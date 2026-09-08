import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light';

interface ThemeState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

const STORAGE_KEY_THEME = 'protofs_theme_mode';

const applyTheme = (theme: ThemeMode) => {
  const root = document.documentElement;
  if (theme === 'light') {
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
  const stored = localStorage.getItem(STORAGE_KEY_THEME) as ThemeMode | null;
  const initialTheme: ThemeMode = stored === 'light' ? 'light' : 'dark';
  applyTheme(initialTheme);

  return {
    theme: initialTheme,
    setTheme: (theme: ThemeMode) => {
      localStorage.setItem(STORAGE_KEY_THEME, theme);
      applyTheme(theme);
      set({ theme });
    },
    toggleTheme: () => {
      const next = get().theme === 'dark' ? 'light' : 'dark';
      get().setTheme(next);
    },
  };
});

