import React, { useState, useEffect } from 'react';
import { FolderInput, Loader2, Folder } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { api } from '../../api';
import { useVfsStore } from '../../stores/useVfsStore';
import { useDriveStore } from '../../stores/useDriveStore';
import type { FileNode, FolderNode } from '../../types';

interface MoveModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetNode?: FileNode | FolderNode;
}

export const MoveModal: React.FC<MoveModalProps> = ({ isOpen, onClose, targetNode }) => {
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [selectedParentId, setSelectedParentId] = useState<string>('root');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { activeDrive } = useDriveStore();
  const { currentParentId, loadDirectory, selectedIds, clearSelection } = useVfsStore();

  useEffect(() => {
    if (isOpen && activeDrive) {
      setLoading(true);
      api
        .loadDrive(activeDrive.id, 0)
        .then((res: { folders: FolderNode[]; files: FileNode[] }) => {
          setFolders(res.folders.filter((f) => !f.trashed));
          setLoading(false);
        })
        .catch((e: any) => {
          setError(e.message || 'Failed to list folders');
          setLoading(false);
        });
    }
  }, [isOpen, activeDrive]);

  const isBatchMove =
    targetNode && selectedIds.size > 1 && selectedIds.has(targetNode.id);

  const handleMove = async () => {
    if (!activeDrive || !targetNode) return;
    setSubmitting(true);
    setError(null);
    try {
      const idsToMove = isBatchMove ? Array.from(selectedIds) : [targetNode.id];
      for (const id of idsToMove) {
        if (id !== selectedParentId) {
          await api.moveNode(activeDrive.id, id, selectedParentId);
        }
      }
      clearSelection();
      await loadDirectory(activeDrive.id, currentParentId);
      setSubmitting(false);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to move item');
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isBatchMove ? `Move ${selectedIds.size} Items` : 'Move Item'}
      subtitle="Moves item to target directory via O(1) Parent ID pointer update"
      maxWidth="md"
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-600 dark:text-slate-300">
          Select destination folder for{' '}
          <span className="font-semibold text-slate-900 dark:text-white">
            {isBatchMove ? `${selectedIds.size} selected items` : targetNode?.name}
          </span>
          :
        </p>

        <div className="max-h-60 overflow-y-auto space-y-1 p-2 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-white/5 no-scrollbar">
          <button
            type="button"
            onClick={() => setSelectedParentId('root')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
              selectedParentId === 'root'
                ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 font-semibold border border-sky-500/30'
                : 'text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/5'
            }`}
          >
            <Folder className="w-4 h-4 text-sky-500 dark:text-sky-400" />
            <span>Root (My Drive)</span>
          </button>

          {loading ? (
            <div className="p-4 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
            </div>
          ) : (
            folders
              .filter((f) => f.id !== targetNode?.id)
              .map((folder) => (
                <button
                  type="button"
                  key={folder.id}
                  onClick={() => setSelectedParentId(folder.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                    selectedParentId === folder.id
                      ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 font-semibold border border-sky-500/30'
                      : 'text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/5'
                  }`}
                >
                  <Folder className="w-4 h-4 text-sky-500 dark:text-sky-400" />
                  <span className="truncate">{folder.name}</span>
                </button>
              ))
          )}
        </div>

        {error && <div className="text-xs font-mono text-rose-500">{error}</div>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleMove}
            disabled={submitting}
            icon={<FolderInput className="w-4 h-4" />}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Move Here'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
