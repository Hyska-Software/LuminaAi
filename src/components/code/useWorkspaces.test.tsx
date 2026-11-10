// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { Conversation, Workspace, WorkspaceContext } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  pickWorkspaceFolder: vi.fn(),
  addWorkspace: vi.fn(),
  setWorkspaceTrusted: vi.fn(),
  setPermissionMode: vi.fn(),
  getCodeSessionState: vi.fn(),
  removeWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  reorderWorkspaces: vi.fn(),
  getWorkspace: vi.fn(),
  setConversationWorkspace: vi.fn(),
  createConversation: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  listArtifacts: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { toast } from 'sonner';
import { useChatStore, useUiStore } from '@/lib/store';
import {
  __resetWorkspacesForTests,
  openFolder,
  reloadWorkspaces,
  startSessionInWorkspace,
  useWorkspaces,
} from './useWorkspaces';

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'zylara-core',
    path: 'C:/dev/zylara',
    createdAt: 1,
    updatedAt: 2,
    lastOpenedAt: 2,
    trusted: false,
    git: { root: 'C:/dev/zylara', branch: 'feat/code-harness', dirty: true },
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
  mocks.getCodeSessionState.mockResolvedValue(null);
  mocks.setConversationWorkspace.mockImplementation(async (id: string, workspaceId: string | null) =>
    conversation({ id, workspaceId }),
  );
  useChatStore.setState({
    conversations: [],
    conversationsLoading: false,
    activeId: null,
    activeIdByLayout: { chat: null, code: null, agent: null },
    messagesByConversation: {},
  });
  useUiStore.setState({
    layoutMode: 'code',
    activeWorkspaceId: null,
    openSessionsByWorkspace: {},
  });
});

afterEach(() => {
  cleanup();
});

describe('useWorkspaces — carregamento', () => {
  it('carrega a lista real do backend e compartilha uma única requisição', async () => {
    const ws = workspace();
    mocks.listWorkspaces.mockResolvedValue([ws]);

    const first = renderHook(() => useWorkspaces());
    const second = renderHook(() => useWorkspaces());

    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(second.result.current.workspaces).toHaveLength(1);
    expect(first.result.current.workspaces[0]?.id).toBe('ws-1');
    expect(mocks.listWorkspaces).toHaveBeenCalledTimes(1);
  });

  it('expõe erro honesto quando a listagem falha e permite recarregar', async () => {
    mocks.listWorkspaces.mockRejectedValueOnce(new Error('backend offline'));
    const { result } = renderHook(() => useWorkspaces());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('backend offline');
    expect(result.current.workspaces).toEqual([]);

    mocks.listWorkspaces.mockResolvedValue([workspace()]);
    await act(async () => {
      await reloadWorkspaces();
    });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.workspaces).toHaveLength(1);
  });
});

