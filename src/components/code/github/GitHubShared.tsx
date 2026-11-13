/**
 * Shared building blocks of the GitHub PR/Issue tabs.
 *
 * Presentation-only: the views own the API calls and pass the resulting data
 * down. Copy is entirely i18n'd under `code:github.*`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  CircleCheck,
  CircleDot,
  CircleSlash,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
  Search,
  XCircle,
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
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Textarea,
} from '@/components/ui';
import { Markdown } from '@/components/chat/Markdown';
import { openExternalUrl } from '@/components/chat/external';
import { formatDate } from '@/lib/i18n/format';
import { describeGitHubError, useGitHubStore } from '@/lib/store';
import type {
  GitHubComment,
  GitHubIssueSummary,
  GitHubLabel,
  GitHubPullRequestSummary,
} from '@/lib/types';
import { cn } from '@/lib/utils';

const CREATE_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Zylara';

/** Locale-aware short date (falls back to the raw value when unparsable). */
export function formatGitHubDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDate(date, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Delays a value so the list search fires once per pause, not per keystroke.
 * GitHub limits search calls to 30/min; typing must not exhaust it.
 */
export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

export interface GitHubErrorStateProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

/** Inline error with a retry affordance. */
export function GitHubErrorState({ message, onRetry, className }: GitHubErrorStateProps) {
  const { t } = useTranslation('code');
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2.5',
        className,
      )}
    >
      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-foreground">
        <XCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" strokeWidth={1.75} />
        <span className="min-w-0 break-words">{message}</span>
      </p>
      {onRetry ? (
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<RefreshCw className="size-3.5" strokeWidth={1.75} />}
          onClick={onRetry}
        >
          {t('github.retry')}
        </Button>
      ) : null}
    </div>
  );
}

export interface GitHubEmptyStateProps {
  icon?: 'merge' | 'issue' | 'search';
  title: string;
  description?: string;
}

/** Centered empty state for lists and detail tabs. */
export function GitHubEmptyState({ icon = 'search', title, description }: GitHubEmptyStateProps) {
  const Icon = icon === 'merge' ? GitPullRequest : icon === 'issue' ? CircleDot : Search;
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="flex size-9 items-center justify-center rounded-xl border border-border bg-surface-hover text-foreground-muted">
        <Icon aria-hidden className="size-4" strokeWidth={1.75} />
      </span>
      <p className="max-w-96 text-[13px] font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-96 text-[12px] leading-relaxed text-foreground-muted">{description}</p>
      ) : null}
    </div>
  );
}

export interface GitHubLoadingProps {
  label: string;
  className?: string;
}

/** Centered spinner with a label (used while a tab loads for the first time). */
export function GitHubLoading({ label, className }: GitHubLoadingProps) {
  return (
    <div
      className={cn(
        'flex flex-1 items-center justify-center gap-2 px-4 py-10 text-[12px] text-foreground-muted',
        className,
      )}
    >
      <Spinner size="sm" />
      {label}
    </div>
  );
}

/** State badge of a pull request (`draft` > `merged` > `open` > `closed`). */
export function PullRequestStatusBadge({
  pr,
}: {
  pr: Pick<GitHubPullRequestSummary, 'state' | 'draft' | 'merged'>;
}) {
  const { t } = useTranslation('code');
  const draft = pr.draft && pr.state === 'open';
  const tone = pr.merged
    ? 'accent'
    : draft
      ? 'neutral'
      : pr.state === 'open'
        ? 'success'
        : 'danger';
  const label = pr.merged
    ? t('github.state.merged')
    : draft
      ? t('github.state.draft')
      : pr.state === 'open'
        ? t('github.state.open')
        : t('github.state.closed');
  const Icon = pr.merged ? GitMerge : pr.state === 'open' ? GitPullRequest : CircleSlash;
  return (
    <Badge tone={tone} className="gap-1">
      <Icon aria-hidden className="size-3" strokeWidth={2} />
      {label}
    </Badge>
  );
}

/** State badge of an issue (closed shows `completed`/`not planned`). */
export function IssueStatusBadge({
  issue,
}: {
  issue: Pick<GitHubIssueSummary, 'state' | 'stateReason'>;
}) {
  const { t } = useTranslation('code');
  const open = issue.state === 'open';
  const label = open
    ? t('github.state.open')
    : issue.stateReason === 'not_planned'
      ? t('github.issue.closeNotPlanned')
      : t('github.issue.closeCompleted');
  const Icon = open ? CircleDot : CircleCheck;
  return (
    <Badge tone={open ? 'success' : 'accent'} className="gap-1">
      <Icon aria-hidden className="size-3" strokeWidth={2} />
      {label}
    </Badge>
  );
}

