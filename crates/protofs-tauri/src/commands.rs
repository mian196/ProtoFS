use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

use protofs_core::cache::{CacheDatabase, SearchResult};
use protofs_core::mtproto::{
    DynamicTelegramTransport, OwnedChannel, QrCheckOutcome, RealTelegramTransport,
    TelegramAuthClient, TelegramTransport, TelegramUser, VerifyOutcome,
};
use protofs_core::sync::SyncEngine;
use protofs_core::vfs::{DriveMetadata, FileNode, FileVersion, FolderNode, VfsNode};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportDriveResult {
    pub export_path: String,
    pub total_folders: usize,
    pub total_files: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    pub session: Option<AuthSession>,
    pub requires_2fa: bool,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrStatusResponse {
    pub token_url: String,
    pub expires_in_sec: i32,
    pub status: String,
    pub session: Option<AuthSession>,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub is_authenticated: bool,
    pub phone: String,
    pub api_id: String,
    pub api_hash: String,
    pub username: Option<String>,
    pub first_name: String,
    pub user_id: i64,
    pub active_drive_id: String,
    #[serde(default)]
    pub is_demo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AccountRegistry {
    pub active_user_id: Option<i64>,
    pub accounts: Vec<AuthSession>,
}

#[derive(Clone)]
pub struct AppState {
    pub engine: Arc<SyncEngine<DynamicTelegramTransport>>,
    pub cache: CacheDatabase,
    pub session: Arc<RwLock<Option<AuthSession>>>,
    pub drives: Arc<RwLock<Vec<DriveMetadata>>>,
    pub auth_client: Arc<TelegramAuthClient>,
    pub transport: DynamicTelegramTransport,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> CommandResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}

// ---------------------------------------------------------------------------
// Authentication & Session IPC Commands (PRD Section 6.1 & 6.18)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn login_send_code(
    app: tauri::AppHandle,
    phone: String,
    api_id: String,
    api_hash: String,
) -> Result<CommandResponse<String>, String> {
    let state = app.state::<AppState>();
    let trimmed_phone = phone.trim();
    if trimmed_phone.is_empty() {
        return Ok(CommandResponse::err("Phone number cannot be empty"));
    }
    if api_id.trim().is_empty() || api_hash.trim().is_empty() {
        return Ok(CommandResponse::err(
            "API ID and API Hash are required (from my.telegram.org)",
        ));
    }

    // Check if demo mode
    if trimmed_phone == "demo"
        || api_id.trim().to_lowercase() == "demo"
        || trimmed_phone.starts_with("+1555")
    {
        let code_hash = format!("hash_{:x}", md5_hash(trimmed_phone));
        return Ok(CommandResponse::ok(code_hash));
    }

    let api_id_int: i32 = match api_id.trim().parse() {
        Ok(val) => val,
        Err(_) => {
            return Ok(CommandResponse::err(
                "API ID must be a numeric integer from my.telegram.org",
            ))
        }
    };

    match state
        .auth_client
        .send_code(trimmed_phone, api_id_int, api_hash.trim())
        .await
    {
        Ok(hash) => Ok(CommandResponse::ok(hash)),
        Err(e) => Ok(CommandResponse::err(format!("Telegram login error: {}", e))),
    }
}

#[allow(clippy::too_many_arguments)]
async fn finalize_login(
    app: &tauri::AppHandle,
    state: &AppState,
    phone: Option<String>,
    api_id: String,
    api_hash: String,
    tg_user: TelegramUser,
    session_bytes: &[u8],
    real_transport: RealTelegramTransport,
) -> AuthSession {
    state.transport.switch_to_real(real_transport).await;

    let drive_id = format!("drive_{}", tg_user.id);
    let session = AuthSession {
        is_authenticated: true,
        phone: phone.unwrap_or_else(|| "+Telegram User".to_string()),
        api_id,
        api_hash,
        username: tg_user.username,
        first_name: tg_user.first_name,
        user_id: tg_user.id,
        active_drive_id: drive_id.clone(),
        is_demo: false,
    };

    save_real_telegram_session_for_user(app, tg_user.id, session_bytes);

    let mut registry = load_account_registry(app);
    if let Some(pos) = registry
        .accounts
        .iter()
        .position(|a| a.user_id == session.user_id)
    {
        registry.accounts[pos] = session.clone();
    } else {
        registry.accounts.push(session.clone());
    }
    registry.active_user_id = Some(session.user_id);
    save_account_registry(app, &registry);

    let mut user_drives = load_user_drives(app, tg_user.id);
    if user_drives.is_empty() {
        let initial_drive = DriveMetadata {
            id: drive_id,
            name: "ProtoFS Cloud Drive".to_string(),
            channel_id: 0,
            pinned_manifest_msg_id: Some(1),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        user_drives.push(initial_drive);
        save_user_drives(app, tg_user.id, &user_drives);
    }

    let mut drives_lock = state.drives.write().await;
    *drives_lock = user_drives;
    drop(drives_lock);

    let mut lock = state.session.write().await;
    *lock = Some(session.clone());

    save_auth_session(app, &session);
    session
}

async fn finalize_demo_login(
    app: &tauri::AppHandle,
    state: &AppState,
    phone: String,
    api_id: String,
    api_hash: String,
) -> AuthSession {
    let session = AuthSession {
        is_authenticated: true,
        phone,
        api_id,
        api_hash,
        username: Some("MuzAmMaL".to_string()),
        first_name: "ProtoFS User".to_string(),
        user_id: 1049281720,
        active_drive_id: "personal".to_string(),
        is_demo: true,
    };

    let mut registry = load_account_registry(app);
    if let Some(pos) = registry
        .accounts
        .iter()
        .position(|a| a.user_id == session.user_id)
    {
        registry.accounts[pos] = session.clone();
    } else {
        registry.accounts.push(session.clone());
    }
    registry.active_user_id = Some(session.user_id);
    save_account_registry(app, &registry);

    let mut lock = state.session.write().await;
    *lock = Some(session.clone());
    let mut drives_lock = state.drives.write().await;
    *drives_lock = get_demo_drives();
    drop(drives_lock);

    save_auth_session(app, &session);
    session
}

#[tauri::command]
pub async fn login_verify_code(
    app: tauri::AppHandle,
    phone: String,
    api_id: String,
    api_hash: String,
    code: String,
) -> Result<CommandResponse<AuthResponse>, String> {
    let state = app.state::<AppState>();
    let trimmed_code = code.trim();

    if trimmed_code.len() < 4 {
        return Ok(CommandResponse::err(
            "Verification code must be at least 4 digits",
        ));
    }

    // Check if demo login
    if phone.trim() == "demo"
        || api_id.trim().to_lowercase() == "demo"
        || phone.trim().starts_with("+1555")
        || phone.trim().starts_with("+1 (202) 555")
        || trimmed_code == "12345"
    {
        let session = finalize_demo_login(&app, &state, phone, api_id, api_hash).await;
        return Ok(CommandResponse::ok(AuthResponse {
            session: Some(session),
            requires_2fa: false,
            hint: None,
        }));
    }

    // Real Telegram MTProto verification
    match state.auth_client.verify_code(trimmed_code).await {
        Ok(VerifyOutcome::Success {
            transport,
            user,
            session_bytes,
        }) => {
            let session = finalize_login(
                &app,
                &state,
                Some(phone),
                api_id,
                api_hash,
                user,
                &session_bytes,
                transport,
            )
            .await;
            Ok(CommandResponse::ok(AuthResponse {
                session: Some(session),
                requires_2fa: false,
                hint: None,
            }))
        }
        Ok(VerifyOutcome::Requires2Fa { hint }) => Ok(CommandResponse::ok(AuthResponse {
            session: None,
            requires_2fa: true,
            hint,
        })),
        Err(e) => Ok(CommandResponse::err(format!("Verification failed: {}", e))),
    }
}

#[tauri::command]
pub async fn login_verify_2fa(
    app: tauri::AppHandle,
    api_id: String,
    api_hash: String,
    password: String,
) -> Result<CommandResponse<AuthResponse>, String> {
    let state = app.state::<AppState>();

    match state.auth_client.verify_2fa(password.trim()).await {
        Ok((transport, user, session_bytes)) => {
            let phone = user.phone.clone();
            let session = finalize_login(
                &app,
                &state,
                phone,
                api_id,
                api_hash,
                user,
                &session_bytes,
                transport,
            )
            .await;
            Ok(CommandResponse::ok(AuthResponse {
                session: Some(session),
                requires_2fa: false,
                hint: None,
            }))
        }
        Err(e) => Ok(CommandResponse::err(format!("{}", e))),
    }
}

#[tauri::command]
pub async fn login_request_qr(
    app: tauri::AppHandle,
    api_id: String,
    api_hash: String,
) -> Result<CommandResponse<QrStatusResponse>, String> {
    let state = app.state::<AppState>();

    if api_id.trim().to_lowercase() == "demo" {
        return Ok(CommandResponse::ok(QrStatusResponse {
            token_url: "tg://login?token=demo_token_protofs_quick_test".to_string(),
            expires_in_sec: 120,
            status: "waiting_scan".to_string(),
            session: None,
            hint: None,
        }));
    }

    let api_id_int = match api_id.trim().parse::<i32>() {
        Ok(val) => val,
        Err(_) => {
            return Ok(CommandResponse::err(
                "Invalid API ID: must be a numeric integer",
            ));
        }
    };

    match state
        .auth_client
        .request_qr_code(api_id_int, api_hash.trim())
        .await
    {
        Ok(res) => {
            let now = Utc::now().timestamp();
            let expires_in_sec = (res.expires_at - now).max(5) as i32;
            Ok(CommandResponse::ok(QrStatusResponse {
                token_url: res.token_url,
                expires_in_sec,
                status: "waiting_scan".to_string(),
                session: None,
                hint: None,
            }))
        }
        Err(e) => Ok(CommandResponse::err(format!(
            "Failed to generate QR code: {}",
            e
        ))),
    }
}

#[tauri::command]
pub async fn login_check_qr(
    app: tauri::AppHandle,
    api_id: String,
    api_hash: String,
) -> Result<CommandResponse<QrStatusResponse>, String> {
    let state = app.state::<AppState>();

    if api_id.trim().to_lowercase() == "demo" {
        return Ok(CommandResponse::ok(QrStatusResponse {
            token_url: "tg://login?token=demo_token_protofs_quick_test".to_string(),
            expires_in_sec: 120,
            status: "waiting_scan".to_string(),
            session: None,
            hint: None,
        }));
    }

    match state.auth_client.check_qr_code().await {
        Ok(QrCheckOutcome::Waiting {
            token_url,
            expires_at,
        }) => {
            let now = Utc::now().timestamp();
            let expires_in_sec = (expires_at - now).max(1) as i32;
            Ok(CommandResponse::ok(QrStatusResponse {
                token_url: token_url.unwrap_or_default(),
                expires_in_sec,
                status: "waiting_scan".to_string(),
                session: None,
                hint: None,
            }))
        }
        Ok(QrCheckOutcome::Success {
            transport,
            user,
            session_bytes,
        }) => {
            let phone = user.phone.clone();
            let session = finalize_login(
                &app,
                &state,
                phone,
                api_id,
                api_hash,
                user,
                &session_bytes,
                transport,
            )
            .await;
            Ok(CommandResponse::ok(QrStatusResponse {
                token_url: String::new(),
                expires_in_sec: 0,
                status: "success".to_string(),
                session: Some(session),
                hint: None,
            }))
        }
        Ok(QrCheckOutcome::Requires2Fa { hint }) => Ok(CommandResponse::ok(QrStatusResponse {
            token_url: String::new(),
            expires_in_sec: 0,
            status: "requires_2fa".to_string(),
            session: None,
            hint,
        })),
        Err(e) => Ok(CommandResponse::err(format!("{}", e))),
    }
}

fn get_accounts_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let base_dir = if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        Some(dir)
    } else if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::PathBuf::from(appdata).join("ProtoFS");
        let _ = std::fs::create_dir_all(&dir);
        Some(dir)
    } else {
        None
    };

    base_dir.map(|d| d.join("accounts.enc"))
}

