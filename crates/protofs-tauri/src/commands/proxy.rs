use chrono::Utc;
use protofs_core::cache::{ProxyProfile, ProxyProfileSummary};
use protofs_core::mtproto::proxy::{ProxyConfig, ProxyDiagnosticResult, run_proxy_diagnostic};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use super::{AppState, CommandResponse};

/// Aggregate status response for UI indicators and status bars.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProxyStatusResponse {
    pub is_enabled: bool,
    pub active_proxy: Option<ProxyProfileSummary>,
    pub total_proxies: usize,
}

/// Payload emitted over the `proxy-state-changed` event stream.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProxyStateChangedPayload {
    pub is_enabled: bool,
    pub active_proxy_id: Option<String>,
    pub active_proxy_label: Option<String>,
    pub timestamp: String,
}

/// Synchronizes the runtime MTProto dynamic transport and Telegram auth client with the active proxy stored in SQLite cache.
pub(crate) async fn sync_transport_proxy(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<(), String> {
    let is_enabled = state
        .cache
        .is_proxy_enabled()
        .map_err(|e| format!("Failed to read proxy enabled state: {}", e))?;

    let active_profile = state
        .cache
        .get_active_proxy()
        .map_err(|e| format!("Failed to read active proxy profile: {}", e))?;

    let (active_id, active_label) = if let Some(ref prof) = active_profile {
        (Some(prof.id.clone()), Some(prof.label.clone()))
    } else {
        (None, None)
    };

    if is_enabled && let Some(ref prof) = active_profile {
        match prof.to_proxy_config() {
            Ok(cfg) => {
                state.transport.set_proxy(Some(cfg.clone())).await;
                state.auth_client.set_proxy(Some(cfg)).await;
                tracing::info!(
                    "Dynamic transport hot-swapped to active proxy: {} ({}:{})",
                    prof.label,
                    prof.host,
                    prof.port
                );
            }
            Err(err) => {
                tracing::warn!(
                    "Failed to parse active proxy configuration for {}: {}",
                    prof.label,
                    err
                );
                state.transport.set_proxy(None).await;
                state.auth_client.set_proxy(None).await;
            }
        }
    } else {
        state.transport.set_proxy(None).await;
        state.auth_client.set_proxy(None).await;
        tracing::info!("Dynamic transport set to direct connection (proxy disabled or unset)");
    }

    let payload = ProxyStateChangedPayload {
        is_enabled,
        active_proxy_id: active_id,
        active_proxy_label: active_label,
        timestamp: Utc::now().to_rfc3339(),
    };

    let _ = app.emit("proxy-state-changed", payload);
    Ok(())
}

/// Tests proxy reachability and measures round-trip latency to a Telegram DC (D-01, D-02, D-03, D-04).
#[tauri::command]
pub async fn test_proxy_connection_command(
    app: tauri::AppHandle,
    draft_config: Option<ProxyConfig>,
    target_dc: Option<u8>,
) -> Result<CommandResponse<ProxyDiagnosticResult>, String> {
    let state = app.state::<AppState>();

    let config_to_test = if let Some(draft) = draft_config {
        Some(draft)
    } else {
        // Fallback to active proxy configuration in database
        match state.cache.get_active_proxy() {
            Ok(Some(active)) => match active.to_proxy_config() {
                Ok(cfg) => Some(cfg),
                Err(e) => {
                    return Ok(CommandResponse::err(format!(
                        "Invalid active proxy configuration: {}",
                        e
                    )));
                }
            },
            Ok(None) => None,
            Err(e) => {
                return Ok(CommandResponse::err(format!(
                    "Database error reading active proxy: {}",
                    e
                )));
            }
        }
    };

    let result = run_proxy_diagnostic(config_to_test.as_ref(), target_dc).await;
    Ok(CommandResponse::ok(result))
}

/// Returns all saved proxy profiles as masked summaries for the UI overview list (D-05, D-10).
#[tauri::command]
pub async fn get_proxies_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<Vec<ProxyProfileSummary>>, String> {
    let state = app.state::<AppState>();
    match state.cache.get_proxies() {
        Ok(list) => Ok(CommandResponse::ok(list)),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

/// Loads a single proxy profile by ID with decrypted secrets for the edit modal (D-10).
#[tauri::command]
pub async fn get_proxy_command(
    app: tauri::AppHandle,
    id: String,
) -> Result<CommandResponse<Option<ProxyProfile>>, String> {
    let state = app.state::<AppState>();
    match state.cache.get_proxy(&id) {
        Ok(prof) => Ok(CommandResponse::ok(prof)),
        Err(e) => Ok(CommandResponse::err(e.to_string())),
    }
}

/// Creates or updates a proxy profile, storing credentials encrypted via DPAPI/HKDF and hot-reloading transport (D-07, D-09, D-13).
#[tauri::command]
pub async fn save_proxy_command(
    app: tauri::AppHandle,
    profile: ProxyProfile,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    if let Err(e) = state.cache.save_proxy(&profile) {
        return Ok(CommandResponse::err(e.to_string()));
    }

    if let Err(e) = sync_transport_proxy(&app, &state).await {
        tracing::warn!("Failed to hot-reload transport after saving proxy: {}", e);
    }

    Ok(CommandResponse::ok(()))
}

/// Deletes a proxy profile and purges its DPAPI secrets atomically (D-11, D-13).
#[tauri::command]
pub async fn delete_proxy_command(
    app: tauri::AppHandle,
    id: String,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    if let Err(e) = state.cache.delete_proxy(&id) {
        return Ok(CommandResponse::err(e.to_string()));
    }

    if let Err(e) = sync_transport_proxy(&app, &state).await {
        tracing::warn!("Failed to hot-reload transport after deleting proxy: {}", e);
    }

    Ok(CommandResponse::ok(()))
}

/// Sets the active proxy profile by ID and hot-reloads runtime transport (D-08, D-13).
#[tauri::command]
pub async fn set_active_proxy_command(
    app: tauri::AppHandle,
    id: Option<String>,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    if let Err(e) = state.cache.set_active_proxy(id.as_deref()) {
        return Ok(CommandResponse::err(e.to_string()));
    }

    if let Err(e) = sync_transport_proxy(&app, &state).await {
        tracing::warn!(
            "Failed to hot-reload transport after setting active proxy: {}",
            e
        );
    }

    Ok(CommandResponse::ok(()))
}

/// Toggles the global proxy enabled state and hot-reloads runtime transport (D-06, D-08, D-13).
#[tauri::command]
pub async fn toggle_proxy_enabled_command(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    if let Err(e) = state.cache.set_proxy_enabled(enabled) {
        return Ok(CommandResponse::err(e.to_string()));
    }

    if let Err(e) = sync_transport_proxy(&app, &state).await {
        tracing::warn!(
            "Failed to hot-reload transport after toggling proxy enabled: {}",
            e
        );
    }

    Ok(CommandResponse::ok(()))
}

/// Returns the overall proxy status including active profile and total counts (D-16).
#[tauri::command]
pub async fn get_proxy_status_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<ProxyStatusResponse>, String> {
    let state = app.state::<AppState>();
    let is_enabled = match state.cache.is_proxy_enabled() {
        Ok(en) => en,
        Err(e) => return Ok(CommandResponse::err(e.to_string())),
    };

    let proxies = match state.cache.get_proxies() {
        Ok(list) => list,
        Err(e) => return Ok(CommandResponse::err(e.to_string())),
    };

    let total_proxies = proxies.len();
    let active_proxy = proxies.into_iter().find(|p| p.is_active);

    Ok(CommandResponse::ok(ProxyStatusResponse {
        is_enabled,
        active_proxy,
        total_proxies,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proxy_status_response_serde() {
        let resp = ProxyStatusResponse {
            is_enabled: true,
            active_proxy: Some(ProxyProfileSummary {
                id: "p1".to_string(),
                label: "My Proxy".to_string(),
                proxy_type: protofs_core::mtproto::proxy::ProxyType::Socks5,
                host: "127.0.0.1".to_string(),
                port: 1080,
                username: Some("user".to_string()),
                has_password: true,
                masked_secret: None,
                is_active: true,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            }),
            total_proxies: 3,
        };

        let json = serde_json::to_string(&resp).unwrap();
        let parsed: ProxyStatusResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(resp, parsed);
    }

    #[test]
    fn test_proxy_state_changed_payload_serde() {
        let payload = ProxyStateChangedPayload {
            is_enabled: true,
            active_proxy_id: Some("p1".to_string()),
            active_proxy_label: Some("Primary SOCKS5".to_string()),
            timestamp: Utc::now().to_rfc3339(),
        };

        let json = serde_json::to_string(&payload).unwrap();
        let parsed: ProxyStateChangedPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(payload, parsed);
    }
}
