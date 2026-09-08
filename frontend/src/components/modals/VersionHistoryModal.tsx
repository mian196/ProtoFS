import React, { useState, useEffect } from 'react';
import { RotateCcw, Lock, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { api } from '../../api';
import { useVfsStore } from '../../stores/useVfsStore';
import type { FileNode, FileVersion } from '../../types';

interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetFile?: FileNode;
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  isOpen,
  onClose,
  targetFile,
}) => {
  const [history, setHistory] = useState<FileVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const { currentParentId, loadDirectory } = useVfsStore();

  useEffect(() => {
    if (isOpen && targetFile) {
      setLoading(true);
      api
        .getFileVersions(targetFile.drive_id, targetFile.id)
        .then((hist: FileVersion[]) => {
          setHistory(hist);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [isOpen, targetFile]);

  const handleRollback = async (version: number) => {
    if (!targetFile) return;
    setRollingBack(version);
    try {
      await api.restoreFileVersion(targetFile.drive_id, targetFile.id, version);
      await loadDirectory(targetFile.drive_id, currentParentId);
      setRollingBack(null);
      onClose();
    } catch {
      setRollingBack(null);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="File Version History"
      subtitle={`Snapshot history for ${targetFile?.name}`}
      maxWidth="md"
    >
      {loading ? (
        <div className="py-8 flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
          <span className="text-xs text-slate-400 font-mono">Loading snapshots...</span>
        </div>
      ) : history.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400">
          No previous versions recorded for this file.
        </div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto no-scrollbar">
          {history.map((ver) => (
            <div
              key={ver.version}
              className="p-3 rounded-2xl bg-slate-950/70 border border-white/5 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-mono font-bold">
                  v{ver.version}
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-200">
                    {formatBytes(ver.size_bytes)}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                    <span>{ver.created_at?.slice(0, 19).replace('T', ' ')}</span>
                    {ver.is_encrypted && (
                      <span className="flex items-center gap-0.5 text-emerald-400">
                        <Lock className="w-2.5 h-2.5" />
                        <span>AES</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleRollback(ver.version)}
                disabled={rollingBack !== null}
                icon={
                  rollingBack === ver.version ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5" />
                  )
                }
              >
                Rollback
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end pt-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
};
