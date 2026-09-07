export interface DriveMetadata {
  id: string;
  name: string;
  channel_id: number;
  pinned_manifest_msg_id?: number;
  created_at: string;
  updated_at: string;
}

export interface FolderNode {
  id: string;
  drive_id: string;
  parent_id: string;
  name: string;
  count?: string;
  created_at: string;
  updated_at: string;
}

export interface FileNode {
  id: string;
  drive_id: string;
  parent_id: string;
  name: string;
  size: string;
  size_bytes: number;
  type: 'video' | 'image' | 'pdf' | 'audio' | 'sheet' | 'binary';
  mime_type?: string;
  telegram_message_id: number;
  encrypted: boolean;
  encryption_iv?: string;
  sha256_hash?: string;
  pinned: boolean;
  trashed: boolean;
  date: string;
  created_at: string;
  updated_at: string;
}

export type VfsNode = { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode };

export interface SearchResult {
  id: string;
  drive_id: string;
  name: string;
  kind: 'folder' | 'file';
  parent_id: string;
  size_bytes?: number;
}

export interface AuthSession {
  is_authenticated: boolean;
  phone: string;
  api_id: string;
  api_hash: string;
  username?: string;
  first_name: string;
  user_id: number;
  active_drive_id: string;
  is_demo?: boolean;
}

export interface AuthResponse {
  session: AuthSession | null;
  requires_2fa: boolean;
  hint?: string;
}

export interface QrStatusResponse {
  token_url: string;
  expires_in_sec: number;
  status: 'waiting_scan' | 'success' | 'requires_2fa';
  session: AuthSession | null;
  hint?: string;
}

export interface SyncPair {
  id: string;
  local_path: string;
  remote_folder_id: string;
  drive_id: string;
  sync_mode: 'one-way' | 'two-way';
  status: string;
  file_count: number;
}

export interface TransferItem {
  id: string;
  name: string;
  size: string;
  progress: number;
  speed: string;
  status: 'uploading' | 'downloading' | 'completed' | 'paused';
}
