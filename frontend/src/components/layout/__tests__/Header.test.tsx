import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../Header';
import { useProxyStore } from '../../../stores/useProxyStore';
import { useModalStore } from '../../../stores/useModalStore';
import { useDriveStore } from '../../../stores/useDriveStore';
import { useVfsStore } from '../../../stores/useVfsStore';
import type { ProxyProfileSummary, ProxyDiagnosticResult } from '../../../types';

describe('Header Component', () => {
  const mockOnUploadClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    useProxyStore.setState({
      proxies: [],
      activeProxyId: null,
      isEnabled: false,
      isLoading: false,
      isTesting: false,
      testingProxyIds: {},
      testResults: {},
      selectedProxyId: null,
      draftProxy: null,
      draftErrors: {},
      isImportModalOpen: false,
    });

    useModalStore.setState({
      activeModal: null,
      payload: {},
    });

    useDriveStore.setState({
      drives: [],
      activeDrive: null,
      driveAccessibility: {},
      isDriveAccessible: true,
      isLoading: false,
    });

    useVfsStore.setState({
      viewMode: 'grid',
      searchQuery: '',
      folders: [],
      files: [],
      selectedIds: new Set(),
      breadcrumbs: [],
    });
  });

  it('renders Direct badge when proxy routing is disabled or inactive', () => {
    render(<Header onUploadClick={mockOnUploadClick} />);

    const badge = screen.getByTitle('Click to configure Telegram MTProto / SOCKS5 Proxy');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Direct');
  });

  it('renders protocol and latency when proxy routing is active', () => {
    const mockSummary: ProxyProfileSummary = {
      id: 'proxy-socks-1',
      label: 'SOCKS5 Proxy',
      proxy_type: 'socks5',
      host: '127.0.0.1',
      port: 1080,
      has_password: false,
      is_active: true,
      created_at: '2026-09-22T00:00:00Z',
      updated_at: '2026-09-22T00:00:00Z',
    };

    const mockDiagnostic: ProxyDiagnosticResult = {
      is_connected: true,
      latency_ms: 82,
      target_dc: 2,
      target_endpoint: '127.0.0.1:1080',
      error_code: null,
      message: 'Connected',
    };

    useProxyStore.setState({
      proxies: [mockSummary],
      activeProxyId: 'proxy-socks-1',
      isEnabled: true,
      testResults: {
        'proxy-socks-1': mockDiagnostic,
      },
    });

    render(<Header onUploadClick={mockOnUploadClick} />);

    const badge = screen.getByTitle('Click to configure Telegram MTProto / SOCKS5 Proxy');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('SOCKS5 • 82ms');

    // Verify zero host/port or internal sensitive strings leaked in header
    expect(screen.queryByText(/127\.0\.0\.1/i)).not.toBeInTheDocument();
  });

  it('clicking proxy badge opens SettingsModal directly to proxy tab', () => {
    const openModalSpy = vi.spyOn(useModalStore.getState(), 'openModal');

    render(<Header onUploadClick={mockOnUploadClick} />);

    const badge = screen.getByTitle('Click to configure Telegram MTProto / SOCKS5 Proxy');
    fireEvent.click(badge);

    expect(openModalSpy).toHaveBeenCalledWith('settings', { defaultTab: 'proxy' });
  });

  it('triggers upload callback when Upload Files button is clicked', () => {
    render(<Header onUploadClick={mockOnUploadClick} />);

    const uploadBtn = screen.getByTitle('Upload Files');
    fireEvent.click(uploadBtn);

    expect(mockOnUploadClick).toHaveBeenCalledTimes(1);
  });
});
