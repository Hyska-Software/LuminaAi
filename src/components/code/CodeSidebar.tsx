import { useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  ExternalLink,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  MessageSquare,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Kbd,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAppStore, useChatStore, useUiStore } from '@/lib/store';
import { filterConversationsForLayout } from '@/lib/conversations';
import type { Conversation, Workspace } from '@/lib/types';
import { cn, copyText, modKey } from '@/lib/utils';
import { useIsCompact } from '@/components/layout/hooks';
import { AddChatSessionDialog } from './AddChatSessionDialog';
import { NO_WORKSPACE_KEY, useWorkspaces } from './useWorkspaces';

export interface CodeSidebarProps {
  className?: string;
  /** Present when the sidebar is rendered as an overlay drawer (< 1024px). */
  onClose?: () => void;
}

interface SidebarActionProps {
  icon: ReactNode;
  label: string;
  /** Accessible name; defaults to the visible label. */
  ariaLabel?: string;
  /** Marks the entry as the current page (Skills view). */
  current?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
  onSelect: () => void;
}

/** Compact Paseo-style action row (PLAN §3.2). */
function SidebarAction({
  icon,
  label,
  ariaLabel,
  current,
  disabled,
  trailing,
  onSelect,
}: SidebarActionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={ariaLabel}
      aria-current={current ? 'page' : undefined}
      disabled={disabled}
      className={cn(
        'mx-3 mt-1 flex h-8 items-center gap-2 rounded-lg px-2 text-[13px]',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:pointer-events-none disabled:opacity-50',
        current
          ? 'bg-surface-active text-foreground'
          : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
      )}
    >
      <span className={cn('shrink-0', current ? 'text-accent' : 'text-foreground-subtle')}>{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      {trailing ? (
        <span className="ml-auto flex shrink-0 items-center gap-0.5">{trailing}</span>
      ) : null}
    </button>
  );
}

interface SessionRowProps {
  conversation: Conversation;
  active: boolean;
  /** Chat session explicitly added to the Code layout (docs/goals/chat-code-sessions). */
  shared: boolean;
  onSelect: () => void;
}

/** One real Code session row; the dot mirrors the Paseo status dot. */
function SessionRow({ conversation, active, shared, onSelect }: SessionRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      aria-label={shared ? `${conversation.title}, sessão compartilhada do Chat` : undefined}
      title={conversation.title}
      className={cn(
        'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px]',
        'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active
          ? 'bg-surface-active text-foreground'
          : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          active ? 'bg-accent' : 'bg-foreground-subtle',
        )}
      />
      <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
      {shared ? (
        <span
          title="Sessão compartilhada do Chat"
          className="ml-auto flex shrink-0 items-center gap-1 text-foreground-subtle"
        >
          <MessageSquare aria-hidden className="size-3.5" strokeWidth={1.75} />
          <span className="text-[10px] font-medium leading-none">Do Chat</span>
        </span>
      ) : null}
    </button>
  );
}

function workspaceIcon(workspace: Workspace) {
  return workspace.git ? FolderGit2 : Folder;
}

interface WorkspaceMenuProps {
  workspace: Workspace;
  onNewSession: () => void;
  onRename: () => void;
  onOpenExplorer: () => void;
  onCopyPath: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}

