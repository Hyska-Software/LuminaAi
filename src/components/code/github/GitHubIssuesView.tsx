/**
 * Issues tab: filterable, paginated list of the repository issues.
 *
 * Each row opens its own center tab (`openCodeIssue`), mirroring the file and
 * pull request tabs.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDot, MessageSquare, Plus, RefreshCw, Search, UserRound } from 'lucide-react';
import { toast } from 'sonner';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  NativeSelect,
  SegmentedControl,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import {
  describeGitHubError,
  gitHubListKey,
  useGitHubStore,
  useUiStore,
  type CodeIssuesTab,
} from '@/lib/store';
import type { GitHubIssueFilter, GitHubIssueSummary, GitHubItemState } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  GitHubConnectDialog,
  GitHubEmptyState,
  GitHubErrorState,
  GitHubLabelChips,
  GitHubLoading,
  IssueStatusBadge,
  formatGitHubDate,
  useDebouncedValue,
} from './GitHubShared';

export interface GitHubIssuesViewProps {
  tab: CodeIssuesTab;
  className?: string;
}

export function GitHubIssuesView({ tab, className }: GitHubIssuesViewProps) {
  const { t } = useTranslation('code');
  const workspaceId = tab.workspaceId;
  const connection = useGitHubStore((state) => state.connections[workspaceId]);
  const account = useGitHubStore((state) => state.account);
  const meta = useGitHubStore((state) => state.metas[workspaceId]?.data ?? null);
  const loadConnection = useGitHubStore((state) => state.loadConnection);
  const loadIssues = useGitHubStore((state) => state.loadIssues);
  const loadMeta = useGitHubStore((state) => state.loadMeta);
  const invalidateLists = useGitHubStore((state) => state.invalidateLists);
  const openIssue = useUiStore((state) => state.openCodeIssue);

  const [stateFilter, setStateFilter] = useState<GitHubItemState>('open');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 350);
  const [mine, setMine] = useState(false);
  const [label, setLabel] = useState('');
  const [milestone, setMilestone] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const labels = meta?.labels ?? [];
  const milestones = meta?.milestones ?? [];

  const filter = useMemo<GitHubIssueFilter>(
    () => ({
      state: stateFilter,
      search: search.trim() ? search.trim() : undefined,
      author: mine ? '@me' : undefined,
      label: label || undefined,
      milestone: milestone || undefined,
      milestoneTitle: milestone
        ? milestones.find((entry) => String(entry.number) === milestone)?.title
        : undefined,
      page,
      perPage: 30,
    }),
    [stateFilter, search, mine, label, milestone, milestones, page],
  );
  const listKey = gitHubListKey(workspaceId, filter);
  const list = useGitHubStore((state) => state.issues[listKey]);

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
    void loadMeta(workspaceId);
  }, [loadMeta, ready, workspaceId]);

  useEffect(() => {
    if (!ready) return;
    void loadIssues(workspaceId, filter);
    // `filter` is encoded in `listKey`; the key is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadIssues, workspaceId, listKey, ready]);

  const items = list?.data?.items ?? [];
  const repo = connection?.data?.repo ?? null;
  const login = connection?.data?.account.login ?? account.data?.login ?? null;
  const awaitingList = !connection || connectionLoading || (ready && !list);

  return (
    <section
      className={cn('flex min-h-0 flex-1 flex-col', className)}
      aria-label={t('code:github.issues.title')}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <CircleDot aria-hidden className="size-4 shrink-0 text-foreground-muted" strokeWidth={1.75} />
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-[12px] font-medium text-foreground">
            {t('code:github.issues.title')}
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
            onClick={() => void loadIssues(workspaceId, filter, { refresh: true })}
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
            {t('code:github.issues.new')}
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
        <div className="relative min-w-36 flex-1">
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 max-w-40 px-2 text-[11px]">
              {label || t('code:github.filters.label')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 min-w-52 overflow-y-auto">
            <DropdownMenuLabel>{t('code:github.filters.label')}</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => {
                setPage(1);
                setLabel('');
              }}
            >
              {t('code:github.filters.anyLabel')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {labels.map((entry) => (
              <DropdownMenuCheckboxItem
                key={entry.name}
                checked={label === entry.name}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => {
                  setPage(1);
                  setLabel((current) => (current === entry.name ? '' : entry.name));
                }}
              >
                {entry.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <NativeSelect
          value={milestone}
          className="h-7 max-w-40 text-[11px]"
          aria-label={t('code:github.filters.milestone')}
          onChange={(event) => {
            setPage(1);
            setMilestone(event.target.value);
          }}
        >
          <option value="">{t('code:github.filters.anyMilestone')}</option>
          {milestones.map((entry) => (
            <option key={entry.number} value={String(entry.number)}>
              {entry.title}
            </option>
          ))}
        </NativeSelect>
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
              onRetry={() => void loadIssues(workspaceId, filter, { refresh: true })}
            />
          </div>
        ) : items.length === 0 ? (
          <GitHubEmptyState
            icon="issue"
            title={t('code:github.issues.emptyTitle')}
            description={t('code:github.issues.emptyDescription')}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((issue) => (
              <li key={issue.number}>
                <button
                  type="button"
                  onClick={() => openIssue({ workspaceId, number: issue.number, title: issue.title })}
                  className={cn(
                    'flex w-full min-w-0 flex-col gap-1 px-3 py-2.5 text-left transition-colors',
                    'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <IssueStatusBadge issue={issue} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                      {issue.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-foreground-subtle">
                      #{issue.number}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-foreground-muted">
                    <span className="truncate">{issue.author.login}</span>
                    {issue.assignees.length ? (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <UserRound aria-hidden className="size-3" strokeWidth={1.75} />
                        <span className="truncate">
                          {issue.assignees.map((user) => user.login).join(', ')}
                        </span>
                      </span>
                    ) : null}
                    {issue.milestone ? <span className="truncate">{issue.milestone}</span> : null}
                    {issue.comments > 0 ? (
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <MessageSquare aria-hidden className="size-3" strokeWidth={1.75} />
                        {issue.comments}
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-foreground-subtle">
                      {formatGitHubDate(issue.updatedAt)}
                    </span>
                  </span>
                  <GitHubLabelChips labels={issue.labels} max={4} />
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
      <GitHubNewIssueDialog
        open={createOpen}
        workspaceId={workspaceId}
        labels={labels.map((entry) => entry.name)}
        assignees={(meta?.users ?? []).map((user) => user.login)}
        onOpenChange={setCreateOpen}
        onCreated={(number, title) => {
          invalidateLists(workspaceId);
          void loadIssues(workspaceId, filter, { refresh: true });
          openIssue({ workspaceId, number, title });
        }}
      />
    </section>
  );
}

export interface GitHubNewIssueDialogProps {
  open: boolean;
  workspaceId: string;
  labels: string[];
  assignees: string[];
  onOpenChange: (open: boolean) => void;
  onCreated: (number: number, title: string) => void;
}

/** Create flow: title, Markdown body, labels and assignees. */
export function GitHubNewIssueDialog({
  open,
  workspaceId,
  labels,
  assignees,
  onOpenChange,
  onCreated,
}: GitHubNewIssueDialogProps) {
  const { t } = useTranslation('code');
  const invalidateLists = useGitHubStore((state) => state.invalidateLists);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  const submit = async () => {
    if (busy || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.githubCreateIssue(workspaceId, {
        title: title.trim(),
        body: body.trim() ? body : null,
        labels: selectedLabels,
        assignees: selectedAssignees,
      });
      toast.success(t('code:github.newIssue.success', { number: created.number }));
      invalidateLists(workspaceId);
      setTitle('');
      setBody('');
      setSelectedLabels([]);
      setSelectedAssignees([]);
      onOpenChange(false);
      onCreated(created.number, created.title);
    } catch (cause) {
      const message = describeGitHubError(cause, t('code:github.newIssue.error'));
      setError(message);
      toast.error(t('code:github.newIssue.error'), { description: message });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('code:github.newIssue.title')}</DialogTitle>
          <DialogDescription>{t('code:github.newIssue.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-6 pb-4">
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
            {t('code:github.newIssue.body')}
            <Textarea
              value={body}
              rows={8}
              aria-label={t('code:github.newIssue.body')}
              placeholder={t('code:github.newIssue.bodyPlaceholder')}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]">
                  {selectedLabels.length
                    ? t('code:github.newIssue.labelsCount', { count: selectedLabels.length })
                    : t('code:github.newIssue.labels')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 min-w-52 overflow-y-auto">
                <DropdownMenuLabel>{t('code:github.newIssue.labels')}</DropdownMenuLabel>
                {labels.length === 0 ? (
                  <DropdownMenuItem disabled>{t('code:github.emptyOptions')}</DropdownMenuItem>
                ) : (
                  labels.map((entry) => (
                    <DropdownMenuCheckboxItem
                      key={entry}
                      checked={selectedLabels.includes(entry)}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={() => setSelectedLabels((list) => toggle(list, entry))}
                    >
                      {entry}
                    </DropdownMenuCheckboxItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]">
                  {selectedAssignees.length
                    ? t('code:github.newIssue.assigneesCount', { count: selectedAssignees.length })
                    : t('code:github.newIssue.assignees')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 min-w-52 overflow-y-auto">
                <DropdownMenuLabel>{t('code:github.newIssue.assignees')}</DropdownMenuLabel>
                {assignees.length === 0 ? (
                  <DropdownMenuItem disabled>{t('code:github.emptyOptions')}</DropdownMenuItem>
                ) : (
                  assignees.map((entry) => (
                    <DropdownMenuCheckboxItem
                      key={entry}
                      checked={selectedAssignees.includes(entry)}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={() => setSelectedAssignees((list) => toggle(list, entry))}
                    >
                      {entry}
                    </DropdownMenuCheckboxItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {error ? (
            <p role="alert" className="text-[12px] leading-relaxed text-danger">
              {error}
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
            disabled={!title.trim()}
            onClick={() => void submit()}
          >
            {t('code:github.newIssue.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GitHubIssuesView;
