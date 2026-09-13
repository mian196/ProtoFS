use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::commands::{AppState, CommandResponse, WebDavServerStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedWebDavSettings {
    pub enabled: bool,
    pub port: u16,
    pub auto_mount: bool,
}

impl Default for PersistedWebDavSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            port: protofs_core::webdav::DEFAULT_WEBDAV_PORT,
            auto_mount: false,
        }
    }
}

pub fn load_webdav_settings(cache: &protofs_core::cache::CacheDatabase) -> PersistedWebDavSettings {
    if let Ok(Some(b)) = cache.get_secure_secret("webdav_settings")
        && let Ok(cfg) = serde_json::from_slice::<PersistedWebDavSettings>(&b)
    {
        return cfg;
    }
    PersistedWebDavSettings::default()
}

pub fn save_webdav_settings(
    cache: &protofs_core::cache::CacheDatabase,
    cfg: &PersistedWebDavSettings,
) {
    if let Ok(b) = serde_json::to_vec(cfg) {
        let _ = cache.set_secure_secret("webdav_settings", &b);
    }
}

#[tauri::command]
pub async fn get_webdav_config_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<WebDavServerStatus>, String> {
    let state = app.state::<AppState>();
    let server = state.webdav_server.read().await;
    let port = server.port().await;
    Ok(CommandResponse::ok(WebDavServerStatus {
        is_running: server.is_running().await,
        port,
        url: format!("http://127.0.0.1:{}/", port),
        auto_mount: server.auto_mount().await,
    }))
}

#[tauri::command]
pub async fn configure_webdav_command(
    app: tauri::AppHandle,
    enabled: bool,
    port: u16,
    auto_mount: bool,
) -> Result<CommandResponse<WebDavServerStatus>, String> {
    let state = app.state::<AppState>();
    let target_port = if port > 0 {
        port
    } else {
        protofs_core::webdav::DEFAULT_WEBDAV_PORT
    };
    save_webdav_settings(
        &state.cache,
        &PersistedWebDavSettings {
            enabled,
            port: target_port,
            auto_mount,
        },
    );

    let mut server = state.webdav_server.write().await;
    let was_running = server.is_running().await;
    let old_port = server.port().await;

    if !enabled {
        if was_running {
            server.stop().await;
        }
    } else {
        server
            .set_config(protofs_core::webdav::WebDavConfig {
                enabled: true,
                port: target_port,
                auto_mount,
                auth_token: None,
            })
            .await;
        if was_running && old_port != target_port {
            server.stop().await;
            let _ = server.start().await;
        } else if !was_running {
            let _ = server.start().await;
        }
    }

    let final_port = server.port().await;
    Ok(CommandResponse::ok(WebDavServerStatus {
        is_running: server.is_running().await,
        port: final_port,
        url: format!("http://127.0.0.1:{}/", final_port),
        auto_mount,
    }))
}
