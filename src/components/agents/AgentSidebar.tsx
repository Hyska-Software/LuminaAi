import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Activity,
  Archive,
  ArchiveRestore,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  Ellipsis,
  Globe2,
  Hash,
  ListChecks,
  ListTree,
  Loader2,
  MessageCircleQuestion,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  Pencil,
  Pin,
  PinOff,
  PanelRight,
  Plus,
  Power,
  Search,
  Settings,
  ShieldAlert,
  Square,
  Trash2,
  Upload,
  Users,
  WandSparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { AgentAvatar } from './AgentAvatar';
import { AgentActivityDialog } from './AgentActivityDialog';
import { AgentChannelDialog } from './AgentChannelDialog';
import { AgentDialogBody } from './AgentDialogBody';
import { AgentRevisionDialog } from './AgentRevisionDialog';
import { AgentRoutinesDialog } from './AgentRoutinesDialog';
import { AgentTaskBoardDialog } from './AgentTaskBoardDialog';
import { AgentTasksDialog } from './AgentTasksDialog';
import { relativeTime } from './agentUtils';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
} from '@/components/ui';
import {
  selectActiveAgents,
  selectArchivedAgents,
  selectPinnedAgents,
  useAgentQueueStore,
  useAgentStore,
  useChatStore,
  useCodeStore,
  useUiStore,
} from '@/lib/store';
import type { Agent, AgentChannel, Conversation } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface AgentSidebarProps {
  className?: string;
  onClose?: () => void;
}

