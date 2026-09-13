use std::collections::HashMap;
use std::sync::Arc;

use grammers_mtsender::SenderPool;
use grammers_session::storages::MemorySession;
use grammers_session::types::{DcOption, PeerId, PeerInfo, UpdatesState};
use grammers_session::{Session, SessionData};
use serde::{Deserialize, Serialize};

use super::RealTelegramTransport;
use crate::error::{ProtoFsError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedSession {
    pub home_dc: i32,
    pub dc_options: Vec<DcOption>,
    pub peer_infos: Vec<PeerInfo>,
    pub updates_state: UpdatesState,
}

impl From<ExportedSession> for SessionData {
    fn from(s: ExportedSession) -> Self {
        let mut dc_map = HashMap::new();
        for dc in s.dc_options {
            dc_map.insert(dc.id, dc);
        }
        let mut peer_map = HashMap::new();
        for p in s.peer_infos {
            peer_map.insert(p.id(), p);
        }
        SessionData {
            home_dc: s.home_dc,
            dc_options: dc_map,
            peer_infos: peer_map,
            updates_state: s.updates_state,
        }
    }
}

pub(crate) async fn export_session_bytes(session: &Arc<MemorySession>) -> Result<Vec<u8>> {
    let home_dc = session
        .home_dc_id()
        .map_err(|e| ProtoFsError::Mtproto(format!("Failed to get home DC: {}", e)))?;

    let mut dc_options = HashMap::new();
    for id in 1..=5 {
        if let Ok(Some(dc)) = session.dc_option(id) {
            dc_options.insert(id, dc);
        }
    }

    let mut peer_infos = HashMap::new();
    if let Ok(Some(self_peer)) = session.peer(PeerId::self_user()).await {
        peer_infos.insert(self_peer.id(), self_peer);
    }

    let updates_state = session
        .updates_state()
        .await
        .map_err(|e| ProtoFsError::Mtproto(format!("Failed to get updates state: {}", e)))?;

    let exported = ExportedSession {
        home_dc,
        dc_options: dc_options.into_values().collect(),
        peer_infos: peer_infos.into_values().collect(),
        updates_state,
    };
    serde_json::to_vec(&exported)
        .map_err(|e| ProtoFsError::Mtproto(format!("Failed to serialize session: {}", e)))
}

pub fn reconnect_from_session(
    session_bytes: &[u8],
    api_id: i32,
    api_hash: &str,
) -> Result<RealTelegramTransport> {
    let exported: ExportedSession = serde_json::from_slice(session_bytes)
        .map_err(|e| ProtoFsError::Mtproto(format!("Corrupt session data: {}", e)))?;
    let session_data: SessionData = exported.into();
    let mem_session = Arc::new(MemorySession::from(session_data));
    let pool = SenderPool::new(mem_session.clone(), api_id);
    let runner = pool.runner;
    tokio::spawn(async move {
        let _ = runner.run().await;
    });
    let client = grammers_client::Client::new(pool.handle);
    Ok(RealTelegramTransport::new(
        client,
        mem_session,
        api_id,
        api_hash.to_string(),
    ))
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    pub fn test_session_data_serde_roundtrip() {
        let session = ExportedSession {
            home_dc: 2,
            dc_options: Vec::new(),
            peer_infos: Vec::new(),
            updates_state: UpdatesState {
                pts: 10,
                qts: 20,
                date: 1700000000,
                seq: 1,
                channels: Vec::new(),
            },
        };
        let bytes = serde_json::to_vec(&session).expect("serialize session");
        let deserialized: ExportedSession =
            serde_json::from_slice(&bytes).expect("deserialize session");
        assert_eq!(deserialized.home_dc, 2);
        assert_eq!(deserialized.updates_state.pts, 10);
        let session_data: SessionData = deserialized.into();
        assert_eq!(session_data.home_dc, 2);
    }
}
