import React, { useEffect, useRef } from 'react';
import {
  Eye,
  Download,
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
  ShieldCheck,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';
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
  onInspect?: (node: FileNode | FolderNode) => void;
  onDelete?: (node: FileNode | FolderNode) => void;
  onRestore?: (node: FileNode | FolderNode) => void;
  onDeletePermanent?: (node: FileNode | FolderNode) => void;
  onEmptyTrash?: () => void;
  onRefresh?: () => void;
  onNewFolder?: () => void;
  onUpload?: () => void;
}

export function buildDisasterCaption(file: FileNode): string {
  const iv = file.encryption_iv || 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const hash =
    file.sha256_hash || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  return `protofs:v1;parent:${file.parent_id};name:${file.name};enc:${Boolean(file.encrypted)};iv:${iv};hash:${hash};`;
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
  onInspect,
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
  const isTrashed = Boolean(isTrashView || (node && node.trashed));

  // Viewport clamping
  const adjustedX = Math.max(10, Math.min(x, (window.innerWidth || 1000) - 230));
  const adjustedY = Math.max(10, Math.min(y, (window.innerHeight || 800) - 340));

  const itemClass =
    'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer';

  return (
    <div
      ref={menuRef}
      style={{ top: `${adjustedY}px`, left: `${adjustedX}px` }}
      className="fixed z-50 min-w-[210px] rounded-xl p-1.5 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-white/10 backdrop-blur-xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 select-none text-slate-800 dark:text-slate-200"
    >
      {/* Target Node Header or Canvas Title */}
      {node ? (
        <div className="px-2.5 py-1.5 border-b border-slate-200/80 dark:border-white/5 mb-1">
          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
            {node.name}
          </p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono flex items-center justify-between gap-2 mt-0.5">
            <span>{isFile ? file?.size : 'Folder'}</span>
            {isTrashed ? (
              <span className="text-rose-500 dark:text-rose-400 font-medium">In Trash</span>
            ) : isFile ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                {file?.encrypted ? 'AES-256-GCM' : 'Plaintext'}
              </span>
            ) : null}
          </p>
        </div>
      ) : (
        <div className="px-2.5 py-1.5 border-b border-slate-200/80 dark:border-white/5 mb-1">
          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
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
                  type="button"
                  onClick={() => {
                    onPreview?.(file!);
                    onClose();
                  }}
                  className={itemClass}
                >
                  <Eye className="w-3.5 h-3.5 text-sky-500" />
                  <span>Preview</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onDownload?.(file!);
                    onClose();
                  }}
                  className={itemClass}
                >
                  <Download className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Download</span>
                </button>

                <div className="h-px bg-slate-200/80 dark:bg-white/5 my-1" />
              </>
            )}

            <button
              type="button"
              onClick={() => {
                onRestore?.(node);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-sky-600 dark:text-sky-300 hover:bg-sky-500/15 font-medium transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-sky-500" />
              <span>Restore from Trash</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onDeletePermanent?.(node);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 font-medium transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Permanently</span>
            </button>

            {onEmptyTrash && (
              <>
                <div className="h-px bg-slate-200/80 dark:bg-white/5 my-1" />
                <button
                  type="button"
                  onClick={() => {
                    onEmptyTrash();
                    onClose();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Empty Trash</span>
                </button>
              </>
            )}
          </>
        )}

        {/* ================= CANVAS TRASH VIEW ================= */}
        {isTrashView && !node && (
          <>
            {onEmptyTrash && (
              <button
                type="button"
                onClick={() => {
                  onEmptyTrash();
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Empty Trash</span>
              </button>
            )}
            {onRefresh && (
              <button
                type="button"
                onClick={() => {
                  onRefresh();
                  onClose();
                }}
                className={itemClass}
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                <span>Refresh Trash</span>
              </button>
            )}
          </>
        )}

        {/* ================= CANVAS REGULAR VIEW ================= */}
        {!isTrashView && !node && (
          <>
            {onNewFolder && (
              <button
                type="button"
                onClick={() => {
                  onNewFolder();
                  onClose();
                }}
                className={itemClass}
              >
                <FolderPlus className="w-3.5 h-3.5 text-sky-500" />
                <span>New Folder</span>
              </button>
            )}
            {onUpload && (
              <button
                type="button"
                onClick={() => {
                  onUpload();
                  onClose();
                }}
                className={itemClass}
              >
                <Upload className="w-3.5 h-3.5 text-emerald-500" />
                <span>Upload Files</span>
              </button>
            )}
            {onRefresh && (
              <button
                type="button"
                onClick={() => {
                  onRefresh();
                  onClose();
                }}
                className={itemClass}
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
                  type="button"
                  onClick={() => {
                    onPreview?.(file!);
                    onClose();
                  }}
                  className={itemClass}
                >
                  <Eye className="w-3.5 h-3.5 text-sky-500" />
                  <span>Preview & Stream</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onDownload?.(file!);
                    onClose();
                  }}
                  className={itemClass}
                >
                  <Download className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Download</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onShare?.(file!);
                    onClose();
                  }}
                  className={itemClass}
                >
                  <Share2 className="w-3.5 h-3.5 text-blue-500" />
                  <span>Share Link</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onHistory?.(file!);
                    onClose();
                  }}
                  className={itemClass}
                >
                  <History className="w-3.5 h-3.5 text-purple-500" />
                  <span>Version History</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onTogglePin?.(file!);
                    onClose();
                  }}
                  className={itemClass}
                >
                  <Pin className="w-3.5 h-3.5 text-amber-500" />
                  <span>{file?.pinned ? 'Unpin from Cache' : 'Pin in Cache'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(buildDisasterCaption(file!));
                    toast.success('Disaster Recovery Caption Copied');
                    onClose();
                  }}
                  className={itemClass}
                >
                  <Copy className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Copy Disaster Caption</span>
                </button>

                <div className="h-px bg-slate-200/80 dark:bg-white/5 my-1" />
              </>
            )}

            <button
              type="button"
              onClick={() => {
                onInspect?.(node);
                onClose();
              }}
              className={itemClass}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-sky-500" />
              <span>Inspect Cryptographic Proof</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onRename?.(node);
                onClose();
              }}
              className={itemClass}
            >
              <Edit2 className="w-3.5 h-3.5 text-slate-400" />
              <span>Rename (F2)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onMove?.(node);
                onClose();
              }}
              className={itemClass}
            >
              <FolderInput className="w-3.5 h-3.5 text-slate-400" />
              <span>Move to...</span>
            </button>

            <div className="h-px bg-slate-200/80 dark:bg-white/5 my-1" />

            <button
              type="button"
              onClick={() => {
                onDelete?.(node);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
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
