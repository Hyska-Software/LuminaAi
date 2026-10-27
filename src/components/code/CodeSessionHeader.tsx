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
  ListChecks,
  PanelRight,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
} from '@/components/ui';
import { api } from '@/lib/api';
import { filterConversationsForLayout } from '@/lib/conversations';
import { useChatStore, useUiStore } from '@/lib/store';
import type { Conversation, PermissionMode, Workspace } from '@/lib/types';
import { SIDE_PANEL_DOCK_MIN_VIEWPORT, useViewportWidth } from '@/lib/sidePanel';
import { cn, copyText } from '@/lib/utils';
import { WorkspaceTrustDialog } from './WorkspaceTrustDialog';
import { CodeContextMeterChip } from './CodeAgentWidgets';
import { NO_WORKSPACE_KEY, openFolder, useWorkspaces } from './useWorkspaces';

/** Synthetic tab shown when the Code layout has no active conversation. */
const NEW_SESSION_ID = '__new_session__';
const NEW_SESSION_TITLE = 'Nova sessão';
/** Synthetic center tab for an open file diff (WORKBENCH §7.2). */
const CODE_DIFF_TAB_ID = '__code_diff__';
/** Synthetic center tab for the commit history (WORKBENCH §7.2). */
const CODE_COMMITS_TAB_ID = '__code_commits__';

/**
 * Id of the conversation surface the session tabs control. `WorkspaceCenter`
 * (layout/) owns that element and should render it with this id so
 * `aria-controls` points at a real region.
 */
const SESSION_PANEL_ID = 'code-session-panel';

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  read_only: 'Leitura',
  edit: 'Editar',
  autonomous: 'Autônomo',
};

const PERMISSION_DESCRIPTIONS: Record<PermissionMode, string> = {
  read_only: 'O agente só pode ler arquivos e consultar o workspace.',
  edit: 'O agente pode editar arquivos; comandos pedem aprovação.',
  autonomous: 'O agente pode editar e executar comandos com menos confirmações.',
};

const PERMISSION_ICONS: Record<PermissionMode, LucideIcon> = {
  read_only: Shield,
  edit: ShieldCheck,
  autonomous: ShieldAlert,
};

const PERMISSION_ORDER: PermissionMode[] = ['read_only', 'edit', 'autonomous'];

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

interface PermissionChipProps {
  permissionMode: PermissionMode;
  busy: boolean;
  onChange: (mode: PermissionMode) => void;
}

