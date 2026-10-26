import * as React from 'react';
import { Check, Star } from 'lucide-react';
import { formatContextWindow, formatPrice } from '@/lib/catalog';
import { modelKey, type ModelListEntry } from '@/lib/modelMenu';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { CapabilityBadges } from './CapabilityBadges';
import { FamilyAvatar } from './FamilyAvatar';

export interface ModelRowProps {
  entry: ModelListEntry;
  /** DOM id of the option (used by `aria-activedescendant`). */
  id: string;
  /** Highlighted by hover or keyboard navigation. */
  active: boolean;
  /** The committed selection (check icon). */
  selected: boolean;
  variant?: 'compact' | 'dialog';
  /** Shows the provider short name (global search results). */
  showProvider?: boolean;
  onActivate: () => void;
  /** Single click / Enter: preview (dialog) or pick (pill). */
  onPick: () => void;
  /** Double click (dialog commits without the footer button). */
  onCommit?: () => void;
  onFavoriteToggle?: () => void;
  className?: string;
}

/** Stable DOM id for an option inside a given listbox. */
export function modelOptionId(listId: string, entry: ModelListEntry): string {
  const safe = modelKey(entry.providerId, entry.model.id).replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${listId}-option-${safe}`;
}

/**
 * One model row, shared by the compact popover and the full dialog.
 *
 * The row itself is a `role="option"` element (listbox pattern). The favorite
 * star is a mouse-only affordance (`tabIndex={-1}`) — keyboard users toggle
 * favorites through the detail panel, which keeps the listbox navigation pure.
 */
export const ModelRow = React.forwardRef<HTMLDivElement, ModelRowProps>(function ModelRow(
  {
    entry,
    id,
    active,
    selected,
    variant = 'dialog',
    showProvider = false,
    onActivate,
    onPick,
    onCommit,
    onFavoriteToggle,
    className,
  },
  ref,
) {
  const { model } = entry;
  const compact = variant === 'compact';
  const unavailable = model.status === 'unavailable';

  return (
    <div className={cn('group/row relative', className)}>
      <div
        ref={ref}
        id={id}
        role="option"
        aria-selected={selected}
        aria-disabled={unavailable || undefined}
        title={unavailable ? 'Indisponível no gateway — não pode ser usado.' : undefined}
        data-active={active || undefined}
        data-selected={selected || undefined}
        onMouseEnter={onActivate}
        onFocus={onActivate}
        onClick={() => {
          if (!unavailable) onPick();
        }}
        onDoubleClick={() => {
          if (!unavailable) onCommit?.();
        }}
        className={cn(
          'flex cursor-default select-none items-center rounded-lg text-left',
          'transition-colors duration-150 motion-reduce:transition-none',
          compact ? 'gap-2 py-1.5 pl-1.5 pr-8' : 'gap-2.5 py-2 pl-2 pr-9',
          active && 'bg-surface-hover',
          selected && !active && 'bg-accent-soft/60',
          unavailable && 'cursor-not-allowed opacity-55',
        )}
      >
        <FamilyAvatar family={model.family} name={model.name} size={compact ? 20 : 24} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                'truncate text-foreground',
                compact ? 'text-[12.5px] font-medium' : 'text-[13px]',
                selected && 'font-semibold',
              )}
            >
              {model.name}
            </span>
            {!compact ? (
              <>
                <CapabilityBadges model={model} max={3} className="shrink-0" />
                {model.estimated ? (
                  <Badge
                    tone="outline"
                    className="shrink-0"
                    title="Modelo listado pela sua conta: capacidades estimadas."
                  >
                    Estimado
                  </Badge>
                ) : null}
              </>
            ) : null}
          </span>
          {compact ? (
            showProvider ? (
              <span className="mt-0.5 block truncate text-[10.5px] text-foreground-subtle">
                {entry.providerShortName}
              </span>
            ) : null
          ) : (
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-foreground-subtle">
              {showProvider ? (
                <>
                  <span className="shrink-0">{entry.providerShortName}</span>
                  <span aria-hidden>·</span>
                </>
              ) : null}
              <span className="shrink-0 tabular-nums">
                {formatContextWindow(model.contextWindow)}
              </span>
              <span aria-hidden>·</span>
              <span className="truncate tabular-nums">{formatPrice(model.cost)}</span>
            </span>
          )}
        </span>
        {selected ? (
          <Check
            aria-hidden
            className={cn('shrink-0 text-accent', compact ? 'size-3.5' : 'size-4')}
            strokeWidth={2.25}
          />
        ) : null}
      </div>

      {onFavoriteToggle ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={
            entry.favorite
              ? `Remover ${model.name} dos favoritos`
              : `Favoritar ${model.name}`
          }
          aria-pressed={entry.favorite}
          title={entry.favorite ? 'Remover dos favoritos' : 'Favoritar'}
          onClick={(event) => {
            event.stopPropagation();
            onFavoriteToggle();
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className={cn(
            'absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md',
            'transition-[color,background-color,opacity] duration-150 motion-reduce:transition-none',
            'hover:bg-surface-hover hover:text-foreground',
            'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            'size-8',
            entry.favorite
              ? 'text-warning opacity-100'
              : 'text-foreground-subtle opacity-0 group-hover/row:opacity-100',
          )}
        >
          <Star
            aria-hidden
            className={cn(compact ? 'size-3' : 'size-3.5', entry.favorite && 'fill-current')}
          />
        </button>
      ) : null}
    </div>
  );
});
