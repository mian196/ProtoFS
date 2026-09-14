import React, { useState, useEffect } from 'react';
import { Copy, Check, Download, AlertTriangle } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { invokeCommand } from '../../../api/client';
import { toast } from 'sonner';

export interface RecoveryPhraseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RecoveryPhraseModal: React.FC<RecoveryPhraseModalProps> = ({ isOpen, onClose }) => {
  const [passphrase, setPassphrase] = useState('');
  const [isRevealed, setIsRevealed] = useState(false);
  const [words, setWords] = useState<string[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clipboardTimeout, setClipboardTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (clipboardTimeout) clearTimeout(clipboardTimeout);
    };
  }, [clipboardTimeout]);

  const handleReveal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase) return;
    setIsVerifying(true);
    try {
      const phrase = await invokeCommand<string>('get_recovery_phrase_command', {
        currentPassphrase: passphrase,
      });
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
    const fullText = words.join(' ');
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    toast.success('Recovery Words Copied', {
      description: 'Clipboard will automatically clear in 60 seconds for security.',
    });

    const timeout = setTimeout(() => {
      navigator.clipboard.writeText('');
      setCopied(false);
      toast.info('Clipboard Cleared', { description: 'Recovery phrase wiped from clipboard memory.' });
    }, 60000);

    setClipboardTimeout(timeout);
  };

  const handleDownloadSheet = () => {
    const content = `=================================================================\n\
PROTOFS EMERGENCY ROOT KEY RECOVERY SHEET\n\
Created: ${new Date().toISOString()}\n\
=================================================================\n\n\
WARNING: KEEP THIS SHEET OFFLINE IN A SAFE, PHYSICAL LOCATION.\n\
NEVER SHARE THESE WORDS OVER EMAIL OR MESSAGING SERVICES.\n\n\
YOUR 24-WORD BIP-39 RECOVERY PHRASE:\n\
${words.map((w, i) => `${i + 1}. ${w}`).join('\n')}\n\n\
RESTORATION INSTRUCTIONS:\n\
1. In ProtoFS, open Settings -> Security & Keys.\n\
2. Click "Recover with Emergency Phrase".\n\
3. Enter these 24 words in exact order and create a new master passphrase.\n\
=================================================================\n`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `protofs_emergency_recovery_sheet_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Emergency Sheet Downloaded');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="BIP-39 Emergency Recovery Phrase"
      subtitle="Your 24-word recovery phrase provides full zero-knowledge key recovery"
      maxWidth="md"
    >
      {!isRevealed ? (
        <form onSubmit={handleReveal} className="space-y-4 pt-2">
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-500 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>Re-enter your vault passphrase to verify ownership before revealing recovery words.</p>
          </div>

          <Input
            type="password"
            placeholder="Vault Passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoFocus
          />

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={isVerifying || !passphrase}>
              {isVerifying ? 'Verifying...' : 'Reveal Phrase'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-3 rounded-2xl bg-slate-950/80 border border-slate-800">
            {words.map((word, idx) => (
              <div
                key={idx}
                className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-slate-200 flex items-center gap-1.5 cursor-pointer group"
                title="Hover to reveal word"
              >
                <span className="text-slate-500 text-[10px] w-4">{idx + 1}.</span>
                <span className="font-semibold text-slate-100 blur-sm group-hover:blur-none select-none transition-all">
                  {word}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCopyWords}
              icon={copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            >
              {copied ? 'Copied (Clears in 60s)' : 'Copy Words'}
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={handleDownloadSheet}
              icon={<Download className="w-3.5 h-3.5" />}
            >
              Download Sheet (.txt)
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
