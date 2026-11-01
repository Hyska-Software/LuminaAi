#!/usr/bin/env node
/**
 * Updates every version source that must stay in sync:
 * - package.json (release workflow + artifact names)
 * - src-tauri/Cargo.toml (CARGO_PKG_VERSION: app_info, installer, updater)
 * - src-tauri/tauri.conf.json (bundle metadata)
 * - src/lib/appVersion.ts (renderer fallback)
 * - src-tauri/Cargo.lock (generated package record)
 *
 * All platforms share the same version.
 *
 * Usage:
 *   node scripts/set-version.mjs 0.2.0 [--dry-run] [--force] [--allow-downgrade]
 *   node scripts/set-version.mjs --bump patch|minor|major [--dry-run]
 *   node scripts/set-version.mjs --state
 *   node scripts/set-version.mjs --compare 0.2.0
 */
import path from 'node:path';
import process from 'node:process';

import { readVersionState } from './installer/shared.mjs';
import {
  applyVersion,
  compareSemver,
  isVersion,
  nextVersion,
  normalizeVersion,
} from './installer/version.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);

function usage() {
  console.error(
    'Uso: node scripts/set-version.mjs <major.minor.patch> [--dry-run] [--force] [--allow-downgrade]\n' +
      '     node scripts/set-version.mjs --bump patch|minor|major [--dry-run]\n' +
      '     node scripts/set-version.mjs --state\n' +
      '     node scripts/set-version.mjs --compare <versão>',
  );
  process.exit(2);
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

const state = readVersionState(root);

if (args.includes('--state')) {
  console.log(JSON.stringify(state, null, 2));
  process.exit(0);
}

const compareTarget = valueAfter('--compare');
if (compareTarget !== null) {
  if (!isVersion(compareTarget) || !state.packageVersion) {
    console.error(`[version] versão inválida: ${compareTarget}`);
    process.exit(2);
  }
  try {
    console.log(compareSemver(normalizeVersion(compareTarget), state.packageVersion));
  } catch (error) {
    console.error(`[version] ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

const bumpEquals = args.find((arg) => arg.startsWith('--bump='));
const bump = bumpEquals ? bumpEquals.slice('--bump='.length) : valueAfter('--bump');
const positional = args.filter(
  (arg, index) => !arg.startsWith('--') && args[index - 1] !== '--bump' && args[index - 1] !== '--compare',
);

if (bump !== null && positional.length > 0) {
  console.error('[version] use uma versão explícita OU --bump, não os dois.');
  process.exit(2);
}
if (bump !== null && !['patch', 'minor', 'major'].includes(bump)) {
  console.error(`[version] bump inválido: ${bump}`);
  process.exit(2);
}
if (bump === null && positional.length !== 1) {
  usage();
}

let target;
if (bump !== null) {
  try {
    target = nextVersion(state.packageVersion, bump);
  } catch (error) {
    console.error(`[version] ${error.message}`);
    process.exit(1);
  }
} else {
  target = normalizeVersion(positional[0]);
  if (!isVersion(target)) {
    console.error(`[version] versão inválida: ${positional[0]}`);
    process.exit(2);
  }
}

const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const allowDowngrade = force || args.includes('--allow-downgrade');

try {
  const result = applyVersion(root, target, { dryRun, force, allowDowngrade });
  console.log(`Versão atual: ${result.current}`);
  console.log(`Nova versão:  ${result.target}`);
  console.log(dryRun ? 'Arquivos que seriam atualizados:' : 'Arquivos atualizados:');
  for (const file of result.files) {
    console.log(`  - ${file}`);
  }
  if (dryRun) {
    console.log('dry-run: nenhum arquivo alterado.');
  } else {
    console.log('Versão verificada em todas as fontes.');
  }
} catch (error) {
  console.error(`[version] ${error.message}`);
  process.exit(1);
}
