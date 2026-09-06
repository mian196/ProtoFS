import { invoke, isTauri } from '@tauri-apps/api/core';
import type { DriveMetadata, FileNode, FolderNode, SearchResult, SyncPair } from './types';

interface TauriCommandResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export class ProtoFsApi {
  private drives: DriveMetadata[] = [
    {
      id: 'personal',
      name: 'Personal Drive',
      channel_id: -1001928472910,
      pinned_manifest_msg_id: 104,
      created_at: '2026-08-01T10:00:00Z',
      updated_at: '2026-09-06T12:00:00Z',
    },
    {
      id: 'work',
      name: 'Work Archive',
      channel_id: -1001982736192,
      pinned_manifest_msg_id: 88,
      created_at: '2026-07-15T09:30:00Z',
      updated_at: '2026-09-05T16:20:00Z',
    },
    {
      id: 'media',
      name: 'Cinema Vault',
      channel_id: -1001837492817,
      pinned_manifest_msg_id: 210,
      created_at: '2026-06-20T14:15:00Z',
      updated_at: '2026-09-04T18:40:00Z',
    },
  ];

  private folders: FolderNode[] = [
    { id: 'f_docs', drive_id: 'personal', parent_id: 'root', name: 'Personal Documents', count: '14 files', created_at: '2026-08-10T12:00:00Z', updated_at: '2026-09-01T10:00:00Z' },
    { id: 'f_media', drive_id: 'personal', parent_id: 'root', name: 'Cinema Vault', count: '8 files', created_at: '2026-08-12T12:00:00Z', updated_at: '2026-09-02T10:00:00Z' },
    { id: 'f_code', drive_id: 'personal', parent_id: 'root', name: 'Rust Projects', count: '32 files', created_at: '2026-08-15T12:00:00Z', updated_at: '2026-09-03T10:00:00Z' },
    { id: 'f_camera', drive_id: 'personal', parent_id: 'root', name: 'Camera Auto-Backup', count: '1,420 photos', created_at: '2026-08-01T12:00:00Z', updated_at: '2026-09-06T12:40:00Z' },
    { id: 'f_vault', drive_id: 'personal', parent_id: 'root', name: 'Encrypted Vault', count: '6 files', created_at: '2026-08-20T12:00:00Z', updated_at: '2026-09-04T10:00:00Z' },
    { id: 'f_docs_tax', drive_id: 'personal', parent_id: 'f_docs', name: 'Tax Receipts 2025', count: '5 files', created_at: '2026-08-25T12:00:00Z', updated_at: '2026-09-01T10:00:00Z' },
    { id: 'f_docs_legal', drive_id: 'personal', parent_id: 'f_docs', name: 'Contracts & Legal', count: '3 files', created_at: '2026-08-26T12:00:00Z', updated_at: '2026-09-02T10:00:00Z' },
    { id: 'f_work_reports', drive_id: 'work', parent_id: 'root', name: 'Quarterly Reports', count: '12 files', created_at: '2026-07-20T12:00:00Z', updated_at: '2026-09-01T10:00:00Z' },
    { id: 'f_cinema_masters', drive_id: 'media', parent_id: 'root', name: '4K Masters', count: '4 files', created_at: '2026-06-25T12:00:00Z', updated_at: '2026-09-01T10:00:00Z' },
  ];

