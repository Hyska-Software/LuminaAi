import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');
const script = path.join(root, 'scripts/combine-release.mjs');

test('combines unique artifacts and merges per-platform metadata', () => {
  const source = mkdtempSync(path.join(tmpdir(), 'zylara-combine-'));
  const out = path.join(source, 'dist');
  for (const platform of ['windows-x64', 'linux-x64']) {
    const dir = path.join(source, '0.1.0', platform);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'release.json'),
      JSON.stringify({
        version: '0.1.0',
        platform,
        arch: 'x64',
        commit: 'abc',
        builtAt: '2026-01-01T00:00:00.000Z',
        signed: false,
        dirty: false,
        minOs: platform,
      }),
    );
    writeFileSync(path.join(dir, `${platform}.exe`), platform);
    if (platform === 'linux-x64') {
      writeFileSync(path.join(dir, 'Zylara-install-0.1.0-linux-x64.sh'), '#!/bin/sh\n');
    }
  }
  const result = spawnSync(process.execPath, [script, source, out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(path.join(out, 'release.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.platforms.length, 2);
  assert.equal(manifest.artifacts.length, 3);
  assert.ok(manifest.artifacts.some((artifact) => artifact.name.endsWith('.sh')));
  const sums = readFileSync(path.join(out, 'SHA256SUMS.txt'), 'utf8');
  assert.match(sums, /windows-x64\.exe/);
  assert.match(sums, /linux-x64\.exe/);
  assert.match(sums, /Zylara-install-0\.1\.0-linux-x64\.sh/);
});

test('fails when two platforms have the same artifact name', () => {
  const source = mkdtempSync(path.join(tmpdir(), 'zylara-combine-dup-'));
  for (const platform of ['a', 'b']) {
    const dir = path.join(source, platform);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ version: '0.1.0' }));
    writeFileSync(path.join(dir, 'same.exe'), platform);
  }
  const result = spawnSync(process.execPath, [script, source, path.join(source, 'dist')], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicado/);
});