fn get_user_session_path(app: &tauri::AppHandle, user_id: i64) -> Option<std::path::PathBuf> {
    let base_dir = if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        Some(dir)
    } else if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::PathBuf::from(appdata).join("ProtoFS");
        let _ = std::fs::create_dir_all(&dir);
        Some(dir)
    } else {
        None
    };

    base_dir.map(|d| d.join(format!("telegram_session_{}.enc", user_id)))
}

fn get_session_paths(
    app: &tauri::AppHandle,
) -> (Option<std::path::PathBuf>, Option<std::path::PathBuf>) {
    let base_dir = if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        Some(dir)
    } else if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::PathBuf::from(appdata).join("ProtoFS");
        let _ = std::fs::create_dir_all(&dir);
        Some(dir)
    } else {
        None
    };

    if let Some(dir) = base_dir {
        let enc_path = dir.join("session.enc");
        let legacy_path = dir.join("session.json");
        (Some(enc_path), Some(legacy_path))
    } else {
        (None, None)
    }
}

fn get_real_session_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let base_dir = if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        Some(dir)
    } else if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::PathBuf::from(appdata).join("ProtoFS");
        let _ = std::fs::create_dir_all(&dir);
        Some(dir)
    } else {
        None
    };

    base_dir.map(|d| d.join("telegram_session.enc"))
}

