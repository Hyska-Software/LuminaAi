import { useTranslation } from 'react-i18next';

import { SUPPORTED_LANGUAGES, type AppLocale } from '@/lib/i18n/languages';
import type { ThemeMode } from '@/lib/types';
import { LAYOUT_MODES } from '@/lib/layoutModes';
import { useAppStore, useUiStore } from '@/lib/store';
import { NativeSelect, SegmentedControl, Slider, Switch } from '@/components/ui';
import { SettingRow, SettingsSection } from './shared';

export function GeneralTab() {
  const { t } = useTranslation('settings');
  const common = useTranslation('common');
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const enabledLayouts = useUiStore((state) => state.enabledLayouts);
  const setLayoutEnabled = useUiStore((state) => state.setLayoutEnabled);
  const enabledCount = LAYOUT_MODES.filter((mode) => enabledLayouts[mode.value]).length;

  const themeOptions = [
    { value: 'light', label: t('general.theme.light') },
    { value: 'dark', label: t('general.theme.dark') },
    { value: 'system', label: t('general.theme.system') },
  ];
  const sendOptions = [
    { value: 'enter', label: 'Enter' },
    { value: 'ctrl+enter', label: 'Ctrl+Enter' },
  ];

  const handleTheme = (value: string) => {
    const next = value as ThemeMode;
    setTheme(next);
    void saveSettings({ theme: next });
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title={t('general.appearance.title')}
        description={t('general.appearance.description')}
      >
        <SettingRow label={t('general.theme.label')} description={t('general.theme.description')}>
          <SegmentedControl
            options={themeOptions}
            value={theme}
            onChange={handleTheme}
            ariaLabel={t('general.theme.aria')}
          />
        </SettingRow>

        <SettingRow
          label={t('general.language.label')}
          description={t('general.language.description')}
        >
          <NativeSelect
            value={settings.locale}
            onChange={(event) => void saveSettings({ locale: event.target.value as AppLocale })}
            aria-label={t('general.language.aria')}
          >
            {SUPPORTED_LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.nativeName}
              </option>
            ))}
          </NativeSelect>
        </SettingRow>

        <SettingRow
          vertical
          label={t('general.fontSize.label')}
          description={t('general.fontSize.description', {
            percent: Math.round(settings.fontScale * 100),
          })}
        >
          <Slider
            min={0.9}
            max={1.15}
            step={0.05}
            value={settings.fontScale}
            valueLabel={`${Math.round(settings.fontScale * 100)}%`}
            onValueChange={(value) => void saveSettings({ fontScale: Number(value.toFixed(2)) })}
            aria-label={t('general.fontSize.aria')}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t('general.layouts.title')}
        description={t('general.layouts.description')}
      >
        {LAYOUT_MODES.map((mode) => {
          const label = common.t(mode.labelKey);
          return (
            <SettingRow
              key={mode.value}
              label={label}
              description={common.t(mode.descriptionKey)}
            >
              <Switch
                checked={enabledLayouts[mode.value]}
                disabled={enabledLayouts[mode.value] && enabledCount === 1}
                onCheckedChange={(checked) => setLayoutEnabled(mode.value, checked)}
                aria-label={t('general.layouts.toggleAria', { name: label })}
              />
            </SettingRow>
          );
        })}
      </SettingsSection>

      <SettingsSection
        title={t('general.behavior.title')}
        description={t('general.behavior.description')}
      >
        <SettingRow
          label={t('general.sendWith.label')}
          description={t('general.sendWith.description')}
        >
          <SegmentedControl
            options={sendOptions}
            value={settings.sendKey}
            onChange={(value) =>
              void saveSettings({ sendKey: value === 'ctrl+enter' ? 'ctrl+enter' : 'enter' })
            }
            ariaLabel={t('general.sendWith.aria')}
          />
        </SettingRow>

        <SettingRow
          label={t('general.reduceMotion.label')}
          description={t('general.reduceMotion.description')}
        >
          <Switch
            checked={settings.reduceMotion}
            onCheckedChange={(checked) => void saveSettings({ reduceMotion: checked })}
            aria-label={t('general.reduceMotion.aria')}
          />
        </SettingRow>

        <SettingRow
          label={t('general.showTokenUsage.label')}
          description={t('general.showTokenUsage.description')}
        >
          <Switch
            checked={settings.showTokenUsage}
            onCheckedChange={(checked) => void saveSettings({ showTokenUsage: checked })}
            aria-label={t('general.showTokenUsage.aria')}
          />
        </SettingRow>

        <SettingRow
          label={t('general.thinkingCollapsed.label')}
          description={t('general.thinkingCollapsed.description')}
        >
          <Switch
            checked={settings.thinkingCollapsedByDefault}
            onCheckedChange={(checked) =>
              void saveSettings({ thinkingCollapsedByDefault: checked })
            }
            aria-label={t('general.thinkingCollapsed.aria')}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
