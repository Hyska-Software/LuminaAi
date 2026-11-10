import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import type { ArtifactThumbnail, LibraryArtifact } from '@/lib/types';
import { cn } from '@/lib/utils';
import { artifactKindMeta } from '@/components/artifacts/kinds';

type ThumbnailState =
  | { status: 'loading' }
  | { status: 'ready'; thumbnail: ArtifactThumbnail }
  | { status: 'unavailable' };

export interface LibraryThumbnailProps {
  artifact: LibraryArtifact;
  className?: string;
}

/**
 * Lazy card thumbnail for image artifacts (PLAN §4.2): the 512px PNG comes from
 * `get_artifact_thumbnail` only for `kind === 'image'`; any failure (or a
 * non-image) falls back to the big kind icon, so a card never shows a broken
 * preview surface.
 */
export function LibraryThumbnail({ artifact, className }: LibraryThumbnailProps) {
  const { t } = useTranslation('library');
  const meta = artifactKindMeta(artifact.kind);
  const Icon = meta.icon;
  const isImage = artifact.kind === 'image';
  const [state, setState] = useState<ThumbnailState>({ status: isImage ? 'loading' : 'unavailable' });

  useEffect(() => {
    if (artifact.kind !== 'image') {
      setState({ status: 'unavailable' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    api
      .getArtifactThumbnail(artifact.id)
      .then((thumbnail) => {
        if (cancelled) return;
        setState(thumbnail ? { status: 'ready', thumbnail } : { status: 'unavailable' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.id, artifact.kind]);

  if (state.status === 'ready') {
    const { mime, dataBase64 } = state.thumbnail;
    return (
      <img
        src={`data:${mime};base64,${dataBase64}`}
        alt={t('library:card.thumbnailAlt', { name: artifact.name })}
        draggable={false}
        className={cn('size-full object-cover', className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        'flex size-full items-center justify-center',
        meta.tone,
        'bg-transparent',
        state.status === 'loading' && 'animate-pulse motion-reduce:animate-none',
        className,
      )}
    >
      {state.status === 'loading' ? (
        <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
      ) : (
        <Icon className="size-9" strokeWidth={1.5} />
      )}
    </span>
  );
}

export default LibraryThumbnail;
