import React, { useEffect, useState, useRef } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { MobileTopBar } from './components/layout/MobileTopBar';
import { MobileTabBar } from './components/layout/MobileTabBar';
import { FileGrid } from './components/explorer/FileGrid';
import { FileTable } from './components/explorer/FileTable';
import { EmptyFolderState } from './components/explorer/EmptyFolderState';
import { DropZoneOverlay } from './components/explorer/DropZoneOverlay';
import { CustomContextMenu } from './components/explorer/CustomContextMenu';
import { DisasterRecoveryBanner } from './components/explorer/DisasterRecoveryBanner';
import { TransferQueue } from './components/transfers/TransferQueue';
import { AppModals } from './components/modals/AppModals';

import { useAuthStore } from './stores/useAuthStore';
import { useDriveStore } from './stores/useDriveStore';
import { useVfsStore } from './stores/useVfsStore';
import { useTransferStore } from './stores/useTransferStore';
import { useNativeStore } from './stores/useNativeStore';
import { useModalStore } from './stores/useModalStore';
import { useProxyStore } from './stores/useProxyStore';
import { useSettingsStore } from './stores/useSettingsStore';
import { confirmDialog } from './stores/useConfirmStore';
import { useTransferListener } from './hooks/useTransferListener';
import { useUploadManager } from './hooks/useUploadManager';
import { useThemeStore } from './stores/useThemeStore';
import { UpdateModal } from './components/settings/modals/UpdateModal';
import { api } from './api';
import { isTauri } from './api/client';
import type { FileNode, FolderNode, VfsNode, UpdateInfo } from './types';
import { Loader2, Trash2, RotateCcw } from 'lucide-react';
import { toast, Toaster } from 'sonner';

