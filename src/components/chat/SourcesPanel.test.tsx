// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ChatMessage, Citation } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(async () => true),
}));

vi.mock('./external', () => ({ openExternalUrl: mocks.openExternalUrl }));

// Imported after the mock above.
import { SIDE_PANEL_MIN_CHAT_WIDTH } from '@/lib/sidePanel';
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
  SIDE_PANEL_WIDTH_STEP,
  useChatStore,
  useUiStore,
} from '@/lib/store';
import { SourcesPanel } from './SourcesPanel';

const originalInnerWidth = window.innerWidth;

/** jsdom defaults to 1024px; tests override it and notify subscribers. */
function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setViewportWidth(originalInnerWidth);
});

function citation(overrides: Partial<Citation> = {}): Citation {
  return {
    id: 'cit-1',
    title: 'MIBR - MIBR',
    url: 'https://mibr.gg/',
    siteName: 'mibr.gg',
    ...overrides,
  };
}

function message(id: string, citations: Citation[]): ChatMessage {
  return {
    id,
    conversationId: 'conv-1',
    role: 'assistant',
    content: '',
    status: 'complete',
    toolCalls: [],
    citations,
    attachments: [],
    createdAt: 1,
  };
}

function conversation(): ChatMessage[] {
  return [
    message('m-1', [
      citation(),
      citation({ id: 'cit-2', title: 'VLR - Times', url: 'https://www.vlr.gg/team/1', siteName: 'www.vlr.gg' }),
    ]),
    message('m-2', [
      // Repeated source across turns: appears once in the panel.
      citation({ id: 'cit-3', title: 'VLR - Times', url: 'https://www.vlr.gg/team/1', siteName: 'www.vlr.gg' }),
      citation({ id: 'cit-4', title: 'Canal no YouTube', url: 'https://www.youtube.com/watch?v=1', siteName: 'youtube.com' }),
    ]),
  ];
}

