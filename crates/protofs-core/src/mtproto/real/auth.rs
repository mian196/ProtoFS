use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use grammers_client::client::{LoginToken, PasswordToken};
use grammers_client::{Client, SignInError};
use grammers_mtsender::SenderPool;
use grammers_session::storages::MemorySession;
use grammers_session::{Session, SessionData};
use grammers_tl_types as tl;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use super::session::{ExportedSession, export_session_bytes};
use super::RealTelegramTransport;
use crate::error::{ProtoFsError, Result};
use crate::mtproto::transport::TelegramUser;

fn base64url_encode(data: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(data)
}

fn init_grammers_client(session: Arc<MemorySession>, api_id: i32) -> Client {
    let pool = SenderPool::new(session, api_id);
    let runner = pool.runner;
    tokio::spawn(async move { let _ = runner.run().await; });
    Client::new(pool.handle)
}

pub enum VerifyOutcome {
    Success { transport: RealTelegramTransport, user: TelegramUser, session_bytes: Vec<u8> },
    Requires2Fa { hint: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrExportResult {
    pub token_url: String,
    pub expires_at: i64,
}

pub enum QrCheckOutcome {
    Waiting { token_url: Option<String>, expires_at: i64 },
    Success { transport: RealTelegramTransport, user: TelegramUser, session_bytes: Vec<u8> },
    Requires2Fa { hint: Option<String> },
}

pub enum PendingAuth {
    Phone {
        client: Client,
        session: Arc<MemorySession>,
        token: LoginToken,
        phone: String,
        api_id: i32,
        api_hash: String,
        pwd_token: Option<PasswordToken>,
    },
    Qr {
        client: Client,
        session: Arc<MemorySession>,
        api_id: i32,
        api_hash: String,
        token_bytes: Vec<u8>,
        expires_at: i64,
        pwd_token: Option<PasswordToken>,
    },
}

#[derive(Default)]
pub struct TelegramAuthClient {
    pending: Mutex<Option<PendingAuth>>,
}

impl TelegramAuthClient {
    pub fn new() -> Self {
        Self { pending: Mutex::new(None) }
    }

    pub async fn is_pending(&self) -> bool {
        self.pending.lock().await.is_some()
    }

    pub async fn cancel_pending_auth(&self) {
        let _ = self.pending.lock().await.take();
    }

    pub async fn cancel(&self) {
        self.cancel_pending_auth().await;
    }

    pub async fn send_code(&self, phone: &str, api_id: i32, api_hash: &str) -> Result<String> {
        let session = Arc::new(MemorySession::default());
        let client = init_grammers_client(Arc::clone(&session), api_id);
        let token = client.request_login_code(phone, api_hash).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to request Telegram login code: {}", e))
        })?;
        *self.pending.lock().await = Some(PendingAuth::Phone {
            client,
            session,
            token,
            phone: phone.to_string(),
            api_id,
            api_hash: api_hash.to_string(),
            pwd_token: None,
        });
        Ok("code_sent".to_string())
    }

    pub async fn request_phone_code(&self, phone: &str, api_id: i32, api_hash: &str) -> Result<String> {
        self.send_code(phone, api_id, api_hash).await
    }

    pub async fn verify_code(&self, code: &str) -> Result<VerifyOutcome> {
        let mut lock = self.pending.lock().await;
        let pending = lock.as_mut().ok_or_else(|| {
            ProtoFsError::Mtproto("No login request in progress. Please request a code first.".to_string())
        })?;

        match pending {
            PendingAuth::Phone { client, session, token, phone, api_id, api_hash, pwd_token } => {
                match client.sign_in(token, code).await {
                    Ok(user) => {
                        let tg_user = TelegramUser {
                            id: user.id().bare_id_unchecked(),
                            first_name: user.first_name().unwrap_or("Telegram User").to_string(),
                            username: user.username().map(|s| s.to_string()),
                            phone: Some(phone.clone()),
                        };
                        let session_bytes = export_session_bytes(session).await?;
                        let transport = RealTelegramTransport::new(client.clone(), Arc::clone(session), *api_id, api_hash.clone());
                        let _ = lock.take();
                        Ok(VerifyOutcome::Success { transport, user: tg_user, session_bytes })
                    }
                    Err(SignInError::PasswordRequired(pt)) => {
                        let hint = pt.hint().map(String::from);
                        *pwd_token = Some(pt);
                        Ok(VerifyOutcome::Requires2Fa { hint })
                    }
                    Err(e) => Err(ProtoFsError::Mtproto(format!("Failed to verify Telegram code: {}", e))),
                }
            }
            PendingAuth::Qr { .. } => Err(ProtoFsError::Mtproto("Current login session is QR code, not phone code.".to_string())),
        }
    }

    pub async fn submit_phone_code(&self, code: &str) -> Result<VerifyOutcome> {
        self.verify_code(code).await
    }

    pub async fn verify_2fa(&self, password: &str) -> Result<(RealTelegramTransport, TelegramUser, Vec<u8>)> {
        let mut lock = self.pending.lock().await;
        let pending = lock.as_mut().ok_or_else(|| {
            ProtoFsError::Mtproto("No login request in progress. Please request a code or QR first.".to_string())
        })?;

        let (res, take) = match pending {
            PendingAuth::Phone { client, session, phone, api_id, api_hash, pwd_token, .. } => {
                let res = check_2fa(client, session, pwd_token, password, Some(phone.clone()), *api_id, api_hash).await;
                let take = res.is_ok();
                (res, take)
            }
            PendingAuth::Qr { client, session, api_id, api_hash, pwd_token, .. } => {
                let res = check_2fa(client, session, pwd_token, password, None, *api_id, api_hash).await;
                let take = res.is_ok();
                (res, take)
            }
        };
        if take { let _ = lock.take(); }
        res
    }

