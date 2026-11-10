import { create } from 'zustand';
import { api } from '../api';
import type { FileNode, FolderNode, SearchResult } from '../types';

export type ViewMode = 'grid' | 'table';
export type SortField = 'name' | 'size' | 'type' | 'date';
export type SortDirection = 'ascending' | 'descending';
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

export function matchesFileFilter(file: FileNode, filter: FilterType): boolean {
  if (filter === 'trash') return Boolean(file.trashed);
  if (file.trashed) return false;
  if (filter === 'all') return true;
  if (filter === 'pinned') return Boolean(file.pinned);
  if (filter === 'doc') {
    return ['doc', 'pdf', 'sheet', 'presentation'].includes(file.type);
  }
  return file.type === filter;
}

function computeDirectorySlice(
  allFolders: FolderNode[],
  allFiles: FileNode[],
  targetParentId: string,
  filterType: FilterType,
): { folders: FolderNode[]; files: FileNode[] } {
  if (filterType === 'trash') {
    return {
      folders: allFolders.filter((f) => Boolean(f.trashed)),
      files: allFiles.filter((f) => Boolean(f.trashed)),
    };
  }
  if (filterType === 'all') {
    return {
      folders: allFolders.filter((f) => f.parent_id === targetParentId && !f.trashed),
      files: allFiles.filter((f) => f.parent_id === targetParentId && !f.trashed),
    };
  }
  return {
    folders: [],
    files: allFiles.filter((f) => matchesFileFilter(f, filterType)),
  };
}

interface VfsState {
  currentParentId: string;
  breadcrumbs: BreadcrumbItem[];
  allFolders: FolderNode[];
  allFiles: FileNode[];
  folders: FolderNode[];
  files: FileNode[];
  selectedIds: Set<string>;
  searchQuery: string;
  searchResults: SearchResult[] | null;
  filterType: FilterType;
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  inspectorOpen: boolean;
  mobileSidebarOpen: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadDirectory: (driveId: string, parentId?: string) => Promise<void>;
  navigateToFolder: (folderId: string, folderName: string) => void;
  navigateToBreadcrumb: (index: number) => void;
  navigateUp: () => void;
  setFilterType: (filter: FilterType) => void;
  setViewMode: (mode: ViewMode) => void;
  setSort: (field: SortField) => void;
  toggleInspector: (open?: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
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
  allFolders: [],
  allFiles: [],
  folders: [],
  files: [],
  selectedIds: new Set<string>(),
  searchQuery: '',
  searchResults: null,
  filterType: 'all',
  viewMode: 'grid',
  sortField: 'name',
  sortDirection: 'ascending',
  inspectorOpen: false,
  mobileSidebarOpen: false,
  isLoading: false,
  error: null,

  loadDirectory: async (driveId: string, parentId?: string) => {
    const targetParentId = parentId !== undefined ? parentId : get().currentParentId;
    set({ isLoading: true, error: null, currentParentId: targetParentId });

    try {
      const { folders: allFolders, files: allFiles } = await api.loadDrive(driveId, 0);
      const { folders: currentFolders, files: currentFiles } = computeDirectorySlice(
        allFolders,
        allFiles,
        targetParentId,
        get().filterType,
      );

      set({
        allFolders,
        allFiles,
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
    const { breadcrumbs, allFolders, allFiles } = get();
    const newBreadcrumbs = [...breadcrumbs, { id: folderId, name: folderName }];
    const slice = computeDirectorySlice(allFolders, allFiles, folderId, 'all');
    set({
      currentParentId: folderId,
      breadcrumbs: newBreadcrumbs,
      filterType: 'all',
      folders: slice.folders,
      files: slice.files,
      selectedIds: new Set<string>(),
      searchQuery: '',
      searchResults: null,
    });
  },

  navigateToBreadcrumb: (index: number) => {
    const { breadcrumbs, allFolders, allFiles } = get();
    if (index >= 0 && index < breadcrumbs.length) {
      const target = breadcrumbs[index];
      const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
      const slice = computeDirectorySlice(allFolders, allFiles, target.id, 'all');
      set({
        currentParentId: target.id,
        breadcrumbs: newBreadcrumbs,
        filterType: 'all',
        folders: slice.folders,
        files: slice.files,
        selectedIds: new Set<string>(),
        searchQuery: '',
        searchResults: null,
      });
    }
  },

  navigateUp: () => {
    const { breadcrumbs, allFolders, allFiles } = get();
    if (breadcrumbs.length > 1) {
      const newBreadcrumbs = breadcrumbs.slice(0, -1);
      const parent = newBreadcrumbs[newBreadcrumbs.length - 1];
      const slice = computeDirectorySlice(allFolders, allFiles, parent.id, 'all');
      set({
        currentParentId: parent.id,
        breadcrumbs: newBreadcrumbs,
        filterType: 'all',
        folders: slice.folders,
        files: slice.files,
        selectedIds: new Set<string>(),
        searchQuery: '',
        searchResults: null,
      });
    }
  },

  setFilterType: (filterType) => {
    const { allFolders, allFiles, currentParentId } = get();
    const slice = computeDirectorySlice(allFolders, allFiles, currentParentId, filterType);
    set({
      filterType,
      folders: slice.folders,
      files: slice.files,
      selectedIds: new Set<string>(),
      searchQuery: '',
      searchResults: null,
      mobileSidebarOpen: false,
    });
  },

  setViewMode: (viewMode) => set({ viewMode }),

  setSort: (field) => {
    const { sortField, sortDirection } = get();
    if (sortField === field) {
      set({
        sortDirection: sortDirection === 'ascending' ? 'descending' : 'ascending',
      });
    } else {
      set({
        sortField: field,
        sortDirection: field === 'date' || field === 'size' ? 'descending' : 'ascending',
      });
    }
  },

  toggleInspector: (open) =>
    set((state) => ({
      inspectorOpen: open !== undefined ? open : !state.inspectorOpen,
    })),

  setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),

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
