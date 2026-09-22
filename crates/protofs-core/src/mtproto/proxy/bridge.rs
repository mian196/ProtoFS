use std::sync::Arc;
use std::time::Duration;

use aes::Aes256;
use cipher::{KeyIvInit, StreamCipher};
use ctr::Ctr128BE;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tracing::{debug, info, trace, warn};

use super::http::http_connect_handshake;
use super::model::{MtprotoSecret, ProxyConfig, ProxyError};
use super::mtproto::fake_tls_handshake;

/// An in-process SOCKS5 loopback bridge that forwards outgoing
/// MTProto connections through non-SOCKS5 proxies (Fake-TLS / DD MTProto proxies or HTTP CONNECT).
#[derive(Debug)]
pub struct LocalProxyBridge {
    pub local_port: u16,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl LocalProxyBridge {
    /// Starts a local SOCKS5 bridge on 127.0.0.1 on an ephemeral OS port.
    pub async fn start(proxy: ProxyConfig) -> Result<Self, ProxyError> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(ProxyError::Io)?;
        let local_port = listener.local_addr().map_err(ProxyError::Io)?.port();
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel();
        let proxy = Arc::new(proxy);

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => {
                        debug!("LocalProxyBridge on port {} shutting down", local_port);
                        break;
                    }
                    res = listener.accept() => {
                        match res {
                            Ok((client_stream, _peer)) => {
                                let proxy_clone = Arc::clone(&proxy);
                                tokio::spawn(async move {
                                    if let Err(e) = handle_socks5_client(client_stream, proxy_clone).await {
                                        debug!("LocalProxyBridge client handler: {}", e);
                                    }
                                });
                            }
                            Err(e) => {
                                warn!("LocalProxyBridge accept error: {}", e);
                                break;
                            }
                        }
                    }
                }
            }
        });

        info!("LocalProxyBridge listening on 127.0.0.1:{}", local_port);
        Ok(Self {
            local_port,
            shutdown_tx: Some(shutdown_tx),
        })
    }
}

