import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  ShieldAlert,
  Square,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import type { AgentPanelContext } from './AgentPanel';
import { inputFromAgent } from './agentUtils';
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
  const frameBusy = useRef(false);
  const conversationId = conversation?.id ?? null;
  const activeTab = status?.tabs.find((tab) => tab.id === status.activeTab) ?? null;
  const enabled = agent.capabilities.browserUse;

  const loadStatus = useCallback(async () => {
    if (!conversationId || !enabled) {
      setStatus(null);
      return;
    }
    try {
      setStatus(await api.browserSessionStatus(conversationId));
    } catch (error) {
      setStatus(null);
      setFrameError(String(error));
    }
  }, [conversationId, enabled]);

  const loadFrame = useCallback(async () => {
    if (!conversationId || !status?.running || frameBusy.current) return;
    frameBusy.current = true;
    try {
      const next = await api.browserFrame(conversationId, status.activeTab);
      setFrame(next);
      setFrameError(null);
    } catch (error) {
      setFrame(null);
      setFrameError(String(error));
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
    if (!urlDraft || document.activeElement?.id !== 'agent-browser-address') {
      setUrlDraft(activeTab?.url ?? '');
    }
  }, [activeTab?.url]);

  useEffect(() => {
    if (!status?.running || document.visibilityState === 'hidden') return;
    void loadFrame();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadFrame();
    }, 1200);
    return () => window.clearInterval(interval);
  }, [status?.running, status?.activeTab, loadFrame]);

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
        urlDraft.trim() && urlDraft.trim() !== 'about:blank' ? urlDraft.trim() : null,
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
    if (!conversationId || !urlDraft.trim()) return;
    setTabBusy(true);
    try {
      await api.browserNavigate(conversationId, urlDraft.trim(), status?.activeTab);
      await loadStatus();
      window.setTimeout(() => void loadFrame(), 250);
    } catch (error) {
      toast.error('URL inválida ou bloqueada', { description: String(error) });
    } finally {
      setTabBusy(false);
    }
  };

  const history = async (action: 'back' | 'forward' | 'reload') => {
    if (!conversationId) return;
    setTabBusy(true);
    try {
      await api.browserHistory(conversationId, action, status?.activeTab);
      await loadStatus();
      window.setTimeout(() => void loadFrame(), 250);
    } catch (error) {
      toast.error('Não foi possível navegar', { description: String(error) });
    } finally {
      setTabBusy(false);
    }
  };

  const newTab = async () => {
    if (!conversationId) return;
    setTabBusy(true);
    try {
      await api.browserNewTab(conversationId, 'about:blank');
      await loadStatus();
    } catch (error) {
      toast.error('Não foi possível criar a aba', { description: String(error) });
    } finally {
      setTabBusy(false);
    }
  };

  const closeTab = async (tabId: string) => {
    if (!conversationId) return;
    setTabBusy(true);
    try {
      await api.browserCloseTab(conversationId, tabId);
      await loadStatus();
    } catch (error) {
      toast.error('Não foi possível fechar a aba', { description: String(error) });
    } finally {
      setTabBusy(false);
    }
  };

  const activateTab = async (tabId: string) => {
    if (!conversationId) return;
    try {
      await api.browserActivateTab(conversationId, tabId);
      await loadStatus();
    } catch (error) {
      toast.error('Não foi possível ativar a aba', { description: String(error) });
    }
  };

  const takeControl = async () => {
    if (!conversationId) return;
    setBusy(true);
    try {
      await api.browserTakeControl(conversationId);
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
      await api.releaseComputerControl(conversationId);
      setPaused(false);
      toast.success('Controle devolvido ao agente');
    } catch (error) {
      toast.error('Não foi possível devolver o controle', { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const clickPreview = async (event: ReactMouseEvent<HTMLImageElement>) => {
    if (!paused || !conversationId || !frame) return;
    event.currentTarget.focus();
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / frame.width, rect.height / frame.height);
    const displayWidth = frame.width * scale;
    const displayHeight = frame.height * scale;
    const offsetX = (rect.width - displayWidth) / 2;
    const offsetY = (rect.height - displayHeight) / 2;
    const x = (event.clientX - rect.left - offsetX) / scale;
    const y = (event.clientY - rect.top - offsetY) / scale;
    if (x < 0 || y < 0 || x > frame.width || y > frame.height) return;
    try {
      await api.browserClickAt(conversationId, x, y, status?.activeTab);
      window.setTimeout(() => void loadFrame(), 250);
    } catch (error) {
      toast.error('Clique não enviado', { description: String(error) });
    }
  };

  const keyPreview = async (event: ReactKeyboardEvent<HTMLImageElement>) => {
    if (!paused || !conversationId) return;
    const special = [
      'Enter',
      'Tab',
      'Escape',
      'Backspace',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      ' ',
    ];
    if (special.includes(event.key)) {
      event.preventDefault();
      try {
        await api.browserPressKey(conversationId, event.key, status?.activeTab);
        window.setTimeout(() => void loadFrame(), 250);
      } catch (error) {
        toast.error('Tecla não enviada', { description: String(error) });
      }
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      try {
        await api.browserInsertText(conversationId, event.key, status?.activeTab);
        window.setTimeout(() => void loadFrame(), 250);
      } catch (error) {
        toast.error('Texto não enviado', { description: String(error) });
      }
    }
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
        {!agent.workspaceId ? (
          <p className="rounded-lg border border-warning/30 bg-warning-soft px-2 py-1 text-[10px] text-warning">
            As tools de navegador rodam no perfil Code. Vincule um workspace ao agente para ele
            operar a página; o painel ainda pode ser usado para inspecionar a sessão.
          </p>
        ) : null}
        {!enabled ? null : (
          <>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={!status?.running || tabBusy}
                onClick={() => void history('back')}
                aria-label="Voltar"
              >
                <ArrowLeft className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!status?.running || tabBusy}
                onClick={() => void history('forward')}
                aria-label="Avançar"
              >
                <ArrowRight className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!status?.running || tabBusy}
                onClick={() => void history('reload')}
                aria-label="Recarregar"
              >
                <RefreshCw className={cn('size-3.5', tabBusy && 'animate-spin')} />
              </Button>
              <Input
                id="agent-browser-address"
                value={urlDraft}
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
                disabled={!status?.running || tabBusy || !urlDraft.trim()}
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
                    className="min-w-0 truncate focus-visible:outline-none"
                    title={tab.title}
                  >
                    {tab.title || 'Nova aba'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void closeTab(tab.id)}
                    disabled={tabBusy}
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
                disabled={!status?.running || tabBusy}
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
            <div className="relative flex min-h-48 flex-1 items-center justify-center overflow-hidden rounded-xl border border-border bg-background">
              {frame ? (
                <img
                  src={frame.dataUrl}
                  alt={`Página controlada por ${agent.name}: ${frame.title}`}
                  onClick={(event) => void clickPreview(event)}
                  onKeyDown={(event) => void keyPreview(event)}
                  tabIndex={paused ? 0 : -1}
                  className={cn(
                    'h-full w-full object-contain',
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
              {paused ? (
                <Badge tone="warning" className="absolute left-2 top-2">
                  <Lock className="mr-1 size-2.5" />
                  Controle humano
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral">
                {frame?.title || activeTab?.title || 'Nova aba'}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-[10px] text-foreground-subtle">
                {frame?.url ?? activeTab?.url ?? ''}
              </span>
              <Button
                size="sm"
                variant={paused ? 'secondary' : 'primary'}
                disabled={busy}
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
              {paused
                ? 'Controle humano: clique no preview e digite; o agente fica pausado.'
                : status.downloadDir
                  ? `Downloads: ${status.downloadDir}`
                  : null}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
