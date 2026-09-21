use chrono::{DateTime, Utc};
use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::db::CacheDatabase;
use crate::error::Result;
use crate::mtproto::proxy::{MtprotoSecret, ProxyAuth, ProxyConfig, ProxyError, ProxyType};

/// A fully populated proxy configuration profile, including sensitive credentials when decrypted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProxyProfile {
    pub id: String,
    pub label: String,
    pub proxy_type: ProxyType,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub secret: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A sanitized summary representation of a proxy profile for general listings, masking secrets and credentials.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProxyProfileSummary {
    pub id: String,
    pub label: String,
    pub proxy_type: ProxyType,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub has_password: bool,
    pub masked_secret: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Global proxy toggle settings and selected active profile.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ProxySettings {
    pub is_enabled: bool,
    pub active_proxy_id: Option<String>,
}

impl ProxyProfile {
    pub fn to_proxy_config(&self) -> std::result::Result<ProxyConfig, ProxyError> {
        match self.proxy_type {
            ProxyType::Direct => Ok(ProxyConfig::Direct),
            ProxyType::Socks5 => {
                let auth = self.username.as_ref().map(|user| ProxyAuth {
                    username: user.clone(),
                    password: self.password.clone().unwrap_or_default(),
                });
                Ok(ProxyConfig::Socks5 {
                    host: self.host.clone(),
                    port: self.port,
                    auth,
                })
            }
            ProxyType::Http => {
                let auth = self.username.as_ref().map(|user| ProxyAuth {
                    username: user.clone(),
                    password: self.password.clone().unwrap_or_default(),
                });
                Ok(ProxyConfig::Http {
                    host: self.host.clone(),
                    port: self.port,
                    auth,
                })
            }
            ProxyType::Mtproto => {
                let raw_secret = self.secret.as_deref().ok_or_else(|| {
                    ProxyError::InvalidSecret("Missing MTProto secret".to_string())
                })?;
                let secret = MtprotoSecret::parse(raw_secret)?;
                Ok(ProxyConfig::Mtproto {
                    host: self.host.clone(),
                    port: self.port,
                    secret,
                })
            }
        }
    }
}

/// Masks a secret string for safe display in UI overview lists.
pub fn mask_secret(secret: &str) -> String {
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.len() <= 8 {
        return "••••••••".to_string();
    }
    if trimmed.starts_with("ee") || trimmed.starts_with("EE") {
        let suffix = &trimmed[trimmed.len().saturating_sub(4)..];
        format!("ee••••{}", suffix)
    } else if trimmed.starts_with("dd") || trimmed.starts_with("DD") {
        let suffix = &trimmed[trimmed.len().saturating_sub(4)..];
        format!("dd••••{}", suffix)
    } else {
        let prefix = &trimmed[..4];
        let suffix = &trimmed[trimmed.len() - 4..];
        format!("{}••••{}", prefix, suffix)
    }
}

impl CacheDatabase {
    /// Returns a list of all saved proxy profiles as masked summaries.
    pub fn get_proxies(&self) -> Result<Vec<ProxyProfileSummary>> {
        let raw_items = {
            let conn = self.lock_conn()?;
            let mut stmt = conn.prepare(
                r#"
                SELECT id, label, proxy_type, host, port, username, is_active, created_at, updated_at
                FROM proxies
                ORDER BY created_at ASC
                "#,
            )?;

            let rows = stmt.query_map([], |row| {
                let id: String = row.get(0)?;
                let label: String = row.get(1)?;
                let type_str: String = row.get(2)?;
                let host: String = row.get(3)?;
                let port: u16 = row.get(4)?;
                let username: Option<String> = row.get(5)?;
                let is_active_int: i32 = row.get(6)?;
                let created_str: String = row.get(7)?;
                let updated_str: String = row.get(8)?;

                let proxy_type = match type_str.as_str() {
                    "socks5" => ProxyType::Socks5,
                    "http" => ProxyType::Http,
                    "mtproto" => ProxyType::Mtproto,
                    _ => ProxyType::Direct,
                };

                let created_at = DateTime::parse_from_rfc3339(&created_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());
                let updated_at = DateTime::parse_from_rfc3339(&updated_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());

                Ok((
                    id,
                    label,
                    proxy_type,
                    host,
                    port,
                    username,
                    is_active_int == 1,
                    created_at,
                    updated_at,
                ))
            })?;

            let mut list = Vec::new();
            for item in rows {
                list.push(item?);
            }
            list
        };

        let mut list = Vec::new();
        for (id, label, proxy_type, host, port, username, is_active, created_at, updated_at) in
            raw_items
        {
            let pass_key = format!("proxy_password:{}", id);
            let secret_key = format!("proxy_secret:{}", id);

            let has_password = self.get_secure_secret(&pass_key)?.is_some();
            let masked_secret = self
                .get_secure_secret(&secret_key)?
                .and_then(|bytes| String::from_utf8(bytes).ok())
                .map(|sec| mask_secret(&sec));

            list.push(ProxyProfileSummary {
                id,
                label,
                proxy_type,
                host,
                port,
                username,
                has_password,
                masked_secret,
                is_active,
                created_at,
                updated_at,
            });
        }

        Ok(list)
    }

    /// Loads a single proxy profile by ID with full decrypted credentials.
    pub fn get_proxy(&self, id: &str) -> Result<Option<ProxyProfile>> {
        let meta = {
            let conn = self.lock_conn()?;
            let mut stmt = conn.prepare(
                r#"
                SELECT id, label, proxy_type, host, port, username, is_active, created_at, updated_at
                FROM proxies
                WHERE id = ?1
                "#,
            )?;

            let mut rows = stmt.query(params![id])?;
            if let Some(row) = rows.next()? {
                let id: String = row.get(0)?;
                let label: String = row.get(1)?;
                let type_str: String = row.get(2)?;
                let host: String = row.get(3)?;
                let port: u16 = row.get(4)?;
                let username: Option<String> = row.get(5)?;
                let is_active_int: i32 = row.get(6)?;
                let created_str: String = row.get(7)?;
                let updated_str: String = row.get(8)?;

                let proxy_type = match type_str.as_str() {
                    "socks5" => ProxyType::Socks5,
                    "http" => ProxyType::Http,
                    "mtproto" => ProxyType::Mtproto,
                    _ => ProxyType::Direct,
                };

                let created_at = DateTime::parse_from_rfc3339(&created_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());
                let updated_at = DateTime::parse_from_rfc3339(&updated_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());

                Some((
                    id,
                    label,
                    proxy_type,
                    host,
                    port,
                    username,
                    is_active_int == 1,
                    created_at,
                    updated_at,
                ))
            } else {
                None
            }
        };

        if let Some((
            id,
            label,
            proxy_type,
            host,
            port,
            username,
            is_active,
            created_at,
            updated_at,
        )) = meta
        {
            let pass_key = format!("proxy_password:{}", id);
            let secret_key = format!("proxy_secret:{}", id);

            let password = self
                .get_secure_secret(&pass_key)?
                .and_then(|bytes| String::from_utf8(bytes).ok());
            let secret = self
                .get_secure_secret(&secret_key)?
                .and_then(|bytes| String::from_utf8(bytes).ok());

            Ok(Some(ProxyProfile {
                id,
                label,
                proxy_type,
                host,
                port,
                username,
                password,
                secret,
                is_active,
                created_at,
                updated_at,
            }))
        } else {
            Ok(None)
        }
    }

    /// Inserts or updates a proxy profile, storing sensitive secrets securely via DPAPI/HKDF.
    pub fn save_proxy(&self, profile: &ProxyProfile) -> Result<()> {
        {
            let mut conn = self.lock_conn()?;
            let tx = conn.transaction()?;

            let type_str = match profile.proxy_type {
                ProxyType::Direct => "direct",
                ProxyType::Socks5 => "socks5",
                ProxyType::Http => "http",
                ProxyType::Mtproto => "mtproto",
            };

            let is_active_int = if profile.is_active { 1 } else { 0 };

            // If activating this profile, unset is_active for other proxies
            if profile.is_active {
                tx.execute(
                    "UPDATE proxies SET is_active = 0 WHERE id != ?1",
                    params![profile.id],
                )?;
                tx.execute(
                    "INSERT OR REPLACE INTO proxy_settings (key, value) VALUES ('active_proxy_id', ?1)",
                    params![profile.id],
                )?;
            }

            tx.execute(
                r#"
                INSERT INTO proxies (id, label, proxy_type, host, port, username, is_active, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ON CONFLICT(id) DO UPDATE SET
                    label = excluded.label,
                    proxy_type = excluded.proxy_type,
                    host = excluded.host,
                    port = excluded.port,
                    username = excluded.username,
                    is_active = excluded.is_active,
                    updated_at = excluded.updated_at
                "#,
                params![
                    profile.id,
                    profile.label,
                    type_str,
                    profile.host,
                    profile.port,
                    profile.username,
                    is_active_int,
                    profile.created_at.to_rfc3339(),
                    profile.updated_at.to_rfc3339(),
                ],
            )?;

            tx.commit()?;
        }

        // Save password / secret outside transaction lock
        let pass_key = format!("proxy_password:{}", profile.id);
        let secret_key = format!("proxy_secret:{}", profile.id);

        if let Some(pass) = &profile.password {
            if !pass.is_empty() {
                self.set_secure_secret(&pass_key, pass.as_bytes())?;
            } else {
                let _ = self.delete_secure_secret(&pass_key);
            }
        } else {
            let _ = self.delete_secure_secret(&pass_key);
        }

        if let Some(sec) = &profile.secret {
            if !sec.is_empty() {
                self.set_secure_secret(&secret_key, sec.as_bytes())?;
            } else {
                let _ = self.delete_secure_secret(&secret_key);
            }
        } else {
            let _ = self.delete_secure_secret(&secret_key);
        }

        Ok(())
    }

    /// Atomically deletes a proxy profile and all associated DPAPI encrypted secret keys.
    pub fn delete_proxy(&self, id: &str) -> Result<()> {
        {
            let conn = self.lock_conn()?;
            conn.execute("DELETE FROM proxies WHERE id = ?1", params![id])?;

            // If the deleted proxy was active, clear active_proxy_id
            conn.execute(
                "DELETE FROM proxy_settings WHERE key = 'active_proxy_id' AND value = ?1",
                params![id],
            )?;
        }

        // Delete associated DPAPI/HKDF secrets outside lock
        let pass_key = format!("proxy_password:{}", id);
        let secret_key = format!("proxy_secret:{}", id);
        let _ = self.delete_secure_secret(&pass_key);
        let _ = self.delete_secure_secret(&secret_key);

        Ok(())
    }

    /// Sets the active proxy profile by ID, or unsets active proxy if None.
    pub fn set_active_proxy(&self, id: Option<&str>) -> Result<()> {
        let conn = self.lock_conn()?;
        if let Some(active_id) = id {
            conn.execute(
                "UPDATE proxies SET is_active = (id = ?1)",
                params![active_id],
            )?;
            conn.execute(
                "INSERT OR REPLACE INTO proxy_settings (key, value) VALUES ('active_proxy_id', ?1)",
                params![active_id],
            )?;
        } else {
            conn.execute("UPDATE proxies SET is_active = 0", [])?;
            conn.execute(
                "DELETE FROM proxy_settings WHERE key = 'active_proxy_id'",
                [],
            )?;
        }
        Ok(())
    }

    /// Resolves the currently active proxy profile (if configured), returning full decrypted credentials.
    pub fn get_active_proxy(&self) -> Result<Option<ProxyProfile>> {
        let active_id = {
            let conn = self.lock_conn()?;
            let mut stmt =
                conn.prepare("SELECT value FROM proxy_settings WHERE key = 'active_proxy_id'")?;
            let mut rows = stmt.query([])?;
            if let Some(row) = rows.next()? {
                let id: String = row.get(0)?;
                Some(id)
            } else {
                let mut stmt_fallback =
                    conn.prepare("SELECT id FROM proxies WHERE is_active = 1 LIMIT 1")?;
                let mut rows_fb = stmt_fallback.query([])?;
                if let Some(row) = rows_fb.next()? {
                    let id: String = row.get(0)?;
                    Some(id)
                } else {
                    None
                }
            }
        };

        if let Some(id) = active_id {
            self.get_proxy(&id)
        } else {
            Ok(None)
        }
    }

    /// Sets the global proxy enable/disable toggle.
    pub fn set_proxy_enabled(&self, enabled: bool) -> Result<()> {
        let conn = self.lock_conn()?;
        let val_str = if enabled { "1" } else { "0" };
        conn.execute(
            "INSERT OR REPLACE INTO proxy_settings (key, value) VALUES ('is_enabled', ?1)",
            params![val_str],
        )?;
        Ok(())
    }

    /// Returns true if proxy routing is globally enabled.
    pub fn is_proxy_enabled(&self) -> Result<bool> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT value FROM proxy_settings WHERE key = 'is_enabled'")?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            let val_str: String = row.get(0)?;
            Ok(val_str == "1" || val_str.eq_ignore_ascii_case("true"))
        } else {
            Ok(false)
        }
    }

    /// Returns the global proxy configuration settings.
    pub fn get_proxy_settings(&self) -> Result<ProxySettings> {
        let is_enabled = self.is_proxy_enabled()?;
        let conn = self.lock_conn()?;
        let mut stmt =
            conn.prepare("SELECT value FROM proxy_settings WHERE key = 'active_proxy_id'")?;
        let mut rows = stmt.query([])?;
        let active_proxy_id = if let Some(row) = rows.next()? {
            let val: String = row.get(0)?;
            Some(val)
        } else {
            None
        };
        Ok(ProxySettings {
            is_enabled,
            active_proxy_id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secret_masking() {
        assert_eq!(mask_secret(""), "");
        assert_eq!(mask_secret("short"), "••••••••");
        assert_eq!(
            mask_secret("ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d"),
            "ee••••6f6d"
        );
        assert_eq!(
            mask_secret("dd0123456789abcdef0123456789abcdef"),
            "dd••••cdef"
        );
        assert_eq!(
            mask_secret("0123456789abcdef0123456789abcdef"),
            "0123••••cdef"
        );
    }

    #[test]
    fn test_proxy_database_crud_and_encryption() {
        let db = CacheDatabase::open_in_memory().expect("open in memory db");

        // Initial state
        assert!(!db.is_proxy_enabled().unwrap());
        assert_eq!(db.get_proxies().unwrap().len(), 0);
        assert_eq!(db.get_active_proxy().unwrap(), None);

        // 1. Create SOCKS5 proxy profile
        let socks_profile = ProxyProfile {
            id: "proxy_socks_1".to_string(),
            label: "Fast SOCKS5".to_string(),
            proxy_type: ProxyType::Socks5,
            host: "127.0.0.1".to_string(),
            port: 1080,
            username: Some("myuser".to_string()),
            password: Some("mypassword123".to_string()),
            secret: None,
            is_active: true,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        db.save_proxy(&socks_profile).expect("save socks proxy");

        // Verify summary list (password must NOT be plaintext)
        let summaries = db.get_proxies().expect("get proxies");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "proxy_socks_1");
        assert_eq!(summaries[0].label, "Fast SOCKS5");
        assert!(summaries[0].has_password);
        assert_eq!(summaries[0].masked_secret, None);
        assert!(summaries[0].is_active);

        // Verify get_proxy loads full decrypted password
        let loaded = db.get_proxy("proxy_socks_1").unwrap().unwrap();
        assert_eq!(loaded.password.as_deref(), Some("mypassword123"));
        assert_eq!(loaded.username.as_deref(), Some("myuser"));

        // 2. Create MTProto Fake-TLS proxy profile
        let mtproto_profile = ProxyProfile {
            id: "proxy_mtproto_2".to_string(),
            label: "Google Fake-TLS".to_string(),
            proxy_type: ProxyType::Mtproto,
            host: "198.51.100.1".to_string(),
            port: 443,
            username: None,
            password: None,
            secret: Some(
                "ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d".to_string(),
            ),
            is_active: true, // Setting this to active should deactivate socks_1
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        db.save_proxy(&mtproto_profile).expect("save mtproto proxy");

        let summaries2 = db.get_proxies().expect("get proxies 2");
        assert_eq!(summaries2.len(), 2);
        let s_mtproto = summaries2
            .iter()
            .find(|p| p.id == "proxy_mtproto_2")
            .unwrap();
        let s_socks = summaries2.iter().find(|p| p.id == "proxy_socks_1").unwrap();
        assert!(s_mtproto.is_active);
        assert!(!s_socks.is_active);
        assert_eq!(s_mtproto.masked_secret.as_deref(), Some("ee••••6f6d"));

        // Verify active proxy is mtproto
        let active = db.get_active_proxy().unwrap().unwrap();
        assert_eq!(active.id, "proxy_mtproto_2");
        assert_eq!(
            active.secret.as_deref(),
            Some("ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d")
        );

        // Test conversion to ProxyConfig
        let proxy_config = active.to_proxy_config().expect("to proxy config");
        assert!(matches!(proxy_config, ProxyConfig::Mtproto { .. }));

        // 3. Test global enable toggle
        db.set_proxy_enabled(true).expect("enable proxy");
        assert!(db.is_proxy_enabled().unwrap());

        // 4. Test atomic deletion
        db.delete_proxy("proxy_mtproto_2")
            .expect("delete mtproto proxy");
        assert_eq!(db.get_proxies().unwrap().len(), 1);
        assert_eq!(db.get_proxy("proxy_mtproto_2").unwrap(), None);

        // Verify secure secret is also deleted
        let sec_key = "proxy_secret:proxy_mtproto_2";
        assert_eq!(db.get_secure_secret(sec_key).unwrap(), None);
    }
}
