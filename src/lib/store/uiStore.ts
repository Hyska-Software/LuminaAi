import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Artifact, ThemeMode } from '../types';

/**
 * Main content surface. `skills` replaces the chat column (the sidebar stays
 * visible), so skill management never opens as a modal — docs/FILES.md §7.4.
 */
export type MainView = 'chat' | 'skills';

interface UiState {
  theme: ThemeMode;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  modelPickerOpen: boolean;
  commandPaletteOpen: boolean;
  searchOpen: boolean;
  attachmentsOpen: boolean;
  artifactPanelOpen: boolean;
  activeView: MainView;
  activeArtifactId: string | null;
  artifacts: Artifact[];
  fontScale: number;
  reduceMotion: boolean;

  setTheme: (theme: ThemeMode) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setModelPickerOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setAttachmentsOpen: (open: boolean) => void;
  /** Switches the main content between the chat and the skills manager. */
  setActiveView: (view: MainView) => void;
  openArtifactPanel: (artifactId?: string | null) => void;
  closeArtifactPanel: () => void;
  setActiveArtifact: (artifactId: string | null) => void;
  setArtifacts: (artifacts: Artifact[]) => void;
  addArtifact: (artifact: Artifact) => void;
  closeAllOverlays: () => void;
  applyTheme: () => void;
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveDark(theme: ThemeMode): boolean {
  return theme === 'dark' || (theme === 'system' && systemPrefersDark());
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      sidebarOpen: true,
      settingsOpen: false,
      modelPickerOpen: false,
      commandPaletteOpen: false,
      searchOpen: false,
      attachmentsOpen: false,
      artifactPanelOpen: false,
      activeView: 'chat',
      activeArtifactId: null,
      artifacts: [],
      fontScale: 1,
      reduceMotion: false,

      setTheme: (theme) => {
        set({ theme });
        get().applyTheme();
      },
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setModelPickerOpen: (modelPickerOpen) => set({ modelPickerOpen }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      setAttachmentsOpen: (attachmentsOpen) => set({ attachmentsOpen }),
      setActiveView: (activeView) => set({ activeView }),
      openArtifactPanel: (artifactId) =>
        set((state) => ({
          artifactPanelOpen: true,
          activeArtifactId: artifactId === undefined ? (state.activeArtifactId ?? state.artifacts[0]?.id ?? null) : artifactId,
        })),
      closeArtifactPanel: () => set({ artifactPanelOpen: false }),
      setActiveArtifact: (activeArtifactId) => set({ activeArtifactId, artifactPanelOpen: activeArtifactId !== null }),
      setArtifacts: (artifacts) =>
        set((state) => ({
          artifacts,
          activeArtifactId:
            state.activeArtifactId && artifacts.some((a) => a.id === state.activeArtifactId)
              ? state.activeArtifactId
              : (artifacts[0]?.id ?? null),
        })),
      addArtifact: (artifact) =>
        set((state) => ({
          artifacts: [artifact, ...state.artifacts.filter((a) => a.id !== artifact.id)],
        })),
      closeAllOverlays: () =>
        set({
          settingsOpen: false,
          modelPickerOpen: false,
          commandPaletteOpen: false,
          searchOpen: false,
          attachmentsOpen: false,
        }),
      applyTheme: () => {
        const dark = resolveDark(get().theme);
        const root = document.documentElement;
        root.classList.toggle('dark', dark);
        root.classList.toggle('light', !dark);
        root.style.colorScheme = dark ? 'dark' : 'light';
      },
    }),
    {
      name: 'lumina.ui',
      partialize: (state) => ({
        theme: state.theme,
        sidebarOpen: state.sidebarOpen,
        fontScale: state.fontScale,
        reduceMotion: state.reduceMotion,
      }),
    },
  ),
);
