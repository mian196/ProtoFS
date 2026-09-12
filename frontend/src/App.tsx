import React, { useEffect, useState, useRef } from 'react';
import { TacticalSidebar } from './components/layout/TacticalSidebar';
import { FluidHeader } from './components/layout/FluidHeader';
import { MobileTopBar } from './components/layout/MobileTopBar';
import { MobileTabBar } from './components/layout/MobileTabBar';
import { FileGrid } from './components/explorer/FileGrid';
import { FileTable } from './components/explorer/FileTable';
import { EmptyFolderState } from './components/explorer/EmptyFolderState';
import { DropZoneOverlay } from './components/explorer/DropZoneOverlay';
import { CustomContextMenu } from './components/explorer/CustomContextMenu';
import { FloatingTransferHUD } from './components/telemetry/FloatingTransferHUD';
import { MediaPreviewModal } from './components/preview/MediaPreviewModal';
import { AuthModal } from './components/modals/AuthModal';
import { AccountManagerModal } from './components/modals/AccountManagerModal';
import { DriveManagerModal } from './components/modals/DriveManagerModal';
import { CreateFolderModal } from './components/modals/CreateFolderModal';
import { RenameModal } from './components/modals/RenameModal';
import { MoveModal } from './components/modals/MoveModal';
import { ShareLinkModal } from './components/modals/ShareLinkModal';
import { VersionHistoryModal } from './components/modals/VersionHistoryModal';
import { SyncConfigModal } from './components/modals/SyncConfigModal';
import { P2pTransferModal } from './components/modals/P2pTransferModal';
import { SettingsModal } from './components/modals/SettingsModal';

