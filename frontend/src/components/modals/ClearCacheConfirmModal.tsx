import React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AlertTriangle, Trash2 } from 'lucide-react';

export interface ClearCacheConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

export const ClearCacheConfirmModal: React.FC<ClearCacheConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isLoading = false,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Purge Local Cache"
      subtitle="Clear local streaming chunks, temporary downloads, and offline write buffers."
      maxWidth="md"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-300">Safe Cache Cleanup</p>
            <p className="text-slate-300 leading-relaxed">
              Files stored in your Telegram cloud channels are completely safe and will not be touched.
              Any active in-progress transfers will be stopped.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isLoading}>
            Keep Cache
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onConfirm}
            disabled={isLoading}
            icon={<Trash2 className="w-3.5 h-3.5" />}
          >
            {isLoading ? 'Purging...' : 'Purge Local Cache'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
