import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CircleAlert,
  FileDiff,
  GitBranch,
  Minus,
  Plus,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Spinner,
} from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { FileChange, FileChangeKind, WorkspaceGitStatus } from '@/lib/types';
import { CommitBar } from './CommitBar';
import { DiffView } from './DiffView';
import { FileIcon } from './FileIcon';

export type ChangeGroup = 'staged' | 'unstaged' | 'untracked' | 'session';
export type ChangeOrigin = 'session' | 'git' | 'both';

/** One file row of the changes list. */
export interface ChangeRow {
  path: string;
/** Short git status code (`M`, `A`, `D`, `R`, `U`…). */
  status: string;
  group: ChangeGroup;
  origin: ChangeOrigin;
  /** `true` when the change is in the git index. */
  staged: boolean;
  added?: number;
  removed?: number;
  /** Diff already known from the session journal (skips the API call). */
  knownDiff?: string | null;
}

export interface ChangesPanelProps {
  workspaceId?: string | null;
  conversationId?: string | null;
  /** Working tree status; `null` while unknown. */
  gitStatus?: WorkspaceGitStatus | null;
  gitLoading?: boolean;
  gitError?: string | null;
  /** Files touched by the current session (journal). */
  sessionChanges?: FileChange[] | null;
  sessionLoading?: boolean;
  sessionError?: string | null;
  /** Called after stage/unstage/revert/commit so the container reloads the data. */
  onRefresh?: () => void;
  /** Abre a aba central de histórico de commits (lista + diff completo). */
/**
   * Abre o diff como aba central em vez do detalhe inline do painel
   * (`Settings.diffOpenMode`, padrão `tab`). Quando definido, clicar numa linha
   * chama `onOpenDiffTab` e o painel não abre o diff interno.
   */
  onOpenDiffTab?: ((row: ChangeRow) => void) | null;
  className?: string;
}

const GROUPS: ReadonlyArray<{ id: ChangeGroup; label: string }> = [
  { id: 'staged', label: 'Preparados' },
  { id: 'unstaged', label: 'Não preparados' },
  { id: 'untracked', label: 'Novos' },
  { id: 'session', label: 'Da sessão' },
];

const KIND_STATUS: Record<FileChangeKind, string> = {
  created: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

const STATUS_STYLES: Record<string, string> = {
  M: 'text-warning',
  A: 'text-success',
  D: 'text-danger',
  R: 'text-accent',
  C: 'text-accent',
  U: 'text-danger',
  '?': 'text-foreground-subtle',
};

function normalizeStatus(status: string): string {
  const trimmed = status.trim();
  if (!trimmed) return 'M';
  return trimmed[0].toUpperCase();
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

/** Merges git status and session journal into a unique, ordered row list. */
export function buildChangeRows(
  gitStatus: WorkspaceGitStatus | null | undefined,
  sessionChanges: FileChange[] | null | undefined,
): ChangeRow[] {
  const rows = new Map<string, ChangeRow>();

  const upsert = (row: ChangeRow) => {
    const existing = rows.get(row.path);
    if (!existing) {
      rows.set(row.path, row);
      return;
    }
    existing.origin = existing.origin === row.origin ? existing.origin : 'both';
    if (row.added !== undefined) existing.added = row.added;
    if (row.removed !== undefined) existing.removed = row.removed;
    if (row.knownDiff != null) existing.knownDiff = row.knownDiff;
  };

  for (const file of gitStatus?.staged ?? []) {
    upsert({
      path: file.path,
      status: normalizeStatus(file.status),
      group: 'staged',
      origin: 'git',
      staged: true,
    });
  }
  for (const file of gitStatus?.unstaged ?? []) {
    upsert({
      path: file.path,
      status: normalizeStatus(file.status),
      group: 'unstaged',
      origin: 'git',
      staged: false,
    });
  }
  for (const path of gitStatus?.untracked ?? []) {
    // Arquivo novo: mostra o badge A e o diff sintético sem precisar de staging.
    upsert({ path, status: 'A', group: 'untracked', origin: 'git', staged: false });
  }
  for (const path of gitStatus?.conflicted ?? []) {
    upsert({ path, status: 'U', group: 'unstaged', origin: 'git', staged: false });
  }

  for (const change of sessionChanges ?? []) {
    upsert({
      path: change.path,
      status: KIND_STATUS[change.kind] ?? 'M',
      group: 'session',
      origin: 'session',
      staged: false,
      added: change.added,
      removed: change.removed,
      knownDiff: change.diff ?? null,
    });
  }

  return [...rows.values()].sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));
}

/**
 * Changes tab of the Code panel (WORKBENCH §7.2/§15).
 *
 * Merges the git working tree (`gitStatus`) with the session journal
 * (`sessionChanges`), grouping by Preparados/Não preparados/Novos/Da sessão and
 * marking the origin (git × agente). Hover actions stage/unstage and revert
 * (with confirmation) through `@/lib/api`; clicking a row opens the unified
 * diff in place and the footer hosts the `CommitBar`.
 */
