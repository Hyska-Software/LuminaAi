import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, FolderOpen, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type {
  CacheSettings,
  CodeEnvironmentStatus,
  InterpreterInfo,
  PermissionMode,
} from '@/lib/types';
import { MAX_STEPS_LIMIT, useAppStore, useUiStore } from '@/lib/store';
import { cn, copyText } from '@/lib/utils';
import { Badge, Button, IconButton, Input, NativeSelect, Slider, Spinner, Switch } from '@/components/ui';
import { countSkillsByOrigin, skillSourceMeta } from '@/components/skills/sources';
import { SettingRow, SettingsBlock, SettingsSection } from './shared';

const TIMEOUT_MIN = 10;
const TIMEOUT_MAX = 600;
const TIMEOUT_STEP = 10;

/** Modos de permissão do harness (mesma ordem do chip do composer). */
const CODE_PERMISSION_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: 'read_only', label: 'Leitura' },
  { value: 'review', label: 'Revisar' },
  { value: 'edit', label: 'Editar' },
  { value: 'autonomous', label: 'Autônomo' },
];

/** Padrão de fábrica quando o backend ainda não devolveu o campo. */
const CODE_DEFAULT_PERMISSION_FALLBACK: PermissionMode = 'autonomous';

function interpreterSourceLabel(source: string): string {
  if (source === 'settings') return 'caminho configurado';
  if (source === 'path') return 'detectado no PATH';
  return source;
}

function InterpreterStatus({ info }: { info: InterpreterInfo | null | undefined }) {
  if (!info) {
    return <Badge tone="warning">Não encontrado</Badge>;
  }
  return (
    <div className="flex min-w-0 flex-col items-end gap-0.5 text-right">
      <code
        title={info.path}
        className="max-w-[280px] truncate font-mono text-[11px] text-foreground-muted"
      >
        {info.path}
      </code>
      <span className="text-[11px] text-foreground-subtle">
        {info.version || 'versão desconhecida'} · {interpreterSourceLabel(info.source)}
      </span>
    </div>
  );
}

