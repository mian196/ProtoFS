#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod commands;

use commands::AppState;
use protofs_core::cache::CacheDatabase;
use protofs_core::mtproto::{DynamicTelegramTransport, TelegramAuthClient};
use protofs_core::sync::SyncEngine;
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
    let transport = DynamicTelegramTransport::new_mock();
    let engine = Arc::new(SyncEngine::new(Arc::new(transport.clone()), cache.clone()));
    let auth_client = Arc::new(TelegramAuthClient::new());

    let app_state = AppState {
        engine,
        cache,
        session: Arc::new(RwLock::new(None)),
        drives: Arc::new(RwLock::new(Vec::new())),
        auth_client,
        transport,
    };

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::login_send_code,
            commands::login_verify_code,
            commands::login_verify_2fa,
            commands::login_request_qr,
            commands::login_check_qr,
            commands::get_session_status,
            commands::list_accounts_command,
            commands::switch_account_command,
            commands::remove_account_command,
            commands::logout_command,
            commands::get_drives_command,
            commands::create_drive_command,
            commands::get_owned_channels_command,
            commands::adopt_channel_as_drive_command,
            commands::load_drive_command,
            commands::flush_manifest_command,
            commands::create_folder_command,
            commands::upload_file_command,
            commands::get_file_versions_command,
            commands::restore_file_version_command,
            commands::export_drive_command,
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
            commands::get_camera_backup_config_command,
            commands::configure_camera_backup_command,
            commands::get_storage_usage_command,
            commands::save_secure_secret_command,
            commands::get_secure_secret_command,
            commands::delete_secure_secret_command,
            commands::check_for_updates_command,
            commands::get_shell_integration_status_command,
            commands::set_shell_integration_command,
            commands::get_pending_uploads_command,
            commands::open_path_in_explorer_command,
            commands::generate_share_link_command,
            commands::parse_share_link_command,
            commands::import_shared_link_command,
            commands::get_virtual_drive_status_command,
            commands::mount_virtual_drive_command,
            commands::unmount_virtual_drive_command,
            commands::open_virtual_drive_in_explorer_command,
            commands::clear_virtual_drive_cache_command,
            commands::get_documents_provider_status_command,
            commands::toggle_documents_provider_command,
            commands::notify_documents_provider_change_command,
            commands::test_saf_document_query_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running protofs desktop application");
}
