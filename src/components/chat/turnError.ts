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

const PLAN_LIMIT_CODES = new Set(['subscription_sharing_usage_limit_exceeded']);

/** Neutral fallback code sent when the raw provider code is absent. */
const NEUTRAL_RATE_LIMIT_CODE = 'rate_limited';

const PLAN_NOT_ELIGIBLE_CODES = new Set([
  'subscription_sharing_user_not_eligible',
  'plan_not_eligible',
]);

const AUTH_REQUIRED_CODES = new Set([
  'auth_required',
  'missing_credentials',
  'subscription_sharing_invalid_user',
]);

export interface TurnErrorContext {
  /**
   * True when the active provider is signed in with ChatGPT plan usage. The
   * neutral `rate_limited` code only becomes a plan-limit banner in that case;
   * for API-key providers it is a transient rate limit (toast/message card).
   */
  planProvider?: boolean;
}

/**
 * Maps a turn error code to the banner the chat should show.
 * Unrelated failures (unsupported preview fields, transport errors) return
 * `null`: they already surface through the message error card and the toast,
 * and must not be presented as a plan/quota state.
 */
export function turnErrorKind(
  code?: string | null,
  context: TurnErrorContext = {},
): TurnErrorKind | null {
  const normalized = code?.trim();
  if (!normalized) return null;
  if (PLAN_LIMIT_CODES.has(normalized)) return 'plan-limit';
  if (normalized === NEUTRAL_RATE_LIMIT_CODE) {
    return context.planProvider ? 'plan-limit' : null;
  }
  if (PLAN_NOT_ELIGIBLE_CODES.has(normalized)) return 'plan-not-eligible';
  if (AUTH_REQUIRED_CODES.has(normalized)) return 'auth-required';
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
