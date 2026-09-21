use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ProxyError {
    #[error("DNS resolution failed for {0}: {1}")]
    DnsResolutionFailed(String, String),

    #[error("Connection timeout: {0}")]
    ConnectionTimeout(String),

    #[error("Proxy handshake failed: {0}")]
    HandshakeFailed(String),

    #[error("Proxy authentication failed: {0}")]
    AuthenticationFailed(String),

    #[error("Invalid proxy secret: {0}")]
    InvalidSecret(String),

    #[error("Invalid proxy URL: {0}")]
    InvalidUrl(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyType {
    Direct,
    Socks5,
    Http,
    Mtproto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProxyAuth {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MtprotoSecret {
    pub raw_secret: String,
    pub secret_bytes: [u8; 16],
    pub is_dd: bool,
    pub tls_domain: Option<String>,
}

impl MtprotoSecret {
    pub fn parse(raw: &str) -> Result<Self, ProxyError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(ProxyError::InvalidSecret(
                "Secret cannot be empty".to_string(),
            ));
        }

        // Check for 'dd' prefix (intermediate obfuscation, 34 hex chars)
        if (trimmed.starts_with("dd") || trimmed.starts_with("DD")) && trimmed.len() == 34 {
            let hex_part = &trimmed[2..];
            let secret_bytes = hex_decode_16(hex_part)?;
            return Ok(Self {
                raw_secret: trimmed.to_string(),
                secret_bytes,
                is_dd: true,
                tls_domain: None,
            });
        }

        // Check for 'ee' prefix (Fake-TLS, 34+ hex chars)
        if trimmed.starts_with("ee") || trimmed.starts_with("EE") {
            if trimmed.len() < 34 {
                return Err(ProxyError::InvalidSecret(
                    "Fake-TLS secret too short, must contain at least 16 bytes key".to_string(),
                ));
            }
            let key_hex = &trimmed[2..34];
            let secret_bytes = hex_decode_16(key_hex)?;

            let tls_domain = if trimmed.len() > 34 {
                let domain_hex = &trimmed[34..];
                if !domain_hex.len().is_multiple_of(2) {
                    return Err(ProxyError::InvalidSecret(
                        "Fake-TLS domain hex length must be even".to_string(),
                    ));
                }
                let domain_bytes = hex_decode_bytes(domain_hex)?;
                let domain_str = String::from_utf8(domain_bytes).map_err(|e| {
                    ProxyError::InvalidSecret(format!("Invalid UTF-8 in Fake-TLS domain: {}", e))
                })?;
                Some(domain_str)
            } else {
                None
            };

            return Ok(Self {
                raw_secret: trimmed.to_string(),
                secret_bytes,
                is_dd: false,
                tls_domain,
            });
        }

        // Standard 32-hex characters (16 bytes)
        if trimmed.len() == 32 {
            let secret_bytes = hex_decode_16(trimmed)?;
            return Ok(Self {
                raw_secret: trimmed.to_string(),
                secret_bytes,
                is_dd: false,
                tls_domain: None,
            });
        }

        Err(ProxyError::InvalidSecret(format!(
            "Secret must be 32 hex chars, 'dd' + 32 hex chars, or 'ee' + 32 hex chars (+ optional domain hex), got length {}",
            trimmed.len()
        )))
    }
}

fn hex_decode_16(hex_str: &str) -> Result<[u8; 16], ProxyError> {
    if hex_str.len() != 32 {
        return Err(ProxyError::InvalidSecret(format!(
            "Expected 32 hex chars for 16-byte key, got {}",
            hex_str.len()
        )));
    }
    let mut bytes = [0u8; 16];
    for i in 0..16 {
        let byte_str = &hex_str[i * 2..i * 2 + 2];
        bytes[i] = u8::from_str_radix(byte_str, 16).map_err(|e| {
            ProxyError::InvalidSecret(format!("Invalid hex byte '{}': {}", byte_str, e))
        })?;
    }
    Ok(bytes)
}

fn hex_decode_bytes(hex_str: &str) -> Result<Vec<u8>, ProxyError> {
    if !hex_str.len().is_multiple_of(2) {
        return Err(ProxyError::InvalidSecret(
            "Hex string must have even length".to_string(),
        ));
    }
    let mut bytes = Vec::with_capacity(hex_str.len() / 2);
    for i in 0..hex_str.len() / 2 {
        let byte_str = &hex_str[i * 2..i * 2 + 2];
        let b = u8::from_str_radix(byte_str, 16).map_err(|e| {
            ProxyError::InvalidSecret(format!("Invalid hex byte '{}': {}", byte_str, e))
        })?;
        bytes.push(b);
    }
    Ok(bytes)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProxyConfig {
    #[default]
    Direct,
    Socks5 {
        host: String,
        port: u16,
        auth: Option<ProxyAuth>,
    },
    Http {
        host: String,
        port: u16,
        auth: Option<ProxyAuth>,
    },
    Mtproto {
        host: String,
        port: u16,
        secret: MtprotoSecret,
    },
}

impl ProxyConfig {
    pub fn is_direct(&self) -> bool {
        matches!(self, Self::Direct)
    }

    pub fn proxy_type(&self) -> ProxyType {
        match self {
            Self::Direct => ProxyType::Direct,
            Self::Socks5 { .. } => ProxyType::Socks5,
            Self::Http { .. } => ProxyType::Http,
            Self::Mtproto { .. } => ProxyType::Mtproto,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_standard_32_hex_secret() {
        let hex = "0123456789abcdef0123456789abcdef";
        let secret = MtprotoSecret::parse(hex).unwrap();
        assert!(!secret.is_dd);
        assert_eq!(secret.tls_domain, None);
        assert_eq!(secret.secret_bytes[0], 0x01);
        assert_eq!(secret.secret_bytes[15], 0xef);
    }

    #[test]
    fn test_dd_obfuscated_secret() {
        let hex = "dd0123456789abcdef0123456789abcdef";
        let secret = MtprotoSecret::parse(hex).unwrap();
        assert!(secret.is_dd);
        assert_eq!(secret.tls_domain, None);
        assert_eq!(secret.secret_bytes[0], 0x01);
        assert_eq!(secret.secret_bytes[15], 0xef);
    }

    #[test]
    fn test_ee_fake_tls_secret_with_domain() {
        // "www.google.com" in hex is 7777772e676f6f676c652e636f6d
        let hex = "ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d";
        let secret = MtprotoSecret::parse(hex).unwrap();
        assert!(!secret.is_dd);
        assert_eq!(secret.tls_domain, Some("www.google.com".to_string()));
        assert_eq!(secret.secret_bytes[0], 0x01);
        assert_eq!(secret.secret_bytes[15], 0xef);
    }

    #[test]
    fn test_ee_fake_tls_secret_without_domain() {
        let hex = "ee0123456789abcdef0123456789abcdef";
        let secret = MtprotoSecret::parse(hex).unwrap();
        assert!(!secret.is_dd);
        assert_eq!(secret.tls_domain, None);
    }

    #[test]
    fn test_invalid_secret_length() {
        assert!(MtprotoSecret::parse("12345").is_err());
        assert!(MtprotoSecret::parse("").is_err());
    }

    #[test]
    fn test_proxy_config_serde() {
        let cfg = ProxyConfig::Socks5 {
            host: "127.0.0.1".to_string(),
            port: 1080,
            auth: Some(ProxyAuth {
                username: "user".to_string(),
                password: "pass".to_string(),
            }),
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let deserialized: ProxyConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg, deserialized);
    }
}
