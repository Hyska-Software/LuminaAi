/**
 * Installed-theme state and application.
 *
 * The backend is the source of truth for the installed packages; `themeId`
 * lives in settings. This store lists themes, keeps the active id, and applies
 * validated tokens/assets to the document.
 */
import { create } from 'zustand';

import { api } from '../api';
import { BUILTIN_THEME_ID, applyThemeAssets, applyThemeTokens, forgetAllThemeAssets, forgetThemeAssets, forgetThemeFonts, readThemeAsset } from '../theme/apply';
import type { ThemeInfo, ThemeInstallResult } from '../types';
import { useAppStore } from './appStore';
import { resolveDark, useUiStore } from './uiStore';

export { BUILTIN_THEME_ID } from '../theme/apply';

export const BUILTIN_THEME: ThemeInfo = {
  id: BUILTIN_THEME_ID,
  name: 'Zylara',
  version: '',
  author: '',
  description: '',
  builtIn: true,
  light: { tokens: {}, wallpaper: null },
  dark: { tokens: {}, wallpaper: null },
  fonts: { sans: null, mono: null },
};

function withBuiltin(themes: readonly ThemeInfo[]): ThemeInfo[] {
  const seen = new Set<string>();
  const unique = themes.filter((theme) => {
    if (seen.has(theme.id)) return false;
    seen.add(theme.id);
    return true;
  });
  const zylara = unique.find((theme) => theme.id === BUILTIN_THEME_ID && theme.builtIn);
  const bundled = unique.filter(
    (theme) => theme.builtIn && theme.id !== BUILTIN_THEME_ID,
  );
  const installed = unique
    .filter((theme) => !theme.builtIn && theme.id !== BUILTIN_THEME_ID)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id));
  return [zylara ?? BUILTIN_THEME, ...bundled, ...installed];
}

interface ThemeState {
  /** Built-in entry first, followed by installed themes sorted by name. */
  themes: ThemeInfo[];
  activeId: string;
  ready: boolean;
  /** Last `listThemes` failure (install/uninstall failures are thrown to the UI). */
  error: string | null;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  apply: () => void;
  setActive: (id: string) => Promise<void>;
  install: (path: string) => Promise<ThemeInstallResult>;
  uninstall: (id: string) => Promise<void>;
  openFolder: () => Promise<void>;
}

let applySeq = 0;
let subscribed = false;

export const useThemeStore = create<ThemeState>()((set, get) => ({
  themes: [BUILTIN_THEME],
  activeId: BUILTIN_THEME_ID,
  ready: false,
  error: null,

  init: async () => {
    if (get().ready) return;
    let themes = [BUILTIN_THEME];
    let error: string | null = null;
    let listFailed = false;
    try {
      themes = withBuiltin(await api.listThemes());
    } catch (cause) {
      listFailed = true;
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const requested = useAppStore.getState().settings.themeId || BUILTIN_THEME_ID;
    const activeId = themes.some((theme) => theme.id === requested) ? requested : BUILTIN_THEME_ID;
    set({ themes, activeId, ready: true, error });
    if (!listFailed && activeId !== requested) {
      void useAppStore.getState().saveSettings({ themeId: activeId });
    }
    if (!subscribed) {
      subscribed = true;
      useUiStore.subscribe((state, previous) => {
        if (state.theme !== previous.theme) useThemeStore.getState().apply();
      });
    }
    get().apply();
  },

  refresh: async () => {
    const previous = get().themes;
    let themes: ThemeInfo[];
    try {
      themes = withBuiltin(await api.listThemes());
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : String(cause) });
      get().apply();
      return;
    }
    for (const theme of previous) forgetThemeFonts(theme.id);
    forgetAllThemeAssets();
    const requested = get().activeId;
    const activeId = themes.some((theme) => theme.id === requested) ? requested : BUILTIN_THEME_ID;
    set({ themes, activeId, error: null });
    if (activeId !== requested) {
      await useAppStore.getState().saveSettings({ themeId: activeId });
    }
    get().apply();
  },

  apply: () => {
    const { themes, activeId } = get();
    const theme = themes.find((entry) => entry.id === activeId) ?? BUILTIN_THEME;
    const dark = resolveDark(useUiStore.getState().theme);
    applyThemeTokens(theme, dark);
    const sequence = ++applySeq;
    void applyThemeAssets(
      theme,
      dark,
      (themeId, asset) => readThemeAsset(themeId, asset, api.getThemeAsset),
      () => sequence === applySeq,
    );
  },

  setActive: async (id) => {
    if (!get().themes.some((theme) => theme.id === id)) return;
    set({ activeId: id });
    await useAppStore.getState().saveSettings({ themeId: id });
    get().apply();
  },

  install: async (path) => {
    const result = await api.installTheme(path);
    forgetThemeAssets(result.theme.id);
    forgetThemeFonts(result.theme.id);
    let themes: ThemeInfo[];
    try {
      themes = withBuiltin(await api.listThemes());
    } catch {
      themes = withBuiltin([...get().themes, result.theme]);
    }
    set({ themes, error: null });
    if (get().activeId === result.theme.id) get().apply();
    return result;
  },

  uninstall: async (id) => {
    const themes = withBuiltin(await api.uninstallTheme(id));
    forgetThemeAssets(id);
    forgetThemeFonts(id);
    set({ themes });
    if (get().activeId === id) {
      set({ activeId: BUILTIN_THEME_ID });
      await useAppStore.getState().saveSettings({ themeId: BUILTIN_THEME_ID });
    }
    get().apply();
  },

  openFolder: async () => {
    await api.openThemesDir();
  },
}));
