use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

use super::connector::connect_stream;
use super::model::{ProxyConfig, ProxyError};

/// Known Telegram Datacenter public endpoints.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TelegramDc {
    pub dc_id: u8,
    pub host: &'static str,
    pub port: u16,
    pub region: &'static str,
}

pub const DC_1: TelegramDc = TelegramDc {
    dc_id: 1,
    host: "149.154.175.50",
    port: 443,
    region: "Miami, USA",
};

pub const DC_2: TelegramDc = TelegramDc {
    dc_id: 2,
    host: "149.154.167.50",
    port: 443,
    region: "Amsterdam, Netherlands",
};

pub const DC_3: TelegramDc = TelegramDc {
    dc_id: 3,
    host: "149.154.175.100",
    port: 443,
    region: "Miami, USA",
};

pub const DC_4: TelegramDc = TelegramDc {
    dc_id: 4,
    host: "149.154.167.91",
    port: 443,
    region: "Amsterdam, Netherlands",
};

pub const DC_5: TelegramDc = TelegramDc {
    dc_id: 5,
    host: "91.108.56.165",
    port: 443,
    region: "Singapore",
};

pub const ALL_DCS: [TelegramDc; 5] = [DC_1, DC_2, DC_3, DC_4, DC_5];

/// Resolves the endpoint for a given Telegram DC id (1-5), defaulting to DC 2 (Amsterdam).
pub fn resolve_telegram_dc(target_dc: Option<u8>) -> TelegramDc {
    match target_dc {
        Some(1) => DC_1,
        Some(2) => DC_2,
        Some(3) => DC_3,
        Some(4) => DC_4,
        Some(5) => DC_5,
        _ => DC_2, // Default test target
    }
}

/// Structured diagnostic result returned by connection testing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProxyDiagnosticResult {
    pub is_connected: bool,
    pub latency_ms: Option<u64>,
    pub target_dc: u8,
    pub target_endpoint: String,
    pub error_code: Option<String>,
    pub message: String,
}

/// Runs a diagnostic connection test against a Telegram DC endpoint via the specified proxy.
/// Enforces a 5-second fail-fast timeout.
pub async fn run_proxy_diagnostic(
    proxy: Option<&ProxyConfig>,
    target_dc: Option<u8>,
) -> ProxyDiagnosticResult {
    let dc = resolve_telegram_dc(target_dc);
    let target_endpoint = format!("{}:{}", dc.host, dc.port);
    let timeout_duration = Duration::from_secs(5);

    let start = Instant::now();
    match connect_stream(dc.host, dc.port, proxy, timeout_duration).await {
        Ok(_stream) => {
            let latency_ms = start.elapsed().as_millis() as u64;
            ProxyDiagnosticResult {
                is_connected: true,
                latency_ms: Some(latency_ms),
                target_dc: dc.dc_id,
                target_endpoint,
                error_code: None,
                message: format!(
                    "Successfully connected to Telegram DC {} ({}) in {}ms",
                    dc.dc_id, dc.region, latency_ms
                ),
            }
        }
        Err(err) => {
            let (error_code, message) = classify_proxy_error(&err, dc.dc_id, &target_endpoint);
            ProxyDiagnosticResult {
                is_connected: false,
                latency_ms: None,
                target_dc: dc.dc_id,
                target_endpoint,
                error_code: Some(error_code),
                message,
            }
        }
    }
}

/// Classifies a `ProxyError` into a standardized uppercase code and user-friendly message.
fn classify_proxy_error(err: &ProxyError, dc_id: u8, target_endpoint: &str) -> (String, String) {
    match err {
        ProxyError::DnsResolutionFailed(host, details) => (
            "DNS_FAILED".to_string(),
            format!("DNS lookup failed for proxy host '{}': {}", host, details),
        ),
        ProxyError::ConnectionTimeout(_) => (
            "TIMEOUT".to_string(),
            format!(
                "Connection to Telegram DC {} ({}) timed out after 5 seconds",
                dc_id, target_endpoint
            ),
        ),
        ProxyError::AuthenticationFailed(details) => (
            "AUTH_FAILED".to_string(),
            format!("Proxy authentication failed: {}", details),
        ),
        ProxyError::HandshakeFailed(details) => {
            if details.to_lowercase().contains("tls") {
                (
                    "TLS_HANDSHAKE_FAILED".to_string(),
                    format!("Fake-TLS MTProto handshake failed: {}", details),
                )
            } else {
                (
                    "HANDSHAKE_FAILED".to_string(),
                    format!("Proxy handshake failed: {}", details),
                )
            }
        }
        ProxyError::InvalidSecret(details) => (
            "INVALID_SECRET".to_string(),
            format!("Invalid MTProto proxy secret: {}", details),
        ),
        ProxyError::InvalidUrl(details) => (
            "INVALID_URL".to_string(),
            format!("Invalid proxy link URL: {}", details),
        ),
        ProxyError::Io(details) => (
            "UNREACHABLE".to_string(),
            format!("Failed to reach endpoint {}: {}", target_endpoint, details),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[test]
    fn test_dc_resolution() {
        assert_eq!(resolve_telegram_dc(Some(1)).dc_id, 1);
        assert_eq!(resolve_telegram_dc(Some(2)).dc_id, 2);
        assert_eq!(resolve_telegram_dc(Some(3)).dc_id, 3);
        assert_eq!(resolve_telegram_dc(Some(4)).dc_id, 4);
        assert_eq!(resolve_telegram_dc(Some(5)).dc_id, 5);
        assert_eq!(resolve_telegram_dc(None).dc_id, 2);
        assert_eq!(resolve_telegram_dc(Some(99)).dc_id, 2);
    }

    #[tokio::test]
    async fn test_diagnostic_direct_mock_success() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let server_task = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            drop(socket);
        });

        // Test connect_stream directly to mock endpoint
        let start = Instant::now();
        let stream = connect_stream("127.0.0.1", port, None, Duration::from_secs(2))
            .await
            .unwrap();
        let elapsed = start.elapsed();
        drop(stream);
        server_task.await.unwrap();

        assert!(elapsed.as_millis() < 2000);
    }

    #[tokio::test]
    async fn test_diagnostic_error_classification() {
        let (code, msg) = classify_proxy_error(
            &ProxyError::DnsResolutionFailed(
                "proxy.example.com".to_string(),
                "nodename nor servname provided".to_string(),
            ),
            2,
            "149.154.167.50:443",
        );
        assert_eq!(code, "DNS_FAILED");
        assert!(msg.contains("proxy.example.com"));

        let (code, _) = classify_proxy_error(
            &ProxyError::AuthenticationFailed("Invalid credentials".to_string()),
            2,
            "149.154.167.50:443",
        );
        assert_eq!(code, "AUTH_FAILED");

        let (code, _) = classify_proxy_error(
            &ProxyError::HandshakeFailed("TLS ClientHello rejected".to_string()),
            2,
            "149.154.167.50:443",
        );
        assert_eq!(code, "TLS_HANDSHAKE_FAILED");

        let (code, _) = classify_proxy_error(
            &ProxyError::ConnectionTimeout("5s".to_string()),
            2,
            "149.154.167.50:443",
        );
        assert_eq!(code, "TIMEOUT");
    }
}
