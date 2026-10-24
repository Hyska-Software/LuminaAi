import type { ReactNode } from 'react';
import { Star } from 'lucide-react';
import { modelDetails } from '@/lib/modelMenu';
import type { ProviderKeyStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui';
import { CapabilityBadges } from './CapabilityBadges';
import { FamilyAvatar } from './FamilyAvatar';
import type { ModelListEntry } from '@/lib/modelMenu';

export interface ModelDetailPanelProps {
  entry: ModelListEntry | null;
  favorite: boolean;
  onFavoriteToggle: () => void;
  variant?: 'compact' | 'dialog';
  /** Thinking controls/summary rendered below the specs. */
  reasoning?: ReactNode;
  keyStatus?: ProviderKeyStatus;
  onConfigureProvider?: () => void;
  footer?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

const COMPACT_LINES = ['Contexto', 'Saída máx.', 'Custo (1M tok.)', 'Protocolo'];

const STATUS_TONES: Record<string, string> = {
  unavailable: 'bg-danger-soft text-danger',
  beta: 'bg-warning-soft text-warning',
  free: 'bg-success-soft text-success',
};

/**
 * Model summary shown next to the list: identity, capabilities, description,
 * specs, status/key warnings and the thinking slot. Shared by both surfaces so
 * the information hierarchy never diverges.
 */
export function ModelDetailPanel({
  entry,
  favorite,
  onFavoriteToggle,
  variant = 'dialog',
  reasoning,
  keyStatus,
  onConfigureProvider,
  footer,
  emptyTitle = 'Selecione um modelo',
  emptyDescription = 'Os detalhes e o modo de pensamento aparecem aqui.',
  className,
}: ModelDetailPanelProps) {
  const compact = variant === 'compact';
  const details = entry ? modelDetails(entry.model, entry.providerName) : null;

  if (!entry || !details) {
    return (
      <div
        className={cn(
          'flex h-full flex-col items-center justify-center gap-1.5 px-5 text-center',
          className,
        )}
      >
        <p className="text-[13px] font-medium text-foreground">{emptyTitle}</p>
        <p className="text-xs leading-relaxed text-foreground-muted">{emptyDescription}</p>
      </div>
    );
  }

  const { model } = entry;
  const lines = compact
    ? details.lines.filter((line) => COMPACT_LINES.includes(line.label))
    : details.lines;
  const statusTone = STATUS_TONES[model.status];

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-2.5">
        <FamilyAvatar family={model.family} name={model.name} size={compact ? 26 : 32} />
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              'truncate font-semibold tracking-tight text-foreground',
              compact ? 'text-[12.5px]' : 'text-[14px]',
            )}
            title={model.name}
          >
            {model.name}
          </h3>
          <p className="mt-0.5 truncate text-[11px] text-foreground-subtle" title={model.id}>
            {entry.providerName} · {model.id}
          </p>
        </div>
        <IconButton
          label={
            favorite ? `Remover ${model.name} dos favoritos` : `Favoritar ${model.name}`
          }
          size="sm"
          active={favorite}
          onClick={onFavoriteToggle}
          className={cn(
            'shrink-0',
            favorite ? 'text-warning hover:text-warning' : 'text-foreground-subtle',
          )}
        >
          <Star aria-hidden className={cn('size-3.5', favorite && 'fill-current')} />
        </IconButton>
      </header>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-y-auto px-3',
          compact ? 'gap-2 py-2.5' : 'gap-3.5 py-3.5',
        )}
      >
        <div className="flex flex-wrap items-center gap-1">
          <CapabilityBadges model={model} max={compact ? 3 : 6} />
          {statusTone && details.statusNote ? (
            <span
              className={cn(
                'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
                statusTone,
              )}
              title={details.statusNote}
            >
              {model.status === 'unavailable'
                ? 'Indisponível'
                : model.status === 'free'
                  ? 'Grátis'
                  : 'Preview'}
            </span>
          ) : null}
        </div>

        {details.description ? (
          <p
            className={cn(
              'text-[11.5px] leading-relaxed text-foreground-muted',
              compact && 'line-clamp-3',
            )}
          >
            {details.description}
          </p>
        ) : null}

        <dl className="flex flex-col">
          {lines.map((line) => (
            <div
              key={line.label}
              className="flex items-baseline justify-between gap-2 border-b border-border py-1 last:border-b-0"
            >
              <dt className="shrink-0 text-[11px] text-foreground-subtle">{line.label}</dt>
              <dd
                className="min-w-0 truncate text-right text-[11.5px] font-medium tabular-nums text-foreground"
                title={line.value}
              >
                {line.value}
              </dd>
            </div>
          ))}
        </dl>

        {reasoning ? <div className="shrink-0">{reasoning}</div> : null}

        {keyStatus && !keyStatus.hasKey ? (
          <div className="rounded-lg bg-warning-soft px-2.5 py-2 text-[11px] leading-relaxed text-warning">
            <p>Sem chave de API para {entry.providerName}. Configure em Configurações › Provedores.</p>
            {onConfigureProvider ? (
              <button
                type="button"
                onClick={onConfigureProvider}
                className="mt-1 font-medium underline underline-offset-2 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none"
              >
                Configurar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {footer ? (
        <div className="shrink-0 border-t border-border px-3 py-2">{footer}</div>
      ) : null}
    </div>
  );
}
