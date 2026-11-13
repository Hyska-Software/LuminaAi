/**
 * Issue tab: header + actions (edit, close with reason, reopen), body and
 * comments. Same interaction model as the pull request detail.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleDot,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  UserRound,
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
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import {
  describeGitHubError,
  gitHubItemKey,
  useGitHubStore,
  type CodeIssueTab,
} from '@/lib/store';
import type { GitHubIssueDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  GitHubComments,
  GitHubEmptyState,
  GitHubErrorState,
  GitHubLabelChips,
  GitHubLoading,
  GitHubMultiPicker,
  IssueStatusBadge,
  formatGitHubDate,
} from './GitHubShared';

export interface GitHubIssueViewProps {
  tab: CodeIssueTab;
  className?: string;
}

export function GitHubIssueView({ tab, className }: GitHubIssueViewProps) {
  const { t } = useTranslation('code');
  const workspaceId = tab.workspaceId;
  const itemKey = gitHubItemKey(workspaceId, tab.number);
  const detailState = useGitHubStore((state) => state.issueDetails[itemKey]);
  const meta = useGitHubStore((state) => state.metas[workspaceId]?.data ?? null);
  const login = useGitHubStore(
    (state) =>
      state.connections[workspaceId]?.data?.account.login ?? state.account.data?.login ?? null,
  );
  const loadIssue = useGitHubStore((state) => state.loadIssue);
  const loadMeta = useGitHubStore((state) => state.loadMeta);
  const loadConnection = useGitHubStore((state) => state.loadConnection);
  const invalidateLists = useGitHubStore((state) => state.invalidateLists);
  const cacheEpoch = useGitHubStore((state) => state.cacheEpoch);

  const [busy, setBusy] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const detail = detailState?.data ?? null;

  useEffect(() => {
    void loadConnection(workspaceId);
  }, [loadConnection, workspaceId]);

  useEffect(() => {
    void loadIssue(workspaceId, tab.number);
    void loadMeta(workspaceId);
  }, [cacheEpoch, loadIssue, loadMeta, tab.number, workspaceId]);

  const refresh = () => loadIssue(workspaceId, tab.number, { refresh: true });

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
        <GitHubErrorState message={detailState.error} onRetry={() => void refresh()} />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
        <GitHubEmptyState title={t('code:github.issue.notFound')} />
      </div>
    );
  }

  const issue = detail.summary;
  const isOpen = issue.state === 'open';

  return (
    <section
      className={cn('flex min-h-0 flex-1 flex-col', className)}
      aria-label={t('code:github.issue.aria', { number: issue.number })}
    >
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <IssueStatusBadge issue={issue} />
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
            {issue.title} <span className="font-normal text-foreground-subtle">#{issue.number}</span>
          </h2>
          <IconButton
            label={t('code:github.refresh')}
            size="sm"
            variant="ghost"
            loading={busy === 'refresh'}
            onClick={() => void run('refresh', () => Promise.resolve())}
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
                onSelect={() => void openExternalUrl(issue.htmlUrl)}
              >
                {t('code:github.openOnGitHub')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={<Pencil aria-hidden className="size-4" strokeWidth={1.75} />}
                disabled={busy !== null}
                onSelect={() => setEditOpen(true)}
              >
                {t('code:github.issue.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={
                  isOpen ? (
                    <XCircle aria-hidden className="size-4" strokeWidth={1.75} />
                  ) : (
                    <CircleDot aria-hidden className="size-4" strokeWidth={1.75} />
                  )
                }
                disabled={busy !== null}
                onSelect={() => {
                  if (isOpen) {
                    setCloseOpen(true);
                    return;
                  }
                  void run(
                    'state',
                    () =>
                      api.githubUpdateIssue(workspaceId, issue.number, { stateValue: 'open' }),
                    t('code:github.issue.reopened'),
                  );
                }}
              >
                {isOpen ? t('code:github.issue.closeAction') : t('code:github.issue.reopenAction')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-foreground-muted">
          <span className="inline-flex items-center gap-1">
            <UserRound aria-hidden className="size-3.5" strokeWidth={1.75} />
            {issue.author.login}
          </span>
          {issue.milestone ? <Badge tone="outline">{issue.milestone}</Badge> : null}
          <span className="ml-auto shrink-0 text-foreground-subtle">
            {formatGitHubDate(issue.updatedAt)}
          </span>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <GitHubLabelChips labels={issue.labels} max={6} />
          <GitHubMultiPicker
            label={t('code:github.pr.labels')}
            emptyLabel={t('code:github.pr.clearLabels')}
            options={labelOptions}
            selected={issue.labels.map((label) => label.name)}
            disabled={busy !== null}
            onApply={(values) =>
              run(
                'labels',
                () => api.githubSetLabels(workspaceId, issue.number, values),
                t('code:github.pr.saved'),
              )
            }
          />
          <GitHubMultiPicker
            label={t('code:github.pr.assignees')}
            emptyLabel={t('code:github.pr.clearAssignees')}
            options={userOptions}
            selected={issue.assignees.map((user) => user.login)}
            disabled={busy !== null}
            onApply={(values) =>
              run(
                'assignees',
                () => api.githubSetAssignees(workspaceId, issue.number, values),
                t('code:github.pr.saved'),
              )
            }
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-4">
          {detail.body.trim() ? (
            <Markdown content={detail.body} className="text-[13px]" />
          ) : (
            <p className="text-[12px] text-foreground-subtle">{t('code:github.issue.noBody')}</p>
          )}
          {detail.locked ? <Badge tone="warning">{t('code:github.issue.locked')}</Badge> : null}
          <GitHubComments
            comments={detail.comments}
            currentLogin={login}
            emptyTitle={t('code:github.comments.empty')}
            onSubmit={async (body) => {
              try {
                await api.githubAddComment(workspaceId, issue.number, body);
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
      </div>

      <EditIssueDialog
        open={editOpen}
        detail={detail}
        milestones={meta?.milestones ?? []}
        onOpenChange={setEditOpen}
        onSubmit={async (patch) => {
          try {
            await api.githubUpdateIssue(workspaceId, issue.number, patch);
            toast.success(t('code:github.pr.saved'));
            invalidateLists(workspaceId);
            setEditOpen(false);
            await refresh();
          } catch (error) {
            toast.error(describeGitHubError(error, t('code:github.issue.updateError')));
          }
        }}
      />

      <CloseIssueDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        onSubmit={async (reason) => {
          try {
            await api.githubUpdateIssue(workspaceId, issue.number, {
              stateValue: 'closed',
              stateReason: reason,
            });
            toast.success(t('code:github.issue.closed'));
            invalidateLists(workspaceId);
            setCloseOpen(false);
            await refresh();
          } catch (error) {
            toast.error(describeGitHubError(error, t('code:github.issue.updateError')));
          }
        }}
      />
    </section>
  );
}

function EditIssueDialog({
  open,
  detail,
  milestones,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  detail: GitHubIssueDetail;
  milestones: { number: number; title: string }[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (patch: {
    title?: string | null;
    body?: string | null;
    milestone?: number | null;
    clearMilestone?: boolean;
  }) => Promise<void>;
}) {
  const { t } = useTranslation('code');
  const [title, setTitle] = useState(detail.summary.title);
  const [body, setBody] = useState(detail.body);
  const [milestone, setMilestone] = useState(
    detail.milestone ? String(detail.milestone.number) : '',
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(detail.summary.title);
    setBody(detail.body);
    setMilestone(detail.milestone ? String(detail.milestone.number) : '');
  }, [detail.body, detail.milestone, detail.summary.title, open]);

  // The metadata only lists open milestones; a closed one already attached to
  // the issue must remain selectable instead of rendering a blank select.
  const milestoneOptions = useMemo(() => {
    const current = detail.milestone;
    if (current && !milestones.some((entry) => entry.number === current.number)) {
      return [{ number: current.number, title: current.title }, ...milestones];
    }
    return milestones;
  }, [detail.milestone, milestones]);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('code:github.issue.edit')}</DialogTitle>
          <DialogDescription>{t('code:github.issue.editDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-6 pb-4">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-foreground-muted">
            {t('code:github.newPr.fieldTitle')}
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-foreground-muted">
            {t('code:github.issue.milestone')}
            <NativeSelect value={milestone} onChange={(event) => setMilestone(event.target.value)}>
              <option value="">{t('code:github.filters.anyMilestone')}</option>
              {milestoneOptions.map((entry) => (
                <option key={entry.number} value={String(entry.number)}>
                  {entry.title}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-foreground-muted">
            {t('code:github.newIssue.body')}
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
              void onSubmit({
                title,
                body,
                milestone: milestone ? Number(milestone) : null,
                clearMilestone: !milestone,
              }).finally(() => setBusy(false));
            }}
          >
            {t('code:github.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseIssueDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: 'completed' | 'not_planned') => Promise<void>;
}) {
  const { t } = useTranslation('code');
  const [reason, setReason] = useState<'completed' | 'not_planned'>('completed');
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('code:github.issue.closeAction')}</DialogTitle>
          <DialogDescription>{t('code:github.issue.closeDescription')}</DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-4">
          <SegmentedControl
            size="sm"
            ariaLabel={t('code:github.issue.closeReason')}
            value={reason}
            onChange={(value) => setReason(value as typeof reason)}
            options={[
              { value: 'completed', label: t('code:github.issue.closeCompleted') },
              { value: 'not_planned', label: t('code:github.issue.closeNotPlanned') },
            ]}
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
            onClick={() => {
              setBusy(true);
              void onSubmit(reason).finally(() => setBusy(false));
            }}
          >
            {t('code:github.issue.closeAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GitHubIssueView;
