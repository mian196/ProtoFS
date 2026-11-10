import React from 'react';
import { HardDrive, Settings, Plus, Shield, Menu } from 'lucide-react';
import { useDriveStore } from '../../stores/useDriveStore';
import { useModalStore } from '../../stores/useModalStore';
import { useVfsStore } from '../../stores/useVfsStore';

interface MobileTopBarProps {
  onSearchToggle?: () => void;
}

export const MobileTopBar: React.FC<MobileTopBarProps> = () => {
  const { activeDrive } = useDriveStore();
  const { openModal } = useModalStore();
  const { setMobileSidebarOpen } = useVfsStore();

  return (
    <div className="md:hidden flex items-center justify-between px-3.5 py-2.5 bg-white/95 dark:bg-slate-950/95 border-b border-slate-200 dark:border-slate-800 backdrop-blur-xl select-none shrink-0">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Open navigation menu"
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="w-6 h-6 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-600 dark:text-sky-400">
          <HardDrive className="w-3.5 h-3.5" />
        </div>
        <div>
          <h1 className="text-xs font-bold text-slate-900 dark:text-white truncate max-w-[160px]">
            {activeDrive?.name || 'ProtoFS Drive'}
          </h1>
          <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 font-mono">
            <Shield className="w-2.5 h-2.5 text-emerald-500" />
            <span>AES-256-GCM</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => openModal('createFolder')}
          className="p-2 rounded-lg text-sky-600 dark:text-sky-400 hover:bg-sky-500/10"
          title="New Folder"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => openModal('settings')}
          className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
