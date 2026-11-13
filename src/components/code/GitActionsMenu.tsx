import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleDot,
  GitBranch,
  GitPullRequest,
  LogOut,
  Plus,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useGitHubStore, useUiStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { GitHubConnectDialog, GitHubNewIssueDialog, GitHubNewPullRequestDialog } from './github';

export type GitRemoteAction = 'fetch' | 'pull' | 'push';

export interface GitActionsMenuProps {
  workspaceId?: string | null;
  /** `false` keeps the trigger disabled (component is hidden outside a repo by the panel). */
  isRepo?: boolean;
  /** Commits ahead of the upstream (`↑N`). */
  ahead?: number;
  /** Commits behind the upstream (`↓N`). */
  behind?: number;
  /** Current branch, used by the "pull request of this branch" shortcut. */
  branch?: string | null;
  /** Called after a successful fetch/pull/push so the container reloads the status. */
  onRefresh?: () => void;
  className?: string;
}

const ACTION_KEYS = {
  fetch: 'code:git.fetch',
  pull: 'code:git.pull',
  push: 'code:git.push',
} as const;

const BUSY_KEYS = {
  fetch: 'code:git.fetchBusy',
  pull: 'code:git.pullBusy',
  push: 'code:git.pushBusy',
} as const;

const SUCCESS_KEYS = {
  fetch: 'code:git.fetchSuccess',
  pull: 'code:git.pullSuccess',
  push: 'code:git.pushSuccess',
} as const;

const ERROR_KEYS = {
  fetch: 'code:git.fetchError',
  pull: 'code:git.pullError',
  push: 'code:git.pushError',
} as const;

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

/**
 * Remote actions of the Changes tab (`WORKBENCH` §7.2): fetch, pull and push
 * through the `@/lib/api` git commands, plus the GitHub shortcuts (pull
 * requests, issues, creation and connection) that open the center tabs.
 *
 * Actions are explicit user gestures — never called by the model — and the
 * trigger follows the branch ahead/behind counters so the menu shows what is
 * pending before running anything.
 */
