import React, { useState, useRef } from 'react';
import { Upload, Check, RefreshCw, AlertCircle, FileArchive } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { useThemeStore } from '../../../stores/useThemeStore';
import { useDriveStore } from '../../../stores/useDriveStore';
import { useAuthStore } from '../../../stores/useAuthStore';
import { toast } from 'sonner';

export interface ImportBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export const ImportBackupModal: React.FC<ImportBackupModalProps> = ({ isOpen, onClose }) => {
  const { setTheme } = useThemeStore();
  const { loadDrives } = useDriveStore();
  const { loadAccounts } = useAuthStore();

  const [importFile, setImportFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImportFile(file);
      setError(null);
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        setIsEncrypted(!!parsed.encrypted && !!parsed.ciphertext);
      } catch {
        setIsEncrypted(file.name.endsWith('.pfsbak'));
      }
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) return;

    setIsImporting(true);
    setError(null);

    try {
      const text = await importFile.text();
      let parsed = JSON.parse(text);

      if (parsed.encrypted && parsed.ciphertext) {
        if (!password) {
          throw new Error('This backup is encrypted. Please enter the decryption password.');
        }
        const salt = hexToBytes(parsed.salt);
        const iv = hexToBytes(parsed.iv);
        const ciphertext = hexToBytes(parsed.ciphertext);
        const key = await deriveKey(password, salt);

        try {
          const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv as any },
            key,
            ciphertext as any
          );
          const decodedText = new TextDecoder().decode(decrypted);
          parsed = JSON.parse(decodedText);
        } catch {
          throw new Error('Decryption failed! Incorrect password or corrupted backup file.');
        }
      }

      if (parsed.theme) setTheme(parsed.theme);
      if (parsed.drives && Array.isArray(parsed.drives)) {
        localStorage.setItem('protofs_drives', JSON.stringify(parsed.drives));
        await loadDrives();
      }
      if (parsed.accounts && Array.isArray(parsed.accounts)) {
        localStorage.setItem('protofs_accounts', JSON.stringify(parsed.accounts));
        await loadAccounts();
      }
      if (parsed.sync_pairs && Array.isArray(parsed.sync_pairs)) {
        localStorage.setItem('protofs_sync_pairs_personal', JSON.stringify(parsed.sync_pairs));
      }

      setSuccess(true);
      toast.success('Backup Restored', {
        description: 'Drives, accounts, and sync configurations restored successfully.',
      });
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error('Import Failed', { description: message });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Import & Restore Backup"
      subtitle="Restore connected drives, accounts, and sync configurations from backup file"
      maxWidth="md"
    >
      <form onSubmit={handleImport} className="space-y-4 pt-2">
        <input
          type="file"
          ref={fileInputRef}
          accept=".pfsbak,.json"
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            icon={<Upload className="w-3.5 h-3.5" />}
          >
            {importFile ? 'Change File' : 'Select Backup File'}
          </Button>

          {importFile && (
            <div className="flex items-center gap-1.5 text-xs font-mono text-sky-600 dark:text-sky-400 truncate">
              <FileArchive className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{importFile.name}</span>
            </div>
          )}
        </div>

        {isEncrypted && (
          <Input
            type="password"
            placeholder="Decryption password..."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="text-xs font-mono"
            autoFocus
          />
        )}

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isImporting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isImporting || !importFile || (isEncrypted && !password)}
            icon={
              success ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : isImporting ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )
            }
          >
            {success ? 'Restored!' : isImporting ? 'Restoring...' : 'Restore Backup'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
