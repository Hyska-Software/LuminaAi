#!/usr/bin/env node
/**
 * Combines the per-platform outputs of `pnpm installer` into a single release
 * directory. GitHub release assets must have unique names; the per-platform
 * metadata files (`release.json`, `SHA256SUMS.txt`) are merged instead of
 * uploaded three times.
 *
 * Usage: node scripts/combine-release.mjs [source] [destination]
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const source = path.resolve(process.argv[2] ?? 'release');
const destination = path.resolve(process.argv[3] ?? 'dist');

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

if (!existsSync(source)) {
  console.error(`Origem inexistente: ${source}`);
  process.exit(1);
}

const files = walk(source);
const manifests = files
  .filter((file) => path.basename(file) === 'release.json')
  .map((file) => JSON.parse(readFileSync(file, 'utf8')));

if (manifests.length === 0) {
  console.error(`Nenhum release.json encontrado em ${source}`);
  process.exit(1);
}

const version = manifests[0].version;
if (manifests.some((manifest) => manifest.version !== version)) {
  console.error('Os manifestos possuem versões diferentes.');
  process.exit(1);
}

const binaryExtensions = new Set(['.exe', '.dmg', '.deb', '.rpm', '.appimage']);
const binaries = files.filter((file) =>
  binaryExtensions.has(path.extname(file).toLowerCase()),
);
if (binaries.length === 0) {
  console.error(`Nenhum artefato binário encontrado em ${source}`);
  process.exit(1);
}

const seen = new Map();
for (const file of binaries) {
  const name = path.basename(file);
  if (seen.has(name)) {
    console.error(`Nome de artefato duplicado: ${name}\n  ${seen.get(name)}\n  ${file}`);
    process.exit(1);
  }
  seen.set(name, file);
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });

const artifacts = [];
const checksumLines = [];
for (const file of [...binaries].sort((a, b) => a.localeCompare(b))) {
  const name = path.basename(file);
  const target = path.join(destination, name);
  copyFileSync(file, target);
  const bytes = readFileSync(target);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  artifacts.push({ name, size: bytes.length, sha256 });
  checksumLines.push(`${sha256}  ${name}`);
}

const platforms = manifests.map((manifest) => ({
  platform: manifest.platform,
  arch: manifest.arch,
  commit: manifest.commit,
  builtAt: manifest.builtAt,
  signed: manifest.signed,
  dirty: manifest.dirty,
  minOs: manifest.minOs,
}));

const release = {
  schemaVersion: 1,
  product: 'Lumina',
  version,
  commit: manifests[0].commit,
  builtAt: new Date().toISOString(),
  platforms,
  artifacts,
};

writeFileSync(path.join(destination, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
writeFileSync(path.join(destination, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`);

console.log(`Release ${version}: ${artifacts.length} artefato(s) em ${destination}`);
for (const artifact of artifacts) {
  console.log(`  ${artifact.name}  ${artifact.size} bytes  ${artifact.sha256}`);
}
