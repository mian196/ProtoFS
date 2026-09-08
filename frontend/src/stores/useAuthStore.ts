import { create } from 'zustand';
import { api } from '../api';
import type { AuthSession } from '../types';

interface AuthState {
  session: AuthSession | null;
  isLoading: boolean;
  error: string | null;
  requires2fa: boolean;
  phoneCodeHash: string | null;
  initSession: () => Promise<void>;
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

export const useAuthStore = create<AuthState>((set) => ({
  session: initialSession,
  isLoading: !initialSession,
  error: null,
  requires2fa: false,
  phoneCodeHash: null,

  initSession: async () => {
    // Only set loading true if we don't have a cached session
    if (!initialSession) {
      set({ isLoading: true, error: null });
    }
    try {
      const session = await api.getSessionStatus();
      set({ session, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to initialize session', isLoading: false });
    }
  },

  setSession: (session) => set({ session, requires2fa: false, phoneCodeHash: null }),

  logout: async () => {
    try {
      await api.logout();
    } catch (e) {
      console.warn('Logout API error:', e);
    }
    set({ session: null, requires2fa: false, phoneCodeHash: null });
  },

  setRequires2fa: (requires2fa) => set({ requires2fa }),
  setPhoneCodeHash: (phoneCodeHash) => set({ phoneCodeHash }),
  setError: (error) => set({ error }),
}));
