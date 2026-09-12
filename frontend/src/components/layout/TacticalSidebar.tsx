import React from 'react';
import {
  HardDrive,
  FolderSync,
  Share2,
  Settings,
  Layers,
  FileVideo,
  FileImage,
  FileText,
  FileAudio,
  Pin,
  Trash2,
  Plus,
  Power,
  RefreshCw,
} from 'lucide-react';
import { StorageGauge } from '../telemetry/StorageGauge';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDriveStore } from '../../stores/useDriveStore';
import { useVfsStore, type FilterType } from '../../stores/useVfsStore';
import { useNativeStore } from '../../stores/useNativeStore';
import { useModalStore } from '../../stores/useModalStore';

export const TacticalSidebar: React.FC = () => {
  const { session, connectionStatus, checkConnection } = useAuthStore();
  const { drives, activeDrive, setActiveDrive } = useDriveStore();
  const { filterType, setFilterType } = useVfsStore();
  const { virtualDrive, mountVirtualDrive, unmountVirtualDrive } = useNativeStore();
  const { openModal } = useModalStore();

  const handleDriveMountToggle = async () => {
    if (!activeDrive) return;
    if (virtualDrive?.is_mounted) {
      await unmountVirtualDrive(activeDrive.id);
    } else {
      await mountVirtualDrive(activeDrive.id, 'X');
    }
  };

  const navFilters: { type: FilterType; label: string; icon: React.ReactNode }[] = [
    { type: 'all', label: 'All Files', icon: <Layers className="w-4 h-4 text-sky-500" /> },
    { type: 'video', label: 'Videos', icon: <FileVideo className="w-4 h-4 text-purple-500" /> },
    { type: 'image', label: 'Images', icon: <FileImage className="w-4 h-4 text-pink-500" /> },
    { type: 'doc', label: 'Documents', icon: <FileText className="w-4 h-4 text-blue-500" /> },
    { type: 'audio', label: 'Audio Tracks', icon: <FileAudio className="w-4 h-4 text-emerald-500" /> },
    { type: 'pinned', label: 'Pinned in Cache', icon: <Pin className="w-4 h-4 text-amber-500" /> },
    { type: 'trash', label: 'Trash Bin', icon: <Trash2 className="w-4 h-4 text-rose-500" /> },
  ];

  const isOnline = connectionStatus === 'connected';

  return (
    <aside className="w-64 shrink-0 flex flex-col justify-between p-3.5 bg-slate-50 dark:bg-slate-950/80 border-r border-slate-200 dark:border-slate-800 select-none h-full overflow-y-auto no-scrollbar transition-colors">
      {/* Top section */}
      <div className="space-y-4">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-2 pt-1">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-600 dark:text-sky-400 shadow-sm">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>ProtoFS</span>
                <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 font-normal px-1.5 py-0.2 rounded bg-sky-500/10 border border-sky-500/20">
                  v0.3
                </span>
              </h1>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Telegram Cloud Drive</p>
            </div>
          </div>
        </div>

        {/* Active Drive Selector */}
        <div className="p-2 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active Channel Drive
            </span>
            <button
              onClick={() => openModal('driveManager')}
              className="p-0.5 rounded text-sky-600 dark:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Manage Drives"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <select
            value={activeDrive?.id || ''}
            onChange={(e) => {
              const d = drives.find((item) => item.id === e.target.value);
              if (d) setActiveDrive(d);
            }}
            className="w-full bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-200 rounded-xl px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 focus:outline-none focus:border-sky-500"
          >
            {drives.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.id})
              </option>
            ))}
          </select>
        </div>

        {/* WinFsp Native Virtual Drive Mount */}
        <div className="p-2.5 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Power
              className={`w-4 h-4 ${
                virtualDrive?.is_mounted ? 'text-emerald-500 animate-pulse' : 'text-slate-400'
              }`}
            />
            <div>
              <p className="text-xs font-medium text-slate-900 dark:text-slate-200">
                {virtualDrive?.is_mounted
                  ? `Virtual Drive (${virtualDrive.drive_letter}:)`
                  : 'Mount Virtual Drive'}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                {virtualDrive?.is_mounted ? (virtualDrive.driver_mode || 'WebDAV Network Drive') : 'Cross-Platform WebDAV'}
              </p>
            </div>
          </div>

          <button
            onClick={handleDriveMountToggle}
            className={`px-2.5 py-1 rounded-full text-[11px] font-mono font-medium transition-colors ${
              virtualDrive?.is_mounted
                ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {virtualDrive?.is_mounted ? 'Unmount' : 'Mount'}
          </button>
        </div>

        {/* Nav Filter Links */}
        <div className="space-y-1">
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Explorer Views
          </div>
          {navFilters.map((nav) => (
            <button
              key={nav.type}
              onClick={() => setFilterType(nav.type)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                filterType === nav.type
                  ? 'bg-sky-500/10 dark:bg-sky-500/15 text-sky-600 dark:text-sky-300 font-semibold border border-sky-500/30'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.04]'
              }`}
            >
              {nav.icon}
              <span>{nav.label}</span>
            </button>
          ))}
        </div>

        {/* Tools & Integrations - Compact button names */}
        <div className="space-y-1 pt-1 border-t border-slate-200 dark:border-slate-800">
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Integrations
          </div>
          <button
            onClick={() => openModal('syncConfig')}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors"
          >
            <FolderSync className="w-4 h-4 text-sky-500 shrink-0" />
            <span>Sync Watcher</span>
          </button>
          <button
            onClick={() => openModal('p2pTransfer')}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors"
          >
            <Share2 className="w-4 h-4 text-purple-500 shrink-0" />
            <span>P2P Transfer</span>
          </button>
          <button
            onClick={() => openModal('settings')}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors"
          >
            <Settings className="w-4 h-4 text-slate-500 shrink-0" />
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* Bottom section: Storage Gauge & Interactive Account Profile */}
      <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
        <StorageGauge
          usedBytes={virtualDrive?.cached_bytes || 0}
          cacheBytes={virtualDrive?.cached_bytes || 0}
        />

        {session && (
          <div className="flex items-center gap-1.5 p-2 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 hover:border-sky-500 shadow-sm transition-all group">
            <button
              type="button"
              onClick={() => openModal('accountManager')}
              className="flex-1 text-left flex items-center gap-2.5 min-w-0"
              title="Manage Accounts & Settings"
            >
              <div className="relative shrink-0">
                <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-600 dark:text-sky-300 flex items-center justify-center font-bold text-xs shadow-inner">
                  {session.first_name ? session.first_name[0].toUpperCase() : 'T'}
                </div>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-950 ${
                    connectionStatus === 'checking'
                      ? 'bg-amber-500 animate-spin'
                      : isOnline
                      ? 'bg-emerald-500 animate-pulse'
                      : 'bg-rose-500 animate-pulse'
                  }`}
                  title={
                    connectionStatus === 'checking'
                      ? 'Checking MTProto connection...'
                      : isOnline
                      ? 'Online (MTProto Connected)'
                      : 'Offline (VPN Required)'
                  }
                />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-200 truncate">
                  {session.username ? `@${session.username.replace(/^@/, '')}` : (session.first_name || 'Telegram User')}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate flex items-center gap-1">
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                      connectionStatus === 'checking'
                        ? 'bg-amber-500'
                        : isOnline
                        ? 'bg-emerald-500'
                        : 'bg-rose-500'
                    }`}
                  />
                  <span>
                    {connectionStatus === 'checking'
                      ? 'Testing...'
                      : isOnline
                      ? 'Online'
                      : 'Offline (VPN)'}
                  </span>
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                checkConnection();
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-500/10 transition-colors shrink-0"
              title="Test / Refresh MTProto Connection"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${connectionStatus === 'checking' ? 'animate-spin text-sky-400' : ''}`} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};


