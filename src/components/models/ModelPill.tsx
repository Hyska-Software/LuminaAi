import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReasoningSelection } from '@/lib/types';
import { defaultReasoningFor, getModel, reasoningLabel, reasoningShortLabel, reasoningUi } from '@/lib/catalog';
import { useAppStore, useUiStore } from '@/lib/store';
import { Tooltip } from '@/components/ui';
import { FamilyAvatar } from './FamilyAvatar';

export interface ModelPillProps {
  /** Overrides the store selection (useful for previews/secondary surfaces). */
  providerId?: string;
  modelId?: string;
  reasoning?: ReasoningSelection | null;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
}

/**
 * Composer/titlebar pill: family avatar + model name + reasoning mode.
 * Clicking opens the model picker (DESIGN §7).
 */
export function ModelPill({
  providerId,
  modelId,
  reasoning,
  compact = false,
  disabled = false,
  className,
  onClick,
}: ModelPillProps) {
  const selection = useAppStore((state) => state.selection);
  const pid = providerId ?? selection.providerId;
  const mid = modelId ?? selection.modelId;
  const model = getModel(pid, mid);

  const effectiveReasoning =
    reasoning !== undefined
      ? reasoning
      : providerId && modelId
        ? defaultReasoningFor(model)
        : selection.reasoning;

  const name = model?.name ?? mid ?? 'Selecionar modelo';
  const showReasoning = Boolean(model && reasoningUi(model).supported);
  const reasoningText = reasoningLabel(model, effectiveReasoning);
  const reasoningShort = reasoningShortLabel(model, effectiveReasoning);

  const handleClick = () => {
    if (disabled) return;
    if (onClick) {
      onClick();
      return;
    }
    useUiStore.getState().setModelPickerOpen(true);
  };

  return (
    <Tooltip content={`${name}${showReasoning ? ` · ${reasoningText}` : ''}`} side="bottom">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label={`Modelo: ${name}. Alterar modelo`}
        className={cn(
          'no-drag inline-flex h-8 min-w-0 max-w-64 items-center gap-1.5 rounded-full border border-border bg-surface-raised pl-1 pr-2',
          'text-[13px] font-medium text-foreground transition-colors duration-150',
          'hover:border-border-strong hover:bg-surface-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none',
          compact && 'h-7 max-w-44 gap-1 pr-1.5 text-xs',
          className,
        )}
      >
        <FamilyAvatar family={model?.family} name={name} size={compact ? 18 : 20} />
        <span className={cn('truncate', compact && 'max-w-28')}>{name}</span>
        {!compact && showReasoning && reasoningShort ? (
          <span className="shrink-0 text-foreground-subtle">· {reasoningShort}</span>
        ) : null}
        {!compact ? <ChevronDown aria-hidden className="ml-0.5 size-3.5 shrink-0 text-foreground-subtle" /> : null}
      </button>
    </Tooltip>
  );
}
