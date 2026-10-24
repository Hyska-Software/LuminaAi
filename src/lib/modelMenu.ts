/**
 * Pure helpers behind the compact model/effort dropdown (`ModelPill`).
 *
 * The default selector is a dropdown: first the user picks a model, then opens
 * the effort menu to choose the thinking mode. The full dialog (search,
 * providers, capabilities) stays available through the small button on the pill.
 */
import { defaultReasoningFor, effortLabel, groupByFamily, modelBadges, reasoningUi, formatContextWindow, formatPrice } from './catalog';
import { formatTokens } from './utils';
import type { ModelInfo, ProviderInfo, ReasoningSelection } from './types';

/* ------------------------------------------------------------------ */
/* Model menu                                                          */
/* ------------------------------------------------------------------ */

export interface ModelMenuItem {
  providerId: string;
  modelId: string;
  name: string;
  family: string;
  status: ModelInfo['status'];
  current: boolean;
}

export interface ModelMenuGroup {
  label: string;
  items: ModelMenuItem[];
}

const FAMILY_LABELS: Record<string, string> = {
  claude: 'Claude',
  gpt: 'GPT',
  glm: 'GLM',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  qwen: 'Qwen',
  minimax: 'MiniMax',
  mimo: 'MiMo',
  grok: 'Grok',
  gemini: 'Gemini',
  muse: 'Muse',
  longcat: 'LongCat',
  step: 'Step',
  hy: 'HY',
  mistral: 'Mistral',
  nemotron: 'Nemotron',
  default: 'Outros',
};

export function familyLabel(family: string): string {
  const known = FAMILY_LABELS[family.toLowerCase()];
  if (known) return known;
  if (!family) return 'Outros';
  return family.charAt(0).toUpperCase() + family.slice(1);
}

/**
 * Builds the model dropdown: favorites first, then models grouped by family.
 * Unavailable models are hidden (they cannot be used by the gateway).
 */
