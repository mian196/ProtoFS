import { create } from 'zustand';
import { api } from '../api';
import type {
  DocumentsProviderStatus,
  P2pStatus,
  SyncPair,
  VirtualDriveStatus,
  WebDavServerStatus,
  WorkManagerSyncStatus,
} from '../types';

interface NativeState {
  virtualDrive: VirtualDriveStatus | null;
  webdavServer: WebDavServerStatus | null;
  documentsProvider: DocumentsProviderStatus | null;
  workManagerSync: WorkManagerSyncStatus | null;
  syncPairs: SyncPair[];
  p2pStatus: P2pStatus | null;
  isLoading: boolean;

  loadNativeStatus: (driveId?: string) => Promise<void>;
  mountVirtualDrive: (
    driveId: string,
    letter?: string,
    onDemandStream?: boolean
  ) => Promise<VirtualDriveStatus | null>;
  unmountVirtualDrive: (driveId: string) => Promise<VirtualDriveStatus | null>;
  configureWebDav: (
    enabled: boolean,
    port: number,
    autoMount: boolean
  ) => Promise<WebDavServerStatus>;
  loadSyncPairs: (driveId?: string) => Promise<void>;
}

export const useNativeStore = create<NativeState>((set) => ({
  virtualDrive: null,
  webdavServer: null,
  documentsProvider: null,
  workManagerSync: null,
  syncPairs: [],
  p2pStatus: null,
  isLoading: false,

  loadNativeStatus: async (driveId = 'personal') => {
    set({ isLoading: true });
    try {
      const [vDrive, webdav, docProv, wmSync, p2p, pairs] = await Promise.all([
        api.getVirtualDriveStatus(driveId),
        api.getWebDavConfig(),
        api.getDocumentsProviderStatus(driveId),
        api.getWorkManagerSyncStatus(),
        api.getP2pStatus(),
        api.getSyncPairs(driveId),
      ]);

      set({
        virtualDrive: vDrive,
        webdavServer: webdav,
        documentsProvider: docProv,
        workManagerSync: wmSync,
        p2pStatus: p2p,
        syncPairs: pairs,
        isLoading: false,
      });
    } catch (e) {
      console.warn('Native status fetch error:', e);
      set({ isLoading: false });
    }
  },

  mountVirtualDrive: async (driveId: string, letter?: string, onDemandStream = true) => {
    const res = await api.mountVirtualDrive(driveId, letter, onDemandStream);
    set({ virtualDrive: res });
    return res;
  },

  unmountVirtualDrive: async (driveId: string) => {
    const res = await api.unmountVirtualDrive(driveId);
    set({ virtualDrive: res });
    return res;
  },

  configureWebDav: async (enabled: boolean, port: number, autoMount: boolean) => {
    const res = await api.configureWebDav(enabled, port, autoMount);
    set({ webdavServer: res });
    return res;
  },

  loadSyncPairs: async (driveId = 'personal') => {
    try {
      const pairs = await api.getSyncPairs(driveId);
      set({ syncPairs: pairs });
    } catch (e) {
      console.warn('Failed to load sync pairs:', e);
    }
  },
}));
