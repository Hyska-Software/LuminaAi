/**
 * Settings → About → Updates: manual check, automatic-check preference and
 * the same download/install actions used by the title-bar popover.
 */
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Badge, Button, Switch } from '@/components/ui';
import { UpdateActions, updateCheckedLabel } from '@/components/layout/UpdatePanel';
import { openExternalUrl } from '@/components/chat/external';
import { canSelfInstall, useAppStore, useUpdateStore } from '@/lib/store';
import { SettingRow, SettingsSection } from './shared';

function statusLabel(
  t: TFunction<'settings'>,
  phase: string,
  available: boolean,
  errorScope: string | null,
  lastCheckAt: number | null | undefined,
  selfInstall: boolean,
): string {
  if (phase === 'checking') return t('update.status.checking');
  if (phase === 'downloading') return t('update.status.downloading');
  if (phase === 'verifying') return t('update.status.verifying');
  if (phase === 'installing') {
    return selfInstall ? t('update.status.installingManaged') : t('update.status.installing');
  }
  if (phase === 'error' && errorScope === 'download') return t('update.status.downloadError');
  if (available) return t('update.status.available');
  if (phase === 'up-to-date') return t('update.status.upToDate');
  if (phase === 'error') return t('update.status.checkError');
  if (lastCheckAt) return t('update.status.idleChecked');
  return t('update.status.idle');
}

export function UpdateSection() {
  const { t } = useTranslation('settings');
  const appInfo = useAppStore((state) => state.appInfo);
  const phase = useUpdateStore((state) => state.phase);
  const info = useUpdateStore((state) => state.info);
  const managed = useUpdateStore((state) => state.managed);
  const preferences = useUpdateStore((state) => state.preferences);
  const error = useUpdateStore((state) => state.error);
  const errorScope = useUpdateStore((state) => state.errorScope);
  const check = useUpdateStore((state) => state.check);
  const setAutoCheck = useUpdateStore((state) => state.setAutoCheck);
  const skip = useUpdateStore((state) => state.skip);
  const unskip = useUpdateStore((state) => state.unskip);

  const available = Boolean(info?.available);
  const selfInstall = canSelfInstall(managed, info?.asset?.kind);
  const checked = updateCheckedLabel(preferences.lastCheckAt);
  const checking = phase === 'checking';
  const installing = phase === 'installing';
  const busyDownload = phase === 'downloading' || phase === 'verifying';
  const skipped = preferences.skippedVersion;

  const detail = (() => {
    if (errorScope === 'check' && error) {
      return info ? t('update.detail.lastResult', { error }) : error;
    }
    if (available && info) {
      const fallbackChecked = checked ?? t('update.detail.recentCheck');
      return info.asset
        ? t('update.detail.availableWithAsset', {
            checked: fallbackChecked,
            platform: info.asset.platformLabel,
          })
        : t('update.detail.availableNoAsset', { checked: fallbackChecked });
    }
    if (checked) return checked;
    return t('update.detail.idle');
  })();

  return (
    <SettingsSection title={t('update.title')} description={t('update.description')}>
      <SettingRow label={t('update.current.label')} description={t('update.current.description')}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent" size="md">
            v{appInfo?.version ?? info?.currentVersion ?? '—'}
          </Badge>
          {managed.mode === 'managed' ? (
            <Badge tone="success" size="sm">
              {t('update.mode.managed')}
            </Badge>
          ) : null}
        </div>
      </SettingRow>

      <SettingRow label={t('update.auto.label')} description={t('update.auto.description')}>
        <Switch
          checked={preferences.autoCheck}
          onCheckedChange={(value) => void setAutoCheck(value)}
          aria-label={t('update.auto.aria')}
        />
      </SettingRow>

      <SettingRow vertical label={t('update.status.label')} description={detail}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-foreground"
              aria-live="polite"
            >
              {statusLabel(t, phase, available, errorScope, preferences.lastCheckAt, selfInstall)}
            </span>
            {available && info ? (
              <Badge tone="accent" size="sm">
                v{info.latestVersion}
              </Badge>
            ) : null}
            {info?.stale || (errorScope === 'check' && info) ? (
              <Badge tone="warning" size="sm">
                {t('update.noConnection')}
              </Badge>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              loading={checking}
              disabled={checking || busyDownload || installing}
              leftIcon={<RefreshCw className="size-3.5" strokeWidth={1.75} />}
              onClick={() => void check({ force: true })}
            >
              {t('update.checkNow')}
            </Button>
            {available && info ? (
              <Button
                size="sm"
                variant="ghost"
                rightIcon={<ExternalLink className="size-3.5" strokeWidth={1.75} />}
                onClick={() => void openExternalUrl(info.htmlUrl)}
              >
                {t('update.viewOnGithub')}
              </Button>
            ) : null}
            {available ? (
              <Button size="sm" variant="ghost" onClick={() => void skip()}>
                {t('update.skip')}
              </Button>
            ) : null}
          </div>

          {available ? <UpdateActions /> : null}

          {!available && skipped ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-foreground-muted">
              <span>{t('update.skipped', { version: skipped })}</span>
              <Button size="sm" variant="ghost" onClick={() => void unskip()}>
                {t('update.unskip')}
              </Button>
            </div>
          ) : null}
        </div>
      </SettingRow>
    </SettingsSection>
  );
}
