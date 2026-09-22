import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { isTauri } from '../api/client';
import { proxyApi } from '../api/proxy';
import { parseProxyLink } from '../utils/proxyLinkParser';
import { useAuthStore } from './useAuthStore';
import type {
  ParsedProxyResult,
  ProxyConfig,
  ProxyDiagnosticResult,
  ProxyProfile,
  ProxyProfileSummary,
  ProxyStateChangedPayload,
  ProxyStatusResponse,
} from '../types';

export interface ProxyState {
  proxies: ProxyProfileSummary[];
  activeProxyId: string | null;
  isEnabled: boolean;
  isLoading: boolean;
  isTesting: boolean;
  testingProxyIds: Record<string, boolean>;
  testResults: Record<string, ProxyDiagnosticResult>;
  selectedProxyId: string | null;
  draftProxy: Partial<ProxyProfile> | null;
  draftErrors: Record<string, string | null>;
  isImportModalOpen: boolean;
}

export interface ProxyActions {
  loadProxies: () => Promise<void>;
  saveProxy: (profile: ProxyProfile) => Promise<boolean>;
  deleteProxy: (id: string) => Promise<boolean>;
  setActiveProxy: (id: string | null) => Promise<boolean>;
  toggleProxyEnabled: (enabled: boolean) => Promise<boolean>;
  testProxy: (
    config?: ProxyConfig | null,
    proxyId?: string,
    targetDc?: number
  ) => Promise<ProxyDiagnosticResult>;
  importFromLink: (link: string) => ParsedProxyResult;
  setDraftProxy: (draft: Partial<ProxyProfile> | null) => void;
  updateDraftField: <K extends keyof ProxyProfile>(key: K, value: ProxyProfile[K]) => void;
  setDraftErrors: (errors: Record<string, string | null>) => void;
  clearDraft: () => void;
  setSelectedProxyId: (id: string | null) => void;
  setImportModalOpen: (open: boolean) => void;
  initEventListener: () => Promise<() => void>;
}

