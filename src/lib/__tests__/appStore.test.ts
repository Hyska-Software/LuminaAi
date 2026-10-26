// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CatalogView,
  LoginChallenge,
  ModelInfo,
  ProviderAuthStatus,
  ProviderInfo,
  Settings,
  SettingsView,
} from '@/lib/types';

const mocks = vi.hoisted(() => {
  const api = {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    setProviderKey: vi.fn(),
    getCatalog: vi.fn(),
    refreshCatalog: vi.fn(),
    listRemoteModels: vi.fn(),
    refreshProviderModels: vi.fn(),
    appInfo: vi.fn(),
    validateProvider: vi.fn(),
    openaiLoginStart: vi.fn(),
    openaiLoginWait: vi.fn(),
    openaiLoginCancel: vi.fn(),
    openaiSignOut: vi.fn(),
    openaiAuthStatus: vi.fn(),
  };
  return { api };
});

vi.mock('@/lib/api', () => ({ api: mocks.api }));

import { useAppStore, favoriteKey } from '@/lib/store/appStore';

const settings: Settings = {
  theme: 'system',
  locale: 'pt-BR',
  defaultProvider: 'openai',
  defaultModel: 'gpt-6.1-sol',
  reasoningDefault: 'max',
  systemPrompt: '',
  webSearchEnabled: true,
  fileCreationEnabled: true,
  maxSteps: 64,
  sendKey: 'enter',
  showTokenUsage: true,
  reduceMotion: false,
  fontScale: 1,
  temperature: null,
  includeAttachments: true,
  autoTitle: true,
  codeExecutionEnabled: false,
  codeTimeoutSecs: 120,
  codePythonPath: '',
  codeNodePath: '',
  skillsPanelEnabled: true,
  disabledSkills: [],
};

function model(id: string, name: string, overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id,
    name,
    family: 'gpt',
    protocols: ['openai-responses'],
    reasoning: true,
    reasoningOptions: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
    attachment: true,
    modalities: { input: ['text', 'image'], output: ['text'] },
    contextWindow: 400_000,
    maxOutput: 32_768,
    openWeights: false,
    tags: [],
    status: 'stable',
    ...overrides,
  };
}

const openaiProvider: ProviderInfo = {
  id: 'openai',
  name: 'OpenAI (ChatGPT)',
  shortName: 'ChatGPT',
  description: 'OpenAI',
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
  models: [
    model('gpt-6.1-sol', 'GPT-6.1 Sol'),
    model('gpt-account-only', 'Conta only', { estimated: true }),
  ],
  notes: [],
};

function authStatus(overrides: Partial<ProviderAuthStatus> = {}): ProviderAuthStatus {
  return {
    providerId: 'openai',
    mode: 'oauth',
    state: 'signed-in',
    accountLabel: 'user@example.com',
    planUsage: true,
    expiresAt: Date.now() + 3_600_000,
    scopes: ['openid', 'chatgpt.tokens.use.direct'],
    clientIdMasked: 'oaiapp_a…1234',
    hostIdMasked: 'urn:uuid:…',
    hint: null,
    ...overrides,
  };
}

function settingsView(overrides: Partial<SettingsView> = {}): SettingsView {
  return {
    settings,
    keys: [{ providerId: 'openai', hasKey: true, masked: null, source: 'chatgpt', mode: 'oauth' }],
    auth: [authStatus()],
    secretsError: null,
    ...overrides,
  };
}

function catalogView(providerOverrides: Partial<ProviderInfo> = {}): CatalogView {
  return {
    catalog: {
      version: 1,
      generatedAt: '2026-10-26T00:00:00.000Z',
      sources: {},
      providers: [{ ...openaiProvider, ...providerOverrides }],
    },
    keys: [{ providerId: 'openai', hasKey: true, masked: null, source: 'chatgpt', mode: 'oauth' }],
    auth: [authStatus()],
    remoteRefreshedAt: 1_700_000_000_000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAppStore.setState({
    ready: false,
    initializing: false,
    appInfo: null,
    settings,
    keys: [],
    auth: [],
    secretsError: null,
    providers: [],
    selection: { providerId: 'openai', modelId: 'gpt-6.1-sol', reasoning: null },
    favorites: [],
    error: null,
    catalogRefreshedAt: null,
    loginChallenge: null,
  });
  mocks.api.getSettings.mockResolvedValue(settingsView());
  mocks.api.getCatalog.mockResolvedValue(catalogView());
  mocks.api.appInfo.mockResolvedValue({ name: 'Lumina' });
});

