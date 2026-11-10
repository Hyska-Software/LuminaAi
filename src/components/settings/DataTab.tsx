import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FolderOpen, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAppStore, useChatStore, useThemeStore, useUiStore } from '@/lib/store';
import { Button } from '@/components/ui';
import { SettingRow, SettingsBlock, SettingsSection } from './shared';

type ConfirmStep = 0 | 1 | 2;

export function DataTab() {
  const { t } = useTranslation('settings');
  const { t: common } = useTranslation('common');
  const appInfo = useAppStore((state) => state.appInfo);
  const [confirmStep, setConfirmStep] = useState<ConfirmStep>(0);
  const [busy, setBusy] = useState(false);

  const openDataDir = async () => {
    try {
      await api.openDataDir();
    } catch (error) {
      toast.error(t('toasts.openFolderFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const resetData = async () => {
    setBusy(true);
    try {
      await api.resetAppData();
      setConfirmStep(0);
      useUiStore.getState().setArtifacts([]);
      useUiStore.getState().closeArtifactPanel();
      useChatStore.setState({ activeId: null, messagesByConversation: {}, conversations: [] });
      await Promise.all([useAppStore.getState().init(), useChatStore.getState().init()]);
      await useThemeStore.getState().refresh();
      toast.success(t('data.toasts.clearedTitle'), {
        description: t('data.toasts.clearedDescription'),
      });
    } catch (error) {
      toast.error(t('data.toasts.clearFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t('data.storage.title')} description={t('data.storage.description')}>
        <SettingRow
          label={t('data.storage.folder.label')}
          description={t('data.storage.folder.description')}
        >
          <Button size="sm" variant="secondary" onClick={openDataDir} leftIcon={<FolderOpen className="size-3.5" />}>
            {t('data.storage.open')}
          </Button>
        </SettingRow>
        <SettingRow vertical label={t('data.storage.location')}>
          <code className="block w-full truncate rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[11px] text-foreground-muted">
            {appInfo?.dataDir ?? '—'}
          </code>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('data.danger.title')} description={t('data.danger.description')}>
        <SettingsBlock>
          {confirmStep === 0 ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium text-foreground">{t('data.danger.clearTitle')}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">
                  {t('data.danger.clearDescription')}
                </p>
              </div>
              <Button variant="danger" size="sm" onClick={() => setConfirmStep(1)}>
                <Trash2 className="size-3.5" />
                {t('data.danger.clearAction')}
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border border-danger/30 bg-danger-soft p-3.5">
              <div className="flex gap-2.5">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-foreground">
                    {confirmStep === 1 ? t('data.danger.confirmTitle') : t('data.danger.finalTitle')}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">
                    {confirmStep === 1 ? t('data.danger.confirmBody') : t('data.danger.finalBody')}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmStep(0)}
                      disabled={busy}
                    >
                      {common('actions.cancel')}
                    </Button>
                    {confirmStep === 1 ? (
                      <Button size="sm" variant="danger" onClick={() => setConfirmStep(2)}>
                        {t('data.danger.continue')}
                      </Button>
                    ) : (
                      <Button size="sm" variant="danger" loading={busy} onClick={() => void resetData()}>
                        {t('data.danger.deleteAll')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </SettingsBlock>
      </SettingsSection>
    </div>
  );
}
