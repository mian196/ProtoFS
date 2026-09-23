import React from 'react';
import { Upload, Download, CheckCircle2, Pause, X, Play, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import { ProgressBar } from '../ui/ProgressBar';
import { formatBytes } from '../../api/mock';
import type { TransferItem } from '../../types';

interface TransferRowProps {
  item: TransferItem;
  onCancel?: (id: string) => void;
  onTogglePause?: (id: string) => void;
  onRetry?: (item: TransferItem) => void;
}

export const TransferRow: React.FC<TransferRowProps> = ({
  item,
  onCancel,
  onTogglePause,
  onRetry,
}) => {
  const isQueued = item.status === 'queued';
  const isUpload = item.status === 'uploading';
  const isDownload = item.status === 'downloading';
  const isCompleted = item.status === 'completed';
  const isPaused = item.status === 'paused';
  const isFailed = item.status === 'failed';

  const progressColor = isCompleted
    ? 'emerald'
    : isFailed
      ? 'rose'
      : isPaused
        ? 'amber'
        : 'sky';

  const byteDisplay =
    item.bytes_transferred !== undefined && item.total_bytes !== undefined && item.total_bytes > 0
      ? `${formatBytes(item.bytes_transferred)} of ${formatBytes(item.total_bytes)}`
      : item.size;

  return (
    <div className="p-3 rounded-xl bg-slate-950/60 border border-white/[0.04] space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="p-1 rounded-lg bg-white/5 shrink-0">
            {isUpload ? (
              <Upload className="w-3.5 h-3.5 text-sky-400" />
            ) : isDownload ? (
              <Download className="w-3.5 h-3.5 text-purple-400" />
            ) : isCompleted ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : isPaused ? (
              <Pause className="w-3.5 h-3.5 text-amber-400" />
            ) : isQueued ? (
              <Clock className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
            )}
          </span>
          <span className="text-xs font-medium text-slate-200 truncate" title={item.name}>
            {item.name}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {(isUpload || isDownload || isPaused) && onTogglePause && (
            <button
              onClick={() => onTogglePause(item.id)}
              title={isPaused ? 'Resume' : 'Pause'}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              {isPaused ? <Play className="w-3 h-3 text-emerald-400" /> : <Pause className="w-3 h-3" />}
            </button>
          )}
          {isFailed && onRetry && (
            <button
              onClick={() => onRetry(item)}
              title="Retry"
              className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-white/10 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
          {onCancel && (
            <button
              onClick={() => onCancel(item.id)}
              title={isCompleted ? 'Dismiss' : 'Cancel'}
              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-white/10 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <ProgressBar progress={item.progress} height="sm" color={progressColor} />

      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
        <span className="truncate max-w-[50%]">{byteDisplay}</span>
        <span className="truncate text-right">
          {isCompleted
            ? 'Done • 100%'
            : isPaused
              ? 'Paused by user'
              : isQueued
                ? 'In queue'
                : isFailed
                  ? <span className="text-rose-400">{item.error || 'Failed. Click retry.'}</span>
                  : `${item.speed}${item.eta ? ` • ETA ${item.eta}` : ''} • ${Math.round(item.progress)}%`}
        </span>
      </div>
    </div>
  );
};
