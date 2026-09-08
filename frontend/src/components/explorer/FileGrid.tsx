import React from 'react';
import { FileGridCard } from './FileGridCard';
import type { FileNode, FolderNode } from '../../types';

interface FileGridProps {
  nodes: ({ kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode })[];
  selectedIds: Set<string>;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (node: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode }) => void;
  onContextMenu: (node: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode }, e: React.MouseEvent) => void;
}

export const FileGrid: React.FC<FileGridProps> = ({
  nodes,
  selectedIds,
  onSelect,
  onOpen,
  onContextMenu,
}) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
      {nodes.map((node) => (
        <FileGridCard
          key={node.data.id}
          node={node}
          isSelected={selectedIds.has(node.data.id)}
          onSelect={(e) => onSelect(node.data.id, e)}
          onOpen={() => onOpen(node)}
          onContextMenu={(e) => onContextMenu(node, e)}
        />
      ))}
    </div>
  );
};