fn save_auth_session(app: &tauri::AppHandle, session: &AuthSession) {
    if let (Some(enc_path), Some(legacy_path)) = get_session_paths(app) {
        if let Ok(json) = serde_json::to_string(session) {
            if let Ok(encrypted) = protofs_core::crypto::protect_secret(json.as_bytes()) {
                let _ = std::fs::write(enc_path, encrypted);
                if legacy_path.exists() {
                    let _ = std::fs::remove_file(legacy_path);
                }
            }
        }
    }
}

fn save_real_telegram_session_for_user(app: &tauri::AppHandle, user_id: i64, session_bytes: &[u8]) {
    if let Some(path) = get_user_session_path(app, user_id) {
        if let Ok(encrypted) = protofs_core::crypto::protect_secret(session_bytes) {
            let _ = std::fs::write(path, encrypted);
        }
    }
    // Also save to legacy path for backward compatibility
    if let Some(path) = get_real_session_path(app) {
        if let Ok(encrypted) = protofs_core::crypto::protect_secret(session_bytes) {
            let _ = std::fs::write(path, encrypted);
        }
    }
}

fn load_real_telegram_session_for_user(app: &tauri::AppHandle, user_id: i64) -> Option<Vec<u8>> {
    if let Some(path) = get_user_session_path(app, user_id) {
        if path.exists() {
            if let Ok(encrypted_bytes) = std::fs::read(&path) {
                if let Ok(decrypted) = protofs_core::crypto::unprotect_secret(&encrypted_bytes) {
                    return Some(decrypted);
                }
            }
        }
    }
    load_real_telegram_session(app)
}

fn save_account_registry(app: &tauri::AppHandle, registry: &AccountRegistry) {
    if let Some(path) = get_accounts_path(app) {
        if let Ok(json) = serde_json::to_string(registry) {
            if let Ok(encrypted) = protofs_core::crypto::protect_secret(json.as_bytes()) {
                let _ = std::fs::write(path, encrypted);
            }
        }
    }
}

fn load_account_registry(app: &tauri::AppHandle) -> AccountRegistry {
    if let Some(path) = get_accounts_path(app) {
        if path.exists() {
            if let Ok(encrypted_bytes) = std::fs::read(&path) {
                if let Ok(decrypted_bytes) =
                    protofs_core::crypto::unprotect_secret(&encrypted_bytes)
                {
                    if let Ok(registry) =
                        serde_json::from_slice::<AccountRegistry>(&decrypted_bytes)
                    {
                        return registry;
                    }
                }
            }
        }
    }

    // Migration from legacy single-session storage
    if let Some(legacy_session) = load_auth_session(app) {
        let user_id = legacy_session.user_id;
        if let (Some(legacy_tg), Some(new_tg)) = (
            get_real_session_path(app),
            get_user_session_path(app, user_id),
        ) {
            if legacy_tg.exists() && !new_tg.exists() {
                let _ = std::fs::copy(&legacy_tg, &new_tg);
            }
        }

        let registry = AccountRegistry {
            active_user_id: Some(user_id),
            accounts: vec![legacy_session],
        };
        save_account_registry(app, &registry);
        return registry;
    }

    AccountRegistry::default()
}

fn load_auth_session(app: &tauri::AppHandle) -> Option<AuthSession> {
    if let (Some(enc_path), Some(legacy_path)) = get_session_paths(app) {
        if enc_path.exists() {
            if let Ok(encrypted_bytes) = std::fs::read(&enc_path) {
                if let Ok(decrypted_bytes) =
                    protofs_core::crypto::unprotect_secret(&encrypted_bytes)
                {
                    if let Ok(persisted) = serde_json::from_slice::<AuthSession>(&decrypted_bytes) {
                        return Some(persisted);
                    }
                }
            }
        } else if legacy_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&legacy_path) {
                if let Ok(persisted) = serde_json::from_str::<AuthSession>(&content) {
                    if let Ok(encrypted) = protofs_core::crypto::protect_secret(content.as_bytes())
                    {
                        let _ = std::fs::write(enc_path, encrypted);
                        let _ = std::fs::remove_file(legacy_path);
                    }
                    return Some(persisted);
                }
            }
        }
    }
    None
}

