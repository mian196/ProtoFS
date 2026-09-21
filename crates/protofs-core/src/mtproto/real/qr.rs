use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use grammers_client::client::PasswordToken;
use grammers_session::Session;
use grammers_session::storages::MemorySession;
use grammers_tl_types as tl;
use serde::{Deserialize, Serialize};

use super::RealTelegramTransport;
use super::auth::{PendingAuth, TelegramAuthClient, init_grammers_client};
use super::session::export_session_bytes;
use crate::error::{ProtoFsError, Result};
use crate::mtproto::transport::TelegramUser;

fn base64url_encode(data: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(data)
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

impl TelegramAuthClient {
    pub async fn request_qr_code(&self, api_id: i32, api_hash: &str) -> Result<QrExportResult> {
        let session = Arc::new(MemorySession::default());
        let proxy = self.get_proxy().await;
        let client = init_grammers_client(Arc::clone(&session), api_id, proxy.clone());
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
                return Err(ProtoFsError::Mtproto(
                    "Unexpected early success during QR token export.".to_string(),
                ));
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
            proxy,
            pwd_token: None,
        });
        Ok(QrExportResult {
            token_url,
            expires_at,
        })
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
                api_id,
                api_hash,
                token_bytes,
                expires_at,
                proxy,
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
                        Ok(QrCheckOutcome::Waiting {
                            token_url: Some(format!(
                                "tg://login?token={}",
                                base64url_encode(token_bytes)
                            )),
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
                        let session_bytes = export_session_bytes(session).await?;
                        let transport = RealTelegramTransport::with_proxy(
                            client.clone(),
                            Arc::clone(session),
                            *api_id,
                            api_hash.clone(),
                            proxy.clone(),
                        );
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
                        let pt = PasswordToken::new(password_type);
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
}
