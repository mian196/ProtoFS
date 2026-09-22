import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AuthModal } from '../AuthModal';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useProxyStore } from '../../../stores/useProxyStore';
import { useModalStore } from '../../../stores/useModalStore';
import { api } from '../../../api';
import type { ProxyProfileSummary, ProxyDiagnosticResult } from '../../../types';

vi.mock('../../../api', () => ({
  api: {
    loginRequestQr: vi.fn(),
    loginCheckQr: vi.fn(),
    loginSendCode: vi.fn(),
    loginVerifyCode: vi.fn(),
    loginVerify2Fa: vi.fn(),
  },
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockQrCode'),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('AuthModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useAuthStore.setState({
      session: null,
      requires2fa: false,
      phoneCodeHash: null,
      connectionStatus: 'disconnected',
    });

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
      activeModal: 'auth',
      payload: {},
    });

    vi.mocked(api.loginRequestQr).mockResolvedValue({
      status: 'waiting_scan',
      session: null,
      token_url: 'tg://login?token=mock_token_123',
      expires_in_sec: 120,
    });

    vi.mocked(api.loginCheckQr).mockResolvedValue({
      status: 'waiting_scan',
      session: null,
      token_url: 'tg://login?token=mock_token_123',
      expires_in_sec: 120,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders pre-auth Direct proxy pill when proxy routing is disabled', async () => {
    render(<AuthModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Telegram MTProto Authentication')).toBeInTheDocument();
    expect(screen.getByText('Proxy: Direct')).toBeInTheDocument();

    await waitFor(() => {
      expect(api.loginRequestQr).toHaveBeenCalled();
    });
  });

  it('renders active MTProto proxy pill with protocol and latency in header', async () => {
    const mockSummary: ProxyProfileSummary = {
      id: 'proxy-mtproto-1',
      label: 'Main MTProto Proxy',
      proxy_type: 'mtproto',
      host: '149.154.167.50',
      port: 443,
      has_password: false,
      is_active: true,
      created_at: '2026-09-22T00:00:00Z',
      updated_at: '2026-09-22T00:00:00Z',
    };

    const mockDiagnostic: ProxyDiagnosticResult = {
      is_connected: true,
      latency_ms: 42,
      target_dc: 2,
      target_endpoint: '149.154.167.50:443',
      error_code: null,
      message: 'Connected',
    };

    useProxyStore.setState({
      proxies: [mockSummary],
      activeProxyId: 'proxy-mtproto-1',
      isEnabled: true,
      testResults: {
        'proxy-mtproto-1': mockDiagnostic,
      },
    });

    render(<AuthModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Proxy: MTPROTO • 42ms')).toBeInTheDocument();

    await waitFor(() => {
      expect(api.loginRequestQr).toHaveBeenCalled();
    });
  });

  it('opens settings modal directly to proxy tab when clicking pre-auth proxy pill', async () => {
    const openModalSpy = vi.spyOn(useModalStore.getState(), 'openModal');

    render(<AuthModal isOpen={true} onClose={vi.fn()} />);

    const proxyPill = screen.getByTitle('Configure MTProto / SOCKS5 proxy before login');
    fireEvent.click(proxyPill);

    expect(openModalSpy).toHaveBeenCalledWith('settings', { defaultTab: 'proxy' });

    await waitFor(() => {
      expect(api.loginRequestQr).toHaveBeenCalled();
    });
  });

  it('triggers dynamic QR refresh when proxy state transitions while in QR mode', async () => {
    render(<AuthModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(api.loginRequestQr).toHaveBeenCalledTimes(1);
    });

    // Simulate activating proxy while login modal is open in QR mode
    const mockSummary: ProxyProfileSummary = {
      id: 'proxy-socks-1',
      label: 'Fast SOCKS5',
      proxy_type: 'socks5',
      host: '127.0.0.1',
      port: 1080,
      has_password: false,
      is_active: true,
      created_at: '2026-09-22T00:00:00Z',
      updated_at: '2026-09-22T00:00:00Z',
    };

    act(() => {
      useProxyStore.setState({
        proxies: [mockSummary],
        activeProxyId: 'proxy-socks-1',
        isEnabled: true,
      });
    });

    await waitFor(() => {
      // loginRequestQr should be called a second time due to proxy change
      expect(api.loginRequestQr).toHaveBeenCalledTimes(2);
    });
  });

  it('provides interactive buttons complying with verb + noun copywriting contract', async () => {
    render(<AuthModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(api.loginRequestQr).toHaveBeenCalled();
    });

    expect(screen.getByText('Generate / Refresh')).toBeInTheDocument();

    // Switch to phone mode
    fireEvent.click(screen.getByText('Phone Number'));
    expect(screen.getByText('Send Login Code')).toBeInTheDocument();
  });
});
