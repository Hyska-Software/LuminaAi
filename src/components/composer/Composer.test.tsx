// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CacheStats, Conversation, ProviderAuthStatus, ProviderInfo, ProviderKeyStatus } from '@/lib/types';
import type { CacheConversationUi } from '@/lib/store/cacheStore';
import type { StreamingState } from '@/lib/store/chatStore';

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(async () => true),
}));

vi.mock('@/components/chat/external', () => ({ openExternalUrl: mocks.openExternalUrl }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }));
// The model pill has its own suite (ui-systems); here it only needs to exist.
vi.mock('@/components/models/ModelPill', () => ({
  ModelPill: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      Modelo
    </button>
  ),
}));

// Imported after the mocks above.
import { useAppStore, useChatStore, useUiStore } from '@/lib/store';
import { useCacheStore } from '@/lib/store/cacheStore';
import { Composer } from './Composer';

function openAiProvider(overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    id: 'openai',
    name: 'OpenAI (ChatGPT)',
    shortName: 'ChatGPT',
    description: '',
    baseUrl: 'https://api.openai.com/v1',
    consoleUrl: 'https://chatgpt.com/settings/usage',
    endpoints: { 'openai-responses': '/responses', models: '/models' },
    authEnv: 'OPENAI_API_KEY',
    defaultModelId: 'gpt-6.1-sol',
    auth: 'oauth',
    requestProfiles: { oauth: 'chatgpt-plan', apiKey: 'standard' },
    oauth: {
      issuer: 'https://auth.openai.com',
      registrationClientId: 'dynamic_agent_client',
      agentNameHint: 'Lumina',
      resource: 'https://api.openai.com/v1',
      scopes: ['openid', 'chatgpt.tokens.use.direct'],
      planUsageScope: 'chatgpt.tokens.use.direct',
      callbackPath: '/auth/callback',
      loopbackHost: '127.0.0.1',
    },
    models: [],
    notes: [],
    ...overrides,
  };
}

function signedIn(overrides: Partial<ProviderAuthStatus> = {}): ProviderAuthStatus {
  return {
    providerId: 'openai',
    mode: 'oauth',
    state: 'signed-in',
    planUsage: true,
    scopes: ['openid', 'chatgpt.tokens.use.direct'],
    ...overrides,
  };
}

function apiKey(providerId = 'openai'): ProviderKeyStatus {
  return { providerId, hasKey: true, source: 'settings', mode: 'api-key' };
}

function seedApp(options: {
  provider?: ProviderInfo | null;
  auth?: ProviderAuthStatus | null;
  keys?: ProviderKeyStatus[];
}): void {
  const provider = options.provider === undefined ? openAiProvider() : options.provider;
  useAppStore.setState({
    providers: provider ? [provider] : [],
    auth: options.auth ? [options.auth] : [],
    keys: options.keys ?? [],
    selection: {
      providerId: provider?.id ?? 'openai',
      modelId: provider?.defaultModelId ?? '',
      reasoning: null,
    },
  });
}

function typeMessage(value = 'Olá'): void {
  fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem para o Lumina' }), {
    target: { value },
  });
}

const sendButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Enviar mensagem' }) as HTMLButtonElement;

function chatConversation(id = 'conv-chat'): Conversation {
  return {
    id,
    title: 'Conversa de teste',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    providerId: 'openai',
    modelId: 'gpt-6.1-sol',
    messageCount: 0,
    mode: 'chat',
  };
}

function cacheStats(overrides: Partial<CacheStats> = {}): CacheStats {
  return {
    hitPercent: 98,
    sessionHitPercent: 97,
    steadyHitPercent: 98.2,
    ceilingPercent: 98.6,
    inputTotal: 250_000,
    cacheRead: 240_000,
    cacheWrite: 6_000,
    uncached: 4_000,
    eligible: true,
    state: 'stable',
    epoch: 1,
    samples: 12,
    ttlSeconds: 3600,
    at: Date.now(),
    ...overrides,
  };
}

