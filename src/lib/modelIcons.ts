/**
 * Model brand glyphs — family → LobeHub icon resolution (pure, no JSX/assets).
 *
 * Icon set: {@link https://icons.lobehub.com} (`@lobehub/icons-static-svg`,
 * MIT). The static package is used instead of the React package because the
 * React build peer-depends on `@lobehub/ui` (a full UI kit) and only the SVG
 * paths are needed; the static SVGs are mono assets painted with
 * `currentColor`, so the renderer can tint them with the design tokens.
 *
 * The mapping mirrors LobeHub's own `modelMappings` table
 * (`@lobehub/icons/es/features/modelConfig.mjs`), normalized to the `family`
 * values exposed by our catalog:
 *
 * | catalog family | LobeHub icon | evidence in LobeHub's modelMappings          |
 * | -------------- | ------------ | -------------------------------------------- |
 * | claude         | Claude       | `claude`                                     |
 * | deepseek       | DeepSeek     | `deepseek`                                   |
 * | gemini         | Gemini       | `gemini`                                     |
 * | glm            | Z.ai (ZAI)   | `^glm-5`, `-glm-5` (matched before ChatGLM)  |
 * | gpt            | OpenAI       | `^gpt-`, `/gpt-`, `openai`                   |
 * | grok           | Grok         | `^grok-`, `/grok-`                           |
 * | hy             | Hunyuan      | `hunyuan`, `hy3`, `hy4`                      |
 * | kimi           | Kimi         | `kimi`, `moonshot`                           |
 * | longcat        | LongCat      | `longcat`                                    |
 * | mimo           | XiaomiMiMo   | `^mimo-`, `/mimo-`                           |
 * | minimax        | Minimax      | `minimax`, `abab`                            |
 * | mistral        | Mistral      | `mistral`, `codestral`, `devstral`, …        |
 * | muse           | Meta         | `(^|/)muse-(spark|wonder)($|-)`              |
 * | nemotron       | Nvidia       | `nemotron`, `nemoretriever`, …               |
 * | qwen           | Qwen         | `qwen`, `qwq`, `wanx`, …                     |
 * | step           | StepFun      | `step`                                       |
 *
 * Families without an official brand in the collection (`default`: Beam, Omen,
 * Big Pickle, Flint) resolve to `null` and fall back to name initials in the
 * avatar — same behavior as LobeHub's `DefaultAvatar`.
 */

/** Mono LobeHub marks bundled with the app (`?raw` SVGs). */
export type ModelIconKey =
  | 'claude'
  | 'deepseek'
  | 'gemini'
  | 'zai'
  | 'openai'
  | 'grok'
  | 'hunyuan'
  | 'kimi'
  | 'longcat'
  | 'xiaomimimo'
  | 'minimax'
  | 'mistral'
  | 'meta'
  | 'nvidia'
  | 'qwen'
  | 'stepfun';

/** Human label of each bundled mark (used in tests/tooltips, not inline). */
export const MODEL_ICON_LABELS: Readonly<Record<ModelIconKey, string>> = {
  claude: 'Claude',
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
  zai: 'Z.ai',
  openai: 'OpenAI',
  grok: 'Grok',
  hunyuan: 'Hunyuan',
  kimi: 'Kimi',
  longcat: 'LongCat',
  xiaomimimo: 'Xiaomi MiMo',
  minimax: 'MiniMax',
  mistral: 'Mistral',
  meta: 'Meta',
  nvidia: 'NVIDIA',
  qwen: 'Qwen',
  stepfun: 'StepFun',
};

/** All bundled mark keys, in stable (declaration) order. */
export const MODEL_ICON_KEYS = Object.keys(MODEL_ICON_LABELS) as ModelIconKey[];

/**
 * Family aliases accepted by the resolver. The canonical key is the catalog
 * family; the extra aliases make the mapping resilient to catalog refreshes
 * that expose the vendor (`openai`, `anthropic`, `zhipu`) or the model line
 * (`codex`, `moonshot`, …) instead of the family.
 */
const FAMILY_TO_ICON: Readonly<Record<string, ModelIconKey>> = {
  claude: 'claude',
  anthropic: 'claude',
  deepseek: 'deepseek',
  gemini: 'gemini',
  google: 'gemini',
  glm: 'zai',
  zai: 'zai',
  zhipu: 'zai',
  chatglm: 'zai',
  glmv: 'zai',
  'glm-v': 'zai',
  gpt: 'openai',
  openai: 'openai',
  codex: 'openai',
  grok: 'grok',
  xai: 'grok',
  hy: 'hunyuan',
  hunyuan: 'hunyuan',
  kimi: 'kimi',
  moonshot: 'kimi',
  longcat: 'longcat',
  mimo: 'xiaomimimo',
  xiaomimimo: 'xiaomimimo',
  'xiaomi-mimo': 'xiaomimimo',
  minimax: 'minimax',
  mistral: 'mistral',
  muse: 'meta',
  meta: 'meta',
  metaai: 'meta',
  nemotron: 'nvidia',
  nvidia: 'nvidia',
  qwen: 'qwen',
  step: 'stepfun',
  stepfun: 'stepfun',
};

/** Normalizes a catalog family for lookup: trim, lowercase, `_`/spaces → `-`. */
export function normalizeModelFamily(family?: string | null): string {
  return (family ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

/**
 * Resolves a catalog family (or vendor/model-line alias) to a bundled LobeHub
 * mark. Returns `null` when the collection has no official brand for it.
 */
export function modelIconForFamily(family?: string | null): ModelIconKey | null {
  const key = normalizeModelFamily(family);
  if (!key) return null;
  // Own-property guard: a bare index would resolve Object.prototype keys
  // (`constructor`, `toString`, …) and leak a non-`ModelIconKey` value.
  return Object.hasOwn(FAMILY_TO_ICON, key) ? (FAMILY_TO_ICON[key] ?? null) : null;
}

/** Label of the resolved mark (or `null` when the family falls back). */
export function modelIconLabel(family?: string | null): string | null {
  const icon = modelIconForFamily(family);
  return icon ? MODEL_ICON_LABELS[icon] : null;
}

/**
 * Initials used by the fallback tile when no brand mark exists. Names are the
 * useful identity here (`Big Pickle` → `BP`, not the unusable `DE` from the
 * `default` family), so the model name wins over the family. Two words give
 * one letter each; a single word gives its first two letters.
 */
export function fallbackInitials(name?: string | null, family?: string | null): string {
  const source = (name?.trim() || family?.trim() || '').trim();
  const words = source.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return '?';
  const [first, second] = words;
  if (!first) return '?';
  const letters = second ? `${first.charAt(0)}${second.charAt(0)}` : first;
  // Uppercase before truncating: some letters expand on case-folding (`ﬃ` →
  // `FFI`), and the invariant is at most 2 characters.
  return Array.from(letters.toUpperCase()).slice(0, 2).join('');
}
