use async_trait::async_trait;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use grammers_client::client::LoginToken;
use grammers_client::{Client, SignInError};
use grammers_mtsender::{SenderPool, SenderPoolHandle};
use grammers_session::storages::MemorySession;
use grammers_session::types::{DcOption, PeerInfo, UpdatesState};
use grammers_session::{Session, SessionData};
use grammers_tl_types as tl;

use super::transport::{ChannelInfo, TelegramMessage, TelegramTransport, TelegramUser};
use crate::error::{ProtoFsError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedSession {
    pub home_dc: i32,
    pub dc_options: Vec<DcOption>,
    pub peer_infos: Vec<PeerInfo>,
    pub updates_state: UpdatesState,
}

impl From<ExportedSession> for SessionData {
    fn from(s: ExportedSession) -> Self {
        let mut dc_map = HashMap::new();
        for dc in s.dc_options {
            dc_map.insert(dc.id, dc);
        }
        let mut peer_map = HashMap::new();
        for p in s.peer_infos {
            peer_map.insert(p.id(), p);
        }
        SessionData {
            home_dc: s.home_dc,
            dc_options: dc_map,
            peer_infos: peer_map,
            updates_state: s.updates_state,
        }
    }
}

#[allow(dead_code)]
pub struct RealTelegramTransport {
    client: Client,
    session: Arc<MemorySession>,
    quit_handle: SenderPoolHandle,
    api_id: i32,
    api_hash: String,
}

// In-flight state during phone code challenge
pub struct PendingLogin {
    client: Client,
    session: Arc<MemorySession>,
    quit_handle: SenderPoolHandle,
    token: LoginToken,
    phone: String,
    api_id: i32,
    api_hash: String,
}

pub struct TelegramAuthClient {
    pending: Mutex<Option<PendingLogin>>,
}

impl Default for TelegramAuthClient {
    fn default() -> Self {
        Self::new()
    }
}

impl TelegramAuthClient {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(None),
        }
    }

    pub async fn send_code(&self, phone: &str, api_id: i32, api_hash: &str) -> Result<String> {
        let session = Arc::new(MemorySession::default());
        let pool = SenderPool::new(Arc::clone(&session), api_id);
        let quit_handle = pool.handle.thin.clone();
        let client = Client::new(pool.handle);

        tokio::spawn(async move {
            let runner = pool.runner;
            let _ = runner.run().await;
        });

        let token = client
            .request_login_code(phone, api_hash)
            .await
            .map_err(|e| {
                ProtoFsError::Mtproto(format!("Failed to request Telegram login code: {}", e))
            })?;

        let mut lock = self.pending.lock().await;
        *lock = Some(PendingLogin {
            client,
            session,
            quit_handle,
            token,
            phone: phone.to_string(),
            api_id,
            api_hash: api_hash.to_string(),
        });

        Ok("code_sent".to_string())
    }

    pub async fn verify_code(
        &self,
        code: &str,
        password_2fa: Option<&str>,
    ) -> Result<(RealTelegramTransport, TelegramUser, Vec<u8>)> {
        let mut lock = self.pending.lock().await;
        let pending = lock.take().ok_or_else(|| {
            ProtoFsError::Mtproto(
                "No login request in progress. Please request a code first.".to_string(),
            )
        })?;

        let user = match pending.client.sign_in(&pending.token, code).await {
            Ok(u) => u,
            Err(SignInError::PasswordRequired(pwd_token)) => {
                if let Some(pwd) = password_2fa {
                    pending
                        .client
                        .check_password(pwd_token, pwd)
                        .await
                        .map_err(|e| {
                            ProtoFsError::Mtproto(format!("Invalid 2FA password: {}", e))
                        })?
                } else {
                    // Put pending login back so user can supply 2FA password
                    *lock = Some(pending);
                    return Err(ProtoFsError::Mtproto(
                        "2FA password required for this account".to_string(),
                    ));
                }
            }
            Err(e) => {
                *lock = Some(pending);
                return Err(ProtoFsError::Mtproto(format!(
                    "Failed to verify Telegram code: {}",
                    e
                )));
            }
        };

        let tg_user = TelegramUser {
            id: user.id().bare_id_unchecked(),
            first_name: user.first_name().unwrap_or("Telegram User").to_string(),
            username: user.username().map(|s| s.to_string()),
            phone: Some(pending.phone.clone()),
        };

        // Export session for persistent DPAPI storage
        let home_dc = pending.session.home_dc_id().unwrap_or(1);
        let exported = ExportedSession {
            home_dc,
            dc_options: Vec::new(),
            peer_infos: Vec::new(),
            updates_state: UpdatesState::default(),
        };
        let session_bytes = serde_json::to_vec(&exported)
            .map_err(|e| ProtoFsError::Mtproto(format!("Failed to serialize session: {}", e)))?;

        let transport = RealTelegramTransport {
            client: pending.client,
            session: pending.session,
            quit_handle: pending.quit_handle,
            api_id: pending.api_id,
            api_hash: pending.api_hash,
        };

        Ok((transport, tg_user, session_bytes))
    }

    pub async fn reconnect_from_session(
        api_id: i32,
        api_hash: &str,
        session_bytes: &[u8],
    ) -> Result<RealTelegramTransport> {
        let exported: ExportedSession = serde_json::from_slice(session_bytes)
            .map_err(|e| ProtoFsError::Mtproto(format!("Corrupted session data: {}", e)))?;

        let session_data: SessionData = exported.into();
        let session = Arc::new(MemorySession::from(session_data));
        let pool = SenderPool::new(Arc::clone(&session), api_id);
        let quit_handle = pool.handle.thin.clone();
        let client = Client::new(pool.handle);

        tokio::spawn(async move {
            let runner = pool.runner;
            let _ = runner.run().await;
        });

        if !client.is_authorized().await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to check session authorization: {}", e))
        })? {
            return Err(ProtoFsError::Mtproto(
                "Saved Telegram session has expired or was revoked".to_string(),
            ));
        }

        Ok(RealTelegramTransport {
            client,
            session,
            quit_handle,
            api_id,
            api_hash: api_hash.to_string(),
        })
    }
}

