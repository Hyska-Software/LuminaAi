import { useState, type SyntheticEvent } from 'react';
import { Clock, Film } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { BinaryPreview } from './BinaryPreview';
import { LARGE_MEDIA_DETAIL, mediaDurationLabel, mediaExtension, mediaFormatLabel } from './AudioPreview';
import type { ArtifactViewProps } from './previewSupport';

const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
};

const VIDEO_FORMAT_BY_EXTENSION: Record<string, string> = {
  mp4: 'MP4',
  m4v: 'M4V',
  webm: 'WEBM',
  ogv: 'OGV',
  mov: 'MOV',
  mkv: 'MKV',
  avi: 'AVI',
  wmv: 'WMV',
  flv: 'FLV',
};

const VIDEO_FORMAT_BY_MIME: Record<string, string> = {
  'video/mp4': 'MP4',
  'video/webm': 'WEBM',
  'video/ogg': 'OGV',
  'video/quicktime': 'MOV',
  'video/x-matroska': 'MKV',
  'video/x-msvideo': 'AVI',
  'video/x-ms-wmv': 'WMV',
  'video/x-flv': 'FLV',
};

function videoMimeType(mimeType: string | null | undefined, name: string | null | undefined): string {
  const mime = mimeType?.trim().toLowerCase();
  if (mime && mime.startsWith('video/')) return mime;
  const extension = mediaExtension(name);
  if (extension && VIDEO_MIME_BY_EXTENSION[extension]) return VIDEO_MIME_BY_EXTENSION[extension];
  return 'video/mp4';
}

function videoDataUrl(mimeType: string, payload: string): string {
  if (payload.startsWith('data:')) return payload;
  return `data:${mimeType};base64,${payload}`;
}

/**
 * Video preview: native `<video controls playsInline>` with the content data
 * URI, over the `surface` token, plus format/size/duration metadata. More than
 * the inline cap (no payload) or a media error falls back to the binary card.
 */
export function VideoPreview({ content, className }: ArtifactViewProps) {
  const { artifact, dataBase64, content: text } = content;
  const [duration, setDuration] = useState<number | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const inlinePayload =
    dataBase64 && !dataBase64.startsWith('data:')
      ? dataBase64
      : dataBase64?.startsWith('data:')
        ? dataBase64
        : text && /^data:video\//i.test(text)
          ? text
          : null;

  if (!inlinePayload) {
    return <BinaryPreview content={content} className={className} detail={LARGE_MEDIA_DETAIL} />;
  }
  if (mediaError) {
    return <BinaryPreview content={content} className={className} detail={mediaError} />;
  }

  const mime = videoMimeType(artifact.mimeType, artifact.name);
  const src = videoDataUrl(mime, inlinePayload);
  const format = mediaFormatLabel(
    artifact.mimeType,
    artifact.name,
    { byExt: VIDEO_FORMAT_BY_EXTENSION, byMime: VIDEO_FORMAT_BY_MIME },
    'VÍDEO',
  );
  const durationLabel = mediaDurationLabel(duration);

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    setDuration(event.currentTarget.duration);
  };

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-3 py-2 text-[11px] text-foreground-muted">
        <Film aria-hidden className="size-4 shrink-0 text-foreground-subtle" strokeWidth={1.8} />
        <Badge tone="warning" size="sm">
          {format}
        </Badge>
        <span className="tabular-nums" title="Tamanho do arquivo">
          {formatBytes(artifact.size)}
        </span>
        <span className="inline-flex items-center gap-1 tabular-nums" title="Duração do vídeo">
          <Clock aria-hidden className="size-3.5 text-foreground-subtle" strokeWidth={1.8} />
          {durationLabel ?? 'Duração —'}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface p-3">
        <video
          controls
          playsInline
          preload="metadata"
          src={src}
          aria-label={`Reprodutor de vídeo de ${artifact.name}`}
          onLoadedMetadata={handleLoadedMetadata}
          onError={() =>
            setMediaError('Não foi possível reproduzir o vídeo; use Abrir/Salvar.')
          }
          className="max-h-full max-w-full rounded-lg border border-border bg-surface shadow-sm"
        />
      </div>
    </div>
  );
}
