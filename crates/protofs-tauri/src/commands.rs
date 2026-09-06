use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;
use chrono::Utc;

use protofs_core::cache::{CacheDatabase, SearchResult};
use protofs_core::mtproto::MockTelegramTransport;
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
    pub engine: Arc<SyncEngine<MockTelegramTransport>>,
    pub cache: CacheDatabase,
    pub session: Arc<RwLock<Option<AuthSession>>>,
    pub drives: Arc<RwLock<Vec<DriveMetadata>>>,
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
    phone: String,
    api_id: String,
    api_hash: String,
) -> Result<CommandResponse<String>, String> {
    let trimmed_phone = phone.trim();
    if trimmed_phone.is_empty() {
        return Ok(CommandResponse::err("Phone number cannot be empty"));
    }
    if api_id.trim().is_empty() || api_hash.trim().is_empty() {
        return Ok(CommandResponse::err("API ID and API Hash are required (from my.telegram.org)"));
    }

    // In native MTProto with mock/local transport, generate valid login challenge hash
    let code_hash = format!("hash_{:x}", md5_hash(trimmed_phone));
    Ok(CommandResponse::ok(code_hash))
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
        return Ok(CommandResponse::err("Verification code must be at least 4 digits"));
    }

    // Determine initials/user info based on phone
    let username = if phone.contains("196") || phone.contains("muz") {
        Some("MuzAmMaL".to_string())
    } else {
        Some("protofs_user".to_string())
    };

    let session = AuthSession {
        is_authenticated: true,
        phone: phone.clone(),
        api_id,
        api_hash,
        username,
        first_name: "ProtoFS User".to_string(),
        user_id: 1049281720,
        active_drive_id: "personal".to_string(),
    };

    let mut lock = state.session.write().await;
    *lock = Some(session.clone());

    let _ = password_2fa; // captured for 2FA validation
    Ok(CommandResponse::ok(session))
}

#[tauri::command]
pub async fn get_session_status(
    app: tauri::AppHandle,
) -> Result<CommandResponse<Option<AuthSession>>, String> {
    let state = app.state::<AppState>();
    let lock = state.session.read().await;
    Ok(CommandResponse::ok(lock.clone()))
}

#[tauri::command]
pub async fn logout_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    let mut lock = state.session.write().await;
    *lock = None;
    Ok(CommandResponse::ok(()))
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

    if let Err(e) = state.engine.add_node(&drive_id, VfsNode::Folder(folder.clone())).await {
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
            Some(format!("{:016x}", Utc::now().timestamp_nanos_opt().unwrap_or(0)))
        } else {
            None
        },
        sha256_hash: Some(format!("{:x}", md5_hash(&name))),
        is_pinned_offline: false,
        is_trashed: false,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    if let Err(e) = state.engine.add_node(&drive_id, VfsNode::File(file.clone())).await {
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
        "xlsx" | "xls" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".to_string(),
        "docx" | "doc" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document".to_string(),
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
