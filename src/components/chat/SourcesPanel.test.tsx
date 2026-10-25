// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ChatMessage, Citation } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(async () => true),
}));

vi.mock('./external', () => ({ openExternalUrl: mocks.openExternalUrl }));

// Imported after the mock above.
import { useChatStore, useUiStore } from '@/lib/store';
import { SourcesPanel } from './SourcesPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
  useUiStore.setState({ sourcesPanelOpen: true, artifactPanelOpen: false });
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