describe('useWorkspaces — abrir pasta e confiança', () => {
  it('abre a pasta, cria a sessão vinculada e deixa a confiança pendente', async () => {
    const ws = workspace();
    mocks.pickWorkspaceFolder.mockResolvedValue('C:/dev/zylara');
    mocks.addWorkspace.mockResolvedValue(ws);
    mocks.listWorkspaces.mockResolvedValue([ws]);

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.openFolder();
    });

    expect(mocks.pickWorkspaceFolder).toHaveBeenCalledTimes(1);
    expect(mocks.addWorkspace).toHaveBeenCalledWith('C:/dev/zylara', false);
    expect(mocks.setConversationWorkspace).toHaveBeenCalledWith('c-new', 'ws-1');
    expect(useUiStore.getState().activeWorkspaceId).toBe('ws-1');
    expect(useUiStore.getState().openSessionsByWorkspace['ws-1']).toEqual(['c-new']);
    await waitFor(() => expect(result.current.pendingTrust?.workspace.id).toBe('ws-1'));
    expect(result.current.pendingTrust?.conversationId).toBe('c-new');
  });

  it('não pergunta a confiança de uma pasta já confiada', async () => {
    const ws = workspace({ trusted: true });
    mocks.pickWorkspaceFolder.mockResolvedValue('C:/dev/zylara');
    mocks.addWorkspace.mockResolvedValue(ws);
    mocks.listWorkspaces.mockResolvedValue([ws]);

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.openFolder();
    });

    expect(result.current.pendingTrust).toBeNull();
  });

  it('com uma sessão existente vincula sem criar outra conversa', async () => {
    const ws = workspace();
    mocks.pickWorkspaceFolder.mockResolvedValue('C:/dev/zylara');
    mocks.addWorkspace.mockResolvedValue(ws);
    mocks.listWorkspaces.mockResolvedValue([ws]);

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await openFolder({ conversationId: 'c-existing' });
    });

    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.setConversationWorkspace).toHaveBeenCalledWith('c-existing', 'ws-1');
    expect(result.current.pendingTrust?.conversationId).toBe('c-existing');
  });

  it('cancelar o seletor de pasta não cria workspace', async () => {
    mocks.pickWorkspaceFolder.mockResolvedValue(null);
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let opened: Workspace | null = workspace();
    await act(async () => {
      opened = await result.current.openFolder();
    });

    expect(opened).toBeNull();
    expect(mocks.addWorkspace).not.toHaveBeenCalled();
  });

  it('confiar libera o workspace e mantém o modo de permissão padrão da sessão', async () => {
    const ws = workspace();
    mocks.pickWorkspaceFolder.mockResolvedValue('C:/dev/zylara');
    mocks.addWorkspace.mockResolvedValue(ws);
    mocks.listWorkspaces.mockResolvedValue([ws]);

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      await result.current.openFolder();
    });

    mocks.setWorkspaceTrusted.mockResolvedValue({ ...ws, trusted: true });

    await act(async () => {
      await result.current.resolveTrust(true);
    });

    expect(mocks.setWorkspaceTrusted).toHaveBeenCalledWith('ws-1', true);
    // Confiar não força "Editar": a sessão mantém o padrão configurado nas
    // settings (Autônomo de fábrica) e a escolha por sessão do chip.
    expect(mocks.setPermissionMode).not.toHaveBeenCalled();
    // O snapshot do codeStore é recarregado: os chips de permissão/Plano do
    // composer refletem o modo em vigor assim que o diálogo fecha.
    expect(mocks.getCodeSessionState).toHaveBeenCalledWith('c-new');
    await waitFor(() => expect(result.current.pendingTrust).toBeNull());
  });

  it('abrir em leitura força Leitura na sessão e mantém o workspace sem confiança', async () => {
    const ws = workspace();
    mocks.pickWorkspaceFolder.mockResolvedValue('C:/dev/zylara');
    mocks.addWorkspace.mockResolvedValue(ws);
    mocks.listWorkspaces.mockResolvedValue([ws]);

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      await result.current.openFolder();
    });

    mocks.setWorkspaceTrusted.mockResolvedValue({ ...ws, trusted: false });
    mocks.setPermissionMode.mockResolvedValue({
      conversationId: 'c-new',
      permissionMode: 'read_only',
      planMode: false,
      todos: [],
      jobs: [],
      approvals: [],
    });

    await act(async () => {
      await result.current.resolveTrust(false);
    });

    expect(mocks.setWorkspaceTrusted).toHaveBeenCalledWith('ws-1', false);
    expect(mocks.setPermissionMode).toHaveBeenCalledWith('c-new', 'read_only');
    expect(mocks.getCodeSessionState).toHaveBeenCalledWith('c-new');
    await waitFor(() => expect(result.current.pendingTrust).toBeNull());
  });

  it('cancelar a confiança remove o workspace recém-criado da lista', async () => {
    const ws = workspace();
    mocks.pickWorkspaceFolder.mockResolvedValue('C:/dev/zylara');
    mocks.addWorkspace.mockResolvedValue(ws);
    mocks.listWorkspaces.mockResolvedValueOnce([ws]).mockResolvedValue([]);
    mocks.removeWorkspace.mockResolvedValue(undefined);

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      await result.current.openFolder();
    });

    await act(async () => {
      await result.current.cancelTrust();
    });

    expect(mocks.removeWorkspace).toHaveBeenCalledWith('ws-1');
    expect(useUiStore.getState().activeWorkspaceId).toBeNull();
    await waitFor(() => expect(result.current.workspaces).toEqual([]));
  });
});

