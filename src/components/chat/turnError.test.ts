// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { i18n } from '@/lib/i18n';
import type { ProviderInfo } from '@/lib/types';
import {
  CHATGPT_USAGE_URL,
  PLAN_LIMIT_BODY,
  credentialGateMessage,
  planLimitDescription,
  planUsageUrl,
  turnErrorKind,
} from './turnError';

function provider(overrides: Partial<ProviderInfo> = {}): ProviderInfo {
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
    models: [],
    notes: [],
    ...overrides,
  };
}

describe('turnErrorKind', () => {
  it('classifica o código cru de limite do plano como plan-limit', () => {
    expect(turnErrorKind('subscription_sharing_usage_limit_exceeded')).toBe('plan-limit');
    expect(turnErrorKind('  subscription_sharing_usage_limit_exceeded  ')).toBe('plan-limit');
  });

  it('só trata rate_limited como limite quando o provedor ativo usa o plano', () => {
    expect(turnErrorKind('rate_limited')).toBeNull();
    expect(turnErrorKind('rate_limited', { planProvider: false })).toBeNull();
    expect(turnErrorKind('rate_limited', { planProvider: true })).toBe('plan-limit');
  });

  it('classifica inelegibilidade com e sem o código cru', () => {
    expect(turnErrorKind('subscription_sharing_user_not_eligible')).toBe('plan-not-eligible');
    expect(turnErrorKind('plan_not_eligible')).toBe('plan-not-eligible');
  });

  it('classifica falta/expiração de credencial como auth-required', () => {
    for (const code of [
      'auth_required',
      'missing_credentials',
      'subscription_sharing_invalid_user',
    ]) {
      expect(turnErrorKind(code)).toBe('auth-required');
    }
  });

  it('não classifica erros não relacionados (sem banner)', () => {
    for (const code of [
      'unsupported_capability',
      'route_not_supported',
      'plan_disabled',
      '',
      null,
      undefined,
    ]) {
      expect(turnErrorKind(code)).toBeNull();
    }
  });
});

describe('planUsageUrl', () => {
  it('usa o consoleUrl do catálogo quando presente', () => {
    expect(planUsageUrl(provider())).toBe('https://chatgpt.com/settings/usage');
    expect(planUsageUrl(provider({ consoleUrl: 'https://example.com/usage' }))).toBe(
      'https://example.com/usage',
    );
  });

  it('cai no dashboard do ChatGPT quando o provedor não tem consoleUrl', () => {
    expect(planUsageUrl(provider({ consoleUrl: '' }))).toBe(CHATGPT_USAGE_URL);
    expect(planUsageUrl(null)).toBe(CHATGPT_USAGE_URL);
  });
});

describe('planLimitDescription', () => {
  it('usa o hint do backend como corpo (o título vem do código)', () => {
    const hint = 'pode ser do plano ou deste app. Use "Gerenciar uso".';
    expect(planLimitDescription(hint)).toBe(hint);
  });

  it('usa a copy localizada quando não há hint', () => {
    expect(planLimitDescription(null)).toBe(i18n.t(PLAN_LIMIT_BODY));
    expect(planLimitDescription('   ')).toBe(i18n.t(PLAN_LIMIT_BODY));
  });

  it('não remove prefixos nem reescreve hints de plano', () => {
    const legacy = 'Limite de uso atingido — pode ser do plano ou deste app. Use "Gerenciar uso".';
    expect(planLimitDescription(legacy)).toBe(legacy);
    expect(planLimitDescription('O limite do seu plano será renovado em breve.')).toBe(
      'O limite do seu plano será renovado em breve.',
    );
  });
});

describe('credentialGateMessage', () => {
  it('fala do ChatGPT para provedores OAuth e da API key para os demais', () => {
    expect(credentialGateMessage(provider())).toContain('ChatGPT');
    expect(credentialGateMessage(provider({ id: 'opencode-go', auth: 'api-key' }))).toContain(
      'API key',
    );
  });
});
