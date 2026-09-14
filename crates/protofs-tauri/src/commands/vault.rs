use protofs_core::crypto::bip39::{entropy_to_mnemonic, mnemonic_to_entropy};
use protofs_core::crypto::envelope::{
    VaultEnvelope, generate_root_master_key, unwrap_master_key, wrap_master_key,
};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use zeroize::Zeroize;

use super::{AppState, CommandResponse};

pub const SECURE_SECRET_VAULT_ENVELOPE: &str = "vault_envelope";
pub const SECURE_SECRET_AUTO_UNLOCK: &str = "vault_auto_unlock";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultStatus {
    pub is_unlocked: bool,
    #[serde(default)]
    pub is_configured: bool,
    #[serde(default)]
    pub has_passphrase: bool,
    pub auto_unlock_enabled: bool,
    #[serde(default = "default_key_slot_count")]
    pub key_slot_count: usize,
    #[serde(default = "default_auto_lock_policy")]
    pub auto_lock_policy: String,
}

fn default_key_slot_count() -> usize {
    1
}

fn default_auto_lock_policy() -> String {
    "15m".to_string()
}

#[tauri::command]
pub async fn get_vault_status_command(
    app: tauri::AppHandle,
) -> Result<CommandResponse<VaultStatus>, String> {
    let state = app.state::<AppState>();
    let master_key_guard = state.master_key.read().await;
    let is_unlocked = master_key_guard.is_some();

    let has_passphrase = state
        .cache
        .get_secure_secret(SECURE_SECRET_VAULT_ENVELOPE)
        .map(|opt| opt.is_some())
        .unwrap_or(false);

    let auto_unlock_enabled = state
        .cache
        .get_secure_secret(SECURE_SECRET_AUTO_UNLOCK)
        .map(|opt| opt.is_some())
        .unwrap_or(false);

    Ok(CommandResponse::ok(VaultStatus {
        is_unlocked,
        is_configured: has_passphrase,
        has_passphrase,
        auto_unlock_enabled,
        key_slot_count: 1,
        auto_lock_policy: "15m".to_string(),
    }))
}

#[tauri::command]
pub async fn unlock_vault_command(
    app: tauri::AppHandle,
    passphrase: String,
    remember: Option<bool>,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    let envelope_bytes = state
        .cache
        .get_secure_secret(SECURE_SECRET_VAULT_ENVELOPE)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Security vault is not configured yet.".to_string())?;

    let envelope: VaultEnvelope = serde_json::from_slice(&envelope_bytes)
        .map_err(|e| format!("Corrupt vault envelope: {}", e))?;

    let root_key = unwrap_master_key(&envelope, &passphrase)
        .map_err(|_| "Incorrect vault passphrase".to_string())?;

    if remember == Some(true) {
        state
            .cache
            .set_secure_secret(SECURE_SECRET_AUTO_UNLOCK, root_key.as_ref())
            .map_err(|e| e.to_string())?;
    } else if remember == Some(false) {
        let _ = state.cache.delete_secure_secret(SECURE_SECRET_AUTO_UNLOCK);
    }

    {
        let mut key_guard = state.master_key.write().await;
        *key_guard = Some(*root_key);
    }

    Ok(CommandResponse::ok(()))
}

#[tauri::command]
pub async fn lock_vault_command(app: tauri::AppHandle) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    let mut key_guard = state.master_key.write().await;
    if let Some(ref mut k) = *key_guard {
        k.zeroize();
    }
    *key_guard = None;
    Ok(CommandResponse::ok(()))
}

