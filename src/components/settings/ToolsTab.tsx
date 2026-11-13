import { Trans, useTranslation } from 'react-i18next';
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
import { AUTONOMOUS_MODE_WARNING_KEY } from '@/lib/permissionModes';
import { useAppStore, useUiStore } from '@/lib/store';
import { cn, copyText } from '@/lib/utils';
import { Badge, Button, IconButton, Input, NativeSelect, Slider, Spinner, Switch } from '@/components/ui';
import { countSkillsByOrigin, localizedSkillMeta, skillSourceMeta } from '@/components/skills/sources';
import { SettingRow, SettingsBlock, SettingsSection } from './shared';

const TIMEOUT_MIN = 10;
const TIMEOUT_MAX = 600;
const TIMEOUT_STEP = 10;

/** Factory default when the backend has not returned the field yet. */
const CODE_DEFAULT_PERMISSION_FALLBACK: PermissionMode = 'autonomous';

function InterpreterStatus({ info }: { info: InterpreterInfo | null | undefined }) {
  const { t } = useTranslation('settings');
  if (!info) {
    return <Badge tone="warning">{t('tools.environment.notFound')}</Badge>;
  }
  const sourceLabel =
    info.source === 'settings'
      ? t('tools.environment.sourceConfigured')
      : info.source === 'path'
        ? t('tools.environment.sourcePath')
        : info.source;
  return (
    <div className="flex min-w-0 flex-col items-end gap-0.5 text-right">
      <code
        title={info.path}
        className="max-w-[280px] truncate font-mono text-[11px] text-foreground-muted"
      >
        {info.path}
      </code>
      <span className="text-[11px] text-foreground-subtle">
        {info.version || t('tools.environment.versionUnknown')} · {sourceLabel}
      </span>
    </div>
  );
}

