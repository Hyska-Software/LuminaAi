#!/usr/bin/env node
/**
 * Builds the bundled model catalog used by both the Rust backend and the React UI.
 *
 * Data sources (regenerate with `node scripts/collect-research.mjs` when models change):
 *  - OpenCode Go / Zen official docs tables      -> model ids, display names, wire protocol
 *  - models.dev catalog (providers opencode/...) -> capabilities, reasoning options, limits, cost
 *  - live protocol verification (probe scripts)  -> which wire protocols each model accepts
 *
 * Output: data/catalog.json
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RESEARCH = path.join(ROOT, '.research');

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(RESEARCH, p), 'utf8'));
const docsGo = readJson('docs-go.json');
const docsZen = readJson('docs-zen.json');
const modelsDev = readJson('models-dev.json');
const goProtocols = readJson('go-protocols.json');

const mdModels = (providerId) => modelsDev[providerId]?.models ?? {};
const mdOpencode = mdModels('opencode');
const mdGo = mdModels('opencode-go');

const byId = (list) => Object.fromEntries(list.map((m) => [m.id, m]));

const docsGoById = byId(docsGo);
const docsZenById = byId(docsZen);
const verifiedById = Object.fromEntries(goProtocols.map((r) => [r.id, r]));

/* ------------------------------------------------------------------ */
/* Heuristics for models missing from models.dev                       */
/* ------------------------------------------------------------------ */

const FAMILY_DEFAULTS = {
  claude: {
    context: 1_000_000,
    output: 128_000,
    attachment: true,
    reasoningOptions: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }],
  },
  gpt: {
    context: 1_050_000,
    output: 128_000,
    attachment: true,
    reasoningOptions: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }],
  },
  grok: {
    context: 500_000,
    output: 128_000,
    attachment: true,
    reasoningOptions: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }],
  },
  gemini: {
    context: 1_048_576,
    output: 65_536,
    attachment: true,
    reasoningOptions: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
  },
  glm: {
    context: 1_000_000,
    output: 131_072,
    attachment: false,
    reasoningOptions: [{ type: 'effort', values: ['low', 'high', 'max'] }],
  },
  kimi: {
    context: 1_048_576,
    output: 131_072,
    attachment: true,
    reasoningOptions: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'high', 'max'] }],
  },
  qwen: {
    context: 1_000_000,
    output: 131_072,
    attachment: true,
    reasoningOptions: [{ type: 'toggle' }],
  },
  minimax: {
    context: 1_000_000,
    output: 128_000,
    attachment: true,
    reasoningOptions: [{ type: 'toggle' }],
  },
  mimo: {
    context: 1_048_576,
    output: 128_000,
    attachment: true,
    reasoningOptions: [],
  },
  deepseek: {
    context: 1_000_000,
    output: 384_000,
    attachment: true,
    reasoningOptions: [{ type: 'effort', values: ['low', 'high', 'max'] }],
  },
  muse: {
    context: 1_048_576,
    output: 131_072,
    attachment: true,
    reasoningOptions: [{ type: 'effort', values: ['minimal', 'low', 'medium', 'high', 'xhigh'] }],
  },
  longcat: {
    context: 1_000_000,
    output: 131_072,
    attachment: true,
    reasoningOptions: [{ type: 'toggle' }],
  },
  step: {
    context: 1_000_000,
    output: 65_536,
    attachment: true,
    reasoningOptions: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
  },
  hy: {
    context: 1_000_000,
    output: 128_000,
    attachment: false,
    reasoningOptions: [{ type: 'effort', values: ['low', 'high'] }],
  },
  nemotron: { context: 1_048_576, output: 131_072, attachment: true, reasoningOptions: [] },
  mistral: { context: 524_288, output: 262_144, attachment: true, reasoningOptions: [{ type: 'effort', values: ['none', 'high'] }] },
  default: { context: 128_000, output: 16_384, attachment: false, reasoningOptions: [] },
};

