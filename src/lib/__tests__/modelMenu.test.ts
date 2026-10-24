import { describe, expect, it } from 'vitest';
import { getModel, getProvider } from '@/lib/catalog';
import type { ModelInfo } from '@/lib/types';
import {
  buildEffortMenu,
  buildModelMenu,
  effortSegmentLabel,
  familyLabel,
  modelDetails,
  reasoningForModel,
} from '@/lib/modelMenu';

const go = getProvider('opencode-go')!;

function syntheticModel(overrides: Partial<ModelInfo>): ModelInfo {
  return {
    id: 'modelo-teste',
    name: 'Modelo Teste',
    family: 'default',
    protocols: ['openai-chat'],
    reasoning: true,
    reasoningOptions: [],
    attachment: false,
    modalities: { input: ['text'], output: ['text'] },
    contextWindow: 128_000,
    maxOutput: 16_384,
    cost: null,
    releaseDate: null,
    knowledge: null,
    openWeights: false,
    description: null,
    tags: [],
    status: 'stable',
    ...overrides,
  };
}

describe('buildModelMenu', () => {
  it('groups favorites first and then models by family', () => {
    const groups = buildModelMenu(go, 'deepseek-v4.1-flash', ['claude-haiku-5-5']);
    expect(groups[0].label).toBe('Favoritos');
    expect(groups[0].items.map((item) => item.modelId)).toEqual(['claude-haiku-5-5']);

    const labels = groups.map((group) => group.label);
    expect(labels).toContain('DeepSeek');
    expect(labels).toContain('GLM');
    expect(labels).toContain('Kimi');

    const deepseek = groups.find((group) => group.label === 'DeepSeek');
    expect(deepseek?.items.some((item) => item.modelId === 'deepseek-v4.1-flash')).toBe(true);
  });

  it('marks the current model', () => {
    const groups = buildModelMenu(go, 'deepseek-v4.1-flash');
    const current = groups.flatMap((group) => group.items).filter((item) => item.current);
    expect(current).toHaveLength(1);
    expect(current[0].modelId).toBe('deepseek-v4.1-flash');
  });

  it('does not list the current model twice', () => {
    const groups = buildModelMenu(go, 'claude-haiku-5-5', ['claude-haiku-5-5']);
    const ids = groups.flatMap((group) => group.items.map((item) => item.modelId));
    expect(ids.filter((id) => id === 'claude-haiku-5-5')).toHaveLength(1);
  });

  it('hides models that are unavailable on the gateway', () => {
    const provider = {
      ...go,
      models: [
        ...go.models,
        syntheticModel({ id: 'modelo-indisponivel', name: 'Indisponível', status: 'unavailable' }),
      ],
    };
    const groups = buildModelMenu(provider, 'deepseek-v4.1-flash');
    const ids = groups.flatMap((group) => group.items.map((item) => item.modelId));
    expect(ids).not.toContain('modelo-indisponivel');
  });

  it('keeps every provider model reachable', () => {
    const groups = buildModelMenu(go, 'deepseek-v4.1-flash');
    const ids = groups.flatMap((group) => group.items.map((item) => item.modelId));
    const usable = go.models.filter((model) => model.status !== 'unavailable');
    expect(ids).toHaveLength(usable.length);
  });
});

describe('familyLabel', () => {
  it('uses the curated display names', () => {
    expect(familyLabel('claude')).toBe('Claude');
    expect(familyLabel('deepseek')).toBe('DeepSeek');
    expect(familyLabel('minimax')).toBe('MiniMax');
    expect(familyLabel('gpt')).toBe('GPT');
  });

  it('capitalizes unknown families', () => {
    expect(familyLabel('nova-familia')).toBe('Nova-familia');
    expect(familyLabel('')).toBe('Outros');
  });
});

describe('buildEffortMenu', () => {
  const glm = getModel('opencode-go', 'glm-5.3-flash')!;
  const claude = getModel('opencode-go', 'claude-haiku-5-5')!;
  const minimax = getModel('opencode-go', 'minimax-m3')!;

  it('lists effort levels for effort-only models', () => {
    const items = buildEffortMenu(glm, { mode: 'effort', effort: 'max' });
    expect(items.map((item) => item.kind)).toEqual(['effort', 'effort', 'effort']);
    expect(items.map((item) => item.effort)).toEqual(['low', 'high', 'max']);
    expect(items.map((item) => item.label)).toEqual(['Baixo', 'Alto', 'Máximo']);
    expect(items.filter((item) => item.current)).toHaveLength(1);
    expect(items.find((item) => item.current)?.effort).toBe('max');
  });

  it('offers "Desligado" for models with a toggle', () => {
    const items = buildEffortMenu(claude, { mode: 'off' });
    expect(items[0].kind).toBe('off');
    expect(items[0].current).toBe(true);
    expect(items.filter((item) => item.kind === 'effort')).toHaveLength(5);
  });

  it('offers only the toggle for toggle-only models', () => {
    const items = buildEffortMenu(minimax, { mode: 'off' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'off', current: true });
  });

  it('derives budget presets when the model only accepts budget_tokens', () => {
    const budgetModel = syntheticModel({
      reasoningOptions: [{ type: 'budget_tokens', min: 2_048, max: 16_384 }],
    });
    const items = buildEffortMenu(budgetModel, { mode: 'budget', budget: 8_192 });
    expect(items.map((item) => item.kind)).toEqual(['budget', 'budget', 'budget']);
    expect(items.map((item) => item.budget)).toEqual([4_096, 8_192, 16_384]);
    expect(items.find((item) => item.current)?.budget).toBe(8_192);
  });

  it('returns no options without a model', () => {
    expect(buildEffortMenu(undefined, { mode: 'off' })).toEqual([]);
  });
});

