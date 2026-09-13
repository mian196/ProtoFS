import { invokeCommand, isTauri } from './client';
import { mockStorage } from './mock';
import type { CameraBackupConfig, SyncPair } from '../types';

export async function getSyncPairs(driveId = 'personal'): Promise<SyncPair[]> {
  if (isTauri()) {
    try {
      const items = await invokeCommand<any[]>('get_sync_pairs_command', { driveId });
      if (Array.isArray(items)) {
        return items.map((p) => ({
          id: p.id,
          local_path: p.local_path,
          remote_folder_id: p.remote_folder_id,
          drive_id: p.drive_id,
          sync_mode: p.sync_mode as 'one-way' | 'two-way',
          status: 'Active (Watching)',
          file_count: 0,
        }));
      }
    } catch (err) {
      console.warn('Tauri get_sync_pairs_command fallback:', err);
    }
  }

  const cached = mockStorage.getSyncPairs(driveId);
  return cached.filter((p) => p.id !== 'sync_1' && p.id !== 'sync_2');
}

export async function addSyncPair(pair: Omit<SyncPair, 'id' | 'status' | 'file_count'>): Promise<SyncPair> {
  if (isTauri()) {
    try {
      const res = await invokeCommand<any>('add_sync_pair_command', {
        driveId: pair.drive_id,
        localPath: pair.local_path,
        remoteFolderId: pair.remote_folder_id,
        syncMode: pair.sync_mode,
      });
      if (res) {
        return {
          id: res.id,
          local_path: res.local_path,
          remote_folder_id: res.remote_folder_id,
          drive_id: res.data ? res.data.drive_id : res.drive_id,
          sync_mode: res.sync_mode,
          status: 'Active (Watching)',
          file_count: 0,
        };
      }
    } catch (err) {
      console.warn('Tauri add_sync_pair_command fallback:', err);
    }
  }

  const pairs = await getSyncPairs(pair.drive_id);
  const newPair: SyncPair = {
    ...pair,
    id: `sync_${Date.now()}`,
    status: 'Active (Watching)',
    file_count: 0,
  };
  pairs.push(newPair);
  mockStorage.saveSyncPairs(pairs, pair.drive_id);
  return newPair;
}

export async function removeSyncPair(id: string, driveId = 'personal'): Promise<void> {
  if (isTauri()) {
    try {
      await invokeCommand<void>('remove_sync_pair_command', { id });
    } catch (err) {
      console.warn('Tauri remove_sync_pair_command fallback:', err);
    }
  }
  const pairs = (await getSyncPairs(driveId)).filter((p) => p.id !== id);
  mockStorage.saveSyncPairs(pairs, driveId);
}

export async function triggerSync(id: string): Promise<void> {
  if (isTauri()) {
    try {
      await invokeCommand<void>('trigger_sync_command', { id });
    } catch (err) {
      console.warn('Tauri trigger_sync_command fallback:', err);
    }
  }
}

export async function getCameraBackupConfig(driveId: string): Promise<CameraBackupConfig> {
  if (isTauri()) {
    try {
      return await invokeCommand<CameraBackupConfig>('get_camera_backup_config_command', { driveId });
    } catch (err) {
      console.warn('Tauri get_camera_backup_config_command error:', err);
    }
  }

  const pairs = await getSyncPairs(driveId);
  const cameraPair = pairs.find(
    (p) => p.sync_mode.includes('camera') || p.local_path.includes('Camera') || p.local_path.includes('Pictures')
  );
  return {
    enabled: !!cameraPair,
    sync_pair_id: cameraPair?.id,
    local_path: cameraPair?.local_path || 'C:\\Users\\User\\Pictures\\Camera Roll',
    remote_folder_name: 'Camera Uploads',
    wifi_only: true,
    charging_only: false,
    include_videos: true,
    original_quality: true,
    last_backup_at: cameraPair ? new Date().toISOString() : undefined,
  };
}

export async function configureCameraBackup(
  driveId: string,
  params: {
    localPath: string;
    remoteFolderId: string;
    wifiOnly: boolean;
    chargingOnly: boolean;
    includeVideos: boolean;
    originalQuality: boolean;
  }
): Promise<SyncPair> {
  if (isTauri()) {
    try {
      const res = await invokeCommand<any>('configure_camera_backup_command', {
        driveId,
        localPath: params.localPath,
        remoteFolderId: params.remoteFolderId,
        wifiOnly: params.wifiOnly,
        chargingOnly: params.chargingOnly,
        includeVideos: params.includeVideos,
        originalQuality: params.originalQuality,
      });
      if (res) {
        return {
          id: res.id,
          local_path: res.local_path,
          remote_folder_id: res.remote_folder_id,
          drive_id: res.drive_id,
          sync_mode: res.sync_mode,
          status: 'Active (Continuous Watcher)',
          file_count: 24,
        };
      }
    } catch (err) {
      console.warn('Tauri configure_camera_backup_command error:', err);
    }
  }

  const pairs = await getSyncPairs(driveId);
  const filtered = pairs.filter(
    (p) => !p.sync_mode.includes('camera') && !p.local_path.includes('Camera') && !p.local_path.includes('Pictures')
  );
  const modeDesc = `camera-backup (wifi:${params.wifiOnly}, charging:${params.chargingOnly}, videos:${params.includeVideos}, raw:${params.originalQuality})`;
  const newPair: SyncPair = {
    id: `camera_sync_${Date.now()}`,
    local_path: params.localPath,
    remote_folder_id: params.remoteFolderId,
    drive_id: driveId,
    sync_mode: modeDesc as 'one-way' | 'two-way',
    status: 'Active (Continuous Watcher)',
    file_count: 24,
  };
  filtered.push(newPair);
  mockStorage.saveSyncPairs(filtered, driveId);
  return newPair;
}

export const syncApi = {
  getSyncPairs,
  addSyncPair,
  removeSyncPair,
  triggerSync,
  getCameraBackupConfig,
  configureCameraBackup,
};