function setConversation(messages: ChatMessage[]): void {
  useChatStore.setState({
    activeId: 'conv-1',
    messagesByConversation: {
      'conv-1': messages,
      'conv-2': [
        message('other', [
          citation({ id: 'cit-other', title: 'Outra fonte', url: 'https://outro.com/', siteName: 'outro.com' }),
        ]),
      ],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Narrow by default so the panel stays in overlay mode unless a test says otherwise.
  setViewportWidth(1024);
  useUiStore.setState({
    sourcesPanelOpen: true,
    artifactPanelOpen: false,
    sidePanelWidth: SIDE_PANEL_WIDTH_DEFAULT,
    sidePanelMode: 'overlay',
    sidebarOpen: true,
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  });
  setConversation(conversation());
});

describe('SourcesPanel', () => {
  it('lista as fontes da conversa ativa, deduplicadas, com contagem no header e no rodapé', () => {
    render(<SourcesPanel />);

    expect(screen.getByRole('heading', { name: 'Fontes' })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Fontes da conversa' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);

    expect(screen.getByText('mibr.gg')).toBeTruthy();
    expect(screen.getByText('vlr.gg')).toBeTruthy();
    expect(screen.getByText('youtube.com')).toBeTruthy();
    expect(screen.getByText('MIBR - MIBR')).toBeTruthy();
    expect(screen.getByText('Canal no YouTube')).toBeTruthy();

    const header = screen.getByRole('heading', { name: 'Fontes' }).closest('header');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByText('3')).toBeTruthy();
    expect(screen.getByText('3 fontes')).toBeTruthy();
    expect(screen.getByText('Abre no navegador padrão')).toBeTruthy();

    // Fontes de outra conversa não vazam para o painel.
    expect(screen.queryByText('outro.com')).toBeNull();
  });

  it('abre e fecha pelo store, escondendo o painel quando fechado', async () => {
    useUiStore.setState({ sourcesPanelOpen: false });
    const { container } = render(<SourcesPanel />);
    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    expect(aside?.getAttribute('aria-hidden')).toBe('true');
    expect(aside?.className).toContain('translate-x-full');

    act(() => useUiStore.getState().openSourcesPanel());

    expect(useUiStore.getState().sourcesPanelOpen).toBe(true);
    expect(aside?.getAttribute('aria-hidden')).toBeNull();
    expect(aside?.className).toContain('translate-x-0');
    // Foco entra no painel ao abrir (requestAnimationFrame).
    await waitFor(() => expect(document.activeElement).toBe(aside));

    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel de fontes' }));

    expect(useUiStore.getState().sourcesPanelOpen).toBe(false);
    expect(aside?.getAttribute('aria-hidden')).toBe('true');
  });

  it('abre a fonte no navegador ao clicar na linha', () => {
    render(<SourcesPanel />);

    fireEvent.click(screen.getByRole('button', { name: /mibr\.gg/ }));

    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://mibr.gg/');
  });

  it('mostra o estado vazio quando a conversa não tem fontes', () => {
    setConversation([message('m-1', [])]);

    render(<SourcesPanel />);

    expect(screen.getByText('Nenhuma fonte nesta conversa')).toBeTruthy();
    expect(
      screen.getByText('Quando o agente pesquisar na web, as fontes aparecem aqui.'),
    ).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Fontes da conversa' })).toBeNull();
    expect(screen.getByText('0 fontes')).toBeTruthy();
  });
});

describe('SourcesPanel — painel redimensionável', () => {
  const panel = (): HTMLElement => screen.getByRole('complementary', { name: 'Painel de fontes' });
  const grip = (): HTMLElement => screen.getByRole('separator', { name: 'Redimensionar painel de fontes' });

  it('aplica a largura persistida e expõe o divisor na borda esquerda', () => {
    useUiStore.setState({ sidePanelWidth: 520 });

    render(<SourcesPanel />);

    expect(panel().style.width).toBe('520px');
    expect(panel().className).toContain('max-w-[92vw]');

    const handle = grip();
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuenow')).toBe('520');
    expect(handle.getAttribute('aria-valuetext')).toBe('520 px');
    expect(handle.getAttribute('aria-valuemin')).toBe(String(SIDE_PANEL_WIDTH_MIN));
    expect(handle.getAttribute('aria-valuemax')).toBe(String(SIDE_PANEL_WIDTH_MAX));
    expect(handle.className).toContain('-left-2');
    expect(handle.className).toContain('absolute');
    // Fora do fluxo, depois do conteúdo: não soma largura nem cobre a lista.
    expect(panel().lastElementChild).toBe(handle);
  });

  it('pré-visualiza durante o arrasto e só persiste no pointerup', () => {
    render(<SourcesPanel />);

    const handle = grip();
    expect(panel().style.width).toBe(`${SIDE_PANEL_WIDTH_DEFAULT}px`);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 900 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 860 });

    // Arrastar para a esquerda aumenta a largura do painel à direita.
    expect(panel().style.width).toBe(`${SIDE_PANEL_WIDTH_DEFAULT + 40}px`);
    expect(grip().getAttribute('aria-valuenow')).toBe(String(SIDE_PANEL_WIDTH_DEFAULT + 40));
    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_DEFAULT);

    fireEvent.pointerUp(handle, { pointerId: 1 });

    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_DEFAULT + 40);
    expect(panel().style.width).toBe(`${SIDE_PANEL_WIDTH_DEFAULT + 40}px`);
  });

  it('persiste a largura pelas setas e pelos limites do teclado', () => {
    render(<SourcesPanel />);

    fireEvent.keyDown(grip(), { key: 'ArrowLeft' });
    expect(useUiStore.getState().sidePanelWidth).toBe(
      SIDE_PANEL_WIDTH_DEFAULT + SIDE_PANEL_WIDTH_STEP,
    );
    expect(panel().style.width).toBe(`${SIDE_PANEL_WIDTH_DEFAULT + SIDE_PANEL_WIDTH_STEP}px`);

    fireEvent.keyDown(grip(), { key: 'Home' });
    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_MIN);
    expect(panel().style.width).toBe(`${SIDE_PANEL_WIDTH_MIN}px`);

    fireEvent.keyDown(grip(), { key: 'End' });
    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_MAX);
    expect(panel().style.width).toBe(`${SIDE_PANEL_WIDTH_MAX}px`);
  });

  it('restaura a largura padrão com duplo clique', () => {
    useUiStore.setState({ sidePanelWidth: 560 });

    render(<SourcesPanel />);

    fireEvent.doubleClick(grip());

    expect(useUiStore.getState().sidePanelWidth).toBe(SIDE_PANEL_WIDTH_DEFAULT);
    expect(panel().style.width).toBe(`${SIDE_PANEL_WIDTH_DEFAULT}px`);
  });
});

