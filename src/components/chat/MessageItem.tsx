import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Pencil, RefreshCw, ThumbsDown, ThumbsUp, TriangleAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { ArtifactCard } from '@/components/artifacts/ArtifactCard';
import { AttachmentChips } from '@/components/composer/AttachmentChips';
import { useReduceMotion } from '@/components/layout/hooks';
import { Badge, Button, IconButton, Spinner } from '@/components/ui';
import { findModel, getModel } from '@/lib/catalog';
import { useAppStore, useChatStore, useUiStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/types';
import { cn, copyText, formatDuration, formatTokens } from '@/lib/utils';
import { CitationChips } from './CitationChips';
import { LuminaOrb } from './LuminaOrb';
import { Markdown } from './Markdown';
import { AgentSteps } from './AgentSteps';

/** Errors that indicate a missing/invalid provider key get a settings CTA. */
const KEY_ERROR_PATTERN = /(chave de api|api[ _-]?key|401|unauthorized|não configurad)/i;

/** Entrance animation shared by every message (DESIGN §11: fade-in-up 260ms). */
const MESSAGE_MOTION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
};

/** Blinking caret appended to the last rendered block while text streams. */
const STREAMING_CARET =
  "[&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:h-[1.05em] [&>*:last-child]:after:w-[0.5em] [&>*:last-child]:after:rounded-[1px] [&>*:last-child]:after:bg-accent [&>*:last-child]:after:align-[-0.15em] [&>*:last-child]:after:content-['']";

function useCopyFeedback() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async (text: string) => {
    const ok = await copyText(text);
    if (!ok) {
      toast.error('Não foi possível copiar');
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return { copied, copy };
}

function modelLabel(message: ChatMessage): string | null {
  if (!message.modelId) return null;
  const exact = message.providerId ? getModel(message.providerId, message.modelId) : undefined;
  const model = exact ?? findModel(message.modelId)?.model;
  return model?.name ?? message.modelId;
}

interface MessageItemProps {
  message: ChatMessage;
  isStreaming: boolean;
  isGroupStart: boolean;
}

const UserMessageItem = memo(function UserMessageItem({ message, isStreaming, isGroupStart }: MessageItemProps) {
  const { copied, copy } = useCopyFeedback();
  const reduceMotion = useReduceMotion();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const attachments = message.attachments ?? [];

  const startEditing = () => {
    setDraft(message.content);
    setEditing(true);
  };

  const saveEdit = () => {
    const content = draft.trim();
    if (!content) return;
    setEditing(false);
    void useChatStore.getState().editAndResend(message.id, content);
  };

  return (
    <motion.div
      initial={reduceMotion ? false : MESSAGE_MOTION.initial}
      animate={MESSAGE_MOTION.animate}
      transition={reduceMotion ? { duration: 0 } : MESSAGE_MOTION.transition}
      className={cn('group/message flex flex-col items-end', isGroupStart ? 'mt-7' : 'mt-3')}
    >
      <div className="flex max-w-[80%] flex-col items-end gap-1.5">
        {attachments.length > 0 ? <AttachmentChips attachments={attachments} align="end" /> : null}

        {editing ? (
          <div className="w-72 max-w-[70vw] rounded-2xl border border-border bg-surface-raised p-2 shadow-sm">
            <textarea
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditing(false);
                } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  saveEdit();
                }
              }}
              rows={2}
              aria-label="Editar mensagem"
              className="max-h-60 w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-foreground outline-none"
            />
            <div className="flex justify-end gap-1.5 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
              <Button variant="primary" size="sm" onClick={saveEdit} disabled={!draft.trim()}>
                Salvar e reenviar
              </Button>
            </div>
          </div>
        ) : message.content ? (
          <div className="whitespace-pre-wrap break-words rounded-3xl bg-user-bubble px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
            {message.content}
          </div>
        ) : null}
      </div>

      {!editing ? (
        <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/message:opacity-100">
          <IconButton
            label={copied ? 'Mensagem copiada' : 'Copiar mensagem'}
            size="sm"
            variant="ghost"
            className="size-8"
            onClick={() => void copy(message.content)}
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          </IconButton>
          <IconButton
            label="Editar mensagem"
            size="sm"
            variant="ghost"
            className="size-8"
            disabled={isStreaming}
            onClick={startEditing}
          >
            <Pencil className="size-3.5" />
          </IconButton>
        </div>
      ) : null}
    </motion.div>
  );
});

