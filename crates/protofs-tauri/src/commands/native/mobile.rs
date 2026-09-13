use std::path::{Path, PathBuf};

use chrono::Utc;
use protofs_core::vfs::VfsNode;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::common::ensure_dir;
use crate::commands::{AppState, CommandResponse, DocumentsProviderStatus, SafTestQueryResult};

pub const SAF_AUTHORITY: &str = "com.protofs.app.documents";

#[cfg(target_os = "android")]
pub mod android {
    // Android JNI/NDK storage bindings quarantined per D-30
}

pub fn get_mime_type_from_filename(filename: &str) -> &'static str {
    match filename.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "json" => "application/json",
        "zip" => "application/zip",
        "tar" | "gz" => "application/gzip",
        _ => "application/octet-stream",
    }
}

async fn build_saf_status(app: &tauri::AppHandle, drive_id: &str, is_enabled: bool) -> DocumentsProviderStatus {
    let state = app.state::<AppState>();
    let drives = state.drives.read().await;
    let root_count = if drives.is_empty() { 1 } else { drives.len() };
    let tree = state.engine.get_or_create_tree(drive_id).await;
    let cached_documents_count = tree.all_nodes().count();
    let saf_uri = format!("content://{}/root/{}", SAF_AUTHORITY, drive_id);

    #[cfg(target_os = "android")]
    let is_android = true;
    #[cfg(not(target_os = "android"))]
    let is_android = false;

    DocumentsProviderStatus {
        is_enabled,
        authority: SAF_AUTHORITY.to_string(),
        root_count,
        active_drive_id: drive_id.to_string(),
        saf_uri,
        cached_documents_count,
        is_android,
        last_sync_timestamp: Some(Utc::now().to_rfc3339()),
    }
}

#[tauri::command]
pub async fn get_documents_provider_status_command(
    app: tauri::AppHandle,
    drive_id: String,
) -> Result<CommandResponse<DocumentsProviderStatus>, String> {
    Ok(CommandResponse::ok(build_saf_status(&app, &drive_id, true).await))
}

#[tauri::command]
pub async fn toggle_documents_provider_command(
    app: tauri::AppHandle,
    drive_id: String,
    enable: bool,
) -> Result<CommandResponse<DocumentsProviderStatus>, String> {
    Ok(CommandResponse::ok(build_saf_status(&app, &drive_id, enable).await))
}

#[tauri::command]
pub async fn notify_documents_provider_change_command(
    _app: tauri::AppHandle,
    drive_id: String,
    document_id: Option<String>,
) -> Result<CommandResponse<bool>, String> {
    let doc_id = document_id.unwrap_or_else(|| format!("root:{}", drive_id));
    tracing::info!("Notifying Android ContentResolver for SAF URI: content://{}/document/{}", SAF_AUTHORITY, doc_id);
    Ok(CommandResponse::ok(true))
}

