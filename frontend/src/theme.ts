export type ThemeMode = 'dark' | 'light';
export type Palette = 'telegram' | 'aurora' | 'emerald' | 'sunset' | 'monochrome';

export const PALETTES: { id: Palette; name: string; desc: string; swatchClass: string }[] = [
  { id: 'telegram', name: 'Telegram Blue (Default)', desc: 'Deep Navy & Cyan', swatchClass: 'sw-telegram' },
  { id: 'aurora', name: 'Cyber Aurora', desc: 'Neon Violet & Aqua', swatchClass: 'sw-aurora' },
  { id: 'emerald', name: 'Emerald Glacier', desc: 'Forest Moss & Teal', swatchClass: 'sw-emerald' },
  { id: 'sunset', name: 'Sunset Flare', desc: 'Terracotta & Amber', swatchClass: 'sw-sunset' },
  { id: 'monochrome', name: 'Obsidian Pure', desc: 'Slate & Platinum', swatchClass: 'sw-mono' },
];

export class ThemeManager {
  private currentTheme: ThemeMode = 'dark';
  private currentPalette: Palette = 'telegram';

  constructor() {
    this.loadSettings();
  }

  public init(): void {
    document.documentElement.setAttribute('data-theme', this.currentTheme);
    document.documentElement.setAttribute('data-palette', this.currentPalette);
  }

  public toggleTheme(): ThemeMode {
    this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', this.currentTheme);
    localStorage.setItem('protofs_theme', this.currentTheme);
    return this.currentTheme;
  }

  public setPalette(palette: Palette): void {
    this.currentPalette = palette;
    document.documentElement.setAttribute('data-palette', palette);
    localStorage.setItem('protofs_palette', palette);
  }

  public getTheme(): ThemeMode {
    return this.currentTheme;
  }

  public getPalette(): Palette {
    return this.currentPalette;
  }

  private loadSettings(): void {
    const savedTheme = localStorage.getItem('protofs_theme') as ThemeMode;
    if (savedTheme === 'light' || savedTheme === 'dark') {
      this.currentTheme = savedTheme;
    }

    const savedPalette = localStorage.getItem('protofs_palette') as Palette;
    if (['telegram', 'aurora', 'emerald', 'sunset', 'monochrome'].includes(savedPalette)) {
      this.currentPalette = savedPalette;
    }
  }
}
