import { Braces, FileText, Image, Presentation, Table, X, type LucideIcon } from 'lucide-react';
import { IconButton } from '@/components/ui';
import type { AttachmentInfo } from '@/lib/types';
import { cn, formatBytes } from '@/lib/utils';

const KIND_ICONS: Record<AttachmentInfo['kind'], LucideIcon> = {
  image: Image,
  pdf: FileText,
  docx: FileText,
  xlsx: Table,
  pptx: Presentation,
  text: FileText,
  code: Braces,
  csv: Table,
  json: Braces,
  unknown: FileText,
};

function describeAttachment(info: AttachmentInfo): string {
  const parts = [formatBytes(info.size)];
  if (info.pageCount) parts.push(`${info.pageCount} pág.`);
  if (info.width && info.height) parts.push(`${info.width}×${info.height}`);
  return parts.join(' · ');
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
  if (!attachments.length) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', align === 'end' ? 'justify-end' : 'justify-start', className)}>
      {attachments.map((attachment) => {
        const Icon = KIND_ICONS[attachment.kind] ?? FileText;
        return (
          <div
            key={attachment.id}
            className={cn(
              'flex max-w-72 items-center gap-2 rounded-xl border border-border bg-surface-raised py-1 pl-1.5',
              onRemove ? 'pr-0.5' : 'pr-2.5',
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-active text-foreground-muted">
              <Icon className="size-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block max-w-52 truncate text-[12px] font-medium leading-tight text-foreground">
                {attachment.name}
              </span>
              <span className="block text-[10.5px] leading-tight text-foreground-subtle">
                {describeAttachment(attachment)}
              </span>
            </span>
            {onRemove ? (
              <IconButton
                label={`Remover ${attachment.name}`}
                size="sm"
                variant="ghost"
                className="size-6 rounded-md"
                onClick={() => onRemove(attachment.id)}
              >
                <X className="size-3.5" />
              </IconButton>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
