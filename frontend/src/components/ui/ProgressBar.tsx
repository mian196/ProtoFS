import React from 'react';

export interface ProgressBarProps {
  progress: number; // 0 to 100
  color?: 'sky' | 'emerald' | 'amber' | 'rose';
  height?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  color = 'sky',
  height = 'md',
  showLabel = false,
}) => {
  const clampedProgress = Math.min(100, Math.max(0, progress));

  const heightClasses = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3',
  }[height];

  const colorClasses = {
    sky: 'bg-sky-500 shadow-sm shadow-sky-500/50',
    emerald: 'bg-emerald-500 shadow-sm shadow-emerald-500/50',
    amber: 'bg-amber-500 shadow-sm shadow-amber-500/50',
    rose: 'bg-rose-500 shadow-sm shadow-rose-500/50',
  }[color];

  return (
    <div className="w-full flex items-center gap-2">
      <div className={`w-full bg-slate-800/80 rounded-full overflow-hidden ${heightClasses}`}>
        <div
          className={`${heightClasses} ${colorClasses} rounded-full transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]`}
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-mono text-slate-400 shrink-0">
          {Math.round(clampedProgress)}%
        </span>
      )}
    </div>
  );
};
