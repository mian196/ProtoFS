import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CloseAppModal } from '../CloseAppModal';
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
    exitApp: vi.fn().mockResolvedValue(undefined),
    minimizeWindow: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../api/client', () => ({
  isTauri: vi.fn().mockReturnValue(false),
}));

describe('CloseAppModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.getState().resetDefaults();
  });

  it('renders title, choices, and remember checkbox when open', () => {
    render(<CloseAppModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Close ProtoFS')).toBeInTheDocument();
    expect(screen.getByText('Minimize to System Tray')).toBeInTheDocument();
    expect(screen.getByText('Exit Application')).toBeInTheDocument();
    expect(screen.getByText('Remember my choice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Minimize to Tray/i })).toBeInTheDocument();
  });

  it('does not render content when isOpen is false', () => {
    render(<CloseAppModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Close ProtoFS')).not.toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const handleClose = vi.fn();
    render(<CloseAppModal isOpen={true} onClose={handleClose} />);

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('updates closeAction in store when remember choice is checked and confirmed', async () => {
    const handleClose = vi.fn();
    render(<CloseAppModal isOpen={true} onClose={handleClose} />);

    // Select Exit Application
    const exitOption = screen.getByText('Exit Application');
    fireEvent.click(exitOption);

    // Check "Remember my choice"
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    // Confirm
    const confirmBtn = screen.getByRole('button', { name: /Exit ProtoFS/i });
    fireEvent.click(confirmBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().closeAction).toBe('exit');
  });

  it('does not update closeAction in store when remember choice is unchecked', async () => {
    const handleClose = vi.fn();
    render(<CloseAppModal isOpen={true} onClose={handleClose} />);

    // Select Exit Application
    const exitOption = screen.getByText('Exit Application');
    fireEvent.click(exitOption);

    // Confirm without checking checkbox
    const confirmBtn = screen.getByRole('button', { name: /Exit ProtoFS/i });
    fireEvent.click(confirmBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().closeAction).toBe('prompt');
  });
});
