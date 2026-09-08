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
        <div className="absolute left-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
          {icon}
        </div>
      )}
      <input
        className={`w-full bg-slate-50 dark:bg-slate-950/80 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-sm rounded-xl border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 transition-all duration-150 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 shadow-sm ${
          icon ? 'pl-9' : ''
        } ${trailingElement ? 'pr-9' : ''} ${className}`}
        {...props}
      />
      {trailingElement && (
        <div className="absolute right-3 flex items-center text-slate-400 dark:text-slate-500">
          {trailingElement}
        </div>
      )}
    </div>
  );
};

