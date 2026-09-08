import { create } from 'zustand';
import { api } from '../api';
import type { FileNode, FolderNode, SearchResult } from '../types';

export type ViewMode = 'grid' | 'table';
export type FilterType =
  | 'all'
  | 'video'
  | 'image'
  | 'doc'
  | 'audio'
  | 'sheet'
  | 'presentation'
  | 'binary'
  | 'pinned'
  | 'trash';

export interface BreadcrumbItem {
  id: string;
  name: string;
}

interface VfsState {
  currentParentId: string;
  breadcrumbs: BreadcrumbItem[];
  folders: FolderNode[];
  files: FileNode[];
  selectedIds: Set<string>;
  searchQuery: string;
  searchResults: SearchResult[] | null;
  filterType: FilterType;
  viewMode: ViewMode;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadDirectory: (driveId: string, parentId?: string) => Promise<void>;
  navigateToFolder: (folderId: string, folderName: string) => void;
  navigateToBreadcrumb: (index: number) => void;
  navigateUp: () => void;
  setFilterType: (filter: FilterType) => void;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
  performSearch: (driveId: string, query: string) => Promise<void>;
  clearSearch: () => void;
  toggleSelect: (id: string, multi?: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;
}

export const useVfsStore = create<VfsState>((set, get) => ({
  currentParentId: 'root',
  breadcrumbs: [{ id: 'root', name: 'My Drive' }],
  folders: [],
  files: [],
  selectedIds: new Set<string>(),
  searchQuery: '',
  searchResults: null,
  filterType: 'all',
  viewMode: 'grid',
  isLoading: false,
  error: null,

  loadDirectory: async (driveId: string, parentId?: string) => {
    const targetParentId = parentId !== undefined ? parentId : get().currentParentId;
    set({ isLoading: true, error: null, currentParentId: targetParentId });

    try {
      const isTrashView = get().filterType === 'trash';
      const { folders: allFolders, files: allFiles } = await api.loadDrive(driveId, 0);

      const currentFolders = isTrashView
        ? []
        : allFolders.filter((f) => f.parent_id === targetParentId);

      const currentFiles = isTrashView
        ? allFiles.filter((f) => f.trashed)
        : allFiles.filter((f) => f.parent_id === targetParentId && !f.trashed);

      set({
        folders: currentFolders,
        files: currentFiles,
        isLoading: false,
        selectedIds: new Set<string>(),
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to list directory', isLoading: false });
    }
  },

  navigateToFolder: (folderId: string, folderName: string) => {
    const { breadcrumbs } = get();
    const newBreadcrumbs = [...breadcrumbs, { id: folderId, name: folderName }];
    set({
      currentParentId: folderId,
      breadcrumbs: newBreadcrumbs,
      selectedIds: new Set<string>(),
      searchQuery: '',
      searchResults: null,
    });
  },

  navigateToBreadcrumb: (index: number) => {
    const { breadcrumbs } = get();
    if (index >= 0 && index < breadcrumbs.length) {
      const target = breadcrumbs[index];
      const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
      set({
        currentParentId: target.id,
        breadcrumbs: newBreadcrumbs,
        selectedIds: new Set<string>(),
        searchQuery: '',
        searchResults: null,
      });
    }
  },

  navigateUp: () => {
    const { breadcrumbs } = get();
    if (breadcrumbs.length > 1) {
      const newBreadcrumbs = breadcrumbs.slice(0, -1);
      const parent = newBreadcrumbs[newBreadcrumbs.length - 1];
      set({
        currentParentId: parent.id,
        breadcrumbs: newBreadcrumbs,
        selectedIds: new Set<string>(),
        searchQuery: '',
        searchResults: null,
      });
    }
  },

  setFilterType: (filterType) => {
    set({ filterType, selectedIds: new Set<string>() });
  },

  setViewMode: (viewMode) => set({ viewMode }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  performSearch: async (driveId: string, query: string) => {
    if (!query.trim()) {
      set({ searchResults: null });
      return;
    }
    set({ isLoading: true });
    try {
      const results = await api.searchNodes(driveId, query);
      set({ searchResults: results, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Search failed', isLoading: false });
    }
  },

  clearSearch: () => set({ searchQuery: '', searchResults: null }),

  toggleSelect: (id: string, multi = false) => {
    const current = new Set(get().selectedIds);
    if (!multi) {
      if (current.has(id) && current.size === 1) {
        current.clear();
      } else {
        current.clear();
        current.add(id);
      }
    } else {
      if (current.has(id)) {
        current.delete(id);
      } else {
        current.add(id);
      }
    }
    set({ selectedIds: current });
  },

  selectAll: () => {
    const { folders, files } = get();
    const allIds = new Set<string>([
      ...folders.map((f) => f.id),
      ...files.map((f) => f.id),
    ]);
    set({ selectedIds: allIds });
  },

  clearSelection: () => set({ selectedIds: new Set<string>() }),
}));
