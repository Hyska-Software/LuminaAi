import { useEffect, useState } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import { toast } from 'sonner';

import { Button, Input, Spinner, Switch } from '@/components/ui';
import { api } from '@/lib/api';
import { DEFAULT_COMPUTER_DOCKER_IMAGE } from '@/lib/computerDocker';
import { useAppStore } from '@/lib/store';
import { SettingRow, SettingsBlock, SettingsSection } from './shared';

/**
 * Global settings of the Agentes layout: concurrency/queue, budget,
 * notifications, browser/desktop policy and the private Docker desktop.
 * Per-persona settings (model, instructions, workspace, capabilities) stay in
 * the agent editor.
 */
export function AgentsTab() {
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const [maxConcurrentTurns, setMaxConcurrentTurns] = useState(
    settings.maxConcurrentTurns ?? 10,
  );
  const [maxConcurrentPerAgent, setMaxConcurrentPerAgent] = useState(
    settings.maxConcurrentTurnsPerAgent ?? 1,
  );
  const [maxQueueLength, setMaxQueueLength] = useState(
    settings.maxQueueLengthPerThread ?? 20,
  );
  const [costLimit, setCostLimit] = useState(
    settings.agentDailyCostLimitUsd != null ? String(settings.agentDailyCostLimitUsd) : '',
  );
  const [computerDockerImage, setComputerDockerImage] = useState(
    settings.computerDockerImage ?? DEFAULT_COMPUTER_DOCKER_IMAGE,
  );
  const [computerImageBusy, setComputerImageBusy] = useState(false);
  const [dockerBusy, setDockerBusy] = useState(false);

  useEffect(
    () => setMaxConcurrentTurns(settings.maxConcurrentTurns ?? 10),
    [settings.maxConcurrentTurns],
  );
  useEffect(
    () => setMaxConcurrentPerAgent(settings.maxConcurrentTurnsPerAgent ?? 1),
    [settings.maxConcurrentTurnsPerAgent],
  );
  useEffect(
    () => setMaxQueueLength(settings.maxQueueLengthPerThread ?? 20),
    [settings.maxQueueLengthPerThread],
  );
  useEffect(
    () =>
      setCostLimit(
        settings.agentDailyCostLimitUsd != null
          ? String(settings.agentDailyCostLimitUsd)
          : '',
      ),
    [settings.agentDailyCostLimitUsd],
  );
  useEffect(
    () =>
      setComputerDockerImage(
        settings.computerDockerImage ?? DEFAULT_COMPUTER_DOCKER_IMAGE,
      ),
    [settings.computerDockerImage],
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-xl border border-border bg-surface/50 px-3 py-2 text-[11px] leading-relaxed text-foreground-muted">
        Modelo, instruções, workspace, permissões e capabilities são definidos
        individualmente em cada agente, no editor da persona. Esta aba reúne apenas as
        preferências globais do layout Agentes.
      </p>

      <SettingsSection
        title="Execução e fila"
        description="Quantos turnos podem rodar ao mesmo tempo e o tamanho da fila de cada thread. Turnos além do limite aguardam na fila da própria conversa."
      >
        <SettingRow
          vertical
          label="Turnos simultâneos (global)"
          description={`Até ${maxConcurrentTurns} turnos rodando ao mesmo tempo em todo o app. O backend também aplica este limite.`}
        >
          <Input
            type="number"
            min={1}
            max={32}
            value={maxConcurrentTurns}
            aria-label="Máximo de turnos simultâneos"
            onChange={(event) => setMaxConcurrentTurns(Number(event.target.value) || 1)}
            onBlur={() =>
              void saveSettings({
                maxConcurrentTurns: Math.max(1, Math.min(32, maxConcurrentTurns)),
              })
            }
          />
        </SettingRow>
        <SettingRow
          vertical
          label="Turnos simultâneos por agente"
          description="Evita que um único agente ocupe todos os slots. Padrão: 1."
        >
          <Input
            type="number"
            min={1}
            max={4}
            value={maxConcurrentPerAgent}
            aria-label="Máximo de turnos simultâneos por agente"
            onChange={(event) => setMaxConcurrentPerAgent(Number(event.target.value) || 1)}
            onBlur={() =>
              void saveSettings({
                maxConcurrentTurnsPerAgent: Math.max(1, Math.min(4, maxConcurrentPerAgent)),
              })
            }
          />
        </SettingRow>
        <SettingRow
          vertical
          label="Mensagens na fila por thread"
          description="Quando a fila atinge este tamanho, novas mensagens são recusadas com um aviso."
        >
          <Input
            type="number"
            min={1}
            max={100}
            value={maxQueueLength}
            aria-label="Máximo de mensagens na fila por thread"
            onChange={(event) => setMaxQueueLength(Number(event.target.value) || 1)}
            onBlur={() =>
              void saveSettings({
                maxQueueLengthPerThread: Math.max(1, Math.min(100, maxQueueLength)),
              })
            }
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Orçamento"
        description="Limite de gasto dos agentes por dia. O backend recusa novos turnos quando o limite é atingido."
      >
        <SettingRow
          vertical
          label="Limite diário por agente (US$)"
          description="Vazio desliga. O custo acumulado do dia considera todas as threads do agente."
        >
          <Input
            value={costLimit}
            inputMode="decimal"
            placeholder="Sem limite"
            aria-label="Limite diário de custo por agente em dólares"
            onChange={(event) => setCostLimit(event.target.value)}
            onBlur={() => {
              const value = Number(costLimit.replace(',', '.'));
              void saveSettings({
                agentDailyCostLimitUsd:
                  costLimit.trim() && Number.isFinite(value) && value > 0 ? value : null,
              });
            }}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Notificações"
        description="Avisos de threads de agente em segundo plano. O SO e o toast in-app respeitam estas opções."
      >
        <SettingRow
          label="Notificações ativas"
          description="Desligado, nenhuma notificação de segundo plano é emitida."
        >
          <Switch
            checked={settings.notificationsEnabled ?? true}
            onCheckedChange={(checked) => void saveSettings({ notificationsEnabled: checked })}
            aria-label="Notificações ativas"
          />
        </SettingRow>

        <SettingRow
          label="Não perturbe"
          description="Mantém os avisos apenas no diálogo Atividade, sem toast nem notificação do SO."
        >
          <Switch
            checked={settings.notificationsDnd ?? false}
            onCheckedChange={(checked) => void saveSettings({ notificationsDnd: checked })}
            aria-label="Não perturbe"
          />
        </SettingRow>

        <div className="grid gap-3 sm:grid-cols-2">
          <SettingRow label="Aprovações" description="Ações que precisam de você.">
            <Switch
              checked={settings.notificationsApprovals ?? true}
              onCheckedChange={(checked) =>
                void saveSettings({ notificationsApprovals: checked })
              }
              aria-label="Notificar aprovações"
            />
          </SettingRow>
          <SettingRow label="Perguntas" description="Perguntas estruturadas do agente.">
            <Switch
              checked={settings.notificationsQuestions ?? true}
              onCheckedChange={(checked) =>
                void saveSettings({ notificationsQuestions: checked })
              }
              aria-label="Notificar perguntas"
            />
          </SettingRow>
          <SettingRow label="Conclusões" description="Turnos de agente concluídos.">
            <Switch
              checked={settings.notificationsCompletions ?? true}
              onCheckedChange={(checked) =>
                void saveSettings({ notificationsCompletions: checked })
              }
              aria-label="Notificar conclusões"
            />
          </SettingRow>
          <SettingRow label="Tarefas" description="Tarefas que precisam de uma pessoa.">
            <Switch
              checked={settings.notificationsTasks ?? true}
              onCheckedChange={(checked) => void saveSettings({ notificationsTasks: checked })}
              aria-label="Notificar tarefas"
            />
          </SettingRow>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Navegador controlado"
        description="Política de hosts do navegador CDP. A denylist vence a allowlist; metadata de nuvem é sempre bloqueado."
      >
        <SettingRow
          vertical
          label="Hosts permitidos"
          description="Lista separada por vírgula (ex.: github.com, notion.so). Vazio libera hosts públicos."
        >
          <Input
            defaultValue={(settings.browserAllowedDomains ?? []).join(', ')}
            aria-label="Hosts permitidos no navegador"
            placeholder="github.com, notion.so"
            onBlur={(event) =>
              void saveSettings({
                browserAllowedDomains: event.target.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </SettingRow>
        <SettingRow
          vertical
          label="Hosts bloqueados"
          description="Sempre negados; avaliados antes da allowlist."
        >
          <Input
            defaultValue={(settings.browserBlockedDomains ?? []).join(', ')}
            aria-label="Hosts bloqueados no navegador"
            placeholder="banco.com, admin.interno"
            onBlur={(event) =>
              void saveSettings({
                browserBlockedDomains: event.target.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </SettingRow>
        <SettingRow
          label="Permitir hosts privados"
          description="Localhost, 127.0.0.1 e redes RFC1918. Desligue para evitar SSRF; necessário para dev servers locais."
        >
          <Switch
            checked={settings.browserAllowPrivateHosts ?? true}
            onCheckedChange={(checked) =>
              void saveSettings({ browserAllowPrivateHosts: checked })
            }
            aria-label="Permitir hosts privados no navegador"
          />
        </SettingRow>
        <SettingRow
          label="Navegador em rotinas"
          description="Permite ações de navegador em tarefas/rotinas sem card de aprovação. A allowlist/denylist de hosts continua valendo; desktop continua fail-closed."
        >
          <Switch
            checked={settings.computerAllowUnattendedBrowser ?? false}
            onCheckedChange={(checked) =>
              void saveSettings({ computerAllowUnattendedBrowser: checked })
            }
            aria-label="Permitir navegador em rotinas não assistidas"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Apps do desktop"
        description="Allowlist/denylist por processo ou título da janela, aplicada antes de qualquer clique/teclado. A denylist vence."
      >
        <SettingRow
          vertical
          label="Apps permitidos"
          description="Separados por vírgula (ex.: notepad, chrome, code). Vazio libera todos, exceto a denylist."
        >
          <Input
            defaultValue={(settings.computerAllowedApps ?? []).join(', ')}
            aria-label="Apps permitidos no computador"
            placeholder="notepad, chrome"
            onBlur={(event) =>
              void saveSettings({
                computerAllowedApps: event.target.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </SettingRow>
        <SettingRow
          vertical
          label="Apps bloqueados"
          description="Sempre negados; avaliados antes da allowlist."
        >
          <Input
            defaultValue={(settings.computerBlockedApps ?? []).join(', ')}
            aria-label="Apps bloqueados no computador"
            placeholder="1password, banking"
            onBlur={(event) =>
              void saveSettings({
                computerBlockedApps: event.target.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Desktop privado (computer use)"
        description="Desktop isolado em Docker, independente do sandbox de comandos. Estas opções valem quando o agente usa o ambiente “Desktop privado”."
      >
        <SettingRow
          vertical
          label="Imagem do computer use"
          description="Imagem gráfica publicada no GHCR (Xvfb + Chromium + xdotool + noVNC). Baixe com o botão ou informe outra imagem acessível ao daemon. Para produção, prefira um digest fixo."
        >
          <div className="flex flex-col gap-2">
            <Input
              value={computerDockerImage}
              maxLength={200}
              aria-label="Imagem Docker do computer use"
              placeholder={DEFAULT_COMPUTER_DOCKER_IMAGE}
              onChange={(event) => setComputerDockerImage(event.target.value)}
              onBlur={() => {
                const value = computerDockerImage.trim();
                if (value && value !== settings.computerDockerImage) {
                  void saveSettings({ computerDockerImage: value });
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  const value = computerDockerImage.trim();
                  if (value && value !== settings.computerDockerImage) {
                    void saveSettings({ computerDockerImage: value });
                  }
                }
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={computerImageBusy || !computerDockerImage.trim()}
                aria-label="Baixar imagem do computer use"
                onClick={() => {
                  const image = computerDockerImage.trim();
                  if (!image) return;
                  if (image !== settings.computerDockerImage) {
                    void saveSettings({ computerDockerImage: image });
                  }
                  setComputerImageBusy(true);
                  void api
                    .dockerPullImage(image)
                    .then(() =>
                      toast.success('Imagem do computer use baixada', { description: image }),
                    )
                    .catch((error) =>
                      toast.error('Não foi possível baixar a imagem', {
                        description: String(error),
                      }),
                    )
                    .finally(() => setComputerImageBusy(false));
                }}
              >
                {computerImageBusy ? (
                  <Spinner className="mr-1.5 size-3.5" />
                ) : (
                  <Download className="mr-1.5 size-3.5" />
                )}
                Baixar imagem
              </Button>
              {computerDockerImage.trim() !== DEFAULT_COMPUTER_DOCKER_IMAGE ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={computerImageBusy}
                  onClick={() => {
                    setComputerDockerImage(DEFAULT_COMPUTER_DOCKER_IMAGE);
                    void saveSettings({ computerDockerImage: DEFAULT_COMPUTER_DOCKER_IMAGE });
                  }}
                >
                  Usar imagem publicada
                </Button>
              ) : null}
            </div>
          </div>
        </SettingRow>
        <SettingRow
          vertical
          label="Container do computer use"
          description="Nome fixo do container gráfico. Ele é criado no primeiro screenshot e mantido entre ações."
        >
          <Input
            defaultValue={settings.computerDockerContainer ?? 'lumina-computer'}
            maxLength={80}
            aria-label="Nome do container do computer use"
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value) void saveSettings({ computerDockerContainer: value });
            }}
          />
        </SettingRow>
        <div className="grid gap-3 sm:grid-cols-2">
          <SettingRow
            vertical
            label="Ações por turno"
            description="Limite de computer use em um único turno."
          >
            <Input
              type="number"
              min={1}
              max={200}
              defaultValue={settings.computerMaxActionsPerTurn ?? 20}
              aria-label="Máximo de ações de computer use por turno"
              onBlur={(event) => {
                const value = Math.max(1, Math.min(200, Number(event.target.value) || 20));
                void saveSettings({ computerMaxActionsPerTurn: value });
              }}
            />
          </SettingRow>
          <SettingRow
            vertical
            label="Ações por hora"
            description="Limite por agente em janela móvel de uma hora."
          >
            <Input
              type="number"
              min={1}
              max={2000}
              defaultValue={settings.computerMaxActionsPerHour ?? 120}
              aria-label="Máximo de ações de computer use por hora"
              onBlur={(event) => {
                const value = Math.max(1, Math.min(2_000, Number(event.target.value) || 120));
                void saveSettings({ computerMaxActionsPerHour: value });
              }}
            />
          </SettingRow>
        </div>
        <SettingsBlock>
          <div className="flex gap-2.5 rounded-xl border border-warning/30 bg-warning-soft p-3">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-[11px] leading-relaxed text-warning">
              Docker Desktop/Engine precisa estar instalado e rodando. O agente controla um display
              isolado no container; o noVNC fica em loopback, somente para você observar.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={dockerBusy}
              onClick={() => {
                setDockerBusy(true);
                void api
                  .dockerCleanup()
                  .then((count) =>
                    toast.success(
                      count === 0
                        ? 'Nenhum container Lumina ativo'
                        : `${count} container(s) removido(s)`,
                    ),
                  )
                  .catch((error) =>
                    toast.error('Não foi possível limpar', {
                      description: String(error),
                    }),
                  )
                  .finally(() => setDockerBusy(false));
              }}
            >
              Limpar containers
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void api
                  .platformDiagnostics()
                  .then((diagnostics) =>
                    toast.info(`Diagnóstico · v${diagnostics.version}`, {
                      description: `${diagnostics.activeTurns.length} turno(s) ativo(s) · ${diagnostics.openTasks} tarefa(s) aberta(s) · ${diagnostics.activeComputerSessions} sessão(ões) de computer use`,
                    }),
                  )
                  .catch((error) =>
                    toast.error('Não foi possível ler o diagnóstico', {
                      description: String(error),
                    }),
                  );
              }}
            >
              Diagnóstico
            </Button>
          </div>
        </SettingsBlock>
      </SettingsSection>
    </div>
  );
}