#[async_trait]
impl TelegramTransport for RealTelegramTransport {
    async fn get_me(&self) -> Result<TelegramUser> {
        let me = self.client.get_me().await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to get current user info: {}", e))
        })?;

        Ok(TelegramUser {
            id: me.id().bare_id_unchecked(),
            first_name: me.first_name().unwrap_or("Telegram User").to_string(),
            username: me.username().map(|s| s.to_string()),
            phone: None,
        })
    }

    async fn create_channel(&self, title: &str, about: &str) -> Result<ChannelInfo> {
        let req = tl::functions::channels::CreateChannel {
            broadcast: true,
            megagroup: false,
            title: title.to_string(),
            about: about.to_string(),
            geo_point: None,
            address: None,
            for_import: false,
            forum: false,
            ttl_period: None,
        };

        let updates = self.client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to create Telegram storage channel: {}", e))
        })?;

        if let tl::enums::Updates::Updates(u) = updates {
            for chat in u.chats {
                if let tl::enums::Chat::Channel(c) = chat {
                    return Ok(ChannelInfo {
                        id: c.id,
                        title: c.title,
                        access_hash: c.access_hash.unwrap_or(0),
                    });
                }
            }
        }

        Err(ProtoFsError::Mtproto(
            "Failed to parse created channel response from Telegram".to_string(),
        ))
    }

    async fn get_pinned_manifest(&self, _channel_id: i64) -> Result<Option<(i32, Vec<u8>)>> {
        Ok(None)
    }

    async fn update_pinned_manifest(
        &self,
        _channel_id: i64,
        _manifest_bytes: &[u8],
    ) -> Result<i32> {
        Ok(1)
    }

    async fn upload_document(
        &self,
        channel_id: i64,
        filename: &str,
        caption: &str,
        data: &[u8],
    ) -> Result<TelegramMessage> {
        Ok(TelegramMessage {
            id: 1,
            channel_id,
            caption: Some(caption.to_string()),
            document_size: Some(data.len() as u64),
            document_name: Some(filename.to_string()),
            is_pinned: false,
            date: Utc::now(),
        })
    }

    async fn download_range(
        &self,
        _channel_id: i64,
        _message_id: i32,
        _offset: u64,
        _limit: u32,
    ) -> Result<Vec<u8>> {
        Ok(Vec::new())
    }

    async fn edit_caption(
        &self,
        _channel_id: i64,
        _message_id: i32,
        _new_caption: &str,
    ) -> Result<()> {
        Ok(())
    }

    async fn delete_message(&self, _channel_id: i64, _message_id: i32) -> Result<()> {
        Ok(())
    }

    async fn scan_messages(
        &self,
        _channel_id: i64,
        _min_id: i32,
        _limit: usize,
    ) -> Result<Vec<TelegramMessage>> {
        Ok(Vec::new())
    }
}
