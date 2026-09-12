import React, { useState, useEffect } from 'react';
import { HardDrive, Loader2, Check, Sparkles, Link2, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { api } from '../../api';
import { useDriveStore } from '../../stores/useDriveStore';
import { useVfsStore } from '../../stores/useVfsStore';
import { useAuthStore } from '../../stores/useAuthStore';

interface DriveManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DriveManagerModal: React.FC<DriveManagerModalProps> = ({ isOpen, onClose }) => {
  const { drives, activeDrive, setActiveDrive, loadDrives, channels, loadChannels } =
    useDriveStore();
  const { loadDirectory } = useVfsStore();
  const { connectionStatus, checkConnection } = useAuthStore();

  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [driveName, setDriveName] = useState('');
  const [channelType, setChannelType] = useState<'auto_create' | 'existing'>('auto_create');
  const [channelId, setChannelId] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadDrives();
      loadChannels();
      checkConnection();
      setError(null);
    }
  }, [isOpen, loadDrives, loadChannels, checkConnection]);

  const handleRetryConnection = async () => {
    setIsRetrying(true);
    await checkConnection();
    await loadChannels();
    setIsRetrying(false);
  };

  const handleSelectDrive = async (drive: any) => {
    setActiveDrive(drive);
    await loadDirectory(drive.id, 'root');
    onClose();
  };

  const handleCreateDrive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!driveName.trim()) return;

    if (!isOnline) {
      setError('Telegram MTProto is unreachable. Please connect to a VPN and retry.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const selectedChannelId =
        channelType === 'auto_create' ? 0 : parseInt(channelId, 10);

      const newDrive = await api.createDrive(driveName.trim(), selectedChannelId);
      await loadDrives();
      setActiveDrive(newDrive);
      await loadDirectory(newDrive.id, 'root');
      setDriveName('');
      setLoading(false);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create drive on Telegram');
      setLoading(false);
    }
  };

  const isOnline = connectionStatus === 'connected';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Drive & Channel Manager"
      subtitle="Mount MTProto broadcast channels as Zero-Knowledge virtual drives"
      maxWidth="md"
    >
      <div className="space-y-4">
        {/* Offline / VPN Alert */}
        {!isOnline && (
          <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 flex items-start justify-between gap-3 text-xs text-rose-300">
            <div className="flex items-start gap-2.5 min-w-0">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-200">Telegram MTProto Offline / Blocked</p>
                <p className="text-[11px] text-rose-300/85 mt-0.5 leading-relaxed">
                  Telegram servers cannot be reached. If Telegram is restricted in your region, please connect to a VPN and click Retry.
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={handleRetryConnection}
              disabled={isRetrying}
              className="shrink-0 text-[11px] py-1 px-2.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border-rose-500/30"
              icon={<RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />}
            >
              {isRetrying ? 'Testing...' : 'Retry'}
            </Button>
          </div>
        )}

        <div className="flex rounded-xl p-1 bg-slate-950 border border-white/5">
          <button
            onClick={() => setMode('list')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mode === 'list' ? 'bg-sky-500/20 text-sky-400 font-semibold' : 'text-slate-400'
            }`}
          >
            Connected Drives ({drives.length})
          </button>
          <button
            onClick={() => setMode('create')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mode === 'create' ? 'bg-sky-500/20 text-sky-400 font-semibold' : 'text-slate-400'
            }`}
          >
            + Create / Link Drive
          </button>
        </div>

        {mode === 'list' ? (
          <div className="space-y-2 max-h-64 overflow-y-auto no-scrollbar">
            {drives.map((d) => (
              <div
                key={d.id}
                onClick={() => handleSelectDrive(d)}
                className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                  activeDrive?.id === d.id
                    ? 'bg-sky-500/15 border-sky-500/40 text-white'
                    : 'bg-slate-950/60 border-white/5 hover:bg-white/5 text-slate-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                    <HardDrive className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold">{d.name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">
                      ID: {d.id} • Channel: {d.channel_id}
                    </p>
                  </div>
                </div>

                {activeDrive?.id === d.id && (
                  <span className="p-1 rounded-full bg-sky-500/20 text-sky-400">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <form onSubmit={handleCreateDrive} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Drive Display Name
              </label>
              <Input
                placeholder="e.g. My Vault, Documents, Media Archive"
                value={driveName}
                onChange={(e) => setDriveName(e.target.value)}
                required
              />
            </div>

            {/* Channel Provisioning Mode Selector */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-300">
                Telegram Channel Target
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setChannelType('auto_create')}
                  className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                    channelType === 'auto_create'
                      ? 'bg-sky-500/15 border-sky-400/50 text-white'
                      : 'bg-slate-950/60 border-white/5 text-slate-400 hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-sky-300">
                    <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                    <span>Auto-Create Channel</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    Automatically create a new private Telegram channel for this drive
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setChannelType('existing')}
                  className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                    channelType === 'existing'
                      ? 'bg-sky-500/15 border-sky-400/50 text-white'
                      : 'bg-slate-950/60 border-white/5 text-slate-400 hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-purple-300">
                    <Link2 className="w-3.5 h-3.5 text-purple-400" />
                    <span>Link Existing Channel</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    Connect an existing Telegram channel you own or admin
                  </p>
                </button>
              </div>
            </div>

            {channelType === 'auto_create' ? (
              <div className="p-3 rounded-xl bg-sky-500/5 border border-sky-500/15 flex items-start gap-2.5 text-[11px] text-sky-200">
                <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <span>
                  ProtoFS will securely create a dedicated private channel via MTProto with Zero-Knowledge encryption headers.
                </span>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Select Existing Channel
                </label>
                <select
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="w-full bg-slate-950 text-xs text-slate-200 rounded-xl px-3 py-2.5 border border-white/10 focus:outline-none focus:border-sky-400"
                  required
                >
                  <option value="">-- Select Owned Channel --</option>
                  {channels.map((ch) => (
                    <option key={ch.channel_id} value={ch.channel_id}>
                      {ch.title} ({ch.channel_id})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {error && <div className="text-xs font-mono text-rose-400">{error}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" type="button" onClick={() => setMode('list')}>
                Back
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="submit"
                disabled={loading || !isOnline}
                title={!isOnline ? 'Telegram MTProto is unreachable. Connect to VPN to create drives.' : undefined}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : !isOnline ? (
                  'Offline (VPN Required)'
                ) : channelType === 'auto_create' ? (
                  'Create Telegram Drive'
                ) : (
                  'Link Channel'
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};

