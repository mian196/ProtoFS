import React, { useState, useEffect, useRef } from 'react';
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
  Sun,
  Moon,
  FileArchive,
  RefreshCw,
  AlertCircle,
  HardDrive,
  FolderSync,
  Camera,
  Layers,
  Sparkles,
  ExternalLink,
  Power,
  Clock,
  CheckCircle2,
  Globe,
  Copy,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useThemeStore } from '../../stores/useThemeStore';
import { useDriveStore } from '../../stores/useDriveStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useNativeStore } from '../../stores/useNativeStore';
import { api } from '../../api';
import type {
  ShellIntegrationStatus,
  CameraBackupConfig,
  WorkManagerSyncStatus,
  UpdateInfo,
} from '../../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab =
  | 'appearance'
  | 'shell'
  | 'mount'
  | 'camera'
  | 'background'
  | 'encryption'
  | 'backup'
  | 'storage'
  | 'updates';

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
  const { drives, activeDrive, loadDrives } = useDriveStore();
  const { session, accounts, loadAccounts } = useAuthStore();
  const {
    virtualDrive,
    webdavServer,
    mountVirtualDrive,
    unmountVirtualDrive,
    configureWebDav,
    loadNativeStatus,
  } = useNativeStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');

  // Shell Integration state
  const [shellStatus, setShellStatus] = useState<ShellIntegrationStatus | null>(null);
  const [shellSaving, setShellSaving] = useState(false);

  // Virtual drive state
  const [selectedDriveLetter, setSelectedDriveLetter] = useState('X');
  const [onDemandStreaming, setOnDemandStreaming] = useState(true);

  // WebDAV Server Configuration state
  const [webdavEnabled, setWebdavEnabled] = useState(true);
  const [webdavPort, setWebdavPort] = useState(28491);
  const [webdavAutoMount, setWebdavAutoMount] = useState(false);
  const [webdavSaving, setWebdavSaving] = useState(false);
  const [copiedWebdavUrl, setCopiedWebdavUrl] = useState(false);

  useEffect(() => {
    if (webdavServer) {
      setWebdavEnabled(webdavServer.is_running);
      setWebdavPort(webdavServer.port || 28491);
      setWebdavAutoMount(webdavServer.auto_mount || false);
    }
  }, [webdavServer]);

  // Camera backup state
  const [cameraConfig, setCameraConfig] = useState<CameraBackupConfig | null>(null);
  const [cameraSaving, setCameraSaving] = useState(false);

  // WorkManager Background Sync state
  const [workManagerStatus, setWorkManagerStatus] = useState<WorkManagerSyncStatus | null>(null);
  const [triggeringSync, setTriggeringSync] = useState(false);

  // Storage usage breakdown
  const [storageMetrics, setStorageMetrics] = useState<any>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  // Update check
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

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

  // Load backend states when modal opens
  useEffect(() => {
    if (isOpen) {
      loadNativeStatus();
      api.getShellIntegrationStatus().then(setShellStatus).catch(() => {});
      api.getWorkManagerSyncStatus().then(setWorkManagerStatus).catch(() => {});
      if (activeDrive) {
        api.getCameraBackupConfig(activeDrive.id).then(setCameraConfig).catch(() => {});
        api.getStorageUsage(activeDrive.id).then(setStorageMetrics).catch(() => {});
      }
    }
  }, [isOpen, activeDrive, loadNativeStatus]);

  const handleToggleShellIntegration = async (type: 'sendTo' | 'contextMenu') => {
    if (!shellStatus) return;
    setShellSaving(true);
    const newSendTo = type === 'sendTo' ? !shellStatus.send_to_enabled : shellStatus.send_to_enabled;
    const newContextMenu = type === 'contextMenu' ? !shellStatus.context_menu_enabled : shellStatus.context_menu_enabled;
    try {
      const updated = await api.setShellIntegration(newSendTo, newContextMenu);
      setShellStatus(updated);
    } finally {
      setShellSaving(false);
    }
  };

  const handleSaveCameraConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDrive || !cameraConfig) return;
    setCameraSaving(true);
    try {
      await api.configureCameraBackup(activeDrive.id, {
        localPath: cameraConfig.local_path,
        remoteFolderId: 'root',
        wifiOnly: cameraConfig.wifi_only,
        chargingOnly: cameraConfig.charging_only,
        includeVideos: cameraConfig.include_videos,
        originalQuality: cameraConfig.original_quality,
      });
      const updated = await api.getCameraBackupConfig(activeDrive.id);
      setCameraConfig(updated);
    } finally {
      setCameraSaving(false);
    }
  };

  const handleTriggerBackgroundSync = async () => {
    setTriggeringSync(true);
    try {
      await api.triggerImmediateBackgroundSync();
      const updated = await api.getWorkManagerSyncStatus();
      setWorkManagerStatus(updated);
    } finally {
      setTriggeringSync(false);
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const info = await api.checkForUpdates();
      setUpdateInfo(info);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleClearWalCache = async () => {
    setClearingCache(true);
    try {
      await api.clearVirtualDriveCache(activeDrive?.id || 'personal');
      setClearingCache(false);
      setCacheCleared(true);
      if (activeDrive) {
        const metrics = await api.getStorageUsage(activeDrive.id);
        setStorageMetrics(metrics);
      }
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

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'appearance', label: 'Theme & Style', icon: <Sun className="w-3.5 h-3.5" /> },
    { id: 'shell', label: 'Windows Shell', icon: <ExternalLink className="w-3.5 h-3.5" /> },
    { id: 'mount', label: 'Virtual Drive', icon: <HardDrive className="w-3.5 h-3.5" /> },
    { id: 'camera', label: 'Camera Roll', icon: <Camera className="w-3.5 h-3.5" /> },
    { id: 'background', label: 'Background Sync', icon: <FolderSync className="w-3.5 h-3.5" /> },
    { id: 'encryption', label: 'Zero-Knowledge', icon: <KeyRound className="w-3.5 h-3.5" /> },
    { id: 'backup', label: 'Backup Center', icon: <FileArchive className="w-3.5 h-3.5" /> },
    { id: 'storage', label: 'Storage & Cache', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'updates', label: 'Updates', icon: <Sparkles className="w-3.5 h-3.5" /> },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="System Settings & Backend Control"
      subtitle="Configure appearance, Windows shell shortcuts, native virtual drives, and encryption"
      maxWidth="3xl"
    >
      <div className="flex flex-col md:flex-row gap-6 min-h-[460px]">
        {/* Left Vertical Tab Navigation */}
        <div className="w-full md:w-48 shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 pr-0 md:pr-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all text-left whitespace-nowrap ${
                activeTab === t.id
                  ? 'bg-sky-500/10 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400 font-semibold border border-sky-500/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Right Content Area */}
        <div className="flex-1 min-w-0 max-h-[460px] overflow-y-auto pr-1 space-y-4 no-scrollbar">
          {/* 1. Theme & Appearance */}
          {activeTab === 'appearance' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Theme & Display Mode
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Switch between shadcn light and dark mode with high-contrast accessibility.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setTheme('light')}
                  className={`p-4 rounded-2xl border text-left transition-all flex items-start gap-3.5 ${
                    theme === 'light'
                      ? 'bg-sky-50 border-sky-500 shadow-sm'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 shrink-0">
                    <Sun className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-900">Light Mode</p>
                      {theme === 'light' && <Check className="w-4 h-4 text-sky-600" />}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Clean white substrate with slate borders and optimal daylight legibility.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setTheme('dark')}
                  className={`p-4 rounded-2xl border text-left transition-all flex items-start gap-3.5 ${
                    theme === 'dark'
                      ? 'bg-slate-900 border-sky-500 shadow-sm'
                      : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 shrink-0">
                    <Moon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-white">Dark Mode</p>
                      {theme === 'dark' && <Check className="w-4 h-4 text-sky-400" />}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Deep OLED slate substrate with electric sky accents for reduced eye strain.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* 2. Windows Shell Integration */}
          {activeTab === 'shell' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Windows Explorer Shell Integration
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Add ProtoFS shortcuts directly into the Windows right-click context menu and SendTo folder.
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-200">
                      "Send to ProtoFS" Shortcut
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Enables one-click encrypted uploading from the Windows SendTo menu.
                    </p>
                  </div>
                  <Button
                    variant={shellStatus?.send_to_enabled ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => handleToggleShellIntegration('sendTo')}
                    disabled={shellSaving}
                  >
                    {shellStatus?.send_to_enabled ? 'Enabled' : 'Disabled'}
                  </Button>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-200">
                      Windows Explorer Context Menu
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Integrates "Upload to ProtoFS" in directory and file context menus.
                    </p>
                  </div>
                  <Button
                    variant={shellStatus?.context_menu_enabled ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => handleToggleShellIntegration('contextMenu')}
                    disabled={shellSaving}
                  >
                    {shellStatus?.context_menu_enabled ? 'Enabled' : 'Disabled'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 3. WebDAV & Virtual Drive Mount */}
          {activeTab === 'mount' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  WebDAV Server & Native OS Mount
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Access your Zero-Knowledge Telegram cloud drives natively in Windows Explorer, macOS Finder, or Linux file managers.
                </p>
              </div>

              {/* WebDAV Server Settings Card */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`p-2 rounded-xl ${webdavServer?.is_running ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-500/10 text-slate-400'}`}>
                      <Globe className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-200 flex items-center gap-2">
                        Embedded WebDAV Server
                        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${
                          webdavServer?.is_running
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-500/15 text-slate-500 border border-slate-500/30'
                        }`}>
                          {webdavServer?.is_running ? `Active on Port ${webdavServer.port}` : 'Disabled'}
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        RFC 4918 standard server with live AES-256-GCM chunk streaming & byte-range seeking.
                      </p>
                    </div>
                  </div>

                  <Button
                    variant={webdavEnabled ? 'danger' : 'primary'}
                    size="sm"
                    disabled={webdavSaving}
                    onClick={async () => {
                      setWebdavSaving(true);
                      try {
                        const newEnabled = !webdavEnabled;
                        setWebdavEnabled(newEnabled);
                        await configureWebDav(newEnabled, webdavPort, webdavAutoMount);
                      } catch (e) {
                        console.error('Failed to toggle WebDAV:', e);
                      } finally {
                        setWebdavSaving(false);
                      }
                    }}
                  >
                    {webdavEnabled ? 'Stop Server' : 'Start Server'}
                  </Button>
                </div>

                {/* WebDAV URL & Port Row */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Local WebDAV Endpoint
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        readOnly
                        value={webdavServer?.url || `http://127.0.0.1:${webdavPort}/`}
                        className="w-full bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-200 rounded-xl px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 focus:outline-none select-all"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 px-2.5 py-1.5"
                        onClick={() => {
                          const url = webdavServer?.url || `http://127.0.0.1:${webdavPort}/`;
                          navigator.clipboard.writeText(url);
                          setCopiedWebdavUrl(true);
                          setTimeout(() => setCopiedWebdavUrl(false), 2000);
                        }}
                      >
                        {copiedWebdavUrl ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Server Port
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        value={webdavPort}
                        onChange={(e) => setWebdavPort(parseInt(e.target.value) || 28491)}
                        className="text-xs font-mono py-1.5"
                        min={1024}
                        max={65535}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={webdavSaving}
                        onClick={async () => {
                          setWebdavSaving(true);
                          try {
                            await configureWebDav(webdavEnabled, webdavPort, webdavAutoMount);
                          } catch (e) {
                            console.error('Failed to update WebDAV port:', e);
                          } finally {
                            setWebdavSaving(false);
                          }
                        }}
                      >
                        Apply
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="webdavAutoMount"
                    checked={webdavAutoMount}
                    onChange={async (e) => {
                      const checked = e.target.checked;
                      setWebdavAutoMount(checked);
                      try {
                        await configureWebDav(webdavEnabled, webdavPort, checked);
                      } catch (err) {
                        console.error('Failed to update auto mount:', err);
                      }
                    }}
                    className="rounded text-sky-500 focus:ring-sky-500"
                  />
                  <label htmlFor="webdavAutoMount" className="text-xs text-slate-700 dark:text-slate-300">
                    Auto-mount active cloud drive on application launch
                  </label>
                </div>
              </div>

              {/* OS Drive Mount Controls Card */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Power
                      className={`w-4 h-4 ${
                        virtualDrive?.is_mounted ? 'text-emerald-500' : 'text-slate-400'
                      }`}
                    />
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-200">
                        {virtualDrive?.is_mounted
                          ? `Mounted on ${virtualDrive.drive_letter}:\\`
                          : 'Drive Currently Unmounted'}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {virtualDrive?.driver_mode || 'WebDAV Zero-Install Streaming Server'}
                      </p>
                    </div>
                  </div>

                  <Button
                    variant={virtualDrive?.is_mounted ? 'danger' : 'primary'}
                    size="sm"
                    onClick={async () => {
                      if (!activeDrive) return;
                      if (virtualDrive?.is_mounted) {
                        await unmountVirtualDrive(activeDrive.id);
                      } else {
                        await mountVirtualDrive(activeDrive.id, selectedDriveLetter, onDemandStreaming);
                      }
                    }}
                  >
                    {virtualDrive?.is_mounted ? 'Unmount Drive' : 'Mount Drive'}
                  </Button>
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Preferred Drive Letter
                    </label>
                    <select
                      value={selectedDriveLetter}
                      onChange={(e) => setSelectedDriveLetter(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 rounded-xl px-3 py-2 border border-slate-200 dark:border-slate-800 focus:outline-none"
                    >
                      {['P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'].map((letter) => (
                        <option key={letter} value={letter}>
                          {letter}: (Windows Drive)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2 pt-5">
                    <input
                      type="checkbox"
                      id="onDemand"
                      checked={onDemandStreaming}
                      onChange={(e) => setOnDemandStreaming(e.target.checked)}
                      className="rounded text-sky-500"
                    />
                    <label htmlFor="onDemand" className="text-xs text-slate-700 dark:text-slate-300">
                      On-Demand 64KB Chunk Streaming
                    </label>
                  </div>
                </div>

                <p className="text-[11px] text-slate-400 dark:text-slate-500 italic pt-1">
                  💡 Zero local disk duplication: Files stream directly through encrypted MTProto chunks and instantly disconnect when ProtoFS is closed.
                </p>
              </div>
            </div>
          )}

          {/* 4. Camera Roll Auto-Backup */}
          {activeTab === 'camera' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Camera Roll & Photos Continuous Sync
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Automatically watch local pictures and camera folder to encrypt and backup new media.
                </p>
              </div>

              {cameraConfig && (
                <form onSubmit={handleSaveCameraConfig} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Local Photos Folder Path
                    </label>
                    <Input
                      value={cameraConfig.local_path}
                      onChange={(e) =>
                        setCameraConfig({ ...cameraConfig, local_path: e.target.value })
                      }
                      className="text-xs font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 text-xs text-slate-700 dark:text-slate-300">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={cameraConfig.wifi_only}
                        onChange={(e) =>
                          setCameraConfig({ ...cameraConfig, wifi_only: e.target.checked })
                        }
                      />
                      <span>Wi-Fi Only</span>
                    </label>

                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={cameraConfig.include_videos}
                        onChange={(e) =>
                          setCameraConfig({ ...cameraConfig, include_videos: e.target.checked })
                        }
                      />
                      <span>Include Videos</span>
                    </label>

                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={cameraConfig.original_quality}
                        onChange={(e) =>
                          setCameraConfig({ ...cameraConfig, original_quality: e.target.checked })
                        }
                      />
                      <span>Lossless Original Quality</span>
                    </label>

                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={cameraConfig.charging_only}
                        onChange={(e) =>
                          setCameraConfig({ ...cameraConfig, charging_only: e.target.checked })
                        }
                      />
                      <span>Charging Only</span>
                    </label>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button variant="primary" size="sm" type="submit" disabled={cameraSaving}>
                      {cameraSaving ? 'Saving...' : 'Save Camera Sync'}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* 5. WorkManager Background Sync */}
          {activeTab === 'background' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Background Sync & WorkManager
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Periodic synchronization engine for unattended automated file syncing.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-500" />
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-200">
                        Periodic Background Sync
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Next scheduled run:{' '}
                        {workManagerStatus?.next_scheduled_run
                          ? new Date(workManagerStatus.next_scheduled_run).toLocaleTimeString()
                          : 'Idle'}
                      </p>
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleTriggerBackgroundSync}
                    disabled={triggeringSync}
                    icon={<RefreshCw className={`w-3.5 h-3.5 ${triggeringSync ? 'animate-spin' : ''}`} />}
                  >
                    Sync Now
                  </Button>
                </div>

                {workManagerStatus?.recent_history && workManagerStatus.recent_history.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
                    <p className="text-[11px] font-mono uppercase text-slate-400">Recent Sync Runs</p>
                    {workManagerStatus.recent_history.slice(0, 3).map((hist) => (
                      <div
                        key={hist.id}
                        className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-mono flex items-center justify-between"
                      >
                        <span className="text-slate-700 dark:text-slate-300">{hist.message}</span>
                        <span className="text-emerald-500 shrink-0">Success</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 6. Zero-Knowledge Encryption Keys */}
          {activeTab === 'encryption' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Zero-Knowledge Master Key & Passphrase
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Master encryption key used for Argon2id key derivation and AES-256-GCM chunks.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-200">
                    Master Passphrase
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSaveMasterKey}
                    icon={keySaved ? <Check className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  >
                    {keySaved ? 'Saved!' : 'Save Key'}
                  </Button>
                </div>

                <div className="relative">
                  <Input
                    type={showPassphrase ? 'text' : 'password'}
                    value={masterPassphrase}
                    onChange={(e) => setMasterPassphrase(e.target.value)}
                    placeholder="Enter master passphrase"
                    className="pr-10 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                  >
                    {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>
                  ProtoFS uses Argon2id key derivation (64MB memory cost, 3 iterations) with authenticated AES-256-GCM 64 KB chunks. Keys never leave your machine in plaintext.
                </span>
              </div>
            </div>
          )}

          {/* 7. Full Backup Export & Import */}
          {activeTab === 'backup' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Full System Backup & Portability Center
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Export or import all connected drives, manifests, sync pairs, and configurations.
                </p>
              </div>

              {/* Export */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-200">
                  Export System Backup
                </p>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={exportEncrypt}
                      onChange={(e) => setExportEncrypt(e.target.checked)}
                      className="rounded text-sky-500"
                    />
                    <span>Encrypt with AES-256-GCM password (Recommended)</span>
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

                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleExportBackup}
                    disabled={isExporting || (exportEncrypt && !exportPassword.trim())}
                    icon={
                      exportSuccess ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : isExporting ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )
                    }
                  >
                    {exportSuccess ? 'Downloaded!' : isExporting ? 'Exporting...' : 'Export (.pfsbak)'}
                  </Button>
                </div>
              </div>

              {/* Import */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-200">
                  Import & Restore Backup
                </p>

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
                    <span className="text-xs font-mono text-sky-600 dark:text-sky-400 truncate">
                      {importFile.name}
                    </span>
                  )}
                </div>

                {importFile && (
                  <div className="space-y-2 pt-1">
                    <Input
                      type="password"
                      placeholder="Decryption password (if encrypted)..."
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
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 dark:text-rose-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{importError}</span>
                  </div>
                )}

                {importSuccess && (
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 dark:text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Backup restored successfully!</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 8. Storage & SQLite WAL Cache */}
          {activeTab === 'storage' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Storage Telemetry & SQLite Cache
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Inspect memory-mapped WAL cache and breakdown of channel storage assets.
                </p>
              </div>

              {storageMetrics && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                    <p className="text-[10px] uppercase font-mono text-slate-400">Total Files</p>
                    <p className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                      {storageMetrics.total_files}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                    <p className="text-[10px] uppercase font-mono text-slate-400">Folders</p>
                    <p className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                      {storageMetrics.total_folders}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                    <p className="text-[10px] uppercase font-mono text-slate-400">Cache Size</p>
                    <p className="text-base font-bold text-sky-600 dark:text-sky-400 mt-0.5">
                      {(storageMetrics.local_cache_bytes / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  </div>
                </div>
              )}

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-200">
                    Local SQLite WAL Cache Eviction
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Flush unpinned decrypted chunks and clean up temporary storage blocks.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleClearWalCache}
                  disabled={clearingCache}
                  icon={
                    cacheCleared ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )
                  }
                >
                  {cacheCleared ? 'Cleared' : clearingCache ? 'Cleaning...' : 'Clear Cache'}
                </Button>
              </div>
            </div>
          )}

          {/* 9. Updates & Releases */}
          {activeTab === 'updates' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Version & Release Highlights
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Check for latest releases with SHA256 cryptographic signature validation.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-200">
                      ProtoFS v0.3.0 (Production Channel)
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                      Cryptographic signature verified
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleCheckUpdates}
                    disabled={checkingUpdate}
                    icon={<RefreshCw className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />}
                  >
                    Check Now
                  </Button>
                </div>

                {updateInfo && (
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs space-y-2">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {updateInfo.update_available ? 'New Version Available!' : 'Up to date!'}
                    </p>
                    <pre className="text-[11px] font-mono text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
                      {updateInfo.release_notes}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-4 mt-4 border-t border-slate-200 dark:border-slate-800">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
};


