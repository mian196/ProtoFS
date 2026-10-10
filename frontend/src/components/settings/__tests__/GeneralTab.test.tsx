import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GeneralTab } from '../GeneralTab';
import { useSettingsStore } from '../../../stores/useSettingsStore';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../../api', () => ({
  api: {
    checkForUpdates: vi.fn().mockResolvedValue({
      current_version: '0.4.3',
      latest_version: '0.4.3',
      update_available: false,
    }),
  },
}));

describe('GeneralTab Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.getState().resetDefaults();
  });

  it('renders Window Close Behavior options correctly', () => {
    render(<GeneralTab />);

    expect(screen.getByText('Window Close Behavior')).toBeInTheDocument();
    expect(screen.getByText('Always Ask')).toBeInTheDocument();
    expect(screen.getByText('Minimize to Tray')).toBeInTheDocument();
    expect(screen.getByText('Exit Application')).toBeInTheDocument();
  });

  it('updates closeAction when Minimize to Tray is clicked', () => {
    render(<GeneralTab />);

    const minimizeBtn = screen.getByText('Minimize to Tray').closest('button');
    expect(minimizeBtn).toBeInTheDocument();
    if (minimizeBtn) fireEvent.click(minimizeBtn);

    expect(useSettingsStore.getState().closeAction).toBe('minimize');
    expect(useSettingsStore.getState().closeToTray).toBe(true);
  });

  it('updates closeAction when Exit Application is clicked', () => {
    render(<GeneralTab />);

    const exitBtn = screen.getByText('Exit Application').closest('button');
    expect(exitBtn).toBeInTheDocument();
    if (exitBtn) fireEvent.click(exitBtn);

    expect(useSettingsStore.getState().closeAction).toBe('exit');
    expect(useSettingsStore.getState().closeToTray).toBe(false);
  });

  it('updates closeAction back to Always Ask', () => {
    useSettingsStore.getState().updateSettings({ closeAction: 'exit' });
    render(<GeneralTab />);

    const alwaysAskBtn = screen.getByText('Always Ask').closest('button');
    expect(alwaysAskBtn).toBeInTheDocument();
    if (alwaysAskBtn) fireEvent.click(alwaysAskBtn);

    expect(useSettingsStore.getState().closeAction).toBe('prompt');
  });
});
