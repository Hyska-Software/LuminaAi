// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Conversation, ConversationDetail, TurnPayload, TurnEvent } from '@/lib/types';

const mocks = vi.hoisted(() => {
  const api = {
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    renameConversation: vi.fn(),
    deleteConversation: vi.fn(),
    setConversationPinned: vi.fn(),
    searchConversations: vi.fn(),
    truncateConversation: vi.fn(),
    importAttachments: vi.fn(),
    deleteAttachment: vi.fn(),
    listArtifacts: vi.fn(),
    runTurn: vi.fn(),
    cancelTurn: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    setProviderKey: vi.fn(),
    getCatalog: vi.fn(),
    refreshCatalog: vi.fn(),
    appInfo: vi.fn(),
    validateProvider: vi.fn(),
  };
  return { api };
});

vi.mock('@/lib/api', () => ({ api: mocks.api }));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

// Imported after the mocks above.
import { useAppStore } from '@/lib/store/appStore';
import { useChatStore, selectModelLocked } from '@/lib/store/chatStore';
import { useUiStore } from '@/lib/store/uiStore';
import { catalog } from '@/lib/catalog';

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'conv-1',
  title: 'Nova conversa',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  pinned: false,
  providerId: 'opencode-go',
  modelId: 'deepseek-v4.1-flash',
  messageCount: 0,
  ...overrides,
});

function userMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'user-1',
    conversationId: 'conv-1',
    role: 'user',
    content: 'Explique MCP',
    status: 'complete',
    toolCalls: [],
    citations: [],
    attachments: [],
    createdAt: 1,
    ...overrides,
  };
}

function assistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-1',
    conversationId: 'conv-1',
    role: 'assistant',
    content: 'Resposta final',
    status: 'complete',
    toolCalls: [],
    citations: [],
    attachments: [],
    createdAt: 2,
    ...overrides,
  };
}

