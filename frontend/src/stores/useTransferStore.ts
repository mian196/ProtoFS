import { create } from 'zustand';
import type { TransferItem } from '../types';

interface TransferState {
  transfers: TransferItem[];
  isOpen: boolean;
  addTransfer: (item: TransferItem) => void;
  updateTransfer: (id: string, progress: number, speed: string, status?: TransferItem['status']) => void;
  removeTransfer: (id: string) => void;
  clearCompleted: () => void;
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
}

export const useTransferStore = create<TransferState>((set) => ({
  transfers: [],
  isOpen: false,

  addTransfer: (item) =>
    set((state) => ({
      transfers: [item, ...state.transfers.filter((t) => t.id !== item.id)],
      isOpen: true,
    })),

  updateTransfer: (id, progress, speed, status) =>
    set((state) => ({
      transfers: state.transfers.map((t) =>
        t.id === id
          ? {
              ...t,
              progress,
              speed,
              status: status !== undefined ? status : progress >= 100 ? 'completed' : t.status,
            }
          : t
      ),
    })),

  removeTransfer: (id) =>
    set((state) => ({
      transfers: state.transfers.filter((t) => t.id !== id),
    })),

  clearCompleted: () =>
    set((state) => ({
      transfers: state.transfers.filter((t) => t.status !== 'completed'),
    })),

  setIsOpen: (isOpen) => set({ isOpen }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
}));
