import { File, FileArchive, Folder } from 'lucide-react';
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

/** `formatBytes` with the pt-BR decimal comma ("1,2 MB") used in archive summaries. */
export function archiveSizeLabel(bytes: number): string {
  return formatBytes(bytes).replace('.', ',');
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * ZIP preview (`api.getArtifactPreview`): summary with file count and total
 * uncompressed size, then a scrollable entry list (folders first-class). Other
 * archive formats come back as `unsupported` and use the binary card.
 */
export function ArchivePreview({ content, className }: ArtifactViewProps) {
  const { state, retry } = useArtifactPreview(content.artifact.id);

  if (state.status === 'loading') {
    return <PreviewLoading label="Lendo arquivo compactado…" className={className} />;
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
            : 'Não foi possível listar as entradas do arquivo compactado.'
        }
      />
    );
  }

  if (!preview.entries.length) {
    return <PreviewEmpty message="Arquivo compactado vazio." className={className} />;
  }

  const files = preview.entries.filter((entry) => !entry.isDir);
  const folders = preview.entries.filter((entry) => entry.isDir);
  const totalSize = files.reduce((sum, entry) => sum + Math.max(0, entry.size), 0);
  const summary = `${pluralize(files.length, 'arquivo', 'arquivos')} · ${archiveSizeLabel(totalSize)}`;
  const directorySummary = folders.length
    ? ` · ${pluralize(folders.length, 'pasta', 'pastas')}`
    : '';

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-3 py-2 text-[11px] text-foreground-muted">
        <FileArchive aria-hidden className="size-4 shrink-0 text-foreground-subtle" strokeWidth={1.8} />
        <Badge tone="neutral" size="sm">
          {preview.format.toUpperCase() || 'ZIP'}
        </Badge>
        <span className="tabular-nums" title="Resumo do conteúdo">
          {summary}
          {directorySummary}
        </span>
        {preview.truncated ? (
          <span role="status" className="ml-auto text-foreground-subtle">
            Mostrando {preview.entries.length} de {preview.totalEntries} entradas
          </span>
        ) : null}
      </div>

      <ul
        role="list"
        aria-label="Entradas do arquivo compactado"
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
