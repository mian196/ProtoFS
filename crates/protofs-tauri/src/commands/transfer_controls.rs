use tauri::Manager;
use tokio::sync::watch;

use super::{AppState, CommandResponse, TransferSignal};

/// Registers an active transfer watch channel into AppState.
pub async fn register_transfer(
    state: &AppState,
    transfer_id: &str,
) -> watch::Receiver<TransferSignal> {
    let (tx, rx) = watch::channel(TransferSignal::Running);
    let mut map = state.active_transfers.write().await;
    map.insert(transfer_id.to_string(), tx);
    rx
}

/// Unregisters a completed or aborted transfer from AppState.
pub async fn unregister_transfer(state: &AppState, transfer_id: &str) {
    let mut map = state.active_transfers.write().await;
    map.remove(transfer_id);
}

/// Checks the transfer signal gate between chunk processing loops.
/// Returns Ok(true) to proceed, or Err(msg) if cancelled. Suspends execution if paused.
pub async fn check_transfer_gate(
    rx: &mut watch::Receiver<TransferSignal>,
) -> Result<bool, String> {
    let current = *rx.borrow();
    match current {
        TransferSignal::Cancelled => Err("Transfer cancelled by user".to_string()),
        TransferSignal::Paused => {
            tracing::info!("Transfer paused, awaiting resume or cancel signal...");
            loop {
                if rx.changed().await.is_err() {
                    return Err("Transfer watch channel closed".to_string());
                }
                match *rx.borrow() {
                    TransferSignal::Running => {
                        tracing::info!("Transfer resumed.");
                        break Ok(true);
                    }
                    TransferSignal::Cancelled => {
                        return Err("Transfer cancelled by user".to_string());
                    }
                    TransferSignal::Paused => continue,
                }
            }
        }
        TransferSignal::Running => Ok(true),
    }
}

#[tauri::command]
pub async fn cancel_transfer_command(
    app: tauri::AppHandle,
    transfer_id: String,
) -> Result<CommandResponse<bool>, String> {
    let state = app.state::<AppState>();
    let mut map = state.active_transfers.write().await;
    if let Some(tx) = map.remove(&transfer_id) {
        let _ = tx.send(TransferSignal::Cancelled);
        tracing::info!("Cancelled transfer {}", transfer_id);
        Ok(CommandResponse::ok(true))
    } else {
        tracing::warn!("Transfer {} not found for cancellation", transfer_id);
        Ok(CommandResponse::ok(false))
    }
}

#[tauri::command]
pub async fn pause_transfer_command(
    app: tauri::AppHandle,
    transfer_id: String,
) -> Result<CommandResponse<bool>, String> {
    let state = app.state::<AppState>();
    let map = state.active_transfers.read().await;
    if let Some(tx) = map.get(&transfer_id) {
        let _ = tx.send(TransferSignal::Paused);
        tracing::info!("Paused transfer {}", transfer_id);
        Ok(CommandResponse::ok(true))
    } else {
        tracing::warn!("Transfer {} not found for pause", transfer_id);
        Ok(CommandResponse::ok(false))
    }
}

#[tauri::command]
pub async fn resume_transfer_command(
    app: tauri::AppHandle,
    transfer_id: String,
) -> Result<CommandResponse<bool>, String> {
    let state = app.state::<AppState>();
    let map = state.active_transfers.read().await;
    if let Some(tx) = map.get(&transfer_id) {
        let _ = tx.send(TransferSignal::Running);
        tracing::info!("Resumed transfer {}", transfer_id);
        Ok(CommandResponse::ok(true))
    } else {
        tracing::warn!("Transfer {} not found for resume", transfer_id);
        Ok(CommandResponse::ok(false))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_transfer_signal_transitions() {
        let (tx, mut rx) = watch::channel(TransferSignal::Running);
        assert!(check_transfer_gate(&mut rx).await.is_ok());

        // Test cancel transition
        tx.send(TransferSignal::Cancelled).unwrap();
        let res = check_transfer_gate(&mut rx).await;
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), "Transfer cancelled by user");
    }

    #[tokio::test]
    async fn test_transfer_pause_resume() {
        let (tx, mut rx) = watch::channel(TransferSignal::Running);
        tx.send(TransferSignal::Paused).unwrap();

        let tx_clone = tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            tx_clone.send(TransferSignal::Running).unwrap();
        });

        let res = check_transfer_gate(&mut rx).await;
        assert!(res.is_ok());
    }
}