export function buildModelMenu(
  provider: ProviderInfo,
  currentModelId: string,
  favorites: string[] = [],
): ModelMenuGroup[] {
  const favoriteSet = new Set(favorites);
  const usable = provider.models.filter((model) => model.status !== 'unavailable');

  const toItem = (model: ModelInfo): ModelMenuItem => ({
    providerId: provider.id,
    modelId: model.id,
    name: model.name,
    family: model.family,
    status: model.status,
    current: model.id === currentModelId,
  });

  const groups: ModelMenuGroup[] = [];
  const favoritesGroup = usable.filter((model) => favoriteSet.has(model.id)).map(toItem);
  if (favoritesGroup.length) {
    groups.push({ label: 'Favoritos', items: favoritesGroup });
  }

  const rest = usable.filter((model) => !favoriteSet.has(model.id));
  for (const family of groupByFamily(rest)) {
    groups.push({ label: familyLabel(family.family), items: family.models.map(toItem) });
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/* Effort menu                                                         */
/* ------------------------------------------------------------------ */

export type EffortMenuItemKind = 'off' | 'effort' | 'budget';

export interface EffortMenuItem {
  kind: EffortMenuItemKind;
  label: string;
  /** Present for `kind === 'effort'`. */
  effort?: string;
  /** Present for `kind === 'budget'`. */
  budget?: number;
  current: boolean;
  description?: string;
}

const BUDGET_PRESETS: { budget: number; label: string; description: string }[] = [
  { budget: 4_096, label: 'Rápido', description: '4k tokens de pensamento' },
  { budget: 8_192, label: 'Equilibrado', description: '8k tokens de pensamento' },
  { budget: 16_384, label: 'Profundo', description: '16k tokens de pensamento' },
  { budget: 32_768, label: 'Máximo', description: '32k tokens de pensamento' },
];

/** Options offered by the effort dropdown for the given model. */
export function buildEffortMenu(
  model: ModelInfo | undefined,
  selection: ReasoningSelection | null | undefined,
): EffortMenuItem[] {
  if (!model) return [];
  const ui = reasoningUi(model);
  const items: EffortMenuItem[] = [];

  if (ui.canDisable) {
    items.push({
      kind: 'off',
      label: 'Desligado',
      current: !selection || selection.mode === 'off',
    });
  }

  if (ui.efforts.length) {
    for (const effort of ui.efforts) {
      items.push({
        kind: 'effort',
        label: effortLabel(effort),
        effort,
        current: selection?.mode === 'effort' && selection.effort === effort,
      });
    }
  } else if (ui.budget) {
    const min = ui.budget.min ?? 1_024;
    const max = ui.budget.max ?? 65_536;
    for (const preset of BUDGET_PRESETS) {
      if (preset.budget < min || preset.budget > max) continue;
      items.push({
        kind: 'budget',
        label: preset.label,
        budget: preset.budget,
        description: preset.description,
        current: selection?.mode === 'budget' && selection.budget === preset.budget,
      });
    }
  }

  return items;
}

/** Short label shown on the effort segment of the pill. */
export function effortSegmentLabel(
  model: ModelInfo | undefined,
  selection: ReasoningSelection | null | undefined,
): string {
  if (!model) return 'Sem controle';
  const ui = reasoningUi(model);
  if (!ui.supported) return 'Sem controle';
  if (!selection || selection.mode === 'off') {
    return ui.canDisable ? 'Off' : 'Padrão';
  }
  if (selection.mode === 'effort') {
    return selection.effort ? effortLabel(selection.effort) : 'Ligado';
  }
  if (selection.mode === 'budget') {
    const budget = selection.budget ?? 4_096;
    const preset = BUDGET_PRESETS.find((candidate) => candidate.budget === budget);
    return preset ? preset.label : `${Math.round(budget / 1_024)}k`;
  }
  return 'Padrão';
}

/**
 * Reasoning to apply when the user switches models from the dropdown: keep the
 * current effort when the new model supports it, otherwise fall back to the
 * model default (so we never send an unsupported mode).
 */
export function reasoningForModel(
  model: ModelInfo | undefined,
  previous: ReasoningSelection | null | undefined,
): ReasoningSelection | null {
  if (!model) return null;
  const ui = reasoningUi(model);
  if (!ui.supported) return null;

  if (previous?.mode === 'off' && ui.canDisable) {
    return { mode: 'off' };
  }
  if (previous?.mode === 'budget' && ui.budget) {
    const min = ui.budget.min ?? 1_024;
    const max = ui.budget.max ?? 65_536;
    const budget = Math.min(max, Math.max(min, previous.budget ?? 8_192));
    return { mode: 'budget', budget };
  }
  if (previous?.mode === 'effort' && previous.effort && ui.efforts.includes(previous.effort)) {
    return { mode: 'effort', effort: previous.effort };
  }
  if (previous?.mode === 'budget' && ui.efforts.length) {
    // Budget-only preference carried onto an effort model: pick the closest
    // effort tier instead of falling back to the model default.
    const budget = previous.budget ?? 8_192;
    if (budget >= 24_576) return { mode: 'effort', effort: pickEffort(ui.efforts, 'max') };
    if (budget >= 8_192) return { mode: 'effort', effort: pickEffort(ui.efforts, 'high') };
    return { mode: 'effort', effort: pickEffort(ui.efforts, 'low') };
  }
  return defaultReasoningFor(model);
}

function pickEffort(efforts: string[], preferred: string): string {
  if (efforts.includes(preferred)) return preferred;
  return efforts[0] ?? preferred;
}

/* ------------------------------------------------------------------ */
/* Hover details                                                       */
/* ------------------------------------------------------------------ */

const PROTOCOL_LABELS: Record<string, string> = {
  'openai-chat': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
  anthropic: 'Anthropic Messages',
  google: 'Google Gemini',
};

const MODALITY_LABELS: Record<string, string> = {
  text: 'Texto',
  image: 'Imagem',
  pdf: 'PDF',
  audio: 'Áudio',
  video: 'Vídeo',
};

export interface ModelDetailLine {
  label: string;
  value: string;
}

export interface ModelDetail {
  id: string;
  name: string;
  description: string | null;
  badges: string[];
  lines: ModelDetailLine[];
}

/**
 * Human-readable summary shown next to the model list when the user hovers (or
 * keyboard-focuses) a model.
 */
export function modelDetails(
  model: ModelInfo | undefined,
  providerName?: string,
): ModelDetail | null {
  if (!model) return null;

  const lines: ModelDetailLine[] = [
    { label: 'Contexto', value: formatContextWindow(model.contextWindow) },
    { label: 'Saída máx.', value: formatTokens(model.maxOutput) },
    { label: 'Custo (1M tok.)', value: formatPrice(model.cost) },
  ];

  const inputs = (model.modalities.input ?? [])
    .map((modality) => MODALITY_LABELS[modality.toLowerCase()] ?? modality)
    .join(', ');
  if (inputs) lines.push({ label: 'Entrada', value: inputs });

  const protocols = model.protocols
    .map((protocol) => PROTOCOL_LABELS[protocol] ?? protocol)
    .join(', ');
  if (protocols) lines.push({ label: 'Protocolo', value: protocols });

  if (providerName) lines.push({ label: 'Provedor', value: providerName });
  if (model.releaseDate) lines.push({ label: 'Lançamento', value: model.releaseDate });

  return {
    id: model.id,
    name: model.name,
    description: model.description?.trim() || null,
    badges: modelBadges(model),
    lines,
  };
}
