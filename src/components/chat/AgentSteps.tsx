import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import {
  ArrowUpRight,
  BookOpen,
  Brain,
  ChevronDown,
  FilePlus,
  FileSearch,
  FileText,
  Library,
  Search,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useReduceMotion } from '@/components/layout/hooks';
import { ToolPresentationCard } from '@/components/agent/ToolPresentationCard';
import { Spinner } from '@/components/ui';
import {
  buildAgentTrace,
  countTraceTools,
  hasTraceReasoning,
  type PageLink,
  type ToolGroup,
} from '@/lib/agentTrace';
import { useAppStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/types';
import { cn, formatDuration, formatThinkingDuration, truncate } from '@/lib/utils';
import { openExternalUrl } from './external';

export type AgentStepsPhase = 'starting' | 'reasoning' | 'text' | 'tool';

export interface AgentStepsProps {
  message: ChatMessage;
  /** The assistant is currently streaming this turn. */
  streaming: boolean;
  /** Current streaming phase (used by the live header). */
  phase: AgentStepsPhase | null;
  /** Turn start timestamp, used by the live counter. */
  startedAt?: number | null;
  className?: string;
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  web_search: Search,
  fetch_url: FileText,
  create_file: FilePlus,
  validate_ui: ShieldCheck,
  run_code: SquareTerminal,
  list_skills: BookOpen,
  read_skill: BookOpen,
  list_artifacts: Library,
  read_artifact: FileSearch,
};

const MAX_DOMAINS = 5;
const MAX_PAGE_CHIPS = 6;
const MAX_FILE_CHIPS = 4;

/** Live counter while the turn streams (500ms tick). */
function useLiveElapsed(active: boolean, startedAt?: number | null): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setElapsed(null);
      return undefined;
    }
    const start = startedAt ?? Date.now();
    const update = () => setElapsed(Math.max(0, Date.now() - start));
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [active, startedAt]);

  return elapsed;
}

/**
 * The "thinking space" of an assistant turn (DESIGN §6.3): a single
 * collapsible timeline that interleaves the model's reasoning with the steps
 * it took (web searches, pages read, files created), replacing the old
 * stand-alone reasoning block and tool cards.
 */
