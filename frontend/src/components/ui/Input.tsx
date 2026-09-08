import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  trailingElement?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  icon,
  trailingElement,
  className = '',
  ...props
}) => {
  return (
    <div className="relative flex items-center w-full">
      {icon && (
        <div className="absolute left-3 flex items-center pointer-events-none text-slate-400">
          {icon}
        </div>
      )}
      <input
        className={`w-full bg-slate-950/70 text-slate-100 placeholder-slate-500 text-sm rounded-xl border border-white/10 px-3.5 py-2.5 transition-all duration-200 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/50 shadow-inner ${
          icon ? 'pl-9' : ''
        } ${trailingElement ? 'pr-9' : ''} ${className}`}
        {...props}
      />
      {trailingElement && (
        <div className="absolute right-3 flex items-center text-slate-400">
          {trailingElement}
        </div>
      )}
    </div>
  );
};