function familyOf(id, familyHint) {
  if (familyHint) {
    const f = String(familyHint).toLowerCase();
    for (const key of Object.keys(FAMILY_DEFAULTS)) {
      if (f.startsWith(key)) return key;
    }
  }
  const s = id.toLowerCase();
  const order = [
    'claude',
    'gpt',
    'grok',
    'gemini',
    'glm',
    'kimi',
    'qwen',
    'minimax',
    'mimo',
    'deepseek',
    'muse',
    'longcat',
    'step',
    'nemotron',
    'mistral',
    'hy',
  ];
  for (const key of order) {
    if (s.startsWith(key) || s.includes('-' + key)) return key;
  }
  if (s.startsWith('hy')) return 'hy';
  return 'default';
}

function prettifyId(id) {
  return id
    .split('-')
    .map((chunk) => {
      if (/^(gpt|glm|kimi|qwen|mimo|hy\d|k\d)/i.test(chunk)) return chunk.toUpperCase();
      if (/^\d/.test(chunk)) return chunk;
      return chunk.charAt(0).toUpperCase() + chunk.slice(1);
    })
    .join(' ');
}

/* ------------------------------------------------------------------ */
/* Protocol selection                                                  */
/* ------------------------------------------------------------------ */

const PROTOCOL_ENDPOINTS = {
  'openai-chat': '/openai/v1/chat/completions',
  'openai-responses': '/openai/v1/responses',
  anthropic: '/anthropic/v1/messages',
  google: '/google/v1beta/models/{model}',
};

// Explicit choices where more than one wire protocol works: picking the one that
// exposes reasoning best (Anthropic returns `thinking` blocks, Responses returns
// reasoning summaries) keeps the "thinking mode" UI meaningful.
const PROTOCOL_OVERRIDES = {
  'minimax-m3': ['anthropic', 'openai-chat'],
  'minimax-m2.7': ['anthropic', 'openai-chat'],
  'minimax-m2.5': ['anthropic', 'openai-chat'],
  'minimax-m3.1-flash': ['anthropic', 'openai-chat'],
  'kimi-k3': ['anthropic', 'openai-chat'],
  'kimi-k3.1-pro': ['anthropic', 'openai-chat'],
};

function protocolsFor(id, docProtocol, verifiedProtocol) {
  const set = new Set();
  const add = (p) => p && set.add(p);
  for (const p of PROTOCOL_OVERRIDES[id] ?? []) add(p);
  add(verifiedProtocol);
  add(docProtocol);
  if (id.startsWith('claude')) add('anthropic');
  if (id.startsWith('gemini')) add('google');
  if (id.startsWith('gpt') || id.startsWith('grok') || id.startsWith('muse')) add('openai-responses');
  const list = [...set];
  // Prefer the verified/protocol-override order, then documentation order.
  return list;
}

/* ------------------------------------------------------------------ */
/* Model assembly                                                      */
/* ------------------------------------------------------------------ */

function buildModel(id, { docsEntry, verified, md, providerKind }) {
  const family = familyOf(id, md?.family);
  const defaults = FAMILY_DEFAULTS[family] ?? FAMILY_DEFAULTS.default;

  const protocols = protocolsFor(id, docsEntry?.protocol, verified?.detected);
  const reasoningOptions = md?.reasoning_options ?? defaults.reasoningOptions;
  const attachment = md?.attachment ?? defaults.attachment;
  const modalities =
    md?.modalities ??
    {
      input: attachment ? ['text', 'image'] : ['text'],
      output: ['text'],
    };

  const tags = [];
  if (id.includes('free')) tags.push('free');
  if (family === 'glm' || family === 'deepseek' || family === 'qwen' || family === 'kimi' || family === 'mimo') tags.push('open-weights');
  if (/flash|luna|nano|mini|lightning/i.test(id)) tags.push('fast');
  if (reasoningOptions.length) tags.push('reasoning');
  if (attachment) tags.push('vision');

  let status = 'stable';
  if (id.includes('free')) status = 'free';
  else if (/preview|contributor|alpha|experimental/.test(id)) status = 'beta';
  if (providerKind === 'go' && verified && !verified.detected) status = 'unavailable';

  return {
    id,
    name: docsEntry?.name ?? md?.name ?? prettifyId(id),
    family,
    protocols,
    reasoning: md?.reasoning ?? reasoningOptions.length > 0,
    reasoningOptions,
    attachment,
    modalities,
    contextWindow: md?.limit?.context ?? defaults.context,
    maxOutput: md?.limit?.output ?? defaults.output,
    cost: md?.cost ?? null,
    releaseDate: md?.release_date ?? null,
    knowledge: md?.knowledge ?? null,
    openWeights: md?.open_weights ?? false,
    description: md?.description ?? null,
    tags,
    status,
  };
}

