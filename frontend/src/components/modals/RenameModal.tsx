import React, { useState, useEffect } from 'react';
import { Edit2, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { api } from '../../api';
import { useVfsStore } from '../../stores/useVfsStore';
import { useDriveStore } from '../../stores/useDriveStore';
import type { FileNode, FolderNode } from '../../types';

interface RenameModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetNode?: FileNode | FolderNode;
}

export const RenameModal: React.FC<RenameModalProps> = ({
  isOpen,
  onClose,
  targetNode,
}) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { activeDrive } = useDriveStore();
  const { currentParentId, loadDirectory } = useVfsStore();

  useEffect(() => {
    if (targetNode) {
      setName(targetNode.name);
    }
  }, [targetNode]);

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !activeDrive || !targetNode) return;

    setLoading(true);
    setError(null);
    try {
      await api.renameNode(activeDrive.id, targetNode.id, name.trim());
      await loadDirectory(activeDrive.id, currentParentId);
      setLoading(false);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to rename item');
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Rename Item"
      subtitle="Performs instant O(1) metadata update without re-encrypting payloads"
      maxWidth="sm"
    >
      <form onSubmit={handleRename} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">New Name</label>
          <Input
            icon={<Edit2 className="w-4 h-4" />}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>

        {error && <div className="text-xs font-mono text-rose-400">{error}</div>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading || !name.trim()}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Rename'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
