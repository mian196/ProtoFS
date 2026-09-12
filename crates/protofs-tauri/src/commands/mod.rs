pub mod auth;
pub mod drives;
pub mod native;
pub mod settings;
pub mod sharing;
pub mod sync;
pub mod transfers;
pub mod vfs;

pub use auth::*;
pub use drives::*;
pub use native::*;
pub use settings::*;
pub use sharing::*;
pub use sync::*;
pub use transfers::*;
pub use vfs::*;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

use protofs_core::cache::CacheDatabase;
use protofs_core::mtproto::{DynamicTelegramTransport, TelegramAuthClient};
use protofs_core::sync::SyncEngine;
use protofs_core::vfs::DriveMetadata;

pub const LOCAL_CACHE_BYTES: u64 = 42 * 1024 * 1024;
pub const P2P_TRANSFER_HISTORY_LIMIT: usize = 20;

pub fn ensure_dir(path: &std::path::Path) {
    if let Err(e) = std::fs::create_dir_all(path) {
        tracing::warn!("Failed to create directory {}: {}", path.display(), e);
    }
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Creates a std::process::Command configured on Windows with CREATE_NO_WINDOW
/// (0x08000000) so no console window flashes or pops up for child processes.
pub fn silent_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportDriveResult {
    pub export_path: String,
    pub total_folders: usize,
    pub total_files: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareLinkInfo {
    pub file_id: String,
    pub file_name: String,
    pub drive_id: String,
    pub drive_name: String,
    pub channel_id: i64,
    pub telegram_message_id: i32,
    pub size_bytes: u64,
    pub mime_type: Option<String>,
    pub is_encrypted: bool,
    pub telegram_message_link: String,
    pub telegram_web_link: String,
    pub protofs_app_link: String,
    pub channel_invite_url: Option<String>,
    pub zero_knowledge_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedShareLink {
    pub is_valid: bool,
    pub drive_id: Option<String>,
    pub file_id: Option<String>,
    pub channel_id: Option<i64>,
    pub telegram_message_id: Option<i32>,
    pub name: String,
    pub size_bytes: u64,
    pub is_encrypted: bool,
    pub encryption_key: Option<String>,
    pub original_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualDriveStatus {
    pub is_mounted: bool,
    pub drive_id: String,
    pub drive_letter: String,
    pub mount_path: String,
    pub driver_mode: String,
    pub winfsp_available: bool,
    pub webdav_available: bool,
    pub webdav_url: String,
    pub available_letters: Vec<String>,
    pub cached_files_count: usize,
    pub cached_bytes: u64,
    pub last_mounted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDavServerStatus {
    pub is_running: bool,
    pub port: u16,
    pub url: String,
    pub auto_mount: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentsProviderStatus {
    pub is_enabled: bool,
    pub authority: String,
    pub root_count: usize,
    pub active_drive_id: String,
    pub saf_uri: String,
    pub cached_documents_count: usize,
    pub is_android: bool,
    pub last_sync_timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafTestQueryResult {
    pub authority: String,
    pub document_id: String,
    pub display_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub flags: Vec<String>,
    pub child_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_notes: String,
    pub release_date: String,
    pub download_url: String,
    pub signature_verified: bool,
    pub channel: String,
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
    pub webdav_server: Arc<RwLock<protofs_core::webdav::WebDavServer<DynamicTelegramTransport>>>,
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

pub fn guess_mime(filename: &str) -> String {
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

pub fn fnv1a_hash_filename(input: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in input.bytes() {
        h = (h ^ (b as u64)).wrapping_mul(0x100000001b3);
    }
    h
}
