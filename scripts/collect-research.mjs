#!/usr/bin/env node
/**
 * Downloads the research inputs used by `build-catalog.mjs`:
 *  - official OpenCode Go + Zen docs (model tables)
 *  - models.dev catalog (capabilities, reasoning options, pricing)
 *
 * Usage: node scripts/collect-research.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RESEARCH = path.join(ROOT, '.research');
const DOCS = path.join(RESEARCH, 'docs');

async function get(url, timeoutMs = 120_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  fs.mkdirSync(DOCS, { recursive: true });

  console.log('• docs: OpenCode Go');
  fs.writeFileSync(path.join(DOCS, 'go.html'), await get('https://opencode.ai/v2/docs/console/go/'));

  console.log('• docs: OpenCode Zen / Console models');
  fs.writeFileSync(
    path.join(DOCS, 'zen.html'),
    await get('https://opencode.ai/v2/docs/console/models/'),
  );

  console.log('• models.dev catalog');
  fs.writeFileSync(path.join(RESEARCH, 'models-dev.json'), await get('https://models.dev/api.json'));

  console.log('• live model lists');
  for (const [name, url] of [
    ['go-models-live.json', 'https://opencode.ai/inference/go/v1/models'],
    ['zen-models-live.json', 'https://opencode.ai/inference/v1/models'],
  ]) {
    try {
      fs.writeFileSync(path.join(RESEARCH, name), await get(url, 30_000));
    } catch (error) {
      console.warn(`  ! ${name}: ${error.message}`);
    }
  }

  console.log('\nDone. Next: node scripts/probe-models.mjs && node scripts/build-catalog.mjs');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
