// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApprovalRequest, CodeSessionState } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  respondApproval: vi.fn(),
  respondQuestion: vi.fn(),
  getCodeSessionState: vi.fn(),
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
import { emptyCodeSession, useCodeStore } from '@/lib/store';
import { CodeSessionCards } from './CodeAgentWidgets';

function planApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'apr-plan',
    toolCallId: 'call-plan',
    tool: 'submit_plan',
    title: 'Aprovar plano?',
    detail: { kind: 'other', text: 'Resumo do plano' },
    risk: 'ask',
    preview: '## Plano\n\n1. Criar módulo',
    options: [],
    createdAt: 1,
    ...overrides,
  };
}

function commandApproval(): ApprovalRequest {
  return {
    id: 'apr-cmd',
    toolCallId: 'call-cmd',
    tool: 'run_command',
    title: 'Executar comando?',
    detail: { kind: 'command', command: 'pnpm test', workdir: '.' },
    risk: 'shell',
    options: [{ id: 'allow', label: 'Permitir' }],
    createdAt: 2,
  };
}

function snapshot(overrides: Partial<CodeSessionState> = {}): CodeSessionState {
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

function seed(approvals: ApprovalRequest[], todos: { content: string; status: 'pending' | 'in_progress' | 'completed' }[] = []): void {
  useCodeStore.setState({
    byConversation: {
      'c-1': {
        ...emptyCodeSession('c-1'),
        approvals,
        todos,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useCodeStore.setState({ byConversation: {} });
  mocks.respondApproval.mockResolvedValue(true);
  mocks.getCodeSessionState.mockResolvedValue(snapshot());
  mocks.respondQuestion.mockResolvedValue(true);
});

afterEach(cleanup);

describe('CodeSessionCards — gate do plano', () => {
  it('renderiza o gate interativo com o markdown do preview', () => {
    seed([planApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);

    expect(screen.getByRole('alertdialog', { name: 'Plano proposto' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aprovar e executar' })).toBeTruthy();
    expect(screen.getByText('Criar módulo')).toBeTruthy();
  });

  it('"Aprovar e executar" envia choice=approve_run', async () => {
    seed([planApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar e executar' }));

    await waitFor(() =>
      expect(mocks.respondApproval).toHaveBeenCalledWith('apr-plan', 'approved', {
        scope: null,
        feedback: null,
        choice: 'approve_run',
        planMarkdown: null,
      }),
    );
    // Decisão de plano sincroniza o snapshot autoritativo.
    await waitFor(() => expect(mocks.getCodeSessionState).toHaveBeenCalledWith('c-1'));
  });

  it('"Aprovar e revisar cada edição" envia choice=approve_review', async () => {
    seed([planApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar e revisar cada edição' }));

    await waitFor(() =>
      expect(mocks.respondApproval).toHaveBeenCalledWith(
        'apr-plan',
        'approved',
        expect.objectContaining({ choice: 'approve_review' }),
      ),
    );
  });

  it('aprova com o plano editado antes de aprovar (planMarkdown)', async () => {
    seed([planApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);

    fireEvent.click(screen.getByRole('button', { name: /Editar plano antes de aprovar/ }));
    fireEvent.change(
      screen.getByLabelText('Plano revisado (será o plano aprovado e persistido)'),
      { target: { value: '## Plano revisado\n\nPasso 1' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar com este plano' }));

    await waitFor(() =>
      expect(mocks.respondApproval).toHaveBeenCalledWith(
        'apr-plan',
        'approved',
        expect.objectContaining({ planMarkdown: '## Plano revisado\n\nPasso 1' }),
      ),
    );
  });

  it('"Continuar planejando" nega com feedback (default quando vazio)', async () => {
    seed([planApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Continuar planejando' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar feedback' }));

    await waitFor(() =>
      expect(mocks.respondApproval).toHaveBeenCalledWith(
        'apr-plan',
        'denied',
        expect.objectContaining({ feedback: 'Continue planejando.' }),
      ),
    );
  });

  it('duplo clique decide uma única vez', async () => {
    seed([planApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);

    const button = screen.getByRole('button', { name: 'Aprovar e executar' });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(mocks.respondApproval).toHaveBeenCalledTimes(1));
  });

  it('decisão já resolvida: store refresca e avisa (não fica card fantasma)', async () => {
    seed([planApproval()]);
    mocks.respondApproval.mockResolvedValue(false);
    render(<CodeSessionCards conversationId="c-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar e executar' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Esta aprovação já não está disponível',
        expect.objectContaining({ description: expect.stringContaining('Atualizando') }),
      ),
    );
    expect(mocks.getCodeSessionState).toHaveBeenCalledWith('c-1');
  });
});

describe('CodeSessionCards — acessibilidade e tarefas', () => {
  it('anuncia o gate em uma região aria-live curta (não envolve os cards)', () => {
    seed([planApproval()]);
    const { container } = render(<CodeSessionCards conversationId="c-1" />);

    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('Plano aguardando aprovação.');
    // O card interativo não fica dentro da live region.
    expect(live?.querySelector('button')).toBeNull();
  });

  it('não renderiza mais o TodoCard fixo no fim do transcript (dedupe F-08)', () => {
    seed([], [{ content: 'Rodar testes', status: 'in_progress' }]);
    const { container } = render(<CodeSessionCards conversationId="c-1" />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tarefas do agente' })).toBeNull();
  });

  it('mantém os cards de aprovação de outras tools', () => {
    seed([commandApproval()]);
    render(<CodeSessionCards conversationId="c-1" />);
    expect(screen.getByRole('alertdialog', { name: 'Executar comando?' })).toBeTruthy();
  });
});
