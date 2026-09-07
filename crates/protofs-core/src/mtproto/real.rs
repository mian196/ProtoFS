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

// Base64URL encoder without padding for Telegram QR login tokens
fn base64url_encode(data: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((data.len() * 4).div_ceil(3));
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        out.push(CHARSET[(b0 >> 2) as usize] as char);
        out.push(CHARSET[(((b0 & 3) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARSET[(((b1 & 15) << 2) | (b2 >> 6)) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(CHARSET[(b2 & 63) as usize] as char);
        }
    }
    out
}

fn export_session_bytes(session: &Arc<MemorySession>) -> Result<Vec<u8>> {
    let home_dc = session.home_dc_id().unwrap_or(1);
    let exported = ExportedSession {
        home_dc,
        dc_options: Vec::new(),
        peer_infos: Vec::new(),
        updates_state: UpdatesState::default(),
    };
    serde_json::to_vec(&exported)
        .map_err(|e| ProtoFsError::Mtproto(format!("Failed to serialize session: {}", e)))
}

pub enum VerifyOutcome {
    Success {
        transport: RealTelegramTransport,
        user: TelegramUser,
        session_bytes: Vec<u8>,
    },
    Requires2Fa {
        hint: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrExportResult {
    pub token_url: String,
    pub expires_at: i64,
}

pub enum QrCheckOutcome {
    Waiting {
        token_url: Option<String>,
        expires_at: i64,
    },
    Success {
        transport: RealTelegramTransport,
        user: TelegramUser,
        session_bytes: Vec<u8>,
    },
    Requires2Fa {
        hint: Option<String>,
    },
}

// In-flight state during authentication challenges
pub enum PendingAuth {
    Phone {
        client: Client,
        session: Arc<MemorySession>,
        quit_handle: SenderPoolHandle,
        token: LoginToken,
        phone: String,
        api_id: i32,
        api_hash: String,
        pwd_token: Option<grammers_client::client::PasswordToken>,
    },
    Qr {
        client: Client,
        session: Arc<MemorySession>,
        quit_handle: SenderPoolHandle,
        api_id: i32,
        api_hash: String,
        token_bytes: Vec<u8>,
        expires_at: i64,
        pwd_token: Option<grammers_client::client::PasswordToken>,
    },
}

pub struct TelegramAuthClient {
    pending: Mutex<Option<PendingAuth>>,
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
        *lock = Some(PendingAuth::Phone {
            client,
            session,
            quit_handle,
            token,
            phone: phone.to_string(),
            api_id,
            api_hash: api_hash.to_string(),
            pwd_token: None,
        });

        Ok("code_sent".to_string())
    }

    pub async fn verify_code(&self, code: &str) -> Result<VerifyOutcome> {
        let mut lock = self.pending.lock().await;
        let pending = lock.as_mut().ok_or_else(|| {
            ProtoFsError::Mtproto(
                "No login request in progress. Please request a code first.".to_string(),
            )
        })?;

        match pending {
            PendingAuth::Phone {
                client,
                session,
                quit_handle,
                token,
                phone,
                api_id,
                api_hash,
                pwd_token,
            } => match client.sign_in(token, code).await {
                Ok(user) => {
                    let tg_user = TelegramUser {
                        id: user.id().bare_id_unchecked(),
                        first_name: user.first_name().unwrap_or("Telegram User").to_string(),
                        username: user.username().map(|s| s.to_string()),
                        phone: Some(phone.clone()),
                    };
                    let session_bytes = export_session_bytes(session)?;
                    let transport = RealTelegramTransport {
                        client: client.clone(),
                        session: Arc::clone(session),
                        quit_handle: quit_handle.clone(),
                        api_id: *api_id,
                        api_hash: api_hash.clone(),
                    };
                    let _ = lock.take();
                    Ok(VerifyOutcome::Success {
                        transport,
                        user: tg_user,
                        session_bytes,
                    })
                }
                Err(SignInError::PasswordRequired(pt)) => {
                    let hint = pt.hint().map(String::from);
                    *pwd_token = Some(pt);
                    Ok(VerifyOutcome::Requires2Fa { hint })
                }
                Err(e) => Err(ProtoFsError::Mtproto(format!(
                    "Failed to verify Telegram code: {}",
                    e
                ))),
            },
            PendingAuth::Qr { .. } => Err(ProtoFsError::Mtproto(
                "Current login session is QR code, not phone code.".to_string(),
            )),
        }
    }

    pub async fn verify_2fa(
        &self,
        password: &str,
    ) -> Result<(RealTelegramTransport, TelegramUser, Vec<u8>)> {
        let mut lock = self.pending.lock().await;
        let pending = lock.as_mut().ok_or_else(|| {
            ProtoFsError::Mtproto("No pending 2FA login session found.".to_string())
        })?;

        match pending {
            PendingAuth::Phone {
                client,
                session,
                quit_handle,
                phone,
                api_id,
                api_hash,
                pwd_token,
                ..
            } => {
                let pt = pwd_token.take().ok_or_else(|| {
                    ProtoFsError::Mtproto("No 2FA password token available.".to_string())
                })?;

                let user = match client.check_password(pt, password).await {
                    Ok(u) => u,
                    Err(SignInError::InvalidPassword(next_token)) => {
                        *pwd_token = Some(next_token);
                        return Err(ProtoFsError::Mtproto(
                            "Invalid 2FA password. Please check your password and try again."
                                .to_string(),
                        ));
                    }
                    Err(e) => {
                        return Err(ProtoFsError::Mtproto(format!(
                            "Failed to verify 2FA password: {}",
                            e
                        )));
                    }
                };

                let tg_user = TelegramUser {
                    id: user.id().bare_id_unchecked(),
                    first_name: user.first_name().unwrap_or("Telegram User").to_string(),
                    username: user.username().map(|s| s.to_string()),
                    phone: Some(phone.clone()),
                };
                let session_bytes = export_session_bytes(session)?;
                let transport = RealTelegramTransport {
                    client: client.clone(),
                    session: Arc::clone(session),
                    quit_handle: quit_handle.clone(),
                    api_id: *api_id,
                    api_hash: api_hash.clone(),
                };
                let _ = lock.take();
                Ok((transport, tg_user, session_bytes))
            }
            PendingAuth::Qr {
                client,
                session,
                quit_handle,
                api_id,
                api_hash,
                pwd_token,
                ..
            } => {
                let pt = pwd_token.take().ok_or_else(|| {
                    ProtoFsError::Mtproto("No 2FA password token available for QR login.".to_string())
                })?;

                let user = match client.check_password(pt, password).await {
                    Ok(u) => u,
                    Err(SignInError::InvalidPassword(next_token)) => {
                        *pwd_token = Some(next_token);
                        return Err(ProtoFsError::Mtproto(
                            "Invalid 2FA password. Please check your password and try again."
                                .to_string(),
                        ));
                    }
                    Err(e) => {
                        return Err(ProtoFsError::Mtproto(format!(
                            "Failed to verify 2FA password: {}",
                            e
                        )));
                    }
                };

                let tg_user = TelegramUser {
                    id: user.id().bare_id_unchecked(),
                    first_name: user.first_name().unwrap_or("Telegram User").to_string(),
                    username: user.username().map(|s| s.to_string()),
                    phone: None,
                };
                let session_bytes = export_session_bytes(session)?;
                let transport = RealTelegramTransport {
                    client: client.clone(),
                    session: Arc::clone(session),
                    quit_handle: quit_handle.clone(),
                    api_id: *api_id,
                    api_hash: api_hash.clone(),
                };
                let _ = lock.take();
                Ok((transport, tg_user, session_bytes))
            }
        }
    }

    pub async fn request_qr_code(&self, api_id: i32, api_hash: &str) -> Result<QrExportResult> {
        let session = Arc::new(MemorySession::default());
        let pool = SenderPool::new(Arc::clone(&session), api_id);
        let quit_handle = pool.handle.thin.clone();
        let client = Client::new(pool.handle);

        tokio::spawn(async move {
            let runner = pool.runner;
            let _ = runner.run().await;
        });

        let req = tl::functions::auth::ExportLoginToken {
            api_id,
            api_hash: api_hash.to_string(),
            except_ids: Vec::new(),
        };

        let res = client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to export Telegram QR login token: {}", e))
        })?;

        match res {
            tl::enums::auth::LoginToken::Token(tok) => {
                let token_b64 = base64url_encode(&tok.token);
                let token_url = format!("tg://login?token={}", token_b64);
                let expires_at = tok.expires as i64;

                let mut lock = self.pending.lock().await;
                *lock = Some(PendingAuth::Qr {
                    client,
                    session,
                    quit_handle,
                    api_id,
                    api_hash: api_hash.to_string(),
                    token_bytes: tok.token,
                    expires_at,
                    pwd_token: None,
                });

                Ok(QrExportResult {
                    token_url,
                    expires_at,
                })
            }
            tl::enums::auth::LoginToken::MigrateTo(mig) => {
                let _ = session.set_home_dc_id(mig.dc_id).await;
                let token_b64 = base64url_encode(&mig.token);
                let token_url = format!("tg://login?token={}", token_b64);
                let expires_at = (chrono::Utc::now().timestamp()) + 30;

                let mut lock = self.pending.lock().await;
                *lock = Some(PendingAuth::Qr {
                    client,
                    session,
                    quit_handle,
                    api_id,
                    api_hash: api_hash.to_string(),
                    token_bytes: mig.token,
                    expires_at,
                    pwd_token: None,
                });

                Ok(QrExportResult {
                    token_url,
                    expires_at,
                })
            }
            tl::enums::auth::LoginToken::Success(_) => Err(ProtoFsError::Mtproto(
                "Unexpected early success during QR token export.".to_string(),
            )),
        }
    }

    pub async fn check_qr_code(&self) -> Result<QrCheckOutcome> {
        let mut lock = self.pending.lock().await;
        let pending = lock.as_mut().ok_or_else(|| {
            ProtoFsError::Mtproto("No QR login session in progress.".to_string())
        })?;

        match pending {
            PendingAuth::Qr {
                client,
                session,
                quit_handle,
                api_id,
                api_hash,
                token_bytes,
                expires_at,
                pwd_token,
            } => {
                let req = tl::functions::auth::ExportLoginToken {
                    api_id: *api_id,
                    api_hash: api_hash.clone(),
                    except_ids: Vec::new(),
                };

                match client.invoke(&req).await {
                    Ok(tl::enums::auth::LoginToken::Token(tok)) => {
                        let token_changed = tok.token != *token_bytes;
                        *token_bytes = tok.token;
                        *expires_at = tok.expires as i64;
                        let token_url = if token_changed {
                            Some(format!("tg://login?token={}", base64url_encode(token_bytes)))
                        } else {
                            None
                        };
                        Ok(QrCheckOutcome::Waiting {
                            token_url,
                            expires_at: *expires_at,
                        })
                    }
                    Ok(tl::enums::auth::LoginToken::MigrateTo(mig)) => {
                        let _ = session.set_home_dc_id(mig.dc_id).await;
                        *token_bytes = mig.token;
                        *expires_at = chrono::Utc::now().timestamp() + 30;
                        let token_url = Some(format!("tg://login?token={}", base64url_encode(token_bytes)));
                        Ok(QrCheckOutcome::Waiting {
                            token_url,
                            expires_at: *expires_at,
                        })
                    }
                    Ok(tl::enums::auth::LoginToken::Success(auth_res)) => {
                        let tg_user = match auth_res.authorization {
                            tl::enums::auth::Authorization::Authorization(auth) => match auth.user {
                                tl::enums::User::User(u) => TelegramUser {
                                    id: u.id,
                                    first_name: u.first_name.unwrap_or_else(|| "Telegram User".to_string()),
                                    username: u.username,
                                    phone: u.phone,
                                },
                                tl::enums::User::Empty(e) => TelegramUser {
                                    id: e.id,
                                    first_name: "Telegram User".to_string(),
                                    username: None,
                                    phone: None,
                                },
                            },
                            tl::enums::auth::Authorization::SignUpRequired(_) => {
                                return Err(ProtoFsError::Mtproto(
                                    "Sign-up with official Telegram client required.".to_string(),
                                ));
                            }
                        };

                        let session_bytes = export_session_bytes(session)?;
                        let transport = RealTelegramTransport {
                            client: client.clone(),
                            session: Arc::clone(session),
                            quit_handle: quit_handle.clone(),
                            api_id: *api_id,
                            api_hash: api_hash.clone(),
                        };

                        let _ = lock.take();
                        Ok(QrCheckOutcome::Success {
                            transport,
                            user: tg_user,
                            session_bytes,
                        })
                    }
                    Err(err) if err.is("SESSION_PASSWORD_NEEDED") => {
                        let req_pwd = tl::functions::account::GetPassword {};
                        let pwd_res = client.invoke(&req_pwd).await.map_err(|e| {
                            ProtoFsError::Mtproto(format!("Failed to query 2FA password info: {}", e))
                        })?;
                        let password_type: tl::types::account::Password = pwd_res.into();
                        let pt = grammers_client::client::PasswordToken::new(password_type);
                        let hint = pt.hint().map(String::from);
                        *pwd_token = Some(pt);
                        Ok(QrCheckOutcome::Requires2Fa { hint })
                    }
                    Err(e) => Err(ProtoFsError::Mtproto(format!("QR check error: {}", e))),
                }
            }
            PendingAuth::Phone { .. } => Err(ProtoFsError::Mtproto(
                "Current login session is phone code, not QR code.".to_string(),
            )),
        }
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
