// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppInfo, CodeSessionState, Conversation, Settings, Workspace } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  pickWorkspaceFolder: vi.fn(),
  addWorkspace: vi.fn(),
  setWorkspaceTrusted: vi.fn(),
  setPermissionMode: vi.fn(),
  setPlanMode: vi.fn(),
  removeWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  getWorkspace: vi.fn(),
  setConversationWorkspace: vi.fn(),
  openWorkspaceInExplorer: vi.fn(),
  getCodeSessionState: vi.fn(),
  createConversation: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  listArtifacts: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));

// Imported after the API mock.
import { useAppStore, useChatStore, useUiStore } from '@/lib/store';
import { __resetWorkspacesForTests } from './useWorkspaces';
import { CodeSessionHeader } from './CodeSessionHeader';

const originalMatchMedia = window.matchMedia;
const originalInnerWidth = window.innerWidth;

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

/** `useViewportWidth` reads `window.innerWidth`; keep it in sync with the resize event. */
function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
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

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'lumina-core',
    path: 'C:/dev/lumina',
    createdAt: 1,
    updatedAt: 2,
    trusted: true,
    git: { root: 'C:/dev/lumina', branch: 'main', dirty: true },
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

function sessionState(overrides: Partial<CodeSessionState> = {}): CodeSessionState {
  return {
    conversationId: 'c-new',
    permissionMode: 'edit',
    planMode: false,
    todos: [],
    jobs: [],
    approvals: [],
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

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });

/** Radix DropdownMenu opens on pointerdown, not click (see other tests). */
function openMenu(trigger: HTMLElement): void {
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetWorkspacesForTests();
  window.matchMedia = matchMediaReturning(false);
  setViewport(1440);
  mocks.listWorkspaces.mockResolvedValue([]);
  mocks.listConversations.mockResolvedValue([]);
  mocks.listArtifacts.mockResolvedValue([]);
  mocks.createConversation.mockResolvedValue(conversation());
  mocks.getCodeSessionState.mockResolvedValue(null);
  mocks.getWorkspace.mockResolvedValue(null);
  mocks.getConversation.mockImplementation(async (id: string) => ({
    conversation: conversation({ id, title: id }),
    messages: [],
  }));
  mocks.setConversationWorkspace.mockImplementation(async (id: string, workspaceId: string | null) =>
    conversation({ id, workspaceId }),
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
    activeWorkspaceId: null,
    openSessionsByWorkspace: {},
    artifactPanelOpen: false,
    artifacts: [],
  });
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: originalInnerWidth,
  });
});

describe('CodeSessionHeader — cabeçalho da sessão', () => {
  it('mostra "Nova sessão" e uma aba ativa quando não há conversa', () => {
    render(<CodeSessionHeader />);

    expect(screen.getByRole('heading', { name: 'Nova sessão' })).toBeTruthy();
    expect(screen.getByText('Sem workspace')).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Sessões abertas' })).toBeTruthy();
    expect(tab('Nova sessão').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Nova sessão' })).toBeTruthy();
  });

  it('mostra o título da conversa ativa e a transforma em aba', async () => {
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', title: 'Corrigir o build' })],
      activeId: 'c-1',
    });

    render(<CodeSessionHeader />);

    expect(screen.getByRole('heading', { name: 'Corrigir o build' })).toBeTruthy();
    await waitFor(() =>
      expect(tab('Corrigir o build').getAttribute('aria-selected')).toBe('true'),
    );
    // Abas apontam para o painel da conversa (contrato com o WorkspaceCenter).
    expect(tab('Corrigir o build').getAttribute('aria-controls')).toBe('code-session-panel');
  });

  it('sincroniza novas abas com a conversa ativa', async () => {
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', title: 'Primeira sessão' })],
      activeId: 'c-1',
    });
    render(<CodeSessionHeader />);

    act(() => {
      useChatStore.setState((state) => ({
        conversations: [
          ...state.conversations,
          conversation({ id: 'c-2', title: 'Segunda sessão' }),
        ],
        activeId: 'c-2',
      }));
    });

    await waitFor(() => expect(tab('Segunda sessão')).toBeTruthy());
    expect(tab('Primeira sessão').getAttribute('aria-selected')).toBe('false');
    expect(tab('Segunda sessão').getAttribute('aria-selected')).toBe('true');
  });

  it('abre outra conversa ao clicar na aba', async () => {
    useChatStore.setState({
      conversations: [
        conversation({ id: 'c-1', title: 'Primeira sessão' }),
        conversation({ id: 'c-2', title: 'Segunda sessão' }),
      ],
      activeId: 'c-1',
    });
    render(<CodeSessionHeader />);

    act(() => {
      useChatStore.setState({ activeId: 'c-2' });
    });
    await waitFor(() => expect(tab('Segunda sessão')).toBeTruthy());

    fireEvent.click(tab('Primeira sessão'));

    await waitFor(() => expect(mocks.getConversation).toHaveBeenCalledWith('c-1'));
    await waitFor(() => expect(useChatStore.getState().activeId).toBe('c-1'));
  });

  it('+ cria uma nova sessão real no namespace Code', async () => {
    render(<CodeSessionHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'Nova sessão' }));

    await waitFor(() => expect(mocks.createConversation).toHaveBeenCalledTimes(1));
    expect(mocks.createConversation.mock.calls[0]?.[3]).toBe('code');
    await waitFor(() => expect(useChatStore.getState().activeId).toBe('c-new'));
    await waitFor(() => expect(tab('Nova conversa').getAttribute('aria-selected')).toBe('true'));
  });
});