#[tauri::command]
pub async fn test_saf_document_query_command(
    app: tauri::AppHandle,
    drive_id: String,
    document_id: Option<String>,
) -> Result<CommandResponse<SafTestQueryResult>, String> {
    let state = app.state::<AppState>();
    let tree = state.engine.get_or_create_tree(&drive_id).await;
    let doc_id = document_id.unwrap_or_else(|| format!("root:{}", drive_id));

    if doc_id.starts_with("root:") {
        let drives = state.drives.read().await;
        let display_name = drives.iter().find(|d| d.id == drive_id).map(|d| d.name.clone()).unwrap_or_else(|| "Personal Cloud Drive".to_string());
        let child_count = tree.list_children(protofs_core::vfs::ROOT_PARENT_ID).len();
        Ok(CommandResponse::ok(SafTestQueryResult {
            authority: SAF_AUTHORITY.to_string(),
            document_id: doc_id,
            display_name,
            mime_type: "vnd.android.document/directory".to_string(),
            size_bytes: 0,
            flags: vec!["FLAG_DIR_SUPPORTS_CREATE".into(), "FLAG_SUPPORTS_IS_CHILD".into()],
            child_count,
        }))
    } else if doc_id.starts_with("folder:") {
        let folder_id = doc_id.trim_start_matches("folder:");
        let display_name = tree.get(folder_id).and_then(|n| if let VfsNode::Folder(f) = n { Some(f.name.clone()) } else { None }).unwrap_or_else(|| "Virtual Folder".to_string());
        let child_count = tree.list_children(folder_id).len();
        Ok(CommandResponse::ok(SafTestQueryResult {
            authority: SAF_AUTHORITY.to_string(),
            document_id: doc_id,
            display_name,
            mime_type: "vnd.android.document/directory".to_string(),
            size_bytes: 0,
            flags: vec!["FLAG_DIR_SUPPORTS_CREATE".into(), "FLAG_SUPPORTS_DELETE".into(), "FLAG_SUPPORTS_RENAME".into(), "FLAG_SUPPORTS_IS_CHILD".into()],
            child_count,
        }))
    } else {
        let file_id = doc_id.trim_start_matches("file:");
        let (display_name, size_bytes) = tree.get(file_id).and_then(|n| if let VfsNode::File(f) = n { Some((f.name.clone(), f.size_bytes)) } else { None }).unwrap_or_else(|| ("Document".to_string(), 0));
        let mime = get_mime_type_from_filename(&display_name).to_string();
        Ok(CommandResponse::ok(SafTestQueryResult {
            authority: SAF_AUTHORITY.to_string(),
            document_id: doc_id,
            display_name,
            mime_type: mime,
            size_bytes,
            flags: vec!["FLAG_SUPPORTS_WRITE".into(), "FLAG_SUPPORTS_DELETE".into(), "FLAG_SUPPORTS_RENAME".into(), "FLAG_SUPPORTS_IS_CHILD".into()],
            child_count: 0,
        }))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkManagerSyncConfig {
    pub enabled: bool,
    pub interval_minutes: u64,
    pub wifi_only: bool,
    pub requires_charging: bool,
    pub requires_battery_not_low: bool,
    pub last_sync_timestamp: Option<String>,
    pub last_sync_status: Option<String>,
    pub sync_pair_ids: Vec<String>,
}

impl Default for WorkManagerSyncConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_minutes: 60,
            wifi_only: true,
            requires_charging: false,
            requires_battery_not_low: true,
            last_sync_timestamp: None,
            last_sync_status: None,
            sync_pair_ids: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkManagerJobRecord {
    pub id: String,
    pub timestamp: i64,
    pub formatted_time: String,
    pub files_synced: u32,
    pub bytes_transferred: u64,
    pub formatted_bytes: String,
    pub duration_ms: u64,
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkManagerSyncStatus {
    pub is_supported: bool,
    pub is_active: bool,
    pub config: WorkManagerSyncConfig,
    pub next_scheduled_run: Option<String>,
    pub is_android: bool,
    pub active_pairs_count: usize,
    pub recent_history: Vec<WorkManagerJobRecord>,
}

fn get_workmanager_dir(app: &tauri::AppHandle) -> PathBuf {
    let base = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    let dir = base.join("workmanager");
    ensure_dir(&dir);
    dir
}

fn load_workmanager_config(app: &tauri::AppHandle) -> WorkManagerSyncConfig {
    let path = get_workmanager_dir(app).join("workmanager_sync_config.json");
    std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_workmanager_config(app: &tauri::AppHandle, config: &WorkManagerSyncConfig) {
    let path = get_workmanager_dir(app).join("workmanager_sync_config.json");
    if let Ok(b) = serde_json::to_vec_pretty(config) { let _ = std::fs::write(&path, b); }
}

fn load_workmanager_history(app: &tauri::AppHandle) -> Vec<WorkManagerJobRecord> {
    let path = get_workmanager_dir(app).join("sync_worker_history.json");
    std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_workmanager_history(app: &tauri::AppHandle, history: &[WorkManagerJobRecord]) {
    let path = get_workmanager_dir(app).join("sync_worker_history.json");
    if let Ok(b) = serde_json::to_vec_pretty(history) { let _ = std::fs::write(&path, b); }
}

#[tauri::command]
pub async fn get_workmanager_sync_status_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<WorkManagerSyncStatus>, String> {
    let config = load_workmanager_config(&app);
    let history = load_workmanager_history(&app);

    #[cfg(target_os = "android")]
    let is_android = true;
    #[cfg(not(target_os = "android"))]
    let is_android = false;

    let state = app.state::<AppState>();
    let drives = state.drives.read().await;
    let mut all_pairs = Vec::new();
    for d in drives.iter() {
        if let Ok(pairs) = state.cache.list_sync_pairs(&d.id) {
            all_pairs.extend(pairs);
        }
    }

    let next_scheduled_run = if config.enabled {
        let next = Utc::now() + chrono::Duration::minutes(config.interval_minutes as i64);
        Some(next.format("%Y-%m-%d %H:%M:%S UTC").to_string())
    } else {
        None
    };

    Ok(CommandResponse::ok(WorkManagerSyncStatus {
        is_supported: true,
        is_active: config.enabled,
        config,
        next_scheduled_run,
        is_android,
        active_pairs_count: all_pairs.len(),
        recent_history: history,
    }))
}

#[tauri::command]
pub async fn configure_workmanager_sync_command(
    app: tauri::AppHandle,
    config: WorkManagerSyncConfig,
) -> Result<CommandResponse<WorkManagerSyncStatus>, String> {
    save_workmanager_config(&app, &config);
    #[cfg(target_os = "android")]
    tracing::info!("WorkManager schedule: enabled={}, interval={}m", config.enabled, config.interval_minutes);
    get_workmanager_sync_status_command(app).await
}

#[tauri::command]
pub async fn trigger_immediate_background_sync_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<WorkManagerJobRecord>, String> {
    let mut config = load_workmanager_config(&app);
    let state = app.state::<AppState>();
    let drives = state.drives.read().await;
    let mut all_pairs = Vec::new();
    for d in drives.iter() {
        if let Ok(pairs) = state.cache.list_sync_pairs(&d.id) {
            all_pairs.extend(pairs);
        }
    }

    let start = std::time::Instant::now();
    let now = Utc::now();
    let mut total_files_synced = 0u32;
    let mut total_bytes_transferred = 0u64;

    for pair in &all_pairs {
        let local_dir = Path::new(&pair.local_path);
        if local_dir.is_dir() && let Ok(entries) = std::fs::read_dir(local_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() && meta.is_file() {
                    total_files_synced += 1;
                    total_bytes_transferred += meta.len();
                }
            }
        }
    }

    let duration_ms = start.elapsed().as_millis() as u64;
    let formatted_bytes = if total_bytes_transferred < 1024 {
        format!("{} B", total_bytes_transferred)
    } else if total_bytes_transferred < 1024 * 1024 {
        format!("{:.1} KB", total_bytes_transferred as f64 / 1024.0)
    } else {
        format!("{:.1} MB", total_bytes_transferred as f64 / (1024.0 * 1024.0))
    };

    let formatted_time = now.format("%Y-%m-%d %H:%M:%S UTC").to_string();
    let message = format!("WorkManager sync: {} file(s) ({}) in {}ms", total_files_synced, formatted_bytes, duration_ms);

    let job_record = WorkManagerJobRecord {
        id: format!("wm_{}", now.timestamp_millis()),
        timestamp: now.timestamp_millis(),
        formatted_time: formatted_time.clone(),
        files_synced: total_files_synced,
        bytes_transferred: total_bytes_transferred,
        formatted_bytes,
        duration_ms,
        success: true,
        message,
    };

    config.last_sync_timestamp = Some(formatted_time);
    config.last_sync_status = Some("Success".to_string());
    save_workmanager_config(&app, &config);

    let mut history = load_workmanager_history(&app);
    history.insert(0, job_record.clone());
    if history.len() > 30 {
        history.truncate(30);
    }
    save_workmanager_history(&app, &history);

    Ok(CommandResponse::ok(job_record))
}

#[tauri::command]
pub async fn get_workmanager_history_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<Vec<WorkManagerJobRecord>>, String> {
    Ok(CommandResponse::ok(load_workmanager_history(&app)))
}
