import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  CalendarClock,
  ChevronRight,
  Cloud,
  Expand,
  Globe2,
  Laptop,
  Loader2,
  Monitor,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Square,
} from 'lucide-react';
import { toast } from 'sonner';

import type { AgentPanelContext } from './AgentPanel';
import { inputFromAgent } from './agentUtils';
import { ComputerDockerHelp, isComputerDockerError } from './ComputerDockerHelp';
import { PrivateDesktopViewer } from './PrivateDesktopViewer';
import { ComputerActivity } from './ComputerActivity';
import { useComputerControlEvents } from './useComputerControlEvents';
import { AgentWorkspaceNotice } from './AgentWorkspaceNotice';
import { Badge, Button, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useAgentStore, useChatStore, useUiStore } from '@/lib/store';
import type { ComputerEnvironment, ComputerPreview } from '@/lib/types';
import { cn } from '@/lib/utils';

type Translate = TFunction<'agents'>;

const ENVIRONMENTS: Array<{
  id: ComputerEnvironment | 'cloud';
  titleKey: string;
  descriptionKey: string;
  icon: typeof Monitor;
  disabled?: boolean;
  badgeKey?: string;
}> = [
  {
    id: 'auto',
    titleKey: 'screen.environments.auto.title',
    descriptionKey: 'screen.environments.auto.description',
    icon: Sparkles,
  },
  {
    id: 'private_desktop',
    titleKey: 'screen.environments.privateDesktop.title',
    descriptionKey: 'screen.environments.privateDesktop.description',
    icon: Monitor,
  },
  {
    id: 'this_computer',
    titleKey: 'screen.environments.thisComputer.title',
    descriptionKey: 'screen.environments.thisComputer.description',
    icon: Laptop,
  },
  {
    id: 'browser',
    titleKey: 'screen.environments.browser.title',
    descriptionKey: 'screen.environments.browser.description',
    icon: Globe2,
  },
  {
    id: 'off',
    titleKey: 'screen.environments.off.title',
    descriptionKey: 'screen.environments.off.description',
    icon: Square,
  },
  {
    id: 'cloud',
    titleKey: 'screen.environments.cloud.title',
    descriptionKey: 'screen.environments.cloud.description',
    icon: Cloud,
    disabled: true,
    badgeKey: 'screen.environments.cloud.badge',
  },
];

function environmentTitle(value: string, t: Translate): string {
  const entry = ENVIRONMENTS.find((candidate) => candidate.id === value);
  return entry ? t(entry.titleKey as never) : value;
}

