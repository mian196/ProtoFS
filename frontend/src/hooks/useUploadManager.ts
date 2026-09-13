import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { isTauri } from '../api/client';
import { formatBytes } from '../api/mock';
import { useTransferStore } from '../stores/useTransferStore';
import type { DriveMetadata, FileNode } from '../types';

export interface UploadQueueItem {
  name: string;
  size: number;
  file?: File;
  path?: string;
  conflictAction?: 'replace' | 'rename' | 'skip';
}

export interface ConflictState {
  isOpen: boolean;
  existingNode: { name: string; size?: string; date?: string };
  incomingFile: { name: string; size?: string; path?: string };
  remainingCount: number;
  resolve: (action: 'replace' | 'rename' | 'skip', applyToAll: boolean) => void;
}

interface UseUploadManagerOptions {
  activeDrive: DriveMetadata | null;
  currentParentId: string;
  files: FileNode[];
  onUploadSuccess: () => Promise<void>;
}

function getIncrementedName(name: string, existingNames: string[]): string {
  const dotIndex = name.lastIndexOf('.');
  const base = dotIndex !== -1 ? name.substring(0, dotIndex) : name;
  const ext = dotIndex !== -1 ? name.substring(dotIndex) : '';
  let count = 1;
  let candidate = `${base} (${count})${ext}`;
  while (existingNames.includes(candidate)) {
    count++;
    candidate = `${base} (${count})${ext}`;
  }
  return candidate;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const commaIdx = res.indexOf(',');
      resolve(commaIdx !== -1 ? res.substring(commaIdx + 1) : res);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function useUploadManager({
  activeDrive,
  currentParentId,
  files,
  onUploadSuccess,
}: UseUploadManagerOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const [conflictState, setConflictState] = useState<ConflictState | null>(null);

  const queueRef = useRef<UploadQueueItem[]>([]);
  const activeCountRef = useRef(0);
  const batchChoiceRef = useRef<'replace' | 'rename' | 'skip' | null>(null);
  const { addTransfer, updateTransfer } = useTransferStore();

  const MAX_CONCURRENCY = 2; // D-07: Concurrency limit to prevent FLOOD_WAIT

  const processNext = useCallback(async () => {
    if (!activeDrive || activeCountRef.current >= MAX_CONCURRENCY || queueRef.current.length === 0) {
      if (activeCountRef.current === 0 && queueRef.current.length === 0) {
        batchChoiceRef.current = null;
      }
      return;
    }

    const item = queueRef.current.shift();
    if (!item) return;

    // Collision check (D-20)
    const existing = files.find(
      (f) => f.name === item.name && (f.parent_id || '') === (currentParentId || '')
    );

    if (existing) {
      let resolvedAction: 'replace' | 'rename' | 'skip';

      if (batchChoiceRef.current) {
        resolvedAction = batchChoiceRef.current;
      } else {
        // Pause queue for user resolution via ConflictModal
        const remainingConflicts = queueRef.current.filter((q) =>
          files.some((f) => f.name === q.name && (f.parent_id || '') === (currentParentId || ''))
        ).length;

        resolvedAction = await new Promise<'replace' | 'rename' | 'skip'>((resolve) => {
          setConflictState({
            isOpen: true,
            existingNode: {
              name: existing.name,
              size: existing.size,
              date: existing.date,
            },
            incomingFile: {
              name: item.name,
              size: item.size > 0 ? formatBytes(item.size) : undefined,
              path: item.path,
            },
            remainingCount: remainingConflicts,
            resolve: (action, applyToAll) => {
              if (applyToAll) {
                batchChoiceRef.current = action;
              }
              setConflictState(null);
              resolve(action);
            },
          });
        });
      }

      if (resolvedAction === 'skip') {
        processNext();
        return;
      } else if (resolvedAction === 'rename') {
        const existingNames = files.map((f) => f.name);
        item.name = getIncrementedName(item.name, existingNames);
      } else if (resolvedAction === 'replace') {
        item.conflictAction = 'replace';
      }
    }

    activeCountRef.current += 1;
    const transferId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    addTransfer({
      id: transferId,
      name: item.name,
      size: formatBytes(item.size),
      size_bytes: item.size,
      total_bytes: item.size,
      bytes_transferred: 0,
      progress: 0,
      speed: 'Starting...',
      speed_bytes_sec: 0,
      status: 'uploading',
      file_path: item.path,
      drive_id: activeDrive.id,
      parent_id: currentParentId,
    });

    try {
      const nativePath = item.path || (item.file ? ((item.file as any).path as string | undefined) : undefined);
      const base64Data = nativePath ? undefined : item.file ? await readFileAsBase64(item.file) : undefined;
      const isEncrypted = localStorage.getItem('protofs_encryption_enabled') === 'true';

      await api.uploadFile(
        activeDrive.id,
        currentParentId,
        item.name,
        item.size,
        isEncrypted,
        undefined,
        nativePath,
        base64Data,
        item.conflictAction
      );

      if (!isTauri()) {
        updateTransfer(transferId, 100, '0 B/s', 'completed');
      }
      await onUploadSuccess();
    } catch (err: any) {
      updateTransfer(transferId, {
        status: 'failed',
        error: err?.message || 'Upload failed',
      });
    } finally {
      activeCountRef.current -= 1;
      processNext();
    }
  }, [activeDrive, currentParentId, files, addTransfer, updateTransfer, onUploadSuccess]);

  const enqueueFiles = useCallback(
    (newFiles: FileList | File[]) => {
      for (let i = 0; i < newFiles.length; i++) {
        const f = newFiles[i];
        const nativePath = (f as any).path as string | undefined;
        queueRef.current.push({
          name: f.name,
          size: f.size,
          file: f,
          path: nativePath,
        });
      }
      processNext();
    },
    [processNext]
  );

  const enqueuePaths = useCallback(
    (paths: string[]) => {
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop() || 'file.bin';
        queueRef.current.push({
          name,
          size: 0,
          path: p,
        });
      }
      processNext();
    },
    [processNext]
  );

  // Native drag & drop event listener for desktop Tauri mode (D-05)
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/webview')
      .then(({ getCurrentWebview }) => {
        return getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === 'enter' || event.payload.type === 'over') {
            setIsDragging(true);
          } else if (event.payload.type === 'drop') {
            setIsDragging(false);
            if (event.payload.paths && event.payload.paths.length > 0) {
              enqueuePaths(event.payload.paths);
            }
          } else {
            setIsDragging(false);
          }
        });
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [enqueuePaths]);

  // Window drag & drop listeners for browser fallback
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
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (isTauri()) return; // Desktop is handled by onDragDropEvent
      if (e.dataTransfer?.files) {
        enqueueFiles(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [enqueueFiles]);

  return {
    isDragging,
    conflictState,
    enqueueFiles,
    enqueuePaths,
    setConflictState,
  };
}
