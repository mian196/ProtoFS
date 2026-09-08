import { create } from 'zustand';
import type { FileNode, FolderNode } from '../types';

export type ModalType =
  | 'auth'
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
  | null;

export interface ModalPayload {
  targetNode?: FileNode | FolderNode;
  previewFile?: FileNode;
  targetDriveId?: string;
  targetParentId?: string;
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
