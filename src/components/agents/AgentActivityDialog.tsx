import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, ListChecks, MessageSquare, Square, Timer } from 'lucide-react';

import { AgentAvatar } from './AgentAvatar';
import { AgentDialogBody } from './AgentDialogBody';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAgentStore, useChatStore, useCodeStore, useUiStore } from '@/lib/store';
import type { ActiveTurnInfo, AgentTask, Conversation } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TASK_ATTENTION_STATUSES, taskStatusMeta } from './agentTaskStatus';

function elapsedLabel(startedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/** Global view of active turns, pending approvals/questions and tasks needing a human. */
export function AgentActivityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('agents');
  const streams = useChatStore((state) => state.streamsByConversation);
  const conversations = useChatStore((state) => state.conversations);
  const openConversation = useChatStore((state) => state.openConversation);
  const stopConversation = useChatStore((state) => state.stopConversation);
  const stopAll = useChatStore((state) => state.stopAllTurns);
  const agents = useAgentStore((state) => state.agentsById);
  const codeSessions = useCodeStore((state) => state.byConversation);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [activeTurns, setActiveTurns] = useState<ActiveTurnInfo[]>([]);
  const [, setClock] = useState(0);

  const loadTasks = useCallback(async () => {
    try {
      const list = await api.listAgentTasks();
      setTasks(list.filter((task) => TASK_ATTENTION_STATUSES.includes(task.status)));
      setTasksError(null);
    } catch (error) {
      setTasksError(String(error));
    }
  }, []);

  const loadActiveTurns = useCallback(async () => {
    try {
      setActiveTurns(await api.listActiveTurns());
    } catch {
      setActiveTurns([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadTasks();
    void loadActiveTurns();
    const reload = () => void loadTasks();
    window.addEventListener('zylara:agent-task-updated', reload);
    const poll = window.setInterval(() => void loadActiveTurns(), 2000);
    const clock = window.setInterval(() => setClock((value) => value + 1), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
      window.removeEventListener('zylara:agent-task-updated', reload);
    };
  }, [open, loadTasks, loadActiveTurns]);

  const entries = Object.values(streams);
  const backgroundTurns = activeTurns.filter(
    (turn) => !streams[turn.conversationId],
  );
  const approvals = Object.values(codeSessions).flatMap((session) =>
    session.approvals.map((approval) => ({ conversationId: session.conversationId, approval })),
  );
  const questions = Object.values(codeSessions).flatMap((session) =>
    session.questions.map((question) => ({ conversationId: session.conversationId, question })),
  );

  const focusConversation = (conversationId: string) => {
    const conversation = conversations.find((entry) => entry.id === conversationId);
    if (conversation?.mode === 'agent') {
      useUiStore.getState().setLayoutMode('agent');
      if (conversation.agentId) {
        useUiStore.getState().setActiveAgentId(conversation.agentId);
      }
    } else if (conversation?.mode === 'code') {
      useUiStore.getState().setLayoutMode('code');
    } else if (conversation?.mode === 'chat') {
      useUiStore.getState().setLayoutMode('chat');
    }
    void openConversation(conversationId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="pb-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Activity className="size-4 text-accent" />
            {t('activityDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('activityDialog.description')}
          </DialogDescription>
        </DialogHeader>
        <AgentDialogBody className="space-y-5">
          {entries.length + backgroundTurns.length > 0 ? (
            <section aria-labelledby="activity-running" className="space-y-2">
              <h3
                id="activity-running"
                className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle"
              >
                {t('activityDialog.running')}
              </h3>
              {entries.map((stream) => {
                const conversation = conversations.find(
                  (entry) => entry.id === stream.conversationId,
                );
                const agent = conversation?.agentId ? agents[conversation.agentId] : undefined;
                return (
                  <article
                    key={stream.turnId}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface/50 p-3"
                  >
                    {agent ? <AgentAvatar avatar={agent.avatar} size="sm" /> : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-foreground">
                        {agent?.name ?? t('activityDialog.session')} · {conversation?.title ?? stream.conversationId}
                      </p>
                      <p className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
                        <Timer className="size-3" />
                        {t('activityDialog.streamMeta', {
                          elapsed: elapsedLabel(stream.startedAt),
                          phase: stream.phase,
                          step: stream.step,
                        })}
                        {stream.turnKind === 'goal_round' ? ` ${t('activityDialog.goalRound')}` : ''}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={cn('shrink-0')}
                      onClick={() => void stopConversation(stream.conversationId)}
                    >
                      <Square className="mr-1.5 size-3.5" />
                      {t('common:actions.stop')}
                    </Button>
                  </article>
                );
              })}
              {backgroundTurns.map((turn) => {
                const conversation = conversations.find(
                  (entry) => entry.id === turn.conversationId,
                );
                const agent = conversation?.agentId ? agents[conversation.agentId] : undefined;
                return (
                  <article
                    key={turn.turnId}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface/50 p-3"
                  >
                    {agent ? <AgentAvatar avatar={agent.avatar} size="sm" /> : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-foreground">
                        {agent?.name ?? t('agentFallback')} · {conversation?.title ?? turn.conversationId}
                      </p>
                      <p className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
                        <Timer className="size-3" />
                        {t('activityDialog.backgroundMeta', {
                          elapsed: elapsedLabel(turn.startedAt),
                        })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={cn('shrink-0')}
                      onClick={() => void stopConversation(turn.conversationId)}
                    >
                      <Square className="mr-1.5 size-3.5" />
                      {t('common:actions.stop')}
                    </Button>
                  </article>
                );
              })}
            </section>
          ) : null}

          {approvals.length + questions.length > 0 ? (
            <section aria-labelledby="activity-attention" className="space-y-2">
              <h3
                id="activity-attention"
                className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle"
              >
                {t('activityDialog.needsYou')}
              </h3>
              {approvals.map(({ conversationId, approval }) => (
                <button
                  key={approval.id}
                  type="button"
                  onClick={() => focusConversation(conversationId)}
                  className="flex w-full items-center gap-3 rounded-xl border border-warning/30 bg-warning-soft/40 p-3 text-left hover:bg-warning-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <AlertTriangle className="size-4 shrink-0 text-warning" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {t('activityDialog.approvalTitle', { title: approval.title })}
                    </span>
                    <span className="block truncate text-[11px] text-foreground-muted">
                      {conversationLabel(conversations, conversationId)}
                    </span>
                  </span>
                  <Badge tone="warning">{t('activityDialog.review')}</Badge>
                </button>
              ))}
              {questions.map(({ conversationId, question }) => (
                <button
                  key={question.id}
                  type="button"
                  onClick={() => focusConversation(conversationId)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface/50 p-3 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <MessageSquare className="size-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {t('askUser.aria')}
                    </span>
                    <span className="block truncate text-[11px] text-foreground-muted">
                      {question.questions[0]?.question ?? t('askUser.aria')}
                    </span>
                  </span>
                  <Badge tone="accent">{t('activityDialog.answer')}</Badge>
                </button>
              ))}
            </section>
          ) : null}

          {tasksError ? (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {t('activityDialog.tasksError', { error: tasksError })}
            </p>
          ) : null}
          {tasks.length > 0 ? (
            <section aria-labelledby="activity-tasks" className="space-y-2">
              <h3
                id="activity-tasks"
                className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle"
              >
                {t('activityDialog.tasksWaiting')}
              </h3>
              {tasks.map((task) => {
                const meta = taskStatusMeta(task.status);
                return (
                <button
                  key={task.id}
                  type="button"
                  disabled={!task.conversationId}
                  onClick={() => {
                    if (task.conversationId) focusConversation(task.conversationId);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface/50 p-3 text-left hover:bg-surface-hover disabled:cursor-default disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <ListChecks className="size-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {task.title}
                    </span>
                    <span className="block truncate text-[11px] text-foreground-muted">
                      {agents[task.ownerAgentId]?.name ?? t('agentFallback')} ·{' '}
                      {t(meta.labelKey as never)}
                    </span>
                  </span>
                  <Badge tone={meta.badge}>{t('activityDialog.open')}</Badge>
                </button>
                );
              })}
            </section>
          ) : null}

          {entries.length + backgroundTurns.length + approvals.length + questions.length + tasks.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-foreground-muted">
              {t('activityDialog.empty')}
            </p>
          ) : null}
        </AgentDialogBody>
        <DialogFooter>
          <Button
            variant="danger"
            disabled={entries.length + backgroundTurns.length === 0}
            onClick={() => void stopAll()}
          >
            <Square className="mr-1.5 size-4" />
            {t('activityDialog.stopAll')}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function conversationLabel(
  conversations: Conversation[],
  conversationId: string,
): string {
  return conversations.find((entry) => entry.id === conversationId)?.title ?? conversationId;
}
