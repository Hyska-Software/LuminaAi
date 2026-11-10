// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProviderAuthStatus, ProviderInfo } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(async () => true),
}));

vi.mock('@/components/chat/external', () => ({ openExternalUrl: mocks.openExternalUrl }));

// Imported after the mock above.
import { useAppStore } from '@/lib/store';
import { CHATGPT_USAGE_URL } from '@/components/chat/turnError';
import { PlanUsageChip } from './PlanUsageChip';

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
      agentNameHint: 'Zylara',
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

function seedApp(provider: ProviderInfo | null, auth: ProviderAuthStatus | null): void {
  useAppStore.setState({
    providers: provider ? [provider] : [],
    auth: auth ? [auth] : [],
    keys: [],
    selection: {
      providerId: provider?.id ?? 'openai',
      modelId: provider?.defaultModelId ?? '',
      reasoning: null,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seedApp(openAiProvider(), signedIn());
});

afterEach(() => {
  cleanup();
  seedApp(null, null);
});

describe('PlanUsageChip', () => {
  it('mostra o selo "Plano ChatGPT" e abre o dashboard de uso externamente', () => {
    render(<PlanUsageChip />);

    expect(screen.getByText('Plano ChatGPT')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gerenciar uso do plano ChatGPT' }));

    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://chatgpt.com/settings/usage');
  });

  it('não mostra percentual nem reset de cota (a API não expõe esses dados)', () => {
    const { container } = render(<PlanUsageChip />);
    expect(container.textContent ?? '').not.toMatch(/%|restante|renova em/i);
  });

  it('não aparece quando a conta não usa o plano (planUsage=false)', () => {
    seedApp(openAiProvider(), signedIn({ planUsage: false }));
    const { container } = render(<PlanUsageChip />);
    expect(container.firstChild).toBeNull();
  });

  it('não aparece quando a sessão não está ativa (reauth-required)', () => {
    seedApp(openAiProvider(), signedIn({ state: 'reauth-required' }));
    const { container } = render(<PlanUsageChip />);
    expect(container.firstChild).toBeNull();
  });

  it('não aparece para provedor sem OAuth (API key)', () => {
    seedApp(openAiProvider({ id: 'opencode-go', auth: 'api-key', oauth: undefined }), null);
    const { container } = render(<PlanUsageChip />);
    expect(container.firstChild).toBeNull();
  });

  it('não aparece durante o boot (lista de provedores vazia)', () => {
    seedApp(null, null);
    const { container } = render(<PlanUsageChip />);
    expect(container.firstChild).toBeNull();
  });

  it('cai no dashboard do ChatGPT quando o provedor não tem consoleUrl', () => {
    seedApp(openAiProvider({ consoleUrl: '' }), signedIn());
    render(<PlanUsageChip />);

    fireEvent.click(screen.getByRole('button', { name: 'Gerenciar uso do plano ChatGPT' }));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(CHATGPT_USAGE_URL);
  });
});
