// @vitest-environment jsdom
/**
 * Montagem do fecho de turno no transcript (DESIGN §6.3): o card
 * `CodeTurnSummary` reside em `AssistantMessageItem`, mas só deve existir no
 * layout **Code** e com o turno **encerrado** — durante o streaming as edições
 * ainda estão chegando. O conteúdo do card tem suíte própria
 * (`CodeTurnSummary.test.tsx`); aqui o alvo é o gate da montagem e o workspace
 * da sessão, que torna as linhas clicáveis (abrem o diff como aba central).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatMessage, Conversation, FileChangeKind, ToolCallRecord } from '@/lib/types';
import { useChatStore, useUiStore, type StreamingState } from '@/lib/store';
import { MessageList } from './MessageList';

const CONVERSATION_ID = 'conv-code';

/** Patch como o harness persiste em `presentation.diff` (abre a aba sem IPC). */
const DIFF = [
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1 +1 @@',
  '-const app = false;',
  '+const app = true;',
].join('\n');

/** Chamada de escrita como o harness persiste: `presentation.kind === 'file_change'`. */
function fileChange(
  path: string,
  added: number,
  removed: number,
  change: FileChangeKind = 'modified',
  diff?: string,
): ToolCallRecord {
  return {
    id: `call-${path}`,
    name: 'edit_file',
    arguments: '{}',
    status: 'done',
    presentation: {
      kind: 'file_change',
      path,
      change,
      added,
      removed,
      ...(diff ? { diff } : {}),
    },
  };
}

function userMessage(): ChatMessage {
  return {
    id: 'user-1',
    conversationId: CONVERSATION_ID,
    role: 'user',
    content: 'Ajuste os arquivos.',
    status: 'complete',
    toolCalls: [],
    citations: [],
    attachments: [],
    createdAt: 1,
  };
}

function assistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-1',
    conversationId: CONVERSATION_ID,
    role: 'assistant',
    content: 'Pronto — ajustei os arquivos.',
    status: 'complete',
    toolCalls: [
      fileChange('src/app.ts', 12, 3),
      fileChange('docs/DESIGN.md', 30, 4, 'created'),
    ],
    citations: [],
    attachments: [],
    createdAt: 2,
    ...overrides,
  };
}

/** Sessão do layout Code (dono do workspace usado para abrir o diff). */
function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONVERSATION_ID,
    title: 'Corrigir o build',
    createdAt: 1,
    updatedAt: 2,
    pinned: false,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    messageCount: 2,
    mode: 'code',
    workspaceId: 'ws-1',
    ...overrides,
  };
}

/** Par usuário + assistente como o transcript recebe do `ChatView`. */
function turn(overrides: Partial<ChatMessage> = {}): ChatMessage[] {
  return [userMessage(), assistantMessage(overrides)];
}

function streamingState(assistantId: string): StreamingState {
  return {
    turnId: 'turn-1',
    conversationId: CONVERSATION_ID,
    assistantId,
    userMessageId: 'user-1',
    phase: 'tool',
    step: 1,
    startedAt: Date.now(),
    turnKind: 'user',
  };
}

const summaryCard = (): HTMLElement | null =>
  screen.queryByRole('group', { name: 'Resumo do turno' });

afterEach(() => {
  cleanup();
  useUiStore.setState({
    layoutMode: 'chat',
    artifacts: [],
    codeDiffTab: null,
    codeView: 'session',
  });
  useChatStore.setState({ streaming: null, conversations: [] });
});

