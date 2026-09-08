import React, { useState, useEffect } from 'react';
import { HardDrive, Loader2, Check } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { api } from '../../api';
import { useDriveStore } from '../../stores/useDriveStore';
import { useVfsStore } from '../../stores/useVfsStore';

interface DriveManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DriveManagerModal: React.FC<DriveManagerModalProps> = ({ isOpen, onClose }) => {
  const { drives, activeDrive, setActiveDrive, loadDrives, channels, loadChannels } =
    useDriveStore();
  const { loadDirectory } = useVfsStore();

  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [driveName, setDriveName] = useState('');
  const [channelId, setChannelId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadChannels();
    }
  }, [isOpen, loadChannels]);

  const handleSelectDrive = async (d: any) => {
    setActiveDrive(d);
    await loadDirectory(d.id, 'root');
    onClose();
  };

  const handleCreateDrive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!driveName.trim() || !channelId) return;

    setLoading(true);
    setError(null);
    try {
      const newDrive = await api.createDrive(driveName.trim(), Number(channelId));
      await loadDrives();
      setActiveDrive(newDrive);
      await loadDirectory(newDrive.id, 'root');
      setLoading(false);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create drive');
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Drive & Channel Manager"
      subtitle="Mount MTProto broadcast channels as Zero-Knowledge virtual drives"
      maxWidth="md"
    >
      <div className="space-y-4">
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
            Connect Channel / Drive
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
          <form onSubmit={handleCreateDrive} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Drive Display Name
              </label>
              <Input
                placeholder="e.g. Personal Vault, Projects, Media"
                value={driveName}
                onChange={(e) => setDriveName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Telegram Channel ID
              </label>
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="w-full bg-slate-950 text-xs text-slate-200 rounded-xl px-3 py-2.5 border border-white/10 focus:outline-none focus:border-sky-400"
                required
              >
                <option value="">-- Select Owned Channel or Enter Manual --</option>
                {channels.map((ch) => (
                  <option key={ch.channel_id} value={ch.channel_id}>
                    {ch.title} ({ch.channel_id})
                  </option>
                ))}
              </select>
            </div>

            {error && <div className="text-xs font-mono text-rose-400">{error}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" type="button" onClick={() => setMode('list')}>
                Back
              </Button>
              <Button variant="primary" size="sm" type="submit" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Mount Channel'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
