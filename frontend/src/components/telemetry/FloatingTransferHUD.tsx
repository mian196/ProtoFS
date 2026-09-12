import React from 'react';
import { ChevronUp, ChevronDown, Activity, Trash2, X } from 'lucide-react';
import { useTransferStore } from '../../stores/useTransferStore';
import { TransferRow } from './TransferRow';

export const FloatingTransferHUD: React.FC = () => {
  const { transfers, isOpen, toggleOpen, setIsOpen, clearCompleted, removeTransfer } =
    useTransferStore();

  const activeCount = transfers.filter((t) => t.status === 'uploading' || t.status === 'downloading').length;
  const completedCount = transfers.filter((t) => t.status === 'completed').length;

  // Auto-dismiss completed transfers after 8 seconds of idle completion
  React.useEffect(() => {
    if (activeCount === 0 && completedCount > 0) {
      const timer = setTimeout(() => {
        clearCompleted();
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [activeCount, completedCount, clearCompleted]);

  if (transfers.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 sm:w-96 rounded-3xl p-1.5 bg-white/[0.04] border border-white/10 backdrop-blur-2xl shadow-2xl transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] animate-in fade-in slide-in-from-bottom-3">
      <div className="rounded-[calc(1.5rem-0.375rem)] bg-slate-900/95 border border-white/[0.05] overflow-hidden shadow-inner">
        {/* HUD Header */}
        <div
          onClick={toggleOpen}
          className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors border-b border-white/5 select-none"
        >
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              {activeCount > 0 && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  activeCount > 0 ? 'bg-sky-500' : 'bg-emerald-500'
                }`}
              />
            </span>
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-semibold text-slate-200">Transfers HUD</span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-mono text-slate-300">
              {activeCount > 0 ? `${activeCount} active` : `${completedCount} done`}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {completedCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearCompleted();
                }}
                title="Clear finished"
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleOpen();
              }}
              title={isOpen ? "Collapse" : "Expand"}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (activeCount === 0) {
                  clearCompleted();
                } else {
                  setIsOpen(false);
                }
              }}
              title="Close HUD"
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* HUD Content Drawer */}
        {isOpen && (
          <div className="max-h-72 overflow-y-auto p-3 space-y-2 divide-y divide-white/5 no-scrollbar">
            {transfers.map((item) => (
              <TransferRow
                key={item.id}
                item={item}
                onCancel={(id) => removeTransfer(id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
