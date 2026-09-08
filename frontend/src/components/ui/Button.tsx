import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'tactical';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  nestedPill?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  trailingIcon,
  nestedPill = false,
  className = '',
  disabled,
  ...props
}) => {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-6 py-3 text-base gap-3',
  }[size];

  const variantClasses = {
    primary:
      'bg-sky-500 text-slate-950 font-semibold hover:bg-sky-400 active:scale-[0.98] shadow-lg shadow-sky-500/20 border border-sky-400/30',
    secondary:
      'bg-slate-800/80 text-slate-200 hover:bg-slate-700 active:scale-[0.98] border border-white/10 hover:border-white/20',
    ghost:
      'bg-transparent text-slate-300 hover:text-white hover:bg-white/5 active:scale-[0.98]',
    danger:
      'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30 hover:border-rose-500/50 active:scale-[0.98]',
    tactical:
      'bg-slate-900 text-sky-400 font-mono text-xs uppercase tracking-wider border border-sky-500/30 hover:border-sky-400 hover:bg-sky-950/40 active:scale-[0.98]',
  }[variant];

  return (
    <button
      className={`group relative inline-flex items-center justify-center rounded-full font-medium select-none cursor-pointer transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] disabled:opacity-40 disabled:pointer-events-none ${sizeClasses} ${variantClasses} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children && <span>{children}</span>}
      {trailingIcon && nestedPill && (
        <span className="w-5 h-5 -mr-1 rounded-full bg-slate-950/20 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
          {trailingIcon}
        </span>
      )}
      {trailingIcon && !nestedPill && <span className="shrink-0">{trailingIcon}</span>}
    </button>
  );
};
