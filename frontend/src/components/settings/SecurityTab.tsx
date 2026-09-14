import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  LifeBuoy,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useModalStore } from '../../stores/useModalStore';
import { invokeCommand } from '../../api/client';
import { VaultUnlockModal } from './modals/VaultUnlockModal';
import { RecoveryPhraseModal } from './modals/RecoveryPhraseModal';
import { toast } from 'sonner';

export interface VaultStatus {
  is_unlocked: boolean;
  is_configured: boolean;
  has_passphrase?: boolean;
  auto_unlock_enabled: boolean;
  key_slot_count: number;
  auto_lock_policy?: string;
}

export const SecurityTab: React.FC = () => {
  const { autoLockPolicy, updateSettings } = useSettingsStore();
  const { openModal } = useModalStore();

  const [vaultStatus, setVaultStatus] = useState<VaultStatus>({
    is_unlocked: false,
    is_configured: false,
    auto_unlock_enabled: false,
    key_slot_count: 1,
  });

  // Passphrase form state
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [rememberOnDevice, setRememberOnDevice] = useState(true);
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingPassphrase, setSavingPassphrase] = useState(false);

  // Auxiliary modals
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);

  const fetchVaultStatus = async () => {
    try {
      const res = await invokeCommand<VaultStatus>('get_vault_status_command');
      setVaultStatus(res);
      setRememberOnDevice(res.auto_unlock_enabled);
    } catch {
      setVaultStatus({
        is_unlocked: true,
        is_configured: true,
        auto_unlock_enabled: true,
        key_slot_count: 1,
      });
    }
  };

  useEffect(() => {
    fetchVaultStatus();
  }, []);

  const handleLockVault = async () => {
    try {
      await invokeCommand('lock_vault_command');
      await fetchVaultStatus();
      toast.info('Security Vault Locked', {
        description: 'Master keys zeroized from memory. Encrypted transfers are paused.',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Failed to Lock Vault', { description: message });
    }
  };

  const handleSavePassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPass) return;
    if (newPass.length < 8) {
      toast.error('Passphrase Too Short', { description: 'Passphrase must be at least 8 characters.' });
      return;
    }
    if (newPass !== confirmPass) {
      toast.error('Passphrase Mismatch', {
        description: 'New passphrase and confirmation do not match.',
      });
      return;
    }

    setSavingPassphrase(true);
    try {
      await invokeCommand('set_vault_passphrase_command', {
        currentPassphrase: currentPass || null,
        newPassphrase: newPass,
        remember: rememberOnDevice,
      });
      setCurrentPass('');
      setNewPass('');
      setConfirmPass('');
      await fetchVaultStatus();
      toast.success('Vault Passphrase Saved', {
        description: 'Root master key envelope successfully re-wrapped with new passphrase.',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Passphrase Update Failed', { description: message });
    } finally {
      setSavingPassphrase(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Master Key Status Card (UX-03, D-12) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 dark:bg-sky-500/15 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                Master Key & Security Vault
              </h4>
              {vaultStatus.is_unlocked ? (
                <Badge variant="emerald" size="sm">
                  Vault Unlocked
                </Badge>
              ) : (
                <Badge variant="amber" size="sm">
                  Vault Locked
                </Badge>
              )}
              <Badge variant="slate" size="sm">
                Argon2id • 256-bit Envelope
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
              {vaultStatus.is_unlocked
                ? 'Root master key is active in memory. Cloud files are decrypted on-the-fly.'
                : 'Security vault is locked. Master key is required to decrypt and upload cloud files.'}
            </p>
          </div>
        </div>

        {vaultStatus.is_unlocked ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleLockVault}
            icon={<Lock className="w-3.5 h-3.5" />}
          >
            Lock Vault Now
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsUnlockModalOpen(true)}
            icon={<KeyRound className="w-3.5 h-3.5" />}
          >
            Unlock Vault
          </Button>
        )}
      </div>

      {/* 2. Passphrase Management Form (D-11, D-09) */}
      <form
        onSubmit={handleSavePassphrase}
        className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
      >
        <div>
          <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
            Vault Passphrase Management
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-normal">
            Your passphrase encrypts the 256-bit root master key. Changing passphrases re-wraps the root key without needing to re-encrypt existing cloud files.
          </p>
        </div>

        <div className="space-y-3">
          {(vaultStatus.is_configured || vaultStatus.has_passphrase) && (
            <Input
              type={showPasswords ? 'text' : 'password'}
              placeholder="Current Passphrase"
              value={currentPass}
              onChange={(e) => setCurrentPass(e.target.value)}
              trailingElement={
                <button
                  type="button"
                  onClick={() => setShowPasswords(!showPasswords)}
                  className="p-1 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />
          )}

          <Input
            type={showPasswords ? 'text' : 'password'}
            placeholder="New Master Passphrase (minimum 8 characters)"
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
          />

          <Input
            type={showPasswords ? 'text' : 'password'}
            placeholder="Confirm New Passphrase"
            value={confirmPass}
            onChange={(e) => setConfirmPass(e.target.value)}
          />

          <label className="flex items-center gap-3 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={rememberOnDevice}
              onChange={(e) => setRememberOnDevice(e.target.checked)}
              className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700"
            />
            <span className="text-xs text-slate-700 dark:text-slate-300">
              Remember on this device using secure hardware storage (Windows DPAPI) for seamless auto-unlock
            </span>
          </label>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800/60">
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={savingPassphrase || !newPass}
          >
            {savingPassphrase ? 'Deriving Key...' : 'Save Vault Passphrase'}
          </Button>
        </div>
      </form>

      {/* 3. Auto-Lock Policy (D-12) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
          Auto-Lock Security Policy
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
          Automatically zeroize memory keys and lock the vault after a period of user inactivity:
        </p>
        <select
          value={autoLockPolicy}
          onChange={(e) => {
            const val = e.target.value as 'never' | '15m' | '1h' | 'on_close';
            updateSettings({ autoLockPolicy: val });
            toast.success('Auto-Lock Policy Saved');
          }}
          className="w-full bg-slate-50 dark:bg-slate-950/80 text-slate-900 dark:text-slate-100 text-sm rounded-xl border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 focus:outline-none focus:border-sky-500"
        >
          <option value="15m">15 Minutes of Inactivity [Default]</option>
          <option value="1h">1 Hour of Inactivity</option>
          <option value="on_close">Immediately On Application Close</option>
          <option value="never">Never (Keep unlocked until manual lock)</option>
        </select>
      </div>

      {/* 4. BIP-39 Emergency Recovery Phrase (D-13, D-14, D-15) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
              Emergency Recovery Phrase (BIP-39)
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-normal">
              Your 24-word recovery phrase provides full disaster restoration if you lose or forget your passphrase.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsRecoveryModalOpen(true)}
            icon={<KeyRound className="w-3.5 h-3.5" />}
          >
            Reveal Recovery Phrase
          </Button>
        </div>

        {/* 5. Emergency Recovery Flow Link (D-16) */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Forgot your passphrase or setting up a new device?
          </span>
          <button
            type="button"
            onClick={() => openModal('recoveryPhrase')}
            className="text-xs text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 font-medium"
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            Recover with Emergency Phrase
          </button>
        </div>
      </div>

      {/* Sub-Modals */}
      <RecoveryPhraseModal
        isOpen={isRecoveryModalOpen}
        onClose={() => setIsRecoveryModalOpen(false)}
      />
      <VaultUnlockModal
        isOpen={isUnlockModalOpen}
        onClose={() => {
          setIsUnlockModalOpen(false);
          fetchVaultStatus();
        }}
        onSuccess={fetchVaultStatus}
      />
    </div>
  );
};
