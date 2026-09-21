import React from 'react';
import { FolderPlus, Upload, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { useModalStore } from '../../stores/useModalStore';

interface EmptyFolderStateProps {
  onUploadClick?: () => void;
  isTrash?: boolean;
}

export const EmptyFolderState: React.FC<EmptyFolderStateProps> = ({
  onUploadClick,
  isTrash = false,
}) => {
  const { openModal } = useModalStore();

  if (isTrash) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/[0.05] border border-rose-500/15 flex items-center justify-center mb-4 shadow-xl">
          <Trash2 className="w-8 h-8 text-rose-400" />
        </div>

        <h3 className="text-base font-semibold text-slate-200">Trash is empty</h3>
        <p className="text-xs text-slate-400 max-w-sm mt-1 mb-2">
          Files and folders you delete will show up here. You can restore them anytime or permanently delete them.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="w-16 h-16 rounded-3xl bg-white/[0.03] border border-white/10 flex items-center justify-center mb-4 shadow-xl">
        <FolderPlus className="w-8 h-8 text-sky-400" />
      </div>

      <h3 className="text-base font-semibold text-slate-200">This directory is empty</h3>
      <p className="text-xs text-slate-400 max-w-sm mt-1 mb-6">
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

      <div className="flex items-center gap-1.5 mt-8 text-[11px] text-emerald-400/80 font-mono">
        <ShieldCheck className="w-3.5 h-3.5" />
        <span>End-to-End Encrypted</span>
      </div>
    </div>
  );
};