  private files: FileNode[] = [
    {
      id: 'file_1',
      drive_id: 'personal',
      parent_id: 'root',
      name: 'Cyberpunk_2077_NightCity_4K.mp4',
      size: '1.84 GB',
      size_bytes: 1975684956,
      type: 'video',
      mime_type: 'video/mp4',
      telegram_message_id: 10492,
      encrypted: true,
      encryption_iv: 'a8b7c6d5e4f3a2b1',
      sha256_hash: '3a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b',
      pinned: true,
      trashed: false,
      date: 'Today, 12:40 PM',
      created_at: '2026-09-06T12:40:00Z',
      updated_at: '2026-09-06T12:40:00Z',
    },
    {
      id: 'file_2',
      drive_id: 'personal',
      parent_id: 'root',
      name: 'ProtoFS_Core_v0.2.0_x86_64.msi',
      size: '42.5 MB',
      size_bytes: 44564480,
      type: 'binary',
      mime_type: 'application/octet-stream',
      telegram_message_id: 10488,
      encrypted: false,
      pinned: false,
      trashed: false,
      date: 'Yesterday',
      created_at: '2026-09-05T15:20:00Z',
      updated_at: '2026-09-05T15:20:00Z',
    },
    {
      id: 'file_3',
      drive_id: 'personal',
      parent_id: 'root',
      name: 'Q3_Financial_Forecast_Confidential.xlsx',
      size: '4.2 MB',
      size_bytes: 4404019,
      type: 'sheet',
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      telegram_message_id: 10450,
      encrypted: true,
      encryption_iv: 'b2c3d4e5f6a7b8c9',
      pinned: true,
      trashed: false,
      date: 'Aug 28, 2026',
      created_at: '2026-08-28T14:10:00Z',
      updated_at: '2026-08-28T14:10:00Z',
    },
    {
      id: 'file_4',
      drive_id: 'personal',
      parent_id: 'root',
      name: 'Neural_Network_Weights_DenseNet121.pt',
      size: '142.8 MB',
      size_bytes: 149737472,
      type: 'binary',
      telegram_message_id: 10442,
      encrypted: true,
      pinned: false,
      trashed: false,
      date: 'Aug 25, 2026',
      created_at: '2026-08-25T11:00:00Z',
      updated_at: '2026-08-25T11:00:00Z',
    },
    {
      id: 'file_5',
      drive_id: 'personal',
      parent_id: 'root',
      name: 'Landscape_Wallpaper_Patagonia_8K.png',
      size: '32.1 MB',
      size_bytes: 33659289,
      type: 'image',
      mime_type: 'image/png',
      telegram_message_id: 10420,
      encrypted: false,
      pinned: false,
      trashed: false,
      date: 'Aug 22, 2026',
      created_at: '2026-08-22T09:15:00Z',
      updated_at: '2026-08-22T09:15:00Z',
    },
    {
      id: 'file_6',
      drive_id: 'personal',
      parent_id: 'root',
      name: 'Nordic_Ambient_Soundtrack_Lossless.flac',
      size: '284.6 MB',
      size_bytes: 298424729,
      type: 'audio',
      mime_type: 'audio/flac',
      telegram_message_id: 10405,
      encrypted: false,
      pinned: false,
      trashed: false,
      date: 'Aug 18, 2026',
      created_at: '2026-08-18T16:30:00Z',
      updated_at: '2026-08-18T16:30:00Z',
    },
    {
      id: 'file_7',
      drive_id: 'personal',
      parent_id: 'f_docs',
      name: 'Passport_Scan_HighRes.pdf',
      size: '8.1 MB',
      size_bytes: 8493465,
      type: 'pdf',
      telegram_message_id: 10390,
      encrypted: true,
      pinned: true,
      trashed: false,
      date: 'Aug 10, 2026',
      created_at: '2026-08-10T14:20:00Z',
      updated_at: '2026-08-10T14:20:00Z',
    },
  ];

  private syncPairs: SyncPair[] = [
    {
      id: 'sp_1',
      local_path: 'C:\\Users\\MuzAmMaL\\Pictures\\Camera',
      remote_folder_id: 'f_camera',
      drive_id: 'personal',
      sync_mode: 'one-way',
      status: 'In Sync',
      file_count: 1420,
    },
    {
      id: 'sp_2',
      local_path: 'D:\\Workspace\\Rust_Projects',
      remote_folder_id: 'f_code',
      drive_id: 'personal',
      sync_mode: 'two-way',
      status: 'Watching for changes',
      file_count: 32,
    },
  ];

  /** Check if running inside the native Tauri 2.0 shell */
  public isNativeRuntime(): boolean {
    return typeof isTauri === 'function' ? isTauri() : false;
  }