impl Drop for LocalProxyBridge {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

async fn handle_socks5_client(
    mut client: TcpStream,
    proxy: Arc<ProxyConfig>,
) -> Result<(), ProxyError> {
    // 1. SOCKS5 Greeting negotiation: [VER (0x05), NMETHODS, METHODS...]
    let mut header = [0u8; 2];
    client
        .read_exact(&mut header)
        .await
        .map_err(ProxyError::Io)?;
    if header[0] != 0x05 {
        return Err(ProxyError::HandshakeFailed(
            "Invalid SOCKS version, expected 5".to_string(),
        ));
    }
    let nmethods = header[1] as usize;
    let mut methods = vec![0u8; nmethods];
    client
        .read_exact(&mut methods)
        .await
        .map_err(ProxyError::Io)?;

    // Accept NO_AUTH (0x00)
    client
        .write_all(&[0x05, 0x00])
        .await
        .map_err(ProxyError::Io)?;
    client.flush().await.map_err(ProxyError::Io)?;

    // 2. SOCKS5 Request: [VER (0x05), CMD (0x01 = CONNECT), RSV (0x00), ATYP, DST.ADDR, DST.PORT]
    let mut req_header = [0u8; 4];
    client
        .read_exact(&mut req_header)
        .await
        .map_err(ProxyError::Io)?;
    if req_header[0] != 0x05 || req_header[1] != 0x01 {
        let _ = client
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await;
        return Err(ProxyError::HandshakeFailed(
            "Only SOCKS5 CONNECT (0x01) supported".to_string(),
        ));
    }

    let atyp = req_header[3];
    let (dst_host, dst_port) = match atyp {
        0x01 => {
            // IPv4: 4 bytes + 2 bytes port
            let mut buf = [0u8; 6];
            client.read_exact(&mut buf).await.map_err(ProxyError::Io)?;
            let ip = std::net::Ipv4Addr::new(buf[0], buf[1], buf[2], buf[3]);
            let port = u16::from_be_bytes([buf[4], buf[5]]);
            (ip.to_string(), port)
        }
        0x03 => {
            // Domain: 1 byte len + domain bytes + 2 bytes port
            let mut len_buf = [0u8; 1];
            client
                .read_exact(&mut len_buf)
                .await
                .map_err(ProxyError::Io)?;
            let len = len_buf[0] as usize;
            let mut domain_buf = vec![0u8; len];
            client
                .read_exact(&mut domain_buf)
                .await
                .map_err(ProxyError::Io)?;
            let mut port_buf = [0u8; 2];
            client
                .read_exact(&mut port_buf)
                .await
                .map_err(ProxyError::Io)?;
            let domain = String::from_utf8(domain_buf).map_err(|e| {
                ProxyError::HandshakeFailed(format!("Invalid UTF-8 in domain: {}", e))
            })?;
            let port = u16::from_be_bytes(port_buf);
            (domain, port)
        }
        0x04 => {
            // IPv6: 16 bytes + 2 bytes port
            let mut buf = [0u8; 18];
            client.read_exact(&mut buf).await.map_err(ProxyError::Io)?;
            let mut octets = [0u8; 16];
            octets.copy_from_slice(&buf[0..16]);
            let ip = std::net::Ipv6Addr::from(octets);
            let port = u16::from_be_bytes([buf[16], buf[17]]);
            (ip.to_string(), port)
        }
        _ => {
            let _ = client
                .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await;
            return Err(ProxyError::HandshakeFailed(format!(
                "Unsupported SOCKS5 ATYP: {}",
                atyp
            )));
        }
    };

    trace!(
        "LocalProxyBridge handle_socks5_client: dst_host={}, dst_port={}",
        dst_host, dst_port
    );
    match &*proxy {
        ProxyConfig::Mtproto { host, port, secret } => {
            let upstream_addr = format!("{}:{}", host, port);
            let upstream = match tokio::time::timeout(
                Duration::from_secs(10),
                TcpStream::connect(&upstream_addr),
            )
            .await
            {
                Ok(Ok(s)) => s,
                Ok(Err(e)) => {
                    let _ = client
                        .write_all(&[0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                        .await;
                    return Err(ProxyError::Io(e));
                }
                Err(_) => {
                    let _ = client
                        .write_all(&[0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                        .await;
                    return Err(ProxyError::ConnectionTimeout(upstream_addr));
                }
            };

            // Send SOCKS5 success reply to client
            client
                .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await
                .map_err(ProxyError::Io)?;
            client.flush().await.map_err(ProxyError::Io)?;

            handle_mtproto_tunnel(client, upstream, secret, &dst_host).await
        }
        ProxyConfig::Http { host, port, auth } => {
            let upstream_addr = format!("{}:{}", host, port);
            let mut upstream = match tokio::time::timeout(
                Duration::from_secs(10),
                TcpStream::connect(&upstream_addr),
            )
            .await
            {
                Ok(Ok(s)) => s,
                Ok(Err(e)) => {
                    let _ = client
                        .write_all(&[0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                        .await;
                    return Err(ProxyError::Io(e));
                }
                Err(_) => {
                    let _ = client
                        .write_all(&[0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                        .await;
                    return Err(ProxyError::ConnectionTimeout(upstream_addr));
                }
            };

            if let Err(e) =
                http_connect_handshake(&mut upstream, &dst_host, dst_port, auth.as_ref()).await
            {
                let _ = client
                    .write_all(&[0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                    .await;
                return Err(e);
            }

            // Send SOCKS5 success reply to client
            client
                .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await
                .map_err(ProxyError::Io)?;
            client.flush().await.map_err(ProxyError::Io)?;

            let (mut client_read, mut client_write) = client.into_split();
            let (mut up_read, mut up_write) = upstream.into_split();

            let client_to_up = tokio::io::copy(&mut client_read, &mut up_write);
            let up_to_client = tokio::io::copy(&mut up_read, &mut client_write);

            tokio::select! {
                _ = client_to_up => {},
                _ = up_to_client => {},
            }
            Ok(())
        }
        _ => {
            let upstream_addr = format!("{}:{}", dst_host, dst_port);
            let upstream = TcpStream::connect(&upstream_addr)
                .await
                .map_err(ProxyError::Io)?;

            client
                .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await
                .map_err(ProxyError::Io)?;
            client.flush().await.map_err(ProxyError::Io)?;

            let (mut client_read, mut client_write) = client.into_split();
            let (mut up_read, mut up_write) = upstream.into_split();

            let client_to_up = tokio::io::copy(&mut client_read, &mut up_write);
            let up_to_client = tokio::io::copy(&mut up_read, &mut client_write);

            tokio::select! {
                _ = client_to_up => {},
                _ = up_to_client => {},
            }
            Ok(())
        }
    }
}

fn resolve_dc_id(dst_host: &str) -> i16 {
    if dst_host.contains("149.154.175.50") {
        1
    } else if dst_host.contains("149.154.167.50") || dst_host.contains("149.154.167.51") {
        2
    } else if dst_host.contains("149.154.175.100") {
        3
    } else if dst_host.contains("149.154.167.91")
        || dst_host.contains("149.154.167.92")
        || dst_host.contains("91.108.56.143")
    {
        4
    } else if dst_host.contains("91.108.56.165") || dst_host.contains("91.108.56") {
        5
    } else {
        2
    }
}

fn generate_init_header(
    secret: &MtprotoSecret,
    dc_id: i16,
) -> ([u8; 64], Ctr128BE<Aes256>, Ctr128BE<Aes256>) {
    let mut init = [0u8; 64];
    loop {
        ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut init).unwrap();
        if init[0] == 0xef {
            continue;
        }
        let first4 = u32::from_le_bytes([init[0], init[1], init[2], init[3]]);
        if first4 == 0x44414548
            || first4 == 0x54534f50
            || first4 == 0x20544547
            || first4 == 0xeeeeeeee
            || first4 == 0
        {
            continue;
        }
        let second4 = u32::from_le_bytes([init[4], init[5], init[6], init[7]]);
        if second4 == 0 {
            continue;
        }
        break;
    }

    let tag = if secret.is_dd {
        [0xdd, 0xdd, 0xdd, 0xdd]
    } else {
        [0xee, 0xee, 0xee, 0xee]
    };
    init[56..60].copy_from_slice(&tag);
    init[60..62].copy_from_slice(&dc_id.to_le_bytes());
    init[62..64].copy_from_slice(&[0, 0]);

    let mut tx_key_data = Vec::with_capacity(32 + 16);
    tx_key_data.extend_from_slice(&init[8..40]);
    tx_key_data.extend_from_slice(&secret.secret_bytes);
    let tx_key = ring::digest::digest(&ring::digest::SHA256, &tx_key_data);
    let tx_iv = &init[40..56];

    let mut init_rev = init;
    init_rev.reverse();
    let mut rx_key_data = Vec::with_capacity(32 + 16);
    rx_key_data.extend_from_slice(&init_rev[8..40]);
    rx_key_data.extend_from_slice(&secret.secret_bytes);
    let rx_key = ring::digest::digest(&ring::digest::SHA256, &rx_key_data);
    let rx_iv = &init_rev[40..56];

    let mut tx_cipher = Ctr128BE::<Aes256>::new_from_slices(tx_key.as_ref(), tx_iv).unwrap();
    let rx_cipher = Ctr128BE::<Aes256>::new_from_slices(rx_key.as_ref(), rx_iv).unwrap();

    let mut encrypted_init = init;
    tx_cipher.apply_keystream(&mut encrypted_init);

    let mut init_to_send = init;
    init_to_send[56..64].copy_from_slice(&encrypted_init[56..64]);

    (init_to_send, tx_cipher, rx_cipher)
}

fn wrap_tls_record(data: &[u8]) -> Vec<u8> {
    let len = data.len() as u16;
    let mut record = Vec::with_capacity(5 + data.len());
    record.push(0x17); // ContentType: ApplicationData
    record.extend_from_slice(&[0x03, 0x03]); // TLS 1.2
    record.extend_from_slice(&len.to_be_bytes());
    record.extend_from_slice(data);
    record
}

fn calculate_crc32(data: &[u8]) -> u32 {
    let mut hasher = crc32fast::Hasher::new();
    hasher.update(data);
    hasher.finalize()
}

fn strip_mtproto_padding(payload: &[u8]) -> &[u8] {
    if payload.len() < 8 {
        return payload;
    }
    let auth_key_id = u64::from_le_bytes(payload[0..8].try_into().unwrap());
    if auth_key_id == 0 {
        // Unencrypted MTProto message: [auth_key_id (8)] [msg_id (8)] [msg_len (4)] [data (msg_len)]
        if payload.len() >= 20 {
            let msg_len = u32::from_le_bytes(payload[16..20].try_into().unwrap()) as usize;
            let real_len = 20 + msg_len;
            if real_len <= payload.len() {
                return &payload[..real_len];
            }
        }
    } else {
        // Encrypted MTProto message: [auth_key_id (8)] [msg_key (16)] [ciphertext (multiple of 16)]
        if payload.len() >= 24 {
            let pad_len = (payload.len() - 8) % 16;
            let real_len = payload.len() - pad_len;
            return &payload[..real_len];
        }
    }
    payload
}

async fn handle_mtproto_tunnel(
    client: TcpStream,
    mut upstream: TcpStream,
    secret: &MtprotoSecret,
    dst_host: &str,
) -> Result<(), ProxyError> {
    let is_fake_tls = secret.tls_domain.is_some()
        || secret.raw_secret.starts_with("ee")
        || secret.raw_secret.starts_with("EE");

    if is_fake_tls {
        fake_tls_handshake(&mut upstream, secret).await?;
    }

    let dc_id = resolve_dc_id(dst_host);
    let (init_buf, mut tx_cipher, mut rx_cipher) = generate_init_header(secret, dc_id);

    if is_fake_tls {
        let record = wrap_tls_record(&init_buf);
        upstream.write_all(&record).await.map_err(ProxyError::Io)?;
        upstream.flush().await.map_err(ProxyError::Io)?;
    } else {
        upstream
            .write_all(&init_buf)
            .await
            .map_err(ProxyError::Io)?;
        upstream.flush().await.map_err(ProxyError::Io)?;
    }

    let (mut client_read, mut client_write) = client.into_split();
    let (mut up_read, mut up_write) = upstream.into_split();

    // Client (Grammers Full Transport) -> Upstream (MTProxy Intermediate Transport)
    let client_to_up = async move {
        loop {
            // Read 4-byte Full transport length header
            let mut len_buf = [0u8; 4];
            if let Err(e) = client_read.read_exact(&mut len_buf).await {
                debug!("Client read EOF/err on len: {}", e);
                break;
            }
            let full_len = u32::from_le_bytes(len_buf) as usize;
            if !(12..=16 * 1024 * 1024).contains(&full_len) {
                warn!("Invalid Full transport length from client: {}", full_len);
                break;
            }

            // Read the rest of the Full transport frame: [seq_no (4)] [payload (full_len - 12)] [crc32 (4)]
            let rest_len = full_len - 4;
            let mut frame_buf = vec![0u8; rest_len];
            if let Err(e) = client_read.read_exact(&mut frame_buf).await {
                debug!("Client read EOF/err on frame body: {}", e);
                break;
            }

            // frame_buf[0..4] is seq_no
            // frame_buf[4..rest_len-4] is payload
            // frame_buf[rest_len-4..rest_len] is crc32
            let payload = &frame_buf[4..rest_len - 4];
            let payload_len = payload.len();

            // Wrap in Intermediate transport for MTProxy: [inter_len (4 bytes = payload_len)] [payload]
            let inter_len = payload_len as u32;
            let mut out_frame = Vec::with_capacity(4 + payload_len);
            out_frame.extend_from_slice(&inter_len.to_le_bytes());
            out_frame.extend_from_slice(payload);

            tx_cipher.apply_keystream(&mut out_frame);

            if is_fake_tls {
                let mut offset = 0;
                let n_out = out_frame.len();
                while offset < n_out {
                    let chunk_len = (n_out - offset).min(16384);
                    let record = wrap_tls_record(&out_frame[offset..offset + chunk_len]);
                    if let Err(e) = up_write.write_all(&record).await {
                        warn!("Upstream TLS write err: {}", e);
                        return;
                    }
                    offset += chunk_len;
                }
                if let Err(e) = up_write.flush().await {
                    warn!("Upstream TLS flush err: {}", e);
                    return;
                }
            } else {
                if let Err(e) = up_write.write_all(&out_frame).await {
                    warn!("Upstream write err: {}", e);
                    return;
                }
                if let Err(e) = up_write.flush().await {
                    warn!("Upstream flush err: {}", e);
                    return;
                }
            }
        }
    };

    // Upstream (MTProxy Intermediate Transport) -> Client (Grammers Full Transport)
    let up_to_client = async move {
        let mut server_seq_no: u32 = 0;
        if is_fake_tls {
            let mut rx_stream_buf = Vec::new();
            loop {
                // Read from TLS record stream and parse Intermediate frames
                let mut hdr = [0u8; 5];
                if let Err(e) = up_read.read_exact(&mut hdr).await {
                    debug!("Upstream TLS header read EOF/err: {}", e);
                    break;
                }
                let content_type = hdr[0];
                let payload_len = u16::from_be_bytes([hdr[3], hdr[4]]) as usize;
                if payload_len > 16384 {
                    warn!("TLS record too large: {}", payload_len);
                    break;
                }
                let mut tls_payload = vec![0u8; payload_len];
                if let Err(e) = up_read.read_exact(&mut tls_payload).await {
                    debug!("Upstream TLS payload read EOF/err: {}", e);
                    break;
                }

                if content_type == 0x14 || content_type == 0x16 {
                    continue;
                }

                rx_cipher.apply_keystream(&mut tls_payload);
                rx_stream_buf.extend_from_slice(&tls_payload);

                // Process Intermediate frames in rx_stream_buf
                while rx_stream_buf.len() >= 4 {
                    let inter_len = u32::from_le_bytes([
                        rx_stream_buf[0],
                        rx_stream_buf[1],
                        rx_stream_buf[2],
                        rx_stream_buf[3],
                    ]) as usize;

                    if inter_len == 0 || inter_len > 16 * 1024 * 1024 {
                        warn!("Invalid Intermediate length from upstream: {}", inter_len);
                        return;
                    }

                    let total_frame_len = 4 + inter_len;
                    if rx_stream_buf.len() < total_frame_len {
                        break; // Wait for complete frame
                    }

                    let raw_payload = &rx_stream_buf[4..total_frame_len];
                    let payload = strip_mtproto_padding(raw_payload);
                    let payload_len = payload.len();

                    // Convert to Full Transport frame for Grammers:
                    // [full_len: 4] [server_seq_no: 4] [payload: payload_len] [crc32: 4]
                    let full_len = (payload_len + 12) as u32;
                    let mut full_frame = Vec::with_capacity(4 + 4 + payload_len + 4);
                    full_frame.extend_from_slice(&full_len.to_le_bytes());
                    full_frame.extend_from_slice(&server_seq_no.to_le_bytes());
                    full_frame.extend_from_slice(payload);
                    let crc = calculate_crc32(&full_frame);
                    full_frame.extend_from_slice(&crc.to_le_bytes());

                    server_seq_no += 1;

                    if let Err(e) = client_write.write_all(&full_frame).await {
                        warn!("Client write err: {}", e);
                        return;
                    }
                    if let Err(e) = client_write.flush().await {
                        warn!("Client flush err: {}", e);
                        return;
                    }

                    rx_stream_buf.drain(..total_frame_len);
                }
            }
        } else {
            let mut rx_stream_buf = Vec::new();
            let mut read_buf = vec![0u8; 8192];
            loop {
                let n = match up_read.read(&mut read_buf).await {
                    Ok(0) => {
                        debug!("Upstream MTProxy closed connection (EOF)");
                        break;
                    }
                    Ok(n) => n,
                    Err(e) => {
                        debug!("Upstream read err: {}", e);
                        break;
                    }
                };

                rx_cipher.apply_keystream(&mut read_buf[..n]);
                rx_stream_buf.extend_from_slice(&read_buf[..n]);

                // Process Intermediate frames in rx_stream_buf
                while rx_stream_buf.len() >= 4 {
                    let inter_len = u32::from_le_bytes([
                        rx_stream_buf[0],
                        rx_stream_buf[1],
                        rx_stream_buf[2],
                        rx_stream_buf[3],
                    ]) as usize;

                    if inter_len == 0 || inter_len > 16 * 1024 * 1024 {
                        warn!("Invalid Intermediate length from upstream: {}", inter_len);
                        return;
                    }

                    let total_frame_len = 4 + inter_len;
                    if rx_stream_buf.len() < total_frame_len {
                        break; // Wait for complete frame
                    }

                    let raw_payload = &rx_stream_buf[4..total_frame_len];
                    let payload = strip_mtproto_padding(raw_payload);
                    let payload_len = payload.len();

                    // Convert to Full Transport frame for Grammers:
                    // [full_len: 4] [server_seq_no: 4] [payload: payload_len] [crc32: 4]
                    let full_len = (payload_len + 12) as u32;
                    let mut full_frame = Vec::with_capacity(4 + 4 + payload_len + 4);
                    full_frame.extend_from_slice(&full_len.to_le_bytes());
                    full_frame.extend_from_slice(&server_seq_no.to_le_bytes());
                    full_frame.extend_from_slice(payload);
                    let crc = calculate_crc32(&full_frame);
                    full_frame.extend_from_slice(&crc.to_le_bytes());

                    server_seq_no += 1;

                    if let Err(e) = client_write.write_all(&full_frame).await {
                        warn!("Client write err: {}", e);
                        return;
                    }
                    if let Err(e) = client_write.flush().await {
                        warn!("Client flush err: {}", e);
                        return;
                    }

                    rx_stream_buf.drain(..total_frame_len);
                }
            }
        }
    };

    tokio::select! {
        _ = client_to_up => {},
        _ = up_to_client => {},
    }

    Ok(())
}
