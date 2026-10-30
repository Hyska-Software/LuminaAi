import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Copy,
  ExternalLink,
  FileDiff,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  History,
  PanelRight,
  Plus,
  RefreshCw,
  ShieldCheck,
  Target,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Spinner,
  Tooltip,
} from '@/components/ui';
import { api } from '@/lib/api';
import { filterConversationsForLayout } from '@/lib/conversations';
import { goalIsRunning, goalPauseReasonLabel } from '@/lib/goalRunner';
import {
  codeFileTabKey,
  useChatStore,
  useCodeStore,
  useUiStore,
  type CodeFileTab,
} from '@/lib/store';
import type { Conversation, GoalView, Workspace } from '@/lib/types';
import { SIDE_PANEL_DOCK_MIN_VIEWPORT, useViewportWidth } from '@/lib/sidePanel';
import { cn, copyText } from '@/lib/utils';
import { WorkspaceTrustDialog } from './WorkspaceTrustDialog';
import { CodeContextMeterChip } from './CodeAgentWidgets';
import { FileIcon } from './FileIcon';
import { NO_WORKSPACE_KEY, openFolder, useWorkspaces } from './useWorkspaces';

/** Synthetic tab shown when the Code layout has no active conversation. */
const NEW_SESSION_ID = '__new_session__';
const NEW_SESSION_TITLE = 'Nova sessão';
/** Synthetic center tab for an open file diff (WORKBENCH §7.2). */
const CODE_DIFF_TAB_ID = '__code_diff__';
/** Synthetic center tab for the commit history (WORKBENCH §7.2). */
const CODE_COMMITS_TAB_ID = '__code_commits__';
/** Synthetic center tab for the approved plan opened from "Ver plano". */
const CODE_PLAN_TAB_ID = '__code_plan__';
/** Synthetic center tab for the session goal (GoalPanel). */
const CODE_GOAL_TAB_ID = '__code_goal__';
/**
 * Prefixo dos ids das abas centrais de arquivo (§7.1) — cada arquivo aberto tem
 * a própria aba. O sufixo é a chave estável `codeFileTabKey` codificada para o
 * DOM (o `\0` interno vira `%00`, então nenhum atributo carrega NUL).
 */
const CODE_FILE_TAB_PREFIX = '__code_file__:';

/** DOM id da aba de um arquivo aberto. */
function codeFileTabDomId(tab: CodeFileTab): string {
  return `${CODE_FILE_TAB_PREFIX}${encodeURIComponent(codeFileTabKey(tab))}`;
}

/** Localiza a aba de arquivo de um id do DOM (ou `null` se não estiver aberta). */
function findCodeFileTab(id: string): CodeFileTab | null {
  if (!id.startsWith(CODE_FILE_TAB_PREFIX)) return null;
  return useUiStore.getState().codeFileTabs.find((tab) => codeFileTabDomId(tab) === id) ?? null;
}

/** Nome curto da aba (o aria/title levam o caminho completo). */
function codeFileTabName(tab: CodeFileTab): string {
  return tab.path.split('/').pop() || tab.path;
}

/**
 * Id of the conversation surface the session tabs control. `WorkspaceCenter`
 * (layout/) owns that element and should render it with this id so
 * `aria-controls` points at a real region.
 */
const SESSION_PANEL_ID = 'code-session-panel';

const chipClassName =
  'inline-flex h-7 max-w-60 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 ' +
  'text-[11.5px] text-foreground-muted transition-colors duration-150 ' +
  'hover:bg-surface-hover hover:text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ' +
  'disabled:pointer-events-none disabled:opacity-60';

interface SessionTab {
  id: string;
  title: string;
}

function sessionTitle(conversations: Conversation[], id: string): string {
  return conversations.find((conversation) => conversation.id === id)?.title ?? NEW_SESSION_TITLE;
}

const GOAL_BADGE_TONE = {
  accent: 'bg-accent-soft text-accent',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} as const;

interface GoalBadgeProps {
  goal: GoalView;
  running: boolean;
  onOpen: () => void;
}

