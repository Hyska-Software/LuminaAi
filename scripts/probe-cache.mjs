#!/usr/bin/env node
/**
 * Probe de prompt caching por provedor/rota (F4.0 do PLAN).
 *
 * Envia DUAS requisições idênticas (prefixo grande, non-stream) por rota e
 * registra o `usage` devolvido: a 1ª aquece o cache, a 2ª deve reportar
 * `cache_read > 0` se a rota suporta cache. Não altera o catálogo: o resultado
 * vira evidência em `docs/goals/prompt-cache/evidence/`.
 *
 * Uso:
 *   node scripts/probe-cache.mjs [--provider anthropic|openai|opencode-go|opencode-zen] [--json <arquivo>]
 *
 * Credenciais:
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY; OpenCode via OPENCODE_API_KEY ou
 *   ~/.local/share/opencode/auth.json. Para OpenAI sem API key tenta o access
 *   token OAuth do auth.json com o perfil chatgpt-plan (store:false).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog.json'), 'utf8'));

const args = process.argv.slice(2);
const providerFlag = valueAfter('--provider');
const modelFlag = valueAfter('--model');
const protocolFlag = valueAfter('--protocol');
const jsonFlag = valueAfter('--json');

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function filler(approxChars = 6_000) {
  const line = 'Zylara cache probe: stable prefix content for prompt-cache validation. ';
  return line.repeat(Math.ceil(approxChars / line.length)).slice(0, approxChars);
}

function readAuthJson() {
  const candidates = [
    path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json'),
    path.join(os.homedir(), '.config', 'opencode', 'auth.json'),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch {
      // sem arquivo nesse caminho
    }
  }
  return null;
}

function readOpencodeKey() {
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY;
  const auth = readAuthJson();
  if (!auth) return null;
  for (const [id, entry] of Object.entries(auth)) {
    if (!id.startsWith('opencode')) continue;
    if (entry?.type === 'api' && typeof entry.key === 'string') return entry.key;
  }
  return null;
}

function openaiOAuthToken() {
  const auth = readAuthJson();
  const entry = auth?.openai;
  if (!entry || typeof entry.access !== 'string') return null;
  if (typeof entry.expires === 'number' && entry.expires > 0 && entry.expires < Date.now()) return null;
  return entry.access;
}

/** `{ token, mode }` onde mode = `api` | `oauth` (OpenAI chatgpt-plan). */
function credentialFor(provider) {
  if (provider.id === 'anthropic') {
    const token = process.env.ANTHROPIC_API_KEY;
    return token ? { token, mode: 'api' } : null;
  }
  if (provider.id === 'openai') {
    if (process.env.OPENAI_API_KEY) return { token: process.env.OPENAI_API_KEY, mode: 'api' };
    const token = openaiOAuthToken();
    return token ? { token, mode: 'oauth' } : null;
  }
  const token = readOpencodeKey();
  return token ? { token, mode: 'api' } : null;
}

function endpoints(provider) {
  const base = provider.baseUrl.replace(/\/$/, '');
  const join = (suffix) => `${base}${suffix}`;
  return {
    anthropic: provider.endpoints.anthropic ? join(provider.endpoints.anthropic) : null,
    responses: provider.endpoints['openai-responses']
      ? join(provider.endpoints['openai-responses'])
      : null,
    chat: provider.endpoints['openai-chat'] ? join(provider.endpoints['openai-chat']) : null,
    google: provider.endpoints.google ? join(provider.endpoints.google) : null,
  };
}

