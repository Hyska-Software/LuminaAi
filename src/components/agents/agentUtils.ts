import type { Agent, ProviderInfo } from '@/lib/types';

export function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '';
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return 'agora';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} d`;
  return new Date(timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
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
  return new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(tokens);
}

/** USD cost with the locale formatting used by the rest of the app. */
export function formatUsageCost(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return 'US$ 0,00';
  return cost.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cost < 1 ? 4 : 2,
  });
}

export function inputFromAgent(agent: Agent) {
  return {
    name: agent.name,
    role: agent.role,
    description: agent.description,
    emoji: agent.emoji,
    department: agent.department,
    providerId: agent.providerId,
    modelId: agent.modelId,
    fallbackProviderId: agent.fallbackProviderId ?? null,
    fallbackModelId: agent.fallbackModelId ?? null,
    reasoning: agent.reasoning,
    instructions: agent.instructions,
    starters: [...agent.starters],
    capabilities: agent.capabilities,
    memoryEnabled: agent.memoryEnabled,
    workspaceId: agent.workspaceId,
    permissionMode: agent.permissionMode,
    dockerImage: agent.dockerImage ?? null,
    computerEnvironment: agent.computerEnvironment ?? 'auto',
  };
}
