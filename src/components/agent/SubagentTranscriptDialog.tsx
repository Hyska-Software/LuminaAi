import { useEffect, useState } from 'react';
import { Bot, User } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@/components/ui';
import { Markdown } from '@/components/chat/Markdown';
import { api } from '@/lib/api';
import type { ConversationDetail } from '@/lib/types';

export interface SubagentTranscriptDialogProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Read-only audit view of a retained subagent transcript. The child session is
 * hidden from the sidebar but remains queryable by id (parent deletion cascades).
 */
export function SubagentTranscriptDialog({
  conversationId,
  open,
  onOpenChange,
}: SubagentTranscriptDialogProps) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    void api
      .getConversation(conversationId)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, open]);

  const conversation = detail?.conversation;
  const usage = conversation
    ? detail?.messages.find((message) => message.role === 'assistant')?.usage
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-h-[86vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot aria-hidden className="size-4 text-foreground-subtle" />
            {conversation?.title ?? 'Transcrição do subagente'}
          </DialogTitle>
          <DialogDescription>
            {conversation
              ? `${conversation.subagentType ?? 'subagente'} · ${conversation.providerId}/${conversation.modelId}`
              : 'Transcrição somente leitura retida para auditoria.'}
            {usage?.totalTokens != null ? ` · ${usage.totalTokens} tokens` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-foreground-muted">
              <Spinner size="xs" /> Carregando transcrição…
            </div>
          ) : error ? (
            <p role="alert" className="rounded-lg border border-border bg-surface p-3 text-[12px] text-danger">
              {error}
            </p>
          ) : !detail || detail.messages.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-foreground-muted">
              Nenhuma mensagem registrada neste subagente.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {detail.messages.map((message) => {
                const isUser = message.role === 'user';
                return (
                  <li key={message.id} className="rounded-lg border border-border bg-surface p-3">
                    <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
                      {isUser ? <User aria-hidden className="size-3" /> : <Bot aria-hidden className="size-3" />}
                      {isUser ? 'Pai' : 'Subagente'}
                      {message.status === 'error' ? (
                        <span className="text-danger">erro</span>
                      ) : null}
                      {message.status === 'cancelled' ? (
                        <span className="text-warning">cancelado</span>
                      ) : null}
                    </div>
                    {message.reasoning?.trim() ? (
                      <details className="mb-2">
                        <summary className="cursor-pointer text-[11px] text-foreground-muted">
                          Raciocínio
                        </summary>
                        <div className="mt-1 border-l border-border pl-2">
                          <Markdown content={message.reasoning} variant="thinking" />
                        </div>
                      </details>
                    ) : null}
                    {message.content.trim() ? (
                      <Markdown content={message.content} />
                    ) : null}
                    {message.toolCalls.length > 0 ? (
                      <ol className="mt-2 flex flex-col gap-1.5">
                        {message.toolCalls.map((tool) => (
                          <li key={tool.id} className="rounded-md border border-border bg-background px-2 py-1.5">
                            <div className="flex items-center gap-2 text-[11.5px]">
                              <code className="font-mono text-foreground">{tool.name}</code>
                              <span
                                className={
                                  tool.status === 'error'
                                    ? 'text-danger'
                                    : tool.status === 'running'
                                      ? 'text-foreground-muted'
                                      : 'text-success'
                                }
                              >
                                {tool.status}
                              </span>
                              {tool.summary ? (
                                <span className="min-w-0 truncate text-foreground-muted">{tool.summary}</span>
                              ) : null}
                            </div>
                            {tool.result?.trim() ? (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-[11px] text-foreground-muted">
                                  Resultado
                                </summary>
                                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground-muted">
                                  {tool.result}
                                </pre>
                              </details>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SubagentTranscriptDialog;
