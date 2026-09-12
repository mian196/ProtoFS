use chrono::Utc;
use protofs_core::cache::SearchResult;
use protofs_core::vfs::{FolderNode, VfsNode};
use tauri::Manager;

use super::{AppState, CommandResponse};

#[tauri::command]
pub async fn create_folder_command(
    app: tauri::AppHandle,
    drive_id: String,
    parent_id: String,
    name: String,
) -> Result<CommandResponse<FolderNode>, String> {
    let state = app.state::<AppState>();
    static FOLDER_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let id = format!(
        "f_{}_{}",
        Utc::now().timestamp_millis(),
        FOLDER_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    let folder = FolderNode {
        id: id.clone(),
        drive_id: drive_id.clone(),
        parent_id,
        name,
        is_trashed: false,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    if let Err(e) = state
        .engine
        .add_node(&drive_id, VfsNode::Folder(folder.clone()))
        .await
    {
        return Ok(CommandResponse::err(e.to_string()));
    }

    Ok(CommandResponse::ok(folder))
}

#[tauri::command]
pub async fn delete_node_command(
    app: tauri::AppHandle,
    drive_id: String,
    node_id: String,
    permanent: bool,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    let res = if permanent {
        state.engine.delete_node(&drive_id, &node_id).await
    } else {
        state.engine.trash_node(&drive_id, &node_id).await
    };

    match res {
        Ok(_) => Ok(CommandResponse::ok(())),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn restore_node_command(
    app: tauri::AppHandle,
    drive_id: String,
    node_id: String,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    match state.engine.restore_node(&drive_id, &node_id).await {
        Ok(_) => Ok(CommandResponse::ok(())),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn empty_trash_command(
    app: tauri::AppHandle,
    drive_id: String,
) -> Result<CommandResponse<usize>, String> {
    let state = app.state::<AppState>();
    match state.engine.empty_trash(&drive_id).await {
        Ok(count) => Ok(CommandResponse::ok(count)),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

#[tauri::command]
pub async fn toggle_pin_command(
    app: tauri::AppHandle,
    drive_id: String,
    node_id: String,
    pinned: bool,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    match state.engine.toggle_pin(&drive_id, &node_id, pinned).await {
        Ok(_) => Ok(CommandResponse::ok(())),
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
pub async fn rename_node_command(
    app: tauri::AppHandle,
    drive_id: String,
    node_id: String,
    new_name: String,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Ok(CommandResponse::err("Node name cannot be empty"));
    }
    if let Err(e) = state.engine.rename_node(&drive_id, &node_id, trimmed).await {
        return Ok(CommandResponse::err(e.to_string()));
    }
    let _ = state
        .cache
        .rename_node_in_cache(&drive_id, &node_id, trimmed);
    Ok(CommandResponse::ok(()))
}

#[tauri::command]
pub async fn move_node_command(
    app: tauri::AppHandle,
    drive_id: String,
    node_id: String,
    new_parent_id: String,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    if let Err(e) = state
        .engine
        .move_node(&drive_id, &node_id, &new_parent_id)
        .await
    {
        return Ok(CommandResponse::err(e.to_string()));
    }
    let _ = state
        .cache
        .move_node_in_cache(&drive_id, &node_id, &new_parent_id);
    Ok(CommandResponse::ok(()))
}