function cacheUi(): CacheConversationUi {
  return {
    current: cacheStats(),
    session: cacheStats(),
    epoch: 1,
    samples: [
      {
        turnId: 'turn-1',
        step: 4,
        providerId: 'openai',
        modelId: 'gpt-6.1-sol',
        protocol: 'openai-responses',
        epoch: 1,
        inputTotal: 250_000,
        cacheRead: 240_000,
        cacheWrite: 6_000,
        uncached: 4_000,
        hitPercent: 98,
        ceilingPercent: 98.6,
        eligible: true,
        state: 'stable',
        at: Date.now(),
      },
    ],
    lastBreak: null,
    restored: true,
  };
}

function seedActiveChat(conversationId = 'conv-chat'): void {
  useChatStore.setState({
    activeId: conversationId,
    conversations: [chatConversation(conversationId)],
  });
}

function streamingState(overrides: Partial<StreamingState> = {}): StreamingState {
  return {
    turnId: 'turn-1',
    conversationId: 'conv-chat',
    assistantId: 'assistant-1',
    userMessageId: 'user-1',
    phase: 'tool',
    step: 1,
    startedAt: Date.now(),
    turnKind: 'user',
    ...overrides,
  };
}

function composerActivity(): HTMLElement {
  return screen.getByTestId('composer-activity');
}

