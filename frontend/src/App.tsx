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
import { useTransferListener } from './hooks/useTransferListener';
import { useUploadManager } from './hooks/useUploadManager';
import { useThemeStore } from './stores/useThemeStore';
import { api } from './api';
import { isTauri } from './api/client';
import type { FileNode, FolderNode, VfsNode } from './types';
import { Loader2 } from 'lucide-react';
import { Toaster } from 'sonner';

export const App: React.FC = () => {
  const { theme } = useThemeStore();
  useTransferListener();
  const { session, initSession } = useAuthStore();
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

  useEffect(() => {
    initSession();
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

  const handleContextMenu = (node: VfsNode, e: React.MouseEvent) => {
    e.preventDefault();
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
    await api.deleteNode(activeDrive.id, node.id, false);
    loadDirectory(activeDrive.id, currentParentId);
  };

  const vfsNodes: VfsNode[] = [
    ...folders.map((f) => ({ kind: 'folder' as const, data: f })),
    ...files.map((f) => ({ kind: 'file' as const, data: f })),
  ];

  const isVaultEncrypted = localStorage.getItem('protofs_encryption_enabled') === 'true';

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

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 mb-16 md:mb-0">
          {activeDrive && !isDriveAccessible && (
            <DisasterRecoveryBanner drive={activeDrive} />
          )}

          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
              <span className="text-xs font-mono">Syncing VFS state from SQLite WAL index...</span>
            </div>
          ) : vfsNodes.length === 0 ? (
            <EmptyFolderState onUploadClick={() => fileInputRef.current?.click()} />
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
        onPreview={(f) => openModal('preview', { previewFile: f })}
        onDownload={handleDownloadFile}
        onRename={(node) => openModal('rename', { targetNode: node })}
        onMove={(node) => openModal('move', { targetNode: node })}
        onShare={(f) => openModal('shareLink', { previewFile: f })}
        onHistory={(f) => openModal('versionHistory', { previewFile: f })}
        onTogglePin={handleTogglePin}
        onDelete={handleDeleteNode}
      />

      <TransferQueue />

      <AppModals
        onDownloadFile={handleDownloadFile}
        conflictState={conflictState}
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
