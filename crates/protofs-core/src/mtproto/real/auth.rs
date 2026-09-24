use std::sync::Arc;

use grammers_client::client::{LoginToken, PasswordToken};
use grammers_client::{Client, SignInError};
use grammers_mtsender::SenderPool;
use grammers_session::SessionData;
use grammers_session::storages::MemorySession;
use tokio::sync::Mutex;

use super::RealTelegramTransport;
use super::session::{ExportedSession, export_session_bytes};
use crate::error::{ProtoFsError, Result};
use crate::mtproto::proxy::{LocalProxyBridge, ProxyConfig};
use crate::mtproto::transport::TelegramUser;

pub(crate) async fn init_grammers_client(
    session: Arc<MemorySession>,
    api_id: i32,
    proxy: Option<ProxyConfig>,
) -> (Client, Option<Arc<LocalProxyBridge>>) {
    let mut params = grammers_mtsender::ConnectionParams::default();
    let mut bridge_ref = None;

    if let Some(proxy_cfg) = proxy {
        match proxy_cfg {
            ProxyConfig::Direct => {
                params.proxy_url = None;
            }
            ProxyConfig::Socks5 { host, port, auth } => {
                let url = match auth {
                    Some(a) if !a.username.is_empty() => {
                        format!("socks5://{}:{}@{}:{}", a.username, a.password, host, port)
                    }
                    _ => format!("socks5://{}:{}", host, port),
                };
                params.proxy_url = Some(url);
            }
            ProxyConfig::Http { .. } | ProxyConfig::Mtproto { .. } => {
                match LocalProxyBridge::start(proxy_cfg).await {
                    Ok(bridge) => {
                        let local_url = format!("socks5://127.0.0.1:{}", bridge.local_port);
                        params.proxy_url = Some(local_url);
                        bridge_ref = Some(Arc::new(bridge));
                    }
                    Err(e) => {
                        tracing::warn!("Failed to start LocalProxyBridge: {}", e);
                    }
                }
            }
        }
    }

    let pool = SenderPool::with_configuration(session, api_id, params);
    let runner = pool.runner;
    tokio::spawn(async move {
        tracing::debug!("Starting Grammers MTProto runner loop");
        runner.run().await;
        tracing::warn!("Grammers MTProto runner loop terminated");
    });
    (Client::new(pool.handle), bridge_ref)
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

pub(crate) enum PendingAuth {
    Phone {
        client: Client,
        session: Arc<MemorySession>,
        token: LoginToken,
        phone: String,
        api_id: i32,
        api_hash: String,
        proxy: Option<ProxyConfig>,
        bridge: Option<Arc<LocalProxyBridge>>,
        pwd_token: Option<PasswordToken>,
    },
    Qr {
        client: Client,
        session: Arc<MemorySession>,
        api_id: i32,
        api_hash: String,
        token_bytes: Vec<u8>,
        expires_at: i64,
        proxy: Option<ProxyConfig>,
        bridge: Option<Arc<LocalProxyBridge>>,
        pwd_token: Option<PasswordToken>,
    },
}

#[derive(Default)]
pub struct TelegramAuthClient {
    pub(crate) pending: Mutex<Option<PendingAuth>>,
    pub(crate) proxy: Mutex<Option<ProxyConfig>>,
}

impl TelegramAuthClient {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(None),
            proxy: Mutex::new(None),
        }
    }

    pub fn with_proxy(proxy: Option<ProxyConfig>) -> Self {
        Self {
            pending: Mutex::new(None),
            proxy: Mutex::new(proxy),
        }
    }

    pub fn set_proxy_sync(&self, proxy: Option<ProxyConfig>) {
        if let Ok(mut lock) = self.proxy.try_lock() {
            *lock = proxy;
        }
    }

    pub async fn set_proxy(&self, proxy: Option<ProxyConfig>) {
        let mut lock = self.proxy.lock().await;
        *lock = proxy;
    }

    pub async fn get_proxy(&self) -> Option<ProxyConfig> {
        let lock = self.proxy.lock().await;
        lock.clone()
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
        let proxy = self.get_proxy().await;
        let (client, bridge) =
            init_grammers_client(Arc::clone(&session), api_id, proxy.clone()).await;
        let token = client
            .request_login_code(phone, api_hash)
            .await
            .map_err(|e| {
                ProtoFsError::Mtproto(format!("Failed to request Telegram login code: {}", e))
            })?;
        *self.pending.lock().await = Some(PendingAuth::Phone {
            client,
            session,
            token,
            phone: phone.to_string(),
            api_id,
            api_hash: api_hash.to_string(),
            proxy,
            bridge,
            pwd_token: None,
        });
        Ok("code_sent".to_string())
    }

    pub async fn request_phone_code(
        &self,
        phone: &str,
        api_id: i32,
        api_hash: &str,
    ) -> Result<String> {
        self.send_code(phone, api_id, api_hash).await
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
                token,
                phone,
                api_id,
                api_hash,
                proxy,
                bridge,
                pwd_token,
            } => match client.sign_in(token, code).await {
                Ok(user) => {
                    let tg_user = TelegramUser {
                        id: user.id().bare_id_unchecked(),
                        first_name: user.first_name().unwrap_or("Telegram User").to_string(),
                        username: user.username().map(|s| s.to_string()),
                        phone: Some(phone.clone()),
                    };
                    let session_bytes = export_session_bytes(session).await?;
                    let transport = RealTelegramTransport::with_proxy_and_bridge(
                        client.clone(),
                        Arc::clone(session),
                        *api_id,
                        api_hash.clone(),
                        proxy.clone(),
                        bridge.clone(),
                    );
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

    pub async fn submit_phone_code(&self, code: &str) -> Result<VerifyOutcome> {
        self.verify_code(code).await
    }

    pub async fn verify_2fa(
        &self,
        password: &str,
    ) -> Result<(RealTelegramTransport, TelegramUser, Vec<u8>)> {
        let mut lock = self.pending.lock().await;
        let pending = lock.as_mut().ok_or_else(|| {
            ProtoFsError::Mtproto(
                "No login request in progress. Please request a code or QR first.".to_string(),
            )
        })?;

        let (res, take) = match pending {
            PendingAuth::Phone {
                client,
                session,
                phone,
                api_id,
                api_hash,
                proxy,
                bridge,
                pwd_token,
                ..
            } => {
                let res = check_2fa(
                    client,
                    session,
                    pwd_token,
                    password,
                    Some(phone.clone()),
                    *api_id,
                    api_hash,
                    proxy.clone(),
                    bridge.clone(),
                )
                .await;
                let take = res.is_ok();
                (res, take)
            }
            PendingAuth::Qr {
                client,
                session,
                api_id,
                api_hash,
                proxy,
                bridge,
                pwd_token,
                ..
            } => {
                let res = check_2fa(
                    client,
                    session,
                    pwd_token,
                    password,
                    None,
                    *api_id,
                    api_hash,
                    proxy.clone(),
                    bridge.clone(),
                )
                .await;
                let take = res.is_ok();
                (res, take)
            }
        };
        if take {
            let _ = lock.take();
        }
        res
    }

    pub async fn submit_2fa_password(
        &self,
        password: &str,
    ) -> Result<(RealTelegramTransport, TelegramUser, Vec<u8>)> {
        self.verify_2fa(password).await
    }

    pub async fn reconnect_from_session(
        api_id: i32,
        api_hash: &str,
        session_bytes: &[u8],
    ) -> Result<RealTelegramTransport> {
        Self::reconnect_from_session_with_proxy(api_id, api_hash, session_bytes, None).await
    }

    pub async fn reconnect_from_session_with_proxy(
        api_id: i32,
        api_hash: &str,
        session_bytes: &[u8],
        proxy: Option<ProxyConfig>,
    ) -> Result<RealTelegramTransport> {
        let exported: ExportedSession = serde_json::from_slice(session_bytes)
            .map_err(|e| ProtoFsError::Mtproto(format!("Corrupted session data: {}", e)))?;
        let session_data: SessionData = exported.into();
        let session = Arc::new(MemorySession::from(session_data));
        let (client, bridge) =
            init_grammers_client(Arc::clone(&session), api_id, proxy.clone()).await;

        let is_auth_res =
            tokio::time::timeout(std::time::Duration::from_secs(10), client.is_authorized())
                .await
                .map_err(|_| {
                    ProtoFsError::Mtproto(
                        "Connection timed out while checking session authorization".to_string(),
                    )
                })?;

        if !is_auth_res.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to check session authorization: {}", e))
        })? {
            return Err(ProtoFsError::Mtproto(
                "Saved Telegram session has expired or was revoked".to_string(),
            ));
        }

        Ok(RealTelegramTransport::with_proxy_and_bridge(
            client,
            session,
            api_id,
            api_hash.to_string(),
            proxy,
            bridge,
        ))
    }
}

#[allow(clippy::too_many_arguments)]
async fn check_2fa(
    client: &Client,
    session: &Arc<MemorySession>,
    pwd_token: &mut Option<PasswordToken>,
    password: &str,
    phone: Option<String>,
    api_id: i32,
    api_hash: &str,
    proxy: Option<ProxyConfig>,
    bridge: Option<Arc<LocalProxyBridge>>,
) -> Result<(RealTelegramTransport, TelegramUser, Vec<u8>)> {
    let pt = pwd_token
        .take()
        .ok_or_else(|| ProtoFsError::Mtproto("No 2FA password token available.".to_string()))?;
    let user = match client.check_password(pt, password).await {
        Ok(u) => u,
        Err(SignInError::InvalidPassword(next_token)) => {
            *pwd_token = Some(next_token);
            return Err(ProtoFsError::Mtproto(
                "Invalid 2FA password. Please check your password and try again.".to_string(),
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
        phone,
    };
    let session_bytes = export_session_bytes(session).await?;
    let transport = RealTelegramTransport::with_proxy_and_bridge(
        client.clone(),
        Arc::clone(session),
        api_id,
        api_hash.to_string(),
        proxy,
        bridge,
    );
    Ok((transport, tg_user, session_bytes))
}
