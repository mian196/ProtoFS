import React from 'react';
import { FolderPlus, Upload, ShieldCheck, Trash2, Search, FilterX } from 'lucide-react';
import { Button } from '../ui/Button';
import { useModalStore } from '../../stores/useModalStore';
import { useVfsStore } from '../../stores/useVfsStore';

interface EmptyFolderStateProps {
  onUploadClick?: () => void;
  isTrash?: boolean;
}

export const EmptyFolderState: React.FC<EmptyFolderStateProps> = ({
  onUploadClick,
  isTrash = false,
}) => {
  const { openModal } = useModalStore();
  const { searchQuery, clearSearch, filterType, setFilterType } = useVfsStore();

  if (searchQuery.trim()) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center mb-4 shadow-sm">
          <Search className="w-6 h-6 text-slate-400" />
        </div>
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
          No matches for "{searchQuery}"
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1 mb-5">
          No files or folders matched your search query in this channel vault.
        </p>
        <Button variant="secondary" size="sm" onClick={clearSearch}>
          Clear Search
        </Button>
      </div>
    );
  }

  if (isTrash) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4 shadow-sm">
          <Trash2 className="w-7 h-7 text-rose-500 dark:text-rose-400" />
        </div>

        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
          Trash is empty
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1 mb-2">
          Files and folders you delete will show up here. You can restore them anytime or permanently delete them.
        </p>
      </div>
    );
  }

  if (filterType !== 'all') {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mb-4 shadow-sm">
          <FilterX className="w-6 h-6 text-sky-500 dark:text-sky-400" />
        </div>
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
          No {filterType} items found
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1 mb-5">
          There are no matching items for this view filter in the active drive.
        </p>
        <Button variant="secondary" size="sm" onClick={() => setFilterType('all')}>
          Show All Files
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center mb-4 shadow-sm">
        <FolderPlus className="w-7 h-7 text-sky-500 dark:text-sky-400" />
      </div>

      <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
        This directory is empty
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1 mb-6">
        Upload files or create subdirectories. All uploads are encrypted with AES-256-GCM before reaching Telegram servers.
      </p>

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          size="sm"
          onClick={onUploadClick}
          icon={<Upload className="w-4 h-4" />}
        >
          Upload Files
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => openModal('createFolder')}
          icon={<FolderPlus className="w-4 h-4" />}
        >
          New Folder
        </Button>
      </div>

      <div className="flex items-center gap-1.5 mt-8 text-[11px] text-emerald-600 dark:text-emerald-400/90 font-mono">
        <ShieldCheck className="w-3.5 h-3.5" />
        <span>Zero-Knowledge End-to-End Encrypted</span>
      </div>
    </div>
  );
};
