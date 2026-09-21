export interface DriveMetadata {
  id: string;
  name: string;
  channel_id: number;
  pinned_manifest_msg_id?: number;
  total_files?: number;
  total_bytes?: number;
  created_at: string;
  updated_at: string;
}

export interface FolderNode {
  id: string;
  drive_id: string;
  parent_id: string;
  name: string;
  count?: string;
  trashed?: boolean;
  is_trashed?: boolean;
  created_at: string;
  updated_at: string;
}

export interface FileVersion {
  version: number;
  telegram_message_id: number;
  size_bytes: number;
  mime_type?: string;
  sha256_hash?: string;
  is_encrypted: boolean;
  encryption_iv?: string;
  created_at: string;
}

export interface ExportDriveResult {
  export_path: string;
  total_folders: number;
  total_files: number;
  total_bytes: number;
}

export interface FileNode {
  id: string;
  drive_id: string;
  parent_id: string;
  name: string;
  size: string;
  size_bytes: number;
  type: 'video' | 'image' | 'pdf' | 'audio' | 'sheet' | 'doc' | 'presentation' | 'binary';
  mime_type?: string;
  telegram_message_id: number;
  encrypted: boolean;
  encryption_iv?: string;
  sha256_hash?: string;
  pinned: boolean;
  trashed: boolean;
  version?: number;
  history?: FileVersion[];
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

export interface TransferProgressPayload {
  transfer_id: string;
  file_id?: string;
  name: string;
  bytes_transferred: number;
  total_bytes: number;
  speed_bytes_sec: number;
  eta_secs: number | null;
  status: 'uploading' | 'downloading' | 'completed' | 'failed' | 'paused';
  error?: string;
}

export interface TransferItem {
  id: string;
  file_id?: string;
  name: string;
  size: string;
  size_bytes?: number;
  bytes_transferred?: number;
  total_bytes?: number;
  progress: number;
  speed: string;
  speed_bytes_sec?: number;
  eta?: string;
  eta_secs?: number | null;
  status: 'uploading' | 'downloading' | 'completed' | 'failed' | 'paused';
  error?: string;
  file_path?: string;
  drive_id?: string;
  parent_id?: string;
}

export interface OwnedChannel {
  channel_id: number;
  title: string;
  is_channel: boolean;
  is_group: boolean;
  is_creator: boolean;
  is_admin: boolean;
  is_protofs_drive: boolean;
  about?: string;
}

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_notes: string;
  release_date: string;
  download_url: string;
  signature_verified: boolean;
  channel: string;
}

export interface ShellIntegrationStatus {
  send_to_enabled: boolean;
  context_menu_enabled: boolean;
  platform: string;
  send_to_path: string;
  target_exe: string;
}

export interface CameraBackupConfig {
  enabled: boolean;
  sync_pair_id?: string;
  local_path: string;
  remote_folder_name: string;
  wifi_only: boolean;
  charging_only: boolean;
  include_videos: boolean;
  original_quality: boolean;
  last_backup_at?: string;
}

export interface ShareLinkInfo {
  file_id: string;
  file_name: string;
  drive_id: string;
  drive_name: string;
  channel_id: number;
  telegram_message_id: number;
  size_bytes: number;
  mime_type?: string;
  is_encrypted: boolean;
  telegram_message_link: string;
  telegram_web_link: string;
  protofs_app_link: string;
  channel_invite_url?: string;
  zero_knowledge_note: string;
}

export interface ParsedShareLink {
  is_valid: boolean;
  drive_id?: string;
  file_id?: string;
  channel_id?: number;
  telegram_message_id?: number;
  name: string;
  size_bytes: number;
  is_encrypted: boolean;
  encryption_key?: string;
  original_url: string;
}

export interface VirtualDriveStatus {
  is_mounted: boolean;
  drive_id: string;
  drive_letter: string;
  mount_path: string;
  driver_mode: string;
  winfsp_available: boolean;
  webdav_available?: boolean;
  webdav_url?: string;
  available_letters: string[];
  cached_files_count: number;
  cached_bytes: number;
  last_mounted_at?: string;
}

export interface WebDavServerStatus {
  is_running: boolean;
  port: number;
  url: string;
  auto_mount: boolean;
}