function resetStores(): void {
  useChatStore.setState({
    conversations: [],
    conversationsLoading: false,
    activeId: null,
    messagesByConversation: {},
    loadingConversationId: null,
    streaming: null,
    pendingAttachments: [],
    error: null,
  });
  useUiStore.setState({ artifacts: [] });
  useAppStore.setState({
    selection: {
      providerId: 'opencode-go',
      modelId: 'deepseek-v4.1-flash',
      reasoning: { mode: 'effort', effort: 'max' },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStores();
  mocks.api.listConversations.mockResolvedValue([]);
  mocks.api.listArtifacts.mockResolvedValue([]);
  mocks.api.renameConversation.mockResolvedValue(undefined);
  mocks.api.deleteConversation.mockResolvedValue(undefined);
  mocks.api.setConversationPinned.mockResolvedValue(undefined);
  mocks.api.truncateConversation.mockResolvedValue(undefined);
  mocks.api.cancelTurn.mockResolvedValue(true);
  mocks.api.createConversation.mockResolvedValue(conversation());
});

describe('chatStore.send', () => {
  it('creates a conversation, streams events and finalizes the assistant message', async () => {
    const payloads: TurnPayload[] = [];
    mocks.api.listConversations.mockResolvedValue([
      conversation({ title: 'O que é MCP', messageCount: 2 }),
    ]);

    mocks.api.runTurn.mockImplementation(
      async (payload: TurnPayload, onEvent: (event: TurnEvent) => void) => {
        payloads.push(payload);
        onEvent({ type: 'turn_started', turnId: payload.turnId!, userMessageId: 'user-1', assistantMessageId: 'assistant-1' });
        onEvent({ type: 'step_started', step: 1 });
        onEvent({ type: 'reasoning_delta', delta: 'pensando…' });
        onEvent({ type: 'reasoning_done' });
        onEvent({ type: 'text_delta', delta: 'Olá ' });
        onEvent({ type: 'text_delta', delta: 'mundo' });
        onEvent({
          type: 'tool_call_started',
          toolCall: { id: 'tool-1', name: 'web_search', arguments: '', status: 'running' },
        });
        onEvent({ type: 'tool_call_args', id: 'tool-1', delta: '{"query":"mcp"}' });
        onEvent({
          type: 'tool_call_finished',
          id: 'tool-1',
          status: 'done',
          result: 'ok',
          summary: '1 resultado',
          citations: [{ id: 'cit-1', title: 'MCP', url: 'https://modelcontextprotocol.io' }],
        });
        onEvent({ type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } });
        onEvent({ type: 'title_updated', conversationId: 'conv-1', title: 'O que é MCP' });
        const result = {
          userMessage: userMessage(),
          assistantMessage: assistantMessage({
            content: 'Olá mundo',
            reasoning: 'pensando…',
            toolCalls: [
              {
                id: 'tool-1',
                name: 'web_search',
                arguments: '{"query":"mcp"}',
                result: 'ok',
                status: 'done' as const,
                summary: '1 resultado',
              },
            ],
            citations: [{ id: 'cit-1', title: 'MCP', url: 'https://modelcontextprotocol.io' }],
            usage: { inputTokens: 10, outputTokens: 5 },
          }),
          usage: { inputTokens: 10, outputTokens: 5 },
          error: null,
          conversation: conversation({ title: 'O que é MCP', messageCount: 2 }),
        };
        onEvent({ type: 'done', result });
        return result;
      },
    );

    await useChatStore.getState().send('Explique MCP');

    await vi.waitFor(() => {
      expect(useChatStore.getState().streaming).toBeNull();
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      conversationId: 'conv-1',
      content: 'Explique MCP',
      providerId: 'opencode-go',
      modelId: 'deepseek-v4.1-flash',
      reasoning: { mode: 'effort', effort: 'max' },
    });
    expect(payloads[0].turnId).toBeTruthy();

    const state = useChatStore.getState();
    expect(state.activeId).toBe('conv-1');
    expect(state.pendingAttachments).toEqual([]);

    const messages = state.messagesByConversation['conv-1'];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: 'user-1', role: 'user', content: 'Explique MCP' });
    expect(messages[1]).toMatchObject({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Olá mundo',
      reasoning: 'pensando…',
      status: 'complete',
    });
    expect(messages[1].toolCalls).toHaveLength(1);
    expect(messages[1].toolCalls[0]).toMatchObject({
      id: 'tool-1',
      status: 'done',
      arguments: '{"query":"mcp"}',
    });
    expect(messages[1].citations.map((citation) => citation.url)).toEqual([
      'https://modelcontextprotocol.io',
    ]);
    await vi.waitFor(() => {
      expect(useChatStore.getState().conversations[0]?.title).toBe('O que é MCP');
    });
  });

  it('records an error and keeps partial content when the turn rejects', async () => {
    mocks.api.runTurn.mockImplementation(
      async (_payload: TurnPayload, onEvent: (event: TurnEvent) => void) => {
        onEvent({ type: 'turn_started', turnId: 'turn-1', userMessageId: 'user-1', assistantMessageId: 'assistant-1' });
        onEvent({ type: 'text_delta', delta: 'parcial' });
        throw new Error('gateway fora do ar');
      },
    );

    await useChatStore.getState().send('Oi');
    await vi.waitFor(() => {
      expect(useChatStore.getState().streaming).toBeNull();
    });

    const state = useChatStore.getState();
    const assistant = state.messagesByConversation['conv-1'][1];
    expect(assistant.content).toBe('parcial');
    expect(assistant.status).toBe('complete');
    expect(state.error).toContain('gateway fora do ar');
  });

  it('builds the thinking trace incrementally while the turn streams', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    mocks.api.runTurn.mockImplementation(
      async (payload: TurnPayload, onEvent: (event: TurnEvent) => void) => {
        onEvent({
          type: 'turn_started',
          turnId: payload.turnId!,
          userMessageId: 'user-1',
          assistantMessageId: 'assistant-1',
        });
        onEvent({ type: 'step_started', step: 1 });
        onEvent({ type: 'reasoning_delta', delta: 'Vou pesquisar.' });
        onEvent({ type: 'reasoning_done' });
        onEvent({
          type: 'tool_call_started',
          toolCall: { id: 'tool-1', name: 'web_search', arguments: '', status: 'running' },
        });
        await gate;
        onEvent({
          type: 'tool_call_finished',
          id: 'tool-1',
          status: 'done',
          result: '{"results":[]}',
          summary: '0 resultados',
        });
        onEvent({ type: 'step_started', step: 2 });
        onEvent({ type: 'reasoning_delta', delta: 'Concluído.' });
        onEvent({ type: 'reasoning_done' });
        const trace = [
          { reasoning: 'Vou pesquisar.', toolCalls: 1 },
          { reasoning: 'Concluído.', toolCalls: 0 },
        ];
        const finalMessage = assistantMessage({
          reasoning: 'Vou pesquisar.Concluído.',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'web_search',
              arguments: '',
              result: '{"results":[]}',
              status: 'done' as const,
              summary: '0 resultados',
            },
          ],
          trace,
        });
        const result = {
          userMessage: userMessage(),
          assistantMessage: finalMessage,
          usage: null,
          error: null,
          conversation: conversation({ messageCount: 2 }),
        };
        onEvent({ type: 'message_updated', message: finalMessage });
        onEvent({ type: 'done', result });
        return result;
      },
    );

    await useChatStore.getState().send('Pesquise');

    // While the turn is held open, the first step is already on the timeline.
    const streamingMessage = useChatStore.getState().messagesByConversation['conv-1'][1];
    expect(streamingMessage.status).toBe('streaming');
    expect(streamingMessage.trace).toEqual([{ reasoning: 'Vou pesquisar.', toolCalls: 1 }]);

    release();
    await vi.waitFor(() => expect(useChatStore.getState().streaming).toBeNull());

    const finalMessage = useChatStore.getState().messagesByConversation['conv-1'][1];
    expect(finalMessage.trace).toEqual([
      { reasoning: 'Vou pesquisar.', toolCalls: 1 },
      { reasoning: 'Concluído.', toolCalls: 0 },
    ]);
  });
});

