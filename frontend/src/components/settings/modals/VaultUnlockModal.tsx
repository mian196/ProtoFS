import React, { useState } from 'react';
import { KeyRound, Lock, Eye, EyeOff, LifeBuoy } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { invokeCommand } from '../../../api/client';
import { useModalStore } from '../../../stores/useModalStore';
import { toast } from 'sonner';

export interface VaultUnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const VaultUnlockModal: React.FC<VaultUnlockModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [passphrase, setPassphrase] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase) return;
    setUnlocking(true);
    try {
      await invokeCommand('unlock_vault_command', { passphrase, remember });
      toast.success('Vault Unlocked', {
        description: 'Master key is active in memory. Cloud transfers resumed.',
      });
      setPassphrase('');
      onSuccess?.();
      onClose();
    } catch {
      toast.error('Unlock Failed', { description: 'Incorrect master passphrase entered.' });
    } finally {
      setUnlocking(false);
    }
  };

  const handleOpenRecovery = () => {
    onClose();
    useModalStore.getState().openModal('recoveryPhrase', { recoveryMode: true });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Unlock Security Vault"
      subtitle="Enter your master passphrase to unlock master encryption keys"
      maxWidth="md"
    >
      <form onSubmit={handleUnlock} className="space-y-4 pt-2">
        <Input
          type={showPassphrase ? 'text' : 'password'}
          placeholder="Enter Master Passphrase"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          icon={<KeyRound className="w-4 h-4 text-slate-400" />}
          trailingElement={
            <button
              type="button"
              onClick={() => setShowPassphrase(!showPassphrase)}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          }
        />

        <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700"
          />
          <span>Remember on this device using Windows DPAPI auto-unlock</span>
        </label>

        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={handleOpenRecovery}
            className="text-xs text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 font-medium"
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            Forgot Passphrase? Recover with Emergency Phrase
          </button>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={unlocking}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={unlocking || !passphrase}
              icon={<Lock className="w-3.5 h-3.5" />}
            >
              {unlocking ? 'Unlocking...' : 'Unlock Vault'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
