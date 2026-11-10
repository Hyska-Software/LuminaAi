import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useChatStore, useCodeStore, useUiStore } from '@/lib/store';
import type { Workspace, WorkspaceContext } from '@/lib/types';
import { createSerialRunner } from '@/lib/utils';

/**
 * Workspaces do layout Code (docs/goals/code-harness/WORKBENCH.md §3–§4/§8).
 *
 * O estado vive num store de módulo (não no `uiStore`, que é contrato do Lead)
 * para que sidebar, cabeçalho e tela de boas-vindas compartilhem UMA lista, um
 * único carregamento e um único diálogo de confiança. O `uiStore` continua sendo
 * a fonte do workspace ativo e das abas por workspace (persistidos).
 *
 * Nada de dado falso: a lista vem de `api.listWorkspaces()`; falhas viram estado
 * de erro honesto e as ações devolvem `null`/`false` sem inventar workspace.
 */

/** Chave usada em `uiStore.openSessionsByWorkspace` para sessões sem workspace. */
export const NO_WORKSPACE_KEY = '__sem_workspace__';

export interface PendingWorkspaceTrust {
  workspace: Workspace;
  /** Sessão criada/vinculada ao abrir a pasta (pode não existir em falha parcial). */
  conversationId: string | null;
}

interface WorkspacesSnapshot {
  workspaces: Workspace[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  pendingTrust: PendingWorkspaceTrust | null;
}

const INITIAL_SNAPSHOT: WorkspacesSnapshot = {
  workspaces: [],
  loading: false,
  loaded: false,
  error: null,
  pendingTrust: null,
};

let snapshot: WorkspacesSnapshot = INITIAL_SNAPSHOT;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();
const runReorder = createSerialRunner();

function emit(patch: Partial<WorkspacesSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): WorkspacesSnapshot {
  return snapshot;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function sortWorkspaces(workspaces: Workspace[]): Workspace[] {
  return [...workspaces].sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned) ||
      (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
      (right.lastOpenedAt ?? right.updatedAt) - (left.lastOpenedAt ?? left.updatedAt) ||
      left.name.localeCompare(right.name),
  );
}

/** Carrega a lista real de workspaces (compartilhado entre os consumidores). */
async function load(force = false): Promise<void> {
  if (!force && snapshot.loaded) return;
  if (loadPromise) return loadPromise;
  emit({ loading: true, error: null });
  loadPromise = (async () => {
    try {
      if (typeof api.listWorkspaces !== 'function') {
        emit({ workspaces: [], loading: false, loaded: true, error: null });
        return;
      }
      const workspaces = await api.listWorkspaces();
      emit({ workspaces: sortWorkspaces(workspaces), loading: false, loaded: true, error: null });
    } catch (error) {
      emit({ loading: false, loaded: true, error: describeError(error) });
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

/** Recarrega a lista ignorando o cache (usada após criar/renomear/remover). */
export async function reloadWorkspaces(): Promise<void> {
  await load(true);
}

/** Persiste a ordem manual dos workspaces (uma seção por vez). */
export async function reorderWorkspaces(ids: string[]): Promise<void> {
  const positions = new Map(ids.map((id, index) => [id, index]));
  if (positions.size === 0) return;
  const previous = snapshot.workspaces;
  emit({
    workspaces: sortWorkspaces(
      snapshot.workspaces.map((workspace) =>
        positions.has(workspace.id)
          ? { ...workspace, sortOrder: positions.get(workspace.id)! }
          : workspace,
      ),
    ),
  });
  try {
    await runReorder(() => api.reorderWorkspaces(ids));
  } catch (error) {
    emit({ workspaces: previous });
    toast.error('Não foi possível reordenar os projetos', { description: describeError(error) });
    await load(true);
  }
}

/** Marca uma conversa como pertencente a um workspace (sem duplicar a sessão). */
async function bindConversation(conversationId: string, workspaceId: string | null): Promise<void> {
  try {
    await api.setConversationWorkspace(conversationId, workspaceId);
    await useChatStore.getState().refreshConversations();
  } catch (error) {
    toast.error('Não foi possível vincular a sessão ao workspace', {
      description: describeError(error),
    });
  }
}

/**
 * Cria uma sessão do Code já vinculada ao workspace (quando informado) e
 * registra a aba no `uiStore`.
 */
export async function startSessionInWorkspace(workspaceId: string | null): Promise<string | null> {
  const conversationId = await useChatStore.getState().startNewConversation('code');
  if (!conversationId) return null;
  if (workspaceId) await bindConversation(conversationId, workspaceId);
  useUiStore.getState().openWorkspaceSession(workspaceId ?? NO_WORKSPACE_KEY, conversationId);
  return conversationId;
}

export interface OpenFolderOptions {
  /**
   * Sessão existente que deve ser vinculada ao workspace aberto. Sem ele, uma
   * nova sessão do Code é criada (fluxo "primeiro uso", WORKBENCH §8.1/§8.2).
   */
  conversationId?: string | null;
}

/**
 * Abre o seletor nativo de pasta, registra o workspace e pergunta a confiança
 * (o diálogo é hospedado pelo `CodeSessionHeader`, sempre montado no Code).
 * Devolve `null` quando o usuário cancela o seletor.
 */
export async function openFolder(options: OpenFolderOptions = {}): Promise<Workspace | null> {
  let path: string | null = null;
  try {
    path = await api.pickWorkspaceFolder();
  } catch (error) {
    toast.error('Não foi possível abrir o seletor de pasta', { description: describeError(error) });
    return null;
  }
  if (!path) return null;

  let workspace: Workspace;
  try {
    workspace = await api.addWorkspace(path, false);
  } catch (error) {
    toast.error('Não foi possível abrir a pasta', { description: describeError(error) });
    return null;
  }

  await load(true);
  useUiStore.getState().setActiveWorkspace(workspace.id);

  let conversationId: string | null = options.conversationId ?? null;
  if (conversationId) {
    await bindConversation(conversationId, workspace.id);
  } else {
    conversationId = await startSessionInWorkspace(workspace.id);
  }

  // Uma pasta já confiada não interrompe o fluxo com a pergunta de segurança.
  if (!workspace.trusted) {
    emit({ pendingTrust: { workspace, conversationId } });
  }
  return workspace;
}

/**
 * Resolve o diálogo de confiança: `true` libera o workspace e **mantém** o modo
 * de permissão da sessão (as novas sessões do Code nascem com o padrão
 * configurado pelo usuário); `false` força Leitura até o usuário confiar depois.
 * A sessão criada ao abrir a pasta acompanha a escolha (contrato
 * `api.setPermissionMode`).
 */
export async function resolvePendingTrust(trusted: boolean): Promise<void> {
  const pending = snapshot.pendingTrust;
  if (!pending) return;
  try {
    await api.setWorkspaceTrusted(pending.workspace.id, trusted);
    if (pending.conversationId) {
      // Confiar não sobrescreve o modo da sessão: antes o fluxo forçava "Editar",
      // o que desfaria o padrão Autônomo configurado nas settings.
      if (!trusted) await api.setPermissionMode(pending.conversationId, 'read_only');
      // Espelha o modo em vigor no snapshot: os chips de permissão/Plano do
      // composer precisam refletir a escolha assim que o diálogo fecha.
      void useCodeStore.getState().refresh(pending.conversationId);
    }
    emit({ pendingTrust: null });
    await Promise.all([load(true), useChatStore.getState().refreshConversations()]);
    toast.success(trusted ? 'Pasta confiada' : 'Pasta aberta em modo leitura', {
      description: trusted
        ? 'O agente pode ler, editar e executar comandos neste workspace.'
        : 'O agente só pode ler arquivos até você confiar na pasta.',
    });
  } catch (error) {
    toast.error('Não foi possível atualizar a confiança da pasta', {
      description: describeError(error),
    });
  }
}

/** Cancela a primeira abertura: desvincula o workspace recém-criado. */
export async function cancelPendingTrust(): Promise<void> {
  const pending = snapshot.pendingTrust;
  emit({ pendingTrust: null });
  if (!pending) return;
  try {
    await api.removeWorkspace(pending.workspace.id);
  } catch (error) {
    toast.error('Não foi possível cancelar a abertura da pasta', {
      description: describeError(error),
    });
  }
  await load(true);
  if (useUiStore.getState().activeWorkspaceId === pending.workspace.id) {
    useUiStore.getState().setActiveWorkspace(snapshot.workspaces[0]?.id ?? null);
  }
  useUiStore.getState().setWorkspaceSessions(pending.workspace.id, []);
}

/** Atualiza a confiança de um workspace já aberto (menu/ações). */
export async function trustWorkspace(workspace: Workspace, trusted: boolean): Promise<void> {
  try {
    await api.setWorkspaceTrusted(workspace.id, trusted);
    await load(true);
  } catch (error) {
    toast.error('Não foi possível atualizar a confiança da pasta', {
      description: describeError(error),
    });
  }
}

/** Renomeia o workspace (o caminho no disco não muda). */
export async function renameWorkspace(workspace: Workspace, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    await api.renameWorkspace(workspace.id, trimmed);
    await load(true);
  } catch (error) {
    toast.error('Não foi possível renomear o workspace', { description: describeError(error) });
  }
}

/**
 * Remove o workspace do Zylara sem apagar a pasta. As sessões continuam no
 * histórico (o backend decide se ficam sem workspace); as abas são limpas.
 */
export async function removeWorkspace(workspace: Workspace): Promise<void> {
  try {
    await api.removeWorkspace(workspace.id);
  } catch (error) {
    toast.error('Não foi possível remover o workspace', { description: describeError(error) });
    return;
  }
  useUiStore.getState().setWorkspaceSessions(workspace.id, []);
  await load(true);
  if (useUiStore.getState().activeWorkspaceId === workspace.id) {
    useUiStore.getState().setActiveWorkspace(snapshot.workspaces[0]?.id ?? null);
  }
  await useChatStore.getState().refreshConversations();
}

/**
 * Reconsulta o contexto do workspace (git/projeto) e atualiza o item da lista.
 * Usada pelo chip "Atualizar" do cabeçalho e pelo painel direito.
 */
export async function refreshWorkspaceContext(id: string): Promise<WorkspaceContext | null> {
  try {
    const context = await api.getWorkspace(id);
    if (context) {
      emit({
        workspaces: snapshot.workspaces.map((workspace) =>
          workspace.id === context.workspace.id ? context.workspace : workspace,
        ),
      });
    }
    return context;
  } catch (error) {
    toast.error('Não foi possível atualizar o workspace', { description: describeError(error) });
    return null;
  }
}

export interface UseWorkspacesResult {
  workspaces: Workspace[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  pendingTrust: PendingWorkspaceTrust | null;
  reload: () => Promise<void>;
  openFolder: (options?: OpenFolderOptions) => Promise<Workspace | null>;
  startSession: (workspaceId: string | null) => Promise<string | null>;
  trust: (workspace: Workspace, trusted: boolean) => Promise<void>;
  rename: (workspace: Workspace, name: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  remove: (workspace: Workspace) => Promise<void>;
  refreshContext: (id: string) => Promise<WorkspaceContext | null>;
  resolveTrust: (trusted: boolean) => Promise<void>;
  cancelTrust: () => Promise<void>;
}

/** Lista compartilhada + ações; carrega uma única vez na primeira montagem. */
export function useWorkspaces(): UseWorkspacesResult {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void load();
  }, []);

  const reload = useCallback(() => reloadWorkspaces(), []);
  const trust = useCallback(
    (workspace: Workspace, trusted: boolean) => trustWorkspace(workspace, trusted),
    [],
  );
  const rename = useCallback(
    (workspace: Workspace, name: string) => renameWorkspace(workspace, name),
    [],
  );
  const remove = useCallback((workspace: Workspace) => removeWorkspace(workspace), []);
  const reorder = useCallback((ids: string[]) => reorderWorkspaces(ids), []);
  const refreshContext = useCallback(
    (id: string) => refreshWorkspaceContext(id),
    [],
  );
  const resolveTrust = useCallback((trusted: boolean) => resolvePendingTrust(trusted), []);
  const cancelTrust = useCallback(() => cancelPendingTrust(), []);

  return {
    workspaces: state.workspaces,
    loading: state.loading,
    loaded: state.loaded,
    error: state.error,
    pendingTrust: state.pendingTrust,
    reload,
    openFolder,
    startSession: startSessionInWorkspace,
    trust,
    rename,
    reorder,
    remove,
    refreshContext,
    resolveTrust,
    cancelTrust,
  };
}

/** Reset do store de módulo entre testes (não usado em produção). */
export function __resetWorkspacesForTests(): void {
  snapshot = INITIAL_SNAPSHOT;
  loadPromise = null;
  for (const listener of listeners) listener();
}
