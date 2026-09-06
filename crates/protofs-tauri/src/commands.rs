use serde::{Deserialize, Serialize};
use std::sync::Arc;

use protofs_core::cache::{CacheDatabase, SearchResult};
use protofs_core::mtproto::MockTelegramTransport;
use protofs_core::sync::SyncEngine;
use protofs_core::vfs::VfsNode;

#[derive(Clone)]
pub struct AppState {
    pub engine: Arc<SyncEngine<MockTelegramTransport>>,
    pub cache: CacheDatabase,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> CommandResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}

use tauri::Manager;

#[tauri::command]
pub async fn load_drive_command(
    app: tauri::AppHandle,
    drive_id: String,
    channel_id: i64,
) -> Result<CommandResponse<Vec<VfsNode>>, String> {
    let state = app.state::<AppState>();
    match state.engine.load_drive(&drive_id, channel_id).await {
        Ok(tree) => {
            let nodes: Vec<VfsNode> = tree.all_nodes().cloned().collect();
            Ok(CommandResponse::ok(nodes))
        }
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn search_nodes_command(
    app: tauri::AppHandle,
    drive_id: String,
    query: String,
) -> Result<CommandResponse<Vec<SearchResult>>, String> {
    let state = app.state::<AppState>();
    match state.cache.search(&drive_id, &query) {
        Ok(results) => Ok(CommandResponse::ok(results)),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn flush_manifest_command(
    app: tauri::AppHandle,
    drive_id: String,
    channel_id: i64,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    match state.engine.flush_manifest(&drive_id, channel_id).await {
        Ok(_) => Ok(CommandResponse::ok(())),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}
