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
const mdOpenai = mdModels('openai');
const docsOpenai = [];

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

/* ------------------------------------------------------------------ */
/* OpenAI (ChatGPT plan usage — Sign in with ChatGPT)                  */
/* ------------------------------------------------------------------ */

const OPENAI_ENDPOINTS = {
  'openai-responses': '/responses',
  models: '/models',
};

const OPENAI_OAUTH = {
  issuer: 'https://auth.openai.com',
  discoveryUrl: 'https://auth.openai.com/.well-known/openid-configuration',
  registrationClientId: 'dynamic_agent_client',
  agentNameHint: 'Lumina',
  resource: 'https://api.openai.com/v1',
  scopes: [
    'openid',
    'profile',
    'email',
    'offline_access',
    'resource.invoke',
    'chatgpt.tokens.use.direct',
  ],
  planUsageScope: 'chatgpt.tokens.use.direct',
  callbackPath: '/auth/callback',
  loopbackHost: '127.0.0.1',
};

const OPENAI_DOCS = [
  'https://developers.openai.com/siwc/token-sharing-open-source/',
  'https://developers.openai.com/siwc/token-sharing-open-source/sign-in',
  'https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference',
];

// Models that are not chat/completion endpoints of the Responses API (or that
// exist only for hosted tools) are not selectable in the chat UI.
const OPENAI_EXCLUDED = /(image|imagen|dall-e|embedding|realtime|transcribe|tts|audio|moderation|whisper|computer[-_]use|deep[-_]research|search[-_]preview|sora|babbage|davinci|daybreak)/i;
// The bundled seed stays on current chat families; the live `/v1/models` list
// (fetched after sign-in) is authoritative for the account.
const OPENAI_SEED_FAMILIES = /^(gpt-5(\.\d+)?(-|$)|gpt-6(\.\d+)?(-|$)|o3(-|$)|o4-mini(-|$))/i;

function buildOpenAiProvider() {
  const models = Object.entries(mdOpenai)
    .filter(([id, md]) => {
      if (OPENAI_EXCLUDED.test(id)) return false;
      if (!OPENAI_SEED_FAMILIES.test(id)) return false;
      const output = md?.modalities?.output ?? ['text'];
      if (!output.includes('text')) return false;
      return true;
    })
    .map(([id, md]) => {
      const model = buildModel(id, { md, providerKind: 'openai' });
      // The app's icon resolver and grouping only know the "gpt" family
      // (models.dev exposes gpt-sol/gpt-luna/gpt-astra/...).
      return {
        ...model,
        family: 'gpt',
        protocols: ['openai-responses'],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const ids = new Set(models.map((model) => model.id));
  const defaultModelId = ids.has('gpt-6.1-sol')
    ? 'gpt-6.1-sol'
    : (ids.has('gpt-6-astra') ? 'gpt-6-astra' : (models[0]?.id ?? ''));

  return {
    id: 'openai',
    name: 'OpenAI (ChatGPT)',
    shortName: 'ChatGPT',
    description:
      'Modelos OpenAI usando o plano ChatGPT da sua conta (Sign in with ChatGPT) ou uma API key da plataforma.',
    baseUrl: 'https://api.openai.com/v1',
    consoleUrl: 'https://chatgpt.com/settings/usage',
    endpoints: OPENAI_ENDPOINTS,
    auth: 'oauth',
    requestProfiles: { oauth: 'chatgpt-plan', apiKey: 'standard' },
    authEnv: 'OPENAI_API_KEY',
    defaultModelId,
    oauth: OPENAI_OAUTH,
    models,
    notes: [
      'O uso consome o limite do seu plano ChatGPT (o mesmo pool compartilhado por apps, Codex e ChatGPT Work).',
      'Contas Plus têm a janela de 5 h compartilhada; Pro não tem esse limite. Limites específicos deste app também podem valer.',
      'A lista de modelos é específica da conta: use "Atualizar modelos" após entrar.',
    ],
  };
}

const catalog = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sources: {
    docs: [
      'https://opencode.ai/v2/docs/console/go/',
      'https://opencode.ai/v2/docs/console/models/',
      ...OPENAI_DOCS,
    ],
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
      defaultModelId: 'deepseek-v4.1-flash',
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
    buildOpenAiProvider(),
  ],
};

const outDir = path.join(ROOT, 'data');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'catalog.json');

// `--provider openai` updates only the OpenAI provider while leaving Go/Zen
// byte-identical (the plan's catalog task requires a surgical diff).
const providerFlagIndex = process.argv.indexOf('--provider');
const onlyProvider = providerFlagIndex >= 0 ? process.argv[providerFlagIndex + 1] : null;

let output = catalog;
if (onlyProvider === 'openai') {
  const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const openai = buildOpenAiProvider();
  output = {
    ...existing,
    generatedAt: new Date().toISOString(),
    sources: {
      ...existing.sources,
      docs: [...new Set([...(existing.sources?.docs ?? []), ...OPENAI_DOCS])],
    },
    providers: [...existing.providers.filter((provider) => provider.id !== 'openai'), openai],
  };
}

fs.writeFileSync(outFile, JSON.stringify(output, null, 1));

for (const p of output.providers) {
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
