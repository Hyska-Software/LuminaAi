/**
 * Aba central de **histórico de commits** do layout Code (estilo Zed).
 *
 * Lista os commits do workspace (`git_log`) e, ao abrir um commit, mostra
 * metadados + a lista de arquivos com o **diff completo** por arquivo
 * (`git_commit_detail`, com syntax highlight do `DiffView`). A navegação
 * lista ↔ commit fica no `uiStore` (`codeCommitsTab`), então fechar e reabrir
 * a aba não perde o commit selecionado na mesma sessão.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ChevronDown,
  CircleAlert,
  Clock,
  Copy,
  FileDiff,
  GitBranch,
  History,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge, Button, IconButton, Spinner, Tooltip } from '@/components/ui';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { formatDate as formatIntlDate } from '@/lib/i18n/format';
import type { WorkspaceCommitDetail, WorkspaceCommitFile, WorkspaceGitCommit } from '@/lib/types';
import { cn, copyText } from '@/lib/utils';
import { DiffView } from './DiffView';

export interface CodeCommitsTabTarget {
  workspaceId: string;
  /** `null` mostra a lista; um hash mostra o commit. */
  revision: string | null;
}

export interface CodeCommitHistoryViewProps {
  target: CodeCommitsTabTarget;
  /** Abre a lista (`null`) ou um commit. */
  onSelect: (revision: string | null) => void;
  className?: string;
}

const STATUS_STYLES: Record<string, string> = {
  A: 'text-success',
  M: 'text-warning',
  D: 'text-danger',
  R: 'text-accent',
  C: 'text-accent',
  T: 'text-foreground-subtle',
};

