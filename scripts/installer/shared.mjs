import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function parseSemver(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareVersions(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) throw new Error(`versão inválida: ${!a ? left : right}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  return 0;
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function readVersionState(root) {
  const packageJson = readJson(path.join(root, 'package.json'));
  const tauri = readJson(path.join(root, 'src-tauri/tauri.conf.json'));
  const cargo = readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;

  const uiPath = path.join(root, 'src/lib/appVersion.ts');
  const ui = existsSync(uiPath) ? readFileSync(uiPath, 'utf8') : '';
  const uiVersion = ui.match(/APP_VERSION_FALLBACK\s*=\s*'([^']+)'/)?.[1] ?? null;

  const lockPath = path.join(root, 'src-tauri/Cargo.lock');
  const lock = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : '';
  const lockVersion =
    lock.match(
      /\[\[package\]\]\r?\nname = "lumina"\r?\nversion = "([^"]+)"/,
    )?.[1] ?? null;

  return {
    packageVersion: packageJson.version,
    tauriVersion: tauri.version,
    cargoVersion,
    uiVersion,
    lockVersion,
  };
}

export function assertVersionsInSync(root) {
  const state = readVersionState(root);
  const versions = [
    state.packageVersion,
    state.tauriVersion,
    state.cargoVersion,
    state.uiVersion,
    state.lockVersion,
  ];
  if (versions.some((value) => !value)) {
    throw new Error(
      `Versão ausente: package.json=${state.packageVersion ?? '?'}, tauri.conf.json=${state.tauriVersion ?? '?'}, Cargo.toml=${state.cargoVersion ?? '?'}, appVersion.ts=${state.uiVersion ?? '?'}, Cargo.lock=${state.lockVersion ?? '?'}`,
    );
  }
  if (!VERSION_PATTERN.test(versions[0])) {
    throw new Error(`Versão inválida em package.json: ${versions[0]}`);
  }
  if (new Set(versions).size !== 1) {
    throw new Error(
      `Versões divergentes: package.json=${versions[0]}, tauri.conf.json=${versions[1]}, Cargo.toml=${versions[2]}, appVersion.ts=${versions[3]}, Cargo.lock=${versions[4]}. Rode "pnpm version:set ${versions[0]}" após revisar.`,
    );
  }
  return versions[0];
}

export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function artifactFileName(version, platform, arch, extension) {
  const suffix = extension.startsWith('.') ? extension : `.${extension}`;
  return `Lumina-Setup-${version}-${platform}-${arch}${suffix}`;
}

export function platformLabel(host, arch) {
  const suffix = arch === 'universal' ? 'universal' : arch === 'arm64' ? 'arm64' : 'x64';
  if (host === 'win32') return `windows-${suffix}`;
  if (host === 'darwin') return `macos-${suffix}`;
  if (host === 'linux') return `linux-${suffix}`;
  return `${host}-${suffix}`;
}

export function hostPlatform(host) {
  if (host === 'win32') return 'windows';
  if (host === 'darwin') return 'macos';
  if (host === 'linux') return 'linux';
  return null;
}

export function bundleDirectory(targetRoot, platform, arch) {
  if (platform === 'macos' && arch === 'universal') {
    return path.join(targetRoot, 'universal-apple-darwin', 'release', 'bundle');
  }
  return path.join(targetRoot, 'release', 'bundle');
}

export function listArtifacts(files) {
  return files
    .filter((file) => existsSync(file))
    .map((file) => ({
      path: file,
      name: path.basename(file),
      size: readFileSync(file).length,
      sha256: sha256File(file),
    }));
}

export function buildManifest({
  version,
  commit,
  branch,
  platform,
  arch,
  files,
  signed,
  channel = 'stable',
  minOs = null,
  dirty = false,
}) {
  const artifacts = listArtifacts(files).map((artifact) => ({
    name: artifact.name,
    size: artifact.size,
    sha256: artifact.sha256,
  }));
  return {
    schemaVersion: 1,
    product: 'Lumina',
    version,
    channel,
    commit,
    branch,
    builtAt: new Date().toISOString(),
    platform,
    arch,
    signed,
    dirty,
    minOs,
    artifacts,
  };
}
