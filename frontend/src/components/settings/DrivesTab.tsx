import React, { useState } from 'react';
import {
  HardDrive,
  Plus,
  MoreVertical,
  Wrench,
  Trash2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useDriveStore } from '../../stores/useDriveStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useModalStore } from '../../stores/useModalStore';
import { api } from '../../api';
import { toast } from 'sonner';

export const DrivesTab: React.FC = () => {
  const { drives, activeDrive, setActiveDrive, deleteDrive, loadDrives } = useDriveStore();
  const { autoCleanupDeletedDrives, updateSettings } = useSettingsStore();
  const { openModal } = useModalStore();

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [repairingDriveId, setRepairingDriveId] = useState<string | null>(null);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const handleRepairStructure = async (driveId: string) => {
    setRepairingDriveId(driveId);
    setActiveMenuId(null);
    toast.info('Repairing Channel Structure', {
      description: 'Scanning pinned manifest and reconstructing folder hierarchy...',
    });
    try {
      await api.checkDriveHealth(driveId, 0);
      await loadDrives();
      toast.success('Channel Structure Repaired', {
        description: 'VFS index synchronized with Telegram cloud channel.',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Repair Failed', { description: message });
    } finally {
      setRepairingDriveId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header with Create Cloud Drive CTA (D-28) */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
            Connected Cloud Drives
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-normal">
            Manage Telegram storage channels and cloud directories linked to this device.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => openModal('driveManager')}
          icon={<Plus className="w-4 h-4" />}
        >
          Create Cloud Drive
        </Button>
      </div>

      {/* 2. Connected Drives List (D-25, D-27) */}
      <div className="space-y-3">
        {drives.length === 0 ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3">
            <HardDrive className="w-10 h-10 mx-auto text-slate-400 opacity-60" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                No Cloud Drives Connected
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-normal">
                Link an existing Telegram channel or create a new dedicated storage drive to start uploading files.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => openModal('driveManager')}
              icon={<Plus className="w-4 h-4" />}
            >
              Create Cloud Drive
            </Button>
          </div>
        ) : (
          drives.map((drive) => {
            const isDefault = activeDrive?.id === drive.id;
            const isMenuOpen = activeMenuId === drive.id;
            const isRepairing = repairingDriveId === drive.id;

            return (
              <div
                key={drive.id}
                className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 transition-all hover:border-slate-300 dark:hover:border-slate-700"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/10 dark:bg-sky-500/15 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
                    <HardDrive className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate" title={drive.name}>
                        {drive.name}
                      </span>
                      {isDefault && (
                        <Badge variant="sky" size="sm">
                          Default
                        </Badge>
                      )}
                      <Badge variant="slate" size="sm">
                        {drive.channel_id ? `Channel #${Math.abs(drive.channel_id)}` : 'Local Root'}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-normal">
                      {drive.total_files || 0} files • {formatBytes(drive.total_bytes || 0)} cloud storage used
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 relative">
                  {!isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setActiveDrive(drive);
                        toast.success('Default Drive Set', { description: `Switched active default drive to ${drive.name}.` });
                      }}
                    >
                      Make Default
                    </Button>
                  )}

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setActiveMenuId(isMenuOpen ? null : drive.id)}
                      aria-label="Drive options"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {isMenuOpen && (
                      <div className="absolute right-0 top-full mt-1 w-48 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl z-20 py-1 text-xs">
                        <button
                          type="button"
                          onClick={() => handleRepairStructure(drive.id)}
                          disabled={isRepairing}
                          className="w-full text-left px-3 py-2 flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Wrench className="w-3.5 h-3.5" />
                          <span>Repair Structure / Re-scan</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuId(null);
                            deleteDrive(drive.id);
                            toast.info('Drive Removed', { description: `Unlinked drive ${drive.name}.` });
                          }}
                          className="w-full text-left px-3 py-2 flex items-center gap-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete / Leave Drive</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 3. Automatic Multi-Device Cleanup (D-26) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
          Automatic Multi-Device Cleanup
        </h4>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoCleanupDeletedDrives}
            onChange={(e) => {
              updateSettings({ autoCleanupDeletedDrives: e.target.checked });
              toast.success('Preference Saved', { description: 'Multi-device cleanup setting updated.' });
            }}
            className="w-4 h-4 mt-0.5 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700"
          />
          <div className="space-y-0.5">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Automatically remove drives deleted on other devices
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
              When enabled, channels removed on mobile or another computer will be cleanly purged from the local cache and VFS index.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
};
