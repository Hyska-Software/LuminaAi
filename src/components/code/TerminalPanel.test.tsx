// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { TerminalEvent, TerminalInfo } from '@/lib/types';

/** xterm needs a canvas; the test validates the wiring with the backend, not the render. */
vi.mock('@xterm/xterm', () => {
  class FakeTerminal {
    cols = 100;
    rows = 24;
    written: string[] = [];
    focused = false;
    cleared = false;
    options: Record<string, unknown> = {};
    host: HTMLElement | null = null;
    loadAddon() {}
    open(host: HTMLElement) {
      this.host = host;
    }
    focus() {
      this.focused = true;
    }
    write(data: string) {
      this.written.push(data);
    }
    clear() {
      this.cleared = true;
    }
    dispose() {}
    onData(handler: (data: string) => void) {
      (this as unknown as { handler: (data: string) => void }).handler = handler;
      return { dispose: () => undefined };
    }
  }
  return { Terminal: FakeTerminal };
});

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

const apiMock = vi.hoisted(() => ({
  openTerminal: vi.fn(),
  writeTerminal: vi.fn(),
  resizeTerminal: vi.fn(),
  closeTerminal: vi.fn(),
  killTerminal: vi.fn(),
  listTerminals: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: apiMock }));

import { TerminalPanel } from './TerminalPanel';
import { __resetTerminalManagerForTests } from './terminalManager';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let nextTerminal = 0;

function terminalInfo(id = `term-${nextTerminal}`): TerminalInfo {
  nextTerminal += 1;
  return {
    id,
    conversationId: 'conv-1',
    title: 'lumina',
    cwd: 'C:/projetos/lumina',
    cols: 100,
    rows: 24,
    running: true,
    exitCode: null,
  };
}

function lastCallback(): (event: TerminalEvent) => void {
  const calls = apiMock.openTerminal.mock.calls;
  return calls[calls.length - 1]?.[3] as (event: TerminalEvent) => void;
}

function hosts(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-terminal-host]'));
}

beforeEach(() => {
  vi.clearAllMocks();
  nextTerminal = 1;
  __resetTerminalManagerForTests();
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
  apiMock.openTerminal.mockImplementation(async () => terminalInfo());
  apiMock.writeTerminal.mockResolvedValue(undefined);
  apiMock.resizeTerminal.mockResolvedValue(undefined);
  apiMock.closeTerminal.mockResolvedValue(true);
  apiMock.killTerminal.mockResolvedValue(undefined);
  apiMock.listTerminals.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe('TerminalPanel', () => {
  it('abre um terminal no workspace e fecha a aba com o backend', async () => {
    render(<TerminalPanel conversationId="conv-1" />);
    expect(screen.getByText('Nenhum terminal aberto')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));

    await waitFor(() => {
      expect(apiMock.openTerminal).toHaveBeenCalledWith('conv-1', 100, 24, expect.any(Function));
    });
    expect(await screen.findByRole('tab', { name: 'Terminal 1' })).toBeTruthy();
    expect(screen.getByText('C:/projetos/lumina')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Fechar Terminal 1' }));

    expect(apiMock.closeTerminal).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Fechar terminal' }));

    expect(apiMock.closeTerminal).toHaveBeenCalledWith('term-1');
    expect(screen.queryByRole('tab', { name: 'Terminal 1' })).toBeNull();
    expect(screen.getByText('Nenhum terminal aberto')).toBeTruthy();
  });

  it('fecha uma aba encerrada sem pedir confirmação', async () => {
    render(<TerminalPanel conversationId="conv-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await screen.findByRole('tab', { name: 'Terminal 1' });

    lastCallback()({ type: 'exit', code: 0 });
    expect(await screen.findByText('Encerrado (0)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar Terminal 1' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiMock.closeTerminal).toHaveBeenCalledWith('term-1');
  });

  it('mostra apenas o host ativo e troca com a aba', async () => {
    render(<TerminalPanel conversationId="conv-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await screen.findByRole('tab', { name: 'Terminal 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Novo terminal' }));
    await screen.findByRole('tab', { name: 'Terminal 2' });

    const [first, second] = hosts();
    expect(first.hidden).toBe(true);
    expect(second.hidden).toBe(false);

    fireEvent.click(screen.getByRole('tab', { name: 'Terminal 1' }));

    expect(first.hidden).toBe(false);
    expect(second.hidden).toBe(true);
  });

  it('desmontar o painel não fecha o PTY; remontar reata a mesma aba', async () => {
    const first = render(<TerminalPanel conversationId="conv-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await screen.findByRole('tab', { name: 'Terminal 1' });
    first.unmount();

    expect(apiMock.closeTerminal).not.toHaveBeenCalled();

    render(<TerminalPanel conversationId="conv-1" />);
    expect(await screen.findByRole('tab', { name: 'Terminal 1' })).toBeTruthy();
    expect(hosts()).toHaveLength(1);
  });

  it('isola os terminais por conversa', async () => {
    const view = render(<TerminalPanel conversationId="conv-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await screen.findByRole('tab', { name: 'Terminal 1' });

    view.rerender(<TerminalPanel conversationId="conv-2" />);
    expect(screen.queryByRole('tab', { name: 'Terminal 1' })).toBeNull();
    expect(screen.getByText('Nenhum terminal aberto')).toBeTruthy();

    view.rerender(<TerminalPanel conversationId="conv-1" />);
    expect(await screen.findByRole('tab', { name: 'Terminal 1' })).toBeTruthy();
  });

  it('marca o processo como encerrado e oferece reiniciar', async () => {
    render(<TerminalPanel conversationId="conv-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await screen.findByRole('tab', { name: 'Terminal 1' });

    lastCallback()({ type: 'exit', code: 0 });

    expect(await screen.findByText('Encerrado (0)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reiniciar terminal' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Matar processo' })).toBeNull();
  });

  it('mata o processo pelo backend mantendo a aba', async () => {
    render(<TerminalPanel conversationId="conv-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await screen.findByRole('tab', { name: 'Terminal 1' });

    fireEvent.click(screen.getByRole('button', { name: 'Matar processo' }));
    await waitFor(() => expect(apiMock.killTerminal).toHaveBeenCalledWith('term-1'));

    lastCallback()({ type: 'exit', code: 130 });
    expect(await screen.findByText('Encerrado (130)')).toBeTruthy();
  });

  it('para no limite de quatro abas e desabilita a abertura', async () => {
    render(<TerminalPanel conversationId="conv-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await screen.findByRole('tab', { name: 'Terminal 1' });

    for (let index = 2; index <= 4; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Novo terminal' }));
      await screen.findByRole('tab', { name: `Terminal ${index}` });
    }

    expect(screen.getAllByRole('tab')).toHaveLength(4);
    const add = screen.getByRole('button', { name: 'Novo terminal' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
  });

  it('degrada com erro amigável e sem retry inútil no limite', async () => {
    apiMock.openTerminal.mockRejectedValueOnce('TERMINAL_LIMIT: máximo de 4 terminais');
    render(<TerminalPanel conversationId="conv-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Limite de 4 terminais');
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('reconcilia sessões órfãs de um reload do webview', async () => {
    apiMock.listTerminals.mockResolvedValueOnce([terminalInfo('term-orphan')]);
    render(<TerminalPanel conversationId="conv-1" />);

    await waitFor(() => expect(apiMock.closeTerminal).toHaveBeenCalledWith('term-orphan'));
  });
});
