use ring::hmac;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::model::{MtprotoSecret, ProxyError};

/// Constructs and sends an MTProto proxy handshake.
/// Handles standard 32-hex secrets, `dd` intermediate obfuscation, and `ee` Fake-TLS.
pub async fn mtproto_proxy_handshake<S>(
    stream: &mut S,
    secret: &MtprotoSecret,
    _target_dc_ip: &str,
    _target_dc_port: u16,
) -> Result<(), ProxyError>
where
    S: AsyncReadExt + AsyncWriteExt + Unpin,
{
    if secret.tls_domain.is_some()
        || secret.raw_secret.starts_with("ee")
        || secret.raw_secret.starts_with("EE")
    {
        fake_tls_handshake(stream, secret).await
    } else {
        obfuscated2_handshake(stream, secret).await
    }
}

/// Generates standard MTProto Obfuscated2 64-byte random initialization payload
pub fn generate_obfuscated2_init(secret: &MtprotoSecret) -> [u8; 64] {
    let mut buf = [0u8; 64];
    loop {
        ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut buf).unwrap();

        // Disallow forbidden starting bytes/words
        if buf[0] == 0xef {
            continue;
        }

        let first4 = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
        if first4 == 0x44414548 // HEAD
            || first4 == 0x54534f50 // POST
            || first4 == 0x20544547 // GET
            || first4 == 0xeeeeeeee
            || first4 == 0
        {
            continue;
        }

        let second4 = u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]);
        if second4 == 0 {
            continue;
        }

        // Set protocol tag at bytes 56..60
        let tag = if secret.is_dd {
            [0xdd, 0xdd, 0xdd, 0xdd] // Intermediate
        } else {
            [0xee, 0xee, 0xee, 0xee] // Abridged / Obfuscated
        };
        buf[56..60].copy_from_slice(&tag);
        break;
    }
    buf
}

async fn obfuscated2_handshake<S>(stream: &mut S, secret: &MtprotoSecret) -> Result<(), ProxyError>
where
    S: AsyncReadExt + AsyncWriteExt + Unpin,
{
    let init_buf = generate_obfuscated2_init(secret);
    stream.write_all(&init_buf).await?;
    stream.flush().await?;
    Ok(())
}

/// Constructs a TLS 1.3 ClientHello record with SNI domain and HMAC-SHA256 signature
pub fn build_fake_tls_client_hello(secret: &MtprotoSecret) -> Vec<u8> {
    let domain = secret.tls_domain.as_deref().unwrap_or("www.google.com");

    let mut client_hello_body = Vec::new();

    // Client version: TLS 1.2 (0x0303)
    client_hello_body.extend_from_slice(&[0x03, 0x03]);

    // Client Random: 32 bytes placeholder (will be overwritten with HMAC timestamp/random)
    let random_offset = client_hello_body.len();
    let mut random_bytes = [0u8; 32];
    ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut random_bytes).unwrap();
    client_hello_body.extend_from_slice(&random_bytes);

    // Session ID: 32 bytes (Legacy session ID)
    let mut session_id = [0u8; 32];
    ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut session_id).unwrap();
    client_hello_body.push(32); // Session ID length
    client_hello_body.extend_from_slice(&session_id);

    // Cipher Suites
    let cipher_suites: [u8; 8] = [
        0x13, 0x01, // TLS_AES_128_GCM_SHA256
        0x13, 0x02, // TLS_AES_256_GCM_SHA384
        0x13, 0x03, // TLS_CHACHA20_POLY1305_SHA256
        0xc0, 0x2b, // TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256
    ];
    client_hello_body.extend_from_slice(&(cipher_suites.len() as u16).to_be_bytes());
    client_hello_body.extend_from_slice(&cipher_suites);

    // Compression Methods: [0x01, 0x00] (None)
    client_hello_body.extend_from_slice(&[0x01, 0x00]);

    // Extensions
    let mut extensions = Vec::new();

    // 1. SNI Extension (0x0000)
    let mut sni_ext = Vec::new();
    let domain_bytes = domain.as_bytes();
    let sni_list_len = (domain_bytes.len() + 3) as u16;
    sni_ext.extend_from_slice(&sni_list_len.to_be_bytes());
    sni_ext.push(0x00); // HostName type
    sni_ext.extend_from_slice(&(domain_bytes.len() as u16).to_be_bytes());
    sni_ext.extend_from_slice(domain_bytes);

    extensions.extend_from_slice(&0x0000u16.to_be_bytes()); // Type SNI
    extensions.extend_from_slice(&(sni_ext.len() as u16).to_be_bytes());
    extensions.extend_from_slice(&sni_ext);

    // 2. Supported Versions (0x002b) -> TLS 1.3 (0x0304)
    let sup_vers = [0x02, 0x03, 0x04];
    extensions.extend_from_slice(&0x002bu16.to_be_bytes());
    extensions.extend_from_slice(&(sup_vers.len() as u16).to_be_bytes());
    extensions.extend_from_slice(&sup_vers);

    // Add extensions to ClientHello body
    client_hello_body.extend_from_slice(&(extensions.len() as u16).to_be_bytes());
    client_hello_body.extend_from_slice(&extensions);

    // Assemble complete TLS record:
    // 0x16 (Handshake record), 0x0301 (TLS 1.0 version), 2 bytes record length
    let handshake_len = (client_hello_body.len() + 4) as u16; // 1 byte type + 3 bytes len
    let mut record = Vec::with_capacity(5 + client_hello_body.len() + 4);

    record.push(0x16); // ContentType: Handshake
    record.extend_from_slice(&[0x03, 0x01]); // TLS 1.0 legacy record version
    record.extend_from_slice(&handshake_len.to_be_bytes());

    // Handshake header: 0x01 (ClientHello), 3 bytes length
    record.push(0x01);
    let body_len = client_hello_body.len() as u32;
    record.push((body_len >> 16) as u8);
    record.push((body_len >> 8) as u8);
    record.push(body_len as u8);
    record.extend_from_slice(&client_hello_body);

    // Calculate HMAC-SHA256 signature with MTProto secret key over record bytes
    // and place into the Random field at record offset (5 + 4 + random_offset)
    let s_key = hmac::Key::new(hmac::HMAC_SHA256, &secret.secret_bytes);
    let signature = hmac::sign(&s_key, &record);
    let rand_start = 5 + 4 + random_offset;
    record[rand_start..rand_start + 32].copy_from_slice(&signature.as_ref()[0..32]);

    record
}

