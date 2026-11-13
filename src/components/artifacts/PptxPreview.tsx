import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { SlidePreview } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { BinaryPreview } from './BinaryPreview';
import {
  PreviewEmpty,
  PreviewError,
  PreviewLoading,
  useArtifactPreview,
  type ArtifactViewProps,
} from './previewSupport';

function splitSlideTexts(texts: string[]): { title: string | null; bullets: string[] } {
  const lines = texts.map((text) => text.trim()).filter((text) => text.length > 0);
  const [title = null, ...bullets] = lines;
  return { title, bullets };
}

function SlideCard({ slide, position }: { slide: SlidePreview; position: number }) {
  const { title, bullets } = splitSlideTexts(slide.texts);
  const notes = slide.notes?.trim();

  return (
    <li className="overflow-hidden rounded-xl bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-1.5">
        <span className="text-[11px] font-medium tabular-nums text-foreground-muted">
          {t('artifacts:pptx.slide', { position })}
        </span>
        {notes ? <Badge tone="muted">{t('artifacts:pptx.withNotes')}</Badge> : null}
      </div>
      <div className="flex aspect-video flex-col gap-2 overflow-auto p-5">
        <p className="text-[14px] font-semibold leading-snug text-foreground">
          {title ?? t('artifacts:pptx.slideNoText')}
        </p>
        {bullets.length ? (
          <ul className="list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-foreground-muted">
            {bullets.map((bullet, index) => (
              <li key={index}>{bullet}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {notes ? (
        <div className="border-t border-border px-3 py-2 text-[11px] leading-relaxed text-foreground-subtle">
          <span className="font-medium text-foreground-muted">{t('artifacts:pptx.notes')} </span>
          {notes}
        </div>
      ) : null}
    </li>
  );
}

/**
 * PowerPoint preview: 16:9 cards numbered in slide order, first line as the
 * title and the remaining lines as bullets. Intentionally simplified — the
 * original layout/theme is not reproduced (see the notice at the top).
 */
export function PptxPreview({ content, className }: ArtifactViewProps) {
  const { t: translate } = useTranslation('artifacts');
  const { state, retry } = useArtifactPreview(content.artifact.id);

  if (state.status === 'loading') {
    return <PreviewLoading label={translate('artifacts:pptx.loading')} className={className} />;
  }
  if (state.status === 'error') {
    return <PreviewError message={state.message} onRetry={retry} className={className} />;
  }

  const preview = state.preview;
  if (!preview || preview.kind !== 'pptx') {
    return (
      <BinaryPreview
        content={content}
        className={className}
        detail={preview?.kind === 'unsupported' ? preview.reason : undefined}
      />
    );
  }
  if (!preview.slides.length) {
    return <PreviewEmpty message={translate('artifacts:pptx.empty')} className={className} />;
  }

  return (
    <div className={cn('h-full overflow-auto bg-surface p-3', className)}>
      <p
        role="note"
        className="mb-3 flex items-start gap-2 rounded-lg bg-surface-hover px-3 py-2 text-[11px] leading-relaxed text-foreground-muted"
      >
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-foreground-subtle" />
        {translate('artifacts:pptx.simplified')}
      </p>
      <ol aria-label={translate('artifacts:pptx.slidesAria')} className="flex flex-col gap-3">
        {preview.slides.map((slide, index) => (
          <SlideCard key={`${slide.index}-${index}`} slide={slide} position={index + 1} />
        ))}
      </ol>
    </div>
  );
}
