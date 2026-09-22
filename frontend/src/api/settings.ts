import { invokeCommand, isTauri } from './client';
import { mockStorage } from './mock';
import type { PurgeCacheResult, ShellIntegrationStatus, UpdateInfo } from '../types';
import { getAppVersion } from '../utils/version';

export async function getStorageUsage(driveId: string): Promise<{
  total_bytes: number;
  total_files: number;
  total_folders: number;
  video_bytes: number;
  image_bytes: number;
  document_bytes: number;
  audio_bytes: number;
  other_bytes: number;
  local_cache_bytes: number;
}> {
  if (isTauri()) {
    try {
      return await invokeCommand('get_storage_usage_command', { driveId });
    } catch (err) {
      console.warn('Tauri get_storage_usage_command fallback:', err);
    }
  }

  const files = mockStorage.getStoredFiles().filter((f) => f.drive_id === driveId && !f.trashed);
  const folders = mockStorage.getStoredFolders().filter((f) => f.drive_id === driveId);
  let total_bytes = 0;
  let video_bytes = 0;
  let image_bytes = 0;
  let document_bytes = 0;
  let audio_bytes = 0;
  let other_bytes = 0;

  for (const fl of files) {
    total_bytes += fl.size_bytes;
    if (fl.type === 'video') video_bytes += fl.size_bytes;
    else if (fl.type === 'image') image_bytes += fl.size_bytes;
    else if (fl.type === 'sheet' || fl.type === 'pdf') document_bytes += fl.size_bytes;
    else if (fl.type === 'audio') audio_bytes += fl.size_bytes;
    else other_bytes += fl.size_bytes;
  }

  return {
    total_bytes,
    total_files: files.length,
    total_folders: folders.length,
    video_bytes,
    image_bytes,
    document_bytes,
    audio_bytes,
    other_bytes,
    local_cache_bytes: 42 * 1024 * 1024,
  };
}

export async function purgeLocalCache(driveId?: string): Promise<PurgeCacheResult> {
  if (isTauri()) {
    try {
      return await invokeCommand<PurgeCacheResult>('purge_local_cache_command', { driveId: driveId || null });
    } catch (err) {
      console.warn('Tauri purge_local_cache_command error:', err);
    }
  }
  return { freed_bytes: 42 * 1024 * 1024, files_deleted: 12 };
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  if (isTauri()) {
    try {
      return await invokeCommand<UpdateInfo>('check_for_updates_command');
    } catch (err) {
      console.warn('Tauri check_for_updates_command error:', err);
    }
  }

  const ver = getAppVersion();
  return {
    current_version: ver,
    latest_version: ver,
    update_available: false,
    release_notes: `### ProtoFS v${ver}\n\n- Latest release version running.`,
    release_date: '2026-09-22',
    download_url: 'https://github.com/mian196/ProtoFS/releases',
    signature_verified: true,
    channel: 'Stable (GitHub Releases)',
    package_type: 'Desktop Binary',
  };
}

export async function getShellIntegrationStatus(): Promise<ShellIntegrationStatus> {
  if (isTauri()) {
    try {
      return await invokeCommand<ShellIntegrationStatus>('get_shell_integration_status_command');
    } catch (err) {
      console.warn('Tauri get_shell_integration_status_command error:', err);
    }
  }

  const savedSendTo = localStorage.getItem('protofs_shell_send_to') === 'true';
  const savedMenu = localStorage.getItem('protofs_shell_context_menu') === 'true';
  return {
    send_to_enabled: savedSendTo,
    context_menu_enabled: savedMenu,
    platform: 'browser',
    send_to_path: '%APPDATA%\\Microsoft\\Windows\\SendTo\\ProtoFS.cmd',
    target_exe: 'protofs-tauri.exe',
  };
}

export async function setShellIntegration(
  enableSendTo: boolean,
  enableContextMenu: boolean
): Promise<ShellIntegrationStatus> {
  if (isTauri()) {
    try {
      return await invokeCommand<ShellIntegrationStatus>('set_shell_integration_command', {
        enableSendTo,
        enableContextMenu,
      });
    } catch (err) {
      console.warn('Tauri set_shell_integration_command error:', err);
    }
  }

  localStorage.setItem('protofs_shell_send_to', String(enableSendTo));
  localStorage.setItem('protofs_shell_context_menu', String(enableContextMenu));
  return {
    send_to_enabled: enableSendTo,
    context_menu_enabled: enableContextMenu,
    platform: 'browser',
    send_to_path: '%APPDATA%\\Microsoft\\Windows\\SendTo\\ProtoFS.cmd',
    target_exe: 'protofs-tauri.exe',
  };
}

export async function getPendingUploads(): Promise<string[]> {
  if (isTauri()) {
    try {
      return await invokeCommand<string[]>('get_pending_uploads_command');
    } catch (err) {
      console.warn('Tauri get_pending_uploads_command error:', err);
    }
  }
  return [];
}

export async function openPathInExplorer(path: string): Promise<boolean> {
  if (isTauri()) {
    try {
      const res = await invokeCommand<boolean>('open_path_in_explorer_command', { path });
      if (typeof res === 'boolean') return res;
    } catch (err) {
      console.warn('Tauri open_path_in_explorer_command error:', err);
    }
  }
  return false;
}

export const settingsApi = {
  getStorageUsage,
  purgeLocalCache,
  checkForUpdates,
  getShellIntegrationStatus,
  setShellIntegration,
  getPendingUploads,
  openPathInExplorer,
};
