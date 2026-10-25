import { useState, type SyntheticEvent } from 'react';
import { Clock, Music } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { BinaryPreview } from './BinaryPreview';
import type { ArtifactViewProps } from './previewSupport';

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  weba: 'audio/webm',
  mid: 'audio/midi',
  midi: 'audio/midi',
  amr: 'audio/amr',
};

const AUDIO_FORMAT_BY_EXTENSION: Record<string, string> = {
  mp3: 'MP3',
  wav: 'WAV',
  ogg: 'OGG',
  oga: 'OGG',
  opus: 'OPUS',
  m4a: 'M4A',
  aac: 'AAC',
  flac: 'FLAC',
  weba: 'WEBM',
  mid: 'MIDI',
  midi: 'MIDI',
  amr: 'AMR',
};

const AUDIO_FORMAT_BY_MIME: Record<string, string> = {
  'audio/mpeg': 'MP3',
  'audio/mp3': 'MP3',
  'audio/wav': 'WAV',
  'audio/x-wav': 'WAV',
  'audio/wave': 'WAV',
  'audio/ogg': 'OGG',
  'audio/opus': 'OPUS',
  'audio/mp4': 'M4A',
  'audio/x-m4a': 'M4A',
  'audio/aac': 'AAC',
  'audio/flac': 'FLAC',
  'audio/x-flac': 'FLAC',
  'audio/webm': 'WEBM',
  'audio/midi': 'MIDI',
  'audio/x-midi': 'MIDI',
  'audio/amr': 'AMR',
};

export const LARGE_MEDIA_DETAIL =
  'Arquivo grande demais para reprodução inline; use Abrir/Salvar.';

export function mediaExtension(name?: string | null): string | null {
  if (!name) return null;
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** Human-readable media container label (MP3/WAV/MP4/WEBM/…). */
export function mediaFormatLabel(
  mimeType: string | null | undefined,
  name: string | null | undefined,
  table: { byExt: Record<string, string>; byMime: Record<string, string> },
  fallback: string,
): string {
  const extension = mediaExtension(name);
  if (extension && table.byExt[extension]) return table.byExt[extension];
  const mime = mimeType?.trim().toLowerCase();
  if (mime && table.byMime[mime]) return table.byMime[mime];
  if (extension) return extension.toUpperCase();
  if (mime) {
    const subtype = mime.split('/')[1];
    if (subtype) return subtype.toUpperCase();
  }
  return fallback;
}

/** `1:15`, `12:04` or `1:02:03`; `null` while the duration is unknown. */
export function mediaDurationLabel(seconds?: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const paddedRest = rest.toString().padStart(2, '0');
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${paddedRest}`;
  return `${minutes}:${paddedRest}`;
}

function audioMimeType(mimeType: string | null | undefined, name: string | null | undefined): string {
  const mime = mimeType?.trim().toLowerCase();
  if (mime && mime.startsWith('audio/')) return mime;
  const extension = mediaExtension(name);
  if (extension && AUDIO_MIME_BY_EXTENSION[extension]) return AUDIO_MIME_BY_EXTENSION[extension];
  return 'audio/mpeg';
}

function audioDataUrl(mimeType: string, payload: string): string {
  if (payload.startsWith('data:')) return payload;
  return `data:${mimeType};base64,${payload}`;
}

/**
 * Audio preview: the native `<audio controls>` player fed by the content data
 * URI, with format/size/duration metadata. Files above the inline cap arrive
 * without a payload and fall back to the binary card.
 */
export function AudioPreview({ content, className }: ArtifactViewProps) {
  const { artifact, dataBase64, content: text } = content;
  const [duration, setDuration] = useState<number | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const inlinePayload =
    dataBase64 && !dataBase64.startsWith('data:')
      ? dataBase64
      : dataBase64?.startsWith('data:')
        ? dataBase64
        : text && /^data:audio\//i.test(text)
          ? text
          : null;

  if (!inlinePayload) {
    return <BinaryPreview content={content} className={className} detail={LARGE_MEDIA_DETAIL} />;
  }
  if (mediaError) {
    return <BinaryPreview content={content} className={className} detail={mediaError} />;
  }

  const mime = audioMimeType(artifact.mimeType, artifact.name);
  const src = audioDataUrl(mime, inlinePayload);
  const format = mediaFormatLabel(
    artifact.mimeType,
    artifact.name,
    { byExt: AUDIO_FORMAT_BY_EXTENSION, byMime: AUDIO_FORMAT_BY_MIME },
    'ÁUDIO',
  );
  const durationLabel = mediaDurationLabel(duration);

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLAudioElement>) => {
    setDuration(event.currentTarget.duration);
  };

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-3 py-2 text-[11px] text-foreground-muted">
        <Music aria-hidden className="size-4 shrink-0 text-foreground-subtle" strokeWidth={1.8} />
        <Badge tone="accent" size="sm">
          {format}
        </Badge>
        <span className="tabular-nums" title="Tamanho do arquivo">
          {formatBytes(artifact.size)}
        </span>
        <span className="inline-flex items-center gap-1 tabular-nums" title="Duração do áudio">
          <Clock aria-hidden className="size-3.5 text-foreground-subtle" strokeWidth={1.8} />
          {durationLabel ?? 'Duração —'}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-surface p-6">
        <audio
          controls
          preload="metadata"
          src={src}
          aria-label={`Reprodutor de áudio de ${artifact.name}`}
          onLoadedMetadata={handleLoadedMetadata}
          onError={() =>
            setMediaError('Não foi possível reproduzir o áudio; use Abrir/Salvar.')
          }
          className="w-full max-w-md"
        />
        <p className="max-w-sm text-center text-[11px] leading-relaxed text-foreground-subtle">
          Reprodução local no player nativo.
        </p>
      </div>
    </div>
  );
}
