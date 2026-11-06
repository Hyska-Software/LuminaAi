import { useEffect, useRef, useState } from 'react';
import { Expand, Minimize2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type RFB from '@novnc/novnc';

interface Props {
  conversationId: string;
  agentName: string;
  interactive: boolean;
  busy: boolean;
  onTakeControl: () => void;
  onReleaseControl: () => void;
}

/** One mounted viewer is resized in place when expanded; it never starts a second desktop. */
export function PrivateDesktopViewer({ conversationId, agentName, interactive, busy, onTakeControl, onReleaseControl }: Props) {
  const target = useRef<HTMLDivElement>(null);
  const clientRef = useRef<RFB | null>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const retries = useRef(0);
  const [expanded, setExpanded] = useState(false);
  const [fit, setFit] = useState(true);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { retries.current = 0; }, [conversationId, interactive]);

  useEffect(() => {
    let disposed = false;
    let client: RFB | null = null;
    let retryTimer: number | undefined;
    setStatus('connecting');
    setError(null);
    const connect = async () => {
      try {
        const [{ default: Rfb }, url] = await Promise.all([
          import('@novnc/novnc'),
          api.computerOpenStream(conversationId, interactive),
        ]);
        if (disposed || !target.current) return;
        client = new Rfb(target.current, url);
        clientRef.current = client;
        client.viewOnly = !interactive;
        client.scaleViewport = fitRef.current;
        client.resizeSession = false;
        client.focusOnClick = interactive;
        client.addEventListener('connect', () => { if (!disposed) setStatus('connected'); });
        client.addEventListener('disconnect', () => {
          if (disposed) return;
          setStatus('disconnected');
          if (retries.current < 3) {
            const delay = 1000 * 2 ** retries.current++;
            retryTimer = window.setTimeout(() => setAttempt((value) => value + 1), delay);
          }
        });
        client.addEventListener('securityfailure', () => { if (!disposed) setStatus('disconnected'); });
      } catch (error) {
        if (!disposed) { setError(String(error)); setStatus('disconnected'); }
      }
    };
    void connect();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      client?.disconnect();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [conversationId, interactive, attempt]);

  useEffect(() => {
    if (clientRef.current) clientRef.current.scaleViewport = fit;
  }, [fit]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !interactive) setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, interactive]);

  useEffect(() => {
    if (!interactive) return;
    const releaseKeyboard = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.shiftKey && event.code === 'KeyQ') {
        event.preventDefault();
        event.stopPropagation();
        clientRef.current?.blur();
        expandButton.current?.focus();
      }
    };
    window.addEventListener('keydown', releaseKeyboard, true);
    return () => window.removeEventListener('keydown', releaseKeyboard, true);
  }, [interactive]);

  return (
    <div className={cn('relative flex flex-col overflow-hidden rounded-xl border border-border bg-background', expanded && 'fixed inset-2 z-[100] rounded-xl shadow-2xl')}>
      <div className="flex min-h-10 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">Tela de {agentName}</span>
        <span role="status" className="text-[11px] text-foreground-muted">
          {status === 'connected' ? (interactive ? 'Você está no controle' : 'Ao vivo · somente visualização') : status === 'connecting' ? 'Conectando…' : 'Conexão interrompida'}
        </span>
        {expanded ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={interactive ? onReleaseControl : onTakeControl}>
            {interactive ? 'Devolver ao agente' : 'Assumir o controle'}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" aria-label={fit ? 'Mostrar tamanho real' : 'Ajustar desktop à janela'} onClick={() => setFit((value) => !value)}>
          {fit ? '1:1' : 'Ajustar'}
        </Button>
        <Button ref={expandButton} size="sm" variant="ghost" aria-label={expanded ? 'Sair da visualização expandida' : 'Expandir desktop'} onClick={() => setExpanded((value) => !value)}>
          {expanded ? <Minimize2 className="size-4" /> : <Expand className="size-4" />}
        </Button>
      </div>
      <div className={cn('relative min-h-48 bg-background', expanded ? 'min-h-0 flex-1' : 'aspect-video')}>
        <div ref={target} aria-label={`Desktop de ${agentName}`} className="absolute inset-0 overflow-hidden" />
        {status !== 'connected' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background p-4 text-center text-[12px] text-foreground-muted">
            <span>{status === 'connecting' ? 'Conectando ao desktop privado…' : 'Não foi possível conectar ao desktop. O agente continua pausado se você assumiu o controle.'}</span>
            {error ? <span className="max-w-full break-words text-[11px] text-danger">{error}</span> : null}
            {status === 'disconnected' ? <Button size="sm" variant="secondary" onClick={() => { retries.current = 0; setAttempt((value) => value + 1); }}><RefreshCw className="mr-1.5 size-3.5" />Reconectar</Button> : null}
          </div>
        ) : null}
      </div>
      {interactive ? <p className="border-t border-border px-3 py-1 text-[11px] text-foreground-muted">Para liberar o teclado do desktop, pressione Ctrl+Alt+Shift+Q.</p> : null}
    </div>
  );
}
