import { invokeCommand, isTauri } from './client';
import { mockStorage, detectFileType, formatBytes, formatDate } from './mock';
import type {
  ExportDriveResult,
  FileNode,
  FileVersion,
  FolderNode,
  ParsedShareLink,
  SearchResult,
  ShareLinkInfo,
  UploadFileOptions,
} from '../types';

export async function loadDrive(
  driveId: string,
  channelId: number
): Promise<{ folders: FolderNode[]; files: FileNode[] }> {
  if (!driveId) return { folders: [], files: [] };
  if (isTauri()) {
    try {
      const items = await invokeCommand<any[]>('load_drive_command', { driveId, channelId });
      const folders: FolderNode[] = [];
      const files: FileNode[] = [];
      for (const item of items || []) {
        if (item.kind === 'Folder' || item.kind === 'folder') {
          folders.push({
            ...item,
            trashed: Boolean(item.is_trashed || item.trashed),
          });
        } else if (item.kind === 'File' || item.kind === 'file') {
          files.push({
            ...item,
            size: formatBytes(item.size_bytes || 0),
            type: detectFileType(item.name),
            encrypted: item.is_encrypted,
            pinned: item.is_pinned_offline,
            trashed: item.is_trashed,
            date: formatDate(item.updated_at),
          });
        }
      }
      return { folders, files };
    } catch (err) {
      console.warn('Tauri load_drive_command error:', err);
    }
  }
  const folders = mockStorage.getStoredFolders().filter((f) => f.drive_id === driveId);
  const files = mockStorage.getStoredFiles().filter((f) => f.drive_id === driveId);
  return { folders, files };
}

