import { it as test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { useConfirmStore, confirmDialog } from '../useConfirmStore';

describe('useConfirmStore & confirmDialog', () => {
  beforeEach(() => {
    useConfirmStore.setState({
      isOpen: false,
      options: null,
      resolver: null,
    });
  });

  test('confirmDialog opens dialog state and resolves true when confirmAction is invoked', async () => {
    const dialogPromise = confirmDialog({
      title: 'Unlink Drive',
      message: 'Are you sure?',
      variant: 'danger',
      icon: 'trash',
      confirmText: 'Unlink',
    });

    const state = useConfirmStore.getState();
    assert.equal(state.isOpen, true);
    assert.equal(state.options?.title, 'Unlink Drive');
    assert.equal(state.options?.variant, 'danger');
    assert.equal(typeof state.resolver, 'function');

    // Confirm action
    useConfirmStore.getState().confirmAction();

    const result = await dialogPromise;
    assert.equal(result, true);

    const finalState = useConfirmStore.getState();
    assert.equal(finalState.isOpen, false);
    assert.equal(finalState.options, null);
    assert.equal(finalState.resolver, null);
  });

  test('confirmDialog resolves false when cancelAction is invoked', async () => {
    const dialogPromise = confirmDialog({
      title: 'Confirm Action',
      message: 'Do you want to proceed?',
      variant: 'info',
    });

    assert.equal(useConfirmStore.getState().isOpen, true);

    // Cancel action
    useConfirmStore.getState().cancelAction();

    const result = await dialogPromise;
    assert.equal(result, false);

    assert.equal(useConfirmStore.getState().isOpen, false);
  });

  test('confirmDialog resolves false when close is invoked', async () => {
    const dialogPromise = confirmDialog({
      title: 'Warning',
      message: 'Careful here',
      variant: 'warning',
      tip: 'Remember to backup',
    });

    assert.equal(useConfirmStore.getState().options?.tip, 'Remember to backup');

    // Close action
    useConfirmStore.getState().close();

    const result = await dialogPromise;
    assert.equal(result, false);
    assert.equal(useConfirmStore.getState().isOpen, false);
  });

  test('consecutive confirmDialog calls safely cancel previous unresolved promise', async () => {
    const firstPromise = confirmDialog({
      title: 'First Dialog',
      message: 'First Message',
    });

    assert.equal(useConfirmStore.getState().options?.title, 'First Dialog');

    const secondPromise = confirmDialog({
      title: 'Second Dialog',
      message: 'Second Message',
    });

    // First dialog should immediately resolve false due to displacement
    const firstResult = await firstPromise;
    assert.equal(firstResult, false);

    assert.equal(useConfirmStore.getState().options?.title, 'Second Dialog');

    // Confirm second dialog
    useConfirmStore.getState().confirmAction();
    const secondResult = await secondPromise;
    assert.equal(secondResult, true);
  });
});
