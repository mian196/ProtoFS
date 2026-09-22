import { create } from 'zustand';
import { api } from '../api';
import { useAuthStore } from './useAuthStore';
import type { DriveMetadata, OwnedChannel, DriveHealthStatus } from '../types';

interface DriveState {
  drives: DriveMetadata[];
  activeDrive: DriveMetadata | null;
  channels: OwnedChannel[];
  isDriveAccessible: boolean;
  driveAccessibility: Record<string, boolean>;
  isLoading: boolean;
  error: string | null;
  loadDrives: () => Promise<void>;
  deleteDrive: (driveId: string) => Promise<void>;
  syncAndPruneDrives: () => Promise<void>;
  setActiveDrive: (drive: DriveMetadata) => void;
  loadChannels: () => Promise<void>;
  checkDriveHealth: (drive: DriveMetadata) => Promise<DriveHealthStatus>;
  exportManifest: (driveId: string, format?: 'json' | 'csv') => Promise<string>;
}

export const useDriveStore = create<DriveState>((set, get) => ({
  drives: [],
  activeDrive: null,
  channels: [],
  isDriveAccessible: true,
  driveAccessibility: {},
  isLoading: false,
  error: null,

  loadDrives: async () => {
    set({ isLoading: true, error: null });
    try {
      const drives = await api.getDrives();
      const currentActive = get().activeDrive;
      const activeDrive = currentActive
        ? drives.find((d: DriveMetadata) => d.id === currentActive.id) || drives[0] || null
        : drives[0] || null;

      set({ drives, activeDrive, isLoading: false });
      if (activeDrive) {
        get().checkDriveHealth(activeDrive);
      }
    } catch (err: any) {
      set({ error: err.message || 'Failed to load drives', isLoading: false });
    }
  },

  deleteDrive: async (driveId: string) => {
    try {
      await api.deleteDrive(driveId);
      await get().loadDrives();
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete drive' });
    }
  },

  syncAndPruneDrives: async () => {
    set({ isLoading: true, error: null });
    try {
      const drives = await api.syncAndPruneDrives();
      const currentActive = get().activeDrive;
      const activeDrive = currentActive
        ? drives.find((d: DriveMetadata) => d.id === currentActive.id) || drives[0] || null
        : drives[0] || null;

      set({ drives, activeDrive, isLoading: false });
      await get().loadChannels();
      if (activeDrive) {
        get().checkDriveHealth(activeDrive);
      }
    } catch (err: any) {
      set({ error: err.message || 'Failed to sync drives', isLoading: false });
    }
  },

  setActiveDrive: (drive: DriveMetadata) => {
    set({ activeDrive: drive });
    get().checkDriveHealth(drive);
  },

  loadChannels: async () => {
    try {
      const channels = await api.getOwnedChannels(true);
      set({ channels });
    } catch (err) {
      console.warn('Failed to load owned channels:', err);
    }
  },

  checkDriveHealth: async (drive: DriveMetadata) => {
    // Only flag drive inaccessibility when authenticated and actively connected to Telegram
    const authStatus = useAuthStore.getState().connectionStatus;
    if (authStatus !== 'connected') {
      set((state) => ({
        isDriveAccessible: true,
        driveAccessibility: {
          ...state.driveAccessibility,
          [drive.id]: true,
        },
      }));
      return {
        drive_id: drive.id,
        channel_id: drive.channel_id,
        is_accessible: true,
      };
    }

    try {
      const health = await api.checkDriveHealth(drive.id, drive.channel_id);
      const isAccessible = health.is_accessible;
      set((state) => ({
        isDriveAccessible: isAccessible,
        driveAccessibility: {
          ...state.driveAccessibility,
          [drive.id]: isAccessible,
        },
      }));
      return health;
    } catch (err) {
      console.warn('Failed to check drive health:', err);
      return {
        drive_id: drive.id,
        channel_id: drive.channel_id,
        is_accessible: true,
      };
    }
  },

  exportManifest: async (driveId: string, format: 'json' | 'csv' = 'json') => {
    return await api.exportDriveManifest(driveId, format);
  },
}));
