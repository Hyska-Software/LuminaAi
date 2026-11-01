#!/usr/bin/env node
/**
 * Updates the three version sources that must stay in sync:
 * - package.json (renderer metadata)
 * - src-tauri/Cargo.toml (app_info / User-Agent / harness)
 * - src-tauri/tauri.conf.json (bundle + window version)
 *
 * Usage: node scripts/set-version.mjs 0.2.0 [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { VERSION_PATTERN, readJson, readVersionState } from './installer/shared.mjs';

const root = path.resolve(import.meta.dirname, '..');
const target = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!target || !VERSION_PATTERN.test(target)) {
  console.error('Uso: node scripts/set-version.mjs <major.minor.patch> [--dry-run]');
  process.exit(2);
}

const current = readVersionState(root);
console.log(`Versão atual: ${current.packageVersion}`);
console.log(`Nova versão:  ${target}`);

const packagePath = path.join(root, 'package.json');
const packageJson = readJson(packagePath);
packageJson.version = target;

const tauriPath = path.join(root, 'src-tauri/tauri.conf.json');
const tauri = readJson(tauriPath);
tauri.version = target;

const cargoPath = path.join(root, 'src-tauri/Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8');
if (!/^version\s*=\s*"[^"]+"/m.test(cargo)) {
  console.error('Não foi possível encontrar a versão em src-tauri/Cargo.toml.');
  process.exit(1);
}
const nextCargo = cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${target}"`);

if (dryRun) {
  console.log('dry-run: nenhum arquivo alterado.');
  process.exit(0);
}

writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
writeFileSync(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`);
writeFileSync(cargoPath, nextCargo);
console.log('Versão atualizada. Rode `cargo check` para atualizar o Cargo.lock.');