function statusLabel(status: string): string {
  switch (status) {
    case 'A':
      return t('code:commits.status.A');
    case 'M':
      return t('code:commits.status.M');
    case 'D':
      return t('code:commits.status.D');
    case 'R':
      return t('code:commits.status.R');
    case 'C':
      return t('code:commits.status.C');
    case 'T':
      return t('code:commits.status.T');
    default:
      return status;
  }
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatIntlDate(date, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Lista de commits do workspace, mais recentes primeiro. */
function CommitList({
  workspaceId,
  onSelect,
}: {
  workspaceId: string;
  onSelect: (revision: string) => void;
}) {
  const { t: translate } = useTranslation('code');
  const [commits, setCommits] = useState<WorkspaceGitCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.gitLog(workspaceId, 100);
      setCommits(Array.isArray(list) ? list : []);
    } catch (loadError) {
      setError(describeError(loadError, translate('code:commits.loadListError')));
      setCommits([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && commits.length === 0) {
    return (
      <div role="status" aria-label={translate('code:commits.loadingList')} className="flex flex-1 items-center justify-center gap-2 text-[12px] text-foreground-muted">
        <Spinner size="sm" /> {translate('code:commits.loadingListText')}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
        <span className="flex size-9 items-center justify-center rounded-xl border border-danger/30 bg-danger-soft text-danger">
          <CircleAlert aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
        <p className="text-[12.5px] font-medium text-foreground">{translate('code:commits.errorTitle')}</p>
        <p className="max-w-80 text-[12px] leading-relaxed text-foreground-muted">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => void load()} leftIcon={<RefreshCw className="size-3.5" />}>
          {translate('common:actions.retry')}
        </Button>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
        <History aria-hidden className="size-5 text-foreground-subtle" strokeWidth={1.75} />
        <p className="text-[12.5px] font-medium text-foreground">{translate('code:commits.empty.title')}</p>
        <p className="max-w-72 text-[12px] leading-relaxed text-foreground-muted">
          {translate('code:commits.empty.description')}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ul role="list" aria-label={translate('code:commits.listAria')} className="divide-y divide-border">
        {commits.map((commit) => (
          <li key={commit.hash}>
            <button
              type="button"
              onClick={() => onSelect(commit.hash)}
              title={commit.subject}
              className="flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[11px] text-accent">{shortHash(commit.hash)}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                  {commit.subject}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-2 text-[11px] text-foreground-subtle">
                <span className="truncate">{commit.author}</span>
                {commit.date ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">{formatDate(commit.date)}</span>
                  </>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Arquivo alterado no commit, com o patch completo expansível. */
function CommitFileSection({
  file,
  expanded,
  onToggle,
}: {
  file: WorkspaceCommitFile;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t: translate } = useTranslation('code');
  const title =
    file.oldPath && file.oldPath !== file.path
      ? `${file.oldPath} → ${file.path}`
      : file.path;
  const status = statusLabel(file.status);
  const statusClass = STATUS_STYLES[file.status] ?? 'text-foreground-subtle';
  return (
    <section aria-label={translate('code:commits.fileAria', { path: file.path })} className="border-b border-border">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex h-9 w-full min-w-0 items-center gap-2 px-3 text-left transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-foreground-subtle transition-transform duration-150 motion-reduce:transition-none',
            !expanded && '-rotate-90',
          )}
          strokeWidth={1.75}
        />
        <span aria-hidden className={cn('shrink-0 font-mono text-[11px] font-semibold', statusClass)}>
          {file.status}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground" title={title}>
          {title}
        </span>
        {file.binary ? (
          <Badge tone="neutral" size="sm" className="shrink-0">
            {translate('code:commits.binaryBadge')}
          </Badge>
        ) : (
          <span className="shrink-0 text-[11px] tabular-nums">
            <span className="text-success">+{file.added}</span>{' '}
            <span className="text-danger">−{file.removed}</span>
          </span>
        )}
      </button>
      {expanded ? (
        <div className="h-72 min-h-0 border-t border-border">
          {file.binary ? (
            <p className="px-4 py-6 text-center text-[12px] text-foreground-muted">
              {translate('code:commits.binaryDiff')}
            </p>
          ) : (
            <DiffView path={file.path} diff={file.diff} className="h-full" />
          )}
        </div>
      ) : null}
      <span className="sr-only">{status}</span>
    </section>
  );
}

/** Tela do commit selecionado: metadados + arquivos + diffs completos. */
function CommitDetail({
  workspaceId,
  revision,
  onBack,
}: {
  workspaceId: string;
  revision: string;
  onBack: () => void;
}) {
  const { t: translate } = useTranslation('code');
  const [detail, setDetail] = useState<WorkspaceCommitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.gitCommitDetail(workspaceId, revision);
      setDetail(result);
      // O primeiro arquivo já vem aberto (como no Zed); o resto sob demanda.
      setExpanded(new Set(result?.files[0] ? [result.files[0].path] : []));
    } catch (loadError) {
      setError(describeError(loadError, translate('code:commits.loadDetailError')));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, revision]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !detail) {
    return (
      <div role="status" aria-label={translate('code:commits.loadingDetail')} className="flex flex-1 items-center justify-center gap-2 text-[12px] text-foreground-muted">
        <Spinner size="sm" /> {translate('code:commits.loadingDetailText')}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
        <span className="flex size-9 items-center justify-center rounded-xl border border-danger/30 bg-danger-soft text-danger">
          <CircleAlert aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
        <p className="text-[12.5px] font-medium text-foreground">{translate('code:commits.detailErrorTitle')}</p>
        <p className="max-w-80 text-[12px] leading-relaxed text-foreground-muted">{error}</p>
        <div className="mt-1 flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void load()} leftIcon={<RefreshCw className="size-3.5" />}>
            {translate('common:actions.retry')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>
            {translate('code:commits.backToCommits')}
          </Button>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const allExpanded = detail.files.length > 0 && detail.files.every((file) => expanded.has(file.path));
  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(detail.files.map((file) => file.path)));
  };

  return (
    <div
      role="region"
      aria-label={translate('code:commits.detailAria')}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      <div className="border-b border-border bg-surface px-3 py-2">
        <div className="flex items-center gap-1">
          <IconButton label={translate('code:commits.backToCommits')} size="sm" onClick={onBack}>
            <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
          </IconButton>
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground" title={detail.subject}>
            {detail.subject}
          </h3>
          <span className="shrink-0 font-mono text-[11px] text-accent" title={detail.hash}>
            {shortHash(detail.hash)}
          </span>
          <Tooltip content={translate('code:commits.copySha')} side="bottom">
            <IconButton
              label={translate('code:commits.copySha')}
              size="sm"
              onClick={() => {
                void copyText(detail.hash).then((copied) => {
                  if (copied) toast.success(translate('code:commits.shaCopied'));
                  else toast.error(translate('code:commits.shaCopyError'));
                });
              }}
            >
              <Copy aria-hidden className="size-3.5" />
            </IconButton>
          </Tooltip>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-1 text-[11px] text-foreground-subtle">
          <span className="truncate text-foreground-muted">
            {detail.author}
            {detail.email ? ` · ${detail.email}` : ''}
          </span>
          {detail.date ? (
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden className="size-3" />
              {formatDate(detail.date)}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <FileDiff aria-hidden className="size-3" />
            {translate('code:commits.files', { count: detail.files.length })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-1.5 text-[11px]"
            onClick={toggleAll}
          >
            {allExpanded ? translate('code:commits.collapseDiffs') : translate('code:commits.expandDiffs')}
          </Button>
        </div>
        {detail.body ? (
          // Mensagem longa tem rolagem própria para nunca empurrar os arquivos
          // para fora da área visível do commit.
          <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words px-1 py-1 text-[11.5px] leading-relaxed text-foreground-muted">
            {detail.body}
          </p>
        ) : null}
        {detail.truncated ? (
          <p role="note" className="mt-1 rounded-md bg-warning-soft px-2 py-1 text-[11px] text-warning">
            {translate('code:commits.truncated')}
          </p>
        ) : null}
      </div>
      <div>
        {detail.files.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-foreground-muted">
            {translate('code:commits.noFiles')}
          </p>
        ) : (
          detail.files.map((file) => (
            <CommitFileSection
              key={file.path}
              file={file}
              expanded={expanded.has(file.path)}
              onToggle={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(file.path)) next.delete(file.path);
                  else next.add(file.path);
                  return next;
                })
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

/** Aba central do histórico de commits: lista ↔ commit completo. */
export function CodeCommitHistoryView({ target, onSelect, className }: CodeCommitHistoryViewProps) {
  const { t: translate } = useTranslation('code');
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <History aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground-muted">
          {translate('code:commits.header')}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] text-foreground-subtle">
          <GitBranch aria-hidden className="size-3" />
          {target.revision ? shortHash(target.revision) : translate('code:commits.all')}
        </span>
      </div>
      {target.revision ? (
        <CommitDetail
          workspaceId={target.workspaceId}
          revision={target.revision}
          onBack={() => onSelect(null)}
        />
      ) : (
        <CommitList workspaceId={target.workspaceId} onSelect={(revision) => onSelect(revision)} />
      )}
    </div>
  );
}

export default CodeCommitHistoryView;