function ThreadRow({
  conversation,
  active,
  onSelect,
  onTogglePin,
  onStartRename,
  onExport,
  onDelete,
  onStop,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onStartRename: () => void;
  onExport: () => void;
  onDelete: () => void;
  onStop: () => void;
}) {
  const queued = useAgentQueueStore(
    (state) => state.byConversation[conversation.id]?.length ?? 0,
  );
  const busy = useChatStore((state) =>
    Boolean(
      state.streamsByConversation[conversation.id] ??
        (state.streaming?.conversationId === conversation.id ? state.streaming : null),
    ),
  );
  const session = useCodeStore((state) => state.byConversation[conversation.id]);
  const awaitingApproval = (session?.approvals.length ?? 0) > 0;
  const awaitingAnswer = (session?.questions.length ?? 0) > 0;
  const failed = Boolean(session?.error);
  return (
    <div className="group/thread relative flex items-center">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        title={conversation.title}
        className={cn(
          'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg pl-7 pr-8 text-left text-[12px]',
          'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          active
            ? 'bg-surface-active text-foreground'
            : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
        )}
      >
        {conversation.pinned ? (
          <Pin aria-hidden className="size-3 shrink-0 text-foreground-subtle" />
        ) : (
          <MessageSquare aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
        )}
        <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
        {queued > 0 ? (
          <span
            title={`${queued} mensagem(ns) na fila`}
            className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] font-medium text-accent"
          >
            {queued}
          </span>
        ) : null}
        {busy ? (
          <Loader2 aria-label="Respondendo" className="size-3 shrink-0 animate-spin text-accent" />
        ) : awaitingApproval ? (
          <ShieldAlert
            aria-label="Aguardando aprovação"
            className="size-3.5 shrink-0 text-warning"
          />
        ) : awaitingAnswer ? (
          <MessageCircleQuestion
            aria-label="Aguardando resposta"
            className="size-3.5 shrink-0 text-accent"
          />
        ) : failed ? (
          <CircleAlert aria-label="Último turno falhou" className="size-3.5 shrink-0 text-danger" />
        ) : (
          <span className="shrink-0 text-[10px] text-foreground-subtle">
            {relativeTime(conversation.updatedAt)}
          </span>
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Opções de ${conversation.title}`}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              'absolute right-0.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md',
              'text-foreground-subtle transition-colors duration-150 hover:bg-surface-active hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              'opacity-100 lg:opacity-0 lg:group-hover/thread:opacity-100 lg:focus-visible:opacity-100 lg:data-[state=open]:opacity-100',
            )}
          >
            <Ellipsis aria-hidden className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {busy ? (
            <>
              <DropdownMenuItem
                variant="danger"
                icon={<Square className="size-3.5" />}
                onSelect={onStop}
              >
                Parar execução
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem
            icon={
              conversation.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />
            }
            onSelect={onTogglePin}
          >
            {conversation.pinned ? 'Desafixar' : 'Fixar'}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Pencil className="size-3.5" />} onSelect={onStartRename}>
            Renomear
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Download className="size-3.5" />} onSelect={onExport}>
            Exportar
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            onSelect={onDelete}
          >
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AgentRow({
  agent,
  active,
  expanded,
  threads,
  activeThreadId,
  onSelect,
  onToggle,
  onNewThread,
  onEdit,
  onRevise,
  onDuplicate,
  onExport,
  onPin,
  onArchive,
  onDelete,
  onOpenThread,
  onToggleThreadPin,
  onStartThreadRename,
  onExportThread,
  onDeleteThread,
  onStopThread,
  onShowAllThreads,
  onRoutines,
  onTasks,
}: {
  agent: Agent;
  active: boolean;
  expanded: boolean;
  threads: Conversation[];
  activeThreadId: string | null;
  onSelect: () => void;
  onToggle: () => void;
  onNewThread: () => void;
  onEdit: () => void;
  onRevise: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onOpenThread: (id: string) => void;
  onToggleThreadPin: (thread: Conversation) => void;
  onStartThreadRename: (thread: Conversation) => void;
  onExportThread: (thread: Conversation) => void;
  onDeleteThread: (thread: Conversation) => void;
  onStopThread: (thread: Conversation) => void;
  onShowAllThreads: () => void;
  onRoutines: () => void;
  onTasks: () => void;
}) {
  const shown = threads.slice(0, 5);
  const streamsByConversation = useChatStore((state) => state.streamsByConversation);
  const visibleStream = useChatStore((state) => state.streaming);
  const busy = threads.some((thread) =>
    Boolean(
      streamsByConversation[thread.id] ??
        (visibleStream?.conversationId === thread.id ? visibleStream : null),
    ),
  );
  return (
    <div>
      <div className="group relative flex items-center">
        <button
          type="button"
          aria-label={expanded ? 'Recolher conversas' : 'Expandir conversas'}
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={onSelect}
          aria-current={active ? 'true' : undefined}
          className={cn(
            'flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-left',
            'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            active ? 'bg-surface-active' : 'hover:bg-surface-hover',
          )}
        >
          <AgentAvatar emoji={agent.emoji} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-foreground">{agent.name}</span>
              {busy ? (
                <Loader2 aria-label="Respondendo" className="size-3 shrink-0 animate-spin text-accent" />
              ) : null}
              {agent.pinned ? <Pin className="size-2.5 shrink-0 text-foreground-subtle" /> : null}
              {agent.computerEnvironment !== 'auto' ||
              agent.capabilities.computerUse ||
              agent.capabilities.screenCapture ||
              agent.capabilities.browserUse ? (
                agent.computerEnvironment === 'off' ? (
                  <Power
                    aria-label="Computador desligado"
                    className="size-3 shrink-0 text-foreground-subtle"
                  />
                ) : agent.computerEnvironment === 'browser' ? (
                  <Globe2
                    aria-label="Somente navegador"
                    className="size-3 shrink-0 text-foreground-subtle"
                  />
                ) : (
                  <Monitor
                    aria-label="Acesso ao computador"
                    className="size-3 shrink-0 text-foreground-subtle"
                  />
                )
              ) : null}
            </span>
            <span className="block truncate text-[11px] text-foreground-muted">{agent.role}</span>
          </span>
          {threads.length > 0 ? (
            <span className="shrink-0 rounded-full bg-surface-raised px-1.5 py-0.5 text-[10px] text-foreground-subtle">
              {threads.length}
            </span>
          ) : null}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Opções de ${agent.name}`}
              onClick={(event) => event.stopPropagation()}
              className={cn(
                'absolute right-0.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md',
                'text-foreground-subtle hover:bg-surface-active hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                'opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 lg:data-[state=open]:opacity-100',
              )}
            >
              <Ellipsis className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem icon={<MessageSquarePlus className="size-3.5" />} onSelect={onNewThread}>
              Nova conversa
            </DropdownMenuItem>
            <DropdownMenuItem icon={<ListTree className="size-3.5" />} onSelect={onShowAllThreads}>
              Ver todas as conversas
            </DropdownMenuItem>
            <DropdownMenuItem icon={<CalendarClock className="size-3.5" />} onSelect={onRoutines}>
              Rotinas
            </DropdownMenuItem>
            <DropdownMenuItem icon={<ListChecks className="size-3.5" />} onSelect={onTasks}>
              Tarefas
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Pencil className="size-3.5" />} onSelect={onEdit}>
              Editar agente
            </DropdownMenuItem>
            <DropdownMenuItem icon={<WandSparkles className="size-3.5" />} onSelect={onRevise}>
              Editar com IA
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Copy className="size-3.5" />} onSelect={onDuplicate}>
              Duplicar
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Download className="size-3.5" />} onSelect={onExport}>
              Exportar
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={agent.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              onSelect={onPin}
            >
              {agent.pinned ? 'Desafixar' : 'Fixar'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Archive className="size-3.5" />} onSelect={onArchive}>
              Arquivar
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="danger"
              icon={<Trash2 className="size-3.5" />}
              onSelect={onDelete}
            >
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded ? (
        <div className="mb-1 space-y-0.5">
          {shown.map((thread) => (
            <ThreadRow
              key={thread.id}
              conversation={thread}
              active={activeThreadId === thread.id}
              onSelect={() => onOpenThread(thread.id)}
              onTogglePin={() => onToggleThreadPin(thread)}
              onStartRename={() => onStartThreadRename(thread)}
              onExport={() => onExportThread(thread)}
              onDelete={() => onDeleteThread(thread)}
              onStop={() => onStopThread(thread)}
            />
          ))}
          {threads.length > shown.length ? (
            <button
              type="button"
              onClick={onShowAllThreads}
              className="flex h-7 w-full items-center gap-2 rounded-lg pl-7 pr-2 text-left text-[11px] text-foreground-muted hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <ListTree aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
              Ver todas ({threads.length})
            </button>
          ) : null}
          {threads.length === 0 ? (
            <p className="py-1 pl-7 text-[11px] text-foreground-subtle">Nenhuma conversa ainda.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ChannelRow({
  channel,
  active,
  onSelect,
  onEdit,
}: {
  channel: AgentChannel;
  active: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="group/channel relative flex items-center">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        title={channel.name}
        className={cn(
          'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 pr-8 text-left text-[12px]',
          'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          active
            ? 'bg-surface-active text-foreground'
            : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
        )}
      >
        <Hash aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
        <span className="shrink-0 text-[10px] text-foreground-subtle">
          {channel.memberIds.length}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Editar canal ${channel.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
        className={cn(
          'absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md',
          'text-foreground-subtle hover:bg-surface-active hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          'opacity-100 lg:opacity-0 lg:group-hover/channel:opacity-100 lg:focus-visible:opacity-100',
        )}
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}

export function AgentSidebar({ className, onClose }: AgentSidebarProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [manageOpen, setManageOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [allThreadsAgent, setAllThreadsAgent] = useState<Agent | null>(null);
  const [routinesAgent, setRoutinesAgent] = useState<Agent | null>(null);
  const [revisionAgent, setRevisionAgent] = useState<Agent | null>(null);
  const [tasksAgent, setTasksAgent] = useState<Agent | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [taskBoardOpen, setTaskBoardOpen] = useState(false);
  const activeTurnCount = useChatStore(
    (state) => Object.keys(state.streamsByConversation).length,
  );
  const agentPanelOpen = useUiStore((state) => state.agentPanelOpen);
  const agentRightPanel = useUiStore((state) => state.agentRightPanel);
  const setAgentPanelOpen = useUiStore((state) => state.setAgentPanelOpen);
  const setAgentRightPanel = useUiStore((state) => state.setAgentRightPanel);
  const [channels, setChannels] = useState<AgentChannel[]>([]);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<AgentChannel | null>(null);
  const [renameThreadTarget, setRenameThreadTarget] = useState<Conversation | null>(null);
  const [renameThreadValue, setRenameThreadValue] = useState('');
  const [renameThreadBusy, setRenameThreadBusy] = useState(false);
  const [deleteThreadTarget, setDeleteThreadTarget] = useState<Conversation | null>(null);
  const [deleteThreadBusy, setDeleteThreadBusy] = useState(false);
  const agents = useAgentStore(useShallow(selectActiveAgents));
  const status = useAgentStore((state) => state.status);
  const storeError = useAgentStore((state) => state.error);
  const refresh = useAgentStore((state) => state.refresh);
  const pinned = useAgentStore(useShallow(selectPinnedAgents));
  const archived = useAgentStore(useShallow(selectArchivedAgents));
  const pin = useAgentStore((state) => state.pin);
  const archive = useAgentStore((state) => state.archive);
  const restore = useAgentStore((state) => state.restore);
  const remove = useAgentStore((state) => state.remove);
  const conversations = useChatStore((state) => state.conversations);
  const activeId = useChatStore((state) => state.activeId);
  const activeAgentId = useUiStore((state) => state.activeAgentId);
  const activeChannelId = useUiStore((state) => state.activeChannelId);
  const setActiveAgentId = useUiStore((state) => state.setActiveAgentId);
  const setActiveChannelId = useUiStore((state) => state.setActiveChannelId);
  const openEditor = useUiStore((state) => state.openAgentEditor);
  const openSettings = useUiStore((state) => state.openSettings);
  const startNewConversation = useChatStore((state) => state.startNewConversation);
  const clearActiveConversation = useChatStore((state) => state.clearActiveConversation);
  const openConversation = useChatStore((state) => state.openConversation);

  useEffect(() => {
    if (activeAgentId) {
      setExpanded((current) => {
        if (current.has(activeAgentId)) return current;
        const next = new Set(current);
        next.add(activeAgentId);
        return next;
      });
    }
  }, [activeAgentId]);

  useEffect(() => {
    let disposed = false;
    const load = () => {
      void api
        .listAgentChannels()
        .then((list) => {
          if (!disposed) setChannels(list);
        })
        .catch(() => {
          if (!disposed) setChannels([]);
        });
    };
    load();
    window.addEventListener('lumina:channels-changed', load);
    return () => {
      disposed = true;
      window.removeEventListener('lumina:channels-changed', load);
    };
  }, []);

  const threadsFor = (agentId: string) =>
    conversations
      .filter(
        (conversation) =>
          conversation.mode === 'agent' &&
          conversation.agentId === agentId &&
          !conversation.channelId,
      )
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt);

  const groups = useMemo(() => {
    const byDepartment = new Map<string, Agent[]>();
    for (const agent of agents) {
      const list = byDepartment.get(agent.department) ?? [];
      list.push(agent);
      byDepartment.set(agent.department, list);
    }
    return [...byDepartment.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'pt-BR', { sensitivity: 'base' }))
      .map(([department, groupAgents]) => ({ department, agents: groupAgents }));
  }, [agents]);

  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
  const matches = (agent: Agent) => {
    if (!normalizedQuery) return true;
    const haystack = `${agent.name} ${agent.role} ${agent.description} ${agent.department}`.toLocaleLowerCase(
      'pt-BR',
    );
    return (
      haystack.includes(normalizedQuery) ||
      threadsFor(agent.id).some((thread) =>
        thread.title.toLocaleLowerCase('pt-BR').includes(normalizedQuery),
      )
    );
  };

  const visiblePinned = useMemo(
    () => pinned.filter(matches),
    [pinned, normalizedQuery, conversations],
  );
  const visibleChannels = useMemo(
    () =>
      normalizedQuery
        ? channels.filter((channel) =>
            channel.name.toLocaleLowerCase('pt-BR').includes(normalizedQuery),
          )
        : channels,
    [channels, normalizedQuery],
  );
  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          agents: group.agents.filter((agent) => !agent.pinned && matches(agent)),
        }))
        .filter((group) => group.agents.length > 0),
    [groups, normalizedQuery, conversations],
  );

  const selectAgent = (agent: Agent) => {
    setActiveAgentId(agent.id);
    clearActiveConversation();
    setExpanded((current) => new Set(current).add(agent.id));
    onClose?.();
  };

  const selectChannel = (channel: AgentChannel) => {
    setActiveChannelId(channel.id);
    clearActiveConversation();
    onClose?.();
  };

  const newThread = (agent: Agent) => {
    setActiveAgentId(agent.id);
    void startNewConversation('agent', { agentId: agent.id });
    onClose?.();
  };

  const openThread = (agent: Agent, threadId: string) => {
    setActiveAgentId(agent.id);
    void openConversation(threadId);
    onClose?.();
  };

  const toggleThreadPinned = (thread: Conversation) => {
    void useChatStore.getState().togglePinned(thread.id);
  };

  const stopThread = (thread: Conversation) => {
    void useChatStore.getState().stopConversation(thread.id);
  };

  const startThreadRename = (thread: Conversation) => {
    setRenameThreadTarget(thread);
    setRenameThreadValue(thread.title);
  };

  const confirmThreadRename = async () => {
    const target = renameThreadTarget;
    const title = renameThreadValue.trim();
    if (!target || !title) return;
    setRenameThreadBusy(true);
    try {
      await useChatStore.getState().renameConversation(target.id, title);
      setRenameThreadTarget(null);
    } catch (error) {
      toast.error('Não foi possível renomear a conversa', { description: String(error) });
    } finally {
      setRenameThreadBusy(false);
    }
  };

  const exportThread = async (thread: Conversation) => {
    try {
      const path = await api.exportConversation(thread.id, 'markdown');
      if (path) toast.success('Conversa exportada', { description: path });
    } catch (error) {
      toast.error('Não foi possível exportar', { description: String(error) });
    }
  };

  const confirmThreadDelete = async () => {
    const target = deleteThreadTarget;
    if (!target) return;
    setDeleteThreadBusy(true);
    try {
      await useChatStore.getState().deleteConversation(target.id);
      setDeleteThreadTarget(null);
    } finally {
      setDeleteThreadBusy(false);
    }
  };

  const duplicateAgent = async (agent: Agent) => {
    try {
      const copy = await api.duplicateAgent(agent.id);
      await refresh();
      setActiveAgentId(copy.id);
      clearActiveConversation();
      toast.success('Agente duplicado', { description: copy.name });
    } catch (error) {
      toast.error('Não foi possível duplicar o agente', { description: String(error) });
    }
  };

  const exportAgent = async (agent: Agent) => {
    try {
      const path = await api.exportAgent(agent.id);
      if (path) toast.success('Agente exportado', { description: path });
    } catch (error) {
      toast.error('Não foi possível exportar o agente', { description: String(error) });
    }
  };

  const importAgent = async () => {
    try {
      const imported = await api.importAgent();
      if (!imported) return;
      await refresh();
      setActiveAgentId(imported.id);
      clearActiveConversation();
      setManageOpen(false);
      toast.success('Agente importado', { description: imported.name });
    } catch (error) {
      toast.error('Não foi possível importar o agente', { description: String(error) });
    }
  };

  const togglePinned = async (agent: Agent) => {
    try {
      await pin(agent.id, !agent.pinned);
    } catch (error) {
      toast.error('Não foi possível alterar o pin', { description: String(error) });
    }
  };

  const archiveAgent = async (agent: Agent) => {
    try {
      await archive(agent.id);
      if (activeAgentId === agent.id) clearActiveConversation();
      toast.success('Agente arquivado', {
        description: agent.name,
        action: {
          label: 'Desfazer',
          onClick: () => void restore(agent.id),
        },
      });
    } catch (error) {
      toast.error('Não foi possível arquivar o agente', { description: String(error) });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove(deleteTarget.id);
      if (activeAgentId === deleteTarget.id) {
        setActiveAgentId(null);
        clearActiveConversation();
      }
      toast.success('Agente excluído', { description: deleteTarget.name });
      setDeleteTarget(null);
    } catch (error) {
      toast.error('Não foi possível excluir o agente', { description: String(error) });
    }
  };

  const deleteThreads = deleteTarget ? threadsFor(deleteTarget.id).length : 0;

  return (
    <aside className={cn('flex h-full min-h-0 flex-col bg-surface', className)}>
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Agentes
        </span>
        <div className="flex items-center gap-1">
          {activeTurnCount > 0 ? (
            <button
              type="button"
              onClick={() => setActivityOpen(true)}
              aria-label={`Atividade: ${activeTurnCount} turno(s) em andamento`}
              className="flex h-6 items-center gap-1 rounded-full bg-accent-soft px-2 text-[10px] font-medium text-accent hover:bg-accent-soft/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Activity className="size-3" />
              {activeTurnCount}
            </button>
          ) : null}
          <IconButton
            label={
              agentPanelOpen && agentRightPanel === 'agent'
                ? 'Recolher painel do agente'
                : 'Abrir painel do agente'
            }
            size="sm"
            variant="ghost"
            active={agentPanelOpen && agentRightPanel === 'agent'}
            onClick={() => {
              setAgentRightPanel('agent');
              setAgentPanelOpen(!(agentPanelOpen && agentRightPanel === 'agent'));
            }}
          >
            <PanelRight className="size-4" />
          </IconButton>
          <IconButton
            label="Quadro de tarefas"
            size="sm"
            variant="ghost"
            onClick={() => setTaskBoardOpen(true)}
          >
            <ListChecks className="size-4" />
          </IconButton>
          <IconButton
            label="Novo agente"
            size="sm"
            variant="ghost"
            onClick={() => openEditor({ mode: 'create' })}
          >
            <Plus className="size-4" />
          </IconButton>
        </div>
      </div>

      <div className="px-3">
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-start"
          disabled={!activeAgentId}
          title={activeAgentId ? 'Nova conversa com o agente selecionado' : 'Selecione um agente'}
          onClick={() => {
            if (activeAgentId) {
              void startNewConversation('agent', { agentId: activeAgentId });
              onClose?.();
            }
          }}
        >
          <MessageSquarePlus className="mr-2 size-4" />
          Nova conversa
        </Button>
      </div>

      <div className="relative mt-3 px-3">
        <Search className="pointer-events-none absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-subtle" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar agentes ou conversas"
          aria-label="Buscar agentes ou conversas"
          className="h-8 pl-8 pr-8 text-[12px]"
        />
        {query ? (
          <button
            type="button"
            aria-label="Limpar busca"
            onClick={() => setQuery('')}
            className="absolute right-4 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-foreground-subtle hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {status === 'loading' && agents.length === 0 ? (
          <div className="space-y-2 px-2 py-3" aria-label="Carregando agentes">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="size-7 animate-pulse rounded-lg bg-surface-active" />
                <div className="h-3 flex-1 animate-pulse rounded bg-surface-active" />
              </div>
            ))}
          </div>
        ) : null}
        {status === 'error' ? (
          <div className="px-2 py-3 text-[12px] text-foreground-muted">
            <p>Não foi possível carregar seus agentes.</p>
            {storeError ? (
              <p className="mt-1 line-clamp-2 text-[11px] text-foreground-subtle">{storeError}</p>
            ) : null}
            <Button size="sm" variant="ghost" className="mt-2 px-0" onClick={() => void refresh()}>
              Tentar novamente
            </Button>
          </div>
        ) : null}
        <section className="mb-3">
          <div className="mb-1 flex items-center justify-between px-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
              Canais
            </p>
            <button
              type="button"
              aria-label="Novo canal"
              onClick={() => {
                setEditingChannel(null);
                setChannelDialogOpen(true);
              }}
              className="flex size-5 items-center justify-center rounded text-foreground-subtle hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          {visibleChannels.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-foreground-subtle">
              {normalizedQuery ? 'Nenhum canal encontrado.' : 'Nenhum canal ainda.'}
            </p>
          ) : (
            <div className="space-y-0.5">
              {visibleChannels.map((channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  active={activeChannelId === channel.id}
                  onSelect={() => selectChannel(channel)}
                  onEdit={() => {
                    setEditingChannel(channel);
                    setChannelDialogOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {status === 'ready' && agents.length === 0 ? (
          <div className="px-2 py-5 text-center">
            <p className="text-[12px] text-foreground-muted">Nenhum agente ainda.</p>
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => openEditor({ mode: 'create' })}
            >
              <Plus className="mr-1 size-3.5" />
              Criar agente
            </Button>
          </div>
        ) : null}
        {visiblePinned.length > 0 ? (
          <section className="mb-3">
            <p className="mb-1 flex items-center gap-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
              <Pin className="size-3" />
              Fixados
            </p>
            {visiblePinned.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                active={activeAgentId === agent.id}
                expanded={expanded.has(agent.id) || Boolean(normalizedQuery)}
                threads={threadsFor(agent.id)}
                activeThreadId={activeId}
                onSelect={() => selectAgent(agent)}
                onToggle={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(agent.id)) next.delete(agent.id);
                    else next.add(agent.id);
                    return next;
                  })
                }
                onNewThread={() => newThread(agent)}
                onEdit={() => openEditor({ mode: 'edit', agentId: agent.id })}
                onRevise={() => setRevisionAgent(agent)}
                onDuplicate={() => void duplicateAgent(agent)}
                onExport={() => void exportAgent(agent)}
                onPin={() => void togglePinned(agent)}
                onArchive={() => void archiveAgent(agent)}
                onDelete={() => setDeleteTarget(agent)}
                onOpenThread={(threadId) => openThread(agent, threadId)}
                onToggleThreadPin={toggleThreadPinned}
                onStartThreadRename={startThreadRename}
                onExportThread={(thread) => void exportThread(thread)}
                onDeleteThread={setDeleteThreadTarget}
                onStopThread={stopThread}
                onShowAllThreads={() => setAllThreadsAgent(agent)}
                onRoutines={() => setRoutinesAgent(agent)}
                onTasks={() => setTasksAgent(agent)}
              />
            ))}
          </section>
        ) : null}

        {visibleGroups.map((group) => (
          <section key={group.department} className="mb-3">
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
              {group.department}
            </p>
            {group.agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                active={activeAgentId === agent.id}
                expanded={expanded.has(agent.id) || Boolean(normalizedQuery)}
                threads={threadsFor(agent.id)}
                activeThreadId={activeId}
                onSelect={() => selectAgent(agent)}
                onToggle={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(agent.id)) next.delete(agent.id);
                    else next.add(agent.id);
                    return next;
                  })
                }
                onNewThread={() => newThread(agent)}
                onEdit={() => openEditor({ mode: 'edit', agentId: agent.id })}
                onRevise={() => setRevisionAgent(agent)}
                onDuplicate={() => void duplicateAgent(agent)}
                onExport={() => void exportAgent(agent)}
                onPin={() => void togglePinned(agent)}
                onArchive={() => void archiveAgent(agent)}
                onDelete={() => setDeleteTarget(agent)}
                onOpenThread={(threadId) => openThread(agent, threadId)}
                onToggleThreadPin={toggleThreadPinned}
                onStartThreadRename={startThreadRename}
                onExportThread={(thread) => void exportThread(thread)}
                onDeleteThread={setDeleteThreadTarget}
                onStopThread={stopThread}
                onShowAllThreads={() => setAllThreadsAgent(agent)}
                onRoutines={() => setRoutinesAgent(agent)}
                onTasks={() => setTasksAgent(agent)}
              />
            ))}
          </section>
        ))}

        {normalizedQuery &&
        visiblePinned.length === 0 &&
        visibleGroups.length === 0 &&
        visibleChannels.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-foreground-subtle">
            Nenhum agente ou conversa encontrado para “{query.trim()}”.
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={() => {
            setActiveAgentId(null);
            setActiveChannelId(null);
            clearActiveConversation();
            onClose?.();
          }}
          aria-current={activeAgentId === null && activeChannelId === null ? 'page' : undefined}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            activeAgentId === null && activeChannelId === null
              ? 'bg-surface-active text-foreground'
              : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
          )}
        >
          <Users className="size-3.5" />
          Equipe
        </button>
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px] text-foreground-muted hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Users className="size-3.5" />
          Gerenciar agentes
        </button>
        <button
          type="button"
          onClick={() => openSettings()}
          className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px] text-foreground-muted hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Settings className="size-3.5" />
          Configurações
        </button>
      </div>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader className="pb-4 pr-12">
            <DialogTitle>Gerenciar agentes</DialogTitle>
            <DialogDescription>
              {agents.length} ativo(s) · {archived.length} arquivado(s). Arquivar preserva o
              histórico e as conversas.
            </DialogDescription>
          </DialogHeader>
          <AgentDialogBody className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
                Ativos
              </h3>
              {agents.length === 0 ? (
                <p className="py-3 text-center text-[12px] text-foreground-muted">
                  Nenhum agente ativo.
                </p>
              ) : (
                agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface/50 p-3"
                  >
                    <AgentAvatar emoji={agent.emoji} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{agent.name}</p>
                      <p className="truncate text-[11px] text-foreground-muted">
                        {agent.role} · {agent.threadCount} conversa(s)
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setActiveAgentId(agent.id)}>
                      Abrir
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEditor({ mode: 'edit', agentId: agent.id })}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void archive(agent.id)
                          .then(() =>
                            toast.success('Agente arquivado', { description: agent.name }),
                          )
                          .catch((error) =>
                            toast.error('Não foi possível arquivar o agente', {
                              description: String(error),
                            }),
                          )
                      }
                    >
                      <Archive className="mr-1.5 size-3.5" />
                      Arquivar
                    </Button>
                  </div>
                ))
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
                Arquivados
              </h3>
              {archived.length === 0 ? (
                <p className="py-3 text-center text-[12px] text-foreground-muted">
                  Nenhum agente arquivado.
                </p>
              ) : (
                archived.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface/50 p-3"
                  >
                    <AgentAvatar emoji={agent.emoji} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{agent.name}</p>
                      <p className="truncate text-[11px] text-foreground-muted">
                        {agent.role} · {agent.threadCount} conversa(s)
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void restore(agent.id)
                          .then(() =>
                            toast.success('Agente restaurado', { description: agent.name }),
                          )
                          .catch((error) =>
                            toast.error('Não foi possível restaurar o agente', {
                              description: String(error),
                            }),
                          )
                      }
                    >
                      <ArchiveRestore className="mr-1.5 size-3.5" />
                      Restaurar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteTarget(agent)}
                    >
                      <Trash2 className="mr-1.5 size-3.5" />
                      Excluir
                    </Button>
                  </div>
                ))
              )}
            </section>
          </AgentDialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => void importAgent()}>
              <Upload className="mr-1.5 size-4" />
              Importar
            </Button>
            <Button variant="secondary" onClick={() => openEditor({ mode: 'create' })}>
              <Plus className="mr-1.5 size-4" />
              Novo agente
            </Button>
            <Button variant="ghost" onClick={() => setManageOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader className="pb-4 pr-12">
            <DialogTitle>Excluir agente?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `“${deleteTarget.name}” será removido permanentemente.`
                : 'Esta ação não pode ser desfeita.'}
            </DialogDescription>
          </DialogHeader>
          {deleteThreads > 0 ? (
            <AgentDialogBody>
              <p className="rounded-lg border border-border bg-surface/50 px-3 py-2 text-[12px] text-foreground-muted">
                Este agente tem {deleteThreads} conversa(s). Arquive-o para manter o histórico; a
                exclusão definitiva só é permitida sem conversas.
              </p>
            </AgentDialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" disabled={deleteThreads > 0} onClick={() => void confirmDelete()}>
              <Trash2 className="mr-1.5 size-3.5" />
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={allThreadsAgent !== null}
        onOpenChange={(open) => !open && setAllThreadsAgent(null)}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader className="pb-4 pr-12">
            <DialogTitle>Conversas de {allThreadsAgent?.name ?? 'agente'}</DialogTitle>
            <DialogDescription>
              {allThreadsAgent ? `${threadsFor(allThreadsAgent.id).length} conversa(s)` : ''}
            </DialogDescription>
          </DialogHeader>
          <AgentDialogBody className="space-y-0.5">
            {allThreadsAgent && threadsFor(allThreadsAgent.id).length === 0 ? (
              <p className="py-6 text-center text-[12px] text-foreground-muted">
                Nenhuma conversa ainda.
              </p>
            ) : null}
            {allThreadsAgent
              ? threadsFor(allThreadsAgent.id).map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    conversation={thread}
                    active={activeId === thread.id}
                    onSelect={() => {
                      openThread(allThreadsAgent, thread.id);
                      setAllThreadsAgent(null);
                    }}
                    onTogglePin={() => toggleThreadPinned(thread)}
                    onStartRename={() => startThreadRename(thread)}
                    onExport={() => void exportThread(thread)}
                    onDelete={() => setDeleteThreadTarget(thread)}
                    onStop={() => stopThread(thread)}
                  />
                ))
              : null}
          </AgentDialogBody>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                if (allThreadsAgent) newThread(allThreadsAgent);
                setAllThreadsAgent(null);
              }}
            >
              <MessageSquarePlus className="mr-1.5 size-4" />
              Nova conversa
            </Button>
            <Button variant="ghost" onClick={() => setAllThreadsAgent(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AgentRoutinesDialog
        agent={routinesAgent}
        open={routinesAgent !== null}
        onOpenChange={(open) => !open && setRoutinesAgent(null)}
      />

      <AgentRevisionDialog
        agent={revisionAgent}
        open={revisionAgent !== null}
        onOpenChange={(open) => !open && setRevisionAgent(null)}
      />

      <AgentTasksDialog
        agent={tasksAgent}
        open={tasksAgent !== null}
        onOpenChange={(open) => !open && setTasksAgent(null)}
      />

      <AgentActivityDialog open={activityOpen} onOpenChange={setActivityOpen} />
      <AgentTaskBoardDialog open={taskBoardOpen} onOpenChange={setTaskBoardOpen} />

      <AgentChannelDialog
        channel={editingChannel}
        open={channelDialogOpen}
        onOpenChange={(open) => {
          setChannelDialogOpen(open);
          if (!open) setEditingChannel(null);
        }}
        onSaved={(saved) => {
          setChannels((current) => {
            const exists = current.some((channel) => channel.id === saved.id);
            return exists
              ? current.map((channel) => (channel.id === saved.id ? saved : channel))
              : [...current, saved];
          });
          setActiveChannelId(saved.id);
          clearActiveConversation();
          window.dispatchEvent(new CustomEvent('lumina:channels-changed'));
        }}
        onDeleted={(deletedId) => {
          setChannels((current) => current.filter((channel) => channel.id !== deletedId));
          if (activeChannelId === deletedId) setActiveChannelId(null);
          window.dispatchEvent(new CustomEvent('lumina:channels-changed'));
        }}
      />

      <Dialog
        open={renameThreadTarget !== null}
        onOpenChange={(open) => !open && setRenameThreadTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader className="pb-4 pr-12">
            <DialogTitle>Renomear conversa</DialogTitle>
            <DialogDescription>O novo título aparece na barra lateral e na paleta.</DialogDescription>
          </DialogHeader>
          <AgentDialogBody>
            <Input
              value={renameThreadValue}
              maxLength={120}
              aria-label="Título da conversa"
              onChange={(event) => setRenameThreadValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void confirmThreadRename();
              }}
            />
          </AgentDialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameThreadTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={renameThreadBusy || !renameThreadValue.trim()}
              onClick={() => void confirmThreadRename()}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteThreadTarget !== null}
        onOpenChange={(open) => !open && setDeleteThreadTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader className="pb-4 pr-12">
            <DialogTitle>Excluir conversa?</DialogTitle>
            <DialogDescription>
              {deleteThreadTarget
                ? `“${deleteThreadTarget.title}” será removida permanentemente.`
                : 'Esta ação não pode ser desfeita.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteThreadTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={deleteThreadBusy}
              onClick={() => void confirmThreadDelete()}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