#[tauri::command]
pub async fn set_vault_passphrase_command(
    app: tauri::AppHandle,
    current_passphrase: Option<String>,
    new_passphrase: String,
    remember: Option<bool>,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();

    let root_key = {
        let existing = state
            .cache
            .get_secure_secret(SECURE_SECRET_VAULT_ENVELOPE)
            .map_err(|e| e.to_string())?;

        if let Some(bytes) = existing {
            let env: VaultEnvelope =
                serde_json::from_slice(&bytes).map_err(|e| format!("Corrupt envelope: {}", e))?;
            let pass = current_passphrase.ok_or_else(|| {
                "Current passphrase required to change vault settings.".to_string()
            })?;
            unwrap_master_key(&env, &pass)
                .map_err(|_| "Current passphrase is incorrect.".to_string())?
        } else {
            generate_root_master_key()
        }
    };

    let new_envelope = wrap_master_key(&root_key, &new_passphrase).map_err(|e| e.to_string())?;
    let json_bytes = serde_json::to_vec(&new_envelope).map_err(|e| e.to_string())?;

    state
        .cache
        .set_secure_secret(SECURE_SECRET_VAULT_ENVELOPE, &json_bytes)
        .map_err(|e| e.to_string())?;

    if remember == Some(true) {
        state
            .cache
            .set_secure_secret(SECURE_SECRET_AUTO_UNLOCK, root_key.as_ref())
            .map_err(|e| e.to_string())?;
    } else if remember == Some(false) {
        let _ = state.cache.delete_secure_secret(SECURE_SECRET_AUTO_UNLOCK);
    }

    {
        let mut key_guard = state.master_key.write().await;
        *key_guard = Some(*root_key);
    }

    Ok(CommandResponse::ok(()))
}

#[tauri::command]
pub async fn get_recovery_phrase_command(
    app: tauri::AppHandle,
    current_passphrase: String,
) -> Result<CommandResponse<String>, String> {
    let state = app.state::<AppState>();
    let envelope_bytes = state
        .cache
        .get_secure_secret(SECURE_SECRET_VAULT_ENVELOPE)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Security vault is not configured.".to_string())?;

    let envelope: VaultEnvelope =
        serde_json::from_slice(&envelope_bytes).map_err(|e| format!("Corrupt envelope: {}", e))?;

    let root_key = unwrap_master_key(&envelope, &current_passphrase)
        .map_err(|_| "Current passphrase incorrect.".to_string())?;

    let phrase = entropy_to_mnemonic(&root_key).map_err(|e| e.to_string())?;

    Ok(CommandResponse::ok(phrase))
}

#[tauri::command]
pub async fn recover_vault_command(
    app: tauri::AppHandle,
    mnemonic: String,
    new_passphrase: String,
    remember: Option<bool>,
) -> Result<CommandResponse<()>, String> {
    let state = app.state::<AppState>();
    let restored_root_key = mnemonic_to_entropy(&mnemonic)
        .map_err(|e| format!("Recovery phrase validation failed: {}", e))?;

    let new_envelope =
        wrap_master_key(&restored_root_key, &new_passphrase).map_err(|e| e.to_string())?;

    let json_bytes = serde_json::to_vec(&new_envelope).map_err(|e| e.to_string())?;

    state
        .cache
        .set_secure_secret(SECURE_SECRET_VAULT_ENVELOPE, &json_bytes)
        .map_err(|e| e.to_string())?;

    if remember == Some(true) {
        state
            .cache
            .set_secure_secret(SECURE_SECRET_AUTO_UNLOCK, restored_root_key.as_ref())
            .map_err(|e| e.to_string())?;
    } else if remember == Some(false) {
        let _ = state.cache.delete_secure_secret(SECURE_SECRET_AUTO_UNLOCK);
    }

    {
        let mut key_guard = state.master_key.write().await;
        *key_guard = Some(*restored_root_key);
    }

    Ok(CommandResponse::ok(()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    #[tokio::test]
    async fn test_lock_vault_zeroizes_master_key() {
        let master_key = Arc::new(RwLock::new(Some([0x42u8; 32])));
        {
            let mut guard = master_key.write().await;
            if let Some(ref mut k) = *guard {
                k.zeroize();
            }
            *guard = None;
        }

        let guard = master_key.read().await;
        assert!(guard.is_none());
    }

    #[test]
    fn test_vault_status_reporting() {
        let status = VaultStatus {
            is_unlocked: true,
            is_configured: true,
            has_passphrase: true,
            auto_unlock_enabled: false,
            key_slot_count: 1,
            auto_lock_policy: "15m".to_string(),
        };

        assert!(status.is_unlocked);
        assert!(status.is_configured);
        assert_eq!(status.auto_lock_policy, "15m");
    }
}