describe('MessageList — fecho do turno (somente no layout Code)', () => {
  it('mostra o resumo do turno no layout Code quando o turno terminou', () => {
    useUiStore.setState({ layoutMode: 'code' });

    render(<MessageList messages={turn()} streaming={null} />);

    expect(summaryCard()).toBeTruthy();
    expect(screen.getByText('2 arquivos alterados')).toBeTruthy();
    expect(screen.getByText('src/app.ts')).toBeTruthy();
    expect(screen.getByText('docs/DESIGN.md')).toBeTruthy();
  });

  it('não monta o card no layout Chat', () => {
    useUiStore.setState({ layoutMode: 'chat' });

    render(<MessageList messages={turn()} streaming={null} />);

    // O transcript continua montado; só o fecho do Code não existe no Chat.
    expect(screen.getByText('Pronto — ajustei os arquivos.')).toBeTruthy();
    expect(summaryCard()).toBeNull();
    expect(screen.queryByText('2 arquivos alterados')).toBeNull();
  });

  it('acompanha a troca de layout em tempo real', () => {
    useUiStore.setState({ layoutMode: 'chat' });
    render(<MessageList messages={turn()} streaming={null} />);
    expect(summaryCard()).toBeNull();

    act(() => {
      useUiStore.setState({ layoutMode: 'code' });
    });

    expect(summaryCard()).toBeTruthy();
  });

  it('não mostra o card durante o streaming e o mostra quando o turno encerra', () => {
    useUiStore.setState({ layoutMode: 'code' });
    const assistant = assistantMessage();
    const messages = [userMessage(), assistant];
    const streaming = streamingState(assistant.id);
    useChatStore.setState({ streaming });

    const { rerender } = render(<MessageList messages={messages} streaming={streaming} />);
    expect(summaryCard()).toBeNull();

    // Turno encerrado: o mesmo transcript passa a fechar com o resumo.
    act(() => {
      useChatStore.setState({ streaming: null });
    });
    rerender(<MessageList messages={messages} streaming={null} />);
    expect(summaryCard()).toBeTruthy();
  });

  it('mantém o resumo em turno cancelado (edições parciais são reais)', () => {
    useUiStore.setState({ layoutMode: 'code' });

    render(<MessageList messages={turn({ status: 'cancelled' })} streaming={null} />);

    const card = summaryCard();
    const badge = screen.getByText('Cancelado');
    expect(card).toBeTruthy();
    expect(badge).toBeTruthy();
    // O selo qualifica o turno e vem ANTES do resumo (não rotula o card).
    expect(
      badge.compareDocumentPosition(card as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('mantém o resumo em turno com erro (edições parciais são reais)', () => {
    useUiStore.setState({ layoutMode: 'code' });

    render(
      <MessageList
        messages={turn({ status: 'error', content: 'Falhou no meio do turno.' })}
        streaming={null}
      />,
    );

    expect(summaryCard()).toBeTruthy();
  });
});

describe('MessageList — workspace da sessão no fecho do turno', () => {
  it('abre o diff do arquivo como aba central pelo resumo (workspace da sessão)', () => {
    useUiStore.setState({ layoutMode: 'code' });
    useChatStore.setState({ conversations: [conversation()] });

    render(
      <MessageList
        messages={[
          userMessage(),
          assistantMessage({ toolCalls: [fileChange('src/app.ts', 12, 3, 'modified', DIFF)] }),
        ]}
        streaming={null}
      />,
    );

    // O clique só grava a aba no store — o `get_file_diff` é do `CodeDiffView`.
    fireEvent.click(screen.getByRole('button', { name: 'Abrir diff de src/app.ts' }));

    expect(useUiStore.getState().codeDiffTab).toEqual({
      workspaceId: 'ws-1',
      path: 'src/app.ts',
      staged: false,
      knownDiff: DIFF,
    });
    expect(useUiStore.getState().codeView).toBe('diff');
  });

  it('sem workspace na sessão, o resumo não oferece abrir o diff', () => {
    useUiStore.setState({ layoutMode: 'code' });
    useChatStore.setState({ conversations: [conversation({ workspaceId: null })] });

    render(
      <MessageList
        messages={[
          userMessage(),
          assistantMessage({ toolCalls: [fileChange('src/app.ts', 12, 3, 'modified', DIFF)] }),
        ]}
        streaming={null}
      />,
    );

    // O card continua informativo; só não há ação de abrir o diff.
    expect(summaryCard()).toBeTruthy();
    expect(screen.getByText('1 arquivo alterado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Abrir diff de / })).toBeNull();
  });
});

describe('MessageList — divisor de troca de modelo no meio da conversa', () => {
  const GO_FLASH = { providerId: 'opencode-go', modelId: 'deepseek-v4.1-flash' } as const;
  const OPENAI_LUNA = { providerId: 'openai', modelId: 'gpt-6-luna' } as const;

  beforeEach(() => {
    useUiStore.setState({ layoutMode: 'chat' });
  });

  function followUpUser(id: string, content: string, createdAt: number): ChatMessage {
    return { ...userMessage(), id, content, createdAt };
  }

  function routedAssistant(
    id: string,
    content: string,
    route: { providerId: string | null; modelId: string | null },
    createdAt: number,
  ): ChatMessage {
    return assistantMessage({ id, content, createdAt, toolCalls: [], ...route });
  }

  /** Conversa com troca no meio: Go/Flash -> OpenAI/Luna (e um turno repetindo). */
  function mixedConversation(): ChatMessage[] {
    return [
      userMessage(),
      routedAssistant('assistant-1', 'Resposta A.', GO_FLASH, 2),
      followUpUser('user-2', 'Agora com outro modelo.', 3),
      routedAssistant('assistant-2', 'Resposta B.', OPENAI_LUNA, 4),
      followUpUser('user-3', 'Continua.', 5),
      routedAssistant('assistant-3', 'Resposta C.', OPENAI_LUNA, 6),
    ];
  }

  it('mostra um único divisor, como sibling imediatamente antes da resposta nova', () => {
    render(<MessageList messages={mixedConversation()} streaming={null} />);

    const dividers = screen.getAllByRole('separator', { name: /Modelo alterado para/ });
    expect(dividers).toHaveLength(1);

    const divider = dividers[0];
    expect(divider.getAttribute('title')).toBe('Modelo alterado para GPT-6 Luna · ChatGPT');
    // O divisor é irmão do MessageItem dentro do role="log" — não envolve a mensagem.
    const log = screen.getByRole('log');
    expect(divider.parentElement).toBe(log);
    const item = divider.nextElementSibling as HTMLElement;
    expect(within(item).getByText('Resposta B.')).toBeTruthy();
    expect(within(item).queryByText('Resposta A.')).toBeNull();
  });

  it('não mostra divisor quando a conversa inteira usa a mesma rota', () => {
    const messages = [
      userMessage(),
      routedAssistant('assistant-1', 'Resposta A.', GO_FLASH, 2),
      followUpUser('user-2', 'Mais uma pergunta.', 3),
      routedAssistant('assistant-2', 'Resposta B.', GO_FLASH, 4),
    ];

    render(<MessageList messages={messages} streaming={null} />);

    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.queryByText(/Modelo alterado para/)).toBeNull();
  });

  it('mantém o role="log"/aria-live e o divisor acessível durante o streaming', () => {
    const messages = mixedConversation();
    const { rerender } = render(<MessageList messages={messages} streaming={null} />);

    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('off');
    const divider = screen.getByRole('separator', {
      name: 'Modelo alterado para GPT-6 Luna · ChatGPT',
    });
    expect(log.contains(divider)).toBe(true);
    expect(divider.textContent).toContain('Modelo alterado para GPT-6 Luna');

    rerender(<MessageList messages={messages} streaming={streamingState('assistant-2')} />);
    expect(screen.getByRole('log').getAttribute('aria-live')).toBe('polite');
    expect(
      screen.getByRole('separator', { name: /Modelo alterado para GPT-6 Luna/ }),
    ).toBeTruthy();
  });

  it('ignora resposta antiga sem modelId ao comparar a rota anterior', () => {
    const messages = [
      userMessage(),
      routedAssistant('assistant-1', 'Resposta A.', GO_FLASH, 2),
      followUpUser('user-2', 'Segue.', 3),
      assistantMessage({
        id: 'assistant-legacy',
        content: 'Resposta legada.',
        createdAt: 4,
        toolCalls: [],
        providerId: null,
        modelId: null,
      }),
      followUpUser('user-3', 'Troquei o modelo.', 5),
      routedAssistant('assistant-3', 'Resposta C.', OPENAI_LUNA, 6),
    ];

    render(<MessageList messages={messages} streaming={null} />);

    // A resposta sem modelId não interrompe a comparação: o divisor vem antes da C.
    const divider = screen.getByRole('separator', { name: /Modelo alterado para GPT-6 Luna/ });
    const item = divider.nextElementSibling as HTMLElement;
    expect(within(item).getByText('Resposta C.')).toBeTruthy();
    expect(screen.queryByText('Resposta legada.')).toBeTruthy();
  });
});

describe('MessageList — UI generativa no layout Code', () => {
  const block = [
    '```ui',
    JSON.stringify({
      components: [
        {
          type: 'card',
          props: { title: 'Verificação do turno' },
          children: [
            { type: 'stat', props: { label: 'Testes', value: '42/42' } },
          ],
        },
      ],
    }),
    '```',
  ].join('\n');

  it('renderiza o bloco ui no transcript do Code', () => {
    useUiStore.setState({ layoutMode: 'code' });
    const assistant = assistantMessage({
      content: `Resumo do turno.\n\n${block}`,
      toolCalls: [],
    });

    render(<MessageList messages={[userMessage(), assistant]} streaming={null} />);

    expect(document.querySelector('.zylara-genui')).toBeTruthy();
    expect(screen.getByText('Verificação do turno')).toBeTruthy();
    expect(screen.getByText('Testes')).toBeTruthy();
    expect(screen.queryByText(/ui\.invalid-json/)).toBeNull();
  });
});
