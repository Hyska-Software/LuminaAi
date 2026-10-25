import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Artifact, ThemeMode } from '../types';

/**
 * Main content surface. `skills` replaces the chat column (the sidebar stays
 * visible), so skill management never opens as a modal — docs/FILES.md §7.4.
 */
export type MainView = 'chat' | 'skills';

/**
 * Surface shown by the artifact side panel: the generated-artifact list (the
 * "+" affordance in the chat and the command palette) or a single preview
 * (clicking an artifact card).
 */
export type ArtifactPanelView = 'list' | 'preview';

interface UiState {
  theme: ThemeMode;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  modelPickerOpen: boolean;
  commandPaletteOpen: boolean;
  searchOpen: boolean;
  attachmentsOpen: boolean;
  artifactPanelOpen: boolean;
  artifactPanelView: ArtifactPanelView;
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
  /** Opens the panel on the artifact preview (or the list when there is none). */
  openArtifactPanel: (artifactId?: string | null) => void;
  /** Opens the panel on the generated-artifact list. */
  openArtifactList: () => void;
  closeArtifactPanel: () => void;
  setArtifactPanelView: (view: ArtifactPanelView) => void;
  setActiveArtifact: (artifactId: string | null) => void;
  setArtifacts: (artifacts: Artifact[]) => void;
  addArtifact: (artifact: Artifact) => void;
  closeAllOverlays: () => void;
  applyTheme: () => void;
}

/**
 * Canonical artifact order, identical to `db::list_artifacts`
 * (`ORDER BY created_at, id`). Keeping it here means the live events, the
 * backend reconciliation and the chat cards never disagree about the order.
 */
export function sortArtifacts(artifacts: Artifact[]): Artifact[] {
  const byId = new Map<string, Artifact>();
  for (const artifact of artifacts) byId.set(artifact.id, artifact);
  return [...byId.values()].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
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
      artifactPanelView: 'list',
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
        set((state) => {
          const active = (typeof artifactId === 'string' ? artifactId : null) ?? state.activeArtifactId;
          if (active) {
            return { artifactPanelOpen: true, artifactPanelView: 'preview', activeArtifactId: active };
          }
          return { artifactPanelOpen: true, artifactPanelView: 'list' };
        }),
      openArtifactList: () => set({ artifactPanelOpen: true, artifactPanelView: 'list' }),
      closeArtifactPanel: () => set({ artifactPanelOpen: false }),
      setArtifactPanelView: (view) =>
        set((state) => {
          if (view === 'list') return { artifactPanelView: 'list' };
          const active =
            state.artifacts.find((artifact) => artifact.id === state.activeArtifactId) ??
            state.artifacts[state.artifacts.length - 1];
          if (!active) return { artifactPanelView: 'list' };
          return { artifactPanelView: 'preview', activeArtifactId: active.id };
        }),
      setActiveArtifact: (activeArtifactId) =>
        set((state) => {
          if (!activeArtifactId) {
            return { activeArtifactId: null, artifactPanelView: 'list', artifactPanelOpen: state.artifactPanelOpen };
          }
          return { activeArtifactId, artifactPanelOpen: true, artifactPanelView: 'preview' };
        }),
      setArtifacts: (artifacts) =>
        set((state) => {
          const next = sortArtifacts(artifacts);
          const activeArtifactId =
            state.activeArtifactId && next.some((artifact) => artifact.id === state.activeArtifactId)
              ? state.activeArtifactId
              : null;
          // A preview whose artifact disappeared falls back to the list, so the
          // panel never stays on a stale/removed artifact.
          const artifactPanelView =
            state.artifactPanelView === 'preview' && !activeArtifactId
              ? 'list'
              : state.artifactPanelView;
          return { artifacts: next, activeArtifactId, artifactPanelView };
        }),
      addArtifact: (artifact) =>
        set((state) => ({
          artifacts: sortArtifacts([...state.artifacts, artifact]),
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
