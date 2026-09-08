import { create } from 'zustand';
import { api } from '../api';
import type { AuthSession } from '../types';

export type ConnectionStatus = 'connected' | 'disconnected' | 'checking';

interface AuthState {
  session: AuthSession | null;
  accounts: AuthSession[];
  connectionStatus: ConnectionStatus;
  isLoading: boolean;
  error: string | null;
  requires2fa: boolean;
  phoneCodeHash: string | null;

  initSession: () => Promise<void>;
  loadAccounts: () => Promise<void>;
  switchAccount: (userId: number) => Promise<void>;
  removeAccount: (userId: number) => Promise<void>;
  checkConnection: () => Promise<boolean>;
  setSession: (session: AuthSession | null) => void;
  logout: () => Promise<void>;
  setRequires2fa: (req: boolean) => void;
  setPhoneCodeHash: (hash: string | null) => void;
  setError: (err: string | null) => void;
}

const STORAGE_KEY_SESSION = 'protofs_session';

const getInitialSession = (): AuthSession | null => {
  try {
    const cached = localStorage.getItem(STORAGE_KEY_SESSION);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
};

const initialSession = getInitialSession();

export const useAuthStore = create<AuthState>((set, get) => ({
  session: initialSession,
  accounts: initialSession ? [initialSession] : [],
  connectionStatus: 'checking',
  isLoading: !initialSession,
  error: null,
  requires2fa: false,
  phoneCodeHash: null,

  initSession: async () => {
    if (!initialSession) {
      set({ isLoading: true, error: null });
    }
    try {
      const session = await api.getSessionStatus();
      const accounts = await api.listAccounts();
      set({ session, accounts, isLoading: false });
      get().checkConnection();
    } catch (err: any) {
      set({ error: err.message || 'Failed to initialize session', isLoading: false });
    }
  },

  loadAccounts: async () => {
    try {
      const accounts = await api.listAccounts();
      set({ accounts });
    } catch (e) {
      console.warn('Failed to list accounts:', e);
    }
  },

  switchAccount: async (userId: number) => {
    set({ isLoading: true });
    try {
      const session = await api.switchAccount(userId);
      set({ session, isLoading: false });
      get().checkConnection();
    } catch (err: any) {
      set({ error: err.message || 'Failed to switch account', isLoading: false });
    }
  },

  removeAccount: async (userId: number) => {
    try {
      const nextSession = await api.removeAccount(userId);
      const accounts = await api.listAccounts();
      set({ session: nextSession, accounts });
    } catch (e) {
      console.warn('Failed to remove account:', e);
    }
  },

  checkConnection: async () => {
    set({ connectionStatus: 'checking' });
    try {
      // Test MTProto connectivity by querying owned channels or session
      const channels = await api.getOwnedChannels(false);
      const isOnline = Array.isArray(channels);
      set({ connectionStatus: isOnline ? 'connected' : 'disconnected' });
      return isOnline;
    } catch {
      set({ connectionStatus: 'disconnected' });
      return false;
    }
  },

  setSession: (session) => {
    set({ session, requires2fa: false, phoneCodeHash: null });
    get().loadAccounts();
    get().checkConnection();
  },

  logout: async () => {
    try {
      await api.logout();
    } catch (e) {
      console.warn('Logout API error:', e);
    }
    set({ session: null, requires2fa: false, phoneCodeHash: null, connectionStatus: 'disconnected' });
  },

  setRequires2fa: (requires2fa) => set({ requires2fa }),
  setPhoneCodeHash: (phoneCodeHash) => set({ phoneCodeHash }),
  setError: (error) => set({ error }),
}));
