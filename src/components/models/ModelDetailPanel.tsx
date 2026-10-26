import type { ReactNode } from 'react';
import { AlertCircle, ExternalLink, Sparkles, Star } from 'lucide-react';
import { modelDetails } from '@/lib/modelMenu';
import type { ProviderAuth, ProviderAuthStatus, ProviderKeyStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge, IconButton } from '@/components/ui';
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
  /** How the provider authenticates; `api-key` is the default. */
  providerAuth?: ProviderAuth;
  /** Auth snapshot of the provider (never contains credential material). */
  authStatus?: ProviderAuthStatus | null;
  /** True when the model is covered by the user's ChatGPT plan. */
  planUsage?: boolean;
  /** "Gerenciar uso" (opens the ChatGPT usage dashboard). */
  onManagePlan?: () => void;
  /** "Configurar" for API keys; also the fallback for the account CTA. */
  onConfigureProvider?: () => void;
  /** "Conectar conta ChatGPT" (opens Settings › Provedores). */
  onConnectAccount?: () => void;
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

/** Copy/CTA for each auth state of an OAuth provider. */
function accountPrompt(
  authState: ProviderAuthStatus['state'],
): { text: string; action: string } {
  switch (authState) {
    case 'reauth-required':
      return {
        text: 'Sua sessão do ChatGPT expirou. Entre novamente para continuar usando o plano.',
        action: 'Conectar novamente',
      };
    case 'plan-disabled':
      return {
        text: 'Sua conta ChatGPT está conectada, mas o uso do plano não está ativado para este app.',
        action: 'Ativar uso do plano',
      };
    default:
      return {
        text: 'Conecte sua conta ChatGPT para usar estes modelos com o seu plano.',
        action: 'Conectar conta ChatGPT',
      };
  }
}

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
  providerAuth = 'api-key',
  authStatus,
  planUsage = false,
  onManagePlan,
  onConfigureProvider,
  onConnectAccount,
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
  const oauthProvider = providerAuth === 'oauth';
  const authState = authStatus?.state ?? 'signed-out';
  const hasKey = Boolean(keyStatus?.hasKey);
  const accountConnected = authState === 'signed-in';
  /** Model covered by the connected ChatGPT plan: hide the per-token price. */
  const includedInPlan = oauthProvider && accountConnected && planUsage;
  const needsAccount = oauthProvider && !hasKey && !accountConnected;
  const needsPlanActivation = oauthProvider && accountConnected && !planUsage;
  const prompt = accountPrompt(authState);
  const connectAction = onConnectAccount ?? onConfigureProvider;
  // The account CTA is only useful when the settings screen can be opened.
  const showAccountCta = Boolean(connectAction);

  const lines = (compact
    ? details.lines.filter((line) => COMPACT_LINES.includes(line.label))
    : details.lines
  ).filter((line) => !(includedInPlan && line.label === 'Custo (1M tok.)'));
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
          {model.estimated ? (
            <Badge
              tone="outline"
              title="Modelo listado pela sua conta: capacidades estimadas."
            >
              Estimado
            </Badge>
          ) : null}
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

        {includedInPlan ? (
          <div className="rounded-lg bg-accent-soft px-2.5 py-2 text-[11px] leading-relaxed text-accent">
            <p className="flex items-center gap-1.5 font-medium">
              <Sparkles aria-hidden className="size-3 shrink-0" />
              Incluído no seu plano ChatGPT
            </p>
            <p className="mt-0.5 text-foreground-muted">
              O uso consome o limite compartilhado do seu plano.
            </p>
            {onManagePlan ? (
              <button
                type="button"
                onClick={onManagePlan}
                className="mt-1 inline-flex items-center gap-1 font-medium text-accent underline-offset-2 transition-opacity hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none"
              >
                Gerenciar uso
                <ExternalLink aria-hidden className="size-3" />
              </button>
            ) : null}
          </div>
        ) : null}

        {needsAccount ? (
          <div className="rounded-lg bg-warning-soft px-2.5 py-2 text-[11px] leading-relaxed text-warning">
            <p>{prompt.text}</p>
            {showAccountCta ? (
              <button
                type="button"
                onClick={connectAction}
                className="mt-1 font-medium underline underline-offset-2 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none"
              >
                {prompt.action}
              </button>
            ) : null}
          </div>
        ) : null}

        {needsPlanActivation ? (
          <div className="rounded-lg bg-warning-soft px-2.5 py-2 text-[11px] leading-relaxed text-warning">
            <p>
              O uso do plano não está ativado para esta conta. Ative para usar os modelos sem custo
              por token.
            </p>
            {showAccountCta ? (
              <button
                type="button"
                onClick={connectAction}
                className="mt-1 font-medium underline underline-offset-2 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none"
              >
                Ativar uso do plano
              </button>
            ) : null}
          </div>
        ) : null}

        {!oauthProvider && keyStatus && !keyStatus.hasKey ? (
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

        {needsAccount || needsPlanActivation ? (
          <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-foreground-subtle">
            <AlertCircle aria-hidden className="mt-0.5 size-3 shrink-0" />
            Você também pode usar este provedor colando uma API key da OpenAI.
          </p>
        ) : null}
      </div>

      {footer ? (
        <div className="shrink-0 border-t border-border px-3 py-2">{footer}</div>
      ) : null}
    </div>
  );
}
