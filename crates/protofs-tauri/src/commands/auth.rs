use chrono::Utc;
use tauri::Manager;

use protofs_core::mtproto::{
    QrCheckOutcome, RealTelegramTransport, TelegramAuthClient, TelegramUser, VerifyOutcome,
};

use super::drives::{get_drives_file_path, load_user_drives, save_user_drives};
use super::{
    AccountRegistry, AppState, AuthResponse, AuthSession, CommandResponse, QrStatusResponse,
    ensure_dir,
};

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

    let api_id_int: i32 = match api_id.trim().parse() {
        Ok(val) => val,
        Err(_) => {
            return Ok(CommandResponse::err(
                "API ID must be a numeric integer from my.telegram.org",
            ));
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
pub async fn finalize_login(
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

    let session = AuthSession {
        is_authenticated: true,
        phone: phone.unwrap_or_else(|| "+Telegram User".to_string()),
        api_id,
        api_hash,
        username: tg_user.username,
        first_name: tg_user.first_name,
        user_id: tg_user.id,
        active_drive_id: String::new(),
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

    let user_drives = load_user_drives(app, tg_user.id)
        .into_iter()
        .filter(|d| !(d.channel_id == 0 && d.name == "ProtoFS Cloud Drive"))
        .collect::<Vec<_>>();
    save_user_drives(app, tg_user.id, &user_drives);

    let mut drives_lock = state.drives.write().await;
    *drives_lock = user_drives;
    drop(drives_lock);

    let mut lock = state.session.write().await;
    *lock = Some(session.clone());

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

pub fn get_accounts_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let base_dir = if let Ok(dir) = app.path().app_data_dir() {
        ensure_dir(&dir);
        Some(dir)
    } else if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::PathBuf::from(appdata).join("ProtoFS");
        ensure_dir(&dir);
        Some(dir)
    } else {
        None
    };

    base_dir.map(|d| d.join("accounts.enc"))
}

pub fn get_user_session_path(app: &tauri::AppHandle, user_id: i64) -> Option<std::path::PathBuf> {
    let base_dir = if let Ok(dir) = app.path().app_data_dir() {
        ensure_dir(&dir);
        Some(dir)
    } else if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::PathBuf::from(appdata).join("ProtoFS");
        ensure_dir(&dir);
        Some(dir)
    } else {
        None
    };

    base_dir.map(|d| d.join(format!("telegram_session_{}.enc", user_id)))
}

pub fn get_session_paths(
    app: &tauri::AppHandle,
) -> (Option<std::path::PathBuf>, Option<std::path::PathBuf>) {
    let base_dir = if let Ok(dir) = app.path().app_data_dir() {
        ensure_dir(&dir);
        Some(dir)
    } else if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::PathBuf::from(appdata).join("ProtoFS");
        ensure_dir(&dir);
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

pub fn get_real_session_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let base_dir = if let Ok(dir) = app.path().app_data_dir() {
        ensure_dir(&dir);
        Some(dir)
    } else if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::PathBuf::from(appdata).join("ProtoFS");
        ensure_dir(&dir);
        Some(dir)
    } else {
        None
    };

    base_dir.map(|d| d.join("telegram_session.enc"))
}

pub fn save_auth_session(app: &tauri::AppHandle, session: &AuthSession) {
    if let (Some(enc_path), Some(legacy_path)) = get_session_paths(app)
        && let Ok(json) = serde_json::to_string(session)
        && let Ok(encrypted) = protofs_core::crypto::protect_secret(json.as_bytes())
    {
        if let Err(e) = std::fs::write(&enc_path, encrypted) {
            tracing::error!("Failed to write encrypted session: {}", e);
        }
        if legacy_path.exists() {
            let _ = std::fs::remove_file(&legacy_path);
        }
    }
}

pub fn save_real_telegram_session_for_user(
    app: &tauri::AppHandle,
    user_id: i64,
    session_bytes: &[u8],
) {
    if let Some(path) = get_user_session_path(app, user_id)
        && let Ok(encrypted) = protofs_core::crypto::protect_secret(session_bytes)
        && let Err(e) = std::fs::write(&path, encrypted)
    {
        tracing::error!("Failed to save session for user {}: {}", user_id, e);
    }
    // Also save to legacy path for backward compatibility
    if let Some(path) = get_real_session_path(app)
        && let Ok(encrypted) = protofs_core::crypto::protect_secret(session_bytes)
        && let Err(e) = std::fs::write(&path, encrypted)
    {
        tracing::error!("Failed to save legacy session: {}", e);
    }
}

pub fn load_real_telegram_session_for_user(
    app: &tauri::AppHandle,
    user_id: i64,
) -> Option<Vec<u8>> {
    if let Some(path) = get_user_session_path(app, user_id)
        && path.exists()
        && let Ok(encrypted_bytes) = std::fs::read(&path)
        && let Ok(decrypted) = protofs_core::crypto::unprotect_secret(&encrypted_bytes)
    {
        return Some(decrypted);
    }
    load_real_telegram_session(app)
}

pub fn save_account_registry(app: &tauri::AppHandle, registry: &AccountRegistry) {
    if let Some(path) = get_accounts_path(app)
        && let Ok(json) = serde_json::to_string(registry)
        && let Ok(encrypted) = protofs_core::crypto::protect_secret(json.as_bytes())
        && let Err(e) = std::fs::write(&path, encrypted)
    {
        tracing::error!("Failed to save account registry: {}", e);
    }
}

