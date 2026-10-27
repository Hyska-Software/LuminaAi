// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProviderAuthStatus, ProviderInfo, ProviderKeyStatus } from '@/lib/types';

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

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({
    streaming: null,
    pendingAttachments: [],
    error: null,
    errorCode: null,
    errorHint: null,
  });
  useUiStore.setState({ settingsOpen: false, layoutMode: 'chat' });
  seedApp({ auth: signedIn() });
});

afterEach(() => {
  cleanup();
  seedApp({ provider: null, auth: null });
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
});
