/**
 * Settings → Sobre → Atualizações: manual check, automatic-check preference and
 * the same download/install actions used by the title-bar popover.
 */
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Badge, Button, Switch } from '@/components/ui';
import { UpdateActions, updateCheckedLabel } from '@/components/layout/UpdatePanel';
import { openExternalUrl } from '@/components/chat/external';
import { useAppStore, useUpdateStore } from '@/lib/store';
import { SettingRow, SettingsSection } from './shared';

function statusLabel(
  phase: string,
  available: boolean,
  errorScope: string | null,
  lastCheckAt: number | null | undefined,
): string {
  if (phase === 'checking') return 'Verificando atualizações…';
  if (phase === 'downloading') return 'Baixando atualização…';
  if (phase === 'verifying') return 'Verificando integridade do download…';
  if (phase === 'installing') return 'Abrindo instalador…';
  if (phase === 'error' && errorScope === 'download') return 'Falha ao baixar a atualização';
  if (available) return 'Atualização disponível';
  if (phase === 'up-to-date') return 'Você está na versão mais recente';
  if (phase === 'error') return 'Não foi possível verificar atualizações';
  if (lastCheckAt) return 'Tudo atualizado';
  return 'Nenhuma verificação concluída ainda';
}

export function UpdateSection() {
  const appInfo = useAppStore((state) => state.appInfo);
  const phase = useUpdateStore((state) => state.phase);
  const info = useUpdateStore((state) => state.info);
  const preferences = useUpdateStore((state) => state.preferences);
  const error = useUpdateStore((state) => state.error);
  const errorScope = useUpdateStore((state) => state.errorScope);
  const check = useUpdateStore((state) => state.check);
  const setAutoCheck = useUpdateStore((state) => state.setAutoCheck);
  const skip = useUpdateStore((state) => state.skip);
  const unskip = useUpdateStore((state) => state.unskip);

  const available = Boolean(info?.available);
  const checked = updateCheckedLabel(preferences.lastCheckAt);
  const checking = phase === 'checking';
  const installing = phase === 'installing';
  const busyDownload = phase === 'downloading' || phase === 'verifying';
  const skipped = preferences.skippedVersion;

  const detail = (() => {
    if (errorScope === 'check' && error) {
      return info
        ? `${error} Mostrando o último resultado.`
        : error;
    }
    if (available && info) {
      const where = info.asset ? `para ${info.asset.platformLabel}` : 'sem instalador para esta plataforma';
      return `${checked ?? 'Verificação recente'} · ${where}.`;
    }
    if (checked) return checked;
    return 'O Lumina consulta o GitHub em busca de versões estáveis. Nada é instalado sem a sua confirmação.';
  })();

  return (
    <SettingsSection
      title="Atualizações"
      description="Baixa e instala versões publicadas no GitHub. O download é verificado por SHA-256 e a instalação é sempre confirmada por você."
    >
      <SettingRow label="Versão atual" description="Versão do Lumina em execução.">
        <Badge tone="accent" size="md">
          v{appInfo?.version ?? info?.currentVersion ?? '—'}
        </Badge>
      </SettingRow>

      <SettingRow
        label="Atualizações automáticas"
        description="Verifica ao abrir e uma vez por dia. Baixar e instalar continuam sendo decisões suas."
      >
        <Switch
          checked={preferences.autoCheck}
          onCheckedChange={(value) => void setAutoCheck(value)}
          aria-label="Verificar atualizações automaticamente"
        />
      </SettingRow>

      <SettingRow vertical label="Status" description={detail}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-foreground"
              aria-live="polite"
            >
              {statusLabel(phase, available, errorScope, preferences.lastCheckAt)}
            </span>
            {available && info ? (
              <Badge tone="accent" size="sm">
                v{info.latestVersion}
              </Badge>
            ) : null}
            {info?.stale || (errorScope === 'check' && info) ? (
              <Badge tone="warning" size="sm">
                Sem conexão
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
              Verificar agora
            </Button>
            {available && info ? (
              <Button
                size="sm"
                variant="ghost"
                rightIcon={<ExternalLink className="size-3.5" strokeWidth={1.75} />}
                onClick={() => void openExternalUrl(info.htmlUrl)}
              >
                Ver no GitHub
              </Button>
            ) : null}
            {available ? (
              <Button size="sm" variant="ghost" onClick={() => void skip()}>
                Ignorar esta versão
              </Button>
            ) : null}
          </div>

          {available ? <UpdateActions /> : null}

          {!available && skipped ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-foreground-muted">
              <span>A versão v{skipped} está ignorada.</span>
              <Button size="sm" variant="ghost" onClick={() => void unskip()}>
                Mostrar novamente
              </Button>
            </div>
          ) : null}
        </div>
      </SettingRow>
    </SettingsSection>
  );
}
