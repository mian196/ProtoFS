import React from 'react';
import { Layers, FolderSync, Share2, Activity, Settings } from 'lucide-react';
import { useVfsStore } from '../../stores/useVfsStore';
import { useModalStore } from '../../stores/useModalStore';
import { useTransferStore } from '../../stores/useTransferStore';

export const MobileTabBar: React.FC = () => {
  const { filterType, setFilterType } = useVfsStore();
  const { openModal } = useModalStore();
  const { toggleOpen, transfers } = useTransferStore();

  const activeTransfers = transfers.filter(
    (t) => t.status === 'uploading' || t.status === 'downloading',
  ).length;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-950/95 border-t border-slate-200 dark:border-slate-800 backdrop-blur-2xl flex items-center justify-around py-1.5 px-1 select-none">
      <button
        type="button"
        onClick={() => setFilterType('all')}
        className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${
          filterType === 'all'
            ? 'text-sky-600 dark:text-sky-400 font-semibold'
            : 'text-slate-500 dark:text-slate-400'
        }`}
      >
        <Layers className="w-4 h-4" />
        <span className="text-[10px]">Files</span>
      </button>

      <button
        type="button"
        onClick={() => openModal('syncConfig')}
        className="flex flex-col items-center gap-1 p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        <FolderSync className="w-4 h-4" />
        <span className="text-[10px]">Sync</span>
      </button>

      <button
        type="button"
        onClick={toggleOpen}
        className="relative flex flex-col items-center gap-1 p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        <Activity className="w-4 h-4" />
        <span className="text-[10px]">Transfers</span>
        {activeTransfers > 0 && (
          <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-sky-500 animate-ping" />
        )}
      </button>

      <button
        type="button"
        onClick={() => openModal('p2pTransfer')}
        className="flex flex-col items-center gap-1 p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        <Share2 className="w-4 h-4" />
        <span className="text-[10px]">P2P</span>
      </button>

      <button
        type="button"
        onClick={() => openModal('settings')}
        className="flex flex-col items-center gap-1 p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        <Settings className="w-4 h-4" />
        <span className="text-[10px]">Settings</span>
      </button>
    </nav>
  );
};