describe('chatStore.regenerate', () => {
  it('truncates the last assistant message and streams a replacement without duplicating the user message', async () => {
    useChatStore.setState({
      conversations: [conversation({ messageCount: 2 })],
      activeId: 'conv-1',
      messagesByConversation: {
        'conv-1': [userMessage(), assistantMessage()],
      },
    });

    mocks.api.runTurn.mockImplementation(
      async (payload: TurnPayload, onEvent: (event: TurnEvent) => void) => {
        onEvent({ type: 'turn_started', turnId: payload.turnId!, userMessageId: 'user-1', assistantMessageId: 'assistant-2' });
        onEvent({ type: 'text_delta', delta: 'nova resposta' });
        const result = {
          userMessage: userMessage(),
          assistantMessage: assistantMessage({ id: 'assistant-2', content: 'nova resposta' }),
          usage: null,
          error: null,
          conversation: conversation({ messageCount: 2 }),
        };
        onEvent({ type: 'done', result });
        return result;
      },
    );

    await useChatStore.getState().regenerate();
    await vi.waitFor(() => expect(useChatStore.getState().streaming).toBeNull());

    expect(mocks.api.truncateConversation).toHaveBeenCalledWith('conv-1', 'assistant-1');
    const messages = useChatStore.getState().messagesByConversation['conv-1'];
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(messages[1].content).toBe('nova resposta');
  });
});

