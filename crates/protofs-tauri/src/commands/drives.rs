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

pub async fn trigger_chat_folder_sync(state: &AppState) {
    let drives = state.drives.read().await;
    let channel_ids: Vec<i64> = drives
        .iter()
        .map(|d| d.channel_id)
        .filter(|&cid| cid != 0)
        .collect();
    drop(drives);

    if !channel_ids.is_empty() {
        let _ = state.engine.sync_chat_folder("ProtoFS", &channel_ids).await;
    }
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
        drop(state_drives);
        trigger_chat_folder_sync(&state).await;
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
    delete_cloud_channel: Option<bool>,
) -> Result<CommandResponse<bool>, String> {
    let state = app.state::<AppState>();
    let should_delete_cloud = delete_cloud_channel.unwrap_or(false);

    // Step 1: Look up target_channel_id from state.drives
    let target_channel_id = {
        let drives = state.drives.read().await;
        drives
            .iter()
            .find(|d| d.id == drive_id)
            .map(|d| d.channel_id)
            .unwrap_or(0)
    };

    // Step 2 (Phase 1: Telegram Cloud Channel Deletion / Leave):
    if should_delete_cloud && target_channel_id != 0 {
        match state.transport.list_owned_channels().await {
            Ok(channels) => {
                let norm_target = target_channel_id.abs();
                let is_creator = channels
                    .iter()
                    .find(|c| c.channel_id.abs() == norm_target)
                    .map(|c| c.is_creator)
                    .unwrap_or(false);

                if is_creator {
                    if let Err(e) = state.transport.delete_channel(target_channel_id).await {
                        tracing::warn!(
                            "Failed to delete Telegram cloud channel {}: {}",
                            target_channel_id,
                            e
                        );
                    }
                } else {
                    tracing::info!(
                        "User is not creator of channel {}; leaving channel instead of deleting",
                        target_channel_id
                    );
                    if let Err(e) = state.transport.leave_channel(target_channel_id).await {
                        tracing::warn!(
                            "Failed to leave Telegram cloud channel {}: {}",
                            target_channel_id,
                            e
                        );
                    }
                }
            }
            Err(e) => {
                tracing::warn!("Failed to list channels before drive deletion: {}", e);
            }
        }
    }

    // Step 3 (Phase 2: Local Cascade Purge):
    // 1. Unload in-memory tree
    state.engine.unload_drive(&drive_id).await;

    // 2. Unmount OS virtual drive if mounted
    let _ = super::native::unmount_virtual_drive_command(app.clone(), drive_id.clone()).await;

    // 3. Purge SQLite cache atomically & checkpoint WAL
    if let Err(e) = state.cache.delete_drive_cache(&drive_id) {
        tracing::warn!("Failed to purge SQLite cache for drive {}: {}", drive_id, e);
    }
    let _ = state.cache.wal_checkpoint_passive();

    // 4. Remove drive from state.drives and persist
    let mut drives = state.drives.write().await;
    drives.retain(|d| d.id != drive_id);
    let session_guard = state.session.read().await;
    if let Some(ref s) = *session_guard {
        save_user_drives(&app, s.user_id, &drives);
    }
    drop(session_guard);
    drop(drives);

    // 5. Sync Telegram chat folder without deleted channel
    trigger_chat_folder_sync(&state).await;

    Ok(CommandResponse::ok(true))
}

