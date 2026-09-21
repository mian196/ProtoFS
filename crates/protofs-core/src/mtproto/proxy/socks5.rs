use std::net::{Ipv4Addr, Ipv6Addr};
use std::str::FromStr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::model::{ProxyAuth, ProxyError};

pub async fn socks5_handshake<S>(
    stream: &mut S,
    target_host: &str,
    target_port: u16,
    auth: Option<&ProxyAuth>,
) -> Result<(), ProxyError>
where
    S: AsyncReadExt + AsyncWriteExt + Unpin,
{
    // 1. Send method negotiation
    if let Some(auth_data) = auth {
        // Offer No Auth (0x00) and Username/Password (0x02)
        stream.write_all(&[0x05, 0x02, 0x00, 0x02]).await?;
        stream.flush().await?;

        let mut method_resp = [0u8; 2];
        stream.read_exact(&mut method_resp).await?;

        if method_resp[0] != 0x05 {
            return Err(ProxyError::HandshakeFailed(format!(
                "Invalid SOCKS5 version in method negotiation: 0x{:02x}",
                method_resp[0]
            )));
        }

        match method_resp[1] {
            0x00 => {
                // Server accepted no authentication
            }
            0x02 => {
                // Perform Username/Password subnegotiation (RFC 1929)
                let u_bytes = auth_data.username.as_bytes();
                let p_bytes = auth_data.password.as_bytes();

                if u_bytes.len() > 255 || p_bytes.len() > 255 {
                    return Err(ProxyError::AuthenticationFailed(
                        "Username or password too long (max 255 bytes)".to_string(),
                    ));
                }

                let mut auth_req = Vec::with_capacity(3 + u_bytes.len() + p_bytes.len());
                auth_req.push(0x01); // Auth subnegotiation version
                auth_req.push(u_bytes.len() as u8);
                auth_req.extend_from_slice(u_bytes);
                auth_req.push(p_bytes.len() as u8);
                auth_req.extend_from_slice(p_bytes);

                stream.write_all(&auth_req).await?;
                stream.flush().await?;

                let mut auth_resp = [0u8; 2];
                stream.read_exact(&mut auth_resp).await?;

                if auth_resp[0] != 0x01 || auth_resp[1] != 0x00 {
                    return Err(ProxyError::AuthenticationFailed(format!(
                        "SOCKS5 authentication failed with status 0x{:02x}",
                        auth_resp[1]
                    )));
                }
            }
            0xff => {
                return Err(ProxyError::AuthenticationFailed(
                    "SOCKS5 server rejected available authentication methods".to_string(),
                ));
            }
            other => {
                return Err(ProxyError::HandshakeFailed(format!(
                    "Unsupported SOCKS5 auth method selected by server: 0x{:02x}",
                    other
                )));
            }
        }
    } else {
        // Offer No Auth (0x00) only
        stream.write_all(&[0x05, 0x01, 0x00]).await?;
        stream.flush().await?;

        let mut method_resp = [0u8; 2];
        stream.read_exact(&mut method_resp).await?;

        if method_resp[0] != 0x05 || method_resp[1] != 0x00 {
            return Err(ProxyError::HandshakeFailed(format!(
                "SOCKS5 server requires authentication (code 0x{:02x}) but none configured",
                method_resp[1]
            )));
        }
    }

    // 2. Send CONNECT request
    let mut connect_req = Vec::new();
    connect_req.push(0x05); // Version 5
    connect_req.push(0x01); // CMD: CONNECT
    connect_req.push(0x00); // RSV

    if let Ok(ipv4) = Ipv4Addr::from_str(target_host) {
        connect_req.push(0x01); // ATYP: IPv4
        connect_req.extend_from_slice(&ipv4.octets());
    } else if let Ok(ipv6) = Ipv6Addr::from_str(target_host) {
        connect_req.push(0x04); // ATYP: IPv6
        connect_req.extend_from_slice(&ipv6.octets());
    } else {
        let domain_bytes = target_host.as_bytes();
        if domain_bytes.len() > 255 {
            return Err(ProxyError::HandshakeFailed(
                "Target domain name exceeds 255 bytes".to_string(),
            ));
        }
        connect_req.push(0x03); // ATYP: Domain name
        connect_req.push(domain_bytes.len() as u8);
        connect_req.extend_from_slice(domain_bytes);
    }

    connect_req.extend_from_slice(&target_port.to_be_bytes());
    stream.write_all(&connect_req).await?;
    stream.flush().await?;

    // 3. Read CONNECT response
    let mut resp_header = [0u8; 4];
    stream.read_exact(&mut resp_header).await?;

    if resp_header[0] != 0x05 {
        return Err(ProxyError::HandshakeFailed(format!(
            "Invalid SOCKS5 response version: 0x{:02x}",
            resp_header[0]
        )));
    }

    let rep = resp_header[1];
    if rep != 0x00 {
        let err_desc = match rep {
            0x01 => "general SOCKS server failure",
            0x02 => "connection not allowed by ruleset",
            0x03 => "network unreachable",
            0x04 => "host unreachable",
            0x05 => "connection refused",
            0x06 => "TTL expired",
            0x07 => "command not supported",
            0x08 => "address type not supported",
            _ => "unknown error",
        };
        return Err(ProxyError::HandshakeFailed(format!(
            "SOCKS5 connection rejected (0x{:02x}): {}",
            rep, err_desc
        )));
    }

    // Discard bound address
    match resp_header[3] {
        0x01 => {
            let mut buf = [0u8; 4 + 2]; // 4 bytes IPv4 + 2 bytes port
            stream.read_exact(&mut buf).await?;
        }
        0x04 => {
            let mut buf = [0u8; 16 + 2]; // 16 bytes IPv6 + 2 bytes port
            stream.read_exact(&mut buf).await?;
        }
        0x03 => {
            let len = stream.read_u8().await? as usize;
            let mut buf = vec![0u8; len + 2]; // Domain + 2 bytes port
            stream.read_exact(&mut buf).await?;
        }
        atyp => {
            return Err(ProxyError::HandshakeFailed(format!(
                "Unknown address type in SOCKS5 response: 0x{:02x}",
                atyp
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    #[tokio::test]
    async fn test_socks5_no_auth_success() {
        let (mut client, mut server) = duplex(1024);

        let server_task = tokio::spawn(async move {
            // Read client greeting: [0x05, 0x01, 0x00]
            let mut greet = [0u8; 3];
            server.read_exact(&mut greet).await.unwrap();
            assert_eq!(greet, [0x05, 0x01, 0x00]);

            // Respond No Auth: [0x05, 0x00]
            server.write_all(&[0x05, 0x00]).await.unwrap();

            // Read connect request: [0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, port_hi, port_lo]
            let mut conn_req = [0u8; 10];
            server.read_exact(&mut conn_req).await.unwrap();
            assert_eq!(&conn_req[0..4], &[0x05, 0x01, 0x00, 0x01]);

            // Respond Success: [0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]
            server
                .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await
                .unwrap();
        });

        socks5_handshake(&mut client, "127.0.0.1", 443, None)
            .await
            .unwrap();
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn test_socks5_auth_success() {
        let (mut client, mut server) = duplex(1024);

        let server_task = tokio::spawn(async move {
            // Read greeting offering No Auth and User/Pass
            let mut greet = [0u8; 4];
            server.read_exact(&mut greet).await.unwrap();
            assert_eq!(greet, [0x05, 0x02, 0x00, 0x02]);

            // Select User/Pass (0x02)
            server.write_all(&[0x05, 0x02]).await.unwrap();

            // Read auth subnegotiation
            let mut ver_ulen = [0u8; 2];
            server.read_exact(&mut ver_ulen).await.unwrap();
            assert_eq!(ver_ulen[0], 0x01);
            let ulen = ver_ulen[1] as usize;
            let mut user = vec![0u8; ulen];
            server.read_exact(&mut user).await.unwrap();

            let plen = server.read_u8().await.unwrap() as usize;
            let mut pass = vec![0u8; plen];
            server.read_exact(&mut pass).await.unwrap();

            assert_eq!(String::from_utf8(user).unwrap(), "myuser");
            assert_eq!(String::from_utf8(pass).unwrap(), "mypass");

            // Respond auth success [0x01, 0x00]
            server.write_all(&[0x01, 0x00]).await.unwrap();

            // Read connect request
            let mut conn_req = [0u8; 10];
            server.read_exact(&mut conn_req).await.unwrap();

            // Respond Success
            server
                .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await
                .unwrap();
        });

        let auth = ProxyAuth {
            username: "myuser".to_string(),
            password: "mypass".to_string(),
        };

        socks5_handshake(&mut client, "127.0.0.1", 443, Some(&auth))
            .await
            .unwrap();
        server_task.await.unwrap();
    }
}
