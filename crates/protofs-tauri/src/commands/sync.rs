use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::{AppState, CommandResponse};

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

    // 1. Find the sync pair across drives
    let drives = state.drives.read().await;
    let drive_list = drives.clone();
    drop(drives);

    let mut found_pair = None;
    for d in &drive_list {
        if let Ok(pairs) = state.cache.list_sync_pairs(&d.id)
            && let Some(pair) = pairs.into_iter().find(|p| p.id == id)
        {
            found_pair = Some((d.clone(), pair));
            break;
        }
    }

    let (drive, pair) = match found_pair {
        Some(res) => res,
        None => {
            // Update timestamp directly if pair metadata is only in cache
            let _ = state.cache.update_sync_pair_last_synced(&id);
            return Ok(CommandResponse::ok(()));
        }
    };

    let local_dir = std::path::PathBuf::from(&pair.local_path);
    if local_dir.is_dir()
        && let Ok(entries) = std::fs::read_dir(&local_dir)
    {
        let tree = state.engine.get_or_create_tree(&drive.id).await;
        let existing_files: std::collections::HashMap<String, String> = tree
            .list_children(&pair.remote_folder_id)
            .into_iter()
            .filter_map(|node| {
                if let protofs_core::vfs::VfsNode::File(f) = node {
                    Some((f.name.clone(), f.sha256_hash.clone().unwrap_or_default()))
                } else {
                    None
                }
            })
            .collect();

        let key = [0x5Au8; 32];
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let file_name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                if file_name.is_empty() {
                    continue;
                }

                if let Ok(bytes) = std::fs::read(&path) {
                    let digest = ring::digest::digest(&ring::digest::SHA256, &bytes);
                    let sha256: String = digest
                        .as_ref()
                        .iter()
                        .map(|b| format!("{:02x}", b))
                        .collect();

                    // If already exists with matching SHA256, skip re-upload
                    if let Some(existing_sha) = existing_files.get(&file_name)
                        && existing_sha == &sha256
                    {
                        continue;
                    }

                    // Upload new / modified file
                    if let Err(e) = state
                        .engine
                        .upload_file_data(
                            &drive.id,
                            &pair.remote_folder_id,
                            &file_name,
                            &bytes,
                            true,
                            Some(&key),
                            drive.channel_id,
                        )
                        .await
                    {
                        tracing::warn!(
                            "Failed to sync file '{}' to drive '{}': {}",
                            file_name,
                            drive.id,
                            e
                        );
                    }
                }
            }
        }
    }

    if let Err(e) = state.cache.update_sync_pair_last_synced(&id) {
        return Ok(CommandResponse::err(e.to_string()));
    }

    Ok(CommandResponse::ok(()))
}

// ---------------------------------------------------------------------------
// Camera Auto-Backup & Media Sync
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraBackupConfig {
    pub enabled: bool,
    pub sync_pair_id: Option<String>,
    pub local_path: String,
    pub remote_folder_name: String,
    pub wifi_only: bool,
    pub charging_only: bool,
    pub include_videos: bool,
    pub original_quality: bool,
    pub last_backup_at: Option<chrono::DateTime<chrono::Utc>>,
}

fn get_default_camera_path() -> String {
    #[cfg(target_os = "windows")]
    {
        let user = std::env::var("USERPROFILE").unwrap_or_default();
        let camera_roll = std::path::PathBuf::from(&user).join("Pictures\\Camera Roll");
        if camera_roll.exists() {
            camera_roll.to_string_lossy().to_string()
        } else {
            std::path::PathBuf::from(&user)
                .join("Pictures")
                .to_string_lossy()
                .to_string()
        }
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        std::path::PathBuf::from(&home)
            .join("Pictures/Camera")
            .to_string_lossy()
            .to_string()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        "/DCIM/Camera".to_string()
    }
}

#[tauri::command]
pub async fn get_camera_backup_config_command(
    app: tauri::AppHandle,
    drive_id: String,
) -> Result<CommandResponse<CameraBackupConfig>, String> {
    let state = app.state::<AppState>();
    let pairs = state.cache.list_sync_pairs(&drive_id).unwrap_or_default();
    let camera_pair = pairs.into_iter().find(|p| {
        p.sync_mode.contains("camera")
            || p.local_path.contains("Camera")
            || p.local_path.contains("Pictures")
    });

    let default_path = get_default_camera_path();

    if let Some(pair) = camera_pair {
        let is_wifi = !pair.sync_mode.contains("wifi:false");
        let is_charging = pair.sync_mode.contains("charging:true");
        let is_videos = !pair.sync_mode.contains("videos:false");
        let is_raw = !pair.sync_mode.contains("raw:false");

        Ok(CommandResponse::ok(CameraBackupConfig {
            enabled: true,
            sync_pair_id: Some(pair.id),
            local_path: pair.local_path,
            remote_folder_name: "Camera Uploads".to_string(),
            wifi_only: is_wifi,
            charging_only: is_charging,
            include_videos: is_videos,
            original_quality: is_raw,
            last_backup_at: Some(pair.last_synced_at),
        }))
    } else {
        Ok(CommandResponse::ok(CameraBackupConfig {
            enabled: false,
            sync_pair_id: None,
            local_path: default_path,
            remote_folder_name: "Camera Uploads".to_string(),
            wifi_only: true,
            charging_only: false,
            include_videos: true,
            original_quality: true,
            last_backup_at: None,
        }))
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn configure_camera_backup_command(
    app: tauri::AppHandle,
    drive_id: String,
    local_path: String,
    remote_folder_id: String,
    wifi_only: bool,
    charging_only: bool,
    include_videos: bool,
    original_quality: bool,
) -> Result<CommandResponse<protofs_core::cache::SyncPairEntry>, String> {
    let state = app.state::<AppState>();

    let pairs = state.cache.list_sync_pairs(&drive_id).unwrap_or_default();
    for p in pairs {
        if p.sync_mode.contains("camera")
            || p.local_path.contains("Camera")
            || p.local_path.contains("Pictures")
        {
            let _ = state.cache.delete_sync_pair(&p.id);
        }
    }

    let id = format!("camera_sync_{}", chrono::Utc::now().timestamp_millis());
    let mode_desc = format!(
        "camera-backup (wifi:{}, charging:{}, videos:{}, raw:{})",
        wifi_only, charging_only, include_videos, original_quality
    );

    let entry = protofs_core::cache::SyncPairEntry {
        id,
        local_path,
        remote_folder_id,
        drive_id,
        sync_mode: mode_desc,
        last_synced_at: chrono::Utc::now(),
    };

    if let Err(e) = state.cache.insert_sync_pair(&entry) {
        return Ok(CommandResponse::err(e.to_string()));
    }

    Ok(CommandResponse::ok(entry))
}
