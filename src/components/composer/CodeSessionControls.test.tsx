// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CodeSessionState, Conversation, JobView, PermissionMode } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  setPermissionMode: vi.fn(),
  setPlanMode: vi.fn(),
  killJob: vi.fn(),
  listJobs: vi.fn(),
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
import { emptyCodeSession, useChatStore, useCodeStore, useUiStore, type CodeSessionUi } from '@/lib/store';
import { CodeSessionControls } from './CodeSessionControls';

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

function job(overrides: Partial<JobView> = {}): JobView {
  return {
    id: 'job-1',
    command: 'pnpm dev',
    status: 'running',
    startedAt: 1,
    durationMs: 1_200,
    ...overrides,
  };
}

/** Linha da conversa (fallback enquanto o snapshot da sessão não chegou). */
function seedConversation(permissionMode?: PermissionMode): void {
  useChatStore.setState({
    conversations: [conversation(permissionMode ? { permissionMode } : {})],
    activeId: 'c-1',
  });
}

/** Snapshot do `codeStore` (carregado pelo `chatStore` ao abrir a sessão). */
function seedSession(overrides: Partial<CodeSessionUi> = {}): void {
  useCodeStore.setState({
    byConversation: { 'c-1': { ...emptyCodeSession('c-1'), ...overrides } },
  });
}

const permissionTrigger = (): HTMLElement =>
  screen.getByRole('button', { name: /^Modo de permissão:/ });

const planToggle = (): HTMLElement => screen.getByRole('button', { name: /^Modo Plano/ });

const planTasksTrigger = (): HTMLElement =>
  screen.getByRole('button', { name: 'Plano, tarefas e trabalhos em segundo plano' });

/** Radix DropdownMenu abre com pointerdown, não click (ver outros testes). */
function openPermissionMenu(): void {
  fireEvent.pointerDown(permissionTrigger(), { button: 0, pointerType: 'mouse' });
}

