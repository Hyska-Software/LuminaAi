/**
 * Auth-aware labels for the provider surfaces (tabs, dots, account CTAs).
 *
 * Inputs are the IPC DTOs (`ProviderAuthStatus` has no credential material) and
 * the catalog provider metadata; nothing here ever sees a token.
 */
import { providerAuth } from '@/lib/catalog';
import { keyStatusLabel } from '@/lib/modelMenu';
import type { ProviderAuthStatus, ProviderInfo, ProviderKeyStatus } from '@/lib/types';

/** Auth snapshot of a provider, if the backend reported one. */
export function authStatusFor(
  auth: ProviderAuthStatus[],
  providerId: string,
): ProviderAuthStatus | undefined {
  return auth.find((entry) => entry.providerId === providerId);
}

/**
 * Tab/segment title: the ChatGPT account state wins over the generic API-key
 * label, so an OAuth provider is not described as "Sem chave de API".
 */
export function providerTabTitle(
  provider: ProviderInfo,
  key: ProviderKeyStatus | undefined,
  authStatus: ProviderAuthStatus | undefined,
): string {
  if (providerAuth(provider) === 'oauth') {
    if (authStatus?.state === 'signed-in' && authStatus.planUsage) return 'Plano ChatGPT conectado';
    if (authStatus?.state === 'signed-in') return 'Conta ChatGPT conectada';
    if (authStatus?.state === 'reauth-required') return 'Sessão do ChatGPT expirada';
  }
  return keyStatusLabel(key);
}

/** True when the provider has a usable credential (API key or ChatGPT account). */
export function providerAuthenticated(
  key: ProviderKeyStatus | undefined,
  authStatus: ProviderAuthStatus | undefined,
): boolean {
  return Boolean(key?.hasKey) || authStatus?.state === 'signed-in';
}
