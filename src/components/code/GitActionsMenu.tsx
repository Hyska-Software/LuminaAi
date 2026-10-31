import { useState } from 'react';
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

const ACTION_LABELS: Record<GitRemoteAction, string> = {
  fetch: 'Buscar (fetch)',
  pull: 'Puxar (pull)',
  push: 'Enviar (push)',
};

const BUSY_LABELS: Record<GitRemoteAction, string> = {
  fetch: 'Buscando…',
  pull: 'Puxando…',
  push: 'Enviando…',
};

const SUCCESS_LABELS: Record<GitRemoteAction, string> = {
  fetch: 'Atualizações buscadas',
  pull: 'Pull concluído',
  push: 'Push concluído',
};

const ERROR_LABELS: Record<GitRemoteAction, string> = {
  fetch: 'Não foi possível buscar atualizações',
  pull: 'Não foi possível fazer pull',
  push: 'Não foi possível fazer push',
};

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
  const [busy, setBusy] = useState<GitRemoteAction | null>(null);

  const run = async (action: GitRemoteAction) => {
    if (!workspaceId || !isRepo || busy) return;
    setBusy(action);
    try {
      if (action === 'fetch') await api.gitFetch(workspaceId);
      else if (action === 'pull') await api.gitPull(workspaceId);
      else await api.gitPush(workspaceId);
      toast.success(SUCCESS_LABELS[action]);
      onRefresh?.();
    } catch (error) {
      toast.error(ERROR_LABELS[action], {
        description: describeError(error, 'Verifique a conexão e o remoto configurado.'),
      });
    } finally {
      setBusy(null);
    }
  };

  const disabledReason = !workspaceId
    ? 'Abra um workspace para sincronizar'
    : !isRepo
      ? 'Não é um repositório Git'
      : busy
        ? BUSY_LABELS[busy]
        : 'Ações do git (fetch, pull, push)';

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
          aria-label="Ações do git"
          title={disabledReason}
        >
          {busy ? BUSY_LABELS[busy] : 'Git'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>Sincronizar</DropdownMenuLabel>
        <DropdownMenuItem
          icon={<RefreshCw aria-hidden className="size-4" strokeWidth={1.75} />}
          disabled={busy !== null}
          onSelect={() => void run('fetch')}
        >
          {ACTION_LABELS.fetch}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<ArrowDownToLine aria-hidden className="size-4" strokeWidth={1.75} />}
          shortcut={behind > 0 ? `↓${behind}` : undefined}
          disabled={busy !== null}
          onSelect={() => void run('pull')}
        >
          {ACTION_LABELS.pull}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<ArrowUpFromLine aria-hidden className="size-4" strokeWidth={1.75} />}
          shortcut={ahead > 0 ? `↑${ahead}` : undefined}
          disabled={busy !== null}
          onSelect={() => void run('push')}
        >
          {ACTION_LABELS.push}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<RefreshCw aria-hidden className="size-4" strokeWidth={1.75} />}
          onSelect={() => onRefresh?.()}
        >
          Atualizar status
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default GitActionsMenu;
