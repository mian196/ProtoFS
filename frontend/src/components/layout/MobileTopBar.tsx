import React from 'react';
import { HardDrive, Settings, Search, Plus } from 'lucide-react';
import { useDriveStore } from '../../stores/useDriveStore';
import { useModalStore } from '../../stores/useModalStore';

interface MobileTopBarProps {
  onSearchToggle: () => void;
}

export const MobileTopBar: React.FC<MobileTopBarProps> = ({ onSearchToggle }) => {
  const { activeDrive } = useDriveStore();
  const { openModal } = useModalStore();

  return (
    <div className="md:hidden flex items-center justify-between p-3.5 bg-slate-950/90 border-b border-white/10 backdrop-blur-xl select-none">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400">
          <HardDrive className="w-4 h-4" />
        </div>
        <div>
          <h1 className="text-xs font-bold text-white truncate max-w-[150px]">
            {activeDrive?.name || 'ProtoFS Drive'}
          </h1>
          <p className="text-[10px] text-slate-400 font-mono">Zero-Knowledge</p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onSearchToggle}
          className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10"
        >
          <Search className="w-4 h-4" />
        </button>
        <button
          onClick={() => openModal('createFolder')}
          className="p-2 rounded-xl text-sky-400 hover:bg-sky-500/10"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={() => openModal('settings')}
          className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
