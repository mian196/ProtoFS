import { describe, it } from 'vitest';
import assert from 'node:assert';
import { api as apiFromShim } from '../../api';
import {
  api as apiFromIndex,
  authApi,
  drivesApi,
  filesApi,
  syncApi,
  webdavApi,
  settingsApi,
  p2pApi,
} from '../index';

describe('API Backward Compatibility Facade', () => {
  it('should export identical singleton instances from shim and index', () => {
    assert.ok(apiFromShim);
    assert.ok(apiFromIndex);
    assert.strictEqual(apiFromShim, apiFromIndex);
  });

  it('should provide all legacy session and authentication methods', () => {
    assert.strictEqual(typeof apiFromIndex.getSessionStatus, 'function');
    assert.strictEqual(typeof apiFromIndex.loginSendCode, 'function');
    assert.strictEqual(typeof apiFromIndex.loginVerifyCode, 'function');
    assert.strictEqual(typeof apiFromIndex.loginVerify2fa, 'function');
    assert.strictEqual(typeof apiFromIndex.loginVerify2Fa, 'function');
    assert.strictEqual(typeof apiFromIndex.loginRequestQr, 'function');
    assert.strictEqual(typeof apiFromIndex.loginCheckQr, 'function');
    assert.strictEqual(typeof apiFromIndex.logout, 'function');
    assert.strictEqual(typeof apiFromIndex.listAccounts, 'function');
    assert.strictEqual(typeof apiFromIndex.switchAccount, 'function');
    assert.strictEqual(typeof apiFromIndex.removeAccount, 'function');
  });

  it('should provide all legacy drive management methods', () => {
    assert.strictEqual(typeof apiFromIndex.getDrives, 'function');
    assert.strictEqual(typeof apiFromIndex.createDrive, 'function');
    assert.strictEqual(typeof apiFromIndex.deleteDrive, 'function');
    assert.strictEqual(typeof apiFromIndex.syncAndPruneDrives, 'function');
    assert.strictEqual(typeof apiFromIndex.syncChatFolder, 'function');
    assert.strictEqual(typeof apiFromIndex.checkConnection, 'function');
    assert.strictEqual(typeof apiFromIndex.checkDriveHealth, 'function');
    assert.strictEqual(typeof apiFromIndex.exportDriveManifest, 'function');
    assert.strictEqual(typeof apiFromIndex.getOwnedChannels, 'function');
    assert.strictEqual(typeof apiFromIndex.adoptChannelAsDrive, 'function');
  });

  it('should provide all legacy file and folder operations', () => {
    assert.strictEqual(typeof apiFromIndex.loadDrive, 'function');
    assert.strictEqual(typeof apiFromIndex.createFolder, 'function');
    assert.strictEqual(typeof apiFromIndex.uploadFile, 'function');
    assert.strictEqual(typeof apiFromIndex.downloadFile, 'function');
    assert.strictEqual(typeof apiFromIndex.getFilePreview, 'function');
    assert.strictEqual(typeof apiFromIndex.getFileVersions, 'function');
    assert.strictEqual(typeof apiFromIndex.restoreFileVersion, 'function');
    assert.strictEqual(typeof apiFromIndex.exportDrive, 'function');
    assert.strictEqual(typeof apiFromIndex.deleteNode, 'function');
    assert.strictEqual(typeof apiFromIndex.restoreNode, 'function');
    assert.strictEqual(typeof apiFromIndex.emptyTrash, 'function');
    assert.strictEqual(typeof apiFromIndex.togglePin, 'function');
    assert.strictEqual(typeof apiFromIndex.searchNodes, 'function');
    assert.strictEqual(typeof apiFromIndex.renameNode, 'function');
    assert.strictEqual(typeof apiFromIndex.moveNode, 'function');
    assert.strictEqual(typeof apiFromIndex.generateShareLink, 'function');
    assert.strictEqual(typeof apiFromIndex.parseShareLink, 'function');
    assert.strictEqual(typeof apiFromIndex.importSharedLink, 'function');
    assert.strictEqual(typeof apiFromIndex.cancelTransfer, 'function');
    assert.strictEqual(typeof apiFromIndex.pauseTransfer, 'function');
    assert.strictEqual(typeof apiFromIndex.resumeTransfer, 'function');
  });

  it('should provide all sync and backup methods', () => {
    assert.strictEqual(typeof apiFromIndex.getSyncPairs, 'function');
    assert.strictEqual(typeof apiFromIndex.addSyncPair, 'function');
    assert.strictEqual(typeof apiFromIndex.removeSyncPair, 'function');
    assert.strictEqual(typeof apiFromIndex.triggerSync, 'function');
    assert.strictEqual(typeof apiFromIndex.getCameraBackupConfig, 'function');
    assert.strictEqual(typeof apiFromIndex.configureCameraBackup, 'function');
  });

  it('should provide all webdav and virtual drive methods', () => {
    assert.strictEqual(typeof apiFromIndex.getWebDavConfig, 'function');
    assert.strictEqual(typeof apiFromIndex.configureWebDav, 'function');
    assert.strictEqual(typeof apiFromIndex.getVirtualDriveStatus, 'function');
    assert.strictEqual(typeof apiFromIndex.mountVirtualDrive, 'function');
    assert.strictEqual(typeof apiFromIndex.unmountVirtualDrive, 'function');
    assert.strictEqual(typeof apiFromIndex.openVirtualDriveInExplorer, 'function');
    assert.strictEqual(typeof apiFromIndex.clearVirtualDriveCache, 'function');
  });

  it('should provide settings and telemetry methods', () => {
    assert.strictEqual(typeof apiFromIndex.getStorageUsage, 'function');
    assert.strictEqual(typeof apiFromIndex.purgeLocalCache, 'function');
    assert.strictEqual(typeof apiFromIndex.checkForUpdates, 'function');
    assert.strictEqual(typeof apiFromIndex.getShellIntegrationStatus, 'function');
    assert.strictEqual(typeof apiFromIndex.setShellIntegration, 'function');
    assert.strictEqual(typeof apiFromIndex.getPendingUploads, 'function');
    assert.strictEqual(typeof apiFromIndex.openPathInExplorer, 'function');
  });

  it('should provide P2P and mobile methods', () => {
    assert.strictEqual(typeof apiFromIndex.getDocumentsProviderStatus, 'function');
    assert.strictEqual(typeof apiFromIndex.toggleDocumentsProvider, 'function');
    assert.strictEqual(typeof apiFromIndex.notifyDocumentsProviderChange, 'function');
    assert.strictEqual(typeof apiFromIndex.testSafDocumentQuery, 'function');
    assert.strictEqual(typeof apiFromIndex.getWorkManagerSyncStatus, 'function');
    assert.strictEqual(typeof apiFromIndex.configureWorkManagerSync, 'function');
    assert.strictEqual(typeof apiFromIndex.triggerImmediateBackgroundSync, 'function');
    assert.strictEqual(typeof apiFromIndex.getWorkManagerHistory, 'function');
    assert.strictEqual(typeof apiFromIndex.getP2pStatus, 'function');
    assert.strictEqual(typeof apiFromIndex.startP2pSession, 'function');
    assert.strictEqual(typeof apiFromIndex.connectP2pPeer, 'function');
    assert.strictEqual(typeof apiFromIndex.cancelP2pSession, 'function');
  });

  it('should expose distinct domain submodule namespaces', () => {
    assert.ok(authApi);
    assert.ok(drivesApi);
    assert.ok(filesApi);
    assert.ok(syncApi);
    assert.ok(webdavApi);
    assert.ok(settingsApi);
    assert.ok(p2pApi);
  });
});
