use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tokio::sync::watch;

use super::{AppState, CommandResponse, TransferSignal};

/// Throttled Tauri event emitter for transfer progress events (D-09, D-10).
/// Guarantees immediate 0% and 100% events, while throttling in-flight events to at most once per 100ms.
pub struct ThrottledProgressEmitter {
    app: tauri::AppHandle,
    event_name: &'static str,
    transfer_id: String,
    file_id: String,
    name: String,
    total_bytes: u64,
    bytes_transferred: u64,
    last_emit: Instant,
    last_bytes: u64,
    min_interval: Duration,
}

impl ThrottledProgressEmitter {
    pub fn new(
        app: tauri::AppHandle,
        event_name: &'static str,
        transfer_id: String,
        file_id: String,
        name: String,
        total_bytes: u64,
    ) -> Self {
        let initial_status = if event_name == "upload-progress" {
            "uploading"
        } else {
            "downloading"
        };
        let _ = app.emit(
            event_name,
            serde_json::json!({
                "transfer_id": &transfer_id,
                "file_id": &file_id,
                "name": &name,
                "bytes_transferred": 0u64,
                "total_bytes": total_bytes,
                "speed_bytes_sec": 0u64,
                "eta_secs": serde_json::Value::Null,
                "status": initial_status,
                "progress": 0u32,
            }),
        );
        Self {
            app,
            event_name,
            transfer_id,
            file_id,
            name,
            total_bytes,
            bytes_transferred: 0,
            last_emit: Instant::now(),
            last_bytes: 0,
            min_interval: Duration::from_millis(100),
        }
    }

    pub fn update(&mut self, chunk_bytes: u64) {
        self.bytes_transferred += chunk_bytes;
        let elapsed = self.last_emit.elapsed();
        if elapsed >= self.min_interval {
            let delta_bytes = self.bytes_transferred.saturating_sub(self.last_bytes);
            let elapsed_secs = elapsed.as_secs_f64().max(0.001);
            let speed = (delta_bytes as f64 / elapsed_secs) as u64;
            let remaining = self.total_bytes.saturating_sub(self.bytes_transferred);
            let eta = remaining.checked_div(speed);
            let progress = if self.total_bytes > 0 {
                ((self.bytes_transferred as f64 / self.total_bytes as f64) * 100.0).min(100.0)
                    as u32
            } else {
                100
            };
            let status = if self.event_name == "upload-progress" {
                "uploading"
            } else {
                "downloading"
            };

            let _ = self.app.emit(
                self.event_name,
                serde_json::json!({
                    "transfer_id": &self.transfer_id,
                    "file_id": &self.file_id,
                    "name": &self.name,
                    "bytes_transferred": self.bytes_transferred,
                    "total_bytes": self.total_bytes,
                    "speed_bytes_sec": speed,
                    "eta_secs": eta,
                    "status": status,
                    "progress": progress,
                }),
            );
            self.last_emit = Instant::now();
            self.last_bytes = self.bytes_transferred;
        }
    }

    pub fn finish(&mut self) {
        self.bytes_transferred = self.total_bytes;
        let _ = self.app.emit(
            self.event_name,
            serde_json::json!({
                "transfer_id": &self.transfer_id,
                "file_id": &self.file_id,
                "name": &self.name,
                "bytes_transferred": self.total_bytes,
                "total_bytes": self.total_bytes,
                "speed_bytes_sec": 0u64,
                "eta_secs": 0u64,
                "status": "completed",
                "progress": 100u32,
            }),
        );
    }

    pub fn fail(&mut self, err_msg: &str) {
        let progress = if self.total_bytes > 0 {
            ((self.bytes_transferred as f64 / self.total_bytes as f64) * 100.0) as u32
        } else {
            0
        };
        let _ = self.app.emit(
            self.event_name,
            serde_json::json!({
                "transfer_id": &self.transfer_id,
                "file_id": &self.file_id,
                "name": &self.name,
                "bytes_transferred": self.bytes_transferred,
                "total_bytes": self.total_bytes,
                "speed_bytes_sec": 0u64,
                "eta_secs": serde_json::Value::Null,
                "status": "failed",
                "error": err_msg,
                "progress": progress,
            }),
        );
    }
}

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
pub async fn check_transfer_gate(rx: &mut watch::Receiver<TransferSignal>) -> Result<bool, String> {
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
