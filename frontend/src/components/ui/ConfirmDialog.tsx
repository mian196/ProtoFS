import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Trash2, ShieldAlert, Info, Lightbulb, X } from 'lucide-react';
import { useConfirmStore } from '../../stores/useConfirmStore';
import { Button } from './Button';

export const ConfirmDialog: React.FC = () => {
  const { isOpen, options, confirmAction, cancelAction } = useConfirmStore();
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const variant = options?.variant || 'info';
  const defaultFocus =
    options?.defaultFocus ?? (variant === 'danger' ? 'cancel' : 'confirm');

  useEffect(() => {
    if (!isOpen) return;

    // Focus appropriate button on modal open
    const timer = setTimeout(() => {
      if (defaultFocus === 'cancel') {
        cancelBtnRef.current?.focus();
      } else {
        confirmBtnRef.current?.focus();
      }
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelAction();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, defaultFocus, cancelAction]);

  if (!isOpen || !options) return null;

  const renderIcon = () => {
    if (options.icon === 'trash' || (variant === 'danger' && !options.icon)) {
      return <Trash2 className="w-5 h-5" />;
    }
    if (options.icon === 'shield') {
      return <ShieldAlert className="w-5 h-5" />;
    }
    if (options.icon === 'alert' || variant === 'warning') {
      return <AlertTriangle className="w-5 h-5" />;
    }
    return <Info className="w-5 h-5" />;
  };

  const badgeStyles = {
    danger:
      'bg-rose-500/10 text-rose-500 dark:text-rose-400 border border-rose-500/20 ring-4 ring-rose-500/5',
    warning:
      'bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20 ring-4 ring-amber-500/5',
    info:
      'bg-sky-500/10 text-sky-500 dark:text-sky-400 border border-sky-500/20 ring-4 ring-sky-500/5',
  }[variant];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/70 dark:bg-slate-950/85 backdrop-blur-md transition-opacity"
        onClick={cancelAction}
      />

      {/* Dialog Card with Spring Scale-in */}
      <div
        className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl z-10 p-6 transition-all duration-200 animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header & Icon */}
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-2xl shrink-0 ${badgeStyles}`}>
            {renderIcon()}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3
              id="confirm-dialog-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100 tracking-tight"
            >
              {options.title}
            </h3>
            <p
              id="confirm-dialog-message"
              className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed whitespace-pre-line"
            >
              {options.message}
            </p>
          </div>
          <button
            onClick={cancelAction}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Formatted Tip Callout Box (if provided) */}
        {options.tip && (
          <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5">
            <Lightbulb className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300/90 leading-relaxed font-medium">
              {options.tip}
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800/80">
          <Button
            ref={cancelBtnRef}
            variant="outline"
            size="sm"
            onClick={cancelAction}
          >
            {options.cancelText || 'Cancel'}
          </Button>
          <Button
            ref={confirmBtnRef}
            variant={variant === 'danger' ? 'danger' : 'primary'}
            size="sm"
            onClick={confirmAction}
          >
            {options.confirmText || (variant === 'danger' ? 'Delete' : 'Confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
};
