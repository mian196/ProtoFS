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
  ChevronRight,
} from 'lucide-react';
import { StorageGauge } from '../telemetry/StorageGauge';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDriveStore } from '../../stores/useDriveStore';
import { useVfsStore, type FilterType } from '../../stores/useVfsStore';
import { useNativeStore } from '../../stores/useNativeStore';
import { useModalStore } from '../../stores/useModalStore';

export const TacticalSidebar: React.FC = () => {
  const { session, connectionStatus } = useAuthStore();
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
    { type: 'all', label: 'All Files', icon: <Layers className="w-4 h-4 text-sky-400" /> },
    { type: 'video', label: 'Videos', icon: <FileVideo className="w-4 h-4 text-purple-400" /> },
    { type: 'image', label: 'Images', icon: <FileImage className="w-4 h-4 text-pink-400" /> },
    { type: 'doc', label: 'Documents', icon: <FileText className="w-4 h-4 text-blue-400" /> },
    { type: 'audio', label: 'Audio Tracks', icon: <FileAudio className="w-4 h-4 text-emerald-400" /> },
    { type: 'pinned', label: 'Pinned in Cache', icon: <Pin className="w-4 h-4 text-amber-400" /> },
    { type: 'trash', label: 'Trash Bin', icon: <Trash2 className="w-4 h-4 text-rose-400" /> },
  ];

  const isOnline = connectionStatus === 'connected';

  return (
    <aside className="w-64 shrink-0 flex flex-col justify-between p-3.5 bg-slate-950/70 border-r border-white/[0.06] backdrop-blur-2xl select-none h-full overflow-y-auto no-scrollbar">
      {/* Top section */}
      <div className="space-y-4">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-2 pt-1">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400 shadow-md">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                <span>ProtoFS</span>
                <span className="text-[10px] font-mono text-sky-400 font-normal px-1.5 py-0.2 rounded bg-sky-500/10 border border-sky-500/20">
                  v0.3
                </span>
              </h1>
              <p className="text-[10px] text-slate-400 font-mono">Telegram Cloud Drive</p>
            </div>
          </div>
        </div>

        {/* Active Drive Selector */}
        <div className="p-2 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Active Channel Drive
            </span>
            <button
              onClick={() => openModal('driveManager')}
              className="p-0.5 rounded text-sky-400 hover:text-sky-300 hover:bg-white/10"
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
            className="w-full bg-slate-900 text-xs text-slate-200 rounded-xl px-2.5 py-1.5 border border-white/10 focus:outline-none focus:border-sky-400"
          >
            {drives.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.id})
              </option>
            ))}
          </select>
        </div>

        {/* WinFsp Native Virtual Drive Mount */}
        <div className="p-2.5 rounded-2xl bg-slate-900/60 border border-white/[0.04] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Power
              className={`w-4 h-4 ${
                virtualDrive?.is_mounted ? 'text-emerald-400 animate-pulse' : 'text-slate-500'
              }`}
            />
            <div>
              <p className="text-xs font-medium text-slate-200">
                {virtualDrive?.is_mounted
                  ? `Virtual Drive (${virtualDrive.drive_letter}:)`
                  : 'Mount Virtual Drive'}
              </p>
              <p className="text-[10px] text-slate-400 font-mono">
                {virtualDrive?.is_mounted ? 'WinFsp Native I/O' : 'Windows Explorer X:'}
              </p>
            </div>
          </div>

          <button
            onClick={handleDriveMountToggle}
            className={`px-2.5 py-1 rounded-full text-[11px] font-mono font-medium transition-colors ${
              virtualDrive?.is_mounted
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-slate-800 text-slate-300 border border-white/10 hover:bg-slate-700'
            }`}
          >
            {virtualDrive?.is_mounted ? 'Unmount' : 'Mount'}
          </button>
        </div>

        {/* Nav Filter Links */}
        <div className="space-y-1">
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Explorer Views
          </div>
          {navFilters.map((nav) => (
            <button
              key={nav.type}
              onClick={() => setFilterType(nav.type)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                filterType === nav.type
                  ? 'bg-sky-500/15 text-sky-300 font-semibold border border-sky-500/20'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {nav.icon}
              <span>{nav.label}</span>
            </button>
          ))}
        </div>

        {/* Tools & Integrations - Compact button names */}
        <div className="space-y-1 pt-1 border-t border-white/5">
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Integrations
          </div>
          <button
            onClick={() => openModal('syncConfig')}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-slate-300 hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            <FolderSync className="w-4 h-4 text-sky-400 shrink-0" />
            <span>Sync Watcher</span>
          </button>
          <button
            onClick={() => openModal('p2pTransfer')}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-slate-300 hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            <Share2 className="w-4 h-4 text-purple-400 shrink-0" />
            <span>P2P Transfer</span>
          </button>
          <button
            onClick={() => openModal('settings')}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-slate-300 hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            <Settings className="w-4 h-4 text-slate-400 shrink-0" />
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* Bottom section: Storage Gauge & Interactive Account Profile */}
      <div className="space-y-3 pt-3 border-t border-white/5">
        <StorageGauge
          usedBytes={virtualDrive?.cached_bytes || 0}
          cacheBytes={virtualDrive?.cached_bytes || 0}
        />

        {session && (
          <button
            type="button"
            onClick={() => openModal('accountManager')}
            className="w-full text-left flex items-center justify-between p-2 rounded-xl bg-white/[0.02] border border-white/5 hover:border-sky-500/30 hover:bg-white/[0.05] transition-all group"
            title="Manage Accounts & Connection Status"
          >
            <div className="flex items-center gap-2.5 min-w-0 pr-1">
              {/* Profile Avatar / Status Dot */}
              <div className="relative shrink-0">
                <div className="w-8 h-8 rounded-xl bg-sky-500/20 border border-sky-400/30 text-sky-300 flex items-center justify-center font-bold text-xs shadow-inner">
                  {session.first_name ? session.first_name[0].toUpperCase() : 'T'}
                </div>
                {/* Connection Status Dot: Green = Connected, Red = Blocked/Offline (VPN required) */}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-950 ${
                    isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500 animate-pulse'
                  }`}
                  title={isOnline ? 'Online (MTProto Connected)' : 'Offline / VPN Required'}
                />
              </div>

              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-200 truncate">
                  {session.username ? `@${session.username.replace(/^@/, '')}` : (session.first_name || 'Telegram User')}
                </p>
                <p className="text-[10px] text-slate-400 font-mono truncate flex items-center gap-1">
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                      isOnline ? 'bg-emerald-400' : 'bg-rose-500'
                    }`}
                  />
                  <span>{isOnline ? 'Online' : 'Offline (VPN)'}</span>
                </p>
              </div>
            </div>

            <div className="p-1 rounded-lg text-slate-500 group-hover:text-sky-400 transition-colors shrink-0">
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        )}
      </div>
    </aside>
  );
};

