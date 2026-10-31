import { useId, useState } from 'react';
import {
  ChevronDown,
  Copy,
  SquareTerminal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { DiffView } from '@/components/code/DiffView';
import { SubagentTranscriptDialog } from '@/components/agent/SubagentTranscriptDialog';
import { Spinner } from '@/components/ui';
import { describeCodeTool, type CodeToolLabel } from '@/lib/agentTrace';
import { useChatStore } from '@/lib/store/chatStore';
import type { ToolCallRecord } from '@/lib/types';
import { cn, copyText, formatDuration } from '@/lib/utils';

export interface ToolCallRowProps {
  tool: ToolCallRecord;
  icon: LucideIcon;
  className?: string;
}

function parseExitCode(result: string | null | undefined): number | null {
  if (!result) return null;
  const match = result.match(/\[exit code:\s*(\d+)\]/);
  return match ? Number(match[1]) : null;
}

function parseResultDuration(result: string | null | undefined): number | null {
  if (!result) return null;
  const match = result.match(/\(duração:\s*(\d+)\s*ms\)/);
  return match ? Number(match[1]) : null;
}

/** Corpo da saída sem as linhas de metadados que já viram badges na linha. */
function resultBody(result: string | null | undefined): string {
  if (!result) return '';
  return result
    .split('\n')
    .filter(
      (line) =>
        !/^\[exit code:/.test(line.trim()) && !/^\(duração:/.test(line.trim()),
    )
    .join('\n')
    .trim();
}

function fileChangeOf(tool: ToolCallRecord) {
  return tool.presentation?.kind === 'file_change' ? tool.presentation : null;
}

function durationMs(tool: ToolCallRecord): number | null {
  if (tool.startedAt != null && tool.finishedAt != null) {
    return Math.max(0, tool.finishedAt - tool.startedAt);
  }
  return parseResultDuration(tool.result);
}

function ExpandedOutput({
  body,
  error,
  id,
}: {
  body: string;
  error: boolean;
  id: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyText(body);
    if (!ok) {
      toast.error('Não foi possível copiar a saída');
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };
  return (
    <div
      id={id}
      className="mt-1 overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1">
        <SquareTerminal aria-hidden className="size-3 shrink-0 text-foreground-subtle" />
        <span className="min-w-0 flex-1 text-[10.5px] font-medium uppercase tracking-wide text-foreground-subtle">
          {error ? 'Saída (falhou)' : 'Saída'}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copiar saída"
          className="flex size-6 shrink-0 items-center justify-center rounded text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Copy aria-hidden className={cn('size-3', copied && 'text-success')} />
        </button>
      </div>
      <pre
        tabIndex={0}
        className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        {body}
      </pre>
    </div>
  );
}

/**
 * Uma linha da timeline de execução do agente (WORKBENCH §5.2).
 *
 * A linha resume a tool (verbo + alvo + status + `+N −M`/`exit code`); o detalhe
 * sob demanda mostra o diff (com syntax highlight, via `DiffView`) ou a saída do
 * comando. Falhas abrem com a saída visível por padrão.
 */
export function ToolCallRow({ tool, icon: Icon, className }: ToolCallRowProps) {
  const detailsId = useId();
  const meta: CodeToolLabel = describeCodeTool(tool);
  const change = fileChangeOf(tool);
  const diff = change?.diff?.trim() ?? '';
  const body = resultBody(tool.result);
  const exitCode = parseExitCode(tool.result);
  const duration = durationMs(tool);
  const running = tool.status === 'running';
  const failed = tool.status === 'error' || (exitCode !== null && exitCode !== 0);
  const hasDetails = Boolean(diff) || Boolean(body);
  const [expanded, setExpanded] = useState(
    () => hasDetails && (tool.status === 'error' || (exitCode !== null && exitCode !== 0)),
  );
  const liveSubagent = useChatStore(
    (state) => state.streaming?.subagents?.[tool.id] ?? null,
  );
  const subagentPresentation =
    tool.presentation?.kind === 'subagent' ? tool.presentation : null;
  const subagentConversationId =
    liveSubagent?.conversationId ?? subagentPresentation?.conversationId ?? null;
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const header = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-[12px] font-semibold text-foreground">{meta.verb}</span>
      {meta.detail ? (
        <code
          title={meta.detail}
          className="min-w-0 max-w-full truncate font-mono text-[11.5px] text-foreground-muted"
        >
          {meta.detail}
        </code>
      ) : null}
      {change ? (
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums">
          <span className="text-success">+{change.added}</span>{' '}
          <span className="text-danger">−{change.removed}</span>
        </span>
      ) : null}
      {exitCode != null ? (
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums',
            exitCode === 0 ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
          )}
        >
          exit {exitCode}
        </span>
      ) : null}
      {duration != null && duration > 0 ? (
        <span className="shrink-0 text-[10.5px] tabular-nums text-foreground-subtle">
          {formatDuration(duration)}
        </span>
      ) : null}
      {running ? <Spinner size="xs" className="text-foreground-subtle" /> : null}
      {failed ? (
        <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-danger" />
      ) : null}
      {hasDetails ? (
        <ChevronDown
          aria-hidden
          className={cn(
            'ml-auto size-3.5 shrink-0 text-foreground-subtle transition-transform duration-150',
            expanded && 'rotate-180',
          )}
        />
      ) : null}
    </div>
  );

  return (
    <li aria-label={meta.label} className={cn('min-w-0', className)}>
      <div
        className={cn(
          'flex min-w-0 items-start gap-2.5 rounded-lg px-1.5 py-1 transition-colors',
          hasDetails && 'hover:bg-surface-hover/60',
        )}
      >
        <Icon
          aria-hidden
          className={cn(
            'mt-0.5 size-3.5 shrink-0',
            failed ? 'text-danger' : 'text-foreground-subtle',
          )}
        />
        {hasDetails ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((value) => !value)}
            className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {header}
          </button>
        ) : (
          <div className="min-w-0 flex-1">{header}</div>
        )}
      </div>

      {liveSubagent || subagentConversationId ? (
        <div className="ml-[26px] mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground-muted">
          {liveSubagent ? (
            <>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  liveSubagent.status === 'running'
                    ? 'bg-accent-soft text-accent'
                    : liveSubagent.status === 'error'
                      ? 'bg-danger-soft text-danger'
                      : 'bg-success-soft text-success',
                )}
              >
                {liveSubagent.status === 'running'
                  ? 'ao vivo'
                  : liveSubagent.status === 'done'
                    ? 'concluído'
                    : liveSubagent.status === 'error'
                      ? 'falhou'
                      : 'cancelado'}
              </span>
              <span className="tabular-nums">{liveSubagent.steps} passos</span>
              {liveSubagent.usage?.totalTokens != null ? (
                <span className="tabular-nums">{liveSubagent.usage.totalTokens} tokens</span>
              ) : null}
              {liveSubagent.effort ? <span>esforço {liveSubagent.effort}</span> : null}
              <code className="min-w-0 truncate font-mono text-[10.5px] text-foreground-subtle">
                {liveSubagent.providerId}/{liveSubagent.modelId}
              </code>
              {liveSubagent.error ? (
                <span className="min-w-0 truncate text-danger">{liveSubagent.error}</span>
              ) : liveSubagent.text.trim() ? (
                <span className="min-w-0 max-w-[420px] truncate text-foreground-subtle">
                  {liveSubagent.text.trim().slice(-140)}
                </span>
              ) : null}
            </>
          ) : null}
          {subagentConversationId ? (
            <button
              type="button"
              onClick={() => setTranscriptOpen(true)}
              className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Ver transcrição
            </button>
          ) : null}
        </div>
      ) : null}

      {expanded && hasDetails ? (
        <div className="ml-[26px]">
          {diff ? (
            <div
              id={detailsId}
              className="mt-1 overflow-hidden rounded-lg border border-border"
            >
              <DiffView path={change?.path ?? meta.detail ?? 'diff'} diff={diff} />
            </div>
          ) : (
            <ExpandedOutput id={detailsId} body={body} error={failed} />
          )}
        </div>
      ) : null}

      <SubagentTranscriptDialog
        conversationId={subagentConversationId}
        open={transcriptOpen}
        onOpenChange={setTranscriptOpen}
      />
    </li>
  );
}

export default ToolCallRow;
