import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
  localizedDepartment,
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

type Translate = TFunction<'agents'>;

function permissionLabel(mode: string, t: Translate): string {
  switch (mode) {
    case 'read_only':
      return t('permissions.readOnly');
    case 'review':
      return t('permissions.review');
    case 'edit':
      return t('permissions.edit');
    case 'autonomous':
      return t('permissions.autonomous');
    default:
      return mode;
  }
}

function environmentLabel(environment: string | undefined, t: Translate): string {
  switch (environment) {
    case 'this_computer':
      return t('panelData.environment.thisComputer');
    case 'private_desktop':
      return t('panelData.environment.privateDesktop');
    case 'browser':
      return t('panelData.environment.browser');
    case 'off':
      return t('panelData.environment.off');
    default:
      return t('panelData.environment.auto');
  }
}

const CAPABILITIES: Array<{ key: keyof AgentPanelContext['agent']['capabilities']; labelKey: string }> = [
  { key: 'webSearch', labelKey: 'panelData.capabilities.web' },
  { key: 'fileAccess', labelKey: 'panelData.capabilities.files' },
  { key: 'codeExecution', labelKey: 'panelData.capabilities.code' },
  { key: 'delegation', labelKey: 'panelData.capabilities.delegation' },
  { key: 'automation', labelKey: 'panelData.capabilities.automation' },
  { key: 'sharedMemory', labelKey: 'panelData.capabilities.sharedMemory' },
  { key: 'skillsWrite', labelKey: 'panelData.capabilities.skillsWrite' },
  { key: 'createAgents', labelKey: 'panelData.capabilities.createAgents' },
  { key: 'computerUse', labelKey: 'panelData.capabilities.computer' },
  { key: 'screenCapture', labelKey: 'panelData.capabilities.screenCapture' },
  { key: 'browserUse', labelKey: 'panelData.capabilities.browser' },
  { key: 'dockerExecution', labelKey: 'panelData.capabilities.docker' },
];