beforeEach(() => {
  vi.clearAllMocks();
  useCodeStore.setState({ byConversation: {} });
  useChatStore.setState({ conversations: [], activeId: null });
  useUiStore.setState({ codeView: 'session', codePlanTab: null });
  mocks.setPermissionMode.mockResolvedValue(sessionState({ permissionMode: 'autonomous' }));
  mocks.setPlanMode.mockResolvedValue(sessionState({ planMode: true }));
  mocks.killJob.mockResolvedValue(job({ status: 'killed' }));
  mocks.listJobs.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('CodeSessionControls — fallback e snapshot da sessão', () => {
  it('usa o permissionMode da linha da conversa enquanto não há snapshot no codeStore', () => {
    seedConversation('read_only');
    render(<CodeSessionControls conversationId="c-1" />);

    expect(screen.getByRole('button', { name: 'Modo de permissão: Leitura' })).toBeTruthy();
    expect(planToggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('o snapshot do codeStore prevalece sobre a linha da conversa', () => {
    seedConversation('read_only');
    seedSession({ permissionMode: 'autonomous', planMode: true });
    render(<CodeSessionControls conversationId="c-1" />);

    expect(screen.getByRole('button', { name: 'Modo de permissão: Autônomo' })).toBeTruthy();
    expect(planToggle().getAttribute('aria-pressed')).toBe('true');
  });

  it('sem linha nem snapshot cai no modo Editar', () => {
    render(<CodeSessionControls conversationId="c-1" />);

    expect(screen.getByRole('button', { name: 'Modo de permissão: Editar' })).toBeTruthy();
  });
});

describe('CodeSessionControls — troca de permissão', () => {
  it('abre o menu com os quatro modos e a descrição do modo atual', async () => {
    seedConversation('edit');
    render(<CodeSessionControls conversationId="c-1" />);

    openPermissionMenu();

    expect(await screen.findByRole('menuitem', { name: 'Leitura' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Revisar' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Editar' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Autônomo' })).toBeTruthy();
    expect(screen.getByText('O agente pode editar arquivos; comandos pedem aprovação.')).toBeTruthy();
  });

  it('oferece o modo Revisar (cada escrita pede aprovação)', async () => {
    seedConversation('edit');
    render(<CodeSessionControls conversationId="c-1" />);

    openPermissionMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Revisar' }));

    await waitFor(() => expect(mocks.setPermissionMode).toHaveBeenCalledWith('c-1', 'review'));
  });

  it('mostra a descrição do modo Revisar', async () => {
    seedSession({ permissionMode: 'review' });
    render(<CodeSessionControls conversationId="c-1" />);

    openPermissionMenu();

    expect(
      await screen.findByText('O agente pode propor edições, mas cada escrita pede aprovação.'),
    ).toBeTruthy();
  });

  it('aplica o novo modo de forma otimista e chama a API da sessão', async () => {
    seedConversation('edit');
    render(<CodeSessionControls conversationId="c-1" />);

    openPermissionMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Autônomo' }));

    // Otimista: o rótulo muda antes da resposta do backend.
    expect(screen.getByRole('button', { name: 'Modo de permissão: Autônomo' })).toBeTruthy();
    await waitFor(() => expect(mocks.setPermissionMode).toHaveBeenCalledWith('c-1', 'autonomous'));
  });

  it('reverte o modo e mantém o toast de erro quando o backend falha', async () => {
    seedSession();
    mocks.setPermissionMode.mockRejectedValue(new Error('negado'));
    render(<CodeSessionControls conversationId="c-1" />);

    openPermissionMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Autônomo' }));

    expect(screen.getByRole('button', { name: 'Modo de permissão: Autônomo' })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Modo de permissão: Editar' })).toBeTruthy(),
    );
    expect(toast.error).toHaveBeenCalledWith(
      'Não foi possível alterar o modo de permissão',
      expect.objectContaining({ description: 'Error: negado' }),
    );
  });
});

describe('CodeSessionControls — modo Plano', () => {
  it('alterna o Plano de forma otimista e reflete o snapshot devolvido pela API', async () => {
    seedSession();
    render(<CodeSessionControls conversationId="c-1" />);

    expect(planToggle().getAttribute('aria-pressed')).toBe('false');
    expect(planToggle().getAttribute('aria-label')).toBe('Modo Plano: desativado');
    fireEvent.click(planToggle());

    // Otimista: responde antes do IPC terminar (paridade com a permissão).
    expect(planToggle().getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(mocks.setPlanMode).toHaveBeenCalledWith('c-1', true));
    await waitFor(() => expect(planToggle().getAttribute('aria-pressed')).toBe('true'));
  });

  it('reverte o Plano (rollback) e mostra toast quando o backend falha', async () => {
    seedSession();
    mocks.setPlanMode.mockRejectedValue(new Error('negado'));
    render(<CodeSessionControls conversationId="c-1" />);

    fireEvent.click(planToggle());
    expect(planToggle().getAttribute('aria-pressed')).toBe('true');

    await waitFor(() => expect(mocks.setPlanMode).toHaveBeenCalledWith('c-1', true));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Não foi possível alterar o modo Plano',
        expect.objectContaining({ description: 'Error: negado' }),
      ),
    );
    await waitFor(() => expect(planToggle().getAttribute('aria-pressed')).toBe('false'));
  });
});

describe('CodeSessionControls — popover de plano e tarefas', () => {
  it('mostra estado/markdown/feedback do plano e o progresso das tarefas', async () => {
    seedSession({
      plan: {
        state: 'reviewing',
        markdown: '## Passo 1\n\nDetalhe do passo',
        feedback: 'Inclua testes de erro',
        updatedAt: 1,
      },
      todos: [
        { content: 'Ler o código', status: 'completed' },
        { content: 'Rodar os testes', status: 'pending' },
      ],
    });
    render(<CodeSessionControls conversationId="c-1" />);

    fireEvent.click(planTasksTrigger());

    expect(await screen.findByText('Plano · Aguardando aprovação')).toBeTruthy();
    expect(screen.getByText('Feedback anterior')).toBeTruthy();
    expect(screen.getByText('Inclua testes de erro')).toBeTruthy();
    expect(screen.getByText('1 de 2 concluídas')).toBeTruthy();
    expect(screen.getByText('Rodar os testes')).toBeTruthy();
    // O popover é somente leitura: nunca oferece aprovar por ali.
    expect(screen.queryByRole('button', { name: 'Aprovar e executar' })).toBeNull();
  });

  it('mostra estados vazios quando não há plano, tarefas nem jobs', async () => {
    seedSession();
    render(<CodeSessionControls conversationId="c-1" />);

    fireEvent.click(planTasksTrigger());

    expect(await screen.findByText('Nenhum plano nesta sessão.')).toBeTruthy();
    expect(screen.getByText('Nenhuma tarefa registrada.')).toBeTruthy();
    expect(screen.getByText('Nenhum trabalho em segundo plano.')).toBeTruthy();
  });

  it('move os jobs em background para o popover do composer (status e parar)', async () => {
    seedSession({ jobs: [job()] });
    render(<CodeSessionControls conversationId="c-1" />);

    fireEvent.click(planTasksTrigger());

    expect(await screen.findByText('Trabalhos em segundo plano')).toBeTruthy();
    expect(screen.getByText('pnpm dev')).toBeTruthy();
    expect(screen.getByText('Rodando')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Parar job: pnpm dev/ }));

    await waitFor(() => expect(mocks.killJob).toHaveBeenCalledWith('job-1'));
  });

  it('"Ver plano" abre o plano aprovado em uma aba central do Code', async () => {
    seedSession({
      plan: {
        state: 'approved',
        markdown: '# Plano aprovado\n\n- Passo 1',
        updatedAt: 7,
      },
    });
    render(<CodeSessionControls conversationId="c-1" />);

    fireEvent.click(planTasksTrigger());
    fireEvent.click(await screen.findByRole('button', { name: 'Ver plano' }));

    const ui = useUiStore.getState();
    expect(ui.codeView).toBe('plan');
    expect(ui.codePlanTab).toEqual({
      conversationId: 'c-1',
      markdown: '# Plano aprovado\n\n- Passo 1',
      title: 'Plano',
      updatedAt: 7,
    });
  });
});
