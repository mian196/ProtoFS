import React from 'react';
import {
  Search,
  LayoutGrid,
  List,
  Upload,
  FolderPlus,
  Moon,
  Sun,
  Shield,
  X,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { BreadcrumbBar } from '../explorer/BreadcrumbBar';
import { useVfsStore } from '../../stores/useVfsStore';
import { useThemeStore } from '../../stores/useThemeStore';
import { useModalStore } from '../../stores/useModalStore';
import { useDriveStore } from '../../stores/useDriveStore';

interface FluidHeaderProps {
  onUploadClick: () => void;
}

export const FluidHeader: React.FC<FluidHeaderProps> = ({ onUploadClick }) => {
  const { viewMode, setViewMode, searchQuery, setSearchQuery, performSearch, clearSearch } =
    useVfsStore();
  const { theme, setTheme } = useThemeStore();
  const { openModal } = useModalStore();
  const { activeDrive } = useDriveStore();

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (activeDrive) {
      performSearch(activeDrive.id, val);
    }
  };

  const cycleTheme = () => {
    const themes: ('nordic' | 'cyberpunk' | 'forest' | 'obsidian')[] = [
      'nordic',
      'cyberpunk',
      'forest',
      'obsidian',
    ];
    const nextIdx = (themes.indexOf(theme) + 1) % themes.length;
    setTheme(themes[nextIdx]);
  };

  return (
    <header className="mx-4 mt-3 rounded-2xl bg-slate-900/80 border border-white/[0.08] backdrop-blur-2xl shadow-xl px-4 py-2.5 flex items-center justify-between gap-4 z-20">
      {/* Left: Breadcrumbs & Path */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <BreadcrumbBar />
      </div>

      {/* Middle: Tactical Search Bar */}
      <div className="relative max-w-xs w-full hidden md:block">
        <div className="relative flex items-center">
          <Search className="absolute left-3 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search FTS5 index... (/)"
            className="w-full bg-slate-950/80 text-xs text-slate-200 placeholder-slate-500 rounded-xl pl-9 pr-8 py-2 border border-white/10 focus:outline-none focus:border-sky-400/80 focus:ring-1 focus:ring-sky-400/30 transition-all font-mono"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-2.5 p-0.5 text-slate-400 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Right: Actions & Tools */}
      <div className="flex items-center gap-2 shrink-0">
        {/* View Mode Toggle */}
        <div className="flex items-center p-0.5 rounded-xl bg-slate-950/80 border border-white/5">
          <button
            onClick={() => setViewMode('grid')}
            title="Grid view"
            className={`p-1.5 rounded-lg transition-colors ${
              viewMode === 'grid'
                ? 'bg-sky-500/20 text-sky-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode('table')}
            title="Table list view"
            className={`p-1.5 rounded-lg transition-colors ${
              viewMode === 'table'
                ? 'bg-sky-500/20 text-sky-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Theme Cycler */}
        <button
          onClick={cycleTheme}
          title={`Active Theme: ${theme.toUpperCase()} (Click to cycle)`}
          className="p-2 rounded-xl bg-slate-950/80 border border-white/5 text-slate-400 hover:text-sky-400 transition-colors"
        >
          {theme === 'nordic' ? (
            <Moon className="w-3.5 h-3.5" />
          ) : (
            <Sun className="w-3.5 h-3.5" />
          )}
        </button>

        {/* New Folder Modal */}
        <button
          onClick={() => openModal('createFolder')}
          title="New Folder"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-white/10 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors"
        >
          <FolderPlus className="w-3.5 h-3.5 text-sky-400" />
          <span>New Folder</span>
        </button>

        {/* Upload Button */}
        <Button
          variant="primary"
          size="sm"
          onClick={onUploadClick}
          icon={<Upload className="w-3.5 h-3.5" />}
          nestedPill
          trailingIcon={<Shield className="w-3 h-3" />}
        >
          Upload
        </Button>
      </div>
    </header>
  );
};