export function AgentPanelScreen({ context }: { context: AgentPanelContext }) {
  const { t } = useTranslation('agents');
  const { agent, conversation } = context;
  const conversationId = conversation?.id ?? null;
  const updateAgent = useAgentStore((state) => state.update);
  const startNewConversation = useChatStore((state) => state.startNewConversation);
  const turnActive = useChatStore((state) => Boolean(conversationId && state.streamsByConversation[conversationId]));
  const openSettings = useUiStore((state) => state.openSettings);
  const setAgentPanelTab = useUiStore((state) => state.setAgentPanelTab);
  const [preview, setPreview] = useState<ComputerPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [environmentBusy, setEnvironmentBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [routineCount, setRoutineCount] = useState(0);
  const [localExpanded, setLocalExpanded] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const loadingRef = useRef(false);
  const previewGeneration = useRef(0);
  const controlRevision = useRef(0);
  const environment = (agent.computerEnvironment ?? 'auto') as ComputerEnvironment;
  const computerCapable =
    agent.capabilities.computerUse || agent.capabilities.screenCapture;
  const previewAvailable =
    Boolean(conversationId) &&
    environment !== 'off' &&
    environment !== 'browser' &&
    computerCapable;
  const dockerSetupError = Boolean(previewError && isComputerDockerError(previewError));
  useComputerControlEvents(conversationId, (control) => {
    controlRevision.current += 1;
    setPreview((current) => current ? { ...current, paused: control.paused, takenOver: control.takenOver && control.target === 'desktop', controlTarget: control.target } : current);
  });

  const loadPreview = useCallback(async () => {
    if (!conversationId || !previewAvailable || loadingRef.current) return;
    const generation = previewGeneration.current;
    loadingRef.current = true;
    setPreviewLoading(true);
    try {
      const next = await api.computerPreview(conversationId);
      if (generation === previewGeneration.current) {
        setPreview({ ...next, takenOver: next.takenOver && next.controlTarget === 'desktop' });
        setPreviewError(null);
      }
    } catch (error) {
      if (generation === previewGeneration.current) {
        setPreview(null);
        setPreviewError(String(error));
      }
    } finally {
      loadingRef.current = false;
      setPreviewLoading(false);
    }
  }, [conversationId, previewAvailable]);

  useEffect(() => {
    previewGeneration.current += 1;
    setPreview(null);
    setPreviewError(null);
    setPreviewEnabled(true);
    return () => { previewGeneration.current += 1; };
  }, [conversationId, environment, agent.id]);

  useEffect(() => {
    if (!previewEnabled || !previewAvailable || previewError) return;
    if (preview) return;
    void loadPreview();
  }, [previewEnabled, previewAvailable, loadPreview, previewError, preview, previewLoading]);

  useEffect(() => {
    if (!conversationId || !previewEnabled || preview?.backend !== 'local') return;
    let disposed = false;
    const streamId = crypto.randomUUID();
    void api.computerStartLocalStream(conversationId, streamId, (frame) => {
      if (!disposed) setPreview((current) => current?.backend === 'local' ? { ...current, ...frame } : current);
    }).then(() => {
      if (disposed) void api.computerStopLocalStream(streamId).catch(() => undefined);
    }).catch((error) => { if (!disposed) setPreviewError(String(error)); });
    return () => {
      disposed = true;
      void api.computerStopLocalStream(streamId).catch(() => undefined);
    };
  }, [conversationId, previewEnabled, preview?.backend]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!conversationId || !previewAvailable) return;
    let disposed = false;
    const refresh = async () => {
      const revision = controlRevision.current;
      try {
        const control = await api.computerControlStatus(conversationId);
        if (!disposed && revision === controlRevision.current) setPreview((current) => current ? { ...current, paused: control.paused, takenOver: control.takenOver && control.target === 'desktop', controlTarget: control.target } : current);
      } catch {
        // The stream cannot grant input if authoritative state is unavailable.
      }
    };
    const interval = window.setInterval(() => void refresh(), 1000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [conversationId, previewAvailable]);

  useEffect(() => {
    let disposed = false;
    void api
      .listAgentRoutines(agent.id)
      .then((routines) => {
        if (!disposed) setRoutineCount(routines.length);
      })
      .catch(() => {
        if (!disposed) setRoutineCount(0);
      });
    return () => {
      disposed = true;
    };
  }, [agent.id, agent.updatedAt]);

  const selectEnvironment = async (next: ComputerEnvironment) => {
    if (next === environment) return;
    const needsComputer = next === 'this_computer' || next === 'private_desktop';
    const needsBrowser = next === 'browser';
    if (needsComputer && !computerCapable) {
      const confirmed = window.confirm(
        t('screen.confirmComputer', { name: agent.name }),
      );
      if (!confirmed) return;
    }
    if (needsBrowser && !agent.capabilities.browserUse) {
      const confirmed = window.confirm(
        t('screen.confirmBrowser', { name: agent.name }),
      );
      if (!confirmed) return;
    }
    setEnvironmentBusy(true);
    try {
      const input = inputFromAgent(agent);
      input.computerEnvironment = next;
      if (needsComputer) {
        input.capabilities = {
          ...input.capabilities,
          computerUse: true,
          screenCapture: input.capabilities.screenCapture,
        };
      }
      if (needsBrowser) {
        input.capabilities = { ...input.capabilities, browserUse: true };
      }
      await updateAgent(agent.id, input);
      toast.success(t('screen.environmentSaved', { environment: environmentTitle(next, t) }), {
        description: t('screen.nextTurn'),
      });
    } catch (error) {
      toast.error(t('screen.environmentError'), { description: String(error) });
    } finally {
      setEnvironmentBusy(false);
    }
  };

  const takeControl = async () => {
    if (!conversationId) return;
    setControlBusy(true);
    try {
      const target = await api.computerTakeControl(conversationId);
      toast.info(t('screen.youControl'), {
        description: target.kind === 'local'
          ? t('screen.takeControlLocal')
          : t('screen.takeControlRemote'),
      });
      setPreview((current) =>
        current ? { ...current, paused: true, takenOver: true, controlTarget: 'desktop' } : current,
      );
    } catch (error) {
      toast.error(t('screen.takeControlError'), { description: String(error) });
    } finally {
      setControlBusy(false);
    }
  };

  const releaseControl = async () => {
    if (!conversationId) return;
    setControlBusy(true);
    try {
      await api.releaseComputerControl(conversationId, 'desktop');
      setPreview((current) =>
        current ? { ...current, paused: false, takenOver: false, controlTarget: '' } : current,
      );
      toast.success(t('screen.controlReleased'));
    } catch (error) {
      toast.error(t('screen.releaseError'), { description: String(error) });
    } finally {
      setControlBusy(false);
    }
  };

  const stopSession = async () => {
    if (!conversationId) return;
    setControlBusy(true);
    try {
      await api.stopComputerSession(conversationId);
      setPreviewEnabled(false);
      setPreview(null);
      toast.success(t('screen.sessionStopped'));
    } catch (error) {
      toast.error(t('screen.stopError'), { description: String(error) });
    } finally {
      setControlBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-4 p-3">
        <section aria-label={t('screen.desktopAria')} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-foreground">
                {t('screen.screenOf', { name: agent.name })}
              </p>
              <p className="truncate text-[11px] text-foreground-muted">
                {environmentTitle(environment, t)}
                {preview?.backend ? ` · ${preview.backend}` : ''}
                {preview?.activeWindow ? ` · ${preview.activeWindow}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {preview?.paused || preview?.takenOver ? (
                <Badge tone="warning">
                  {preview.takenOver ? t('screen.youControl') : t('screen.paused')}
                </Badge>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void loadPreview()}
                disabled={!previewAvailable || previewLoading}
                aria-label={t('screen.refreshPreview')}
              >
                {previewLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
              </Button>
            </div>
          </div>

          <div className={cn('relative overflow-hidden rounded-xl border border-border bg-background', localExpanded && preview?.backend === 'local' && 'fixed inset-2 z-[100] flex flex-col shadow-2xl')}>
            {!conversation ? (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 p-5 text-center">
                <Monitor className="size-6 text-foreground-subtle" />
                <p className="text-[12px] text-foreground-muted">
                  {t('screen.openConversationToSee', { name: agent.name })}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void startNewConversation('agent', { agentId: agent.id })}
                >
                  {t('home.newConversation')}
                </Button>
              </div>
            ) : !computerCapable ? (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 p-5 text-center">
                <ShieldAlert className="size-6 text-warning" />
                <p className="text-[12px] text-foreground-muted">
                  {t('screen.computerDisabled')}
                </p>
                <p className="text-[11px] text-foreground-subtle">
                  {t('screen.computerDisabledHint')}
                </p>
              </div>
            ) : environment === 'off' || environment === 'browser' ? (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 p-5 text-center">
                <Monitor className="size-6 text-foreground-subtle" />
                <p className="text-[12px] text-foreground-muted">
                  {t('screen.noDesktopInMode', { mode: environmentTitle(environment, t) })}
                </p>
              </div>
            ) : previewEnabled && preview?.backend === 'docker' && conversationId ? (
              <PrivateDesktopViewer
                conversationId={conversationId}
                agentName={agent.name}
                interactive={preview.takenOver}
                busy={controlBusy}
                onTakeControl={() => void takeControl()}
                onReleaseControl={() => void releaseControl()}
              />
            ) : previewEnabled && preview ? (
              <>
                <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-foreground-muted">
                  <span className="min-w-0 flex-1">
                    {t('screen.thisComputerLive', {
                      state:
                        clock - preview.capturedAt < 3000
                          ? t('screen.live')
                          : t('screen.staleFrame'),
                    })}
                  </span>
                  {localExpanded ? <Button size="sm" variant="secondary" disabled={controlBusy} onClick={() => preview.takenOver ? void releaseControl() : void takeControl()}>{preview.takenOver ? t('screen.giveBack') : t('screen.takeControl')}</Button> : null}
                  <Button size="sm" variant="ghost" aria-label={localExpanded ? t('screen.exitExpanded') : t('screen.expand')} onClick={() => setLocalExpanded((value) => !value)}>{localExpanded ? <Minimize2 className="size-4" /> : <Expand className="size-4" />}</Button>
                </div>
                <img src={preview.dataUrl} alt={t('screen.thisComputerAlt', { name: agent.name })} className={cn('w-full object-contain', localExpanded ? 'min-h-0 flex-1' : 'aspect-video')} />
                <p className="px-3 py-1.5 text-[11px] text-foreground-muted">{t('screen.localControlHint')}</p>
              </>
            ) : previewEnabled && previewLoading ? (
              <div className="flex aspect-video items-center justify-center">
                <Spinner className="size-5" />
              </div>
            ) : previewError && dockerSetupError ? (
              <ComputerDockerHelp
                error={previewError}
                onRetry={() => {
                  setPreviewEnabled(true);
                  void loadPreview();
                }}
                onOpenSettings={() => openSettings('agents')}
              />
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 p-5 text-center">
                <Monitor className="size-6 text-foreground-subtle" />
                <p className="text-[12px] text-foreground-muted">
                  {previewError
                    ? t('screen.captureError')
                    : t('screen.previewPaused')}
                </p>
                {previewError ? (
                  <p className="max-w-full break-words text-[10px] text-danger">{previewError}</p>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setPreviewEnabled(true);
                      void loadPreview();
                    }}
                  >
                    <RefreshCw className="mr-1.5 size-3.5" />
                    {t('common:actions.retry')}
                  </Button>
                  {previewEnabled ? (
                    <Button size="sm" variant="ghost" onClick={() => setPreviewEnabled(false)}>
                      {t('screen.pause')}
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setPreviewEnabled(true)}>
                      {t('screen.resume')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {conversationId && computerCapable && environment !== 'off' && environment !== 'browser' ? (
            <div className="flex gap-2">
            <Button
              size="sm"
              variant={preview?.takenOver ? 'secondary' : 'primary'}
              disabled={controlBusy || dockerSetupError || !previewEnabled || (preview?.paused && preview.controlTarget === 'browser')}
              title={
                dockerSetupError ? t('screen.dockerImageTitle') : undefined
              }
              onClick={() =>
                preview?.takenOver ? void releaseControl() : void takeControl()
              }
              className="flex-1"
            >
              {controlBusy ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : preview?.takenOver ? (
                <Play className="mr-1.5 size-3.5" />
              ) : (
                <Pause className="mr-1.5 size-3.5" />
              )}
              {preview?.takenOver ? t('screen.giveBack') : t('screen.takeControl')}
            </Button>
            <Button size="sm" variant="secondary" disabled={controlBusy || !previewEnabled} onClick={() => void stopSession()}>
              <Square className="mr-1.5 size-3.5" /> {t('screen.endSession')}
            </Button>
            </div>
          ) : null}
          {preview?.paused && preview.controlTarget === 'browser' ? <p className="text-[11px] text-foreground-muted">{t('screen.releaseBrowserFirst')}</p> : null}
        </section>

        {conversationId ? <ComputerActivity conversationId={conversationId} /> : null}

        <section aria-labelledby="agent-work-environment" className="flex flex-col gap-2">
          <div>
            <h3 id="agent-work-environment" className="text-[13px] font-medium text-foreground">
              {t('screen.worksIn')}
            </h3>
            <p className="text-[11px] text-foreground-muted">
              {t('screen.worksInHint')}
            </p>
            {turnActive ? <p className="text-[11px] text-foreground-muted">{t('screen.waitTurn')}</p> : null}
            <AgentWorkspaceNotice agent={agent} conversation={conversation} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {ENVIRONMENTS.map((entry) => {              const Icon = entry.icon;
              const selected = entry.id === environment;
              const disabled = entry.disabled || environmentBusy || turnActive;
              return (
                <button
                  key={entry.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => {
                    if (entry.id !== 'cloud') void selectEnvironment(entry.id);
                  }}
                  className={cn(
                    'flex min-h-16 items-start gap-2 rounded-xl border p-2.5 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    selected
                      ? 'border-accent/50 bg-accent-soft/50'
                      : 'border-border bg-surface-raised/40 hover:bg-surface-hover',
                    disabled && 'cursor-default opacity-60',
                  )}
                >
                  <Icon
                    aria-hidden
                    className={cn('mt-0.5 size-4 shrink-0', selected ? 'text-accent' : 'text-foreground-muted')}
                    strokeWidth={1.75}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                      {t(entry.titleKey as never)}
                      {entry.badgeKey ? <Badge tone="neutral">{t(entry.badgeKey as never)}</Badge> : null}
                    </span>
                    <span className="block text-[10px] leading-relaxed text-foreground-muted">
                      {t(entry.descriptionKey as never)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="agent-routines-summary" className="rounded-xl border border-border bg-surface-raised/40 p-3">
          <button
            type="button"
            onClick={() => setAgentPanelTab('routines')}
            className="flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <CalendarClock className="size-4 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-medium text-foreground">{t('panel.tabs.routines')}</span>
              <span className="block text-[11px] text-foreground-muted">
                {routineCount === 0
                  ? t('screen.noSchedules')
                  : t('screen.schedules', { count: routineCount })}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-foreground-subtle" />
          </button>
        </section>
      </div>
    </div>
  );
}
