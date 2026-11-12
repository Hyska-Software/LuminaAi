/**
 * Shared update panel: header, release notes and the download/install actions.
 * Used by the title-bar popover and by Settings → Sobre so both surfaces always
 * show the same phase and copy.
 */
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, ProgressBar } from '@/components/ui';
import { openExternalUrl } from '@/components/chat/external';
import { t } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/format';
import { canSelfInstall, useUpdateStore } from '@/lib/store';
import type { ManagedUpdateStatus, UpdateAssetKind } from '@/lib/types';
import { cn, formatBytes, relativeTime } from '@/lib/utils';

export function updateCheckedLabel(timestamp?: number | null): string | null {
  if (!timestamp) return null;
  const diff = Date.now() - timestamp;
  if (diff < 0) return t('common:shell.update.checkedNow');
  if (diff < 45_000) return t('common:shell.update.checkedNow');
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return t('common:shell.update.checkedAgo', { relative: relativeTime(timestamp) });
  }
  return t('common:shell.update.checkedAt', {
    date: formatDate(timestamp, { day: '2-digit', month: 'short' }),
  });
}

function releasedLabel(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return t('common:shell.update.released', {
    date: formatDate(date, { day: '2-digit', month: 'short', year: 'numeric' }),
  });
}

/** Removes the heavier Markdown noise so GitHub-generated notes read well in a
 *  small popover. Notes are always rendered as plain text (never HTML). */
function plainNotes(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();
}

function installHint(
  kind: UpdateAssetKind | undefined,
  managed: ManagedUpdateStatus,
  version: string,
): string {
  if (canSelfInstall(managed, kind)) {
    return t('common:shell.update.hintManaged', { version });
  }
  switch (kind) {
    case 'setup':
      return t('common:shell.update.hintSetup');
    case 'dmg':
      return t('common:shell.update.hintDmg');
    case 'appimage':
      return t('common:shell.update.hintAppImage');
    case 'deb':
    case 'rpm':
      return t('common:shell.update.hintSystem');
    default:
      return t('common:shell.update.hintDefault');
  }
}

function primaryLabel(kind: UpdateAssetKind | undefined): string {
  return kind === 'setup'
    ? t('common:shell.update.downloadAction')
    : t('common:shell.update.downloadUpdate');
}

function installLabel(
  kind: UpdateAssetKind | undefined,
  managed: ManagedUpdateStatus,
): string {
  if (canSelfInstall(managed, kind)) {
    return t('common:shell.update.installAndRestart');
  }
  switch (kind) {
    case 'setup':
      return t('common:shell.update.installNow');
    case 'dmg':
      return t('common:shell.update.openDmg');
    case 'appimage':
      return t('common:shell.update.openFolder');
    case 'deb':
    case 'rpm':
      return t('common:shell.update.openInstaller');
    default:
      return t('common:shell.update.openInstaller');
  }
}

function ErrorBox() {
  const error = useUpdateStore((state) => state.error);
  const errorScope = useUpdateStore((state) => state.errorScope);
  if (!error || (errorScope !== 'download' && errorScope !== 'install')) return null;
  return (
    <div
      role="alert"
      className="mt-3 flex gap-2 rounded-lg border border-danger/30 bg-danger-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-danger"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 break-words">{error}</span>
    </div>
  );
}

