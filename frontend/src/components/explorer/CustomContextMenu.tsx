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
  RotateCcw,
  RefreshCw,
  FolderPlus,
  Upload,
} from 'lucide-react';
import type { FileNode, FolderNode } from '../../types';

export interface ContextMenuProps {
  x: number;
  y: number;
  isOpen: boolean;
  onClose: () => void;
  targetNode: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode } | null;
  isTrashView?: boolean;
  onPreview?: (file: FileNode) => void;
  onDownload?: (file: FileNode) => void;
  onRename?: (node: FileNode | FolderNode) => void;
  onMove?: (node: FileNode | FolderNode) => void;
  onShare?: (file: FileNode) => void;
  onHistory?: (file: FileNode) => void;
  onTogglePin?: (file: FileNode) => void;
  onToggleEncryption?: (file: FileNode) => void;
  onDelete?: (node: FileNode | FolderNode) => void;
  onRestore?: (node: FileNode | FolderNode) => void;
  onDeletePermanent?: (node: FileNode | FolderNode) => void;
  onEmptyTrash?: () => void;
  onRefresh?: () => void;
  onNewFolder?: () => void;
  onUpload?: () => void;
}

export const CustomContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  isOpen,
  onClose,
  targetNode,
  isTrashView = false,
  onPreview,
  onDownload,
  onRename,
  onMove,
  onShare,
  onHistory,
  onTogglePin,
  onToggleEncryption,
  onDelete,
  onRestore,
  onDeletePermanent,
  onEmptyTrash,
  onRefresh,
  onNewFolder,
  onUpload,
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

  if (!isOpen) return null;

  const isFile = targetNode?.kind === 'file';
  const file = isFile ? (targetNode!.data as FileNode) : null;
  const node = targetNode?.data;
  const isTrashed = Boolean(isTrashView || (node && (node as any).trashed));

  // Viewport clamping
  const adjustedX = Math.max(10, Math.min(x, (window.innerWidth || 1000) - 220));
  const adjustedY = Math.max(10, Math.min(y, (window.innerHeight || 800) - 320));

  return (
    <div
      ref={menuRef}
      style={{ top: `${adjustedY}px`, left: `${adjustedX}px` }}
      className="fixed z-50 min-w-[200px] rounded-2xl p-1.5 bg-slate-900/95 border border-white/10 backdrop-blur-xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 select-none text-slate-200"
    >
      {/* Target Node Header or Canvas Title */}
      {node ? (
        <div className="px-2.5 py-1.5 border-b border-white/5 mb-1">
          <p className="text-xs font-semibold text-slate-200 truncate">{node.name}</p>
          <p className="text-[10px] text-slate-400 font-mono flex items-center justify-between gap-2 mt-0.5">
            <span>{isFile ? file?.size : 'Folder'}</span>
            {isTrashed ? (
              <span className="text-rose-400 font-medium">In Trash</span>
            ) : isFile ? (
              <span>{file?.encrypted ? 'Encrypted' : 'Plaintext'}</span>
            ) : null}
          </p>
        </div>
      ) : (
        <div className="px-2.5 py-1.5 border-b border-white/5 mb-1">
          <p className="text-xs font-semibold text-slate-200">
            {isTrashView ? 'Trash Options' : 'Explorer Options'}
          </p>
        </div>
      )}

      <div className="space-y-0.5">
        {/* ================= TRASH ACTIONS ================= */}
        {isTrashed && node && (
          <>
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
                  <span>Preview</span>
                </button>

                <button
                  onClick={() => {
                    onDownload?.(file!);
                    onClose();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Download</span>
                </button>

                <div className="h-px bg-white/5 my-1" />
              </>
            )}

            <button
              onClick={() => {
                onRestore?.(node);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-sky-300 hover:text-sky-200 hover:bg-sky-500/20 font-medium transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
              <span>Restore from Trash</span>
            </button>

            <button
              onClick={() => {
                onDeletePermanent?.(node);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/20 font-medium transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Delete Permanently</span>
            </button>

            {onEmptyTrash && (
              <>
                <div className="h-px bg-white/5 my-1" />
                <button
                  onClick={() => {
                    onEmptyTrash();
                    onClose();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/20 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Clear / Empty Trash</span>
                </button>
              </>
            )}
          </>
        )}

        {/* ================= CANVAS TRASH VIEW (CLICKED ON EMPTY SPACE) ================= */}
        {isTrashView && !node && (
          <>
            {onEmptyTrash && (
              <button
                onClick={() => {
                  onEmptyTrash();
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/20 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>Empty Trash</span>
              </button>
            )}
            {onRefresh && (
              <button
                onClick={() => {
                  onRefresh();
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                <span>Refresh Trash</span>
              </button>
            )}
          </>
        )}

        {/* ================= CANVAS REGULAR VIEW (CLICKED ON EMPTY SPACE) ================= */}
        {!isTrashView && !node && (
          <>
            {onNewFolder && (
              <button
                onClick={() => {
                  onNewFolder();
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5 text-sky-400" />
                <span>New Folder</span>
              </button>
            )}
            {onUpload && (
              <button
                onClick={() => {
                  onUpload();
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
              >
                <Upload className="w-3.5 h-3.5 text-emerald-400" />
                <span>Upload Files</span>
              </button>
            )}
            {onRefresh && (
              <button
                onClick={() => {
                  onRefresh();
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                <span>Refresh</span>
              </button>
            )}
          </>
        )}

        {/* ================= REGULAR ACTIVE FILE/FOLDER ACTIONS ================= */}
        {!isTrashed && node && (
          <>
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
                  <span>Download</span>
                </button>

                <button
                  onClick={() => {
                    onShare?.(file!);
                    onClose();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Share2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Share Link</span>
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
                  <span>{file?.pinned ? 'Unpin from Cache' : 'Pin in Cache'}</span>
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
          </>
        )}
      </div>
    </div>
  );
};
