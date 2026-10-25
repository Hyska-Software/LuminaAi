import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SETTINGS_TAB, isSettingsTabId, type SettingsTabId } from '../settingsTabs';
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

/**
 * How the right side panel shares space with the chat: `overlay` floats above
 * the conversation (classic drawer); `docked` splits the row so the chat
 * reflows. The docked layout only applies on wide windows — `lib/sidePanel.ts`
 * owns the responsive fallback to overlay.
 */
export type SidePanelMode = 'overlay' | 'docked';

/**
 * Sidebar width bounds (px). The user resizes the sidebar by dragging its right
 * edge (`components/layout/SidebarResizer`); the value is persisted with the
 * rest of the UI state and clamped on read/write. docs/DESIGN.md §5.
 */
export const SIDEBAR_WIDTH_MIN = 220;
export const SIDEBAR_WIDTH_MAX = 480;
export const SIDEBAR_WIDTH_DEFAULT = 272;
/** Width change per arrow key press on the resize handle. */
export const SIDEBAR_WIDTH_STEP = 16;

/** Keeps a sidebar width inside the supported range; invalid input falls back to the default. */
export function clampSidebarWidth(width: number): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
}

/**
 * Right side panel (artifacts and sources share the same surface) width bounds.
 * Resized by dragging its left edge (`components/layout/PanelResizer`), also
 * persisted and clamped on read/write. docs/DESIGN.md §5.
 */
export const SIDE_PANEL_WIDTH_MIN = 360;
export const SIDE_PANEL_WIDTH_MAX = 900;
export const SIDE_PANEL_WIDTH_DEFAULT = 480;
/** Width change per arrow key press on the resize handle. */
export const SIDE_PANEL_WIDTH_STEP = 16;

/** Keeps a side panel width inside the supported range; invalid input falls back to the default. */
export function clampSidePanelWidth(width: number): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return SIDE_PANEL_WIDTH_DEFAULT;
  return Math.min(SIDE_PANEL_WIDTH_MAX, Math.max(SIDE_PANEL_WIDTH_MIN, Math.round(width)));
}

interface UiState {
  theme: ThemeMode;
  sidebarOpen: boolean;
  /** Persisted width of the desktop sidebar, in px (docs/DESIGN.md §5). */
  sidebarWidth: number;
  settingsOpen: boolean;
  /** Active tab of the settings dialog, shared with the command palette. */
  settingsTab: SettingsTabId;
  modelPickerOpen: boolean;
  commandPaletteOpen: boolean;
  artifactPanelOpen: boolean;
  artifactPanelView: ArtifactPanelView;
  /** Side panel listing every source (citation) used in the conversation. */
  sourcesPanelOpen: boolean;
  /** Persisted width of the right side panel (artifacts/sources), in px. */
  sidePanelWidth: number;
  /** Persisted layout preference of the right side panel (see SidePanelMode). */
  sidePanelMode: SidePanelMode;
  activeView: MainView;
  activeArtifactId: string | null;
  artifacts: Artifact[];

  setTheme: (theme: ThemeMode) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  /** Clamps to `SIDEBAR_WIDTH_MIN`…`SIDEBAR_WIDTH_MAX` and persists the width. */
  setSidebarWidth: (width: number) => void;
  /** Clamps to `SIDE_PANEL_WIDTH_MIN`…`SIDE_PANEL_WIDTH_MAX` and persists the width. */
  setSidePanelWidth: (width: number) => void;
  /** Persists the overlay/docked preference (responsive fallback lives in lib/sidePanel). */
  setSidePanelMode: (mode: SidePanelMode) => void;
  setSettingsOpen: (open: boolean) => void;
  /** Opens the settings dialog, optionally jumping straight to a tab. */
  openSettings: (tab?: SettingsTabId) => void;
  setSettingsTab: (tab: SettingsTabId) => void;
  setModelPickerOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  /** Switches the main content between the chat and the skills manager. */
  setActiveView: (view: MainView) => void;
  /** Opens the panel on the artifact preview (or the list when there is none). */
  openArtifactPanel: (artifactId?: string | null) => void;
  /** Opens the panel on the generated-artifact list. */
  openArtifactList: () => void;
  closeArtifactPanel: () => void;
  setArtifactPanelView: (view: ArtifactPanelView) => void;
  /** Opens the side panel listing every source used in the conversation. */
  openSourcesPanel: () => void;
  closeSourcesPanel: () => void;
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
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      settingsOpen: false,
      settingsTab: DEFAULT_SETTINGS_TAB,
      modelPickerOpen: false,
      commandPaletteOpen: false,
      artifactPanelOpen: false,
      artifactPanelView: 'list',
      sourcesPanelOpen: false,
      sidePanelWidth: SIDE_PANEL_WIDTH_DEFAULT,
      sidePanelMode: 'overlay',
      activeView: 'chat',
      activeArtifactId: null,
      artifacts: [],

