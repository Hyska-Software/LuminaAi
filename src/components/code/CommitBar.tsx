import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, CircleAlert, GitCommitHorizontal, Sparkles } from 'lucide-react';
import { Button, NativeSelect, Spinner, Textarea, Tooltip } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { CommitTarget, WorkspaceGitCommit, WorkspaceGitStatus } from '@/lib/types';

export interface CommitBarProps {
  workspaceId?: string | null;
  /** `false` when the workspace is not a git repository (commit disabled). */
  isRepo?: boolean;
  /** True when there is at least one pending change. */
  hasChanges?: boolean;
  /** Paths currently prepared in the index (target "Preparados"). */
  stagedPaths?: string[];
  /** Paths checked by the user (target "Seleção"). */
  selectedPaths?: string[];
  added?: number;
  removed?: number;
  /** Extra reason to block the commit (e.g. merge conflicts). */
  blockedReason?: string | null;
  onCommitted?: (status: WorkspaceGitStatus) => void;
  /** Called after a successful commit so the container can reload status/files. */
  onRefresh?: () => void;
  className?: string;
}

const LOG_LIMIT = 10;

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

/** Short hash shown in the history (`a1b2c3d`) and in the success toast. */
export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

/** Git dates arrive as ISO strings; invalid values are shown as-is. */
export function formatCommitDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

/**
 * Commit bar of the Code panel (WORKBENCH §7.2/§15): target selector
 * (tudo/preparados/seleção), message with AI suggestion, commit with
 * loading/toast feedback and a collapsible recent-commits history.
 */
