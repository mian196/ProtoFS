import React from 'react';
import { Database, Shield } from 'lucide-react';
import { ProgressBar } from '../ui/ProgressBar';

interface StorageGaugeProps {
  usedBytes?: number;
  totalBytes?: number;
  cacheBytes?: number;
}

export const StorageGauge: React.FC<StorageGaugeProps> = ({
  usedBytes = 0,
  cacheBytes = 0,
}) => {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-white/[0.06] space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
          <Database className="w-3.5 h-3.5 text-sky-400" />
          <span>Cloud Storage</span>
        </div>
        <span className="text-[10px] font-mono text-emerald-400 font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
          UNLIMITED
        </span>
      </div>

      <ProgressBar progress={100} color="sky" height="sm" />

      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
        <span>Stored: {formatBytes(usedBytes)}</span>
        <span className="text-[10px] text-slate-400">WAL: {formatBytes(cacheBytes)}</span>
      </div>

      <div className="flex items-center gap-1.5 pt-1 text-[10px] text-slate-400 border-t border-white/5">
        <Shield className="w-3 h-3 text-sky-400" />
        <span>Telegram MTProto Zero-Knowledge VFS</span>
      </div>
    </div>
  );
};