fn load_real_telegram_session(app: &tauri::AppHandle) -> Option<Vec<u8>> {
    if let Some(path) = get_real_session_path(app) {
        if path.exists() {
            if let Ok(encrypted_bytes) = std::fs::read(&path) {
                if let Ok(decrypted) = protofs_core::crypto::unprotect_secret(&encrypted_bytes) {
                    return Some(decrypted);
                }
            }
        }
    }
    None
}

#[tauri::command]
pub async fn get_session_status(
    app: tauri::AppHandle,
) -> Result<CommandResponse<Option<AuthSession>>, String> {
    let state = app.state::<AppState>();
    let mut lock = state.session.write().await;

    // If in-memory state is empty, restore active account from registry
    if lock.is_none() {
        let registry = load_account_registry(&app);
        if let Some(active_id) = registry.active_user_id {
            if let Some(account) = registry
                .accounts
                .iter()
                .find(|a| a.user_id == active_id)
                .cloned()
            {
                if account.is_demo {
                    state.transport.switch_to_mock().await;
                    let mut drives_lock = state.drives.write().await;
                    *drives_lock = get_demo_drives();
                } else {
                    if let Some(session_bytes) =
                        load_real_telegram_session_for_user(&app, active_id)
                    {
                        if let Ok(api_id_int) = account.api_id.trim().parse::<i32>() {
                            if let Ok(real) = TelegramAuthClient::reconnect_from_session(
                                api_id_int,
                                account.api_hash.trim(),
                                &session_bytes,
                            )
                            .await
                            {
                                state.transport.switch_to_real(real).await;
                            }
                        }
                    }
                    let mut drives_lock = state.drives.write().await;
                    *drives_lock = load_user_drives(&app, account.user_id);
                }
                *lock = Some(account);
            }
        }
    }

    Ok(CommandResponse::ok(lock.clone()))
}

#[tauri::command]
pub async fn list_accounts_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<Vec<AuthSession>>, String> {
    let registry = load_account_registry(&app);
    Ok(CommandResponse::ok(registry.accounts))
}

#[tauri::command]
pub async fn switch_account_command(
    app: tauri::AppHandle,
    user_id: i64,
) -> Result<CommandResponse<AuthSession>, String> {
    let state = app.state::<AppState>();
    let mut registry = load_account_registry(&app);

    let target_account = registry
        .accounts
        .iter()
        .find(|a| a.user_id == user_id)
        .cloned()
        .ok_or_else(|| "Account not found in registered accounts".to_string())?;

    registry.active_user_id = Some(user_id);
    save_account_registry(&app, &registry);

    if target_account.is_demo {
        state.transport.switch_to_mock().await;
        let mut drives_lock = state.drives.write().await;
        *drives_lock = get_demo_drives();
    } else {
        if let Some(session_bytes) = load_real_telegram_session_for_user(&app, user_id) {
            if let Ok(api_id_int) = target_account.api_id.trim().parse::<i32>() {
                if let Ok(real) = TelegramAuthClient::reconnect_from_session(
                    api_id_int,
                    target_account.api_hash.trim(),
                    &session_bytes,
                )
                .await
                {
                    state.transport.switch_to_real(real).await;
                }
            }
        }
        let mut drives_lock = state.drives.write().await;
        *drives_lock = load_user_drives(&app, user_id);
    }

    let mut lock = state.session.write().await;
    *lock = Some(target_account.clone());
    save_auth_session(&app, &target_account);

    Ok(CommandResponse::ok(target_account))
}

#[tauri::command]
pub async fn remove_account_command(
    app: tauri::AppHandle,
    user_id: i64,
) -> Result<CommandResponse<Option<AuthSession>>, String> {
    let state = app.state::<AppState>();
    let mut registry = load_account_registry(&app);

    registry.accounts.retain(|a| a.user_id != user_id);

    // Clean up per-user storage files
    if let Some(path) = get_user_session_path(&app, user_id) {
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }
    if let Some(path) = get_drives_file_path(&app, user_id) {
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }

    let was_active = registry.active_user_id == Some(user_id);
    let next_session = if was_active {
        if let Some(next_acc) = registry.accounts.first().cloned() {
            registry.active_user_id = Some(next_acc.user_id);
            save_account_registry(&app, &registry);

            if next_acc.is_demo {
                state.transport.switch_to_mock().await;
                let mut drives_lock = state.drives.write().await;
                *drives_lock = get_demo_drives();
            } else {
                if let Some(session_bytes) =
                    load_real_telegram_session_for_user(&app, next_acc.user_id)
                {
                    if let Ok(api_id_int) = next_acc.api_id.trim().parse::<i32>() {
                        if let Ok(real) = TelegramAuthClient::reconnect_from_session(
                            api_id_int,
                            next_acc.api_hash.trim(),
                            &session_bytes,
                        )
                        .await
                        {
                            state.transport.switch_to_real(real).await;
                        }
                    }
                }
                let mut drives_lock = state.drives.write().await;
                *drives_lock = load_user_drives(&app, next_acc.user_id);
            }

            let mut lock = state.session.write().await;
            *lock = Some(next_acc.clone());
            save_auth_session(&app, &next_acc);
            Some(next_acc)
        } else {
            registry.active_user_id = None;
            save_account_registry(&app, &registry);

            let mut lock = state.session.write().await;
            *lock = None;
            let mut drives_lock = state.drives.write().await;
            drives_lock.clear();
            state.transport.switch_to_mock().await;

            if let (Some(enc_path), Some(legacy_path)) = get_session_paths(&app) {
                if enc_path.exists() {
                    let _ = std::fs::remove_file(enc_path);
                }
                if legacy_path.exists() {
                    let _ = std::fs::remove_file(legacy_path);
                }
            }
            None
        }
    } else {
        save_account_registry(&app, &registry);
        state.session.read().await.clone()
    };

    Ok(CommandResponse::ok(next_session))
}

