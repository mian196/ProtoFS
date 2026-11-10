import React from 'react';
import { Pin, Lock, MoreVertical, Check } from 'lucide-react';
import { FileIcon } from './FileIcon';
import type { FileNode, FolderNode } from '../../types';

interface FileTableRowProps {
  node: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode };
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onToggleCheck?: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export const FileTableRow: React.FC<FileTableRowProps> = ({
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

  return (
    <tr
      data-context-item="true"
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      className={`group select-none cursor-pointer transition-colors duration-150 text-xs ${
        isSelected
          ? 'bg-sky-500/10 dark:bg-sky-500/15 text-slate-900 dark:text-white'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
      }`}
    >
      <td className="py-2.5 pl-3.5 pr-1 w-9">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            (onToggleCheck || onSelect)(e);
          }}
          aria-label={`Select ${name}`}
          className={`w-4 h-4 rounded flex items-center justify-center border transition-all cursor-pointer ${
            isSelected
              ? 'bg-sky-500 border-sky-500 text-white'
              : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 opacity-60 group-hover:opacity-100'
          }`}
        >
          {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
        </button>
      </td>

      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <FileIcon
            kind={node.kind}
            fileType={file?.type}
            fileName={name}
            isEncrypted={file?.encrypted}
            size={18}
          />
          <span
            className="font-medium truncate max-w-xs sm:max-w-md group-hover:text-slate-950 dark:group-hover:text-white transition-colors"
            title={name}
          >
            {name}
          </span>
        </div>
      </td>

      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 font-mono text-[11px] whitespace-nowrap">
        {isFile ? file?.size : folder?.count || 'Directory'}
      </td>

      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 font-mono text-[10px] whitespace-nowrap hidden sm:table-cell">
        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/70">
          {isFile ? file?.type.toUpperCase() : 'FOLDER'}
        </span>
      </td>

      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 font-mono text-[11px] whitespace-nowrap hidden md:table-cell">
        {isFile ? file?.date : folder?.created_at?.slice(0, 10) || '-'}
      </td>

      <td className="py-2.5 px-4 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-1.5">
          {file?.pinned && (
            <span
              title="Pinned in LRU cache"
              className="p-1 rounded bg-amber-500/10 text-amber-500"
            >
              <Pin className="w-3 h-3" />
            </span>
          )}
          {file?.encrypted && (
            <span
              title="AES-256-GCM Encrypted"
              className="p-1 rounded bg-emerald-500/10 text-emerald-500"
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
      </td>
    </tr>
  );
};
