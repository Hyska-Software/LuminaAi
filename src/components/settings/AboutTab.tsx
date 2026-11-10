import { useTranslation } from 'react-i18next';

import { ExternalLink } from 'lucide-react';
import { BrandMark } from '@/components/chat/BrandMark';
import { catalog, CATALOG_GENERATED_AT } from '@/lib/catalog';
import { openExternal } from '@/lib/genui/open-external';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { APP_VERSION_FALLBACK } from '@/lib/appVersion';
import { useAppStore } from '@/lib/store';
import { Badge, Button } from '@/components/ui';
import { SettingRow, SettingsSection } from './shared';
import { UpdateSection } from './UpdateSection';

const OPENCODE_URL = 'https://opencode.ai';
const CONSOLE_URL = 'https://opencode.ai/console';
const CHATGPT_URL = 'https://chatgpt.com';
const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';
const REPOSITORY_URL = 'https://github.com/Hyska-Software/ZylaraAi';

function formatGeneratedAt(value: string): string {
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' });
}

export function AboutTab() {
  const { t } = useTranslation('settings');
  const appInfo = useAppStore((state) => state.appInfo);
  const modelCount = catalog.providers.reduce(
    (total, provider) => total + provider.models.length,
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t('about.title')} description={t('about.description')}>
        <div className="flex items-center gap-3 py-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
            <BrandMark size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold tracking-tight text-foreground">Zylara</p>
            <p className="text-[11px] text-foreground-muted">{t('about.stack')}</p>
          </div>
          <Badge tone="accent" size="md">
            v{appInfo?.version ?? APP_VERSION_FALLBACK}
          </Badge>
        </div>

        <SettingRow label={t('about.tauri.label')} description={t('about.tauri.description')}>
          <span className="font-mono text-xs text-foreground-muted">{appInfo?.tauriVersion ?? '—'}</span>
        </SettingRow>
        <SettingRow label={t('about.platform.label')}>
          <span className="font-mono text-xs text-foreground-muted">{appInfo?.platform ?? '—'}</span>
        </SettingRow>
        <SettingRow
          label={t('about.catalog.label')}
          description={t('about.catalog.description', { date: formatGeneratedAt(CATALOG_GENERATED_AT) })}
        >
          <span className="text-xs text-foreground-muted">
            {t('about.catalog.value', {
              version: catalog.version,
              count: formatNumber(modelCount),
            })}
          </span>
        </SettingRow>
        <SettingRow label={t('about.storage.label')} description={t('about.storage.description')}>
          <span className="text-xs text-foreground-muted">{t('about.storage.value')}</span>
        </SettingRow>
      </SettingsSection>

      <UpdateSection />

      <SettingsSection title={t('about.links.title')} description={t('about.links.description')}>
        <SettingRow
          label={t('about.links.opencode.label')}
          description={t('about.links.opencode.description')}
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void openExternal(OPENCODE_URL)}
            rightIcon={<ExternalLink className="size-3.5" />}
          >
            {t('about.links.opencode.action')}
          </Button>
        </SettingRow>
        <SettingRow
          label={t('about.links.console.label')}
          description={t('about.links.console.description')}
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void openExternal(CONSOLE_URL)}
            rightIcon={<ExternalLink className="size-3.5" />}
          >
            {t('about.links.console.action')}
          </Button>
        </SettingRow>
        <SettingRow
          label={t('about.links.chatgpt.label')}
          description={t('about.links.chatgpt.description')}
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void openExternal(CHATGPT_URL)}
            rightIcon={<ExternalLink className="size-3.5" />}
          >
            {t('about.links.chatgpt.action')}
          </Button>
        </SettingRow>
        <SettingRow
          label={t('about.links.usage.label')}
          description={t('about.links.usage.description')}
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void openExternal(CHATGPT_USAGE_URL)}
            rightIcon={<ExternalLink className="size-3.5" />}
          >
            {t('about.links.usage.action')}
          </Button>
        </SettingRow>
        <SettingRow
          label={t('about.links.repository.label')}
          description={t('about.links.repository.description')}
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void openExternal(REPOSITORY_URL)}
            rightIcon={<ExternalLink className="size-3.5" />}
          >
            {t('about.links.repository.action')}
          </Button>
        </SettingRow>
      </SettingsSection>

      <p className="text-[11px] leading-relaxed text-foreground-subtle">{t('about.footer')}</p>
    </div>
  );
}