function setShowCacheIndicator(showIndicator: boolean): void {
  useAppStore.setState((state) => ({
    settings: {
      ...state.settings,
      cache: {
        showIndicator,
        anthropicTtl: state.settings.cache?.anthropicTtl ?? '1h',
        openaiRetention: state.settings.cache?.openaiRetention ?? null,
      },
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({
    streaming: null,
    pendingAttachments: [],
    error: null,
    errorCode: null,
    errorHint: null,
    activeId: null,
  });
  useCacheStore.getState().reset();
  useUiStore.setState({ settingsOpen: false, layoutMode: 'chat' });
  seedApp({ auth: signedIn() });
});

afterEach(() => {
  cleanup();
  seedApp({ provider: null, auth: null });
  useChatStore.setState({ activeId: null, conversations: [] });
  useCacheStore.getState().reset();
  setShowCacheIndicator(true);
  useAppStore.setState((state) => ({
    settings: { ...state.settings, reduceMotion: false },
  }));
});

describe('Composer — gate de envio (D9)', () => {
  it('desabilita o envio e mostra o CTA de Provedores quando falta credencial', () => {
    seedApp({ auth: null });
    render(<Composer />);

    typeMessage();
    expect(sendButton().disabled).toBe(true);
    expect(screen.getByText(/Entre com sua conta ChatGPT/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir Provedores' }));

    expect(useUiStore.getState().settingsOpen).toBe(true);
    expect(useUiStore.getState().settingsTab).toBe('providers');
  });

  it('descreve o aviso do compositor pelo textarea (aria-describedby)', () => {
    seedApp({ auth: null });
    render(<Composer />);

    const textarea = screen.getByRole('textbox', { name: 'Mensagem para o Lumina' });
    expect(textarea.getAttribute('aria-describedby')).toBe('composer-credential-notice');
  });

  it('habilita o envio com API key salva', () => {
    seedApp({ auth: null, keys: [apiKey()] });
    render(<Composer />);

    typeMessage();
    expect(sendButton().disabled).toBe(false);
    expect(screen.queryByText(/adicionar uma API key|Adicione a API key/i)).toBeNull();
  });

  it('habilita o envio com a conta ChatGPT conectada', () => {
    render(<Composer />);

    typeMessage();
    expect(sendButton().disabled).toBe(false);
  });

  it('mantém o compositor habilitado quando o catálogo está vazio (boot/testes)', () => {
    seedApp({ provider: null, auth: null });
    render(<Composer />);

    typeMessage();
    expect(sendButton().disabled).toBe(false);
  });
});

describe('Composer — variant por layoutMode (Chat | Code)', () => {
  it('no modo Chat mantém placeholder e rótulo atuais', () => {
    render(<Composer />);

    const textarea = screen.getByRole('textbox', { name: 'Mensagem para o Lumina' });
    expect(textarea.getAttribute('placeholder')).toBe('Pergunte alguma coisa…');
  });

  it('no modo Code usa a copy de tarefa para o agente', () => {
    useUiStore.setState({ layoutMode: 'code' });
    render(<Composer />);

    const textarea = screen.getByRole('textbox', { name: 'Tarefa para o agente' });
    expect(textarea.getAttribute('placeholder')).toBe('Descreva a tarefa para o agente…');
    expect(screen.queryByRole('textbox', { name: 'Mensagem para o Lumina' })).toBeNull();
  });

  it('troca a copy ao alternar o modo sem perder o rascunho nem o envio', () => {
    render(<Composer />);
    typeMessage('Corrigir o build');
    expect(sendButton().disabled).toBe(false);

    act(() => useUiStore.getState().setLayoutMode('code'));

    const textarea = screen.getByRole('textbox', { name: 'Tarefa para o agente' }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Corrigir o build');
    expect(sendButton().disabled).toBe(false);
  });

  it('no modo Chat mantém os pills de ferramentas e não mostra os controles da sessão', () => {
    render(<Composer />);

    expect(screen.getByRole('button', { name: 'Busca web' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar arquivos' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Modo de permissão/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Modo Plano' })).toBeNull();
  });
});

describe('Composer — chip de cache no Chat', () => {
  it('mostra o chip cache-first antes do ModelPill quando a conversa ativa tem amostras', () => {
    seedActiveChat();
    useCacheStore.setState({ byConversation: { 'conv-chat': cacheUi() } });
    render(<Composer />);

    const chip = screen.getByRole('button', { name: 'Cache de prompt: 98% de acerto' });
    const modelPill = screen.getByRole('button', { name: 'Modelo' });
    // O chip fica antes do ModelPill na fileira de controles.
    expect(
      chip.compareDocumentPosition(modelPill) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(chip.className).toContain('h-8');
  });

  it('não mostra o chip sem conversa ativa', () => {
    useCacheStore.setState({ byConversation: { 'conv-chat': cacheUi() } });
    render(<Composer />);

    expect(screen.queryByRole('button', { name: /^Cache de prompt:/ })).toBeNull();
  });

  it('não mostra o chip no layout Code (o header já hospeda o medidor)', () => {
    seedActiveChat();
    useCacheStore.setState({ byConversation: { 'conv-chat': cacheUi() } });
    useUiStore.setState({ layoutMode: 'code' });
    render(<Composer />);

    expect(screen.queryByRole('button', { name: /^Cache de prompt:/ })).toBeNull();
  });

  it('respeita Settings.cache.showIndicator = false', () => {
    seedActiveChat();
    useCacheStore.setState({ byConversation: { 'conv-chat': cacheUi() } });
    setShowCacheIndicator(false);
    render(<Composer />);

    expect(screen.queryByRole('button', { name: /^Cache de prompt:/ })).toBeNull();
  });

  it('não mostra o chip antes de existir amostra/restauração', () => {
    seedActiveChat();
    useCacheStore.setState({
      byConversation: {
        'conv-chat': {
          current: null,
          session: null,
          epoch: 0,
          samples: [],
          lastBreak: null,
          restored: true,
        },
      },
    });
    render(<Composer />);

    expect(screen.queryByRole('button', { name: /^Cache de prompt:/ })).toBeNull();
  });
});

describe('Composer — indicador de execução', () => {
  it('orbita o perímetro inteiro nos dois layouts durante o streaming', () => {
    useChatStore.setState({ streaming: streamingState() });
    render(<Composer />);

    expect(composerActivity().getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('button', { name: 'Parar resposta' })).toBeTruthy();

    act(() => useUiStore.getState().setLayoutMode('code'));

    expect(composerActivity().getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('button', { name: 'Parar resposta' })).toBeTruthy();
  });

  it('mantém o indicador estático quando reduceMotion está ativo', () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, reduceMotion: true },
    }));
    useChatStore.setState({ streaming: streamingState() });
    render(<Composer />);

    expect(composerActivity().getAttribute('data-active')).toBe('true');
    expect(composerActivity().getAttribute('data-motion')).toBe('reduced');
  });
});