pub fn load_account_registry(app: &tauri::AppHandle) -> AccountRegistry {
    if let Some(path) = get_accounts_path(app)
        && path.exists()
        && let Ok(encrypted_bytes) = std::fs::read(&path)
        && let Ok(decrypted_bytes) = protofs_core::crypto::unprotect_secret(&encrypted_bytes)
        && let Ok(registry) = serde_json::from_slice::<AccountRegistry>(&decrypted_bytes)
    {
        return registry;
    }

    // Migration from legacy single-session storage
    if let Some(legacy_session) = load_auth_session(app) {
        let user_id = legacy_session.user_id;
        if let (Some(legacy_tg), Some(new_tg)) = (
            get_real_session_path(app),
            get_user_session_path(app, user_id),
        ) && legacy_tg.exists()
            && !new_tg.exists()
        {
            let _ = std::fs::copy(&legacy_tg, &new_tg);
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

pub fn load_auth_session(app: &tauri::AppHandle) -> Option<AuthSession> {
    if let (Some(enc_path), Some(legacy_path)) = get_session_paths(app) {
        if enc_path.exists() {
            if let Ok(encrypted_bytes) = std::fs::read(&enc_path)
                && let Ok(decrypted_bytes) =
                    protofs_core::crypto::unprotect_secret(&encrypted_bytes)
                && let Ok(persisted) = serde_json::from_slice::<AuthSession>(&decrypted_bytes)
            {
                return Some(persisted);
            }
        } else if legacy_path.exists()
            && let Ok(content) = std::fs::read_to_string(&legacy_path)
            && let Ok(persisted) = serde_json::from_str::<AuthSession>(&content)
        {
            if let Ok(encrypted) = protofs_core::crypto::protect_secret(content.as_bytes()) {
                let _ = std::fs::write(&enc_path, encrypted);
                let _ = std::fs::remove_file(&legacy_path);
            }
            return Some(persisted);
        }
    }
    None
}

pub fn load_real_telegram_session(app: &tauri::AppHandle) -> Option<Vec<u8>> {
    if let Some(path) = get_real_session_path(app)
        && path.exists()
        && let Ok(encrypted_bytes) = std::fs::read(&path)
        && let Ok(decrypted) = protofs_core::crypto::unprotect_secret(&encrypted_bytes)
    {
        return Some(decrypted);
    }
    None
}

#[tauri::command]
pub async fn get_session_status(
    app: tauri::AppHandle,
) -> Result<CommandResponse<Option<AuthSession>>, String> {
    let state = app.state::<AppState>();

    // Check if session is already populated
    {
        let lock = state.session.read().await;
        if lock.is_some() {
            return Ok(CommandResponse::ok(lock.clone()));
        }
    }

    // Session is empty — restore from registry outside the lock
    let registry = load_account_registry(&app);
    if let Some(active_id) = registry.active_user_id
        && let Some(account) = registry
            .accounts
            .iter()
            .find(|a| a.user_id == active_id)
            .cloned()
    {
        if let Some(session_bytes) = load_real_telegram_session_for_user(&app, active_id)
            && let Ok(api_id_int) = account.api_id.trim().parse::<i32>()
            && let Ok(real) = TelegramAuthClient::reconnect_from_session(
                api_id_int,
                account.api_hash.trim(),
                &session_bytes,
            )
            .await
        {
            state.transport.switch_to_real(real).await;
        }
        let user_drives = load_user_drives(&app, account.user_id);
        *state.drives.write().await = user_drives;
        *state.session.write().await = Some(account);
    }

    let lock = state.session.read().await;
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

    let target_account = match registry
        .accounts
        .iter()
        .find(|a| a.user_id == user_id)
        .cloned()
    {
        Some(account) => account,
        None => {
            return Ok(CommandResponse::err(
                "Account not found in registered accounts".to_string(),
            ));
        }
    };

    registry.active_user_id = Some(user_id);
    save_account_registry(&app, &registry);

    if let Some(session_bytes) = load_real_telegram_session_for_user(&app, user_id)
        && let Ok(api_id_int) = target_account.api_id.trim().parse::<i32>()
        && let Ok(real) = TelegramAuthClient::reconnect_from_session(
            api_id_int,
            target_account.api_hash.trim(),
            &session_bytes,
        )
        .await
    {
        state.transport.switch_to_real(real).await;
    }
    let mut drives_lock = state.drives.write().await;
    *drives_lock = load_user_drives(&app, user_id);

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
    if let Some(path) = get_user_session_path(&app, user_id)
        && path.exists()
    {
        let _ = std::fs::remove_file(&path);
    }
    if let Some(path) = get_drives_file_path(&app, user_id)
        && path.exists()
    {
        let _ = std::fs::remove_file(&path);
    }

    let was_active = registry.active_user_id == Some(user_id);
    let next_session = if was_active {
        if let Some(next_acc) = registry.accounts.first().cloned() {
            registry.active_user_id = Some(next_acc.user_id);
            save_account_registry(&app, &registry);

            if let Some(session_bytes) = load_real_telegram_session_for_user(&app, next_acc.user_id)
                && let Ok(api_id_int) = next_acc.api_id.trim().parse::<i32>()
                && let Ok(real) = TelegramAuthClient::reconnect_from_session(
                    api_id_int,
                    next_acc.api_hash.trim(),
                    &session_bytes,
                )
                .await
            {
                state.transport.switch_to_real(real).await;
            }
            let mut drives_lock = state.drives.write().await;
            *drives_lock = load_user_drives(&app, next_acc.user_id);

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

            if let (Some(enc_path), Some(legacy_path)) = get_session_paths(&app) {
                if enc_path.exists() {
                    let _ = std::fs::remove_file(&enc_path);
                }
                if legacy_path.exists() {
                    let _ = std::fs::remove_file(&legacy_path);
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
    }

    Ok(CommandResponse::ok(()))
}
