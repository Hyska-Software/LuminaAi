import { useEffect, useState } from 'react';
import { MAX_STEPS_LIMIT, useAppStore } from '@/lib/store';
import { Slider, Switch } from '@/components/ui';
import { SettingRow, SettingsBlock, SettingsSection } from './shared';

export function ToolsTab() {
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const [maxSteps, setMaxSteps] = useState(settings.maxSteps);
  const [temperature, setTemperature] = useState(settings.temperature ?? 0.7);

  useEffect(() => setMaxSteps(settings.maxSteps), [settings.maxSteps]);
  useEffect(() => {
    if (settings.temperature != null) setTemperature(settings.temperature);
  }, [settings.temperature]);

  const temperatureEnabled = settings.temperature != null;

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Ferramentas do agente" description="O que o modelo pode fazer durante uma resposta.">
        <SettingRow
          label="Busca web"
          description="Permite pesquisar na internet e citar as fontes no chat."
        >
          <Switch
            checked={settings.webSearchEnabled}
            onCheckedChange={(checked) => void saveSettings({ webSearchEnabled: checked })}
            aria-label="Ativar busca web"
          />
        </SettingRow>

        <SettingRow
          label="Criar arquivos"
          description="Permite gerar artefatos (documentos, planilhas, código, HTML)."
        >
          <Switch
            checked={settings.fileCreationEnabled}
            onCheckedChange={(checked) => void saveSettings({ fileCreationEnabled: checked })}
            aria-label="Ativar criação de arquivos"
          />
        </SettingRow>

        <SettingRow
          label="Enviar anexos ao modelo"
          description="Inclui o texto extraído e imagens dos anexos no contexto."
        >
          <Switch
            checked={settings.includeAttachments}
            onCheckedChange={(checked) => void saveSettings({ includeAttachments: checked })}
            aria-label="Enviar anexos ao modelo"
          />
        </SettingRow>

        <SettingRow
          label="Gerar título automático"
          description="Cria um título curto para a conversa no primeiro turno."
        >
          <Switch
            checked={settings.autoTitle}
            onCheckedChange={(checked) => void saveSettings({ autoTitle: checked })}
            aria-label="Gerar título automático"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Execução" description="Limites do loop de agente e criatividade do modelo.">
        <SettingRow
          vertical
          label="Máximo de passos"
          description={`O agente executa até ${maxSteps} ${maxSteps === 1 ? 'passo' : 'passos'} (ferramenta → resposta) por turno.`}
        >
          <Slider
            min={1}
            max={MAX_STEPS_LIMIT}
            step={1}
            value={maxSteps}
            valueLabel={String(maxSteps)}
            onValueChange={setMaxSteps}
            onValueCommit={(value) => void saveSettings({ maxSteps: value })}
            aria-label="Máximo de passos do agente"
          />
        </SettingRow>

        <SettingsBlock>
          <div className="flex flex-col gap-3">
            <Switch
              checked={temperatureEnabled}
              onCheckedChange={(checked) =>
                void saveSettings({ temperature: checked ? temperature : null })
              }
              label="Personalizar temperatura"
              description="Quando desligado, cada provedor usa o próprio padrão."
            />
            {temperatureEnabled ? (
              <Slider
                min={0}
                max={1.5}
                step={0.05}
                value={temperature}
                valueLabel={temperature.toFixed(2)}
                onValueChange={setTemperature}
                onValueCommit={(value) => void saveSettings({ temperature: value })}
                description="Valores baixos são mais determinísticos; altos, mais criativos."
                aria-label="Temperatura"
              />
            ) : null}
          </div>
        </SettingsBlock>
      </SettingsSection>
    </div>
  );
}