import { useAuthStore } from './stores/useAuthStore';
import { useDriveStore } from './stores/useDriveStore';
import { useVfsStore } from './stores/useVfsStore';
import { useTransferStore } from './stores/useTransferStore';
import { useNativeStore } from './stores/useNativeStore';
import { useModalStore } from './stores/useModalStore';
import { api } from './api';
import type { FileNode, FolderNode, VfsNode } from './types';
import { Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const { session, isLoading: isAuthLoading, initSession } = useAuthStore();
  const { activeDrive, loadDrives } = useDriveStore();
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
  const { activeModal, payload, openModal, closeModal } = useModalStore();

  const [isDragging, setIsDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    isOpen: boolean;
    node: VfsNode | null;
  }>({ x: 0, y: 0, isOpen: false, node: null });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize session & drives on mount
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

  // Helper to read File as Base64 efficiently without huge memory overhead
  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result as string;
        const commaIdx = res.indexOf(',');
        resolve(commaIdx !== -1 ? res.substring(commaIdx + 1) : res);
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  };

  // Sequential Upload Queue
  const uploadQueueRef = useRef<File[]>([]);
  const isUploadingRef = useRef(false);

  const processUploadQueue = async () => {
    if (isUploadingRef.current || uploadQueueRef.current.length === 0) return;
    isUploadingRef.current = true;

    while (uploadQueueRef.current.length > 0) {
      const file = uploadQueueRef.current.shift();
      if (file) {
        await handleUploadFile(file);
      }
    }

    isUploadingRef.current = false;
  };

  const enqueueFiles = (files: FileList | File[]) => {
    for (let i = 0; i < files.length; i++) {
      uploadQueueRef.current.push(files[i]);
    }
    processUploadQueue();
  };

  // Global Drag and Drop handlers
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    };
    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        setIsDragging(false);
      }
    };
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (!e.dataTransfer?.files || !activeDrive) return;
      enqueueFiles(e.dataTransfer.files);
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [activeDrive, currentParentId]);

  // Upload handler
  const handleUploadFile = async (file: File) => {
    if (!activeDrive) return;
    const transferId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const formatBytes = (bytes: number): string => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    addTransfer({
      id: transferId,
      name: file.name,
      size: formatBytes(file.size),
      progress: 0,
      speed: 'Reading...',
      status: 'uploading',
    });

    try {
      let progress = 15;
      const progressTimer = setInterval(() => {
        progress = Math.min(92, progress + 15);
        updateTransfer(transferId, progress, '4.2 MB/s', 'uploading');
      }, 350);

      const base64Data = await readFileAsBase64(file);
      const isEncrypted = localStorage.getItem('protofs_encryption_enabled') === 'true';

      await api.uploadFile(
        activeDrive.id,
        currentParentId,
        file.name,
        file.size,
        isEncrypted,
        undefined,
        undefined,
        base64Data
      );

      clearInterval(progressTimer);
      updateTransfer(transferId, 100, '0 MB/s', 'completed');
      await loadDirectory(activeDrive.id, currentParentId);
    } catch (err: any) {
      updateTransfer(transferId, 0, err.message || 'Upload failed', 'paused');
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      enqueueFiles(e.target.files);
      e.target.value = '';
    }
  };

  // Node opening
  const handleOpenNode = (node: VfsNode) => {
    if (node.kind === 'folder') {
      navigateToFolder(node.data.id, node.data.name);
    } else {
      openModal('preview', { previewFile: node.data });
    }
  };

  // Context Menu trigger
  const handleContextMenu = (node: VfsNode, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      isOpen: true,
      node,
    });
  };

  // Actions from Context Menu
  const handleDownloadFile = async (file: FileNode) => {
    if (!activeDrive) return;
    const transferId = `dl_${Date.now()}`;
    addTransfer({
      id: transferId,
      name: file.name,
      size: file.size,
      progress: 0,
      speed: 'Starting...',
      status: 'downloading',
    });

    try {
      let progress = 20;
      const progressTimer = setInterval(() => {
        progress = Math.min(95, progress + 25);
        updateTransfer(transferId, progress, '5.8 MB/s', 'downloading');
      }, 300);

      const res = await api.downloadFile(activeDrive.id, file.id);
      clearInterval(progressTimer);
      updateTransfer(transferId, 100, '0 MB/s', 'completed');

      if (res && res.data_base64) {
        const link = document.createElement('a');
        link.href = `data:application/octet-stream;base64,${res.data_base64}`;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch {
      updateTransfer(transferId, 0, 'Failed', 'paused');
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

  // Filtered VFS Nodes
  const vfsNodes: VfsNode[] = [
    ...folders.map((f) => ({ kind: 'folder' as const, data: f })),
    ...files
      .filter((f) => {
        if (filterType === 'all' || filterType === 'trash') return true;
        if (filterType === 'pinned') return f.pinned;
        return f.type === filterType;
      })
      .map((f) => ({ kind: 'file' as const, data: f })),
  ];

  return (
    <div className="flex h-screen w-screen bg-slate-100/60 dark:bg-slate-950 overflow-hidden font-sans text-slate-900 dark:text-slate-100 transition-colors">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Desktop Left Sidebar */}
      <div className="hidden md:block">
        <TacticalSidebar />
      </div>

      {/* Main Work Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Mobile Top App Bar */}
        <MobileTopBar onSearchToggle={() => {}} />

        {/* Desktop Fluid Island Floating Header */}
        <FluidHeader onUploadClick={() => fileInputRef.current?.click()} />

        {/* Content View Area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 mb-16 md:mb-0">
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

        {/* Mobile Bottom Tab Bar */}
        <MobileTabBar />
      </div>

      {/* Drag and Drop Overlay */}
      <DropZoneOverlay isDragging={isDragging} />

      {/* Context Menu */}
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

      {/* Floating Transfer HUD */}
      <FloatingTransferHUD />

      {/* Modals */}
      <AuthModal
        isOpen={(!isAuthLoading && !session) || activeModal === 'auth'}
        onClose={closeModal}
      />
      <AccountManagerModal
        isOpen={activeModal === 'accountManager'}
        onClose={closeModal}
      />
      <DriveManagerModal isOpen={activeModal === 'driveManager'} onClose={closeModal} />
      <CreateFolderModal isOpen={activeModal === 'createFolder'} onClose={closeModal} />
      <RenameModal
        isOpen={activeModal === 'rename'}
        onClose={closeModal}
        targetNode={payload.targetNode}
      />
      <MoveModal
        isOpen={activeModal === 'move'}
        onClose={closeModal}
        targetNode={payload.targetNode}
      />
      <ShareLinkModal
        isOpen={activeModal === 'shareLink'}
        onClose={closeModal}
        targetFile={payload.previewFile}
      />
      <VersionHistoryModal
        isOpen={activeModal === 'versionHistory'}
        onClose={closeModal}
        targetFile={payload.previewFile}
      />
      <SyncConfigModal isOpen={activeModal === 'syncConfig'} onClose={closeModal} />
      <P2pTransferModal isOpen={activeModal === 'p2pTransfer'} onClose={closeModal} />
      <SettingsModal isOpen={activeModal === 'settings'} onClose={closeModal} />
      <MediaPreviewModal
        isOpen={activeModal === 'preview'}
        onClose={closeModal}
        file={payload.previewFile || null}
        onDownload={handleDownloadFile}
      />
    </div>
  );
};