export async function createFolder(driveId: string, parentId: string, name: string): Promise<FolderNode> {
  if (isTauri()) return invokeCommand<FolderNode>('create_folder_command', { driveId, parentId, name });
  const folders = mockStorage.getStoredFolders();
  const folder: FolderNode = {
    id: `f_${Date.now().toString(36)}`,
    drive_id: driveId,
    parent_id: parentId,
    name,
    count: '0 files',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  folders.push(folder);
  mockStorage.saveFolders(folders);
  return folder;
}

export async function uploadFile(
  driveIdOrOptions: string | UploadFileOptions,
  parentId?: string,
  name?: string,
  sizeBytes?: number,
  isEncrypted?: boolean,
  fileBytes?: Uint8Array | number[],
  filePath?: string,
  fileBase64?: string,
  conflictAction?: 'replace' | 'rename' | 'skip',
  transferId?: string
): Promise<FileNode> {
  const opts: UploadFileOptions = typeof driveIdOrOptions === 'object'
    ? driveIdOrOptions
    : {
        driveId: driveIdOrOptions,
        parentId: parentId || '',
        name: name || 'file.bin',
        sizeBytes: sizeBytes || 0,
        isEncrypted: !!isEncrypted,
        fileBytes: fileBytes instanceof Uint8Array ? fileBytes : (fileBytes ? new Uint8Array(fileBytes) : undefined),
        filePath,
        fileBase64,
        conflictAction,
        transferId,
      };

  if (isTauri()) {
    const rawBytes = opts.fileBytes ? Array.from(opts.fileBytes) : null;
    const item = await invokeCommand<any>('upload_file_command', {
      driveId: opts.driveId,
      parentId: opts.parentId,
      name: opts.name,
      sizeBytes: opts.sizeBytes,
      isEncrypted: opts.isEncrypted,
      fileBytes: rawBytes,
      fileBase64: opts.fileBase64 || null,
      filePath: opts.filePath || null,
      conflictAction: opts.conflictAction || null,
      transferId: opts.transferId || null,
    });
    return {
      ...item,
      size: formatBytes(item.size_bytes || opts.sizeBytes),
      type: detectFileType(item.name),
      encrypted: item.is_encrypted,
      pinned: item.is_pinned_offline,
      trashed: item.is_trashed,
      date: 'Just now',
    };
  }
  return mockStorage.uploadFile(opts);
}

export async function downloadFile(
  driveId: string,
  fileId: string,
  destinationPath?: string
): Promise<{ file_id: string; name: string; size_bytes: number; destination_path?: string; data_base64?: string }> {
  if (isTauri()) {
    return invokeCommand('download_file_command', { driveId, fileId, destinationPath: destinationPath || null });
  }
  return { file_id: fileId, name: 'downloaded_file', size_bytes: 0, destination_path: destinationPath };
}

export async function getFilePreview(
  driveId: string,
  fileId: string
): Promise<{
  file_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  is_text: boolean;
  text_content?: string;
  data_base64?: string;
}> {
  if (isTauri()) return invokeCommand('get_file_preview_command', { driveId, fileId });
  return { file_id: fileId, name: 'preview', mime_type: 'application/octet-stream', size_bytes: 0, is_text: false };
}

export async function getFileVersions(driveId: string, fileId: string): Promise<FileVersion[]> {
  if (isTauri()) {
    try {
      return await invokeCommand<FileVersion[]>('get_file_versions_command', { driveId, fileId });
    } catch (err) {
      console.warn('Tauri get_file_versions_command error:', err);
    }
  }
  const file = mockStorage.getStoredFiles().find((f) => f.id === fileId);
  return file?.history || [];
}

export async function restoreFileVersion(driveId: string, fileId: string, targetVersion: number): Promise<FileNode> {
  if (isTauri()) {
    const item = await invokeCommand<any>('restore_file_version_command', { driveId, fileId, targetVersion });
    return {
      ...item,
      size: formatBytes(item.size_bytes || 0),
      type: detectFileType(item.name),
      encrypted: item.is_encrypted,
      pinned: item.is_pinned_offline,
      trashed: item.is_trashed,
      date: 'Restored',
    };
  }
  const file = mockStorage.getStoredFiles().find((f) => f.id === fileId);
  if (!file) throw new Error('File not found');
  return file;
}

export async function exportDrive(driveId: string, targetPath: string): Promise<ExportDriveResult> {
  if (isTauri()) return invokeCommand<ExportDriveResult>('export_drive_command', { driveId, targetPath });
  return { export_path: `${targetPath}/Exported_Drive`, total_folders: 4, total_files: 8, total_bytes: 18491020 };
}

export async function deleteNode(driveId: string, nodeId: string, permanent: boolean): Promise<void> {
  if (isTauri()) {
    try {
      await invokeCommand<void>('delete_node_command', { driveId, nodeId, permanent });
      return;
    } catch (err) {
      console.warn('Tauri delete_node_command fallback:', err);
    }
  }
  mockStorage.deleteNode(nodeId, permanent);
}

export async function restoreNode(driveId: string, nodeId: string): Promise<void> {
  if (isTauri()) {
    try {
      await invokeCommand<void>('restore_node_command', { driveId, nodeId });
      return;
    } catch (err) {
      console.warn('Tauri restore_node_command fallback:', err);
    }
  }
  mockStorage.restoreNode(nodeId);
}

export async function emptyTrash(driveId: string): Promise<number> {
  if (isTauri()) {
    try {
      return await invokeCommand<number>('empty_trash_command', { driveId });
    } catch (err) {
      console.warn('Tauri empty_trash_command fallback:', err);
    }
  }
  return mockStorage.emptyTrash(driveId);
}

export async function togglePin(driveId: string, nodeId: string, pinned: boolean): Promise<void> {
  if (isTauri()) {
    try {
      await invokeCommand<void>('toggle_pin_command', { driveId, nodeId, pinned });
      return;
    } catch (err) {
      console.warn('Tauri toggle_pin_command fallback:', err);
    }
  }
  mockStorage.togglePin(nodeId, pinned);
}

export async function searchNodes(driveId: string, query: string): Promise<SearchResult[]> {
  if (isTauri()) {
    try {
      return await invokeCommand<SearchResult[]>('search_nodes_command', { driveId, query });
    } catch (err) {
      console.warn('Tauri search fallback:', err);
    }
  }
  return mockStorage.searchNodes(driveId, query);
}

export async function renameNode(driveId: string, nodeId: string, newName: string): Promise<void> {
  if (isTauri()) {
    await invokeCommand<void>('rename_node_command', { driveId, nodeId, newName });
    return;
  }
  mockStorage.renameNode(nodeId, newName);
}

export async function moveNode(driveId: string, nodeId: string, newParentId: string): Promise<void> {
  if (isTauri()) {
    await invokeCommand<void>('move_node_command', { driveId, nodeId, newParentId });
    return;
  }
  mockStorage.moveNode(nodeId, newParentId);
}

export async function generateShareLink(driveId: string, fileId: string, includeKey?: string): Promise<ShareLinkInfo | null> {
  if (isTauri()) {
    try {
      return await invokeCommand<ShareLinkInfo>('generate_share_link_command', { driveId, fileId, includeKey });
    } catch (err) {
      console.warn('Tauri generate_share_link_command error:', err);
    }
  }
  return mockStorage.generateShareLink(driveId, fileId, includeKey);
}

export async function parseShareLink(linkUrl: string): Promise<ParsedShareLink | null> {
  if (isTauri()) {
    try {
      return await invokeCommand<ParsedShareLink>('parse_share_link_command', { linkUrl });
    } catch (err) {
      console.warn('Tauri parse_share_link_command error:', err);
    }
  }
  return mockStorage.parseShareLink(linkUrl);
}

export async function importSharedLink(
  targetDriveId: string,
  targetParentId: string,
  linkUrl: string,
  customName?: string,
  customKey?: string
): Promise<FileNode | null> {
  if (isTauri()) {
    const item = await invokeCommand<any>('import_shared_link_command', {
      targetDriveId,
      targetParentId,
      linkUrl,
      customName,
      customKey,
    });
    return {
      ...item,
      size: formatBytes(item.size_bytes || 0),
      type: detectFileType(item.name),
      encrypted: item.is_encrypted,
      pinned: item.is_pinned_offline,
      trashed: item.is_trashed,
      date: 'Just now',
    };
  }
  return mockStorage.importSharedLink(targetDriveId, targetParentId, linkUrl, customName);
}

export async function cancelTransfer(transferId: string): Promise<boolean> {
  if (isTauri()) {
    try { return await invokeCommand<boolean>('cancel_transfer_command', { transferId }); }
    catch (err) { console.warn('cancelTransfer error:', err); return false; }
  }
  return true;
}

export async function pauseTransfer(transferId: string): Promise<boolean> {
  if (isTauri()) {
    try { return await invokeCommand<boolean>('pause_transfer_command', { transferId }); }
    catch (err) { console.warn('pauseTransfer error:', err); return false; }
  }
  return true;
}

export async function resumeTransfer(transferId: string): Promise<boolean> {
  if (isTauri()) {
    try { return await invokeCommand<boolean>('resume_transfer_command', { transferId }); }
    catch (err) { console.warn('resumeTransfer error:', err); return false; }
  }
  return true;
}

export async function flushManifest(driveId: string, channelId: number = 0): Promise<void> {
  if (isTauri()) {
    try {
      await invokeCommand<void>('flush_manifest_command', { driveId, channelId });
    } catch (err) {
      console.warn('flushManifest error:', err);
    }
  }
}

export const filesApi = {
  loadDrive,
  createFolder,
  uploadFile,
  downloadFile,
  getFilePreview,
  getFileVersions,
  restoreFileVersion,
  exportDrive,
  deleteNode,
  restoreNode,
  emptyTrash,
  togglePin,
  searchNodes,
  renameNode,
  moveNode,
  generateShareLink,
  parseShareLink,
  importSharedLink,
  cancelTransfer,
  pauseTransfer,
  resumeTransfer,
  flushManifest,
};