export const useProxyStore = create<ProxyState & ProxyActions>((set, get) => ({
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

  loadProxies: async () => {
    set({ isLoading: true });
    try {
      const [statusRes, listRes]: [ProxyStatusResponse, ProxyProfileSummary[]] = await Promise.all([
        proxyApi.getProxyStatus(),
        proxyApi.getProxies(),
      ]);

      const activeId = statusRes.active_proxy?.id ?? listRes.find((p) => p.is_active)?.id ?? null;

      set({
        isEnabled: statusRes.is_enabled,
        activeProxyId: activeId,
        proxies: listRes,
        isLoading: false,
      });
    } catch (err) {
      console.error('Failed to load proxy settings:', err);
      set({ isLoading: false });
    }
  },

  saveProxy: async (profile: ProxyProfile) => {
    const prevProxies = get().proxies;
    const prevActiveId = get().activeProxyId;

    // Optimistic summary update
    const summary: ProxyProfileSummary = {
      id: profile.id,
      label: profile.label,
      proxy_type: profile.proxy_type,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      has_password: Boolean(profile.password),
      masked_secret: profile.secret ? maskSecretPreview(profile.secret) : undefined,
      is_active: profile.is_active,
      created_at: profile.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const existingIndex = prevProxies.findIndex((p) => p.id === profile.id);
    let nextProxies = [...prevProxies];

    if (existingIndex !== -1) {
      nextProxies[existingIndex] = summary;
    } else {
      nextProxies.push(summary);
    }

    if (profile.is_active) {
      nextProxies = nextProxies.map((p) => ({
        ...p,
        is_active: p.id === profile.id,
      }));
    }

    set({
      proxies: nextProxies,
      activeProxyId: profile.is_active ? profile.id : prevActiveId,
    });

    try {
      await proxyApi.saveProxy(profile);
      toast.success(`Proxy "${profile.label}" saved successfully`);
      if (profile.is_active) {
        void useAuthStore.getState().checkConnection();
      }
      return true;
    } catch (err) {
      // Rollback on failure
      set({ proxies: prevProxies, activeProxyId: prevActiveId });
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to save proxy: ${msg}`);
      return false;
    }
  },

  deleteProxy: async (id: string) => {
    const prevProxies = get().proxies;
    const prevActiveId = get().activeProxyId;

    // Optimistic deletion
    set({
      proxies: prevProxies.filter((p) => p.id !== id),
      activeProxyId: prevActiveId === id ? null : prevActiveId,
    });

    try {
      await proxyApi.deleteProxy(id);
      toast.success('Proxy profile deleted');
      return true;
    } catch (err) {
      // Rollback on failure
      set({ proxies: prevProxies, activeProxyId: prevActiveId });
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to delete proxy: ${msg}`);
      return false;
    }
  },

  setActiveProxy: async (id: string | null) => {
    const prevProxies = get().proxies;
    const prevActiveId = get().activeProxyId;

    // Optimistic active toggle
    set({
      activeProxyId: id,
      proxies: prevProxies.map((p) => ({
        ...p,
        is_active: p.id === id,
      })),
    });

    try {
      await proxyApi.setActiveProxy(id);
      void useAuthStore.getState().checkConnection();
      return true;
    } catch (err) {
      // Rollback on failure
      set({ proxies: prevProxies, activeProxyId: prevActiveId });
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to set active proxy: ${msg}`);
      return false;
    }
  },

  toggleProxyEnabled: async (enabled: boolean) => {
    const prevEnabled = get().isEnabled;

    // Optimistic toggle
    set({ isEnabled: enabled });

    try {
      await proxyApi.toggleProxyEnabled(enabled);
      void useAuthStore.getState().checkConnection();
      return true;
    } catch (err) {
      // Rollback on failure
      set({ isEnabled: prevEnabled });
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to toggle proxy: ${msg}`);
      return false;
    }
  },

  testProxy: async (
    config?: ProxyConfig | null,
    proxyId?: string,
    targetDc?: number
  ): Promise<ProxyDiagnosticResult> => {
    const cacheKey = proxyId || 'draft';

    set((state) => ({
      isTesting: true,
      testingProxyIds: proxyId ? { ...state.testingProxyIds, [proxyId]: true } : state.testingProxyIds,
    }));

    try {
      const result = await proxyApi.testProxyConnection(config, targetDc);

      set((state) => ({
        isTesting: false,
        testingProxyIds: proxyId
          ? { ...state.testingProxyIds, [proxyId]: false }
          : state.testingProxyIds,
        testResults: {
          ...state.testResults,
          [cacheKey]: result,
        },
      }));

      return result;
    } catch (err) {
      const fallbackResult: ProxyDiagnosticResult = {
        is_connected: false,
        latency_ms: null,
        target_dc: targetDc || 2,
        target_endpoint: config ? `${config.host}:${config.port}` : 'unknown',
        error_code: 'TEST_INVOCATION_FAILED',
        message: err instanceof Error ? err.message : String(err),
      };

      set((state) => ({
        isTesting: false,
        testingProxyIds: proxyId
          ? { ...state.testingProxyIds, [proxyId]: false }
          : state.testingProxyIds,
        testResults: {
          ...state.testResults,
          [cacheKey]: fallbackResult,
        },
      }));

      return fallbackResult;
    }
  },

  importFromLink: (link: string): ParsedProxyResult => {
    const parsed = parseProxyLink(link);

    if (parsed.isValid && parsed.host && parsed.port && parsed.proxyType) {
      const currentDraft = get().draftProxy || {};

      const nextDraft: Partial<ProxyProfile> = {
        ...currentDraft,
        proxy_type: parsed.proxyType,
        host: parsed.host,
        port: parsed.port,
        secret: parsed.secret,
        username: parsed.username,
        password: parsed.password,
        label:
          currentDraft.label ||
          (parsed.proxyType === 'mtproto'
            ? `MTProto (${parsed.host})`
            : `SOCKS5 (${parsed.host})`),
      };

      set({
        draftProxy: nextDraft,
        draftErrors: {},
      });

      toast.success('Telegram proxy link recognized and imported');
    } else {
      toast.error(parsed.error || 'Failed to parse proxy link');
    }

    return parsed;
  },

  setDraftProxy: (draft) => set({ draftProxy: draft }),

  updateDraftField: (key, value) => {
    const current = get().draftProxy || {};
    set({
      draftProxy: {
        ...current,
        [key]: value,
      },
    });
  },

  setDraftErrors: (errors) => set({ draftErrors: errors }),

  clearDraft: () => set({ draftProxy: null, draftErrors: {} }),

  setSelectedProxyId: (id) => set({ selectedProxyId: id }),

  setImportModalOpen: (open) => set({ isImportModalOpen: open }),

  initEventListener: async () => {
    if (!isTauri()) {
      return () => {};
    }

    try {
      const unlisten = await listen<ProxyStateChangedPayload>('proxy-state-changed', (event) => {
        const payload = event.payload;
        set((state) => ({
          isEnabled: payload.is_enabled,
          activeProxyId: payload.active_proxy_id,
          proxies: state.proxies.map((p) => ({
            ...p,
            is_active: p.id === payload.active_proxy_id,
          })),
        }));
        void useAuthStore.getState().checkConnection();
      });

      return unlisten;
    } catch (err) {
      console.warn('Failed to listen to proxy-state-changed event:', err);
      return () => {};
    }
  },
}));

function maskSecretPreview(secret: string): string {
  if (secret.length <= 8) return '••••••••';
  return `${secret.substring(0, 4)}••••••••${secret.substring(secret.length - 4)}`;
}
