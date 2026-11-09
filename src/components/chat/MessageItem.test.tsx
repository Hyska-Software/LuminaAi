// @vitest-environment jsdom
/**
 * Transcript — origem `goal_round` (docs/goals/code-goals/PLAN.md §10.5).
 *
 * A mensagem de abertura de uma rodada automática do objetivo não é do usuário:
 * vira um divisor "Continuação do objetivo" (separator acessível), sem bolha,
 * sem copiar/editar e sem regenerar. Mensagens normais continuam idênticas.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Agent, ChatMessage, Conversation } from '@/lib/types';
import { useAgentStore, useChatStore, useUiStore, type StreamingState } from '@/lib/store';
import { MessageItem } from './MessageItem';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm-1',
    conversationId: 'conv-code',
    role: 'user',
    content: 'Ajuste os arquivos.',
    status: 'complete',
    toolCalls: [],
    citations: [],
    attachments: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

function goalRoundMessage(): ChatMessage {
  return message({ id: 'm-goal', role: 'user', content: '', origin: 'goal_round' });
}

function streaming(overrides: Partial<StreamingState> = {}): StreamingState {
  return {
    turnId: 'turn-2',
    conversationId: 'conv-code',
    assistantId: 'assistant-2',
    userMessageId: 'm-goal',
    phase: 'tool',
    step: 1,
    startedAt: Date.now(),
    turnKind: 'goal_round',
    ...overrides,
  };
}

function renderMessage(entry: ChatMessage, isStreaming = false) {
  return render(<MessageItem message={entry} isStreaming={isStreaming} isGroupStart />);
}

afterEach(() => {
  cleanup();
  useChatStore.setState({ streaming: null });
  useUiStore.setState({ layoutMode: 'chat' });
});

describe('MessageItem — avatar do agente', () => {
  it('usa o ícone do agente no layout Agentes em vez do logo do app', () => {
    useUiStore.setState({ layoutMode: 'agent' });
    useChatStore.setState({
      conversations: [
        {
          id: 'conv-agent',
          agentId: 'agent-1',
        } as Conversation,
      ],
    });
    useAgentStore.setState({
      agentsById: {
        'agent-1': {
          id: 'agent-1',
          avatar: { kind: 'emoji', value: '🔎', shape: 'rounded' },
        } as Agent,
      },
    });

    const { container } = render(
      <MessageItem
        message={message({
          id: 'a-agent',
          conversationId: 'conv-agent',
          role: 'assistant',
          content: 'Notícias analisadas.',
        })}
        isStreaming={false}
        isGroupStart
      />,
    );

    expect(screen.getByText('🔎')).toBeTruthy();
    expect(container.querySelector('img[src*="lumina-mark"]')).toBeNull();
  });

  it('anima o avatar do agente enquanto a mensagem está em streaming', () => {
    useUiStore.setState({ layoutMode: 'agent' });
    useChatStore.setState({
      conversations: [{ id: 'conv-agent', agentId: 'agent-1' } as Conversation],
    });
    useAgentStore.setState({
      agentsById: {
        'agent-1': {
          id: 'agent-1',
          avatar: { kind: 'emoji', value: '🔎', shape: 'rounded' },
        } as Agent,
      },
    });

    const entry = message({
      id: 'a-agent',
      conversationId: 'conv-agent',
      role: 'assistant',
      content: 'Analisando…',
    });
    const { container, rerender } = render(
      <MessageItem message={entry} isStreaming isGroupStart />,
    );
    expect(container.querySelector('[data-activity="running"]')).not.toBeNull();

    rerender(<MessageItem message={entry} isStreaming={false} isGroupStart />);
    expect(container.querySelector('[data-activity="idle"]')).not.toBeNull();
  });
});

describe('MessageItem — readOnly', () => {
  it('esconde edição, regeneração e feedback, preservando cópia', () => {
    const { rerender } = render(
      <MessageItem message={message()} isStreaming={false} isGroupStart readOnly />,
    );
    expect(screen.queryByRole('button', { name: 'Editar mensagem' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copiar mensagem' })).toBeTruthy();

    const assistant = message({
      id: 'a-1',
      role: 'assistant',
      content: 'Resposta do subagente.',
    });
    rerender(
      <MessageItem message={assistant} isStreaming={false} isGroupStart readOnly />,
    );
    expect(screen.queryByRole('button', { name: 'Regenerar resposta' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resposta útil' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resposta não útil' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copiar resposta' })).toBeTruthy();
  });
});

describe('MessageItem — origem goal_round', () => {
  it('renderiza um divisor acessível em vez da bolha do usuário', () => {
    renderMessage(goalRoundMessage());

    const divider = screen.getByRole('separator');
    expect(divider.getAttribute('aria-label')).toContain('Continuação do objetivo');
    expect(screen.getByText('Continuação do objetivo')).toBeTruthy();
    // Sem bolha, sem editar/copiar/regenerar.
    expect(screen.queryByText('Ajuste os arquivos.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar mensagem' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copiar mensagem' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Regenerar resposta' })).toBeNull();
  });

  it('mostra o spinner/estado de andamento enquanto a rodada roda', () => {
    useChatStore.setState({ streaming: streaming() });
    renderMessage(goalRoundMessage());

    expect(screen.getByRole('separator').getAttribute('aria-label')).toBe(
      'Continuação do objetivo — rodada em andamento',
    );
    // O spinner do divisor é decorativo (o anúncio vem do aria-label).
    expect(document.querySelectorAll('.animate-spin').length).toBeGreaterThan(0);
  });

  it('não anima por streaming de outra conversa ou de turno do usuário', () => {
    useChatStore.setState({ streaming: streaming({ conversationId: 'outra' }) });
    renderMessage(goalRoundMessage());
    expect(screen.getByRole('separator').getAttribute('aria-label')).not.toContain(
      'em andamento',
    );
    cleanup();

    useChatStore.setState({ streaming: streaming({ turnKind: 'user' }) });
    renderMessage(goalRoundMessage());
    expect(screen.getByRole('separator').getAttribute('aria-label')).not.toContain(
      'em andamento',
    );
  });
});

describe('MessageItem — mensagem normal do usuário (regressão)', () => {
  it('mantém a bolha e as ações de copiar/editar', () => {
    renderMessage(message());

    expect(screen.getByText('Ajuste os arquivos.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copiar mensagem' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Editar mensagem' })).toBeTruthy();
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('não edita enquanto um turno está em streaming', () => {
    renderMessage(message(), true);

    const edit = screen.getByRole('button', { name: 'Editar mensagem' }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
  });
});

describe('MessageItem — diferenças do layout Code', () => {
  const cited = message({
    id: 'a-cited',
    role: 'assistant',
    content: 'Resposta com fontes.',
    citations: [
      { id: 'cit-1', title: 'Tauri', url: 'https://tauri.app/', siteName: 'tauri.app' },
    ],
  });

  it('omite o avatar do app e os chips de fontes no layout Code', () => {
    useUiStore.setState({ layoutMode: 'code' });

    const { container } = renderMessage(cited);

    expect(screen.getByText('Resposta com fontes.')).toBeTruthy();
    expect(container.querySelector('img[src*="lumina-mark"]')).toBeNull();
    expect(screen.queryByText('tauri.app')).toBeNull();
  });

  it('mantém o avatar e os chips de fontes no layout Chat', () => {
    useUiStore.setState({ layoutMode: 'chat' });

    const { container } = renderMessage(cited);

    expect(container.querySelector('img[src*="lumina-mark"]')).not.toBeNull();
    expect(screen.getByText('tauri.app')).toBeTruthy();
  });
});

describe('MessageItem — execução separada por resposta', () => {
  function segmentedAssistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return message({
      id: 'a-segmented',
      role: 'assistant',
      content: 'Agora a verificação final completa desta rodada.',
      toolCalls: [
        {
          id: 'tool-read',
          name: 'read_file',
          arguments: '{"path":"tests/validation/834.spec"}',
          status: 'done',
          result: 'ok',
        },
      ],
      trace: [
        {
          reasoning: 'Vou checar o fixture.',
          text: 'Ambos rejeitados (exit 65).',
          durationMs: 2_000,
          toolCalls: 1,
        },
        { reasoning: 'Verificação final.', durationMs: 4_000, toolCalls: 0 },
      ],
      ...overrides,
    });
  }

  it('mostra a narração intermediária e a resposta final no layout Code', () => {
    useUiStore.setState({ layoutMode: 'code' });

    renderMessage(segmentedAssistant());

    expect(screen.getByText('Ambos rejeitados (exit 65).')).toBeTruthy();
    expect(
      screen.getByText('Agora a verificação final completa desta rodada.'),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Trabalhou por 4s' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Usou / })).toBeNull();
  });

  it('não renderiza a narração intermediária no layout Chat', () => {
    useUiStore.setState({ layoutMode: 'chat' });

    renderMessage(segmentedAssistant());

    expect(screen.queryByText('Ambos rejeitados (exit 65).')).toBeNull();
    expect(
      screen.getByText('Agora a verificação final completa desta rodada.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Usou / })).toBeNull();
    expect(screen.queryByRole('button', { name: /Trabalhou por/ })).toBeNull();
  });
});
