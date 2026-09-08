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
  const { theme, toggleTheme } = useThemeStore();
  const { openModal } = useModalStore();
  const { activeDrive } = useDriveStore();

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (activeDrive) {
      performSearch(activeDrive.id, val);
    }
  };

  return (
    <header className="mx-4 mt-3 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 backdrop-blur-xl shadow-sm px-4 py-2.5 flex items-center justify-between gap-4 z-20 transition-colors">
      {/* Left: Breadcrumbs & Path */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <BreadcrumbBar />
      </div>

      {/* Middle: Search Bar */}
      <div className="relative max-w-xs w-full hidden md:block">
        <div className="relative flex items-center">
          <Search className="absolute left-3 w-3.5 h-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search files... (/)"
            className="w-full bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 rounded-xl pl-9 pr-8 py-2 border border-slate-200 dark:border-slate-800 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all font-mono"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-2.5 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Right: Actions & Tools */}
      <div className="flex items-center gap-2 shrink-0">
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

        {/* New Folder Modal */}
        <button
          onClick={() => openModal('createFolder')}
          title="New Folder"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shadow-sm"
        >
          <FolderPlus className="w-3.5 h-3.5 text-sky-500" />
          <span>New Folder</span>
        </button>

        {/* Upload Button */}
        <Button
          variant="primary"
          size="sm"
          onClick={onUploadClick}
          icon={<Upload className="w-3.5 h-3.5" />}
          trailingIcon={<Shield className="w-3 h-3" />}
        >
          Upload
        </Button>
      </div>
    </header>
  );
};

