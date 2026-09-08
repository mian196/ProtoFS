import { create } from 'zustand';

export type ThemePalette = 'nordic' | 'cyberpunk' | 'forest' | 'obsidian';

interface ThemeState {
  theme: ThemePalette;
  setTheme: (theme: ThemePalette) => void;
}

const STORAGE_KEY_THEME = 'protofs_theme';

export const useThemeStore = create<ThemeState>((set) => {
  const initialTheme = (localStorage.getItem(STORAGE_KEY_THEME) as ThemePalette) || 'nordic';
  document.documentElement.setAttribute('data-theme', initialTheme);

  return {
    theme: initialTheme,
    setTheme: (theme: ThemePalette) => {
      localStorage.setItem(STORAGE_KEY_THEME, theme);
      document.documentElement.setAttribute('data-theme', theme);
      set({ theme });
    },
  };
});