export function AgentSteps({ message, streaming, phase, startedAt, className }: AgentStepsProps) {
  const reduceMotion = useReduceMotion();
  const entries = useMemo(
    () => buildAgentTrace(message),
    [message.reasoning, message.toolCalls, message.trace],
  );
  const hasReasoning = hasTraceReasoning(entries);
  const toolCount = countTraceTools(entries);
  const running = entries.some(
    (entry) => entry.kind === 'tools' && entry.group.status === 'running',
  );
  const liveElapsed = useLiveElapsed(streaming, startedAt);
  // Apresentações persistidas das tools do harness de código (diff/tarefas/
  // plano/job/respostas) — ficam fora do bloco recolhível para não esconder o
  // que o agente mudou (WORKBENCH §5.2).
  const presentations = useMemo(
    () =>
      (message.toolCalls ?? [])
        .map((tool) => tool.presentation)
        .filter((presentation): presentation is NonNullable<typeof presentation> =>
          Boolean(presentation),
        ),
    [message.toolCalls],
  );

  // Auto-open while the agent works and collapse once the answer is ready
  // (same behavior as the previous reasoning block; the user can reopen).
  // When "raciocínio recolhido por padrão" is enabled the block starts closed
  // and never toggles by itself: a manual expansion wins, even after the stream
  // ends. Keeping `setOpen` out of the effect in that mode avoids races with
  // the user's own expansion.
  const collapsedByDefault = useAppStore((state) => state.settings.thinkingCollapsedByDefault);
  const [open, setOpen] = useState(() => (collapsedByDefault ? false : streaming));
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    const was = wasStreaming.current;
    wasStreaming.current = streaming;
    if (collapsedByDefault) return;
    if (streaming) setOpen(true);
    else if (was) setOpen(false);
  }, [streaming, collapsedByDefault]);

  const visible = entries.length > 0 || (streaming && phase !== 'text');
  if (!visible) return null;

  const working = streaming && phase !== 'text';
  const duration = formatThinkingDuration(
    streaming ? liveElapsed : (message.usage?.durationMs ?? null),
  );
  const title = working
    ? running && phase === 'tool'
      ? 'Executando ferramentas…'
      : 'Pensando…'
    : hasReasoning
      ? duration
        ? `Pensou por ${duration}`
        : 'Raciocínio'
      : toolCount > 0
        ? `${toolCount} ${toolCount === 1 ? 'passo' : 'passos'}`
        : 'Raciocínio';
  const shimmer = working && !reduceMotion;

  return (
    <div className={className}>
      <Collapsible.Root open={open} onOpenChange={setOpen} className="mb-3">
      <Collapsible.Trigger asChild>
        <button
          type="button"
          className={cn(
            'group/steps flex items-center gap-1.5 rounded-md py-0.5 text-left text-[13px] font-medium text-foreground-muted',
            'transition-colors duration-150 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          )}
        >
          <Brain
            aria-hidden
            className={cn(
              'size-3.5 shrink-0',
              streaming ? 'text-accent' : 'text-foreground-subtle',
            )}
          />
          <span
            className={cn(
              shimmer &&
                'bg-linear-to-r from-foreground-muted via-foreground to-foreground-muted bg-[length:200%_100%] bg-clip-text text-transparent animate-shimmer',
            )}
          >
            {title}
          </span>
          {working && liveElapsed !== null ? (
            <span className="text-[12px] font-normal tabular-nums text-foreground-subtle">
              · {formatDuration(liveElapsed)}
            </span>
          ) : null}
          <ChevronDown
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-foreground-subtle transition-transform duration-150',
              open && 'rotate-180',
            )}
          />
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content>
        <div
          className={cn(
            'mt-2.5 pl-0.5',
            !streaming && 'max-h-80 overflow-y-auto overscroll-contain pr-1',
          )}
        >
          <ol className="flex flex-col gap-3">
            {entries.map((entry, index) => (
              <li key={index} className="relative flex gap-2.5">
                <span
                  aria-hidden
                  className="relative z-10 mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full bg-background"
                >
                  {entry.kind === 'reasoning' ? (
                    <span className="size-[5px] rounded-full bg-foreground-subtle" />
                  ) : (
                    <ToolMarker group={entry.group} />
                  )}
                </span>
                {index < entries.length - 1 ? (
                  <span
                    aria-hidden
                    className="absolute -bottom-3 left-[7.5px] top-5 w-px bg-border"
                  />
                ) : null}
                {entry.kind === 'reasoning' ? (
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground-muted">
                    {entry.text}
                  </p>
                ) : (
                  <ToolActivity group={entry.group} />
                )}
              </li>
            ))}
          </ol>
        </div>
      </Collapsible.Content>
      </Collapsible.Root>
      {presentations.length > 0 ? (
        <div className="mb-3 flex flex-col gap-2">
          {presentations.map((presentation, index) => (
            <ToolPresentationCard key={index} presentation={presentation} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolMarker({ group }: { group: ToolGroup }): ReactNode {
  if (group.status === 'running') {
    return <Spinner size="xs" className="text-foreground-subtle" />;
  }
  if (group.status === 'error') {
    return <TriangleAlert className="size-3.5 text-danger" />;
  }
  const Icon = TOOL_ICONS[group.name] ?? Wrench;
  return <Icon className="size-3.5 text-foreground-subtle" />;
}

function ToolActivity({ group }: { group: ToolGroup }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13px] leading-relaxed text-foreground-muted">{group.label}</span>
        {group.domains.length > 0 ? <DomainSources domains={group.domains} /> : null}
      </div>

      {group.errors.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {group.errors.map((error, index) => (
            <li key={index} className="break-words text-[12px] leading-relaxed text-danger">
              {error}
            </li>
          ))}
        </ul>
      ) : null}

      {group.pages.length > 0 ? <PageLinks pages={group.pages} /> : null}
      {group.files.length > 0 ? <FileChips files={group.files} /> : null}
    </div>
  );
}

/** Source avatars (one letter per domain) — reads like a row of favicons. */
function DomainSources({ domains }: { domains: string[] }) {
  const visible = domains.slice(0, MAX_DOMAINS);
  const hidden = domains.length - visible.length;
  return (
    <span role="img" aria-label={`Fontes: ${domains.join(', ')}`} className="flex items-center gap-1">
      <span aria-hidden className="flex items-center -space-x-1">
        {visible.map((domain) => (
          <span
            key={domain}
            title={domain}
            className="flex size-4 items-center justify-center rounded-full border border-background bg-accent-soft text-[8px] font-semibold uppercase leading-none text-accent"
          >
            {domain.charAt(0)}
          </span>
        ))}
      </span>
      {hidden > 0 ? (
        <span className="text-[10px] tabular-nums text-foreground-subtle">+{hidden}</span>
      ) : null}
    </span>
  );
}

/** Pages read by `fetch_url`: dashed-underline links that open in the browser. */
function PageLinks({ pages }: { pages: PageLink[] }) {
  const visible = pages.slice(0, MAX_PAGE_CHIPS);
  const hidden = pages.length - visible.length;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      {visible.map((page) => (
        <button
          key={page.url}
          type="button"
          onClick={() => void openExternalUrl(page.url)}
          title={page.url}
          aria-label={`Abrir ${page.title} no navegador`}
          className={cn(
            'group/page flex max-w-full items-center gap-1 border-b border-dashed border-border-strong pb-px text-left',
            'text-[12px] font-medium text-foreground-muted transition-colors duration-150',
            'hover:border-foreground-subtle hover:text-foreground',
            'focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          )}
        >
          <span className="min-w-0 truncate">{truncate(page.title, 72)}</span>
          <ArrowUpRight
            aria-hidden
            className="size-3 shrink-0 opacity-60 transition-opacity group-hover/page:opacity-100"
          />
        </button>
      ))}
      {hidden > 0 ? (
        <span className="text-[11px] tabular-nums text-foreground-subtle">+{hidden}</span>
      ) : null}
    </div>
  );
}

/** Artifact names created by `create_file` (the artifact card is rendered below). */
function FileChips({ files }: { files: string[] }) {
  const visible = files.slice(0, MAX_FILE_CHIPS);
  const hidden = files.length - visible.length;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {visible.map((file) => (
        <span
          key={file}
          title={file}
          className="flex h-6 max-w-60 items-center gap-1.5 rounded-full border border-border bg-surface px-2 text-[11px] text-foreground-muted"
        >
          <FileText aria-hidden className="size-3 shrink-0 text-foreground-subtle" />
          <span className="truncate">{truncate(file, 48)}</span>
        </span>
      ))}
      {hidden > 0 ? (
        <span className="text-[11px] tabular-nums text-foreground-subtle">+{hidden}</span>
      ) : null}
    </div>
  );
}
