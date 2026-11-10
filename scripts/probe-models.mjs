#!/usr/bin/env node
/**
 * Probes the OpenCode gateway to discover which wire protocols and reasoning
 * parameters each model accepts. Writes `.research/go-protocols.json`, which is
 * consumed by `build-catalog.mjs`.
 *
 * The API key is read (never printed) from, in order:
 *   1. OPENCODE_API_KEY environment variable
 *   2. OpenCode CLI auth file: ~/.local/share/opencode/auth.json
 *
 * Usage:
 *   node scripts/probe-models.mjs             # all Go models
 *   node scripts/probe-models.mjs --model glm-5.3
 *   node scripts/probe-models.mjs --concurrency 4
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RESEARCH = path.join(ROOT, '.research');
const BASE = 'https://opencode.ai/inference/go';

function loadKey() {
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY.trim();
  const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
  if (fs.existsSync(authPath)) {
    try {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      const entry = auth['opencode-go'] ?? auth.opencode;
      if (entry?.key) return entry.key;
    } catch {
      /* ignore */
    }
  }
  return null;
}

const apiKey = loadKey();
if (!apiKey) {
  console.error('Nenhuma API key encontrada (OPENCODE_API_KEY ou auth.json do OpenCode CLI).');
  process.exit(1);
}

const args = process.argv.slice(2);
const onlyModel = args.includes('--model') ? args[args.indexOf('--model') + 1] : null;
const concurrency = args.includes('--concurrency')
  ? Math.max(1, Number(args[args.indexOf('--concurrency') + 1]) || 4)
  : 4;

const headers = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'User-Agent': 'Zylara-probe/1.0',
  'x-opencode-session': `probe-${Date.now()}`,
};

const PROTOCOLS = {
  'openai-chat': (model) => ({
    url: `${BASE}/openai/v1/chat/completions`,
    body: {
      model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    },
  }),
  'openai-responses': (model) => ({
    url: `${BASE}/openai/v1/responses`,
    body: { model, max_output_tokens: 64, input: 'Reply with the single word: ok' },
  }),
  anthropic: (model) => ({
    url: `${BASE}/anthropic/v1/messages`,
    body: {
      model,
      max_tokens: 24,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    },
  }),
  google: (model) => ({
    url: `${BASE}/google/v1beta/models/${model}:generateContent`,
    body: { contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }] },
  }),
};

async function tryProtocol(protocol, model) {
  const { url, body } = PROTOCOLS[protocol](model);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    const ms = Date.now() - started;
    if (res.ok) return { protocol, ok: true, ms };
    let err = text;
    try {
      const json = JSON.parse(text);
      err = json?.error?.message ?? json?.error?.type ?? text;
    } catch {
      /* keep */
    }
    return { protocol, ok: false, status: res.status, err: String(err).slice(0, 180), ms };
  } catch (error) {
    return { protocol, ok: false, err: `NET ${error.message.slice(0, 140)}`, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  const listRes = await fetch(`${BASE}/v1/models`, { headers });
  if (!listRes.ok) throw new Error(`models endpoint -> HTTP ${listRes.status}`);
  const list = await listRes.json();
  let ids = list.data.map((item) => item.id);
  if (onlyModel) ids = ids.filter((id) => id === onlyModel);
  console.log(`${ids.length} modelo(s) para sondar, concorrência ${concurrency}`);

  const results = await mapLimit(ids, concurrency, async (id) => {
    const attempts = [];
    for (const protocol of Object.keys(PROTOCOLS)) {
      const result = await tryProtocol(protocol, id);
      attempts.push(result);
      if (result.ok) break; // primary protocol found; alternatives stay unknown
    }
    const detected = attempts.find((a) => a.ok)?.protocol ?? null;
    console.log(
      `${detected ? 'OK  ' : 'FAIL'} ${id.padEnd(34)} ${detected ?? attempts.map((a) => `${a.protocol}:${a.status ?? a.err}`).join(' | ')}`,
    );
    return { id, detected, attempts };
  });

  fs.mkdirSync(RESEARCH, { recursive: true });
  const outFile = path.join(RESEARCH, 'go-protocols.json');
  fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
  const summary = results.reduce((acc, item) => {
    const key = item.detected ?? 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nWrote ${outFile}`);
  console.log('Summary:', JSON.stringify(summary));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
