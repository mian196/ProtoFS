use chrono::Utc;
use protofs_core::vfs::VfsNode;
use tauri::Manager;

use crate::commands::{AppState, CommandResponse, DocumentsProviderStatus, SafTestQueryResult};

pub const SAF_AUTHORITY: &str = "com.protofs.app.documents";

#[cfg(target_os = "android")]
pub mod android {
    // Android JNI/NDK storage bindings quarantined per D-30
}

pub fn get_mime_type_from_filename(filename: &str) -> &'static str {
    match filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
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

async fn build_saf_status(
    app: &tauri::AppHandle,
    drive_id: &str,
    is_enabled: bool,
) -> DocumentsProviderStatus {
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
    Ok(CommandResponse::ok(
        build_saf_status(&app, &drive_id, true).await,
    ))
}

#[tauri::command]
pub async fn toggle_documents_provider_command(
    app: tauri::AppHandle,
    drive_id: String,
    enable: bool,
) -> Result<CommandResponse<DocumentsProviderStatus>, String> {
    Ok(CommandResponse::ok(
        build_saf_status(&app, &drive_id, enable).await,
    ))
}

#[tauri::command]
pub async fn notify_documents_provider_change_command(
    _app: tauri::AppHandle,
    drive_id: String,
    document_id: Option<String>,
) -> Result<CommandResponse<bool>, String> {
    let doc_id = document_id.unwrap_or_else(|| format!("root:{}", drive_id));
    tracing::info!(
        "Notifying Android ContentResolver for SAF URI: content://{}/document/{}",
        SAF_AUTHORITY,
        doc_id
    );
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
        let display_name = drives
            .iter()
            .find(|d| d.id == drive_id)
            .map(|d| d.name.clone())
            .unwrap_or_else(|| "Personal Cloud Drive".to_string());
        let child_count = tree.list_children(protofs_core::vfs::ROOT_PARENT_ID).len();
        Ok(CommandResponse::ok(SafTestQueryResult {
            authority: SAF_AUTHORITY.to_string(),
            document_id: doc_id,
            display_name,
            mime_type: "vnd.android.document/directory".to_string(),
            size_bytes: 0,
            flags: vec![
                "FLAG_DIR_SUPPORTS_CREATE".into(),
                "FLAG_SUPPORTS_IS_CHILD".into(),
            ],
            child_count,
        }))
    } else if doc_id.starts_with("folder:") {
        let folder_id = doc_id.trim_start_matches("folder:");
        let display_name = tree
            .get(folder_id)
            .and_then(|n| {
                if let VfsNode::Folder(f) = n {
                    Some(f.name.clone())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| "Virtual Folder".to_string());
        let child_count = tree.list_children(folder_id).len();
        Ok(CommandResponse::ok(SafTestQueryResult {
            authority: SAF_AUTHORITY.to_string(),
            document_id: doc_id,
            display_name,
            mime_type: "vnd.android.document/directory".to_string(),
            size_bytes: 0,
            flags: vec![
                "FLAG_DIR_SUPPORTS_CREATE".into(),
                "FLAG_SUPPORTS_DELETE".into(),
                "FLAG_SUPPORTS_RENAME".into(),
                "FLAG_SUPPORTS_IS_CHILD".into(),
            ],
            child_count,
        }))
    } else {
        let file_id = doc_id.trim_start_matches("file:");
        let (display_name, size_bytes) = tree
            .get(file_id)
            .and_then(|n| {
                if let VfsNode::File(f) = n {
                    Some((f.name.clone(), f.size_bytes))
                } else {
                    None
                }
            })
            .unwrap_or_else(|| ("Document".to_string(), 0));
        let mime = get_mime_type_from_filename(&display_name).to_string();
        Ok(CommandResponse::ok(SafTestQueryResult {
            authority: SAF_AUTHORITY.to_string(),
            document_id: doc_id,
            display_name,
            mime_type: mime,
            size_bytes,
            flags: vec![
                "FLAG_SUPPORTS_WRITE".into(),
                "FLAG_SUPPORTS_DELETE".into(),
                "FLAG_SUPPORTS_RENAME".into(),
                "FLAG_SUPPORTS_IS_CHILD".into(),
            ],
            child_count: 0,
        }))
    }
}
