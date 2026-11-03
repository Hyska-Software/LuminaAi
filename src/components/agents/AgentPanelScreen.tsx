import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  ChevronRight,
  Cloud,
  Globe2,
  Laptop,
  Loader2,
  Monitor,
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
import { AgentRoutinesDialog } from './AgentRoutinesDialog';
import { Badge, Button, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useAgentStore, useChatStore } from '@/lib/store';
import type { ComputerEnvironment, ComputerPreview } from '@/lib/types';
import { cn } from '@/lib/utils';

const ENVIRONMENTS: Array<{
  id: ComputerEnvironment | 'cloud';
  title: string;
  description: string;
  icon: typeof Monitor;
  disabled?: boolean;
  badge?: string;
}> = [
  {
    id: 'auto',
    title: 'Automático',
    description: 'Escolhe o melhor ambiente disponível.',
    icon: Sparkles,
  },
  {
    id: 'private_desktop',
    title: 'Desktop privado',
    description: 'Desktop isolado em Docker.',
    icon: Monitor,
  },
  {
    id: 'this_computer',
    title: 'Este computador',
    description: 'Sua tela e seus apps.',
    icon: Laptop,
  },
  {
    id: 'browser',
    title: 'Navegador',
    description: 'Somente páginas da web.',
    icon: Globe2,
  },
  {
    id: 'off',
    title: 'Desligado',
    description: 'Sem acesso ao computador.',
    icon: Square,
  },
  {
    id: 'cloud',
    title: 'Desktop na nuvem',
    description: 'Disponível em uma versão futura.',
    icon: Cloud,
    disabled: true,
    badge: 'Em breve',
  },
];

function environmentLabel(value: string): string {
  return (
    ENVIRONMENTS.find((entry) => entry.id === value)?.title ??
    (value === 'auto' ? 'Automático' : value)
  );
}

