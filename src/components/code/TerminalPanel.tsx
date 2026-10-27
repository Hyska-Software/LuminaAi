/**
 * Terminal PTY do layout Code (F7; `WORKBENCH.md` §7.3).
 *
 * O backend (ConPTY no Windows) transmite a saída por um `Channel<TerminalEvent>`;
 * o xterm.js renderiza e manda a digitação de volta por `write_terminal`. É o
 * terminal do **usuário** — o agente tem `run_command`/jobs próprios.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Plus, RotateCcw, X } from 'lucide-react';

import { IconButton, Spinner, Tooltip } from '@/components/ui';
import { api } from '@/lib/api';
import type { TerminalInfo } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TerminalInstance {
  id: string;
  term: XTerm;
  dispose: () => void;
}

interface TerminalPanelProps {
  conversationId: string;
  className?: string;
}

/** Aba "Terminal" do painel direito: abas de terminais, xterm e foco. */
export function TerminalPanel({ conversationId, className }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instances = useRef(new Map<string, TerminalInstance>());
  const [tabs, setTabs] = useState<TerminalInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectTab = useCallback((id: string) => {
    setActiveId(id);
    instances.current.get(id)?.term.focus();
  }, []);

  const closeTerminal = useCallback((id: string) => {
    instances.current.get(id)?.dispose();
    instances.current.delete(id);
    void api.closeTerminal(id).catch(() => undefined);
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id);
      setActiveId((active) => (active === id ? (next[0]?.id ?? null) : active));
      return next;
    });
  }, []);

  const openTerminal = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    setLoading(true);
    setError(null);
    // O xterm é criado antes do PTY para que os primeiros bytes já tenham
    // onde ser escritos; o tamanho inicial é ajustado via FitAddon.
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
      fontSize: 12,
      scrollback: 5_000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const host = document.createElement('div');
    host.className = 'h-full w-full';
    container.appendChild(host);
    try {
      term.open(host);
      try {
        fit.fit();
      } catch {
        // Sem dimensões no primeiro paint: o ResizeObserver corrige.
      }
      const info = await api.openTerminal(
        conversationId,
        term.cols || 100,
        term.rows || 24,
        (event) => {
          if (event.type === 'data') term.write(event.data);
          else term.write('\r\n\x1b[90m[processo finalizado]\x1b[0m\r\n');
        },
      );
      const input = term.onData((data) => {
        void api.writeTerminal(info.id, data).catch((writeError: unknown) => {
          term.write(`\r\n\x1b[31m${String(writeError)}\x1b[0m\r\n`);
        });
      });
      const resize = () => {
        try {
          fit.fit();
        } catch {
          return;
        }
        void api.resizeTerminal(info.id, term.cols, term.rows).catch(() => undefined);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      instances.current.set(info.id, {
        id: info.id,
        term,
        dispose: () => {
          observer.disconnect();
          input.dispose();
          term.dispose();
          host.remove();
        },
      });
      setTabs((current) => [...current, info]);
      setActiveId(info.id);
      requestAnimationFrame(() => {
        resize();
        term.focus();
      });
    } catch (openError) {
      term.dispose();
      host.remove();
      setError(String(openError));
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(
    () => () => {
      for (const instance of instances.current.values()) instance.dispose();
      instances.current.clear();
    },
    [],
  );

  const active = tabs.find((tab) => tab.id === activeId) ?? null;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <div
          role="tablist"
          aria-label="Terminais abertos"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="presentation"
              className={cn(
                'flex h-7 max-w-40 shrink-0 items-center rounded-md border text-[12px]',
                activeId === tab.id
                  ? 'border-border bg-surface-raised text-foreground shadow-sm'
                  : 'border-transparent text-foreground-muted hover:bg-surface-hover',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeId === tab.id}
                onClick={() => selectTab(tab.id)}
                className="h-full min-w-0 flex-1 truncate pl-2 text-left"
              >
                {tab.title}
              </button>
              <button
                type="button"
                aria-label={`Fechar ${tab.title}`}
                onClick={() => closeTerminal(tab.id)}
                className="mr-0.5 flex size-5 items-center justify-center rounded text-foreground-subtle hover:text-foreground"
              >
                <X aria-hidden className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <Tooltip content="Novo terminal" side="bottom">
          <IconButton
            label="Novo terminal"
            size="sm"
            onClick={() => void openTerminal()}
            disabled={loading}
          >
            {loading ? <Spinner size="xs" /> : <Plus className="size-4" />}
          </IconButton>
        </Tooltip>
      </div>

      {error ? (
        <div role="alert" className="border-b border-border px-3 py-2 text-[12px] text-danger">
          {error}
          <button
            type="button"
            onClick={() => void openTerminal()}
            className="ml-2 inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
          >
            <RotateCcw aria-hidden className="size-3" /> Tentar novamente
          </button>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 bg-background">
        <div ref={containerRef} className="h-full w-full" />
        {tabs.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[13px] font-medium text-foreground">Nenhum terminal aberto</p>
            <p className="max-w-64 text-[12px] leading-relaxed text-foreground-muted">
              O terminal roda no diretório do workspace. O agente usa os próprios comandos e jobs.
            </p>
            <button
              type="button"
              onClick={() => void openTerminal()}
              className="mt-1 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-surface-hover"
            >
              Abrir terminal
            </button>
          </div>
        ) : null}
      </div>
      {active ? (
        <div className="flex h-6 shrink-0 items-center justify-between border-t border-border px-3 text-[11px] text-foreground-subtle">
          <span className="truncate">{active.cwd || active.title}</span>
          <span className="tabular-nums">
            {active.cols}×{active.rows}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default TerminalPanel;
