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

    let (resolved_channel_id, was_created) = if channel_id == 0 {
        let channel_title = format!("[ProtoFS] {}", name);
        let channel_about = format!("ProtoFS Encrypted Cloud Storage [protofs-id: {}]", id);
        match state
            .transport
            .create_channel(&channel_title, &channel_about)
            .await
        {
            Ok(info) => (info.id, true),
            Err(e) => {
                return Ok(CommandResponse::err(format!(
                    "Failed to create Telegram channel: {}",
                    e
                )));
            }
        }
    } else {
        (channel_id, false)
    };

    // 1. Send introductory welcome banner if newly created
    if was_created && resolved_channel_id != 0 {
        let welcome_text = format!(
            "🚀 ProtoFS Cloud Storage Initialized\n\
             ===================================\n\
             📁 Drive Name: {}\n\
             🆔 Drive ID: {}\n\
             🔒 Protocol: ProtoFS v0.3.0 (MTProto + Argon2id / AES-256-GCM)\n\
             ⚡ Status: Active & Ready\n\
             ===================================\n\
             ℹ️ Notice: This channel stores your ProtoFS filesystem data, encrypted chunks, and compressed snapshots. Please do not delete pinned manifest messages.",
            name, id
        );
        let _ = state
            .transport
            .send_text_message(resolved_channel_id, &welcome_text)
            .await;
    }

    // 2. Initialize in-memory drive tree and synthesize/pin initial manifest.json.zst v1
    let tree = state.engine.get_or_create_tree(&id).await;
    let mut pinned_msg_id = Some(1);

    if resolved_channel_id != 0 {
        let snapshot = protofs_core::manifest::ManifestSnapshot::from_tree(&id, 1, &tree);
        let _ = state.cache.batch_insert_manifest(&snapshot);
        if let Ok(compressed) = snapshot.to_compressed_bytes() {
            match state
                .transport
                .update_pinned_manifest(resolved_channel_id, &compressed)
                .await
            {
                Ok(msg_id) => {
                    pinned_msg_id = Some(msg_id);
                    tracing::info!(
                        "Synthesized and pinned initial manifest v1 (msg #{}) for drive '{}'",
                        msg_id,
                        id
                    );
                }
                Err(e) => {
                    tracing::warn!("Failed to pin initial manifest for drive '{}': {}", id, e);
                }
            }
        }
    }

    let new_drive = DriveMetadata {
        id: id.clone(),
        name,
        channel_id: resolved_channel_id,
        pinned_manifest_msg_id: pinned_msg_id,
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

    let welcome_text = format!(
        "🚀 ProtoFS Cloud Storage Connected\n\
         ===================================\n\
         📁 Drive Name: {}\n\
         🆔 Drive ID: {}\n\
         ⚡ Status: Channel adopted as active virtual drive\n\
         ===================================",
        name, id
    );
    let _ = state
        .transport
        .send_text_message(channel_id, &welcome_text)
        .await;

    let tree = state.engine.get_or_create_tree(&id).await;
    let mut pinned_msg_id = Some(1);

    if channel_id != 0 {
        let snapshot = protofs_core::manifest::ManifestSnapshot::from_tree(&id, 1, &tree);
        let _ = state.cache.batch_insert_manifest(&snapshot);
        if let Ok(compressed) = snapshot.to_compressed_bytes()
            && let Ok(msg_id) = state
                .transport
                .update_pinned_manifest(channel_id, &compressed)
                .await
        {
            pinned_msg_id = Some(msg_id);
        }
    }

    let new_drive = DriveMetadata {
        id: id.clone(),
        name,
        channel_id,
        pinned_manifest_msg_id: pinned_msg_id,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    drives.push(new_drive.clone());

    let session_guard = state.session.read().await;
    if let Some(ref s) = *session_guard {
        save_user_drives(&app, s.user_id, &drives);
    }
    drop(session_guard);

    Ok(CommandResponse::ok(new_drive))
}

#[tauri::command]
pub async fn sync_and_prune_drives_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<Vec<DriveMetadata>>, String> {
    let state = app.state::<AppState>();

    // Fetch live owned channels from Telegram
    if let Ok(owned) = state.transport.list_owned_channels().await {
        let valid_ids: std::collections::HashSet<i64> =
            owned.into_iter().map(|c| c.channel_id.abs()).collect();
        let mut drives = state.drives.write().await;

        drives.retain(|d| {
            d.channel_id == 0
                || valid_ids.contains(&d.channel_id.abs())
                || valid_ids.iter().any(|&vid| {
                    let s_vid = vid.to_string();
                    let s_did = d.channel_id.abs().to_string();
                    s_vid.ends_with(&s_did) || s_did.ends_with(&s_vid)
                })
        });

        let session_guard = state.session.read().await;
        if let Some(ref s) = *session_guard {
            save_user_drives(&app, s.user_id, &drives);
        }
        drop(session_guard);

        return Ok(CommandResponse::ok(drives.clone()));
    }

    let drives = state.drives.read().await;
    Ok(CommandResponse::ok(drives.clone()))
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
                let err_str = e.to_string();
                if err_str.contains("CHANNEL_INVALID") {
                    tracing::warn!(
                        "Channel {} was deleted from Telegram. Auto-pruning drive '{}'",
                        target_channel_id,
                        drive_id
                    );
                    let mut drives = state.drives.write().await;
                    drives.retain(|d| d.id != drive_id);
                    let session_guard = state.session.read().await;
                    if let Some(ref s) = *session_guard {
                        save_user_drives(&app, s.user_id, &drives);
                    }
                    drop(session_guard);
                    return Ok(CommandResponse::err(
                        "This drive channel was deleted from Telegram and has been unlinked."
                            .to_string(),
                    ));
                }

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
