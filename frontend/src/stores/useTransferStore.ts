import { create } from 'zustand';
import type { TransferItem } from '../types';

export interface AggregateTransferStats {
  activeCount: number;
  completedCount: number;
  failedCount: number;
  pausedCount: number;
  totalBytesTransferred: number;
  totalQueueBytes: number;
  overallPercent: number;
  aggregateSpeedBytesSec: number;
}

interface TransferState {
  transfers: TransferItem[];
  isOpen: boolean;
  addTransfer: (item: TransferItem) => void;
  updateTransfer: (
    id: string,
    updatesOrProgress: Partial<TransferItem> | number,
    speed?: string,
    status?: TransferItem['status']
  ) => void;
  removeTransfer: (id: string) => void;
  clearCompleted: () => void;
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
  getAggregateStats: () => AggregateTransferStats;
}

export const useTransferStore = create<TransferState>((set, get) => ({
  transfers: [],
  isOpen: false,

  addTransfer: (item) =>
    set((state) => ({
      transfers: [item, ...state.transfers.filter((t) => t.id !== item.id)],
      isOpen: true,
    })),

  updateTransfer: (id, updatesOrProgress, speed, status) =>
    set((state) => {
      const updates: Partial<TransferItem> =
        typeof updatesOrProgress === 'number'
          ? {
              progress: updatesOrProgress,
              speed: speed ?? '0 B/s',
              status: status !== undefined ? status : updatesOrProgress >= 100 ? 'completed' : undefined,
            }
          : updatesOrProgress;

      return {
        transfers: state.transfers.map((t) => {
          if (t.id !== id) return t;
          const merged = { ...t, ...updates };
          if (merged.progress >= 100 && merged.status !== 'failed' && merged.status !== 'paused') {
            merged.status = 'completed';
          }
          return merged;
        }),
      };
    }),

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

  getAggregateStats: () => {
    const { transfers } = get();
    let activeCount = 0;
    let completedCount = 0;
    let failedCount = 0;
    let pausedCount = 0;
    let totalBytesTransferred = 0;
    let totalQueueBytes = 0;
    let aggregateSpeedBytesSec = 0;

    for (const t of transfers) {
      if (t.status === 'uploading' || t.status === 'downloading') {
        activeCount++;
        aggregateSpeedBytesSec += t.speed_bytes_sec || 0;
      } else if (t.status === 'completed') {
        completedCount++;
      } else if (t.status === 'failed') {
        failedCount++;
      } else if (t.status === 'paused') {
        pausedCount++;
      }

      totalBytesTransferred += t.bytes_transferred || 0;
      totalQueueBytes += t.total_bytes || t.size_bytes || 0;
    }

    const overallPercent =
      totalQueueBytes > 0
        ? Math.min(100, Math.round((totalBytesTransferred / totalQueueBytes) * 100))
        : completedCount > 0 && activeCount === 0
          ? 100
          : 0;

    return {
      activeCount,
      completedCount,
      failedCount,
      pausedCount,
      totalBytesTransferred,
      totalQueueBytes,
      overallPercent,
      aggregateSpeedBytesSec,
    };
  },
}));
