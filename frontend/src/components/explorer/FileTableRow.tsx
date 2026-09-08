import React from 'react';
import { Pin, Lock, MoreVertical } from 'lucide-react';
import { FileIcon } from './FileIcon';
import type { FileNode, FolderNode } from '../../types';

interface FileTableRowProps {
  node: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode };
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export const FileTableRow: React.FC<FileTableRowProps> = ({
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
    <tr
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      className={`group select-none cursor-pointer transition-colors duration-150 border-b border-white/[0.04] text-xs ${
        isSelected
          ? 'bg-sky-500/15 text-white'
          : 'hover:bg-white/[0.03] text-slate-300'
      }`}
    >
      <td className="py-2.5 px-4 flex items-center gap-3">
        <FileIcon
          kind={node.kind}
          fileType={file?.type}
          fileName={name}
          isEncrypted={file?.encrypted}
          size={18}
        />
        <span className="font-medium truncate max-w-xs sm:max-w-md group-hover:text-white transition-colors" title={name}>
          {name}
        </span>
      </td>

      <td className="py-2.5 px-4 text-slate-400 font-mono text-[11px] whitespace-nowrap">
        {isFile ? file?.size : folder?.count || 'Folder'}
      </td>

      <td className="py-2.5 px-4 text-slate-400 text-[11px] whitespace-nowrap hidden sm:table-cell">
        {isFile ? file?.type.toUpperCase() : 'FOLDER'}
      </td>

      <td className="py-2.5 px-4 text-slate-400 font-mono text-[11px] whitespace-nowrap hidden md:table-cell">
        {isFile ? file?.date : folder?.created_at?.slice(0, 10) || '-'}
      </td>

      <td className="py-2.5 px-4 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100">
          {file?.pinned && (
            <span title="Pinned in LRU cache" className="text-amber-400">
              <Pin className="w-3.5 h-3.5" />
            </span>
          )}
          {file?.encrypted && (
            <span title="AES-256 Encrypted" className="text-emerald-400">
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
      </td>
    </tr>
  );
};
