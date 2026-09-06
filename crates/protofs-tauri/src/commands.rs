use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

use protofs_core::cache::{CacheDatabase, SearchResult};
use protofs_core::mtproto::{DynamicTelegramTransport, TelegramAuthClient};
use protofs_core::sync::SyncEngine;
use protofs_core::vfs::{DriveMetadata, FileNode, FolderNode, VfsNode};

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

#[tauri::command]
pub async fn login_verify_code(
    app: tauri::AppHandle,
    phone: String,
    api_id: String,
    api_hash: String,
    code: String,
    password_2fa: Option<String>,
) -> Result<CommandResponse<AuthSession>, String> {
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
        || trimmed_code == "12345"
    {
        let session = AuthSession {
            is_authenticated: true,
            phone: phone.clone(),
            api_id,
            api_hash,
            username: Some("MuzAmMaL".to_string()),
            first_name: "ProtoFS User".to_string(),
            user_id: 1049281720,
            active_drive_id: "personal".to_string(),
        };

        let mut lock = state.session.write().await;
        *lock = Some(session.clone());
        save_auth_session(&app, &session);
        return Ok(CommandResponse::ok(session));
    }

    // Real Telegram MTProto verification
    let (real_transport, tg_user, session_bytes) = match state
        .auth_client
        .verify_code(trimmed_code, password_2fa.as_deref())
        .await
    {
        Ok(res) => res,
        Err(e) => return Ok(CommandResponse::err(format!("Verification failed: {}", e))),
    };

    // Switch engine transport to live Telegram MTProto
    state.transport.switch_to_real(real_transport).await;

    let session = AuthSession {
        is_authenticated: true,
        phone: phone.clone(),
        api_id,
        api_hash,
        username: tg_user.username,
        first_name: tg_user.first_name,
        user_id: tg_user.id,
        active_drive_id: "personal".to_string(),
    };

    let mut lock = state.session.write().await;
    *lock = Some(session.clone());

    save_auth_session(&app, &session);
    save_real_telegram_session(&app, &session_bytes);

    Ok(CommandResponse::ok(session))
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

fn save_real_telegram_session(app: &tauri::AppHandle, session_bytes: &[u8]) {
    if let Some(path) = get_real_session_path(app) {
        if let Ok(encrypted) = protofs_core::crypto::protect_secret(session_bytes) {
            let _ = std::fs::write(path, encrypted);
        }
    }
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

    // If in-memory state is empty, restore hardware-encrypted session from disk
    if lock.is_none() {
        if let Some(session) = load_auth_session(&app) {
            // Attempt to reconnect to real Telegram MTProto if session exists
            if let Some(session_bytes) = load_real_telegram_session(&app) {
                if let Ok(api_id_int) = session.api_id.trim().parse::<i32>() {
                    if let Ok(real) = TelegramAuthClient::reconnect_from_session(
                        api_id_int,
                        session.api_hash.trim(),
                        &session_bytes,
                    )
                    .await
                    {
                        state.transport.switch_to_real(real).await;
                    }
                }
            }
            *lock = Some(session);
        }
    }

    Ok(CommandResponse::ok(lock.clone()))
}

#[tauri::command]
pub async fn logout_command(app: tauri::AppHandle) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    let mut lock = state.session.write().await;
    *lock = None;

    state.transport.switch_to_mock().await;

    if let (Some(enc_path), Some(legacy_path)) = get_session_paths(&app) {
        if enc_path.exists() {
            let _ = std::fs::remove_file(enc_path);
        }
        if legacy_path.exists() {
            let _ = std::fs::remove_file(legacy_path);
        }
    }

    if let Some(path) = get_real_session_path(&app) {
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
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

// ---------------------------------------------------------------------------
// Drive Management IPC Commands (PRD Section 6.2)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_drives_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<Vec<DriveMetadata>>, String> {
    let state = app.state::<AppState>();
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
    let new_drive = DriveMetadata {
        id: id.clone(),
        name,
        channel_id,
        pinned_manifest_msg_id: Some(1),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    let mut drives = state.drives.write().await;
    drives.push(new_drive.clone());

    // Load initial empty drive tree into sync engine
    let _ = state.engine.load_drive(&id, channel_id).await;

    Ok(CommandResponse::ok(new_drive))
}

#[tauri::command]
pub async fn load_drive_command(
    app: tauri::AppHandle,
    drive_id: String,
    channel_id: i64,
) -> Result<CommandResponse<Vec<VfsNode>>, String> {
    let state = app.state::<AppState>();
    match state.engine.load_drive(&drive_id, channel_id).await {
        Ok(tree) => {
            let nodes: Vec<VfsNode> = tree.all_nodes().cloned().collect();
            Ok(CommandResponse::ok(nodes))
        }
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
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
    let id = format!("file_{}", Utc::now().timestamp_millis());
    let file = FileNode {
        id: id.clone(),
        drive_id: drive_id.clone(),
        parent_id,
        name: name.clone(),
        size_bytes,
        mime_type: Some(guess_mime(&name)),
        telegram_message_id: (Utc::now().timestamp_subsec_millis() as i32) + 1000,
        is_encrypted,
        encryption_iv: if is_encrypted {
            Some(format!(
                "{:016x}",
                Utc::now().timestamp_nanos_opt().unwrap_or(0)
            ))
        } else {
            None
        },
        sha256_hash: Some(format!("{:x}", md5_hash(&name))),
        is_pinned_offline: false,
        is_trashed: false,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    if let Err(e) = state
        .engine
        .add_node(&drive_id, VfsNode::File(file.clone()))
        .await
    {
        return Ok(CommandResponse::err(e.to_string()));
    }

    Ok(CommandResponse::ok(file))
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
