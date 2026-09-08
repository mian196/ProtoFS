import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'sky' | 'emerald' | 'amber' | 'rose' | 'slate' | 'tactical';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'sky',
  size = 'md',
  icon,
}) => {
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px] gap-1',
    md: 'px-2.5 py-1 text-xs gap-1.5',
  }[size];

  const variantClasses = {
    sky: 'bg-sky-500/10 text-sky-400 border border-sky-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
    slate: 'bg-slate-800 text-slate-300 border border-white/5',
    tactical:
      'bg-slate-950 text-sky-400 font-mono tracking-widest uppercase border border-sky-500/30',
  }[variant];

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${sizeClasses} ${variantClasses}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
};
