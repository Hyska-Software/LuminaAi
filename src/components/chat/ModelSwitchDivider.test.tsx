// @vitest-environment jsdom
/**
 * Divisor "Modelo alterado" no transcript. A detecção é pura (mensagens ->
 * rota) e o componente é só apresentação: texto visível em pt-BR (nunca só
 * cor), provedor no `title`/`aria-label` e nome do catálogo com fallback para o
 * id persistido.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ChatMessage } from '@/lib/types';
import {
  ModelSwitchDivider,
  detectModelSwitch,
  modelSwitchAt,
  resolveModelRoute,
  type ModelRoute,
} from './ModelSwitchDivider';

function assistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-1',
    conversationId: 'conv-1',
    role: 'assistant',
    content: 'Resposta.',
    status: 'complete',
    toolCalls: [],
    citations: [],
    attachments: [],
    createdAt: 1,
    ...overrides,
  };
}

function user(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return assistant({ role: 'user', content: 'Pergunta.', ...overrides });
}

const GO_FLASH = { providerId: 'opencode-go', modelId: 'deepseek-v4.1-flash' } as const;
const ZEN_FLASH = { providerId: 'opencode-zen', modelId: 'deepseek-v4.1-flash' } as const;
const GO_LUNA = { providerId: 'opencode-go', modelId: 'gpt-6-luna' } as const;

afterEach(() => {
  cleanup();
});

describe('detectModelSwitch — detecção pura da troca', () => {
  it('mesma rota não gera divisor', () => {
    expect(detectModelSwitch(assistant(GO_FLASH), assistant(GO_FLASH))).toBeNull();
  });

  it('troca de modelo devolve a rota nova', () => {
    expect(detectModelSwitch(assistant(GO_LUNA), assistant(GO_FLASH))).toEqual(GO_LUNA);
  });

  it('troca só de provedor com o mesmo modelId devolve a rota nova', () => {
    expect(detectModelSwitch(assistant(ZEN_FLASH), assistant(GO_FLASH))).toEqual(ZEN_FLASH);
  });

  it('a primeira resposta da conversa nunca gera divisor', () => {
    expect(detectModelSwitch(assistant(GO_FLASH), null)).toBeNull();
    expect(detectModelSwitch(assistant(GO_FLASH), undefined)).toBeNull();
  });

  it('mensagens sem modelId são ignoradas', () => {
    expect(detectModelSwitch(assistant({ providerId: 'opencode-go' }), assistant(GO_FLASH))).toBeNull();
    expect(detectModelSwitch(assistant(GO_FLASH), assistant({ providerId: 'opencode-go' }))).toBeNull();
  });

  it('não gera divisor para mensagem que não é assistant', () => {
    expect(detectModelSwitch(user(GO_LUNA), assistant(GO_FLASH))).toBeNull();
  });

  it('resolveModelRoute devolve a rota e null sem modelId', () => {
    expect(resolveModelRoute(assistant(GO_FLASH))).toEqual(GO_FLASH);
    expect(resolveModelRoute(assistant({ modelId: null }))).toBeNull();
    expect(resolveModelRoute(assistant({ modelId: 'gpt-6-luna' }))).toEqual({
      providerId: null,
      modelId: 'gpt-6-luna',
    });
  });
});

describe('modelSwitchAt — varredura do transcript', () => {
  it('a primeira assistant não gera divisor mesmo com usuário antes', () => {
    expect(modelSwitchAt([user(), assistant(GO_FLASH)], 1)).toBeNull();
  });

  it('detecta a troca depois de mensagens de usuário', () => {
    const messages = [user(), assistant(GO_FLASH), user(), assistant(GO_LUNA)];

    expect(modelSwitchAt(messages, 1)).toBeNull();
    expect(modelSwitchAt(messages, 3)).toEqual(GO_LUNA);
  });

  it('ignora assistant sem modelId ao procurar a rota anterior', () => {
    const messages = [
      user(),
      assistant(GO_FLASH),
      user(),
      assistant({ providerId: 'opencode-go' }),
      user(),
      assistant(ZEN_FLASH),
    ];

    expect(modelSwitchAt(messages, 3)).toBeNull();
    expect(modelSwitchAt(messages, 5)).toEqual(ZEN_FLASH);
  });

  it('mensagem de usuário nunca gera divisor', () => {
    expect(modelSwitchAt([user(), assistant(GO_FLASH)], 0)).toBeNull();
  });
});

describe('ModelSwitchDivider — apresentação', () => {
  const renderDivider = (route: ModelRoute) => render(<ModelSwitchDivider route={route} />);

  it('mostra o texto visível e o provedor no title/aria quando conhecido', () => {
    renderDivider({ providerId: 'openai', modelId: 'gpt-6-luna' });

    const divider = screen.getByRole('separator', {
      name: 'Modelo alterado para GPT-6 Luna · ChatGPT',
    });
    expect(divider.getAttribute('title')).toBe('Modelo alterado para GPT-6 Luna · ChatGPT');
    expect(divider.textContent).toContain('Modelo alterado para GPT-6 Luna');
    // O ícone é decorativo; o texto carrega a informação (não só cor).
    expect(divider.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('sem provedor conhecido, o texto visível é o nome acessível', () => {
    // `gpt-5.6` só existe no provedor openai — o nome sai do findModel sem ambiguidade.
    renderDivider({ providerId: null, modelId: 'gpt-5.6' });

    const divider = screen.getByRole('separator', { name: 'Modelo alterado para GPT-5.6' });
    expect(divider.textContent).toContain('Modelo alterado para GPT-5.6');
    expect(divider.textContent).not.toContain('·');
  });

  it('cai para o id do modelo quando o catálogo não conhece', () => {
    renderDivider({ providerId: 'opencode-go', modelId: 'modelo-inexistente' });

    expect(screen.getByText('Modelo alterado para modelo-inexistente')).toBeTruthy();
    expect(screen.getByRole('separator').getAttribute('title')).toBe(
      'Modelo alterado para modelo-inexistente · Go',
    );
  });
});
