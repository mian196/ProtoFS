import { invokeCommand, isTauri } from './client';
import { mockStorage } from './mock';
import type { DriveHealthStatus, DriveMetadata, OwnedChannel } from '../types';

export async function getDrives(): Promise<DriveMetadata[]> {
  if (isTauri()) {
    try {
      const data = await invokeCommand<DriveMetadata[]>('get_drives_command');
      const filtered = (data || []).filter((d) => !(d.channel_id === 0 && d.name === 'ProtoFS Cloud Drive'));
      mockStorage.setDrives(filtered);
      return filtered;
    } catch (err) {
      console.warn('Tauri get_drives_command error, falling back:', err);
    }
  }

  const cached = mockStorage.getDrives();
  return (cached || []).filter((d) => !(d.channel_id === 0 && d.name === 'ProtoFS Cloud Drive'));
}

export async function deleteDrive(driveId: string): Promise<boolean> {
  if (isTauri()) {
    try {
      await invokeCommand<boolean>('delete_drive_command', { driveId });
    } catch (err) {
      console.warn('Tauri delete_drive_command error:', err);
    }
  }
  const drives = (await getDrives()).filter((d) => d.id !== driveId);
  mockStorage.setDrives(drives);
  return true;
}

export async function syncAndPruneDrives(): Promise<DriveMetadata[]> {
  if (isTauri()) {
    try {
      const data = await invokeCommand<DriveMetadata[]>('sync_and_prune_drives_command');
      const filtered = (data || []).filter((d) => !(d.channel_id === 0 && d.name === 'ProtoFS Cloud Drive'));
      mockStorage.setDrives(filtered);
      return filtered;
    } catch (err) {
      console.warn('Tauri sync_and_prune_drives_command error:', err);
    }
  }
  return getDrives();
}

export async function syncChatFolder(): Promise<void> {
  if (isTauri()) {
    try {
      await invokeCommand<void>('sync_chat_folder_command');
    } catch (err) {
      console.warn('Tauri sync_chat_folder_command error:', err);
    }
  }
}

export async function createDrive(name: string, channelId: number): Promise<DriveMetadata> {
  if (isTauri()) {
    return invokeCommand<DriveMetadata>('create_drive_command', { name, channelId });
  }

  const drives = await getDrives();
  const newDrive: DriveMetadata = {
    id: `drive_${Date.now()}`,
    name,
    channel_id: channelId,
    pinned_manifest_msg_id: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  drives.push(newDrive);
  mockStorage.setDrives(drives);
  return newDrive;
}

export async function checkConnection(): Promise<boolean> {
  if (isTauri()) {
    try {
      return await invokeCommand<boolean>('check_telegram_connection_command');
    } catch (err) {
      console.warn('Tauri check_telegram_connection_command error:', err);
      return false;
    }
  }
  return true;
}

export async function checkDriveHealth(driveId: string, channelId: number): Promise<DriveHealthStatus> {
  if (isTauri()) {
    try {
      return await invokeCommand<DriveHealthStatus>('check_drive_health_command', { driveId, channelId });
    } catch (err) {
      console.warn('Tauri check_drive_health_command error:', err);
    }
  }
  return {
    drive_id: driveId,
    channel_id: channelId,
    is_accessible: true,
  };
}

export async function exportDriveManifest(driveId: string, format: 'json' | 'csv' = 'json'): Promise<string> {
  if (isTauri()) {
    return invokeCommand<string>('export_drive_manifest_command', { driveId, format });
  }
  return JSON.stringify({ driveId, format, exported_at: new Date().toISOString() }, null, 2);
}

export async function getOwnedChannels(showAll: boolean): Promise<OwnedChannel[]> {
  if (isTauri()) {
    return invokeCommand<OwnedChannel[]>('get_owned_channels_command', { showAll });
  }

  const defaultChannels: OwnedChannel[] = [
    {
      channel_id: -1001928471001,
      title: 'ProtoFS Backup Vault',
      is_channel: true,
      is_group: false,
      is_creator: true,
      is_admin: true,
      is_protofs_drive: true,
      about: 'ProtoFS Encrypted Storage [protofs-id: drive_vault]',
    },
    {
      channel_id: -1001928471002,
      title: 'Personal Media Channel',
      is_channel: true,
      is_group: false,
      is_creator: true,
      is_admin: true,
      is_protofs_drive: false,
      about: 'Personal media archives',
    },
    {
      channel_id: -1001928471003,
      title: 'Family Archive Group',
      is_channel: false,
      is_group: true,
      is_creator: true,
      is_admin: true,
      is_protofs_drive: false,
    },
  ];

  if (!showAll) {
    return defaultChannels.filter((c) => c.is_protofs_drive);
  }
  return defaultChannels;
}

export async function adoptChannelAsDrive(channelId: number, name: string): Promise<DriveMetadata> {
  if (isTauri()) {
    return invokeCommand<DriveMetadata>('adopt_channel_as_drive_command', { channelId, name });
  }
  return createDrive(name, channelId);
}

export const drivesApi = {
  getDrives,
  deleteDrive,
  syncAndPruneDrives,
  syncChatFolder,
  createDrive,
  checkConnection,
  checkDriveHealth,
  exportDriveManifest,
  getOwnedChannels,
  adoptChannelAsDrive,
};