describe('chatStore other actions', () => {
  it('stop() cancels the active turn', async () => {
    useChatStore.setState({
      streaming: {
        turnId: 'turn-9',
        conversationId: 'conv-1',
        assistantId: 'assistant-1',
        userMessageId: 'user-1',
        phase: 'text',
        step: 1,
        startedAt: Date.now(),
      },
    });
    await useChatStore.getState().stop();
    expect(mocks.api.cancelTurn).toHaveBeenCalledWith('turn-9');
  });

  it('openConversation loads messages and artifacts', async () => {
    const detail: ConversationDetail = {
      conversation: conversation({ messageCount: 2 }),
      messages: [userMessage(), assistantMessage()],
    };
    mocks.api.getConversation.mockResolvedValue(detail);
    mocks.api.listArtifacts.mockResolvedValue([
      {
        id: 'artifact-1',
        conversationId: 'conv-1',
        name: 'relatorio.md',
        mimeType: 'text/markdown',
        kind: 'markdown',
        size: 120,
        createdAt: 1,
      },
    ]);

    await useChatStore.getState().openConversation('conv-1');

    expect(useChatStore.getState().messagesByConversation['conv-1']).toHaveLength(2);
    expect(useUiStore.getState().artifacts).toHaveLength(1);
    expect(useUiStore.getState().artifacts[0].name).toBe('relatorio.md');
  });

  it('deleteConversation removes the conversation and clears its messages', async () => {
    useChatStore.setState({
      conversations: [conversation()],
      activeId: 'conv-1',
      messagesByConversation: { 'conv-1': [userMessage()] },
    });
    await useChatStore.getState().deleteConversation('conv-1');
    expect(useChatStore.getState().conversations).toHaveLength(0);
    expect(useChatStore.getState().messagesByConversation['conv-1']).toBeUndefined();
  });

  it('ships the DeepSeek V4.1 Flash model in the bundled catalog', () => {
    const go = catalog.providers.find((provider) => provider.id === 'opencode-go');
    expect(go?.models.some((model) => model.id === 'deepseek-v4.1-flash')).toBe(true);
  });
});

