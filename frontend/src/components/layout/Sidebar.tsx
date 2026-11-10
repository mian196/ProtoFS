import React, { useState, useMemo } from 'react';
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
  RefreshCw,
  Loader2,
  ExternalLink,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api';
import { StorageGauge } from '../telemetry/StorageGauge';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDriveStore } from '../../stores/useDriveStore';
import {
  useVfsStore,
  matchesFileFilter,
  type FilterType,
} from '../../stores/useVfsStore';
import { useNativeStore } from '../../stores/useNativeStore';
import { useModalStore } from '../../stores/useModalStore';
import { useProxyStore } from '../../stores/useProxyStore';
import { getAppVersion } from '../../utils/version';

export const Sidebar: React.FC = () => {
  const { session, connectionStatus, checkConnection } = useAuthStore();
  const { drives, activeDrive, setActiveDrive, driveAccessibility } = useDriveStore();
  const {
    filterType,
    setFilterType,
    allFolders,
    allFiles,
    mobileSidebarOpen,
    setMobileSidebarOpen,
  } = useVfsStore();
  const { virtualDrive, syncPairs, mountVirtualDrive, unmountVirtualDrive } = useNativeStore();
  const { openModal } = useModalStore();
  const { isEnabled, activeProxyId, proxies } = useProxyStore();
  const activeProxy = proxies.find((p) => p.id === activeProxyId);
  const [isMounting, setIsMounting] = useState(false);

  const counts = useMemo(() => {
    const activeFiles = allFiles.filter((f) => !f.trashed);
    const activeFolders = allFolders.filter((f) => !f.trashed);
    return {
      all: activeFiles.length + activeFolders.length,
      video: activeFiles.filter((f) => matchesFileFilter(f, 'video')).length,
      image: activeFiles.filter((f) => matchesFileFilter(f, 'image')).length,
      doc: activeFiles.filter((f) => matchesFileFilter(f, 'doc')).length,
      audio: activeFiles.filter((f) => matchesFileFilter(f, 'audio')).length,
      pinned: activeFiles.filter((f) => matchesFileFilter(f, 'pinned')).length,
      trash:
        allFiles.filter((f) => Boolean(f.trashed)).length +
        allFolders.filter((f) => Boolean(f.trashed)).length,
      totalBytes: activeFiles.reduce((acc, f) => acc + (f.size_bytes || 0), 0),
      encryptedCount: activeFiles.filter((f) => Boolean(f.encrypted)).length,
    };
  }, [allFolders, allFiles]);

  const handleWebDavRowClick = async () => {
    if (virtualDrive?.is_mounted) {
      await api.openVirtualDriveInExplorer(virtualDrive.drive_letter || 'P');
    } else {
      openModal('settings', { defaultTab: 'webdav' });
    }
  };

  const handlePillClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeDrive) return;

    setIsMounting(true);
    try {
      if (virtualDrive?.is_mounted) {
        await unmountVirtualDrive(activeDrive.id);
        toast.info('WebDAV Drive Unmounted', {
          description: `Drive ${virtualDrive.drive_letter || 'P'}: successfully disconnected.`,
        });
      } else {
        const preferred = localStorage.getItem('protofs_mount_letter_personal') || 'P';
        await mountVirtualDrive(activeDrive.id, preferred);
        toast.success('WebDAV Drive Connected', {
          description: `Drive ${preferred}: ready in File Explorer.`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('WebDAV Mount Failed', {
        description: msg,
        action: {
          label: 'Open WebDAV Settings',
          onClick: () => openModal('settings', { defaultTab: 'webdav' }),
        },
      });
    } finally {
      setIsMounting(false);
    }
  };

  const navFilters: {
    type: FilterType;
    label: string;
    count: number;
    icon: React.ReactNode;
  }[] = [
    {
      type: 'all',
      label: 'All Files',
      count: counts.all,
      icon: <Layers className="w-4 h-4 text-sky-500" />,
    },
    {
      type: 'pinned',
      label: 'Pinned in Cache',
      count: counts.pinned,
      icon: <Pin className="w-4 h-4 text-amber-500" />,
    },
    {
      type: 'video',
      label: 'Videos',
      count: counts.video,
      icon: <FileVideo className="w-4 h-4 text-purple-500" />,
    },
    {
      type: 'image',
      label: 'Images',
      count: counts.image,
      icon: <FileImage className="w-4 h-4 text-pink-500" />,
    },
    {
      type: 'doc',
      label: 'Documents',
      count: counts.doc,
      icon: <FileText className="w-4 h-4 text-blue-500" />,
    },
    {
      type: 'audio',
      label: 'Audio Tracks',
      count: counts.audio,
      icon: <FileAudio className="w-4 h-4 text-emerald-500" />,
    },
    {
      type: 'trash',
      label: 'Trash Bin',
      count: counts.trash,
      icon: <Trash2 className="w-4 h-4 text-rose-500" />,
    },
  ];

  const isOnline = connectionStatus === 'connected';
  const cloudUsedBytes = counts.totalBytes || activeDrive?.total_bytes || 0;

  const sidebarContent = (
    <aside className="w-64 shrink-0 flex flex-col justify-between p-3 bg-slate-100/90 dark:bg-slate-950 border-r border-slate-200/90 dark:border-slate-800/90 select-none h-full overflow-y-auto no-scrollbar transition-colors">
      {/* Top section */}
      <div className="space-y-3.5">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-1.5 pt-0.5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-600 dark:text-sky-400 shadow-xs">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>ProtoFS</span>
                <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 font-medium px-1.5 py-0.2 rounded bg-sky-500/10 border border-sky-500/20">
                  v{getAppVersion()}
                </span>
              </h1>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                Zero-Knowledge VFS
              </p>
            </div>
          </div>

          {mobileSidebarOpen && (
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              className="md:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800"
              aria-label="Close navigation drawer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Active Drive Selector */}
        <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/90 shadow-xs">
          <div className="flex items-center justify-between mb-1.5 px-0.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
              Channel Vault
            </span>
            <button
              type="button"
              onClick={() => openModal('driveManager')}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 transition-colors cursor-pointer"
              title="Manage Drives"
            >
              <Plus className="w-3 h-3" />
              <span>Manage</span>
            </button>
          </div>

          <select
            aria-label="Active Channel Drive"
            value={activeDrive?.id || ''}
            onChange={(e) => {
              const d = drives.find((item) => item.id === e.target.value);
              if (d) setActiveDrive(d);
            }}
            className="w-full bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-900 dark:text-slate-200 rounded-lg px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            {drives.map((d) => (
              <option key={d.id} value={d.id}>
                {driveAccessibility[d.id] === false && isOnline ? '⚠️ [Recovery] ' : ''}
                {d.name} ({d.id})
              </option>
            ))}
          </select>
        </div>

        {/* WebDAV Drive Mount & Status */}
        <div
          onClick={handleWebDavRowClick}
          title={
            virtualDrive?.is_mounted
              ? `Open ${virtualDrive.drive_letter || 'P'}:\\ in File Explorer`
              : 'Configure WebDAV Drive'
          }
          className="p-2.5 rounded-xl bg-white dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/90 shadow-xs flex items-center justify-between cursor-pointer hover:border-sky-500/50 transition-all group"
        >
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0 group-hover:text-sky-500 transition-colors">
              <HardDrive className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-200 leading-tight truncate flex items-center gap-1">
                <span>WebDAV Mount</span>
                {virtualDrive?.is_mounted && (
                  <ExternalLink className="w-2.5 h-2.5 text-slate-400 group-hover:text-sky-400" />
                )}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {virtualDrive?.is_mounted ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono truncate">
                      {virtualDrive.drive_letter || 'P'}: • Mounted
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-600 shrink-0" />
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate">
                      Unmounted
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handlePillClick}
            disabled={isMounting}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition-colors shrink-0 cursor-pointer ${
              isMounting
                ? 'opacity-70 cursor-wait flex items-center gap-1 bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700'
                : virtualDrive?.is_mounted
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30'
                : 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30 hover:bg-sky-500/20'
            }`}
          >
            {isMounting ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{virtualDrive?.is_mounted ? '...' : '...'}</span>
              </>
            ) : virtualDrive?.is_mounted ? (
              'Unmount'
            ) : (
              'Mount'
            )}
          </button>
        </div>

        {/* Nav Filter Links */}
        <div className="space-y-0.5">
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
            Explorer Views
          </div>
          {navFilters.map((nav) => {
            const isActive = filterType === nav.type;
            return (
              <button
                key={nav.type}
                type="button"
                onClick={() => setFilterType(nav.type)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-sky-500/12 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold border border-sky-500/30 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  {nav.icon}
                  <span className="truncate">{nav.label}</span>
                </span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-md ${
                    isActive
                      ? 'bg-sky-500/20 text-sky-700 dark:text-sky-300'
                      : 'text-slate-400 dark:text-slate-500 bg-slate-200/60 dark:bg-slate-900'
                  }`}
                >
                  {nav.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Tools & Integrations */}
        <div className="space-y-0.5 pt-2 border-t border-slate-200/80 dark:border-slate-800/80">
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
            Workstation Tools
          </div>
          <button
            type="button"
            onClick={() => openModal('syncConfig')}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              <FolderSync className="w-4 h-4 text-sky-500 shrink-0" />
              <span>Sync Watcher</span>
            </span>
            {syncPairs.length > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                {syncPairs.length} active
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => openModal('p2pTransfer')}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <Share2 className="w-4 h-4 text-purple-500 shrink-0" />
            <span>P2P Direct Stream</span>
          </button>
          <button
            type="button"
            onClick={() => openModal('settings')}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4 text-slate-500 shrink-0" />
            <span>System Settings</span>
          </button>
        </div>
      </div>

      {/* Bottom section: Storage Gauge & Interactive Account Profile */}
      <div className="space-y-2.5 pt-3 border-t border-slate-200/80 dark:border-slate-800/80">
        <StorageGauge
          usedBytes={cloudUsedBytes}
          cacheBytes={virtualDrive?.cached_bytes || 0}
          encryptedCount={counts.encryptedCount}
          pinnedCount={counts.pinned}
        />

        {session && (
          <div className="flex items-center gap-1.5 p-2 rounded-xl bg-white dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/90 hover:border-sky-500/50 shadow-xs transition-all group">
            <button
              type="button"
              onClick={() => openModal('accountManager')}
              className="flex-1 text-left flex items-center gap-2.5 min-w-0 cursor-pointer"
              title="Manage Telegram Sessions"
            >
              <div className="relative shrink-0">
                <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-600 dark:text-sky-300 flex items-center justify-center font-bold text-xs">
                  {session.first_name ? session.first_name[0].toUpperCase() : 'T'}
                </div>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-950 ${
                    connectionStatus === 'checking'
                      ? 'bg-amber-500 animate-spin'
                      : isOnline
                      ? 'bg-emerald-500'
                      : 'bg-rose-500 animate-pulse'
                  }`}
                />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-200 truncate">
                  {session.username
                    ? `@${session.username.replace(/^@/, '')}`
                    : session.first_name || 'Telegram User'}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate">
                  {connectionStatus === 'checking'
                    ? 'Connecting...'
                    : isOnline
                    ? isEnabled && activeProxy
                      ? `MTProto (${activeProxy.proxy_type.toUpperCase()})`
                      : 'MTProto Connected'
                    : isEnabled
                    ? 'Offline (Proxy)'
                    : 'Offline'}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                checkConnection();
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-sky-500/10 transition-colors shrink-0 cursor-pointer"
              title="Test / Refresh MTProto Connection"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  connectionStatus === 'checking' ? 'animate-spin text-sky-400' : ''
                }`}
              />
            </button>
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden md:flex h-full shrink-0">{sidebarContent}</div>
      {mobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative z-10 h-full flex">{sidebarContent}</div>
        </div>
      )}
    </>
  );
};
