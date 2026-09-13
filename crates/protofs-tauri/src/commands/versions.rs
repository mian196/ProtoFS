use chrono::Utc;
use protofs_core::vfs::{FileNode, FileVersion, VfsNode};
use tauri::Manager;

use super::{AppState, CommandResponse, ExportDriveResult, ensure_dir};

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

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct FilePreviewResult {
    pub file_id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub is_text: bool,
    pub text_content: Option<String>,
    pub data_base64: Option<String>,
}

#[tauri::command]
pub async fn get_file_preview_command(
    app: tauri::AppHandle,
    drive_id: String,
    file_id: String,
) -> Result<CommandResponse<FilePreviewResult>, String> {
    let state = app.state::<AppState>();
    let drives = state.drives.read().await;
    let drive_meta = drives.iter().find(|d| d.id == drive_id).cloned();
    drop(drives);
    let channel_id = drive_meta.as_ref().map(|d| d.channel_id).unwrap_or(0);

    let tree = state.engine.get_or_create_tree(&drive_id).await;
    let file_node_opt = tree.get_file(&file_id).cloned();
    drop(tree);

    let master_key = if let Some(ref f) = file_node_opt {
        if f.is_encrypted {
            let guard = state.master_key.read().await;
            match *guard {
                Some(k) => Some(k),
                None => {
                    return Ok(CommandResponse::err("File is encrypted but master key is not unlocked"));
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    match state
        .engine
        .download_file_data(&drive_id, &file_id, master_key.as_ref(), channel_id)
        .await
    {
        Ok((file_node, data)) => {
            let mime = file_node.mime_type.clone().unwrap_or_else(|| super::guess_mime(&file_node.name));
            let is_text_mime = mime.starts_with("text/") || mime == "application/json";
            let (is_text, text_content) = if is_text_mime || data.len() < 256 * 1024 {
                if let Ok(text) = std::str::from_utf8(&data) {
                    (true, Some(text.to_string()))
                } else {
                    (false, None)
                }
            } else {
                (false, None)
            };

            use base64::Engine;
            let b64 = if !is_text && data.len() < 50 * 1024 * 1024 {
                Some(base64::engine::general_purpose::STANDARD.encode(&data))
            } else {
                None
            };

            Ok(CommandResponse::ok(FilePreviewResult {
                file_id: file_node.id,
                name: file_node.name,
                mime_type: mime,
                size_bytes: data.len() as u64,
                is_text,
                text_content,
                data_base64: b64,
            }))
        }
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

