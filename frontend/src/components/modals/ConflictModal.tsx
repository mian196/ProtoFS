import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { FileText, Copy, RefreshCw, X } from 'lucide-react';

export interface ConflictModalProps {
  isOpen: boolean;
  existingNode: { name: string; size?: string; date?: string };
  incomingFile: { name: string; size?: string; path?: string };
  remainingCount?: number;
  onResolve: (action: 'replace' | 'rename' | 'skip', applyToAll: boolean) => void;
  onClose: () => void;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({
  isOpen,
  existingNode,
  incomingFile,
  remainingCount = 0,
  onResolve,
  onClose,
}) => {
  const [applyToAll, setApplyToAll] = useState(false);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="File Name Collision"
      subtitle="A file with this name already exists in this folder. How would you like to resolve it?"
      maxWidth="lg"
    >
      <div className="space-y-4">
        {/* Comparison Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-white/5 space-y-1.5">
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">
              <FileText className="w-4 h-4 text-slate-400" />
              <span>Existing Cloud File</span>
            </div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate" title={existingNode.name}>
              {existingNode.name}
            </p>
            <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
              <p>Size: {existingNode.size || 'Unknown'}</p>
              {existingNode.date && <p>Modified: {existingNode.date}</p>}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-500/20 space-y-1.5">
            <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 text-xs font-semibold uppercase tracking-wider">
              <FileText className="w-4 h-4 text-sky-400" />
              <span>Incoming File</span>
            </div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate" title={incomingFile.name}>
              {incomingFile.name}
            </p>
            <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
              <p>Size: {incomingFile.size || 'Unknown'}</p>
              <p className="text-sky-600 dark:text-sky-400">New upload</p>
            </div>
          </div>
        </div>

        {/* Batch Resolution Option */}
        {remainingCount > 0 && (
          <label className="flex items-center gap-2 px-1 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-700 text-sky-500 focus:ring-sky-500/40"
            />
            <span>Apply choice to remaining conflicts in this upload ({remainingCount} remaining)</span>
          </label>
        )}

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onResolve('skip', applyToAll)}
            icon={<X className="w-3.5 h-3.5" />}
          >
            Skip File
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => onResolve('replace', applyToAll)}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Replace Existing File
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onResolve('rename', applyToAll)}
            icon={<Copy className="w-3.5 h-3.5" />}
          >
            Keep Both (Rename)
          </Button>
        </div>
      </div>
    </Modal>
  );
};
