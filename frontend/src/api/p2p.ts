import { invokeCommand, isTauri } from './client';
import { formatBytes } from './mock';
import type {
  DocumentsProviderStatus,
  P2pSessionInfo,
  P2pStatus,
  P2pTransferProgress,
  SafTestQueryResult,
  WorkManagerJobRecord,
  WorkManagerSyncConfig,
  WorkManagerSyncStatus,
} from '../types';

// ---------------------------------------------------------------------------
// Android DocumentsProvider & Storage Access Framework (SAF)
// ---------------------------------------------------------------------------

export async function getDocumentsProviderStatus(driveId: string): Promise<DocumentsProviderStatus> {
  if (isTauri()) {
    try {
      return await invokeCommand<DocumentsProviderStatus>('get_documents_provider_status_command', { driveId });
    } catch (err) {
      console.warn('Tauri get_documents_provider_status_command error:', err);
    }
  }

  const isEnabled = localStorage.getItem(`protofs_saf_enabled_${driveId}`) !== 'false';
  return {
    is_enabled: isEnabled,
    authority: 'com.protofs.app.documents',
    root_count: 1,
    active_drive_id: driveId,
    saf_uri: `content://com.protofs.app.documents/root/${driveId}`,
    cached_documents_count: 24,
    is_android: false,
    last_sync_timestamp: new Date().toISOString(),
  };
}

export async function toggleDocumentsProvider(driveId: string, enable: boolean): Promise<DocumentsProviderStatus> {
  if (isTauri()) {
    return invokeCommand<DocumentsProviderStatus>('toggle_documents_provider_command', { driveId, enable });
  }

  localStorage.setItem(`protofs_saf_enabled_${driveId}`, String(enable));
  return {
    is_enabled: enable,
    authority: 'com.protofs.app.documents',
    root_count: 1,
    active_drive_id: driveId,
    saf_uri: `content://com.protofs.app.documents/root/${driveId}`,
    cached_documents_count: 24,
    is_android: false,
    last_sync_timestamp: new Date().toISOString(),
  };
}

export async function notifyDocumentsProviderChange(driveId: string, documentId?: string): Promise<boolean> {
  if (isTauri()) {
    try {
      const res = await invokeCommand<boolean>('notify_documents_provider_change_command', { driveId, documentId });
      if (typeof res === 'boolean') return res;
    } catch (err) {
      console.warn('Tauri notify_documents_provider_change_command error:', err);
    }
  }
  return true;
}

export async function testSafDocumentQuery(driveId: string, documentId?: string): Promise<SafTestQueryResult> {
  if (isTauri()) {
    return invokeCommand<SafTestQueryResult>('test_saf_document_query_command', { driveId, documentId });
  }

  return {
    authority: 'com.protofs.app.documents',
    document_id: documentId || `root:${driveId}`,
    display_name: 'Personal Cloud Drive',
    mime_type: 'vnd.android.document/directory',
    size_bytes: 0,
    flags: ['FLAG_DIR_SUPPORTS_CREATE', 'FLAG_SUPPORTS_IS_CHILD'],
    child_count: 12,
  };
}

// ---------------------------------------------------------------------------
// Android Jetpack WorkManager Background Sync
// ---------------------------------------------------------------------------

export async function getWorkManagerSyncStatus(): Promise<WorkManagerSyncStatus> {
  if (isTauri()) {
    try {
      return await invokeCommand<WorkManagerSyncStatus>('get_workmanager_sync_status_command');
    } catch (err) {
      console.warn('Tauri get_workmanager_sync_status_command error:', err);
    }
  }

  const raw = localStorage.getItem('protofs_workmanager_config');
  const config: WorkManagerSyncConfig = raw
    ? JSON.parse(raw)
    : {
        enabled: false,
        interval_minutes: 60,
        wifi_only: true,
        requires_charging: false,
        requires_battery_not_low: true,
        last_sync_timestamp: null,
        last_sync_status: null,
        sync_pair_ids: [],
      };

  const rawHist = localStorage.getItem('protofs_workmanager_history');
  const recentHistory: WorkManagerJobRecord[] = rawHist ? JSON.parse(rawHist) : [];

  return {
    is_supported: true,
    is_active: config.enabled,
    config,
    next_scheduled_run: config.enabled ? new Date(Date.now() + config.interval_minutes * 60000).toISOString() : null,
    is_android: false,
    active_pairs_count: 2,
    recent_history: recentHistory,
  };
}

export async function configureWorkManagerSync(config: WorkManagerSyncConfig): Promise<WorkManagerSyncStatus> {
  if (isTauri()) {
    return invokeCommand<WorkManagerSyncStatus>('configure_workmanager_sync_command', { config });
  }

  localStorage.setItem('protofs_workmanager_config', JSON.stringify(config));
  return getWorkManagerSyncStatus();
}

