use protofs_core::mtproto::proxy::{
    MtprotoSecret, ProxyAuth, ProxyConfig, ProxyType, build_fake_tls_client_hello, connect_stream,
    generate_obfuscated2_init, http_connect_handshake, ping_proxy, socks5_handshake,
};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt, duplex};
use tokio::net::TcpListener;

#[tokio::test]
async fn test_socks5_flow_with_auth_and_domain() {
    let (mut client, mut server) = duplex(2048);

    let server_task = tokio::spawn(async move {
        // 1. Method negotiation: [0x05, 0x02, 0x00, 0x02]
        let mut greet = [0u8; 4];
        server.read_exact(&mut greet).await.unwrap();
        assert_eq!(greet[0], 0x05);

        // Accept user/pass method
        server.write_all(&[0x05, 0x02]).await.unwrap();

        // 2. Read subnegotiation
        let ver = server.read_u8().await.unwrap();
        assert_eq!(ver, 0x01);
        let ulen = server.read_u8().await.unwrap() as usize;
        let mut user = vec![0u8; ulen];
        server.read_exact(&mut user).await.unwrap();
        assert_eq!(String::from_utf8(user).unwrap(), "tg_user");

        let plen = server.read_u8().await.unwrap() as usize;
        let mut pass = vec![0u8; plen];
        server.read_exact(&mut pass).await.unwrap();
        assert_eq!(String::from_utf8(pass).unwrap(), "tg_pass");

        // Respond Auth OK
        server.write_all(&[0x01, 0x00]).await.unwrap();

        // 3. Read CONNECT command with domain name
        let mut req_hdr = [0u8; 4];
        server.read_exact(&mut req_hdr).await.unwrap();
        assert_eq!(req_hdr[0], 0x05); // Ver
        assert_eq!(req_hdr[1], 0x01); // CMD Connect
        assert_eq!(req_hdr[3], 0x03); // ATYP Domain

        let dlen = server.read_u8().await.unwrap() as usize;
        let mut domain = vec![0u8; dlen];
        server.read_exact(&mut domain).await.unwrap();
        assert_eq!(String::from_utf8(domain).unwrap(), "venus.web.telegram.org");

        let port = server.read_u16().await.unwrap();
        assert_eq!(port, 443);

        // Respond CONNECT Success
        server
            .write_all(&[0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x01, 0xbb])
            .await
            .unwrap();
    });

    let auth = ProxyAuth {
        username: "tg_user".to_string(),
        password: "tg_pass".to_string(),
    };

    socks5_handshake(&mut client, "venus.web.telegram.org", 443, Some(&auth))
        .await
        .unwrap();

    server_task.await.unwrap();
}

#[tokio::test]
async fn test_http_tunnel_with_credentials() {
    let (mut client, mut server) = duplex(2048);

    let server_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let mut b = [0u8; 1];
        while !buf.ends_with(b"\r\n\r\n") {
            server.read_exact(&mut b).await.unwrap();
            buf.push(b[0]);
        }
        let req = String::from_utf8_lossy(&buf);
        assert!(req.contains("CONNECT 149.154.167.50:443 HTTP/1.1"));
        assert!(req.contains("Proxy-Authorization: Basic"));

        server
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await
            .unwrap();
    });

    let auth = ProxyAuth {
        username: "proxy_user".to_string(),
        password: "secret_password".to_string(),
    };

    http_connect_handshake(&mut client, "149.154.167.50", 443, Some(&auth))
        .await
        .unwrap();

    server_task.await.unwrap();
}