export function ToolsTab() {
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const [maxSteps, setMaxSteps] = useState(settings.maxSteps);
  const [temperature, setTemperature] = useState(settings.temperature ?? 0.7);
  const [timeoutSecs, setTimeoutSecs] = useState(settings.codeTimeoutSecs);
  const [dockerImage, setDockerImage] = useState(settings.dockerImage ?? 'node:22-bookworm');
  const [maxConcurrentTurns, setMaxConcurrentTurns] = useState(
    settings.maxConcurrentTurns ?? 3,
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
  const [dockerInfo, setDockerInfo] = useState<string | null>(null);
  const [dockerBusy, setDockerBusy] = useState(false);
  const [environment, setEnvironment] = useState<CodeEnvironmentStatus | null>(null);
  const [environmentLoading, setEnvironmentLoading] = useState(true);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [environmentAttempt, setEnvironmentAttempt] = useState(0);
  const [openingSkills, setOpeningSkills] = useState(false);

  useEffect(() => setMaxSteps(settings.maxSteps), [settings.maxSteps]);
  useEffect(() => {
    if (settings.temperature != null) setTemperature(settings.temperature);
  }, [settings.temperature]);
  useEffect(() => setTimeoutSecs(settings.codeTimeoutSecs), [settings.codeTimeoutSecs]);
  useEffect(
    () => setDockerImage(settings.dockerImage ?? 'node:22-bookworm'),
    [settings.dockerImage],
  );
  useEffect(
    () => setMaxConcurrentTurns(settings.maxConcurrentTurns ?? 3),
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

  useEffect(() => {
    let cancelled = false;
    setEnvironmentLoading(true);
    setEnvironmentError(null);
    api
      .getCodeEnvironment()
      .then((status) => {
        if (!cancelled) setEnvironment(status);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setEnvironmentError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setEnvironmentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [environmentAttempt]);

  const temperatureEnabled = settings.temperature != null;
  const executionEnvironment = settings.executionEnvironment ?? 'local';
  const codeDefaultPermissionMode: PermissionMode =
    settings.codeDefaultPermissionMode ?? CODE_DEFAULT_PERMISSION_FALLBACK;
  const cacheSettings: CacheSettings = {
    showIndicator: settings.cache?.showIndicator ?? true,
    anthropicTtl: settings.cache?.anthropicTtl ?? '1h',
    openaiRetention: settings.cache?.openaiRetention ?? null,
  };
  const saveCacheSettings = (patch: Partial<CacheSettings>) => {
    void saveSettings({ cache: { ...cacheSettings, ...patch } });
  };
  const skills = environment?.skills ?? [];
  const originCounts = countSkillsByOrigin(skills);

  const openSkillsDir = async () => {
    setOpeningSkills(true);
    try {
      await api.openSkillsDir();
    } catch (error) {
      toast.error('Não foi possível abrir a pasta de skills', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setOpeningSkills(false);
    }
  };

  const copyInstallHint = async () => {
    if (!environment?.installHint) return;
    const copied = await copyText(environment.installHint);
    if (copied) toast.success('Comando copiado');
    else toast.error('Não foi possível copiar o comando');
  };

  const retryEnvironment = () => setEnvironmentAttempt((value) => value + 1);

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

      <SettingsSection
        title="Cache de prompt"
        description="Como o Lumina reaproveita o prefixo do prompt nos provedores que medem cache."
      >
        <SettingRow
          label="Mostrar indicador"
          description="Exibe o acerto de cache em tempo real no medidor de contexto do Code e no composer do Chat. Desligar só esconde o indicador: a medição continua."
        >
          <Switch
            checked={cacheSettings.showIndicator}
            onCheckedChange={(checked) => saveCacheSettings({ showIndicator: checked })}
            aria-label="Mostrar indicador de cache"
          />
        </SettingRow>

        <SettingRow
          label="TTL do cache (Anthropic)"
          description="Quanto tempo o prefixo fica cacheado na API da Anthropic. 1 h custa 2× na gravação e reduz renovações no meio do turno; 5 min custa 1,25×."
        >
          <NativeSelect
            value={cacheSettings.anthropicTtl}
            onChange={(event) =>
              saveCacheSettings({ anthropicTtl: event.target.value === '5m' ? '5m' : '1h' })
            }
            aria-label="TTL do cache da Anthropic"
          >
            <option value="1h">1 hora (padrão)</option>
            <option value="5m">5 minutos</option>
          </NativeSelect>
        </SettingRow>

        <SettingRow
          label="Retenção do cache (OpenAI)"
          description="Por quanto tempo a OpenAI mantém o prefixo no cache. Automático deixa o provedor decidir."
        >
          <NativeSelect
            value={cacheSettings.openaiRetention ?? 'auto'}
            onChange={(event) =>
              saveCacheSettings({
                openaiRetention: event.target.value === 'auto' ? null : event.target.value,
              })
            }
            aria-label="Retenção do cache da OpenAI"
          >
            <option value="auto">Automático</option>
            <option value="in_memory">Na memória</option>
            <option value="24h">24 horas</option>
          </NativeSelect>
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

      <SettingsSection
        title="Execução de código"
        description="Permite ao agente executar scripts para criar documentos, planilhas, apresentações e imagens."
      >
        <SettingRow
          label="Permitir execução de código"
          description="Opt-in: o modelo só recebe a ferramenta de execução quando isto está ligado."
        >
          <Switch
            checked={settings.codeExecutionEnabled}
            onCheckedChange={(checked) => void saveSettings({ codeExecutionEnabled: checked })}
            aria-label="Ativar execução de código"
          />
        </SettingRow>

        <SettingsBlock>
          <div className="flex gap-2.5 rounded-xl border border-warning/30 bg-warning-soft p-3">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-[11px] leading-relaxed text-warning">
              O código roda nesta máquina com as suas permissões e acesso à rede —{' '}
              <span className="font-semibold">não é um sandbox de sistema</span>. As chaves de API do
              aplicativo não são repassadas e cada execução tem limite de tempo, mas habilite apenas
              se confiar no que o modelo for executar.
            </p>
          </div>
        </SettingsBlock>

        <SettingRow
          vertical
          label="Tempo limite de execução"
          description={`Cada script é interrompido após ${timeoutSecs} ${timeoutSecs === 1 ? 'segundo' : 'segundos'}.`}
        >
          <Slider
            min={TIMEOUT_MIN}
            max={TIMEOUT_MAX}
            step={TIMEOUT_STEP}
            value={timeoutSecs}
            valueLabel={`${timeoutSecs} s`}
            onValueChange={setTimeoutSecs}
            onValueCommit={(value) => void saveSettings({ codeTimeoutSecs: value })}
            aria-label="Tempo limite de execução"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Concorrência e orçamento"
        description="Quantos turnos podem rodar ao mesmo tempo e quando o app deve parar de gastar. Turnos além do limite aguardam na fila da própria thread."
      >
        <SettingRow
          vertical
          label="Turnos simultâneos (global)"
          description={`Até ${maxConcurrentTurns} turnos rodando ao mesmo tempo em todo o app. O backend também aplica este limite.`}
        >
          <Input
            type="number"
            min={1}
            max={8}
            value={maxConcurrentTurns}
            aria-label="Máximo de turnos simultâneos"
            onChange={(event) => setMaxConcurrentTurns(Number(event.target.value) || 1)}
            onBlur={() =>
              void saveSettings({
                maxConcurrentTurns: Math.max(1, Math.min(8, maxConcurrentTurns)),
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
        <SettingRow
          vertical
          label="Limite diário por agente (US$)"
          description="Vazio desliga. O backend recusa novos turnos quando o custo acumulado do dia atinge o limite."
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
        title="Sandbox de comandos"
        description="Onde os comandos do agente de código rodam. O padrão executa nesta máquina; Docker isola o processo com o workspace montado em /workspace."
      >
        <SettingRow
          label="Ambiente"
          description="O terminal interativo do painel continua local; esta opção vale para as ferramentas run_command/run_checks e jobs do agente."
        >
          <NativeSelect
            value={executionEnvironment}
            aria-label="Ambiente de execução dos comandos do agente"
            onChange={(event) =>
              void saveSettings({
                executionEnvironment: event.target.value === 'docker' ? 'docker' : 'local',
              })
            }
          >
            <option value="local">Este computador</option>
            <option value="docker">Docker</option>
          </NativeSelect>
        </SettingRow>

        {executionEnvironment === 'docker' ? (
          <>
            <SettingRow
              vertical
              label="Imagem Docker"
              description="Precisa existir no Docker local (o app não baixa imagens automaticamente). Ex.: node:22-bookworm, python:3.12, ubuntu:24.04."
            >
              <Input
                value={dockerImage}
                maxLength={200}
                aria-label="Imagem Docker dos comandos do agente"
                placeholder="node:22-bookworm"
                onChange={(event) => setDockerImage(event.target.value)}
                onBlur={() => {
                  const value = dockerImage.trim();
                  if (value && value !== settings.dockerImage) {
                    void saveSettings({ dockerImage: value });
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    const value = dockerImage.trim();
                    if (value && value !== settings.dockerImage) {
                      void saveSettings({ dockerImage: value });
                    }
                  }
                }}
              />
            </SettingRow>
            <SettingRow
              label="Rede no contêiner"
              description="Desligado, o comando roda com --network none. Ligue apenas quando a tarefa precisar baixar dependências ou acessar a internet."
            >
              <Switch
                checked={settings.dockerNetwork ?? false}
                onCheckedChange={(checked) => void saveSettings({ dockerNetwork: checked })}
                aria-label="Permitir rede no contêiner Docker"
              />
            </SettingRow>
            <SettingRow
              vertical
              label="Imagem do computer use"
              description="Imagem gráfica (Xvfb + Chromium + xdotool + noVNC). O agente controla o display; o noVNC fica em 127.0.0.1:6080 para você observar."
            >
              <Input
                defaultValue={settings.computerDockerImage ?? 'lumina/computer:latest'}
                maxLength={200}
                aria-label="Imagem Docker do computer use"
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value) void saveSettings({ computerDockerImage: value });
                }}
              />
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
            <SettingsBlock>
              <div className="flex gap-2.5 rounded-xl border border-warning/30 bg-warning-soft p-3">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                <p className="text-[11px] leading-relaxed text-warning">
                  Docker Desktop/Engine precisa estar instalado e rodando. O workspace é montado
                  em <code>/workspace</code>; o contêiner pode ler e alterar esses arquivos, mas
                  não tem acesso ao resto do computador. Ainda assim, revise o que o agente executa.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={dockerBusy}
                  onClick={() => {
                    setDockerBusy(true);
                    void api
                      .dockerValidateImage(settings.dockerImage ?? 'node:22-bookworm')
                      .then((info) =>
                        setDockerInfo(
                          `${info.image} · ${info.architecture} · ${info.id.slice(0, 19)}…`,
                        ),
                      )
                      .catch((error) => {
                        setDockerInfo(null);
                        toast.error('Imagem Docker inválida', {
                          description: String(error),
                        });
                      })
                      .finally(() => setDockerBusy(false));
                  }}
                >
                  {dockerBusy ? <Spinner className="mr-1.5 size-3.5" /> : null}
                  Validar imagem
                </Button>
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
                {dockerInfo ? (
                  <span className="text-[11px] text-foreground-muted">{dockerInfo}</span>
                ) : null}
              </div>
            </SettingsBlock>
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Sessões de código"
        description="Padrões das novas sessões do layout Code e como o workbench mostra as alterações."
      >
        <SettingRow
          label="Modo de permissão padrão"
          description="Toda nova sessão do Code começa neste modo. Você pode trocar pelo chip de permissão no composer a qualquer momento — a mudança aqui vale para as próximas sessões."
        >
          <NativeSelect
            value={codeDefaultPermissionMode}
            onChange={(event) => {
              const mode = CODE_PERMISSION_OPTIONS.find(
                (option) => option.value === event.target.value,
              )?.value;
              if (mode) void saveSettings({ codeDefaultPermissionMode: mode });
            }}
            aria-label="Modo de permissão padrão das novas sessões do Code"
          >
            {CODE_PERMISSION_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </SettingRow>

        <SettingRow
          label="Abrir diff dos arquivos"
          description="Escolha onde o diff de um arquivo da aba Alterações abre ao clicar."
        >
          <NativeSelect
            value={settings.diffOpenMode ?? 'tab'}
            onChange={(event) =>
              void saveSettings({
                diffOpenMode: event.target.value === 'panel' ? 'panel' : 'tab',
              })
            }
            aria-label="Onde abrir o diff dos arquivos"
          >
            <option value="tab">Em uma aba do chat (padrão)</option>
            <option value="panel">No painel lateral</option>
          </NativeSelect>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Ambiente de código"
        description="Detectado nesta máquina; nada é instalado automaticamente."
      >
        {environmentLoading && !environment ? (
          <SettingsBlock>
            <div className="flex items-center gap-2 text-xs text-foreground-muted">
              <Spinner size="sm" className="text-accent" label="Verificando ambiente de código" />
              Verificando ambiente…
            </div>
          </SettingsBlock>
        ) : null}

        {environmentError ? (
          <SettingsBlock>
            <div className="flex flex-col items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3">
              <div className="flex gap-2.5">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-foreground">
                    Não foi possível verificar o ambiente
                  </p>
                  <p className="mt-0.5 break-words text-[11px] leading-relaxed text-foreground-muted">
                    {environmentError}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="secondary" loading={environmentLoading} onClick={retryEnvironment}>
                Verificar novamente
              </Button>
            </div>
          </SettingsBlock>
        ) : null}

        {environment ? (
          <>
            <SettingRow
              label="Python"
              description="Interpretador usado pelos scripts que geram documentos e planilhas."
            >
              <InterpreterStatus info={environment.python} />
            </SettingRow>

            <SettingRow
              label="Node.js"
              description="Interpretador usado para executar scripts JavaScript."
            >
              <InterpreterStatus info={environment.node} />
            </SettingRow>

            <SettingsBlock>
              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-[13px] font-medium text-foreground">Pacotes opcionais</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">
                    Ampliam os formatos suportados nos scripts de Python. Os helpers embutidos usam
                    somente a biblioteca padrão.
                  </p>
                </div>

                {environment.packages.length ? (
                  <ul className="grid grid-cols-2 gap-1.5">
                    {environment.packages.map((entry) => (
                      <li key={entry.name} className="flex min-w-0 items-center gap-1.5 text-[11px]">
                        <span
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded-full',
                            entry.available
                              ? 'bg-success-soft text-success'
                              : 'bg-danger-soft text-danger',
                          )}
                        >
                          {entry.available ? (
                            <Check aria-hidden className="size-2.5" strokeWidth={2.5} />
                          ) : (
                            <X aria-hidden className="size-2.5" strokeWidth={2.5} />
                          )}
                        </span>
                        <span className="truncate font-mono text-foreground-muted">{entry.name}</span>
                        <span className="sr-only">
                          {entry.available ? 'disponível' : 'não instalado'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-foreground-muted">Nenhum pacote opcional verificado.</p>
                )}

                {environment.installHint ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[11px] text-foreground-subtle">
                      Para instalar os pacotes opcionais, execute:
                    </p>
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5">
                      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[11px] text-foreground-muted">
                        {environment.installHint}
                      </code>
                      <IconButton
                        label="Copiar comando de instalação"
                        size="sm"
                        onClick={() => void copyInstallHint()}
                      >
                        <Copy className="size-3.5" />
                      </IconButton>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={environmentLoading}
                    onClick={retryEnvironment}
                  >
                    Verificar novamente
                  </Button>
                  <span className="text-[11px] text-foreground-subtle">
                    Nada é instalado automaticamente.
                  </span>
                </div>
              </div>
            </SettingsBlock>
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Skills"
        description="Instruções e scripts que o agente pode consultar para tarefas especializadas."
      >
        <SettingRow
          label="Painel de skills na barra lateral"
          description="Mostra o item Skills na barra lateral. Quando desligado, o gerenciamento continua disponível por aqui."
        >
          <Switch
            checked={settings.skillsPanelEnabled}
            onCheckedChange={(checked) => void saveSettings({ skillsPanelEnabled: checked })}
            aria-label="Mostrar painel de skills na barra lateral"
          />
        </SettingRow>

        {environmentLoading && !environment ? (
          <SettingsBlock>
            <div className="flex items-center gap-2 text-xs text-foreground-muted">
              <Spinner size="sm" className="text-accent" label="Carregando skills" />
              Carregando skills…
            </div>
          </SettingsBlock>
        ) : null}

        {environmentError ? (
          <SettingsBlock>
            <p className="text-xs leading-relaxed text-foreground-muted">
              Não foi possível carregar as skills. Tente verificar o ambiente novamente.
            </p>
          </SettingsBlock>
        ) : null}

        {environment ? (
          <SettingsBlock>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="muted">
                  {originCounts.total} {originCounts.total === 1 ? 'skill' : 'skills'}
                </Badge>
                {originCounts.lumina > 0 ? (
                  <Badge tone="accent">{originCounts.lumina} do Lumina</Badge>
                ) : null}
                {originCounts.external > 0 ? (
                  <Badge tone="muted">
                    {originCounts.external} {originCounts.external === 1 ? 'externa' : 'externas'}
                  </Badge>
                ) : null}
                {originCounts.bundled > 0 ? (
                  <Badge tone="success">
                    {originCounts.bundled} {originCounts.bundled === 1 ? 'embutida' : 'embutidas'}
                  </Badge>
                ) : null}
                {originCounts.other > 0 ? (
                  <Badge tone="muted">{originCounts.other} outras</Badge>
                ) : null}
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Sparkles className="size-3.5" />}
                    onClick={() => {
                      // Skills is a main view: leave Settings and replace the
                      // chat column instead of opening a modal.
                      setSettingsOpen(false);
                      setActiveView('skills');
                    }}
                  >
                    Gerenciar skills
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={openingSkills}
                    leftIcon={<FolderOpen className="size-3.5" />}
                    onClick={() => void openSkillsDir()}
                  >
                    Abrir pasta de skills
                  </Button>
                </div>
              </div>

              {skills.length ? (
                <ul className="flex flex-col divide-y divide-border">
                  {skills.map((skill) => {
                    const meta = skillSourceMeta(skill.source);
                    const SkillIcon = meta.icon;
                    return (
                      <li
                        key={`${skill.source}-${skill.name}`}
                        className="flex items-start gap-2 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium">
                            <span
                              className={cn(
                                'font-mono',
                                skill.enabled ? 'text-foreground' : 'text-foreground-muted',
                              )}
                            >
                              {skill.name}
                            </span>
                            <Badge tone={meta.tone}>
                              <SkillIcon aria-hidden className="size-2.5" />
                              {meta.label}
                            </Badge>
                            {!skill.enabled ? <Badge tone="muted">Desativada</Badge> : null}
                          </p>
                          <p
                            className={cn(
                              'mt-0.5 text-[11px] leading-relaxed',
                              skill.enabled ? 'text-foreground-muted' : 'text-foreground-subtle',
                            )}
                          >
                            {skill.description}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-foreground-muted">Nenhuma skill encontrada.</p>
              )}
            </div>
          </SettingsBlock>
        ) : null}
      </SettingsSection>
    </div>
  );
}