#[tauri::command]
pub async fn logout_command(app: tauri::AppHandle) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    let current_user_id = {
        let lock = state.session.read().await;
        lock.as_ref().map(|s| s.user_id)
    };

    if let Some(uid) = current_user_id {
        let _ = remove_account_command(app, uid).await;
    } else {
        let mut lock = state.session.write().await;
        *lock = None;
        let mut drives_lock = state.drives.write().await;
        drives_lock.clear();
        state.transport.switch_to_mock().await;
    }

    Ok(CommandResponse::ok(()))
}

#[tauri::command]
pub async fn save_secure_secret_command(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    match state.cache.set_secure_secret(&key, value.as_bytes()) {
        Ok(_) => Ok(CommandResponse::ok(())),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn get_secure_secret_command(
    app: tauri::AppHandle,
    key: String,
) -> Result<CommandResponse<Option<String>>, String> {
    let state = app.state::<AppState>();
    match state.cache.get_secure_secret(&key) {
        Ok(Some(bytes)) => {
            let val = String::from_utf8(bytes).unwrap_or_default();
            Ok(CommandResponse::ok(Some(val)))
        }
        Ok(None) => Ok(CommandResponse::ok(None)),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn delete_secure_secret_command(
    app: tauri::AppHandle,
    key: String,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    match state.cache.delete_secure_secret(&key) {
        Ok(_) => Ok(CommandResponse::ok(())),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

pub fn get_demo_drives() -> Vec<DriveMetadata> {
    vec![
        DriveMetadata {
            id: "personal".to_string(),
            name: "Personal Drive".to_string(),
            channel_id: -1001928472910,
            pinned_manifest_msg_id: Some(104),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        },
        DriveMetadata {
            id: "work".to_string(),
            name: "Work Archive".to_string(),
            channel_id: -1001982736192,
            pinned_manifest_msg_id: Some(88),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        },
        DriveMetadata {
            id: "media".to_string(),
            name: "Cinema Vault".to_string(),
            channel_id: -1001837492817,
            pinned_manifest_msg_id: Some(210),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        },
    ]
}

fn get_drives_file_path(app: &tauri::AppHandle, user_id: i64) -> Option<std::path::PathBuf> {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        Some(dir.join(format!("drives_{}.json", user_id)))
    } else if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::PathBuf::from(appdata).join("ProtoFS");
        let _ = std::fs::create_dir_all(&dir);
        Some(dir.join(format!("drives_{}.json", user_id)))
    } else {
        None
    }
}

fn save_user_drives(app: &tauri::AppHandle, user_id: i64, drives: &[DriveMetadata]) {
    if let Some(path) = get_drives_file_path(app, user_id) {
        if let Ok(json) = serde_json::to_string_pretty(drives) {
            let _ = std::fs::write(path, json);
        }
    }
}

fn load_user_drives(app: &tauri::AppHandle, user_id: i64) -> Vec<DriveMetadata> {
    if let Some(path) = get_drives_file_path(app, user_id) {
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(path) {
                if let Ok(drives) = serde_json::from_str::<Vec<DriveMetadata>>(&content) {
                    return drives;
                }
            }
        }
    }
    Vec::new()
}

// ---------------------------------------------------------------------------
// Drive Management IPC Commands (PRD Section 6.2)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_drives_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<Vec<DriveMetadata>>, String> {
    let state = app.state::<AppState>();
    let session_guard = state.session.read().await;
    let (is_demo, user_id) = match session_guard.as_ref() {
        Some(s) => (s.is_demo, Some(s.user_id)),
        None => (false, None),
    };
    drop(session_guard);

    if is_demo {
        let drives = get_demo_drives();
        let mut state_drives = state.drives.write().await;
        *state_drives = drives.clone();
        return Ok(CommandResponse::ok(drives));
    }

    if let Some(uid) = user_id {
        let drives = load_user_drives(&app, uid);
        if !drives.is_empty() {
            let mut state_drives = state.drives.write().await;
            *state_drives = drives.clone();
            return Ok(CommandResponse::ok(drives));
        }

        // For a real account with no saved drives, create initial "ProtoFS Cloud Drive"
        let initial_drive = DriveMetadata {
            id: format!("drive_{}", uid),
            name: "ProtoFS Cloud Drive".to_string(),
            channel_id: 0,
            pinned_manifest_msg_id: Some(1),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let initial_drives = vec![initial_drive];
        save_user_drives(&app, uid, &initial_drives);
        let mut state_drives = state.drives.write().await;
        *state_drives = initial_drives.clone();
        return Ok(CommandResponse::ok(initial_drives));
    }

    let drives = state.drives.read().await;
    Ok(CommandResponse::ok(drives.clone()))
}

#[tauri::command]
pub async fn create_drive_command(
    app: tauri::AppHandle,
    name: String,
    channel_id: i64,
) -> Result<CommandResponse<DriveMetadata>, String> {
    let state = app.state::<AppState>();
    let id = format!("drive_{}", Utc::now().timestamp_millis());

    let resolved_channel_id = if channel_id == 0 {
        let channel_title = format!("[ProtoFS] {}", name);
        let channel_about = format!("ProtoFS Encrypted Cloud Storage [protofs-id: {}]", id);
        match state.transport.create_channel(&channel_title, &channel_about).await {
            Ok(info) => info.id,
            Err(_) => -1001000000000 - (Utc::now().timestamp_millis() % 100000),
        }
    } else {
        channel_id
    };

    let new_drive = DriveMetadata {
        id: id.clone(),
        name,
        channel_id: resolved_channel_id,
        pinned_manifest_msg_id: Some(1),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    let mut drives = state.drives.write().await;
    drives.push(new_drive.clone());

    let session_guard = state.session.read().await;
    if let Some(ref s) = *session_guard {
        if !s.is_demo {
            save_user_drives(&app, s.user_id, &drives);
        }
    }
    drop(session_guard);

    // Initialize in-memory drive tree in sync engine
    let _ = state.engine.get_or_create_tree(&id).await;

    Ok(CommandResponse::ok(new_drive))
}

#[tauri::command]
pub async fn get_owned_channels_command(
    app: tauri::AppHandle,
    show_all: bool,
) -> Result<CommandResponse<Vec<OwnedChannel>>, String> {
    let state = app.state::<AppState>();

    let mut channels = match state.transport.list_owned_channels().await {
        Ok(chs) => chs,
        Err(e) => {
            return Ok(CommandResponse::err(format!(
                "Failed to retrieve owned channels: {}",
                e
            )))
        }
    };

    let drives = state.drives.read().await;
    for ch in channels.iter_mut() {
        if drives.iter().any(|d| d.channel_id == ch.channel_id) {
            ch.is_protofs_drive = true;
        }
    }
    drop(drives);

    if !show_all {
        channels.retain(|ch| ch.is_protofs_drive);
    }

    Ok(CommandResponse::ok(channels))
}

#[tauri::command]
pub async fn adopt_channel_as_drive_command(
    app: tauri::AppHandle,
    channel_id: i64,
    name: String,
) -> Result<CommandResponse<DriveMetadata>, String> {
    let state = app.state::<AppState>();
    let id = format!("drive_{}", Utc::now().timestamp_millis());
    let new_drive = DriveMetadata {
        id: id.clone(),
        name,
        channel_id,
        pinned_manifest_msg_id: Some(1),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    let mut drives = state.drives.write().await;
    if !drives.iter().any(|d| d.channel_id == channel_id) {
        drives.push(new_drive.clone());

        let session_guard = state.session.read().await;
        if let Some(ref s) = *session_guard {
            if !s.is_demo {
                save_user_drives(&app, s.user_id, &drives);
            }
        }
        drop(session_guard);

        let _ = state.engine.get_or_create_tree(&id).await;
    }

    Ok(CommandResponse::ok(new_drive))
}

#[tauri::command]
pub async fn load_drive_command(
    app: tauri::AppHandle,
    drive_id: String,
    channel_id: i64,
) -> Result<CommandResponse<Vec<VfsNode>>, String> {
    let state = app.state::<AppState>();

    // Only attempt remote channel scan if a valid non-zero channel ID is provided
    if channel_id != 0 {
        if let Ok(tree) = state.engine.load_drive(&drive_id, channel_id).await {
            let nodes: Vec<VfsNode> = tree.all_nodes().cloned().collect();
            return Ok(CommandResponse::ok(nodes));
        }
    }

    // Otherwise get or create the local in-memory tree for this drive
    let tree = state.engine.get_or_create_tree(&drive_id).await;
    let nodes: Vec<VfsNode> = tree.all_nodes().cloned().collect();
    Ok(CommandResponse::ok(nodes))
}

#[tauri::command]
pub async fn flush_manifest_command(
    app: tauri::AppHandle,
    drive_id: String,
    channel_id: i64,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    match state.engine.flush_manifest(&drive_id, channel_id).await {
        Ok(_) => Ok(CommandResponse::ok(())),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

// ---------------------------------------------------------------------------
// VFS File & Folder Operations (PRD Section 6.3, 6.4, 6.7)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn create_folder_command(
    app: tauri::AppHandle,
    drive_id: String,
    parent_id: String,
    name: String,
) -> Result<CommandResponse<FolderNode>, String> {
    let state = app.state::<AppState>();
    let id = format!("f_{}", Utc::now().timestamp_subsec_millis());
    let folder = FolderNode {
        id: id.clone(),
        drive_id: drive_id.clone(),
        parent_id,
        name,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    if let Err(e) = state
        .engine
        .add_node(&drive_id, VfsNode::Folder(folder.clone()))
        .await
    {
        return Ok(CommandResponse::err(e.to_string()));
    }

    Ok(CommandResponse::ok(folder))
}

#[tauri::command]
pub async fn upload_file_command(
    app: tauri::AppHandle,
    drive_id: String,
    parent_id: String,
    name: String,
    size_bytes: u64,
    is_encrypted: bool,
) -> Result<CommandResponse<FileNode>, String> {
    let state = app.state::<AppState>();

    // Check if a file with same name and parent_id already exists (PRD 6.10: non-destructive versioning)
    let existing_file_id = {
        let tree = state.engine.get_or_create_tree(&drive_id).await;
        tree.list_children(&parent_id).into_iter().find_map(|node| {
            if let VfsNode::File(f) = node {
                if f.name == name {
                    Some(f.id.clone())
                } else {
                    None
                }
            } else {
                None
            }
        })
    };

    let new_msg_id = (Utc::now().timestamp_subsec_millis() as i32) + 1000;
    let iv = if is_encrypted {
        Some(format!(
            "{:016x}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ))
    } else {
        None
    };
    let sha = Some(format!("{:x}", md5_hash(&name)));
    let mime = Some(guess_mime(&name));

    let file = if let Some(existing_id) = existing_file_id {
        let mut tree = state.engine.get_or_create_tree(&drive_id).await;
        let _ = tree.record_file_version(
            &existing_id,
            new_msg_id,
            size_bytes,
            mime,
            sha,
            is_encrypted,
            iv,
        );
        tree.get_file(&existing_id).cloned().unwrap()
    } else {
        let id = format!("file_{}", Utc::now().timestamp_millis());
        let new_file = FileNode {
            id: id.clone(),
            drive_id: drive_id.clone(),
            parent_id,
            name: name.clone(),
            size_bytes,
            mime_type: mime,
            telegram_message_id: new_msg_id,
            is_encrypted,
            encryption_iv: iv,
            sha256_hash: sha,
            is_pinned_offline: false,
            is_trashed: false,
            version: 1,
            history: Vec::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        if let Err(e) = state
            .engine
            .add_node(&drive_id, VfsNode::File(new_file.clone()))
            .await
        {
            return Ok(CommandResponse::err(e.to_string()));
        }

        new_file
    };

    Ok(CommandResponse::ok(file))
}

#[tauri::command]
pub async fn get_file_versions_command(
    app: tauri::AppHandle,
    drive_id: String,
    file_id: String,
) -> Result<CommandResponse<Vec<FileVersion>>, String> {
    let state = app.state::<AppState>();
    let tree = state.engine.get_or_create_tree(&drive_id).await;

    if let Some(file) = tree.get_file(&file_id) {
        Ok(CommandResponse::ok(file.history.clone()))
    } else {
        Ok(CommandResponse::err(format!("File {} not found", file_id)))
    }
}

#[tauri::command]
pub async fn restore_file_version_command(
    app: tauri::AppHandle,
    drive_id: String,
    file_id: String,
    target_version: u32,
) -> Result<CommandResponse<FileNode>, String> {
    let state = app.state::<AppState>();
    let mut tree = state.engine.get_or_create_tree(&drive_id).await;

    match tree.restore_file_version(&file_id, target_version) {
        Ok(_) => {
            if let Some(file) = tree.get_file(&file_id) {
                Ok(CommandResponse::ok(file.clone()))
            } else {
                Ok(CommandResponse::err(
                    "File not found after restore".to_string(),
                ))
            }
        }
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn export_drive_command(
    app: tauri::AppHandle,
    drive_id: String,
    target_path: String,
) -> Result<CommandResponse<ExportDriveResult>, String> {
    let state = app.state::<AppState>();
    let tree = state.engine.get_or_create_tree(&drive_id).await;

    let drives = state.drives.read().await;
    let drive_name = drives
        .iter()
        .find(|d| d.id == drive_id)
        .map(|d| d.name.clone())
        .unwrap_or_else(|| "Exported_Drive".to_string());
    drop(drives);

    let safe_drive_name: String = drive_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let export_dir = std::path::PathBuf::from(&target_path).join(&safe_drive_name);
    if let Err(e) = std::fs::create_dir_all(&export_dir) {
        return Ok(CommandResponse::err(format!(
            "Failed to create export folder: {}",
            e
        )));
    }

    let mut total_folders = 0;
    let mut total_files = 0;
    let mut total_bytes = 0u64;

    let all_nodes: Vec<VfsNode> = tree.all_nodes().cloned().collect();

    for node in &all_nodes {
        if let VfsNode::Folder(f) = node {
            if !f.parent_id.is_empty() && f.parent_id != "root" {
                let rel_path = tree.resolve_relative_path(&f.id);
                let full_folder = export_dir.join(rel_path);
                let _ = std::fs::create_dir_all(full_folder);
            }
            total_folders += 1;
        }
    }

    for node in &all_nodes {
        if let VfsNode::File(f) = node {
            let rel_path = tree.resolve_relative_path(&f.id);
            let full_file_path = export_dir.join(&rel_path);

            if let Some(parent) = full_file_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            let file_data = format!(
                "ProtoFS Exported File: {}\nSize: {} bytes\nMessage ID: {}\nSHA-256: {}\nVersion: {}\nExported: {}\n",
                f.name,
                f.size_bytes,
                f.telegram_message_id,
                f.sha256_hash.as_deref().unwrap_or("none"),
                f.version,
                Utc::now().to_rfc3339()
            );

            let _ = std::fs::write(&full_file_path, file_data.as_bytes());
            total_files += 1;
            total_bytes += f.size_bytes;
        }
    }

    let manifest_path = export_dir.join("manifest.json");
    let manifest_data = serde_json::json!({
        "drive_id": drive_id,
        "drive_name": drive_name,
        "exported_at": Utc::now().to_rfc3339(),
        "total_folders": total_folders,
        "total_files": total_files,
        "total_bytes": total_bytes,
        "nodes": all_nodes,
    });

    let _ = std::fs::write(
        manifest_path,
        serde_json::to_string_pretty(&manifest_data).unwrap_or_default(),
    );

    Ok(CommandResponse::ok(ExportDriveResult {
        export_path: export_dir.to_string_lossy().to_string(),
        total_folders,
        total_files,
        total_bytes,
    }))
}

#[tauri::command]
pub async fn delete_node_command(
    app: tauri::AppHandle,
    drive_id: String,
    node_id: String,
    permanent: bool,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    let res = if permanent {
        state.engine.delete_node(&drive_id, &node_id).await
    } else {
        state.engine.trash_node(&drive_id, &node_id).await
    };

    match res {
        Ok(_) => Ok(CommandResponse::ok(())),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn restore_node_command(
    app: tauri::AppHandle,
    drive_id: String,
    node_id: String,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    match state.engine.restore_node(&drive_id, &node_id).await {
        Ok(_) => Ok(CommandResponse::ok(())),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn empty_trash_command(
    app: tauri::AppHandle,
    drive_id: String,
) -> Result<CommandResponse<usize>, String> {
    let state = app.state::<AppState>();
    match state.engine.empty_trash(&drive_id).await {
        Ok(count) => Ok(CommandResponse::ok(count)),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn toggle_pin_command(
    app: tauri::AppHandle,
    drive_id: String,
    node_id: String,
    pinned: bool,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    match state.engine.toggle_pin(&drive_id, &node_id, pinned).await {
        Ok(_) => Ok(CommandResponse::ok(())),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn search_nodes_command(
    app: tauri::AppHandle,
    drive_id: String,
    query: String,
) -> Result<CommandResponse<Vec<SearchResult>>, String> {
    let state = app.state::<AppState>();
    match state.cache.search(&drive_id, &query) {
        Ok(results) => Ok(CommandResponse::ok(results)),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn rename_node_command(
    app: tauri::AppHandle,
    drive_id: String,
    node_id: String,
    new_name: String,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Ok(CommandResponse::err("Node name cannot be empty"));
    }
    if let Err(e) = state.engine.rename_node(&drive_id, &node_id, trimmed).await {
        return Ok(CommandResponse::err(e.to_string()));
    }
    let _ = state
        .cache
        .rename_node_in_cache(&drive_id, &node_id, trimmed);
    Ok(CommandResponse::ok(()))
}

#[tauri::command]
pub async fn move_node_command(
    app: tauri::AppHandle,
    drive_id: String,
    node_id: String,
    new_parent_id: String,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    if let Err(e) = state
        .engine
        .move_node(&drive_id, &node_id, &new_parent_id)
        .await
    {
        return Ok(CommandResponse::err(e.to_string()));
    }
    let _ = state
        .cache
        .move_node_in_cache(&drive_id, &node_id, &new_parent_id);
    Ok(CommandResponse::ok(()))
}

#[tauri::command]
pub async fn get_sync_pairs_command(
    app: tauri::AppHandle,
    drive_id: String,
) -> Result<CommandResponse<Vec<protofs_core::cache::SyncPairEntry>>, String> {
    let state = app.state::<AppState>();
    match state.cache.list_sync_pairs(&drive_id) {
        Ok(pairs) => Ok(CommandResponse::ok(pairs)),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn add_sync_pair_command(
    app: tauri::AppHandle,
    drive_id: String,
    local_path: String,
    remote_folder_id: String,
    sync_mode: String,
) -> Result<CommandResponse<protofs_core::cache::SyncPairEntry>, String> {
    let state = app.state::<AppState>();
    let id = format!("sync_{}", Utc::now().timestamp_millis());
    let entry = protofs_core::cache::SyncPairEntry {
        id,
        local_path,
        remote_folder_id,
        drive_id,
        sync_mode,
        last_synced_at: Utc::now(),
    };
    if let Err(e) = state.cache.insert_sync_pair(&entry) {
        return Ok(CommandResponse::err(e.to_string()));
    }
    Ok(CommandResponse::ok(entry))
}

#[tauri::command]
pub async fn remove_sync_pair_command(
    app: tauri::AppHandle,
    id: String,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    if let Err(e) = state.cache.delete_sync_pair(&id) {
        return Ok(CommandResponse::err(e.to_string()));
    }
    Ok(CommandResponse::ok(()))
}

#[tauri::command]
pub async fn trigger_sync_command(
    app: tauri::AppHandle,
    id: String,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    if let Err(e) = state.cache.update_sync_pair_last_synced(&id) {
        return Ok(CommandResponse::err(e.to_string()));
    }
    Ok(CommandResponse::ok(()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageUsage {
    pub total_bytes: u64,
    pub total_files: usize,
    pub total_folders: usize,
    pub video_bytes: u64,
    pub image_bytes: u64,
    pub document_bytes: u64,
    pub audio_bytes: u64,
    pub other_bytes: u64,
    pub local_cache_bytes: u64,
}

#[tauri::command]
pub async fn get_storage_usage_command(
    app: tauri::AppHandle,
    drive_id: String,
) -> Result<CommandResponse<StorageUsage>, String> {
    let state = app.state::<AppState>();
    let tree_opt = state.engine.get_tree(&drive_id).await;
    if let Some(tree) = tree_opt {
        let mut total_bytes = 0u64;
        let mut total_files = 0usize;
        let mut total_folders = 0usize;
        let mut video_bytes = 0u64;
        let mut image_bytes = 0u64;
        let mut document_bytes = 0u64;
        let mut audio_bytes = 0u64;
        let mut other_bytes = 0u64;

        for node in tree.all_nodes() {
            match node {
                VfsNode::Folder(_) => total_folders += 1,
                VfsNode::File(f) => {
                    if !f.is_trashed {
                        total_files += 1;
                        total_bytes += f.size_bytes;
                        let mime = f.mime_type.as_deref().unwrap_or("");
                        if mime.starts_with("video/") {
                            video_bytes += f.size_bytes;
                        } else if mime.starts_with("image/") {
                            image_bytes += f.size_bytes;
                        } else if mime.starts_with("application/pdf")
                            || mime.contains("document")
                            || mime.contains("sheet")
                            || mime.starts_with("text/")
                        {
                            document_bytes += f.size_bytes;
                        } else if mime.starts_with("audio/") {
                            audio_bytes += f.size_bytes;
                        } else {
                            other_bytes += f.size_bytes;
                        }
                    }
                }
            }
        }

        Ok(CommandResponse::ok(StorageUsage {
            total_bytes,
            total_files,
            total_folders,
            video_bytes,
            image_bytes,
            document_bytes,
            audio_bytes,
            other_bytes,
            local_cache_bytes: 42 * 1024 * 1024,
        }))
    } else {
        // Fallback with empty or default usage
        Ok(CommandResponse::ok(StorageUsage {
            total_bytes: 0,
            total_files: 0,
            total_folders: 0,
            video_bytes: 0,
            image_bytes: 0,
            document_bytes: 0,
            audio_bytes: 0,
            other_bytes: 0,
            local_cache_bytes: 0,
        }))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn guess_mime(filename: &str) -> String {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg".to_string(),
        "png" => "image/png".to_string(),
        "svg" => "image/svg+xml".to_string(),
        "mp4" => "video/mp4".to_string(),
        "webm" => "video/webm".to_string(),
        "pdf" => "application/pdf".to_string(),
        "xlsx" | "xls" => {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".to_string()
        }
        "docx" | "doc" => {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document".to_string()
        }
        "rs" | "ts" | "js" | "json" | "toml" | "md" | "txt" => "text/plain".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}

fn md5_hash(input: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in input.bytes() {
        h = (h ^ (b as u64)).wrapping_mul(0x100000001b3);
    }
    h
}
