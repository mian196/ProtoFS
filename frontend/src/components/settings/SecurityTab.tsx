import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, KeyRound, Lock, Eye, EyeOff, LifeBuoy } from 'lucide-react';
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

  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [rememberOnDevice, setRememberOnDevice] = useState(true);
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingPassphrase, setSavingPassphrase] = useState(false);
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);

  const fetchVaultStatus = useCallback(async () => {
    try {
      const res = await invokeCommand<VaultStatus>('get_vault_status_command');
      setVaultStatus(res);
      setRememberOnDevice(res.auto_unlock_enabled);
    } catch {
      setVaultStatus({ is_unlocked: true, is_configured: true, auto_unlock_enabled: true, key_slot_count: 1 });
    }
  }, []);

  useEffect(() => { fetchVaultStatus(); }, [fetchVaultStatus]);

  const handleLockVault = async () => {
    try {
      await invokeCommand('lock_vault_command');
      await fetchVaultStatus();
      toast.info('Security Vault Locked', { description: 'Master keys zeroized from memory. Transfers paused.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Failed to Lock Vault', { description: msg });
    }
  };

  const handleSavePassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPass) return;
    if (newPass.length < 8) {
      toast.error('Passphrase Too Short', { description: 'Must be at least 8 characters.' });
      return;
    }
    if (newPass !== confirmPass) {
      toast.error('Passphrase Mismatch', { description: 'Passphrases do not match.' });
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
      toast.success('Vault Passphrase Saved', { description: 'Root master key envelope successfully re-wrapped.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Passphrase Update Failed', { description: msg });
    } finally {
      setSavingPassphrase(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 1. Master Key Status Card */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 dark:bg-sky-500/15 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">Master Key & Vault</h4>
              <Badge variant={vaultStatus.is_unlocked ? 'emerald' : 'amber'} size="sm">
                {vaultStatus.is_unlocked ? 'Vault Unlocked' : 'Vault Locked'}
              </Badge>
              <Badge variant="slate" size="sm">Argon2id • 256-bit Envelope</Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
              {vaultStatus.is_unlocked
                ? 'Root master key active in memory. Cloud files decrypted on-the-fly.'
                : 'Security vault is locked. Master key is required to decrypt cloud files.'}
            </p>
          </div>
        </div>

        {vaultStatus.is_unlocked ? (
          <Button variant="secondary" size="sm" onClick={handleLockVault} icon={<Lock className="w-3.5 h-3.5" />}>
            Lock Vault
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setIsUnlockModalOpen(true)} icon={<KeyRound className="w-3.5 h-3.5" />}>
            Unlock Vault
          </Button>
        )}
      </div>

      {/* 2. Passphrase Form */}
      <form onSubmit={handleSavePassphrase} className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div>
          <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">Vault Passphrase Management</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Changing passphrases re-wraps the root key without re-encrypting existing cloud files.
          </p>
        </div>

        <div className="space-y-2.5">
          {(vaultStatus.is_configured || vaultStatus.has_passphrase) && (
            <Input
              type={showPasswords ? 'text' : 'password'}
              placeholder="Current Passphrase"
              value={currentPass}
              onChange={(e) => setCurrentPass(e.target.value)}
              trailingElement={
                <button type="button" onClick={() => setShowPasswords(!showPasswords)} className="p-1 hover:text-slate-700 dark:hover:text-slate-200">
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

          <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer pt-0.5">
            <input
              type="checkbox"
              checked={rememberOnDevice}
              onChange={(e) => setRememberOnDevice(e.target.checked)}
              className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700"
            />
            <span>Remember on this device using Windows DPAPI auto-unlock</span>
          </label>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800/60">
          <Button type="submit" variant="primary" size="md" disabled={savingPassphrase || !newPass}>
            {savingPassphrase ? 'Deriving Key...' : 'Save Vault Passphrase'}
          </Button>
        </div>
      </form>

      {/* 3. Auto-Lock Policy */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
        <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">Auto-Lock Security Policy</h4>
        <p className="text-xs text-slate-500 dark:text-slate-400">Zeroize memory keys and lock the vault after user inactivity:</p>
        <select
          value={autoLockPolicy}
          onChange={(e) => {
            const val = e.target.value as 'never' | '15m' | '1h' | 'on_close';
            updateSettings({ autoLockPolicy: val });
            toast.success('Auto-Lock Policy Saved');
          }}
          className="w-full bg-slate-50 dark:bg-slate-950/80 text-slate-900 dark:text-slate-100 text-sm rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2 focus:outline-none focus:border-sky-500"
        >
          <option value="15m">15 Minutes of Inactivity [Default]</option>
          <option value="1h">1 Hour of Inactivity</option>
          <option value="on_close">Immediately On Application Close</option>
          <option value="never">Never (Keep unlocked until manual lock)</option>
        </select>
      </div>

      {/* 4. BIP-39 Recovery Phrase */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">Emergency Recovery Phrase (BIP-39)</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              24-word recovery phrase provides full disaster restoration if you lose your passphrase.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setIsRecoveryModalOpen(true)} icon={<KeyRound className="w-3.5 h-3.5" />}>
            Reveal Words
          </Button>
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">Forgot passphrase or setting up a new device?</span>
          <button
            type="button"
            onClick={() => openModal('recoveryPhrase', { recoveryMode: true })}
            className="text-xs text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 font-medium"
          >
            <LifeBuoy className="w-3.5 h-3.5" /> Recover with Emergency Phrase
          </button>
        </div>
      </div>

      <RecoveryPhraseModal isOpen={isRecoveryModalOpen} onClose={() => setIsRecoveryModalOpen(false)} />
      <VaultUnlockModal
        isOpen={isUnlockModalOpen}
        onClose={() => { setIsUnlockModalOpen(false); fetchVaultStatus(); }}
        onSuccess={fetchVaultStatus}
      />
    </div>
  );
};
