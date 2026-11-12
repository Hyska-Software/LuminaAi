import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronDown,
  CircleAlert,
  CloudDownload,
  GitBranch,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Tooltip,
} from '@/components/ui';
import { api } from '@/lib/api';
import { flattenBranchGroups, groupBranches, type BranchGroup } from '@/lib/branchMenu';
import type { WorkspaceGitBranch, WorkspaceGitStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface BranchPickerProps {
  workspaceId?: string | null;
  /** `false` (or no workspace) keeps the trigger disabled with an explanatory hint. */
  isRepo?: boolean;
  /** Branch checked out right now; mirrors `git status` while the list loads. */
  currentBranch?: string | null;
  /** Commits ahead of the upstream of the checked-out branch (`↑N`). */
  ahead?: number;
  /** Commits behind the upstream of the checked-out branch (`↓N`). */
  behind?: number;
  /** Called after a successful switch/create so the container reloads status/files. */
  onChanged?: (status: WorkspaceGitStatus) => void;
  /** Called whenever the branch list changed outside the picker (fetch, checkout). */
  onRefresh?: () => void;
  /** `true` hides the branch name, keeping only the icon (narrow panel). */
  compact?: boolean;
  className?: string;
}

/** Busy sentinels that never collide with a real branch name. */
const BUSY_CREATE = '\u0000create';
const BUSY_FETCH = '\u0000fetch';

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

/** Stable DOM id for an option of a given listbox instance. */
function optionId(listId: string, name: string): string {
  return `${listId}-option-${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/**
 * Branch dropdown of the Changes tab (`WORKBENCH` §7.2).
 *
 * Lists every local and remote-tracking branch of the repository, filters them
 * as the user types and creates a new branch from the highlighted one. Picking
 * a remote row checks out its local tracking branch; the component never runs
 * git itself — every mutation goes through `@/lib/api`.
 */
export function BranchPicker({
  workspaceId,
  isRepo = false,
  currentBranch = null,
  ahead = 0,
  behind = 0,
  onChanged,
  onRefresh,
  compact = false,
  className,
}: BranchPickerProps) {
  const { t } = useTranslation('code');
  const rawId = useId();
  const listId = useMemo(() => `branch-picker-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [rawId]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [branches, setBranches] = useState<WorkspaceGitBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const run = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);

  const disabled = !workspaceId || !isRepo;

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const current = run.current + 1;
    run.current = current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.gitBranches(workspaceId);
      if (current !== run.current) return;
      setBranches(result?.all ?? []);
    } catch (loadError) {
      if (current !== run.current) return;
      setBranches([]);
      setError(describeError(loadError, t('code:branches.loadError')));
    } finally {
      if (current === run.current) setLoading(false);
    }
  }, [workspaceId, t]);

  /* A workspace switch starts from a clean slate: no stale list or query. */
  useEffect(() => {
    run.current += 1;
    setBranches([]);
    setQuery('');
    setError(null);
    setLoading(false);
    setBusy(null);
    setCreating(false);
    setNewName('');
    setCreateError(null);
    setActive(null);
  }, [workspaceId]);

  /* The list is loaded when the popover opens: the trigger itself only needs
     the branch name, which the container already has from `git status`. */

  const groups = useMemo(() => groupBranches(branches, query), [branches, query]);
  const ordered = useMemo(() => flattenBranchGroups(groups), [groups]);
  const orderedNames = useMemo(() => ordered.map((branch) => branch.name), [ordered]);

  const checkedOut = useMemo(
    () => currentBranch ?? branches.find((branch) => branch.current)?.name ?? null,
    [currentBranch, branches],
  );

  const trimmedQuery = query.trim();

  /* Re-anchor the highlight when filtering hides the active row. */
  useEffect(() => {
    if (!open) return;
    if (active && orderedNames.includes(active)) return;
    setActive(orderedNames[0] ?? null);
  }, [open, active, orderedNames]);

  useEffect(() => {
    if (!open || creating) return;
    searchRef.current?.focus();
  }, [open, creating]);

  useEffect(() => {
    if (creating) newNameRef.current?.focus();
  }, [creating]);

  const announce = (status: WorkspaceGitStatus, fallback: string) => {
    onChanged?.(status);
    onRefresh?.();
    setOpen(false);
    setQuery('');
    setNewName('');
    setCreating(false);
    setCreateError(null);
    setActive(null);
    return status.branch ?? fallback;
  };

  /** Checks out `target`: a local branch, or a remote ref that creates its local tracking branch. */
  const checkout = async (target: string) => {
    if (!workspaceId || busy) return;
    setBusy(target);
    try {
      const status = await api.gitSwitchBranch(workspaceId, target);
      toast.success(t('code:branches.switched', { name: announce(status, target) }));
    } catch (checkoutError) {
      toast.error(t('code:branches.switchError'), {
        description: describeError(checkoutError, t('code:branches.switchErrorHint')),
      });
    } finally {
      setBusy(null);
    }
  };

  /** Creates `name` from the current HEAD and checks it out. */
  const create = async (rawName: string) => {
    const name = rawName.trim();
    if (!workspaceId || !name || busy) return;
    setBusy(BUSY_CREATE);
    setCreateError(null);
    try {
      const status = await api.gitCreateBranch(workspaceId, name, null);
      toast.success(t('code:branches.created', { name: announce(status, name) }));
    } catch (createErrorValue) {
      setCreateError(describeError(createErrorValue, t('code:branches.createError')));
    } finally {
      setBusy(null);
    }
  };

  const fetchRemote = async () => {
    if (!workspaceId || busy) return;
    setBusy(BUSY_FETCH);
    try {
      await api.gitFetch(workspaceId);
      await load();
      onRefresh?.();
      toast.success(t('code:git.fetchSuccess'));
    } catch (fetchError) {
      toast.error(t('code:git.fetchError'), {
        description: describeError(fetchError, t('code:git.connectionHint')),
      });
    } finally {
      setBusy(null);
    }
  };

  const move = (direction: 1 | -1) => {
    if (!orderedNames.length) return;
    const index = active ? orderedNames.indexOf(active) : -1;
    const next =
      index < 0
        ? direction > 0
          ? 0
          : orderedNames.length - 1
        : (index + direction + orderedNames.length) % orderedNames.length;
    setActive(orderedNames[next]);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActive(orderedNames[0] ?? null);
        break;
      case 'End':
        event.preventDefault();
        setActive(orderedNames[orderedNames.length - 1] ?? null);
        break;
      case 'Enter':
        event.preventDefault();
        if (active) void checkout(active);
        else if (trimmedQuery) void create(trimmedQuery);
        break;
      case 'Escape':
        if (query) {
          event.preventDefault();
          setQuery('');
        }
        break;
      default:
        break;
    }
  };

  const activeDescendant =
    open && active && orderedNames.includes(active) ? optionId(listId, active) : undefined;
  const disabledReason = !workspaceId
    ? t('code:branches.openWorkspace')
    : !isRepo
      ? t('code:git.notRepo')
      : null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && disabled) return;
        setOpen(next);
        if (next) void load();
        else {
          setCreating(false);
          setCreateError(null);
          setNewName('');
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={
            checkedOut
              ? t('code:branches.triggerAria', { name: checkedOut })
              : t('code:branches.triggerAriaNone')
          }
          title={disabledReason ?? checkedOut ?? t('code:branches.triggerTitle')}
          className={cn(
            'inline-flex h-7 max-w-52 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px]',
            'text-foreground-muted transition-colors duration-150',
            'hover:bg-surface-hover hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            'disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none',
            open && 'bg-surface-hover text-foreground',
            className,
          )}
        >
          <GitBranch aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
          {compact ? null : (
            <span className="min-w-0 truncate font-medium">
              {checkedOut ?? t('code:branches.none')}
            </span>
          )}
          {compact || ahead === 0 ? null : (
            <span className="shrink-0 tabular-nums text-foreground-subtle">↑{ahead}</span>
          )}
          {compact || behind === 0 ? null : (
            <span className="shrink-0 tabular-nums text-foreground-subtle">↓{behind}</span>
          )}
          <ChevronDown aria-hidden className="size-3 shrink-0 opacity-70" strokeWidth={2} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        role="dialog"
        aria-label={t('code:branches.dialogAria')}
        className="w-[21rem] max-w-[calc(100vw-2rem)] p-0"
      >
        <div className="flex shrink-0 flex-col gap-2 border-b border-border p-2.5">
          <div className="flex items-center gap-1.5">
            <div className="relative flex min-w-0 flex-1 items-center">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 size-3.5 text-foreground-subtle"
              />
              <Input
                ref={searchRef}
                role="combobox"
                aria-label={t('code:branches.searchAria')}
                aria-expanded={open}
                aria-controls={listId}
                aria-activedescendant={activeDescendant}
                aria-autocomplete="list"
                autoComplete="off"
                spellCheck={false}
                value={query}
                placeholder={t('code:branches.searchPlaceholder')}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCreateError(null);
                }}
                onKeyDown={handleSearchKeyDown}
                className="h-8 pl-8 text-[12.5px]"
              />
            </div>
            <Tooltip content={t('code:branches.fetchTooltip')} side="bottom">
              <IconButton
                label={t('code:branches.fetch')}
                size="sm"
                disabled={busy !== null || loading}
                onClick={() => void fetchRemote()}
              >
                <RefreshCw aria-hidden className="size-3.5" strokeWidth={1.75} />
              </IconButton>
            </Tooltip>
          </div>

          <div className="flex items-center justify-between gap-2 text-[11px] text-foreground-subtle">
            <span className="truncate">
              {checkedOut
                ? t('code:branches.current', { name: checkedOut })
                : t('code:branches.detached')}
            </span>
            <span className="shrink-0 tabular-nums">
              {t('code:branches.count', { count: ordered.length })}
            </span>
          </div>
        </div>

        <div className="max-h-[min(20rem,calc(100dvh-11rem))] min-h-0 overflow-y-auto overscroll-contain py-1">
          {error ? (
            <div
              role="alert"
              className="flex items-start gap-1.5 px-3 py-2 text-[11.5px] text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">{error}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px]"
                onClick={() => void load()}
              >
                {t('code:branches.retry')}
              </Button>
            </div>
          ) : loading && branches.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11.5px] text-foreground-muted">
              {t('code:branches.loading')}
            </p>
          ) : ordered.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-[12px] font-medium text-foreground">
                {trimmedQuery ? t('code:branches.emptyQuery') : t('code:branches.empty')}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-foreground-muted">
                {trimmedQuery
                  ? t('code:branches.emptyQueryHint', { name: trimmedQuery })
                  : t('code:branches.emptyHint')}
              </p>
            </div>
          ) : (
            <div role="listbox" id={listId} aria-label={t('code:branches.listAria')}>
              {groups.map((group) => (
                <BranchGroupSection
                  key={group.key}
                  group={group}
                  listId={listId}
                  active={active}
                  checkedOut={checkedOut}
                  busy={busy}
                  onActivate={setActive}
                  onCheckout={(name) => void checkout(name)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-border p-2.5">
          {creating ? (
            <div className="flex flex-col gap-1.5">
              <Input
                ref={newNameRef}
                aria-label={t('code:branches.newAria')}
                aria-invalid={createError ? true : undefined}
                placeholder={t('code:branches.newPlaceholder')}
                value={newName}
                onChange={(event) => {
                  setNewName(event.target.value);
                  setCreateError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void create(newName);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setCreating(false);
                    setCreateError(null);
                    setNewName('');
                  }
                }}
                className="h-8 text-[12.5px]"
              />
              {createError ? (
                <p role="alert" className="text-[11px] leading-relaxed text-danger">
                  {createError}
                </p>
              ) : (
                <p className="truncate text-[11px] leading-relaxed text-foreground-subtle">
                  {t('code:branches.newFromCurrent')}
                </p>
              )}
              <div className="flex items-center justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11.5px]"
                  onClick={() => {
                    setCreating(false);
                    setCreateError(null);
                    setNewName('');
                  }}
                >
                  {t('common:actions.cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="h-7 px-2.5 text-[11.5px]"
                  loading={busy === BUSY_CREATE}
                  disabled={!newName.trim() || busy !== null}
                  onClick={() => void create(newName)}
                >
                  {t('code:branches.create')}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="subtle"
              size="sm"
              className="h-8 justify-start px-2 text-[12px]"
              disabled={busy !== null}
              title={t('code:branches.newHint')}
              leftIcon={<Plus aria-hidden className="size-3.5" strokeWidth={1.75} />}
              onClick={() => {
                setNewName(trimmedQuery);
                setCreating(true);
                setCreateError(null);
              }}
            >
              {trimmedQuery
                ? t('code:branches.newFromSearch', { name: trimmedQuery })
                : t('code:branches.new')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface BranchGroupSectionProps {
  group: BranchGroup;
  listId: string;
  active: string | null;
  checkedOut: string | null;
  busy: string | null;
  onActivate: (name: string) => void;
  onCheckout: (name: string) => void;
}

function BranchGroupSection({
  group,
  listId,
  active,
  checkedOut,
  busy,
  onActivate,
  onCheckout,
}: BranchGroupSectionProps) {
  const { t } = useTranslation('code');
  return (
    <div role="group" aria-label={group.label}>
      <div
        aria-hidden
        className={cn(
          'sticky top-0 z-10 bg-surface-raised/95 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider',
          'text-foreground-subtle backdrop-blur',
        )}
      >
        {group.label}
      </div>
      <div className="px-1">
        {group.branches.map((branch) => {
          const selected = branch.name === checkedOut;
          const isActive = active === branch.name;
          const isBusy = busy === branch.name;
          const label = branch.name;
          return (
            <div
              key={branch.name}
              id={optionId(listId, branch.name)}
              role="option"
              aria-selected={selected}
              aria-busy={isBusy || undefined}
              data-active={isActive || undefined}
              onMouseEnter={() => onActivate(branch.name)}
              onClick={() => {
                if (!selected && busy === null) onCheckout(branch.name);
              }}
              className={cn(
                'flex cursor-default select-none items-center gap-2 rounded-lg py-1 pl-2 pr-1.5',
                'transition-colors duration-150 motion-reduce:transition-none',
                isActive && 'bg-surface-hover',
                selected && !isActive && 'bg-accent-soft/60',
                selected && 'cursor-default',
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn(
                      'truncate text-[12.5px] text-foreground',
                      selected && 'font-semibold',
                    )}
                    title={label}
                  >
                    {label}
                  </span>
                  {branch.gone ? (
                    <Badge tone="warning" className="shrink-0">
                      {t('code:branches.gone')}
                    </Badge>
                  ) : null}
                </span>
                {branch.subject ? (
                  <span
                    className="truncate text-[11px] text-foreground-subtle"
                    title={branch.subject}
                  >
                    {branch.subject}
                  </span>
                ) : null}
              </span>

              {branch.ahead ? (
                <span className="shrink-0 tabular-nums text-[11px] text-foreground-subtle">
                  ↑{branch.ahead}
                </span>
              ) : null}
              {branch.behind ? (
                <span className="shrink-0 tabular-nums text-[11px] text-foreground-subtle">
                  ↓{branch.behind}
                </span>
              ) : null}
              {isBusy ? (
                <Spinner size="xs" label={t('code:branches.checkingOut')} />
              ) : selected ? (
                <Check aria-hidden className="size-3.5 shrink-0 text-accent" strokeWidth={2.25} />
              ) : branch.local ? (
                <span aria-hidden className="size-3.5 shrink-0" />
              ) : (
                <CloudDownload
                  aria-hidden
                  className="size-3.5 shrink-0 text-foreground-subtle"
                  strokeWidth={1.75}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default BranchPicker;