describe('model lock', () => {
  it('locks as soon as the conversation has messages, is streaming or is known to be non-empty', () => {
    expect(selectModelLocked(useChatStore.getState())).toBe(false);

    useChatStore.setState({
      activeId: 'conv-1',
      conversations: [conversation({ messageCount: 0 })],
      messagesByConversation: { 'conv-1': [] },
    });
    expect(selectModelLocked(useChatStore.getState())).toBe(false);

    useChatStore.setState({ messagesByConversation: { 'conv-1': [userMessage()] } });
    expect(selectModelLocked(useChatStore.getState())).toBe(true);

    // The conversation list alone already says the conversation started.
    useChatStore.setState({
      messagesByConversation: {},
      conversations: [conversation({ messageCount: 2 })],
    });
    expect(selectModelLocked(useChatStore.getState())).toBe(true);

    // A running turn also locks the model.
    useChatStore.setState({
      messagesByConversation: {},
      conversations: [conversation({ messageCount: 0 })],
      streaming: {
        turnId: 'turn-1',
        conversationId: 'conv-1',
        assistantId: 'assistant-1',
        userMessageId: 'user-1',
        phase: 'text',
        step: 1,
        startedAt: Date.now(),
      },
    });
    expect(selectModelLocked(useChatStore.getState())).toBe(true);
  });

  it('syncs the active selection to the conversation model when opening a started conversation', async () => {
    mocks.api.getConversation.mockResolvedValue({
      conversation: conversation({
        providerId: 'opencode-go',
        modelId: 'glm-5.3-flash',
        messageCount: 2,
      }),
      messages: [userMessage(), assistantMessage()],
    });

    await useChatStore.getState().openConversation('conv-1');

    expect(useAppStore.getState().selection).toMatchObject({
      providerId: 'opencode-go',
      modelId: 'glm-5.3-flash',
    });
  });

  it('does not change the selection when opening an empty conversation', async () => {
    mocks.api.getConversation.mockResolvedValue({
      conversation: conversation({
        providerId: 'opencode-zen',
        modelId: 'gpt-6-luna',
        messageCount: 0,
      }),
      messages: [],
    });

    await useChatStore.getState().openConversation('conv-2');

    expect(useAppStore.getState().selection.modelId).toBe('deepseek-v4.1-flash');
  });

  it('startNewConversation resets the composer to the configured defaults after a started conversation', async () => {
    useChatStore.setState({
      activeId: 'conv-1',
      conversations: [conversation({ messageCount: 2 })],
      messagesByConversation: { 'conv-1': [userMessage(), assistantMessage()] },
    });
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        defaultProvider: 'opencode-go',
        defaultModel: 'glm-5.3-flash',
        reasoningDefault: 'high',
      },
    });
    mocks.api.createConversation.mockResolvedValue(
      conversation({ id: 'conv-2', title: 'Nova conversa', messageCount: 0 }),
    );

    await useChatStore.getState().startNewConversation();

    expect(useAppStore.getState().selection).toEqual({
      providerId: 'opencode-go',
      modelId: 'glm-5.3-flash',
      reasoning: { mode: 'effort', effort: 'high' },
    });
  });

  it('keeps the current selection when starting a new chat from the welcome screen', async () => {
    useAppStore.setState({
      selection: {
        providerId: 'opencode-go',
        modelId: 'qwen3.8-flash',
        reasoning: { mode: 'effort', effort: 'low' },
      },
    });
    mocks.api.createConversation.mockResolvedValue(
      conversation({ id: 'conv-3', title: 'Nova conversa', messageCount: 0 }),
    );

    await useChatStore.getState().startNewConversation();

    expect(useAppStore.getState().selection.modelId).toBe('qwen3.8-flash');
  });

  it('send keeps the conversation model even if the global selection was mutated', async () => {
    useChatStore.setState({
      activeId: 'conv-1',
      conversations: [conversation({ messageCount: 2 })],
      messagesByConversation: { 'conv-1': [userMessage(), assistantMessage()] },
    });
    // Simulates any surface bypassing the UI lock.
    useAppStore.setState({
      selection: {
        providerId: 'opencode-go',
        modelId: 'glm-5.3-flash',
        reasoning: { mode: 'effort', effort: 'low' },
      },
    });

    const payloads: TurnPayload[] = [];
    mocks.api.runTurn.mockImplementation(
      async (payload: TurnPayload, onEvent: (event: TurnEvent) => void) => {
        payloads.push(payload);
        onEvent({
          type: 'turn_started',
          turnId: payload.turnId!,
          userMessageId: 'user-2',
          assistantMessageId: 'assistant-2',
        });
        const result = {
          userMessage: userMessage({ id: 'user-2' }),
          assistantMessage: assistantMessage({ id: 'assistant-2', content: 'ok' }),
          usage: null,
          error: null,
          conversation: conversation({ messageCount: 4 }),
        };
        onEvent({ type: 'done', result });
        return result;
      },
    );

    await useChatStore.getState().send('continua');
    await vi.waitFor(() => expect(useChatStore.getState().streaming).toBeNull());

    expect(payloads[0]).toMatchObject({
      providerId: 'opencode-go',
      modelId: 'deepseek-v4.1-flash',
    });
  });

  it('regenerate keeps the conversation model even if the global selection was mutated', async () => {
    useChatStore.setState({
      activeId: 'conv-1',
      conversations: [conversation({ messageCount: 2 })],
      messagesByConversation: { 'conv-1': [userMessage(), assistantMessage()] },
    });
    useAppStore.setState({
      selection: {
        providerId: 'opencode-go',
        modelId: 'glm-5.3-flash',
        reasoning: { mode: 'effort', effort: 'low' },
      },
    });

    const payloads: TurnPayload[] = [];
    mocks.api.runTurn.mockImplementation(
      async (payload: TurnPayload, onEvent: (event: TurnEvent) => void) => {
        payloads.push(payload);
        onEvent({
          type: 'turn_started',
          turnId: payload.turnId!,
          userMessageId: 'user-1',
          assistantMessageId: 'assistant-2',
        });
        const result = {
          userMessage: userMessage(),
          assistantMessage: assistantMessage({ id: 'assistant-2', content: 'nova' }),
          usage: null,
          error: null,
          conversation: conversation({ messageCount: 2 }),
        };
        onEvent({ type: 'done', result });
        return result;
      },
    );

    await useChatStore.getState().regenerate();
    await vi.waitFor(() => expect(useChatStore.getState().streaming).toBeNull());

    expect(payloads[0]).toMatchObject({
      providerId: 'opencode-go',
      modelId: 'deepseek-v4.1-flash',
    });
  });
});