function baseHeaders(provider, credential) {
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${credential.token}`,
    'user-agent': 'Zylara-cache-probe/1.0',
  };
  if (provider.headers) Object.assign(headers, provider.headers);
  if (provider.id.startsWith('opencode')) headers['x-opencode-session'] = 'zylara-cache-probe';
  return headers;
}

function cacheFromUsage(raw) {
  const usage = raw?.usage ?? raw?.usageMetadata ?? raw ?? {};
  const pick = (source, key) => source?.[key] ?? null;
  return {
    input_tokens:
      pick(usage, 'input_tokens') ?? pick(usage, 'prompt_tokens') ?? pick(usage, 'promptTokenCount'),
    cache_read:
      pick(usage, 'cache_read_input_tokens') ??
      usage?.input_tokens_details?.cached_tokens ??
      usage?.prompt_tokens_details?.cached_tokens ??
      pick(usage, 'cachedContentTokenCount') ??
      usage?.opencode?.tokens?.cache_read ??
      pick(usage, 'prompt_cache_hit_tokens') ??
      null,
    cache_write:
      pick(usage, 'cache_creation_input_tokens') ??
      usage?.prompt_tokens_details?.cache_write_tokens ??
      usage?.opencode?.tokens?.cache_write_5m ??
      usage?.opencode?.tokens?.cache_write_1h ??
      null,
    opencode: usage?.opencode?.tokens ?? null,
    raw: usage,
  };
}

async function post(url, headers, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // resposta não-JSON: mantém o texto no relatório
  }
  return { status: response.status, json, text: json ? null : text.slice(0, 500) };
}

function routeFor(provider, model, kind, oauth = false) {
  const urls = endpoints(provider);
  if (kind === 'anthropic') {
    return {
      url: urls.anthropic,
      body: {
        model,
        max_tokens: 8,
        stream: false,
        system: [
          { type: 'text', text: filler() },
          { type: 'text', text: 'Responda apenas OK.', cache_control: { type: 'ephemeral', ttl: '1h' } },
        ],
        messages: [{ role: 'user', content: 'Responda apenas OK.' }],
      },
    };
  }
  if (kind === 'responses') {
    return {
      url: urls.responses,
      body: {
        model,
        input: 'Responda apenas OK.',
        instructions: filler(),
        stream: false,
        ...(oauth
          ? { store: false, include: ['reasoning.encrypted_content'] }
          : { max_output_tokens: 32, prompt_cache_retention: '24h' }),
        prompt_cache_key: 'zylara-cache-probe',
      },
    };
  }
  if (kind === 'chat') {
    return {
      url: urls.chat,
      body: {
        model,
        stream: false,
        max_tokens: 8,
        messages: [
          { role: 'system', content: filler() },
          { role: 'user', content: 'Responda apenas OK.' },
        ],
        prompt_cache_key: 'zylara-cache-probe',
      },
    };
  }
  if (kind === 'google') {
    return {
      url: urls.google ? `${urls.google.replace(/\{model\}/, model)}:generateContent` : null,
      body: {
        systemInstruction: { parts: [{ text: filler() }] },
        contents: [{ role: 'user', parts: [{ text: 'Responda apenas OK.' }] }],
        generationConfig: { maxOutputTokens: 8 },
      },
    };
  }
  return null;
}

async function probeRoute(provider, model, kind) {
  const credential = credentialFor(provider);
  if (!credential) return { route: kind, model, skipped: 'sem credencial' };
  const route = routeFor(provider, model, kind, credential.mode === 'oauth');
  if (!route?.url) return { route: kind, model, skipped: 'sem endpoint no catálogo' };
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await post(route.url, baseHeaders(provider, credential), route.body);
      attempts.push({
        attempt,
        status: result.status,
        cache: result.json ? cacheFromUsage(result.json) : null,
        error: result.status >= 400 ? result.text : null,
      });
      if (result.status >= 400) break;
    } catch (error) {
      attempts.push({ attempt, error: String(error) });
      break;
    }
  }
  return { route: kind, model, authMode: credential.mode, url: route.url, attempts };
}

function modelsFor(provider) {
  if (modelFlag) return [modelFlag];
  return provider.models
    .filter((model) => model.status !== 'unavailable')
    .slice(0, 2)
    .map((model) => model.id);
}

const report = {
  generatedAt: new Date().toISOString(),
  fixture: 'zylara-cache-probe-v1',
  providers: [],
};

for (const provider of catalog.providers) {
  if (providerFlag && provider.id !== providerFlag) continue;
  const entry = { provider: provider.id, name: provider.name, cache: provider.cache ?? null, routes: [] };
  const models = modelsFor(provider);
  const protocols = protocolFlag
    ? [protocolFlag]
    : provider.id === 'anthropic'
      ? ['anthropic']
      : provider.id === 'openai'
        ? ['responses']
        : ['chat', 'anthropic', 'google'];
  for (const model of models) {
    for (const kind of protocols) {
      const modelInfo = provider.models.find((item) => item.id === model);
      const wire = { anthropic: 'anthropic', responses: 'openai-responses', chat: 'openai-chat', google: 'google' }[kind];
      if (modelInfo && wire && !modelInfo.protocols.includes(wire)) continue;
      entry.routes.push(await probeRoute(provider, model, kind));
    }
  }
  report.providers.push(entry);
}

const outDir = path.join(ROOT, 'docs', 'goals', 'prompt-cache', 'evidence');
fs.mkdirSync(outDir, { recursive: true });
const outFile = jsonFlag ? path.resolve(jsonFlag) : path.join(outDir, `probe-${nowStamp()}.json`);
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nprobe salvo em ${outFile}`);