describe('useWorkspaces — ações do menu', () => {
  it('renomeia e recarrega a lista', async () => {
    const ws = workspace();
    mocks.listWorkspaces.mockResolvedValue([ws]);
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    mocks.renameWorkspace.mockResolvedValue({ ...ws, name: 'core' });
    mocks.listWorkspaces.mockResolvedValue([{ ...ws, name: 'core' }]);

    await act(async () => {
      await result.current.rename(ws, 'core');
    });

    expect(mocks.renameWorkspace).toHaveBeenCalledWith('ws-1', 'core');
    await waitFor(() => expect(result.current.workspaces[0]?.name).toBe('core'));
  });

  it('remove sem apagar a pasta, limpa as abas e troca o workspace ativo', async () => {
    const ws = workspace();
    const other = workspace({ id: 'ws-2', name: 'site', path: 'C:/dev/site' });
    mocks.listWorkspaces.mockResolvedValue([ws, other]);
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    useUiStore.setState({
      activeWorkspaceId: 'ws-1',
      openSessionsByWorkspace: { 'ws-1': ['c-1'] },
    });
    mocks.removeWorkspace.mockResolvedValue(undefined);
    mocks.listWorkspaces.mockResolvedValue([other]);

    await act(async () => {
      await result.current.remove(ws);
    });

    expect(mocks.removeWorkspace).toHaveBeenCalledWith('ws-1');
    expect(useUiStore.getState().activeWorkspaceId).toBe('ws-2');
    await waitFor(() => expect(result.current.workspaces).toHaveLength(1));
  });

  it('reordena e persiste; em erro volta à ordem anterior', async () => {
    const first = workspace({ id: 'ws-1', name: 'a', lastOpenedAt: 20, sortOrder: 0 });
    const second = workspace({
      id: 'ws-2',
      name: 'b',
      path: 'C:/dev/b',
      lastOpenedAt: 10,
      sortOrder: 1,
    });
    mocks.listWorkspaces.mockResolvedValue([first, second]);
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    mocks.reorderWorkspaces.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.reorder(['ws-2', 'ws-1']);
    });
    expect(mocks.reorderWorkspaces).toHaveBeenCalledWith(['ws-2', 'ws-1']);
    expect(result.current.workspaces.map((item) => item.id)).toEqual(['ws-2', 'ws-1']);

    mocks.reorderWorkspaces.mockRejectedValue(new Error('falhou'));
    mocks.listWorkspaces.mockResolvedValue([first, second]);
    await act(async () => {
      await result.current.reorder(['ws-1', 'ws-2']);
    });
    expect(toast.error).toHaveBeenCalled();
    expect(result.current.workspaces.map((item) => item.id)).toEqual(['ws-1', 'ws-2']);
  });

  it('atualiza o contexto git do workspace', async () => {
    const ws = workspace();
    mocks.listWorkspaces.mockResolvedValue([ws]);
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const context: WorkspaceContext = {
      workspace: { ...ws, git: { root: 'C:/dev/zylara', branch: 'main', dirty: false } },
      project: { kind: 'node', name: 'zylara', checks: [] },
    };
    mocks.getWorkspace.mockResolvedValue(context);

    await act(async () => {
      await result.current.refreshContext('ws-1');
    });

    expect(result.current.workspaces[0]?.git?.branch).toBe('main');
    expect(result.current.workspaces[0]?.git?.dirty).toBe(false);
  });
});

describe('useWorkspaces — sessão em workspace', () => {
  it('startSession cria a conversa, vincula e registra a aba', async () => {
    useChatStore.setState({ conversations: [] });
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let id: string | null = null;
    await act(async () => {
      id = await startSessionInWorkspace('ws-1');
    });

    expect(id).toBe('c-new');
    expect(mocks.createConversation).toHaveBeenCalledTimes(1);
    expect(mocks.setConversationWorkspace).toHaveBeenCalledWith('c-new', 'ws-1');
    expect(useUiStore.getState().openSessionsByWorkspace['ws-1']).toEqual(['c-new']);
  });
});
