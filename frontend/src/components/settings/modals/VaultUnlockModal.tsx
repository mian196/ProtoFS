import React, { useState } from 'react';
import { KeyRound, Lock, Eye, EyeOff } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { invokeCommand } from '../../../api/client';
import { toast } from 'sonner';

export interface VaultUnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const VaultUnlockModal: React.FC<VaultUnlockModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase) return;
    setUnlocking(true);
    try {
      await invokeCommand('unlock_vault_command', { passphrase });
      toast.success('Vault Unlocked', {
        description: 'Master key active in memory. Encrypted file transfers resumed.',
      });
      setPassphrase('');
      onSuccess?.();
      onClose();
    } catch {
      toast.error('Unlock Failed', { description: 'Incorrect passphrase entered.' });
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Unlock Security Vault"
      subtitle="Enter your master passphrase to unlock zero-knowledge encryption keys"
      maxWidth="sm"
    >
      <form onSubmit={handleUnlock} className="space-y-4 pt-2">
        <Input
          type={showPassphrase ? 'text' : 'password'}
          placeholder="Vault Passphrase"
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

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
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
      </form>
    </Modal>
  );
};
