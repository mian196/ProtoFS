import React, { useState, useEffect } from 'react';
import {
  Globe,
  HardDrive,
  Copy,
  Check,
  Power,
  FolderOpen,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { useNativeStore } from '../../stores/useNativeStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { api } from '../../api';
import { toast } from 'sonner';

export const WebDavTab: React.FC = () => {
  const {
    virtualDrive,
    webdavServer,
    loadNativeStatus,
    mountVirtualDrive,
    unmountVirtualDrive,
    configureWebDav,
  } = useNativeStore();

  const {
    autoMountWebDav,
    preferredDriveLetter,
    fastStreamingPlayback,
    updateSettings,
  } = useSettingsStore();

  const [port, setPort] = useState(28491);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isMounting, setIsMounting] = useState(false);
  const [isApplyingPort, setIsApplyingPort] = useState(false);

  useEffect(() => {
    loadNativeStatus();
  }, [loadNativeStatus]);

  useEffect(() => {
    if (webdavServer?.port) {
      setPort(webdavServer.port);
    }
  }, [webdavServer]);

  const webdavUrl = `http://127.0.0.1:${port}/`;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(webdavUrl);
    setCopiedUrl(true);
    toast.success('WebDAV URL Copied', {
      description: `${webdavUrl} copied to system clipboard.`,
    });
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleToggleMount = async () => {
    setIsMounting(true);
    try {
      const driveId = virtualDrive?.drive_id || 'personal';
      if (virtualDrive?.is_mounted) {
        await unmountVirtualDrive(driveId);
        toast.info('WebDAV Drive Unmounted', {
          description: `Drive ${virtualDrive.drive_letter || preferredDriveLetter}: successfully disconnected.`,
        });
      } else {
        await mountVirtualDrive(driveId, preferredDriveLetter, fastStreamingPlayback);
        toast.success('WebDAV Drive Connected', {
          description: `Drive ${preferredDriveLetter}: ready in File Explorer.`,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Mount Operation Failed', { description: message });
    } finally {
      setIsMounting(false);
    }
  };

  const handleApplyPort = async () => {
    setIsApplyingPort(true);
    try {
      await configureWebDav(true, port, autoMountWebDav);
      toast.success('Port Changes Applied', {
        description: `WebDAV server restarted on port ${port}.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Failed to Apply Port', { description: message });
    } finally {
      setIsApplyingPort(false);
    }
  };

  const availableLetters = virtualDrive?.available_letters || ['P', 'Z', 'Y', 'X', 'W', 'V'];

  return (
    <div className="space-y-6">
      {/* 1. Live WebDAV Server Status Card (D-33, D-04) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 dark:bg-sky-500/15 flex items-center justify-center text-sky-600 dark:text-sky-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                  WebDAV Drive
                </h4>
                {webdavServer?.is_running && virtualDrive?.is_mounted ? (
                  <Badge variant="emerald" size="sm">
                    Connected ({virtualDrive.drive_letter || preferredDriveLetter}:)
                  </Badge>
                ) : webdavServer?.is_running ? (
                  <Badge variant="emerald" size="sm">
                    Running on Port {port}
                  </Badge>
                ) : (
                  <Badge variant="amber" size="sm">
                    Stopped
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-normal">
                Streams cloud files directly to native OS file explorers (Explorer, Finder, Nautilus).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {virtualDrive?.is_mounted && (
              <Button
                variant="secondary"
                size="sm"
                icon={<FolderOpen className="w-4 h-4 text-sky-500" />}
                onClick={() => api.openVirtualDriveInExplorer(virtualDrive.drive_letter || preferredDriveLetter)}
                title={`Reveal ${virtualDrive.drive_letter || preferredDriveLetter}:\\ in File Explorer`}
              >
                Reveal in File Explorer
              </Button>
            )}
            <Button
              variant={virtualDrive?.is_mounted ? 'danger' : 'primary'}
              size="sm"
              onClick={handleToggleMount}
              disabled={isMounting}
              icon={virtualDrive?.is_mounted ? <Power className="w-4 h-4" /> : <HardDrive className="w-4 h-4" />}
            >
              {isMounting
                ? 'Working...'
                : virtualDrive?.is_mounted
                ? `Unmount Drive (${virtualDrive.drive_letter || preferredDriveLetter}:)`
                : 'Mount WebDAV Drive'}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/60">
          <Input
            readOnly
            value={webdavUrl}
            className="font-mono text-xs bg-slate-50 dark:bg-slate-950"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopyUrl}
            icon={copiedUrl ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          >
            {copiedUrl ? 'Copied' : 'Copy URL'}
          </Button>
        </div>
      </div>

      {/* 2. Drive Letter & Mount Settings (D-34, D-35) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div>
          <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
            Mount Configuration
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-normal">
            Choose drive letter assignment and startup behavior.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
              Preferred Drive Letter:
            </label>
            <select
              value={preferredDriveLetter}
              onChange={(e) => {
                updateSettings({ preferredDriveLetter: e.target.value });
                toast.success('Preference Saved', { description: `Preferred drive letter set to ${e.target.value}:` });
              }}
              className="w-full bg-slate-50 dark:bg-slate-950/80 text-slate-900 dark:text-slate-100 text-sm rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2 focus:outline-none focus:border-sky-500"
            >
              {availableLetters.map((ltr) => (
                <option key={ltr} value={ltr}>
                  {ltr}: {ltr === 'P' ? '(ProtoFS Default)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3 pt-1">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoMountWebDav}
                onChange={(e) => {
                  updateSettings({ autoMountWebDav: e.target.checked });
                  toast.success('Preference Saved');
                }}
                className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700"
              />
              <span className="text-xs text-slate-700 dark:text-slate-300">
                Automatically mount drive letter on app startup
              </span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={fastStreamingPlayback}
                onChange={(e) => {
                  updateSettings({ fastStreamingPlayback: e.target.checked });
                  toast.success('Preference Saved');
                }}
                className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700"
              />
              <span className="text-xs text-slate-700 dark:text-slate-300">
                Fast streaming playback (stream audio/video without full download)
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* 3. Server Port Configuration */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
          Server Port Configuration
        </h4>
        <div className="flex items-center gap-3 max-w-sm">
          <Input
            type="number"
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value, 10) || 28491)}
            placeholder="28491"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleApplyPort}
            disabled={isApplyingPort}
          >
            {isApplyingPort ? 'Applying...' : 'Apply Port'}
          </Button>
        </div>
      </div>
    </div>
  );
};
