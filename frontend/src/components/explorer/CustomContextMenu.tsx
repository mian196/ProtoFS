import React, { useEffect, useRef } from 'react';
import {
  Eye,
  Download,
  Lock,
  Unlock,
  Edit2,
  FolderInput,
  Share2,
  History,
  Trash2,
  Pin,
} from 'lucide-react';
import type { FileNode, FolderNode } from '../../types';

export interface ContextMenuProps {
  x: number;
  y: number;
  isOpen: boolean;
  onClose: () => void;
  targetNode: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode } | null;
  onPreview?: (file: FileNode) => void;
  onDownload?: (file: FileNode) => void;
  onRename?: (node: FileNode | FolderNode) => void;
  onMove?: (node: FileNode | FolderNode) => void;
  onShare?: (file: FileNode) => void;
  onHistory?: (file: FileNode) => void;
  onTogglePin?: (file: FileNode) => void;
  onToggleEncryption?: (file: FileNode) => void;
  onDelete?: (node: FileNode | FolderNode) => void;
}

export const CustomContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  isOpen,
  onClose,
  targetNode,
  onPreview,
  onDownload,
  onRename,
  onMove,
  onShare,
  onHistory,
  onTogglePin,
  onToggleEncryption,
  onDelete,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('scroll', onClose);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', onClose);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !targetNode) return null;

  const isFile = targetNode.kind === 'file';
  const file = isFile ? targetNode.data : null;
  const node = targetNode.data;

  return (
    <div
      ref={menuRef}
      style={{ top: `${y}px`, left: `${x}px` }}
      className="fixed z-50 min-w-[190px] rounded-2xl p-1.5 bg-slate-900/95 border border-white/10 backdrop-blur-xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 select-none"
    >
      <div className="px-2.5 py-1.5 border-b border-white/5 mb-1">
        <p className="text-xs font-semibold text-slate-200 truncate">{node.name}</p>
        {isFile && (
          <p className="text-[10px] text-slate-400 font-mono">
            {file?.size} • {file?.encrypted ? 'Encrypted' : 'Plaintext'}
          </p>
        )}
      </div>

      <div className="space-y-0.5">
        {isFile && (
          <>
            <button
              onClick={() => {
                onPreview?.(file!);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-sky-500/20 hover:text-sky-300 transition-colors"
            >
              <Eye className="w-3.5 h-3.5 text-sky-400" />
              <span>Preview & Stream</span>
            </button>

            <button
              onClick={() => {
                onDownload?.(file!);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Download Decrypted</span>
            </button>

            <button
              onClick={() => {
                onShare?.(file!);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Share2 className="w-3.5 h-3.5 text-blue-400" />
              <span>Zero-Knowledge Share</span>
            </button>

            <button
              onClick={() => {
                onHistory?.(file!);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
            >
              <History className="w-3.5 h-3.5 text-purple-400" />
              <span>Version History</span>
            </button>

            <button
              onClick={() => {
                onTogglePin?.(file!);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Pin className="w-3.5 h-3.5 text-amber-400" />
              <span>{file?.pinned ? 'Unpin from LRU' : 'Pin in Cache'}</span>
            </button>

            <button
              onClick={() => {
                onToggleEncryption?.(file!);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
            >
              {file?.encrypted ? (
                <>
                  <Unlock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Decrypt in Place</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Encrypt with AES-256</span>
                </>
              )}
            </button>

            <div className="h-px bg-white/5 my-1" />
          </>
        )}

        <button
          onClick={() => {
            onRename?.(node);
            onClose();
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Edit2 className="w-3.5 h-3.5 text-slate-400" />
          <span>Rename</span>
        </button>

        <button
          onClick={() => {
            onMove?.(node);
            onClose();
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
        >
          <FolderInput className="w-3.5 h-3.5 text-slate-400" />
          <span>Move to...</span>
        </button>

        <div className="h-px bg-white/5 my-1" />

        <button
          onClick={() => {
            onDelete?.(node);
            onClose();
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-rose-400 hover:bg-rose-500/20 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Move to Trash</span>
        </button>
      </div>
    </div>
  );
};
