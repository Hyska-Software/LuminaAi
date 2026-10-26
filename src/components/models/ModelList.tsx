import { useEffect, useRef, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { entryKey, type ModelListEntry, type ModelListGroup } from '@/lib/modelMenu';
import { cn } from '@/lib/utils';
import { ModelRow, modelOptionId } from './ModelRow';

export interface ModelListProps {
  groups: ModelListGroup[];
  /** Id of the listbox; option ids derive from it. */
  listId: string;
  ariaLabel: string;
  /** Key (`provider:model`) of the hovered/keyboard-highlighted row. */
  activeKey: string | null;
  /** Key of the committed selection. */
  selectedKey: string | null;
  onActivate: (key: string) => void;
  onPick: (entry: ModelListEntry) => void;
  onCommit?: (entry: ModelListEntry) => void;
  /** Favorites are keyed by `providerId:modelId`; the provider is always passed. */
  onFavoriteToggle?: (providerId: string, modelId: string) => void;
  variant?: 'compact' | 'dialog';
  showProvider?: boolean;
  emptyState?: ReactNode;
  className?: string;
}

function DefaultEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <Search aria-hidden className="size-5 text-foreground-subtle" />
      <p className="text-[13px] font-medium text-foreground">Nenhum modelo encontrado</p>
      <p className="text-xs text-foreground-muted">Tente outro termo ou limpe os filtros.</p>
    </div>
  );
}

/**
 * Scrollable, grouped model listbox shared by the pill popover and the dialog.
 * Keyboard handling lives in the surface (the search input is the combobox), so
 * this component only renders options and keeps the active row in view.
 */
export function ModelList({
  groups,
  listId,
  ariaLabel,
  activeKey,
  selectedKey,
  onActivate,
  onPick,
  onCommit,
  onFavoriteToggle,
  variant = 'dialog',
  showProvider = false,
  emptyState,
  className,
}: ModelListProps) {
  const optionRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!activeKey) return;
    const node = optionRefs.current.get(activeKey);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeKey]);

  if (!groups.length) {
    return <div className={cn('h-full', className)}>{emptyState ?? <DefaultEmptyState />}</div>;
  }

  return (
    <div
      role="listbox"
      id={listId}
      aria-label={ariaLabel}
      className={cn('h-full overflow-y-auto overscroll-contain py-1', className)}
    >
      {groups.map((group) => (
        <div key={group.key} role="group" aria-label={group.label}>
          <div
            aria-hidden
            className={cn(
              'sticky top-0 z-10 bg-surface-raised/95 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider',
              'text-foreground-subtle backdrop-blur',
            )}
          >
            {group.label}
          </div>
          <div className="px-1">
            {group.items.map((entry) => {
              const key = entryKey(entry);
              return (
                <ModelRow
                  key={key}
                  ref={(node) => {
                    if (node) optionRefs.current.set(key, node);
                    else optionRefs.current.delete(key);
                  }}
                  entry={entry}
                  id={modelOptionId(listId, entry)}
                  active={activeKey === key}
                  selected={selectedKey === key}
                  variant={variant}
                  showProvider={showProvider}
                  onActivate={() => onActivate(key)}
                  onPick={() => onPick(entry)}
                  onCommit={onCommit ? () => onCommit(entry) : undefined}
                  onFavoriteToggle={
                    onFavoriteToggle
                      ? () => onFavoriteToggle(entry.providerId, entry.model.id)
                      : undefined
                  }
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
