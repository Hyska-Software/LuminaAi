import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Expand,
  ExternalLink,
  Globe2,
  Loader2,
  Lock,
  Minimize2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Square,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import type { AgentPanelContext } from './AgentPanel';
import { inputFromAgent } from './agentUtils';
import { ComputerActivity } from './ComputerActivity';
import { useComputerControlEvents } from './useComputerControlEvents';
import { AgentWorkspaceNotice } from './AgentWorkspaceNotice';
import { Badge, Button, Input, Switch } from '@/components/ui';
import { api } from '@/lib/api';
import { useAgentStore } from '@/lib/store';
import type { BrowserFrame, BrowserStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Local CDP browser surface: tabs, address bar, live page frame and human
 * take-over. The backend owns the isolated Chromium process; this panel only
 * mirrors it and never shares the app origin.
 */
export function AgentPanelBrowser({ context }: { context: AgentPanelContext }) {
  const { agent, conversation } = context;
  const updateAgent = useAgentStore((state) => state.update);
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [frame, setFrame] = useState<BrowserFrame | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tabBusy, setTabBusy] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [paused, setPaused] = useState(false);
  const [otherControl, setOtherControl] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const frameBusy = useRef(false);
  const inputQueue = useRef<Promise<void>>(Promise.resolve());
  const movePending = useRef(false);
  const controlRevision = useRef(0);
  const controlGeneration = useRef<{ conversationId: string; value: string } | null>(null);
  const keyboardTarget = useRef<HTMLTextAreaElement>(null);
  const controlButton = useRef<HTMLButtonElement>(null);
  const expandedControlButton = useRef<HTMLButtonElement>(null);
  const pressedKeys = useRef(new Map<string, Record<string, string | number | boolean>>());
  const pressedMouse = useRef<{ x: number; y: number; button: string } | null>(null);
  const conversationId = conversation?.id ?? null;
  const currentConversation = useRef(conversationId);
  currentConversation.current = conversationId;
  const currentTab = useRef<string | null>(null);
  currentTab.current = status?.activeTab ?? null;
  const activeTab = status?.tabs.find((tab) => tab.id === status.activeTab) ?? null;
  const enabled = agent.capabilities.browserUse;
  useComputerControlEvents(conversationId, (control) => {
    controlRevision.current += 1;
    controlGeneration.current = control.paused && control.takenOver && control.target === 'browser' && control.generation
      ? { conversationId: control.conversationId, value: control.generation }
      : null;
    setPaused(control.paused && control.takenOver && control.target === 'browser');
    setOtherControl(control.paused && control.takenOver && control.target === 'desktop');
  });

  const loadStatus = useCallback(async () => {
    if (!conversationId || !enabled) {
      setStatus(null);
      return;
    }
    try {
      const next = await api.browserSessionStatus(conversationId);
      if (currentConversation.current === conversationId) setStatus(next);
    } catch (error) {
      if (currentConversation.current === conversationId) {
        setStatus(null);
        setFrameError(String(error));
      }
    }
  }, [conversationId, enabled]);

  const loadFrame = useCallback(async () => {
    if (!conversationId || !status?.running || frameBusy.current) return;
    frameBusy.current = true;
    const tab = status.activeTab;
    try {
      const next = await api.browserFrame(conversationId, tab);
      if (currentConversation.current === conversationId && currentTab.current === tab) {
        setFrame((current) => !current || next.capturedAt >= current.capturedAt ? next : current);
        setFrameError(null);
      }
    } catch (error) {
      if (currentConversation.current === conversationId && currentTab.current === tab) {
        setFrame(null);
        setFrameError(String(error));
      }
    } finally {
      frameBusy.current = false;
    }
  }, [conversationId, status?.running, status?.activeTab]);

  useEffect(() => {
    setFrame(null);
    setFrameError(null);
    setStatus(null);
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!conversationId || !enabled) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadStatus();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [conversationId, enabled, loadStatus]);

  useEffect(() => {
    if (!status?.running) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status?.running]);

  useEffect(() => {
    if (!urlDraft || document.activeElement?.id !== 'agent-browser-address') {
      setUrlDraft(activeTab?.url ?? '');
    }
  }, [activeTab?.url]);

  useEffect(() => {
    if (!conversationId || !status?.running) return;
    let disposed = false;
    const streamId = crypto.randomUUID();
    void loadFrame();
    void api.browserStartStream(conversationId, status.activeTab, streamId, (next) => {
      if (!disposed) {
        setFrame((current) => !current || next.capturedAt >= current.capturedAt ? next : current);
        setFrameError(null);
      }
    }).then(() => {
      if (disposed) void api.browserStopStream(streamId).catch(() => undefined);
    }).catch((error) => { if (!disposed) setFrameError(String(error)); });
    // A low-frequency fallback also recovers when an inactive browser produces no frames.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadFrame();
    }, 5000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      void api.browserStopStream(streamId).catch(() => undefined);
    };
  }, [conversationId, status?.running, status?.activeTab, loadFrame]);

  useEffect(() => {
    setPaused(false);
    setOtherControl(false);
    controlGeneration.current = null;
    if (!conversationId || !enabled) return;
    let disposed = false;
    const refresh = async () => {
      const revision = controlRevision.current;
      try {
        const control = await api.computerControlStatus(conversationId);
        if (!disposed && revision === controlRevision.current) {
          controlGeneration.current = control.paused && control.takenOver && control.target === 'browser' && control.generation
            ? { conversationId, value: control.generation }
            : null;
          setPaused(control.paused && control.takenOver && control.target === 'browser');
          setOtherControl(control.paused && control.takenOver && control.target === 'desktop');
        }
      } catch {
        if (!disposed) setPaused(false);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [conversationId, enabled]);

  const toggleBrowser = async (next: boolean) => {
    setBusy(true);
    try {
      const input = inputFromAgent(agent);
      input.capabilities = { ...input.capabilities, browserUse: next };
      if (next && input.computerEnvironment === 'off') {
        input.computerEnvironment = 'auto';
      }
      await updateAgent(agent.id, input);
      if (!next && conversationId) {
        await api.browserSessionClose(conversationId).catch(() => undefined);
      }
      setStatus(null);
      toast.success(next ? 'Navegador liberado' : 'Navegador desligado');
    } catch (error) {
      toast.error('Não foi possível alterar o navegador', { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const openSession = async () => {
    if (!conversationId) return;
    setBusy(true);
    try {
      const next = await api.browserSessionOpen(
        conversationId,
        !paused && urlDraft.trim() && urlDraft.trim() !== 'about:blank' ? urlDraft.trim() : null,
      );
      setStatus(next);
      toast.success('Navegador aberto', {
        description: 'A sessão usa um perfil isolado; o agente só age com aprovação.',
      });
    } catch (error) {
      toast.error('Não foi possível abrir o navegador', { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const closeSession = async () => {
    if (!conversationId) return;
    setBusy(true);
    try {
      await api.browserSessionClose(conversationId);
      setStatus(null);
      setFrame(null);
      toast.success('Navegador encerrado');
    } catch (error) {
      toast.error('Não foi possível encerrar', { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const navigate = async () => {
    const generation = controlGeneration.current;
    if (!conversationId || !urlDraft.trim() || generation?.conversationId !== conversationId) return;
    setTabBusy(true);
    try {
      await api.browserNavigate(conversationId, urlDraft.trim(), generation.value, status?.activeTab);
      await loadStatus();
      window.setTimeout(() => void loadFrame(), 250);
    } catch (error) {
      toast.error('URL inválida ou bloqueada', { description: String(error) });
    } finally {
      setTabBusy(false);
    }
  };

  const history = async (action: 'back' | 'forward' | 'reload') => {
    const generation = controlGeneration.current;
    if (!conversationId || generation?.conversationId !== conversationId) return;
    setTabBusy(true);
    try {
      await api.browserHistory(conversationId, action, generation.value, status?.activeTab);
      await loadStatus();
      window.setTimeout(() => void loadFrame(), 250);
    } catch (error) {
      toast.error('Não foi possível navegar', { description: String(error) });
    } finally {
      setTabBusy(false);
    }
  };

  const newTab = async () => {
    const generation = controlGeneration.current;
    if (!conversationId || generation?.conversationId !== conversationId) return;
    setTabBusy(true);
    try {
      await api.browserNewTab(conversationId, generation.value, 'about:blank');
      await loadStatus();
    } catch (error) {
      toast.error('Não foi possível criar a aba', { description: String(error) });
    } finally {
      setTabBusy(false);
    }
  };

  const closeTab = async (tabId: string) => {
    const generation = controlGeneration.current;
    if (!conversationId || generation?.conversationId !== conversationId) return;
    setTabBusy(true);
    try {
      await api.browserCloseTab(conversationId, tabId, generation.value);
      await loadStatus();
    } catch (error) {
      toast.error('Não foi possível fechar a aba', { description: String(error) });
    } finally {
      setTabBusy(false);
    }
  };

  const activateTab = async (tabId: string) => {
    const generation = controlGeneration.current;
    if (!conversationId || generation?.conversationId !== conversationId) return;
    try {
      await api.browserActivateTab(conversationId, tabId, generation.value);
      await loadStatus();
    } catch (error) {
      toast.error('Não foi possível ativar a aba', { description: String(error) });
    }
  };

  const takeControl = async () => {
    if (!conversationId) return;
    setBusy(true);
    try {
      const result = await api.browserTakeControl(conversationId);
      if (!result.generation) throw new Error('Geração de controle indisponível');
      if (currentConversation.current !== conversationId) return;
      controlGeneration.current = { conversationId, value: result.generation };
      setPaused(true);
      toast.info('Você está no controle', {
        description: 'O agente fica pausado até você devolver o controle.',
      });
    } catch (error) {
      toast.error('Não foi possível assumir o controle', { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const releaseControl = async () => {
    if (!conversationId) return;
    setBusy(true);
    try {
      const generation = controlGeneration.current;
      if (!generation || generation.conversationId !== conversationId) throw new Error('Geração de controle indisponível');
      releasePressedInputs();
      await inputQueue.current;
      await api.releaseComputerControl(conversationId, 'browser', generation.value);
      if (controlGeneration.current?.value === generation.value) controlGeneration.current = null;
      setPaused(false);
      toast.success('Controle devolvido ao agente');
    } catch (error) {
      toast.error('Não foi possível devolver o controle', { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const coordinates = (element: HTMLImageElement, clientX: number, clientY: number, clamp = false) => {
    if (!frame) return null;
    const rect = element.getBoundingClientRect();
    const scale = Math.min(rect.width / frame.width, rect.height / frame.height);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const displayWidth = frame.width * scale;
    const displayHeight = frame.height * scale;
    const offsetX = (rect.width - displayWidth) / 2;
    const offsetY = (rect.height - displayHeight) / 2;
    const x = (clientX - rect.left - offsetX) / scale;
    const y = (clientY - rect.top - offsetY) / scale;
    if (!clamp && (x < 0 || y < 0 || x >= frame.width || y >= frame.height)) return null;
    return { x: Math.min(frame.width - 1, Math.max(0, x)), y: Math.min(frame.height - 1, Math.max(0, y)) };
  };

  const enqueueInput = (kind: 'mouse' | 'key', params: Record<string, string | number | boolean>) => {
    if (!conversationId || !paused) return;
    const generation = controlGeneration.current;
    if (!generation || generation.conversationId !== conversationId) return;
    const move = params.type === 'mouseMoved';
    if (move && movePending.current) return;
    if (move) movePending.current = true;
    const tabId = status?.activeTab ?? null;
    inputQueue.current = inputQueue.current.then(async () => {
      try { await api.browserHumanInput(conversationId, tabId, kind, params, generation.value); }
      catch (error) { if (!move) toast.error('Entrada não enviada', { description: String(error) }); }
      finally { if (move) movePending.current = false; }
    });
  };

  const enqueueText = (text: string) => {
    if (!conversationId || !paused || !text) return;
    const generation = controlGeneration.current;
    if (!generation || generation.conversationId !== conversationId) return;
    const tabId = status?.activeTab ?? null;
    inputQueue.current = inputQueue.current.then(async () => {
      try { await api.browserInsertText(conversationId, text, generation.value, tabId); }
      catch (error) { toast.error('Texto não enviado', { description: String(error) }); }
    });
  };

  const releasePressedInputs = () => {
    for (const params of pressedKeys.current.values()) enqueueInput('key', { ...params, type: 'keyUp', autoRepeat: false });
    pressedKeys.current.clear();
    const mouse = pressedMouse.current;
    if (mouse) enqueueInput('mouse', { type: 'mouseReleased', ...mouse, buttons: 0, clickCount: 1 });
    pressedMouse.current = null;
  };

  const pointerPreview = (event: ReactPointerEvent<HTMLImageElement>, type: 'mouseMoved' | 'mousePressed' | 'mouseReleased') => {
    if (!paused) return;
    const point = coordinates(event.currentTarget, event.clientX, event.clientY, type === 'mouseReleased' || event.buttons !== 0);
    if (!point) return;
    event.preventDefault();
    if (type === 'mousePressed') {
      keyboardTarget.current?.focus();
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    const button = type === 'mouseMoved' && event.buttons === 0 ? 'none' : event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left';
    if (type === 'mousePressed') pressedMouse.current = { ...point, button };
    if (type === 'mouseMoved' && pressedMouse.current) pressedMouse.current = { ...pressedMouse.current, ...point };
    if (type === 'mouseReleased') pressedMouse.current = null;
    enqueueInput('mouse', { type, ...point, button, buttons: event.buttons, clickCount: type === 'mouseMoved' ? 0 : event.detail || 1 });
  };

  const wheelPreview = (event: ReactWheelEvent<HTMLImageElement>) => {
    if (!paused) return;
    const point = coordinates(event.currentTarget, event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    enqueueInput('mouse', { type: 'mouseWheel', ...point, deltaX: event.deltaX, deltaY: event.deltaY });
  };

  const keyPreview = (event: ReactKeyboardEvent<HTMLTextAreaElement>, type: 'keyDown' | 'keyUp') => {
    if (!paused || event.nativeEvent.isComposing) return;
    if (type === 'keyDown' && event.ctrlKey && event.altKey && event.shiftKey && event.code === 'KeyQ') {
      event.preventDefault();
      releasePressedInputs();
      (expanded ? expandedControlButton.current : controlButton.current)?.focus();
      return;
    }
    event.preventDefault();
    const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
    const params: Record<string, string | number | boolean> = {
      type, key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode, modifiers,
      autoRepeat: event.repeat,
    };
    if (type === 'keyDown' && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) params.text = event.key;
    if (type === 'keyDown') pressedKeys.current.set(event.code || event.key, params);
    else pressedKeys.current.delete(event.code || event.key);
    enqueueInput('key', params);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <Globe2 className="size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground">Navegador</p>
            <p className="truncate text-[11px] text-foreground-muted">
              {status?.running
                ? `${status.tabs.length} aba(s) · ${status.executable ?? 'Chromium/Edge'}`
                : `Deixe ${agent.name} usar um navegador controlado.`}
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => void toggleBrowser(checked)}
            disabled={busy}
            aria-label={`Deixar ${agent.name} usar um navegador`}
          />
        </div>
        <AgentWorkspaceNotice agent={agent} conversation={conversation} />
        {!enabled ? null : (
          <>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={!status?.running || tabBusy || !paused}
                onClick={() => void history('back')}
                aria-label="Voltar"
              >
                <ArrowLeft className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!status?.running || tabBusy || !paused}
                onClick={() => void history('forward')}
                aria-label="Avançar"
              >
                <ArrowRight className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!status?.running || tabBusy || !paused}
                onClick={() => void history('reload')}
                aria-label="Recarregar"
              >
                <RefreshCw className={cn('size-3.5', tabBusy && 'animate-spin')} />
              </Button>
              <Input
                id="agent-browser-address"
                value={urlDraft}
                disabled={Boolean(status?.running && !paused)}
                onChange={(event) => setUrlDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void navigate();
                  }
                }}
                placeholder={status?.running ? 'Pesquisar ou digitar URL' : 'https://…'}
                aria-label="Barra de endereço do navegador"
                className="h-8 min-w-0 flex-1 text-[11px]"
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={!status?.running || tabBusy || !paused || !urlDraft.trim()}
                onClick={() => void navigate()}
                aria-label="Ir para o endereço"
              >
                {tabBusy ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {status?.tabs.map((tab) => (
                <span
                  key={tab.id}
                  className={cn(
                    'group inline-flex max-w-40 items-center gap-1 rounded-lg border px-2 py-1 text-[10px]',
                    tab.active
                      ? 'border-accent/40 bg-accent-soft text-accent'
                      : 'border-border bg-surface-raised text-foreground-muted hover:bg-surface-hover',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void activateTab(tab.id)}
                    disabled={!paused}
                    className="min-w-0 truncate focus-visible:outline-none"
                    title={tab.title}
                  >
                    {tab.title || 'Nova aba'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void closeTab(tab.id)}
                    disabled={tabBusy || !paused}
                    aria-label={`Fechar ${tab.title || 'aba'}`}
                    className="shrink-0 rounded p-0.5 hover:bg-surface-active focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  >
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
              <Button
                size="sm"
                variant="ghost"
                disabled={!status?.running || tabBusy || !paused}
                onClick={() => void newTab()}
                aria-label="Nova aba"
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {!conversationId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-surface-raised/30 p-6 text-center">
            <Globe2 className="size-6 text-foreground-subtle" />
            <p className="text-[12px] text-foreground-muted">
              Abra uma conversa com {agent.name} para usar o navegador.
            </p>
          </div>
        ) : !enabled ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-surface-raised/30 p-6 text-center">
            <ShieldAlert className="size-6 text-foreground-subtle" />
            <p className="text-[12px] text-foreground-muted">
              O navegador está desligado para este agente.
            </p>
            <Button size="sm" variant="secondary" onClick={() => void toggleBrowser(true)}>
              Ativar navegador
            </Button>
          </div>
        ) : !status?.running ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-raised/20 p-6 text-center">
            <Globe2 className="size-6 text-foreground-subtle" />
            <p className="text-[12px] text-foreground-muted">
              Nenhuma sessão aberta.
            </p>
            <p className="max-w-64 text-[11px] text-foreground-subtle">
              O Lumina abre um Chromium/Edge isolado, com perfil próprio por conversa e porta CDP
              apenas em loopback.
            </p>
            <Button size="sm" disabled={busy} onClick={() => void openSession()}>
              {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Globe2 className="mr-1.5 size-3.5" />}
              Abrir navegador
            </Button>
          </div>
        ) : (
          <>
            <div className={cn('relative flex min-h-48 flex-1 items-center justify-center overflow-hidden rounded-xl border border-border bg-background', paused && 'focus-within:ring-2 focus-within:ring-accent', expanded && 'fixed inset-2 z-[100] flex-col shadow-2xl')}>
              {expanded ? <div className="flex h-10 w-full shrink-0 items-center gap-2 border-b border-border px-3">
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">Navegador de {agent.name}</span>
                <span className="text-[11px] text-foreground-muted">{paused ? 'Você está no controle' : 'Somente visualização'} · {frame && clock - frame.capturedAt < 8000 ? 'Ao vivo' : 'Imagem desatualizada'}</span>
                <Button ref={expandedControlButton} size="sm" variant="secondary" disabled={busy || otherControl} onClick={() => (paused ? void releaseControl() : void takeControl())}>{paused ? 'Devolver ao agente' : 'Assumir o controle'}</Button>
                <Button size="sm" variant="ghost" aria-label="Sair da visualização expandida" onClick={() => setExpanded(false)}><Minimize2 className="size-4" /></Button>
              </div> : null}
              {frame ? (
                <img
                  src={frame.dataUrl}
                  alt={`Página controlada por ${agent.name}: ${frame.title}`}
                  onPointerDown={(event) => pointerPreview(event, 'mousePressed')}
                  onPointerMove={(event) => pointerPreview(event, 'mouseMoved')}
                  onPointerUp={(event) => pointerPreview(event, 'mouseReleased')}
                  onContextMenu={(event) => { if (paused) event.preventDefault(); }}
                  onWheel={wheelPreview}
                  tabIndex={-1}
                  className={cn(
                    'min-h-0 h-full w-full object-contain',
                    paused &&
                      'cursor-crosshair focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  )}
                />
              ) : frameError ? (
                <div className="flex flex-col items-center gap-1 p-4 text-center">
                  <ShieldAlert className="size-5 text-warning" />
                  <p className="text-[11px] text-foreground-muted">Sem frame da página.</p>
                  <p className="break-words text-[10px] text-danger">{frameError}</p>
                  <Button size="sm" variant="ghost" onClick={() => void loadFrame()}>
                    Tentar de novo
                  </Button>
                </div>
              ) : (
                <Loader2 className="size-5 animate-spin text-foreground-muted" />
              )}
              <textarea
                ref={keyboardTarget}
                aria-label="Teclado do navegador controlado"
                tabIndex={paused ? 0 : -1}
                className="absolute bottom-0 left-0 size-px opacity-0"
                onKeyDown={(event) => keyPreview(event, 'keyDown')}
                onKeyUp={(event) => keyPreview(event, 'keyUp')}
                onCompositionEnd={(event) => { enqueueText(event.data); event.currentTarget.value = ''; }}
                onPaste={(event) => { event.preventDefault(); enqueueText(event.clipboardData.getData('text')); }}
                onBlur={releasePressedInputs}
              />
              {paused ? (
                <Badge tone="warning" className="absolute left-2 top-2">
                  <Lock className="mr-1 size-2.5" />
                  Controle humano
                </Badge>
              ) : null}
              {!expanded ? <Button size="sm" variant="secondary" aria-label="Expandir navegador" className="absolute right-2 top-2" onClick={() => setExpanded(true)}><Expand className="size-3.5" /></Button> : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span role="status" className="text-[10px] text-foreground-muted">{frame && clock - frame.capturedAt < 8000 ? 'Ao vivo' : 'Imagem desatualizada'}</span>
              <Badge tone="neutral">
                {activeTab?.title || frame?.title || 'Nova aba'}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-[10px] text-foreground-subtle">
                {activeTab?.url ?? frame?.url ?? ''}
              </span>
              <Button
                ref={controlButton}
                size="sm"
                variant={paused ? 'secondary' : 'primary'}
                disabled={busy || otherControl}
                onClick={() => (paused ? void releaseControl() : void takeControl())}
              >
                {busy ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : paused ? (
                  <RefreshCw className="mr-1.5 size-3.5" />
                ) : (
                  <Lock className="mr-1.5 size-3.5" />
                )}
                {paused ? 'Devolver ao agente' : 'Assumir o controle'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void closeSession()} disabled={busy}>
                <Square className="mr-1.5 size-3.5" />
                Encerrar
              </Button>
            </div>
            <p className="text-[10px] leading-relaxed text-foreground-subtle">
              {otherControl
                ? 'Devolva o controle do desktop antes de assumir o navegador.'
                : paused
                ? 'Controle humano: clique na página para digitar. Ctrl+Alt+Shift+Q libera o teclado.'
                : status.downloadDir
                  ? `Downloads: ${status.downloadDir}`
                  : null}
            </p>
            <ComputerActivity conversationId={conversationId} />
          </>
        )}
      </div>
    </div>
  );
}