describe('effortSegmentLabel', () => {
  const glm = getModel('opencode-go', 'glm-5.3-flash')!;
  const claude = getModel('opencode-go', 'claude-haiku-5-5')!;
  const noControl = syntheticModel({ reasoning: false, reasoningOptions: [] });

  it('labels effort, off and unsupported models', () => {
    expect(effortSegmentLabel(glm, { mode: 'effort', effort: 'max' })).toBe('Máximo');
    expect(effortSegmentLabel(glm, { mode: 'effort', effort: null })).toBe('Ligado');
    expect(effortSegmentLabel(claude, { mode: 'off' })).toBe('Off');
    expect(effortSegmentLabel(noControl, { mode: 'off' })).toBe('Sem controle');
    expect(effortSegmentLabel(undefined, null)).toBe('Sem controle');
  });

  it('labels budget selections', () => {
    expect(effortSegmentLabel(claude, { mode: 'budget', budget: 16_384 })).toBe('Profundo');
    expect(effortSegmentLabel(glm, { mode: 'budget', budget: 6_000 })).toBe('6k');
  });
});

describe('reasoningForModel', () => {
  const glm = getModel('opencode-go', 'glm-5.3-flash')!;
  const claude = getModel('opencode-go', 'claude-haiku-5-5')!;
  const deepseek = getModel('opencode-go', 'deepseek-v4.1-flash')!;
  const minimax = getModel('opencode-go', 'minimax-m3')!;
  const noControl = syntheticModel({ id: 'sem-controle', reasoning: false, reasoningOptions: [] });

  it('keeps the same effort when the next model supports it', () => {
    expect(reasoningForModel(glm, { mode: 'effort', effort: 'max' })).toEqual({
      mode: 'effort',
      effort: 'max',
    });
    expect(reasoningForModel(claude, { mode: 'effort', effort: 'max' })).toEqual({
      mode: 'effort',
      effort: 'max',
    });
  });

  it('falls back to the model default when the effort is unsupported', () => {
    // minimax-m3 only supports a toggle, so "max" cannot be preserved.
    expect(reasoningForModel(minimax, { mode: 'effort', effort: 'max' })).toEqual({ mode: 'off' });
    // deepseek default is effort high (first preferred tier available).
    expect(reasoningForModel(deepseek, { mode: 'effort', effort: 'medium' })).toEqual({
      mode: 'effort',
      effort: 'high',
    });
  });

  it('keeps "off" for models that can disable thinking', () => {
    expect(reasoningForModel(glm, { mode: 'off' })).toEqual({ mode: 'effort', effort: 'high' });
    expect(reasoningForModel(claude, { mode: 'off' })).toEqual({ mode: 'off' });
  });

  it('clamps a budget selection into the model range', () => {
    const budgetModel = syntheticModel({
      reasoningOptions: [{ type: 'budget_tokens', min: 2_048, max: 16_384 }],
    });
    expect(reasoningForModel(budgetModel, { mode: 'budget', budget: 99_000 })).toEqual({
      mode: 'budget',
      budget: 16_384,
    });
  });

  it('maps a budget preference onto effort tiers', () => {
    expect(reasoningForModel(glm, { mode: 'budget', budget: 32_000 })).toEqual({
      mode: 'effort',
      effort: 'max',
    });
    expect(reasoningForModel(glm, { mode: 'budget', budget: 8_192 })).toEqual({
      mode: 'effort',
      effort: 'high',
    });
    expect(reasoningForModel(glm, { mode: 'budget', budget: 2_000 })).toEqual({
      mode: 'effort',
      effort: 'low',
    });
  });

  it('returns null for models without thinking controls', () => {
    expect(reasoningForModel(noControl, { mode: 'effort', effort: 'max' })).toBeNull();
    expect(reasoningForModel(undefined, null)).toBeNull();
  });
});

describe('modelDetails', () => {
  const deepseek = getModel('opencode-go', 'deepseek-v4.1-flash')!;
  const noControl = syntheticModel({ id: 'sem-controle', reasoning: false, reasoningOptions: [] });

  it('summarises context, output, pricing, input and protocol', () => {
    const details = modelDetails(deepseek, 'OpenCode Go')!;
    expect(details.name).toBe('DeepSeek V4.1 Flash');
    expect(details.description).toContain('DeepSeek');
    const line = (label: string) => details.lines.find((entry) => entry.label === label)?.value;
    expect(line('Contexto')).toBe('1M');
    expect(line('Saída máx.')).toBe('384K');
    expect(line('Custo (1M tok.)')).toBe('$0.30 / $1.20');
    expect(line('Entrada')).toBe('Texto, Imagem');
    expect(line('Protocolo')).toBe('OpenAI Chat');
    expect(line('Provedor')).toBe('OpenCode Go');
    expect(line('Lançamento')).toBe('2026-09-10');
  });

  it('lists capability badges', () => {
    const details = modelDetails(deepseek)!;
    expect(details.badges).toContain('Visão');
    expect(details.badges).toContain('Raciocínio');
    expect(details.badges).toContain('Open');
  });

  it('omits the reasoning badge for models without thinking controls', () => {
    const details = modelDetails(noControl)!;
    expect(details.badges).not.toContain('Raciocínio');
  });

  it('returns null without a model', () => {
    expect(modelDetails(undefined)).toBeNull();
  });
});