export function UpdateActions({ className }: { className?: string }) {
  const { t } = useTranslation('common');
  const phase = useUpdateStore((state) => state.phase);
  const info = useUpdateStore((state) => state.info);
  const downloaded = useUpdateStore((state) => state.downloaded);
  const managed = useUpdateStore((state) => state.managed);
  const progress = useUpdateStore((state) => state.progress);
  const error = useUpdateStore((state) => state.error);
  const errorScope = useUpdateStore((state) => state.errorScope);
  const startDownload = useUpdateStore((state) => state.download);
  const cancelDownload = useUpdateStore((state) => state.cancel);
  const install = useUpdateStore((state) => state.install);
  const reveal = useUpdateStore((state) => state.reveal);

  if (!info) return null;
  const kind = info.asset?.kind;
  const selfInstall = canSelfInstall(managed, kind);

  if (phase === 'downloading' || phase === 'verifying') {
    const received = progress?.received ?? 0;
    const total = progress?.total ?? info.asset?.size ?? 0;
    const percent = progress?.percent ?? 0;
    return (
      <div className={cn('mt-3 flex flex-col gap-2', className)}>
        <span className="sr-only" aria-live="polite">
          {phase === 'verifying'
            ? t('shell.update.verifyingTitle')
            : t('shell.update.downloadingAria')}
        </span>
        <div className="flex items-center justify-between gap-3 text-[11.5px]">
          <span className="text-foreground-muted">
            {phase === 'verifying'
              ? t('shell.update.verifyingIntegrity')
              : t('shell.update.progress', {
                  received: formatBytes(received),
                  total: formatBytes(total),
                })}
          </span>
          <span className="font-mono tabular-nums text-foreground-muted">
            {phase === 'verifying' ? '—' : `${Math.round(percent)}%`}
          </span>
        </div>
        <ProgressBar
          value={phase === 'verifying' ? null : percent}
          label={t('shell.update.downloadLabel')}
          size="sm"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] tabular-nums text-foreground-subtle">
            {phase === 'downloading' && progress
              ? t('shell.update.speed', { speed: formatBytes(progress.bytesPerSec) })
              : t('shell.update.keepOpen')}
          </span>
          {phase === 'downloading' ? (
            <Button size="sm" variant="ghost" onClick={() => void cancelDownload()}>
              {t('actions.cancel')}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (phase === 'installing') {
    return (
      <div className={cn('mt-3', className)}>
        <Button size="md" className="w-full" loading>
          {selfInstall
            ? t('shell.update.installingManaged')
            : t('shell.update.installing')}
        </Button>
      </div>
    );
  }

  if (phase === 'ready' && downloaded) {
    return (
      <div className={cn('mt-3 flex flex-col gap-2', className)}>
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-success">
          <ShieldCheck className="size-3.5" strokeWidth={1.75} />
          {t('shell.update.verified')}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="md"
            className="flex-1"
            leftIcon={<CheckCircle2 className="size-4" strokeWidth={1.75} />}
            onClick={() => void install()}
          >
            {installLabel(kind, managed)}
          </Button>
          <Button size="md" variant="secondary" onClick={() => void reveal()}>
            {t('shell.update.openFolder')}
          </Button>
        </div>
        {error && errorScope === 'install' ? <ErrorBox /> : null}
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          {installHint(kind, managed, info.latestVersion)}
        </p>
      </div>
    );
  }

  if (!info.asset) {
    return (
      <div className={cn('mt-3 flex flex-col gap-2', className)}>
        <p className="text-[11.5px] leading-relaxed text-foreground-muted">
          {t('shell.update.noAsset')}
        </p>
        <Button
          size="md"
          variant="secondary"
          className="w-full"
          rightIcon={<ExternalLink className="size-3.5" strokeWidth={1.75} />}
          onClick={() => void openExternalUrl(info.htmlUrl)}
        >
          {t('shell.update.viewGithub')}
        </Button>
      </div>
    );
  }

  const checking = phase === 'checking';
  return (
    <div className={cn('mt-3', className)}>
      {error && errorScope === 'download' ? <ErrorBox /> : null}
      <Button
        size="md"
        className="mt-1 w-full"
        loading={checking}
        disabled={checking}
        onClick={() => void startDownload()}
      >
        {errorScope === 'download' && error ? t('actions.retry') : primaryLabel(kind)}
      </Button>
      <p className="mt-2 text-[11px] leading-relaxed text-foreground-subtle">
        {formatBytes(info.asset.size)} · {info.asset.platformLabel} · SHA-256
      </p>
    </div>
  );
}

export function UpdatePopoverBody({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common');
  const info = useUpdateStore((state) => state.info);
  const preferences = useUpdateStore((state) => state.preferences);
  const phase = useUpdateStore((state) => state.phase);
  const notes = useUpdateStore((state) =>
    info ? state.notes[info.latestVersion] : undefined,
  );
  const notesLoading = useUpdateStore((state) => state.notesLoading);
  const check = useUpdateStore((state) => state.check);
  const skip = useUpdateStore((state) => state.skip);
  const errorScope = useUpdateStore((state) => state.errorScope);

  if (!info) {
    const checking = phase === 'checking';
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-hover text-foreground-muted">
            {checking ? (
              <Loader2 className="size-[18px] animate-spin motion-reduce:animate-none" strokeWidth={1.75} />
            ) : (
              <CheckCircle2 className="size-[18px]" strokeWidth={1.75} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold tracking-tight text-foreground">
              {checking ? t('shell.update.checkingPanelTitle') : t('shell.update.upToDate')}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-foreground-muted">
              {checking
                ? t('shell.update.checkingPanelDescription')
                : t('shell.update.upToDateDescription')}
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('actions.close')}
        </Button>
      </div>
    );
  }

  const checkedAt = updateCheckedLabel(preferences.lastCheckAt);
  const released = releasedLabel(info.releasedAt);
  const notesText = notes?.notes ? plainNotes(notes.notes) : null;
  const loadingNotes = notesLoading === info.latestVersion;
  const checking = phase === 'checking';
  const stale = info.stale || errorScope === 'check';

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <ArrowUpCircle className="size-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold tracking-tight text-foreground">
            {t('shell.update.newVersion')}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-foreground-muted">
            {info.releaseName}
            {released ? ` · ${released}` : ''}
          </p>
        </div>
        <Badge tone="accent" size="sm">
          {t('shell.update.newBadge')}
        </Badge>
      </div>

      {stale ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-[11px] leading-relaxed text-foreground-muted">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p>{t('shell.update.stale')}</p>
            <button
              type="button"
              onClick={() => void check({ force: true })}
              className="mt-1 inline-flex items-center gap-1 font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <RefreshCw className={cn('size-3', checking && 'animate-spin')} strokeWidth={1.75} />
              {t('shell.update.verifyAgain')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 border-t border-border pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
          {t('shell.update.whatsNew')}
        </p>
        {loadingNotes ? (
          <div className="mt-2 flex flex-col gap-1.5" aria-label={t('shell.update.loadingNotes')}>
            <span className="h-2.5 w-11/12 animate-pulse rounded bg-surface-hover motion-reduce:animate-none" />
            <span className="h-2.5 w-3/4 animate-pulse rounded bg-surface-hover motion-reduce:animate-none" />
            <span className="h-2.5 w-2/3 animate-pulse rounded bg-surface-hover motion-reduce:animate-none" />
          </div>
        ) : notesText ? (
          <div className="mt-1.5 max-h-36 overflow-y-auto whitespace-pre-line pr-1 text-[11.5px] leading-relaxed text-foreground-muted">
            {notesText}
          </div>
        ) : (
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground-muted">
            {t('shell.update.notesFallback')}
          </p>
        )}
        <button
          type="button"
          onClick={() => void openExternalUrl(notes?.htmlUrl ?? info.htmlUrl)}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {t('shell.update.viewGithub')}
          <ExternalLink className="size-3" strokeWidth={1.75} />
        </button>
      </div>

      <UpdateActions />

      {checkedAt ? (
        <p className="mt-2 text-center text-[10.5px] text-foreground-subtle">{checkedAt}</p>
      ) : null}

      {phase !== 'downloading' && phase !== 'verifying' && phase !== 'installing' ? (
        <div className="mt-2 flex flex-col items-center gap-1 border-t border-border pt-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[11.5px] font-medium text-foreground-muted transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {t('shell.update.notNow')}
          </button>
          <button
            type="button"
            onClick={() => void skip()}
            className="rounded-md px-2 py-0.5 text-[10.5px] text-foreground-subtle transition-colors duration-150 hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {t('shell.update.skip')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
