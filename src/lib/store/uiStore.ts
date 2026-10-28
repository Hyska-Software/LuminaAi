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
 * (Biblioteca/Skills) and vice versa. `diff` mostra o diff de um arquivo em uma
 * aba central (WORKBENCH §7.2); `file` mostra a prévia de um arquivo do
 * workspace na mesma faixa de abas (código, imagem ou PDF); `plan` mostra o
 * plano aprovado da sessão em Markdown na mesma faixa (ver `codePlanTab`).
 * Os alvos vivem em `codeDiffTab`/`codeFileTab`/`codePlanTab`.
 */
export type CodeView = 'session' | 'skills' | 'diff' | 'commits' | 'file' | 'plan';

/** Diff aberto como aba central (alvo é volátil; não persiste entre sessões). */
export interface CodeDiffTab {
  workspaceId: string;
  path: string;
  /** `true` = diff do index (`git diff --cached`). */
  staged: boolean;
  /** Diff já conhecido pelo journal da sessão (evita a chamada de API). */
  knownDiff?: string | null;
}

/**
 * Arquivo aberto como aba central (alvo volátil; não persiste entre sessões).
 * A prévia inline do painel Arquivos foi substituída por estas abas: cada
 * clique na árvore abre (ou ativa) uma aba e o conteúdo é carregado por
 * `read_workspace_file`.
 */
export interface CodeFileTab {
  workspaceId: string;
  /** Caminho relativo ao workspace, sempre com `/`. */
  path: string;
}

/** Chave estável de uma aba de arquivo (workspace + caminho relativo). */
export function codeFileTabKey(tab: CodeFileTab): string {
  return `${tab.workspaceId}\u0000${tab.path}`;
}

/**
 * Plano aprovado aberto como aba central (volátil, como as abas de arquivo).
 * Guarda o Markdown no momento da abertura; a visualização reusa o `FilePreview`
 * (Documento ⇄ Código), igual à prévia de um `.md` da filetree.
 */
export interface CodePlanTab {
  conversationId: string;
  /** Markdown congelado no momento em que "Ver plano" foi acionado. */
  markdown: string;
  /** Rótulo curto da aba (default: "Plano"). */
  title?: string;
  updatedAt: number;
}

/** Tabs of the Code right panel (Arquivos | Alterações). */
export type CodePanelTab = 'files' | 'changes' | 'terminal';

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
  /** Diff aberto como aba central (`null` = nenhum; pode ficar em segundo plano). */
  codeDiffTab: CodeDiffTab | null;
  /** Arquivos abertos nas abas centrais, na ordem de abertura (volátil). */
  codeFileTabs: CodeFileTab[];
  /** Aba de arquivo ativa (`null` = nenhuma; sempre presente em `codeFileTabs`). */
  codeFileTab: CodeFileTab | null;
  /** Plano aprovado exibido como aba central (`null` = nenhum/aba fechada). */
  codePlanTab: CodePlanTab | null;
  /** Quebra de linha dos arquivos — global, persistida e aplicada a todas as abas. */
  codeFileWrap: boolean;
  /** Aba central de histórico de commits (`null` = fechada). */
  codeCommitsTab: { workspaceId: string; revision: string | null } | null;
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
  /** Abre o diff de um arquivo como aba central (codeView vira diff). */
  openCodeDiff: (target: CodeDiffTab) => void;
  /** Fecha a aba de diff; se ela era a ativa, volta para a sessão. */
  closeCodeDiff: () => void;
  /** Abre (ou ativa) o arquivo em uma aba central (acumula abas; codeView vira file). */
  openCodeFile: (target: CodeFileTab) => void;
  /**
   * Fecha a aba do arquivo (por padrão, a ativa). Se a aba fechada era a ativa,
   * ativa a vizinha; sem abas restantes, o centro volta para a sessão.
   */
  closeCodeFile: (target?: CodeFileTab) => void;
  /** Abre (ou atualiza) o plano aprovado em uma aba central (`codeView` vira plan). */
  openCodePlan: (target: CodePlanTab) => void;
  /** Fecha a aba do plano; se ela era a ativa, volta para a sessão. */
  closeCodePlan: () => void;
  /** Liga/desliga a quebra de linha de todas as abas de arquivo (persistida). */
  setCodeFileWrap: (enabled: boolean) => void;
  /** Abre a aba de histórico de commits (lista do workspace). */
  openCodeCommits: (workspaceId: string) => void;
  /** Mostra um commit (`null` volta para a lista). */
  selectCodeCommit: (revision: string | null) => void;
  /** Fecha a aba de commits; se ela era a ativa, volta para a sessão. */
  closeCodeCommits: () => void;
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

