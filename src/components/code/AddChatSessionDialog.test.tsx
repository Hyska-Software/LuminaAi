// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  setConversationCodeLinked: vi.fn(),
  getConversation: vi.fn(),
  listArtifacts: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: mocks }));
vi.mock('sonner', () => ({ toast: toastMocks }));

// Imported after the API/store mocks.
import { useChatStore, useUiStore } from '@/lib/store';
import { AddChatSessionDialog } from './AddChatSessionDialog';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'chat-1',
    title: 'Reunião de planejamento',
    createdAt: 1,
    updatedAt: Date.now() - 60_000,
    pinned: false,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    messageCount: 4,
    preview: 'Discutir o roadmap do trimestre',
    mode: 'chat',
    ...overrides,
  };
}

/** Controlled wrapper so the test can observe the dialog closing. */
function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <AddChatSessionDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange?.(next);
        }}
      />
      <span data-testid="open-state">{String(open)}</span>
    </>
  );
}

const dialog = (): HTMLElement | null => screen.queryByRole('dialog');
const searchInput = (): HTMLElement =>
  screen.getByRole('textbox', { name: 'Buscar sessão do Chat' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setConversationCodeLinked.mockImplementation(async (id: string, linked: boolean) =>
    conversation({ id, codeLinked: linked }),
  );
  mocks.getConversation.mockImplementation(async (id: string) => ({
    // The real backend returns the stored conversation, including `codeLinked`.
    conversation:
      useChatStore.getState().conversations.find((entry) => entry.id === id) ??
      conversation({ id }),
    messages: [],
  }));
  mocks.listArtifacts.mockResolvedValue([]);
  useChatStore.setState({
    conversations: [],
    conversationsLoading: false,
    activeId: null,
    activeIdByLayout: { chat: null, code: null, agent: null },
  });
  useUiStore.setState({ layoutMode: 'code', codeView: 'session' });
});

afterEach(() => {
  cleanup();
});

describe('AddChatSessionDialog — lista de sessões do Chat', () => {
  it('lista apenas conversas do Chat ainda não compartilhadas com o Code', () => {
    useChatStore.setState({
      conversations: [
        conversation({ id: 'chat-1', title: 'Reunião de planejamento' }),
        conversation({ id: 'chat-2', title: 'Já compartilhada', codeLinked: true }),
        conversation({ id: 'code-1', title: 'Sessão do Code', mode: 'code' }),
      ],
    });

    render(<Harness />);

    expect(dialog()).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Adicionar sessão do Chat' })).toBeTruthy();
    expect(searchInput()).toBeTruthy();

    expect(
      screen.getByRole('button', { name: 'Adicionar Reunião de planejamento ao Code' }),
    ).toBeTruthy();
    expect(screen.queryByText('Já compartilhada')).toBeNull();
    expect(screen.queryByText('Sessão do Code')).toBeNull();
    expect(screen.getByText('1 sessão disponível')).toBeTruthy();
  });

  it('mostra título, prévia e data real da conversa', () => {
    useChatStore.setState({ conversations: [conversation()] });

    render(<Harness />);

    expect(screen.getByText('Reunião de planejamento')).toBeTruthy();
    expect(screen.getByText('Discutir o roadmap do trimestre')).toBeTruthy();
    expect(screen.getByText('1 min')).toBeTruthy();
  });

  it('busca por título/prévia sem acentos e sem caixa', () => {
    useChatStore.setState({
      conversations: [
        conversation({ id: 'chat-1', title: 'Reunião de planejamento' }),
        conversation({ id: 'chat-2', title: 'Bug no parser', preview: 'Falha no build' }),
      ],
    });
    render(<Harness />);

    fireEvent.change(searchInput(), { target: { value: 'reuniao' } });
    expect(screen.getByText('Reunião de planejamento')).toBeTruthy();
    expect(screen.queryByText('Bug no parser')).toBeNull();

    fireEvent.change(searchInput(), { target: { value: 'build' } });
    expect(screen.getByText('Bug no parser')).toBeTruthy();
    expect(screen.queryByText('Reunião de planejamento')).toBeNull();
  });

  it('oferece estado vazio de busca com "Limpar busca"', () => {
    useChatStore.setState({ conversations: [conversation()] });
    render(<Harness />);

    fireEvent.change(searchInput(), { target: { value: 'inexistente' } });

    expect(screen.getByText('Nenhuma sessão encontrada')).toBeTruthy();
    expect(screen.getByText(/corresponde a “inexistente”/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Limpar busca' }));

    expect((searchInput() as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Reunião de planejamento')).toBeTruthy();
  });

  it('mostra o estado vazio honesto quando não há sessão do Chat disponível', () => {
    useChatStore.setState({
      conversations: [
        conversation({ id: 'chat-2', title: 'Já compartilhada', codeLinked: true }),
        conversation({ id: 'code-1', title: 'Sessão do Code', mode: 'code' }),
      ],
    });

    render(<Harness />);

    expect(screen.getByText('Nenhuma sessão do Chat disponível')).toBeTruthy();
    expect(
      screen.getByText(
        'Todas as conversas do Chat já estão no Code, ou você ainda não tem conversas no Chat.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('0 sessões disponíveis')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('AddChatSessionDialog — adicionar ao Code', () => {
  it('compartilha a sessão, fecha o diálogo e abre a conversa no Code', async () => {
    useChatStore.setState({ conversations: [conversation({ id: 'chat-1' })] });
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Reunião de planejamento ao Code' }));

    await waitFor(() =>
      expect(mocks.setConversationCodeLinked).toHaveBeenCalledWith('chat-1', true),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.getByTestId('open-state').textContent).toBe('false');
    expect(dialog()).toBeNull();

    expect(useUiStore.getState().codeView).toBe('session');
    await waitFor(() => expect(mocks.getConversation).toHaveBeenCalledWith('chat-1'));
    await waitFor(() => expect(useChatStore.getState().activeId).toBe('chat-1'));
    // A mesma conversa passa a ser compartilhada (não é duplicada).
    expect(useChatStore.getState().conversations).toHaveLength(1);
    expect(useChatStore.getState().conversations[0]?.codeLinked).toBe(true);
  });

  it('em falha mostra toast e mantém o diálogo aberto', async () => {
    useChatStore.setState({ conversations: [conversation()] });
    mocks.setConversationCodeLinked.mockRejectedValueOnce(new Error('backend offline'));

    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Reunião de planejamento ao Code' }));

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith('Não foi possível adicionar a sessão ao Code'),
    );
    expect(dialog()).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível adicionar a sessão');
    // O botão volta a ficar disponível para tentar de novo.
    await waitFor(() =>
      expect(
        (screen.getByRole('button', {
          name: 'Adicionar Reunião de planejamento ao Code',
        }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(useChatStore.getState().activeId).toBeNull();
  });

  it('Cancelar fecha o diálogo sem compartilhar nada', () => {
    useChatStore.setState({ conversations: [conversation()] });
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(dialog()).toBeNull();
    expect(mocks.setConversationCodeLinked).not.toHaveBeenCalled();
  });

  it('fecha com Esc (focus trap do Radix) sem compartilhar', async () => {
    useChatStore.setState({ conversations: [conversation()] });
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);

    await screen.findByRole('dialog');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.setConversationCodeLinked).not.toHaveBeenCalled();
  });
});