/** Chip do modo de permissão da sessão (Leitura / Editar / Autônomo). */
function PermissionChip({ permissionMode, busy, onChange }: PermissionChipProps) {
  const Icon = PERMISSION_ICONS[permissionMode];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-haspopup="menu"
          aria-label={`Modo de permissão: ${PERMISSION_LABELS[permissionMode]}`}
          title={PERMISSION_DESCRIPTIONS[permissionMode]}
          disabled={busy}
          className={chipClassName}
        >
          <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{PERMISSION_LABELS[permissionMode]}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        <DropdownMenuLabel>Modo de permissão</DropdownMenuLabel>
        {PERMISSION_ORDER.map((mode) => {
          const ModeIcon = PERMISSION_ICONS[mode];
          return (
            <DropdownMenuItem
              key={mode}
              icon={<ModeIcon className="size-4" />}
              checked={mode === permissionMode}
              onSelect={() => onChange(mode)}
            >
              {PERMISSION_LABELS[mode]}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <p className="px-2 pb-1 text-[11px] leading-relaxed text-foreground-subtle">
          {PERMISSION_DESCRIPTIONS[permissionMode]}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Code session chrome (WORKBENCH §4): título, chip do workspace real (branch,
 * dirty, ações), modo de permissão, chip de plano, toggle do painel e abas das
 * sessões abertas. Também hospeda o diálogo de confiança da primeira pasta —
 * o cabeçalho é o único chrome sempre montado no layout Code.
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
  const viewportWidth = useViewportWidth();
  /** The docked code panel only exists on wide windows (see CodePanel). */
  const canDock = viewportWidth >= SIDE_PANEL_DOCK_MIN_VIEWPORT;

  const { workspaces, pendingTrust, refreshContext, resolveTrust, cancelTrust } = useWorkspaces();

  const [permissionMode, setPermissionMode] = useState<PermissionMode>('edit');
  const [planMode, setPlanMode] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
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

  /* Permission/plan come from the session state; the conversation row is the
     fallback while the backend snapshot is not available yet. A troca de
     permissão é otimista: o efeito só re-sincroniza quando a SESSÃO muda (id),
     nunca quando `refreshConversations` substitui o objeto da conversa. */
  const activeConversationId = activeConversation?.id;
  useEffect(() => {
    if (!activeConversationId) {
      setPermissionMode('edit');
      setPlanMode(false);
      return;
    }
    const conversation = useChatStore
      .getState()
      .conversations.find((entry) => entry.id === activeConversationId);
    setPermissionMode(conversation?.permissionMode ?? 'edit');
    setPlanMode(false);
    let cancelled = false;
    if (typeof api.getCodeSessionState === 'function') {
      void api
        .getCodeSessionState(activeConversationId)
        .then((state) => {
          if (cancelled || !state) return;
          setPermissionMode(state.permissionMode);
          setPlanMode(state.planMode);
        })
        .catch(() => {
          /* Snapshot opcional: a sessão continua com o modo da conversa. */
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

  /* Quando o diálogo de confiança fecha (o hook aplica o modo de permissão),
     a sessão já existe e o efeito acima não roda de novo. Re-sincroniza uma vez
     para o chip refletir "Leitura" ao abrir em leitura. */
  const pendingTrustRef = useRef(pendingTrust);
  useEffect(() => {
    const hadPending = pendingTrustRef.current !== null;
    pendingTrustRef.current = pendingTrust;
    if (!hadPending || pendingTrust !== null || !activeConversationId) return;
    if (typeof api.getCodeSessionState !== 'function') return;
    let cancelled = false;
    void api
      .getCodeSessionState(activeConversationId)
      .then((state) => {
        if (cancelled || !state) return;
        setPermissionMode(state.permissionMode);
        setPlanMode(state.planMode);
      })
      .catch(() => {
        /* Snapshot opcional. */
      });
    return () => {
      cancelled = true;
    };
  }, [pendingTrust, activeConversationId]);

  const selectTab = (id: string) => {
    if (id === CODE_DIFF_TAB_ID) {
      useUiStore.getState().setCodeView('diff');
      return;
    }
    if (id === CODE_COMMITS_TAB_ID) {
      useUiStore.getState().setCodeView('commits');
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

  const handlePermissionChange = async (mode: PermissionMode) => {
    if (!activeConversation || mode === permissionMode || permissionBusy) return;
    const previous = permissionMode;
    // Atualização otimista: o chip responde na hora; erro volta ao modo anterior.
    setPermissionMode(mode);
    setPermissionBusy(true);
    try {
      const state = await api.setPermissionMode(activeConversation.id, mode);
      if (state?.permissionMode) setPermissionMode(state.permissionMode);
      await useChatStore.getState().refreshConversations();
    } catch (error) {
      setPermissionMode(previous);
      toast.error('Não foi possível mudar o modo de permissão', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPermissionBusy(false);
    }
  };

  const handlePlanToggle = async () => {
    if (!activeConversation || planBusy) return;
    const previous = planMode;
    setPlanMode(!previous);
    setPlanBusy(true);
    try {
      const state = await api.setPlanMode(activeConversation.id, !previous);
      if (state) setPlanMode(state.planMode);
    } catch (error) {
      setPlanMode(previous);
      toast.error('Não foi possível alternar o modo Plano', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPlanBusy(false);
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

        {activeConversation ? (
          <>
            <PermissionChip
              permissionMode={permissionMode}
              busy={permissionBusy}
              onChange={(mode) => void handlePermissionChange(mode)}
            />
            <Tooltip
              content={
                planMode
                  ? 'Modo Plano ativo: o agente planeja antes de editar'
                  : 'Ativar modo Plano (planejar antes de editar)'
              }
              side="bottom"
            >
              <button
                type="button"
                aria-label="Modo Plano"
                aria-pressed={planMode}
                title="Modo Plano"
                disabled={planBusy}
                onClick={() => void handlePlanToggle()}
                className={cn(
                  chipClassName,
                  planMode && 'border-accent/40 bg-accent-soft text-accent hover:bg-accent-soft',
                )}
              >
                <ListChecks aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="hidden truncate sm:inline">Plano</span>
              </button>
            </Tooltip>
          </>
        ) : null}

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

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
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
                'flex h-8 max-w-44 shrink-0 select-none items-center rounded-lg border border-border',
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
                    'group flex h-8 max-w-44 shrink-0 items-center rounded-lg border transition-colors duration-150',
                    selected
                      ? 'border-border bg-surface-raised text-foreground shadow-sm'
                      : 'border-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground',
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
          {codeDiffTab ? (
            <div
              role="presentation"
              className={cn(
                'group flex h-8 max-w-44 shrink-0 items-center rounded-lg border transition-colors duration-150',
                codeView === 'diff'
                  ? 'border-border bg-surface-raised text-foreground shadow-sm'
                  : 'border-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground',
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
                'group flex h-8 max-w-44 shrink-0 items-center rounded-lg border transition-colors duration-150',
                codeView === 'commits'
                  ? 'border-border bg-surface-raised text-foreground shadow-sm'
                  : 'border-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground',
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

