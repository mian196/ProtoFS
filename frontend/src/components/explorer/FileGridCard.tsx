import React from 'react';
import { Pin, Lock, MoreVertical } from 'lucide-react';
import { FileIcon } from './FileIcon';
import type { FileNode, FolderNode } from '../../types';

interface FileGridCardProps {
  node: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode };
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export const FileGridCard: React.FC<FileGridCardProps> = ({
  node,
  isSelected,
  onSelect,
  onOpen,
  onContextMenu,
}) => {
  const isFile = node.kind === 'file';
  const file = isFile ? node.data : null;
  const folder = !isFile ? node.data : null;
  const name = isFile ? file!.name : folder!.name;

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      className={`group relative rounded-xl p-3.5 transition-all duration-150 select-none cursor-pointer flex flex-col justify-between h-36 ${
        isSelected
          ? 'bg-sky-50 dark:bg-sky-500/15 border border-sky-500 shadow-sm'
          : 'bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm'
      }`}
    >
      {/* Top bar */}
      <div className="flex items-start justify-between">
        <FileIcon
          kind={node.kind}
          fileType={file?.type}
          fileName={name}
          isEncrypted={file?.encrypted}
          size={28}
        />
        <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
          {file?.pinned && (
            <span title="Pinned in LRU cache" className="text-amber-500">
              <Pin className="w-3.5 h-3.5" />
            </span>
          )}
          {file?.encrypted && (
            <span title="AES-256-GCM Encrypted" className="text-emerald-500">
              <Lock className="w-3.5 h-3.5" />
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onContextMenu(e);
            }}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Bottom meta */}
      <div className="mt-2">
        <p
          className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate group-hover:text-slate-900 dark:group-hover:text-white transition-colors"
          title={name}
        >
          {name}
        </p>
        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
          <span>{isFile ? file?.size : folder?.count || 'Folder'}</span>
          <span>{isFile ? file?.date : ''}</span>
        </div>
      </div>
    </div>
  );
};
