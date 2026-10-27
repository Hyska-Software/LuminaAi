import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { cn } from '@/lib/utils';
import {
  LIBRARY_FILTERS,
  libraryFilterLabel,
  pluralizeFiles,
  type LibraryFilterId,
} from './filters';

export interface LibraryFiltersProps {
  filter: LibraryFilterId;
  counts: Record<LibraryFilterId, number>;
  onChange: (filter: LibraryFilterId) => void;
}

/**
 * Category pills (PLAN §4.2): a radio group under the header, with the count of
 * each category in the accessible name/title. Selecting a pill only filters the
 * page; a filter without matches shows the "Limpar filtros" empty state.
 */
export function LibraryFilters({ filter, counts, onChange }: LibraryFiltersProps) {
  return (
    <RadioGroupPrimitive.Root
      value={filter}
      onValueChange={(value) => onChange(value as LibraryFilterId)}
      aria-label="Filtrar biblioteca"
      orientation="horizontal"
      className="flex flex-wrap items-center gap-1.5"
    >
      {LIBRARY_FILTERS.map((definition) => {
        const count = counts[definition.id] ?? 0;
        const countLabel = `${libraryFilterLabel(definition.id)} (${pluralizeFiles(count)})`;
        return (
          <RadioGroupPrimitive.Item
            key={definition.id}
            value={definition.id}
            aria-label={countLabel}
            title={countLabel}
            className={cn(
              'inline-flex h-7 select-none items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3',
              'text-[12px] font-medium text-foreground-muted transition-colors duration-150',
              'hover:border-border-strong hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'data-[state=checked]:border-transparent data-[state=checked]:bg-accent-soft data-[state=checked]:text-accent',
              'motion-reduce:transition-none',
            )}
          >
            {definition.label}
            <span aria-hidden className="tabular-nums text-[11px] font-normal">
              {count}
            </span>
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}

export default LibraryFilters;