/**
 * Badge do objetivo no cabeçalho (PLAN §10.6): rodada em andamento
 * (`accent` + spinner), pausado (`warning`), bloqueado (`danger`) e ativo
 * (`N/M`). Concluído não aparece — o card de atenção/painel cuidam desse caso.
 * Clicar abre a aba central "Objetivo" (`openCodeGoal`).
 */
function GoalBadge({ goal, running, onOpen }: GoalBadgeProps) {
  const tone =
    goal.status === 'paused' ? 'warning' : goal.status === 'blocked' ? 'danger' : 'accent';
  const pauseLabel = goalPauseReasonLabel(goal.pauseReason);
  const ariaLabel = running
    ? `Abrir objetivo: rodada ${goal.rounds} de ${goal.maxRounds} em andamento`
    : goal.status === 'paused'
      ? `Abrir objetivo: pausado${pauseLabel ? ` (${pauseLabel})` : ''}`
      : goal.status === 'blocked'
        ? 'Abrir objetivo: bloqueado'
        : `Abrir objetivo: ativo, rodada ${goal.rounds} de ${goal.maxRounds}${
            goal.autoContinue ? ', continuidade automática' : ', continuidade manual'
          }`;
  const visible =
    goal.status === 'paused'
      ? 'Pausado'
      : goal.status === 'blocked'
        ? 'Bloqueado'
        : `${goal.rounds}/${goal.maxRounds}`;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onOpen}
      className={cn(
        'inline-flex h-7 max-w-36 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium',
        'transition-opacity duration-150 hover:opacity-90 motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        GOAL_BADGE_TONE[tone],
      )}
    >
      {running ? (
        <Spinner size="xs" />
      ) : (
        <Target aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
      )}
      <span className="truncate tabular-nums">{visible}</span>
    </button>
  );
}

interface WorkspaceChipProps {
  workspace: Workspace | null;
  busy: boolean;
  onRefresh: () => void;
  onOpenExplorer: () => void;
  onCopyPath: () => void;
  onOpenFolder: () => void;
  /** Troca a sessão ativa de workspace (null = sem workspace). */
  onBind: (workspaceId: string | null) => void;
  onToggleTrust: () => void;
}

/**
 * Chip do workspace da sessão + menu de ações (WORKBENCH §4). Sem workspace o
 * chip vira o CTA "Sem workspace" (abrir pasta ou vincular a um já aberto) —
 * nunca um beco sem saída.
 */