/** Menu de contexto de um workspace (WORKBENCH §3): ações reais, sem becos. */
function WorkspaceMenu({
  workspace,
  onNewSession,
  onRename,
  onOpenExplorer,
  onCopyPath,
  onRefresh,
  onRemove,
}: WorkspaceMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Opções do workspace ${workspace.name}`}
          title="Opções do workspace"
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-subtle',
            'transition-colors duration-150 hover:bg-surface-active hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            'lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 lg:data-[state=open]:opacity-100',
          )}
        >
          <Ellipsis aria-hidden className="size-4" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className="max-w-48 truncate normal-case tracking-normal text-foreground-muted">
          {workspace.name}
        </DropdownMenuLabel>
        <DropdownMenuItem icon={<SquarePen className="size-4" />} onSelect={onNewSession}>
          Nova sessão
        </DropdownMenuItem>
        <DropdownMenuItem icon={<RefreshCw className="size-4" />} onSelect={onRefresh}>
          Atualizar
        </DropdownMenuItem>
        <DropdownMenuItem icon={<ExternalLink className="size-4" />} onSelect={onOpenExplorer}>
          Abrir no Explorer
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Copy className="size-4" />} onSelect={onCopyPath}>
          Copiar caminho
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Folder className="size-4" />} onSelect={onRename}>
          Renomear
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" icon={<Trash2 className="size-4" />} onSelect={onRemove}>
          Remover do Lumina
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface WorkspaceRowProps {
  workspace: Workspace;
  sessions: Conversation[];
  active: boolean;
  expanded: boolean;
  activeConversationId: string | null;
  onToggle: () => void;
  onSelect: () => void;
  onNewSession: () => void;
  onRename: () => void;
  onOpenExplorer: () => void;
  onCopyPath: () => void;
  onRefresh: () => void;
  onRemove: () => void;
  onOpenConversation: (conversation: Conversation) => void;
}

function WorkspaceRow({
  workspace,
  sessions,
  active,
  expanded,
  activeConversationId,
  onToggle,
  onSelect,
  onNewSession,
  onRename,
  onOpenExplorer,
  onCopyPath,
  onRefresh,
  onRemove,
  onOpenConversation,
}: WorkspaceRowProps) {
  const Icon = workspaceIcon(workspace);
  const branch = workspace.git?.branch;
  const canExpand = sessions.length > 0;

  return (
    <div className={cn('rounded-lg', active && 'bg-surface-active/60')}>
      <div className="group flex h-8 min-w-0 items-center gap-0.5 rounded-lg pr-0.5">
        <button
          type="button"
          aria-label={
            canExpand
              ? expanded
                ? `Recolher sessões de ${workspace.name}`
                : `Expandir sessões de ${workspace.name}`
              : `Workspace ${workspace.name} sem sessões`
          }
          aria-expanded={canExpand ? expanded : undefined}
          disabled={!canExpand}
          onClick={onToggle}
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-subtle',
            'transition-colors duration-150 hover:bg-surface-hover hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            'disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          {expanded && canExpand ? (
            <ChevronDown aria-hidden className="size-3.5" strokeWidth={1.75} />
          ) : (
            <ChevronRight aria-hidden className="size-3.5" strokeWidth={1.75} />
          )}
        </button>

        <button
          type="button"
          onClick={onSelect}
          aria-current={active ? 'true' : undefined}
          aria-label={workspace.name}
          title={`${workspace.name} — ${workspace.path}`}
          className={cn(
            'flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left text-[13px]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            active
              ? 'text-foreground'
              : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
          )}
        >
          <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 truncate font-medium">{workspace.name}</span>
          {branch ? (
            <span className="flex min-w-0 shrink items-center gap-0.5 text-[10.5px] text-foreground-subtle">
              <GitBranch aria-hidden className="size-2.5 shrink-0" strokeWidth={1.75} />
              <span className="max-w-16 truncate">{branch}</span>
              {workspace.git?.dirty ? (
                <span
                  aria-hidden
                  title="Alterações não commitadas"
                  className="size-1 shrink-0 rounded-full bg-warning"
                />
              ) : null}
            </span>
          ) : null}
          {workspace.trusted === false ? (
            <span
              title="Pasta não confiável — o agente está em modo leitura"
              className="shrink-0 rounded border border-warning/30 bg-warning-soft px-1 text-[9.5px] font-medium uppercase tracking-wide text-warning"
            >
              Leitura
            </span>
          ) : null}
          <span
            aria-hidden
            title={sessions.length === 1 ? '1 sessão' : `${sessions.length} sessões`}
            className="ml-auto shrink-0 text-[10px] tabular-nums text-foreground-subtle"
          >
            {sessions.length}
          </span>
        </button>

        <WorkspaceMenu
          workspace={workspace}
          onNewSession={onNewSession}
          onRename={onRename}
          onOpenExplorer={onOpenExplorer}
          onCopyPath={onCopyPath}
          onRefresh={onRefresh}
          onRemove={onRemove}
        />
      </div>

      {expanded && canExpand ? (
        <div className="mb-1 ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-1.5">
          {sessions.map((conversation) => (
            <SessionRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeConversationId}
              shared={conversation.codeLinked === true}
              onSelect={() => onOpenConversation(conversation)}
            />
          ))}
        </div>
      ) : null}

      {expanded && !canExpand ? (
        <p className="mb-1 ml-6 text-[11px] leading-relaxed text-foreground-subtle">
          Nenhuma sessão ainda — use “Nova sessão” no menu do workspace.
        </p>
      ) : null}
    </div>
  );
}

interface RenameWorkspaceDialogProps {
  workspace: Workspace | null;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function RenameWorkspaceDialog({
  workspace,
  value,
  busy,
  onChange,
  onCancel,
  onConfirm,
}: RenameWorkspaceDialogProps) {
  if (!workspace) return null;
  return (
    <Dialog open onOpenChange={(next) => (!next && !busy ? onCancel() : undefined)}>
      <DialogContent size="sm" className="gap-0">
        <DialogHeader>
          <DialogTitle>Renomear workspace</DialogTitle>
          <DialogDescription>
            O novo nome vale só no Lumina; a pasta no disco continua com o mesmo caminho.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-4">
          <Input
            autoFocus
            aria-label="Nome do workspace"
            value={value}
            disabled={busy}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onConfirm();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || value.trim().length === 0}
            loading={busy}
            onClick={onConfirm}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RemoveWorkspaceDialogProps {
  workspace: Workspace | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function RemoveWorkspaceDialog({ workspace, busy, onCancel, onConfirm }: RemoveWorkspaceDialogProps) {
  if (!workspace) return null;
  return (
    <Dialog open onOpenChange={(next) => (!next && !busy ? onCancel() : undefined)}>
      <DialogContent size="sm" className="gap-0">
        <DialogHeader>
          <DialogTitle>Remover workspace do Lumina?</DialogTitle>
          <DialogDescription>
            A pasta <span className="font-mono text-[11.5px]">{workspace.path}</span> não será apagada.
            As sessões continuam no histórico, mas deixam de aparecer agrupadas neste workspace.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="danger" size="sm" loading={busy} onClick={onConfirm}>
            Remover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Code layout sidebar (WORKBENCH §3): ações compactas, a seção **Workspaces**
 * real (pastas do backend) com sessões agrupadas por workspace, o grupo
 * "Sem workspace" para sessões da fase 1 e o rodapé existente.
 *
 * Nada de dado falso: vazio/erro/carregando são estados explícitos e as ações
 * só existem quando o backend suporta (abrir pasta, renomear, remover sem
 * apagar a pasta, abrir no Explorer, copiar caminho).
 */
export function CodeSidebar({ className, onClose }: CodeSidebarProps) {
  const conversations = useChatStore((state) => state.conversations);
  const activeId = useChatStore((state) => state.activeId);
  const codeView = useUiStore((state) => state.codeView);
  const setCodeView = useUiStore((state) => state.setCodeView);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const activeWorkspaceId = useUiStore((state) => state.activeWorkspaceId);
  const setActiveWorkspace = useUiStore((state) => state.setActiveWorkspace);
  const appInfo = useAppStore((state) => state.appInfo);
  const skillsPanelEnabled = useAppStore((state) => state.settings.skillsPanelEnabled);
  const isCompact = useIsCompact();

  const {
    workspaces,
    loading: workspacesLoading,
    loaded: workspacesLoaded,
    error: workspacesError,
    reload,
    openFolder,
    startSession,
    rename,
    remove,
    refreshContext,
  } = useWorkspaces();

  const [addSessionOpen, setAddSessionOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [openingFolder, setOpeningFolder] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Workspace | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Workspace | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const codeConversations = useMemo(
    () => filterConversationsForLayout(conversations, 'code'),
    [conversations],
  );

  const workspaceIds = useMemo(
    () => new Set(workspaces.map((workspace) => workspace.id)),
    [workspaces],
  );

  /** Sessões por workspace + sessões sem workspace (ou de workspace removido). */
  const { sessionsByWorkspace, unassignedSessions } = useMemo(() => {
    const byWorkspace = new Map<string, Conversation[]>();
    const unassigned: Conversation[] = [];
    for (const conversation of codeConversations) {
      const workspaceId = conversation.workspaceId;
      if (workspaceId && workspaceIds.has(workspaceId)) {
        const list = byWorkspace.get(workspaceId) ?? [];
        list.push(conversation);
        byWorkspace.set(workspaceId, list);
      } else {
        unassigned.push(conversation);
      }
    }
    for (const list of byWorkspace.values()) {
      list.sort((left, right) => right.updatedAt - left.updatedAt);
    }
    unassigned.sort((left, right) => right.updatedAt - left.updatedAt);
    return { sessionsByWorkspace: byWorkspace, unassignedSessions: unassigned };
  }, [codeConversations, workspaceIds]);

  const isExpanded = (workspaceId: string) => !collapsed.has(workspaceId);

  const toggleWorkspace = (workspaceId: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  };

  const openConversation = (conversation: Conversation) => {
    useUiStore.getState().setCodeView('session');
    void useChatStore.getState().openConversation(conversation.id);
    useUiStore
      .getState()
      .openWorkspaceSession(conversation.workspaceId ?? NO_WORKSPACE_KEY, conversation.id);
    if (isCompact) onClose?.();
  };

  const handleNewAgent = async () => {
    if (creatingSession || openingFolder) return;
    useUiStore.getState().setCodeView('session');
    if (activeWorkspaceId) {
      setCreatingSession(true);
      try {
        await startSession(activeWorkspaceId);
      } finally {
        setCreatingSession(false);
      }
      if (isCompact) onClose?.();
      return;
    }
    // Sem workspace ativo o fluxo honesto é abrir uma pasta (WORKBENCH §8.1).
    setOpeningFolder(true);
    try {
      const workspace = await openFolder();
      if (workspace && isCompact) onClose?.();
    } finally {
      setOpeningFolder(false);
    }
  };

  const handleOpenFolder = async () => {
    if (openingFolder) return;
    setOpeningFolder(true);
    try {
      const workspace = await openFolder();
      if (workspace) {
        useUiStore.getState().setCodeView('session');
        if (isCompact) onClose?.();
      }
    } finally {
      setOpeningFolder(false);
    }
  };

  const handleNewSessionIn = async (workspace: Workspace) => {
    useUiStore.getState().setCodeView('session');
    setActiveWorkspace(workspace.id);
    await startSession(workspace.id);
    if (isCompact) onClose?.();
  };

  const handleSelectWorkspace = (workspace: Workspace) => {
    setActiveWorkspace(workspace.id);
    if (collapsed.has(workspace.id)) toggleWorkspace(workspace.id);
  };

  const handleOpenExplorer = async (workspace: Workspace) => {
    try {
      await api.openWorkspaceInExplorer(workspace.id);
    } catch (error) {
      toast.error('Não foi possível abrir a pasta no Explorer', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleCopyPath = async (workspace: Workspace) => {
    if (await copyText(workspace.path)) toast.success('Caminho copiado');
    else toast.error('Não foi possível copiar o caminho');
  };

  const handleStartRename = (workspace: Workspace) => {
    setRenameTarget(workspace);
    setRenameValue(workspace.name);
  };

  const handleConfirmRename = async () => {
    if (!renameTarget || renameBusy) return;
    setRenameBusy(true);
    try {
      await rename(renameTarget, renameValue);
      setRenameTarget(null);
    } finally {
      setRenameBusy(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!removeTarget || removeBusy) return;
    setRemoveBusy(true);
    try {
      await remove(removeTarget);
      setRemoveTarget(null);
    } finally {
      setRemoveBusy(false);
    }
  };

  const handleAddSession = () => {
    setAddSessionOpen(true);
  };

  const handleSearch = () => {
    setCommandPaletteOpen(true);
  };

  const handleSkills = () => {
    setCodeView('skills');
    if (isCompact) onClose?.();
  };

  const handleOpenSettings = () => {
    setSettingsOpen(true);
    if (isCompact) onClose?.();
  };

  return (
    <aside
      aria-label="Sessões"
      className={cn('flex h-full w-full min-w-0 flex-col bg-surface', className)}
    >
      <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-3">
        <Button
          variant="secondary"
          size="md"
          onClick={() => void handleNewAgent()}
          loading={creatingSession || openingFolder}
          leftIcon={<SquarePen className="size-4" />}
          className="h-9 flex-1 justify-start rounded-xl px-3 text-[13px] font-medium"
        >
          Novo agente
        </Button>
        {onClose ? (
          <IconButton label="Fechar barra lateral" size="sm" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        ) : null}
      </div>

      <SidebarAction
        icon={<FolderPlus className="size-4" />}
        label="Abrir pasta"
        disabled={openingFolder}
        onSelect={() => void handleOpenFolder()}
      />
      <SidebarAction
        icon={<MessageSquarePlus className="size-4" />}
        label="Adicionar sessão do Chat"
        ariaLabel="Adicionar sessão do Chat"
        onSelect={handleAddSession}
      />
      <SidebarAction
        icon={<Search className="size-4" />}
        label="Buscar"
        trailing={
          <>
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </>
        }
        onSelect={handleSearch}
      />
      {skillsPanelEnabled ? (
        <SidebarAction
          icon={<Sparkles className="size-4" />}
          label="Skills"
          ariaLabel="Skills"
          current={codeView === 'skills'}
          onSelect={handleSkills}
        />
      ) : null}

      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden">
        <section
          aria-labelledby="code-workspaces-heading"
          className="flex min-h-0 flex-1 flex-col border-t border-border px-2 pb-1 pt-3"
        >
          <h2
            id="code-workspaces-heading"
            className="px-1 text-[11px] font-medium tracking-tight text-foreground-subtle"
          >
            Workspaces
          </h2>

          <div className="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
            {workspacesLoading && !workspacesLoaded ? (
              <div
                role="status"
                aria-label="Carregando workspaces"
                className="flex flex-col gap-2 px-1 py-2"
              >
                {[0, 1].map((index) => (
                  <div
                    key={index}
                    className="h-8 animate-pulse rounded-lg bg-surface-hover motion-reduce:animate-none"
                  />
                ))}
              </div>
            ) : workspacesError ? (
              <div role="alert" className="px-1 py-2">
                <p className="text-[12px] leading-relaxed text-danger">
                  Não foi possível carregar os workspaces.
                </p>
                <p className="mt-1 break-words text-[11px] leading-relaxed text-foreground-subtle">
                  {workspacesError}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  leftIcon={<RefreshCw className="size-3.5" />}
                  onClick={() => void reload()}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : workspaces.length === 0 ? (
              <div className="px-1 py-2">
                <p className="text-[12.5px] font-medium text-foreground-muted">
                  Nenhum workspace aberto
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-foreground-subtle">
                  Abra uma pasta para o agente ler, editar e rodar comandos.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  disabled={openingFolder}
                  loading={openingFolder}
                  leftIcon={<FolderOpen className="size-3.5" />}
                  onClick={() => void handleOpenFolder()}
                >
                  Abrir pasta…
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {workspaces.map((workspace) => (
                  <WorkspaceRow
                    key={workspace.id}
                    workspace={workspace}
                    sessions={sessionsByWorkspace.get(workspace.id) ?? []}
                    active={workspace.id === activeWorkspaceId}
                    expanded={isExpanded(workspace.id)}
                    activeConversationId={activeId}
                    onToggle={() => toggleWorkspace(workspace.id)}
                    onSelect={() => handleSelectWorkspace(workspace)}
                    onNewSession={() => void handleNewSessionIn(workspace)}
                    onRename={() => handleStartRename(workspace)}
                    onOpenExplorer={() => void handleOpenExplorer(workspace)}
                    onCopyPath={() => void handleCopyPath(workspace)}
                    onRefresh={() => void refreshContext(workspace.id)}
                    onRemove={() => setRemoveTarget(workspace)}
                    onOpenConversation={openConversation}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section
          aria-labelledby="code-unassigned-heading"
          className="shrink-0 border-t border-border px-2 pb-1 pt-2"
        >
          <h2
            id="code-unassigned-heading"
            className="px-1 text-[11px] font-medium tracking-tight text-foreground-subtle"
          >
            Sem workspace
          </h2>
          <div className="mt-1 max-h-44 overflow-y-auto overscroll-contain pb-1">
            {unassignedSessions.length === 0 ? (
              <p className="px-1 py-1.5 text-[11.5px] leading-relaxed text-foreground-subtle">
                Nenhuma sessão sem workspace. As sessões do Code aparecem aqui se você abrir uma pasta
                depois de criá-las.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {unassignedSessions.map((conversation) => (
                  <SessionRow
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === activeId}
                    shared={conversation.codeLinked === true}
                    onSelect={() => openConversation(conversation)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="border-t border-border px-2 py-2">
        <button
          type="button"
          onClick={handleOpenSettings}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[13px] text-foreground-muted',
            'transition-colors duration-150 hover:bg-surface-hover hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          )}
        >
          <Settings className="size-4" />
          <span>Configurações</span>
          <span className="ml-auto text-[11px] tabular-nums text-foreground-subtle">
            {appInfo?.version ? `v${appInfo.version}` : ''}
          </span>
        </button>
      </div>

      <AddChatSessionDialog
        open={addSessionOpen}
        onOpenChange={setAddSessionOpen}
        onAdded={() => {
          // The compact drawer must reveal the session it just opened.
          if (isCompact) onClose?.();
        }}
      />

      <RenameWorkspaceDialog
        workspace={renameTarget}
        value={renameValue}
        busy={renameBusy}
        onChange={setRenameValue}
        onCancel={() => !renameBusy && setRenameTarget(null)}
        onConfirm={() => void handleConfirmRename()}
      />
      <RemoveWorkspaceDialog
        workspace={removeTarget}
        busy={removeBusy}
        onCancel={() => !removeBusy && setRemoveTarget(null)}
        onConfirm={() => void handleConfirmRemove()}
      />
    </aside>
  );
}

export default CodeSidebar;
