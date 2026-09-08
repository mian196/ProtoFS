import React, { useState } from 'react';
import { FolderPlus, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { api } from '../../api';
import { useVfsStore } from '../../stores/useVfsStore';
import { useDriveStore } from '../../stores/useDriveStore';

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateFolderModal: React.FC<CreateFolderModalProps> = ({ isOpen, onClose }) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { activeDrive } = useDriveStore();
  const { currentParentId, loadDirectory } = useVfsStore();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !activeDrive) return;

    setLoading(true);
    setError(null);
    try {
      await api.createFolder(activeDrive.id, currentParentId, name.trim());
      await loadDirectory(activeDrive.id, currentParentId);
      setName('');
      setLoading(false);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create folder');
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create New Folder"
      subtitle="Creates a hierarchical directory node in the ProtoFS VFS tree"
      maxWidth="sm"
    >
      <form onSubmit={handleCreate} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">Folder Name</label>
          <Input
            icon={<FolderPlus className="w-4 h-4" />}
            placeholder="e.g. Documents, Backups, Media"
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
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Folder'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
