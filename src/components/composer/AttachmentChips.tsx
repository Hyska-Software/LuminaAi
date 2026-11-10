import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { FileIcon } from '@/components/code/FileIcon';
import { IconButton } from '@/components/ui';
import { api } from '@/lib/api';
import type { ArtifactThumbnail, AttachmentInfo } from '@/lib/types';
import { cn } from '@/lib/utils';
import { describeAttachment } from './attachmentLabels';
import { AttachmentPreviewDialog } from './AttachmentPreviewDialog';

/**
 * Tile content: the real thumbnail for images, otherwise the colored
 * file-explorer glyph (Material Icon Theme) resolved from the file name.
 */
function AttachmentTile({ attachment }: { attachment: AttachmentInfo }) {
  const [thumb, setThumb] = useState<ArtifactThumbnail | null>(null);

  useEffect(() => {
    if (attachment.kind !== 'image') return;
    let cancelled = false;
    api
      .getAttachmentThumbnail(attachment.id)
      .then((value) => {
        if (!cancelled) setThumb(value);
      })
      .catch(() => {
        /* fallback: file-explorer icon */
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.id, attachment.kind]);

  if (attachment.kind === 'image' && thumb) {
    return (
      <img
        src={`data:${thumb.mime};base64,${thumb.dataBase64}`}
        alt=""
        aria-hidden
        draggable={false}
        className="size-full object-cover"
      />
    );
  }
  return <FileIcon path={attachment.name} className="size-5" />;
}

export interface AttachmentChipsProps {
  attachments: AttachmentInfo[];
  /** When provided each chip gets a remove button (composer). */
  onRemove?: (id: string) => void;
  /** Aligns chips to the right (user bubble) or left (composer). */
  align?: 'start' | 'end';
  className?: string;
}

/** Attachment chips used above user bubbles and inside the composer. */
export function AttachmentChips({ attachments, onRemove, align = 'start', className }: AttachmentChipsProps) {
  const { t } = useTranslation('composer');
  const [previewing, setPreviewing] = useState<AttachmentInfo | null>(null);
  if (!attachments.length) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', align === 'end' ? 'justify-end' : 'justify-start', className)}>
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className={cn(
            'flex max-w-72 items-center gap-1.5 rounded-xl border border-border bg-surface-raised py-1 pl-1.5',
            onRemove ? 'pr-0.5' : 'pr-2.5',
          )}
        >
          <button
            type="button"
            onClick={() => setPreviewing(attachment)}
            aria-label={t('attachments.previewOf', { name: attachment.name })}
            title={t('attachments.preview')}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-lg text-left',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-active text-foreground-muted">
              <AttachmentTile attachment={attachment} />
            </span>
            <span className="min-w-0">
              <span className="block max-w-48 truncate text-[12px] font-medium leading-tight text-foreground">
                {attachment.name}
              </span>
              <span className="block text-[10.5px] leading-tight text-foreground-subtle">
                {describeAttachment(attachment)}
              </span>
            </span>
          </button>
          {onRemove ? (
            <IconButton
              label={t('attachments.remove', { name: attachment.name })}
              size="sm"
              variant="ghost"
              className="size-6 rounded-md"
              onClick={() => onRemove(attachment.id)}
            >
              <X className="size-3.5" />
            </IconButton>
          ) : null}
        </div>
      ))}
      {previewing ? (
        <AttachmentPreviewDialog
          attachment={previewing}
          onClose={() => setPreviewing(null)}
        />
      ) : null}
    </div>
  );
}
