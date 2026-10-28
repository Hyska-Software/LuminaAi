// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation, ProviderInfo } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  searchWorkspaceFiles: vi.fn(),
  compactSession: vi.fn(),
  setPlanMode: vi.fn(),
  setPermissionMode: vi.fn(),
  createConversation: vi.fn(),
  listConversations: vi.fn(),
  listArtifacts: vi.fn(),
  openExternalUrl: vi.fn(async () => true),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('@/components/chat/external', () => ({ openExternalUrl: mocks.openExternalUrl }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));
vi.mock('@/components/models/ModelPill', () => ({
  ModelPill: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      Modelo
    </button>
  ),
}));

// Imported after the mocks above.
import { toast } from 'sonner';
import { emptyCodeSession, useAppStore, useChatStore, useCodeStore, useUiStore } from '@/lib/store';
import { Composer } from './Composer';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c-1',
    title: 'Corrigir o build',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    providerId: 'deepseek',
    modelId: 'deepseek-v4.1-flash',
    messageCount: 0,
    preview: null,
    mode: 'code',
    workspaceId: 'ws-1',
    ...overrides,
  };
}

const FILES = ['src/app.ts', 'src/lib/api.ts', 'src/main.tsx'];

function providerFixture(): ProviderInfo {
  return {
    id: 'deepseek',
    name: 'DeepSeek',
    shortName: 'DeepSeek',
    description: '',
    baseUrl: 'https://api.deepseek.com',
    consoleUrl: '',
    endpoints: { 'openai-chat': '/chat/completions', models: '/models' },
    authEnv: 'DEEPSEEK_API_KEY',
    defaultModelId: 'deepseek-v4.1-flash',
    auth: 'api-key',
    requestProfiles: { apiKey: 'standard' },
    models: [],
    notes: [],
  };
}

const textarea = (): HTMLTextAreaElement =>
  screen.getByRole('textbox', { name: 'Tarefa para o agente' }) as HTMLTextAreaElement;

function typeInComposer(value: string): void {
  fireEvent.change(textarea(), { target: { value } });
}

function openMentionMenu(): void {
  typeInComposer('@');
}

const codePanelTab = () => useUiStore.getState().codePanelTab;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchWorkspaceFiles.mockResolvedValue(FILES);
  mocks.compactSession.mockRejectedValue(new Error('Compactação ainda não disponível'));
  mocks.setPlanMode.mockResolvedValue({
    conversationId: 'c-1',
    permissionMode: 'edit',
    planMode: false,
    todos: [],
    jobs: [],
    approvals: [],
  });
  mocks.setPermissionMode.mockResolvedValue({
    conversationId: 'c-1',
    permissionMode: 'edit',
    planMode: false,
    todos: [],
    jobs: [],
    approvals: [],
  });
  mocks.createConversation.mockResolvedValue(conversation({ id: 'c-new' }));
  useAppStore.setState({
    providers: [providerFixture()],
    auth: [],
    keys: [{ providerId: 'deepseek', hasKey: true, source: 'settings', mode: 'api-key' }],
    selection: {
      providerId: 'deepseek',
      modelId: 'deepseek-v4.1-flash',
      reasoning: null,
    },
  });
  useChatStore.setState({
    conversations: [conversation()],
    activeId: 'c-1',
    streaming: null,
    pendingAttachments: [],
    error: null,
    errorCode: null,
    errorHint: null,
  });
  useCodeStore.setState({ byConversation: {} });
  useUiStore.setState({
    layoutMode: 'code',
    activeWorkspaceId: 'ws-1',
    codePanelTab: 'files',
    codePanelOpen: false,
    settingsOpen: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Composer — placeholder e atalho no modo Code', () => {
  it('com workspace usa a copy que ensina @ e /', () => {
    render(<Composer />);

    expect(textarea().getAttribute('placeholder')).toBe(
      'Descreva a tarefa… @ para arquivos, / para comandos',
    );
  });

  it('sem workspace mantém a copy anterior', () => {
    useUiStore.setState({ activeWorkspaceId: null });
    useChatStore.setState({ conversations: [conversation({ workspaceId: null })], activeId: 'c-1' });
    render(<Composer />);

    expect(textarea().getAttribute('placeholder')).toBe('Descreva a tarefa para o agente…');
  });

  it('Ctrl/Cmd+L foca o composer no modo Code', () => {
    render(<Composer />);

    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });

    expect(document.activeElement).toBe(textarea());
  });
});