function WorkspaceChip({
  workspace,
  busy,
  onRefresh,
  onOpenExplorer,
  onCopyPath,
  onOpenFolder,
  onBind,
  onToggleTrust,
}: WorkspaceChipProps) {
  const { workspaces } = useWorkspaces();
  const Icon = workspace ? (workspace.git ? FolderGit2 : Folder) : FolderOpen;
  const label = workspace ? workspace.name : 'Sem workspace';
  const branch = workspace?.git?.branch;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-haspopup="menu"
          aria-label={
            workspace
              ? `Workspace ${workspace.name}${branch ? `, branch ${branch}` : ''}${
                  workspace.git?.dirty ? ', alterações não commitadas' : ''
                }`
              : 'Sem workspace — abrir pasta'
          }
          title={workspace?.path ?? 'Abrir uma pasta para o agente trabalhar'}
          className={chipClassName}
        >
          <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{label}</span>
          {branch ? (
            <span className="flex min-w-0 items-center gap-1 text-foreground-subtle">
              <span aria-hidden>·</span>
              <GitBranch aria-hidden className="size-3 shrink-0" strokeWidth={1.75} />
              <span className="max-w-24 truncate">{branch}</span>
            </span>
          ) : null}
          {workspace?.git?.dirty ? (
            <span
              aria-hidden
              title="Alterações não commitadas"
              className="size-1.5 shrink-0 rounded-full bg-warning"
            />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        {workspace ? (
          <>
            <DropdownMenuLabel className="max-w-56 truncate normal-case tracking-normal text-foreground-muted">
              {workspace.name}
            </DropdownMenuLabel>
            <DropdownMenuItem icon={<RefreshCw className="size-4" />} onSelect={onRefresh}>
              Atualizar
            </DropdownMenuItem>
            <DropdownMenuItem icon={<ExternalLink className="size-4" />} onSelect={onOpenExplorer}>
              Abrir no Explorer
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Copy className="size-4" />} onSelect={onCopyPath}>
              Copiar caminho
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<ShieldCheck className="size-4" />}
              onSelect={onToggleTrust}
              disabled={busy}
            >
              {workspace.trusted ? 'Revogar confiança' : 'Confiar na pasta'}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuLabel className="normal-case tracking-normal text-foreground-muted">
              Nenhuma pasta vinculada
            </DropdownMenuLabel>
            <DropdownMenuItem icon={<FolderOpen className="size-4" />} onSelect={onOpenFolder}>
              Abrir pasta…
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Trocar workspace</DropdownMenuLabel>
        <DropdownMenuItem
          icon={<Folder className="size-4" />}
          checked={!workspace}
          onSelect={() => onBind(null)}
        >
          Sem workspace
        </DropdownMenuItem>
        {workspaces.map((entry) => (
          <DropdownMenuItem
            key={entry.id}
            icon={entry.git ? <FolderGit2 className="size-4" /> : <Folder className="size-4" />}
            checked={workspace?.id === entry.id}
            onSelect={() => onBind(entry.id)}
          >
            {entry.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Code session chrome (WORKBENCH §4): título, chip do workspace real (branch,
 * dirty, ações), medidor de contexto, toggle do painel e abas das sessões
 * abertas. Também hospeda o diálogo de confiança da primeira pasta — o
 * cabeçalho é o único chrome sempre montado no layout Code.
 */
export function CodeSessionHeader() {
  const activeId = useChatStore((state) => state.activeId);
  const conversations = useChatStore((state) => state.conversations);
  const codePanelOpen = useUiStore((state) => state.codePanelOpen);
  const toggleCodePanel = useUiStore((state) => state.toggleCodePanel);
  const codeView = useUiStore((state) => state.codeView);
  const codeDiffTab = useUiStore((state) => state.codeDiffTab);
  const closeCodeDiff = useUiStore((state) => state.closeCodeDiff);
  const codeCommitsTab = useUiStore((state) => state.codeCommitsTab);
  const closeCodeCommits = useUiStore((state) => state.closeCodeCommits);
  const codeFileTabs = useUiStore((state) => state.codeFileTabs);
  const codePlanTab = useUiStore((state) => state.codePlanTab);
  const codeGoalOpen = useUiStore((state) => state.codeGoalOpen);
  const codeFileTab = useUiStore((state) => state.codeFileTab);
  const closeCodeFile = useUiStore((state) => state.closeCodeFile);
  const viewportWidth = useViewportWidth();
  /** The docked code panel only exists on wide windows (see CodePanel). */
  const canDock = viewportWidth >= SIDE_PANEL_DOCK_MIN_VIEWPORT;

  const { workspaces, pendingTrust, refreshContext, resolveTrust, cancelTrust } = useWorkspaces();

  const [trustBusy, setTrustBusy] = useState(false);

  // Sessions are separated per layout: the Code tabs only ever mirror Code
  // sessions and Chat sessions explicitly shared with Code (chat-code-sessions).
  const codeConversations = useMemo(
    () => filterConversationsForLayout(conversations, 'code'),
    [conversations],
  );

  const [openIds, setOpenIds] = useState<string[]>(() => (activeId ? [activeId] : []));
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const addTabRef = (id: string) => (node: HTMLButtonElement | null) => {
    if (node) tabRefs.current.set(id, node);
    else tabRefs.current.delete(id);
  };
  const plusRef = useRef<HTMLButtonElement | null>(null);

  /** Restores keyboard focus after closing a tab (R3 do EVIDENCE da fase 1). */
  const focusTab = (id: string | undefined) => {
    window.setTimeout(() => {
      if (id) tabRefs.current.get(id)?.focus();
      else plusRef.current?.focus();
    }, 0);
  };

  /* The active conversation always becomes a tab; tabs of deleted (or no
     longer Code-visible) conversations are dropped. Comparing before returning
     keeps the previous array (and the render) when nothing changed. */
  useEffect(() => {
    const known = new Set(codeConversations.map((conversation) => conversation.id));
    setOpenIds((previous) => {
      const next = previous.filter((id) => known.has(id));
      if (activeId && known.has(activeId) && !next.includes(activeId)) next.push(activeId);
      if (next.length === previous.length && next.every((id, index) => id === previous[index])) {
        return previous;
      }
      return next;
    });
  }, [activeId, codeConversations]);

  const activeConversation = activeId
    ? codeConversations.find((conversation) => conversation.id === activeId)
    : undefined;
  const title = activeConversation?.title ?? NEW_SESSION_TITLE;
  // Aprovação/pergunta pendente precisa ser descobrível mesmo com o card fora
  // da viewport (WORKBENCH §9: badge âmbar na aba/header).
  const pendingApprovals = useCodeStore((state) => {
    if (!activeId) return 0;
    const session = state.byConversation[activeId];
    if (!session) return 0;
    return session.approvals.length + session.questions.length;
  });
  // Objetivo persistento da sessão ativa (docs/goals/code-goals): o badge só
  // aparece quando há objetivo e ele não está concluído (PLAN §10.6).
  const activeGoal = useCodeStore((state) =>
    activeId ? (state.byConversation[activeId]?.goal ?? null) : null,
  );
  const streaming = useChatStore((state) => state.streaming);
  const goalRunning = activeGoal
    ? goalIsRunning(
        activeGoal,
        streaming != null,
        streaming?.turnKind,
        streaming?.conversationId,
        activeId,
      )
    : false;
  const tabs: SessionTab[] =
    openIds.length === 0
      ? []
      : openIds.map((id) => ({ id, title: sessionTitle(codeConversations, id) }));
  /* No active Code session (no conversation, or it belongs to Chat only): the
     tab strip falls back to the synthetic "Nova sessão" tab, so the tablist
     always has exactly one selected tab. */
  const showNewSessionTab = activeConversation === undefined;

  const workspace = activeConversation?.workspaceId
    ? (workspaces.find((entry) => entry.id === activeConversation.workspaceId) ?? null)
    : null;

  const selectTab = (id: string) => {
    if (id.startsWith(CODE_FILE_TAB_PREFIX)) {
      /* Ativar a aba de arquivo (sem duplicar: `openCodeFile` só ativa se já
         estiver aberto) e mostrar o arquivo no centro. */
      const fileTarget = findCodeFileTab(id);
      if (fileTarget) useUiStore.getState().openCodeFile(fileTarget);
      return;
    }
    if (id === CODE_DIFF_TAB_ID) {
      useUiStore.getState().setCodeView('diff');
      return;
    }
    if (id === CODE_COMMITS_TAB_ID) {
      useUiStore.getState().setCodeView('commits');
      return;
    }
    if (id === CODE_PLAN_TAB_ID) {
      useUiStore.getState().setCodeView('plan');
      return;
    }
    if (id === CODE_GOAL_TAB_ID) {
      useUiStore.getState().openCodeGoal();
      return;
    }
    if (id === NEW_SESSION_ID) return;
    const isActiveConversation = id === activeId;
    // Clicar na aba da conversa que JÁ está ativa é no-op… exceto quando o
    // centro mostra o diff: aí a aba é o caminho de volta para a sessão.
    if (isActiveConversation && codeView === 'session') return;
    useUiStore.getState().setCodeView('session');
    if (!isActiveConversation) void useChatStore.getState().openConversation(id);
  };

  const closeTab = (id: string) => {
    if (id === NEW_SESSION_ID) return;
    if (id.startsWith(CODE_FILE_TAB_PREFIX)) {
      const fileTarget = findCodeFileTab(id);
      if (!fileTarget) return;
      closeCodeFile(fileTarget);
      /* Devolve o foco: nova aba ativa (a vizinha, quando a fechada era ativa),
         senão a aba da sessão ativa, senão o botão "+" (padrão de `focusTab`). */
      const nextFileTab = useUiStore.getState().codeFileTab;
      if (nextFileTab) focusTab(codeFileTabDomId(nextFileTab));
      else focusTab(activeId ?? undefined);
      return;
    }
    if (id === CODE_DIFF_TAB_ID) {
      closeCodeDiff();
      focusTab(activeId ?? undefined);
      return;
    }
    if (id === CODE_COMMITS_TAB_ID) {
      closeCodeCommits();
      focusTab(activeId ?? undefined);
      return;
    }
    if (id === CODE_PLAN_TAB_ID) {
      useUiStore.getState().closeCodePlan();
      focusTab(activeId ?? undefined);
      return;
    }
    if (id === CODE_GOAL_TAB_ID) {
      useUiStore.getState().closeCodeGoal();
      focusTab(activeId ?? undefined);
      return;
    }
    const index = tabs.findIndex((tab) => tab.id === id);
    const rest = tabs.filter((tab) => tab.id !== id);
    setOpenIds(rest.map((tab) => tab.id));
    if (id !== activeId) {
      focusTab(activeId ?? undefined);
      return;
    }
    // Closing the active tab falls back to the next one, then to the previous;
    // closing the last tab returns to the "Nova sessão" welcome state. The
    // conversation itself stays in the history (there is no backend close).
    const neighbor = tabs[index + 1] ?? tabs[index - 1];
    if (neighbor) {
      void useChatStore.getState().openConversation(neighbor.id);
      focusTab(neighbor.id);
    } else {
      useChatStore.getState().clearActiveConversation();
      focusTab(undefined);
    }
  };

  const createSession = () => {
    useUiStore.getState().setCodeView('session');
    void useChatStore.getState().startNewConversation('code');
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLElement>, id: string) => {
    const tablist = event.currentTarget.closest('[role="tablist"]');
    const items = tablist ? Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]')) : [];
    const index = items.indexOf(event.currentTarget);
    const focusAt = (nextIndex: number) => {
      const element = items[nextIndex];
      if (!element) return;
      event.preventDefault();
      element.focus();
    };

    switch (event.key) {
      case 'ArrowRight':
        focusAt((index + 1) % items.length);
        break;
      case 'ArrowLeft':
        focusAt((index - 1 + items.length) % items.length);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(items.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        selectTab(id);
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        closeTab(id);
        break;
      default:
        break;
    }
  };

  const handleBindWorkspace = async (workspaceId: string | null) => {
    if (!activeConversation || workspaceId === (activeConversation.workspaceId ?? null)) return;
    try {
      await api.setConversationWorkspace(activeConversation.id, workspaceId);
      useUiStore
        .getState()
        .openWorkspaceSession(workspaceId ?? NO_WORKSPACE_KEY, activeConversation.id);
      await useChatStore.getState().refreshConversations();
      if (workspaceId) useUiStore.getState().setActiveWorkspace(workspaceId);
    } catch (error) {
      toast.error('Não foi possível trocar o workspace da sessão', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleOpenFolder = () => {
    void openFolder({ conversationId: activeConversation?.id ?? null });
  };

  const handleCopyPath = async () => {
    if (!workspace) return;
    if (await copyText(workspace.path)) toast.success('Caminho copiado');
    else toast.error('Não foi possível copiar o caminho');
  };

  const handleTrustToggle = () => {
    if (!workspace) return;
    const next = !workspace.trusted;
    setTrustBusy(true);
    void api
      .setWorkspaceTrusted(workspace.id, next)
      .then(async () => {
        await refreshContext(workspace.id);
        toast.success(next ? 'Pasta confiada' : 'Confiança revogada', {
          description: next
            ? 'O agente pode ler, editar e executar comandos.'
            : 'O agente volta ao modo leitura neste workspace.',
        });
      })
      .catch((error: unknown) => {
        toast.error('Não foi possível atualizar a confiança da pasta', {
          description: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => setTrustBusy(false));
  };

  const handleResolveTrust = async (trusted: boolean) => {
    setTrustBusy(true);
    try {
      await resolveTrust(trusted);
    } finally {
      setTrustBusy(false);
    }
  };

  const handleCancelTrust = async () => {
    setTrustBusy(true);
    try {
      await cancelTrust();
    } finally {
      setTrustBusy(false);
    }
  };

  const panelLabel = codePanelOpen ? 'Ocultar painel de arquivos' : 'Mostrar painel de arquivos';
  const panelButton = (
    <IconButton
      label={panelLabel}
      size="sm"
      active={codePanelOpen}
      aria-pressed={codePanelOpen}
      disabled={!canDock}
      onClick={toggleCodePanel}
    >
      <PanelRight className="size-4" />
    </IconButton>
  );

  return (
    <header className="flex shrink-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2
          className="min-w-0 truncate text-[13px] font-semibold tracking-tight text-foreground"
          title={title}
        >
          {title}
        </h2>

        {pendingApprovals > 0 ? (
          <Badge
            variant="warning"
            title={`${pendingApprovals} ${pendingApprovals === 1 ? 'pedido aguardando' : 'pedidos aguardando'} sua decisão`}
          >
            Aguardando aprovação
          </Badge>
        ) : null}

        {activeGoal && activeGoal.status !== 'completed' ? (
          <GoalBadge
            goal={activeGoal}
            running={goalRunning}
            onOpen={() => useUiStore.getState().openCodeGoal()}
          />
        ) : null}

        <WorkspaceChip
          workspace={workspace}
          busy={trustBusy}
          onRefresh={() => workspace && void refreshContext(workspace.id)}
          onOpenExplorer={() => workspace && void api.openWorkspaceInExplorer(workspace.id)}
          onCopyPath={() => void handleCopyPath()}
          onOpenFolder={handleOpenFolder}
          onBind={(workspaceId) => void handleBindWorkspace(workspaceId)}
          onToggleTrust={handleTrustToggle}
        />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {activeConversation ? (
            <CodeContextMeterChip conversationId={activeConversation.id} />
          ) : null}
          {canDock ? (
            <Tooltip content={panelLabel} side="bottom">
              {panelButton}
            </Tooltip>
          ) : (
            <Tooltip content="Aumente a janela para ver o painel de arquivos" side="bottom">
              {/* Disabled buttons swallow pointer events: hover the wrapper so the hint stays discoverable. */}
              <span className="inline-flex" title="Aumente a janela para ver o painel de arquivos">
                {panelButton}
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-1 px-2">
        <div
          role="tablist"
          aria-label="Sessões abertas"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-0.5"
        >
          {showNewSessionTab ? (
            <div
              role="tab"
              aria-label={NEW_SESSION_TITLE}
              aria-selected
              aria-controls={SESSION_PANEL_ID}
              title={NEW_SESSION_TITLE}
              tabIndex={0}
              className={cn(
                'flex h-8 max-w-44 shrink-0 select-none items-center rounded-lg',
                'bg-surface-raised pl-2.5 pr-2 text-[12px] text-foreground shadow-sm',
                'outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              )}
            >
              <span className="truncate">{NEW_SESSION_TITLE}</span>
            </div>
          ) : (
            tabs.map((tab) => {
              const selected = tab.id === activeId && codeView === 'session';
              return (
                <div
                  key={tab.id}
                  role="presentation"
                  className={cn(
                    'group flex h-8 max-w-44 shrink-0 items-center rounded-lg transition-colors duration-150',
                    selected
                      ? 'bg-surface-raised text-foreground shadow-sm'
                      : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                  )}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-label={tab.title}
                    aria-selected={selected}
                    aria-controls={SESSION_PANEL_ID}
                    title={tab.title}
                    tabIndex={selected ? 0 : -1}
                    ref={addTabRef(tab.id)}
                    onClick={() => selectTab(tab.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                    className={cn(
                      'h-full min-w-0 flex-1 cursor-pointer select-none rounded-l-lg pl-2.5 text-left text-[12px]',
                      'outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    )}
                  >
                    <span className="block truncate">{tab.title}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Fechar ${tab.title}`}
                    tabIndex={-1}
                    onClick={() => closeTab(tab.id)}
                    className={cn(
                      'mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-subtle',
                      'transition-colors duration-150 hover:bg-surface-active hover:text-foreground',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    )}
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </div>
              );
            })
          )}
          {codeFileTabs.map((fileTab) => {
            const id = codeFileTabDomId(fileTab);
            const name = codeFileTabName(fileTab);
            const selected =
              codeView === 'file' &&
              codeFileTab !== null &&
              codeFileTabKey(codeFileTab) === codeFileTabKey(fileTab);
            return (
              <div
                key={id}
                role="presentation"
                className={cn(
                  'group flex h-8 max-w-44 shrink-0 items-center rounded-lg transition-colors duration-150',
                  selected
                    ? 'bg-surface-raised text-foreground shadow-sm'
                    : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-label={`Arquivo ${fileTab.path}`}
                  aria-selected={selected}
                  aria-controls="code-file-panel"
                  title={`Arquivo ${fileTab.path}`}
                  tabIndex={selected ? 0 : -1}
                  ref={addTabRef(id)}
                  onClick={() => selectTab(id)}
                  onKeyDown={(event) => handleTabKeyDown(event, id)}
                  className={cn(
                    'flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-l-lg pl-2.5 text-left text-[12px]',
                    'outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  )}
                >
                  <FileIcon path={fileTab.path} className="size-3.5" />
                  <span className="truncate">{name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Fechar ${name}`}
                  tabIndex={-1}
                  onClick={() => closeTab(id)}
                  className={cn(
                    'mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-subtle',
                    'transition-colors duration-150 hover:bg-surface-active hover:text-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  )}
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </div>
            );
          })}
          {codePlanTab ? (
            <div
              role="presentation"
              className={cn(
                'group flex h-8 max-w-44 shrink-0 items-center rounded-lg transition-colors duration-150',
                codeView === 'plan'
                  ? 'bg-surface-raised text-foreground shadow-sm'
                  : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-label="Plano aprovado da sessão"
                aria-selected={codeView === 'plan'}
                aria-controls="code-plan-panel"
                title="Plano aprovado da sessão"
                tabIndex={codeView === 'plan' ? 0 : -1}
                ref={addTabRef(CODE_PLAN_TAB_ID)}
                onClick={() => selectTab(CODE_PLAN_TAB_ID)}
                onKeyDown={(event) => handleTabKeyDown(event, CODE_PLAN_TAB_ID)}
                className={cn(
                  'flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-l-lg pl-2.5 text-left text-[12px]',
                  'outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
              >
                <FileIcon path="Plano.md" className="size-3.5 shrink-0" />
                <span className="truncate">{codePlanTab.title ?? 'Plano'}</span>
              </button>
              <button
                type="button"
                aria-label="Fechar plano"
                tabIndex={-1}
                onClick={() => closeTab(CODE_PLAN_TAB_ID)}
                className={cn(
                  'mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-subtle',
                  'transition-colors duration-150 hover:bg-surface-active hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </div>
          ) : null}
          {codeGoalOpen ? (
            <div
              role="presentation"
              className={cn(
                'group flex h-8 max-w-44 shrink-0 items-center rounded-lg transition-colors duration-150',
                codeView === 'goal'
                  ? 'bg-surface-raised text-foreground shadow-sm'
                  : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-label="Objetivo da sessão"
                aria-selected={codeView === 'goal'}
                aria-controls="code-goal-panel"
                title="Objetivo da sessão"
                tabIndex={codeView === 'goal' ? 0 : -1}
                ref={addTabRef(CODE_GOAL_TAB_ID)}
                onClick={() => selectTab(CODE_GOAL_TAB_ID)}
                onKeyDown={(event) => handleTabKeyDown(event, CODE_GOAL_TAB_ID)}
                className={cn(
                  'flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-l-lg pl-2.5 text-left text-[12px]',
                  'outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
              >
                <Target aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">Objetivo</span>
              </button>
              <button
                type="button"
                aria-label="Fechar objetivo"
                tabIndex={-1}
                onClick={() => closeTab(CODE_GOAL_TAB_ID)}
                className={cn(
                  'mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-subtle',
                  'transition-colors duration-150 hover:bg-surface-active hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </div>
          ) : null}
          {codeDiffTab ? (
            <div
              role="presentation"
              className={cn(
                'group flex h-8 max-w-44 shrink-0 items-center rounded-lg transition-colors duration-150',
                codeView === 'diff'
                  ? 'bg-surface-raised text-foreground shadow-sm'
                  : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-label={`Diff de ${codeDiffTab.path}`}
                aria-selected={codeView === 'diff'}
                aria-controls="code-diff-panel"
                title={`Diff: ${codeDiffTab.path}`}
                tabIndex={codeView === 'diff' ? 0 : -1}
                ref={addTabRef(CODE_DIFF_TAB_ID)}
                onClick={() => selectTab(CODE_DIFF_TAB_ID)}
                onKeyDown={(event) => handleTabKeyDown(event, CODE_DIFF_TAB_ID)}
                className={cn(
                  'flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-l-lg pl-2.5 text-left text-[12px]',
                  'outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
              >
                <FileDiff aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">Diff</span>
              </button>
              <button
                type="button"
                aria-label={`Fechar diff de ${codeDiffTab.path}`}
                tabIndex={-1}
                onClick={() => closeTab(CODE_DIFF_TAB_ID)}
                className={cn(
                  'mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-subtle',
                  'transition-colors duration-150 hover:bg-surface-active hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </div>
          ) : null}
          {codeCommitsTab ? (
            <div
              role="presentation"
              className={cn(
                'group flex h-8 max-w-44 shrink-0 items-center rounded-lg transition-colors duration-150',
                codeView === 'commits'
                  ? 'bg-surface-raised text-foreground shadow-sm'
                  : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-label="Histórico de commits"
                aria-selected={codeView === 'commits'}
                aria-controls="code-commits-panel"
                title="Histórico de commits"
                tabIndex={codeView === 'commits' ? 0 : -1}
                ref={addTabRef(CODE_COMMITS_TAB_ID)}
                onClick={() => selectTab(CODE_COMMITS_TAB_ID)}
                onKeyDown={(event) => handleTabKeyDown(event, CODE_COMMITS_TAB_ID)}
                className={cn(
                  'flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-l-lg pl-2.5 text-left text-[12px]',
                  'outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
              >
                <History aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">Commits</span>
              </button>
              <button
                type="button"
                aria-label="Fechar histórico de commits"
                tabIndex={-1}
                onClick={() => closeTab(CODE_COMMITS_TAB_ID)}
                className={cn(
                  'mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-subtle',
                  'transition-colors duration-150 hover:bg-surface-active hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </div>
          ) : null}
        </div>

        <Tooltip content="Nova sessão" side="bottom">
          <IconButton ref={plusRef} label="Nova sessão" size="sm" onClick={createSession}>
            <Plus className="size-4" />
          </IconButton>
        </Tooltip>
      </div>

      {/* O diálogo de confiança vive aqui: o cabeçalho é o único chrome do Code
          sempre montado (inclusive quando a sidebar é um drawer fechado). */}
      <WorkspaceTrustDialog
        open={pendingTrust !== null}
        workspace={pendingTrust?.workspace ?? null}
        busy={trustBusy}
        onConfirm={() => void handleResolveTrust(true)}
        onReadOnly={() => void handleResolveTrust(false)}
        onCancel={() => void handleCancelTrust()}
      />
    </header>
  );
}

export default CodeSessionHeader;

