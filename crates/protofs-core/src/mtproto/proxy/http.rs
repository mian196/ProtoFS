use base64::prelude::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::model::{ProxyAuth, ProxyError};

pub async fn http_connect_handshake<S>(
    stream: &mut S,
    target_host: &str,
    target_port: u16,
    auth: Option<&ProxyAuth>,
) -> Result<(), ProxyError>
where
    S: AsyncReadExt + AsyncWriteExt + Unpin,
{
    let mut req = format!(
        "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\nUser-Agent: Mozilla/5.0 (ProtoFS)\r\nProxy-Connection: Keep-Alive\r\n",
        target_host, target_port, target_host, target_port
    );

    if let Some(auth_data) = auth {
        let creds = format!("{}:{}", auth_data.username, auth_data.password);
        let encoded = BASE64_STANDARD.encode(creds.as_bytes());
        req.push_str(&format!("Proxy-Authorization: Basic {}\r\n", encoded));
    }

    req.push_str("\r\n");

    stream.write_all(req.as_bytes()).await?;
    stream.flush().await?;

    // Read HTTP response until "\r\n\r\n"
    let mut resp_buf = Vec::with_capacity(1024);
    let mut temp = [0u8; 1];

    while !resp_buf.ends_with(b"\r\n\r\n") {
        if resp_buf.len() > 8192 {
            return Err(ProxyError::HandshakeFailed(
                "HTTP proxy response header too large".to_string(),
            ));
        }
        let n = stream.read(&mut temp).await?;
        if n == 0 {
            return Err(ProxyError::HandshakeFailed(
                "HTTP proxy closed connection prematurely".to_string(),
            ));
        }
        resp_buf.push(temp[0]);
    }

    let resp_str = String::from_utf8_lossy(&resp_buf);
    let status_line = resp_str.lines().next().unwrap_or("");

    // Expected format: "HTTP/1.1 200 ..." or "HTTP/1.0 200 ..."
    let parts: Vec<&str> = status_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Err(ProxyError::HandshakeFailed(format!(
            "Malformed HTTP proxy response status line: '{}'",
            status_line
        )));
    }

    let status_code: u16 = parts[1].parse().map_err(|_| {
        ProxyError::HandshakeFailed(format!("Invalid HTTP status code in: '{}'", status_line))
    })?;

    match status_code {
        200..=299 => Ok(()),
        407 => Err(ProxyError::AuthenticationFailed(
            "HTTP 407 Proxy Authentication Required".to_string(),
        )),
        code => Err(ProxyError::HandshakeFailed(format!(
            "HTTP proxy tunnel failed with status code {}: {}",
            code, status_line
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    #[tokio::test]
    async fn test_http_connect_success() {
        let (mut client, mut server) = duplex(1024);

        let server_task = tokio::spawn(async move {
            let mut req_buf = Vec::new();
            let mut temp = [0u8; 1];
            while !req_buf.ends_with(b"\r\n\r\n") {
                server.read_exact(&mut temp).await.unwrap();
                req_buf.push(temp[0]);
            }
            let req_str = String::from_utf8_lossy(&req_buf);
            assert!(req_str.starts_with("CONNECT 149.154.167.50:443 HTTP/1.1\r\n"));

            server
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .unwrap();
        });

        http_connect_handshake(&mut client, "149.154.167.50", 443, None).await.unwrap();
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn test_http_connect_auth_407() {
        let (mut client, mut server) = duplex(1024);

        let server_task = tokio::spawn(async move {
            let mut req_buf = Vec::new();
            let mut temp = [0u8; 1];
            while !req_buf.ends_with(b"\r\n\r\n") {
                server.read_exact(&mut temp).await.unwrap();
                req_buf.push(temp[0]);
            }
            server
                .write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
                .await
                .unwrap();
        });

        let res = http_connect_handshake(&mut client, "149.154.167.50", 443, None).await;
        assert!(matches!(res, Err(ProxyError::AuthenticationFailed(_))));
        server_task.await.unwrap();
    }
}
