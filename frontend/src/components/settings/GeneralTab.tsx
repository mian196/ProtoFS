import React, { useState } from 'react';
import {
  Sun,
  Moon,
  Monitor,
  RefreshCw,
  HelpCircle,
  Minimize2,
  Power,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { useThemeStore } from '../../stores/useThemeStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { api } from '../../api';
import type { UpdateInfo } from '../../types';
import { getAppVersion } from '../../utils/version';
import { UpdateModal } from './modals/UpdateModal';
import { toast } from 'sonner';

export const GeneralTab: React.FC = () => {
  const { theme, setTheme } = useThemeStore();
  const {
    closeAction,
    notificationsEnabled,
    rateLimitAlerts,
    notificationSound,
    autoCheckUpdates,
    updateSettings,
  } = useSettingsStore();

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const info = await api.checkForUpdates();
      setUpdateInfo(info);
      setShowUpdateModal(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Update Check Failed', { description: message });
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Theme & Appearance (D-37) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div>
          <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
            Theme & Display Mode
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-normal">
            Switch between Light, Dark, or automatically match your System Default appearance.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setTheme('light')}
            className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-medium transition-all ${
              theme === 'light'
                ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }`}
          >
            <Sun className="w-5 h-5 mb-1.5" />
            <span>Light Mode</span>
          </button>
          <button
            type="button"
            onClick={() => setTheme('dark')}
            className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-medium transition-all ${
              theme === 'dark'
                ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }`}
          >
            <Moon className="w-5 h-5 mb-1.5" />
            <span>Dark Mode</span>
          </button>
          <button
            type="button"
            onClick={() => setTheme('system')}
            className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-medium transition-all ${
              theme === 'system'
                ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }`}
          >
            <Monitor className="w-5 h-5 mb-1.5" />
            <span>System Default</span>
          </button>
        </div>
      </div>

      {/* 2. Software Updates (D-38) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
              Software Updates
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-normal">
              ProtoFS v{updateInfo?.current_version || getAppVersion()} • {updateInfo?.package_type || 'Desktop App'} • {updateInfo?.channel || 'Stable Channel'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCheckUpdates}
            disabled={checkingUpdate}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />}
          >
            {checkingUpdate ? 'Checking...' : 'Check for Updates'}
          </Button>
        </div>

        <label className="flex items-center gap-3 cursor-pointer pt-2 border-t border-slate-100 dark:border-slate-800/60">
          <input
            type="checkbox"
            checked={autoCheckUpdates}
            onChange={(e) => {
              updateSettings({ autoCheckUpdates: e.target.checked });
              toast.success('Preference Saved', { description: 'Auto-check for updates updated.' });
            }}
            className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          />
          <span className="text-xs text-slate-700 dark:text-slate-300">
            Automatically check for updates on application startup
          </span>
        </label>
      </div>

      {/* 3. Window Close Behavior (D-39) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div>
          <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
            Window Close Behavior
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-normal">
            Choose what happens when you click the window close (&times;) button.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => {
              updateSettings({ closeAction: 'prompt' });
              toast.success('Preference Saved', { description: 'ProtoFS will prompt before closing.' });
            }}
            className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all cursor-pointer ${
              closeAction === 'prompt'
                ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500/30'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <HelpCircle className="w-4 h-4 text-sky-500" />
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Always Ask
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
              Show a prompt dialog to choose between minimizing and exiting each time.
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              updateSettings({ closeAction: 'minimize', closeToTray: true });
              toast.success('Preference Saved', { description: 'ProtoFS will minimize to tray on close.' });
            }}
            className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all cursor-pointer ${
              closeAction === 'minimize'
                ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500/30'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Minimize2 className="w-4 h-4 text-sky-500" />
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Minimize to Tray
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
              Keep ProtoFS running in background for active transfers and sync.
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              updateSettings({ closeAction: 'exit', closeToTray: false });
              toast.success('Preference Saved', { description: 'ProtoFS will exit completely on close.' });
            }}
            className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all cursor-pointer ${
              closeAction === 'exit'
                ? 'border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/30'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Power className="w-4 h-4 text-rose-500" />
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Exit Application
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
              Completely shut down the application and disconnect virtual drives.
            </p>
          </button>
        </div>
      </div>

      {/* 4. Notification Preferences (D-40) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
          Notification Preferences
        </h4>
        <div className="space-y-2 pt-1">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={(e) => {
                updateSettings({ notificationsEnabled: e.target.checked });
                toast.success('Preference Saved');
              }}
              className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700"
            />
            <span className="text-xs text-slate-700 dark:text-slate-300">
              Show in-app toast notifications for transfer completions
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={rateLimitAlerts}
              onChange={(e) => {
                updateSettings({ rateLimitAlerts: e.target.checked });
                toast.success('Preference Saved');
              }}
              className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700"
            />
            <span className="text-xs text-slate-700 dark:text-slate-300">
              Alert when Telegram rate limits (FLOOD_WAIT) are encountered
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={notificationSound}
              onChange={(e) => {
                updateSettings({ notificationSound: e.target.checked });
                toast.success('Preference Saved');
              }}
              className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700"
            />
            <span className="text-xs text-slate-700 dark:text-slate-300">
              Play sound effect on transfer errors or warnings
            </span>
          </label>
        </div>
      </div>

      <UpdateModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        updateInfo={updateInfo}
      />
    </div>
  );
};
