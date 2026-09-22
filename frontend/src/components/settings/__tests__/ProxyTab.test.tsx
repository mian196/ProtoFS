import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProxyTab } from '../ProxyTab';
import { useProxyStore } from '../../../stores/useProxyStore';
import * as confirmStore from '../../../stores/useConfirmStore';
import { proxyApi } from '../../../api/proxy';
import type { ProxyProfile, ProxyProfileSummary, ProxyDiagnosticResult } from '../../../types';

vi.mock('../../../api/proxy', () => ({
  proxyApi: {
    getProxies: vi.fn(),
    getProxy: vi.fn(),
    saveProxy: vi.fn(),
    deleteProxy: vi.fn(),
    setActiveProxy: vi.fn(),
    toggleProxyEnabled: vi.fn(),
    testProxyConnection: vi.fn(),
    getProxyStatus: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('ProxyTab Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset Zustand store state
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

    vi.mocked(proxyApi.getProxies).mockResolvedValue([]);
    vi.mocked(proxyApi.getProxyStatus).mockResolvedValue({
      is_enabled: false,
      active_proxy: null,
      total_proxies: 0,
    });
  });

  it('renders empty state when no proxy profiles are configured', async () => {
    render(<ProxyTab />);

    await waitFor(() => {
      expect(screen.getByText('No Proxy Profiles Configured')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Add an MTProto, SOCKS5, or HTTP proxy to route Telegram traffic/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText('Add Proxy Profile')[0]).toBeInTheDocument();
    expect(screen.getByText('0 proxy profiles configured')).toBeInTheDocument();
  });

  it('toggles global proxy routing switch', async () => {
    vi.mocked(proxyApi.toggleProxyEnabled).mockResolvedValue(undefined);

    render(<ProxyTab />);

    const toggle = screen.getByLabelText('Toggle Telegram proxy routing');
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Disabled')).toBeInTheDocument();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(proxyApi.toggleProxyEnabled).toHaveBeenCalledWith(true);
    });
  });

  it('parses quick-import link and opens editor drawer with Fake-TLS SNI preview', async () => {
    render(<ProxyTab />);

    const quickImportInput = screen.getByPlaceholderText(
      'Paste tg://proxy?server=... or https://t.me/proxy?...'
    );

    // Fake-TLS secret with www.google.com in hex (7777772e676f6f676c652e636f6d)
    const fakeTlsLink =
      'tg://proxy?server=149.154.167.50&port=443&secret=ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d';

    fireEvent.change(quickImportInput, { target: { value: fakeTlsLink } });

    await waitFor(() => {
      expect(screen.getByText('Add Proxy Profile')).toBeInTheDocument();
      expect(screen.getByDisplayValue('149.154.167.50')).toBeInTheDocument();
      expect(screen.getByDisplayValue('443')).toBeInTheDocument();
      expect(screen.getByText(/Fake-TLS SNI Domain: www\.google\.com/i)).toBeInTheDocument();
    });
  });

  it('renders saved profile cards with masked secret and latency badge', async () => {
    const mockSummary: ProxyProfileSummary = {
      id: 'proxy-1',
      label: 'Main MTProto Proxy',
      proxy_type: 'mtproto',
      host: '149.154.167.50',
      port: 443,
      masked_secret: 'ee01••••6f6d',
      has_password: false,
      is_active: true,
      created_at: '2026-09-22T00:00:00Z',
      updated_at: '2026-09-22T00:00:00Z',
    };

    const mockDiagnostic: ProxyDiagnosticResult = {
      is_connected: true,
      latency_ms: 48,
      target_dc: 2,
      target_endpoint: '149.154.167.50:443',
      error_code: null,
      message: 'Connected',
    };

    vi.mocked(proxyApi.getProxies).mockResolvedValue([mockSummary]);

    useProxyStore.setState({
      proxies: [mockSummary],
      activeProxyId: 'proxy-1',
      isEnabled: true,
      testResults: {
        'proxy-1': mockDiagnostic,
      },
    });

    render(<ProxyTab />);

    await waitFor(() => {
      expect(screen.getByText('Main MTProto Proxy')).toBeInTheDocument();
    });

    expect(screen.getByText('149.154.167.50:443')).toBeInTheDocument();
    expect(screen.getByText(/• Secret: ee01••••6f6d/i)).toBeInTheDocument();
    expect(screen.getByText('48ms')).toBeInTheDocument();
    expect(screen.getByText('Fake-TLS (ee)')).toBeInTheDocument();
    expect(screen.getByText('1 proxy profile configured')).toBeInTheDocument();

    // Verify zero plaintext secrets in DOM
    expect(screen.queryByText(/0123456789abcdef/i)).not.toBeInTheDocument();
  });

  it('triggers connection diagnostic ping from list card and updates latency badge', async () => {
    const mockSummary: ProxyProfileSummary = {
      id: 'proxy-1',
      label: 'Main MTProto Proxy',
      proxy_type: 'mtproto',
      host: '149.154.167.50',
      port: 443,
      masked_secret: 'ee01••••6f6d',
      has_password: false,
      is_active: true,
      created_at: '2026-09-22T00:00:00Z',
      updated_at: '2026-09-22T00:00:00Z',
    };

    const fullProfile: ProxyProfile = {
      id: 'proxy-1',
      label: 'Main MTProto Proxy',
      proxy_type: 'mtproto',
      host: '149.154.167.50',
      port: 443,
      secret: 'ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d',
      is_active: true,
      created_at: '2026-09-22T00:00:00Z',
      updated_at: '2026-09-22T00:00:00Z',
    };

    vi.mocked(proxyApi.getProxies).mockResolvedValue([mockSummary]);
    vi.mocked(proxyApi.getProxy).mockResolvedValue(fullProfile);
    vi.mocked(proxyApi.testProxyConnection).mockResolvedValue({
      is_connected: true,
      latency_ms: 62,
      target_dc: 2,
      target_endpoint: '149.154.167.50:443',
      error_code: null,
      message: 'Connected',
    });

    useProxyStore.setState({
      proxies: [mockSummary],
      activeProxyId: 'proxy-1',
    });

    render(<ProxyTab />);

    await waitFor(() => {
      expect(screen.getByText('Main MTProto Proxy')).toBeInTheDocument();
    });

    const testBtn = screen.getByTitle('Test Connection');
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(proxyApi.getProxy).toHaveBeenCalledWith('proxy-1');
      expect(proxyApi.testProxyConnection).toHaveBeenCalled();
      expect(screen.getByText('62ms')).toBeInTheDocument();
    });
  });

  it('fetches full decrypted credentials when editing profile', async () => {
    const mockSummary: ProxyProfileSummary = {
      id: 'proxy-1',
      label: 'Main MTProto Proxy',
      proxy_type: 'mtproto',
      host: '149.154.167.50',
      port: 443,
      masked_secret: 'ee01••••6f6d',
      has_password: false,
      is_active: true,
      created_at: '2026-09-22T00:00:00Z',
      updated_at: '2026-09-22T00:00:00Z',
    };

    const fullProfile: ProxyProfile = {
      id: 'proxy-1',
      label: 'Main MTProto Proxy',
      proxy_type: 'mtproto',
      host: '149.154.167.50',
      port: 443,
      secret: 'ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d',
      is_active: true,
      created_at: '2026-09-22T00:00:00Z',
      updated_at: '2026-09-22T00:00:00Z',
    };

    vi.mocked(proxyApi.getProxies).mockResolvedValue([mockSummary]);
    vi.mocked(proxyApi.getProxy).mockResolvedValue(fullProfile);

    useProxyStore.setState({
      proxies: [mockSummary],
      activeProxyId: 'proxy-1',
    });

    render(<ProxyTab />);

    await waitFor(() => {
      expect(screen.getByText('Main MTProto Proxy')).toBeInTheDocument();
    });

    const editBtn = screen.getByTitle('Edit Profile');
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(proxyApi.getProxy).toHaveBeenCalledWith('proxy-1');
      expect(screen.getByText('Edit Proxy Profile')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Main MTProto Proxy')).toBeInTheDocument();
      expect(
        screen.getByDisplayValue(
          'ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d'
        )
      ).toBeInTheDocument();
    });
  });

  it('prompts confirmation dialog and deletes profile on confirmation', async () => {
    const mockSummary: ProxyProfileSummary = {
      id: 'proxy-1',
      label: 'Old Backup Proxy',
      proxy_type: 'socks5',
      host: '192.168.1.100',
      port: 1080,
      has_password: false,
      is_active: false,
      created_at: '2026-09-22T00:00:00Z',
      updated_at: '2026-09-22T00:00:00Z',
    };

    vi.mocked(proxyApi.getProxies).mockResolvedValue([mockSummary]);
    const confirmSpy = vi.spyOn(confirmStore, 'confirmDialog').mockResolvedValue(true);
    vi.mocked(proxyApi.deleteProxy).mockResolvedValue(undefined);

    useProxyStore.setState({
      proxies: [mockSummary],
    });

    render(<ProxyTab />);

    await waitFor(() => {
      expect(screen.getByText('Old Backup Proxy')).toBeInTheDocument();
    });

    const deleteBtn = screen.getByTitle('Delete Profile');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Delete Proxy Profile',
          message: expect.stringContaining('Old Backup Proxy'),
          variant: 'danger',
          confirmText: 'Delete Profile',
          cancelText: 'Cancel',
        })
      );
      expect(proxyApi.deleteProxy).toHaveBeenCalledWith('proxy-1');
    });
  });

  it('validates form fields before saving in editor drawer', async () => {
    render(<ProxyTab />);

    // Click Add Proxy Profile
    const addBtn = screen.getAllByText('Add Proxy Profile')[0];
    fireEvent.click(addBtn);

    expect(screen.getByText('Add Proxy Profile')).toBeInTheDocument();

    // Click Save without filling required fields
    const saveBtn = screen.getByText('Save Proxy Profile');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText('Host / IP address is required')).toBeInTheDocument();
      expect(screen.getByText('Secret is required for MTProto proxy')).toBeInTheDocument();
    });

    expect(proxyApi.saveProxy).not.toHaveBeenCalled();
  });
});
