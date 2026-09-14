import React, { useState, useEffect } from 'react';
import { Copy, Check, Download, AlertTriangle, KeyRound, RefreshCw, LifeBuoy } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { invokeCommand } from '../../../api/client';
import { toast } from 'sonner';

export interface RecoveryPhraseModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'export' | 'recover';
  onSuccess?: () => void;
}

export const RecoveryPhraseModal: React.FC<RecoveryPhraseModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'export',
  onSuccess,
}) => {
  const [mode, setMode] = useState<'export' | 'recover'>(initialMode);
  const [passphrase, setPassphrase] = useState('');
  const [isRevealed, setIsRevealed] = useState(false);
  const [words, setWords] = useState<string[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clipboardTimeout, setClipboardTimeout] = useState<NodeJS.Timeout | null>(null);

  // Recovery mode state
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [rememberDevice, setRememberDevice] = useState(true);
  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    setMode(initialMode);
    setIsRevealed(false);
    setWords([]);
    setPassphrase('');
    setMnemonicInput('');
    setNewPassphrase('');
    setConfirmPassphrase('');
  }, [initialMode, isOpen]);

  useEffect(() => () => { if (clipboardTimeout) clearTimeout(clipboardTimeout); }, [clipboardTimeout]);

  const handleReveal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase) return;
    setIsVerifying(true);
    try {
      const phrase = await invokeCommand<string>('get_recovery_phrase_command', { currentPassphrase: passphrase });
      setWords(phrase.split(' '));
      setIsRevealed(true);
      setPassphrase('');
    } catch {
      toast.error('Verification Failed', { description: 'Passphrase incorrect.' });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCopyWords = () => {
    navigator.clipboard.writeText(words.join(' '));
    setCopied(true);
    toast.success('Recovery Words Copied', { description: 'Clipboard clears in 60s for security.' });
    setClipboardTimeout(setTimeout(() => {
      navigator.clipboard.writeText('');
      setCopied(false);
      toast.info('Clipboard Cleared', { description: 'Recovery phrase wiped from clipboard.' });
    }, 60000));
  };

  const handleDownloadSheet = () => {
    const text = `PROTOFS EMERGENCY RECOVERY SHEET\nCreated: ${new Date().toISOString()}\n\n24-WORD BIP-39 PHRASE:\n${words.map((w, i) => `${i + 1}. ${w}`).join('\n')}\n`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `protofs_recovery_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Emergency Sheet Downloaded');
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanMnemonic = mnemonicInput.trim().replace(/\s+/g, ' ');
    if (cleanMnemonic.split(' ').length !== 24) {
      toast.error('Invalid Phrase', { description: 'Mnemonic phrase must be exactly 24 words.' });
      return;
    }
    if (newPassphrase.length < 8) {
      toast.error('Passphrase Too Short', { description: 'Minimum 8 characters required.' });
      return;
    }
    if (newPassphrase !== confirmPassphrase) {
      toast.error('Passphrase Mismatch', { description: 'Passwords do not match.' });
      return;
    }

    setIsRecovering(true);
    try {
      await invokeCommand('recover_vault_command', { mnemonic: cleanMnemonic, newPassphrase, remember: rememberDevice });
      toast.success('Vault Recovered', { description: 'Root master key restored. Vault is now unlocked.' });
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Recovery Failed', { description: message });
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'export' ? 'Emergency Recovery Phrase (BIP-39)' : 'Recover Vault from Phrase'}
      subtitle={mode === 'export' ? '24-word recovery phrase provides full emergency disaster recovery' : 'Enter 24-word phrase to regain access and set a new passphrase'}
      maxWidth="md"
    >
      {mode === 'export' ? (
        !isRevealed ? (
          <form onSubmit={handleReveal} className="space-y-4 pt-2">
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-500 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>Re-enter vault passphrase to verify identity before revealing words.</p>
            </div>
            <Input type="password" placeholder="Current Vault Passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoFocus />
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
              <button type="button" onClick={() => setMode('recover')} className="text-xs text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1">
                <LifeBuoy className="w-3.5 h-3.5" /> Switch to Recovery Mode
              </button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                <Button type="submit" variant="primary" size="sm" disabled={isVerifying || !passphrase}>
                  {isVerifying ? 'Verifying...' : 'Reveal Phrase'}
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-3 rounded-2xl bg-slate-950/80 border border-slate-800">
              {words.map((word, idx) => (
                <div key={idx} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-slate-200 flex items-center gap-1.5 group cursor-pointer" title="Hover to reveal">
                  <span className="text-slate-500 text-[10px] w-4">{idx + 1}.</span>
                  <span className="font-semibold text-slate-100 blur-sm group-hover:blur-none select-none transition-all">{word}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button variant="secondary" size="sm" onClick={handleCopyWords} icon={copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}>
                {copied ? 'Copied (Clears in 60s)' : 'Copy Words'}
              </Button>
              <Button variant="primary" size="sm" onClick={handleDownloadSheet} icon={<Download className="w-3.5 h-3.5" />}>Download Sheet (.txt)</Button>
            </div>
          </div>
        )
      ) : (
        <form onSubmit={handleRecover} className="space-y-3.5 pt-2">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">24-Word Recovery Phrase</label>
            <textarea rows={3} value={mnemonicInput} onChange={(e) => setMnemonicInput(e.target.value)} placeholder="apple banana cherry dog elephant..." className="w-full text-xs font-mono p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500" autoFocus />
          </div>
          <Input type="password" placeholder="New Master Passphrase (min 8 chars)" value={newPassphrase} onChange={(e) => setNewPassphrase(e.target.value)} />
          <Input type="password" placeholder="Confirm New Master Passphrase" value={confirmPassphrase} onChange={(e) => setConfirmPassphrase(e.target.value)} />
          <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700" />
            <span>Remember on this device using Windows DPAPI auto-unlock</span>
          </label>
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
            <button type="button" onClick={() => setMode('export')} className="text-xs text-sky-600 dark:text-sky-400 hover:underline">Back to Export Mode</button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={isRecovering}>Cancel</Button>
              <Button type="submit" variant="primary" size="sm" disabled={isRecovering || !mnemonicInput.trim() || !newPassphrase} icon={isRecovering ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}>
                {isRecovering ? 'Restoring...' : 'Recover Vault'}
              </Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
};
