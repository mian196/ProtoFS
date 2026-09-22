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
} from 'lucide-react';
import { Button } from '../ui/Button';
import { BreadcrumbBar } from '../explorer/BreadcrumbBar';
import { useVfsStore } from '../../stores/useVfsStore';
import { useThemeStore } from '../../stores/useThemeStore';
import { useModalStore } from '../../stores/useModalStore';
import { useDriveStore } from '../../stores/useDriveStore';
import { useProxyStore } from '../../stores/useProxyStore';

export interface HeaderProps {
  onUploadClick: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onUploadClick }) => {
  const { viewMode, setViewMode, searchQuery, setSearchQuery, performSearch, clearSearch } =
    useVfsStore();
  const { theme, toggleTheme } = useThemeStore();
  const { openModal } = useModalStore();
  const { activeDrive, isDriveAccessible } = useDriveStore();
  const { isEnabled, activeProxyId, proxies, testResults } = useProxyStore();

  const activeProxy = proxies.find((p) => p.id === activeProxyId);
  const activeResult = activeProxyId ? testResults[activeProxyId] : null;

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
    <header className="mx-4 mt-3 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 backdrop-blur-xl shadow-sm px-4 py-2.5 flex flex-col gap-2 z-20 transition-colors">
      <div className="flex items-center justify-between gap-4 w-full">
        {/* Left: Breadcrumbs & Path (D-15) */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <BreadcrumbBar />
        </div>

        {/* Middle: Search Bar (D-14) */}
        <div className="relative max-w-xs w-full hidden md:block">
          <div className="relative flex items-center">
            <Search className="absolute left-3 w-3.5 h-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search files... (Ctrl+K or /)"
              className="w-full bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 rounded-xl pl-9 pr-14 py-2 border border-slate-200 dark:border-slate-800 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all font-mono"
            />
            {searchQuery ? (
              <button
                onClick={clearSearch}
                className="absolute right-2.5 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            ) : (
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded select-none pointer-events-none">
                Ctrl K
              </kbd>
            )}
          </div>
        </div>

        {/* Right: Actions & Tools */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Mobile Search Toggle (D-16) */}
          <button
            type="button"
            onClick={() => {
              setIsSearchExpanded((prev) => !prev);
              if (!isSearchExpanded) {
                setTimeout(() => mobileSearchInputRef.current?.focus(), 50);
              }
            }}
            className="md:hidden p-2 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors shadow-sm"
            title="Toggle Search Bar"
            aria-label="Toggle Search Bar"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          {/* View Mode Toggle */}
          <div className="flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setViewMode('grid')}
              title="Grid view"
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              title="Table list view"
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Light / Dark Mode Toggle */}
          <button
            onClick={toggleTheme}
            title={`Active: ${theme === 'dark' ? 'Dark' : 'Light'} Mode (Click to toggle)`}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors shadow-sm"
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-slate-700" />
            )}
          </button>

          {/* Live Proxy Status Badge (D-05, UI-03) */}
          <button
            type="button"
            onClick={() => openModal('settings', { defaultTab: 'proxy' })}
            title="Click to configure Telegram MTProto / SOCKS5 Proxy"
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-mono transition-all shadow-sm cursor-pointer ${
              isEnabled && activeProxy
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700'
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

          {/* New Folder Modal */}
          <button
            onClick={() => isDriveAccessible && openModal('createFolder')}
            disabled={!isDriveAccessible}
            title={!isDriveAccessible ? 'Disabled: Drive is read-only (channel inaccessible)' : 'New Folder'}
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors shadow-sm ${
              !isDriveAccessible
                ? 'opacity-40 cursor-not-allowed bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <FolderPlus className="w-3.5 h-3.5 text-sky-500" />
            <span>New Folder</span>
          </button>

          {/* Upload Button (D-08) */}
          <Button
            variant="primary"
            size="sm"
            disabled={!isDriveAccessible}
            onClick={isDriveAccessible ? onUploadClick : undefined}
            icon={<Upload className="w-3.5 h-3.5" />}
            title={!isDriveAccessible ? 'Disabled: Drive is read-only (channel inaccessible)' : 'Upload Files'}
          >
            Upload Files
          </Button>
        </div>
      </div>

      {/* Mobile Search Overlay Sub-Row (<md) (D-16) */}
      {isSearchExpanded && (
        <div className="md:hidden w-full pt-2 border-t border-slate-100 dark:border-slate-800/80 animate-in fade-in slide-in-from-top-1">
          <div className="relative flex items-center">
            <Search className="absolute left-3 w-3.5 h-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
            <input
              ref={mobileSearchInputRef}
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search files..."
              className="w-full bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 rounded-xl pl-9 pr-8 py-2 border border-slate-200 dark:border-slate-800 focus:outline-none focus:border-sky-500 font-mono"
            />
            <button
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
