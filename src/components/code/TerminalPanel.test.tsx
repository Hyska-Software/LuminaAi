// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/** xterm precisa de canvas; o teste valida a fiação com o backend, não o render. */
vi.mock('@xterm/xterm', () => {
  class FakeTerminal {
    cols = 100;
    rows = 24;
    written: string[] = [];
    focused = false;
    loadAddon() {}
    open() {}
    focus() {
      this.focused = true;
    }
    write(data: string) {
      this.written.push(data);
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
}));

vi.mock('@/lib/api', () => ({ api: apiMock }));

import { TerminalPanel } from './TerminalPanel';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
  apiMock.openTerminal.mockResolvedValue({
    id: 'term-1',
    conversationId: 'conv-1',
    title: 'lumina',
    cwd: 'C:/projetos/lumina',
    cols: 100,
    rows: 24,
    running: true,
  });
  apiMock.writeTerminal.mockResolvedValue(undefined);
  apiMock.resizeTerminal.mockResolvedValue(undefined);
  apiMock.closeTerminal.mockResolvedValue(true);
});

afterEach(() => cleanup());

describe('TerminalPanel', () => {
  it('mostra o estado vazio e abre um terminal no workspace da conversa', async () => {
    render(<TerminalPanel conversationId="conv-1" />);
    expect(screen.getByText('Nenhum terminal aberto')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));

    await waitFor(() => {
      expect(apiMock.openTerminal).toHaveBeenCalledWith('conv-1', 100, 24, expect.any(Function));
    });
    expect(await screen.findByRole('tab', { name: 'lumina' })).toBeTruthy();
    expect(screen.getByText('C:/projetos/lumina')).toBeTruthy();
  });

  it('fecha a aba e o processo do backend', async () => {
    render(<TerminalPanel conversationId="conv-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await screen.findByRole('tab', { name: 'lumina' });

    fireEvent.click(screen.getByRole('button', { name: 'Fechar lumina' }));

    expect(apiMock.closeTerminal).toHaveBeenCalledWith('term-1');
    expect(screen.queryByRole('tab', { name: 'lumina' })).toBeNull();
    expect(screen.getByText('Nenhum terminal aberto')).toBeTruthy();
  });

  it('degrada com erro honesto quando o backend recusa', async () => {
    apiMock.openTerminal.mockRejectedValueOnce('TERMINAL_LIMIT: máximo de 4 terminais');
    render(<TerminalPanel conversationId="conv-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/TERMINAL_LIMIT/)).toBeTruthy();
  });
});