function buildProvider({ id, name, shortName, description, baseUrl, defaultModelId, docsById, mdSource, kind, notes }) {
  const ids = new Set(Object.keys(docsById));
  if (kind === 'go') for (const id of Object.keys(verifiedById)) ids.add(id);
  const models = [...ids]
    .map((modelId) =>
      buildModel(modelId, {
        docsEntry: docsById[modelId],
        verified: verifiedById[modelId],
        md: mdSource[modelId],
        providerKind: kind,
      }),
    )
    .sort((a, b) => {
      // keep models.dev order-ish: by family then name
      if (a.family !== b.family) return a.family.localeCompare(b.family);
      return a.name.localeCompare(b.name);
    });

  return {
    id,
    name,
    shortName,
    description,
    baseUrl,
    consoleUrl: 'https://opencode.ai/console',
    endpoints: PROTOCOL_ENDPOINTS,
    authEnv: 'OPENCODE_API_KEY',
    defaultModelId,
    models,
    notes: notes ?? [],
  };
}

const catalog = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sources: {
    docs: ['https://opencode.ai/v2/docs/console/go/', 'https://opencode.ai/v2/docs/console/models/'],
    models: 'https://models.dev/api.json',
    probe: 'scripts/probe-models.mjs',
  },
  providers: [
    buildProvider({
      id: 'opencode-go',
      name: 'OpenCode Go',
      shortName: 'Go',
      description: 'Assinatura OpenCode Go — modelos abertos de alta performance com limites mensais.',
      baseUrl: 'https://opencode.ai/inference/go',
      defaultModelId: 'glm-5.3-flash',
      docsById: docsGoById,
      mdSource: { ...mdGo, ...mdOpencode },
      kind: 'go',
      notes: [
        'Envie o header x-opencode-session para melhor roteamento e prompt caching.',
        'Modelos marcados como "contributor" podem usar seus dados para treino.',
      ],
    }),
    buildProvider({
      id: 'opencode-zen',
      name: 'OpenCode Zen',
      shortName: 'Zen',
      description: 'OpenCode Console (pay-as-you-go) — catálogo curado de modelos de vários provedores.',
      baseUrl: 'https://opencode.ai/inference',
      defaultModelId: 'gpt-6-luna',
      docsById: docsZenById,
      mdSource: mdOpencode,
      kind: 'zen',
      notes: ['Funciona com créditos do OpenCode Console.', 'Modelos gratuitos exigem o cliente OpenCode.'],
    }),
  ],
};

const outDir = path.join(ROOT, 'data');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'catalog.json');
fs.writeFileSync(outFile, JSON.stringify(catalog, null, 1));

for (const p of catalog.providers) {
  const byProtocol = p.models.reduce((acc, m) => {
    const key = m.protocols[0] ?? 'none';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`${p.id}: ${p.models.length} models, primary protocols=${JSON.stringify(byProtocol)}`);
  const missing = p.models.filter((m) => m.reasoningOptions.length === 0).length;
  console.log(`  reasoning-control: ${p.models.length - missing}, no-reasoning: ${missing}`);
  const noMeta = p.models.filter((m) => !m.cost).length;
  console.log(`  without pricing metadata: ${noMeta}`);
}
console.log(`wrote ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(1)} KiB)`);
