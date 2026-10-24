import { useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { Check, ChevronDown, FilePlus, FileText, Globe, ShieldCheck, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
import { Spinner } from '@/components/ui';
import type { Citation, ToolCallRecord } from '@/lib/types';
import { cn, formatDuration, safeJsonParse, truncate } from '@/lib/utils';
import { CitationChips } from './CitationChips';

interface ToolMeta {
  label: string;
  icon: LucideIcon;
}

const TOOL_META: Record<string, ToolMeta> = {
  web_search: { label: 'Busca web', icon: Globe },
  fetch_url: { label: 'Ler página', icon: FileText },
  create_file: { label: 'Criar arquivo', icon: FilePlus },
  // Autovalidação da UI generativa (documentada em docs/GENUI.md §10).
  validate_ui: { label: 'Validar interface', icon: ShieldCheck },
};

/** Argument keys that make a good one-line summary, in priority order. */
const SUMMARY_KEYS = ['query', 'q', 'url', 'path', 'name', 'filename', 'title'];

function summarize(tool: ToolCallRecord): string | null {
  if (tool.summary?.trim()) return truncate(tool.summary.trim(), 96);
  const args = safeJsonParse<Record<string, unknown>>(tool.arguments, {});
  for (const key of SUMMARY_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return truncate(value.trim(), 96);
    if (Array.isArray(value)) {
      const first = value.find((item): item is string => typeof item === 'string');
      if (first) return truncate(first, 96);
    }
  }
  const raw = tool.arguments.trim();
  return raw ? truncate(raw, 96) : null;
}

function formatResult(result?: string | null): string {
  const trimmed = result?.trim() ?? '';
  if (!trimmed) return '';
  const looksJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (looksJson) {
    const parsed = safeJsonParse<unknown>(trimmed, null);
    if (parsed !== null) {
      try {
        return JSON.stringify(parsed, null, 2);
      } catch {
        return trimmed;
      }
    }
  }
  return trimmed;
}

export interface ToolCallCardProps {
  tool: ToolCallRecord;
  /** Citation chips shown for `web_search` results. */
  citations?: Citation[];
  className?: string;
}

/** Compact tool invocation card (DESIGN §6.3). */
export function ToolCallCard({ tool, citations, className }: ToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[tool.name] ?? { label: tool.name, icon: Wrench };
  const Icon = meta.icon;
  const summary = summarize(tool);
  const duration =
    tool.startedAt && tool.finishedAt && tool.finishedAt > tool.startedAt
      ? formatDuration(tool.finishedAt - tool.startedAt)
      : null;
  const output = formatResult(tool.result);

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className={cn('overflow-hidden rounded-xl border border-border bg-surface', className)}
    >
      <Collapsible.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2.5 px-3 py-2 text-left',
            'transition-colors duration-150 hover:bg-surface-hover',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
          )}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-active text-foreground-muted">
            <Icon className="size-3.5" />
          </span>
          <span className="shrink-0 text-[13px] font-medium text-foreground">{meta.label}</span>
          {summary ? (
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground-subtle">{summary}</span>
          ) : (
            <span className="flex-1" />
          )}
          {duration ? (
            <span className="shrink-0 text-[11px] tabular-nums text-foreground-subtle">{duration}</span>
          ) : null}
          <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
            {tool.status === 'running' ? (
              <Spinner size="xs" className="text-foreground-subtle" />
            ) : tool.status === 'error' ? (
              <TriangleAlert className="size-3.5 text-danger" />
            ) : (
              <Check className="size-3.5 text-success" />
            )}
          </span>
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-foreground-subtle transition-transform duration-150',
              open && 'rotate-180',
            )}
          />
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content>
        <div className="border-t border-border px-3 py-2.5">
          {citations && citations.length > 0 ? <CitationChips citations={citations} className="mb-2" /> : null}
          {output ? (
            <pre
              className={cn(
                'max-h-64 overflow-auto overscroll-contain whitespace-pre-wrap break-words',
                'rounded-lg bg-surface-raised p-2.5 font-mono text-[11.5px] leading-5 text-foreground-muted',
              )}
            >
              {output}
            </pre>
          ) : (
            <p className="text-[12px] text-foreground-subtle">
              {tool.status === 'running' ? 'Executando…' : 'Sem resultado registrado.'}
            </p>
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