/** Aba central aberta no centro (as três abas convivem na faixa de abas). */
type CentralCodeView = Extract<CodeView, 'diff' | 'file' | 'commits' | 'plan'>;

/**
 * Fechar uma aba central em **segundo plano** (o usuário está lendo outra aba)
 * não pode puxar o centro para a sessão. A view só volta para `session` quando
 * a aba fechada era a que estava ativa; caso contrário, permanece na atual.
 */
function keepCenterViewUnlessActive(
  state: UiState,
  closed: CentralCodeView,
): Pick<UiState, 'codeView'> {
  return { codeView: state.codeView === closed ? 'session' : state.codeView };
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
      codeDiffTab: null,
      codeFileTabs: [],
      codeFileTab: null,
      codePlanTab: null,
      codeFileWrap: false,
      codeCommitsTab: null,
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
        set({
          codeView:
            codeView === 'skills'
              ? 'skills'
              : codeView === 'diff'
                ? 'diff'
                : codeView === 'commits'
                  ? 'commits'
                  : codeView === 'file'
                    ? 'file'
                    : codeView === 'plan'
                      ? 'plan'
                      : 'session',
        }),
      openCodeDiff: (codeDiffTab) => set({ codeDiffTab, codeView: 'diff' }),
      closeCodeDiff: () =>
        set((state) => ({ codeDiffTab: null, ...keepCenterViewUnlessActive(state, 'diff') })),
      openCodeFile: (target) =>
        set((state) => {
          const key = codeFileTabKey(target);
          const alreadyOpen = state.codeFileTabs.some((tab) => codeFileTabKey(tab) === key);
          return {
            /* Abrir outro arquivo ADICIONA uma aba (não substitui a atual); abrir
               um arquivo já aberto apenas o ativa. */
            codeFileTabs: alreadyOpen ? state.codeFileTabs : [...state.codeFileTabs, target],
            codeFileTab: target,
            codeView: 'file',
          };
        }),
      closeCodeFile: (target) =>
        set((state) => {
          const closing = target ?? state.codeFileTab;
          if (!closing) return {};
          const closingKey = codeFileTabKey(closing);
          const index = state.codeFileTabs.findIndex((tab) => codeFileTabKey(tab) === closingKey);
          if (index < 0) return {};
          const remaining = state.codeFileTabs.filter((_, tabIndex) => tabIndex !== index);
          const activeKey = state.codeFileTab ? codeFileTabKey(state.codeFileTab) : null;
          if (activeKey !== closingKey) {
            /* Aba em segundo plano: mantém a ativa e a view atual. */
            return { codeFileTabs: remaining };
          }
          /* Aba ativa: vizinha da direita e, na falta dela, a da esquerda. */
          const neighbor = remaining[Math.min(index, remaining.length - 1)] ?? null;
          return {
            codeFileTabs: remaining,
            codeFileTab: neighbor,
            codeView: neighbor === null && state.codeView === 'file' ? 'session' : state.codeView,
          };
        }),
      openCodePlan: (target) =>
        set({
          codePlanTab: {
            ...target,
            markdown: target.markdown,
          },
          codeView: 'plan',
        }),
      closeCodePlan: () =>
        set((state) => ({ codePlanTab: null, ...keepCenterViewUnlessActive(state, 'plan') })),
      setCodeFileWrap: (codeFileWrap) => set({ codeFileWrap }),
      openCodeCommits: (workspaceId) =>
        set({ codeCommitsTab: { workspaceId, revision: null }, codeView: 'commits' }),
      selectCodeCommit: (revision) =>
        set((state) => ({
          codeCommitsTab: state.codeCommitsTab
            ? { ...state.codeCommitsTab, revision }
            : state.codeCommitsTab,
          codeView: 'commits',
        })),
      closeCodeCommits: () =>
        set((state) => ({ codeCommitsTab: null, ...keepCenterViewUnlessActive(state, 'commits') })),
      setCodePanelOpen: (codePanelOpen) => set({ codePanelOpen }),
      toggleCodePanel: () => set((state) => ({ codePanelOpen: !state.codePanelOpen })),
      setCodePanelTab: (codePanelTab) =>
        set({
          codePanelTab:
            codePanelTab === 'files'
              ? 'files'
              : codePanelTab === 'terminal'
                ? 'terminal'
                : 'changes',
        }),
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
        codeFileWrap: state.codeFileWrap,
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
          codeFileWrap:
            typeof stored.codeFileWrap === 'boolean' ? stored.codeFileWrap : current.codeFileWrap,
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
