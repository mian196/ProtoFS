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

use super::transport::{
    ChannelInfo, OwnedChannel, TelegramMessage, TelegramTransport, TelegramUser,
};
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
                    ProtoFsError::Mtproto(
                        "No 2FA password token available for QR login.".to_string(),
                    )
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
        let pending = lock
            .as_mut()
            .ok_or_else(|| ProtoFsError::Mtproto("No QR login session in progress.".to_string()))?;

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
                            Some(format!(
                                "tg://login?token={}",
                                base64url_encode(token_bytes)
                            ))
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
                        let token_url = Some(format!(
                            "tg://login?token={}",
                            base64url_encode(token_bytes)
                        ));
                        Ok(QrCheckOutcome::Waiting {
                            token_url,
                            expires_at: *expires_at,
                        })
                    }
                    Ok(tl::enums::auth::LoginToken::Success(auth_res)) => {
                        let tg_user = match auth_res.authorization {
                            tl::enums::auth::Authorization::Authorization(auth) => {
                                match auth.user {
                                    tl::enums::User::User(u) => TelegramUser {
                                        id: u.id,
                                        first_name: u
                                            .first_name
                                            .unwrap_or_else(|| "Telegram User".to_string()),
                                        username: u.username,
                                        phone: u.phone,
                                    },
                                    tl::enums::User::Empty(e) => TelegramUser {
                                        id: e.id,
                                        first_name: "Telegram User".to_string(),
                                        username: None,
                                        phone: None,
                                    },
                                }
                            }
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
                            ProtoFsError::Mtproto(format!(
                                "Failed to query 2FA password info: {}",
                                e
                            ))
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

impl RealTelegramTransport {
    async fn upload_bytes_to_telegram(&self, filename: &str, data: &[u8]) -> Result<tl::enums::InputFile> {
        let temp = tempfile::NamedTempFile::new().map_err(ProtoFsError::Io)?;
        std::fs::write(temp.path(), data).map_err(ProtoFsError::Io)?;
        let uploaded = self
            .client
            .upload_file(temp.path())
            .await
            .map_err(|e| ProtoFsError::Mtproto(format!("Failed to upload file '{}': {}", filename, e)))?;
        let raw_file: tl::enums::InputFile = uploaded.raw;
        Ok(raw_file)
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

    async fn list_owned_channels(&self) -> Result<Vec<OwnedChannel>> {
        let req = tl::functions::messages::GetDialogs {
            exclude_pinned: false,
            folder_id: None,
            offset_date: 0,
            offset_id: 0,
            offset_peer: tl::enums::InputPeer::Empty,
            limit: 100,
            hash: 0,
        };

        let dialogs = self.client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to retrieve Telegram dialogs: {}", e))
        })?;

        let chats = match dialogs {
            tl::enums::messages::Dialogs::Dialogs(d) => d.chats,
            tl::enums::messages::Dialogs::Slice(s) => s.chats,
            tl::enums::messages::Dialogs::NotModified(_) => Vec::new(),
        };

        let mut owned = Vec::new();
        for chat in chats {
            match chat {
                tl::enums::Chat::Channel(c) => {
                    let is_creator = c.creator;
                    let is_admin = c.admin_rights.is_some();
                    if is_creator || is_admin {
                        let is_protofs = c.title.to_lowercase().contains("protofs");
                        owned.push(OwnedChannel {
                            channel_id: c.id,
                            title: c.title,
                            is_channel: c.broadcast,
                            is_group: c.megagroup,
                            is_creator,
                            is_admin,
                            is_protofs_drive: is_protofs,
                            about: None,
                        });
                    }
                }
                tl::enums::Chat::Chat(c) => {
                    let is_creator = c.creator;
                    let is_admin = c.admin_rights.is_some();
                    if is_creator || is_admin {
                        let is_protofs = c.title.to_lowercase().contains("protofs");
                        owned.push(OwnedChannel {
                            channel_id: c.id,
                            title: c.title,
                            is_channel: false,
                            is_group: true,
                            is_creator,
                            is_admin,
                            is_protofs_drive: is_protofs,
                            about: None,
                        });
                    }
                }
                _ => {}
            }
        }

        Ok(owned)
    }

    async fn get_pinned_manifest(&self, channel_id: i64) -> Result<Option<(i32, Vec<u8>)>> {
        let input_peer = tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
            channel_id,
            access_hash: 0,
        });

        let req = tl::functions::messages::Search {
            peer: input_peer,
            q: "#protofs_manifest_v1".to_string(),
            from_id: None,
            saved_peer_id: None,
            top_msg_id: None,
            filter: tl::enums::MessagesFilter::InputMessagesFilterDocument,
            min_date: 0,
            max_date: 0,
            offset_id: 0,
            add_offset: 0,
            limit: 10,
            max_id: 0,
            min_id: 0,
            hash: 0,
            saved_reaction: None,
        };

        let res = match self.client.invoke(&req).await {
            Ok(m) => m,
            Err(_) => return Ok(None),
        };

        let messages = match res {
            tl::enums::messages::Messages::Messages(m) => m.messages,
            tl::enums::messages::Messages::Slice(s) => s.messages,
            tl::enums::messages::Messages::ChannelMessages(c) => c.messages,
            tl::enums::messages::Messages::NotModified(_) => Vec::new(),
        };

        for msg in messages {
            if let tl::enums::Message::Message(m) = msg {
                if let Some(tl::enums::MessageMedia::Document(doc_media)) = m.media
                    && let Some(tl::enums::Document::Document(doc)) = doc_media.document
                {
                    let location = tl::enums::InputFileLocation::InputDocumentFileLocation(
                        tl::types::InputDocumentFileLocation {
                            id: doc.id,
                            access_hash: doc.access_hash,
                            file_reference: doc.file_reference,
                            thumb_size: String::new(),
                        },
                    );
                    let download_req = tl::functions::upload::GetFile {
                        precise: true,
                        cdn_supported: false,
                        location,
                        offset: 0,
                        limit: 1048576 * 4,
                    };
                    if let Ok(file_res) = self.client.invoke(&download_req).await {
                        let bytes = match file_res {
                            tl::enums::upload::File::File(f) => f.bytes,
                            tl::enums::upload::File::CdnRedirect(_) => Vec::new(),
                        };
                        if !bytes.is_empty() {
                            return Ok(Some((m.id, bytes)));
                        }
                    }
                }
            }
        }
        Ok(None)
    }



    async fn update_pinned_manifest(
        &self,
        channel_id: i64,
        manifest_bytes: &[u8],
    ) -> Result<i32> {
        let input_file = self.upload_bytes_to_telegram("manifest.json.zst", manifest_bytes).await?;

        let input_peer = tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
            channel_id,
            access_hash: 0,
        });

        let media = tl::enums::InputMedia::UploadedDocument(tl::types::InputMediaUploadedDocument {
            file: input_file,
            mime_type: "application/x-zstd".to_string(),
            attributes: vec![tl::enums::DocumentAttribute::Filename(
                tl::types::DocumentAttributeFilename {
                    file_name: "manifest.json.zst".to_string(),
                },
            )],
            nosound_video: false,
            force_file: true,
            ttl_seconds: None,
            spoiler: false,
            stickers: None,
            thumb: None,
            video_cover: None,
            video_timestamp: None,
        });

        let send_req = tl::functions::messages::SendMedia {
            silent: true,
            background: false,
            clear_draft: false,
            noforwards: false,
            update_stickersets_order: false,
            invert_media: false,
            peer: input_peer.clone(),
            reply_to: None,
            media,
            message: "#protofs_manifest_v1".to_string(),
            random_id: rand::random(),
            reply_markup: None,
            entities: None,
            schedule_date: None,
            send_as: None,
            quick_reply_shortcut: None,
            effect: None,
            allow_paid_floodskip: false,
            allow_paid_stars: None,
            schedule_repeat_period: None,
            suggested_post: None,
        };

        let updates = self.client.invoke(&send_req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to send pinned manifest message: {}", e))
        })?;

        let msg_id = match updates {
            tl::enums::Updates::Updates(u) => u
                .updates
                .into_iter()
                .find_map(|upd| match upd {
                    tl::enums::Update::NewMessage(nm) => {
                        if let tl::enums::Message::Message(m) = nm.message {
                            Some(m.id)
                        } else {
                            None
                        }
                    }
                    _ => None,
                })
                .unwrap_or(1),
            _ => 1,
        };

        let pin_req = tl::functions::messages::UpdatePinnedMessage {
            silent: true,
            unpin: false,
            pm_oneside: false,
            peer: input_peer,
            id: msg_id,
        };
        let _ = self.client.invoke(&pin_req).await;

        Ok(msg_id)
    }

    async fn upload_document(
        &self,
        channel_id: i64,
        filename: &str,
        caption: &str,
        data: &[u8],
    ) -> Result<TelegramMessage> {
        let input_file = self.upload_bytes_to_telegram(filename, data).await?;

        let input_peer = tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
            channel_id,
            access_hash: 0,
        });

        let media = tl::enums::InputMedia::UploadedDocument(tl::types::InputMediaUploadedDocument {
            file: input_file,
            mime_type: "application/octet-stream".to_string(),
            attributes: vec![tl::enums::DocumentAttribute::Filename(
                tl::types::DocumentAttributeFilename {
                    file_name: filename.to_string(),
                },
            )],
            nosound_video: false,
            force_file: true,
            ttl_seconds: None,
            spoiler: false,
            stickers: None,
            thumb: None,
            video_cover: None,
            video_timestamp: None,
        });

        let send_req = tl::functions::messages::SendMedia {
            silent: false,
            background: false,
            clear_draft: false,
            noforwards: false,
            update_stickersets_order: false,
            invert_media: false,
            peer: input_peer,
            reply_to: None,
            media,
            message: caption.to_string(),
            random_id: rand::random(),
            reply_markup: None,
            entities: None,
            schedule_date: None,
            send_as: None,
            quick_reply_shortcut: None,
            effect: None,
            allow_paid_floodskip: false,
            allow_paid_stars: None,
            schedule_repeat_period: None,
            suggested_post: None,
        };

        let updates = self.client.invoke(&send_req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to send document message: {}", e))
        })?;

        let msg_id = match updates {
            tl::enums::Updates::Updates(u) => u
                .updates
                .into_iter()
                .find_map(|upd| match upd {
                    tl::enums::Update::NewMessage(nm) => {
                        if let tl::enums::Message::Message(m) = nm.message {
                            Some(m.id)
                        } else {
                            None
                        }
                    }
                    _ => None,
                })
                .unwrap_or(1),
            _ => 1,
        };

        Ok(TelegramMessage {
            id: msg_id,
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
        channel_id: i64,
        message_id: i32,
        offset: u64,
        limit: u32,
    ) -> Result<Vec<u8>> {
        let get_msg_req = tl::functions::channels::GetMessages {
            channel: tl::enums::InputChannel::Channel(tl::types::InputChannel {
                channel_id,
                access_hash: 0,
            }),
            id: vec![tl::enums::InputMessage::Id(tl::types::InputMessageId {
                id: message_id,
            })],
        };

        let res = self.client.invoke(&get_msg_req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to fetch message #{}: {}", message_id, e))
        })?;

        let messages = match res {
            tl::enums::messages::Messages::Messages(m) => m.messages,
            tl::enums::messages::Messages::Slice(s) => s.messages,
            tl::enums::messages::Messages::ChannelMessages(c) => c.messages,
            tl::enums::messages::Messages::NotModified(_) => Vec::new(),
        };

        for msg in messages {
            if let tl::enums::Message::Message(m) = msg
                && let Some(tl::enums::MessageMedia::Document(doc_media)) = m.media
                && let Some(tl::enums::Document::Document(doc)) = doc_media.document
            {
                let location = tl::enums::InputFileLocation::InputDocumentFileLocation(
                    tl::types::InputDocumentFileLocation {
                        id: doc.id,
                        access_hash: doc.access_hash,
                        file_reference: doc.file_reference,
                        thumb_size: String::new(),
                    },
                );
                let download_req = tl::functions::upload::GetFile {
                    precise: true,
                    cdn_supported: false,
                    location,
                    offset: offset as i64,
                    limit: limit as i32,
                };
                if let Ok(file_res) = self.client.invoke(&download_req).await {
                    let bytes = match file_res {
                        tl::enums::upload::File::File(f) => f.bytes,
                        tl::enums::upload::File::CdnRedirect(_) => Vec::new(),
                    };
                    return Ok(bytes);
                }
            }
        }

        Ok(Vec::new())
    }

    async fn edit_caption(
        &self,
        channel_id: i64,
        message_id: i32,
        new_caption: &str,
    ) -> Result<()> {
        let input_peer = tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
            channel_id,
            access_hash: 0,
        });

        let req = tl::functions::messages::EditMessage {
            no_webpage: true,
            invert_media: false,
            peer: input_peer,
            id: message_id,
            message: Some(new_caption.to_string()),
            media: None,
            reply_markup: None,
            entities: None,
            schedule_date: None,
            quick_reply_shortcut_id: None,
            rich_message: None,
            schedule_repeat_period: None,
        };

        self.client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to edit caption for message #{}: {}", message_id, e))
        })?;

        Ok(())
    }

    async fn delete_message(&self, channel_id: i64, message_id: i32) -> Result<()> {
        let input_channel = tl::enums::InputChannel::Channel(tl::types::InputChannel {
            channel_id,
            access_hash: 0,
        });

        let req = tl::functions::channels::DeleteMessages {
            channel: input_channel,
            id: vec![message_id],
        };

        self.client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to delete message #{}: {}", message_id, e))
        })?;

        Ok(())
    }

    async fn scan_messages(
        &self,
        channel_id: i64,
        min_id: i32,
        limit: usize,
    ) -> Result<Vec<TelegramMessage>> {
        let input_peer = tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
            channel_id,
            access_hash: 0,
        });

        let req = tl::functions::messages::GetHistory {
            peer: input_peer,
            offset_id: 0,
            offset_date: 0,
            add_offset: 0,
            limit: limit as i32,
            max_id: 0,
            min_id,
            hash: 0,
        };

        let res = self.client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to scan message history for channel {}: {}", channel_id, e))
        })?;

        let raw_messages = match res {
            tl::enums::messages::Messages::Messages(m) => m.messages,
            tl::enums::messages::Messages::Slice(s) => s.messages,
            tl::enums::messages::Messages::ChannelMessages(c) => c.messages,
            tl::enums::messages::Messages::NotModified(_) => Vec::new(),
        };

        let mut result = Vec::new();
        for msg in raw_messages {
            if let tl::enums::Message::Message(m) = msg {
                let mut size = None;
                let mut name = None;
                if let Some(tl::enums::MessageMedia::Document(doc_media)) = &m.media
                    && let Some(tl::enums::Document::Document(doc)) = &doc_media.document
                {
                    size = Some(doc.size as u64);
                    for attr in &doc.attributes {
                        if let tl::enums::DocumentAttribute::Filename(f) = attr {
                            name = Some(f.file_name.clone());
                        }
                    }
                }

                result.push(TelegramMessage {
                    id: m.id,
                    channel_id,
                    caption: m.message.into(),
                    document_size: size,
                    document_name: name,
                    is_pinned: m.pinned,
                    date: chrono::DateTime::from_timestamp(m.date as i64, 0).unwrap_or_else(Utc::now),
                });
            }
        }

        Ok(result)
    }
}
