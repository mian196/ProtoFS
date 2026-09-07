import { invoke, isTauri } from '@tauri-apps/api/core';
import type {
  AuthResponse,
  AuthSession,
  DriveMetadata,
  ExportDriveResult,
  FileNode,
  FileVersion,
  FolderNode,
  OwnedChannel,
  QrStatusResponse,
  SearchResult,
  SyncPair,
  UpdateInfo,
  ShellIntegrationStatus,
  CameraBackupConfig,
  ShareLinkInfo,
  ParsedShareLink,
} from './types';

interface TauriCommandResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const STORAGE_KEY_SESSION = 'protofs_session';
const STORAGE_KEY_ACCOUNTS = 'protofs_accounts';
const STORAGE_KEY_DRIVES = 'protofs_drives';
const STORAGE_KEY_FOLDERS = 'protofs_folders';
const STORAGE_KEY_FILES = 'protofs_files';
const STORAGE_KEY_SYNC_PAIRS = 'protofs_sync_pairs';

export class ProtoFsApi {
  // -------------------------------------------------------------------------
  // Session & Authentication (PRD Section 6.1 & 6.18)
  // -------------------------------------------------------------------------

  async getSessionStatus(): Promise<AuthSession | null> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<AuthSession | null>>('get_session_status');
        if (res.success) {
          if (res.data) {
            localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(res.data));
            return res.data;
          } else {
            // Tauri backend explicitly has no active session
            localStorage.removeItem(STORAGE_KEY_SESSION);
            return null;
          }
        }
      } catch (err) {
        console.warn('Tauri get_session_status failed, checking local cache:', err);
      }
    }
    const cached = localStorage.getItem(STORAGE_KEY_SESSION);
    return cached ? JSON.parse(cached) : null;
  }

  async loginSendCode(phone: string, apiId: string, apiHash: string): Promise<string> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<string>>('login_send_code', {
          phone,
          apiId,
          apiHash,
        });
        if (res.success && res.data) {
          return res.data;
        }
        throw new Error(res.error || 'Failed to send login code');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }
    // Web fallback for testing without Tauri binary
    return 'demo_code_hash_12345';
  }

  async loginVerifyCode(
    phone: string,
    apiId: string,
    apiHash: string,
    code: string
  ): Promise<AuthResponse> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<AuthResponse>>('login_verify_code', {
          phone,
          apiId,
          apiHash,
          code,
        });
        if (res.success && res.data) {
          if (res.data.session) {
            localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(res.data.session));
          }
          return res.data;
        }
        throw new Error(res.error || 'Invalid verification code');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    // Web fallback
    const session: AuthSession = {
      is_authenticated: true,
      phone,
      api_id: apiId,
      api_hash: apiHash,
      username: 'MuzAmMaL',
      first_name: 'MuzAmMaL',
      user_id: 1049281720,
      active_drive_id: 'personal',
      is_demo: true,
    };
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    return { session, requires_2fa: false };
  }

  async loginVerify2Fa(
    apiId: string,
    apiHash: string,
    password: string
  ): Promise<AuthResponse> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<AuthResponse>>('login_verify_2fa', {
          apiId,
          apiHash,
          password,
        });
        if (res.success && res.data) {
          if (res.data.session) {
            localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(res.data.session));
          }
          return res.data;
        }
        throw new Error(res.error || 'Invalid 2FA password');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    const session: AuthSession = {
      is_authenticated: true,
      phone: '+1 (202) 555-0196',
      api_id: apiId,
      api_hash: apiHash,
      username: 'MuzAmMaL',
      first_name: 'MuzAmMaL',
      user_id: 1049281720,
      active_drive_id: 'personal',
      is_demo: true,
    };
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    return { session, requires_2fa: false };
  }

  async loginRequestQr(apiId: string, apiHash: string): Promise<QrStatusResponse> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<QrStatusResponse>>('login_request_qr', {
          apiId,
          apiHash,
        });
        if (res.success && res.data) {
          return res.data;
        }
        throw new Error(res.error || 'Failed to request QR login');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    return {
      token_url: 'tg://login?token=demo_token_protofs_quick_test',
      expires_in_sec: 120,
      status: 'waiting_scan',
      session: null,
    };
  }

  async loginCheckQr(apiId: string, apiHash: string): Promise<QrStatusResponse> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<QrStatusResponse>>('login_check_qr', {
          apiId,
          apiHash,
        });
        if (res.success && res.data) {
          if (res.data.session) {
            localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(res.data.session));
          }
          return res.data;
        }
        throw new Error(res.error || 'Failed to check QR login status');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    return {
      token_url: '',
      expires_in_sec: 0,
      status: 'waiting_scan',
      session: null,
    };
  }

  async logout(): Promise<void> {
    if (isTauri()) {
      try {
        await invoke('logout_command');
      } catch (err) {
        console.warn('Tauri logout error:', err);
      }
    }
    localStorage.removeItem(STORAGE_KEY_SESSION);
    localStorage.removeItem(STORAGE_KEY_DRIVES);
    localStorage.removeItem(STORAGE_KEY_FOLDERS);
    localStorage.removeItem(STORAGE_KEY_FILES);
  }

  // Multi-Account Management
  async listAccounts(): Promise<AuthSession[]> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<AuthSession[]>>('list_accounts_command');
        if (res.success && res.data) {
          localStorage.setItem(STORAGE_KEY_ACCOUNTS, JSON.stringify(res.data));
          return res.data;
        }
      } catch (err) {
        console.warn('Tauri list_accounts_command error:', err);
      }
    }
    const cached = localStorage.getItem(STORAGE_KEY_ACCOUNTS);
    if (cached) return JSON.parse(cached);
    const active = await this.getSessionStatus();
    return active ? [active] : [];
  }

  async switchAccount(userId: number): Promise<AuthSession> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<AuthSession>>('switch_account_command', {
          userId,
        });
        if (res.success && res.data) {
          localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(res.data));
          return res.data;
        }
        throw new Error(res.error || 'Failed to switch account');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    const accounts = await this.listAccounts();
    const target = accounts.find(a => a.user_id === userId);
    if (!target) throw new Error('Account not found');
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(target));
    return target;
  }

  async removeAccount(userId: number): Promise<AuthSession | null> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<AuthSession | null>>('remove_account_command', {
          userId,
        });
        if (res.success) {
          if (res.data) {
            localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(res.data));
          } else {
            localStorage.removeItem(STORAGE_KEY_SESSION);
          }
          return res.data || null;
        }
        throw new Error(res.error || 'Failed to remove account');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    let accounts = await this.listAccounts();
    accounts = accounts.filter(a => a.user_id !== userId);
    localStorage.setItem(STORAGE_KEY_ACCOUNTS, JSON.stringify(accounts));
    const next = accounts[0] || null;
    if (next) {
      localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(next));
    } else {
      localStorage.removeItem(STORAGE_KEY_SESSION);
    }
    return next;
  }

  // -------------------------------------------------------------------------
  // Drives (PRD Section 6.2)
  // -------------------------------------------------------------------------

  async getDrives(): Promise<DriveMetadata[]> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<DriveMetadata[]>>('get_drives_command');
        if (res.success && res.data && res.data.length > 0) {
          return res.data;
        }
      } catch (err) {
        console.warn('Tauri get_drives_command error, falling back:', err);
      }
    }

    const session = await this.getSessionStatus();
    if (session && !session.is_demo) {
      return [
        {
          id: `drive_${session.user_id}`,
          name: 'ProtoFS Cloud Drive',
          channel_id: 0,
          pinned_manifest_msg_id: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
    }

    const cached = localStorage.getItem(STORAGE_KEY_DRIVES);
    if (cached) return JSON.parse(cached);

    const defaultDrives: DriveMetadata[] = [
      {
        id: 'personal',
        name: 'Personal Drive',
        channel_id: -1001928472910,
        pinned_manifest_msg_id: 104,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'work',
        name: 'Work Archive',
        channel_id: -1001982736192,
        pinned_manifest_msg_id: 88,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    return defaultDrives;
  }

  async createDrive(name: string, channelId: number): Promise<DriveMetadata> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<DriveMetadata>>('create_drive_command', {
          name,
          channelId,
        });
        if (res.success && res.data) return res.data;
        throw new Error(res.error || 'Failed to create drive');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    const drives = await this.getDrives();
    const newDrive: DriveMetadata = {
      id: `drive_${Date.now()}`,
      name,
      channel_id: channelId,
      pinned_manifest_msg_id: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    drives.push(newDrive);
    localStorage.setItem(STORAGE_KEY_DRIVES, JSON.stringify(drives));
    return newDrive;
  }

  async getOwnedChannels(showAll: boolean): Promise<OwnedChannel[]> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<OwnedChannel[]>>('get_owned_channels_command', {
          showAll,
        });
        if (res.success && res.data) return res.data;
      } catch (err) {
        console.warn('Tauri get_owned_channels_command error:', err);
      }
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
      return defaultChannels.filter(c => c.is_protofs_drive);
    }
    return defaultChannels;
  }

  async adoptChannelAsDrive(channelId: number, name: string): Promise<DriveMetadata> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<DriveMetadata>>('adopt_channel_as_drive_command', {
          channelId,
          name,
        });
        if (res.success && res.data) return res.data;
        throw new Error(res.error || 'Failed to adopt channel');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    return this.createDrive(name, channelId);
  }

  // -------------------------------------------------------------------------
  // Nodes (Folders & Files)
  // -------------------------------------------------------------------------

  async loadDrive(driveId: string, channelId: number): Promise<{ folders: FolderNode[]; files: FileNode[] }> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<any[]>>('load_drive_command', {
          driveId,
          channelId,
        });
        if (res.success && res.data) {
          const folders: FolderNode[] = [];
          const files: FileNode[] = [];
          for (const item of res.data) {
            if (item.kind === 'Folder' || item.kind === 'folder') {
              folders.push(item);
            } else if (item.kind === 'File' || item.kind === 'file') {
              files.push({
                ...item,
                size: formatBytes(item.size_bytes || 0),
                type: detectFileType(item.name),
                encrypted: item.is_encrypted,
                pinned: item.is_pinned_offline,
                trashed: item.is_trashed,
                date: formatDate(item.updated_at),
              });
            }
          }
          return { folders, files };
        }
      } catch (err) {
        console.warn('Tauri load_drive_command error:', err);
      }
    }

    const session = await this.getSessionStatus();
    // Real account should never see mock demo files
    if (session && !session.is_demo) {
      return { folders: [], files: [] };
    }

    // Local state fallback with rich realistic data for demo
    return this.getLocalDriveData(driveId);
  }

  async createFolder(driveId: string, parentId: string, name: string): Promise<FolderNode> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<FolderNode>>('create_folder_command', {
          driveId,
          parentId,
          name,
        });
        if (res.success && res.data) return res.data;
        throw new Error(res.error || 'Failed to create folder');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    const folders = this.getStoredFolders();
    const folder: FolderNode = {
      id: `f_${Date.now().toString(36)}`,
      drive_id: driveId,
      parent_id: parentId,
      name,
      count: '0 files',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    folders.push(folder);
    localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(folders));
    return folder;
  }

  async uploadFile(
    driveId: string,
    parentId: string,
    name: string,
    sizeBytes: number,
    isEncrypted: boolean
  ): Promise<FileNode> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<any>>('upload_file_command', {
          driveId,
          parentId,
          name,
          sizeBytes,
          isEncrypted,
        });
        if (res.success && res.data) {
          const item = res.data;
          return {
            ...item,
            size: formatBytes(item.size_bytes || sizeBytes),
            type: detectFileType(item.name),
            encrypted: item.is_encrypted,
            pinned: item.is_pinned_offline,
            trashed: item.is_trashed,
            date: 'Just now',
          };
        }
        throw new Error(res.error || 'Failed to upload file');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    const files = this.getStoredFiles();
    const file: FileNode = {
      id: `file_${Date.now()}`,
      drive_id: driveId,
      parent_id: parentId,
      name,
      size: formatBytes(sizeBytes),
      size_bytes: sizeBytes,
      type: detectFileType(name),
      telegram_message_id: Math.floor(Math.random() * 90000) + 10000,
      encrypted: isEncrypted,
      encryption_iv: isEncrypted ? 'a1b2c3d4e5f67890' : undefined,
      sha256_hash: '3a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b',
      pinned: false,
      trashed: false,
      date: 'Just now',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    files.push(file);
    localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(files));
    return file;
  }

  async getFileVersions(driveId: string, fileId: string): Promise<FileVersion[]> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<FileVersion[]>>('get_file_versions_command', {
          driveId,
          fileId,
        });
        if (res.success && res.data) return res.data;
      } catch (err) {
        console.warn('Tauri get_file_versions_command error:', err);
      }
    }
    const files = this.getStoredFiles();
    const file = files.find(f => f.id === fileId);
    return file?.history || [];
  }

  async restoreFileVersion(driveId: string, fileId: string, targetVersion: number): Promise<FileNode> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<any>>('restore_file_version_command', {
          driveId,
          fileId,
          targetVersion,
        });
        if (res.success && res.data) {
          const item = res.data;
          return {
            ...item,
            size: formatBytes(item.size_bytes || 0),
            type: detectFileType(item.name),
            encrypted: item.is_encrypted,
            pinned: item.is_pinned_offline,
            trashed: item.is_trashed,
            date: 'Restored',
          };
        }
        throw new Error(res.error || 'Failed to restore file version');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    const files = this.getStoredFiles();
    const file = files.find(f => f.id === fileId);
    if (!file) throw new Error('File not found');
    return file;
  }

  async exportDrive(driveId: string, targetPath: string): Promise<ExportDriveResult> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<ExportDriveResult>>('export_drive_command', {
          driveId,
          targetPath,
        });
        if (res.success && res.data) return res.data;
        throw new Error(res.error || 'Failed to export drive');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    return {
      export_path: `${targetPath}/Exported_Drive`,
      total_folders: 4,
      total_files: 8,
      total_bytes: 18491020,
    };
  }

  async deleteNode(driveId: string, nodeId: string, permanent: boolean): Promise<void> {
    if (isTauri()) {
      try {
        await invoke('delete_node_command', { driveId, nodeId, permanent });
        return;
      } catch (err) {
        console.warn('Tauri delete_node_command fallback:', err);
      }
    }

    const files = this.getStoredFiles();
    const idx = files.findIndex(f => f.id === nodeId);
    if (idx !== -1) {
      if (permanent) {
        files.splice(idx, 1);
      } else {
        files[idx].trashed = true;
      }
      localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(files));
      return;
    }

    const folders = this.getStoredFolders();
    const fIdx = folders.findIndex(f => f.id === nodeId);
    if (fIdx !== -1) {
      folders.splice(fIdx, 1);
      localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(folders));
    }
  }

  async restoreNode(driveId: string, nodeId: string): Promise<void> {
    if (isTauri()) {
      try {
        await invoke('restore_node_command', { driveId, nodeId });
        return;
      } catch (err) {
        console.warn('Tauri restore_node_command fallback:', err);
      }
    }

    const files = this.getStoredFiles();
    const file = files.find(f => f.id === nodeId);
    if (file) {
      file.trashed = false;
      localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(files));
    }
  }

  async emptyTrash(driveId: string): Promise<number> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<number>>('empty_trash_command', { driveId });
        if (res.success && typeof res.data === 'number') return res.data;
      } catch (err) {
        console.warn('Tauri empty_trash_command fallback:', err);
      }
    }

    const files = this.getStoredFiles();
    const remaining = files.filter(f => !f.trashed || f.drive_id !== driveId);
    const count = files.length - remaining.length;
    localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(remaining));
    return count;
  }

  async togglePin(driveId: string, nodeId: string, pinned: boolean): Promise<void> {
    if (isTauri()) {
      try {
        await invoke('toggle_pin_command', { driveId, nodeId, pinned });
        return;
      } catch (err) {
        console.warn('Tauri toggle_pin_command fallback:', err);
      }
    }

    const files = this.getStoredFiles();
    const file = files.find(f => f.id === nodeId);
    if (file) {
      file.pinned = pinned;
      localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(files));
    }
  }

  async searchNodes(driveId: string, query: string): Promise<SearchResult[]> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<SearchResult[]>>('search_nodes_command', {
          driveId,
          query,
        });
        if (res.success && res.data) return res.data;
      } catch (err) {
        console.warn('Tauri search fallback:', err);
      }
    }

    const q = query.toLowerCase();
    const results: SearchResult[] = [];
    for (const f of this.getStoredFolders()) {
      if (f.drive_id === driveId && f.name.toLowerCase().includes(q)) {
        results.push({ id: f.id, drive_id: f.drive_id, name: f.name, kind: 'folder', parent_id: f.parent_id });
      }
    }
    for (const fl of this.getStoredFiles()) {
      if (fl.drive_id === driveId && fl.name.toLowerCase().includes(q)) {
        results.push({
          id: fl.id,
          drive_id: fl.drive_id,
          name: fl.name,
          kind: 'file',
          parent_id: fl.parent_id,
          size_bytes: fl.size_bytes,
        });
      }
    }
    return results;
  }

  async renameNode(driveId: string, nodeId: string, newName: string): Promise<void> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<void>>('rename_node_command', {
          driveId,
          nodeId,
          newName,
        });
        if (res.success) return;
        throw new Error(res.error || 'Failed to rename item');
      } catch (err: any) {
        console.warn('Tauri rename_node_command fallback:', err);
      }
    }

    const folders = this.getStoredFolders();
    const folder = folders.find(f => f.id === nodeId);
    if (folder) {
      folder.name = newName;
      folder.updated_at = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(folders));
      return;
    }

    const files = this.getStoredFiles();
    const file = files.find(f => f.id === nodeId);
    if (file) {
      file.name = newName;
      file.updated_at = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(files));
    }
  }

  async moveNode(driveId: string, nodeId: string, newParentId: string): Promise<void> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<void>>('move_node_command', {
          driveId,
          nodeId,
          newParentId,
        });
        if (res.success) return;
        throw new Error(res.error || 'Failed to move item');
      } catch (err: any) {
        console.warn('Tauri move_node_command fallback:', err);
      }
    }

    const folders = this.getStoredFolders();
    const folder = folders.find(f => f.id === nodeId);
    if (folder) {
      folder.parent_id = newParentId;
      folder.updated_at = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(folders));
      return;
    }

    const files = this.getStoredFiles();
    const file = files.find(f => f.id === nodeId);
    if (file) {
      file.parent_id = newParentId;
      file.updated_at = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(files));
    }
  }

  // -------------------------------------------------------------------------
  // Sync Pairs (PRD Section 6.6)
  // -------------------------------------------------------------------------

  async getSyncPairs(driveId = 'personal'): Promise<SyncPair[]> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<any[]>>('get_sync_pairs_command', { driveId });
        if (res.success && Array.isArray(res.data)) {
          return res.data.map(p => ({
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

    // Purge legacy storage containing hardcoded dummy pairs if present
    const legacy = localStorage.getItem(STORAGE_KEY_SYNC_PAIRS);
    if (legacy) {
      localStorage.removeItem(STORAGE_KEY_SYNC_PAIRS);
    }

    const driveKey = `${STORAGE_KEY_SYNC_PAIRS}_${driveId}`;
    const cached = localStorage.getItem(driveKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return parsed.filter((p: any) => p.id !== 'sync_1' && p.id !== 'sync_2');
        }
      } catch {
        return [];
      }
    }

    return [];
  }

  async addSyncPair(pair: Omit<SyncPair, 'id' | 'status' | 'file_count'>): Promise<SyncPair> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<any>>('add_sync_pair_command', {
          driveId: pair.drive_id,
          localPath: pair.local_path,
          remoteFolderId: pair.remote_folder_id,
          syncMode: pair.sync_mode,
        });
        if (res.success && res.data) {
          return {
            id: res.data.id,
            local_path: res.data.local_path,
            remote_folder_id: res.data.remote_folder_id,
            drive_id: res.data.drive_id,
            sync_mode: res.data.sync_mode,
            status: 'Active (Watching)',
            file_count: 0,
          };
        }
      } catch (err) {
        console.warn('Tauri add_sync_pair_command fallback:', err);
      }
    }

    const pairs = await this.getSyncPairs(pair.drive_id);
    const newPair: SyncPair = {
      ...pair,
      id: `sync_${Date.now()}`,
      status: 'Active (Watching)',
      file_count: 0,
    };
    pairs.push(newPair);
    const driveKey = `${STORAGE_KEY_SYNC_PAIRS}_${pair.drive_id}`;
    localStorage.setItem(driveKey, JSON.stringify(pairs));
    return newPair;
  }

  async removeSyncPair(id: string, driveId = 'personal'): Promise<void> {
    if (isTauri()) {
      try {
        await invoke('remove_sync_pair_command', { id });
      } catch (err) {
        console.warn('Tauri remove_sync_pair_command fallback:', err);
      }
    }
    const pairs = (await this.getSyncPairs(driveId)).filter(p => p.id !== id);
    const driveKey = `${STORAGE_KEY_SYNC_PAIRS}_${driveId}`;
    localStorage.setItem(driveKey, JSON.stringify(pairs));
  }

  async triggerSync(id: string): Promise<void> {
    if (isTauri()) {
      try {
        await invoke('trigger_sync_command', { id });
      } catch (err) {
        console.warn('Tauri trigger_sync_command fallback:', err);
      }
    }
  }

  async getStorageUsage(driveId: string): Promise<{
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
        const res = await invoke<TauriCommandResponse<any>>('get_storage_usage_command', { driveId });
        if (res.success && res.data) {
          return res.data;
        }
      } catch (err) {
        console.warn('Tauri get_storage_usage_command fallback:', err);
      }
    }

    // Fallback calculation from local drive
    const { folders, files } = await this.loadDrive(driveId, 0);
    let total_bytes = 0;
    let video_bytes = 0;
    let image_bytes = 0;
    let document_bytes = 0;
    let audio_bytes = 0;
    let other_bytes = 0;

    for (const fl of files) {
      if (!fl.trashed) {
        total_bytes += fl.size_bytes;
        if (fl.type === 'video') video_bytes += fl.size_bytes;
        else if (fl.type === 'image') image_bytes += fl.size_bytes;
        else if (fl.type === 'sheet' || fl.type === 'pdf') document_bytes += fl.size_bytes;
        else if (fl.type === 'audio') audio_bytes += fl.size_bytes;
        else other_bytes += fl.size_bytes;
      }
    }

    return {
      total_bytes,
      total_files: files.filter(f => !f.trashed).length,
      total_folders: folders.length,
      video_bytes,
      image_bytes,
      document_bytes,
      audio_bytes,
      other_bytes,
      local_cache_bytes: 42 * 1024 * 1024,
    };
  }

  async checkForUpdates(): Promise<UpdateInfo> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<UpdateInfo>>('check_for_updates_command');
        if (res.success && res.data) return res.data;
      } catch (err) {
        console.warn('Tauri check_for_updates_command error:', err);
      }
    }

    return {
      current_version: '0.2.0',
      latest_version: '0.2.1',
      update_available: true,
      release_notes: `### ProtoFS v0.2.1 Release Highlights:

- In-App Office Document Previewers: Full interactive support for docx, xlsx, pptx, and high-fidelity audio streams.
- Full Drive Local Export: One-click directory tree reconstruction to disk with root manifest portability.
- File Version History: Non-destructive overwrite tracking with up to 10 versions and one-click restore.
- Multi-Account Support: Instant switching between multiple linked Telegram accounts.
- Zero-Knowledge Stream Encryption: Hardened 64KB AES-256-GCM chunk verification with Argon2id.`,
      release_date: '2026-09-07',
      download_url: 'https://github.com/mian196/ProtoFS/releases/tag/v0.2.1',
      signature_verified: true,
      channel: 'Stable (GitHub Releases)',
    };
  }

  // -------------------------------------------------------------------------
  // OS Context Menu & Shell Integration (PRD Section 6.13)
  // -------------------------------------------------------------------------

  async getShellIntegrationStatus(): Promise<ShellIntegrationStatus> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<ShellIntegrationStatus>>('get_shell_integration_status_command');
        if (res.success && res.data) return res.data;
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

  async setShellIntegration(enableSendTo: boolean, enableContextMenu: boolean): Promise<ShellIntegrationStatus> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<ShellIntegrationStatus>>('set_shell_integration_command', {
          enableSendTo,
          enableContextMenu,
        });
        if (res.success && res.data) return res.data;
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

  async getPendingUploads(): Promise<string[]> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<string[]>>('get_pending_uploads_command');
        if (res.success && res.data) return res.data;
      } catch (err) {
        console.warn('Tauri get_pending_uploads_command error:', err);
      }
    }
    return [];
  }

  async openPathInExplorer(path: string): Promise<boolean> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<boolean>>('open_path_in_explorer_command', { path });
        if (res.success && typeof res.data === 'boolean') return res.data;
      } catch (err) {
        console.warn('Tauri open_path_in_explorer_command error:', err);
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Camera Auto-Backup & Media Sync (PRD Section 6.9)
  // -------------------------------------------------------------------------

  async getCameraBackupConfig(driveId: string): Promise<CameraBackupConfig> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<CameraBackupConfig>>('get_camera_backup_config_command', { driveId });
        if (res.success && res.data) return res.data;
      } catch (err) {
        console.warn('Tauri get_camera_backup_config_command error:', err);
      }
    }

    const pairs = await this.getSyncPairs(driveId);
    const cameraPair = pairs.find(p => p.sync_mode.includes('camera') || p.local_path.includes('Camera') || p.local_path.includes('Pictures'));
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

  async configureCameraBackup(
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
        const res = await invoke<TauriCommandResponse<any>>('configure_camera_backup_command', {
          driveId,
          localPath: params.localPath,
          remoteFolderId: params.remoteFolderId,
          wifiOnly: params.wifiOnly,
          chargingOnly: params.chargingOnly,
          includeVideos: params.includeVideos,
          originalQuality: params.originalQuality,
        });
        if (res.success && res.data) {
          return {
            id: res.data.id,
            local_path: res.data.local_path,
            remote_folder_id: res.data.remote_folder_id,
            drive_id: res.data.drive_id,
            sync_mode: res.data.sync_mode,
            status: 'Active (Continuous Watcher)',
            file_count: 24,
          };
        }
      } catch (err) {
        console.warn('Tauri configure_camera_backup_command error:', err);
      }
    }

    const pairs = await this.getSyncPairs(driveId);
    const filtered = pairs.filter(
      (p: SyncPair) =>
        !p.sync_mode.includes('camera') &&
        !p.local_path.includes('Camera') &&
        !p.local_path.includes('Pictures')
    );
    const modeDesc = `camera-backup (wifi:${params.wifiOnly}, charging:${params.chargingOnly}, videos:${params.includeVideos}, raw:${params.originalQuality})`;
    const newPair: SyncPair = {
      id: `camera_sync_${Date.now()}`,
      local_path: params.localPath,
      remote_folder_id: params.remoteFolderId,
      drive_id: driveId,
      sync_mode: modeDesc as any,
      status: 'Active (Continuous Watcher)',
      file_count: 24,
    };
    filtered.push(newPair);
    localStorage.setItem(STORAGE_KEY_SYNC_PAIRS, JSON.stringify(filtered));
    return newPair;
  }

  // -------------------------------------------------------------------------
  // Shareable Links (PRD Section 6.11)
  // -------------------------------------------------------------------------

  async generateShareLink(driveId: string, fileId: string, includeKey?: string): Promise<ShareLinkInfo | null> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<ShareLinkInfo>>('generate_share_link_command', {
          driveId,
          fileId,
          includeKey,
        });
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
      } catch (err) {
        console.warn('Tauri generate_share_link_command error:', err);
      }
    }

    const files = this.getStoredFiles();
    const file = files.find(f => f.id === fileId);
    if (!file) return null;

    const drives = await this.getDrives();
    const drive = drives.find(d => d.id === driveId) || { id: driveId, name: 'Personal Cloud Drive', channel_id: 1982736450 };
    const cleanCid = Math.abs(drive.channel_id);
    const strippedCid = cleanCid.toString().startsWith('100') ? cleanCid.toString().substring(3) : cleanCid.toString();
    const msgId = file.telegram_message_id || 10420;

    let protofsUrl = `protofs://share?drive=${encodeURIComponent(driveId)}&file=${encodeURIComponent(fileId)}&channel=${drive.channel_id}&msg=${msgId}&name=${encodeURIComponent(file.name)}&size=${file.size_bytes || 0}&enc=${file.encrypted}`;
    if (includeKey && includeKey.trim()) {
      protofsUrl += `#key=${encodeURIComponent(includeKey.trim())}`;
    }

    return {
      file_id: file.id,
      file_name: file.name,
      drive_id: drive.id,
      drive_name: drive.name,
      channel_id: drive.channel_id,
      telegram_message_id: msgId,
      size_bytes: file.size_bytes || 0,
      mime_type: undefined,
      is_encrypted: !!file.encrypted,
      telegram_message_link: `https://t.me/c/${strippedCid}/${msgId}`,
      telegram_web_link: `https://web.telegram.org/a/#-${cleanCid}_${msgId}`,
      protofs_app_link: protofsUrl,
      channel_invite_url: undefined,
      zero_knowledge_note: file.encrypted
        ? (includeKey ? 'Zero-Knowledge Protection: Decryption key is embedded in the client-side URL fragment hash (#key=...). In adherence to RFC 3986, fragment hashes are never sent across the network or to Telegram servers.' : 'Zero-Knowledge Protection: File is encrypted with AES-256-GCM. Decryption passphrase must be shared separately.')
        : 'Public Telegram Link: Plaintext file accessible directly via Telegram channel.',
    };
  }

  async parseShareLink(linkUrl: string): Promise<ParsedShareLink | null> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<ParsedShareLink>>('parse_share_link_command', { linkUrl });
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
      } catch (err) {
        console.warn('Tauri parse_share_link_command error:', err);
      }
    }

    const trimmed = linkUrl.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('protofs://share')) {
      const [mainPart, hashPart] = trimmed.split('#');
      const key = hashPart && hashPart.startsWith('key=') ? decodeURIComponent(hashPart.substring(4)) : undefined;
      const query = mainPart.split('?')[1] || '';
      const params = new URLSearchParams(query);

      return {
        is_valid: true,
        drive_id: params.get('drive') ? decodeURIComponent(params.get('drive')!) : undefined,
        file_id: params.get('file') ? decodeURIComponent(params.get('file')!) : undefined,
        channel_id: params.get('channel') ? parseInt(params.get('channel')!, 10) : undefined,
        telegram_message_id: params.get('msg') ? parseInt(params.get('msg')!, 10) : undefined,
        name: params.get('name') ? decodeURIComponent(params.get('name')!) : 'Shared_File',
        size_bytes: params.get('size') ? parseInt(params.get('size')!, 10) : 0,
        is_encrypted: params.get('enc') === 'true' || params.get('enc') === '1',
        encryption_key: key,
        original_url: trimmed,
      };
    }

    if (trimmed.includes('t.me/c/')) {
      const parts = trimmed.split('t.me/c/')[1]?.split('/') || [];
      if (parts.length >= 2) {
        const cid = parseInt(parts[0], 10);
        const mid = parseInt(parts[1].split('?')[0], 10);
        if (!isNaN(cid) && !isNaN(mid)) {
          return {
            is_valid: true,
            channel_id: -1000000000000 - cid,
            telegram_message_id: mid,
            name: `Telegram_Message_${mid}.bin`,
            size_bytes: 0,
            is_encrypted: false,
            original_url: trimmed,
          };
        }
      }
    }

    return null;
  }

  async importSharedLink(
    targetDriveId: string,
    targetParentId: string,
    linkUrl: string,
    customName?: string,
    customKey?: string
  ): Promise<FileNode | null> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<any>>('import_shared_link_command', {
          targetDriveId,
          targetParentId,
          linkUrl,
          customName,
          customKey,
        });
        if (res.success && res.data) {
          const item = res.data;
          return {
            ...item,
            size: formatBytes(item.size_bytes || 0),
            type: detectFileType(item.name),
            encrypted: item.is_encrypted,
            pinned: item.is_pinned_offline,
            trashed: item.is_trashed,
            date: 'Just now',
          };
        }
        if (res.error) throw new Error(res.error);
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    const parsed = await this.parseShareLink(linkUrl);
    if (!parsed || !parsed.is_valid) throw new Error('Invalid share link format');

    const files = this.getStoredFiles();
    const finalName = customName && customName.trim() ? customName.trim() : parsed.name;
    const isEnc = parsed.is_encrypted;
    const newFile: FileNode = {
      id: `file_${Date.now()}`,
      drive_id: targetDriveId,
      parent_id: targetParentId,
      name: finalName,
      size: formatBytes(parsed.size_bytes),
      size_bytes: parsed.size_bytes,
      type: detectFileType(finalName),
      telegram_message_id: parsed.telegram_message_id || 10500,
      encrypted: isEnc,
      encryption_iv: isEnc ? 'e1f2a3b4c5d6e7f8' : undefined,
      pinned: false,
      trashed: false,
      date: 'Just now',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    files.push(newFile);
    localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(files));
    return newFile;
  }

  // -------------------------------------------------------------------------
  // Local storage helpers
  // -------------------------------------------------------------------------

  private getStoredFolders(): FolderNode[] {
    const cached = localStorage.getItem(STORAGE_KEY_FOLDERS);
    return cached ? JSON.parse(cached) : [];
  }

  private getStoredFiles(): FileNode[] {
    const cached = localStorage.getItem(STORAGE_KEY_FILES);
    return cached ? JSON.parse(cached) : [];
  }

  private getLocalDriveData(driveId: string): { folders: FolderNode[]; files: FileNode[] } {
    let folders = this.getStoredFolders();
    let files = this.getStoredFiles();

    if (folders.length === 0 && files.length === 0) {
      folders = [
        { id: 'f_docs', drive_id: 'personal', parent_id: 'root', name: 'Personal Documents', count: '14 files', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'f_media', drive_id: 'personal', parent_id: 'root', name: 'Cinema Vault', count: '8 files', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'f_code', drive_id: 'personal', parent_id: 'root', name: 'Rust Projects', count: '32 files', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'f_camera', drive_id: 'personal', parent_id: 'root', name: 'Camera Auto-Backup', count: '1,420 photos', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'f_vault', drive_id: 'personal', parent_id: 'root', name: 'Encrypted Vault', count: '6 files', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'f_docs_tax', drive_id: 'personal', parent_id: 'f_docs', name: 'Tax Receipts 2025', count: '5 files', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'f_docs_legal', drive_id: 'personal', parent_id: 'f_docs', name: 'Contracts & Legal', count: '3 files', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      ];
      files = [
        {
          id: 'file_1',
          drive_id: 'personal',
          parent_id: 'root',
          name: 'Cyberpunk_2077_NightCity_4K.mp4',
          size: '1.84 GB',
          size_bytes: 1975684956,
          type: 'video',
          telegram_message_id: 10492,
          encrypted: true,
          encryption_iv: 'a8b7c6d5e4f3a2b1',
          sha256_hash: '3a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b',
          pinned: true,
          trashed: false,
          date: 'Today, 12:40 PM',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'file_2',
          drive_id: 'personal',
          parent_id: 'root',
          name: 'ProtoFS_Core_v0.2.0_x86_64.msi',
          size: '42.5 MB',
          size_bytes: 44564480,
          type: 'binary',
          telegram_message_id: 10488,
          encrypted: false,
          pinned: false,
          trashed: false,
          date: 'Yesterday',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'file_3',
          drive_id: 'personal',
          parent_id: 'root',
          name: 'Q3_Financial_Forecast_Confidential.xlsx',
          size: '4.2 MB',
          size_bytes: 4404019,
          type: 'sheet',
          telegram_message_id: 10450,
          encrypted: true,
          encryption_iv: 'b2c3d4e5f6a7b8c9',
          pinned: true,
          trashed: false,
          date: 'Sep 04, 2026',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'file_4',
          drive_id: 'personal',
          parent_id: 'root',
          name: 'ProtoFS_Architecture_Whitepaper.pdf',
          size: '890 KB',
          size_bytes: 911360,
          type: 'pdf',
          telegram_message_id: 10421,
          encrypted: false,
          pinned: false,
          trashed: false,
          date: 'Sep 02, 2026',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'file_5',
          drive_id: 'personal',
          parent_id: 'root',
          name: 'ProtoFS_Product_Specification.docx',
          size: '1.24 MB',
          size_bytes: 1300234,
          type: 'doc',
          telegram_message_id: 10410,
          encrypted: false,
          pinned: true,
          trashed: false,
          date: 'Aug 29, 2026',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'file_6',
          drive_id: 'personal',
          parent_id: 'root',
          name: 'Investor_Pitch_Deck_2026.pptx',
          size: '8.65 MB',
          size_bytes: 9070200,
          type: 'presentation',
          telegram_message_id: 10398,
          encrypted: false,
          pinned: false,
          trashed: false,
          date: 'Aug 25, 2026',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'file_7',
          drive_id: 'personal',
          parent_id: 'root',
          name: 'Security_Architecture_Briefing.mp3',
          size: '14.2 MB',
          size_bytes: 14889780,
          type: 'audio',
          telegram_message_id: 10382,
          encrypted: true,
          encryption_iv: 'c3d4e5f6a7b8c9d0',
          pinned: false,
          trashed: false,
          date: 'Aug 20, 2026',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(folders));
      localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(files));
    } else {
      let updated = false;
      if (!files.some(f => f.type === 'doc')) {
        files.push({
          id: 'file_5',
          drive_id: 'personal',
          parent_id: 'root',
          name: 'ProtoFS_Product_Specification.docx',
          size: '1.24 MB',
          size_bytes: 1300234,
          type: 'doc',
          telegram_message_id: 10410,
          encrypted: false,
          pinned: true,
          trashed: false,
          date: 'Aug 29, 2026',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        updated = true;
      }
      if (!files.some(f => f.type === 'presentation')) {
        files.push({
          id: 'file_6',
          drive_id: 'personal',
          parent_id: 'root',
          name: 'Investor_Pitch_Deck_2026.pptx',
          size: '8.65 MB',
          size_bytes: 9070200,
          type: 'presentation',
          telegram_message_id: 10398,
          encrypted: false,
          pinned: false,
          trashed: false,
          date: 'Aug 25, 2026',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        updated = true;
      }
      if (!files.some(f => f.type === 'audio')) {
        files.push({
          id: 'file_7',
          drive_id: 'personal',
          parent_id: 'root',
          name: 'Security_Architecture_Briefing.mp3',
          size: '14.2 MB',
          size_bytes: 14889780,
          type: 'audio',
          telegram_message_id: 10382,
          encrypted: true,
          encryption_iv: 'c3d4e5f6a7b8c9d0',
          pinned: false,
          trashed: false,
          date: 'Aug 20, 2026',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        updated = true;
      }
      if (updated) {
        localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(files));
      }
    }

    return {
      folders: folders.filter(f => f.drive_id === driveId),
      files: files.filter(f => f.drive_id === driveId),
    };
  }
}

function detectFileType(name: string): 'video' | 'image' | 'pdf' | 'audio' | 'sheet' | 'doc' | 'presentation' | 'binary' {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4':
    case 'mkv':
    case 'webm':
    case 'mov':
    case 'avi':
      return 'video';
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'bmp':
    case 'ico':
      return 'image';
    case 'pdf':
      return 'pdf';
    case 'mp3':
    case 'flac':
    case 'wav':
    case 'ogg':
    case 'm4a':
    case 'aac':
      return 'audio';
    case 'xlsx':
    case 'xls':
    case 'csv':
    case 'tsv':
    case 'ods':
      return 'sheet';
    case 'docx':
    case 'doc':
    case 'odt':
    case 'rtf':
    case 'txt':
    case 'md':
      return 'doc';
    case 'pptx':
    case 'ppt':
    case 'odp':
    case 'key':
      return 'presentation';
    default:
      return 'binary';
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'Recently';
  }
}
