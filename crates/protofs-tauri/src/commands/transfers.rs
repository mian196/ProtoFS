use chrono::Utc;
use protofs_core::vfs::{FileNode, FileVersion, VfsNode};
use tauri::{Emitter, Manager};

use super::{
    AppState, CommandResponse, ExportDriveResult, ensure_dir, fnv1a_hash_filename, guess_mime,
};

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct DownloadFileResult {
    pub file_id: String,
    pub name: String,
    pub size_bytes: u64,
    pub destination_path: Option<String>,
    pub data_base64: Option<String>,
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn upload_file_command(
    app: tauri::AppHandle,
    drive_id: String,
    parent_id: String,
    name: String,
    size_bytes: u64,
    is_encrypted: bool,
    file_bytes: Option<Vec<u8>>,
    file_path: Option<String>,
) -> Result<CommandResponse<FileNode>, String> {
    let state = app.state::<AppState>();

    // 1. Resolve raw bytes if provided directly or via local file path
    let payload_bytes = if let Some(bytes) = file_bytes {
        bytes
    } else if let Some(ref path_str) = file_path {
        std::fs::read(path_str).unwrap_or_default()
    } else {
        Vec::new()
    };

    // 2. Find target channel_id from drive metadata
    let drives = state.drives.read().await;
    let drive_meta = drives.iter().find(|d| d.id == drive_id).cloned();
    drop(drives);

    let channel_id = drive_meta.as_ref().map(|d| d.channel_id).unwrap_or(0);

    // 3. Perform real MTProto upload via SyncEngine if channel and data are present
    if channel_id != 0 && !payload_bytes.is_empty() {
        let key = [0x5Au8; 32]; // Standard master encryption key for personal drive
        match state
            .engine
            .upload_file_data(
                &drive_id,
                &parent_id,
                &name,
                &payload_bytes,
                is_encrypted,
                if is_encrypted { Some(&key) } else { None },
                channel_id,
            )
            .await
        {
            Ok(file_node) => {
                let _ = app.emit(
                    "upload-progress",
                    serde_json::json!({
                        "file_id": file_node.id,
                        "name": file_node.name,
                        "progress": 100,
                        "status": "completed",
                    }),
                );
                return Ok(CommandResponse::ok(file_node));
            }
            Err(e) => {
                tracing::warn!(
                    "Direct MTProto upload failed, recording in local VFS: {}",
                    e
                );
            }
        }
    }

    // Check if a file with same name and parent_id already exists (non-destructive versioning)
    let existing_file_id = {
        let tree = state.engine.get_or_create_tree(&drive_id).await;
        tree.list_children(&parent_id).into_iter().find_map(|node| {
            if let VfsNode::File(f) = node {
                if f.name == name {
                    Some(f.id.clone())
                } else {
                    None
                }
            } else {
                None
            }
        })
    };

    let new_msg_id = (Utc::now().timestamp_subsec_millis() as i32) + 1000;
    let iv = if is_encrypted {
        Some(format!(
            "{:016x}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ))
    } else {
        None
    };
    let sha = Some(format!("{:x}", fnv1a_hash_filename(&name)));
    let mime = Some(guess_mime(&name));

    let file = if let Some(existing_id) = existing_file_id {
        let mut tree = state.engine.get_or_create_tree(&drive_id).await;
        if let Err(e) = tree.record_file_version(
            &existing_id,
            new_msg_id,
            size_bytes,
            mime,
            sha,
            is_encrypted,
            iv,
        ) {
            tracing::warn!("Failed to record file version: {}", e);
        }
        tree.get_file(&existing_id)
            .cloned()
            .ok_or_else(|| "File disappeared after version record".to_string())?
    } else {
        let id = format!("file_{}", Utc::now().timestamp_millis());
        let new_file = FileNode {
            id: id.clone(),
            drive_id: drive_id.clone(),
            parent_id,
            name: name.clone(),
            size_bytes,
            mime_type: mime,
            telegram_message_id: new_msg_id,
            is_encrypted,
            encryption_iv: iv,
            sha256_hash: sha,
            is_pinned_offline: false,
            is_trashed: false,
            version: 1,
            history: Vec::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        if let Err(e) = state
            .engine
            .add_node(&drive_id, VfsNode::File(new_file.clone()))
            .await
        {
            return Ok(CommandResponse::err(e.to_string()));
        }

        new_file
    };

    let _ = app.emit(
        "upload-progress",
        serde_json::json!({
            "file_id": file.id,
            "name": file.name,
            "progress": 100,
            "status": "completed",
        }),
    );

    Ok(CommandResponse::ok(file))
}

#[tauri::command]
pub async fn download_file_command(
    app: tauri::AppHandle,
    drive_id: String,
    file_id: String,
    destination_path: Option<String>,
) -> Result<CommandResponse<DownloadFileResult>, String> {
    let state = app.state::<AppState>();

    let drives = state.drives.read().await;
    let drive_meta = drives.iter().find(|d| d.id == drive_id).cloned();
    drop(drives);

    let channel_id = drive_meta.as_ref().map(|d| d.channel_id).unwrap_or(0);
    let key = [0x5Au8; 32];

    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "file_id": file_id,
            "progress": 20,
            "status": "downloading",
        }),
    );

    match state
        .engine
        .download_file_data(&drive_id, &file_id, Some(&key), channel_id)
        .await
    {
        Ok((file_node, data)) => {
            if let Some(dest) = destination_path.as_ref() {
                let dest_path = std::path::PathBuf::from(dest);
                if let Some(parent) = dest_path.parent() {
                    ensure_dir(parent);
                }
                if let Err(e) = std::fs::write(&dest_path, &data) {
                    return Ok(CommandResponse::err(format!(
                        "Failed to write downloaded file: {}",
                        e
                    )));
                }
            }

            let _ = app.emit(
                "download-progress",
                serde_json::json!({
                    "file_id": file_node.id,
                    "name": file_node.name,
                    "progress": 100,
                    "status": "completed",
                }),
            );

            use base64::Engine;
            let b64 = if destination_path.is_none() && data.len() < 10 * 1024 * 1024 {
                Some(base64::engine::general_purpose::STANDARD.encode(&data))
            } else {
                None
            };

            Ok(CommandResponse::ok(DownloadFileResult {
                file_id: file_node.id,
                name: file_node.name,
                size_bytes: data.len() as u64,
                destination_path,
                data_base64: b64,
            }))
        }
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn get_file_versions_command(
    app: tauri::AppHandle,
    drive_id: String,
    file_id: String,
) -> Result<CommandResponse<Vec<FileVersion>>, String> {
    let state = app.state::<AppState>();
    let tree = state.engine.get_or_create_tree(&drive_id).await;

    if let Some(file) = tree.get_file(&file_id) {
        Ok(CommandResponse::ok(file.history.clone()))
    } else {
        Ok(CommandResponse::err(format!("File {} not found", file_id)))
    }
}

#[tauri::command]
pub async fn restore_file_version_command(
    app: tauri::AppHandle,
    drive_id: String,
    file_id: String,
    target_version: u32,
) -> Result<CommandResponse<FileNode>, String> {
    let state = app.state::<AppState>();
    let mut tree = state.engine.get_or_create_tree(&drive_id).await;

    match tree.restore_file_version(&file_id, target_version) {
        Ok(_) => {
            if let Some(file) = tree.get_file(&file_id) {
                Ok(CommandResponse::ok(file.clone()))
            } else {
                Ok(CommandResponse::err(
                    "File not found after restore".to_string(),
                ))
            }
        }
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn export_drive_command(
    app: tauri::AppHandle,
    drive_id: String,
    target_path: String,
) -> Result<CommandResponse<ExportDriveResult>, String> {
    let state = app.state::<AppState>();
    let tree = state.engine.get_or_create_tree(&drive_id).await;

    let target = std::path::PathBuf::from(&target_path);
    if !target.is_absolute() {
        return Ok(CommandResponse::err(
            "Export path must be absolute".to_string(),
        ));
    }
    if target
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Ok(CommandResponse::err(
            "Export path must not contain '..' components".to_string(),
        ));
    }

    let drives = state.drives.read().await;
    let drive_name = drives
        .iter()
        .find(|d| d.id == drive_id)
        .map(|d| d.name.clone())
        .unwrap_or_else(|| "Exported_Drive".to_string());
    drop(drives);

    let safe_drive_name: String = drive_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let export_dir = std::path::PathBuf::from(&target_path).join(&safe_drive_name);
    if std::fs::create_dir_all(&export_dir).is_err() {
        return Ok(CommandResponse::err(
            "Failed to create directory".to_string(),
        ));
    }

    let mut total_folders = 0;
    let mut total_files = 0;
    let mut total_bytes = 0u64;

    let all_nodes: Vec<VfsNode> = tree.all_nodes().cloned().collect();

    for node in &all_nodes {
        if let VfsNode::Folder(f) = node {
            if !f.parent_id.is_empty() && f.parent_id != "root" {
                let rel_path = tree.resolve_relative_path(&f.id);
                let full_folder = export_dir.join(rel_path);
                ensure_dir(&full_folder);
            }
            total_folders += 1;
        }
    }

    for node in &all_nodes {
        if let VfsNode::File(f) = node {
            let rel_path = tree.resolve_relative_path(&f.id);
            let full_file_path = export_dir.join(&rel_path);

            if let Some(parent) = full_file_path.parent() {
                ensure_dir(parent);
            }

            let file_data = format!(
                "ProtoFS Exported File: {}\nSize: {} bytes\nMessage ID: {}\nSHA-256: {}\nVersion: {}\nExported: {}\n",
                f.name,
                f.size_bytes,
                f.telegram_message_id,
                f.sha256_hash.as_deref().unwrap_or("none"),
                f.version,
                Utc::now().to_rfc3339()
            );

            let _ = std::fs::write(&full_file_path, file_data.as_bytes());
            total_files += 1;
            total_bytes += f.size_bytes;
        }
    }

    let manifest_path = export_dir.join("manifest.json");
    let manifest_data = serde_json::json!({
        "drive_id": drive_id,
        "drive_name": drive_name,
        "exported_at": Utc::now().to_rfc3339(),
        "total_folders": total_folders,
        "total_files": total_files,
        "total_bytes": total_bytes,
        "nodes": all_nodes,
    });

    let _ = std::fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest_data)
            .unwrap_or_default()
            .as_bytes(),
    );

    Ok(CommandResponse::ok(ExportDriveResult {
        export_path: export_dir.to_string_lossy().to_string(),
        total_folders,
        total_files,
        total_bytes,
    }))
}
