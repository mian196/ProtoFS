import { invokeCommand, isTauri } from './client';
import type { VirtualDriveStatus, WebDavServerStatus } from '../types';

export async function getWebDavConfig(): Promise<WebDavServerStatus> {
  if (isTauri()) {
    try {
      return await invokeCommand<WebDavServerStatus>('get_webdav_config_command');
    } catch (err) {
      console.warn('Tauri get_webdav_config_command error:', err);
    }
  }
  return {
    is_running: true,
    port: 28491,
    url: 'http://127.0.0.1:28491/',
    auto_mount: false,
  };
}

export async function configureWebDav(enabled: boolean, port: number, autoMount: boolean): Promise<WebDavServerStatus> {
  if (isTauri()) {
    return invokeCommand<WebDavServerStatus>('configure_webdav_command', { enabled, port, autoMount });
  }
  return {
    is_running: enabled,
    port: port || 28491,
    url: `http://127.0.0.1:${port || 28491}/`,
    auto_mount: autoMount,
  };
}

export async function getVirtualDriveStatus(driveId: string): Promise<VirtualDriveStatus | null> {
  if (!driveId) return null;
  if (isTauri()) {
    try {
      return await invokeCommand<VirtualDriveStatus>('get_virtual_drive_status_command', { driveId });
    } catch (err) {
      console.warn('Tauri get_virtual_drive_status_command error:', err);
    }
  }

  const isMounted = localStorage.getItem(`protofs_mount_${driveId}`) === 'true';
  const driveLetter = localStorage.getItem(`protofs_mount_letter_${driveId}`) || 'P';
  return {
    is_mounted: isMounted,
    drive_id: driveId,
    drive_letter: driveLetter,
    mount_path: `${driveLetter}:\\`,
    driver_mode: 'Windows Native Drive Mapping (Zero-Install)',
    winfsp_available: false,
    available_letters: ['P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'],
    cached_files_count: isMounted ? 14 : 0,
    cached_bytes: isMounted ? 45890200 : 0,
    last_mounted_at: isMounted ? new Date().toISOString() : undefined,
  };
}

export async function mountVirtualDrive(
  driveId: string,
  requestedLetter?: string,
  onDemandStream = true
): Promise<VirtualDriveStatus | null> {
  if (isTauri()) {
    return invokeCommand<VirtualDriveStatus>('mount_virtual_drive_command', {
      driveId,
      requestedLetter,
      onDemandStream,
    });
  }

  const letter = requestedLetter || 'P';
  localStorage.setItem(`protofs_mount_${driveId}`, 'true');
  localStorage.setItem(`protofs_mount_letter_${driveId}`, letter);
  return {
    is_mounted: true,
    drive_id: driveId,
    drive_letter: letter,
    mount_path: `${letter}:\\`,
    driver_mode: 'Windows Native Drive Mapping (Zero-Install)',
    winfsp_available: false,
    available_letters: ['P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'],
    cached_files_count: 14,
    cached_bytes: 45890200,
    last_mounted_at: new Date().toISOString(),
  };
}

export async function unmountVirtualDrive(driveId: string): Promise<VirtualDriveStatus | null> {
  if (isTauri()) {
    return invokeCommand<VirtualDriveStatus>('unmount_virtual_drive_command', { driveId });
  }

  const letter = localStorage.getItem(`protofs_mount_letter_${driveId}`) || 'P';
  localStorage.removeItem(`protofs_mount_${driveId}`);
  return {
    is_mounted: false,
    drive_id: driveId,
    drive_letter: letter,
    mount_path: `${letter}:\\`,
    driver_mode: 'Windows Native Drive Mapping (Zero-Install)',
    winfsp_available: false,
    available_letters: ['P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'],
    cached_files_count: 0,
    cached_bytes: 0,
    last_mounted_at: undefined,
  };
}

export async function openVirtualDriveInExplorer(driveLetter: string): Promise<boolean> {
  if (isTauri()) {
    try {
      return await invokeCommand<boolean>('open_virtual_drive_in_explorer_command', { driveLetter });
    } catch (err) {
      console.warn('Tauri open_virtual_drive_in_explorer_command error:', err);
    }
  }
  return false;
}

export async function clearVirtualDriveCache(driveId: string): Promise<boolean> {
  if (isTauri()) {
    try {
      return await invokeCommand<boolean>('clear_virtual_drive_cache_command', { driveId });
    } catch (err) {
      console.warn('Tauri clear_virtual_drive_cache_command error:', err);
    }
  }
  return true;
}

export const webdavApi = {
  getWebDavConfig,
  configureWebDav,
  getVirtualDriveStatus,
  mountVirtualDrive,
  unmountVirtualDrive,
  openVirtualDriveInExplorer,
  clearVirtualDriveCache,
};
