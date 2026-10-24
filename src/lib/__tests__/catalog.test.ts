import { describe, expect, it } from 'vitest';
import {
  defaultReasoningFor,
  defaultSelection,
  effortLabel,
  findModel,
  formatContextWindow,
  formatPrice,
  getModel,
  getProvider,
  groupByFamily,
  modelBadges,
  providerLabel,
  reasoningLabel,
  reasoningShortLabel,
  reasoningUi,
  supportsAttachments,
} from '@/lib/catalog';

const glm = getModel('opencode-go', 'glm-5.3-flash')!;
const claude = getModel('opencode-go', 'claude-haiku-5-5')!;
const gpt = getModel('opencode-zen', 'gpt-6-luna')!;

describe('catalog providers', () => {
  it('exposes both OpenCode providers', () => {
    expect(getProvider('opencode-go')?.shortName).toBe('Go');
    expect(getProvider('opencode-zen')?.shortName).toBe('Zen');
    expect(providerLabel('opencode-go')).toBe('Go');
    expect(providerLabel('desconhecido')).toBe('desconhecido');
  });

  it('finds models across providers', () => {
    expect(findModel('glm-5.3-flash')?.provider.id).toBe('opencode-go');
    expect(findModel('nao-existe')).toBeNull();
  });

  it('ships a DeepSeek V4.1 Flash entry for the Go provider', () => {
    const deepseek = getModel('opencode-go', 'deepseek-v4.1-flash')!;
    expect(deepseek.name).toContain('DeepSeek V4.1 Flash');
    expect(deepseek.protocols).toContain('openai-chat');
    expect(deepseek.reasoningOptions.some((option) => option.type === 'effort')).toBe(true);
  });
});

describe('reasoningUi', () => {
  it('describes effort-only models', () => {
    const ui = reasoningUi(glm);
    expect(ui.supported).toBe(true);
    expect(ui.canDisable).toBe(false);
    expect(ui.efforts).toEqual(['low', 'high', 'max']);
    expect(ui.budget).toBeNull();
  });

  it('describes toggle + effort models', () => {
    const ui = reasoningUi(claude);
    expect(ui.supported).toBe(true);
    expect(ui.canDisable).toBe(true);
    expect(ui.efforts).toContain('max');
  });

  it('reports models without reasoning control', () => {
    const ui = reasoningUi(undefined);
    expect(ui.supported).toBe(false);
    expect(ui.efforts).toEqual([]);
  });
});

describe('defaultReasoningFor', () => {
  it('prefers a balanced effort when available', () => {
    expect(defaultReasoningFor(glm)).toEqual({ mode: 'effort', effort: 'high' });
    expect(defaultReasoningFor(claude)).toEqual({ mode: 'effort', effort: 'medium' });
    expect(defaultReasoningFor(undefined)).toBeNull();
  });

  it('returns a concrete budget for budget-only models', () => {
    // Zen's Claude Haiku 4.5 only accepts budget_tokens (no toggle/effort), so
    // the slider value shown by the UI must also be the value that is committed.
    const budgetOnly = getModel('opencode-zen', 'claude-haiku-4-5')!;
    expect(defaultReasoningFor(budgetOnly)).toEqual({ mode: 'budget', budget: 8_192 });
  });
});

describe('reasoning labels', () => {
  it('labels full and short forms', () => {
    expect(reasoningLabel(glm, { mode: 'effort', effort: 'max' })).toBe('Pensamento Máximo');
    expect(reasoningShortLabel(glm, { mode: 'effort', effort: 'max' })).toBe('Máximo');
    expect(reasoningLabel(glm, { mode: 'effort', effort: null })).toBe('Pensamento ligado');
    expect(reasoningShortLabel(claude, { mode: 'off' })).toBe('off');
    expect(reasoningLabel(undefined, { mode: 'off' })).toBe('Sem controle');
  });

  it('translates effort values', () => {
    expect(effortLabel('max')).toBe('Máximo');
    expect(effortLabel('xhigh')).toBe('Muito alto');
    expect(effortLabel('custom')).toBe('custom');
  });
});

describe('formatting helpers', () => {
  it('formats context windows', () => {
    expect(formatContextWindow(1_000_000)).toBe('1M');
    expect(formatContextWindow(1_048_576)).toBe('1M');
    expect(formatContextWindow(1_050_000)).toBe('1.1M');
    expect(formatContextWindow(262_144)).toBe('262K');
    expect(formatContextWindow(0)).toBe('—');
  });

  it('formats prices', () => {
    expect(formatPrice(glm.cost)).toBe('$0.15 / $0.50');
    expect(formatPrice(getModel('opencode-go', 'beam-free')!.cost)).toBe('Grátis');
    expect(formatPrice(null)).toBe('—');
  });

  it('produces capability badges', () => {
    expect(modelBadges(glm)).toContain('Raciocínio');
    expect(modelBadges(claude)).toContain('Visão');
    expect(modelBadges(gpt)).toContain('Visão');
  });

  it('detects attachment support', () => {
    expect(supportsAttachments(claude)).toBe(true);
    expect(supportsAttachments(null)).toBe(false);
  });
});

describe('groupByFamily', () => {
  it('groups and sorts models by family', () => {
    const provider = getProvider('opencode-go')!;
    const groups = groupByFamily(provider.models);
    expect(groups.length).toBeGreaterThan(1);
    const families = groups.map((group) => group.family);
    expect(families).toEqual([...families].sort((a, b) => a.localeCompare(b)));
    const claudeGroup = groups.find((group) => group.family === 'claude');
    expect(claudeGroup?.models.every((model) => model.family === 'claude')).toBe(true);
  });
});

describe('defaultSelection', () => {
  const baseSettings = {
    theme: 'system',
    locale: 'pt-BR',
    defaultProvider: 'opencode-go',
    defaultModel: 'deepseek-v4.1-flash',
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
  } as const;

  it('honours the configured model and maximum reasoning effort', () => {
    const selection = defaultSelection({ ...baseSettings } as never);
    expect(selection.providerId).toBe('opencode-go');
    expect(selection.modelId).toBe('deepseek-v4.1-flash');
    expect(selection.reasoning).toEqual({ mode: 'effort', effort: 'max' });
  });

  it('falls back to the provider default model when the configured model is unknown', () => {
    const selection = defaultSelection({
      ...baseSettings,
      defaultModel: 'modelo-que-nao-existe',
    } as never);
    expect(selection.modelId).toBe('deepseek-v4.1-flash');
  });

  it('uses the go provider when settings are missing', () => {
    const selection = defaultSelection(undefined);
    expect(selection.providerId).toBe('opencode-go');
    expect(selection.modelId.length).toBeGreaterThan(0);
  });
});
