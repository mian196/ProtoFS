import React from 'react';
import { Pin, Lock, MoreVertical, Check } from 'lucide-react';
import { FileIcon } from './FileIcon';
import type { FileNode, FolderNode } from '../../types';

interface FileGridCardProps {
  node: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode };
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onToggleCheck?: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export const FileGridCard: React.FC<FileGridCardProps> = ({
  node,
  isSelected,
  onSelect,
  onToggleCheck,
  onOpen,
  onContextMenu,
}) => {
  const isFile = node.kind === 'file';
  const file = isFile ? node.data : null;
  const folder = !isFile ? node.data : null;
  const name = isFile ? file!.name : folder!.name;

  if (!isFile) {
    return (
      <div
        data-context-item="true"
        onClick={onSelect}
        onDoubleClick={onOpen}
        onContextMenu={onContextMenu}
        className={`group relative rounded-xl px-3.5 py-2.5 transition-all duration-150 select-none cursor-pointer flex items-center justify-between gap-2.5 ${
          isSelected
            ? 'bg-sky-500/12 dark:bg-sky-500/15 border border-sky-500 shadow-xs'
            : 'bg-white dark:bg-slate-900/75 border border-slate-200/90 dark:border-slate-800/90 hover:border-sky-500/40 dark:hover:border-slate-700 hover:shadow-xs'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              (onToggleCheck || onSelect)(e);
            }}
            aria-label={`Select ${name}`}
            className={`w-4 h-4 rounded flex items-center justify-center border transition-all shrink-0 cursor-pointer ${
              isSelected
                ? 'bg-sky-500 border-sky-500 text-white opacity-100'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 opacity-0 group-hover:opacity-100'
            }`}
          >
            {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
          </button>
          <FileIcon kind="folder" fileName={name} size={22} />
          <div className="min-w-0">
            <p
              className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate"
              title={name}
            >
              {name}
            </p>
            <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate">
              {folder?.count || 'Directory'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(e);
          }}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-pointer"
          aria-label={`Actions for ${name}`}
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      data-context-item="true"
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      className={`group relative rounded-xl p-3.5 transition-all duration-150 select-none cursor-pointer flex flex-col justify-between h-36 ${
        isSelected
          ? 'bg-sky-500/10 dark:bg-sky-500/15 border border-sky-500 shadow-xs'
          : 'bg-white dark:bg-slate-900/75 border border-slate-200/90 dark:border-slate-800/90 hover:border-sky-500/40 dark:hover:border-slate-700 hover:shadow-xs'
      }`}
    >
      {/* Top bar */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              (onToggleCheck || onSelect)(e);
            }}
            aria-label={`Select ${name}`}
            className={`w-4 h-4 rounded flex items-center justify-center border transition-all shrink-0 cursor-pointer ${
              isSelected
                ? 'bg-sky-500 border-sky-500 text-white opacity-100'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 opacity-0 group-hover:opacity-100'
            }`}
          >
            {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
          </button>
          <FileIcon
            kind="file"
            fileType={file?.type}
            fileName={name}
            isEncrypted={file?.encrypted}
            size={28}
          />
        </div>
        <div className="flex items-center gap-1">
          {file?.pinned && (
            <span
              title="Pinned in LRU cache"
              className="p-1 rounded-md bg-amber-500/10 text-amber-500"
            >
              <Pin className="w-3 h-3" />
            </span>
          )}
          {file?.encrypted && (
            <span
              title="AES-256-GCM Encrypted"
              className="p-1 rounded-md bg-emerald-500/10 text-emerald-500"
            >
              <Lock className="w-3 h-3" />
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onContextMenu(e);
            }}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            aria-label={`Actions for ${name}`}
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Bottom meta */}
      <div className="mt-2">
        <p
          className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-slate-950 dark:group-hover:text-white transition-colors"
          title={name}
        >
          {name}
        </p>
        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
          <span>{file?.size}</span>
          <span>{file?.date}</span>
        </div>
      </div>
    </div>
  );
};