export function AgentPanelScreen({ context }: { context: AgentPanelContext }) {
  const { agent, conversation } = context;
  const conversationId = conversation?.id ?? null;
  const updateAgent = useAgentStore((state) => state.update);
  const startNewConversation = useChatStore((state) => state.startNewConversation);
  const [preview, setPreview] = useState<ComputerPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [environmentBusy, setEnvironmentBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [routineCount, setRoutineCount] = useState(0);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const loadingRef = useRef(false);
  const environment = (agent.computerEnvironment ?? 'auto') as ComputerEnvironment;
  const computerCapable =
    agent.capabilities.computerUse || agent.capabilities.screenCapture;
  const previewAvailable =
    Boolean(conversationId) &&
    environment !== 'off' &&
    environment !== 'browser' &&
    computerCapable;

  const loadPreview = useCallback(async () => {
    if (!conversationId || !previewAvailable || loadingRef.current) return;
    loadingRef.current = true;
    setPreviewLoading(true);
    try {
      const next = await api.computerPreview(conversationId);
      setPreview(next);
      setPreviewError(null);
    } catch (error) {
      setPreview(null);
      setPreviewError(String(error));
    } finally {
      loadingRef.current = false;
      setPreviewLoading(false);
    }
  }, [conversationId, previewAvailable]);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    setPreviewEnabled(true);
  }, [conversationId, environment, agent.id]);

  useEffect(() => {
    if (!previewEnabled || !previewAvailable) return;
    void loadPreview();
    const interval = window.setInterval(() => void loadPreview(), 2500);
    return () => window.clearInterval(interval);
  }, [previewEnabled, previewAvailable, loadPreview]);

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
        `Ativar o controle do computador para ${agent.name}? Toda ação de mouse/teclado continua exigindo aprovação.`,
      );
      if (!confirmed) return;
    }
    if (needsBrowser && !agent.capabilities.browserUse) {
      const confirmed = window.confirm(
        `Permitir que ${agent.name} use um navegador controlado? Downloads e ações de página continuam sujeitos a aprovação.`,
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
      toast.success(`Ambiente: ${environmentLabel(next)}`, {
        description: 'A mudança vale a partir do próximo turno.',
      });
    } catch (error) {
      toast.error('Não foi possível salvar o ambiente', { description: String(error) });
    } finally {
      setEnvironmentBusy(false);
    }
  };

  const takeControl = async () => {
    if (!conversationId) return;
    setControlBusy(true);
    try {
      const target = await api.computerTakeControl(conversationId);
      if (target.kind === 'vnc' && target.url) {
        window.open(target.url, '_blank', 'noopener,noreferrer');
        toast.info('Controle humano ativado', {
          description: 'Use a janela do noVNC. O agente fica pausado até você devolver.',
        });
      } else {
        toast.info('Você está no controle', {
          description: 'O agente fica pausado até você devolver o controle.',
        });
      }
      setPreview((current) =>
        current ? { ...current, paused: true, takenOver: true } : current,
      );
    } catch (error) {
      toast.error('Não foi possível assumir o controle', { description: String(error) });
    } finally {
      setControlBusy(false);
    }
  };

  const releaseControl = async () => {
    if (!conversationId) return;
    setControlBusy(true);
    try {
      await api.releaseComputerControl(conversationId);
      setPreview((current) =>
        current ? { ...current, paused: false, takenOver: false } : current,
      );
      toast.success('Controle devolvido ao agente');
    } catch (error) {
      toast.error('Não foi possível devolver o controle', { description: String(error) });
    } finally {
      setControlBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-4 p-3">
        <section aria-label="Visualização do desktop" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-foreground">
                Tela de {agent.name}
              </p>
              <p className="truncate text-[11px] text-foreground-muted">
                {environmentLabel(environment)}
                {preview?.backend ? ` · ${preview.backend}` : ''}
                {preview?.activeWindow ? ` · ${preview.activeWindow}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {preview?.paused || preview?.takenOver ? (
                <Badge tone="warning">Pausado</Badge>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void loadPreview()}
                disabled={!previewAvailable || previewLoading}
                aria-label="Atualizar visualização"
              >
                {previewLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
              </Button>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-border bg-background">
            {!conversation ? (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 p-5 text-center">
                <Monitor className="size-6 text-foreground-subtle" />
                <p className="text-[12px] text-foreground-muted">
                  Abra uma conversa com {agent.name} para ver o desktop.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void startNewConversation('agent', { agentId: agent.id })}
                >
                  Nova conversa
                </Button>
              </div>
            ) : !computerCapable ? (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 p-5 text-center">
                <ShieldAlert className="size-6 text-warning" />
                <p className="text-[12px] text-foreground-muted">
                  O controle do computador está desligado para este agente.
                </p>
                <p className="text-[11px] text-foreground-subtle">
                  Escolha “Este computador” ou “Desktop privado” abaixo.
                </p>
              </div>
            ) : environment === 'off' || environment === 'browser' ? (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 p-5 text-center">
                <Monitor className="size-6 text-foreground-subtle" />
                <p className="text-[12px] text-foreground-muted">
                  Nenhum desktop ativo no modo {environmentLabel(environment)}.
                </p>
              </div>
            ) : previewEnabled && preview ? (
              <img
                src={preview.dataUrl}
                alt={`Tela controlada por ${agent.name}`}
                className="aspect-video w-full object-contain"
              />
            ) : previewEnabled && previewLoading ? (
              <div className="flex aspect-video items-center justify-center">
                <Spinner className="size-5" />
              </div>
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 p-5 text-center">
                <Monitor className="size-6 text-foreground-subtle" />
                <p className="text-[12px] text-foreground-muted">
                  {previewError
                    ? 'Não foi possível capturar a tela.'
                    : 'Visualização pausada.'}
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
                    Tentar de novo
                  </Button>
                  {previewEnabled ? (
                    <Button size="sm" variant="ghost" onClick={() => setPreviewEnabled(false)}>
                      Pausar
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setPreviewEnabled(true)}>
                      Retomar
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {conversationId && computerCapable && environment !== 'off' && environment !== 'browser' ? (
            <Button
              size="sm"
              variant={preview?.takenOver ? 'secondary' : 'primary'}
              disabled={controlBusy}
              onClick={() =>
                preview?.takenOver ? void releaseControl() : void takeControl()
              }
            >
              {controlBusy ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : preview?.takenOver ? (
                <Play className="mr-1.5 size-3.5" />
              ) : (
                <Pause className="mr-1.5 size-3.5" />
              )}
              {preview?.takenOver ? 'Devolver ao agente' : 'Assumir o controle'}
            </Button>
          ) : null}
        </section>

        <section aria-labelledby="agent-work-environment" className="flex flex-col gap-2">
          <div>
            <h3 id="agent-work-environment" className="text-[13px] font-medium text-foreground">
              Trabalha em
            </h3>
            <p className="text-[11px] text-foreground-muted">
              Escolha onde este agente pode trabalhar. A permissão de cada ação continua separada.
            </p>
            {!agent.workspaceId ? (
              <p className="mt-1 rounded-lg border border-warning/30 bg-warning-soft px-2 py-1 text-[10px] text-warning">
                As tools de controle rodam no perfil Code. Vincule um workspace ao agente no editor
                para ele executar mouse/teclado/navegador.
              </p>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {ENVIRONMENTS.map((entry) => {              const Icon = entry.icon;
              const selected = entry.id === environment;
              const disabled = entry.disabled || environmentBusy;
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
                      {entry.title}
                      {entry.badge ? <Badge tone="neutral">{entry.badge}</Badge> : null}
                    </span>
                    <span className="block text-[10px] leading-relaxed text-foreground-muted">
                      {entry.description}
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
            onClick={() => setRoutinesOpen(true)}
            className="flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <CalendarClock className="size-4 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-medium text-foreground">Rotinas</span>
              <span className="block text-[11px] text-foreground-muted">
                {routineCount === 0
                  ? 'Nenhum agendamento ainda'
                  : `${routineCount} agendamento(s)`}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-foreground-subtle" />
          </button>
        </section>
      </div>
      <AgentRoutinesDialog
        agent={agent}
        open={routinesOpen}
        onOpenChange={setRoutinesOpen}
      />
    </div>
  );
}
