// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation, Workspace } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  pickWorkspaceFolder: vi.fn(),
  addWorkspace: vi.fn(),
  setWorkspaceTrusted: vi.fn(),
  setPermissionMode: vi.fn(),
  removeWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  getWorkspace: vi.fn(),
  setConversationWorkspace: vi.fn(),
  createConversation: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  listArtifacts: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));

import { useChatStore, useUiStore } from '@/lib/store';
import { __resetWorkspacesForTests } from './useWorkspaces';
import { CodeWelcomeScreen } from './CodeWelcomeScreen';

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
    providerId: 'deepseek',
    modelId: 'deepseek-v4.1-flash',
    messageCount: 0,
    preview: null,
    mode: 'code',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetWorkspacesForTests();
  mocks.listWorkspaces.mockResolvedValue([]);
  mocks.listConversations.mockResolvedValue([]);
  mocks.listArtifacts.mockResolvedValue([]);
  mocks.createConversation.mockResolvedValue(conversation());
  mocks.pickWorkspaceFolder.mockResolvedValue('C:/dev/lumina');
  mocks.addWorkspace.mockResolvedValue(workspace());
  mocks.setConversationWorkspace.mockImplementation(async (id: string, workspaceId: string | null) =>
    conversation({ id, workspaceId }),
  );
  useChatStore.setState({
    conversations: [],
    conversationsLoading: false,
    activeId: null,
    activeIdByLayout: { chat: null, code: null },
  });
  useUiStore.setState({ layoutMode: 'code', activeWorkspaceId: null });
});

afterEach(() => {
  cleanup();
});

describe('CodeWelcomeScreen — sem workspace', () => {
  it('convida a abrir uma pasta e explica o que o agente poderá fazer', async () => {
    render(<CodeWelcomeScreen />);

    expect(screen.getByRole('heading', { level: 1, name: 'Comece com uma pasta' })).toBeTruthy();
    expect(
      await screen.findByText('Abra uma pasta para o agente ler, editar e rodar comandos aqui.'),
    ).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Abrir pasta/ })).toBeTruthy();

    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalled());
  });

  it('o botão Abrir pasta dispara o seletor nativo e registra a sessão', async () => {
    render(<CodeWelcomeScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /Abrir pasta/ }));

    await waitFor(() => expect(mocks.pickWorkspaceFolder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.addWorkspace).toHaveBeenCalledWith('C:/dev/lumina', false));
    await waitFor(() => expect(useUiStore.getState().activeWorkspaceId).toBe('ws-1'));
  });

  it('lista workspaces recentes e reabre um deles sem criar sessão', async () => {
    const ws = workspace();
    mocks.listWorkspaces.mockResolvedValue([ws]);
    render(<CodeWelcomeScreen />);

    const recent = await screen.findByRole('button', { name: /lumina-core/ });
    const before = mocks.createConversation.mock.calls.length;
    fireEvent.click(recent);

    expect(useUiStore.getState().activeWorkspaceId).toBe('ws-1');
    expect(mocks.createConversation.mock.calls.length).toBe(before);
  });

  it('mostra erro honesto quando os workspaces não carregam', async () => {
    mocks.listWorkspaces.mockRejectedValue(new Error('backend offline'));
    render(<CodeWelcomeScreen />);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar'),
    );
  });
});

describe('CodeWelcomeScreen — com workspace ativo', () => {
  beforeEach(() => {
    mocks.listWorkspaces.mockResolvedValue([workspace()]);
    useUiStore.setState({ activeWorkspaceId: 'ws-1' });
  });

  it('mostra o caminho/branch do workspace e as sugestões de tarefa', async () => {
    render(<CodeWelcomeScreen />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Comece uma sessão do agente' }),
    ).toBeTruthy();
    expect(screen.getByText('lumina-core')).toBeTruthy();
    expect(screen.getAllByText('C:/dev/lumina').length).toBeGreaterThan(0);
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.getByText('Alterações não commitadas')).toBeTruthy();

    for (const name of ['Explique o código', 'Encontre um bug', 'Escreva testes']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
  });

  it('as sugestões preenchem o composer sem enviar nada', async () => {
    const suggestions: string[] = [];
    const listener = (event: Event) => {
      suggestions.push((event as CustomEvent<string>).detail);
    };
    window.addEventListener('lumina:suggest', listener);
    render(<CodeWelcomeScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /Escreva testes/ }));

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toContain('casos de borda');
    window.removeEventListener('lumina:suggest', listener);
  });
});
