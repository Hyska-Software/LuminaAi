/**
 * Pure helpers behind the model selector (compact pill popover + full dialog).
 *
 * Everything here is UI-agnostic and fully testable: keys, search, filters,
 * grouping, thinking-mode options, labels and detail summaries. The two
 * selector surfaces (`ModelPill`, `ModelPickerDialog`) and their shared
 * components consume this module as the single source of truth, so behavior
 * cannot drift between them.
 *
 * Contract: `docs/MODEL_SELECTOR_REDESIGN.md` §5.1.
 */
import {
  defaultReasoningFor,
  effortLabel,
  formatContextWindow,
  formatPrice,
  modelBadges,
  reasoningUi,
} from './catalog';
import type {
  ModelInfo,
  ModelSelection,
  ProviderInfo,
  ProviderKeyStatus,
  ReasoningSelection,
} from './types';

/* ------------------------------------------------------------------ */
/* Model keys                                                          */
/* ------------------------------------------------------------------ */

/**
 * Stable identity of a model inside the selector. Model ids repeat across
 * providers, so every list key is `providerId:modelId`.
 */
export function modelKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

export function parseModelKey(key: string): { providerId: string; modelId: string } | null {
  const separator = key.indexOf(':');
  if (separator <= 0 || separator === key.length - 1) return null;
  return {
    providerId: key.slice(0, separator),
    modelId: key.slice(separator + 1),
  };
}

export function selectionKey(selection: ModelSelection | null | undefined): string | null {
  if (!selection?.providerId || !selection.modelId) return null;
  return modelKey(selection.providerId, selection.modelId);
}

/* ------------------------------------------------------------------ */
/* Families                                                            */
/* ------------------------------------------------------------------ */

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
  flint: 'Flint',
  omen: 'Omen',
  beam: 'Beam',
};

