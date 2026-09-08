import { create } from 'zustand';
import { api } from '../api';
import type { DriveMetadata, OwnedChannel } from '../types';

interface DriveState {
  drives: DriveMetadata[];
  activeDrive: DriveMetadata | null;
  channels: OwnedChannel[];
  isLoading: boolean;
  error: string | null;
  loadDrives: () => Promise<void>;
  setActiveDrive: (drive: DriveMetadata) => void;
  loadChannels: () => Promise<void>;
}

export const useDriveStore = create<DriveState>((set, get) => ({
  drives: [],
  activeDrive: null,
  channels: [],
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
    } catch (err: any) {
      set({ error: err.message || 'Failed to load drives', isLoading: false });
    }
  },

  setActiveDrive: (drive: DriveMetadata) => {
    set({ activeDrive: drive });
  },

  loadChannels: async () => {
    try {
      const channels = await api.getOwnedChannels(true);
      set({ channels });
    } catch (err) {
      console.warn('Failed to load owned channels:', err);
    }
  },
}));
