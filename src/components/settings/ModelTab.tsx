import { useEffect, useMemo, useState } from 'react';
import {
  defaultReasoningFor,
  formatContextWindow,
  formatPrice,
  getModel,
  providers as catalogProviders,
} from '@/lib/catalog';
import type { ProviderInfo, ReasoningSelection, Settings } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { Badge, NativeSelect } from '@/components/ui';
import { CapabilityBadges } from '@/components/models';
import { ThinkingSelector } from '@/components/models/ThinkingSelector';
import { SettingRow, SettingsBlock, SettingsSection } from './shared';

function reasoningDefaultOf(selection: ReasoningSelection | null): Settings['reasoningDefault'] {
  if (!selection || selection.mode === 'off') return 'off';
  if (selection.mode === 'budget') return 'auto';
  switch (selection.effort) {
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
    case 'max':
      return 'max';
    default:
      return 'auto';
  }
}

export function ModelTab() {
  const settings = useAppStore((state) => state.settings);
  const selection = useAppStore((state) => state.selection);
  const storeProviders = useAppStore((state) => state.providers);
  const setSelection = useAppStore((state) => state.setSelection);
  const setReasoning = useAppStore((state) => state.setReasoning);
  const saveSettings = useAppStore((state) => state.saveSettings);

  const providerList: ProviderInfo[] = storeProviders.length ? storeProviders : catalogProviders();
  const activeProvider =
    providerList.find((provider) => provider.id === selection.providerId) ?? providerList[0];
  const model = activeProvider ? getModel(activeProvider.id, selection.modelId) : undefined;
  const availableModels = useMemo(
    () => (activeProvider?.models ?? []).filter((entry) => entry.status !== 'unavailable'),
    [activeProvider],
  );

  const [pendingReasoning, setPendingReasoning] = useState<ReasoningSelection | null>(selection.reasoning);
  useEffect(() => {
    setPendingReasoning(selection.reasoning);
  }, [selection.providerId, selection.modelId, selection.reasoning]);

  const commit = (
    providerId: string,
    modelId: string,
    reasoning: ReasoningSelection | null,
  ) => {
    setSelection({ providerId, modelId, reasoning });
    setReasoning(reasoning);
    void saveSettings({
      defaultProvider: providerId,
      defaultModel: modelId,
      reasoningDefault: reasoningDefaultOf(reasoning),
    });
    setPendingReasoning(reasoning);
  };

  const handleProviderChange = (providerId: string) => {
    const provider = providerList.find((entry) => entry.id === providerId);
    if (!provider) return;
    const preferred =
      provider.models.find((entry) => entry.id === provider.defaultModelId && entry.status !== 'unavailable') ??
      provider.models.find((entry) => entry.status !== 'unavailable') ??
      provider.models[0];
    if (!preferred) return;
    commit(provider.id, preferred.id, defaultReasoningFor(preferred));
  };

  const handleModelChange = (modelId: string) => {
    if (!activeProvider) return;
    const next = getModel(activeProvider.id, modelId);
    commit(activeProvider.id, modelId, defaultReasoningFor(next));
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Modelo padrão"
        description="Usado em novas conversas e como seleção inicial do composer."
      >
        <SettingRow label="Provedor" description="OpenCode Go (assinatura) ou OpenCode Zen (créditos).">
          <NativeSelect
            value={activeProvider?.id ?? ''}
            onChange={(event) => handleProviderChange(event.target.value)}
            aria-label="Provedor padrão"
            wrapperClassName="w-[220px]"
          >
            {providerList.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </NativeSelect>
        </SettingRow>

        <SettingRow label="Modelo" description="Modelos indisponíveis não aparecem nesta lista.">
          <NativeSelect
            value={selection.modelId}
            onChange={(event) => handleModelChange(event.target.value)}
            aria-label="Modelo padrão"
            wrapperClassName="w-[220px]"
          >
            {availableModels.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </NativeSelect>
        </SettingRow>

        {model ? (
          <SettingsBlock>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <CapabilityBadges model={model} max={5} />
                <span className="text-[11px] tabular-nums text-foreground-subtle">
                  {formatContextWindow(model.contextWindow)} contexto · {formatPrice(model.cost)}
                </span>
              </div>
              <ThinkingSelector
                model={model}
                value={pendingReasoning}
                onChange={(reasoning) => {
                  setPendingReasoning(reasoning);
                  setReasoning(reasoning);
                  void saveSettings({ reasoningDefault: reasoningDefaultOf(reasoning) });
                }}
              />
              <p className="text-[11px] leading-relaxed text-foreground-subtle">
                O padrão de raciocínio é aplicado ao modelo escolhido; modelos sem suporte ignoram essa
                configuração.
              </p>
            </div>
          </SettingsBlock>
        ) : (
          <SettingsBlock>
            <p className="text-xs text-foreground-muted">
              O modelo salvo ({settings.defaultModel}) não está no catálogo atual.
            </p>
          </SettingsBlock>
        )}
      </SettingsSection>

      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-[11px] leading-relaxed text-foreground-muted">
        <Badge tone="muted">Dica</Badge>
        Você também pode trocar de modelo pelo seletor no topo da janela ou pelo composer, sem alterar
        o padrão das próximas conversas.
      </div>
    </div>
  );
}
