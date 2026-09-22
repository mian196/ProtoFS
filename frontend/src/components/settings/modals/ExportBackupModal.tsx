import React, { useState } from 'react';
import { Download, Lock, Check, RefreshCw } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { useThemeStore } from '../../../stores/useThemeStore';
import { useDriveStore } from '../../../stores/useDriveStore';
import { useAuthStore } from '../../../stores/useAuthStore';
import { api } from '../../../api';
import { toast } from 'sonner';
import { getAppVersion } from '../../../utils/version';

export interface ExportBackupModalProps {
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const ExportBackupModal: React.FC<ExportBackupModalProps> = ({ isOpen, onClose }) => {
  const { theme } = useThemeStore();
  const { drives } = useDriveStore();
  const { accounts, session } = useAuthStore();

  const [encrypt, setEncrypt] = useState(true);
  const [password, setPassword] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (encrypt && !password.trim()) {
      toast.error('Password Required', { description: 'Please enter a backup encryption password.' });
      return;
    }

    setIsExporting(true);
    try {
      const backupData = {
        version: getAppVersion(),
        exported_at: new Date().toISOString(),
        theme,
        drives,
        accounts,
        session,
        sync_pairs: await api.getSyncPairs('personal').catch(() => []),
        local_settings: {
          shell_send_to: localStorage.getItem('protofs_shell_send_to'),
          shell_context_menu: localStorage.getItem('protofs_shell_context_menu'),
          workmanager_config: localStorage.getItem('protofs_workmanager_config'),
        },
      };

      let outputContent: string;
      let fileExtension = 'json';

      if (encrypt && password.trim()) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(password.trim(), salt);
        const encodedData = new TextEncoder().encode(JSON.stringify(backupData));
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: iv as any },
          key,
          encodedData
        );

        const encryptedBundle = {
          protofs_backup_version: '1.0',
          encrypted: true,
          algorithm: 'AES-256-GCM',
          kdf: 'PBKDF2-SHA256-100K',
          salt: bytesToHex(salt),
          iv: bytesToHex(iv),
          ciphertext: bytesToHex(new Uint8Array(ciphertext)),
        };
        outputContent = JSON.stringify(encryptedBundle, null, 2);
        fileExtension = 'pfsbak';
      } else {
        outputContent = JSON.stringify(backupData, null, 2);
      }

      const blob = new Blob([outputContent], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `protofs_backup_${new Date().toISOString().slice(0, 10)}.${fileExtension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportSuccess(true);
      toast.success('Backup Exported', {
        description: `Saved backup as .${fileExtension} successfully.`,
      });
      setTimeout(() => {
        setExportSuccess(false);
        onClose();
      }, 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Export Failed', { description: message });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export System Backup"
      subtitle="Export connected drives, manifests, sync pairs, and client configurations"
      maxWidth="md"
    >
      <form onSubmit={handleExport} className="space-y-4 pt-2">
        <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={encrypt}
            onChange={(e) => setEncrypt(e.target.checked)}
            className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700"
          />
          <span className="font-medium">Encrypt with AES-256-GCM password (Recommended)</span>
        </label>

        {encrypt && (
          <Input
            type="password"
            placeholder="Enter backup encryption password..."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="text-xs font-mono"
            icon={<Lock className="w-4 h-4 text-slate-400" />}
            autoFocus
          />
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isExporting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isExporting || (encrypt && !password.trim())}
            icon={
              exportSuccess ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : isExporting ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )
            }
          >
            {exportSuccess ? 'Exported!' : isExporting ? 'Exporting...' : 'Export Backup'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
