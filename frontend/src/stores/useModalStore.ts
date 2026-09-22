import { create } from 'zustand';
import type { FileNode, FolderNode } from '../types';

export type SettingsTabId =
  | 'general'
  | 'drives'
  | 'sync'
  | 'security'
  | 'webdav'
  | 'advanced'
  | 'proxy';

export type ModalType =
  | 'auth'
  | 'accountManager'
  | 'driveManager'
  | 'createFolder'
  | 'rename'
  | 'move'
  | 'shareLink'
  | 'versionHistory'
  | 'syncConfig'
  | 'p2pTransfer'
  | 'settings'
  | 'preview'
  | 'vaultUnlock'
  | 'recoveryPhrase'
  | 'clearCacheConfirm'
  | 'exportBackup'
  | 'importBackup'
  | null;

export interface ModalPayload {
  targetNode?: FileNode | FolderNode;
  previewFile?: FileNode;
  targetDriveId?: string;
  targetParentId?: string;
  defaultTab?: SettingsTabId;
  onSuccess?: () => void;
  recoveryMode?: boolean;
}

interface ModalState {
  activeModal: ModalType;
  payload: ModalPayload;
  openModal: (type: ModalType, payload?: ModalPayload) => void;
  closeModal: () => void;
}

export const useModalStore = create<ModalState>((set) => ({
  activeModal: null,
  payload: {},

  openModal: (activeModal, payload = {}) => set({ activeModal, payload }),
  closeModal: () => set({ activeModal: null, payload: {} }),
}));
