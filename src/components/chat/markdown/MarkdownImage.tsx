import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOff } from 'lucide-react';

export interface MarkdownImageProps {
  src?: string;
  alt?: string;
  title?: string;
}

function ImageFallback({ description }: { description: string }) {
  const { t } = useTranslation('chat');
  const label = description
    ? t('image.unavailableWithDescription', { description })
    : t('image.unavailable');
  return (
    <span
      role="img"
      aria-label={label}
      className="my-2 flex w-full max-w-md flex-col items-center gap-1.5 rounded-xl border border-dashed border-border bg-surface px-4 py-6 text-center"
    >
      <ImageOff aria-hidden className="size-5 text-foreground-subtle" />
      <span className="text-[13px] font-medium text-foreground-muted">{t('image.unavailable')}</span>
      {description ? <span className="text-[12px] text-foreground-subtle">{description}</span> : null}
    </span>
  );
}

/**
 * Markdown image with a lazy-loaded, token-styled frame and an accessible
 * fallback when the source is missing (sanitizer stripped it) or the load
 * fails. Only `http(s)` sources reach this component (docs §3.1).
 */
export function MarkdownImage({ src, alt, title }: MarkdownImageProps) {
  const [failed, setFailed] = useState(false);
  const source = typeof src === 'string' ? src.trim() : '';
  const description = typeof alt === 'string' ? alt.trim() : '';

  if (!source || failed) return <ImageFallback description={description} />;

  return (
    <img
      src={source}
      alt={description}
      title={title}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="my-2 max-w-full rounded-xl border border-border"
    />
  );
}
