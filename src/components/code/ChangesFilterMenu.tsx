import { ChevronDown } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui';
import type { WorkspaceGitCommit } from '@/lib/types';
import { cn } from '@/lib/utils';
import { shortHash } from './CommitBar';

/** Filtro de origem das alterações exibidas na aba Alterações. */
export type ChangesFilter =
  | { kind: 'last-turn' }
  | { kind: 'uncommitted' }
  | { kind: 'unstaged' }
  | { kind: 'staged' }
  | { kind: 'commit'; hash: string; subject: string }
  | { kind: 'branch'; base: string };

export interface ChangesFilterMenuProps {
  value: ChangesFilter;
  onChange: (filter: ChangesFilter) => void;
  commits: WorkspaceGitCommit[];
  commitsLoading?: boolean;
  /** `null` enquanto a lista de branches ainda não foi carregada. */
  branches: string[] | null;
  currentBranch?: string | null;
  branchesLoading?: boolean;
  branchesError?: string | null;
  onOpenBranches: () => void;
  className?: string;
}

/** Stable key used by checks and tests. */
export function filterKey(filter: ChangesFilter): string {
  switch (filter.kind) {
    case 'commit':
      return `commit:${filter.hash}`;
    case 'branch':
      return `branch:${filter.base}`;
    default:
      return filter.kind;
  }
}

/** Label shown on the toolbar trigger. */
export function filterLabel(filter: ChangesFilter): string {
  switch (filter.kind) {
    case 'last-turn':
      return 'Último turno';
    case 'uncommitted':
      return 'Sem commit';
    case 'unstaged':
      return 'Não marcadas para commit';
    case 'staged':
      return 'Marcadas para commit';
    case 'commit':
      return `Commit ${shortHash(filter.hash)}`;
    case 'branch':
      return `Branch ${filter.base}`;
  }
}

const COMMIT_MENU_LIMIT = 10;

/**
 * Filter dropdown of the Changes tab (WORKBENCH §7.2): last turn, uncommitted,
 * staged/unstaged, a specific commit and a branch comparison. Commit/branch are
 * submenus because each can have many options.
 */
export function ChangesFilterMenu({
  value,
  onChange,
  commits,
  commitsLoading = false,
  branches,
  currentBranch = null,
  branchesLoading = false,
  branchesError = null,
  onOpenBranches,
  className,
}: ChangesFilterMenuProps) {
  const current = filterKey(value);
  const label = filterLabel(value);
  const commitItems = commits.slice(0, COMMIT_MENU_LIMIT);
  const otherBranches = (branches ?? []).filter((branch) => branch !== currentBranch);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Filtrar alterações"
          title={label}
          className={cn(
            'h-7 min-w-0 gap-1 px-2 text-[11.5px] font-medium',
            className,
          )}
        >
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem
          checked={current === 'last-turn'}
          onSelect={() => onChange({ kind: 'last-turn' })}
        >
          Último turno
        </DropdownMenuItem>
        <DropdownMenuItem
          checked={current === 'uncommitted'}
          onSelect={() => onChange({ kind: 'uncommitted' })}
        >
          Sem commit
        </DropdownMenuItem>
        <DropdownMenuItem
          checked={current === 'unstaged'}
          onSelect={() => onChange({ kind: 'unstaged' })}
        >
          Não marcadas para commit
        </DropdownMenuItem>
        <DropdownMenuItem
          checked={current === 'staged'}
          onSelect={() => onChange({ kind: 'staged' })}
        >
          Marcadas para commit
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            disabled={commits.length === 0 && !commitsLoading}
            title={
              commits.length === 0 && !commitsLoading
                ? 'Nenhum commit no workspace'
                : 'Escolher um commit'
            }
          >
            Commit
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {commitsLoading ? (
              <DropdownMenuItem disabled>Carregando commits…</DropdownMenuItem>
            ) : commitItems.length === 0 ? (
              <DropdownMenuItem disabled>Nenhum commit</DropdownMenuItem>
            ) : (
              commitItems.map((commit) => (
                <DropdownMenuItem
                  key={commit.hash}
                  checked={current === `commit:${commit.hash}`}
                  title={commit.subject}
                  onSelect={() =>
                    onChange({
                      kind: 'commit',
                      hash: commit.hash,
                      subject: commit.subject,
                    })
                  }
                >
                  {shortHash(commit.hash)} · {commit.subject}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub
          onOpenChange={(open) => {
            if (open) onOpenBranches();
          }}
        >
          <DropdownMenuSubTrigger title="Comparar com uma branch">
            Branch
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {branchesLoading || (branches === null && !branchesError) ? (
              <DropdownMenuItem disabled>Carregando branches…</DropdownMenuItem>
            ) : branchesError ? (
              <DropdownMenuItem disabled>{branchesError}</DropdownMenuItem>
            ) : otherBranches.length === 0 ? (
              <DropdownMenuItem disabled>Nenhuma outra branch</DropdownMenuItem>
            ) : (
              otherBranches.map((branch) => (
                <DropdownMenuItem
                  key={branch}
                  checked={current === `branch:${branch}`}
                  title={branch}
                  onSelect={() => onChange({ kind: 'branch', base: branch })}
                >
                  {branch}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ChangesFilterMenu;