describe('CodeSessionHeader — workspace real', () => {
  it('mostra nome, branch e estado sujo do workspace da sessão', async () => {
    mocks.listWorkspaces.mockResolvedValue([workspace()]);
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', title: 'Corrigir o build', workspaceId: 'ws-1' })],
      activeId: 'c-1',
    });

    render(<CodeSessionHeader />);

    const chip = await screen.findByRole('button', {
      name: 'Workspace lumina-core, branch main, alterações não commitadas',
    });
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain('lumina-core');
    expect(chip.textContent).toContain('main');
  });

  it('o menu do workspace atualiza o contexto git e abre no Explorer', async () => {
    mocks.listWorkspaces.mockResolvedValue([workspace()]);
    mocks.getWorkspace.mockResolvedValue({ workspace: workspace() });
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', workspaceId: 'ws-1' })],
      activeId: 'c-1',
    });

    render(<CodeSessionHeader />);
    const chip = await screen.findByRole('button', { name: /Workspace lumina-core/ });
    openMenu(chip);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Atualizar' }));
    await waitFor(() => expect(mocks.getWorkspace).toHaveBeenCalledWith('ws-1'));

    openMenu(chip);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Abrir no Explorer' }));
    await waitFor(() => expect(mocks.openWorkspaceInExplorer).toHaveBeenCalledWith('ws-1'));
  });

  it('permite trocar a sessão de workspace pelo chip', async () => {
    mocks.listWorkspaces.mockResolvedValue([workspace()]);
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', title: 'Sem pasta', workspaceId: null })],
      activeId: 'c-1',
    });

    render(<CodeSessionHeader />);
    const chip = await screen.findByRole('button', { name: /Sem workspace/ });
    openMenu(chip);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'lumina-core' }));

    await waitFor(() =>
      expect(mocks.setConversationWorkspace).toHaveBeenCalledWith('c-1', 'ws-1'),
    );
    expect(useUiStore.getState().activeWorkspaceId).toBe('ws-1');
    expect(useUiStore.getState().openSessionsByWorkspace['ws-1']).toEqual(['c-1']);
  });

  it('sem workspace o chip oferece Abrir pasta… (não é beco sem saída)', async () => {
    mocks.listWorkspaces.mockResolvedValue([]);
    const ws = workspace({ trusted: false });
    mocks.pickWorkspaceFolder.mockResolvedValue('C:/dev/lumina');
    mocks.addWorkspace.mockResolvedValue(ws);
    mocks.listWorkspaces.mockResolvedValueOnce([]).mockResolvedValue([ws]);

    render(<CodeSessionHeader />);
    const chip = await screen.findByRole('button', { name: /Sem workspace/ });
    openMenu(chip);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Abrir pasta…' }));

    await waitFor(() => expect(mocks.pickWorkspaceFolder).toHaveBeenCalledTimes(1));
    // O diálogo de confiança é hospedado pelo cabeçalho.
    const dialog = await screen.findByRole('dialog', { name: 'Confiar nesta pasta?' });
    expect(dialog).toBeTruthy();
  });
});

describe('CodeSessionHeader — confiança da pasta', () => {
  it('“Confiar” aplica trusted + permissão na sessão recém-criada', async () => {
    const ws = workspace({ trusted: false });
    mocks.pickWorkspaceFolder.mockResolvedValue('C:/dev/lumina');
    mocks.addWorkspace.mockResolvedValue(ws);
    mocks.listWorkspaces.mockResolvedValue([ws]);
    mocks.setWorkspaceTrusted.mockResolvedValue({ ...ws, trusted: true });
    mocks.setPermissionMode.mockResolvedValue(sessionState({ permissionMode: 'edit' }));

    render(<CodeSessionHeader />);
    const chip = await screen.findByRole('button', { name: /Sem workspace/ });
    openMenu(chip);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Abrir pasta…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confiar nesta pasta?' });
    expect(dialog).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confiar' }));

    await waitFor(() => expect(mocks.setWorkspaceTrusted).toHaveBeenCalledWith('ws-1', true));
    await waitFor(() =>
      expect(mocks.setPermissionMode).toHaveBeenCalledWith('c-new', 'edit'),
    );
  });
});