export const App: React.FC = () => {
  const { theme } = useThemeStore();
  useTransferListener();
  const { session, initSession, connectionStatus } = useAuthStore();
  const isOnline = connectionStatus === 'connected';
  const { activeDrive, isDriveAccessible, loadDrives } = useDriveStore();
  const {
    currentParentId,
    folders,
    files,
    selectedIds,
    filterType,
    viewMode,
    isLoading,
    loadDirectory,
    navigateToFolder,
    toggleSelect,
    clearSelection,
  } = useVfsStore();
  const { addTransfer, updateTransfer } = useTransferStore();
  const { loadNativeStatus } = useNativeStore();
  const { openModal } = useModalStore();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    isOpen: boolean;
    node: VfsNode | null;
  }>({ x: 0, y: 0, isOpen: false, node: null });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { isDragging, conflictState, enqueueFiles } = useUploadManager({
    activeDrive,
    currentParentId,
    files,
    onUploadSuccess: async () => {
      if (activeDrive) {
        await loadDirectory(activeDrive.id, currentParentId);
      }
    },
  });

  const [startupUpdateInfo, setStartupUpdateInfo] = useState<UpdateInfo | null>(null);
  const [showStartupUpdateModal, setShowStartupUpdateModal] = useState(false);

  useEffect(() => {
    initSession();
    useProxyStore.getState().loadProxies();
    const unlistenPromise = useProxyStore.getState().initEventListener();

    // D-38: Startup auto-check for software updates (silent when up-to-date)
    const autoCheck = useSettingsStore.getState().autoCheckUpdates;
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    if (autoCheck) {
      updateTimer = setTimeout(async () => {
        try {
          const info = await api.checkForUpdates();
          if (info && info.update_available) {
            setStartupUpdateInfo(info);
            toast.info('Software Update Available', {
              description: `ProtoFS v${info.latest_version} is available. Click to review.`,
              duration: 8000,
              action: {
                label: 'View Update',
                onClick: () => setShowStartupUpdateModal(true),
              },
            });
          }
        } catch {
          // Silently ignore startup background check errors
        }
      }, 4000);
    }

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
      if (updateTimer) clearTimeout(updateTimer);
    };
  }, [initSession]);

  useEffect(() => {
    if (session) {
      loadDrives();
      loadNativeStatus();
    }
  }, [session, loadDrives, loadNativeStatus]);

  useEffect(() => {
    if (activeDrive) {
      loadDirectory(activeDrive.id, currentParentId);
    }
  }, [activeDrive, currentParentId, filterType, loadDirectory]);

  // Bug 4 fix: Intercept F5 and Ctrl+R / Cmd+R to prevent full webview reload.
  // Perform an in-app soft refresh of the file directory and drive state instead.
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        if (activeDrive) {
          toast.promise(
            Promise.all([
              loadDirectory(activeDrive.id, currentParentId),
              loadDrives(),
            ]),
            {
              loading: 'Refreshing files...',
              success: 'Files refreshed',
              error: 'Failed to refresh',
              duration: 1500,
            }
          );
        } else {
          loadDrives();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDrive, currentParentId, loadDirectory, loadDrives]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      enqueueFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleOpenNode = (node: VfsNode) => {
    if (node.kind === 'folder') {
      navigateToFolder(node.data.id, node.data.name);
    } else {
      openModal('preview', { previewFile: node.data });
    }
  };

  const handleContextMenu = (node: VfsNode | null, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      isOpen: true,
      node,
    });
  };

  const handleDownloadFile = async (file: FileNode) => {
    if (!activeDrive) return;
    const transferId = `dl_${Date.now()}`;
    addTransfer({
      id: transferId,
      name: file.name,
      size: file.size,
      size_bytes: file.size_bytes,
      total_bytes: file.size_bytes,
      bytes_transferred: 0,
      progress: 0,
      speed: 'Starting...',
      speed_bytes_sec: 0,
      status: 'downloading',
    });

    try {
      const res = await api.downloadFile(activeDrive.id, file.id);
      if (!isTauri()) {
        updateTransfer(transferId, 100, '0 B/s', 'completed');
      }

      if (res && res.data_base64) {
        const link = document.createElement('a');
        link.href = `data:application/octet-stream;base64,${res.data_base64}`;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err: any) {
      updateTransfer(transferId, {
        status: 'failed',
        error: err?.message || 'Download failed',
      });
    }
  };

  const handleTogglePin = async (file: FileNode) => {
    if (!activeDrive) return;
    await api.togglePin(activeDrive.id, file.id, !file.pinned);
    loadDirectory(activeDrive.id, currentParentId);
  };

  const handleDeleteNode = async (node: FileNode | FolderNode) => {
    if (!activeDrive) return;
    try {
      await api.deleteNode(activeDrive.id, node.id, false);
      toast.info(`Moved "${node.name}" to Trash`);
      loadDirectory(activeDrive.id, currentParentId);
    } catch (err: any) {
      toast.error(err.message || 'Failed to move to Trash');
    }
  };

  // Bug 3 fix: Recover/Restore node from Trash
  const handleRestoreNode = async (node: FileNode | FolderNode) => {
    if (!activeDrive) return;
    try {
      await api.restoreNode(activeDrive.id, node.id);
      toast.success(`Restored "${node.name}"`);
      loadDirectory(activeDrive.id, currentParentId);
    } catch (err: any) {
      toast.error(err.message || 'Failed to restore file');
    }
  };

  // Permanent single node delete
  const handleDeletePermanent = async (node: FileNode | FolderNode) => {
    if (!activeDrive) return;
    const confirmed = await confirmDialog({
      title: 'Delete Permanently?',
      message: `Are you sure you want to permanently delete "${node.name}"?\nThis action cannot be undone and cannot be recovered.`,
      variant: 'danger',
      icon: 'trash',
      confirmText: 'Delete Permanently',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    try {
      await api.deleteNode(activeDrive.id, node.id, true);
      toast.success(`Permanently deleted "${node.name}"`);
      loadDirectory(activeDrive.id, currentParentId);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete permanently');
    }
  };

  // Bug 2 fix: Clear / Empty trash action
  const handleEmptyTrash = async () => {
    if (!activeDrive) return;
    const confirmed = await confirmDialog({
      title: 'Empty Trash?',
      message: `Are you sure you want to permanently delete all items in the Trash?\nAll trashed files and folders will be irrecoverably removed.`,
      variant: 'danger',
      icon: 'trash',
      confirmText: 'Empty Trash',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    try {
      const count = await api.emptyTrash(activeDrive.id);
      toast.success(`Trash cleared (${count} ${count === 1 ? 'item' : 'items'} removed)`);
      loadDirectory(activeDrive.id, currentParentId);
    } catch (err: any) {
      toast.error(err.message || 'Failed to empty trash');
    }
  };

  // Bug 3 fix: Batch restore selected items in Trash
  const handleRestoreSelected = async () => {
    if (!activeDrive || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      for (const id of ids) {
        await api.restoreNode(activeDrive.id, id);
      }
      toast.success(`Restored ${ids.length} ${ids.length === 1 ? 'item' : 'items'}`);
      clearSelection();
      loadDirectory(activeDrive.id, currentParentId);
    } catch (err: any) {
      toast.error(err.message || 'Failed to restore selected items');
    }
  };

  // Batch delete selected items permanently in Trash
  const handleDeletePermanentSelected = async () => {
    if (!activeDrive || selectedIds.size === 0) return;
    const count = selectedIds.size;
    const confirmed = await confirmDialog({
      title: 'Delete Selected Permanently?',
      message: `Are you sure you want to permanently delete ${count} selected ${count === 1 ? 'item' : 'items'}?\nThis action cannot be undone.`,
      variant: 'danger',
      icon: 'trash',
      confirmText: 'Delete Permanently',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    const ids = Array.from(selectedIds);
    try {
      for (const id of ids) {
        await api.deleteNode(activeDrive.id, id, true);
      }
      toast.success(`Permanently deleted ${ids.length} ${ids.length === 1 ? 'item' : 'items'}`);
      clearSelection();
      loadDirectory(activeDrive.id, currentParentId);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete selected items');
    }
  };

  const vfsNodes: VfsNode[] = [
    ...folders.map((f) => ({ kind: 'folder' as const, data: f })),
    ...files.map((f) => ({ kind: 'file' as const, data: f })),
  ];

  const isVaultEncrypted = localStorage.getItem('protofs_encryption_enabled') === 'true';
  const isTrashView = filterType === 'trash';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 transition-colors duration-200 select-none">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden">
        <MobileTopBar onSearchToggle={() => {}} />
        <Header onUploadClick={() => fileInputRef.current?.click()} />

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          multiple
          className="hidden"
        />

        <main
          className="flex-1 overflow-y-auto p-4 sm:p-6 mb-16 md:mb-0"
          onContextMenu={(e) => {
            // Right-clicking empty canvas area
            const target = e.target as HTMLElement;
            if (!target.closest('[data-context-item]')) {
              handleContextMenu(null, e);
            }
          }}
        >
          {activeDrive && !isDriveAccessible && isOnline && (
            <DisasterRecoveryBanner drive={activeDrive} />
          )}

          {/* Trash Bin Header Banner & Batch Actions */}
          {isTrashView && (
            <div className="mb-4 p-3 rounded-2xl bg-rose-500/[0.07] border border-rose-500/20 flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-rose-500/15 text-rose-400">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-rose-300 flex items-center gap-2">
                    <span>Trash Bin</span>
                    <span className="text-[11px] font-normal text-rose-400/80 font-mono">
                      ({vfsNodes.length} {vfsNodes.length === 1 ? 'item' : 'items'})
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Items in trash can be recovered or permanently deleted.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {selectedIds.size > 0 ? (
                  <>
                    <span className="text-xs text-slate-300 font-mono px-2 py-1 bg-slate-850 dark:bg-slate-900 rounded-lg border border-white/10">
                      {selectedIds.size} selected
                    </span>
                    <button
                      onClick={handleRestoreSelected}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 text-xs font-medium transition-colors shadow-sm"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore Selected</span>
                    </button>
                    <button
                      onClick={handleDeletePermanentSelected}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs font-medium transition-colors shadow-sm"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Selected</span>
                    </button>
                    <button
                      onClick={clearSelection}
                      className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 transition-colors"
                    >
                      Clear
                    </button>
                  </>
                ) : (
                  vfsNodes.length > 0 && (
                    <button
                      onClick={handleEmptyTrash}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/25 text-xs font-medium transition-colors shadow-sm"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Empty Trash</span>
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
              <span className="text-xs font-mono">Syncing VFS state from SQLite WAL index...</span>
            </div>
          ) : vfsNodes.length === 0 ? (
            <EmptyFolderState
              isTrash={isTrashView}
              onUploadClick={() => fileInputRef.current?.click()}
            />
          ) : viewMode === 'grid' ? (
            <FileGrid
              nodes={vfsNodes}
              selectedIds={selectedIds}
              onSelect={(id, e) => toggleSelect(id, e.ctrlKey || e.metaKey)}
              onOpen={handleOpenNode}
              onContextMenu={handleContextMenu}
            />
          ) : (
            <FileTable
              nodes={vfsNodes}
              selectedIds={selectedIds}
              onSelect={(id, e) => toggleSelect(id, e.ctrlKey || e.metaKey)}
              onOpen={handleOpenNode}
              onContextMenu={handleContextMenu}
            />
          )}
        </main>

        <MobileTabBar />
      </div>

      <DropZoneOverlay isDragging={isDragging} isEncrypted={isVaultEncrypted} />

      <CustomContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        isOpen={contextMenu.isOpen}
        onClose={() => setContextMenu((prev) => ({ ...prev, isOpen: false }))}
        targetNode={contextMenu.node}
        isTrashView={isTrashView}
        onPreview={(f) => openModal('preview', { previewFile: f })}
        onDownload={handleDownloadFile}
        onRename={(node) => openModal('rename', { targetNode: node })}
        onMove={(node) => openModal('move', { targetNode: node })}
        onShare={(f) => openModal('shareLink', { previewFile: f })}
        onHistory={(f) => openModal('versionHistory', { previewFile: f })}
        onTogglePin={handleTogglePin}
        onDelete={handleDeleteNode}
        onRestore={handleRestoreNode}
        onDeletePermanent={handleDeletePermanent}
        onEmptyTrash={handleEmptyTrash}
        onRefresh={() => {
          if (activeDrive) loadDirectory(activeDrive.id, currentParentId);
        }}
        onNewFolder={() => isDriveAccessible && openModal('createFolder')}
        onUpload={() => isDriveAccessible && fileInputRef.current?.click()}
      />

      <TransferQueue />

      <AppModals
        onDownloadFile={handleDownloadFile}
        conflictState={conflictState}
      />

      <UpdateModal
        isOpen={showStartupUpdateModal}
        onClose={() => setShowStartupUpdateModal(false)}
        updateInfo={startupUpdateInfo}
      />

      <Toaster
        position="top-right"
        richColors
        theme={theme === 'system' ? 'system' : theme}
        closeButton
        duration={4000}
      />
    </div>
  );
};