    pub async fn submit_2fa_password(&self, password: &str) -> Result<(RealTelegramTransport, TelegramUser, Vec<u8>)> {
        self.verify_2fa(password).await
    }

    pub async fn request_qr_code(&self, api_id: i32, api_hash: &str) -> Result<QrExportResult> {
        let session = Arc::new(MemorySession::default());
        let client = init_grammers_client(Arc::clone(&session), api_id);
        let req = tl::functions::auth::ExportLoginToken {
            api_id,
            api_hash: api_hash.to_string(),
            except_ids: Vec::new(),
        };
        let res = client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to export Telegram QR login token: {}", e))
        })?;

        let (token_bytes, expires_at) = match res {
            tl::enums::auth::LoginToken::Token(tok) => (tok.token, tok.expires as i64),
            tl::enums::auth::LoginToken::MigrateTo(mig) => {
                let _ = session.set_home_dc_id(mig.dc_id).await;
                (mig.token, chrono::Utc::now().timestamp() + 30)
            }
            tl::enums::auth::LoginToken::Success(_) => {
                return Err(ProtoFsError::Mtproto("Unexpected early success during QR token export.".to_string()));
            }
        };

        let token_url = format!("tg://login?token={}", base64url_encode(&token_bytes));
        *self.pending.lock().await = Some(PendingAuth::Qr {
            client,
            session,
            api_id,
            api_hash: api_hash.to_string(),
            token_bytes,
            expires_at,
            pwd_token: None,
        });
        Ok(QrExportResult { token_url, expires_at })
    }

    pub async fn check_qr_code(&self) -> Result<QrCheckOutcome> {
        let mut lock = self.pending.lock().await;
        let pending = lock.as_mut().ok_or_else(|| {
            ProtoFsError::Mtproto("No QR login session in progress.".to_string())
        })?;

        match pending {
            PendingAuth::Qr { client, session, api_id, api_hash, token_bytes, expires_at, pwd_token } => {
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
                        Ok(QrCheckOutcome::Waiting { token_url, expires_at: *expires_at })
                    }
                    Ok(tl::enums::auth::LoginToken::MigrateTo(mig)) => {
                        let _ = session.set_home_dc_id(mig.dc_id).await;
                        *token_bytes = mig.token;
                        *expires_at = chrono::Utc::now().timestamp() + 30;
                        Ok(QrCheckOutcome::Waiting {
                            token_url: Some(format!("tg://login?token={}", base64url_encode(token_bytes))),
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
                                return Err(ProtoFsError::Mtproto("Sign-up with official Telegram client required.".to_string()));
                            }
                        };
                        let session_bytes = export_session_bytes(session).await?;
                        let transport = RealTelegramTransport::new(client.clone(), Arc::clone(session), *api_id, api_hash.clone());
                        let _ = lock.take();
                        Ok(QrCheckOutcome::Success { transport, user: tg_user, session_bytes })
                    }
                    Err(err) if err.is("SESSION_PASSWORD_NEEDED") => {
                        let req_pwd = tl::functions::account::GetPassword {};
                        let pwd_res = client.invoke(&req_pwd).await.map_err(|e| {
                            ProtoFsError::Mtproto(format!("Failed to query 2FA password info: {}", e))
                        })?;
                        let password_type: tl::types::account::Password = pwd_res.into();
                        let pt = PasswordToken::new(password_type);
                        let hint = pt.hint().map(String::from);
                        *pwd_token = Some(pt);
                        Ok(QrCheckOutcome::Requires2Fa { hint })
                    }
                    Err(e) => Err(ProtoFsError::Mtproto(format!("QR check error: {}", e))),
                }
            }
            PendingAuth::Phone { .. } => Err(ProtoFsError::Mtproto("Current login session is phone code, not QR code.".to_string())),
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
        let client = init_grammers_client(Arc::clone(&session), api_id);

        if !client.is_authorized().await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to check session authorization: {}", e))
        })? {
            return Err(ProtoFsError::Mtproto("Saved Telegram session has expired or was revoked".to_string()));
        }

        Ok(RealTelegramTransport::new(client, session, api_id, api_hash.to_string()))
    }
}

async fn check_2fa(
    client: &Client,
    session: &Arc<MemorySession>,
    pwd_token: &mut Option<PasswordToken>,
    password: &str,
    phone: Option<String>,
    api_id: i32,
    api_hash: &str,
) -> Result<(RealTelegramTransport, TelegramUser, Vec<u8>)> {
    let pt = pwd_token.take().ok_or_else(|| {
        ProtoFsError::Mtproto("No 2FA password token available.".to_string())
    })?;
    let user = match client.check_password(pt, password).await {
        Ok(u) => u,
        Err(SignInError::InvalidPassword(next_token)) => {
            *pwd_token = Some(next_token);
            return Err(ProtoFsError::Mtproto("Invalid 2FA password. Please check your password and try again.".to_string()));
        }
        Err(e) => return Err(ProtoFsError::Mtproto(format!("Failed to verify 2FA password: {}", e))),
    };
    let tg_user = TelegramUser {
        id: user.id().bare_id_unchecked(),
        first_name: user.first_name().unwrap_or("Telegram User").to_string(),
        username: user.username().map(|s| s.to_string()),
        phone,
    };
    let session_bytes = export_session_bytes(session).await?;
    let transport = RealTelegramTransport::new(client.clone(), Arc::clone(session), api_id, api_hash.to_string());
    Ok((transport, tg_user, session_bytes))
}
