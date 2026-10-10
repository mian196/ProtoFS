import React, { useState } from 'react';
import { Minimize2, Power, Check, AlertCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { api } from '../../api';
import { isTauri } from '../../api/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toast } from 'sonner';

interface CloseAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CloseAppModal: React.FC<CloseAppModalProps> = ({ isOpen, onClose }) => {
  const [selectedAction, setSelectedAction] = useState<'minimize' | 'exit'>('minimize');
  const [rememberChoice, setRememberChoice] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const { updateSettings } = useSettingsStore();

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      if (rememberChoice) {
        updateSettings({
          closeAction: selectedAction,
          closeToTray: selectedAction === 'minimize',
        });
        toast.info(
          selectedAction === 'minimize'
            ? 'ProtoFS will now minimize when closed.'
            : 'ProtoFS will now exit when closed.',
          {
            description: 'You can change this preference anytime in Settings > General.',
            duration: 4000,
          }
        );
      }

      onClose();

      if (selectedAction === 'minimize') {
        if (isTauri()) {
          await api.minimizeWindow();
        }
      } else {
        if (isTauri()) {
          await api.exitApp();
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Action Failed', { description: message });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Close ProtoFS"
      subtitle="Choose how the application should handle closing the window."
      maxWidth="md"
    >
      <div className="space-y-4">
        {/* Action Selection Cards */}
        <div className="grid grid-cols-1 gap-3">
          {/* Minimize Option */}
          <button
            type="button"
            onClick={() => setSelectedAction('minimize')}
            className={`flex items-start gap-3.5 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
              selectedAction === 'minimize'
                ? 'border-sky-500 bg-sky-500/10 text-slate-900 dark:text-slate-100 ring-1 ring-sky-500/30'
                : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/40'
            }`}
          >
            <div
              className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                selectedAction === 'minimize'
                  ? 'bg-sky-500/20 text-sky-500 dark:text-sky-400'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
              }`}
            >
              <Minimize2 className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Minimize to System Tray</span>
                {selectedAction === 'minimize' && (
                  <span className="p-0.5 rounded-full bg-sky-500 text-white dark:text-slate-950 shrink-0">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-normal">
                Keep ProtoFS running in the background. Ongoing file uploads, downloads, and background sync will continue uninterrupted.
              </p>
            </div>
          </button>

          {/* Exit Option */}
          <button
            type="button"
            onClick={() => setSelectedAction('exit')}
            className={`flex items-start gap-3.5 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
              selectedAction === 'exit'
                ? 'border-rose-500 bg-rose-500/10 text-slate-900 dark:text-slate-100 ring-1 ring-rose-500/30'
                : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/40'
            }`}
          >
            <div
              className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                selectedAction === 'exit'
                  ? 'bg-rose-500/20 text-rose-500 dark:text-rose-400'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
              }`}
            >
              <Power className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Exit Application</span>
                {selectedAction === 'exit' && (
                  <span className="p-0.5 rounded-full bg-rose-500 text-white dark:text-slate-950 shrink-0">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-normal">
                Completely terminate ProtoFS. Active transfers and virtual drive mounts will be cleanly disconnected.
              </p>
            </div>
          </button>
        </div>

        {/* Remember Choice Checkbox */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 cursor-pointer"
            />
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                Remember my choice
              </span>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                Don&apos;t ask again. You can change this anytime in Settings &gt; General &gt; Window Close Behavior.
              </p>
            </div>
          </label>
        </div>

        {/* Informative Note */}
        {selectedAction === 'exit' && (
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Exiting will pause any ongoing background file transfers.</span>
          </div>
        )}

        {/* Footer Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={onClose}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            variant={selectedAction === 'exit' ? 'danger' : 'primary'}
            size="sm"
            type="button"
            onClick={handleConfirm}
            disabled={isProcessing}
          >
            {selectedAction === 'minimize' ? 'Minimize to Tray' : 'Exit ProtoFS'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
