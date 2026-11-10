import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  Circle,
  Database,
  Gauge,
  ListChecks,
  Loader2,
  Pencil,
  ShieldCheck,
  Square,
  Wrench,
} from 'lucide-react';

import type { AgentPanelContext } from './AgentPanel';
import { AgentMemoryPanel } from './AgentMemoryPanel';
import { AgentTaskBoardDialog } from './AgentTaskBoardDialog';
import {
  formatUsageCost,
  formatUsageTokens,
  modelLabel,
  relativeTime,
} from './agentUtils';
import { Badge, Button } from '@/components/ui';
import { api } from '@/lib/api';
import {
  useMessageQueueStore,
  useAppStore,
  useChatStore,
  useUiStore,
} from '@/lib/store';
import type { AgentTask, AgentUsage, ComputerActionRecord } from '@/lib/types';

const PERMISSION_LABELS: Record<string, string> = {
  read_only: 'Leitura',
  review: 'Revisar',
  edit: 'Editar',
  autonomous: 'Autônomo',
};

const CAPABILITIES: Array<{ key: keyof AgentPanelContext['agent']['capabilities']; label: string }> = [
  { key: 'webSearch', label: 'Web' },
  { key: 'fileAccess', label: 'Arquivos' },
  { key: 'codeExecution', label: 'Código' },
  { key: 'delegation', label: 'Delegação' },
  { key: 'automation', label: 'Automações' },
  { key: 'sharedMemory', label: 'Memória equipe' },
  { key: 'skillsWrite', label: 'Skills (escrita)' },
  { key: 'createAgents', label: 'Criar agentes' },
  { key: 'computerUse', label: 'Computador' },
  { key: 'screenCapture', label: 'Tela (leitura)' },
  { key: 'browserUse', label: 'Navegador' },
  { key: 'dockerExecution', label: 'Docker' },
];

