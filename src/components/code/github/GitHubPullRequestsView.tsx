/**
 * Pull requests tab: filterable, paginated list of the repository PRs.
 *
 * Basic controls live in the `Git` dropdown of the Changes panel; the list is
 * the entry point to each pull request tab (`openCodePullRequest`).
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GitPullRequest,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  NativeSelect,
  SegmentedControl,
  Switch,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import {
  useGitHubStore,
  gitHubListKey,
  useUiStore,
  describeGitHubError,
  type CodePullRequestsTab,
} from '@/lib/store';
import type { GitHubItemState, GitHubPullRequestFilter, WorkspaceGitBranches } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  GitHubConnectDialog,
  GitHubEmptyState,
  GitHubErrorState,
  GitHubLabelChips,
  GitHubLoading,
  PullRequestStatusBadge,
  formatGitHubDate,
  useDebouncedValue,
} from './GitHubShared';

export interface GitHubPullRequestsViewProps {
  tab: CodePullRequestsTab;
  className?: string;
}

export function GitHubPullRequestsView({ tab, className }: GitHubPullRequestsViewProps) {
  const { t } = useTranslation('code');
  const workspaceId = tab.workspaceId;
  const connection = useGitHubStore((state) => state.connections[workspaceId]);
  const account = useGitHubStore((state) => state.account);
  const loadConnection = useGitHubStore((state) => state.loadConnection);
  const loadPullRequests = useGitHubStore((state) => state.loadPullRequests);
  const invalidateLists = useGitHubStore((state) => state.invalidateLists);
  const openPullRequest = useUiStore((state) => state.openCodePullRequest);

  const [stateFilter, setStateFilter] = useState<GitHubItemState>('open');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 350);
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const filter = useMemo<GitHubPullRequestFilter>(
    () => ({
      state: stateFilter,
      search: search.trim() ? search.trim() : undefined,
      author: mine ? '@me' : undefined,
      page,
      perPage: 30,
    }),
    [stateFilter, search, mine, page],
  );
  const listKey = gitHubListKey(workspaceId, filter);
  const list = useGitHubStore((state) => state.pullRequests[listKey]);

  const ready = Boolean(connection?.data?.repo) && !connection?.data?.message;
  const connectionLoading = Boolean(connection?.loading) && !connection?.data;
  const connectionMessage = connection?.error ?? connection?.data?.message ?? null;
  const needsConnect = Boolean(connection?.data) && !connection.data?.account.authenticated;
  const connectionRetry =
    connection?.error || connection?.data?.account.authenticated
      ? () => void loadConnection(workspaceId, { refresh: true })
      : () => setConnectOpen(true);

  useEffect(() => {
    void loadConnection(workspaceId);
  }, [loadConnection, workspaceId]);

  useEffect(() => {
    if (!ready) return;
    void loadPullRequests(workspaceId, filter);
    // `filter` is encoded in `listKey`; the key is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPullRequests, workspaceId, listKey, ready]);

  const login = connection?.data?.account.login ?? account.data?.login ?? null;
  const repo = connection?.data?.repo ?? null;
  const items = list?.data?.items ?? [];
  const awaitingList = !connection || connectionLoading || (ready && !list);

  return (
    <section
      className={cn('flex min-h-0 flex-1 flex-col', className)}
      aria-label={t('code:github.prs.title')}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <GitPullRequest aria-hidden className="size-4 shrink-0 text-foreground-muted" strokeWidth={1.75} />
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-[12px] font-medium text-foreground">
            {t('code:github.prs.title')}
          </p>
          <p className="truncate text-[11px] text-foreground-subtle">
            {repo ? repo.fullName : t('code:github.repoUnknown')}
            {login ? ` · ${login}` : ''}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton
            label={t('code:github.refresh')}
            size="sm"
            variant="ghost"
            loading={list?.loading ?? false}
            onClick={() => void loadPullRequests(workspaceId, filter, { refresh: true })}
          >
            <RefreshCw aria-hidden className="size-4" strokeWidth={1.75} />
          </IconButton>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Plus aria-hidden className="size-3.5" strokeWidth={2} />}
            disabled={!ready}
            onClick={() => setCreateOpen(true)}
          >
            {t('code:github.prs.new')}
          </Button>
        </div>
      </header>

      {connectionMessage || needsConnect ? (
        <div className="shrink-0 border-b border-border px-3 py-2">
          <GitHubErrorState
            message={connectionMessage ?? t('code:github.connect.requiredDescription')}
            onRetry={connectionRetry}
          />
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <SegmentedControl
          size="sm"
          ariaLabel={t('code:github.filters.state')}
          value={stateFilter}
          onChange={(value) => {
            setPage(1);
            setStateFilter(value as GitHubItemState);
          }}
          options={[
            { value: 'open', label: t('code:github.filters.open') },
            { value: 'closed', label: t('code:github.filters.closed') },
            { value: 'all', label: t('code:github.filters.all') },
          ]}
        />
        <div className="relative min-w-40 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-foreground-subtle"
            strokeWidth={1.75}
          />
          <Input
            value={searchInput}
            className="h-7 pl-7 text-[12px]"
            placeholder={t('code:github.filters.searchPlaceholder')}
            aria-label={t('code:github.filters.searchPlaceholder')}
            onChange={(event) => {
              setPage(1);
              setSearchInput(event.target.value);
            }}
          />
        </div>
        <Button
          size="sm"
          variant={mine ? 'primary' : 'ghost'}
          className="h-7 px-2 text-[11px]"
          leftIcon={<UserRound aria-hidden className="size-3.5" strokeWidth={1.75} />}
          aria-pressed={mine}
          onClick={() => {
            setPage(1);
            setMine((value) => !value);
          }}
        >
          {t('code:github.filters.mine')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {awaitingList || (list?.loading && !list.data) ? (
          <GitHubLoading label={t('code:github.loading')} />
        ) : list?.error ? (
          <div className="p-3">
            <GitHubErrorState
              message={list.error}
              onRetry={() => void loadPullRequests(workspaceId, filter, { refresh: true })}
            />
          </div>
        ) : items.length === 0 ? (
          <GitHubEmptyState
            icon="merge"
            title={t('code:github.prs.emptyTitle')}
            description={t('code:github.prs.emptyDescription')}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((pr) => (
              <li key={pr.number}>
                <button
                  type="button"
                  onClick={() =>
                    openPullRequest({ workspaceId, number: pr.number, title: pr.title })
                  }
                  className={cn(
                    'flex w-full min-w-0 flex-col gap-1 px-3 py-2.5 text-left transition-colors',
                    'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <PullRequestStatusBadge pr={pr} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                      {pr.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-foreground-subtle">#{pr.number}</span>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-foreground-muted">
                    <span className="truncate">{pr.author.login}</span>
                    {pr.headRef ? (
                      <span className="truncate font-mono text-[10px] text-foreground-subtle">
                        {pr.headRef} → {pr.baseRef}
                      </span>
                    ) : null}
                    {pr.changedFiles > 0 ? (
                      <span className="shrink-0">
                        <span className="text-success">+{pr.additions}</span>{' '}
                        <span className="text-danger">−{pr.deletions}</span>
                      </span>
                    ) : null}
                    {pr.comments > 0 ? (
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <MessageSquare aria-hidden className="size-3" strokeWidth={1.75} />
                        {pr.comments}
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-foreground-subtle">
                      {formatGitHubDate(pr.updatedAt)}
                    </span>
                  </span>
                  <GitHubLabelChips labels={pr.labels} max={4} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-[11px] text-foreground-muted">
        <span>{t('code:github.pagination.page', { page })}</span>
        <span className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            disabled={page <= 1 || (list?.loading ?? false)}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            {t('code:github.pagination.previous')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            disabled={!list?.data?.hasNext || (list?.loading ?? false)}
            onClick={() => setPage((value) => value + 1)}
          >
            {t('code:github.pagination.next')}
          </Button>
        </span>
      </footer>

      <GitHubConnectDialog
        open={connectOpen}
        workspaceId={workspaceId}
        onOpenChange={(open) => {
          setConnectOpen(open);
          if (!open) void loadConnection(workspaceId, { refresh: true });
        }}
      />
      <GitHubNewPullRequestDialog
        open={createOpen}
        workspaceId={workspaceId}
        onOpenChange={setCreateOpen}
        onCreated={(number, title) => {
          invalidateLists(workspaceId);
          void loadPullRequests(workspaceId, filter, { refresh: true });
          openPullRequest({ workspaceId, number, title });
        }}
      />
    </section>
  );
}

export interface GitHubNewPullRequestDialogProps {
  open: boolean;
  workspaceId: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (number: number, title: string) => void;
}

/** Create flow: head from the local branches, base from the repository ones. */
export function GitHubNewPullRequestDialog({
  open,
  workspaceId,
  onOpenChange,
  onCreated,
}: GitHubNewPullRequestDialogProps) {
  const { t } = useTranslation('code');
  const meta = useGitHubStore((state) => state.metas[workspaceId]);
  const loadMeta = useGitHubStore((state) => state.loadMeta);
  const loadConnection = useGitHubStore((state) => state.loadConnection);
  const repo = useGitHubStore((state) => state.connections[workspaceId]?.data?.repo ?? null);
  const connectionPending = useGitHubStore(
    (state) => !state.connections[workspaceId] || state.connections[workspaceId].loading,
  );
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [head, setHead] = useState('');
  const [base, setBase] = useState('');
  const [local, setLocal] = useState<WorkspaceGitBranches | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const invalidateLists = useGitHubStore((state) => state.invalidateLists);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLocalError(null);
    void loadConnection(workspaceId);
    void loadMeta(workspaceId);
    let cancelled = false;
    api
      .gitBranches(workspaceId)
      .then((branches) => {
        if (cancelled) return;
        setLocal(branches);
        setHead(branches.current ?? branches.branches[0] ?? '');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLocal(null);
        setLocalError(describeGitHubError(cause, t('code:github.actionError')));
      });
    return () => {
      cancelled = true;
    };
  }, [loadConnection, loadMeta, open, workspaceId]);

  useEffect(() => {
    if (!open || connectionPending) return;
    const branches = meta?.data?.branches ?? [];
    const fallback = repo?.defaultBranch ?? branches[0] ?? '';
    setBase((current) => current || fallback);
  }, [connectionPending, open, meta?.data?.branches, repo?.defaultBranch]);

  const submit = async () => {
    if (busy) return;
    if (!title.trim() || !head || !base) {
      setError(t('code:github.newPr.missing'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.githubCreatePullRequest(workspaceId, {
        title: title.trim(),
        body: body.trim() ? body : null,
        head,
        base,
        draft,
      });
      toast.success(t('code:github.newPr.success', { number: created.number }));
      invalidateLists(workspaceId);
      setTitle('');
      setBody('');
      setDraft(false);
      onOpenChange(false);
      onCreated(created.number, created.title);
    } catch (cause) {
      const message = describeGitHubError(cause, t('code:github.newPr.error'));
      setError(message);
      toast.error(t('code:github.newPr.error'), { description: message });
    } finally {
      setBusy(false);
    }
  };

  const headOptions = local?.branches ?? [];
  const baseOptions = meta?.data?.branches ?? [];
  const visibleBaseOptions =
    base && !baseOptions.includes(base) ? [base, ...baseOptions] : baseOptions;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('code:github.newPr.title')}</DialogTitle>
          <DialogDescription>{t('code:github.newPr.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-6 pb-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[12px] font-medium text-foreground-muted">
              {t('code:github.newPr.head')}
              <NativeSelect
                value={head}
                aria-label={t('code:github.newPr.head')}
                onChange={(event) => setHead(event.target.value)}
              >
                {headOptions.length === 0 ? <option value="">—</option> : null}
                {headOptions.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-foreground-muted">
              {t('code:github.newPr.base')}
              <NativeSelect
                value={base}
                aria-label={t('code:github.newPr.base')}
                onChange={(event) => setBase(event.target.value)}
              >
                {visibleBaseOptions.length === 0 ? <option value="">—</option> : null}
                {visibleBaseOptions.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-foreground-muted">
            {t('code:github.newPr.fieldTitle')}
            <Input
              value={title}
              maxLength={256}
              aria-label={t('code:github.newPr.fieldTitle')}
              placeholder={t('code:github.newPr.titlePlaceholder')}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-foreground-muted">
            {t('code:github.newPr.body')}
            <Textarea
              value={body}
              rows={8}
              aria-label={t('code:github.newPr.body')}
              placeholder={t('code:github.newPr.bodyPlaceholder')}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-[12px] text-foreground-muted">
            {t('code:github.newPr.draft')}
            <Switch
              checked={draft}
              onCheckedChange={setDraft}
              aria-label={t('code:github.newPr.draft')}
            />
          </label>
          {error ? (
            <p role="alert" className="text-[12px] leading-relaxed text-danger">
              {error}
            </p>
          ) : null}
          {meta?.error || localError ? (
            <p role="alert" className="text-[12px] leading-relaxed text-danger">
              {meta?.error ?? localError}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('code:github.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!title.trim() || !head || !base}
            onClick={() => void submit()}
          >
            {t('code:github.newPr.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GitHubPullRequestsView;
