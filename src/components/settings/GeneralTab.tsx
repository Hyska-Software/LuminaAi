import type { ThemeMode } from '@/lib/types';
import { useAppStore, useUiStore } from '@/lib/store';
import { SegmentedControl, Slider, Switch } from '@/components/ui';
import { SettingRow, SettingsSection } from './shared';

const THEME_OPTIONS = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Sistema' },
];

const LANGUAGE_OPTIONS = [
  { value: 'pt-BR', label: 'Português (BR)' },
  { value: 'en', label: 'English', disabled: true, title: 'Disponível em breve' },
];

const SEND_OPTIONS = [
  { value: 'enter', label: 'Enter' },
  { value: 'ctrl+enter', label: 'Ctrl+Enter' },
];

export function GeneralTab() {
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);

  const handleTheme = (value: string) => {
    const next = value as ThemeMode;
    setTheme(next);
    void saveSettings({ theme: next });
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Aparência" description="Tema, idioma e tamanho do texto da interface.">
        <SettingRow
          label="Tema"
          description="“Sistema” acompanha a preferência do seu sistema operacional."
        >
          <SegmentedControl
            options={THEME_OPTIONS}
            value={theme}
            onChange={handleTheme}
            ariaLabel="Tema da interface"
          />
        </SettingRow>

        <SettingRow label="Idioma" description="Idioma da interface. Inglês chega em breve.">
          <SegmentedControl
            options={LANGUAGE_OPTIONS}
            value={settings.locale}
            onChange={(value) => {
              if (value === 'pt-BR') void saveSettings({ locale: 'pt-BR' });
            }}
            ariaLabel="Idioma da interface"
          />
        </SettingRow>

        <SettingRow
          vertical
          label="Tamanho da fonte"
          description={`${Math.round(settings.fontScale * 100)}% do tamanho padrão — afeta toda a interface.`}
        >
          <Slider
            min={0.9}
            max={1.15}
            step={0.05}
            value={settings.fontScale}
            valueLabel={`${Math.round(settings.fontScale * 100)}%`}
            onValueChange={(value) => void saveSettings({ fontScale: Number(value.toFixed(2)) })}
            aria-label="Tamanho da fonte"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Comportamento" description="Como o composer envia e exibe as mensagens.">
        <SettingRow label="Enviar com" description="Shift+Enter sempre quebra uma nova linha.">
          <SegmentedControl
            options={SEND_OPTIONS}
            value={settings.sendKey}
            onChange={(value) =>
              void saveSettings({ sendKey: value === 'ctrl+enter' ? 'ctrl+enter' : 'enter' })
            }
            ariaLabel="Tecla para enviar mensagem"
          />
        </SettingRow>

        <SettingRow
          label="Reduzir movimento"
          description="Desativa animações de transformação, shimmer e transições longas."
        >
          <Switch
            checked={settings.reduceMotion}
            onCheckedChange={(checked) => void saveSettings({ reduceMotion: checked })}
            aria-label="Reduzir movimento"
          />
        </SettingRow>

        <SettingRow
          label="Mostrar uso de tokens"
          description="Exibe tokens e custo estimado no rodapé das respostas."
        >
          <Switch
            checked={settings.showTokenUsage}
            onCheckedChange={(checked) => void saveSettings({ showTokenUsage: checked })}
            aria-label="Mostrar uso de tokens"
          />
        </SettingRow>

        <SettingRow
          label="Raciocínio recolhido por padrão"
          description="O bloco de raciocínio e passos do agente começa fechado e não abre sozinho durante o streaming. Você pode expandi-lo a qualquer momento."
        >
          <Switch
            checked={settings.thinkingCollapsedByDefault}
            onCheckedChange={(checked) =>
              void saveSettings({ thinkingCollapsedByDefault: checked })
            }
            aria-label="Raciocínio recolhido por padrão"
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
