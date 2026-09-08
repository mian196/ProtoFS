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

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isLoading: true,
  error: null,
  requires2fa: false,
  phoneCodeHash: null,

  initSession: async () => {
    set({ isLoading: true, error: null });
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
