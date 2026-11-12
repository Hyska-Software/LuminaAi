import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  installerScriptName,
  managedTarget,
  payloadForTarget,
  renderUnixInstaller,
} from '../unix.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasSh() {
  return !spawnSync('sh', ['-c', 'exit 0']).error;
}

function hasCommand(name) {
  const result = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0;
}

function tempDir(prefix = 'zylara-installer-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

async function serve(payload, route) {
  const server = createServer((request, response) => {
    if (request.url === route) {
      response.writeHead(200, { 'content-length': payload.length });
      response.end(payload);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function writeScript(directory, script) {
  const file = path.join(directory, 'install.sh');
  writeFileSync(file, script);
  return file;
}

const linuxPayload = Buffer.from('zylara-fake-appimage-payload');
const macosPayload = Buffer.from('zylara-fake-dmg-payload');

test('renders a Linux script with embedded release metadata', () => {
  const script = renderUnixInstaller({
    version: '0.8.0',
    platform: 'linux',
    arch: 'x64',
    artifact: {
      name: 'Zylara-0.8.0-linux-x64.AppImage',
      size: linuxPayload.length,
      sha256: sha256(linuxPayload),
    },
  });
  assert.match(script, /ZYLARA_VERSION='0\.8\.0'/);
  assert.match(script, /ZYLARA_PLATFORM='linux'/);
  assert.match(script, /ZYLARA_PAYLOAD_NAME='Zylara-0\.8\.0-linux-x64\.AppImage'/);
  assert.match(script, new RegExp(`ZYLARA_PAYLOAD_SIZE=${linuxPayload.length}`));
  assert.match(script, /ZYLARA_PAYLOAD_URL='https:\/\/github\.com\/Hyska-Software\/ZylaraAi\/releases\/download\/v0\.8\.0\//);
  assert.match(script, /\.local\/opt\/zylara/);
  assert.match(script, /managed-install\.json/);
  assert.doesNotMatch(script, /@[A-Z_]+@/);
});

test('renders a macOS script with the DMG target and validation', () => {
  const script = renderUnixInstaller({
    version: '0.8.0',
    platform: 'macos',
    arch: 'arm64',
    artifact: {
      name: 'Zylara-0.8.0-macos-arm64.dmg',
      size: macosPayload.length,
      sha256: sha256(macosPayload),
    },
  });
  assert.match(script, /ZYLARA_PLATFORM='macos'/);
  assert.match(script, /ZYLARA_ARCH='arm64'/);
  assert.match(script, /\$HOME\/Applications/);
  assert.match(script, /hdiutil attach/);
  assert.match(script, /CFBundleIdentifier/);
  assert.match(script, /codesign --verify --deep --strict/);
  assert.doesNotMatch(script, /@[A-Z_]+@/);
});

test('generated scripts pass sh -n', (t) => {
  if (!hasSh()) {
    t.skip('sh is not available');
    return;
  }
  const directory = tempDir('zylara-syntax-');
  try {
    for (const [platform, arch, name, size, sha] of [
      ['linux', 'x64', 'Zylara-0.8.0-linux-x64.AppImage', linuxPayload.length, sha256(linuxPayload)],
      ['macos', 'arm64', 'Zylara-0.8.0-macos-arm64.dmg', macosPayload.length, sha256(macosPayload)],
    ]) {
      const script = renderUnixInstaller({
        version: '0.8.0',
        platform,
        arch,
        artifact: { name, size, sha256: sha },
      });
      const file = writeScript(directory, script);
      const result = spawnSync('sh', ['-n', file], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${platform}: ${result.stderr}`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects unsupported targets and unsafe artifact metadata', () => {
  assert.equal(managedTarget('linux', 'arm64'), null);
  assert.equal(managedTarget('macos', 'x64'), null);
  assert.equal(managedTarget('macos', 'universal'), null);
  assert.equal(installerScriptName('0.8.0', 'linux', 'x64'), 'Zylara-install-0.8.0-linux-x64.sh');
  assert.throws(() => installerScriptName('0.8', 'linux', 'x64'));
  assert.throws(() => installerScriptName('0.8.0', 'linux', 'arm64'));

  const base = {
    version: '0.8.0',
    platform: 'linux',
    arch: 'x64',
    artifact: {
      name: 'Zylara-0.8.0-linux-x64.AppImage',
      size: 10,
      sha256: 'a'.repeat(64),
    },
  };
  assert.throws(() => renderUnixInstaller({ ...base, version: '0.8' }));
  assert.throws(() => renderUnixInstaller({ ...base, platform: 'windows' }));
  assert.throws(() =>
    renderUnixInstaller({ ...base, artifact: { ...base.artifact, name: '../x.AppImage' } }),
  );
  assert.throws(() =>
    renderUnixInstaller({ ...base, artifact: { ...base.artifact, name: 'Zylara-0.8.0.dmg' } }),
  );
  assert.throws(() =>
    renderUnixInstaller({ ...base, artifact: { ...base.artifact, size: 0 } }),
  );
  assert.throws(() =>
    renderUnixInstaller({ ...base, artifact: { ...base.artifact, sha256: 'abc' } }),
  );
  assert.throws(() => renderUnixInstaller({ ...base, baseUrl: 'http://example.com' }));
  assert.doesNotThrow(() =>
    renderUnixInstaller({ ...base, baseUrl: 'http://127.0.0.1:9999' }),
  );
});

test('payloadForTarget selects the managed payload', () => {
  const linux = managedTarget('linux', 'x64');
  const macos = managedTarget('macos', 'arm64');
  assert.equal(
    payloadForTarget(['a.deb', 'Zylara-0.8.0-linux-x64.AppImage', 'a.rpm'], linux),
    'Zylara-0.8.0-linux-x64.AppImage',
  );
  assert.equal(payloadForTarget(['a.dmg'], macos), 'a.dmg');
  assert.equal(payloadForTarget(['a.deb'], linux), null);
});

test('localizes fatal errors in Portuguese and Spanish', (t) => {
  if (!hasSh()) {
    t.skip('sh is not available');
    return;
  }
  const directory = tempDir('zylara-locale-');
  try {
    const script = renderUnixInstaller({
      version: '0.8.0',
      platform: 'linux',
      arch: 'x64',
      artifact: {
        name: 'Zylara-0.8.0-linux-x64.AppImage',
        size: linuxPayload.length,
        sha256: sha256(linuxPayload),
      },
    });
    const file = writeScript(directory, script);
    for (const [lang, expected] of [
      ['pt', /Este instalador|HOME precisa/],
      ['es', /Este instalador|HOME debe/],
      ['en', /This installer|HOME must/],
    ]) {
      const result = spawnSync('sh', [file], {
        encoding: 'utf8',
        env: { ...process.env, HOME: '', ZYLARA_LANG: lang },
      });
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}${result.stderr}`, expected);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  'installs an AppImage into a temporary HOME and keeps the old file on a bad hash',
  { skip: process.platform !== 'linux' },
  async (t) => {
    if (!hasSh() || !hasCommand('curl') || !hasCommand('sha256sum')) {
      t.skip('sh, curl or sha256sum is not available');
      return;
    }
    const directory = tempDir('zylara-linux-install-');
    const home = path.join(directory, 'home with space');
    const data = path.join(directory, 'data');
    mkdirSync(home, { recursive: true });
    mkdirSync(data, { recursive: true });
    const name = 'Zylara-0.8.0-linux-x64.AppImage';
    const route = `/releases/download/v0.8.0/${name}`;
    const server = await serve(linuxPayload, route);
    try {
      const script = renderUnixInstaller({
        version: '0.8.0',
        platform: 'linux',
        arch: 'x64',
        artifact: { name, size: linuxPayload.length, sha256: sha256(linuxPayload) },
        baseUrl: server.baseUrl,
      });
      const file = writeScript(directory, script);
      const env = {
        ...process.env,
        HOME: home,
        XDG_DATA_HOME: data,
        ZYLARA_NO_LAUNCH: '1',
      };
      const first = spawnSync('sh', [file], { encoding: 'utf8', env });
      assert.equal(first.status, 0, first.stderr);
      const target = path.join(home, '.local', 'opt', 'zylara', 'Zylara.AppImage');
      assert.deepEqual(readFileSync(target), linuxPayload);
      assert.equal(statSync(target).mode & 0o777, 0o755);
      const desktop = path.join(data, 'applications', 'zylara-managed.desktop');
      const desktopBody = readFileSync(desktop, 'utf8');
      assert.match(desktopBody, /X-Zylara-Managed=true/);
      assert.match(desktopBody, /Exec=".*Zylara\.AppImage"/);
      const marker = path.join(data, 'app.zylara.chat', 'managed-install.json');
      const markerJson = JSON.parse(readFileSync(marker, 'utf8'));
      assert.deepEqual(markerJson, {
        schemaVersion: 1,
        method: 'managed-script',
        platform: 'linux',
        arch: 'x64',
        installPath: target,
        version: '0.8.0',
      });

      const second = spawnSync('sh', [file], { encoding: 'utf8', env });
      assert.equal(second.status, 0, second.stderr);
      assert.deepEqual(readFileSync(target), linuxPayload);

      const bad = Buffer.from('corrupt payload');
      const badServer = await serve(bad, route);
      try {
        const badScript = renderUnixInstaller({
          version: '0.8.0',
          platform: 'linux',
          arch: 'x64',
          artifact: { name, size: bad.length, sha256: sha256(linuxPayload) },
          baseUrl: badServer.baseUrl,
        });
        const badFile = writeScript(directory, badScript);
        const failed = spawnSync('sh', [badFile], { encoding: 'utf8', env });
        assert.notEqual(failed.status, 0);
        assert.deepEqual(readFileSync(target), linuxPayload);
      } finally {
        await badServer.close();
      }
    } finally {
      await server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  'installs a DMG into a temporary HOME on macOS',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    if (
      !hasSh() ||
      !hasCommand('hdiutil') ||
      !hasCommand('ditto') ||
      !hasCommand('plutil') ||
      !hasCommand('open')
    ) {
      t.skip('macOS packaging tools are not available');
      return;
    }
    const directory = tempDir('zylara-macos-install-');
    const source = path.join(directory, 'source');
    const home = path.join(directory, 'home');
    const app = path.join(source, 'Zylara.app');
    mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(
      path.join(app, 'Contents', 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.zylara.chat</string>
<key>CFBundleExecutable</key><string>zylara</string>
</dict></plist>
`,
    );
    writeFileSync(path.join(app, 'Contents', 'MacOS', 'zylara'), '#!/bin/sh\nexit 0\n');
    chmodSync(path.join(app, 'Contents', 'MacOS', 'zylara'), 0o755);
    const dmg = path.join(directory, 'Zylara-0.8.0-macos-arm64.dmg');
    const created = spawnSync(
      'hdiutil',
      ['create', '-volname', 'Zylara', '-srcfolder', source, '-ov', '-format', 'UDZO', dmg],
      { encoding: 'utf8' },
    );
    assert.equal(created.status, 0, created.stderr);
    const payload = readFileSync(dmg);
    const name = 'Zylara-0.8.0-macos-arm64.dmg';
    const route = `/releases/download/v0.8.0/${name}`;
    const server = await serve(payload, route);
    try {
      const script = renderUnixInstaller({
        version: '0.8.0',
        platform: 'macos',
        arch: 'arm64',
        artifact: { name, size: payload.length, sha256: sha256(payload) },
        baseUrl: server.baseUrl,
      });
      const file = writeScript(directory, script);
      const result = spawnSync('sh', [file], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home, ZYLARA_NO_LAUNCH: '1' },
      });
      assert.equal(result.status, 0, result.stderr);
      const target = path.join(home, 'Applications', 'Zylara.app');
      assert.ok(existsSync(path.join(target, 'Contents', 'Info.plist')));
      const marker = path.join(
        home,
        'Library',
        'Application Support',
        'app.zylara.chat',
        'managed-install.json',
      );
      const markerJson = JSON.parse(readFileSync(marker, 'utf8'));
      assert.equal(markerJson.platform, 'macos');
      assert.equal(markerJson.arch, 'arm64');
      assert.equal(markerJson.installPath, target);
    } finally {
      await server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
