import React, { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { api } from '../../../api';
import { toast } from 'sonner';

export interface ClearCacheConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  driveId?: string;
}

export const ClearCacheConfirmModal: React.FC<ClearCacheConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  driveId,
}) => {
  const [isPurging, setIsPurging] = useState(false);

  const handlePurge = async () => {
    setIsPurging(true);
    try {
      if (onConfirm) {
        onConfirm();
      } else {
        const res = await api.purgeLocalCache(driveId);
        const freedMb = (res.freed_bytes / (1024 * 1024)).toFixed(1);
        toast.success('Cache Purged', {
          description: `Successfully wiped ${freedMb} MB of local streaming chunks.`,
        });
      }
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Purge Failed', { description: message });
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Purge Local Cache"
      subtitle="Clear local streaming chunks, temporary downloads, and offline write buffers."
      maxWidth="md"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-600 dark:text-amber-400">Safe Cache Cleanup</p>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Files stored in your Telegram cloud channels are completely safe and will not be touched.
              Any active in-progress downloads or uploads may be stopped.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPurging}>
            Keep Cache
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handlePurge}
            disabled={isPurging}
            icon={<Trash2 className="w-3.5 h-3.5" />}
          >
            {isPurging ? 'Purging...' : 'Purge Local Cache'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
