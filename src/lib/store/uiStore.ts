import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SETTINGS_TAB, isSettingsTabId, type SettingsTabId } from '../settingsTabs';
import type { Artifact, ThemeMode } from '../types';

/**
 * Main content surface. `skills` and `library` replace the chat column (the
 * sidebar stays visible), so their management never opens as a modal —
 * docs/FILES.md §7.4 and docs/goals/library-page/PLAN.md.
 */
export type MainView = 'chat' | 'skills' | 'library';

/**
 * Application layout mode. `chat` is the classic conversation app; `code` is
 * the coding-agent workbench (Paseo-inspired) introduced by
 * docs/goals/chat-code-layout/PLAN.md. The mode is persisted and switched from
 * the title bar.
 */
export type LayoutMode = 'chat' | 'code';

/**
 * Surface shown inside the Code layout's center column. The Code workbench has
 * its own view state so switching layouts never loses the Chat surface's page
 * (Biblioteca/Skills) and vice versa.
 */
export type CodeView = 'session' | 'skills';

/** Tabs of the Code right panel (Arquivos | Alterações). */
export type CodePanelTab = 'files' | 'changes';

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
  /** Active application layout (Chat | Code) — persisted (PLAN §2). */
  layoutMode: LayoutMode;
  /** Center surface inside the Code layout; reset to `session` on demand. */
  codeView: CodeView;
  /** Whether the Code layout shows its right panel (Arquivos/Alterações). */
  codePanelOpen: boolean;
  /** Active tab of the Code right panel. */
  codePanelTab: CodePanelTab;
  /** Workspace ativo do layout Code (`null` = nenhum/nenhuma pasta aberta). */
  activeWorkspaceId: string | null;
  /**
   * Abas de sessão abertas por workspace (`workspaceId -> conversationIds`).
   * Persistido para o Code restaurar as abas ao reabrir o app (limitação da
   * fase 1 resolvida em docs/goals/code-harness/WORKBENCH.md §4).
   */
  openSessionsByWorkspace: Record<string, string[]>;
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
  /** Switches the whole application between the Chat and Code layouts. */
  setLayoutMode: (mode: LayoutMode) => void;
  /** Switches the Code center between the agent session and the Skills page. */
  setCodeView: (view: CodeView) => void;
  setCodePanelOpen: (open: boolean) => void;
  toggleCodePanel: () => void;
  setCodePanelTab: (tab: CodePanelTab) => void;
  /** Define o workspace ativo do layout Code (persistido). */
  setActiveWorkspace: (workspaceId: string | null) => void;
  /** Abre (ou ativa) uma aba de sessão dentro de um workspace. */
  openWorkspaceSession: (workspaceId: string, conversationId: string) => void;
  /** Fecha uma aba de sessão; devolve o id vizinho sugerido (ou `null`). */
  closeWorkspaceSession: (workspaceId: string, conversationId: string) => string | null;
  /** Substitui a lista de abas de um workspace (sincronização com o backend). */
  setWorkspaceSessions: (workspaceId: string, conversationIds: string[]) => void;
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
      layoutMode: 'chat',
      codeView: 'session',
      codePanelOpen: true,
      codePanelTab: 'changes',
      activeWorkspaceId: null,
      openSessionsByWorkspace: {},
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
      setLayoutMode: (layoutMode) =>
        set({ layoutMode: layoutMode === 'code' ? 'code' : 'chat' }),
      setCodeView: (codeView) =>
        set({ codeView: codeView === 'skills' ? 'skills' : 'session' }),
      setCodePanelOpen: (codePanelOpen) => set({ codePanelOpen }),
      toggleCodePanel: () => set((state) => ({ codePanelOpen: !state.codePanelOpen })),
      setCodePanelTab: (codePanelTab) =>
        set({ codePanelTab: codePanelTab === 'files' ? 'files' : 'changes' }),
      setActiveWorkspace: (activeWorkspaceId) => set({ activeWorkspaceId }),
      openWorkspaceSession: (workspaceId, conversationId) =>
        set((state) => {
          const current = state.openSessionsByWorkspace[workspaceId] ?? [];
          const next = current.includes(conversationId) ? current : [...current, conversationId];
          return {
            openSessionsByWorkspace: { ...state.openSessionsByWorkspace, [workspaceId]: next },
          };
        }),
      closeWorkspaceSession: (workspaceId, conversationId) => {
        const state = get();
        const current = state.openSessionsByWorkspace[workspaceId] ?? [];
        const index = current.indexOf(conversationId);
        if (index < 0) return null;
        const next = current.filter((id) => id !== conversationId);
        const neighbor = next[Math.min(index, next.length - 1)] ?? null;
        set({
          openSessionsByWorkspace: { ...state.openSessionsByWorkspace, [workspaceId]: next },
        });
        return neighbor;
      },
      setWorkspaceSessions: (workspaceId, conversationIds) =>
        set((state) => ({
          openSessionsByWorkspace: {
            ...state.openSessionsByWorkspace,
            [workspaceId]: [...new Set(conversationIds)],
          },
        })),
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
        layoutMode: state.layoutMode,
        codePanelOpen: state.codePanelOpen,
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        sidePanelWidth: state.sidePanelWidth,
        sidePanelMode: state.sidePanelMode,
        activeWorkspaceId: state.activeWorkspaceId,
        openSessionsByWorkspace: state.openSessionsByWorkspace,
      }),
      /**
       * Rehydrated layouts may carry an out-of-range width (manually edited
       * storage, older versions, future bounds). Clamp on merge so the first
       * paint already uses a sane value instead of waiting for the next drag.
       */
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<UiState>;
        const validWorkspaceId = (value: unknown): string | null =>
          typeof value === 'string' && value.trim().length > 0 ? value : null;
        const validSessions = (value: unknown): Record<string, string[]> => {
          if (!value || typeof value !== 'object') return {};
          const mapped: Record<string, string[]> = {};
          for (const [workspaceId, ids] of Object.entries(value as Record<string, unknown>)) {
            if (!Array.isArray(ids)) continue;
            const clean = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
            if (clean.length > 0) mapped[workspaceId] = [...new Set(clean)];
          }
          return mapped;
        };
        return {
          ...current,
          ...stored,
          layoutMode: stored.layoutMode === 'code' ? 'code' : 'chat',
          codePanelOpen:
            typeof stored.codePanelOpen === 'boolean' ? stored.codePanelOpen : current.codePanelOpen,
          sidebarWidth: clampSidebarWidth(stored.sidebarWidth ?? current.sidebarWidth),
          sidePanelWidth: clampSidePanelWidth(stored.sidePanelWidth ?? current.sidePanelWidth),
          sidePanelMode: stored.sidePanelMode === 'docked' ? 'docked' : 'overlay',
          activeWorkspaceId: validWorkspaceId(stored.activeWorkspaceId),
          openSessionsByWorkspace: validSessions(stored.openSessionsByWorkspace),
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
