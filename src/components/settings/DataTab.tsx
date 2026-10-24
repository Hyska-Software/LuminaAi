import { useState } from 'react';
import { AlertTriangle, FolderOpen, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAppStore, useChatStore, useUiStore } from '@/lib/store';
import { Button } from '@/components/ui';
import { SettingRow, SettingsBlock, SettingsSection } from './shared';

type ConfirmStep = 0 | 1 | 2;

export function DataTab() {
  const appInfo = useAppStore((state) => state.appInfo);
  const [confirmStep, setConfirmStep] = useState<ConfirmStep>(0);
  const [busy, setBusy] = useState(false);

  const openDataDir = async () => {
    try {
      await api.openDataDir();
    } catch (error) {
      toast.error('Não foi possível abrir a pasta', {
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
      toast.success('Dados apagados', { description: 'As configurações voltaram ao padrão.' });
    } catch (error) {
      toast.error('Não foi possível limpar os dados', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Armazenamento" description="Tudo fica somente nesta máquina.">
        <SettingRow
          label="Pasta de dados"
          description="Conversas (SQLite), anexos, artefatos e configurações."
        >
          <Button size="sm" variant="secondary" onClick={openDataDir} leftIcon={<FolderOpen className="size-3.5" />}>
            Abrir pasta
          </Button>
        </SettingRow>
        <SettingRow vertical label="Localização">
          <code className="block w-full truncate rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[11px] text-foreground-muted">
            {appInfo?.dataDir ?? '—'}
          </code>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Zona de perigo"
        description="Estas ações são permanentes e não podem ser desfeitas."
      >
        <SettingsBlock>
          {confirmStep === 0 ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium text-foreground">Limpar todos os dados</p>
                <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">
                  Apaga conversas, mensagens, anexos, artefatos e as API keys salvas.
                </p>
              </div>
              <Button variant="danger" size="sm" onClick={() => setConfirmStep(1)}>
                <Trash2 className="size-3.5" />
                Limpar dados…
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border border-danger/30 bg-danger-soft p-3.5">
              <div className="flex gap-2.5">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-foreground">
                    {confirmStep === 1
                      ? 'Tem certeza que deseja limpar os dados?'
                      : 'Confirmação final'}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">
                    {confirmStep === 1
                      ? 'Conversas, anexos, artefatos, configurações e chaves de API serão apagados desta máquina.'
                      : 'Esta é a última confirmação. Depois de apagar, não há como recuperar as conversas.'}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmStep(0)}
                      disabled={busy}
                    >
                      Cancelar
                    </Button>
                    {confirmStep === 1 ? (
                      <Button size="sm" variant="danger" onClick={() => setConfirmStep(2)}>
                        Continuar
                      </Button>
                    ) : (
                      <Button size="sm" variant="danger" loading={busy} onClick={() => void resetData()}>
                        Apagar tudo definitivamente
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
