pub mod commands;

use commands::AppState;
use protofs_core::cache::CacheDatabase;
use protofs_core::mtproto::{DynamicTelegramTransport, TelegramAuthClient};
use protofs_core::sync::SyncEngine;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let appdata_dir = std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("ProtoFS");
    let logs_dir = appdata_dir.join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);
    let log_file_path = logs_dir.join("protofs.log");

    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;

    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        tracing_subscriber::EnvFilter::new("protofs_core=debug,protofs_tauri=debug,info")
    });

    if let Ok(file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file_path)
    {
        let file_layer = tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .with_writer(std::sync::Arc::new(file));
        let stdout_layer = tracing_subscriber::fmt::layer();
        let _ = tracing_subscriber::registry()
            .with(filter)
            .with(stdout_layer)
            .with(file_layer)
            .try_init();
    } else {
        let _ = tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer())
            .try_init();
    }

    tracing::info!("ProtoFS starting up. Log file: {}", log_file_path.display());

    tauri::Builder::default()
        .setup(|app| {
            let appdata_dir = app.path().app_data_dir().unwrap_or_else(|_| {
                std::env::var("APPDATA")
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|_| std::env::temp_dir())
                    .join("ProtoFS")
            });
            let _ = std::fs::create_dir_all(&appdata_dir);
            let db_path = appdata_dir.join("cache.db");
            let cache = CacheDatabase::open(&db_path).unwrap_or_else(|_| {
                CacheDatabase::open_in_memory().expect("failed to open sqlite cache")
            });
            let transport = DynamicTelegramTransport::new_unauthenticated();
            let engine = Arc::new(SyncEngine::new(Arc::new(transport.clone()), cache.clone()));
            let auth_client = Arc::new(TelegramAuthClient::new());

            let drives_state = Arc::new(RwLock::new(Vec::new()));
            let webdav_settings = commands::load_webdav_settings(&cache);
            let webdav_config = protofs_core::webdav::WebDavConfig {
                enabled: webdav_settings.enabled,
                port: webdav_settings.port,
                auto_mount: webdav_settings.auto_mount,
                auth_token: None,
            };
            let master_key = Arc::new(RwLock::new(None));
            let webdav_server = Arc::new(RwLock::new(protofs_core::webdav::WebDavServer::new(
                engine.clone(),
                drives_state.clone(),
                webdav_config.clone(),
                master_key.clone(),
            )));

            let app_state = AppState {
                engine,
                cache,
                session: Arc::new(RwLock::new(None)),
                drives: drives_state,
                auth_client,
                transport,
                webdav_server: webdav_server.clone(),
                master_key,
                active_transfers: Arc::new(RwLock::new(std::collections::HashMap::new())),
            };

            // Cleanup any stale virtual drive mounts left from a previous unclean exit
            commands::unmount_all_virtual_drives_cleanup(app.handle());

            // Start WebDAV server in background if enabled
            if webdav_config.enabled {
                let s_clone = webdav_server.clone();
                tauri::async_runtime::spawn(async move {
                    let mut s = s_clone.write().await;
                    if let Err(e) = s.start().await {
                        tracing::warn!("Failed to start WebDAV background server: {}", e);
                    }
                });
            }

            // Attempt auto-unlock if "vault_auto_unlock" secret exists (Windows DPAPI / machine-bound)
            if let Ok(Some(secret_bytes)) = app_state.cache.get_secure_secret("vault_auto_unlock")
                && secret_bytes.len() == 32
            {
                let mut key = [0u8; 32];
                key.copy_from_slice(&secret_bytes);
                *app_state.master_key.blocking_write() = Some(key);
                tracing::info!("Security vault auto-unlocked successfully via secure storage");
            }

            // Initialize active proxy if enabled (D-15)
            if app_state.cache.is_proxy_enabled().unwrap_or(false)
                && let Ok(Some(active_proxy)) = app_state.cache.get_active_proxy()
            {
                match active_proxy.to_proxy_config() {
                    Ok(cfg) => {
                        app_state.auth_client.set_proxy_sync(Some(cfg.clone()));
                        let t_clone = app_state.transport.clone();
                        let a_clone = app_state.auth_client.clone();
                        let label = active_proxy.label.clone();
                        let host = active_proxy.host.clone();
                        let port = active_proxy.port;
                        tauri::async_runtime::spawn(async move {
                            t_clone.set_proxy(Some(cfg.clone())).await;
                            a_clone.set_proxy(Some(cfg)).await;
                            tracing::info!(
                                "Startup active proxy initialized from cache: {} ({}:{})",
                                label,
                                host,
                                port
                            );
                        });
                    }
                    Err(e) => {
                        tracing::warn!("Failed to parse active proxy on startup: {}", e);
                    }
                }
            }

            app.manage(app_state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                commands::unmount_all_virtual_drives_cleanup(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::login_send_code,
            commands::login_verify_code,
            commands::login_verify_2fa,
            commands::login_request_qr,
            commands::login_check_qr,
            commands::get_session_status,
            commands::check_telegram_connection_command,
            commands::list_accounts_command,
            commands::switch_account_command,
            commands::remove_account_command,
            commands::logout_command,
            commands::get_drives_command,
            commands::create_drive_command,
            commands::delete_drive_command,
            commands::sync_and_prune_drives_command,
            commands::sync_chat_folder_command,
            commands::get_owned_channels_command,
            commands::adopt_channel_as_drive_command,
            commands::check_drive_health_command,
            commands::export_drive_manifest_command,
            commands::load_drive_command,
            commands::flush_manifest_command,
            commands::create_folder_command,
            commands::upload_file_command,
            commands::download_file_command,
            commands::get_file_preview_command,
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
            commands::purge_local_cache_command,
            commands::get_shell_integration_status_command,
            commands::set_shell_integration_command,
            commands::get_pending_uploads_command,
            commands::open_path_in_explorer_command,
            commands::generate_share_link_command,
            commands::parse_share_link_command,
            commands::import_shared_link_command,
            commands::get_webdav_config_command,
            commands::configure_webdav_command,
            commands::get_virtual_drive_status_command,
            commands::mount_virtual_drive_command,
            commands::unmount_virtual_drive_command,
            commands::open_virtual_drive_in_explorer_command,
            commands::clear_virtual_drive_cache_command,
            commands::get_documents_provider_status_command,
            commands::toggle_documents_provider_command,
            commands::notify_documents_provider_change_command,
            commands::test_saf_document_query_command,
            commands::get_workmanager_sync_status_command,
            commands::configure_workmanager_sync_command,
            commands::trigger_immediate_background_sync_command,
            commands::get_workmanager_history_command,
            commands::get_p2p_status_command,
            commands::start_p2p_session_command,
            commands::connect_p2p_peer_command,
            commands::cancel_p2p_session_command,
            commands::cancel_transfer_command,
            commands::pause_transfer_command,
            commands::resume_transfer_command,
            commands::get_vault_status_command,
            commands::unlock_vault_command,
            commands::lock_vault_command,
            commands::set_vault_passphrase_command,
            commands::get_recovery_phrase_command,
            commands::recover_vault_command,
            commands::test_proxy_connection_command,
            commands::get_proxies_command,
            commands::get_proxy_command,
            commands::save_proxy_command,
            commands::delete_proxy_command,
            commands::set_active_proxy_command,
            commands::toggle_proxy_enabled_command,
            commands::get_proxy_status_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running protofs application");
}
