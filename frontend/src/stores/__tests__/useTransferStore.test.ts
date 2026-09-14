import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTransferStore } from '../useTransferStore';
import type { TransferItem } from '../../types';

describe('useTransferStore telemetry & queue management', () => {
  beforeEach(() => {
    useTransferStore.setState({
      transfers: [],
      isOpen: false,
    });
  });

  test('addTransfer sets item in store and opens transfer queue', () => {
    const item: TransferItem = {
      id: 'tx_1',
      name: 'archive.tar.gz',
      size: '10 MB',
      size_bytes: 10 * 1024 * 1024,
      total_bytes: 10 * 1024 * 1024,
      bytes_transferred: 0,
      progress: 0,
      speed: 'Starting...',
      speed_bytes_sec: 0,
      status: 'uploading',
    };

    useTransferStore.getState().addTransfer(item);

    const state = useTransferStore.getState();
    assert.equal(state.transfers.length, 1);
    assert.equal(state.transfers[0].id, 'tx_1');
    assert.equal(state.isOpen, true);
  });

  test('updateTransfer handles partial object telemetry updates atomically', () => {
    const item: TransferItem = {
      id: 'tx_2',
      name: 'video.mp4',
      size: '50 MB',
      total_bytes: 50 * 1024 * 1024,
      bytes_transferred: 0,
      progress: 0,
      speed: '0 B/s',
      status: 'downloading',
    };
    useTransferStore.getState().addTransfer(item);

    useTransferStore.getState().updateTransfer('tx_2', {
      bytes_transferred: 25 * 1024 * 1024,
      progress: 50,
      speed: '5.0 MB/s',
      speed_bytes_sec: 5 * 1024 * 1024,
      eta: '5s',
      eta_secs: 5,
    });

    const tx = useTransferStore.getState().transfers[0];
    assert.equal(tx.bytes_transferred, 25 * 1024 * 1024);
    assert.equal(tx.progress, 50);
    assert.equal(tx.speed, '5.0 MB/s');
    assert.equal(tx.speed_bytes_sec, 5 * 1024 * 1024);
    assert.equal(tx.eta, '5s');
    assert.equal(tx.status, 'downloading');
  });

  test('updateTransfer automatically transitions to completed when progress hits 100', () => {
    const item: TransferItem = {
      id: 'tx_3',
      name: 'doc.pdf',
      size: '1 MB',
      total_bytes: 1024 * 1024,
      progress: 0,
      speed: '1 MB/s',
      status: 'uploading',
    };
    useTransferStore.getState().addTransfer(item);

    useTransferStore.getState().updateTransfer('tx_3', 100, '0 B/s');

    const tx = useTransferStore.getState().transfers[0];
    assert.equal(tx.progress, 100);
    assert.equal(tx.status, 'completed');
  });

  test('getAggregateStats computes authentic queue metrics', () => {
    useTransferStore.getState().addTransfer({
      id: 'tx_active',
      name: 'active.bin',
      size: '20 MB',
      total_bytes: 20 * 1024 * 1024,
      bytes_transferred: 10 * 1024 * 1024,
      progress: 50,
      speed: '2 MB/s',
      speed_bytes_sec: 2 * 1024 * 1024,
      status: 'uploading',
    });

    useTransferStore.getState().addTransfer({
      id: 'tx_done',
      name: 'done.bin',
      size: '10 MB',
      total_bytes: 10 * 1024 * 1024,
      bytes_transferred: 10 * 1024 * 1024,
      progress: 100,
      speed: '0 B/s',
      status: 'completed',
    });

    useTransferStore.getState().addTransfer({
      id: 'tx_failed',
      name: 'fail.bin',
      size: '5 MB',
      total_bytes: 5 * 1024 * 1024,
      bytes_transferred: 0,
      progress: 0,
      speed: '0 B/s',
      status: 'failed',
      error: 'Network timeout',
    });

    const stats = useTransferStore.getState().getAggregateStats();
    assert.equal(stats.activeCount, 1);
    assert.equal(stats.completedCount, 1);
    assert.equal(stats.failedCount, 1);
    assert.equal(stats.totalBytesTransferred, 20 * 1024 * 1024);
    assert.equal(stats.totalQueueBytes, 35 * 1024 * 1024);
    assert.equal(stats.overallPercent, Math.round((20 / 35) * 100));
    assert.equal(stats.aggregateSpeedBytesSec, 2 * 1024 * 1024);
  });

  test('clearCompleted preserves active and failed transfers', () => {
    useTransferStore.getState().addTransfer({
      id: 'tx_1',
      name: '1.bin',
      size: '1 MB',
      progress: 100,
      speed: '0 B/s',
      status: 'completed',
    });
    useTransferStore.getState().addTransfer({
      id: 'tx_2',
      name: '2.bin',
      size: '1 MB',
      progress: 40,
      speed: '1 MB/s',
      status: 'uploading',
    });
    useTransferStore.getState().addTransfer({
      id: 'tx_3',
      name: '3.bin',
      size: '1 MB',
      progress: 0,
      speed: '0 B/s',
      status: 'failed',
    });

    useTransferStore.getState().clearCompleted();

    const remaining = useTransferStore.getState().transfers;
    assert.equal(remaining.length, 2);
    assert.ok(remaining.some((t) => t.id === 'tx_2'));
    assert.ok(remaining.some((t) => t.id === 'tx_3'));
    assert.ok(!remaining.some((t) => t.id === 'tx_1'));
  });
});
