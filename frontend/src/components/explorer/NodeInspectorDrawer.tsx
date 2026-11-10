import React from 'react';
import {
  X,
  ShieldCheck,
  Lock,
  Pin,
  Copy,
  Eye,
  Download,
  Share2,
  History,
  Edit2,
  FolderInput,
  Trash2,
  Hash,
  KeyRound,
  MessageSquareCode,
  HardDrive,
} from 'lucide-react';
import { toast } from 'sonner';
import { FileIcon } from './FileIcon';
import { buildDisasterCaption } from './CustomContextMenu';
import type { FileNode, FolderNode, DriveMetadata } from '../../types';

interface NodeInspectorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedNode: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode } | null;
  selectedCount: number;
  activeDrive: DriveMetadata | null;
  totalFilesCount: number;
  totalFoldersCount: number;
  onPreview: (file: FileNode) => void;
  onDownload: (file: FileNode) => void;
  onShare: (file: FileNode) => void;
  onHistory: (file: FileNode) => void;
  onTogglePin: (file: FileNode) => void;
  onRename: (node: FileNode | FolderNode) => void;
  onMove: (node: FileNode | FolderNode) => void;
  onDelete: (node: FileNode | FolderNode) => void;
}

export const NodeInspectorDrawer: React.FC<NodeInspectorDrawerProps> = ({
  isOpen,
  onClose,
  selectedNode,
  selectedCount,
  activeDrive,
  totalFilesCount,
  totalFoldersCount,
  onPreview,
  onDownload,
  onShare,
  onHistory,
  onTogglePin,
  onRename,
  onMove,
  onDelete,
}) => {
  if (!isOpen) return null;

  const isFile = selectedNode?.kind === 'file';
  const file = isFile ? (selectedNode.data as FileNode) : null;
  const folder = selectedNode?.kind === 'folder' ? (selectedNode.data as FolderNode) : null;
  const caption = file ? buildDisasterCaption(file) : null;

  const copyText = (label: string, value: string) => {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <aside
      aria-label="Cryptographic Node Inspector"
      className="w-80 shrink-0 border-l border-slate-200/90 dark:border-slate-800/90 bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl flex flex-col justify-between h-full overflow-y-auto no-scrollbar p-4 select-none z-20"
    >
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-2.5 border-b border-slate-200/80 dark:border-slate-800/80">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-500" />
            <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
              Node Proof Inspector
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            title="Close Inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!selectedNode ? (
          <div className="space-y-4 py-4">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/80 space-y-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-500">
                  <HardDrive className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {activeDrive?.name || 'Channel Vault'}
                  </p>
                  <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
                    Channel ID: {activeDrive?.channel_id || activeDrive?.id || 'N/A'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800/70 text-xs font-mono">
                <div>
                  <span className="text-[10px] text-slate-400 block">Directories</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {totalFoldersCount}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Encrypted Objects</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {totalFilesCount}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {selectedCount > 1
                ? `${selectedCount} items currently selected. Use the batch action bar below to perform bulk operations.`
                : 'Select any file or directory to inspect its AES-256-GCM cryptographic envelope, SHA-256 integrity hash, and self-describing Telegram disaster recovery caption.'}
            </p>
          </div>
        ) : (
          <>
            {/* Selected Node Summary Card */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/80 space-y-3">
              <div className="flex items-start gap-3">
                <FileIcon
                  kind={selectedNode.kind}
                  fileType={file?.type}
                  fileName={selectedNode.data.name}
                  isEncrypted={file?.encrypted}
                  size={32}
                />
                <div className="min-w-0 flex-1">
                  <h3
                    className="text-xs font-semibold text-slate-900 dark:text-white break-all leading-snug"
                    title={selectedNode.data.name}
                  >
                    {selectedNode.data.name}
                  </h3>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {isFile ? file!.type.toUpperCase() : 'FOLDER'}
                    </span>
                    {isFile && (
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        {file!.size}
                      </span>
                    )}
                    {file?.encrypted && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                        <Lock className="w-2.5 h-2.5" />
                        AES-256-GCM
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Action Grid */}
              <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-slate-200/70 dark:border-slate-800/70">
                {isFile && (
                  <>
                    <button
                      type="button"
                      onClick={() => onPreview(file!)}
                      className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-sky-500 text-white hover:bg-sky-400 transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Preview</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownload(file!)}
                      className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-sky-500/40 transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Download</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onShare(file!)}
                      className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-sky-500/40 transition-colors cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5 text-sky-500" />
                      <span>Share</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onHistory(file!)}
                      className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-sky-500/40 transition-colors cursor-pointer"
                    >
                      <History className="w-3.5 h-3.5 text-purple-500" />
                      <span>Versions</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onTogglePin(file!)}
                      className="col-span-2 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-amber-500/40 transition-colors cursor-pointer"
                    >
                      <Pin className="w-3.5 h-3.5 text-amber-500" />
                      <span>{file!.pinned ? 'Unpin from Local Cache' : 'Pin in Local LRU Cache'}</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => onRename(selectedNode.data)}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Rename</span>
                </button>
                <button
                  type="button"
                  onClick={() => onMove(selectedNode.data)}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white cursor-pointer"
                >
                  <FolderInput className="w-3.5 h-3.5" />
                  <span>Move</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(selectedNode.data)}
                  className="col-span-2 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Move to Trash</span>
                </button>
              </div>
            </div>

            {/* Cryptographic Envelope & Telegram Proof */}
            {isFile && file ? (
              <div className="space-y-3">
                <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Cryptographic Telemetry
                </div>

                <div className="space-y-2 text-xs font-mono">
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/80">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                      <span className="flex items-center gap-1">
                        <MessageSquareCode className="w-3 h-3 text-sky-500" />
                        Telegram Message ID
                      </span>
                      <span className="text-emerald-500">Synced</span>
                    </div>
                    <div className="text-slate-800 dark:text-slate-200 font-semibold">
                      #{file.telegram_message_id || 'Pending'} (v{file.version || 1})
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/80">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                      <span className="flex items-center gap-1">
                        <KeyRound className="w-3 h-3 text-amber-500" />
                        AES-256-GCM IV (Base64)
                      </span>
                      {file.encryption_iv && (
                        <button
                          type="button"
                          onClick={() => copyText('IV', file.encryption_iv!)}
                          className="text-sky-500 hover:underline cursor-pointer"
                        >
                          Copy
                        </button>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-700 dark:text-slate-300 break-all">
                      {file.encryption_iv || 'Derived per-chunk envelope'}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/80">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                      <span className="flex items-center gap-1">
                        <Hash className="w-3 h-3 text-purple-500" />
                        SHA-256 Content Digest
                      </span>
                      {file.sha256_hash && (
                        <button
                          type="button"
                          onClick={() => copyText('SHA-256 Hash', file.sha256_hash!)}
                          className="text-sky-500 hover:underline cursor-pointer"
                        >
                          Copy
                        </button>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-700 dark:text-slate-300 break-all">
                      {file.sha256_hash || 'Verified on stream completion'}
                    </div>
                  </div>

                  {caption && (
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/80">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                        <span>Self-Describing Recovery Caption</span>
                        <button
                          type="button"
                          onClick={() => copyText('Disaster Recovery Caption', caption)}
                          className="inline-flex items-center gap-1 text-sky-500 hover:underline cursor-pointer"
                        >
                          <Copy className="w-2.5 h-2.5" />
                          <span>Copy</span>
                        </button>
                      </div>
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-400/90 bg-emerald-500/5 border border-emerald-500/20 rounded p-2 break-all leading-relaxed">
                        {caption}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              folder && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/80 text-xs font-mono space-y-1.5">
                  <div className="text-[10px] text-slate-400">Node ID</div>
                  <div className="text-slate-800 dark:text-slate-200 break-all">{folder.id}</div>
                  <div className="text-[10px] text-slate-400 pt-1">Parent Directory</div>
                  <div className="text-slate-800 dark:text-slate-200">{folder.parent_id}</div>
                </div>
              )
            )}
          </>
        )}
      </div>
    </aside>
  );
};
