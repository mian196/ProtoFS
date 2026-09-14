import type {
  AuthSession,
  DriveMetadata,
  FileNode,
  FolderNode,
  ParsedShareLink,
  SearchResult,
  ShareLinkInfo,
  SyncPair,
  UploadFileOptions,
} from '../types';

export const STORAGE_KEY_SESSION = 'protofs_session';
export const STORAGE_KEY_ACCOUNTS = 'protofs_accounts';
export const STORAGE_KEY_DRIVES = 'protofs_drives';
export const STORAGE_KEY_FOLDERS = 'protofs_folders';
export const STORAGE_KEY_FILES = 'protofs_files';
export const STORAGE_KEY_SYNC_PAIRS = 'protofs_sync_pairs';

export class MockStorageApi {
  getSession(): AuthSession | null {
    const cached = localStorage.getItem(STORAGE_KEY_SESSION);
    return cached ? JSON.parse(cached) : null;
  }

  setSession(session: AuthSession | null): void {
    if (session) localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY_SESSION);
  }

  getAccounts(): AuthSession[] {
    const cached = localStorage.getItem(STORAGE_KEY_ACCOUNTS);
    return cached ? JSON.parse(cached) : [];
  }

  setAccounts(accounts: AuthSession[]): void {
    localStorage.setItem(STORAGE_KEY_ACCOUNTS, JSON.stringify(accounts));
  }

  getDrives(): DriveMetadata[] {
    const cached = localStorage.getItem(STORAGE_KEY_DRIVES);
    return cached ? JSON.parse(cached) : [
      {
        id: 'mock_personal',
        name: 'Personal Vault (Browser Mock)',
        channel_id: 123456789,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
  }

  setDrives(drives: DriveMetadata[]): void {
    localStorage.setItem(STORAGE_KEY_DRIVES, JSON.stringify(drives));
  }

  getStoredFiles(): FileNode[] {
    const cached = localStorage.getItem(STORAGE_KEY_FILES);
    return cached ? JSON.parse(cached) : [];
  }

  saveFiles(files: FileNode[]): void {
    localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(files));
  }

  getStoredFolders(): FolderNode[] {
    const cached = localStorage.getItem(STORAGE_KEY_FOLDERS);
    return cached ? JSON.parse(cached) : [];
  }

  saveFolders(folders: FolderNode[]): void {
    localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(folders));
  }

  getSyncPairs(driveId = 'personal'): SyncPair[] {
    const driveKey = `${STORAGE_KEY_SYNC_PAIRS}_${driveId}`;
    const cached = localStorage.getItem(driveKey);
    return cached ? JSON.parse(cached) : [];
  }

  saveSyncPairs(pairs: SyncPair[], driveId = 'personal'): void {
    const driveKey = `${STORAGE_KEY_SYNC_PAIRS}_${driveId}`;
    localStorage.setItem(driveKey, JSON.stringify(pairs));
  }

  clearAll(): void {
    localStorage.removeItem(STORAGE_KEY_SESSION);
    localStorage.removeItem(STORAGE_KEY_DRIVES);
    localStorage.removeItem(STORAGE_KEY_FOLDERS);
    localStorage.removeItem(STORAGE_KEY_FILES);
  }

  uploadFile(opts: UploadFileOptions): FileNode {
    const files = this.getStoredFiles();
    const file: FileNode = {
      id: `file_${Date.now()}`,
      drive_id: opts.driveId,
      parent_id: opts.parentId,
      name: opts.name,
      size: formatBytes(opts.sizeBytes),
      size_bytes: opts.sizeBytes,
      type: detectFileType(opts.name),
      telegram_message_id: Math.floor(Math.random() * 90000) + 10000,
      encrypted: opts.isEncrypted,
      encryption_iv: opts.isEncrypted ? 'a1b2c3d4e5f67890' : undefined,
      sha256_hash: '3a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b',
      pinned: false,
      trashed: false,
      date: 'Just now',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    files.push(file);
    this.saveFiles(files);
    return file;
  }

  deleteNode(nodeId: string, permanent: boolean): void {
    const files = this.getStoredFiles();
    const idx = files.findIndex((f) => f.id === nodeId);
    if (idx !== -1) {
      if (permanent) files.splice(idx, 1);
      else files[idx].trashed = true;
      this.saveFiles(files);
      return;
    }
    const folders = this.getStoredFolders();
    const fIdx = folders.findIndex((f) => f.id === nodeId);
    if (fIdx !== -1) {
      folders.splice(fIdx, 1);
      this.saveFolders(folders);
    }
  }

  restoreNode(nodeId: string): void {
    const files = this.getStoredFiles();
    const file = files.find((f) => f.id === nodeId);
    if (file) {
      file.trashed = false;
      this.saveFiles(files);
    }
  }

  emptyTrash(driveId: string): number {
    const files = this.getStoredFiles();
    const remaining = files.filter((f) => !f.trashed || f.drive_id !== driveId);
    const count = files.length - remaining.length;
    this.saveFiles(remaining);
    return count;
  }

  togglePin(nodeId: string, pinned: boolean): void {
    const files = this.getStoredFiles();
    const file = files.find((f) => f.id === nodeId);
    if (file) {
      file.pinned = pinned;
      this.saveFiles(files);
    }
  }

  searchNodes(driveId: string, query: string): SearchResult[] {
    const q = query.toLowerCase();
    const results: SearchResult[] = [];
    for (const f of this.getStoredFolders()) {
      if (f.drive_id === driveId && f.name.toLowerCase().includes(q)) {
        results.push({ id: f.id, drive_id: f.drive_id, name: f.name, kind: 'folder', parent_id: f.parent_id });
      }
    }
    for (const fl of this.getStoredFiles()) {
      if (fl.drive_id === driveId && fl.name.toLowerCase().includes(q)) {
        results.push({ id: fl.id, drive_id: fl.drive_id, name: fl.name, kind: 'file', parent_id: fl.parent_id, size_bytes: fl.size_bytes });
      }
    }
    return results;
  }

  renameNode(nodeId: string, newName: string): void {
    const folders = this.getStoredFolders();
    const folder = folders.find((f) => f.id === nodeId);
    if (folder) {
      folder.name = newName;
      folder.updated_at = new Date().toISOString();
      this.saveFolders(folders);
      return;
    }
    const files = this.getStoredFiles();
    const file = files.find((f) => f.id === nodeId);
    if (file) {
      file.name = newName;
      file.updated_at = new Date().toISOString();
      this.saveFiles(files);
    }
  }

  moveNode(nodeId: string, newParentId: string): void {
    const folders = this.getStoredFolders();
    const folder = folders.find((f) => f.id === nodeId);
    if (folder) {
      folder.parent_id = newParentId;
      folder.updated_at = new Date().toISOString();
      this.saveFolders(folders);
      return;
    }
    const files = this.getStoredFiles();
    const file = files.find((f) => f.id === nodeId);
    if (file) {
      file.parent_id = newParentId;
      file.updated_at = new Date().toISOString();
      this.saveFiles(files);
    }
  }

  generateShareLink(driveId: string, fileId: string, includeKey?: string): ShareLinkInfo | null {
    const file = this.getStoredFiles().find((f) => f.id === fileId);
    if (!file) return null;
    const drive = this.getDrives().find((d) => d.id === driveId) || { id: driveId, name: 'Personal Cloud Drive', channel_id: 1982736450 };
    const cleanCid = Math.abs(drive.channel_id);
    const strippedCid = cleanCid.toString().startsWith('100') ? cleanCid.toString().substring(3) : cleanCid.toString();
    const msgId = file.telegram_message_id || 10420;
    let protofsUrl = `protofs://share?drive=${encodeURIComponent(driveId)}&file=${encodeURIComponent(fileId)}&channel=${drive.channel_id}&msg=${msgId}&name=${encodeURIComponent(file.name)}&size=${file.size_bytes || 0}&enc=${file.encrypted}`;
    if (includeKey?.trim()) protofsUrl += `#key=${encodeURIComponent(includeKey.trim())}`;
    return {
      file_id: file.id,
      file_name: file.name,
      drive_id: drive.id,
      drive_name: drive.name,
      channel_id: drive.channel_id,
      telegram_message_id: msgId,
      size_bytes: file.size_bytes || 0,
      is_encrypted: !!file.encrypted,
      telegram_message_link: `https://t.me/c/${strippedCid}/${msgId}`,
      telegram_web_link: `https://web.telegram.org/a/#-${cleanCid}_${msgId}`,
      protofs_app_link: protofsUrl,
      zero_knowledge_note: file.encrypted ? 'End-to-End Encrypted' : 'Public Telegram Link',
    };
  }

  parseShareLink(linkUrl: string): ParsedShareLink | null {
    const trimmed = linkUrl.trim();
    if (!trimmed.startsWith('protofs://share')) return null;
    const [mainPart, hashPart] = trimmed.split('#');
    const key = hashPart?.startsWith('key=') ? decodeURIComponent(hashPart.substring(4)) : undefined;
    const params = new URLSearchParams(mainPart.split('?')[1] || '');
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

  importSharedLink(targetDriveId: string, targetParentId: string, linkUrl: string, customName?: string): FileNode | null {
    const parsed = this.parseShareLink(linkUrl);
    if (!parsed || !parsed.is_valid) throw new Error('Invalid share link format');
    const files = this.getStoredFiles();
    const finalName = customName?.trim() || parsed.name;
    const newFile: FileNode = {
      id: `file_${Date.now()}`,
      drive_id: targetDriveId,
      parent_id: targetParentId,
      name: finalName,
      size: formatBytes(parsed.size_bytes),
      size_bytes: parsed.size_bytes,
      type: detectFileType(finalName),
      telegram_message_id: parsed.telegram_message_id || 10500,
      encrypted: parsed.is_encrypted,
      pinned: false,
      trashed: false,
      date: 'Just now',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    files.push(newFile);
    this.saveFiles(files);
    return newFile;
  }
}

export function detectFileType(name: string): 'video' | 'image' | 'pdf' | 'audio' | 'sheet' | 'doc' | 'presentation' | 'binary' {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4': case 'mkv': case 'webm': case 'mov': case 'avi':
      return 'video';
    case 'jpg': case 'jpeg': case 'png': case 'gif': case 'svg': case 'webp': case 'bmp': case 'ico':
      return 'image';
    case 'pdf':
      return 'pdf';
    case 'mp3': case 'flac': case 'wav': case 'ogg': case 'm4a': case 'aac':
      return 'audio';
    case 'xlsx': case 'xls': case 'csv': case 'tsv': case 'ods':
      return 'sheet';
    case 'docx': case 'doc': case 'odt': case 'rtf': case 'txt': case 'md':
      return 'doc';
    case 'pptx': case 'ppt': case 'odp': case 'key':
      return 'presentation';
    default:
      return 'binary';
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'Recently';
  }
}

export const mockStorage = new MockStorageApi();