#[test]
fn test_mtproto_secrets_and_fake_tls() {
    // 1. Standard hex secret
    let standard = MtprotoSecret::parse("d0e0f00102030405060708090a0b0c0d").unwrap();
    assert!(!standard.is_dd);
    assert_eq!(standard.tls_domain, None);
    let init_std = generate_obfuscated2_init(&standard);
    assert_eq!(&init_std[56..60], &[0xee, 0xee, 0xee, 0xee]);

    // 2. DD obfuscated secret
    let dd = MtprotoSecret::parse("ddd0e0f00102030405060708090a0b0c0d").unwrap();
    assert!(dd.is_dd);
    assert_eq!(dd.tls_domain, None);
    let init_dd = generate_obfuscated2_init(&dd);
    assert_eq!(&init_dd[56..60], &[0xdd, 0xdd, 0xdd, 0xdd]);

    // 3. EE Fake-TLS secret with custom domain SNI (e.g. cloudflare.com = 636c6f7564666c6172652e636f6d)
    let ee = MtprotoSecret::parse("eed0e0f00102030405060708090a0b0c0d636c6f7564666c6172652e636f6d")
        .unwrap();
    assert!(!ee.is_dd);
    assert_eq!(ee.tls_domain, Some("cloudflare.com".to_string()));

    let client_hello = build_fake_tls_client_hello(&ee);
    assert_eq!(client_hello[0], 0x16); // TLS record
    assert_eq!(client_hello[5], 0x01); // ClientHello
    let str_repr = String::from_utf8_lossy(&client_hello);
    assert!(str_repr.contains("cloudflare.com"));
}

#[tokio::test]
async fn test_connector_and_ping_flow() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let server_task = tokio::spawn(async move {
        // Accept first ping/connect
        let (s1, _) = listener.accept().await.unwrap();
        drop(s1);
        // Accept second
        let (s2, _) = listener.accept().await.unwrap();
        drop(s2);
    });

    let config = ProxyConfig::Direct;
    assert!(config.is_direct());
    assert_eq!(config.proxy_type(), ProxyType::Direct);

    // Direct connect
    let stream = connect_stream("127.0.0.1", port, Some(&config), Duration::from_secs(2))
        .await
        .unwrap();
    drop(stream);

    // Ping check
    let duration = ping_proxy("127.0.0.1", port, Some(&config), Duration::from_secs(2))
        .await
        .unwrap();
    assert!(duration.as_millis() < 2000);

    server_task.await.unwrap();
}