describe('CodeSessionHeader — modo de permissão e Plano', () => {
  it('mostra o modo da conversa e permite mudar de forma otimista', async () => {
    mocks.setPermissionMode.mockResolvedValue(sessionState({ permissionMode: 'autonomous' }));
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', permissionMode: 'edit' })],
      activeId: 'c-1',
    });

    render(<CodeSessionHeader />);
    const chip = screen.getByRole('button', { name: 'Modo de permissão: Editar' });
    openMenu(chip);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Autônomo' }));

    // Otimista: o chip muda antes da resposta.
    expect(
      screen.getByRole('button', { name: 'Modo de permissão: Autônomo' }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(mocks.setPermissionMode).toHaveBeenCalledWith('c-1', 'autonomous'),
    );
  });

  it('reverte o modo de permissão quando o backend falha', async () => {
    mocks.setPermissionMode.mockRejectedValue(new Error('negado'));
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', permissionMode: 'edit' })],
      activeId: 'c-1',
    });

    render(<CodeSessionHeader />);
    openMenu(screen.getByRole('button', { name: 'Modo de permissão: Editar' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Autônomo' }));

    await waitFor(() =>
      expect(mocks.setPermissionMode).toHaveBeenCalledWith('c-1', 'autonomous'),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Modo de permissão: Editar' })).toBeTruthy(),
    );
  });

  it('o estado da sessão sincroniza permissão e Plano ao abrir', async () => {
    mocks.getCodeSessionState.mockResolvedValue(
      sessionState({ permissionMode: 'read_only', planMode: true }),
    );
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1' })],
      activeId: 'c-1',
    });

    render(<CodeSessionHeader />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Modo de permissão: Leitura' })).toBeTruthy(),
    );
    const plan = screen.getByRole('button', { name: 'Modo Plano' });
    expect(plan.getAttribute('aria-pressed')).toBe('true');
  });

  it('o chip Plano alterna com atualização otimista', async () => {
    mocks.setPlanMode.mockResolvedValue(sessionState({ planMode: true }));
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1' })],
      activeId: 'c-1',
    });

    render(<CodeSessionHeader />);
    const plan = screen.getByRole('button', { name: 'Modo Plano' });
    expect(plan.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(plan);

    expect(screen.getByRole('button', { name: 'Modo Plano' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await waitFor(() => expect(mocks.setPlanMode).toHaveBeenCalledWith('c-1', true));
  });

  it('não mostra os chips de sessão quando não há conversa ativa', () => {
    render(<CodeSessionHeader />);

    expect(screen.queryByRole('button', { name: /Modo de permissão/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Modo Plano' })).toBeNull();
  });
});

describe('CodeSessionHeader — fechar abas', () => {
  it('fecha uma aba inativa sem trocar a conversa ativa', async () => {
    useChatStore.setState({
      conversations: [
        conversation({ id: 'c-1', title: 'Primeira sessão' }),
        conversation({ id: 'c-2', title: 'Segunda sessão' }),
      ],
      activeId: 'c-1',
    });
    render(<CodeSessionHeader />);
    act(() => {
      useChatStore.setState({ activeId: 'c-2' });
    });
    await waitFor(() => expect(tab('Segunda sessão')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Fechar Primeira sessão' }));

    expect(screen.queryByRole('tab', { name: 'Primeira sessão' })).toBeNull();
    expect(useChatStore.getState().activeId).toBe('c-2');
  });

  it('ao fechar a aba ativa, cai na vizinha', async () => {
    useChatStore.setState({
      conversations: [
        conversation({ id: 'c-1', title: 'Primeira sessão' }),
        conversation({ id: 'c-2', title: 'Segunda sessão' }),
      ],
      activeId: 'c-1',
    });
    render(<CodeSessionHeader />);
    act(() => {
      useChatStore.setState({ activeId: 'c-2' });
    });
    await waitFor(() => expect(tab('Segunda sessão')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Fechar Segunda sessão' }));

    await waitFor(() => expect(mocks.getConversation).toHaveBeenCalledWith('c-1'));
    await waitFor(() => expect(useChatStore.getState().activeId).toBe('c-1'));
    expect(screen.queryByRole('tab', { name: 'Segunda sessão' })).toBeNull();
  });

  it('ao fechar a última aba, volta para o estado "Nova sessão"', async () => {
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', title: 'Única sessão' })],
      activeId: 'c-1',
    });
    render(<CodeSessionHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'Fechar Única sessão' }));

    await waitFor(() => expect(useChatStore.getState().activeId).toBeNull());
    expect(tab('Nova sessão').getAttribute('aria-selected')).toBe('true');
    // A conversa não é apagada do histórico: só deixa de estar ativa.
    expect(useChatStore.getState().conversations).toHaveLength(1);
  });

  it('restaura o foco na aba vizinha ao fechar a aba ativa (teclado)', async () => {
    useChatStore.setState({
      conversations: [
        conversation({ id: 'c-1', title: 'Primeira sessão' }),
        conversation({ id: 'c-2', title: 'Segunda sessão' }),
      ],
      activeId: 'c-1',
    });
    render(<CodeSessionHeader />);
    act(() => {
      useChatStore.setState({ activeId: 'c-2' });
    });
    await waitFor(() => expect(tab('Segunda sessão')).toBeTruthy());

    // The mock backend renames the conversation to its id while loading, so the
    // assertion is on the same DOM node captured before the close.
    const neighbor = tab('Primeira sessão');
    tab('Segunda sessão').focus();
    fireEvent.keyDown(tab('Segunda sessão'), { key: 'Delete' });

    await waitFor(() => expect(document.activeElement).toBe(neighbor));
  });

  it('restaura o foco no botão "+" ao fechar a última aba', async () => {
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', title: 'Única sessão' })],
      activeId: 'c-1',
    });
    render(<CodeSessionHeader />);

    fireEvent.keyDown(tab('Única sessão'), { key: 'Delete' });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nova sessão' })),
    );
  });
});