export function ToolsTab() {
  const { t } = useTranslation('settings');
  const { t: codeT } = useTranslation('code');
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const [timeoutSecs, setTimeoutSecs] = useState(settings.codeTimeoutSecs);
  const [dockerImage, setDockerImage] = useState(settings.dockerImage ?? 'node:22-bookworm');
  const [dockerInfo, setDockerInfo] = useState<string | null>(null);
  const [dockerBusy, setDockerBusy] = useState(false);
  const [environment, setEnvironment] = useState<CodeEnvironmentStatus | null>(null);
  const [environmentLoading, setEnvironmentLoading] = useState(true);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [environmentAttempt, setEnvironmentAttempt] = useState(0);
  const [openingSkills, setOpeningSkills] = useState(false);

  useEffect(() => setTimeoutSecs(settings.codeTimeoutSecs), [settings.codeTimeoutSecs]);
  useEffect(
    () => setDockerImage(settings.dockerImage ?? 'node:22-bookworm'),
    [settings.dockerImage],
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
  const permissionOptions: { value: PermissionMode; label: string }[] = [
    { value: 'read_only', label: t('tools.codeSessions.permission.read_only') },
    { value: 'review', label: t('tools.codeSessions.permission.review') },
    { value: 'edit', label: t('tools.codeSessions.permission.edit') },
    { value: 'autonomous', label: t('tools.codeSessions.permission.autonomous') },
  ];

  const openSkillsDir = async () => {
    setOpeningSkills(true);
    try {
      await api.openSkillsDir();
    } catch (error) {
      toast.error(t('tools.skills.openFolderFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setOpeningSkills(false);
    }
  };

  const copyInstallHint = async () => {
    if (!environment?.installHint) return;
    const copied = await copyText(environment.installHint);
    if (copied) toast.success(t('tools.skills.copied'));
    else toast.error(t('tools.skills.copyFailed'));
  };

  const retryEnvironment = () => setEnvironmentAttempt((value) => value + 1);

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t('tools.agent.title')} description={t('tools.agent.description')}>
        <SettingRow
          label={t('tools.agent.webSearch.label')}
          description={t('tools.agent.webSearch.description')}
        >
          <Switch
            checked={settings.webSearchEnabled}
            onCheckedChange={(checked) => void saveSettings({ webSearchEnabled: checked })}
            aria-label={t('tools.agent.webSearch.aria')}
          />
        </SettingRow>

        <SettingRow
          label={t('tools.agent.fileCreation.label')}
          description={t('tools.agent.fileCreation.description')}
        >
          <Switch
            checked={settings.fileCreationEnabled}
            onCheckedChange={(checked) => void saveSettings({ fileCreationEnabled: checked })}
            aria-label={t('tools.agent.fileCreation.aria')}
          />
        </SettingRow>

        <SettingRow
          label={t('tools.agent.attachments.label')}
          description={t('tools.agent.attachments.description')}
        >
          <Switch
            checked={settings.includeAttachments}
            onCheckedChange={(checked) => void saveSettings({ includeAttachments: checked })}
            aria-label={t('tools.agent.attachments.aria')}
          />
        </SettingRow>

        <SettingRow
          label={t('tools.agent.autoTitle.label')}
          description={t('tools.agent.autoTitle.description')}
        >
          <Switch
            checked={settings.autoTitle}
            onCheckedChange={(checked) => void saveSettings({ autoTitle: checked })}
            aria-label={t('tools.agent.autoTitle.aria')}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('tools.cache.title')} description={t('tools.cache.description')}>
        <SettingRow
          label={t('tools.cache.indicator.label')}
          description={t('tools.cache.indicator.description')}
        >
          <Switch
            checked={cacheSettings.showIndicator}
            onCheckedChange={(checked) => saveCacheSettings({ showIndicator: checked })}
            aria-label={t('tools.cache.indicator.aria')}
          />
        </SettingRow>

        <SettingRow
          label={t('tools.cache.anthropicTtl.label')}
          description={t('tools.cache.anthropicTtl.description')}
        >
          <NativeSelect
            value={cacheSettings.anthropicTtl}
            onChange={(event) =>
              saveCacheSettings({ anthropicTtl: event.target.value === '5m' ? '5m' : '1h' })
            }
            aria-label={t('tools.cache.anthropicTtl.aria')}
          >
            <option value="1h">{t('tools.cache.anthropicTtl.oneHour')}</option>
            <option value="5m">{t('tools.cache.anthropicTtl.fiveMinutes')}</option>
          </NativeSelect>
        </SettingRow>

        <SettingRow
          label={t('tools.cache.openaiRetention.label')}
          description={t('tools.cache.openaiRetention.description')}
        >
          <NativeSelect
            value={cacheSettings.openaiRetention ?? 'auto'}
            onChange={(event) =>
              saveCacheSettings({
                openaiRetention: event.target.value === 'auto' ? null : event.target.value,
              })
            }
            aria-label={t('tools.cache.openaiRetention.aria')}
          >
            <option value="auto">{t('tools.cache.openaiRetention.auto')}</option>
            <option value="in_memory">{t('tools.cache.openaiRetention.memory')}</option>
            <option value="24h">{t('tools.cache.openaiRetention.day')}</option>
          </NativeSelect>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t('tools.codeExecution.title')}
        description={t('tools.codeExecution.description')}
      >
        <SettingRow
          label={t('tools.codeExecution.enable.label')}
          description={t('tools.codeExecution.enable.description')}
        >
          <Switch
            checked={settings.codeExecutionEnabled}
            onCheckedChange={(checked) => void saveSettings({ codeExecutionEnabled: checked })}
            aria-label={t('tools.codeExecution.enable.aria')}
          />
        </SettingRow>

        <SettingsBlock>
          <div className="flex gap-2.5 rounded-xl bg-warning-soft p-3">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-[11px] leading-relaxed text-warning">
              <Trans
                ns="settings"
                i18nKey="tools.codeExecution.warning"
                components={{ b: <span className="font-semibold" /> }}
              />
            </p>
          </div>
        </SettingsBlock>

        <SettingRow
          vertical
          label={t('tools.codeExecution.timeout.label')}
          description={t('tools.codeExecution.timeout.description', { count: timeoutSecs })}
        >
          <Slider
            min={TIMEOUT_MIN}
            max={TIMEOUT_MAX}
            step={TIMEOUT_STEP}
            value={timeoutSecs}
            valueLabel={`${timeoutSecs} s`}
            onValueChange={setTimeoutSecs}
            onValueCommit={(value) => void saveSettings({ codeTimeoutSecs: value })}
            aria-label={t('tools.codeExecution.timeout.aria')}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('tools.sandbox.title')} description={t('tools.sandbox.description')}>
        <SettingRow
          label={t('tools.sandbox.environment.label')}
          description={t('tools.sandbox.environment.description')}
        >
          <NativeSelect
            value={executionEnvironment}
            aria-label={t('tools.sandbox.environment.aria')}
            onChange={(event) =>
              void saveSettings({
                executionEnvironment: event.target.value === 'docker' ? 'docker' : 'local',
              })
            }
          >
            <option value="local">{t('tools.sandbox.environment.local')}</option>
            <option value="docker">{t('tools.sandbox.environment.docker')}</option>
          </NativeSelect>
        </SettingRow>

        {executionEnvironment === 'docker' ? (
          <>
            <SettingRow
              vertical
              label={t('tools.sandbox.image.label')}
              description={t('tools.sandbox.image.description')}
            >
              <Input
                value={dockerImage}
                maxLength={200}
                aria-label={t('tools.sandbox.image.aria')}
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
              label={t('tools.sandbox.network.label')}
              description={t('tools.sandbox.network.description')}
            >
              <Switch
                checked={settings.dockerNetwork ?? false}
                onCheckedChange={(checked) => void saveSettings({ dockerNetwork: checked })}
                aria-label={t('tools.sandbox.network.aria')}
              />
            </SettingRow>
            <div className="grid gap-3 sm:grid-cols-3">
              <SettingRow
                vertical
                label={t('tools.sandbox.memory.label')}
                description={t('tools.sandbox.memory.description')}
              >
                <Input
                  type="number"
                  min={256}
                  max={16384}
                  defaultValue={settings.dockerMemoryMb ?? 2048}
                  aria-label={t('tools.sandbox.memory.aria')}
                  onBlur={(event) => {
                    const value = Math.max(256, Math.min(16_384, Number(event.target.value) || 2048));
                    void saveSettings({ dockerMemoryMb: value });
                  }}
                />
              </SettingRow>
              <SettingRow
                vertical
                label={t('tools.sandbox.cpus.label')}
                description={t('tools.sandbox.cpus.description')}
              >
                <Input
                  type="number"
                  min={0.25}
                  max={16}
                  step={0.25}
                  defaultValue={settings.dockerCpus ?? 2}
                  aria-label={t('tools.sandbox.cpus.aria')}
                  onBlur={(event) => {
                    const value = Math.max(0.25, Math.min(16, Number(event.target.value) || 2));
                    void saveSettings({ dockerCpus: value });
                  }}
                />
              </SettingRow>
              <SettingRow
                vertical
                label={t('tools.sandbox.pids.label')}
                description={t('tools.sandbox.pids.description')}
              >
                <Input
                  type="number"
                  min={32}
                  max={4096}
                  defaultValue={settings.dockerPidsLimit ?? 256}
                  aria-label={t('tools.sandbox.pids.aria')}
                  onBlur={(event) => {
                    const value = Math.max(32, Math.min(4096, Number(event.target.value) || 256));
                    void saveSettings({ dockerPidsLimit: value });
                  }}
                />
              </SettingRow>
            </div>
            <SettingRow
              label={t('tools.sandbox.readOnlyRoot.label')}
              description={t('tools.sandbox.readOnlyRoot.description')}
            >
              <Switch
                checked={settings.dockerReadOnlyRoot ?? true}
                onCheckedChange={(checked) => void saveSettings({ dockerReadOnlyRoot: checked })}
                aria-label={t('tools.sandbox.readOnlyRoot.aria')}
              />
            </SettingRow>
            <SettingsBlock>
              <div className="flex gap-2.5 rounded-xl bg-warning-soft p-3">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                <p className="text-[11px] leading-relaxed text-warning">
                  <Trans
                    ns="settings"
                    i18nKey="tools.sandbox.warning"
                    components={{ code: <code /> }}
                  />
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
                        toast.error(t('tools.sandbox.invalidImage'), {
                          description: String(error),
                        });
                      })
                      .finally(() => setDockerBusy(false));
                  }}
                >
                  {dockerBusy ? <Spinner className="mr-1.5 size-3.5" /> : null}
                  {t('tools.sandbox.validate')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={dockerBusy}
                  aria-label={t('tools.sandbox.pullAria')}
                  onClick={() => {
                    setDockerBusy(true);
                    void api
                      .dockerPullImage(settings.dockerImage ?? 'node:22-bookworm')
                      .then((image) => toast.success(t('tools.sandbox.available', { image })))
                      .catch((error) =>
                        toast.error(t('tools.sandbox.pullFailed'), {
                          description: String(error),
                        }),
                      )
                      .finally(() => setDockerBusy(false));
                  }}
                >
                  {t('tools.sandbox.download')}
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
        title={t('tools.codeSessions.title')}
        description={t('tools.codeSessions.description')}
      >
        <SettingRow
          label={t('tools.codeSessions.permission.label')}
          description={t('tools.codeSessions.permission.description')}
        >
          <NativeSelect
            value={codeDefaultPermissionMode}
            onChange={(event) => {
              const mode = permissionOptions.find(
                (option) => option.value === event.target.value,
              )?.value;
              if (mode) void saveSettings({ codeDefaultPermissionMode: mode });
            }}
            aria-label={t('tools.codeSessions.permission.aria')}
          >
            {permissionOptions.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </SettingRow>

        {codeDefaultPermissionMode === 'autonomous' ? (
          <p
            role="status"
            className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-[11.5px] leading-relaxed text-warning"
          >
            {codeT(AUTONOMOUS_MODE_WARNING_KEY)}
          </p>
        ) : null}

        <SettingRow
          label={t('tools.codeSessions.diff.label')}
          description={t('tools.codeSessions.diff.description')}
        >
          <NativeSelect
            value={settings.diffOpenMode ?? 'tab'}
            onChange={(event) =>
              void saveSettings({
                diffOpenMode: event.target.value === 'panel' ? 'panel' : 'tab',
              })
            }
            aria-label={t('tools.codeSessions.diff.aria')}
          >
            <option value="tab">{t('tools.codeSessions.diff.tab')}</option>
            <option value="panel">{t('tools.codeSessions.diff.panel')}</option>
          </NativeSelect>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t('tools.environment.title')}
        description={t('tools.environment.description')}
      >
        {environmentLoading && !environment ? (
          <SettingsBlock>
            <div className="flex items-center gap-2 text-xs text-foreground-muted">
              <Spinner size="sm" className="text-accent" label={t('tools.environment.checking')} />
              {t('tools.environment.checkingShort')}
            </div>
          </SettingsBlock>
        ) : null}

        {environmentError ? (
          <SettingsBlock>
            <div className="flex flex-col items-start gap-2 rounded-xl bg-danger-soft p-3">
              <div className="flex gap-2.5">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-foreground">
                    {t('tools.environment.errorTitle')}
                  </p>
                  <p className="mt-0.5 break-words text-[11px] leading-relaxed text-foreground-muted">
                    {environmentError}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="secondary" loading={environmentLoading} onClick={retryEnvironment}>
                {t('tools.environment.retry')}
              </Button>
            </div>
          </SettingsBlock>
        ) : null}

        {environment ? (
          <>
            <SettingRow
              label={t('tools.environment.python.label')}
              description={t('tools.environment.python.description')}
            >
              <InterpreterStatus info={environment.python} />
            </SettingRow>

            <SettingRow
              label={t('tools.environment.node.label')}
              description={t('tools.environment.node.description')}
            >
              <InterpreterStatus info={environment.node} />
            </SettingRow>

            <SettingsBlock>
              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-[13px] font-medium text-foreground">
                    {t('tools.environment.packages.title')}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">
                    {t('tools.environment.packages.description')}
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
                          {entry.available
                            ? t('tools.environment.packages.available')
                            : t('tools.environment.packages.unavailable')}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-foreground-muted">
                    {t('tools.environment.packages.none')}
                  </p>
                )}

                {environment.installHint ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[11px] text-foreground-subtle">
                      {t('tools.environment.packages.installHint')}
                    </p>
                    <div className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5">
                      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[11px] text-foreground-muted">
                        {environment.installHint}
                      </code>
                      <IconButton
                        label={t('tools.environment.packages.copyInstall')}
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
                    {t('tools.environment.retry')}
                  </Button>
                  <span className="text-[11px] text-foreground-subtle">
                    {t('tools.environment.packages.nothingInstalled')}
                  </span>
                </div>
              </div>
            </SettingsBlock>
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t('tools.skills.title')} description={t('tools.skills.description')}>
        <SettingRow
          label={t('tools.skills.panel.label')}
          description={t('tools.skills.panel.description')}
        >
          <Switch
            checked={settings.skillsPanelEnabled}
            onCheckedChange={(checked) => void saveSettings({ skillsPanelEnabled: checked })}
            aria-label={t('tools.skills.panel.aria')}
          />
        </SettingRow>

        {environmentLoading && !environment ? (
          <SettingsBlock>
            <div className="flex items-center gap-2 text-xs text-foreground-muted">
              <Spinner size="sm" className="text-accent" label={t('tools.skills.loading')} />
              {t('tools.skills.loadingShort')}
            </div>
          </SettingsBlock>
        ) : null}

        {environmentError ? (
          <SettingsBlock>
            <p className="text-xs leading-relaxed text-foreground-muted">{t('tools.skills.error')}</p>
          </SettingsBlock>
        ) : null}

        {environment ? (
          <SettingsBlock>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="muted">{t('tools.skills.count', { count: originCounts.total })}</Badge>
                {originCounts.zylara > 0 ? (
                  <Badge tone="accent">
                    {t('tools.skills.ofZylara', { count: originCounts.zylara })}
                  </Badge>
                ) : null}
                {originCounts.external > 0 ? (
                  <Badge tone="muted">
                    {t('tools.skills.external', { count: originCounts.external })}
                  </Badge>
                ) : null}
                {originCounts.bundled > 0 ? (
                  <Badge tone="success">
                    {t('tools.skills.bundled', { count: originCounts.bundled })}
                  </Badge>
                ) : null}
                {originCounts.other > 0 ? (
                  <Badge tone="muted">{t('tools.skills.other', { count: originCounts.other })}</Badge>
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
                    {t('tools.skills.manage')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={openingSkills}
                    leftIcon={<FolderOpen className="size-3.5" />}
                    onClick={() => void openSkillsDir()}
                  >
                    {t('tools.skills.openFolder')}
                  </Button>
                </div>
              </div>

              {skills.length ? (
                <ul className="flex flex-col divide-y divide-border">
                  {skills.map((skill) => {
                    const meta = skillSourceMeta(skill.source);
                    const SkillIcon = meta.icon;
                    const localized = localizedSkillMeta(skill);
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
                              {localized.name}
                            </span>
                            <Badge tone={meta.tone}>
                              <SkillIcon aria-hidden className="size-2.5" />
                              {meta.label}
                            </Badge>
                            {!skill.enabled ? (
                              <Badge tone="muted">{t('tools.skills.disabled')}</Badge>
                            ) : null}
                          </p>
                          <p
                            className={cn(
                              'mt-0.5 text-[11px] leading-relaxed',
                              skill.enabled ? 'text-foreground-muted' : 'text-foreground-subtle',
                            )}
                          >
                            {localized.description}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-foreground-muted">{t('tools.skills.empty')}</p>
              )}
            </div>
          </SettingsBlock>
        ) : null}
      </SettingsSection>
    </div>
  );
}
