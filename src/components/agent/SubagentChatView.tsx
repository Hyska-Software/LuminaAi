import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, Bot } from 'lucide-react';

import { MessageList } from '@/components/chat/MessageList';
import { Spinner } from '@/components/ui';
import { subagentTypeLabel } from '@/components/agents/agentUtils';
import { api } from '@/lib/api';
import { useChatStore, type CodeSubagentTab, type StreamingState } from '@/lib/store';
import type { ChatMessage, ConversationDetail, UsageInfo } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS_LABEL_KEY = {
  running: 'subagent.status.running',
  done: 'subagent.status.done',
  error: 'subagent.status.error',
  cancelled: 'subagent.status.cancelled',
} as const;

export interface SubagentChatViewProps {
  target: CodeSubagentTab;
  className?: string;
}

function liveMessages(target: CodeSubagentTab, live: NonNullable<ReturnType<typeof useLive>>): ChatMessage[] {
  const startedAt = live.startedAt;
  const user: ChatMessage = {
    id: `subagent-user-${target.taskCallId}`,
    conversationId: live.conversationId,
    role: 'user',
    content: live.prompt || target.prompt || target.description,
    status: 'complete',
    toolCalls: [],
    citations: [],
    attachments: [],
    trace: [],
    createdAt: startedAt,
  };
  const assistant: ChatMessage = {
    id: `subagent-assistant-${target.taskCallId}`,
    conversationId: live.conversationId,
    role: 'assistant',
    content: live.text,
    reasoning: live.reasoning || null,
    status:
      live.status === 'running'
        ? 'streaming'
        : live.status === 'done'
          ? 'complete'
          : live.status,
    toolCalls: live.toolCalls,
    citations: [],
    attachments: [],
    trace: live.trace,
    usage: live.usage,
    modelId: live.modelId,
    providerId: live.providerId,
    createdAt: startedAt + 1,
  };
  return [user, assistant];
}

function useLive(target: CodeSubagentTab) {
  return useChatStore((state) => state.streaming?.subagents?.[target.taskCallId] ?? null);
}

function statusOfDetail(detail: ConversationDetail | null): 'done' | 'error' | 'cancelled' {
  const assistant = [...(detail?.messages ?? [])]
    .reverse()
    .find((message) => message.role === 'assistant');
  if (assistant?.status === 'error') return 'error';
  if (assistant?.status === 'cancelled') return 'cancelled';
  return 'done';
}

function lastUsage(detail: ConversationDetail | null): UsageInfo | null {
  const assistant = [...(detail?.messages ?? [])]
    .reverse()
    .find((message) => message.role === 'assistant');
  return assistant?.usage ?? null;
}

/**
 * Full read-only conversation of a retained/live subagent, rendered as a real
 * Chat tab (same Markdown/Thinking/tool rows) without Composer or chat actions.
 */
