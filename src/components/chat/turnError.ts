/**
 * Presentation helpers for turn errors on the chat surface (T4.4a).
 *
 * The backend classifies provider failures into `TurnEvent::Error.code`
 * (PLAN §2.3): the raw `subscription_sharing_*` code wins when it exists,
 * otherwise a transport-neutral app code is sent. The UI must never invent
 * quota data (PLAN kill criteria (e)) — only explain the state and point at
 * the ChatGPT usage dashboard when the plan limit was hit.
 */
import { t } from '@/lib/i18n';
import type { ProviderInfo } from '@/lib/types';

/** Fixed ChatGPT usage dashboard (PLAN §1.5). The API exposes no remaining-quota data. */
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';

export type TurnErrorKind = 'plan-limit' | 'plan-not-eligible' | 'auth-required';

const PLAN_LIMIT_CODES: Record<string, true> = {
  subscription_sharing_usage_limit_exceeded: true,
  // Neutral code emitted for `ProviderError::PlanLimit`; the raw provider code
  // still wins when present, but this covers providers without a structured
  // body.
  plan_limit: true,
};

const PLAN_NOT_ELIGIBLE_CODES: Record<string, true> = {
  subscription_sharing_user_not_eligible: true,
  plan_not_eligible: true,
};

const AUTH_REQUIRED_CODES: Record<string, true> = {
  auth_required: true,
  missing_credentials: true,
  subscription_sharing_invalid_user: true,
};

export interface TurnErrorContext {
  /** Kept for API compatibility; the banner no longer depends on the route. */
  planProvider?: boolean;
}

/**
 * Maps a turn error code to the banner the chat should show.
 * Unrelated failures (transient rate limits, unsupported preview fields,
 * transport errors) return `null`: they already surface through the message
 * error card and the toast, and must not be presented as a plan/quota state.
 */
export function turnErrorKind(
  code?: string | null,
  _context: TurnErrorContext = {},
): TurnErrorKind | null {
  const normalized = code?.trim();
  if (!normalized) return null;
  if (PLAN_LIMIT_CODES[normalized]) return 'plan-limit';
  if (PLAN_NOT_ELIGIBLE_CODES[normalized]) return 'plan-not-eligible';
  if (AUTH_REQUIRED_CODES[normalized]) return 'auth-required';
  return null;
}

/**
 * Usage dashboard for a provider: the catalog `consoleUrl` is authoritative
 * (OpenAI's entry points at `https://chatgpt.com/settings/usage`), with the
 * ChatGPT dashboard as fallback when the provider list is stale/absent.
 */
export function planUsageUrl(provider?: ProviderInfo | null): string {
  const configured = provider?.consoleUrl?.trim();
  return configured && configured.length > 0 ? configured : CHATGPT_USAGE_URL;
}

/* Copy keys. The banner and its tests resolve them through `t`. */

export const PLAN_LIMIT_TITLE = 'chat:turnError.planLimit.title';
export const PLAN_LIMIT_BODY = 'chat:turnError.planLimit.body';
export const PLAN_NOT_ELIGIBLE_TITLE = 'chat:turnError.planNotEligible.title';
export const PLAN_NOT_ELIGIBLE_BODY = 'chat:turnError.planNotEligible.body';
export const AUTH_REQUIRED_TITLE = 'chat:turnError.authRequired.title';
export const AUTH_REQUIRED_BODY = 'chat:turnError.authRequired.body';

/**
 * Description of the plan-limit banner. The backend hint already carries the
 * honest body copy (no title prefix); when it is missing, the localized body is
 * used. Retrying is never suggested for a usage limit.
 */
export function planLimitDescription(hint?: string | null): string {
  const trimmed = hint?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : t(PLAN_LIMIT_BODY);
}

/** Inline notice shown when the composer is blocked for lack of credentials (D9). */
export function credentialGateMessage(provider?: ProviderInfo | null): string {
  return provider?.auth === 'oauth'
    ? t('chat:credentialGate.oauth')
    : t('chat:credentialGate.apiKey');
}
