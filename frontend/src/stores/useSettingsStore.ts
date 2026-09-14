import { create } from 'zustand';

export interface UserSettings {
  autoCleanupDeletedDrives: boolean;
  encryptionEnabled: boolean;
  autoMountWebDav: boolean;
  preferredDriveLetter: string;
  fastStreamingPlayback: boolean;
  closeToTray: boolean;
  notificationsEnabled: boolean;
  rateLimitAlerts: boolean;
  notificationSound: boolean;
  autoCheckUpdates: boolean;
  autoLockPolicy: 'never' | '15m' | '1h' | 'on_close';
  syncConflictPolicy: 'prompt' | 'newest' | 'both';
  syncWifiOnly: boolean;
  syncPauseLowBattery: boolean;
}

interface SettingsState extends UserSettings {
  updateSettings: (partial: Partial<UserSettings>) => void;
  resetDefaults: () => void;
}

const STORAGE_KEY = 'protofs_user_settings';

const DEFAULT_SETTINGS: UserSettings = {
  autoCleanupDeletedDrives: true,
  encryptionEnabled: true,
  autoMountWebDav: false,
  preferredDriveLetter: 'P',
  fastStreamingPlayback: true,
  closeToTray: true,
  notificationsEnabled: true,
  rateLimitAlerts: true,
  notificationSound: false,
  autoCheckUpdates: true,
  autoLockPolicy: '15m',
  syncConflictPolicy: 'prompt',
  syncWifiOnly: false,
  syncPauseLowBattery: true,
};

function loadStoredSettings(): UserSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.warn('Failed to parse protofs_user_settings from localStorage:', err);
  }
  return DEFAULT_SETTINGS;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...loadStoredSettings(),

  updateSettings: (partial) =>
    set((state) => {
      const updated = { ...state, ...partial };
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        }
      } catch (err) {
        console.error('Failed to persist protofs_user_settings:', err);
      }
      return updated;
    }),

  resetDefaults: () => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (err) {
      console.error('Failed to reset protofs_user_settings:', err);
    }
    set(DEFAULT_SETTINGS);
  },
}));
