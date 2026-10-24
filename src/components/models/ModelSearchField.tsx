import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModelSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the field. */
  ariaLabel: string;
  /** Id of the listbox controlled by this combobox. */
  controls?: string;
  /** Id of the currently active option (combobox pattern). */
  activeDescendant?: string;
  expanded?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Combobox for model lists; searchbox when the field only filters a table. */
  role?: 'combobox' | 'searchbox';
  hint?: React.ReactNode;
  className?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onClear?: () => void;
}

/**
 * Search input shared by the compact popover and the full dialog. Implements
 * the ARIA combobox contract used by `ModelList` (`aria-activedescendant`), so
 * arrow keys can move the list without leaving the field.
 */
export const ModelSearchField = React.forwardRef<HTMLInputElement, ModelSearchFieldProps>(
  function ModelSearchField(
    {
      value,
      onChange,
      ariaLabel,
      controls,
      activeDescendant,
      expanded,
      placeholder = 'Buscar modelos…',
      autoFocus = false,
      role = 'combobox',
      hint,
      className,
      onKeyDown,
      onClear,
    },
    ref,
  ) {
    return (
      <div className={cn('relative flex items-center', className)}>
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 size-3.5 text-foreground-subtle"
        />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          role={role}
          aria-expanded={expanded}
          aria-controls={controls}
          aria-activedescendant={activeDescendant}
          aria-autocomplete={role === 'combobox' ? 'list' : undefined}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            'h-9 w-full rounded-lg border border-border bg-surface pl-8 text-[13px] text-foreground',
            'placeholder:text-foreground-subtle',
            'transition-[border-color,box-shadow] duration-150',
            'focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20',
            'motion-reduce:transition-none',
            value ? 'pr-8' : hint ? 'pr-14' : 'pr-3',
          )}
        />
        {value ? (
          <button
            type="button"
            aria-label="Limpar busca"
            onClick={() => {
              onChange('');
              onClear?.();
            }}
            className={cn(
              'absolute right-0.5 flex size-8 items-center justify-center rounded-md text-foreground-subtle',
              'transition-colors duration-150 hover:bg-surface-hover hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              'motion-reduce:transition-none',
            )}
          >
            <X aria-hidden className="size-3.5" />
          </button>
        ) : hint ? (
          <span
            aria-hidden
            className="pointer-events-none absolute right-2.5 text-[10px] tabular-nums text-foreground-subtle"
          >
            {hint}
          </span>
        ) : null}
      </div>
    );
  },
);