const AssistantMessageItem = memo(function AssistantMessageItem({ message, isStreaming, isGroupStart }: MessageItemProps) {
  const { copied, copy } = useCopyFeedback();
  const reduceMotion = useReduceMotion();
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const phase = useChatStore((state) => (state.streaming?.assistantId === message.id ? state.streaming.phase : null));
  const startedAt = useChatStore((state) =>
    state.streaming?.assistantId === message.id ? state.streaming.startedAt : null,
  );
  const anyStreaming = useChatStore((state) => state.streaming !== null);
  const showTokenUsage = useAppStore((state) => state.settings.showTokenUsage);
  const artifacts = useUiStore((state) => state.artifacts);

  const attachments = message.attachments ?? [];
  const citations = message.citations ?? [];
  const toolCalls = message.toolCalls ?? [];
  const reasoning = message.reasoning?.trim() ?? '';
  const reasoningActive = isStreaming && phase === 'reasoning';
  const awaitingText = isStreaming && !message.content && !reasoning && toolCalls.length === 0;
  const showCaret = isStreaming && phase === 'text' && message.content.length > 0;
  const messageArtifacts = useMemo(
    () => artifacts.filter((artifact) => artifact.messageId === message.id),
    [artifacts, message.id],
  );

  const usage = message.usage;
  const totalTokens =
    usage?.totalTokens ??
    ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) || null);
  const model = modelLabel(message);
  const isKeyError = message.status === 'error' && KEY_ERROR_PATTERN.test(message.content ?? '');

  const regenerate = () => {
    window.dispatchEvent(new CustomEvent('lumina:scroll-bottom'));
    void useChatStore.getState().regenerate();
  };

  return (
    <motion.div
      initial={reduceMotion ? false : MESSAGE_MOTION.initial}
      animate={MESSAGE_MOTION.animate}
      transition={reduceMotion ? { duration: 0 } : MESSAGE_MOTION.transition}
      className={cn('group/message flex items-start gap-3', isGroupStart ? 'mt-7' : 'mt-3')}
    >
      <LuminaOrb size={24} className="mt-0.5" animated={isStreaming} />

      <div className="min-w-0 flex-1">
        {reasoning || reasoningActive || toolCalls.length > 0 ? (
          <AgentSteps
            message={message}
            streaming={isStreaming}
            phase={phase}
            startedAt={startedAt}
          />
        ) : null}

        {message.status !== 'error' && message.content ? (
          <div
            className={cn(
              showCaret && STREAMING_CARET,
              showCaret && !reduceMotion && '[&>*:last-child]:after:animate-blink',
            )}
          >
            <Markdown content={message.content} />
          </div>
        ) : null}

        {awaitingText ? (
          <div className="flex items-center gap-2 py-1 text-[13px] text-foreground-subtle">
            <Spinner size="xs" />
            <span>Gerando resposta…</span>
          </div>
        ) : null}

        {message.status === 'error' ? (
          <div role="alert" className="mt-2 rounded-xl border border-border bg-danger-soft p-3">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground">Não foi possível concluir</p>
                {message.content ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] text-foreground-muted">
                    {message.content}
                  </p>
                ) : (
                  <p className="mt-1 text-[12.5px] text-foreground-muted">Tente novamente em instantes.</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Button variant="secondary" size="sm" onClick={regenerate} disabled={anyStreaming}>
                    Tentar novamente
                  </Button>
                  {isKeyError ? (
                    <Button variant="ghost" size="sm" onClick={() => useUiStore.getState().setSettingsOpen(true)}>
                      Abrir configurações
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {attachments.length > 0 ? <AttachmentChips attachments={attachments} className="mt-3" /> : null}
        {citations.length > 0 ? <CitationChips citations={citations} className="mt-3" /> : null}

        {messageArtifacts.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {messageArtifacts.map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} />
            ))}
          </div>
        ) : null}

        {message.status === 'cancelled' ? (
          <div className="mt-2">
            <Badge tone="neutral">Cancelado</Badge>
          </div>
        ) : null}

        {!isStreaming &&
        message.status !== 'error' &&
        (message.content || messageArtifacts.length > 0) ? (
          <div className="mt-2 flex flex-wrap items-center gap-0.5 text-foreground-subtle opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/message:opacity-100">
            <IconButton
              label={copied ? 'Resposta copiada' : 'Copiar resposta'}
              size="sm"
              variant="ghost"
              className="size-8"
              disabled={!message.content}
              onClick={() => void copy(message.content)}
            >
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </IconButton>
            <IconButton
              label="Regenerar resposta"
              size="sm"
              variant="ghost"
              className="size-8"
              disabled={anyStreaming}
              onClick={regenerate}
            >
              <RefreshCw className="size-3.5" />
            </IconButton>
            <IconButton
              label="Resposta útil"
              size="sm"
              variant="ghost"
              className="size-8"
              active={feedback === 'up'}
              aria-pressed={feedback === 'up'}
              onClick={() => setFeedback((current) => (current === 'up' ? null : 'up'))}
            >
              <ThumbsUp className="size-3.5" />
            </IconButton>
            <IconButton
              label="Resposta não útil"
              size="sm"
              variant="ghost"
              className="size-8"
              active={feedback === 'down'}
              aria-pressed={feedback === 'down'}
              onClick={() => setFeedback((current) => (current === 'down' ? null : 'down'))}
            >
              <ThumbsDown className="size-3.5" />
            </IconButton>

            {model || (showTokenUsage && totalTokens) ? (
              <span aria-hidden className="mx-1 h-3 w-px bg-border" />
            ) : null}
            {model ? <span className="px-1 text-[11px] text-foreground-subtle">{model}</span> : null}
            {showTokenUsage && totalTokens ? (
              <span className="text-[11px] tabular-nums text-foreground-subtle">
                {formatTokens(totalTokens)} tokens
                {usage?.durationMs ? ` · ${formatDuration(usage.durationMs)}` : ''}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
});

/** Renders a single chat message: user bubble or assistant markdown turn. */
export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
  if (props.message.role === 'user') return <UserMessageItem {...props} />;
  if (props.message.role === 'system') {
    return (
      <div className="mt-4 text-center text-[12px] italic text-foreground-subtle">{props.message.content}</div>
    );
  }
  return <AssistantMessageItem {...props} />;
});
