use chrono::Utc;
use protofs_core::mtproto::{OwnedChannel, TelegramTransport};
use protofs_core::vfs::{DriveMetadata, VfsNode};
use tauri::Manager;

use super::{AppState, CommandResponse, ensure_dir};

pub fn get_drives_file_path(app: &tauri::AppHandle, user_id: i64) -> Option<std::path::PathBuf> {
    if let Ok(dir) = app.path().app_data_dir() {
        ensure_dir(&dir);
        Some(dir.join(format!("drives_{}.json", user_id)))
    } else if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::PathBuf::from(appdata).join("ProtoFS");
        ensure_dir(&dir);
        Some(dir.join(format!("drives_{}.json", user_id)))
    } else {
        None
    }
}

pub fn save_user_drives(app: &tauri::AppHandle, user_id: i64, drives: &[DriveMetadata]) {
    if let Some(path) = get_drives_file_path(app, user_id)
        && let Ok(json) = serde_json::to_string_pretty(drives)
        && let Ok(encrypted) = protofs_core::crypto::protect_secret(json.as_bytes())
    {
        let _ = std::fs::write(&path, encrypted);
    }
}

pub fn load_user_drives(app: &tauri::AppHandle, user_id: i64) -> Vec<DriveMetadata> {
    if let Some(path) = get_drives_file_path(app, user_id)
        && path.exists()
        && let Ok(content) = std::fs::read(&path)
    {
        // Try encrypted format first, fall back to plaintext for migration
        if let Ok(decrypted) = protofs_core::crypto::unprotect_secret(&content)
            && let Ok(drives) = serde_json::from_slice::<Vec<DriveMetadata>>(&decrypted)
        {
            return drives;
        }
        if let Ok(s) = std::str::from_utf8(&content)
            && let Ok(drives) = serde_json::from_str::<Vec<DriveMetadata>>(s)
        {
            // Migrate to encrypted format
            save_user_drives(app, user_id, &drives);
            return drives;
        }
    }
    Vec::new()
}

#[tauri::command]
pub async fn get_drives_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<Vec<DriveMetadata>>, String> {
    let state = app.state::<AppState>();

    // Hold session lock while loading drives to prevent TOCTOU race
    let session_guard = state.session.read().await;
    let user_id = session_guard.as_ref().map(|s| s.user_id);

    if let Some(uid) = user_id {
        let drives = load_user_drives(&app, uid)
            .into_iter()
            .filter(|d| !(d.channel_id == 0 && d.name == "ProtoFS Cloud Drive"))
            .collect::<Vec<_>>();
        save_user_drives(&app, uid, &drives);
        drop(session_guard);
        let mut state_drives = state.drives.write().await;
        *state_drives = drives.clone();
        return Ok(CommandResponse::ok(drives));
    }
    drop(session_guard);

    let drives = state.drives.read().await;
    let filtered_drives: Vec<DriveMetadata> = drives
        .iter()
        .filter(|d| !(d.channel_id == 0 && d.name == "ProtoFS Cloud Drive"))
        .cloned()
        .collect();
    Ok(CommandResponse::ok(filtered_drives))
}

#[tauri::command]
pub async fn delete_drive_command(
    app: tauri::AppHandle,
    drive_id: String,
) -> Result<CommandResponse<bool>, String> {
    let state = app.state::<AppState>();
    let mut drives = state.drives.write().await;
    drives.retain(|d| d.id != drive_id);
    let session_guard = state.session.read().await;
    if let Some(ref s) = *session_guard {
        save_user_drives(&app, s.user_id, &drives);
    }
    drop(session_guard);
    Ok(CommandResponse::ok(true))
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
        match state
            .transport
            .create_channel(&channel_title, &channel_about)
            .await
        {
            Ok(info) => info.id,
            Err(e) => {
                return Ok(CommandResponse::err(format!(
                    "Failed to create Telegram channel: {}",
                    e
                )));
            }
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
        save_user_drives(&app, s.user_id, &drives);
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
            )));
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
    let mut drives = state.drives.write().await;
    if let Some(existing) = drives.iter().find(|d| d.channel_id == channel_id) {
        return Ok(CommandResponse::ok(existing.clone()));
    }
    let id = format!("drive_{}", Utc::now().timestamp_millis());
    let new_drive = DriveMetadata {
        id: id.clone(),
        name,
        channel_id,
        pinned_manifest_msg_id: Some(1),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    drives.push(new_drive.clone());

    let session_guard = state.session.read().await;
    if let Some(ref s) = *session_guard {
        save_user_drives(&app, s.user_id, &drives);
    }
    drop(session_guard);

    let _ = state.engine.get_or_create_tree(&id).await;

    Ok(CommandResponse::ok(new_drive))
}

#[tauri::command]
pub async fn load_drive_command(
    app: tauri::AppHandle,
    drive_id: String,
    channel_id: i64,
) -> Result<CommandResponse<Vec<VfsNode>>, String> {
    let state = app.state::<AppState>();

    if drive_id.is_empty() {
        return Ok(CommandResponse::ok(Vec::new()));
    }

    let target_channel_id = if channel_id != 0 {
        channel_id
    } else {
        let drives = state.drives.read().await;
        drives
            .iter()
            .find(|d| d.id == drive_id)
            .map(|d| d.channel_id)
            .unwrap_or(0)
    };

    if target_channel_id != 0 {
        match state.engine.load_drive(&drive_id, target_channel_id).await {
            Ok(tree) => {
                let nodes: Vec<VfsNode> = tree.all_nodes().cloned().collect();
                return Ok(CommandResponse::ok(nodes));
            }
            Err(e) => {
                tracing::warn!(
                    "Failed to load remote drive '{}' from channel {}: {}. Falling back to local cache.",
                    drive_id,
                    target_channel_id,
                    e
                );
            }
        }
    }

    // Fallback to local cache/in-memory tree
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

    let target_channel_id = if channel_id != 0 {
        channel_id
    } else {
        let drives = state.drives.read().await;
        drives
            .iter()
            .find(|d| d.id == drive_id)
            .map(|d| d.channel_id)
            .unwrap_or(0)
    };

    if target_channel_id == 0 {
        return Ok(CommandResponse::err(format!(
            "Drive '{}' has no associated Telegram channel to flush manifest to",
            drive_id
        )));
    }

    match state
        .engine
        .flush_manifest(&drive_id, target_channel_id)
        .await
    {
        Ok(_) => Ok(CommandResponse::ok(())),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}
