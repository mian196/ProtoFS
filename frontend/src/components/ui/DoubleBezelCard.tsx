import React from 'react';

export interface DoubleBezelCardProps {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  onClick?: () => void;
  interactive?: boolean;
}

export const DoubleBezelCard: React.FC<DoubleBezelCardProps> = ({
  children,
  className = '',
  innerClassName = '',
  onClick,
  interactive = false,
}) => {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl p-1.5 bg-white/[0.03] border border-white/[0.08] backdrop-blur-xl shadow-xl transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        interactive ? 'cursor-pointer hover:border-sky-500/40 hover:bg-white/[0.05] hover:scale-[1.01]' : ''
      } ${className}`}
    >
      <div
        className={`rounded-[calc(1rem-0.125rem)] bg-slate-900/90 border border-white/[0.04] shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] ${innerClassName}`}
      >
        {children}
      </div>
    </div>
  );
};
