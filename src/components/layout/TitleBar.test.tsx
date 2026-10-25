// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const windowMock = vi.hoisted(() => ({
  isMaximized: vi.fn(async () => false),
  minimize: vi.fn(async () => undefined),
  maximize: vi.fn(async () => undefined),
  unmaximize: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  onResized: vi.fn(async () => () => undefined),
}));

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => windowMock }));
vi.mock('@/lib/api', () => ({ api: {} }));

// Imported after the mocks.
import { TitleBar } from './TitleBar';

afterEach(() => {
  cleanup();
});

describe('TitleBar', () => {
  it('mantém a marca, a busca e os controles nativos', async () => {
    render(<TitleBar />);

    await waitFor(() => expect(windowMock.isMaximized).toHaveBeenCalled());

    expect(screen.getByText('Lumina')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buscar conversas e comandos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Minimizar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Maximizar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy();
  });

  it('não monta o seletor de modelo/pensamento (ele vive no composer do chat)', async () => {
    render(<TitleBar />);

    await waitFor(() => expect(windowMock.isMaximized).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: /Selecionar modelo/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Selecionar modo de pensamento/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Selecionar modelo' })).toBeNull();
  });

  it('funde-se ao chrome: fundo surface e nenhuma borda inferior', async () => {
    render(<TitleBar />);

    await waitFor(() => expect(windowMock.isMaximized).toHaveBeenCalled());

    const header = screen.getByRole('banner');
    expect(header.className).toContain('bg-surface');
    // A divisão com o chat é feita pelo canto arredondado do painel, não por linha.
    expect(header.className).not.toContain('border');
  });
});
