import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  LayoutGrid,
  List,
  Upload,
  FolderPlus,
  Moon,
  Sun,
  X,
  ShieldCheck,
  ShieldOff,
  PanelRight,
  Activity,
  Link2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { BreadcrumbBar } from '../explorer/BreadcrumbBar';
import { useVfsStore } from '../../stores/useVfsStore';
import { useThemeStore } from '../../stores/useThemeStore';
import { useModalStore } from '../../stores/useModalStore';
import { useDriveStore } from '../../stores/useDriveStore';
import { useProxyStore } from '../../stores/useProxyStore';
import { useTransferStore } from '../../stores/useTransferStore';

export interface HeaderProps {
  onUploadClick: () => void;
}

const FILTER_LABELS: Record<string, string> = {
  video: 'Videos',
  image: 'Images',
  doc: 'Documents',
  audio: 'Audio Tracks',
  pinned: 'Pinned in Cache',
  trash: 'Trash Bin',
};

export const Header: React.FC<HeaderProps> = ({ onUploadClick }) => {
  const {
    viewMode,
    setViewMode,
    searchQuery,
    searchResults,
    setSearchQuery,
    performSearch,
    clearSearch,
    filterType,
    setFilterType,
    inspectorOpen,
    toggleInspector,
  } = useVfsStore();
  const { theme, toggleTheme } = useThemeStore();
  const { openModal } = useModalStore();
  const { activeDrive, isDriveAccessible } = useDriveStore();
  const { isEnabled, activeProxyId, proxies, testResults } = useProxyStore();
  const { transfers, isOpen: isTransfersOpen, toggleOpen: toggleTransfers } = useTransferStore();

  const activeProxy = proxies.find((p) => p.id === activeProxyId);
  const activeResult = activeProxyId ? testResults[activeProxyId] : null;
  const activeTransferCount = transfers.filter(
    (t) => t.status === 'uploading' || t.status === 'downloading',
  ).length;

  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (activeDrive) {
      performSearch(activeDrive.id, val);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.innerWidth < 768) {
          setIsSearchExpanded(true);
          setTimeout(() => mobileSearchInputRef.current?.focus(), 50);
        } else {
          searchInputRef.current?.focus();
        }
      } else if (e.key === '/' && !isInput) {
        e.preventDefault();
        if (window.innerWidth < 768) {
          setIsSearchExpanded(true);
          setTimeout(() => mobileSearchInputRef.current?.focus(), 50);
        } else {
          searchInputRef.current?.focus();
        }
      } else if (
        e.key === 'Escape' &&
        (document.activeElement === searchInputRef.current ||
          document.activeElement === mobileSearchInputRef.current)
      ) {
        clearSearch();
        searchInputRef.current?.blur();
        mobileSearchInputRef.current?.blur();
        setIsSearchExpanded(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSearch]);

  return (
    <header className="w-full bg-white/90 dark:bg-slate-900/90 border-b border-slate-200/90 dark:border-slate-800/90 backdrop-blur-xl px-4 py-2.5 flex flex-col gap-2 z-20 transition-colors shrink-0">
      <div className="flex items-center justify-between gap-3 w-full">
        {/* Left: Breadcrumbs & Active View Pill */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <BreadcrumbBar />
          {filterType !== 'all' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium bg-sky-500/12 text-sky-700 dark:text-sky-300 border border-sky-500/25 shrink-0">
              <span>View: {FILTER_LABELS[filterType] || filterType}</span>
              <button
                type="button"
                onClick={() => setFilterType('all')}
                className="hover:text-sky-900 dark:hover:text-white cursor-pointer"
                title="Reset view filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>

        {/* Middle: Search Bar */}
        <div className="relative max-w-xs w-full hidden md:block">
          <div className="relative flex items-center">
            <Search className="absolute left-3 w-3.5 h-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search vault... (Ctrl+K or /)"
              className="w-full bg-slate-100/80 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 rounded-lg pl-8 pr-16 py-1.5 border border-slate-200 dark:border-slate-800 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all font-mono"
            />
            {searchQuery ? (
              <div className="absolute right-2 flex items-center gap-1">
                {searchResults && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-600 dark:text-sky-400">
                    {searchResults.length}
                  </span>
                )}
                <button
                  type="button"
                  onClick={clearSearch}
                  className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded select-none pointer-events-none">
                Ctrl K
              </kbd>
            )}
          </div>
        </div>

        {/* Right: Workstation Controls & Primary Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Mobile Search Toggle */}
          <button
            type="button"
            onClick={() => {
              setIsSearchExpanded((prev) => !prev);
              if (!isSearchExpanded) {
                setTimeout(() => mobileSearchInputRef.current?.focus(), 50);
              }
            }}
            className="md:hidden p-1.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
            title="Toggle Search Bar"
            aria-label="Toggle Search Bar"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          {/* View Mode Segmented Switch */}
          <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              title="Grid view"
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-2xs'
                  : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              title="Table list view"
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-2xs'
                  : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Node Inspector Toggle */}
          <button
            type="button"
            onClick={() => toggleInspector()}
            title="Toggle Cryptographic Node Inspector"
            aria-pressed={inspectorOpen}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              inspectorOpen
                ? 'bg-sky-500/15 border-sky-500/40 text-sky-600 dark:text-sky-400'
                : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400'
            }`}
          >
            <PanelRight className="w-3.5 h-3.5" />
          </button>

          {/* Transfer Queue Toggle */}
          <button
            type="button"
            onClick={toggleTransfers}
            title="Toggle Transfer Queue"
            className={`hidden sm:flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs font-mono transition-colors cursor-pointer ${
              isTransfersOpen || activeTransferCount > 0
                ? 'bg-sky-500/12 border-sky-500/30 text-sky-600 dark:text-sky-400'
                : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Activity
              className={`w-3.5 h-3.5 ${activeTransferCount > 0 ? 'animate-pulse text-sky-500' : ''}`}
            />
            {transfers.length > 0 && <span>{transfers.length}</span>}
          </button>

          {/* Light / Dark Mode Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            title={`Active: ${theme === 'dark' ? 'Dark' : 'Light'} Mode (Click to toggle)`}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors cursor-pointer"
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-slate-700" />
            )}
          </button>

          {/* Live Proxy Status Badge */}
          <button
            type="button"
            onClick={() => openModal('settings', { defaultTab: 'proxy' })}
            title="Click to configure Telegram MTProto / SOCKS5 Proxy"
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono transition-all cursor-pointer ${
              isEnabled && activeProxy
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {isEnabled && activeProxy ? (
              <>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>
                  {activeProxy.proxy_type.toUpperCase()}
                  {activeResult?.latency_ms ? ` • ${activeResult.latency_ms}ms` : ' • Active'}
                </span>
              </>
            ) : (
              <>
                <ShieldOff className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>Direct</span>
              </>
            )}
          </button>

          {/* Import Shared Link Button */}
          <button
            type="button"
            onClick={() => isDriveAccessible && openModal('shareLink')}
            disabled={!isDriveAccessible}
            title="Import or Create protofs:// Share Link"
            className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
              !isDriveAccessible
                ? 'opacity-40 cursor-not-allowed bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                : 'bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Link2 className="w-3.5 h-3.5 text-sky-500" />
            <span>Import Link</span>
          </button>

          {/* New Folder Button */}
          <button
            type="button"
            onClick={() => isDriveAccessible && openModal('createFolder')}
            disabled={!isDriveAccessible}
            title={
              !isDriveAccessible
                ? 'Disabled: Drive is read-only (channel inaccessible)'
                : 'New Folder'
            }
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
              !isDriveAccessible
                ? 'opacity-40 cursor-not-allowed bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                : 'bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <FolderPlus className="w-3.5 h-3.5 text-sky-500" />
            <span>New Folder</span>
          </button>

          {/* Upload Button */}
          <Button
            variant="primary"
            size="sm"
            disabled={!isDriveAccessible}
            onClick={isDriveAccessible ? onUploadClick : undefined}
            icon={<Upload className="w-3.5 h-3.5" />}
            title={
              !isDriveAccessible
                ? 'Disabled: Drive is read-only (channel inaccessible)'
                : 'Upload Files'
            }
          >
            Upload Files
          </Button>
        </div>
      </div>

      {/* Mobile Search Overlay Sub-Row (<md) */}
      {isSearchExpanded && (
        <div className="md:hidden w-full pt-2 border-t border-slate-200 dark:border-slate-800 animate-in fade-in slide-in-from-top-1">
          <div className="relative flex items-center">
            <Search className="absolute left-3 w-3.5 h-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
            <input
              ref={mobileSearchInputRef}
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search files..."
              className="w-full bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 rounded-lg pl-9 pr-8 py-2 border border-slate-200 dark:border-slate-800 focus:outline-none focus:border-sky-500 font-mono"
            />
            <button
              type="button"
              onClick={() => {
                clearSearch();
                setIsSearchExpanded(false);
              }}
              className="absolute right-2.5 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white"
              title="Close Search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