/** Agent + conversation dashboard: identity, usage, memory, tasks and audit. */
export function AgentPanelData({ context }: { context: AgentPanelContext }) {
  const { t } = useTranslation('agents');
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
        <section className="rounded-xl bg-surface-hover p-3">
          <div className="flex items-start gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Bot className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">
                {agent.name} · {agent.role || t('agentFallback')}
              </p>
              <p className="truncate text-[11px] text-foreground-muted">
                {modelLabel(providers, agent.providerId, agent.modelId)}
                {agent.department ? ` · ${localizedDepartment(agent.department)}` : ''}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={onEdit} aria-label={t('panelData.editAgentAria')}>
              <Pencil className="size-3.5" />
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="neutral">{permissionLabel(agent.permissionMode, t)}</Badge>
            <Badge tone={agent.workspaceId ? 'accent' : 'neutral'}>
              {agent.workspaceId ? t('panelData.folder.selected') : t('panelData.folder.internal')}
            </Badge>
            <Badge tone="neutral">
              {environmentLabel(agent.computerEnvironment, t)}
            </Badge>
            <Badge tone={agent.archivedAt ? 'danger' : 'success'}>
              {agent.archivedAt ? t('panelData.archived') : t('panelData.active')}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {CAPABILITIES.map((capability) => {
              const enabled = Boolean(agent.capabilities[capability.key]);
              return (
                <span
                  key={capability.key}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-foreground-muted"
                  title={`${t(capability.labelKey as never)}: ${
                    enabled ? t('panelData.capabilityOn') : t('panelData.capabilityOff')
                  }`}
                >
                  {enabled ? (
                    <CheckCircle2 className="size-2.5 text-success" />
                  ) : (
                    <Circle className="size-2.5 text-foreground-subtle" />
                  )}
                  {t(capability.labelKey as never)}
                </span>
              );
            })}
          </div>
        </section>

        <section aria-label={t('panelData.usageAria')} className="rounded-xl bg-surface-hover p-3">
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-accent" />
            <p className="text-[12px] font-medium text-foreground">{t('panelData.usage')}</p>
            {loading ? <Loader2 className="size-3.5 animate-spin text-foreground-muted" /> : null}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <dt className="text-foreground-subtle">{t('panelData.fields.turns')}</dt>
              <dd className="font-medium text-foreground">{usage?.turns ?? 0}</dd>
            </div>
            <div>
              <dt className="text-foreground-subtle">{t('panelData.fields.tokens')}</dt>
              <dd className="font-medium text-foreground">
                {formatUsageTokens(usage?.totalTokens ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-foreground-subtle">{t('panelData.fields.cost')}</dt>
              <dd className="font-medium text-foreground">
                {formatUsageCost(usage?.cost ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-foreground-subtle">{t('panelData.fields.lastActivity')}</dt>
              <dd className="font-medium text-foreground">
                {usage?.lastUsedAt ? relativeTime(usage.lastUsedAt) : '—'}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-label={t('panelData.conversationAria')} className="rounded-xl bg-surface-hover p-3">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-accent" />
            <p className="text-[12px] font-medium text-foreground">{t('panelData.conversation')}</p>
          </div>
          {conversation ? (
            <div className="mt-2 space-y-1.5 text-[11px] text-foreground-muted">
              <p className="truncate font-medium text-foreground">{conversation.title}</p>
              <p>
                {t('panelData.conversationMeta', {
                  count: conversation.messageCount,
                  model: modelLabel(providers, conversation.providerId, conversation.modelId),
                })}
              </p>
              <p>
                {activeStream
                  ? t('panelData.activeTurn', {
                      phase: activeStream.phase,
                      step: activeStream.step,
                    })
                  : t('panelData.noActiveTurn')}
              </p>
              <p>
                {t('panelData.queue', { count: queueItems.length })}
                {queueIsPaused ? ` ${t('panelData.queuePaused')}` : ''}
              </p>
              {activeStream ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void stopConversation(conversation.id)}
                >
                  <Square className="mr-1.5 size-3.5" />
                  {t('panelData.stopTurn')}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-foreground-muted">
              {t('panelData.noThread')}
            </p>
          )}
        </section>

        <section aria-label={t('panelData.tasksAria')} className="rounded-xl bg-surface-hover p-3">
          <div className="flex items-center gap-2">
            <ListChecks className="size-4 text-accent" />
            <p className="text-[12px] font-medium text-foreground">{t('panelData.tasks')}</p>
            <span className="ml-auto text-[11px] text-foreground-muted">
              {t('panelData.openTasks', { open: openTasks, total: tasks.length })}
            </span>
          </div>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setBoardOpen(true)}>
            <ListChecks className="mr-1.5 size-3.5" />
            {t('panelData.openBoard')}
          </Button>
        </section>

        <section aria-label={t('panelData.auditAria')} className="rounded-xl bg-surface-hover p-3">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-accent" />
            <p className="text-[12px] font-medium text-foreground">{t('panelData.audit')}</p>
          </div>
          {actions.length === 0 ? (
            <p className="mt-2 text-[11px] text-foreground-muted">
              {t('panelData.noComputerActions')}
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

        <section aria-label={t('panelData.memoryAria')} className="rounded-xl bg-surface-hover p-3">
          <div className="flex items-center gap-2">
            <Wrench className="size-4 text-accent" />
            <p className="text-[12px] font-medium text-foreground">{t('panelData.memory')}</p>
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
          <p className="rounded-xl bg-danger-soft px-3 py-2 text-[11px] text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => openAgentEditor({ mode: 'edit', agentId: agent.id })}>
            <Pencil className="mr-1.5 size-3.5" />
            {t('panelData.editAgent')}
          </Button>
          {conversation ? (
            <Button size="sm" variant="ghost" onClick={() => openThread(conversation.id)}>
              <Activity className="mr-1.5 size-3.5" />
              {t('panelData.openConversation')}
            </Button>
          ) : null}
        </div>
      </div>
      <AgentTaskBoardDialog
        open={boardOpen}
        onOpenChange={setBoardOpen}
        ownerAgentId={context.agent.id}
        title={t('tasks.boardTitle', { name: context.agent.name })}
      />
    </div>
  );
}
