import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Check, ChevronLeft, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  thinkingNote,
  thinkingOptions,
  type ThinkingOption,
} from '@/lib/modelMenu';
import type { ModelInfo, ReasoningSelection } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface ThinkingOptionsProps {
  model: ModelInfo;
  value: ReasoningSelection | null;
  /** Id of the highlighted option. */
  activeId: string | null;
  onActiveChange: (id: string) => void;
  onSelect: (option: ThinkingOption) => void;
  /** Id of the listbox; option ids derive from it. */
  listId: string;
  /** Renders the back button to the model list. */
  onBack?: () => void;
  autoFocus?: boolean;
  className?: string;
}

/** Stable DOM id of a thinking option inside a listbox. */
export function thinkingOptionId(listId: string, optionId: string): string {
  return `${listId}-option-${optionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/**
 * Thinking-mode listbox (step 2 of the pill flow): label + explanation for each
 * mode, keyboard navigation with the listbox itself focused, and a back button
 * that returns to the model list without closing the popover.
 */
export function ThinkingOptions({
  model,
  value,
  activeId,
  onActiveChange,
  onSelect,
  listId,
  onBack,
  autoFocus = false,
  className,
}: ThinkingOptionsProps) {
  const { t } = useTranslation('models');
  const options = thinkingOptions(model, value);
  const note = thinkingNote(model);
  // Always highlight something: the requested id, the current option, or the
  // first one (budget-only models may not have a matching preset yet).
  const resolvedActiveId =
    activeId ?? options.find((option) => option.current)?.id ?? options[0]?.id ?? null;
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (autoFocus) listRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!resolvedActiveId) return;
    optionRefs.current.get(resolvedActiveId)?.scrollIntoView({ block: 'nearest' });
  }, [resolvedActiveId]);

  const move = (delta: number) => {
    if (!options.length) return;
    const index = options.findIndex((option) => option.id === resolvedActiveId);
    const next =
      index < 0
        ? delta > 0
          ? 0
          : options.length - 1
        : (index + delta + options.length) % options.length;
    onActiveChange(options[next].id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        if (options[0]) onActiveChange(options[0].id);
        break;
      case 'End':
        event.preventDefault();
        if (options.length) onActiveChange(options[options.length - 1].id);
        break;
      case 'Enter':
      case ' ': {
        const option =
          options.find((candidate) => candidate.id === resolvedActiveId) ??
          options.find((candidate) => candidate.current) ??
          options[0];
        if (option) {
          event.preventDefault();
          onSelect(option);
        }
        break;
      }
      default:
        break;
    }
  };

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center gap-1.5 px-1 pb-1.5">
        {onBack ? (
          <button
            type="button"
            aria-label={t('thinking.backToList')}
            onClick={onBack}
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md text-foreground-subtle',
              'transition-colors duration-150 hover:bg-surface-hover hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              'motion-reduce:transition-none',
            )}
          >
            <ChevronLeft aria-hidden className="size-3.5" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium leading-tight text-foreground">
            {t('thinking.modeLabel')}
          </p>
          <p className="truncate text-[11px] text-foreground-subtle" title={model.name}>
            {model.name}
          </p>
        </div>
        <Sparkles aria-hidden className="size-3.5 shrink-0 text-accent" />
      </div>

      {note ? (
        <p className="mx-1 mb-1.5 rounded-md bg-surface px-2 py-1 text-[10.5px] leading-relaxed text-foreground-muted">
          {note}
        </p>
      ) : null}

      <div
        ref={listRef}
        role="listbox"
        id={listId}
        aria-label={t('thinking.modeLabel')}
        aria-activedescendant={
          resolvedActiveId ? thinkingOptionId(listId, resolvedActiveId) : undefined
        }
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex w-full max-h-[min(17rem,calc(100dvh-14rem))] flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-lg p-0.5',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        )}
      >
        {options.map((option) => {
          const active = option.id === resolvedActiveId;
          return (
            <div
              key={option.id}
              ref={(node) => {
                if (node) optionRefs.current.set(option.id, node);
                else optionRefs.current.delete(option.id);
              }}
              id={thinkingOptionId(listId, option.id)}
              role="option"
              aria-selected={option.current}
              data-active={active || undefined}
              onMouseEnter={() => onActiveChange(option.id)}
              onClick={() => onSelect(option)}
              className={cn(
                'flex cursor-default select-none items-start gap-2 rounded-lg px-2 py-1.5',
                'transition-colors duration-150 motion-reduce:transition-none',
                active ? 'bg-surface-hover' : 'hover:bg-surface-hover/60',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[12.5px] font-medium text-foreground">
                    {option.label}
                  </span>
                  {option.current ? (
                    <Check aria-hidden className="size-3 shrink-0 text-accent" strokeWidth={2.5} />
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[10.5px] leading-relaxed text-foreground-subtle">
                  {option.description}
                </span>
              </span>
            </div>
          );
        })}

        {options.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-foreground-subtle">
            {t('thinking.empty')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
