import { useId, useState } from 'react';
import { ChevronDown, Download, ExternalLink, FileQuestion, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { t as translate } from '@/lib/i18n';
import { cn, formatBytes } from '@/lib/utils';
import { Button, Spinner } from '@/components/ui';
import { artifactKindMeta } from './kinds';
import { HexDump } from './HexDump';
import { useArtifactPreview, type ArtifactViewProps } from './previewSupport';

async function saveArtifact(artifactId: string, name: string) {
  try {
    const path = await api.saveArtifact(artifactId, name);
    if (path) toast.success(translate('artifacts:card.saveSuccess'), { description: path });
  } catch (error) {
    toast.error(translate('artifacts:card.saveError'), {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

async function openArtifact(artifactId: string) {
  try {
    await api.openArtifact(artifactId);
  } catch (error) {
    toast.error(translate('artifacts:card.openError'), {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface BinaryPreviewProps extends ArtifactViewProps {
  /** Extra explanation shown under the metadata (e.g. the backend "unsupported" reason). */
  detail?: string;
  /** Optional retry for failed previews (binary artifacts only). */
  onRetry?: () => void;
}

function ArtifactActions({
  content,
  onRetry,
  showArtifactActions = true,
}: {
  content: ArtifactViewProps['content'];
  onRetry?: () => void;
  showArtifactActions?: boolean;
}) {
  const { t } = useTranslation('artifacts');
  const { artifact } = content;
  if (!showArtifactActions && !onRetry) return null;
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {showArtifactActions ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Download className="size-3.5" />}
            onClick={() => void saveArtifact(artifact.id, artifact.name)}
          >
            {t('artifacts:binary.saveAs')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<ExternalLink className="size-3.5" />}
            onClick={() => void openArtifact(artifact.id)}
          >
            {t('artifacts:binary.open')}
          </Button>
        </>
      ) : null}
      {onRetry ? (
        <Button size="sm" variant="ghost" leftIcon={<RotateCcw className="size-3.5" />} onClick={onRetry}>
          {t('artifacts:binary.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/** Static card shared by every artifact the panel cannot render. */
function BinaryFallbackCard({
  content,
  className,
  detail,
  onRetry,
  showArtifactActions = true,
}: ArtifactViewProps & { detail?: string; onRetry?: () => void }) {
  const { t } = useTranslation('artifacts');
  const { artifact } = content;
  const meta = artifactKindMeta(artifact.kind);

  return (
    <div className={cn('flex h-full items-center justify-center p-6', className)}>
      <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border border-border bg-surface-raised p-6 text-center">
        <span className={cn('flex size-12 items-center justify-center rounded-xl', meta.tone)}>
          <FileQuestion aria-hidden className="size-6" strokeWidth={1.8} />
        </span>
        <div>
          <p className="text-[13px] font-medium text-foreground">{artifact.name}</p>
          <p className="mt-0.5 text-[11px] text-foreground-subtle">
            {t('artifacts:binary.subtitleUnavailable', {
              kind: meta.label,
              size: formatBytes(artifact.size),
            })}
          </p>
          {detail ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-foreground-muted">{detail}</p>
          ) : null}
        </div>
        <ArtifactActions
          content={content}
          onRetry={onRetry}
          showArtifactActions={showArtifactActions}
        />
      </div>
    </div>
  );
}

/**
 * Binary-file preview: keeps the save/open card and, when the backend can sniff
 * the file, adds a collapsible "Primeiros N bytes" hexdump. The card is always
 * rendered for `kind === 'binary'`, so it doubles as the loading/fallback state.
 */
function BinaryArtifactPreview({
  content,
  className,
  detail,
  onRetry,
  showArtifactActions = true,
}: BinaryPreviewProps) {
  const { t } = useTranslation('artifacts');
  const { artifact } = content;
  const { state, retry } = useArtifactPreview(artifact.id);
  const [expanded, setExpanded] = useState(true);
  const hexdumpId = useId();
  const meta = artifactKindMeta(artifact.kind);

  const preview = state.status === 'ready' && state.preview?.kind === 'binary' ? state.preview : null;
  const unsupportedReason =
    state.status === 'ready' && state.preview?.kind === 'unsupported' ? state.preview.reason : null;
  const errorMessage = state.status === 'error' ? state.message : null;
  const retryAction = onRetry ?? (errorMessage ? retry : undefined);
  const problem =
    detail ??
    unsupportedReason ??
    (errorMessage ? t('artifacts:binary.readError', { message: errorMessage }) : null);

  return (
    <div className={cn('flex h-full flex-col items-center gap-3 overflow-auto p-4', className)}>
      <div className="flex w-full max-w-md shrink-0 flex-col items-center gap-3 rounded-2xl border border-border bg-surface-raised p-6 text-center">
        <span className={cn('flex size-12 items-center justify-center rounded-xl', meta.tone)}>
          <FileQuestion aria-hidden className="size-6" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 max-w-full">
          <p className="truncate text-[13px] font-medium text-foreground" title={artifact.name}>
            {artifact.name}
          </p>
          <p className="mt-0.5 text-[11px] text-foreground-subtle">
            {preview
              ? t('artifacts:binary.subtitleWithFormat', {
                  kind: meta.label,
                  format: preview.format,
                  size: formatBytes(artifact.size),
                })
              : t('artifacts:binary.subtitleUnavailable', {
                  kind: meta.label,
                  size: formatBytes(artifact.size),
                })}
          </p>
          {problem ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-foreground-muted">{problem}</p>
          ) : null}
          {state.status === 'loading' ? (
            <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-foreground-subtle">
              <Spinner size="xs" label={t('artifacts:binary.readingBytes')} />
              {t('artifacts:binary.readingBytesEllipsis')}
            </span>
          ) : null}
        </div>
        <ArtifactActions
          content={content}
          onRetry={retryAction}
          showArtifactActions={showArtifactActions}
        />
      </div>

      {preview ? (
        <section className="w-full max-w-2xl shrink-0" aria-label={t('artifacts:binary.firstBytesAria')}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={hexdumpId}
            onClick={() => setExpanded((value) => !value)}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-left transition-colors duration-150',
              'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              'motion-reduce:transition-none',
            )}
          >
            <ChevronDown
              aria-hidden
              strokeWidth={1.8}
              className={cn('size-4 shrink-0 text-foreground-subtle transition-transform duration-150', {
                '-rotate-90': !expanded,
              })}
            />
            <span className="text-[12px] font-medium text-foreground">
              {t('artifacts:binary.firstBytes', { count: preview.previewBytes })}
            </span>
            <span className="ml-auto truncate text-[11px] text-foreground-subtle">
              {t('artifacts:binary.totalSize', { size: formatBytes(artifact.size) })}
            </span>
          </button>
          {expanded ? (
            <div id={hexdumpId} className="mt-2">
              <HexDump
                base64={preview.previewBase64}
                maxBytes={preview.previewBytes}
                label={t('artifacts:binary.hexdumpLabel', {
                  count: preview.previewBytes,
                  name: artifact.name,
                })}
              />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Last-resort card for artifacts the panel cannot render. Binary artifacts also
 * load `api.getArtifactPreview` and show the detected format plus a hexdump;
 * PDF/Office/Markdown fallbacks keep the plain card (and never double-fetch the
 * preview, which their own component already loaded).
 */
export function BinaryPreview({ content, className, detail, onRetry, showArtifactActions }: BinaryPreviewProps) {
  if (content.artifact.kind === 'binary') {
    return (
      <BinaryArtifactPreview
        content={content}
        className={className}
        detail={detail}
        onRetry={onRetry}
        showArtifactActions={showArtifactActions}
      />
    );
  }
  return (
    <BinaryFallbackCard
      content={content}
      className={className}
      detail={detail}
      onRetry={onRetry}
      showArtifactActions={showArtifactActions}
    />
  );
}
