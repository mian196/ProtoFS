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
  | 'closeApp'
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

interface ModalStackEntry {
  activeModal: ModalType;
  payload: ModalPayload;
}

interface ModalState {
  activeModal: ModalType;
  payload: ModalPayload;
  modalStack: ModalStackEntry[];
  openModal: (type: ModalType, payload?: ModalPayload) => void;
  closeModal: () => void;
  closeAllModals: () => void;
}

export const useModalStore = create<ModalState>((set) => ({
  activeModal: null,
  payload: {},
  modalStack: [],

  openModal: (activeModal, payload = {}) =>
    set((state) => {
      if (activeModal === null) {
        return { activeModal: null, payload: {}, modalStack: [] };
      }
      const shouldPush =
        state.activeModal !== null && state.activeModal !== activeModal;
      return {
        activeModal,
        payload,
        modalStack: shouldPush
          ? [
              ...state.modalStack,
              { activeModal: state.activeModal, payload: state.payload },
            ]
          : state.modalStack,
      };
    }),

  closeModal: () =>
    set((state) => {
      if (state.modalStack.length > 0) {
        const nextStack = state.modalStack.slice(0, -1);
        const previous = state.modalStack[state.modalStack.length - 1];
        return {
          activeModal: previous.activeModal,
          payload: previous.payload,
          modalStack: nextStack,
        };
      }
      return { activeModal: null, payload: {}, modalStack: [] };
    }),

  closeAllModals: () =>
    set({ activeModal: null, payload: {}, modalStack: [] }),
}));
