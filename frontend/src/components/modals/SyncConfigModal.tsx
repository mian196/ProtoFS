import React, { useState } from 'react';
import { Plus, Trash2, Play } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { api } from '../../api';
import { useNativeStore } from '../../stores/useNativeStore';
import { useDriveStore } from '../../stores/useDriveStore';
import { useVfsStore } from '../../stores/useVfsStore';

interface SyncConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SyncConfigModal: React.FC<SyncConfigModalProps> = ({ isOpen, onClose }) => {
  const { syncPairs, loadSyncPairs } = useNativeStore();
  const { activeDrive } = useDriveStore();
  const { currentParentId } = useVfsStore();

  const [localPath, setLocalPath] = useState('');
  const [syncMode, setSyncMode] = useState<'one-way' | 'two-way'>('two-way');
  const [creating, setCreating] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localPath.trim() || !activeDrive) return;

    setCreating(true);
    try {
      await api.addSyncPair({
        local_path: localPath.trim(),
        remote_folder_id: currentParentId,
        drive_id: activeDrive.id,
        sync_mode: syncMode,
      });
      await loadSyncPairs(activeDrive.id);
      setLocalPath('');
      setCreating(false);
    } catch {
      setCreating(false);
    }
  };

  const handleTriggerSync = async (id: string) => {
    setSyncingId(id);
    try {
      await api.triggerSync(id);
      if (activeDrive) await loadSyncPairs(activeDrive.id);
      setSyncingId(null);
    } catch {
      setSyncingId(null);
    }
  };

  const handleRemove = async (id: string) => {
    if (!activeDrive) return;
    try {
      await api.removeSyncPair(id, activeDrive.id);
      await loadSyncPairs(activeDrive.id);
    } catch (e) {
      console.warn(e);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Bidirectional Folder Sync Watcher"
      subtitle="Monitors OS file system events via native notify watcher and queues encrypted uploads"
      maxWidth="lg"
    >
      <div className="space-y-4">
        {/* Register Form */}
        <form onSubmit={handleRegister} className="p-3.5 rounded-2xl bg-slate-950/70 border border-white/5 space-y-3">
          <p className="text-xs font-semibold text-slate-200">Register New Folder Pair</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="sm:col-span-2">
              <Input
                placeholder="Local Path (e.g. C:\Users\User\Documents)"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                required
              />
            </div>
            <div>
              <select
                value={syncMode}
                onChange={(e) => setSyncMode(e.target.value as any)}
                className="w-full bg-slate-900 text-xs text-slate-200 rounded-xl px-3 py-2.5 border border-white/10"
              >
                <option value="two-way">Two-Way Sync</option>
                <option value="one-way">One-Way (Upload Only)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={creating || !localPath.trim()}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              Add Watcher Pair
            </Button>
          </div>
        </form>

        {/* Existing Pairs */}
        <div className="space-y-2 max-h-56 overflow-y-auto no-scrollbar">
          <p className="text-[11px] font-mono uppercase text-slate-400">
            Active Watchers ({syncPairs.length})
          </p>

          {syncPairs.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500">
              No active folder sync watchers configured.
            </div>
          ) : (
            syncPairs.map((pair) => (
              <div
                key={pair.id}
                className="p-3 rounded-2xl bg-slate-950/60 border border-white/5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-xs font-mono text-slate-200 truncate">{pair.local_path}</p>
                  <p className="text-[10px] text-slate-400 font-mono">
                    Mode: {pair.sync_mode} • Status: {pair.status} • Files: {pair.file_count}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleTriggerSync(pair.id)}
                    disabled={syncingId === pair.id}
                    icon={<Play className="w-3 h-3" />}
                  >
                    Sync Now
                  </Button>
                  <button
                    onClick={() => handleRemove(pair.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
};
