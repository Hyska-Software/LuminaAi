/**
 * Dismissible banner for turn failures that need an explicit next action
 * (T4.4a / PLAN §1.5):
 *
 * - plan limit hit → "Limite de uso atingido" + **Gerenciar uso** (external);
 * - plan not eligible → explanation, no retry;
 * - missing/expired credential → **Abrir Provedores** (same CTA as D9).
 *
 * Unrelated turn errors are not rendered here (they stay on the message error
 * card/toast). The banner never invents quota numbers: the ChatGPT API does not
 * expose remaining usage.
 */
import { useState } from 'react';
import { ExternalLink, KeyRound, ShieldAlert, TriangleAlert, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui';
import { openExternalUrl } from './external';
import {
  AUTH_REQUIRED_BODY,
  AUTH_REQUIRED_TITLE,
  CHATGPT_USAGE_URL,
  PLAN_LIMIT_TITLE,
  PLAN_NOT_ELIGIBLE_BODY,
  PLAN_NOT_ELIGIBLE_TITLE,
  planLimitDescription,
  turnErrorKind,
} from './turnError';

export interface TurnErrorBannerProps {
  /** `TurnEvent::Error.code` (raw `subscription_sharing_*` or neutral app code). */
  code?: string | null;
  /** Actionable hint sent by the backend (plain pt-BR sentence). */
  hint?: string | null;
  /** Whether the active provider is signed in with ChatGPT plan usage. */
  planProvider?: boolean;
  /** Usage dashboard URL; falls back to the ChatGPT dashboard. */
  usageUrl?: string | null;
  /** Opens Settings → Provedores. */
  onOpenProviders: () => void;
}

export function TurnErrorBanner({
  code,
  hint,
  planProvider = false,
  usageUrl,
  onOpenProviders,
}: TurnErrorBannerProps) {
  const kind = turnErrorKind(code, { planProvider });
  const signature = `${kind ?? ''}|${code ?? ''}|${hint ?? ''}`;
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!kind || dismissed === signature) return null;

  const isPlanLimit = kind === 'plan-limit';
  const isPlanNotEligible = kind === 'plan-not-eligible';
  const Icon = isPlanLimit ? TriangleAlert : isPlanNotEligible ? ShieldAlert : KeyRound;
  const title = isPlanLimit
    ? PLAN_LIMIT_TITLE
    : isPlanNotEligible
      ? PLAN_NOT_ELIGIBLE_TITLE
      : AUTH_REQUIRED_TITLE;
  const body = isPlanLimit
    ? planLimitDescription(hint)
    : hint?.trim() || (isPlanNotEligible ? PLAN_NOT_ELIGIBLE_BODY : AUTH_REQUIRED_BODY);
  const target = usageUrl?.trim() || CHATGPT_USAGE_URL;

  return (
    <div
      role="alert"
      className="mb-2 flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2.5"
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-foreground-muted">{body}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isPlanLimit ? (
          <Button
            variant="primary"
            size="sm"
            leftIcon={<ExternalLink className="size-4" strokeWidth={1.75} />}
            onClick={() => void openExternalUrl(target)}
          >
            Gerenciar uso
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={onOpenProviders}>
            Abrir Provedores
          </Button>
        )}
        <IconButton
          label="Dispensar aviso"
          size="sm"
          variant="ghost"
          onClick={() => setDismissed(signature)}
        >
          <X className="size-4" strokeWidth={1.75} />
        </IconButton>
      </div>
    </div>
  );
}
