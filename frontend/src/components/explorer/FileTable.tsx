import React from 'react';
import { FileTableRow } from './FileTableRow';
import type { FileNode, FolderNode } from '../../types';

interface FileTableProps {
  nodes: ({ kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode })[];
  selectedIds: Set<string>;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (node: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode }) => void;
  onContextMenu: (node: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode }, e: React.MouseEvent) => void;
}

export const FileTable: React.FC<FileTableProps> = ({
  nodes,
  selectedIds,
  onSelect,
  onOpen,
  onContextMenu,
}) => {
  return (
    <div className="w-full overflow-x-auto rounded-2xl bg-slate-900/60 border border-white/[0.06] backdrop-blur-md">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-white/10 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            <th className="py-3 px-4">Name</th>
            <th className="py-3 px-4">Size</th>
            <th className="py-3 px-4 hidden sm:table-cell">Type</th>
            <th className="py-3 px-4 hidden md:table-cell">Modified</th>
            <th className="py-3 px-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.02]">
          {nodes.map((node) => (
            <FileTableRow
              key={node.data.id}
              node={node}
              isSelected={selectedIds.has(node.data.id)}
              onSelect={(e) => onSelect(node.data.id, e)}
              onOpen={() => onOpen(node)}
              onContextMenu={(e) => onContextMenu(node, e)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};