  public async getDrives(): Promise<DriveMetadata[]> {
    return this.drives;
  }

  public async getFolders(driveId: string, parentId: string): Promise<FolderNode[]> {
    return this.folders.filter((f) => f.drive_id === driveId && f.parent_id === parentId);
  }

  public async getFiles(driveId: string, parentId: string, filter?: string): Promise<FileNode[]> {
    return this.files.filter((f) => {
      const matchDrive = f.drive_id === driveId;
      const matchParent = f.parent_id === parentId;
      const matchTrash = !f.trashed;

      if (filter === 'pinned') return matchDrive && f.pinned && matchTrash;
      if (filter === 'encrypted') return matchDrive && f.encrypted && matchTrash;
      if (filter === 'trash') return matchDrive && f.trashed;

      return matchDrive && matchParent && matchTrash;
    });
  }

  public async createFolder(driveId: string, parentId: string, name: string): Promise<FolderNode> {
    const newFolder: FolderNode = {
      id: 'f_' + Date.now(),
      drive_id: driveId,
      parent_id: parentId,
      name,
      count: '0 files',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.folders.push(newFolder);
    return newFolder;
  }

  public async renameNode(id: string, newName: string): Promise<void> {
    const folder = this.folders.find((f) => f.id === id);
    if (folder) {
      folder.name = newName;
      folder.updated_at = new Date().toISOString();
      return;
    }
    const file = this.files.find((f) => f.id === id);
    if (file) {
      file.name = newName;
      file.updated_at = new Date().toISOString();
    }
  }

  public async togglePin(id: string): Promise<boolean> {
    const file = this.files.find((f) => f.id === id);
    if (file) {
      file.pinned = !file.pinned;
      return file.pinned;
    }
    return false;
  }

  public async trashFile(id: string): Promise<void> {
    const file = this.files.find((f) => f.id === id);
    if (file) {
      file.trashed = true;
    }
  }

  public async search(driveId: string, query: string): Promise<SearchResult[]> {
    if (this.isNativeRuntime()) {
      try {
        const resp = await invoke<TauriCommandResponse<SearchResult[]>>('search_nodes_command', {
          driveId,
          query,
        });
        if (resp && resp.success && resp.data) {
          return resp.data;
        }
      } catch (err) {
        console.warn('Tauri IPC search failed, falling back to in-memory search:', err);
      }
    }

    const q = query.toLowerCase();
    const results: SearchResult[] = [];

    this.folders
      .filter((f) => f.drive_id === driveId && f.name.toLowerCase().includes(q))
      .forEach((f) => results.push({ id: f.id, drive_id: f.drive_id, name: f.name, kind: 'folder', parent_id: f.parent_id }));

    this.files
      .filter((f) => f.drive_id === driveId && !f.trashed && f.name.toLowerCase().includes(q))
      .forEach((f) => results.push({ id: f.id, drive_id: f.drive_id, name: f.name, kind: 'file', parent_id: f.parent_id, size_bytes: f.size_bytes }));

    return results;
  }

  public async flushManifest(driveId: string, channelId: number): Promise<void> {
    if (this.isNativeRuntime()) {
      try {
        await invoke<TauriCommandResponse<void>>('flush_manifest_command', {
          driveId,
          channelId,
        });
        return;
      } catch (err) {
        console.warn('Tauri IPC flush failed, falling back to mock:', err);
      }
    }
    console.debug('Manifest flushed to channel', channelId);
  }

  public async getSyncPairs(): Promise<SyncPair[]> {
    return this.syncPairs;
  }

  public async addSyncPair(localPath: string, remoteFolderId: string, driveId: string, mode: 'one-way' | 'two-way'): Promise<SyncPair> {
    const newPair: SyncPair = {
      id: 'sp_' + Date.now(),
      local_path: localPath,
      remote_folder_id: remoteFolderId,
      drive_id: driveId,
      sync_mode: mode,
      status: 'In Sync',
      file_count: 0,
    };
    this.syncPairs.push(newPair);
    return newPair;
  }
}