export interface DocumentsProviderStatus {
  is_enabled: boolean;
  authority: string;
  root_count: number;
  active_drive_id: string;
  saf_uri: string;
  cached_documents_count: number;
  is_android: boolean;
  last_sync_timestamp?: string;
}

export interface SafTestQueryResult {
  authority: string;
  document_id: string;
  display_name: string;
  mime_type: string;
  size_bytes: number;
  flags: string[];
  child_count: number;
}

export interface WorkManagerSyncConfig {
  enabled: boolean;
  interval_minutes: number;
  wifi_only: boolean;
  requires_charging: boolean;
  requires_battery_not_low: boolean;
  last_sync_timestamp?: string | null;
  last_sync_status?: string | null;
  sync_pair_ids: string[];
}

export interface WorkManagerJobRecord {
  id: string;
  timestamp: number;
  formatted_time: string;
  files_synced: number;
  bytes_transferred: number;
  formatted_bytes: string;
  duration_ms: number;
  success: boolean;
  message: string;
}

export interface WorkManagerSyncStatus {
  is_supported: boolean;
  is_active: boolean;
  config: WorkManagerSyncConfig;
  next_scheduled_run?: string | null;
  is_android: boolean;
  active_pairs_count: number;
  recent_history: WorkManagerJobRecord[];
}

export interface P2pTransferProgress {
  transfer_id: string;
  role: 'sender' | 'receiver';
  file_name: string;
  file_size: number;
  bytes_transferred: number;
  speed_bps: number;
  progress_percent: number;
  status: string;
  peer_address: string;
  pin_code: string;
  duration_ms: number;
  formatted_bytes: string;
  formatted_speed: string;
}

export interface P2pSessionInfo {
  session_id: string;
  pin_code: string;
  listen_port: number;
  local_ip: string;
  p2p_uri: string;
  qr_payload: string;
  is_active: boolean;
  role: string;
  target_file_id?: string | null;
  target_file_name?: string | null;
  target_file_size?: number | null;
}

export interface P2pStatus {
  is_supported: boolean;
  local_ip: string;
  default_port: number;
  active_session?: P2pSessionInfo | null;
  recent_transfers: P2pTransferProgress[];
}

export interface DriveHealthStatus {
  drive_id: string;
  channel_id: number;
  is_accessible: boolean;
  error?: string;
}

export interface PurgeCacheResult {
  freed_bytes: number;
  files_deleted: number;
}

export interface UploadFileOptions {
  driveId: string;
  parentId: string;
  name: string;
  sizeBytes: number;
  isEncrypted: boolean;
  filePath?: string;
  fileBytes?: Uint8Array;
  fileBase64?: string;
  conflictAction?: 'replace' | 'rename' | 'skip';
}

export type ProxyType = 'mtproto' | 'socks5' | 'http';

export interface ProxyProfile {
  id: string;
  label: string;
  proxy_type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
  secret?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProxyProfileSummary {
  id: string;
  label: string;
  proxy_type: ProxyType;
  host: string;
  port: number;
  username?: string;
  has_password: boolean;
  masked_secret?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProxyConfig {
  proxy_type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
  secret?: string;
}

export interface ProxyDiagnosticResult {
  is_connected: boolean;
  latency_ms: number | null;
  target_dc: number;
  target_endpoint: string;
  error_code: string | null;
  message: string;
}

export interface ProxyStatusResponse {
  is_enabled: boolean;
  active_proxy: ProxyProfileSummary | null;
  total_proxies: number;
}

export interface ProxyStateChangedPayload {
  is_enabled: boolean;
  active_proxy_id: string | null;
  active_proxy_label: string | null;
  timestamp: string;
}

export type SecretClassification = 'standard_mtproto' | 'obfuscated_dd' | 'fake_tls_ee' | 'invalid';

export interface SecretClassificationInfo {
  type: SecretClassification;
  label: string;
  tlsDomain?: string;
  isValid: boolean;
}

export interface FieldValidationResult {
  isValid: boolean;
  error?: string;
}

export interface ParsedProxyResult {
  isValid: boolean;
  error?: string;
  proxyType?: ProxyType;
  host?: string;
  port?: number;
  secret?: string;
  tlsDomain?: string;
  username?: string;
  password?: string;
  rawLink?: string;
}