      setTheme: (theme) => {
        set({ theme });
        get().applyTheme();
      },
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: clampSidebarWidth(sidebarWidth) }),
      setSidePanelWidth: (sidePanelWidth) => set({ sidePanelWidth: clampSidePanelWidth(sidePanelWidth) }),
      setSidePanelMode: (sidePanelMode) => set({ sidePanelMode }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      openSettings: (tab) =>
        set((state) => ({
          settingsOpen: true,
          settingsTab: tab && isSettingsTabId(tab) ? tab : state.settingsTab,
        })),
      setSettingsTab: (settingsTab) =>
        set({ settingsTab: isSettingsTabId(settingsTab) ? settingsTab : DEFAULT_SETTINGS_TAB }),
      setModelPickerOpen: (modelPickerOpen) => set({ modelPickerOpen }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      setActiveView: (activeView) => set({ activeView }),
      openArtifactPanel: (artifactId) =>
        set((state) => {
          const active = (typeof artifactId === 'string' ? artifactId : null) ?? state.activeArtifactId;
          if (active) {
            return { artifactPanelOpen: true, artifactPanelView: 'preview', activeArtifactId: active, sourcesPanelOpen: false };
          }
          return { artifactPanelOpen: true, artifactPanelView: 'list', sourcesPanelOpen: false };
        }),
      openArtifactList: () =>
        set({ artifactPanelOpen: true, artifactPanelView: 'list', sourcesPanelOpen: false }),
      closeArtifactPanel: () => set({ artifactPanelOpen: false }),
      openSourcesPanel: () => set({ sourcesPanelOpen: true, artifactPanelOpen: false }),
      closeSourcesPanel: () => set({ sourcesPanelOpen: false }),
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
          return { activeArtifactId, artifactPanelOpen: true, artifactPanelView: 'preview', sourcesPanelOpen: false };
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
          sourcesPanelOpen: false,
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
        sidebarWidth: state.sidebarWidth,
        sidePanelWidth: state.sidePanelWidth,
        sidePanelMode: state.sidePanelMode,
      }),
      /**
       * Rehydrated layouts may carry an out-of-range width (manually edited
       * storage, older versions, future bounds). Clamp on merge so the first
       * paint already uses a sane value instead of waiting for the next drag.
       */
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<UiState>;
        return {
          ...current,
          ...stored,
          sidebarWidth: clampSidebarWidth(stored.sidebarWidth ?? current.sidebarWidth),
          sidePanelWidth: clampSidePanelWidth(stored.sidePanelWidth ?? current.sidePanelWidth),
          sidePanelMode: stored.sidePanelMode === 'docked' ? 'docked' : 'overlay',
        };
      },
    },
  ),
);

/**
 * The artifact and sources panels share the same surface, so both can never be
 * visible at once: in the docked layout that renders two columns side by side
 * and squeezes the chat between them. Every store action already closes the
 * sibling panel; this guard keeps the invariant even if the state is mutated
 * from somewhere else (stale HMR module, devtools, a future action that forgets
 * the rule). Keep whichever panel was opened last, or close the artifact panel
 * when both were already open.
 */
useUiStore.subscribe((state, previous) => {
  if (!state.artifactPanelOpen || !state.sourcesPanelOpen) return;
  const sourcesJustOpened = !previous.sourcesPanelOpen;
  useUiStore.setState(
    sourcesJustOpened ? { artifactPanelOpen: false } : { sourcesPanelOpen: false },
  );
});
