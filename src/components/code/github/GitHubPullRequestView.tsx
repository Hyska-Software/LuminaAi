/**
 * Pull request tab: header + actions, body, conversation, changed files,
 * commits, checks and the merge box.
 *
 * Every action is an explicit user gesture and reloads the cached detail after
 * the API call. Errors come localized from the backend (see `github.errors.*`).
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDot,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Markdown } from '@/components/chat/Markdown';
import { openExternalUrl } from '@/components/chat/external';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  NativeSelect,
  SegmentedControl,
  Switch,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import {
  describeGitHubError,
  gitHubItemKey,
  useGitHubStore,
  type CodePullRequestTab,
} from '@/lib/store';
import type {
  GitHubChecksSummary,
  GitHubMergeMethod,
  GitHubPullRequestDetail,
  GitHubPullRequestFile,
  GitHubReview,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { DiffView } from '../DiffView';
import {
  GitHubComments,
  GitHubEmptyState,
  GitHubErrorState,
  GitHubLabelChips,
  GitHubLoading,
  GitHubMultiPicker,
  PullRequestStatusBadge,
  formatGitHubDate,
} from './GitHubShared';

type PrSection = 'conversation' | 'files' | 'commits' | 'checks';

export interface GitHubPullRequestViewProps {
  tab: CodePullRequestTab;
  className?: string;
}

export function GitHubPullRequestView({ tab, className }: GitHubPullRequestViewProps) {
  const { t } = useTranslation('code');
  const workspaceId = tab.workspaceId;
  const itemKey = gitHubItemKey(workspaceId, tab.number);
  const detailState = useGitHubStore((state) => state.pullRequestDetails[itemKey]);
  const filesState = useGitHubStore((state) => state.pullRequestFiles[itemKey]);
  const commitsState = useGitHubStore((state) => state.pullRequestCommits[itemKey]);
  const metaState = useGitHubStore((state) => state.metas[workspaceId]);
  const login = useGitHubStore(
    (state) => state.connections[workspaceId]?.data?.account.login ?? state.account.data?.login ?? null,
  );
  const graphqlAvailable = useGitHubStore(
    (state) => state.connections[workspaceId]?.data?.repo?.graphql ?? false,
  );
  const loadPullRequest = useGitHubStore((state) => state.loadPullRequest);
  const loadFiles = useGitHubStore((state) => state.loadPullRequestFiles);
  const loadCommits = useGitHubStore((state) => state.loadPullRequestCommits);
  const loadMeta = useGitHubStore((state) => state.loadMeta);
  const loadConnection = useGitHubStore((state) => state.loadConnection);
  const invalidateLists = useGitHubStore((state) => state.invalidateLists);
  const cacheEpoch = useGitHubStore((state) => state.cacheEpoch);

  const [section, setSection] = useState<PrSection>('conversation');
  const [busy, setBusy] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [method, setMethod] = useState<GitHubMergeMethod>('merge');
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [mergeTitle, setMergeTitle] = useState('');
  const [mergeMessage, setMergeMessage] = useState('');

  const detail = detailState?.data ?? null;

  useEffect(() => {
    void loadConnection(workspaceId);
  }, [loadConnection, workspaceId]);

  useEffect(() => {
    void loadPullRequest(workspaceId, tab.number);
    void loadMeta(workspaceId);
  }, [cacheEpoch, loadMeta, loadPullRequest, tab.number, workspaceId]);

  useEffect(() => {
    if (section === 'files') void loadFiles(workspaceId, tab.number);
    if (section === 'commits') void loadCommits(workspaceId, tab.number);
  }, [cacheEpoch, loadCommits, loadFiles, section, tab.number, workspaceId]);

  const refresh = async () => {
    await loadPullRequest(workspaceId, tab.number, { refresh: true });
    if (filesState?.data) await loadFiles(workspaceId, tab.number, { refresh: true });
    if (commitsState?.data) await loadCommits(workspaceId, tab.number, { refresh: true });
  };

  const run = async (key: string, action: () => Promise<unknown>, success?: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      invalidateLists(workspaceId);
      if (success) toast.success(success);
      await refresh();
    } catch (error) {
      toast.error(describeGitHubError(error, t('code:github.actionError')));
    } finally {
      setBusy(null);
    }
  };

  const meta = metaState?.data ?? null;
  const labelOptions = useMemo(
    () => (meta?.labels ?? []).map((label) => ({ value: label.name, label: label.name })),
    [meta?.labels],
  );
  const userOptions = useMemo(
    () => (meta?.users ?? []).map((user) => ({ value: user.login, label: user.login })),
    [meta?.users],
  );

  if (!detailState || (detailState.loading && !detail)) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
        <GitHubLoading label={t('code:github.loading')} />
      </div>
    );
  }

  if (detailState?.error && !detail) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col p-3', className)}>
        <GitHubErrorState
          message={detailState.error}
          onRetry={() => void loadPullRequest(workspaceId, tab.number, { refresh: true })}
        />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
        <GitHubEmptyState icon="merge" title={t('code:github.pr.notFound')} />
      </div>
    );
  }

  const pr = detail.summary;
  const isOpen = pr.state === 'open' && !pr.merged;
  const canMerge = isOpen && detail.mergeable !== false && !pr.draft;

  return (
    <section
      className={cn('flex min-h-0 flex-1 flex-col', className)}
      aria-label={t('code:github.pr.aria', { number: pr.number })}
    >
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <PullRequestStatusBadge pr={pr} />
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
            {pr.title} <span className="font-normal text-foreground-subtle">#{pr.number}</span>
          </h2>
          <IconButton
            label={t('code:github.refresh')}
            size="sm"
            variant="ghost"
            loading={busy === 'refresh'}
            onClick={() => void run('refresh', () => Promise.resolve(), undefined)}
          >
            <RefreshCw aria-hidden className="size-4" strokeWidth={1.75} />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={t('code:github.actions')} size="sm" variant="ghost">
                <MoreHorizontal aria-hidden className="size-4" strokeWidth={1.75} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel>{t('code:github.actions')}</DropdownMenuLabel>
              <DropdownMenuItem
                icon={<ExternalLink aria-hidden className="size-4" strokeWidth={1.75} />}
                onSelect={() => void openExternalUrl(pr.htmlUrl)}
              >
                {t('code:github.openOnGitHub')}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<GitBranch aria-hidden className="size-4" strokeWidth={1.75} />}
                disabled={!pr.headRef || busy !== null}
                onSelect={() =>
                  void run(
                    'checkout',
                    async () => {
                      const branch = await api.githubCheckoutPullRequest(workspaceId, pr.number);
                      toast.success(t('code:github.pr.checkoutSuccess', { branch }));
                    },
                  )
                }
              >
                {t('code:github.pr.checkout')}
              </DropdownMenuItem>
              {pr.draft && detail.nodeId && graphqlAvailable ? (
                <DropdownMenuItem
                  icon={<ShieldCheck aria-hidden className="size-4" strokeWidth={1.75} />}
                  disabled={busy !== null}
                  onSelect={() =>
                    void run(
                      'ready',
                      () => api.githubMarkPullRequestReady(workspaceId, detail.nodeId ?? ''),
                      t('code:github.pr.readySuccess'),
                    )
                  }
                >
                  {t('code:github.pr.ready')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={<Pencil aria-hidden className="size-4" strokeWidth={1.75} />}
                onSelect={() => setEditOpen(true)}
              >
                {t('code:github.pr.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={
                  isOpen ? (
                    <XCircle aria-hidden className="size-4" strokeWidth={1.75} />
                  ) : (
                    <CircleDot aria-hidden className="size-4" strokeWidth={1.75} />
                  )
                }
                disabled={busy !== null || pr.merged}
                onSelect={() =>
                  void run(
                    'state',
                    () =>
                      api.githubUpdatePullRequest(workspaceId, pr.number, {
                        stateValue: isOpen ? 'closed' : 'open',
                      }),
                    isOpen ? t('code:github.pr.closed') : t('code:github.pr.reopened'),
                  )
                }
              >
                {isOpen ? t('code:github.pr.closeAction') : t('code:github.pr.reopenAction')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-foreground-muted">
          <span className="inline-flex items-center gap-1">
            <GitPullRequest aria-hidden className="size-3.5" strokeWidth={1.75} />
            {pr.author.login}
          </span>
          {pr.headRef ? (
            <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[10px] text-foreground-subtle">
              <span className="truncate">{pr.headRef}</span>
              <ArrowLeftRight aria-hidden className="size-3 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{pr.baseRef}</span>
            </span>
          ) : null}
          <ChecksBadge checks={detail.checks} />
          {pr.changedFiles > 0 ? (
            <span>
              <span className="text-success">+{pr.additions}</span>{' '}
              <span className="text-danger">−{pr.deletions}</span> ·{' '}
              {t('code:github.pr.fileCount', { count: pr.changedFiles })}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-foreground-subtle">
            {formatGitHubDate(pr.updatedAt)}
          </span>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <GitHubLabelChips labels={pr.labels} max={6} />
          <GitHubMultiPicker
            label={t('code:github.pr.labels')}
            emptyLabel={t('code:github.pr.clearLabels')}
            options={labelOptions}
            selected={pr.labels.map((label) => label.name)}
            disabled={busy !== null || !isOpen}
            onApply={(values) =>
              run(
                'labels',
                () => api.githubSetLabels(workspaceId, pr.number, values),
                t('code:github.pr.saved'),
              )
            }
          />
          <GitHubMultiPicker
            label={t('code:github.pr.assignees')}
            emptyLabel={t('code:github.pr.clearAssignees')}
            options={userOptions}
            selected={detail.assignees.map((user) => user.login)}
            disabled={busy !== null || !isOpen}
            onApply={(values) =>
              run(
                'assignees',
                () => api.githubSetAssignees(workspaceId, pr.number, values),
                t('code:github.pr.saved'),
              )
            }
          />
          <GitHubMultiPicker
            label={t('code:github.pr.reviewers')}
            emptyLabel={t('code:github.pr.clearReviewers')}
            options={userOptions.filter((option) => option.value !== pr.author.login)}
            selected={detail.requestedReviewers.map((user) => user.login)}
            disabled={busy !== null || !isOpen}
            onApply={(values) =>
              run(
                'reviewers',
                () => api.githubRequestReviewers(workspaceId, pr.number, values),
                t('code:github.pr.saved'),
              )
            }
          />
          {detail.milestone ? (
            <Badge tone="outline">{detail.milestone.title}</Badge>
          ) : null}
        </div>
      </header>

      <nav className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
        <SegmentedControl
          size="sm"
          ariaLabel={t('code:github.pr.sections')}
          value={section}
          onChange={(value) => setSection(value as PrSection)}
          options={[
            { value: 'conversation', label: t('code:github.pr.tabs.conversation') },
            { value: 'files', label: t('code:github.pr.tabs.files') },
            { value: 'commits', label: t('code:github.pr.tabs.commits') },
            { value: 'checks', label: t('code:github.pr.tabs.checks') },
          ]}
        />
        {isOpen ? (
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto h-7 px-2 text-[11px]"
            leftIcon={<ShieldCheck aria-hidden className="size-3.5" strokeWidth={1.75} />}
            disabled={busy !== null}
            onClick={() => setReviewOpen(true)}
          >
            {t('code:github.pr.review')}
          </Button>
        ) : null}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {section === 'conversation' ? (
          <div className="flex flex-col gap-4">
            {detail.body.trim() ? (
              <Markdown content={detail.body} className="text-[13px]" />
            ) : (
              <p className="text-[12px] text-foreground-subtle">{t('code:github.pr.noBody')}</p>
            )}

            {canMerge ? (
              <MergeBox
                title={mergeTitle}
                message={mergeMessage}
                method={method}
                deleteBranch={deleteBranch}
                busy={busy === 'merge'}
                onTitle={setMergeTitle}
                onMessage={setMergeMessage}
                onMethod={setMethod}
                onDeleteBranch={setDeleteBranch}
                onMerge={() =>
                  void run(
                    'merge',
                    () =>
                      api.githubMergePullRequest(workspaceId, pr.number, {
                        method,
                        commitTitle: mergeTitle.trim() || null,
                        commitMessage: mergeMessage.trim() || null,
                        sha: pr.headSha || null,
                        deleteBranch,
                      }),
                    t('code:github.pr.merge.success'),
                  )
                }
              />
            ) : isOpen && detail.mergeable === false ? (
              <p className="inline-flex items-center gap-1.5 text-[12px] text-warning">
                <CircleAlert aria-hidden className="size-4" strokeWidth={1.75} />
                {detail.mergeableState === 'dirty'
                  ? t('code:github.pr.merge.conflicts')
                  : t('code:github.pr.merge.notMergeable')}
              </p>
            ) : null}

            {detail.reviews.length ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
                  {t('code:github.pr.reviewsTitle')}
                </p>
                <ul className="flex flex-col gap-1">
                  {detail.reviews.map((review) => (
                    <li key={review.id} className="flex min-w-0 flex-wrap items-center gap-2">
                      <ReviewBadge review={review} />
                      <span className="text-[11px] text-foreground-muted">{review.author.login}</span>
                      <span className="text-[11px] text-foreground-subtle">
                        {formatGitHubDate(review.submittedAt)}
                      </span>
                      {review.body.trim() ? (
                        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground-muted">
                          {review.body}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <GitHubComments
              comments={detail.comments}
              currentLogin={login}
              emptyTitle={t('code:github.comments.empty')}
              onSubmit={async (body) => {
                try {
                  await api.githubAddComment(workspaceId, pr.number, body);
                  invalidateLists(workspaceId);
                  await refresh();
                } catch (error) {
                  toast.error(describeGitHubError(error, t('code:github.comments.error')));
                  throw error;
                }
              }}
              onUpdate={async (commentId, body) => {
                try {
                  await api.githubUpdateComment(workspaceId, commentId, body);
                  toast.success(t('code:github.comments.updated'));
                  await refresh();
                } catch (error) {
                  toast.error(describeGitHubError(error, t('code:github.comments.error')));
                  throw error;
                }
              }}
              onDelete={async (commentId) => {
                try {
                  await api.githubDeleteComment(workspaceId, commentId);
                  toast.success(t('code:github.comments.deleted'));
                  invalidateLists(workspaceId);
                  await refresh();
                } catch (error) {
                  toast.error(describeGitHubError(error, t('code:github.comments.error')));
                  throw error;
                }
              }}
            />
          </div>
        ) : section === 'files' ? (
          <FilesSection
            state={filesState}
            onRetry={() => void loadFiles(workspaceId, tab.number, { refresh: true })}
          />
        ) : section === 'commits' ? (
          <CommitsSection
            state={commitsState}
            onRetry={() => void loadCommits(workspaceId, tab.number, { refresh: true })}
          />
        ) : (
          <ChecksSection checks={detail.checks} />
        )}
      </div>

      <EditPullRequestDialog
        open={editOpen}
        detail={detail}
        branches={meta?.branches ?? []}
        onOpenChange={setEditOpen}
        onSubmit={async (patch) => {
          try {
            await api.githubUpdatePullRequest(workspaceId, pr.number, patch);
            toast.success(t('code:github.pr.saved'));
            invalidateLists(workspaceId);
            setEditOpen(false);
            await refresh();
          } catch (error) {
            toast.error(describeGitHubError(error, t('code:github.pr.updateError')));
          }
        }}
      />

      <ReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        onSubmit={async (event, body) => {
          try {
            await api.githubSubmitReview(workspaceId, pr.number, event, body);
            toast.success(t('code:github.pr.reviewSuccess'));
            invalidateLists(workspaceId);
            setReviewOpen(false);
            await refresh();
          } catch (error) {
            toast.error(describeGitHubError(error, t('code:github.pr.reviewError')));
            throw error;
          }
        }}
      />
    </section>
  );
}

function ChecksBadge({ checks }: { checks: GitHubChecksSummary }) {
  const { t } = useTranslation('code');
  if (checks.state === 'none') return null;
  const tone =
    checks.state === 'success'
      ? 'success'
      : checks.state === 'failure'
        ? 'danger'
        : checks.state === 'pending'
          ? 'warning'
          : 'neutral';
  const Icon =
    checks.state === 'success' ? CircleCheck : checks.state === 'failure' ? CircleAlert : CircleDot;
  return (
    <Badge tone={tone} title={t('code:github.pr.checks.summary', {
      passed: checks.passed,
      failed: checks.failed,
      pending: checks.pending,
    })}>
      <Icon aria-hidden className="size-3" strokeWidth={2} />
      {t(`code:github.checks.${checks.state}`)}
    </Badge>
  );
}

function ReviewBadge({ review }: { review: GitHubReview }) {
  const { t } = useTranslation('code');
  const map: Record<string, { tone: 'success' | 'danger' | 'neutral' | 'accent'; key: string }> = {
    APPROVED: { tone: 'success', key: 'code:github.review.approved' },
    CHANGES_REQUESTED: { tone: 'danger', key: 'code:github.review.changesRequested' },
    COMMENTED: { tone: 'neutral', key: 'code:github.review.commented' },
    DISMISSED: { tone: 'neutral', key: 'code:github.review.dismissed' },
    PENDING: { tone: 'accent', key: 'code:github.review.pending' },
  };
  const entry = map[review.state] ?? { tone: 'neutral' as const, key: 'code:github.review.commented' };
  return <Badge tone={entry.tone}>{t(entry.key)}</Badge>;
}

function FilesSection({
  state,
  onRetry,
}: {
  state: { data: { files: GitHubPullRequestFile[]; truncated: boolean } | null; loading: boolean; error: string | null } | undefined;
  onRetry: () => void;
}) {
  const { t } = useTranslation('code');
  if (!state || (state.loading && !state.data)) return <GitHubLoading label={t('code:github.loading')} />;
  if (state.error) return <GitHubErrorState message={state.error} onRetry={onRetry} />;
  const data = state.data;
  if (!data || data.files.length === 0) {
    return <GitHubEmptyState title={t('code:github.pr.files.empty')} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {data.truncated ? (
        <p className="text-[11px] text-foreground-subtle">
          {t('code:github.pr.files.truncated', { count: data.files.length })}
        </p>
      ) : null}
      {data.files.map((file) => (
        <div key={file.path} className="overflow-hidden rounded-xl ">
          <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface px-2.5 py-1.5 text-[11px]">
            <span className="truncate font-mono text-foreground">{file.path}</span>
            <span className="ml-auto shrink-0 text-success">+{file.additions}</span>
            <span className="shrink-0 text-danger">−{file.deletions}</span>
          </div>
          {file.patch ? (
            <DiffView path={file.path} diff={file.patch} />
          ) : (
            <p className="px-3 py-3 text-[12px] text-foreground-subtle">
              {t('code:github.pr.files.binary')}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function CommitsSection({
  state,
  onRetry,
}: {
  state:
    | { data: { sha: string; message: string; author: string; date?: string | null }[] | null; loading: boolean; error: string | null }
    | undefined;
  onRetry: () => void;
}) {
  const { t } = useTranslation('code');
  if (!state || (state.loading && !state.data)) return <GitHubLoading label={t('code:github.loading')} />;
  if (state.error) return <GitHubErrorState message={state.error} onRetry={onRetry} />;
  if (!state.data?.length) return <GitHubEmptyState title={t('code:github.pr.commits.empty')} />;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {state.data.map((commit) => (
        <li key={commit.sha} className="flex min-w-0 flex-col gap-1 py-2 first:pt-0">
          <span className="min-w-0 truncate text-[12px] font-medium text-foreground">
            {commit.message.split('\n')[0]}
          </span>
          <span className="flex min-w-0 items-center gap-2 text-[11px] text-foreground-muted">
            <span className="truncate">{commit.author}</span>
            <span className="font-mono text-[10px] text-foreground-subtle">
              {commit.sha.slice(0, 7)}
            </span>
            <span className="ml-auto shrink-0 text-foreground-subtle">
              {formatGitHubDate(commit.date)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ChecksSection({ checks }: { checks: GitHubChecksSummary }) {
  const { t } = useTranslation('code');
  if (checks.state === 'none') {
    return <GitHubEmptyState title={t('code:github.pr.checks.empty')} />;
  }
  return (
    <div className="flex flex-col gap-2 text-[12px] text-foreground-muted">
      <p className="font-medium text-foreground">{t(`code:github.checks.${checks.state}`)}</p>
      <p>
        {t('code:github.pr.checks.summary', {
          passed: checks.passed,
          failed: checks.failed,
          pending: checks.pending,
        })}
      </p>
    </div>
  );
}

interface MergeBoxProps {
  title: string;
  message: string;
  method: GitHubMergeMethod;
  deleteBranch: boolean;
  busy: boolean;
  onTitle: (value: string) => void;
  onMessage: (value: string) => void;
  onMethod: (value: GitHubMergeMethod) => void;
  onDeleteBranch: (value: boolean) => void;
  onMerge: () => void;
}

function MergeBox({
  title,
  message,
  method,
  deleteBranch,
  busy,
  onTitle,
  onMessage,
  onMethod,
  onDeleteBranch,
  onMerge,
}: MergeBoxProps) {
  const { t } = useTranslation('code');
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          onClick={onMerge}
          leftIcon={<Check aria-hidden className="size-3.5" strokeWidth={2.5} />}
        >
          {t('code:github.pr.merge.submit')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          rightIcon={<ChevronDown aria-hidden className="size-3.5" strokeWidth={2} />}
          onClick={() => setOpen((value) => !value)}
        >
          {t('code:github.pr.merge.options')}
        </Button>
        <label className="ml-auto flex items-center gap-2 text-[11px] text-foreground-muted">
          {t('code:github.pr.merge.deleteBranch')}
          <Switch
            checked={deleteBranch}
            onCheckedChange={onDeleteBranch}
            aria-label={t('code:github.pr.merge.deleteBranch')}
          />
        </label>
      </div>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
          <label className="flex flex-col gap-1 text-[11px] font-medium text-foreground-muted">
            {t('code:github.pr.merge.method')}
            <NativeSelect
              value={method}
              aria-label={t('code:github.pr.merge.method')}
              onChange={(event) => onMethod(event.target.value as GitHubMergeMethod)}
            >
              <option value="merge">{t('code:github.pr.merge.merge')}</option>
              <option value="squash">{t('code:github.pr.merge.squash')}</option>
              <option value="rebase">{t('code:github.pr.merge.rebase')}</option>
            </NativeSelect>
          </label>
          <Input
            value={title}
            placeholder={t('code:github.pr.merge.commitTitle')}
            aria-label={t('code:github.pr.merge.commitTitle')}
            onChange={(event) => onTitle(event.target.value)}
          />
          <Textarea
            value={message}
            rows={3}
            placeholder={t('code:github.pr.merge.commitMessage')}
            aria-label={t('code:github.pr.merge.commitMessage')}
            onChange={(event) => onMessage(event.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}

function EditPullRequestDialog({
  open,
  detail,
  branches,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  detail: GitHubPullRequestDetail;
  branches: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (patch: {
    title?: string | null;
    body?: string | null;
    base?: string | null;
  }) => Promise<void>;
}) {
  const { t } = useTranslation('code');
  const [title, setTitle] = useState(detail.summary.title);
  const [body, setBody] = useState(detail.body);
  const [base, setBase] = useState(detail.summary.baseRef);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(detail.summary.title);
    setBody(detail.body);
    setBase(detail.summary.baseRef);
  }, [detail.body, detail.summary.baseRef, detail.summary.title, open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('code:github.pr.edit')}</DialogTitle>
          <DialogDescription>{t('code:github.pr.editDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-6 pb-4">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-foreground-muted">
            {t('code:github.newPr.fieldTitle')}
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-foreground-muted">
            {t('code:github.newPr.base')}
            <NativeSelect value={base} onChange={(event) => setBase(event.target.value)}>
              {[detail.summary.baseRef, ...branches.filter((branch) => branch !== detail.summary.baseRef)]
                .filter(Boolean)
                .map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-foreground-muted">
            {t('code:github.newPr.body')}
            <Textarea rows={10} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
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
            onClick={() => {
              setBusy(true);
              void onSubmit({ title, body, base }).finally(() => setBusy(false));
            }}
          >
            {t('code:github.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string | null) => Promise<void>;
}) {
  const { t } = useTranslation('code');
  const [event, setEvent] = useState<'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'>('APPROVE');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('code:github.pr.review')}</DialogTitle>
          <DialogDescription>{t('code:github.pr.reviewDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 pb-4">
          <SegmentedControl
            size="sm"
            ariaLabel={t('code:github.pr.review')}
            value={event}
            onChange={(value) => setEvent(value as typeof event)}
            options={[
              { value: 'APPROVE', label: t('code:github.pr.reviewApprove') },
              { value: 'REQUEST_CHANGES', label: t('code:github.pr.reviewRequestChanges') },
              { value: 'COMMENT', label: t('code:github.pr.reviewComment') },
            ]}
          />
          <Textarea
            rows={5}
            value={body}
            placeholder={t('code:github.pr.reviewBody')}
            aria-label={t('code:github.pr.reviewBody')}
            onChange={(change) => setBody(change.target.value)}
          />
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('code:github.cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={event !== 'APPROVE' && !body.trim()}
            leftIcon={<Send aria-hidden className="size-3.5" strokeWidth={1.75} />}
            onClick={() => {
              setBusy(true);
              void onSubmit(event, body.trim() ? body : null)
                .then(() => {
                  setBody('');
                  setEvent('APPROVE');
                })
                .catch(() => {
                  // The owner toasted the failure; keep the draft for retry.
                })
                .finally(() => setBusy(false));
            }}
          >
            {t('code:github.pr.reviewSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GitHubPullRequestView;
