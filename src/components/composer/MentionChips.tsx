import { FileCode, X } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { MentionedFile } from './mentions';

export interface MentionChipsProps {
  mentions: MentionedFile[];
  /** Remove uma menção (X do chip). */
  onRemove: (path: string) => void;
  className?: string;
}

/**
 * Chips de contexto `@arquivo` acima do textarea (WORKBENCH §6). São a
 * representação visual do que será enviado como `[arquivo: path]` no turno.
 */
export function MentionChips({ mentions, onRemove, className }: MentionChipsProps) {
  if (!mentions.length) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {mentions.map((mention) => (
        <div
          key={mention.path}
          className={cn(
            'flex max-w-72 items-center gap-1.5 rounded-xl border border-border bg-surface py-1 pl-1.5 pr-0.5',
          )}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
            <FileCode aria-hidden className="size-3.5" strokeWidth={1.75} />
          </span>
          <span
            className="min-w-0 max-w-56 truncate font-mono text-[11.5px] leading-tight text-foreground"
            title={mention.path}
          >
            {mention.path}
          </span>
          <IconButton
            label={`Remover menção a ${mention.path}`}
            size="sm"
            variant="ghost"
            className="size-6 rounded-md"
            onClick={() => onRemove(mention.path)}
          >
            <X className="size-3.5" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

export default MentionChips;