export async function triggerImmediateBackgroundSync(): Promise<WorkManagerJobRecord> {
  if (isTauri()) {
    return invokeCommand<WorkManagerJobRecord>('trigger_immediate_background_sync_command');
  }

  const record: WorkManagerJobRecord = {
    id: `wm_${Date.now()}`,
    timestamp: Date.now(),
    formatted_time: new Date().toISOString(),
    files_synced: 8,
    bytes_transferred: 2154800,
    formatted_bytes: '2.1 MB',
    duration_ms: 1240,
    success: true,
    message: 'WorkManager sync completed in 1240ms: 8 files synchronized (2.1 MB)',
  };

  const rawHist = localStorage.getItem('protofs_workmanager_history');
  const hist: WorkManagerJobRecord[] = rawHist ? JSON.parse(rawHist) : [];
  hist.unshift(record);
  if (hist.length > 20) hist.pop();
  localStorage.setItem('protofs_workmanager_history', JSON.stringify(hist));

  const rawCfg = localStorage.getItem('protofs_workmanager_config');
  if (rawCfg) {
    const cfg = JSON.parse(rawCfg);
    cfg.last_sync_timestamp = record.formatted_time;
    cfg.last_sync_status = 'Success';
    localStorage.setItem('protofs_workmanager_config', JSON.stringify(cfg));
  }

  return record;
}

export async function getWorkManagerHistory(): Promise<WorkManagerJobRecord[]> {
  if (isTauri()) {
    try {
      return await invokeCommand<WorkManagerJobRecord[]>('get_workmanager_history_command');
    } catch (err) {
      console.warn('Tauri get_workmanager_history_command error:', err);
    }
  }

  const rawHist = localStorage.getItem('protofs_workmanager_history');
  return rawHist ? JSON.parse(rawHist) : [];
}

// ---------------------------------------------------------------------------
// P2P Direct Sharing
// ---------------------------------------------------------------------------

export async function getP2pStatus(): Promise<P2pStatus> {
  if (isTauri()) {
    try {
      return await invokeCommand<P2pStatus>('get_p2p_status_command');
    } catch (err) {
      console.warn('Tauri get_p2p_status_command error:', err);
    }
  }

  const rawSession = localStorage.getItem('protofs_p2p_session');
  const rawHist = localStorage.getItem('protofs_p2p_history');
  const recentTransfers: P2pTransferProgress[] = rawHist ? JSON.parse(rawHist) : [];

  return {
    is_supported: true,
    local_ip: '192.168.1.145',
    default_port: 48873,
    active_session: rawSession ? JSON.parse(rawSession) : null,
    recent_transfers: recentTransfers,
  };
}

export async function startP2pSession(role: 'sender' | 'receiver', fileId?: string, driveId?: string): Promise<P2pSessionInfo> {
  if (isTauri()) {
    return invokeCommand<P2pSessionInfo>('start_p2p_session_command', { role, fileId, driveId });
  }

  const pin = `${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}`;
  const session: P2pSessionInfo = {
    session_id: `p2p_${Date.now()}`,
    pin_code: pin,
    listen_port: 48873,
    local_ip: '192.168.1.145',
    p2p_uri: `protofs-p2p://192.168.1.145:48873/?pin=${pin}&role=${role}`,
    qr_payload: `protofs://p2p/connect?ip=192.168.1.145&port=48873&pin=${pin}&role=${role}`,
    is_active: true,
    role,
    target_file_id: fileId,
    target_file_name: fileId ? 'Encrypted_Cloud_File.dat' : null,
    target_file_size: fileId ? 4892100 : null,
  };

  localStorage.setItem('protofs_p2p_session', JSON.stringify(session));
  return session;
}

export async function connectP2pPeer(
  peerAddress: string,
  pinCode: string,
  targetFolderId?: string,
  driveId?: string
): Promise<P2pTransferProgress> {
  if (isTauri()) {
    return invokeCommand<P2pTransferProgress>('connect_p2p_peer_command', {
      peerAddress,
      pinCode,
      targetFolderId,
      driveId,
    });
  }

  const rawSession = localStorage.getItem('protofs_p2p_session');
  const session: P2pSessionInfo | null = rawSession ? JSON.parse(rawSession) : null;
  const isSender = session?.role === 'sender';
  const fileSize = session?.target_file_size || 5242880;
  const fileName = session?.target_file_name || 'Direct_P2P_Share.pdf';

  const result: P2pTransferProgress = {
    transfer_id: `p2p_tx_${Date.now()}`,
    role: isSender ? 'sender' : 'receiver',
    file_name: fileName,
    file_size: fileSize,
    bytes_transferred: fileSize,
    speed_bps: 18500000,
    progress_percent: 100,
    status: 'completed',
    peer_address: peerAddress,
    pin_code: pinCode,
    duration_ms: 680,
    formatted_bytes: formatBytes(fileSize),
    formatted_speed: '18.5 MB/s',
  };

  const rawHist = localStorage.getItem('protofs_p2p_history');
  const hist: P2pTransferProgress[] = rawHist ? JSON.parse(rawHist) : [];
  hist.unshift(result);
  if (hist.length > 20) hist.pop();
  localStorage.setItem('protofs_p2p_history', JSON.stringify(hist));
  localStorage.removeItem('protofs_p2p_session');

  return result;
}

export async function cancelP2pSession(): Promise<boolean> {
  if (isTauri()) {
    try {
      const res = await invokeCommand<boolean>('cancel_p2p_session_command');
      if (typeof res === 'boolean') return res;
    } catch (err) {
      console.warn('Tauri cancel_p2p_session_command error:', err);
    }
  }
  localStorage.removeItem('protofs_p2p_session');
  return true;
}

export const p2pApi = {
  getDocumentsProviderStatus,
  toggleDocumentsProvider,
  notifyDocumentsProviderChange,
  testSafDocumentQuery,
  getWorkManagerSyncStatus,
  configureWorkManagerSync,
  triggerImmediateBackgroundSync,
  getWorkManagerHistory,
  getP2pStatus,
  startP2pSession,
  connectP2pPeer,
  cancelP2pSession,
};
