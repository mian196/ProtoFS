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
      className={`group relative rounded-2xl p-1.5 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] select-none cursor-pointer ${
        isSelected
          ? 'bg-sky-500/20 border border-sky-400/50 shadow-lg shadow-sky-500/10 scale-[1.01]'
          : 'bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/15 hover:scale-[1.01]'
      }`}
    >
      <div className="rounded-xl bg-slate-900/80 p-3.5 flex flex-col justify-between h-36 border border-white/[0.03] shadow-inner">
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
              <span title="Pinned in LRU cache" className="text-amber-400">
                <Pin className="w-3.5 h-3.5" />
              </span>
            )}
            {file?.encrypted && (
              <span title="AES-256-GCM Encrypted" className="text-emerald-400">
                <Lock className="w-3.5 h-3.5" />
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onContextMenu(e);
              }}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Bottom meta */}
        <div className="mt-2">
          <p
            className="text-xs font-medium text-slate-200 truncate group-hover:text-white transition-colors"
            title={name}
          >
            {name}
          </p>
          <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 font-mono">
            <span>{isFile ? file?.size : folder?.count || 'Folder'}</span>
            <span>{isFile ? file?.date : ''}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
