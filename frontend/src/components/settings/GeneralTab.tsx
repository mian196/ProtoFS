import React, { useState } from 'react';
import {
  Sun,
  Moon,
  Monitor,
  RefreshCw,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { useThemeStore } from '../../stores/useThemeStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { api } from '../../api';
import type { UpdateInfo } from '../../types';
import { toast } from 'sonner';

export const GeneralTab: React.FC = () => {
  const { theme, setTheme } = useThemeStore();
  const {
    closeToTray,
    notificationsEnabled,
    rateLimitAlerts,
    notificationSound,
    autoCheckUpdates,
    updateSettings,
  } = useSettingsStore();

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const info = await api.checkForUpdates();
      setUpdateInfo(info);
      if (info.update_available) {
        toast.info('Software Update Available', {
          description: `ProtoFS v${info.latest_version} is available for download.`,
          action: {
            label: 'View Release',
            onClick: () => window.open(info.download_url, '_blank'),
          },
        });
      } else {
        toast.success('ProtoFS is Up to Date', {
          description: `Current version v${info.current_version} is the latest release.`,
        });
      }
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
              ProtoFS v{updateInfo?.current_version || '0.3.0'} • Stable Release Channel
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

      {/* 3. Window Close & System Tray (D-39) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
          Window Close & System Tray
        </h4>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={closeToTray}
            onChange={(e) => {
              updateSettings({ closeToTray: e.target.checked });
              toast.success('Preference Saved', { description: 'Window close behavior updated.' });
            }}
            className="w-4 h-4 mt-0.5 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          />
          <div className="space-y-0.5">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Close window to system tray / taskbar
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
              When enabled, closing the window keeps ProtoFS running in the background. Left-click the tray icon to view running telemetry; right-click for options.
            </p>
          </div>
        </label>
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
    </div>
  );
};
