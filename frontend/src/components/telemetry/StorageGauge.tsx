import React from 'react';
import { Database, Shield, HardDrive } from 'lucide-react';
import { ProgressBar } from '../ui/ProgressBar';

interface StorageGaugeProps {
  usedBytes?: number;
  totalBytes?: number;
  cacheBytes?: number;
  encryptedCount?: number;
  pinnedCount?: number;
}

export const StorageGauge: React.FC<StorageGaugeProps> = ({
  usedBytes = 0,
  cacheBytes = 0,
  encryptedCount = 0,
  pinnedCount = 0,
}) => {
  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Visual activity ratio for local cache vs cloud payload (min 12% when non-empty for visibility)
  const ratio =
    usedBytes > 0
      ? Math.max(18, Math.min(100, Math.round((cacheBytes / Math.max(usedBytes, 1)) * 100) || 32))
      : 8;

  return (
    <div className="p-3 rounded-xl bg-white dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/90 shadow-xs space-y-2.5 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
          <Database className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
          <span>Channel Vault</span>
        </div>
        <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/25">
          UNLIMITED
        </span>
      </div>

      <ProgressBar progress={ratio} color="sky" height="sm" />

      <div className="grid grid-cols-2 gap-1.5 pt-0.5">
        <div className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200/60 dark:border-slate-800/70">
          <div className="text-[9px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Cloud Stored
          </div>
          <div className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200">
            {formatBytes(usedBytes)}
          </div>
        </div>
        <div className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200/60 dark:border-slate-800/70">
          <div className="text-[9px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1">
            <HardDrive className="w-2.5 h-2.5 text-amber-500" />
            <span>LRU Cache</span>
          </div>
          <div className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200">
            {formatBytes(cacheBytes)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1.5 text-[10px] text-slate-500 dark:text-slate-400 border-t border-slate-200/70 dark:border-slate-800/70 font-mono">
        <span className="flex items-center gap-1">
          <Shield className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
          <span>AES-256-GCM ({encryptedCount})</span>
        </span>
        <span>{pinnedCount} pinned</span>
      </div>
    </div>
  );
};