describe('appStore — OpenAI plan usage', () => {
  it('loads the merged catalog view, auth statuses and secrets error', async () => {
    mocks.api.getSettings.mockResolvedValue(settingsView({ secretsError: 'arquivo inválido' }));
    await useAppStore.getState().init();
    const state = useAppStore.getState();
    expect(state.ready).toBe(true);
    expect(state.providers.map((provider) => provider.id)).toContain('openai');
    expect(state.providers[0].models.map((entry) => entry.id)).toContain('gpt-account-only');
    expect(state.auth[0].state).toBe('signed-in');
    expect(state.secretsError).toBe('arquivo inválido');
    expect(state.selection.providerId).toBe('openai');
    expect(state.selection.modelId).toBe('gpt-6.1-sol');
  });

  it('keeps a persisted account-only model across restarts', async () => {
    useAppStore.setState({
      selection: { providerId: 'openai', modelId: 'gpt-account-only', reasoning: null },
    });
    await useAppStore.getState().init();
    expect(useAppStore.getState().selection.modelId).toBe('gpt-account-only');
  });

  it('reports readiness from OAuth status or API key', () => {
    useAppStore.setState({ providers: [openaiProvider], keys: [], auth: [authStatus()] });
    expect(useAppStore.getState().providerReady('openai')).toBe(true);

    useAppStore.setState({ auth: [], keys: [{ providerId: 'openai', hasKey: true, source: 'settings', mode: 'api-key' }] });
    expect(useAppStore.getState().providerReady('openai')).toBe(true);

    useAppStore.setState({ auth: [authStatus({ state: 'signed-out' })], keys: [] });
    expect(useAppStore.getState().providerReady('openai')).toBe(false);
  });

  it('runs the two-phase login and refreshes auth + models', async () => {
    const challenge: LoginChallenge = {
      attemptId: 'a1',
      authUrl: 'https://auth.openai.com/api/accounts/authorize?x=1',
      expiresAt: Date.now() + 600_000,
    };
    mocks.api.openaiLoginStart.mockResolvedValue(challenge);
    mocks.api.openaiLoginWait.mockResolvedValue(authStatus());
    mocks.api.openaiAuthStatus.mockResolvedValue([authStatus()]);
    mocks.api.refreshProviderModels.mockResolvedValue(catalogView());

    const started = await useAppStore.getState().startChatGptLogin('openai');
    expect(started).toEqual(challenge);
    expect(useAppStore.getState().loginChallenge).toEqual(challenge);

    const status = await useAppStore.getState().awaitChatGptLogin('a1');
    expect(status.state).toBe('signed-in');
    expect(mocks.api.openaiLoginWait).toHaveBeenCalledWith('a1');
    expect(useAppStore.getState().loginChallenge).toBeNull();
    expect(mocks.api.refreshProviderModels).toHaveBeenCalledWith('openai');
    expect(useAppStore.getState().auth[0].state).toBe('signed-in');
  });

  it('clears the pending challenge on cancel and on login failure', async () => {
    mocks.api.openaiLoginStart.mockResolvedValue({
      attemptId: 'a1',
      authUrl: 'https://example',
      expiresAt: Date.now() + 1000,
    });
    mocks.api.openaiLoginCancel.mockResolvedValue(undefined);
    await useAppStore.getState().startChatGptLogin('openai');
    await useAppStore.getState().cancelChatGptLogin('a1');
    expect(useAppStore.getState().loginChallenge).toBeNull();

    mocks.api.openaiLoginWait.mockRejectedValue(new Error('denied'));
    await expect(useAppStore.getState().awaitChatGptLogin('a2')).rejects.toThrow('denied');
    expect(useAppStore.getState().loginChallenge).toBeNull();
    expect(useAppStore.getState().error).toContain('denied');
  });

  it('signs out and refreshes auth state', async () => {
    mocks.api.openaiSignOut.mockResolvedValue(authStatus({ state: 'signed-out', planUsage: false }));
    mocks.api.openaiAuthStatus.mockResolvedValue([
      authStatus({ state: 'signed-out', planUsage: false }),
    ]);
    await useAppStore.getState().signOutProvider('openai');
    expect(mocks.api.openaiSignOut).toHaveBeenCalledWith('openai');
    expect(useAppStore.getState().auth[0].state).toBe('signed-out');
  });

  it('keys favorites by provider and keeps legacy ids working', () => {
    const store = useAppStore.getState();
    store.toggleFavorite('openai', 'gpt-6.1-sol');
    expect(useAppStore.getState().favorites).toContain(favoriteKey('openai', 'gpt-6.1-sol'));
    expect(useAppStore.getState().isFavorite('openai', 'gpt-6.1-sol')).toBe(true);

    // Legacy bare id still matches (old persisted favorites).
    useAppStore.setState({ favorites: ['gpt-6.1-sol'] });
    expect(useAppStore.getState().isFavorite('openai', 'gpt-6.1-sol')).toBe(true);

    // Toggling once migrates the legacy entry to the pair key.
    useAppStore.getState().toggleFavorite('openai', 'gpt-6.1-sol');
    expect(useAppStore.getState().favorites).not.toContain('gpt-6.1-sol');
    expect(useAppStore.getState().isFavorite('openai', 'gpt-6.1-sol')).toBe(false);
  });
});
