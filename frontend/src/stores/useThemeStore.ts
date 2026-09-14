import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

const STORAGE_KEY_THEME = 'protofs_theme_mode';

const resolveTheme = (theme: ThemeMode): 'dark' | 'light' => {
  if (theme === 'system') {
    return typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return theme;
};

const applyTheme = (theme: ThemeMode) => {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  if (resolved === 'light') {
    root.classList.add('light');
    root.classList.remove('dark');
    root.setAttribute('data-theme', 'light');
    root.style.colorScheme = 'light';
  } else {
    root.classList.add('dark');
    root.classList.remove('light');
    root.setAttribute('data-theme', 'dark');
    root.style.colorScheme = 'dark';
  }
};

export const useThemeStore = create<ThemeState>((set, get) => {
  const stored = (typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEY_THEME)
    : null) as ThemeMode | null;
  const initialTheme: ThemeMode =
    stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark';
  applyTheme(initialTheme);

  if (typeof window !== 'undefined' && window.matchMedia) {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (get().theme === 'system') {
          applyTheme('system');
        }
      });
  }

  return {
    theme: initialTheme,
    setTheme: (theme: ThemeMode) => {
      localStorage.setItem(STORAGE_KEY_THEME, theme);
      applyTheme(theme);
      set({ theme });
    },
    toggleTheme: () => {
      const current = get().theme;
      const next = current === 'dark' ? 'light' : 'dark';
      get().setTheme(next);
    },
  };
});
