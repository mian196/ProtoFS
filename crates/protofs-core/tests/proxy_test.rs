use std::time::Duration;
use protofs_core::mtproto::proxy::{
    build_fake_tls_client_hello, connect_stream, generate_obfuscated2_init,
    http_connect_handshake, ping_proxy, socks5_handshake, MtprotoSecret, ProxyAuth, ProxyConfig,
    ProxyType,
};
use tokio::io::{duplex, AsyncReadExt, AsyncWriteExt};
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
    let ee = MtprotoSecret::parse("eed0e0f00102030405060708090a0b0c0d636c6f7564666c6172652e636f6d").unwrap();
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
