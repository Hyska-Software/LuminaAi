import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  TERMINAL_FONT_FAMILY_MAX_LENGTH,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  normalizeTerminalFontSize,
} from '@/lib/terminalSettings';
import { useAppStore } from '@/lib/store';
import { Input, Slider } from '@/components/ui';
import { SettingRow, SettingsSection } from './shared';

/** Settings › Terminal: typography of the integrated terminal (Code layout). */
export function TerminalTab() {
  const { t } = useTranslation('settings');
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const savedFamily = settings.terminalFontFamily ?? '';
  const fontSize = normalizeTerminalFontSize(settings.terminalFontSize);
  const [fontFamily, setFontFamily] = useState(savedFamily);

  useEffect(() => {
    setFontFamily(savedFamily);
  }, [savedFamily]);

  const commitFontFamily = () => {
    const value = fontFamily.trim();
    if (value !== savedFamily) void saveSettings({ terminalFontFamily: value });
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title={t('terminal.appearance.title')}
        description={t('terminal.appearance.description')}
      >
        <SettingRow
          vertical
          label={t('terminal.fontFamily.label')}
          description={t('terminal.fontFamily.description')}
        >
          <Input
            value={fontFamily}
            maxLength={TERMINAL_FONT_FAMILY_MAX_LENGTH}
            aria-label={t('terminal.fontFamily.aria')}
            placeholder={t('terminal.fontFamily.placeholder')}
            onChange={(event) => setFontFamily(event.target.value)}
            onBlur={commitFontFamily}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitFontFamily();
            }}
          />
        </SettingRow>

        <SettingRow
          vertical
          label={t('terminal.fontSize.label')}
          description={t('terminal.fontSize.description')}
        >
          <Slider
            min={TERMINAL_FONT_SIZE_MIN}
            max={TERMINAL_FONT_SIZE_MAX}
            step={1}
            value={fontSize}
            valueLabel={`${fontSize}px`}
            onValueChange={(value) => void saveSettings({ terminalFontSize: Math.round(value) })}
            aria-label={t('terminal.fontSize.aria')}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
