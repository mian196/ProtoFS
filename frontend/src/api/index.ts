import { authApi } from './auth';
import { drivesApi } from './drives';
import { filesApi } from './files';
import { syncApi } from './sync';
import { webdavApi } from './webdav';
import { settingsApi } from './settings';
import { p2pApi } from './p2p';
import type { UploadFileOptions } from '../types';

export * from './client';
export * from './mock';
export { authApi } from './auth';
export { drivesApi } from './drives';
export { filesApi } from './files';
export { syncApi } from './sync';
export { webdavApi } from './webdav';
export { settingsApi } from './settings';
export { p2pApi } from './p2p';

/**
 * Aggregated backward-compatible facade delegating to modular domain submodules.
 */
export class ProtoFsApi {
  // Session & Auth
  getSessionStatus = authApi.getSessionStatus;
  loginSendCode = authApi.loginSendCode;
  loginVerifyCode = authApi.loginVerifyCode;
  loginVerify2fa = authApi.loginVerify2fa;
  loginVerify2Fa = authApi.loginVerify2Fa;
  loginRequestQr = authApi.loginRequestQr;
  loginCheckQr = authApi.loginCheckQr;
  logout = authApi.logout;
  listAccounts = authApi.listAccounts;
  switchAccount = authApi.switchAccount;
  removeAccount = authApi.removeAccount;

  // Drives
  getDrives = drivesApi.getDrives;
  deleteDrive = drivesApi.deleteDrive;
  syncAndPruneDrives = drivesApi.syncAndPruneDrives;
  syncChatFolder = drivesApi.syncChatFolder;
  createDrive = drivesApi.createDrive;
  checkConnection = drivesApi.checkConnection;
  checkDriveHealth = drivesApi.checkDriveHealth;
  exportDriveManifest = drivesApi.exportDriveManifest;
  getOwnedChannels = drivesApi.getOwnedChannels;
  adoptChannelAsDrive = drivesApi.adoptChannelAsDrive;

  // Files & Nodes
  loadDrive = filesApi.loadDrive;
  createFolder = filesApi.createFolder;
  uploadFile = (
    driveIdOrOptions: string | UploadFileOptions,
    parentId?: string,
    name?: string,
    sizeBytes?: number,
    isEncrypted?: boolean,
    fileBytes?: number[] | Uint8Array,
    filePath?: string,
    fileBase64?: string,
    conflictAction?: 'replace' | 'rename' | 'skip'
  ) => filesApi.uploadFile(driveIdOrOptions, parentId, name, sizeBytes, isEncrypted, fileBytes, filePath, fileBase64, conflictAction);
  downloadFile = filesApi.downloadFile;
  getFilePreview = filesApi.getFilePreview;
  getFileVersions = filesApi.getFileVersions;
  restoreFileVersion = filesApi.restoreFileVersion;
  exportDrive = filesApi.exportDrive;
  deleteNode = filesApi.deleteNode;
  restoreNode = filesApi.restoreNode;
  emptyTrash = filesApi.emptyTrash;
  togglePin = filesApi.togglePin;
  searchNodes = filesApi.searchNodes;
  renameNode = filesApi.renameNode;
  moveNode = filesApi.moveNode;
  generateShareLink = filesApi.generateShareLink;
  parseShareLink = filesApi.parseShareLink;
  importSharedLink = filesApi.importSharedLink;
  cancelTransfer = filesApi.cancelTransfer;
  pauseTransfer = filesApi.pauseTransfer;
  resumeTransfer = filesApi.resumeTransfer;

  // Sync
  getSyncPairs = syncApi.getSyncPairs;
  addSyncPair = syncApi.addSyncPair;
  removeSyncPair = syncApi.removeSyncPair;
  triggerSync = syncApi.triggerSync;
  getCameraBackupConfig = syncApi.getCameraBackupConfig;
  configureCameraBackup = syncApi.configureCameraBackup;

  // WebDAV & Virtual Drive
  getWebDavConfig = webdavApi.getWebDavConfig;
  configureWebDav = webdavApi.configureWebDav;
  getVirtualDriveStatus = webdavApi.getVirtualDriveStatus;
  mountVirtualDrive = webdavApi.mountVirtualDrive;
  unmountVirtualDrive = webdavApi.unmountVirtualDrive;
  openVirtualDriveInExplorer = webdavApi.openVirtualDriveInExplorer;
  clearVirtualDriveCache = webdavApi.clearVirtualDriveCache;

  // Settings & System
  getStorageUsage = settingsApi.getStorageUsage;
  purgeLocalCache = settingsApi.purgeLocalCache;
  checkForUpdates = settingsApi.checkForUpdates;
  getShellIntegrationStatus = settingsApi.getShellIntegrationStatus;
  setShellIntegration = settingsApi.setShellIntegration;
  getPendingUploads = settingsApi.getPendingUploads;
  openPathInExplorer = settingsApi.openPathInExplorer;

  // P2P & Android SAF/WorkManager
  getDocumentsProviderStatus = p2pApi.getDocumentsProviderStatus;
  toggleDocumentsProvider = p2pApi.toggleDocumentsProvider;
  notifyDocumentsProviderChange = p2pApi.notifyDocumentsProviderChange;
  testSafDocumentQuery = p2pApi.testSafDocumentQuery;
  getWorkManagerSyncStatus = p2pApi.getWorkManagerSyncStatus;
  configureWorkManagerSync = p2pApi.configureWorkManagerSync;
  triggerImmediateBackgroundSync = p2pApi.triggerImmediateBackgroundSync;
  getWorkManagerHistory = p2pApi.getWorkManagerHistory;
  getP2pStatus = p2pApi.getP2pStatus;
  startP2pSession = p2pApi.startP2pSession;
  connectP2pPeer = p2pApi.connectP2pPeer;
  cancelP2pSession = p2pApi.cancelP2pSession;
}

export const api = new ProtoFsApi();
export default api;
