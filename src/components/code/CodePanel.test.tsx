// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/api', () => ({ api: {} }));

import {
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_STEP,
  useUiStore,
} from '@/lib/store';
import { CodePanel } from './CodePanel';

const originalInnerWidth = window.innerWidth;

/** `useViewportWidth` reads `window.innerWidth`; keep it in sync with the resize event. */
function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

const panel = (): HTMLElement | null => screen.queryByRole('complementary');
const requiredPanel = (): HTMLElement =>
  screen.getByRole('complementary', { name: 'Painel de arquivos e alterações' });

function resetPanelState(): void {
  useUiStore.setState({
    codePanelOpen: true,
    codePanelTab: 'changes',
    sidePanelWidth: SIDE_PANEL_WIDTH_DEFAULT,
    sidebarOpen: true,
    sidebarWidth: 272,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setViewport(1440);
  resetPanelState();
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: originalInnerWidth,
  });
});

describe('CodePanel — visibilidade', () => {
  it('aparece como painel fixo ao lado da conversa em janelas largas', () => {
    render(<CodePanel />);

    const aside = requiredPanel();
    expect(aside.style.width).toBe(`${SIDE_PANEL_WIDTH_DEFAULT}px`);
    expect(aside.className).toContain('border-l');
    expect(aside.className).toContain('bg-surface-raised');
    expect(screen.getByRole('tablist', { name: 'Conteúdo do painel' })).toBeTruthy();
  });

  it('fiche-se oculto quando codePanelOpen é falso', () => {
    useUiStore.setState({ codePanelOpen: false });

    render(<CodePanel />);

    expect(panel()).toBeNull();
  });

  it('fiche-se oculto abaixo de 1120px, como o painel fixo do chat', () => {
    setViewport(1000);

    render(<CodePanel />);

    expect(panel()).toBeNull();
    // A preferência continua salva para quando a janela crescer.
    expect(useUiStore.getState().codePanelOpen).toBe(true);
  });
});

describe('CodePanel — abas Arquivos / Alterações', () => {
  it('abre em Alterações com a barra de commit em estado vazio', () => {
    render(<CodePanel />);

    expect(screen.getByRole('tab', { name: 'Alterações' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Arquivos' }).getAttribute('aria-selected')).toBe('false');

    expect(screen.getByText('Sem workspace')).toBeTruthy();
    expect(screen.getByText('Sem commit')).toBeTruthy();
    expect(screen.getByText('+0')).toBeTruthy();
    expect(screen.getByText('−0')).toBeTruthy();

    expect(screen.getByText('Nenhuma alteração pendente')).toBeTruthy();
    expect(
      screen.getByText('As mudanças do agente aparecerão aqui para revisão e commit.'),
    ).toBeTruthy();
  });

  it('o botão Commit fica desabilitado e explica que depende do harness', () => {
    render(<CodePanel />);

    const commit = screen.getByRole('button', { name: 'Commit' }) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
    expect(screen.getByTitle('Disponível com o harness de código')).toBeTruthy();
  });

  it('troca para Arquivos e mostra o estado vazio da árvore do workspace', () => {
    render(<CodePanel />);

    fireEvent.click(screen.getByRole('tab', { name: 'Arquivos' }));

    expect(useUiStore.getState().codePanelTab).toBe('files');
    expect(screen.getByText('Nenhum arquivo para mostrar')).toBeTruthy();
    expect(
      screen.getByText('A árvore do workspace aparece aqui quando o harness estiver ativo.'),
    ).toBeTruthy();
    expect(screen.queryByText('Nenhuma alteração pendente')).toBeNull();
  });

  it('respeita o estado persistido e navega com as setas do teclado', () => {
    useUiStore.setState({ codePanelTab: 'files' });
    render(<CodePanel />);

    expect(screen.getByRole('tab', { name: 'Arquivos' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Arquivos' }), { key: 'ArrowRight' });

    expect(useUiStore.getState().codePanelTab).toBe('changes');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Alterações' }));

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alterações' }), { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Alterações' }));

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alterações' }), { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Arquivos' }));
    expect(useUiStore.getState().codePanelTab).toBe('files');
  });

  it('recolhe o painel e persiste o estado', () => {
    render(<CodePanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Recolher painel' }));

    expect(useUiStore.getState().codePanelOpen).toBe(false);
    expect(panel()).toBeNull();
  });
});

describe('CodePanel — redimensionamento', () => {
  it('usa a largura persistida e o mesmo divisor acessível dos painéis direitos', () => {
    useUiStore.setState({ sidePanelWidth: 520 });

    render(<CodePanel />);

    expect(requiredPanel().style.width).toBe('520px');

    const handle = screen.getByRole('separator', { name: 'Redimensionar painel de arquivos' });
    expect(handle.getAttribute('aria-valuenow')).toBe('520');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });

    expect(useUiStore.getState().sidePanelWidth).toBe(520 + SIDE_PANEL_WIDTH_STEP);
    expect(requiredPanel().style.width).toBe(`${520 + SIDE_PANEL_WIDTH_STEP}px`);
  });

  it('não deixa o painel espremer a conversa abaixo de 480px (limite do viewport)', () => {
    render(<CodePanel />);

    const handle = screen.getByRole('separator', { name: 'Redimensionar painel de arquivos' });
    fireEvent.keyDown(handle, { key: 'End' });

    // 1440 - sidebar 272 - 480 de conversa = 688px máximo no modo fixo.
    expect(useUiStore.getState().sidePanelWidth).toBe(688);
    expect(requiredPanel().style.width).toBe('688px');
  });

  it('duplo clique no divisor restaura a largura padrão', () => {
    useUiStore.setState({ sidePanelWidth: 600 });

    render(<CodePanel />);

    fireEvent.doubleClick(screen.getByRole('separator', { name: 'Redimensionar painel de arquivos' }));

    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_DEFAULT);
    expect(requiredPanel().style.width).toBe(`${SIDE_PANEL_WIDTH_DEFAULT}px`);
  });

  it('persiste sempre dentro dos limites globais dos painéis direitos', () => {
    useUiStore.setState({ sidePanelWidth: SIDE_PANEL_WIDTH_MAX });

    render(<CodePanel />);

    // A largura persistida é clampada ao espaço disponível (688px), sem passar do máximo global.
    expect(requiredPanel().style.width).toBe('688px');
    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_MAX);
  });
});
