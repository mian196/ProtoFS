use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio::time::timeout;

use super::http::http_connect_handshake;
use super::model::{ProxyConfig, ProxyError};
use super::mtproto::mtproto_proxy_handshake;
use super::socks5::socks5_handshake;

/// Connects to a target host and port, either directly or through the configured proxy.
pub async fn connect_stream(
    target_host: &str,
    target_port: u16,
    proxy: Option<&ProxyConfig>,
    connect_timeout: Duration,
) -> Result<TcpStream, ProxyError> {
    let fut = async {
        match proxy {
            None | Some(ProxyConfig::Direct) => {
                let target = format!("{}:{}", target_host, target_port);
                let stream = TcpStream::connect(&target).await.map_err(|e| {
                    ProxyError::DnsResolutionFailed(target_host.to_string(), e.to_string())
                })?;
                Ok(stream)
            }
            Some(ProxyConfig::Socks5 { host, port, auth }) => {
                let proxy_addr = format!("{}:{}", host, port);
                let mut stream = TcpStream::connect(&proxy_addr).await.map_err(|e| {
                    ProxyError::DnsResolutionFailed(host.clone(), e.to_string())
                })?;
                socks5_handshake(&mut stream, target_host, target_port, auth.as_ref()).await?;
                Ok(stream)
            }
            Some(ProxyConfig::Http { host, port, auth }) => {
                let proxy_addr = format!("{}:{}", host, port);
                let mut stream = TcpStream::connect(&proxy_addr).await.map_err(|e| {
                    ProxyError::DnsResolutionFailed(host.clone(), e.to_string())
                })?;
                http_connect_handshake(&mut stream, target_host, target_port, auth.as_ref())
                    .await?;
                Ok(stream)
            }
            Some(ProxyConfig::Mtproto { host, port, secret }) => {
                let proxy_addr = format!("{}:{}", host, port);
                let mut stream = TcpStream::connect(&proxy_addr).await.map_err(|e| {
                    ProxyError::DnsResolutionFailed(host.clone(), e.to_string())
                })?;
                mtproto_proxy_handshake(&mut stream, secret, target_host, target_port).await?;
                Ok(stream)
            }
        }
    };

    match timeout(connect_timeout, fut).await {
        Ok(res) => res,
        Err(_) => Err(ProxyError::ConnectionTimeout(format!(
            "Timed out after {:?}",
            connect_timeout
        ))),
    }
}

/// Measures round-trip reachability and latency to a Telegram endpoint through a proxy.
pub async fn ping_proxy(
    target_host: &str,
    target_port: u16,
    proxy: Option<&ProxyConfig>,
    connect_timeout: Duration,
) -> Result<Duration, ProxyError> {
    let start = Instant::now();
    let _stream = connect_stream(target_host, target_port, proxy, connect_timeout).await?;
    Ok(start.elapsed())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn test_direct_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let server_task = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            drop(socket);
        });

        let stream = connect_stream("127.0.0.1", port, None, Duration::from_secs(2))
            .await
            .unwrap();
        drop(stream);
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn test_connection_timeout() {
        // Non-routable IP address to force timeout
        let res = connect_stream("10.255.255.1", 80, None, Duration::from_millis(50)).await;
        assert!(matches!(res, Err(ProxyError::ConnectionTimeout(_)) | Err(ProxyError::DnsResolutionFailed(..))));
    }
}
