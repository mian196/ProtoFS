import React from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, Check } from 'lucide-react';
import { FileTableRow } from './FileTableRow';
import { useVfsStore, type SortField } from '../../stores/useVfsStore';
import type { FileNode, FolderNode } from '../../types';

interface FileTableProps {
  nodes: ({ kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode })[];
  selectedIds: Set<string>;
  onSelect: (id: string, e: React.MouseEvent, forceMulti?: boolean) => void;
  onOpen: (node: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode }) => void;
  onContextMenu: (
    node: { kind: 'folder'; data: FolderNode } | { kind: 'file'; data: FileNode },
    e: React.MouseEvent,
  ) => void;
}

const COLUMNS: { key: SortField; label: string; className?: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size', className: 'w-28' },
  { key: 'type', label: 'Type', className: 'w-28 hidden sm:table-cell' },
  { key: 'date', label: 'Modified', className: 'w-36 hidden md:table-cell' },
];

export const FileTable: React.FC<FileTableProps> = ({
  nodes,
  selectedIds,
  onSelect,
  onOpen,
  onContextMenu,
}) => {
  const { sortField, sortDirection, setSort, selectAll, clearSelection } = useVfsStore();
  const allSelected = nodes.length > 0 && nodes.every((n) => selectedIds.has(n.data.id));

  const handleToggleAll = () => {
    if (allSelected) {
      clearSelection();
    } else {
      selectAll();
    }
  };

  return (
    <div
      role="region"
      aria-label="Vault directory contents"
      tabIndex={0}
      className="w-full overflow-x-auto rounded-xl bg-white dark:bg-slate-900/75 border border-slate-200/90 dark:border-slate-800/90 shadow-xs focus:outline-none focus:ring-1 focus:ring-sky-500/40"
    >
      <table className="w-full text-left border-collapse">
        <thead className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-md">
          <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            <th scope="col" className="py-2.5 pl-3.5 pr-1 w-9">
              <button
                type="button"
                onClick={handleToggleAll}
                aria-label={allSelected ? 'Deselect all items' : 'Select all items'}
                className={`w-4 h-4 rounded flex items-center justify-center border transition-colors cursor-pointer ${
                  allSelected
                    ? 'bg-sky-500 border-sky-500 text-white'
                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:border-sky-500'
                }`}
              >
                {allSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
              </button>
            </th>
            {COLUMNS.map((col) => {
              const isSorted = sortField === col.key;
              const ariaSort = isSorted ? sortDirection : 'none';
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={`py-2.5 px-3 ${col.className || ''}`}
                >
                  <button
                    type="button"
                    onClick={() => setSort(col.key)}
                    className="inline-flex items-center gap-1.5 font-mono uppercase tracking-wider text-[11px] hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                  >
                    <span>{col.label}</span>
                    <span aria-hidden="true" className="text-slate-400">
                      {!isSorted ? (
                        <ArrowUpDown className="w-3 h-3 opacity-60" />
                      ) : sortDirection === 'ascending' ? (
                        <ArrowUp className="w-3 h-3 text-sky-500" />
                      ) : (
                        <ArrowDown className="w-3 h-3 text-sky-500" />
                      )}
                    </span>
                  </button>
                </th>
              );
            })}
            <th scope="col" className="py-2.5 px-4 text-right w-28 font-mono">
              Proof / Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
          {nodes.map((node) => (
            <FileTableRow
              key={node.data.id}
              node={node}
              isSelected={selectedIds.has(node.data.id)}
              onSelect={(e) => onSelect(node.data.id, e)}
              onToggleCheck={(e) => onSelect(node.data.id, e, true)}
              onOpen={() => onOpen(node)}
              onContextMenu={(e) => onContextMenu(node, e)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};
