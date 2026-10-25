import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, FolderOpen, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { CodeEnvironmentStatus, InterpreterInfo } from '@/lib/types';
import { MAX_STEPS_LIMIT, useAppStore, useUiStore } from '@/lib/store';
import { cn, copyText } from '@/lib/utils';
import { Badge, Button, IconButton, Slider, Spinner, Switch } from '@/components/ui';
import { countSkillsByOrigin, skillSourceMeta } from '@/components/skills/sources';
import { SettingRow, SettingsBlock, SettingsSection } from './shared';

const TIMEOUT_MIN = 10;
const TIMEOUT_MAX = 600;
const TIMEOUT_STEP = 10;

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