export function SubagentChatView({ target, className }: SubagentChatViewProps) {
  const { t } = useTranslation('agents');
  const live = useLive(target);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setLoading(true);
  }, [target.conversationId]);

  useEffect(() => {
    if (live?.status === 'running') return;
    let cancelled = false;
    setLoading(true);
    void api
      .getConversation(target.conversationId)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target.conversationId, live?.status]);

  const messages = useMemo(() => {
    if (live?.status === 'running') return liveMessages(target, live);
    if (detail) return detail.messages;
    return live ? liveMessages(target, live) : [];
  }, [detail, live, target]);
  const running = live?.status === 'running';
  const streaming: StreamingState | null =
    running && live
      ? {
          turnId: `subagent-${target.taskCallId}`,
          conversationId: live.conversationId,
          assistantId: `subagent-assistant-${target.taskCallId}`,
          userMessageId: `subagent-user-${target.taskCallId}`,
          phase: live.toolCalls.some((tool) => tool.status === 'running')
            ? 'tool'
            : live.text
              ? 'text'
              : live.reasoning
                ? 'reasoning'
                : 'starting',
          step: Math.max(1, live.steps),
          startedAt: live.startedAt,
          turnKind: 'user',
        }
      : null;
  const status = live?.status ?? statusOfDetail(detail);
  const usage = live?.usage ?? lastUsage(detail);
  const totalTokens =
    usage?.totalTokens ??
    ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) || null);
  const duration = live?.durationMs ?? usage?.durationMs ?? null;
  const providerId = live?.providerId ?? target.providerId ?? detail?.conversation.providerId;
  const modelId = live?.modelId ?? target.modelId ?? detail?.conversation.modelId;
  const effort = live?.effort ?? target.effort;
  const rawType = live?.subagentType ?? target.subagentType;
  const isWorker = rawType === 'worker';
  const type = subagentTypeLabel(rawType);
  const description = live?.description ?? target.description ?? detail?.conversation.title ?? '';
  const unavailable = !live && !detail && !loading && !error;

  const scrollToBottom = () => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    atBottomRef.current = true;
    setShowJump(false);
  };

  useEffect(() => {
    if (atBottomRef.current) scrollToBottom();
  }, [messages, live?.text, live?.reasoning, live?.toolCalls.length]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 96;
    atBottomRef.current = nearBottom;
    setShowJump(!nearBottom);
  };

  return (
    <div className={cn('relative flex h-full min-h-0 flex-col', className)}>
      <header className="shrink-0 border-b border-border px-5 py-3">
        <div className="mx-auto flex w-full max-w-3xl min-w-0 items-center gap-2">
          <Bot aria-hidden className="size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[13px] font-semibold text-foreground">
                {t('subagent.header', { type })}
              </h2>
              <span
                className={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  status === 'running'
                    ? 'bg-accent-soft text-accent'
                    : status === 'error'
                      ? 'bg-danger-soft text-danger'
                      : status === 'cancelled'
                        ? 'bg-warning-soft text-warning'
                        : 'bg-success-soft text-success',
                )}
              >
                {t(STATUS_LABEL_KEY[status])}
              </span>
              <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-foreground-subtle">
                {t(isWorker ? 'subagent.autonomous' : 'subagent.readOnly')}
              </span>
            </div>
            <p className="truncate text-[11.5px] text-foreground-muted">{description}</p>
          </div>
          {status === 'running' ? <Spinner size="xs" /> : null}
          <span className="hidden shrink-0 text-[11px] text-foreground-subtle tabular-nums sm:inline">
            {modelId ? `${providerId}/${modelId}` : null}
            {effort ? t('subagent.effort', { effort }) : ''}
            {totalTokens != null ? ` · ${totalTokens} tokens` : ''}
            {duration != null ? ` · ${(duration / 1000).toFixed(1)} s` : ''}
          </span>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto w-full max-w-3xl px-6 pb-10 pt-6">
          {loading && !live ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-foreground-muted">
              <Spinner size="xs" /> {t('subagent.loadingTranscript')}
            </div>
          ) : error && !live ? (
            <p role="alert" className="rounded-lg border border-border bg-surface p-3 text-[12px] text-danger">
              {error}
            </p>
          ) : unavailable ? (
            <p className="py-12 text-center text-[12px] text-foreground-muted">
              {t('subagent.transcriptUnavailable')}
            </p>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-foreground-muted">
              <Spinner size="xs" /> {t('subagent.starting')}
            </div>
          ) : (
            <MessageList messages={messages} streaming={streaming} readOnly />
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-5 py-2.5 text-center text-[10.5px] text-foreground-subtle">
        {t('subagent.footer')}
      </div>

      {showJump ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center">
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label={t('subagent.jumpToEnd')}
            className="pointer-events-auto flex size-9 items-center justify-center rounded-full border border-border bg-surface-raised text-foreground-muted shadow-md transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <ArrowDown className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default SubagentChatView;
