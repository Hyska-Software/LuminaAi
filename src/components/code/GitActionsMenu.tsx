import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpFromLine, GitBranch, RefreshCw } from 'lucide-react';
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
import { cn } from '@/lib/utils';

export type GitRemoteAction = 'fetch' | 'pull' | 'push';

export interface GitActionsMenuProps {
  workspaceId?: string | null;
  /** `false` keeps the trigger disabled (component is hidden outside a repo by the panel). */
  isRepo?: boolean;
  /** Commits ahead of the upstream (`↑N`). */
  ahead?: number;
  /** Commits behind the upstream (`↓N`). */
  behind?: number;
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
 * through the `@/lib/api` git commands. Actions are explicit user gestures —
 * never called by the model — and the trigger follows the branch ahead/behind
 * counters so the menu shows what is pending before running anything.
 */
export function GitActionsMenu({
  workspaceId,
  isRepo = false,
  ahead = 0,
  behind = 0,
  onRefresh,
  className,
}: GitActionsMenuProps) {
  const { t } = useTranslation('code');
  const [busy, setBusy] = useState<GitRemoteAction | null>(null);

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

  return (
    <DropdownMenu>
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
      <DropdownMenuContent align="end" className="min-w-52">
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
        <DropdownMenuItem
          icon={<RefreshCw aria-hidden className="size-4" strokeWidth={1.75} />}
          onSelect={() => onRefresh?.()}
        >
          {t('code:git.refresh')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default GitActionsMenu;
