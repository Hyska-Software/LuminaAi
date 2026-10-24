import { useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, SlidersHorizontal, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReasoningSelection } from '@/lib/types';
import { defaultReasoningFor, getModel, getProvider, reasoningUi } from '@/lib/catalog';
import {
  buildEffortMenu,
  buildModelMenu,
  effortSegmentLabel,
  modelDetails,
  reasoningForModel,
  type EffortMenuItem,
} from '@/lib/modelMenu';
import { useAppStore, useUiStore } from '@/lib/store';
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui';
import { FamilyAvatar } from './FamilyAvatar';

export interface ModelPillProps {
  /** Overrides the store selection (useful for previews/secondary surfaces). */
  providerId?: string;
  modelId?: string;
  reasoning?: ReasoningSelection | null;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
  /** Opens the full model dialog (invoked by "Ver todos os modelos…"). */
  onClick?: () => void;
}

type Stage = 'model' | 'thinking';

/**
 * Compact model selector (DESIGN §7 default), a two-step dropdown:
 * 1. the list shows the available models (hover reveals the model details);
 * 2. picking a model switches the same dropdown to the thinking-mode list;
 * 3. "Ver todos os modelos…" at the bottom of the list opens the full dialog.
 * The thinking label on the pill is a shortcut straight to step 2.
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
  const favorites = useAppStore((state) => state.favorites);
  const setSelection = useAppStore((state) => state.setSelection);
  const setReasoning = useAppStore((state) => state.setReasoning);

  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('model');
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);

  const pid = providerId ?? selection.providerId;
  const mid = modelId ?? selection.modelId;
  const model = getModel(pid, mid);
  const provider = getProvider(pid);

  const effectiveReasoning: ReasoningSelection | null =
    reasoning !== undefined
      ? reasoning
      : providerId && modelId
        ? defaultReasoningFor(model)
        : selection.reasoning;

  const name = model?.name ?? mid ?? 'Selecionar modelo';
  const reasoningSupported = Boolean(model && reasoningUi(model).supported);
  const effortText = effortSegmentLabel(model, effectiveReasoning);

  const modelGroups = provider ? buildModelMenu(provider, mid, favorites) : [];
  const effortItems = buildEffortMenu(model, effectiveReasoning);

  const hoveredModel = hoveredModelId ? getModel(pid, hoveredModelId) : model;
  const details = useMemo(
    () => modelDetails(hoveredModel, provider?.name),
    [hoveredModel, provider?.name],
  );

  const openFullPicker = () => {
    if (disabled) return;
    setOpen(false);
    if (onClick) {
      onClick();
      return;
    }
    useUiStore.getState().setModelPickerOpen(true);
  };

  const handleModelSelect = (nextModelId: string) => {
    const nextModel = getModel(pid, nextModelId);
    if (!nextModel) return;
    if (nextModelId !== mid) {
      const nextReasoning = reasoningForModel(nextModel, effectiveReasoning);
      setSelection({ providerId: pid, modelId: nextModelId, reasoning: nextReasoning });
      if (nextReasoning) setReasoning(nextReasoning);
      setHoveredModelId(nextModelId);
    }
    // Continue inside the same dropdown: choose the thinking mode now.
    if (reasoningUi(nextModel).supported) {
      setStage('thinking');
    } else {
      setOpen(false);
    }
  };

  const handleEffortSelect = (item: EffortMenuItem) => {
    setOpen(false);
    if (item.kind === 'off') {
      setReasoning({ mode: 'off' });
      return;
    }
    if (item.kind === 'effort' && item.effort) {
      setReasoning({ mode: 'effort', effort: item.effort });
      return;
    }
    if (item.kind === 'budget' && item.budget) {
      setReasoning({ mode: 'budget', budget: item.budget });
    }
  };

  const openModelStage = () => {
    setStage('model');
    setHoveredModelId(mid);
    setOpen(true);
  };

  const openThinkingStage = () => {
    if (!reasoningSupported) return;
    setStage('thinking');
    setOpen(true);
  };

  return (
    <div
      className={cn(
        'no-drag inline-flex h-8 min-w-0 items-stretch overflow-hidden rounded-full border border-border bg-surface-raised',
        'text-[13px] font-medium text-foreground transition-colors duration-150',
        'focus-within:ring-2 focus-within:ring-accent/40 focus-within:ring-offset-2 focus-within:ring-offset-background',
        disabled && 'pointer-events-none opacity-60',
        compact && 'h-7 text-xs',
        className,
      )}
    >
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Selecionar modelo. Atual: ${name}`}
            disabled={disabled}
            onPointerDown={() => setStage('model')}
            className={cn(
              'flex min-w-0 items-center gap-1.5 rounded-l-full pl-1 pr-1.5',
              'transition-colors hover:bg-surface-hover focus-visible:outline-none',
              'disabled:cursor-not-allowed',
              compact && 'gap-1 pl-0.5 pr-1',
            )}
          >
            <FamilyAvatar family={model?.family} name={name} size={compact ? 18 : 20} />
            <span className={cn('truncate', compact ? 'max-w-24' : 'max-w-36')}>{name}</span>
            <ChevronDown aria-hidden className="size-3 shrink-0 text-foreground-subtle" />
          </button>
        </DropdownMenuTrigger>

        <span aria-hidden className="my-1.5 w-px shrink-0 bg-border" />

        <button
          type="button"
          disabled={disabled || !reasoningSupported || effortItems.length === 0}
          aria-label={`Selecionar modo de pensamento. Atual: ${effortText}`}
          onClick={openThinkingStage}
          className={cn(
            'flex items-center gap-1 rounded-r-full px-1.5',
            'transition-colors hover:bg-surface-hover focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:hover:bg-transparent',
            open && stage === 'thinking' && 'bg-surface-hover',
          )}
        >
          <Sparkles
            aria-hidden
            className={cn(
              'size-3 shrink-0',
              reasoningSupported ? 'text-accent' : 'text-foreground-subtle',
            )}
          />
          <span
            className={cn(
              'truncate text-[12px] font-normal',
              reasoningSupported ? 'text-foreground-muted' : 'text-foreground-subtle',
              compact && 'hidden',
            )}
          >
            {effortText}
          </span>
          <ChevronDown aria-hidden className="size-3 shrink-0 text-foreground-subtle" />
        </button>

        <DropdownMenuContent
          align="start"
          className={cn('p-0', stage === 'model' ? 'w-[35rem] max-w-[calc(100vw-2rem)]' : 'w-64')}
          aria-label={stage === 'model' ? 'Selecionar modelo' : 'Modo de pensamento'}
        >
          {stage === 'model' ? (
            <div className="flex max-h-[25rem]">
              <div className="w-64 shrink-0 overflow-y-auto p-1">
                <DropdownMenuLabel className="flex items-center justify-between gap-2">
                  <span>Modelos</span>
                  <span className="text-[10px] normal-case tracking-normal text-foreground-subtle">
                    {provider?.shortName ?? pid}
                  </span>
                </DropdownMenuLabel>
                {modelGroups.map((group, index) => (
                  <div key={group.label}>
                    {index > 0 ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                    {group.items.map((item) => (
                      <DropdownMenuItem
                        key={`${item.providerId}:${item.modelId}`}
                        checked={item.current}
                        onSelect={(event) => {
                          // Keep the dropdown open: the same panel then shows the
                          // thinking-mode list for the model we just picked.
                          event.preventDefault();
                          handleModelSelect(item.modelId);
                        }}
                        onPointerEnter={() => setHoveredModelId(item.modelId)}
                        onPointerLeave={() => setHoveredModelId(mid)}
                        onFocus={() => setHoveredModelId(item.modelId)}
                        className={cn(item.current && 'font-medium')}
                      >
                        {item.name}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
                {modelGroups.length === 0 ? (
                  <div className="px-2 py-3 text-[12px] text-foreground-subtle">
                    Nenhum modelo disponível.
                  </div>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<SlidersHorizontal />} onSelect={openFullPicker}>
                  Ver todos os modelos…
                </DropdownMenuItem>
              </div>

              <div
                className="hidden w-[15.5rem] shrink-0 overflow-y-auto border-l border-border bg-surface/40 p-3 sm:block"
                aria-live="polite"
              >
                {details ? (
                  <div className="flex flex-col gap-2.5">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold leading-tight text-foreground">
                        {details.name}
                      </p>
                      {details.description ? (
                        <p className="mt-1 line-clamp-3 text-[11.5px] leading-relaxed text-foreground-muted">
                          {details.description}
                        </p>
                      ) : null}
                    </div>
                    {details.badges.length ? (
                      <div className="flex flex-wrap gap-1">
                        {details.badges.slice(0, 4).map((badge) => (
                          <Badge key={badge} tone="neutral" size="sm">
                            {badge}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <dl className="flex flex-col gap-1">
                      {details.lines.map((line) => (
                        <div key={line.label} className="flex items-baseline justify-between gap-2">
                          <dt className="shrink-0 text-[11px] text-foreground-subtle">
                            {line.label}
                          </dt>
                          <dd className="min-w-0 truncate text-right text-[11.5px] font-medium tabular-nums text-foreground-muted">
                            {line.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="p-1">
              <div className="flex items-center gap-1.5 px-1 pb-1">
                <button
                  type="button"
                  aria-label="Voltar para a lista de modelos"
                  onClick={() => setStage('model')}
                  className="flex size-6 items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none"
                >
                  <ChevronLeft aria-hidden className="size-3.5" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium leading-tight text-foreground">
                    Modo de pensamento
                  </p>
                  <p className="truncate text-[11px] text-foreground-subtle">{name}</p>
                </div>
                <Sparkles aria-hidden className="size-3.5 shrink-0 text-accent" />
              </div>
              <DropdownMenuSeparator />
              {effortItems.map((item) => (
                <DropdownMenuItem
                  key={`${item.kind}:${item.effort ?? item.budget ?? 'off'}`}
                  checked={item.current}
                  onSelect={() => handleEffortSelect(item)}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
              {effortItems.length === 0 ? (
                <div className="px-2 py-3 text-[12px] text-foreground-subtle">
                  Este modelo não expõe controle de raciocínio.
                </div>
              ) : null}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
