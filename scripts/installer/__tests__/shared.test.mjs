import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  artifactFileName,
  assertVersionsInSync,
  buildManifest,
  compareVersions,
  hostPlatform,
  parseSemver,
  platformLabel,
  sha256File,
} from '../shared.mjs';

test('parses and compares semantic versions', () => {
  assert.deepEqual(parseSemver('v0.2.10'), { major: 0, minor: 2, patch: 10 });
  assert.equal(parseSemver('0.2'), null);
  assert.equal(compareVersions('0.2.10', '0.2.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.9.0', '1.0.0'), -1);
});

test('maps hosts and artifact labels', () => {
  assert.equal(hostPlatform('win32'), 'windows');
  assert.equal(hostPlatform('darwin'), 'macos');
  assert.equal(hostPlatform('freebsd'), null);
  assert.equal(platformLabel('win32', 'x64'), 'windows-x64');
  assert.equal(platformLabel('darwin', 'arm64'), 'macos-arm64');
  assert.equal(platformLabel('darwin', 'universal'), 'macos-universal');
  assert.equal(platformLabel('linux', 'x64'), 'linux-x64');
  assert.equal(
    artifactFileName('1.2.3', 'windows', 'x64', '.exe'),
    'Lumina-Setup-1.2.3-windows-x64.exe',
  );
});

test('requires all version sources to match', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumina-version-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.2.0' }));
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  mkdirSync(path.join(root, 'src/lib'), { recursive: true });
  writeFileSync(
    path.join(root, 'src-tauri/tauri.conf.json'),
    JSON.stringify({ version: '0.2.0' }),
  );
  writeFileSync(
    path.join(root, 'src-tauri/Cargo.toml'),
    '[package]\nname = "lumina"\nversion = "0.2.0"\n',
  );
  writeFileSync(
    path.join(root, 'src/lib/appVersion.ts'),
    "export const APP_VERSION_FALLBACK = '0.2.0';\n",
  );
  writeFileSync(
    path.join(root, 'src-tauri/Cargo.lock'),
    '[[package]]\nname = "lumina"\nversion = "0.2.0"\n',
  );
  assert.equal(assertVersionsInSync(root), '0.2.0');

  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.3.0' }));
  assert.throws(() => assertVersionsInSync(root), /divergentes/);
});

test('manifest records checksums and sizes', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lumina-manifest-'));
  const file = path.join(directory, 'Lumina-Setup.exe');
  writeFileSync(file, 'lumina');
  const hash = sha256File(file);
  assert.equal(hash.length, 64);
  const manifest = buildManifest({
    version: '0.1.0',
    commit: 'abc123',
    branch: 'main',
    platform: 'windows-x64',
    arch: 'x64',
    files: [file],
    signed: false,
    minOs: 'Windows 10/11',
  });
  assert.equal(manifest.product, 'Lumina');
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].sha256, hash);
  assert.equal(manifest.artifacts[0].size, 6);
  assert.equal(manifest.signed, false);
});
