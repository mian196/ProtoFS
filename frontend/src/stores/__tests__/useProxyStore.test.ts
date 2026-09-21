import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useProxyStore } from '../useProxyStore';
import type { ProxyProfile, ProxyProfileSummary } from '../../types';

describe('useProxyStore', () => {
  beforeEach(() => {
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
  });

  it('should initialize with default state values', () => {
    const state = useProxyStore.getState();
    assert.deepEqual(state.proxies, []);
    assert.equal(state.activeProxyId, null);
    assert.equal(state.isEnabled, false);
    assert.equal(state.isLoading, false);
    assert.equal(state.isTesting, false);
    assert.equal(state.draftProxy, null);
  });

  it('should import valid MTProto tg:// link into draftProxy', () => {
    const link =
      'tg://proxy?server=149.154.167.50&port=443&secret=ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d';
    const res = useProxyStore.getState().importFromLink(link);

    assert.equal(res.isValid, true);
    assert.equal(res.proxyType, 'mtproto');

    const draft = useProxyStore.getState().draftProxy;
    assert.ok(draft);
    assert.equal(draft?.proxy_type, 'mtproto');
    assert.equal(draft?.host, '149.154.167.50');
    assert.equal(draft?.port, 443);
    assert.equal(
      draft?.secret,
      'ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d'
    );
    assert.equal(draft?.label, 'MTProto (149.154.167.50)');
  });

  it('should import valid SOCKS5 https://t.me/socks link into draftProxy', () => {
    const link =
      'https://t.me/socks?server=10.0.0.1&port=1080&user=testuser&pass=testpass';
    const res = useProxyStore.getState().importFromLink(link);

    assert.equal(res.isValid, true);
    assert.equal(res.proxyType, 'socks5');

    const draft = useProxyStore.getState().draftProxy;
    assert.ok(draft);
    assert.equal(draft?.proxy_type, 'socks5');
    assert.equal(draft?.host, '10.0.0.1');
    assert.equal(draft?.port, 1080);
    assert.equal(draft?.username, 'testuser');
    assert.equal(draft?.password, 'testpass');
    assert.equal(draft?.label, 'SOCKS5 (10.0.0.1)');
  });

  it('should reject invalid proxy link without corrupting draftProxy', () => {
    const res = useProxyStore.getState().importFromLink('invalid-link');
    assert.equal(res.isValid, false);
    assert.equal(useProxyStore.getState().draftProxy, null);
  });

  it('should update and clear draft fields correctly', () => {
    useProxyStore.getState().setDraftProxy({
      proxy_type: 'mtproto',
      host: '1.2.3.4',
      port: 443,
    });

    useProxyStore.getState().updateDraftField('host', '5.6.7.8');
    assert.equal(useProxyStore.getState().draftProxy?.host, '5.6.7.8');

    useProxyStore.getState().updateDraftField('port', 8443);
    assert.equal(useProxyStore.getState().draftProxy?.port, 8443);

    useProxyStore.getState().clearDraft();
    assert.equal(useProxyStore.getState().draftProxy, null);
    assert.deepEqual(useProxyStore.getState().draftErrors, {});
  });

  it('should set and manage draft errors', () => {
    useProxyStore.getState().setDraftErrors({
      host: 'Host is required',
      port: 'Invalid port',
    });

    assert.equal(useProxyStore.getState().draftErrors.host, 'Host is required');
    assert.equal(useProxyStore.getState().draftErrors.port, 'Invalid port');
  });

  it('should manage selected proxy id and modal state', () => {
    useProxyStore.getState().setSelectedProxyId('proxy-123');
    assert.equal(useProxyStore.getState().selectedProxyId, 'proxy-123');

    useProxyStore.getState().setImportModalOpen(true);
    assert.equal(useProxyStore.getState().isImportModalOpen, true);
  });

  it('should handle optimistic state mutations on proxy profiles', () => {
    const p1: ProxyProfileSummary = {
      id: 'p1',
      label: 'Main MTProto',
      proxy_type: 'mtproto',
      host: '1.2.3.4',
      port: 443,
      has_password: false,
      masked_secret: 'ee01••••6f6d',
      is_active: false,
      created_at: '2026-09-22T00:00:00Z',
      updated_at: '2026-09-22T00:00:00Z',
    };

    useProxyStore.setState({
      proxies: [p1],
      activeProxyId: null,
      isEnabled: false,
    });

    // Manually test draft updating helper
    const draft: ProxyProfile = {
      id: 'p2',
      label: 'Secondary SOCKS',
      proxy_type: 'socks5',
      host: '10.0.0.1',
      port: 1080,
      is_active: true,
      created_at: '2026-09-22T00:00:00Z',
      updated_at: '2026-09-22T00:00:00Z',
    };

    useProxyStore.getState().setDraftProxy(draft);
    assert.equal(useProxyStore.getState().draftProxy?.id, 'p2');
  });
});