/** Colored label chips (GitHub label colors are user data, not theme tokens). */
export function GitHubLabelChips({
  labels,
  max = 3,
  className,
}: {
  labels: GitHubLabel[];
  max?: number;
  className?: string;
}) {
  if (!labels.length) return null;
  const visible = labels.slice(0, max);
  const hidden = labels.length - visible.length;
  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {visible.map((label) => (
        <span
          key={label.name}
          title={label.description ?? label.name}
          className="inline-flex h-[18px] max-w-32 items-center truncate rounded-full border border-border px-1.5 text-[10px] font-medium text-foreground-muted"
          style={
            label.color
              ? { borderColor: `#${label.color}`, backgroundColor: `#${label.color}22` }
              : undefined
          }
        >
          {label.name}
        </span>
      ))}
      {hidden > 0 ? <span className="text-[10px] text-foreground-subtle">+{hidden}</span> : null}
    </span>
  );
}

export interface GitHubMultiPickerOption {
  value: string;
  label: string;
  description?: string | null;
}

export interface GitHubMultiPickerProps {
  label: string;
  /** Copy shown in the trigger when nothing is selected. */
  emptyLabel: string;
  options: GitHubMultiPickerOption[];
  selected: string[];
  disabled?: boolean;
  onApply: (values: string[]) => void;
}

/**
 * Multi-select panel used for labels, assignees and reviewers. The draft is
 * local until "Apply" so a slow request never flickers the selection.
 */
