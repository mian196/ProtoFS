import React from 'react';
import { Upload, Download, CheckCircle2, Pause, X, Play } from 'lucide-react';
import { ProgressBar } from '../ui/ProgressBar';
import type { TransferItem } from '../../types';

interface TransferRowProps {
  item: TransferItem;
  onCancel?: (id: string) => void;
  onTogglePause?: (id: string) => void;
}

export const TransferRow: React.FC<TransferRowProps> = ({
  item,
  onCancel,
  onTogglePause,
}) => {
  const isUpload = item.status === 'uploading';
  const isCompleted = item.status === 'completed';
  const isPaused = item.status === 'paused';

  return (
    <div className="p-3 rounded-xl bg-slate-950/60 border border-white/[0.04] space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="p-1 rounded-lg bg-white/5 shrink-0">
            {isUpload ? (
              <Upload className="w-3.5 h-3.5 text-sky-400" />
            ) : isCompleted ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Download className="w-3.5 h-3.5 text-purple-400" />
            )}
          </span>
          <span className="text-xs font-medium text-slate-200 truncate" title={item.name}>
            {item.name}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!isCompleted && onTogglePause && (
            <button
              onClick={() => onTogglePause(item.id)}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10"
            >
              {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            </button>
          )}
          {onCancel && (
            <button
              onClick={() => onCancel(item.id)}
              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-white/10"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <ProgressBar
        progress={item.progress}
        height="sm"
        color={isCompleted ? 'emerald' : 'sky'}
      />

      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
        <span>{item.size}</span>
        <span>
          {isCompleted ? 'Finished' : isPaused ? 'Paused' : `${item.speed} • ${Math.round(item.progress)}%`}
        </span>
      </div>
    </div>
  );
};