describe('Composer — controles de sessão no layout Code', () => {
  it('troca os pills de ferramentas pelos controles de permissão, Plano e Plano/tarefas', () => {
    render(<Composer />);

    expect(screen.getByRole('button', { name: 'Modo de permissão: Editar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Modo Plano/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plano, tarefas e trabalhos em segundo plano' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Busca web' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Criar arquivos' })).toBeNull();
  });

  it('reflete o snapshot da sessão carregado no codeStore', () => {
    useCodeStore.setState({
      byConversation: {
        'c-1': { ...emptyCodeSession('c-1'), permissionMode: 'read_only', planMode: true },
      },
    });
    render(<Composer />);

    expect(screen.getByRole('button', { name: 'Modo de permissão: Leitura' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Modo Plano: ativado' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('Composer — menção @arquivo', () => {
  it('abre o listbox ao digitar @ e busca os arquivos do workspace', async () => {
    render(<Composer />);

    openMentionMenu();

    expect(await screen.findByRole('listbox', { name: 'Arquivos do workspace' })).toBeTruthy();
    await waitFor(() =>
      expect(mocks.searchWorkspaceFiles).toHaveBeenCalledWith('ws-1', '', 20),
    );
    expect(await screen.findByRole('option', { name: 'src/app.ts' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'src/main.tsx' })).toBeTruthy();
  });

  it('filtra com o termo digitado depois do @ (debounce)', async () => {
    render(<Composer />);

    typeInComposer('@api');

    await waitFor(() =>
      expect(mocks.searchWorkspaceFiles).toHaveBeenCalledWith('ws-1', 'api', 20),
    );
  });

  it('navega com setas e insere chip com Enter, enviando [arquivo: path]', async () => {
    const send = vi.spyOn(useChatStore.getState(), 'send').mockResolvedValue(undefined);
    render(<Composer />);

    openMentionMenu();
    await screen.findByRole('option', { name: 'src/app.ts' });

    fireEvent.keyDown(textarea(), { key: 'ArrowDown' });
    fireEvent.keyDown(textarea(), { key: 'Enter' });

    expect(
      await screen.findByRole('button', { name: 'Remover menção a src/lib/api.ts' }),
    ).toBeTruthy();
    expect(textarea().value).toBe('');

    typeInComposer('Corrigir o build');
    fireEvent.keyDown(textarea(), { key: 'Enter' });

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[0]).toBe('Corrigir o build\n\n[arquivo: src/lib/api.ts]');
    expect(screen.queryByRole('button', { name: /Remover menção/ })).toBeNull();
  });

  it('Tab também seleciona a opção ativa', async () => {
    render(<Composer />);

    openMentionMenu();
    await screen.findByRole('option', { name: 'src/app.ts' });
    fireEvent.keyDown(textarea(), { key: 'Tab' });

    expect(
      await screen.findByRole('button', { name: 'Remover menção a src/app.ts' }),
    ).toBeTruthy();
  });

  it('Esc fecha o menu sem inserir chip', async () => {
    render(<Composer />);

    openMentionMenu();
    await screen.findByRole('listbox', { name: 'Arquivos do workspace' });
    fireEvent.keyDown(textarea(), { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('listbox', { name: 'Arquivos do workspace' })).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: /Remover menção/ })).toBeNull();
  });

  it('Backspace com o textarea vazio remove o último chip; o X também remove', async () => {
    render(<Composer />);

    openMentionMenu();
    await screen.findByRole('option', { name: 'src/app.ts' });
    fireEvent.keyDown(textarea(), { key: 'Tab' });
    await screen.findByRole('button', { name: 'Remover menção a src/app.ts' });

    fireEvent.keyDown(textarea(), { key: 'Backspace' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Remover menção/ })).toBeNull(),
    );

    openMentionMenu();
    await screen.findByRole('option', { name: 'src/main.tsx' });
    fireEvent.keyDown(textarea(), { key: 'ArrowDown' });
    fireEvent.keyDown(textarea(), { key: 'Tab' });
    fireEvent.click(await screen.findByRole('button', { name: 'Remover menção a src/lib/api.ts' }));

    expect(screen.queryByRole('button', { name: /Remover menção/ })).toBeNull();
  });

  it('não abre menção no Chat nem no Code sem workspace', async () => {
    useUiStore.setState({ layoutMode: 'chat' });
    const { unmount } = render(<Composer />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem para o Lumina' }), {
      target: { value: '@' },
    });
    await waitFor(() => expect(mocks.searchWorkspaceFiles).not.toHaveBeenCalled());
    expect(screen.queryByRole('listbox')).toBeNull();
    unmount();

    useUiStore.setState({ layoutMode: 'code', activeWorkspaceId: null });
    useChatStore.setState({ conversations: [conversation({ workspaceId: null })], activeId: 'c-1' });
    render(<Composer />);
    typeInComposer('@');
    await waitFor(() => expect(mocks.searchWorkspaceFiles).not.toHaveBeenCalled());
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Composer — comandos /', () => {
  it('abre o catálogo ao digitar / e filtra pelo texto', async () => {
    render(<Composer />);

    typeInComposer('/');

    expect(await screen.findByRole('listbox', { name: 'Comandos do modo Code' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /\/compact/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /\/commit/ })).toBeTruthy();

    typeInComposer('/compa');

    await waitFor(() => expect(screen.getByRole('option', { name: /\/compact/ })).toBeTruthy());
    expect(screen.queryByRole('option', { name: /\/commit/ })).toBeNull();
  });

  it('/compact chama a API e mostra erro honesto quando ainda não disponível', async () => {
    render(<Composer />);

    typeInComposer('/compact');
    await screen.findByRole('option', { name: /\/compact/ });
    fireEvent.keyDown(textarea(), { key: 'Enter' });

    await waitFor(() => expect(mocks.compactSession).toHaveBeenCalledWith('c-1'));
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'Compactação ainda não disponível',
        expect.objectContaining({ description: expect.stringContaining('Compactação') }),
      ),
    );
  });

  it('/commit abre o painel Alterações', async () => {
    render(<Composer />);

    typeInComposer('/commit');
    await screen.findByRole('option', { name: /\/commit/ });
    fireEvent.keyDown(textarea(), { key: 'Enter' });

    await waitFor(() => expect(codePanelTab()).toBe('changes'));
    expect(useUiStore.getState().codePanelOpen).toBe(true);
  });

  it('/limpar limpa o texto e as menções', async () => {
    render(<Composer />);

    openMentionMenu();
    await screen.findByRole('option', { name: 'src/app.ts' });
    fireEvent.keyDown(textarea(), { key: 'Tab' });
    await screen.findByRole('button', { name: /Remover menção a src\/app.ts/ });
    typeInComposer('/limpar');

    fireEvent.keyDown(textarea(), { key: 'Enter' });

    await waitFor(() => expect(textarea().value).toBe(''));
    expect(screen.queryByRole('button', { name: /Remover menção/ })).toBeNull();
  });

  it('comandos de preenchimento (/review) colocam o prompt no composer sem enviar', async () => {
    const send = vi.spyOn(useChatStore.getState(), 'send').mockResolvedValue(undefined);
    render(<Composer />);

    typeInComposer('/review');
    await screen.findByRole('option', { name: /\/review/ });
    fireEvent.keyDown(textarea(), { key: 'Enter' });

    await waitFor(() => expect(textarea().value).toContain('Revise as alterações atuais'));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('/plan ativa o modo Plano no codeStore e mantém o texto de instrução', async () => {
    mocks.setPlanMode.mockResolvedValue({
      conversationId: 'c-1',
      permissionMode: 'edit',
      planMode: true,
      todos: [],
      jobs: [],
      approvals: [],
    });
    render(<Composer />);

    typeInComposer('/plan');
    fireEvent.keyDown(textarea(), { key: 'Enter' });

    await waitFor(() => expect(mocks.setPlanMode).toHaveBeenCalledWith('c-1', true));
    expect(textarea().value).toContain('Planeje a solução para esta tarefa');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Modo Plano: ativado' }).getAttribute('aria-pressed'),
      ).toBe('true'),
    );
  });

  it('/plan não chama o backend quando o modo já está ativo', async () => {
    useCodeStore.setState({
      byConversation: { 'c-1': { ...emptyCodeSession('c-1'), planMode: true } },
    });
    render(<Composer />);

    typeInComposer('/plan');
    fireEvent.keyDown(textarea(), { key: 'Enter' });

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Modo Plano já está ativo'));
    expect(mocks.setPlanMode).not.toHaveBeenCalled();
  });

  it('/plan off desativa o modo Plano pelo store (chip sincroniza)', async () => {
    useCodeStore.setState({
      byConversation: { 'c-1': { ...emptyCodeSession('c-1'), planMode: true } },
    });
    render(<Composer />);

    // O catálogo completo abre com `/`; escolhe a opção pelo clique (o espaço
    // fecha o filtro, então o comando é selecionado na lista inicial).
    typeInComposer('/');
    await screen.findByRole('option', { name: /\/plan off/ });
    fireEvent.click(screen.getByRole('option', { name: /\/plan off/ }));

    await waitFor(() => expect(mocks.setPlanMode).toHaveBeenCalledWith('c-1', false));
    await waitFor(() => expect(useCodeStore.getState().byConversation['c-1']?.planMode).toBe(false));
    expect(
      screen.getByRole('button', { name: 'Modo Plano: desativado' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('não abre slash no Chat', async () => {
    useUiStore.setState({ layoutMode: 'chat' });
    render(<Composer />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem para o Lumina' }), {
      target: { value: '/' },
    });

    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