#[tokio::test]
async fn test_local_proxy_bridge_mtproto_tunnel() {
    use aes::Aes256;
    use cipher::{KeyIvInit, StreamCipher};
    use ctr::Ctr128BE;
    use protofs_core::mtproto::proxy::LocalProxyBridge;
    use tokio::net::TcpStream;

    // 1. Mock upstream MTProxy server
    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_port = upstream_listener.local_addr().unwrap().port();

    let secret = MtprotoSecret::parse("0123456789abcdef0123456789abcdef").unwrap();
    let secret_bytes = secret.secret_bytes;

    let server_task = tokio::spawn(async move {
        let (mut socket, _) = upstream_listener.accept().await.unwrap();

        // Read 64-byte Obfuscated2 header
        let mut init_buf = [0u8; 64];
        socket.read_exact(&mut init_buf).await.unwrap();

        // Server derives RX key/iv from init_buf[8..40] and init_buf[40..56]
        let mut rx_key_data = Vec::with_capacity(32 + 16);
        rx_key_data.extend_from_slice(&init_buf[8..40]);
        rx_key_data.extend_from_slice(&secret_bytes);
        let rx_key = ring::digest::digest(&ring::digest::SHA256, &rx_key_data);
        let rx_iv = &init_buf[40..56];
        let mut rx_cipher = Ctr128BE::<Aes256>::new_from_slices(rx_key.as_ref(), rx_iv).unwrap();

        // Decrypt the 64-byte header
        let mut decrypted_init = init_buf;
        rx_cipher.apply_keystream(&mut decrypted_init);

        // Verify protocol tag (0xeeeeeeee) and DC ID (2)
        assert_eq!(&decrypted_init[56..60], &[0xee, 0xee, 0xee, 0xee]);
        let dc_id = i16::from_le_bytes([decrypted_init[60], decrypted_init[61]]);
        assert_eq!(dc_id, 2);

        // Server derives TX key/iv from reversed init_buf
        let mut init_rev = init_buf;
        init_rev.reverse();
        let mut tx_key_data = Vec::with_capacity(32 + 16);
        tx_key_data.extend_from_slice(&init_rev[8..40]);
        tx_key_data.extend_from_slice(&secret_bytes);
        let tx_key = ring::digest::digest(&ring::digest::SHA256, &tx_key_data);
        let tx_iv = &init_rev[40..56];
        let mut tx_cipher = Ctr128BE::<Aes256>::new_from_slices(tx_key.as_ref(), tx_iv).unwrap();

        // Read subsequent MTProto payload from client (Intermediate format: [len (4)] [payload])
        let mut len_buf = [0u8; 4];
        socket.read_exact(&mut len_buf).await.unwrap();
        rx_cipher.apply_keystream(&mut len_buf);
        let inter_len = u32::from_le_bytes(len_buf) as usize;
        assert_eq!(inter_len, 8); // b"PING_REQ".len()

        let mut client_msg = vec![0u8; inter_len];
        socket.read_exact(&mut client_msg).await.unwrap();
        rx_cipher.apply_keystream(&mut client_msg);
        assert_eq!(&client_msg, b"PING_REQ");

        // Send encrypted response back in Intermediate format: [len (4)] [payload]
        let mut response = Vec::new();
        response.extend_from_slice(&8u32.to_le_bytes());
        response.extend_from_slice(b"PONG_RES");
        tx_cipher.apply_keystream(&mut response);
        socket.write_all(&response).await.unwrap();
    });

    // 2. Start LocalProxyBridge pointing to mock upstream MTProxy
    let proxy_cfg = ProxyConfig::Mtproto {
        host: "127.0.0.1".to_string(),
        port: upstream_port,
        secret,
    };
    let bridge = LocalProxyBridge::start(proxy_cfg).await.unwrap();

    // 3. Client connects via SOCKS5 to LocalProxyBridge
    let mut client = TcpStream::connect(format!("127.0.0.1:{}", bridge.local_port))
        .await
        .unwrap();

    // SOCKS5 greeting [0x05, 1 method, NO_AUTH (0x00)]
    client.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
    let mut greet_resp = [0u8; 2];
    client.read_exact(&mut greet_resp).await.unwrap();
    assert_eq!(greet_resp, [0x05, 0x00]);

    // SOCKS5 CONNECT to DC 2 (149.154.167.50:443)
    client
        .write_all(&[0x05, 0x01, 0x00, 0x01, 149, 154, 167, 50, 0x01, 0xbb])
        .await
        .unwrap();
    let mut conn_resp = [0u8; 10];
    client.read_exact(&mut conn_resp).await.unwrap();
    assert_eq!(conn_resp[0..4], [0x05, 0x00, 0x00, 0x01]);

    // Send Full Transport frame: [full_len: 4 (8 + 12 = 20)] [seq_no: 4 (0)] [payload: 8] [crc32: 4]
    let mut full_frame = Vec::new();
    full_frame.extend_from_slice(&20u32.to_le_bytes());
    full_frame.extend_from_slice(&0u32.to_le_bytes());
    full_frame.extend_from_slice(b"PING_REQ");
    let mut hasher = crc32fast::Hasher::new();
    hasher.update(&full_frame);
    let crc = hasher.finalize();
    full_frame.extend_from_slice(&crc.to_le_bytes());

    client.write_all(&full_frame).await.unwrap();

    // Read Full Transport frame response: [full_len: 4] [seq_no: 4] [payload: 8] [crc32: 4]
    let mut resp_len_buf = [0u8; 4];
    client.read_exact(&mut resp_len_buf).await.unwrap();
    let resp_full_len = u32::from_le_bytes(resp_len_buf) as usize;
    assert_eq!(resp_full_len, 20);

    let mut resp_rest = vec![0u8; resp_full_len - 4];
    client.read_exact(&mut resp_rest).await.unwrap();
    let resp_seq = u32::from_le_bytes(resp_rest[0..4].try_into().unwrap());
    assert_eq!(resp_seq, 0);
    assert_eq!(&resp_rest[4..12], b"PONG_RES");

    server_task.await.unwrap();
}