describe('SourcesPanel — modo docked', () => {
  const panel = (): HTMLElement => screen.getByRole('complementary', { name: 'Painel de fontes' });
  const grip = (): HTMLElement =>
    screen.getByRole('separator', { name: 'Redimensionar painel de fontes' });

  it('fixa o painel ao lado do chat quando a janela permite', () => {
    setViewportWidth(1440);
    useUiStore.setState({ sidePanelMode: 'docked' });

    render(<SourcesPanel />);

    const aside = panel();
    expect(aside.className).toContain('relative');
    expect(aside.className).toContain('shrink-0');
    expect(aside.className).not.toContain('absolute');
    expect(aside.className).not.toContain('translate-x-full');
    expect(aside.style.width).toBe(`${SIDE_PANEL_WIDTH_DEFAULT}px`);

    // 1440 − 272 (sidebar) − 480 (chat mínimo) = 688.
    const maxWidth = 1440 - SIDEBAR_WIDTH_DEFAULT - SIDE_PANEL_MIN_CHAT_WIDTH;
    expect(grip().getAttribute('aria-valuenow')).toBe(String(SIDE_PANEL_WIDTH_DEFAULT));
    expect(grip().getAttribute('aria-valuemax')).toBe(String(maxWidth));
  });

  it('esconde o painel dockado quando fechado', () => {
    setViewportWidth(1440);
    useUiStore.setState({ sidePanelMode: 'docked', sourcesPanelOpen: false });

    const { container } = render(<SourcesPanel />);
    const aside = container.querySelector('aside');

    expect(aside?.className).toContain('hidden');
    expect(aside?.getAttribute('aria-hidden')).toBe('true');
    // Escondido estruturalmente (inline): nunca depende só do merge de classes,
    // que já deixou dois painéis visíveis ao mesmo tempo (regressão).
    expect(aside?.style.display).toBe('none');
  });

  it('volta para overlay quando a janela é estreita demais para fixar', () => {
    setViewportWidth(1024);
    useUiStore.setState({ sidePanelMode: 'docked' });

    render(<SourcesPanel />);

    const aside = panel();
    expect(aside.className).toContain('absolute');
    expect(aside.className).not.toContain('relative');
    expect(aside.className).toContain('translate-x-0');
    // A preferência é preservada para quando a janela crescer de novo.
    expect(useUiStore.getState().sidePanelMode).toBe('docked');
  });

  it('limita a largura dockada ao espaço disponível e persiste o valor clampado', () => {
    setViewportWidth(1200);
    useUiStore.setState({ sidePanelMode: 'docked', sidePanelWidth: 900 });

    render(<SourcesPanel />);

    // 1200 − 272 (sidebar) − 480 (chat mínimo) = 448.
    const available = 1200 - SIDEBAR_WIDTH_DEFAULT - SIDE_PANEL_MIN_CHAT_WIDTH;
    expect(available).toBe(448);
    expect(panel().style.width).toBe('448px');
    expect(grip().getAttribute('aria-valuenow')).toBe('448');
    expect(grip().getAttribute('aria-valuemax')).toBe('448');

    fireEvent.keyDown(grip(), { key: 'End' });

    expect(useUiStore.getState().sidePanelWidth).toBe(448);
    expect(panel().style.width).toBe('448px');
  });

  it('alterna entre fixar e soltar pelo botão do header', () => {
    setViewportWidth(1440);

    render(<SourcesPanel />);

    const dock = screen.getByRole('button', { name: 'Fixar painel ao lado do chat' });
    expect(dock.getAttribute('aria-pressed')).toBeNull();
    expect((dock as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(dock);

    expect(useUiStore.getState().sidePanelMode).toBe('docked');
    expect(panel().className).toContain('relative');

    const undock = screen.getByRole('button', { name: 'Soltar painel sobre o chat' });
    expect(undock.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(undock);

    expect(useUiStore.getState().sidePanelMode).toBe('overlay');
    expect(panel().className).toContain('absolute');
  });

  it('desabilita o botão de fixar quando não há espaço para dockar', () => {
    setViewportWidth(1024);

    render(<SourcesPanel />);

    const dock = screen.getByRole('button', { name: 'Fixar painel ao lado do chat' });
    expect((dock as HTMLButtonElement).disabled).toBe(true);
    // A dica "aumente a janela" precisa de um wrapper hoverável em volta do botão.
    expect(dock.parentElement?.tagName).toBe('SPAN');
  });

  it('permite desafixar mesmo quando a janela encolheu (fallback overlay)', () => {
    setViewportWidth(1024);
    useUiStore.setState({ sidePanelMode: 'docked' });

    render(<SourcesPanel />);

    const undock = screen.getByRole('button', { name: 'Soltar painel sobre o chat' });
    expect((undock as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(undock);
    expect(useUiStore.getState().sidePanelMode).toBe('overlay');
  });
});
