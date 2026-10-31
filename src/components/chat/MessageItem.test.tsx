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
import type { ChatMessage } from '@/lib/types';
import { useChatStore, type StreamingState } from '@/lib/store';
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
