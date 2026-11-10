import { t } from '@/lib/i18n';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import type { ProviderInfo } from '@/lib/types';

export { inputFromAgent } from '@/lib/agentInput';

export function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '';
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return t('agents:time.now');
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return t('agents:time.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('agents:time.hours', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('agents:time.days', { count: days });
  return formatDate(new Date(timestamp), { day: '2-digit', month: 'short' });
}

export function modelLabel(
  providers: ProviderInfo[],
  providerId: string,
  modelId: string,
): string {
  const provider = providers.find((entry) => entry.id === providerId);
  const model = provider?.models.find((entry) => entry.id === modelId);
  return model?.name ?? modelId;
}

/** Compact token count for the team cards (`12,4 mil`, `1,2 mi`). */
export function formatUsageTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  return formatNumber(tokens, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
}

/** USD cost with the locale formatting used by the rest of the app. */
export function formatUsageCost(cost: number): string {
  const value = Number.isFinite(cost) && cost > 0 ? cost : 0;
  return formatNumber(value, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 1 ? 4 : 2,
  });
}

const DEFAULT_DEPARTMENTS: Record<string, true> = { geral: true, general: true };

/** Stable key for grouping: legacy/default departments collapse together. */
export function departmentKey(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return 'general';
  return DEFAULT_DEPARTMENTS[trimmed.toLowerCase()] === true ? 'general' : trimmed;
}

/**
 * Display label for a department. The known defaults (`Geral`/`General`) are
 * shown in the active language; custom departments stay verbatim.
 */
export function localizedDepartment(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || DEFAULT_DEPARTMENTS[trimmed.toLowerCase()] === true) {
    return t('agents:departments.general');
  }
  return trimmed;
}

/** Strips the localized `Subagent:`/`Subagente:` prefix from a child title. */
export function subagentDescription(title: string): string {
  return title.replace(/^(?:subagent|subagente):\s*/i, '');
}

/** Localized label for a subagent kind, with the raw value as fallback. */
export function subagentTypeLabel(type: string): string {
  switch (type) {
    case 'explore':
      return t('agents:subagent.type.explore');
    case 'review':
      return t('agents:subagent.type.review');
    case 'general':
      return t('agents:subagent.type.general');
    default:
      return type;
  }
}
