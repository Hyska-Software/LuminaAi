// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AppInfo, Conversation, Settings } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  listArtifacts: vi.fn(),
  setConversationCodeLinked: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));

// Imported after the API mock.
import { useAppStore, useChatStore, useUiStore } from '@/lib/store';
import { CodeSidebar } from './CodeSidebar';

const originalMatchMedia = window.matchMedia;

/** jsdom setup returns `matches: false`; tests may force the compact drawer. */
function matchMediaReturning(matches: boolean): typeof window.matchMedia {
  return vi.fn((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as unknown as typeof window.matchMedia;
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    theme: 'system',
    locale: 'pt-BR',
    defaultProvider: 'opencode-go',
    defaultModel: 'deepseek-v4.1-flash',
    reasoningDefault: 'max',
    systemPrompt: '',
    webSearchEnabled: true,
    fileCreationEnabled: true,
    maxSteps: 64,
    sendKey: 'enter',
    showTokenUsage: true,
    reduceMotion: false,
    thinkingCollapsedByDefault: false,
    fontScale: 1,
    temperature: null,
    includeAttachments: true,
    autoTitle: true,
    codeExecutionEnabled: false,
    codeTimeoutSecs: 120,
    codePythonPath: '',
    codeNodePath: '',
    skillsPanelEnabled: true,
    disabledSkills: [],
    ...overrides,
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c-new',
    title: 'Nova conversa',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    messageCount: 0,
    preview: null,
    // Session fixtures here are Code sessions unless the test says otherwise.
    mode: 'code',
    ...overrides,
  };
}

function appInfo(): AppInfo {
  return {
    name: 'Lumina',
    version: '0.1.0',
    tauriVersion: '2.0.0',
    platform: 'windows',
    startedAt: 1,
    dataDir: 'C:/lumina',
  };
}

function renderSidebar(onClose?: () => void) {
  return render(onClose ? <CodeSidebar onClose={onClose} /> : <CodeSidebar />);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = matchMediaReturning(false);
  mocks.createConversation.mockResolvedValue(conversation());
  mocks.getConversation.mockImplementation(async (id: string) => ({
    // Mirror the backend: the stored conversation keeps its mode/codeLinked.
    conversation:
      useChatStore.getState().conversations.find((entry) => entry.id === id) ??
      conversation({ id }),
    messages: [],
  }));
  mocks.listArtifacts.mockResolvedValue([]);
  mocks.setConversationCodeLinked.mockImplementation(async (id: string, linked: boolean) =>
    conversation({ id, mode: 'chat', codeLinked: linked }),
  );
  useAppStore.setState({ settings: settings(), appInfo: appInfo() });
  useChatStore.setState({
    conversations: [],
    conversationsLoading: false,
    activeId: null,
    activeIdByLayout: { chat: null, code: null },
  });
  useUiStore.setState({
    layoutMode: 'code',
    codeView: 'session',
    codePanelOpen: true,
    codePanelTab: 'changes',
    commandPaletteOpen: false,
    settingsOpen: false,
  });
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

describe('CodeSidebar — chrome e ações', () => {
  it('é a sidebar de Sessões sobre a superfície do chrome, sem borda divisória', () => {
    renderSidebar();

    const aside = screen.getByRole('complementary', { name: 'Sessões' });
    expect(aside.className).toContain('bg-surface');
    expect(aside.className).toContain('w-full');
    expect(aside.className).not.toContain('border-r');
  });

  it('oferece Novo agente, Adicionar sessão do Chat, Buscar e Skills, na ordem do plano', () => {
    renderSidebar();

    const newAgent = screen.getByRole('button', { name: /Novo agente/ });
    const addSession = screen.getByRole('button', { name: 'Adicionar sessão do Chat' });
    const search = screen.getByRole('button', { name: /Buscar/ });
    const skills = screen.getByRole('button', { name: 'Skills' });

    expect(
      newAgent.compareDocumentPosition(addSession) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      addSession.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      search.compareDocumentPosition(skills) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('+ Novo agente cria uma conversa real no namespace Code e volta para a sessão', async () => {
    useUiStore.setState({ codeView: 'skills' });
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: /Novo agente/ }));

    // O centro volta para a sessão imediatamente; a conversa é criada no backend.
    expect(useUiStore.getState().codeView).toBe('session');
    await waitFor(() => expect(mocks.createConversation).toHaveBeenCalledTimes(1));
    expect(mocks.createConversation.mock.calls[0]?.[3]).toBe('code');
    await waitFor(() => expect(useChatStore.getState().activeId).toBe('c-new'));
  });

  it('Buscar abre a paleta de comandos', () => {
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: /Buscar/ }));

    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
  });

  it('Skills abre a página de Skills e marca o item como atual', () => {
    renderSidebar();

    const skills = screen.getByRole('button', { name: 'Skills' });
    expect(skills.getAttribute('aria-current')).toBeNull();

    fireEvent.click(skills);

    expect(useUiStore.getState().codeView).toBe('skills');
    expect(screen.getByRole('button', { name: 'Skills' }).getAttribute('aria-current')).toBe('page');
  });

  it('esconde Skills quando o painel de skills está desativado nas configurações', () => {
    useAppStore.setState({ settings: settings({ skillsPanelEnabled: false }) });
    renderSidebar();

    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull();
    // O resto das ações continua disponível.
    expect(screen.getByRole('button', { name: /Novo agente/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Buscar/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Adicionar sessão do Chat' })).toBeTruthy();
  });

  it('Adicionar sessão do Chat abre o diálogo com as sessões do Chat disponíveis', () => {
    useChatStore.setState({
      conversations: [
        conversation({ id: 'chat-1', title: 'Conversa do Chat', mode: 'chat' }),
        conversation({ id: 'code-1', title: 'Sessão do Code' }),
      ],
    });
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão do Chat' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Adicionar sessão do Chat' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Adicionar Conversa do Chat ao Code' }),
    ).toBeTruthy();
    // O diálogo lista só o Chat; a sessão do Code continua só na sidebar.
    expect(within(dialog).queryByText('Sessão do Code')).toBeNull();
  });

  it('ao adicionar, compartilha a sessão, abre no Code e fecha o drawer compacto', async () => {
    window.matchMedia = matchMediaReturning(true);
    const onClose = vi.fn();
    useChatStore.setState({
      conversations: [conversation({ id: 'chat-1', title: 'Conversa do Chat', mode: 'chat' })],
    });

    renderSidebar(onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar sessão do Chat' }));
    // Abrir o diálogo não fecha o drawer: o diálogo vive na sidebar.
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Conversa do Chat ao Code' }));

    await waitFor(() =>
      expect(mocks.setConversationCodeLinked).toHaveBeenCalledWith('chat-1', true),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useChatStore.getState().activeId).toBe('chat-1'));
  });
});

describe('CodeSidebar — Workspaces (estado vazio honesto)', () => {
  it('mostra a seção com o estado vazio do harness, sem botão morto', () => {
    renderSidebar();

    expect(screen.getByRole('heading', { name: 'Workspaces' })).toBeTruthy();
    expect(screen.getByText('Nenhum workspace aberto')).toBeTruthy();
    expect(
      screen.getByText('Os workspaces do harness de código aparecem aqui na próxima etapa.'),
    ).toBeTruthy();

    // Nenhuma ação de workspace fictícia (criar/adicionar workspace).
    expect(screen.queryByRole('button', { name: /workspace/i })).toBeNull();
  });
});

describe('CodeSidebar — Sessões (conversas reais)', () => {
  it('agrupa as conversas reais e destaca a sessão ativa', () => {
    const today = Date.now() - 1000;
    const old = Date.now() - 40 * 86_400_000;
    useChatStore.setState({
      conversations: [
        conversation({ id: 'c-ativa', title: 'Corrigir o build', updatedAt: today }),
        conversation({ id: 'c-antiga', title: 'Refatorar parser', updatedAt: old }),
      ],
      activeId: 'c-ativa',
    });

    renderSidebar();

    expect(screen.getByRole('heading', { name: 'Sessões' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Hoje' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Mais antigas' })).toBeTruthy();

    const active = screen.getByRole('button', { name: 'Corrigir o build' });
    const other = screen.getByRole('button', { name: 'Refatorar parser' });
    expect(active.getAttribute('aria-current')).toBe('true');
    expect(other.getAttribute('aria-current')).toBeNull();
  });

  it('abre a conversa ao clicar e volta para a sessão', async () => {
    useChatStore.setState({
      conversations: [conversation({ id: 'c-antiga', title: 'Refatorar parser' })],
    });
    useUiStore.setState({ codeView: 'skills' });

    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Refatorar parser' }));

    expect(useUiStore.getState().codeView).toBe('session');
    await waitFor(() => expect(mocks.getConversation).toHaveBeenCalledWith('c-antiga'));
    await waitFor(() => expect(useChatStore.getState().activeId).toBe('c-antiga'));
  });

  it('lista só sessões visíveis no Code e marca as compartilhadas do Chat', () => {
    useChatStore.setState({
      conversations: [
        conversation({ id: 'code-1', title: 'Sessão do Code' }),
        conversation({ id: 'chat-1', title: 'Conversa só do Chat', mode: 'chat' }),
        conversation({
          id: 'shared-1',
          title: 'Conversa compartilhada',
          mode: 'chat',
          codeLinked: true,
        }),
      ],
    });

    renderSidebar();

    expect(screen.getByRole('button', { name: 'Sessão do Code' })).toBeTruthy();
    // A sessão do Chat que não foi compartilhada não pertence ao Code.
    expect(screen.queryByRole('button', { name: 'Conversa só do Chat' })).toBeNull();

    const shared = screen.getByRole('button', {
      name: 'Conversa compartilhada, sessão compartilhada do Chat',
    });
    expect(shared).toBeTruthy();
    expect(shared.textContent).toContain('Do Chat');
    expect(shared.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    // Só a sessão compartilhada tem o selo "Sessão compartilhada do Chat".
    expect(screen.getAllByTitle('Sessão compartilhada do Chat')).toHaveLength(1);
  });

  it('mostra o estado vazio quando não há sessões', () => {
    renderSidebar();

    expect(screen.getByText('Nenhuma sessão ainda.')).toBeTruthy();
    expect(
      screen.getByText('Comece um novo agente ou adicione uma sessão do Chat.'),
    ).toBeTruthy();
  });

  it('não renderiza a Biblioteca no modo Code', () => {
    renderSidebar();

    expect(screen.queryByRole('button', { name: /Biblioteca/ })).toBeNull();
    expect(screen.queryByText('Biblioteca')).toBeNull();
  });
});

describe('CodeSidebar — rodapé', () => {
  it('abre Configurações e mostra a versão do app', () => {
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: /Configurações/ }));

    expect(useUiStore.getState().settingsOpen).toBe(true);
    expect(screen.getByText('v0.1.0')).toBeTruthy();
  });

  it('fecha o drawer compacto depois das ações', async () => {
    window.matchMedia = matchMediaReturning(true);
    const onClose = vi.fn();
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', title: 'Sessão compacta' })],
    });

    renderSidebar(onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Sessão compacta' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: /Configurações/ }));
    expect(onClose).toHaveBeenCalledTimes(3);

    // O drawer só existe quando o AppShell passa onClose.
    expect(screen.getByRole('button', { name: 'Fechar barra lateral' })).toBeTruthy();
  });
});