#[allow(dead_code)]
pub async fn export_drive_manifest_snapshot_backup(
    app: &tauri::AppHandle,
    drive_id: &str,
) -> Result<std::path::PathBuf, String> {
    let state = app.state::<AppState>();
    let tree = state.engine.get_or_create_tree(drive_id).await;
    let nodes: Vec<_> = tree.all_nodes().cloned().collect();
    let json = serde_json::to_string_pretty(&nodes).map_err(|e| e.to_string())?;

    let backup_dir = super::native::common::get_protofs_mount_dir(app, "_backups");
    super::native::common::ensure_dir(&backup_dir);
    let backup_path = backup_dir.join(format!("{}_manifest_backup.json", drive_id));
    std::fs::write(&backup_path, json.as_bytes()).map_err(|e| e.to_string())?;
    Ok(backup_path)
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
    drop(drives);

    trigger_chat_folder_sync(&state).await;

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
    drop(drives);

    trigger_chat_folder_sync(&state).await;

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
        let updated_drives = drives.clone();
        drop(drives);

        trigger_chat_folder_sync(&state).await;

        return Ok(CommandResponse::ok(updated_drives));
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DriveHealthStatus {
    pub drive_id: String,
    pub channel_id: i64,
    pub is_accessible: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn check_drive_health_command(
    app: tauri::AppHandle,
    drive_id: String,
    channel_id: i64,
) -> Result<CommandResponse<DriveHealthStatus>, String> {
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
        return Ok(CommandResponse::ok(DriveHealthStatus {
            drive_id,
            channel_id: 0,
            is_accessible: true,
            error: None,
        }));
    }

    match state.transport.list_owned_channels().await {
        Ok(owned) => {
            let exists = owned.into_iter().any(|c| {
                c.channel_id.abs() == target_channel_id.abs()
                    || c.channel_id
                        .abs()
                        .to_string()
                        .ends_with(&target_channel_id.abs().to_string())
                    || target_channel_id
                        .abs()
                        .to_string()
                        .ends_with(&c.channel_id.abs().to_string())
            });

            if exists {
                Ok(CommandResponse::ok(DriveHealthStatus {
                    drive_id,
                    channel_id: target_channel_id,
                    is_accessible: true,
                    error: None,
                }))
            } else {
                Ok(CommandResponse::ok(DriveHealthStatus {
                    drive_id,
                    channel_id: target_channel_id,
                    is_accessible: false,
                    error: Some(
                        "Channel not found in your Telegram account (deleted or unlinked)"
                            .to_string(),
                    ),
                }))
            }
        }
        Err(e) => Ok(CommandResponse::ok(DriveHealthStatus {
            drive_id,
            channel_id: target_channel_id,
            is_accessible: false,
            error: Some(e.to_string()),
        })),
    }
}

#[tauri::command]
pub async fn export_drive_manifest_command(
    app: tauri::AppHandle,
    drive_id: String,
    format: String,
) -> Result<CommandResponse<String>, String> {
    let state = app.state::<AppState>();

    // Load tree from memory or local cache
    let tree = state.engine.get_or_create_tree(&drive_id).await;
    let mut nodes: Vec<VfsNode> = tree.all_nodes().cloned().collect();
    if nodes.is_empty()
        && let Ok(cached_tree) = state.cache.load_tree(&drive_id)
    {
        nodes = cached_tree.all_nodes().cloned().collect();
    }

    if format.eq_ignore_ascii_case("csv") {
        let mut csv = String::from(
            "id,name,type,parent_id,size_bytes,mime_type,telegram_message_id,is_encrypted,sha256_hash,created_at,updated_at\n",
        );
        for node in &nodes {
            match node {
                VfsNode::File(f) => {
                    csv.push_str(&format!(
                        "\"{}\",\"{}\",file,\"{}\",{},\"{}\",{},{},\"{}\",\"{}\",\"{}\"\n",
                        f.id,
                        f.name.replace('"', "\"\""),
                        f.parent_id,
                        f.size_bytes,
                        f.mime_type.as_deref().unwrap_or(""),
                        f.telegram_message_id,
                        f.is_encrypted,
                        f.sha256_hash.as_deref().unwrap_or(""),
                        f.created_at.to_rfc3339(),
                        f.updated_at.to_rfc3339(),
                    ));
                }
                VfsNode::Folder(d) => {
                    csv.push_str(&format!(
                        "\"{}\",\"{}\",folder,\"{}\",0,\"\",0,false,\"\",\"{}\",\"{}\"\n",
                        d.id,
                        d.name.replace('"', "\"\""),
                        d.parent_id,
                        d.created_at.to_rfc3339(),
                        d.updated_at.to_rfc3339(),
                    ));
                }
            }
        }
        Ok(CommandResponse::ok(csv))
    } else {
        let json = serde_json::to_string_pretty(&nodes)
            .map_err(|e| format!("Failed to serialize manifest to JSON: {}", e))?;
        Ok(CommandResponse::ok(json))
    }
}

#[tauri::command]
pub async fn sync_chat_folder_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    trigger_chat_folder_sync(&state).await;
    Ok(CommandResponse::ok(()))
}
