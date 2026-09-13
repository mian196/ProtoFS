import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '../api/client';
import { formatBytes } from '../api/mock';
import { useTransferStore } from '../stores/useTransferStore';
import type { TransferProgressPayload } from '../types';

export function formatEta(secs: number | null | undefined): string {
  if (secs == null || secs < 0) return '--';
  if (secs === 0) return '0s';
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

/**
 * Global Tauri transfer event listener hook (D-11, D-12).
 * Subscribes to 'upload-progress' and 'download-progress' events, applies
 * Exponential Moving Average (EMA alpha=0.2) speed smoothing, and atomically
 * updates useTransferStore.
 */
export function useTransferListener() {
  const speedHistoryRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!isTauri()) return;

    let unlistenUpload: (() => void) | undefined;
    let unlistenDownload: (() => void) | undefined;
    let isSubscribed = true;

    const handleProgress = (payload: TransferProgressPayload) => {
      const prevSpeed = speedHistoryRef.current.get(payload.transfer_id) ?? payload.speed_bytes_sec;
      const smoothedSpeed = Math.round(0.2 * payload.speed_bytes_sec + 0.8 * prevSpeed);
      speedHistoryRef.current.set(payload.transfer_id, smoothedSpeed);

      const progress =
        payload.total_bytes > 0
          ? Math.min(100, Math.round((payload.bytes_transferred / payload.total_bytes) * 100))
          : payload.status === 'completed'
            ? 100
            : 0;

      const speedStr = smoothedSpeed > 0 ? `${formatBytes(smoothedSpeed)}/s` : '0 B/s';
      const etaStr = formatEta(payload.eta_secs);

      const store = useTransferStore.getState();
      const existing = store.transfers.find(
        (t) =>
          t.id === payload.transfer_id ||
          (t.name === payload.name &&
            ((payload.status === 'uploading' && t.status === 'uploading') ||
              (payload.status === 'downloading' && t.status === 'downloading')))
      );

      const targetId = existing ? existing.id : payload.transfer_id;

      if (!existing) {
        store.addTransfer({
          id: payload.transfer_id,
          file_id: payload.file_id,
          name: payload.name,
          size: formatBytes(payload.total_bytes),
          total_bytes: payload.total_bytes,
          bytes_transferred: payload.bytes_transferred,
          progress,
          speed: speedStr,
          speed_bytes_sec: smoothedSpeed,
          eta: etaStr,
          eta_secs: payload.eta_secs,
          status: payload.status,
          error: payload.error,
        });
      } else {
        store.updateTransfer(targetId, {
          id: payload.transfer_id,
          file_id: payload.file_id || existing.file_id,
          bytes_transferred: payload.bytes_transferred,
          total_bytes: payload.total_bytes || existing.total_bytes,
          progress,
          speed: speedStr,
          speed_bytes_sec: smoothedSpeed,
          eta: etaStr,
          eta_secs: payload.eta_secs,
          status: payload.status,
          error: payload.error,
        });
      }

      if (payload.status === 'completed' || payload.status === 'failed') {
        speedHistoryRef.current.delete(payload.transfer_id);
      }
    };

    const subscribe = async () => {
      try {
        const uUp = await listen<TransferProgressPayload>('upload-progress', (e) => {
          if (isSubscribed) handleProgress(e.payload);
        });
        const uDown = await listen<TransferProgressPayload>('download-progress', (e) => {
          if (isSubscribed) handleProgress(e.payload);
        });

        if (isSubscribed) {
          unlistenUpload = uUp;
          unlistenDownload = uDown;
        } else {
          uUp();
          uDown();
        }
      } catch (err) {
        console.warn('Failed to subscribe to Tauri transfer events:', err);
      }
    };

    subscribe();

    const speedHistory = speedHistoryRef.current;

    return () => {
      isSubscribed = false;
      unlistenUpload?.();
      unlistenDownload?.();
      speedHistory.clear();
    };
  }, []);
}
