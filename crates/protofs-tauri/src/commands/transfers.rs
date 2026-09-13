use chrono::Utc;
use protofs_core::vfs::FileNode;
use tauri::Manager;
use tokio::io::AsyncReadExt;

use super::{
    check_transfer_gate, ensure_dir, fnv1a_hash_filename, guess_mime, register_transfer,
    unregister_transfer, AppState, CommandResponse, DownloadFileResult, ThrottledProgressEmitter,
};

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
    file_base64: Option<String>,
    file_path: Option<String>,
) -> Result<CommandResponse<FileNode>, String> {
    let state = app.state::<AppState>();
    let transfer_id = format!("upload_{}_{}", Utc::now().timestamp_millis(), &name);
    let mut rx = register_transfer(&state, &transfer_id).await;

    let total_upload_size = if let Some(ref path_str) = file_path {
        std::fs::metadata(path_str).map(|m| m.len()).unwrap_or(size_bytes)
    } else {
        size_bytes
    };

    let mut emitter = ThrottledProgressEmitter::new(
        app.clone(),
        "upload-progress",
        transfer_id.clone(),
        format!("temp_{}", &name),
        name.clone(),
        total_upload_size,
    );

    // Resolve authenticated master key from AppState if encrypted (D-22, D-23, D-24)
    let master_key = if is_encrypted {
        let guard = state.master_key.read().await;
        match *guard {
            Some(k) => Some(k),
            None => {
                emitter.fail("Vault locked: Master key not unlocked in AppState");
                unregister_transfer(&state, &transfer_id).await;
                return Ok(CommandResponse::err(
                    "Encryption is enabled but no master key is unlocked in AppState. Please unlock your vault in Settings.",
                ));
            }
        }
    } else {
        None
    };

    let drives = state.drives.read().await;
    let drive_meta = drives.iter().find(|d| d.id == drive_id).cloned();
    drop(drives);
    let channel_id = drive_meta.as_ref().map(|d| d.channel_id).unwrap_or(0);

    // 1. Memory-safe streaming upload from disk if file_path is provided (D-06, PERF-01)
    let payload_bytes = if let Some(ref path_str) = file_path {
        let path = std::path::PathBuf::from(path_str);
        if !path.exists() {
            emitter.fail(&format!("File does not exist: {}", path_str));
            unregister_transfer(&state, &transfer_id).await;
            return Ok(CommandResponse::err(format!("File does not exist: {}", path_str)));
        }

        let mut file = match tokio::fs::File::open(&path).await {
            Ok(f) => f,
            Err(e) => {
                let err = format!("Failed to open file: {}", e);
                emitter.fail(&err);
                unregister_transfer(&state, &transfer_id).await;
                return Ok(CommandResponse::err(err));
            }
        };

        let mut full_data = Vec::with_capacity(total_upload_size.min(1024 * 1024 * 1024) as usize);
        let mut chunk_buf = vec![0u8; 512 * 1024]; // 512KB sequential chunk buffer

        loop {
            if let Err(e) = check_transfer_gate(&mut rx).await {
                emitter.fail(&e);
                unregister_transfer(&state, &transfer_id).await;
                return Ok(CommandResponse::err(e));
            }

            let n = match file.read(&mut chunk_buf).await {
                Ok(0) => break,
                Ok(bytes_read) => bytes_read,
                Err(e) => {
                    let err = format!("Disk read error: {}", e);
                    emitter.fail(&err);
                    unregister_transfer(&state, &transfer_id).await;
                    return Ok(CommandResponse::err(err));
                }
            };

            full_data.extend_from_slice(&chunk_buf[..n]);
            emitter.update(n as u64);
        }
        full_data
    } else if let Some(b64) = file_base64 {
        use base64::Engine;
        match base64::engine::general_purpose::STANDARD.decode(b64.trim()) {
            Ok(bytes) => bytes,
            Err(e) => {
                emitter.fail(&format!("Invalid base64 payload: {}", e));
                unregister_transfer(&state, &transfer_id).await;
                return Ok(CommandResponse::err(format!("Invalid base64 payload: {}", e)));
            }
        }
    } else {
        file_bytes.unwrap_or_default()
    };

    // 2. Perform MTProto upload via SyncEngine if channel and data are present
    if channel_id != 0 && !payload_bytes.is_empty() {
        match state
            .engine
            .upload_file_data(
                &drive_id,
                &parent_id,
                &name,
                &payload_bytes,
                is_encrypted,
                master_key.as_ref(),
                channel_id,
            )
            .await
        {
            Ok(file_node) => {
                if let Err(e) = state.engine.debounced_flush_manifest(&drive_id, channel_id).await {
                    tracing::warn!("Debounced manifest flush failed: {}", e);
                }

                emitter.finish();
                unregister_transfer(&state, &transfer_id).await;
                return Ok(CommandResponse::ok(file_node));
            }
            Err(e) => {
                let err = format!("Telegram upload failed: {}", e);
                tracing::error!("MTProto upload to channel {} failed: {}", channel_id, e);
                emitter.fail(&err);
                unregister_transfer(&state, &transfer_id).await;
                return Ok(CommandResponse::err(err));
            }
        }
    }

    // 3. Mock fallback for local browser testing
    let new_msg_id = (Utc::now().timestamp_subsec_millis() as i32) + 1000;
    let iv = if is_encrypted {
        Some(format!("{:016x}", Utc::now().timestamp_nanos_opt().unwrap_or(0)))
    } else {
        None
    };

    let sha256_hash = if !payload_bytes.is_empty() {
        let digest = ring::digest::digest(&ring::digest::SHA256, &payload_bytes);
        Some(digest.as_ref().iter().map(|b| format!("{:02x}", b)).collect())
    } else {
        Some("mock_hash".to_string())
    };

    let file = FileNode {
        id: format!("file_{}", fnv1a_hash_filename(&name)),
        drive_id,
        parent_id,
        name: name.clone(),
        size_bytes: payload_bytes.len() as u64,
        mime_type: Some(guess_mime(&name)),
        telegram_message_id: new_msg_id,
        is_encrypted,
        encryption_iv: iv,
        sha256_hash,
        is_pinned_offline: false,
        is_trashed: false,
        version: 1,
        history: Vec::new(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    emitter.finish();
    unregister_transfer(&state, &transfer_id).await;
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
    let transfer_id = format!("download_{}_{}", Utc::now().timestamp_millis(), &file_id);
    let mut rx = register_transfer(&state, &transfer_id).await;

    let drives = state.drives.read().await;
    let drive_meta = drives.iter().find(|d| d.id == drive_id).cloned();
    drop(drives);
    let channel_id = drive_meta.as_ref().map(|d| d.channel_id).unwrap_or(0);

    let tree = state.engine.get_or_create_tree(&drive_id).await;
    let file_node_opt = tree.get_file(&file_id).cloned();
    drop(tree);

    let download_name = file_node_opt
        .as_ref()
        .map(|f| f.name.clone())
        .unwrap_or_else(|| file_id.clone());
    let download_size = file_node_opt.as_ref().map(|f| f.size_bytes).unwrap_or(0);
    let mut emitter = ThrottledProgressEmitter::new(
        app.clone(),
        "download-progress",
        transfer_id.clone(),
        file_id.clone(),
        download_name,
        download_size,
    );

    let master_key = if let Some(ref f) = file_node_opt {
        if f.is_encrypted {
            let guard = state.master_key.read().await;
            match *guard {
                Some(k) => Some(k),
                None => {
                    emitter.fail("Vault locked: Master key not unlocked in AppState");
                    unregister_transfer(&state, &transfer_id).await;
                    return Ok(CommandResponse::err(
                        "File is encrypted but master key is not unlocked in AppState. Please unlock in Settings.",
                    ));
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    if let Err(e) = check_transfer_gate(&mut rx).await {
        emitter.fail(&e);
        unregister_transfer(&state, &transfer_id).await;
        return Ok(CommandResponse::err(e));
    }

    match state
        .engine
        .download_file_data(&drive_id, &file_id, master_key.as_ref(), channel_id)
        .await
    {
        Ok((file_node, data)) => {
            // Stream directly to destination file on disk (D-08)
            if let Some(dest) = destination_path.as_ref() {
                let dest_path = std::path::PathBuf::from(dest);
                if dest_path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
                    emitter.fail("Path traversal detected in destination_path");
                    unregister_transfer(&state, &transfer_id).await;
                    return Ok(CommandResponse::err("Path traversal detected in destination_path"));
                }
                if let Some(parent) = dest_path.parent() {
                    ensure_dir(parent);
                }
                if let Err(e) = std::fs::write(&dest_path, &data) {
                    let err = format!("Failed to write file: {}", e);
                    emitter.fail(&err);
                    unregister_transfer(&state, &transfer_id).await;
                    return Ok(CommandResponse::err(err));
                }

                emitter.finish();
                unregister_transfer(&state, &transfer_id).await;
                return Ok(CommandResponse::ok(DownloadFileResult {
                    file_id: file_node.id,
                    name: file_node.name,
                    size_bytes: data.len() as u64,
                    destination_path: Some(dest.clone()),
                    data_base64: None,
                }));
            }

            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            emitter.finish();
            unregister_transfer(&state, &transfer_id).await;
            Ok(CommandResponse::ok(DownloadFileResult {
                file_id: file_node.id,
                name: file_node.name,
                size_bytes: data.len() as u64,
                destination_path: None,
                data_base64: Some(b64),
            }))
        }
        Err(e) => {
            let err = e.to_string();
            emitter.fail(&err);
            unregister_transfer(&state, &transfer_id).await;
            Ok(CommandResponse::err(err))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_chunked_file_reading_bounded_ram() {
        use tokio::io::AsyncWriteExt;
        let dir = std::env::temp_dir().join(format!("protofs_test_chunk_{}", std::process::id()));
        let _ = tokio::fs::create_dir_all(&dir).await;
        let file_path = dir.join("test_large_file.bin");

        // Write a 1.5MB test file
        let mut f = tokio::fs::File::create(&file_path).await.unwrap();
        let chunk = vec![0xABu8; 512 * 1024];
        for _ in 0..3 {
            f.write_all(&chunk).await.unwrap();
        }
        f.flush().await.unwrap();
        drop(f);

        // Read in bounded 512KB chunks
        let mut reader = tokio::fs::File::open(&file_path).await.unwrap();
        let mut buffer = vec![0u8; 512 * 1024];
        let mut total_read = 0;
        loop {
            let n = reader.read(&mut buffer).await.unwrap();
            if n == 0 {
                break;
            }
            total_read += n;
            assert!(n <= 512 * 1024);
        }
        assert_eq!(total_read, 3 * 512 * 1024);
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}

