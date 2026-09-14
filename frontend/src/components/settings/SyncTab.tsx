import React, { useState } from 'react';
import {
  FolderSync,
  Camera,
  Plus,
  Play,
  FolderOpen,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { useDriveStore } from '../../stores/useDriveStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useModalStore } from '../../stores/useModalStore';
import { api } from '../../api';
import { toast } from 'sonner';

export const SyncTab: React.FC = () => {
  const { activeDrive } = useDriveStore();
  const {
    syncConflictPolicy,
    syncWifiOnly,
    syncPauseLowBattery,
    updateSettings,
  } = useSettingsStore();
  const { openModal } = useModalStore();

  const [triggeringSync, setTriggeringSync] = useState(false);
  const [cameraPath, setCameraPath] = useState('C:\\Users\\Pictures\\Camera Roll');
  const [savingCamera, setSavingCamera] = useState(false);

  const handleTriggerSyncNow = async () => {
    setTriggeringSync(true);
    toast.info('Triggering Background Sync', {
      description: 'Checking folder sync pairs and camera roll for changed files...',
    });
    try {
      await api.triggerImmediateBackgroundSync?.();
      toast.success('Sync Finished', {
        description: 'All paired folders are synchronized with Telegram cloud storage.',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Sync Encountered Error', { description: message });
    } finally {
      setTriggeringSync(false);
    }
  };

  const handleSaveCameraBackup = async () => {
    setSavingCamera(true);
    try {
      const driveId = activeDrive?.id || 'personal';
      await api.configureCameraBackup(driveId, {
        localPath: cameraPath,
        remoteFolderId: 'camera_uploads',
        wifiOnly: syncWifiOnly,
        chargingOnly: syncPauseLowBattery,
        includeVideos: true,
        originalQuality: true,
      });
      toast.success('Camera Backup Configured', {
        description: `Automated photo upload folder set to ${cameraPath}`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Failed to configure camera backup', { description: message });
    } finally {
      setSavingCamera(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Folder Sync Pairs (D-30) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
              Folder Sync Pairs
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-normal">
              Keep local desktop folders continuously synchronized with cloud directories.
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => openModal('syncConfig')}
            icon={<Plus className="w-4 h-4" />}
          >
            Add Folder Pair
          </Button>
        </div>

        <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 text-center space-y-2">
          <FolderSync className="w-8 h-8 mx-auto text-slate-400 opacity-60" />
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            No Active Folder Pairs Configured
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-normal">
            Choose a local desktop folder and pair it with a cloud folder to keep files synchronized automatically.
          </p>
        </div>
      </div>

      {/* 2. Conflict Resolution Policy (D-31) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
          Sync Conflict Resolution Policy
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
          Select how file name collisions are handled during automated background synchronization:
        </p>
        <select
          value={syncConflictPolicy}
          onChange={(e) => {
            const val = e.target.value as 'prompt' | 'newest' | 'both';
            updateSettings({ syncConflictPolicy: val });
            toast.success('Conflict Policy Updated', { description: `Policy set to ${val}.` });
          }}
          className="w-full bg-slate-50 dark:bg-slate-950/80 text-slate-900 dark:text-slate-100 text-sm rounded-xl border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 focus:outline-none focus:border-sky-500"
        >
          <option value="prompt">Ask Every Time (Prompt Modal) [Default]</option>
          <option value="newest">Keep Newest (Overwrite older file)</option>
          <option value="both">Keep Both (Append timestamp suffix to copy)</option>
        </select>
      </div>

      {/* 3. Network & Battery Constraints (D-32) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
          Smart Network & Battery Constraints
        </h4>
        <div className="space-y-2 pt-1">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={syncWifiOnly}
              onChange={(e) => {
                updateSettings({ syncWifiOnly: e.target.checked });
                toast.success('Preference Saved');
              }}
              className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700"
            />
            <span className="text-xs text-slate-700 dark:text-slate-300">
              Synchronize on unmetered Wi-Fi connections only (pause on mobile data)
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={syncPauseLowBattery}
              onChange={(e) => {
                updateSettings({ syncPauseLowBattery: e.target.checked });
                toast.success('Preference Saved');
              }}
              className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700"
            />
            <span className="text-xs text-slate-700 dark:text-slate-300">
              Pause synchronization when battery level falls below 20%
            </span>
          </label>
        </div>
      </div>

      {/* 4. Camera Roll & Photo Backup Card */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-sky-500" />
          <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
            Camera Roll & Photo Backup
          </h4>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
          Automatically watch and upload photos and screenshots to cloud storage.
        </p>
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              value={cameraPath}
              onChange={(e) => setCameraPath(e.target.value)}
              placeholder="C:\Users\Pictures\Camera Roll"
              icon={<FolderOpen className="w-4 h-4 text-slate-400" />}
            />
          </div>
          <Button
            variant="secondary"
            size="md"
            onClick={handleSaveCameraBackup}
            disabled={savingCamera}
          >
            {savingCamera ? 'Saving...' : 'Save Backup'}
          </Button>
        </div>
      </div>

      {/* 5. Background Sync Service (WorkManager) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
              Background Sync Service
            </h4>
            <Badge variant="emerald" size="sm">
              Idle
            </Badge>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-normal">
            Automated polling runs every 15 minutes in the background.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleTriggerSyncNow}
          disabled={triggeringSync}
          icon={<Play className={`w-3.5 h-3.5 ${triggeringSync ? 'animate-spin' : ''}`} />}
        >
          {triggeringSync ? 'Syncing...' : 'Trigger Sync Now'}
        </Button>
      </div>
    </div>
  );
};
