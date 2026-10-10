import { beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { useSettingsStore } from '../useSettingsStore';

describe('useSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().resetDefaults();
  });

  it('should initialize with default closeAction as "prompt"', () => {
    const state = useSettingsStore.getState();
    assert.equal(state.closeAction, 'prompt');
  });

  it('should update closeAction to "minimize" and persist to localStorage', () => {
    useSettingsStore.getState().updateSettings({ closeAction: 'minimize', closeToTray: true });

    const state = useSettingsStore.getState();
    assert.equal(state.closeAction, 'minimize');
    assert.equal(state.closeToTray, true);

    const stored = JSON.parse(localStorage.getItem('protofs_user_settings') || '{}');
    assert.equal(stored.closeAction, 'minimize');
  });

  it('should update closeAction to "exit" and persist to localStorage', () => {
    useSettingsStore.getState().updateSettings({ closeAction: 'exit', closeToTray: false });

    const state = useSettingsStore.getState();
    assert.equal(state.closeAction, 'exit');
    assert.equal(state.closeToTray, false);

    const stored = JSON.parse(localStorage.getItem('protofs_user_settings') || '{}');
    assert.equal(stored.closeAction, 'exit');
  });

  it('should reset defaults correctly', () => {
    useSettingsStore.getState().updateSettings({ closeAction: 'exit' });
    assert.equal(useSettingsStore.getState().closeAction, 'exit');

    useSettingsStore.getState().resetDefaults();
    assert.equal(useSettingsStore.getState().closeAction, 'prompt');
  });
});
