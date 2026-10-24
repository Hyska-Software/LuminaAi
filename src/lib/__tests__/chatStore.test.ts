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
import { useChatStore } from '@/lib/store/chatStore';
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
