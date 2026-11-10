import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  Square,
  SquareTerminal,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { Badge, IconButton } from '@/components/ui';
import type { JobView } from '@/lib/types';
import { cn, formatDuration } from '@/lib/utils';

export interface JobsBarProps {
  jobs: JobView[];
  onKill?: (id: string) => void;
  onOpen?: (job: JobView) => void;
  className?: string;
}

const STATUS_LABEL: Record<JobView['status'], string> = {
  running: 'jobs.status.running',
  done: 'jobs.status.done',
  failed: 'jobs.status.failed',
  killed: 'jobs.status.killed',
};

function StatusIcon({ status }: { status: JobView['status'] }) {
  if (status === 'running') {
    return <SquareTerminal aria-hidden className="size-3.5 shrink-0 text-accent motion-safe:animate-pulse" />;
  }
  if (status === 'failed') {
    return <XCircle aria-hidden className="size-3.5 shrink-0 text-danger" />;
  }
  if (status === 'killed') {
    return <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warning" />;
  }
  return <CheckCircle2 aria-hidden className="size-3.5 shrink-0 text-success" />;
}

function elapsed(job: JobView): string {
  const ms = job.durationMs ?? (job.status === 'running' ? Date.now() - job.startedAt : null);
  return ms == null ? '—' : formatDuration(ms);
}

/**
 * Faixa de jobs em background (WORKBENCH §7.4/§9): status, comando truncado,
 * tempo e ações "ver"/"parar". Recolhível; some quando não há jobs.
 */
export function JobsBar({ jobs, onKill, onOpen, className }: JobsBarProps) {
  const { t } = useTranslation('agents');
  const listId = useId();
  const [open, setOpen] = useState(true);

  if (jobs.length === 0) return null;

  const running = jobs.filter((job) => job.status === 'running').length;

  return (
    <section aria-label={t('jobs.aria')} className={cn('rounded-xl border border-border bg-surface', className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={listId}
        className={cn(
          'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left',
          'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        )}
      >
        {open ? (
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-foreground-muted" />
        ) : (
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-foreground-muted" />
        )}
        <span className="min-w-0 flex-1 text-[12px] font-medium text-foreground-muted">
          {t('jobs.title')}
        </span>
        {running > 0 ? <Badge variant="accent">{t('jobs.runningCount', { count: running })}</Badge> : null}
        <span className="text-[11px] tabular-nums text-foreground-muted">{jobs.length}</span>
      </button>

      {open ? (
        <ul id={listId} aria-label={t('jobs.listAria')} className="border-t border-border p-1.5">
          {jobs.map((job) => {
            const isRunning = job.status === 'running';
            return (
              <li
                key={job.id}
                className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-surface-hover"
              >
                <StatusIcon status={job.status} />
                <code
                  title={job.command}
                  className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground-muted"
                >
                  {job.command}
                </code>
                <span className="sr-only">{t(STATUS_LABEL[job.status])}</span>
                {job.exitCode != null && !isRunning ? (
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-foreground-muted">
                    exit {job.exitCode}
                  </span>
                ) : null}
                <span className="shrink-0 text-[11px] tabular-nums text-foreground-muted">
                  {elapsed(job)}
                </span>
                {onOpen ? (
                  <IconButton
                    size="sm"
                    label={t('jobs.openJob', { command: job.command })}
                    onClick={() => onOpen(job)}
                  >
                    <Eye className="size-3.5" />
                  </IconButton>
                ) : null}
                {isRunning && onKill ? (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={t('jobs.killJob', { command: job.command })}
                    onClick={() => onKill(job.id)}
                  >
                    <Square className="size-3.5" />
                  </IconButton>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
