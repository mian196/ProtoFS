import React from 'react';
import { FileGridCard } from './FileGridCard';
import type { FileNode, FolderNode } from '../../types';

interface FileGridProps {
  nodes: ({ kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode })[];
  selectedIds: Set<string>;
  onSelect: (id: string, e: React.MouseEvent, forceMulti?: boolean) => void;
  onOpen: (node: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode }) => void;
  onContextMenu: (
    node: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode },
    e: React.MouseEvent,
  ) => void;
}

export const FileGrid: React.FC<FileGridProps> = ({
  nodes,
  selectedIds,
  onSelect,
  onOpen,
  onContextMenu,
}) => {
  const folderNodes = nodes.filter((n) => n.kind === 'folder');
  const fileNodes = nodes.filter((n) => n.kind === 'file');

  return (
    <div className="space-y-5">
      {folderNodes.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2 px-0.5">
            <h2 className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Directories ({folderNodes.length})
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
            {folderNodes.map((node) => (
              <FileGridCard
                key={node.data.id}
                node={node}
                isSelected={selectedIds.has(node.data.id)}
                onSelect={(e) => onSelect(node.data.id, e)}
                onToggleCheck={(e) => onSelect(node.data.id, e, true)}
                onOpen={() => onOpen(node)}
                onContextMenu={(e) => onContextMenu(node, e)}
              />
            ))}
          </div>
        </section>
      )}

      {fileNodes.length > 0 && (
        <section>
          {folderNodes.length > 0 && (
            <div className="flex items-center justify-between mb-2 px-0.5">
              <h2 className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Encrypted Objects ({fileNodes.length})
              </h2>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {fileNodes.map((node) => (
              <FileGridCard
                key={node.data.id}
                node={node}
                isSelected={selectedIds.has(node.data.id)}
                onSelect={(e) => onSelect(node.data.id, e)}
                onToggleCheck={(e) => onSelect(node.data.id, e, true)}
                onOpen={() => onOpen(node)}
                onContextMenu={(e) => onContextMenu(node, e)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
