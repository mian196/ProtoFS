use std::sync::Arc;
use serde::{Deserialize, Serialize};

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

pub async fn load_drive_command(
    state: &AppState,
    drive_id: String,
    channel_id: i64,
) -> CommandResponse<Vec<VfsNode>> {
    match state.engine.load_drive(&drive_id, channel_id).await {
        Ok(tree) => {
            let nodes: Vec<VfsNode> = tree.all_nodes().cloned().collect();
            CommandResponse::ok(nodes)
        }
        Err(e) => CommandResponse::err(e.to_string()),
    }
}

pub async fn search_nodes_command(
    state: &AppState,
    drive_id: String,
    query: String,
) -> CommandResponse<Vec<SearchResult>> {
    match state.cache.search(&drive_id, &query) {
        Ok(results) => CommandResponse::ok(results),
        Err(e) => CommandResponse::err(e.to_string()),
    }
}

pub async fn flush_manifest_command(
    state: &AppState,
    drive_id: String,
    channel_id: i64,
) -> CommandResponse<()> {
    match state.engine.flush_manifest(&drive_id, channel_id).await {
        Ok(_) => CommandResponse::ok(()),
        Err(e) => CommandResponse::err(e.to_string()),
    }
}