async fn fake_tls_handshake<S>(stream: &mut S, secret: &MtprotoSecret) -> Result<(), ProxyError>
where
    S: AsyncReadExt + AsyncWriteExt + Unpin,
{
    let client_hello = build_fake_tls_client_hello(secret);
    stream.write_all(&client_hello).await?;
    stream.flush().await?;

    // Read TLS ServerHello response (at least 5 bytes TLS record header)
    let mut record_hdr = [0u8; 5];
    stream.read_exact(&mut record_hdr).await?;

    // ContentType 0x16 (Handshake) or 0x14 (ChangeCipherSpec) or 0x17 (ApplicationData)
    if record_hdr[0] != 0x16 && record_hdr[0] != 0x14 && record_hdr[0] != 0x17 {
        return Err(ProxyError::HandshakeFailed(format!(
            "Invalid TLS response content type from MTProto proxy: 0x{:02x}",
            record_hdr[0]
        )));
    }

    let payload_len = u16::from_be_bytes([record_hdr[3], record_hdr[4]]) as usize;
    if payload_len > 16384 {
        return Err(ProxyError::HandshakeFailed(format!(
            "TLS response record too large: {} bytes",
            payload_len
        )));
    }

    let mut payload = vec![0u8; payload_len];
    stream.read_exact(&mut payload).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    #[test]
    fn test_obfuscated2_init_validity() {
        let secret = MtprotoSecret::parse("0123456789abcdef0123456789abcdef").unwrap();
        let init = generate_obfuscated2_init(&secret);
        assert_ne!(init[0], 0xef);
        assert_eq!(&init[56..60], &[0xee, 0xee, 0xee, 0xee]);

        let dd_secret = MtprotoSecret::parse("dd0123456789abcdef0123456789abcdef").unwrap();
        let dd_init = generate_obfuscated2_init(&dd_secret);
        assert_eq!(&dd_init[56..60], &[0xdd, 0xdd, 0xdd, 0xdd]);
    }

    #[test]
    fn test_fake_tls_client_hello_structure() {
        let secret =
            MtprotoSecret::parse("ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d")
                .unwrap();
        let record = build_fake_tls_client_hello(&secret);

        assert_eq!(record[0], 0x16); // TLS Handshake
        assert_eq!(record[1], 0x03); // TLS 1.0 legacy version
        assert_eq!(record[2], 0x01);
        assert_eq!(record[5], 0x01); // Handshake Type: ClientHello

        // Must contain "www.google.com" in the SNI extension
        let record_str = String::from_utf8_lossy(&record);
        assert!(record_str.contains("www.google.com"));
    }

    #[tokio::test]
    async fn test_fake_tls_handshake_flow() {
        let (mut client, mut server) = duplex(4096);
        let secret =
            MtprotoSecret::parse("ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d")
                .unwrap();

        let server_task = tokio::spawn(async move {
            let mut hdr = [0u8; 5];
            server.read_exact(&mut hdr).await.unwrap();
            assert_eq!(hdr[0], 0x16);
            let len = u16::from_be_bytes([hdr[3], hdr[4]]) as usize;
            let mut body = vec![0u8; len];
            server.read_exact(&mut body).await.unwrap();

            // Send simulated ServerHello (ContentType 0x16, TLS 1.2, 8 bytes dummy body)
            server
                .write_all(&[0x16, 0x03, 0x03, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 7, 8])
                .await
                .unwrap();
        });

        fake_tls_handshake(&mut client, &secret).await.unwrap();
        server_task.await.unwrap();
    }
}
