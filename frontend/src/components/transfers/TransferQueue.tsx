import React from 'react';
import { ChevronUp, ChevronDown, Activity, Trash2, X } from 'lucide-react';
import { useTransferStore } from '../../stores/useTransferStore';
import { TransferRow } from './TransferRow';
import { ProgressBar } from '../ui/ProgressBar';
import { formatBytes } from '../../api/mock';
import { api } from '../../api';

export const TransferQueue: React.FC = () => {
  const {
    transfers,
    isOpen,
    toggleOpen,
    setIsOpen,
    clearCompleted,
    removeTransfer,
    updateTransfer,
    getAggregateStats,
  } = useTransferStore();

  const stats = getAggregateStats();
  const { activeCount, queuedCount, completedCount, failedCount, pausedCount, overallPercent, aggregateSpeedBytesSec } = stats;

  if (transfers.length === 0) return null;

  // Telegram FLOOD_WAIT or network offline status detection (D-16, D-18)
  const isRateLimited = transfers.some((t) => t.error?.toLowerCase().includes('rate limit') || t.error?.includes('FLOOD_WAIT'));
  const isOffline = !navigator.onLine || transfers.some((t) => t.error?.toLowerCase().includes('network offline'));

  const handleTogglePause = async (id: string) => {
    const item = transfers.find((t) => t.id === id);
    if (!item) return;

    if (item.status === 'paused') {
      await api.resumeTransfer(id);
      updateTransfer(id, { status: 'uploading', speed: 'Resuming...' });
    } else if (item.status === 'uploading' || item.status === 'downloading') {
      await api.pauseTransfer(id);
      updateTransfer(id, { status: 'paused', speed: '0 B/s' });
    }
  };

  const handleCancel = async (id: string) => {
    await api.cancelTransfer(id);
    removeTransfer(id);
  };

  const handleRetry = async (item: (typeof transfers)[number]) => {
    updateTransfer(item.id, {
      status: 'uploading',
      progress: 0,
      error: undefined,
      speed: 'Retrying...',
    });
    await api.resumeTransfer(item.id);
  };

  const headerStatusText = isOffline
    ? 'Network offline: Waiting for connection...'
    : isRateLimited
      ? 'Rate limited: Cooling down...'
      : activeCount > 0
        ? `${activeCount} active${queuedCount > 0 ? ` • ${queuedCount} queued` : ''} • ${formatBytes(aggregateSpeedBytesSec)}/s`
        : queuedCount > 0
          ? `${queuedCount} in queue`
          : failedCount > 0
            ? `${failedCount} failed`
            : `${completedCount} completed`;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 sm:w-96 rounded-2xl p-1 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-white/10 backdrop-blur-2xl shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-3">
      <div className="rounded-xl bg-slate-50/90 dark:bg-slate-950/90 border border-slate-200/70 dark:border-white/[0.05] overflow-hidden">
        {/* Transfer Queue Header */}
        <div
          onClick={toggleOpen}
          className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/[0.02] transition-colors border-b border-slate-200/80 dark:border-white/5 select-none"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              {activeCount > 0 && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isRateLimited || isOffline
                    ? 'bg-amber-400'
                    : failedCount > 0
                      ? 'bg-rose-500'
                      : activeCount > 0
                        ? 'bg-sky-500'
                        : queuedCount > 0
                          ? 'bg-amber-400'
                          : 'bg-emerald-500'
                }`}
              />
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <Activity className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Transfers
              </span>
            </div>
            <span className="truncate px-2 py-0.5 rounded-full bg-slate-200/80 dark:bg-white/10 text-[10px] font-mono text-slate-700 dark:text-slate-300">
              {headerStatusText}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {completedCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearCompleted();
                }}
                title="Clear completed transfers"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleOpen();
              }}
              title={isOpen ? 'Collapse transfer queue' : 'Expand transfer queue'}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
              }}
              title="Minimize transfer queue"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Aggregate Queue Progress Bar */}
        {(activeCount > 0 || queuedCount > 0) && (
          <div className="px-3.5 py-1.5 bg-slate-100/60 dark:bg-white/[0.02] border-b border-slate-200/80 dark:border-white/5">
            <ProgressBar
              progress={overallPercent}
              height="sm"
              color={failedCount > 0 ? 'rose' : pausedCount > 0 ? 'amber' : 'sky'}
            />
          </div>
        )}

        {/* Transfer Queue Drawer */}
        {isOpen && (
          <div className="max-h-72 overflow-y-auto p-2.5 space-y-2 divide-y divide-slate-200/60 dark:divide-white/5 no-scrollbar">
            {transfers.map((item) => (
              <TransferRow
                key={item.id}
                item={item}
                onCancel={handleCancel}
                onTogglePause={handleTogglePause}
                onRetry={handleRetry}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
