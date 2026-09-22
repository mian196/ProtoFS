use protofs_core::vfs::VfsNode;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::{AppState, CommandResponse, LOCAL_CACHE_BYTES, PurgeCacheResult, UpdateInfo};

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
            local_cache_bytes: LOCAL_CACHE_BYTES,
        }))
    } else {
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

#[tauri::command]
pub async fn check_for_updates_command() -> Result<CommandResponse<UpdateInfo>, String> {
    let current_version = env!("CARGO_PKG_VERSION");
    let update_info = super::updater::fetch_latest_release(current_version).await;
    Ok(CommandResponse::ok(update_info))
}

/// Purges local temporary chunks and cache safely (D-28, D-29).
/// Strictly sandboxed to the local cache directory without affecting cloud files.
#[tauri::command]
pub async fn purge_local_cache_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<PurgeCacheResult>, String> {
    let cache_dir = match app.path().app_cache_dir() {
        Ok(p) => p,
        Err(_) => {
            #[cfg(target_os = "windows")]
            {
                let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
                std::path::PathBuf::from(localappdata)
                    .join("ProtoFS")
                    .join("cache")
            }
            #[cfg(not(target_os = "windows"))]
            {
                std::env::temp_dir().join("protofs_cache")
            }
        }
    };

    let mut freed_bytes = 0u64;
    let mut files_deleted = 0usize;

    if cache_dir.exists()
        && let Ok(entries) = std::fs::read_dir(&cache_dir)
    {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(meta) = path.metadata() {
                    freed_bytes += meta.len();
                }
                if std::fs::remove_file(&path).is_ok() {
                    files_deleted += 1;
                }
            } else if path.is_dir() {
                if let Ok(meta) = path.metadata() {
                    freed_bytes += meta.len();
                }
                if std::fs::remove_dir_all(&path).is_ok() {
                    files_deleted += 1;
                }
            }
        }
    }

    tracing::info!(
        "Purged local cache: freed {} bytes across {} files/dirs in {}",
        freed_bytes,
        files_deleted,
        cache_dir.display()
    );

    Ok(CommandResponse::ok(PurgeCacheResult {
        freed_bytes,
        files_deleted,
    }))
}
