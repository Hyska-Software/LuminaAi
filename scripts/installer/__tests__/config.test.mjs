import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');
const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));

test('windows uses the in-app setup mode instead of a bundled installer', () => {
  const windows = read('src-tauri/tauri.windows.conf.json');
  assert.equal(windows.bundle.active, false);
  assert.ok(existsSync(path.join(root, 'installer.html')));
  assert.ok(existsSync(path.join(root, 'src-tauri/capabilities/installer.json')));
  assert.ok(existsSync(path.join(root, 'src-tauri/src/installer/windows.rs')));
});

test('macOS ships a dark DMG with the app and Applications positions', () => {
  const macos = read('src-tauri/tauri.macos.conf.json');
  assert.deepEqual(macos.bundle.targets, ['app', 'dmg']);
  assert.equal(macos.bundle.macOS.dmg.windowSize.width, 660);
  assert.equal(macos.bundle.macOS.dmg.windowSize.height, 400);
  const background = path.join(root, 'installer/macos/dmg-background.png');
  const background2x = path.join(root, 'installer/macos/dmg-background@2x.png');
  assert.ok(existsSync(background));
  assert.ok(existsSync(background2x));
  const png = readFileSync(background);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(png.readUInt32BE(16), 660);
  assert.equal(png.readUInt32BE(20), 400);
  const retina = readFileSync(background2x);
  assert.equal(retina.readUInt32BE(16), 1320);
  assert.equal(retina.readUInt32BE(20), 800);
});

test('linux ships deb, rpm and AppImage with media support', () => {
  const linux = read('src-tauri/tauri.linux.conf.json');
  assert.deepEqual(linux.bundle.targets, ['deb', 'rpm', 'appimage']);
  assert.equal(linux.bundle.linux.appimage.bundleMediaFramework, true);
  assert.equal(linux.bundle.publisher, 'Zylara');
});