describe('CodeSessionHeader — teclado e painel', () => {
  async function renderWithThreeTabs(): Promise<void> {
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', title: 'Primeira sessão' })],
      activeId: 'c-1',
    });
    render(<CodeSessionHeader />);
    act(() => {
      useChatStore.setState((state) => ({
        conversations: [
          ...state.conversations,
          conversation({ id: 'c-2', title: 'Segunda sessão' }),
          conversation({ id: 'c-3', title: 'Terceira sessão' }),
        ],
        activeId: 'c-2',
      }));
    });
    await waitFor(() => expect(tab('Segunda sessão')).toBeTruthy());
    act(() => {
      useChatStore.setState({ activeId: 'c-3' });
    });
    await waitFor(() => expect(tab('Terceira sessão')).toBeTruthy());
  }

  it('navega entre as abas com setas e Home/End, ativando com Enter', async () => {
    await renderWithThreeTabs();

    tab('Primeira sessão').focus();
    fireEvent.keyDown(tab('Primeira sessão'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('Segunda sessão'));

    fireEvent.keyDown(tab('Segunda sessão'), { key: 'End' });
    expect(document.activeElement).toBe(tab('Terceira sessão'));

    fireEvent.keyDown(tab('Terceira sessão'), { key: 'Home' });
    expect(document.activeElement).toBe(tab('Primeira sessão'));

    // Ativação manual: a seta só move o foco.
    expect(useChatStore.getState().activeId).toBe('c-3');
    fireEvent.keyDown(tab('Primeira sessão'), { key: 'Enter' });
    await waitFor(() => expect(useChatStore.getState().activeId).toBe('c-1'));
  });

  it('fecha a aba focada com Delete', async () => {
    await renderWithThreeTabs();

    fireEvent.keyDown(tab('Primeira sessão'), { key: 'Delete' });

    expect(screen.queryByRole('tab', { name: 'Primeira sessão' })).toBeNull();
  });

  it('o botão do painel alterna codePanelOpen e expõe aria-pressed', () => {
    render(<CodeSessionHeader />);

    const openButton = screen.getByRole('button', { name: 'Ocultar painel de arquivos' });
    expect(openButton.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(openButton);

    expect(useUiStore.getState().codePanelOpen).toBe(false);
    const closedButton = screen.getByRole('button', { name: 'Mostrar painel de arquivos' });
    expect(closedButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('desabilita o botão do painel e explica a largura mínima abaixo de 1120px', () => {
    setViewport(1000);

    render(<CodeSessionHeader />);

    const button = screen.getByRole('button', { name: 'Ocultar painel de arquivos' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByTitle('Aumente a janela para ver o painel de arquivos')).toBeTruthy();
  });
});

describe('CodeSessionHeader — sessões separadas por layout', () => {
  it('ignora sessões do Chat não compartilhadas nas abas e no título', async () => {
    useChatStore.setState({
      conversations: [
        conversation({ id: 'c-code', title: 'Sessão do Code' }),
        conversation({ id: 'c-chat', title: 'Conversa só do Chat', mode: 'chat' }),
      ],
      activeId: 'c-code',
    });

    render(<CodeSessionHeader />);

    expect(screen.getByRole('heading', { name: 'Sessão do Code' })).toBeTruthy();
    expect(tab('Sessão do Code').getAttribute('aria-selected')).toBe('true');

    // Mesmo que o activeId aponte para uma sessão exclusiva do Chat, ela não
    // vira aba/título no Code.
    act(() => {
      useChatStore.setState({ activeId: 'c-chat' });
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Nova sessão' })).toBeTruthy());
    expect(screen.queryByRole('tab', { name: 'Conversa só do Chat' })).toBeNull();
    expect(tab('Nova sessão').getAttribute('aria-selected')).toBe('true');
  });

  it('inclui a sessão do Chat compartilhada como aba normal', async () => {
    useChatStore.setState({
      conversations: [
        conversation({
          id: 'c-shared',
          title: 'Conversa compartilhada',
          mode: 'chat',
          codeLinked: true,
        }),
      ],
      activeId: 'c-shared',
    });

    render(<CodeSessionHeader />);

    expect(screen.getByRole('heading', { name: 'Conversa compartilhada' })).toBeTruthy();
    await waitFor(() =>
      expect(tab('Conversa compartilhada').getAttribute('aria-selected')).toBe('true'),
    );
  });

  it('mostra a aba de diff aberta como aba central e fecha pelo X', async () => {
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', title: 'Sessão aberta' })],
      activeId: 'c-1',
    });

    render(<CodeSessionHeader />);

    act(() => {
      useUiStore.getState().openCodeDiff({
        workspaceId: 'ws-1',
        path: 'src/app.ts',
        staged: false,
        knownDiff: '@@ -1 +1 @@\n-a\n+b',
      });
    });

    const diffTab = await screen.findByRole('tab', { name: 'Diff de src/app.ts' });
    expect(diffTab.getAttribute('aria-selected')).toBe('true');
    // A aba da sessão deixa de parecer ativa enquanto o diff está aberto.
    expect(tab('Sessão aberta').getAttribute('aria-selected')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Fechar diff de src/app.ts' }));
    expect(useUiStore.getState().codeDiffTab).toBeNull();
    expect(useUiStore.getState().codeView).toBe('session');
    expect(screen.queryByRole('tab', { name: 'Diff de src/app.ts' })).toBeNull();
  });

  it('ao fechar a última aba, limpa a sessão ativa do layout pelo store', async () => {
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', title: 'Única sessão' })],
      activeId: 'c-1',
      activeIdByLayout: { chat: 'c-chat-preservada', code: 'c-1' },
    });
    useUiStore.setState({ artifactPanelOpen: true });

    render(<CodeSessionHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'Fechar Única sessão' }));

    await waitFor(() => expect(useChatStore.getState().activeId).toBeNull());
    // Só a sessão do Code é limpa; a do Chat continua lembrada.
    expect(useChatStore.getState().activeIdByLayout).toEqual({
      chat: 'c-chat-preservada',
      code: null,
    });
    expect(useUiStore.getState().artifactPanelOpen).toBe(false);
    expect(tab('Nova sessão').getAttribute('aria-selected')).toBe('true');
  });
});

describe('CodeSessionHeader — troca de aba com diff aberto', () => {
  it('clicar na aba da sessão ativa volta do diff para a conversa', async () => {
    useChatStore.setState({
      conversations: [conversation({ id: 'c-1', title: 'Primeira sessão' })],
      activeId: 'c-1',
    });

    render(<CodeSessionHeader />);

    act(() => {
      useUiStore.getState().openCodeDiff({
        workspaceId: 'ws-1',
        path: 'src/app.ts',
        staged: false,
        knownDiff: '@@ -1 +1 @@\n-a\n+b',
      });
    });

    expect(await screen.findByRole('tab', { name: 'Diff de src/app.ts' })).toBeTruthy();
    fireEvent.click(tab('Primeira sessão'));

    await waitFor(() => {
      expect(useUiStore.getState().codeView).toBe('session');
    });
    // A aba de diff continua aberta para ser reaberta pelo clique nela.
    expect(useUiStore.getState().codeDiffTab?.path).toBe('src/app.ts');
  });
});
