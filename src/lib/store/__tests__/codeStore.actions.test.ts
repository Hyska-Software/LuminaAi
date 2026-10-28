import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeSessionState } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getCodeSessionState: vi.fn(),
  setPlanMode: vi.fn(),
  setPermissionMode: vi.fn(),
  respondApproval: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

// Imported after the mocks above.
import { toast } from 'sonner';
import { emptyCodeSession, useCodeStore } from '../codeStore';

function sessionState(overrides: Partial<CodeSessionState> = {}): CodeSessionState {
  return {
    conversationId: 'c-1',
    permissionMode: 'edit',
    planMode: false,
    todos: [],
    jobs: [],
    approvals: [],
    ...overrides,
  };
}

function seed(): void {
  useCodeStore.setState({ byConversation: { 'c-1': emptyCodeSession('c-1') } });
}

beforeEach(() => {
  vi.clearAllMocks();
  useCodeStore.setState({ byConversation: {} });
});

describe('codeStore — ações de plano/aprovação (Fase 0)', () => {
  it('setPlanMode é otimista: o chip liga antes do IPC e confirma com o snapshot', async () => {
    seed();
    let resolveSnapshot: (value: CodeSessionState) => void = () => undefined;
    mocks.setPlanMode.mockReturnValue(
      new Promise<CodeSessionState>((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const pending = useCodeStore.getState().setPlanMode('c-1', true);
    // Otimista: estado da UI muda antes da resposta do backend.
    expect(useCodeStore.getState().byConversation['c-1'].planMode).toBe(true);

    resolveSnapshot(sessionState({ planMode: true }));
    await expect(pending).resolves.toBe(true);
    expect(mocks.setPlanMode).toHaveBeenCalledWith('c-1', true);
    expect(useCodeStore.getState().byConversation['c-1'].planMode).toBe(true);
  });

  it('setPlanMode faz rollback e mostra toast quando o backend falha', async () => {
    seed();
    mocks.setPlanMode.mockRejectedValue(new Error('negado'));

    await expect(useCodeStore.getState().setPlanMode('c-1', true)).resolves.toBe(false);

    expect(useCodeStore.getState().byConversation['c-1'].planMode).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      'Não foi possível alterar o modo Plano',
      expect.objectContaining({ description: 'Error: negado' }),
    );
  });

  it('respondApproval encaminha choice/planMarkdown e sincroniza o snapshot do plano', async () => {
    seed();
    mocks.respondApproval.mockResolvedValue(true);
    mocks.getCodeSessionState.mockResolvedValue(
      sessionState({ planMode: false, permissionMode: 'review' }),
    );

    const ok = await useCodeStore.getState().respondApproval('c-1', 'apr-1', 'approved', {
      choice: 'approve_review',
      planMarkdown: '## Plano revisado',
    });

    expect(ok).toBe(true);
    expect(mocks.respondApproval).toHaveBeenCalledWith('apr-1', 'approved', {
      scope: null,
      feedback: null,
      choice: 'approve_review',
      planMarkdown: '## Plano revisado',
    });
    // Decisão de plano muda modo/permissão: snapshot é recarregado.
    expect(mocks.getCodeSessionState).toHaveBeenCalledWith('c-1');
    expect(useCodeStore.getState().byConversation['c-1'].permissionMode).toBe('review');
  });

  it('respondApproval trata aprovação morta (false) com toast + refresh', async () => {
    seed();
    mocks.respondApproval.mockResolvedValue(false);
    mocks.getCodeSessionState.mockResolvedValue(sessionState());

    const ok = await useCodeStore.getState().respondApproval('c-1', 'apr-1', 'denied', {
      feedback: 'ajuste',
    });

    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      'Esta aprovação já não está disponível',
      expect.anything(),
    );
    expect(mocks.getCodeSessionState).toHaveBeenCalledWith('c-1');
  });
});
