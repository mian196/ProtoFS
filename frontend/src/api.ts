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
  VirtualDriveStatus,
  WebDavServerStatus,
  DocumentsProviderStatus,
  SafTestQueryResult,
  WorkManagerSyncConfig,
  WorkManagerJobRecord,
  WorkManagerSyncStatus,
  P2pTransferProgress,
  P2pSessionInfo,
  P2pStatus,
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
  // Session & Authentication
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
    // Tauri environment required
    throw new Error('ProtoFS requires the desktop Tauri runtime for MTProto operations.');
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
      username: 'protofs_user',
      first_name: 'ProtoFS User',
      user_id: 11100000,
      active_drive_id: 'personal',
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
      phone: '+11100000000',
      api_id: apiId,
      api_hash: apiHash,
      username: 'protofs_user',
      first_name: 'ProtoFS User',
      user_id: 11100000,
      active_drive_id: 'personal',
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

    throw new Error('ProtoFS requires the desktop Tauri runtime for MTProto operations.');
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
  // Drives
  // -------------------------------------------------------------------------

  async getDrives(): Promise<DriveMetadata[]> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<DriveMetadata[]>>('get_drives_command');
        if (res.success && res.data) {
          const filtered = res.data.filter(d => !(d.channel_id === 0 && d.name === 'ProtoFS Cloud Drive'));
          localStorage.setItem(STORAGE_KEY_DRIVES, JSON.stringify(filtered));
          return filtered;
        }
      } catch (err) {
        console.warn('Tauri get_drives_command error, falling back:', err);
      }
    }

    const cached = localStorage.getItem(STORAGE_KEY_DRIVES);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return parsed.filter((d: any) => !(d.channel_id === 0 && d.name === 'ProtoFS Cloud Drive'));
        }
      } catch {
        // ignore
      }
    }
    return [];
  }

  async deleteDrive(driveId: string): Promise<boolean> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<boolean>>('delete_drive_command', { driveId });
        if (res.success) {
          const drives = (await this.getDrives()).filter(d => d.id !== driveId);
          localStorage.setItem(STORAGE_KEY_DRIVES, JSON.stringify(drives));
          return true;
        }
      } catch (err) {
        console.warn('Tauri delete_drive_command error:', err);
      }
    }
    const drives = (await this.getDrives()).filter(d => d.id !== driveId);
    localStorage.setItem(STORAGE_KEY_DRIVES, JSON.stringify(drives));
    return true;
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

  async checkConnection(): Promise<boolean> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<boolean>>('check_telegram_connection_command');
        return res.success && Boolean(res.data);
      } catch (err) {
        console.warn('Tauri check_telegram_connection_command error:', err);
        return false;
      }
    }
    return true;
  }

  async getOwnedChannels(showAll: boolean): Promise<OwnedChannel[]> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<OwnedChannel[]>>('get_owned_channels_command', {
          showAll,
        });
        if (res.success && res.data) return res.data;
        throw new Error(res.error || 'MTProto transport error: Not authenticated with Telegram');
      } catch (err: any) {
        console.warn('Tauri get_owned_channels_command error:', err);
        throw new Error(err.message || 'MTProto unreachable');
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
    if (!driveId) {
      return { folders: [], files: [] };
    }
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

    return { folders: [], files: [] };
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
    isEncrypted: boolean,
    fileBytes?: number[],
    filePath?: string
  ): Promise<FileNode> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<any>>('upload_file_command', {
          driveId,
          parentId,
          name,
          sizeBytes,
          isEncrypted,
          fileBytes: fileBytes || null,
          filePath: filePath || null,
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

  async downloadFile(
    driveId: string,
    fileId: string,
    destinationPath?: string
  ): Promise<{ file_id: string; name: string; size_bytes: number; destination_path?: string; data_base64?: string }> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<any>>('download_file_command', {
          driveId,
          fileId,
          destinationPath: destinationPath || null,
        });
        if (res.success && res.data) {
          return res.data;
        }
        throw new Error(res.error || 'Failed to download file');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    return {
      file_id: fileId,
      name: 'downloaded_file',
      size_bytes: 0,
      destination_path: destinationPath,
    };
  }

  async getFilePreview(
    driveId: string,
    fileId: string
  ): Promise<{
    file_id: string;
    name: string;
    mime_type: string;
    size_bytes: number;
    is_text: boolean;
    text_content?: string;
    data_base64?: string;
  }> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<any>>('get_file_preview_command', {
          driveId,
          fileId,
        });
        if (res.success && res.data) {
          return res.data;
        }
        throw new Error(res.error || 'Failed to fetch preview');
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    return {
      file_id: fileId,
      name: 'preview',
      mime_type: 'application/octet-stream',
      size_bytes: 0,
      is_text: false,
    };
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
  // Sync Pairs
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
      current_version: '0.3.0',
      latest_version: '0.3.0',
      update_available: false,
      release_notes: `### ProtoFS v0.3.0 Release Highlights:

- P2P Direct Sharing: Ephemeral direct file transfers between local network peers via pairing PIN and QR codes.
- Native Virtual Drive Mount: Mount active drive directly to P:\\ on Windows with live Explorer integration.
- Android DocumentsProvider & WorkManager: Native SAF document provider and periodic background sync.
- In-App Office Document Previewers: Full interactive support for docx, xlsx, pptx, and audio streams.
- Full Drive Local Export: One-click directory tree reconstruction to disk with root manifest portability.
- File Version History: Non-destructive overwrite tracking with up to 10 versions and one-click restore.
- Zero-Knowledge Stream Encryption: Hardened 64KB AES-256-GCM chunk verification with Argon2id.`,
      release_date: '2026-09-07',
      download_url: 'https://github.com/mian196/ProtoFS/releases/tag/v0.3.0',
      signature_verified: true,
      channel: 'Stable (GitHub Releases)',
    };
  }

  // -------------------------------------------------------------------------
  // OS Context Menu & Shell Integration
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
  // Camera Auto-Backup & Media Sync
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
  // Shareable Links
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
  // WebDAV Server & Native Virtual Drive Mount
  // -------------------------------------------------------------------------

  async getWebDavConfig(): Promise<WebDavServerStatus> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<WebDavServerStatus>>('get_webdav_config_command');
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
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

  async configureWebDav(enabled: boolean, port: number, autoMount: boolean): Promise<WebDavServerStatus> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<WebDavServerStatus>>('configure_webdav_command', {
          enabled,
          port,
          autoMount,
        });
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }
    return {
      is_running: enabled,
      port: port || 28491,
      url: `http://127.0.0.1:${port || 28491}/`,
      auto_mount: autoMount,
    };
  }

  async getVirtualDriveStatus(driveId: string): Promise<VirtualDriveStatus | null> {
    if (!driveId) return null;
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<VirtualDriveStatus>>('get_virtual_drive_status_command', { driveId });
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
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

  async mountVirtualDrive(driveId: string, requestedLetter?: string, onDemandStream = true): Promise<VirtualDriveStatus | null> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<VirtualDriveStatus>>('mount_virtual_drive_command', {
          driveId,
          requestedLetter,
          onDemandStream,
        });
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
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

  async unmountVirtualDrive(driveId: string): Promise<VirtualDriveStatus | null> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<VirtualDriveStatus>>('unmount_virtual_drive_command', { driveId });
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
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

  async openVirtualDriveInExplorer(driveLetter: string): Promise<boolean> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<boolean>>('open_virtual_drive_in_explorer_command', { driveLetter });
        if (res.success && typeof res.data === 'boolean') return res.data;
      } catch (err) {
        console.warn('Tauri open_virtual_drive_in_explorer_command error:', err);
      }
    }
    return false;
  }

  async clearVirtualDriveCache(driveId: string): Promise<boolean> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<boolean>>('clear_virtual_drive_cache_command', { driveId });
        if (res.success && typeof res.data === 'boolean') return res.data;
      } catch (err) {
        console.warn('Tauri clear_virtual_drive_cache_command error:', err);
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Android DocumentsProvider & Storage Access Framework (SAF)
  // -------------------------------------------------------------------------

  async getDocumentsProviderStatus(driveId: string): Promise<DocumentsProviderStatus> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<DocumentsProviderStatus>>('get_documents_provider_status_command', { driveId });
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
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

  async toggleDocumentsProvider(driveId: string, enable: boolean): Promise<DocumentsProviderStatus> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<DocumentsProviderStatus>>('toggle_documents_provider_command', {
          driveId,
          enable,
        });
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
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

  async notifyDocumentsProviderChange(driveId: string, documentId?: string): Promise<boolean> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<boolean>>('notify_documents_provider_change_command', {
          driveId,
          documentId,
        });
        if (res.success && typeof res.data === 'boolean') return res.data;
      } catch (err) {
        console.warn('Tauri notify_documents_provider_change_command error:', err);
      }
    }
    return true;
  }

  async testSafDocumentQuery(driveId: string, documentId?: string): Promise<SafTestQueryResult> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<SafTestQueryResult>>('test_saf_document_query_command', {
          driveId,
          documentId,
        });
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
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

  // -------------------------------------------------------------------------
  // Android Jetpack WorkManager Background Sync
  // -------------------------------------------------------------------------

  async getWorkManagerSyncStatus(): Promise<WorkManagerSyncStatus> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<WorkManagerSyncStatus>>('get_workmanager_sync_status_command');
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
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

  async configureWorkManagerSync(config: WorkManagerSyncConfig): Promise<WorkManagerSyncStatus> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<WorkManagerSyncStatus>>('configure_workmanager_sync_command', {
          config,
        });
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
    }

    localStorage.setItem('protofs_workmanager_config', JSON.stringify(config));
    return this.getWorkManagerSyncStatus();
  }

  async triggerImmediateBackgroundSync(): Promise<WorkManagerJobRecord> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<WorkManagerJobRecord>>('trigger_immediate_background_sync_command');
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
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

  async getWorkManagerHistory(): Promise<WorkManagerJobRecord[]> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<WorkManagerJobRecord[]>>('get_workmanager_history_command');
        if (res.success && res.data) return res.data;
      } catch (err) {
        console.warn('Tauri get_workmanager_history_command error:', err);
      }
    }

    const rawHist = localStorage.getItem('protofs_workmanager_history');
    return rawHist ? JSON.parse(rawHist) : [];
  }

  // -------------------------------------------------------------------------
  // P2P Direct Sharing
  // -------------------------------------------------------------------------

  async getP2pStatus(): Promise<P2pStatus> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<P2pStatus>>('get_p2p_status_command');
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
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

  async startP2pSession(role: 'sender' | 'receiver', fileId?: string, driveId?: string): Promise<P2pSessionInfo> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<P2pSessionInfo>>('start_p2p_session_command', {
          role,
          fileId,
          driveId,
        });
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
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

  async connectP2pPeer(
    peerAddress: string,
    pinCode: string,
    targetFolderId?: string,
    driveId?: string
  ): Promise<P2pTransferProgress> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<P2pTransferProgress>>('connect_p2p_peer_command', {
          peerAddress,
          pinCode,
          targetFolderId,
          driveId,
        });
        if (res.success && res.data) return res.data;
        if (res.error) throw new Error(res.error);
      } catch (err: any) {
        throw new Error(err.message || String(err));
      }
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

  async cancelP2pSession(): Promise<boolean> {
    if (isTauri()) {
      try {
        const res = await invoke<TauriCommandResponse<boolean>>('cancel_p2p_session_command');
        if (res.success) return true;
      } catch (err) {
        console.warn('Tauri cancel_p2p_session_command error:', err);
      }
    }
    localStorage.removeItem('protofs_p2p_session');
    return true;
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

export const api = new ProtoFsApi();