export function GitHubMultiPicker({
  label,
  emptyLabel,
  options,
  selected,
  disabled = false,
  onApply,
}: GitHubMultiPickerProps) {
  const { t } = useTranslation('code');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);

  useEffect(() => {
    if (open) setDraft(selected);
  }, [open, selected]);

  // A selected value may not be in `options` (closed milestone label, reviewer
  // outside the assignable list, >100 labels). Keep it visible so it can be
  // unchecked instead of becoming impossible to remove.
  const entries = useMemo(() => {
    const known = new Set(options.map((option) => option.value));
    const missing = selected
      .filter((value) => !known.has(value))
      .map((value) => ({ value, label: value, description: null }));
    return [...options, ...missing];
  }, [options, selected]);

  const toggle = (value: string) => {
    setDraft((current) =>
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value],
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          className="h-6 px-2 text-[11px]"
          title={label}
        >
          {selected.length ? `${label}: ${selected.length}` : emptyLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="flex flex-col">
          <p className="border-b border-border px-3 py-2 text-[11px] font-semibold text-foreground-muted">
            {label}
          </p>
          <div className="max-h-64 overflow-y-auto p-1">
            {entries.length === 0 ? (
              <p className="px-2 py-3 text-[11px] text-foreground-subtle">
                {t('github.emptyOptions')}
              </p>
            ) : (
              entries.map((option) => {
                const active = draft.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggle(option.value)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-hover',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      active ? 'text-foreground' : 'text-foreground-muted',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border border-border',
                        active && 'border-accent bg-accent-soft text-accent',
                      )}
                    >
                      {active ? <Check aria-hidden className="size-3" strokeWidth={2.5} /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.description ? (
                      <span className="max-w-20 shrink-0 truncate text-[10px] text-foreground-subtle">
                        {option.description}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft([])}>
              {t('github.pickers.clear')}
            </Button>
            <span className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                {t('github.cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onApply(draft);
                  setOpen(false);
                }}
              >
                {t('github.apply')}
              </Button>
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface GitHubCommentsProps {
  comments: GitHubComment[];
  currentLogin?: string | null;
  emptyTitle: string;
  onSubmit: (body: string) => Promise<void>;
  onUpdate?: (commentId: number, body: string) => Promise<void>;
  onDelete?: (commentId: number) => Promise<void>;
}

/** Conversation comments with a Markdown composer and owner edit/delete. */
export function GitHubComments({
  comments,
  currentLogin,
  emptyTitle,
  onSubmit,
  onUpdate,
  onDelete,
}: GitHubCommentsProps) {
  const { t } = useTranslation('code');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
      setBody('');
    } catch {
      // The owner reports the failure with a toast; keep the draft for retry.
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (commentId: number) => {
    if (!onUpdate || !editingBody.trim() || busy) return;
    setBusy(true);
    try {
      await onUpdate(commentId, editingBody.trim());
      setEditingId(null);
    } catch {
      // Keep the editor open so the user can retry.
    } finally {
      setBusy(false);
    }
  };

  const remove = async (commentId: number) => {
    if (!onDelete || busy) return;
    setBusy(true);
    try {
      await onDelete(commentId);
      setConfirmingDelete(null);
    } catch {
      // Keep the confirmation open; the owner already toasted the error.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {comments.length === 0 ? (
        <p className="text-[12px] text-foreground-subtle">{emptyTitle}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((comment) => {
            const own = Boolean(
              currentLogin &&
                comment.author.login.toLowerCase() === currentLogin.toLowerCase(),
            );
            return (
              <li key={comment.id} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex min-w-0 items-center gap-2 text-[11px] text-foreground-subtle">
                  <span className="font-medium text-foreground-muted">{comment.author.login}</span>
                  <span className="shrink-0">{formatGitHubDate(comment.createdAt)}</span>
                  {comment.authorAssociation ? (
                    <Badge tone="outline">{comment.authorAssociation.toLowerCase()}</Badge>
                  ) : null}
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {own && onUpdate ? (
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-[11px] text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                        onClick={() => {
                          setEditingId(comment.id);
                          setEditingBody(comment.body);
                        }}
                      >
                        {t('github.comments.edit')}
                      </button>
                    ) : null}
                    {own && onDelete ? (
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-[11px] text-foreground-muted transition-colors hover:bg-surface-hover hover:text-danger"
                        onClick={() => setConfirmingDelete(comment.id)}
                      >
                        {t('github.comments.delete')}
                      </button>
                    ) : null}
                    {comment.htmlUrl ? (
                      <button
                        type="button"
                        className="rounded p-0.5 text-foreground-subtle transition-colors hover:text-foreground"
                        aria-label={t('github.openOnGitHub')}
                        onClick={() => void openExternalUrl(comment.htmlUrl ?? '')}
                      >
                        <ExternalLink aria-hidden className="size-3.5" strokeWidth={1.75} />
                      </button>
                    ) : null}
                  </span>
                </div>

                {confirmingDelete === comment.id ? (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-danger/40 bg-danger-soft px-2.5 py-2 text-[11px] text-foreground">
                    <span className="min-w-0 flex-1">{t('github.comments.confirmDelete')}</span>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(null)}>
                      {t('github.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy}
                      onClick={() => void remove(comment.id)}
                    >
                      {t('github.comments.delete')}
                    </Button>
                  </div>
                ) : editingId === comment.id ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <Textarea
                      value={editingBody}
                      onChange={(event) => setEditingBody(event.target.value)}
                      rows={4}
                      aria-label={t('github.comments.edit')}
                    />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        {t('github.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        loading={busy}
                        disabled={!editingBody.trim()}
                        onClick={() => void saveEdit(comment.id)}
                      >
                        {t('github.comments.save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Markdown content={comment.body} className="mt-1.5 text-[12.5px]" />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          placeholder={t('github.comments.placeholder')}
          aria-label={t('github.comments.placeholder')}
        />
        <div className="flex items-center justify-end gap-2">
          <MessageSquare aria-hidden className="size-3.5 text-foreground-subtle" strokeWidth={1.75} />
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!body.trim()}
            onClick={() => void submit()}
          >
            {t('github.comments.submit')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface GitHubConnectDialogProps {
  open: boolean;
  workspaceId?: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Personal access token dialog. The token is validated and persisted by the
 * backend and never comes back to the renderer.
 */
export function GitHubConnectDialog({ open, workspaceId, onOpenChange }: GitHubConnectDialogProps) {
  const { t } = useTranslation('code');
  const connect = useGitHubStore((state) => state.connect);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setToken('');
    setError(null);
    setBusy(false);
  }, [open]);

  const submit = async () => {
    const value = token.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await connect(value, workspaceId ?? null);
      setToken('');
      onOpenChange(false);
    } catch (connectError) {
      setError(describeGitHubError(connectError, t('github.connect.error')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('github.connect.title')}</DialogTitle>
          <DialogDescription>{t('github.connect.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 pb-4">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-foreground-muted">
            {t('github.connect.tokenLabel')}
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={t('github.connect.placeholder')}
              aria-label={t('github.connect.tokenLabel')}
            />
          </label>
          <p className="text-[11px] leading-relaxed text-foreground-subtle">
            {t('github.connect.scopes')}
          </p>
          <button
            type="button"
            className="inline-flex w-fit items-center gap-1 text-[11px] text-accent hover:underline"
            onClick={() => void openExternalUrl(CREATE_TOKEN_URL)}
          >
            {t('github.connect.createToken')}
            <ExternalLink aria-hidden className="size-3" strokeWidth={1.75} />
          </button>
          {error ? <p className="text-[11px] text-danger">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('github.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!token.trim()}
            onClick={() => void submit()}
          >
            {t('github.connect.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