export function GitActionsMenu({
  workspaceId,
  isRepo = false,
  ahead = 0,
  behind = 0,
  branch = null,
  onRefresh,
  className,
}: GitActionsMenuProps) {
  const { t } = useTranslation('code');
  const [busy, setBusy] = useState<GitRemoteAction | null>(null);
  const [open, setOpen] = useState(false);
  const [prNumber, setPrNumber] = useState<number | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [newPrOpen, setNewPrOpen] = useState(false);
  const [newIssueOpen, setNewIssueOpen] = useState(false);

  const openPullRequests = useUiStore((state) => state.openCodePullRequests);
  const openIssues = useUiStore((state) => state.openCodeIssues);
  const openPullRequest = useUiStore((state) => state.openCodePullRequest);
  const openIssue = useUiStore((state) => state.openCodeIssue);
  const account = useGitHubStore((state) => state.account);
  const loadAccount = useGitHubStore((state) => state.loadAccount);
  const disconnect = useGitHubStore((state) => state.disconnect);
  const loadMeta = useGitHubStore((state) => state.loadMeta);
  const meta = useGitHubStore((state) =>
    workspaceId ? (state.metas[workspaceId]?.data ?? null) : null,
  );

  const authenticated = account.data?.authenticated ?? false;
  const login = account.data?.login ?? null;
  const labelOptions = (meta?.labels ?? []).map((label) => label.name);
  const userOptions = (meta?.users ?? []).map((user) => user.login);

  useEffect(() => {
    if (open) void loadAccount();
  }, [loadAccount, open]);

  /* Pull request of the current branch: loaded when the menu opens. */
  useEffect(() => {
    if (!open || !authenticated || !isRepo || !workspaceId || !branch) {
      setPrNumber(null);
      return;
    }
    let cancelled = false;
    api
      .githubListPullRequests(workspaceId, { state: 'open', head: branch, perPage: 1 })
      .then((list) => {
        if (!cancelled) setPrNumber(list.items[0]?.number ?? null);
      })
      .catch(() => {
        if (!cancelled) setPrNumber(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, branch, isRepo, open, workspaceId]);

  const run = async (action: GitRemoteAction) => {
    if (!workspaceId || !isRepo || busy) return;
    setBusy(action);
    try {
      if (action === 'fetch') await api.gitFetch(workspaceId);
      else if (action === 'pull') await api.gitPull(workspaceId);
      else await api.gitPush(workspaceId);
      toast.success(t(SUCCESS_KEYS[action]));
      onRefresh?.();
    } catch (error) {
      toast.error(t(ERROR_KEYS[action]), {
        description: describeError(error, t('code:git.connectionHint')),
      });
    } finally {
      setBusy(null);
    }
  };

  const disabledReason = !workspaceId
    ? t('code:git.openWorkspace')
    : !isRepo
      ? t('code:git.notRepo')
      : busy
        ? t(BUSY_KEYS[busy])
        : t('code:git.actionsHint');

  const canUseGitHub = Boolean(workspaceId) && isRepo;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn('h-6 shrink-0 px-2 text-[11px]', className)}
            loading={busy !== null}
            disabled={!workspaceId || !isRepo}
            leftIcon={<GitBranch aria-hidden className="size-3.5" strokeWidth={1.75} />}
            aria-label={t('code:git.aria')}
            title={disabledReason}
          >
            {busy ? t(BUSY_KEYS[busy]) : 'Git'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>{t('code:git.sync')}</DropdownMenuLabel>
          <DropdownMenuItem
            icon={<RefreshCw aria-hidden className="size-4" strokeWidth={1.75} />}
            disabled={busy !== null}
            onSelect={() => void run('fetch')}
          >
            {t(ACTION_KEYS.fetch)}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<ArrowDownToLine aria-hidden className="size-4" strokeWidth={1.75} />}
            shortcut={behind > 0 ? `↓${behind}` : undefined}
            disabled={busy !== null}
            onSelect={() => void run('pull')}
          >
            {t(ACTION_KEYS.pull)}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<ArrowUpFromLine aria-hidden className="size-4" strokeWidth={1.75} />}
            shortcut={ahead > 0 ? `↑${ahead}` : undefined}
            disabled={busy !== null}
            onSelect={() => void run('push')}
          >
            {t(ACTION_KEYS.push)}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('code:github.menu.title')}</DropdownMenuLabel>
          <DropdownMenuItem
            icon={<GitPullRequest aria-hidden className="size-4" strokeWidth={1.75} />}
            shortcut={prNumber ? `#${prNumber}` : undefined}
            disabled={!canUseGitHub}
            onSelect={() => {
              if (!workspaceId) return;
              if (prNumber) {
                openPullRequest({
                  workspaceId,
                  number: prNumber,
                  title: t('code:github.pr.tabTitle', { number: prNumber }),
                });
                return;
              }
              openPullRequests(workspaceId);
            }}
          >
            {t('code:github.menu.pullRequests')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Plus aria-hidden className="size-4" strokeWidth={1.75} />}
            disabled={!canUseGitHub || !authenticated}
            onSelect={() => {
              setNewPrOpen(true);
              if (workspaceId) void loadMeta(workspaceId);
            }}
          >
            {t('code:github.menu.newPullRequest')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<CircleDot aria-hidden className="size-4" strokeWidth={1.75} />}
            disabled={!canUseGitHub}
            onSelect={() => {
              if (workspaceId) openIssues(workspaceId);
            }}
          >
            {t('code:github.menu.issues')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Plus aria-hidden className="size-4" strokeWidth={1.75} />}
            disabled={!canUseGitHub || !authenticated}
            onSelect={() => {
              setNewIssueOpen(true);
              if (workspaceId) void loadMeta(workspaceId);
            }}
          >
            {t('code:github.menu.newIssue')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {authenticated ? (
            <DropdownMenuItem
              icon={<LogOut aria-hidden className="size-4" strokeWidth={1.75} />}
              onSelect={() => {
                void disconnect()
                  .then(() => toast.success(t('code:github.connect.disconnected')))
                  .catch((error: unknown) =>
                    toast.error(t('code:github.connect.error'), {
                      description: describeError(error, t('code:github.connect.error')),
                    }),
                  );
              }}
            >
              {t('code:github.menu.disconnect')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              icon={<Unplug aria-hidden className="size-4" strokeWidth={1.75} />}
              onSelect={() => setConnectOpen(true)}
            >
              {t('code:github.menu.connect')}
            </DropdownMenuItem>
          )}
          {authenticated && login ? (
            <DropdownMenuItem disabled>
              {t('code:github.menu.account', { login })}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={<RefreshCw aria-hidden className="size-4" strokeWidth={1.75} />}
            onSelect={() => onRefresh?.()}
          >
            {t('code:git.refresh')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <GitHubConnectDialog
        open={connectOpen}
        workspaceId={workspaceId ?? null}
        onOpenChange={setConnectOpen}
      />
      {workspaceId ? (
        <>
          <GitHubNewPullRequestDialog
            open={newPrOpen}
            workspaceId={workspaceId}
            onOpenChange={setNewPrOpen}
            onCreated={(number, title) => openPullRequest({ workspaceId, number, title })}
          />
          <GitHubNewIssueDialog
            open={newIssueOpen}
            workspaceId={workspaceId}
            labels={labelOptions}
            assignees={userOptions}
            onOpenChange={setNewIssueOpen}
            onCreated={(number, title) => openIssue({ workspaceId, number, title })}
          />
        </>
      ) : null}
    </>
  );
}

export default GitActionsMenu;