/** Curated family label; unknown families are capitalized, empty/default → "Outros". */
export function familyLabel(family: string | null | undefined): string {
  const key = (family ?? '').toLowerCase().trim();
  if (!key || key === 'default' || key === 'outros' || key === 'other') return 'Outros';
  const known = FAMILY_LABELS[key];
  if (known) return known;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function isOtherFamily(family: string | null | undefined): boolean {
  return familyLabel(family) === 'Outros';
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

const DIACRITICS = /[\u0300-\u036f]/g;

/** Lowercase, accent-free and trimmed — used by every search comparison. */
export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(DIACRITICS, '').toLowerCase().trim();
}

function modelHaystack(model: ModelInfo, provider?: ProviderInfo): string {
  return normalizeSearch(
    [
      model.name,
      model.id,
      model.family,
      familyLabel(model.family),
      model.description ?? '',
      model.tags.join(' '),
      provider?.name ?? '',
      provider?.shortName ?? '',
    ].join(' '),
  );
}

/**
 * Token-AND search over name, id, family, description, tags and provider.
 * Diacritics and casing are ignored, so "visao" finds "Visão" tags too.
 */
export function modelMatchesQuery(
  model: ModelInfo,
  provider: ProviderInfo | undefined,
  query: string,
): boolean {
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = modelHaystack(model, provider);
  return tokens.every((token) => haystack.includes(token));
}

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

export type ModelFilter = 'favorites' | 'vision' | 'reasoning' | 'free';

export interface ModelFilterOption {
  value: ModelFilter;
  label: string;
  title: string;
}

/** Quick filters shown as toggle chips in the full dialog. */
export function modelFilterOptions(): ModelFilterOption[] {
  return [
    { value: 'favorites', label: 'Favoritos', title: 'Mostrar apenas modelos favoritos' },
    { value: 'vision', label: 'Visão', title: 'Modelos que aceitam imagens/anexos' },
    { value: 'reasoning', label: 'Raciocínio', title: 'Modelos com controle de pensamento' },
    { value: 'free', label: 'Grátis', title: 'Modelos gratuitos no gateway' },
  ];
}

export function modelSupportsVision(model: ModelInfo): boolean {
  return model.attachment || model.modalities.input.includes('image');
}

export function modelSupportsReasoning(model: ModelInfo): boolean {
  return reasoningUi(model).supported;
}

/** Favorites are keyed `providerId:modelId`; legacy bare ids match any provider. */
export function favoriteEntryMatches(
  favorites: readonly string[],
  providerId: string,
  modelId: string,
): boolean {
  return favorites.includes(modelKey(providerId, modelId)) || favorites.includes(modelId);
}

/** Every active filter must match (AND semantics). */
export function modelMatchesFilters(
  model: ModelInfo,
  filters: ModelFilter[],
  favorites: string[] = [],
  favoriteMatch?: (modelId: string) => boolean,
): boolean {
  return filters.every((filter) => {
    switch (filter) {
      case 'favorites':
        return favoriteMatch ? favoriteMatch(model.id) : favorites.includes(model.id);
      case 'vision':
        return modelSupportsVision(model);
      case 'reasoning':
        return modelSupportsReasoning(model);
      case 'free':
        return model.status === 'free';
      default:
        return true;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

export interface ModelListEntry {
  providerId: string;
  providerName: string;
  providerShortName: string;
  model: ModelInfo;
  favorite: boolean;
}

export interface ModelListGroup {
  key: string;
  label: string;
  /** Set when the group belongs to one provider (search results / global lists). */
  providerId: string | null;
  items: ModelListEntry[];
}

export interface BuildModelGroupsOptions {
  /** Restricts the list to a provider when there is no query. */
  providerId?: string | null;
  query?: string;
  filters?: ModelFilter[];
  favorites?: string[];
  /**
   * Provider-aware favorite matcher. The store keys favorites by
   * `providerId:modelId`; callers that already have the pair logic can pass it
   * here (defaults to the legacy bare-id check for backwards compatibility).
   */
  favoriteMatch?: (providerId: string, modelId: string) => boolean;
  /** The dialog shows unavailable models (disabled); the compact pill hides them. */
  includeUnavailable?: boolean;
}

function toEntry(provider: ProviderInfo, model: ModelInfo, favorite: boolean): ModelListEntry {
  return {
    providerId: provider.id,
    providerName: provider.name,
    providerShortName: provider.shortName,
    model,
    favorite,
  };
}

function groupModelsByFamily(models: ModelInfo[]): { family: string; models: ModelInfo[] }[] {
  const map = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const family = model.family || 'default';
    const list = map.get(family) ?? [];
    list.push(model);
    map.set(family, list);
  }
  return [...map.entries()]
    .map(([family, list]) => ({
      family,
      models: list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    }))
    .sort((a, b) => {
      const aOther = isOtherFamily(a.family);
      const bOther = isOtherFamily(b.family);
      if (aOther !== bOther) return aOther ? 1 : -1;
      return familyLabel(a.family).localeCompare(familyLabel(b.family), 'pt-BR');
    });
}

/**
 * Builds the groups consumed by `ModelList`.
 *
 * - With a query, the search spans every provider (global) and groups read
 *   "Go · Claude"; the current provider scope is intentionally ignored.
 * - Without a query, the list is scoped to `providerId` (when given) and
 *   favorites come first, followed by the remaining families ("Outros" last).
 */
export function buildModelGroups(
  providers: ProviderInfo[],
  options: BuildModelGroupsOptions = {},
): ModelListGroup[] {
  const {
    providerId = null,
    query = '',
    filters = [],
    favorites = [],
    favoriteMatch,
    includeUnavailable = false,
  } = options;
  const isFavorite = (candidateProvider: ProviderInfo, model: ModelInfo): boolean =>
    favoriteMatch
      ? favoriteMatch(candidateProvider.id, model.id)
      : favoriteEntryMatches(favorites, candidateProvider.id, model.id);
  const searching = normalizeSearch(query).length > 0;

  const scoped = searching || providerId == null
    ? providers
    : providers.filter((provider) => provider.id === providerId);

  const filtered = scoped
    .map((provider) => ({
      provider,
      models: provider.models.filter((model) => {
        if (!includeUnavailable && model.status === 'unavailable') return false;
        if (!modelMatchesFilters(model, filters, favorites, (modelId) => favoriteMatch
          ? favoriteMatch(provider.id, modelId)
          : favoriteEntryMatches(favorites, provider.id, modelId))) {
          return false;
        }
        if (!modelMatchesQuery(model, provider, query)) return false;
        return true;
      }),
    }))
    .filter((entry) => entry.models.length > 0);

  const groups: ModelListGroup[] = [];

  if (searching || providerId == null) {
    // Global mode: one group per provider + family, providers in catalog order.
    for (const { provider, models } of filtered) {
      for (const family of groupModelsByFamily(models)) {
        groups.push({
          key: `${provider.id}:${family.family}`,
          label: `${provider.shortName} · ${familyLabel(family.family)}`,
          providerId: provider.id,
          items: family.models.map((model) => toEntry(provider, model, isFavorite(provider, model))),
        });
      }
    }
    return groups;
  }

  // Scoped mode: favorites first, then families (favorites removed from them).
  for (const { provider, models } of filtered) {
    const favoriteModels = models
      .filter((model) => isFavorite(provider, model))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (favoriteModels.length) {
      groups.push({
        key: `${provider.id}:favorites`,
        label: 'Favoritos',
        providerId: provider.id,
        items: favoriteModels.map((model) => toEntry(provider, model, true)),
      });
    }
    const rest = models.filter((model) => !isFavorite(provider, model));
    for (const family of groupModelsByFamily(rest)) {
      groups.push({
        key: `${provider.id}:${family.family}`,
        label: familyLabel(family.family),
        providerId: provider.id,
        items: family.models.map((model) => toEntry(provider, model, false)),
      });
    }
  }

  return groups;
}

export function flattenGroups(groups: ModelListGroup[]): ModelListEntry[] {
  return groups.flatMap((group) => group.items);
}

export function entryKey(entry: ModelListEntry): string {
  return modelKey(entry.providerId, entry.model.id);
}

/** Preferred entry when still visible, otherwise the first selectable one. */
export function firstSelectable(
  groups: ModelListGroup[],
  preferredKey?: string | null,
): ModelListEntry | null {
  const entries = flattenGroups(groups);
  if (preferredKey) {
    const preferred = entries.find(
      (entry) => entryKey(entry) === preferredKey && entry.model.status !== 'unavailable',
    );
    if (preferred) return preferred;
  }
  return entries.find((entry) => entry.model.status !== 'unavailable') ?? entries[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Thinking modes                                                      */
/* ------------------------------------------------------------------ */

export type ThinkingOptionKind = 'off' | 'on' | 'effort' | 'budget';

export interface ThinkingOption {
  /** Stable id used for listbox options: "off" | "on" | "effort:high" | "budget:8192". */
  id: string;
  kind: ThinkingOptionKind;
  label: string;
  description: string;
  effort?: string;
  budget?: number;
  current: boolean;
}

const EFFORT_DESCRIPTIONS: Record<string, string> = {
  none: 'Sem raciocínio estendido.',
  minimal: 'Quase direto; o mínimo de raciocínio.',
  low: 'Rápido, para tarefas simples.',
  medium: 'Equilíbrio entre velocidade e profundidade.',
  high: 'Pensa mais antes de responder; bom para problemas complexos.',
  xhigh: 'Esforço muito alto; respostas mais lentas e detalhadas.',
  max: 'Maior esforço disponível; mais lento e mais tokens.',
};

export function effortDescription(effort: string): string {
  return EFFORT_DESCRIPTIONS[effort] ?? 'Ajusta quanto o modelo pensa antes de responder.';
}

const BUDGET_PRESETS: { budget: number; label: string; description: string }[] = [
  { budget: 4_096, label: 'Rápido', description: 'Cerca de 4 mil tokens de raciocínio.' },
  { budget: 8_192, label: 'Equilibrado', description: 'Cerca de 8 mil tokens de raciocínio.' },
  { budget: 16_384, label: 'Profundo', description: 'Cerca de 16 mil tokens de raciocínio.' },
  { budget: 32_768, label: 'Máximo', description: 'Cerca de 32 mil tokens de raciocínio.' },
];

/** Budget presets that fit the model's declared range. */
export function budgetPresets(model?: ModelInfo | null): typeof BUDGET_PRESETS {
  const ui = reasoningUi(model);
  if (!ui.budget) return [];
  const min = ui.budget.min ?? 1_024;
  const max = ui.budget.max ?? 65_536;
  return BUDGET_PRESETS.filter((preset) => preset.budget >= min && preset.budget <= max);
}

/**
 * Every thinking mode offered by a model, in display order, with descriptions.
 *
 * - toggle-only models expose "Ligado" + "Desligado";
 * - effort models expose the effort tiers (+ "Desligado" when allowed);
 * - budget-only models expose token presets;
 * - models with efforts *and* budget expose both (efforts first).
 */
export function thinkingOptions(
  model: ModelInfo | undefined | null,
  selection: ReasoningSelection | null | undefined,
): ThinkingOption[] {
  if (!model) return [];
  const ui = reasoningUi(model);
  if (!ui.supported) return [];

  const currentId = currentThinkingId(selection);
  const options: ThinkingOption[] = [];
  const efforts = ui.efforts.filter((effort) => effort !== 'none');
  const presets = budgetPresets(model);

  if (ui.canDisable) {
    options.push({
      id: 'off',
      kind: 'off',
      label: 'Desligado',
      description: 'Responde direto, sem raciocínio estendido.',
      current: currentId === 'off',
    });
  }

  if (efforts.length) {
    for (const effort of efforts) {
      options.push({
        id: `effort:${effort}`,
        kind: 'effort',
        label: effortLabel(effort),
        description: effortDescription(effort),
        effort,
        current: currentId === `effort:${effort}`,
      });
    }
  } else if (!presets.length) {
    // Toggle-only model: offer the explicit "on" state.
    options.push({
      id: 'on',
      kind: 'on',
      label: 'Ligado',
      description: 'Habilita o raciocínio do modelo, sem ajuste de esforço.',
      current: currentId === 'on',
    });
  }

  for (const preset of presets) {
    options.push({
      id: `budget:${preset.budget}`,
      kind: 'budget',
      label: preset.label,
      description: preset.description,
      budget: preset.budget,
      current: currentId === `budget:${preset.budget}`,
    });
  }

  return options;
}

export function currentThinkingId(
  selection: ReasoningSelection | null | undefined,
): string | null {
  if (!selection) return null;
  if (selection.mode === 'off') return 'off';
  if (selection.mode === 'effort') {
    return selection.effort ? `effort:${selection.effort}` : 'on';
  }
  if (selection.mode === 'budget') {
    return selection.budget ? `budget:${selection.budget}` : null;
  }
  return null;
}

export function thinkingSelectionFor(option: ThinkingOption): ReasoningSelection {
  if (option.kind === 'off') return { mode: 'off' };
  if (option.kind === 'budget') return { mode: 'budget', budget: option.budget ?? 8_192 };
  if (option.kind === 'on') return { mode: 'effort', effort: null };
  return { mode: 'effort', effort: option.effort ?? null };
}

/** Note shown above the thinking list when the model has constraints. */
export function thinkingNote(model?: ModelInfo | null): string | null {
  const ui = reasoningUi(model);
  if (!model || !ui.supported) return 'Este modelo não expõe controle de raciocínio.';
  if (!ui.canDisable && ui.efforts.length) {
    return 'Este modelo sempre pensa; escolha o nível de esforço.';
  }
  if (!ui.canDisable && ui.budget) {
    return 'Este modelo sempre pensa; escolha o orçamento de tokens.';
  }
  return null;
}

/** Short label on the thinking segment of the pill (e.g. "Alto", "Desligado"). */
export function effortSegmentLabel(
  model: ModelInfo | undefined,
  selection: ReasoningSelection | null | undefined,
): string {
  if (!model) return 'Padrão';
  const ui = reasoningUi(model);
  if (!ui.supported) return 'Padrão';
  if (!selection || selection.mode === 'off') {
    return ui.canDisable ? 'Desligado' : 'Padrão';
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

/** Sentence used by the detail panel to describe the current thinking mode. */
export function thinkingHeadline(
  model: ModelInfo | undefined,
  selection: ReasoningSelection | null | undefined,
): string {
  if (!model) return '—';
  const ui = reasoningUi(model);
  if (!ui.supported) return 'Sem controle de raciocínio';
  if (!selection || selection.mode === 'off') {
    return ui.canDisable ? 'Pensamento desligado' : 'Padrão do modelo';
  }
  if (selection.mode === 'effort') {
    return selection.effort
      ? `Pensamento ${effortLabel(selection.effort).toLowerCase()}`
      : 'Pensamento ligado';
  }
  if (selection.mode === 'budget') {
    return `Orçamento de ${formatContextWindow(selection.budget ?? 8_192)} tokens`;
  }
  return 'Padrão do modelo';
}

function pickEffort(efforts: string[], preferred: string): string {
  if (efforts.includes(preferred)) return preferred;
  return efforts[0] ?? preferred;
}

/**
 * Reasoning to apply when switching models: keep the current effort whenever
 * the next model supports it, otherwise fall back to the model default so we
 * never send an unsupported mode.
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
  if (previous?.mode === 'effort' && !previous.effort && !ui.efforts.length) {
    // "on" carries over to another toggle-only model.
    return { mode: 'effort', effort: null };
  }
  if (previous?.mode === 'budget' && ui.efforts.length) {
    const budget = previous.budget ?? 8_192;
    if (budget >= 24_576) return { mode: 'effort', effort: pickEffort(ui.efforts, 'max') };
    if (budget >= 8_192) return { mode: 'effort', effort: pickEffort(ui.efforts, 'high') };
    return { mode: 'effort', effort: pickEffort(ui.efforts, 'low') };
  }
  return defaultReasoningFor(model);
}

/* ------------------------------------------------------------------ */
/* Details                                                             */
/* ------------------------------------------------------------------ */

export const PROTOCOL_LABELS: Record<string, string> = {
  'openai-chat': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
  anthropic: 'Anthropic Messages',
  google: 'Google Gemini',
};

export const MODALITY_LABELS: Record<string, string> = {
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
  providerName: string;
  description: string | null;
  badges: string[];
  lines: ModelDetailLine[];
  statusNote: string | null;
}

/** Human-readable summary shown in the detail panel of both surfaces. */
export function modelDetails(
  model: ModelInfo | undefined,
  providerName?: string,
): ModelDetail | null {
  if (!model) return null;

  const lines: ModelDetailLine[] = [
    { label: 'Contexto', value: formatContextWindow(model.contextWindow) },
    { label: 'Saída máx.', value: formatContextWindow(model.maxOutput) },
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

  if (model.knowledge) lines.push({ label: 'Conhecimento até', value: model.knowledge });
  if (model.releaseDate) lines.push({ label: 'Lançamento', value: model.releaseDate });

  return {
    id: model.id,
    name: model.name,
    providerName: providerName ?? '',
    description: model.description?.trim() || null,
    badges: modelBadges(model),
    lines,
    statusNote: modelStatusNote(model),
  };
}

/** Short status note rendered as a warning/info box in the detail panel. */
export function modelStatusNote(model?: ModelInfo | null): string | null {
  if (!model) return null;
  if (model.status === 'unavailable') {
    return 'Indisponível no gateway — não pode ser usado.';
  }
  if (model.status === 'beta') return 'Modelo em prévia: pode mudar ou sair do catálogo.';
  if (model.status === 'free') return 'Modelo gratuito no gateway, com limites de uso.';
  return null;
}

/* ------------------------------------------------------------------ */
/* Provider keys                                                       */
/* ------------------------------------------------------------------ */

export function keyStatusFor(
  keys: ProviderKeyStatus[],
  providerId: string,
): ProviderKeyStatus | undefined {
  return keys.find((key) => key.providerId === providerId);
}

export function providerHasKey(keys: ProviderKeyStatus[], providerId: string): boolean {
  return Boolean(keyStatusFor(keys, providerId)?.hasKey);
}

export function keyStatusLabel(key?: ProviderKeyStatus): string {
  switch (key?.source) {
    case 'settings':
      return 'Chave configurada';
    case 'env':
      return 'Chave via variável de ambiente';
    case 'opencode-cli':
      return 'Chave do OpenCode CLI';
    case 'chatgpt':
      return key?.hasKey ? 'Conta ChatGPT conectada' : 'Sessão do ChatGPT expirada';
    default:
      return key?.mode === 'oauth' ? 'Sem conta ChatGPT' : 'Sem chave de API';
  }
}