export function ChangesPanel({
  workspaceId,
  conversationId,
  gitStatus,
  gitLoading = false,
  gitError = null,
  sessionChanges,
  sessionLoading = false,
  sessionError = null,
  onRefresh,
  onOpenDiffTab = null,
  className,
}: ChangesPanelProps) {
  const rows = useMemo(() => buildChangeRows(gitStatus, sessionChanges), [gitStatus, sessionChanges]);
  const isRepo = gitStatus?.isRepo ?? false;
  const conflicted = (gitStatus?.conflicted.length ?? 0) > 0;

  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<ChangeRow | null>(null);
  const [reverting, setReverting] = useState(false);

  const [selected, setSelected] = useState<ChangeRow | null>(null);
  const [diffText, setDiffText] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const diffRun = useRef(0);

  const stagedPaths = useMemo(
    () => rows.filter((row) => row.group === 'staged').map((row) => row.path),
    [rows],
  );
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({ added: acc.added + (row.added ?? 0), removed: acc.removed + (row.removed ?? 0) }),
        { added: 0, removed: 0 },
      ),
    [rows],
  );

  useEffect(
    () => () => {
      diffRun.current += 1;
    },
    [],
  );

  const openRow = useCallback(
    async (row: ChangeRow) => {
      // Padrão: o diff abre como aba central (configurável nas Configurações).
      if (onOpenDiffTab) {
        onOpenDiffTab(row);
        return;
      }
      const run = diffRun.current + 1;
      diffRun.current = run;
      setSelected(row);
      setDiffError(null);
      if (row.knownDiff != null) {
        setDiffText(row.knownDiff);
        setDiffLoading(false);
        return;
      }
      if (!workspaceId) {
        setDiffText('');
        setDiffError('Abra um workspace para ver o diff.');
        return;
      }
      setDiffText('');
      setDiffLoading(true);
      try {
        const text = await api.getFileDiff(workspaceId, row.path, row.staged);
        if (run !== diffRun.current) return;
        setDiffText(text ?? '');
      } catch (error) {
        if (run !== diffRun.current) return;
        setDiffError(describeError(error, 'Não foi possível carregar o diff.'));
      } finally {
        if (run === diffRun.current) setDiffLoading(false);
      }
    },
    [workspaceId, onOpenDiffTab],
  );

  const closeDiff = () => {
    diffRun.current += 1;
    setSelected(null);
    setDiffText('');
    setDiffError(null);
    setDiffLoading(false);
  };

  const mutate = async (row: ChangeRow, action: 'stage' | 'unstage') => {
    if (!workspaceId || busyPath) return;
    setBusyPath(row.path);
    try {
      if (action === 'stage') await api.gitStage(workspaceId, [row.path]);
      else await api.gitUnstage(workspaceId, [row.path]);
      onRefresh?.();
    } catch (error) {
      toast.error(describeError(error, 'Não foi possível atualizar o stage'));
    } finally {
      setBusyPath(null);
    }
  };

  const confirmRevert = async () => {
    if (!confirmRow || !workspaceId) return;
    setReverting(true);
    try {
      if ((confirmRow.origin === 'session' || confirmRow.origin === 'both') && conversationId) {
        await api.revertFile(conversationId, confirmRow.path);
      } else {
        await api.gitDiscard(workspaceId, [confirmRow.path]);
      }
      toast.success('Arquivo revertido');
      if (selected?.path === confirmRow.path) closeDiff();
      setConfirmRow(null);
      onRefresh?.();
    } catch (error) {
      toast.error(describeError(error, 'Não foi possível reverter o arquivo'));
    } finally {
      setReverting(false);
    }
  };

  const loading = gitLoading || sessionLoading;
  const commitBar = (
    <CommitBar
      workspaceId={workspaceId}
      isRepo={isRepo}
      hasChanges={rows.length > 0}
      stagedPaths={stagedPaths}
      added={totals.added}
      removed={totals.removed}
      blockedReason={conflicted ? 'Resolva os conflitos de merge antes de commitar' : null}
      onRefresh={onRefresh}
    />
  );

  /* The detail view and the list share the same footer (CommitBar keeps its
     message/history state while a diff is open). No modo "aba" o detalhe inline
     não é usado: o diff abre no centro. */
  const detail = selected && !onOpenDiffTab ? (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-1.5">
        <IconButton label="Voltar para alterações" size="sm" onClick={closeDiff}>
          <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
        </IconButton>
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground-muted">Diff do arquivo</span>
      </div>
      <DiffView
        path={selected.path}
        diff={diffText}
        loading={diffLoading}
        error={diffError}
        className="min-h-0 flex-1"
      />
    </div>
  ) : null;

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {detail ?? (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {gitError ? (
          <div
            role="alert"
            className="flex items-start gap-2 border-b border-border bg-danger-soft px-3 py-2 text-[11.5px] text-danger"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            <span>{gitError}</span>
          </div>
        ) : null}

        {gitStatus && !gitStatus.isRepo ? (
          <div className="flex items-start gap-2 border-b border-border bg-surface px-3 py-2 text-[11.5px] text-foreground-muted">
            <GitBranch aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            <span>
              <span className="font-medium text-foreground">Não é um repositório Git.</span> As
              alterações da sessão continuam disponíveis; inicialize um repositório para commitar.
            </span>
          </div>
        ) : null}

        {conflicted ? (
          <div
            role="alert"
            className="flex items-start gap-2 border-b border-border bg-warning-soft px-3 py-2 text-[11.5px] text-warning"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            <span>Conflitos de merge — resolva antes de commitar.</span>
          </div>
        ) : null}

        {sessionError ? (
          <div
            role="alert"
            className="flex items-start gap-2 border-b border-border bg-danger-soft px-3 py-2 text-[11.5px] text-danger"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            <span>{sessionError}</span>
          </div>
        ) : null}

        {loading && rows.length === 0 ? (
          <div aria-hidden className="space-y-1.5 p-2">
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="h-6 animate-pulse rounded-md bg-surface-hover motion-reduce:animate-none"
                style={{ width: `${86 - row * 8}%` }}
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
            <FileDiff aria-hidden className="size-5 text-foreground-subtle" strokeWidth={1.75} />
            <p className="text-[12.5px] font-medium text-foreground">
              {workspaceId ? 'Nenhuma alteração pendente' : 'Nenhum workspace selecionado'}
            </p>
            <p className="max-w-64 text-[12px] leading-relaxed text-foreground-muted">
              {workspaceId
                ? 'As edições do agente e as mudanças do git aparecem aqui.'
                : 'Abra uma pasta para ver as alterações do código.'}
            </p>
          </div>
        ) : (
          <div>
            {GROUPS.map((group) => {
              const groupRows = rows.filter((row) => row.group === group.id);
              if (groupRows.length === 0) return null;
              return (
                <section key={group.id} aria-label={group.label} className="border-b border-border">
                  <h3 className="sticky top-0 z-10 flex h-7 items-center gap-1.5 bg-surface-raised px-3 text-[10.5px] font-medium uppercase tracking-wider text-foreground-subtle">
                    {group.label}
                    <span className="tabular-nums">({groupRows.length})</span>
                  </h3>
                  <ul>
                    {groupRows.map((row) => {
                      const badge = row.origin === 'both' ? 'sessão + git' : row.origin === 'session' ? 'sessão' : null;
                      return (
                        <li
                          key={`${group.id}-${row.path}`}
                          className="group flex h-7 items-center gap-1 pr-1 hover:bg-surface-hover"
                        >
                          <button
                            type="button"
                            onClick={() => void openRow(row)}
                            title={row.path}
                            className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pl-3 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                          >
                            <span
                              aria-hidden
                              className={cn(
                                'w-3 shrink-0 font-mono text-[11px] font-semibold',
                                STATUS_STYLES[row.status] ?? 'text-foreground-subtle',
                              )}
                            >
                              {row.status}
                            </span>
                            <FileIcon path={row.path} className="size-3.5" />
                            <span className="min-w-0 flex-1 truncate text-[12px] text-foreground-muted group-hover:text-foreground">
                              {row.path}
                            </span>
                            {badge ? (
                              <Badge
                                variant="accent"
                                size="sm"
                                title={`Origem: ${badge}`}
                                className="shrink-0"
                              >
                                {row.origin === 'both' ? 'agente + git' : 'agente'}
                              </Badge>
                            ) : null}
                            {row.added !== undefined || row.removed !== undefined ? (
                              <span className="shrink-0 text-[11px] tabular-nums">
                                <span className="text-success">+{row.added ?? 0}</span>{' '}
                                <span className="text-danger">−{row.removed ?? 0}</span>
                              </span>
                            ) : null}
                          </button>

                          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
                            {row.group === 'staged' ? (
                              <IconButton
                                label={`Remover ${row.path} do stage`}
                                size="sm"
                                disabled={busyPath === row.path}
                                onClick={() => void mutate(row, 'unstage')}
                              >
                                <Minus aria-hidden className="size-3.5" strokeWidth={2} />
                              </IconButton>
                            ) : (
                              <IconButton
                                label={`Preparar ${row.path}`}
                                size="sm"
                                disabled={busyPath === row.path || !isRepo}
                                onClick={() => void mutate(row, 'stage')}
                              >
                                <Plus aria-hidden className="size-3.5" strokeWidth={2} />
                              </IconButton>
                            )}
                            <IconButton
                              label={`Reverter ${row.path}`}
                              size="sm"
                              disabled={busyPath === row.path}
                              onClick={() => setConfirmRow(row)}
                            >
                              <Undo2 aria-hidden className="size-3.5" strokeWidth={1.75} />
                            </IconButton>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
      )}

      {commitBar}

      <Dialog
        open={confirmRow !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRow(null);
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Reverter arquivo?</DialogTitle>
          </DialogHeader>
          <DialogDescription className="px-6 pb-4">
            {confirmRow ? `As alterações em ${confirmRow.path} voltam ao estado anterior. ` : ''}
            Esta ação não pode ser desfeita.
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRow(null)}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" loading={reverting} onClick={() => void confirmRevert()}>
              Reverter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ChangesPanel;
