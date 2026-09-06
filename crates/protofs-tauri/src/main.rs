#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod commands;

use chrono::Utc;
use commands::AppState;
use protofs_core::cache::CacheDatabase;
use protofs_core::mtproto::MockTelegramTransport;
use protofs_core::sync::SyncEngine;
use protofs_core::vfs::DriveMetadata;
use std::sync::Arc;
use tokio::sync::RwLock;

fn main() {
    tracing_subscriber::fmt::init();

    let appdata_dir = std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("ProtoFS");
    let _ = std::fs::create_dir_all(&appdata_dir);
    let db_path = appdata_dir.join("cache.db");
    let cache = CacheDatabase::open(&db_path)
        .unwrap_or_else(|_| CacheDatabase::open_in_memory().expect("failed to open sqlite cache"));
    let transport = Arc::new(MockTelegramTransport::new());
    let engine = Arc::new(SyncEngine::new(transport, cache.clone()));

    let default_drives = vec![
        DriveMetadata {
            id: "personal".to_string(),
            name: "Personal Drive".to_string(),
            channel_id: -1001928472910,
            pinned_manifest_msg_id: Some(104),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        },
        DriveMetadata {
            id: "work".to_string(),
            name: "Work Archive".to_string(),
            channel_id: -1001982736192,
            pinned_manifest_msg_id: Some(88),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        },
        DriveMetadata {
            id: "media".to_string(),
            name: "Cinema Vault".to_string(),
            channel_id: -1001837492817,
            pinned_manifest_msg_id: Some(210),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        },
    ];

    let app_state = AppState {
        engine,
        cache,
        session: Arc::new(RwLock::new(None)),
        drives: Arc::new(RwLock::new(default_drives)),
    };

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::login_send_code,
            commands::login_verify_code,
            commands::get_session_status,
            commands::logout_command,
            commands::get_drives_command,
            commands::create_drive_command,
            commands::load_drive_command,
            commands::flush_manifest_command,
            commands::create_folder_command,
            commands::upload_file_command,
            commands::delete_node_command,
            commands::restore_node_command,
            commands::empty_trash_command,
            commands::toggle_pin_command,
            commands::search_nodes_command,
            commands::rename_node_command,
            commands::move_node_command,
            commands::get_sync_pairs_command,
            commands::add_sync_pair_command,
            commands::remove_sync_pair_command,
            commands::trigger_sync_command,
            commands::get_storage_usage_command,
            commands::save_secure_secret_command,
            commands::get_secure_secret_command,
            commands::delete_secure_secret_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running protofs desktop application");
}
