import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { asStringArray, propArray, propObjectArray, propString, type GenUIValue } from '@/lib/genui';
import { runGenUIAction } from '@/lib/genui/actions';
import { Button, ProgressBar } from '@/components/ui';
import { genUIIcon } from './icons';

export interface GenUIChoicesProps {
  props?: Record<string, GenUIValue>;
}

interface GenUIChoiceOption {
  label: string;
  description: string;
  icon: string;
}

/** Lê `options` descartando itens sem rótulo (o validador garante ≥ 2). */
function readOptions(props: Record<string, GenUIValue> | undefined): GenUIChoiceOption[] {
  const options: GenUIChoiceOption[] = [];
  for (const raw of propObjectArray(props, 'options')) {
    const label = propString(raw, 'label').trim();
    if (!label) continue;
    options.push({ label, description: propString(raw, 'description'), icon: propString(raw, 'icon') });
  }
  return options;
}

/**
 * Grupo de escolhas interativo (`choices`).
 *
 * A interação é 100% local: o estado vive no renderer e o envio apenas
 * **preenche o composer** com `submitPrefix + labels separados por vírgula` —
 * nunca dispara um turno sozinho. Por isso não há toast no envio.
 */
export function GenUIChoices({ props }: GenUIChoicesProps) {
  const labelId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-choices-label`;
  const options = readOptions(props);
  const layout = propString(props, 'layout', 'list') === 'segmented' ? 'segmented' : 'list';
  const requestedMode = propString(props, 'mode', 'single') === 'multiple' ? 'multiple' : 'single';
  // O layout segmentado é inerentemente uma escolha única.
  const mode = layout === 'segmented' ? 'single' : requestedMode;
  const label = propString(props, 'label');
  const countLabel = propString(props, 'countLabel');
  const submitLabel = propString(props, 'submitLabel');
  const submitPrefix = propString(props, 'submitPrefix');
  const optionLabels = options.map((option) => option.label);
  const [selected, setSelected] = useState<string[]>(() => {
    const defaults = asStringArray(propArray(props, 'default')).filter((entry) => optionLabels.includes(entry));
    const unique = Array.from(new Set(defaults));
    return mode === 'single' ? unique.slice(0, 1) : unique;
  });

  if (!options.length) return null;

  const selectedLabels = options
    .filter((option) => selected.includes(option.label))
    .map((option) => option.label);
  const selectedCount = selectedLabels.length;
  const activeDescription = options.find((option) => selected.includes(option.label))?.description ?? '';

  const toggle = (optionLabel: string) => {
    setSelected((previous) => {
      if (mode === 'single') return previous.includes(optionLabel) ? previous : [optionLabel];
      return previous.includes(optionLabel)
        ? previous.filter((entry) => entry !== optionLabel)
        : [...previous, optionLabel];
    });
  };

  const submit = () => {
    if (!selectedCount) return;
    // Sempre um único espaço entre prefixo e lista, com ou sem espaço no fim.
    const prefix = submitPrefix.trimEnd() || 'Seleção:';
    void runGenUIAction({ label: submitLabel, prompt: `${prefix} ${selectedLabels.join(', ')}` });
  };

  const renderListOption = (option: GenUIChoiceOption) => {
    const isSelected = selected.includes(option.label);
    const OptionIcon = genUIIcon(option.icon);
    return (
      <button
        key={option.label}
        type="button"
        role={mode === 'single' ? 'radio' : 'checkbox'}
        aria-checked={isSelected}
        onClick={() => toggle(option.label)}
        className={cn(
          'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150',
          'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          'motion-reduce:transition-none',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex size-4 shrink-0 items-center justify-center border',
            mode === 'single' ? 'rounded-full' : 'rounded-[4px]',
            isSelected
              ? 'border-accent bg-accent text-accent-foreground'
              : 'border-border-strong bg-background text-transparent',
          )}
        >
          {isSelected ? <Check className="size-3" strokeWidth={2.5} /> : null}
        </span>
        {OptionIcon ? (
          <OptionIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
        ) : null}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block text-[12.5px]',
              isSelected ? 'font-semibold text-foreground' : 'font-medium text-foreground',
            )}
          >
            {option.label}
          </span>
          {option.description ? (
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-foreground-muted">
              {option.description}
            </span>
          ) : null}
        </span>
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-labelledby={label ? labelId : undefined}
      aria-label={label ? undefined : 'Escolhas'}
      data-selected-count={selectedCount}
      className="flex min-w-0 flex-col gap-2.5"
    >
      {label ? (
        <p id={labelId} className="text-[12.5px] font-semibold tracking-tight text-foreground">
          {label}
        </p>
      ) : null}

      {layout === 'list' ? (
        <div className="flex flex-col gap-0.5">{options.map(renderListOption)}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
            {options.map((option) => {
              const isSelected = selected.includes(option.label);
              const OptionIcon = genUIIcon(option.icon);
              return (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => toggle(option.label)}
                  className={cn(
                    'flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium',
                    'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    'motion-reduce:transition-none',
                    isSelected
                      ? 'bg-surface-raised text-foreground shadow-sm'
                      : 'text-foreground-muted hover:text-foreground',
                  )}
                >
                  {OptionIcon ? <OptionIcon aria-hidden className="size-4 shrink-0" /> : null}
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
          {activeDescription ? (
            <p className="text-[11.5px] leading-relaxed text-foreground-muted">{activeDescription}</p>
          ) : null}
        </div>
      )}

      {mode === 'multiple' && countLabel ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11.5px] text-foreground-subtle">{countLabel}</span>
            <span className="text-[11.5px] tabular-nums text-foreground-muted">
              {selectedCount}/{options.length}
            </span>
          </div>
          <ProgressBar
            value={Math.round((selectedCount / options.length) * 100)}
            size="sm"
            tone="accent"
            label={countLabel}
          />
        </div>
      ) : null}

      {submitLabel ? (
        <div className="flex justify-end">
          <Button size="sm" variant="primary" disabled={selectedCount === 0} onClick={submit}>
            {submitLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