/** Agent + conversation dashboard: identity, usage, memory, tasks and audit. */
export function AgentPanelData({ context }: { context: AgentPanelContext }) {
  const { agent, conversation, openThread, onEdit } = context;
  const providers = useAppStore((state) => state.providers);
  const openAgentEditor = useUiStore((state) => state.openAgentEditor);
  const stopConversation = useChatStore((state) => state.stopConversation);
  const activeId = useChatStore((state) => state.activeId);
  const queue = useMessageQueueStore((state) => state.byConversation);
  const queuePaused = useMessageQueueStore((state) => state.pausedByConversation);
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [actions, setActions] = useState<ComputerActionRecord[]>([]);
  const [boardOpen, setBoardOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextUsage, nextTasks] = await Promise.all([
        api.getAgentUsage(agent.id),
        api.listAgentTasks({ ownerAgentId: agent.id }),
      ]);
      setUsage(nextUsage);
      setTasks(nextTasks);
      if (conversation) {
        setActions(await api.listComputerActions(conversation.id, 8));
      } else {
        setActions([]);
      }
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  }, [agent.id, conversation]);

  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener('zylara:agent-task-updated', reload);
    return () => window.removeEventListener('zylara:agent-task-updated', reload);
  }, [load]);

  const openTasks = tasks.filter((task) =>
    ['queued', 'accepted', 'running', 'waiting_input', 'waiting_approval', 'review', 'handoff_pending'].includes(
      task.status,
    ),
  ).length;
  const queueItems = activeId ? queue[activeId] ?? [] : [];
  const queueIsPaused = activeId ? queuePaused[activeId] === true : false;
  const activeStream = useChatStore((state) =>
    activeId ? state.streamsByConversation[activeId] ?? null : null,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-4 p-3">
        <section className="rounded-xl border border-border bg-surface-raised/40 p-3">
          <div className="flex items-start gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Bot className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">
                {agent.name} · {agent.role || 'Agente'}
              </p>
              <p className="truncate text-[11px] text-foreground-muted">
                {modelLabel(providers, agent.providerId, agent.modelId)}
                {agent.department ? ` · ${agent.department}` : ''}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={onEdit} aria-label="Editar agente">
              <Pencil className="size-3.5" />
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="neutral">{PERMISSION_LABELS[agent.permissionMode] ?? agent.permissionMode}</Badge>
            <Badge tone={agent.workspaceId ? 'accent' : 'neutral'}>
              {agent.workspaceId ? 'Pasta selecionada' : 'Pasta interna'}
            </Badge>
            <Badge tone="neutral">
              {agent.computerEnvironment === 'this_computer'
                ? 'Este computador'
                : agent.computerEnvironment === 'private_desktop'
                  ? 'Desktop privado'
                  : agent.computerEnvironment === 'browser'
                    ? 'Navegador'
                    : agent.computerEnvironment === 'off'
                      ? 'Computador desligado'
                      : 'Ambiente automático'}
            </Badge>
            <Badge tone={agent.archivedAt ? 'danger' : 'success'}>
              {agent.archivedAt ? 'Arquivado' : 'Ativo'}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {CAPABILITIES.map((capability) => {
              const enabled = Boolean(agent.capabilities[capability.key]);
              return (
                <span
                  key={capability.key}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-foreground-muted"
                  title={`${capability.label}: ${enabled ? 'ligado' : 'desligado'}`}
                >
                  {enabled ? (
                    <CheckCircle2 className="size-2.5 text-success" />
                  ) : (
                    <Circle className="size-2.5 text-foreground-subtle" />
                  )}
                  {capability.label}
                </span>
              );
            })}
          </div>
        </section>

        <section aria-label="Uso do agente" className="rounded-xl border border-border bg-surface-raised/40 p-3">
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-accent" />
            <p className="text-[12px] font-medium text-foreground">Uso</p>
            {loading ? <Loader2 className="size-3.5 animate-spin text-foreground-muted" /> : null}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <dt className="text-foreground-subtle">Turnos</dt>
              <dd className="font-medium text-foreground">{usage?.turns ?? 0}</dd>
            </div>
            <div>
              <dt className="text-foreground-subtle">Tokens</dt>
              <dd className="font-medium text-foreground">
                {formatUsageTokens(usage?.totalTokens ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-foreground-subtle">Custo</dt>
              <dd className="font-medium text-foreground">
                {formatUsageCost(usage?.cost ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-foreground-subtle">Última atividade</dt>
              <dd className="font-medium text-foreground">
                {usage?.lastUsedAt ? relativeTime(usage.lastUsedAt) : '—'}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-label="Conversa atual" className="rounded-xl border border-border bg-surface-raised/40 p-3">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-accent" />
            <p className="text-[12px] font-medium text-foreground">Conversa</p>
          </div>
          {conversation ? (
            <div className="mt-2 space-y-1.5 text-[11px] text-foreground-muted">
              <p className="truncate font-medium text-foreground">{conversation.title}</p>
              <p>
                {conversation.messageCount} mensagem(ns) · {modelLabel(providers, conversation.providerId, conversation.modelId)}
              </p>
              <p>
                {activeStream
                  ? `Turno ativo · ${activeStream.phase} · passo ${activeStream.step}`
                  : 'Nenhum turno ativo'}
              </p>
              <p>
                Fila: {queueItems.length} mensagem(ns){queueIsPaused ? ' · pausada' : ''}
              </p>
              {activeStream ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void stopConversation(conversation.id)}
                >
                  <Square className="mr-1.5 size-3.5" />
                  Parar turno
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-foreground-muted">
              Nenhuma thread aberta. Abra uma conversa para ver fila, turno ativo e auditoria.
            </p>
          )}
        </section>

        <section aria-label="Tarefas do agente" className="rounded-xl border border-border bg-surface-raised/40 p-3">
          <div className="flex items-center gap-2">
            <ListChecks className="size-4 text-accent" />
            <p className="text-[12px] font-medium text-foreground">Tarefas</p>
            <span className="ml-auto text-[11px] text-foreground-muted">
              {openTasks} aberta(s) de {tasks.length}
            </span>
          </div>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setBoardOpen(true)}>
            <ListChecks className="mr-1.5 size-3.5" />
            Abrir quadro
          </Button>
        </section>

        <section aria-label="Auditoria de computer use" className="rounded-xl border border-border bg-surface-raised/40 p-3">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-accent" />
            <p className="text-[12px] font-medium text-foreground">Auditoria</p>
          </div>
          {actions.length === 0 ? (
            <p className="mt-2 text-[11px] text-foreground-muted">
              Nenhuma ação de computador nesta conversa.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {actions.map((action) => (
                <li key={action.id} className="flex items-start gap-1.5 text-[10px]">
                  {action.result === 'ok' ? (
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" />
                  ) : (
                    <ShieldCheck className="mt-0.5 size-3 shrink-0 text-warning" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{action.tool}</span>
                    <span className="block truncate text-foreground-subtle">
                      {action.decision ?? action.result} · {relativeTime(action.createdAt)}
                      {action.errorCode ? ` · ${action.errorCode}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Memória do agente" className="rounded-xl border border-border bg-surface-raised/40 p-3">
          <div className="flex items-center gap-2">
            <Wrench className="size-4 text-accent" />
            <p className="text-[12px] font-medium text-foreground">Memória</p>
          </div>
          <div className="mt-2">
            <AgentMemoryPanel
              agentId={agent.id}
              memoryEnabled={agent.memoryEnabled}
              className="max-h-64"
            />
          </div>
        </section>

        {error ? (
          <p className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => openAgentEditor({ mode: 'edit', agentId: agent.id })}>
            <Pencil className="mr-1.5 size-3.5" />
            Editar agente
          </Button>
          {conversation ? (
            <Button size="sm" variant="ghost" onClick={() => openThread(conversation.id)}>
              <Activity className="mr-1.5 size-3.5" />
              Abrir conversa
            </Button>
          ) : null}
        </div>
      </div>
      <AgentTaskBoardDialog
        open={boardOpen}
        onOpenChange={setBoardOpen}
        ownerAgentId={context.agent.id}
        title={`Tarefas de ${context.agent.name}`}
      />
    </div>
  );
}
