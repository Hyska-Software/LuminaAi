import { File, FileArchive, Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/lib/i18n/format';
import { cn, formatBytes } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { BinaryPreview } from './BinaryPreview';
import {
  PreviewEmpty,
  PreviewError,
  PreviewLoading,
  useArtifactPreview,
  type ArtifactViewProps,
} from './previewSupport';

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** Byte size with the locale decimal separator ("1,2 MB" in pt-BR, "1.2 MB" in en). */
export function archiveSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `${formatNumber(0)} ${SIZE_UNITS[0]}`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${formatNumber(rounded, { maximumFractionDigits: 1 })} ${SIZE_UNITS[unit]}`;
}

/**
 * ZIP preview (`api.getArtifactPreview`): summary with file count and total
 * uncompressed size, then a scrollable entry list (folders first-class). Other
 * archive formats come back as `unsupported` and use the binary card.
 */
export function ArchivePreview({ content, className }: ArtifactViewProps) {
  const { t } = useTranslation('artifacts');
  const { state, retry } = useArtifactPreview(content.artifact.id);

  if (state.status === 'loading') {
    return <PreviewLoading label={t('artifacts:archive.loading')} className={className} />;
  }
  if (state.status === 'error') {
    return <PreviewError message={state.message} onRetry={retry} className={className} />;
  }

  const preview = state.preview;
  if (!preview || preview.kind !== 'archive') {
    return (
      <BinaryPreview
        content={content}
        className={className}
        detail={
          preview?.kind === 'unsupported'
            ? preview.reason
            : t('artifacts:archive.listError')
        }
      />
    );
  }

  if (!preview.entries.length) {
    return <PreviewEmpty message={t('artifacts:archive.empty')} className={className} />;
  }

  const files = preview.entries.filter((entry) => !entry.isDir);
  const folders = preview.entries.filter((entry) => entry.isDir);
  const totalSize = files.reduce((sum, entry) => sum + Math.max(0, entry.size), 0);
  const summary = t('artifacts:archive.summary', {
    count: files.length,
    size: archiveSizeLabel(totalSize),
  });
  const directorySummary = folders.length
    ? t('artifacts:archive.directorySummary', { count: folders.length })
    : '';

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-3 py-2 text-[11px] text-foreground-muted">
        <FileArchive aria-hidden className="size-4 shrink-0 text-foreground-subtle" strokeWidth={1.8} />
        <Badge tone="neutral" size="sm">
          {preview.format.toUpperCase() || 'ZIP'}
        </Badge>
        <span className="tabular-nums" title={t('artifacts:archive.summaryTitle')}>
          {summary}
          {directorySummary}
        </span>
        {preview.truncated ? (
          <span role="status" className="ml-auto text-foreground-subtle">
            {t('artifacts:archive.showing', {
              shown: preview.entries.length,
              total: preview.totalEntries,
            })}
          </span>
        ) : null}
      </div>

      <ul
        role="list"
        aria-label={t('artifacts:archive.entriesAria')}
        className="min-h-0 flex-1 divide-y divide-border overflow-y-auto"
      >
        {preview.entries.map((entry, index) => (
          <li
            key={`${entry.name}-${index}`}
            className="flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors duration-150 hover:bg-surface-hover motion-reduce:transition-none"
          >
            {entry.isDir ? (
              <Folder
                aria-hidden
                className="size-4 shrink-0 text-foreground-subtle"
                strokeWidth={1.8}
              />
            ) : (
              <File aria-hidden className="size-4 shrink-0 text-foreground-subtle" strokeWidth={1.8} />
            )}
            <span className="min-w-0 flex-1 truncate text-foreground-muted" title={entry.name}>
              {entry.name}
            </span>
            <span
              className={cn(
                'shrink-0 tabular-nums text-[11px]',
                entry.isDir ? 'text-foreground-subtle' : 'text-foreground-muted',
              )}
            >
              {entry.isDir ? '—' : formatBytes(entry.size)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
