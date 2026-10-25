import { Check } from 'lucide-react';
import { Kbd } from '@/components/ui';
import type { PaletteAction, TextRanges } from '@/lib/palette/types';
import { cn } from '@/lib/utils';
import { HighlightedText } from './HighlightedText';

export interface PaletteRowProps {
  id: string;
  action: PaletteAction;
  labelRanges: TextRanges;
  descriptionRanges: TextRanges;
  active: boolean;
  onActivate: () => void;
  onExecute: () => void;
  refCallback?: (element: HTMLButtonElement | null) => void;
}

/** Renders a shortcut ("Ctrl+N", "⌘+B") as individual keycaps. */
export function ShortcutHint({ shortcut }: { shortcut: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {shortcut.split('+').map((part, index) => (
        <Kbd key={`${part}-${index}`}>{part}</Kbd>
      ))}
    </span>
  );
}

/** One command option inside the palette listbox (DESIGN §10). */
export function PaletteRow({
  id,
  action,
  labelRanges,
  descriptionRanges,
  active,
  onActivate,
  onExecute,
  refCallback,
}: PaletteRowProps) {
  const Icon = action.icon;

  return (
    <button
      ref={refCallback}
      id={id}
      type="button"
      role="option"
      aria-label={action.label}
      aria-selected={active}
      aria-description={action.description}
      tabIndex={-1}
      data-palette-active={active ? 'true' : undefined}
      onPointerMove={onActivate}
      onClick={onExecute}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
        'transition-colors duration-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active ? 'bg-surface-hover' : 'hover:bg-surface-hover',
      )}
    >
      <Icon
        aria-hidden
        className={cn('size-4 shrink-0', active ? 'text-accent' : 'text-foreground-subtle')}
        strokeWidth={1.9}
      />

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground">
            <HighlightedText text={action.label} ranges={labelRanges} />
          </span>
          {action.checked ? (
            <Check aria-hidden className="size-3.5 shrink-0 text-accent" strokeWidth={2.25} />
          ) : null}
        </span>
        {action.description ? (
          <span className="mt-0.5 block truncate text-[11px] text-foreground-muted">
            <HighlightedText text={action.description} ranges={descriptionRanges} />
          </span>
        ) : null}
      </span>

      {action.shortcut ? <ShortcutHint shortcut={action.shortcut} /> : null}
    </button>
  );
}

export default PaletteRow;