export function CommitBar({
  workspaceId,
  isRepo = true,
  hasChanges = true,
  stagedPaths = [],
  selectedPaths = [],
  added = 0,
  removed = 0,
  blockedReason = null,
  onCommitted,
  onRefresh,
  className,
}: CommitBarProps) {
  const [target, setTarget] = useState<CommitTarget>('all');
  const [message, setMessage] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commits, setCommits] = useState<WorkspaceGitCommit[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const logRun = useRef(0);
  const suggestRun = useRef(0);

  const loadLog = useCallback(async () => {
    const run = logRun.current + 1;
    logRun.current = run;
    if (!workspaceId || !isRepo) {
      setCommits([]);
      setLogError(null);
      setLogLoading(false);
      return;
    }
    setLogLoading(true);
    setLogError(null);
    try {
      const log = await api.gitLog(workspaceId, LOG_LIMIT);
      if (run !== logRun.current) return;
      setCommits(log ?? []);
    } catch (error) {
      if (run !== logRun.current) return;
      setCommits([]);
      setLogError(describeError(error, 'Não foi possível carregar os commits recentes.'));
    } finally {
      if (run === logRun.current) setLogLoading(false);
    }
  }, [workspaceId, isRepo]);

  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  useEffect(() => {
    suggestRun.current += 1;
    setMessage('');
    setSuggestError(null);
    setSuggesting(false);
  }, [workspaceId]);

  useEffect(() => {
    suggestRun.current += 1;
    setSuggestError(null);
    setSuggesting(false);
  }, [target]);

  const stageCount = stagedPaths.length;
  const selectionCount = selectedPaths.length;

  /* A target whose paths disappeared (e.g. after a commit) falls back to "tudo". */
  useEffect(() => {
    if (target === 'staged' && stageCount === 0) setTarget('all');
    if (target === 'selection' && selectionCount === 0) setTarget('all');
  }, [target, stageCount, selectionCount]);

  const suggestDisabledReason = !workspaceId
    ? 'Abra um workspace para commitar'
    : !isRepo
      ? 'Não é um repositório Git'
      : blockedReason
        ? blockedReason
        : !hasChanges
          ? 'Nenhuma alteração para commitar'
          : target === 'staged' && stageCount === 0
            ? 'Nenhum arquivo preparado'
            : target === 'selection' && selectionCount === 0
              ? 'Selecione arquivos na lista'
              : null;
  const disabledReason =
    suggestDisabledReason ?? (!message.trim() ? 'Escreva a mensagem do commit' : null);

  const canCommit = !disabledReason && !committing;
  const targetPaths = target === 'selection' ? selectedPaths : undefined;

  const handleSuggest = async () => {
    if (!workspaceId || suggesting || suggestDisabledReason) return;
    const run = ++suggestRun.current;
    const requestedMessage = message;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const suggestion = await api.suggestCommitMessage(workspaceId, target, targetPaths);
      if (run !== suggestRun.current) return;
      if (suggestion?.trim()) {
        setMessage((current) => (current === requestedMessage ? suggestion.trim() : current));
      } else {
        setSuggestError('A sugestão veio vazia — escreva a mensagem do commit.');
      }
    } catch (error) {
      if (run !== suggestRun.current) return;
      setSuggestError(describeError(error, 'Não foi possível sugerir uma mensagem.'));
    } finally {
      if (run === suggestRun.current) setSuggesting(false);
    }
  };

  const handleCommit = async () => {
    if (!workspaceId || !canCommit) return;
    setCommitting(true);
    try {
      const status = await api.gitCommit(workspaceId, message.trim(), target, targetPaths);
      setMessage('');
      setSuggestError(null);
      onCommitted?.(status);
      let hash = '';
      try {
        const log = await api.gitLog(workspaceId, LOG_LIMIT);
        setCommits(log ?? []);
        hash = log?.[0]?.hash ?? '';
      } catch {
        /* The commit succeeded; the history refresh is best-effort. */
      }
      toast.success(hash ? `Commit criado (${shortHash(hash)})` : 'Commit criado');
      onRefresh?.();
    } catch (error) {
      toast.error(describeError(error, 'Não foi possível criar o commit'));
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className={cn('flex shrink-0 flex-col border-t border-border bg-surface', className)}>
      <div className="flex items-center gap-2 px-3 pt-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-subtle">
          Commit
        </span>
        <span className="ml-auto text-[11.5px] tabular-nums" title="Linhas adicionadas e removidas">
          <span className="text-success">+{added}</span> <span className="text-danger">−{removed}</span>
        </span>
        <NativeSelect
          aria-label="Alvo do commit"
          value={target}
          onChange={(event) => setTarget(event.target.value as CommitTarget)}
          wrapperClassName="w-auto"
          className="h-7 w-auto min-w-28 text-[11.5px]"
        >
          <option value="all">Tudo</option>
          <option value="staged" disabled={stageCount === 0}>
            Preparados ({stageCount})
          </option>
          <option value="selection" disabled={selectionCount === 0}>
            Seleção ({selectionCount})
          </option>
        </NativeSelect>
      </div>

      <div className="px-3 pt-2">
        <Textarea
          aria-label="Mensagem do commit"
          placeholder="Mensagem do commit…"
          rows={2}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="min-h-16 resize-none rounded-lg text-[12.5px]"
        />
      </div>

      <div className="flex items-center gap-2 px-3 py-2">
        <Tooltip
          content={suggestDisabledReason ?? 'Sugerir mensagem com IA'}
          side="top"
        >
          <Button
            size="sm"
            variant="subtle"
            loading={suggesting}
            disabled={Boolean(suggestDisabledReason)}
            title={suggestDisabledReason ?? 'Sugerir mensagem com IA'}
            aria-label="Sugerir mensagem"
            leftIcon={<Sparkles aria-hidden className="size-3.5" strokeWidth={1.75} />}
            onClick={() => void handleSuggest()}
          >
            Sugerir
          </Button>
        </Tooltip>

        {/* Disabled buttons swallow pointer events: the wrapper carries the hint. */}
        <span className="ml-auto inline-flex" title={disabledReason ?? undefined}>
          <Button
            size="sm"
            variant="primary"
            loading={committing}
            disabled={!canCommit}
            title={disabledReason ?? 'Commit'}
            leftIcon={<GitCommitHorizontal aria-hidden className="size-3.5" strokeWidth={1.75} />}
            onClick={() => void handleCommit()}
          >
            Commit
          </Button>
        </span>
      </div>

      {suggestError ? (
        <p role="alert" className="flex items-center gap-1.5 px-3 pb-2 text-[11.5px] text-danger">
          <CircleAlert aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
          {suggestError}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setLogOpen((current) => !current)}
        aria-expanded={logOpen}
        className="flex h-8 shrink-0 items-center gap-1 border-t border-border px-3 text-[11.5px] font-medium text-foreground-muted transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none',
            logOpen && 'rotate-90',
          )}
          strokeWidth={1.75}
        />
        Commits recentes{commits.length ? ` (${commits.length})` : ''}
        {logLoading ? <Spinner size="xs" label="Carregando commits" className="ml-auto" /> : null}
      </button>

      {logOpen ? (
        <div className="border-t border-border px-3 py-2">
          {logError ? (
            <p role="alert" className="text-[11.5px] text-danger">
              {logError}
            </p>
          ) : logLoading && commits.length === 0 ? (
            <p className="text-[11.5px] text-foreground-muted">Carregando commits…</p>
          ) : commits.length === 0 ? (
            <div>
              <p className="text-[12px] font-medium text-foreground">Sem commits ainda</p>
              <p className="text-[11.5px] text-foreground-muted">
                Os commits do workspace aparecem aqui.
              </p>
            </div>
          ) : (
            <ul aria-label="Commits recentes" className="max-h-52 space-y-1 overflow-y-auto">
              {commits.map((commit) => (
                <li key={commit.hash} className="flex items-baseline gap-2 text-[11.5px]">
                  <span
                    className="shrink-0 font-mono text-foreground-subtle"
                    title={commit.hash}
                  >
                    {shortHash(commit.hash)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground" title={commit.subject}>
                    {commit.subject}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-foreground-subtle">
                    {commit.author} · {formatCommitDate(commit.date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default CommitBar;
