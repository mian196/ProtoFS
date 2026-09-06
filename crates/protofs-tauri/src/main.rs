#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod commands;

use commands::AppState;
use protofs_core::cache::CacheDatabase;
use protofs_core::mtproto::MockTelegramTransport;
use protofs_core::sync::SyncEngine;
use std::sync::Arc;

fn main() {
    tracing_subscriber::fmt::init();

    let transport = Arc::new(MockTelegramTransport::new());
    let cache = CacheDatabase::open_in_memory().expect("failed to open in-memory sqlite cache");
    let engine = Arc::new(SyncEngine::new(transport, cache.clone()));

    let app_state = AppState { engine, cache };

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::load_drive_command,
            commands::search_nodes_command,
            commands::flush_manifest_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running protofs desktop application");
}
