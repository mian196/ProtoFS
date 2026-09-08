import React, { useState, useRef } from 'react';
import {
  Trash2,
  ShieldCheck,
  Check,
  KeyRound,
  Download,
  Upload,
  Lock,
  Eye,
  EyeOff,
  Palette,
  FileArchive,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useThemeStore, type ThemePalette } from '../../stores/useThemeStore';
import { useDriveStore } from '../../stores/useDriveStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { api } from '../../api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'encryption' | 'backup';

// Helpers for client-side AES-GCM password encryption of export bundles
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

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { theme, setTheme } = useThemeStore();
  const { drives, loadDrives } = useDriveStore();
  const { session, accounts, loadAccounts } = useAuthStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  // Encryption Key Configuration State
  const [masterPassphrase, setMasterPassphrase] = useState(
    () => localStorage.getItem('protofs_master_passphrase') || 'protofs-master-zero-knowledge-key'
  );
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  // Backup Export State
  const [exportEncrypt, setExportEncrypt] = useState(true);
  const [exportPassword, setExportPassword] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Backup Import State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPassword, setImportPassword] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const themeOptions: { id: ThemePalette; name: string; desc: string; color: string }[] = [
    {
      id: 'nordic',
      name: 'Nordic Frost',
      desc: 'Deep OLED Navy substrate with Electric Ice Blue accents',
      color: '#38BDF8',
    },
    {
      id: 'cyberpunk',
      name: 'Cyberpunk Neon',
      desc: 'OLED Black with Neon Mint and Aviation Rose',
      color: '#00F5D4',
    },
    {
      id: 'forest',
      name: 'Forest Slate',
      desc: 'Subdued Pine substrate with Emerald accents',
      color: '#10B981',
    },
    {
      id: 'obsidian',
      name: 'Obsidian Amber',
      desc: 'Warm Obsidian substrate with Golden Amber accents',
      color: '#F59E0B',
    },
  ];

  const handleClearWalCache = async () => {
    setClearingCache(true);
    try {
      await api.clearVirtualDriveCache('personal');
      setClearingCache(false);
      setCacheCleared(true);
      setTimeout(() => setCacheCleared(false), 2500);
    } catch {
      setClearingCache(false);
    }
  };

  const handleSaveMasterKey = () => {
    localStorage.setItem('protofs_master_passphrase', masterPassphrase);
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2500);
  };

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      // Gather full settings, drives, manifests, sync pairs, and accounts
      const backupData = {
        version: '0.3.0',
        exported_at: new Date().toISOString(),
        theme,
        master_key_configured: !!localStorage.getItem('protofs_master_passphrase'),
        master_passphrase: masterPassphrase,
        drives,
        accounts,
        session,
        sync_pairs: await api.getSyncPairs('personal'),
        local_settings: {
          shell_send_to: localStorage.getItem('protofs_shell_send_to'),
          shell_context_menu: localStorage.getItem('protofs_shell_context_menu'),
          workmanager_config: localStorage.getItem('protofs_workmanager_config'),
        },
      };

      let outputContent: string;
      let fileExtension = 'json';

      if (exportEncrypt && exportPassword.trim()) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(exportPassword.trim(), salt);
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

      // Download file to user
      const blob = new Blob([outputContent], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `protofs_backup_${new Date().toISOString().slice(0, 10)}.${fileExtension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setIsExporting(false);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch {
      setIsExporting(false);
    }
  };

  const handleImportBackup = async () => {
    if (!importFile) return;
    setIsImporting(true);
    setImportError(null);

    try {
      const text = await importFile.text();
      let parsed: any = JSON.parse(text);

      // Check if encrypted
      if (parsed.encrypted && parsed.ciphertext) {
        if (!importPassword) {
          throw new Error('This backup is encrypted with AES-256. Please enter the backup decryption password.');
        }
        const salt = hexToBytes(parsed.salt);
        const iv = hexToBytes(parsed.iv);
        const ciphertext = hexToBytes(parsed.ciphertext);
        const key = await deriveKey(importPassword, salt);

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

      // Restore configuration
      if (parsed.theme) setTheme(parsed.theme);
      if (parsed.master_passphrase) {
        localStorage.setItem('protofs_master_passphrase', parsed.master_passphrase);
        setMasterPassphrase(parsed.master_passphrase);
      }
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

      setIsImporting(false);
      setImportSuccess(true);
      setImportFile(null);
      setImportPassword('');
      setTimeout(() => setImportSuccess(false), 3500);
    } catch (err: any) {
      setIsImporting(false);
      setImportError(err.message || 'Failed to import backup');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Settings & Vault Preferences"
      subtitle="Configure themes, Zero-Knowledge encryption keys, and full system backup import/export"
      maxWidth="lg"
    >
      <div className="space-y-5">
        {/* Navigation Tabs */}
        <div className="flex rounded-xl p-1 bg-slate-950 border border-white/5">
          <button
            onClick={() => setActiveTab('general')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'general' ? 'bg-sky-500/20 text-sky-400 font-semibold' : 'text-slate-400'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>General & Themes</span>
          </button>
          <button
            onClick={() => setActiveTab('encryption')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'encryption' ? 'bg-sky-500/20 text-sky-400 font-semibold' : 'text-slate-400'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Encryption Keys</span>
          </button>
          <button
            onClick={() => setActiveTab('backup')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'backup' ? 'bg-sky-500/20 text-sky-400 font-semibold' : 'text-slate-400'
            }`}
          >
            <FileArchive className="w-3.5 h-3.5" />
            <span>Backup Export / Import</span>
          </button>
        </div>

        {/* Tab 1: General & Appearance */}
        {activeTab === 'general' && (
          <div className="space-y-5">
            {/* Color Palette Selector */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-200">
                UI Color Palette (WCAG AA High-Contrast)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {themeOptions.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                      theme === t.id
                        ? 'bg-white/[0.06] border-sky-400/50 shadow-md'
                        : 'bg-slate-950/60 border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div
                      className="w-5 h-5 rounded-full shrink-0 mt-0.5 border border-white/20 flex items-center justify-center"
                      style={{ backgroundColor: t.color }}
                    >
                      {theme === t.id && <Check className="w-3 h-3 text-slate-950 stroke-[3]" />}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-200">{t.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{t.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* SQLite Cache Maintenance */}
            <div className="p-4 rounded-2xl bg-slate-950/70 border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-200">Local SQLite WAL Cache</p>
                  <p className="text-[11px] text-slate-400">
                    Clears unpinned chunk files and resets the local memory-mapped database cache.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleClearWalCache}
                  disabled={clearingCache}
                  icon={
                    cacheCleared ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )
                  }
                >
                  {cacheCleared ? 'Cleared' : clearingCache ? 'Cleaning...' : 'Clear Cache'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Zero-Knowledge Encryption Keys */}
        {activeTab === 'encryption' && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-950/70 border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-200">Master Key & Passphrase</p>
                  <p className="text-[11px] text-slate-400">
                    Used to derive Argon2id / AES-256-GCM symmetric encryption keys for all channel file chunks.
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveMasterKey}
                  icon={keySaved ? <Check className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                >
                  {keySaved ? 'Saved!' : 'Save Key'}
                </Button>
              </div>

              <div className="relative mt-2">
                <Input
                  type={showPassphrase ? 'text' : 'password'}
                  value={masterPassphrase}
                  onChange={(e) => setMasterPassphrase(e.target.value)}
                  placeholder="Enter strong master passphrase"
                  className="pr-10 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPassphrase(!showPassphrase)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-white"
                >
                  {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Cryptographic Spec Card */}
            <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Zero-Knowledge Hardened Cryptography</span>
              </div>
              <ul className="text-[11px] text-emerald-200/90 font-mono space-y-1 list-disc list-inside">
                <li>Key Derivation: Argon2id (Memory: 64MB, Iterations: 3, Parallelism: 4)</li>
                <li>Stream Cipher: AES-256-GCM with 64 KB authenticated chunks</li>
                <li>Integrity Verification: SHA-256 Merkle root verification</li>
                <li>Plaintext master keys are never stored on Telegram or transmitted over networks.</li>
              </ul>
            </div>
          </div>
        )}

        {/* Tab 3: Full Backup Export & Import */}
        {activeTab === 'backup' && (
          <div className="space-y-4">
            {/* Export Card */}
            <div className="p-4 rounded-2xl bg-slate-950/70 border border-white/5 space-y-3">
              <div>
                <p className="text-xs font-semibold text-slate-200">Export Full System Backup</p>
                <p className="text-[11px] text-slate-400">
                  Export all connected drive manifests, sync pairs, Telegram account metadata, and encryption configurations to a portable file.
                </p>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={exportEncrypt}
                    onChange={(e) => setExportEncrypt(e.target.checked)}
                    className="rounded bg-slate-900 border-white/20 text-sky-500 focus:ring-0"
                  />
                  <span>Encrypt export file with AES-256-GCM password (Recommended)</span>
                </label>

                {exportEncrypt && (
                  <Input
                    type="password"
                    placeholder="Enter backup encryption password..."
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    className="text-xs font-mono"
                  />
                )}
              </div>

              <div className="flex justify-end pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleExportBackup}
                  disabled={isExporting || (exportEncrypt && !exportPassword.trim())}
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
                  {exportSuccess ? 'Backup Downloaded!' : isExporting ? 'Exporting...' : 'Export Backup (.pfsbak)'}
                </Button>
              </div>
            </div>

            {/* Import Card */}
            <div className="p-4 rounded-2xl bg-slate-950/70 border border-white/5 space-y-3">
              <div>
                <p className="text-xs font-semibold text-slate-200">Import & Restore Backup</p>
                <p className="text-[11px] text-slate-400">
                  Restore your drives, channels, sync pairs, and master keys from a `.pfsbak` or `.json` file.
                </p>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                accept=".pfsbak,.json"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setImportFile(e.target.files[0]);
                    setImportError(null);
                  }
                }}
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
                  <span className="text-xs font-mono text-sky-400 truncate max-w-[200px]">
                    {importFile.name}
                  </span>
                )}
              </div>

              {importFile && (
                <div className="space-y-2 pt-1">
                  <Input
                    type="password"
                    placeholder="Enter backup decryption password (if encrypted)..."
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    className="text-xs font-mono"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleImportBackup}
                    disabled={isImporting}
                    icon={
                      isImporting ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )
                    }
                  >
                    {isImporting ? 'Restoring...' : 'Restore Backup'}
                  </Button>
                </div>
              )}

              {importError && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              {importSuccess && (
                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Backup successfully restored! Drives and configurations updated.</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-white/5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
};

