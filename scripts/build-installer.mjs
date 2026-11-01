#!/usr/bin/env node
/**
 * Builds the latest Lumina installer artifacts for the host platform.
 *
 * Manual use:
 *   pnpm installer
 *   pnpm installer --platform windows --allow-dirty
 *   pnpm installer --platform macos --universal --skip-tests
 *
 * Each CI job runs one platform; cross-building is intentionally rejected
 * because macOS signing and Linux glibc baselines need a native host.
 */
import { spawnSync } from 'node:child_process';
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
import { parseArgs } from 'node:util';

import {
  artifactFileName,
  assertVersionsInSync,
  buildManifest,
  hostPlatform,
  listArtifacts,
  platformLabel,
  sha256File,
  VERSION_PATTERN,
} from './installer/shared.mjs';

const root = path.resolve(import.meta.dirname, '..');

const { values } = parseArgs({
  options: {
    platform: { type: 'string', default: 'host' },
    arch: { type: 'string', default: 'host' },
    version: { type: 'string' },
    out: { type: 'string', default: 'release' },
    'skip-tests': { type: 'boolean', default: false },
    'skip-typecheck': { type: 'boolean', default: false },
    universal: { type: 'boolean', default: false },
    ci: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'allow-dirty': { type: 'boolean', default: false },
    'require-clean': { type: 'boolean', default: false },
    'no-sign': { type: 'boolean', default: false },
    channel: { type: 'string', default: 'stable' },
    verbose: { type: 'boolean', default: false },
  },
  strict: true,
});

const host = process.platform;
const hostPlat = hostPlatform(host);
if (!hostPlat) {
  console.error(`Sistema operacional não suportado: ${host}`);
  process.exit(2);
}
const platform = values.platform === 'host' ? hostPlat : values.platform;
if (!['windows', 'macos', 'linux'].includes(platform)) {
  console.error('Use --platform windows|macos|linux|host.');
  process.exit(2);
}
if (platform !== hostPlat && !values['dry-run']) {
  console.error(
    `Não é possível gerar o instalador de ${platform} em ${host}. Use um host ${platform} ou o CI (matriz por plataforma).`,
  );
  process.exit(2);
}
if (platform !== hostPlat) {
  console.log(
    `[installer] dry-run estático de ${platform} em ${host}: comandos de build não serão executados.`,
  );
}

const arch = values.universal
  ? 'universal'
  : values.arch === 'host'
    ? process.arch === 'arm64'
      ? 'arm64'
      : 'x64'
    : values.arch;
if (!['x64', 'arm64', 'universal'].includes(arch)) {
  console.error('Use --arch x64|arm64|universal.');
  process.exit(2);
}
if (arch === 'universal' && platform !== 'macos') {
  console.error('--universal só é suportado no macOS.');
  process.exit(2);
}

const outRoot = path.resolve(root, values.out);
let version = '0.0.0';

function log(message) {
  if (!values.ci) console.log(message);
}

function fail(message) {
  console.error(`\n[installer] ${message}`);
  process.exit(1);
}

function windowsQuote(value) {
  return /[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function commandSpec(command, args) {
  if (process.platform === 'win32') {
    // Node 24 rejects spawning .cmd files directly on Windows. A single shell
    // command string avoids the deprecated (and unsafe) args+shell combination.
    return { file: [command, ...args.map(windowsQuote)].join(' '), args: [], shell: true };
  }
  return { file: command, args, shell: false };
}

function run(command, args, options = {}) {
  log(`\n$ ${[command, ...args].join(' ')}`);
  const spec = commandSpec(command, args);
  const result = spawnSync(spec.file, spec.args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    shell: spec.shell,
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout,
  });
  if (result.error) fail(`${command} falhou: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} terminou com código ${result.status}.`);
}

function capture(command, args) {
  const spec = commandSpec(command, args);
  const result = spawnSync(spec.file, spec.args, {
    cwd: root,
    encoding: 'utf8',
    shell: spec.shell,
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function cleanPlatformOut(platformLabelValue) {
  const target = path.join(outRoot, version, platformLabelValue);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  return target;
}

function writeChecksums(directory, files) {
  const lines = files
    .filter((file) => existsSync(file))
    .map((file) => `${sha256File(file)}  ${path.basename(file)}`);
  writeFileSync(path.join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
}

function currentVersion() {
  if (values.version) {
    if (!VERSION_PATTERN.test(values.version)) fail(`Versão inválida: ${values.version}`);
    if (values['dry-run']) {
      fail('--version não é permitido com --dry-run (o dry-run não altera arquivos).');
    }
    run(process.execPath, [path.join(root, 'scripts/set-version.mjs'), values.version]);
  }
  try {
    return assertVersionsInSync(root);
  } catch (error) {
    fail(error.message);
  }
}

function ensureAssets() {
  const required = [
    'installer.html',
    'src/installer/main.tsx',
    'scripts/set-version.mjs',
    'src-tauri/capabilities/installer.json',
  ];
  if (platform === 'macos') required.push('installer/macos/dmg-background.png');
  const missing = required.filter((file) => !existsSync(path.join(root, file)));
  if (missing.length) fail(`Assets ausentes: ${missing.join(', ')}`);
}

function gitInfo() {
  const dirty = capture('git', ['status', '--porcelain']);
  if (dirty && values['require-clean'] && !values['dry-run']) {
    fail(
      'A árvore de trabalho tem alterações não commitadas e --require-clean foi pedido. Faça commit antes do release.',
    );
  }
  if (dirty && !values['allow-dirty'] && !values['require-clean']) {
    log('\n[installer] aviso: árvore suja; o manifesto registrará dirty=true. Use --require-clean no CI de release.');
  }
  return {
    commit: capture('git', ['rev-parse', 'HEAD']) || 'unknown',
    branch: capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown',
    dirty: Boolean(dirty),
  };
}

function verifyTests() {
  if (values['skip-tests']) {
    log('\n[installer] testes pulados (--skip-tests).');
    return;
  }
  if (!values['skip-typecheck']) run('pnpm', ['typecheck']);
  run('pnpm', ['test']);
  run('cargo', ['test', '--lib'], { cwd: path.join(root, 'src-tauri') });
}

function tauriBuild(extra, env = {}) {
  run('pnpm', ['tauri', 'build', ...extra], { env });
}

function buildWindows() {
  tauriBuild(['--no-bundle']);
  const exe = path.join(root, 'src-tauri/target/release/lumina.exe');
  if (!existsSync(exe)) fail(`Executável não encontrado: ${exe}`);
  const label = platformLabel('win32', arch);
  const directory = cleanPlatformOut(label);
  const output = path.join(directory, artifactFileName(version, 'windows', arch, '.exe'));
  copyFileSync(exe, output);

  let signed = false;
  if (!values['no-sign']) {
    const thumbprint = process.env.LUMINA_WINDOWS_CERT_THUMBPRINT ?? process.env.WINDOWS_CERT_THUMBPRINT;
    if (thumbprint) {
      log('\n$ signtool sign (Authenticode)');
      const signArgs = [
        'sign',
        '/sha1',
        thumbprint,
        '/tr',
        process.env.LUMINA_TIMESTAMP_URL ?? 'http://timestamp.digicert.com',
        '/td',
        'sha256',
        '/fd',
        'sha256',
        output,
      ];
      const spec = commandSpec('signtool', signArgs);
      const result = spawnSync(spec.file, spec.args, {
        stdio: 'inherit',
        shell: spec.shell,
      });
      signed = result.status === 0;
      if (!signed) log('[installer] aviso: assinatura Authenticode falhou; o artefato continua unsigned.');
    } else {
      log(
        '[installer] aviso: sem LUMINA_WINDOWS_CERT_THUMBPRINT; o instalador será unsigned e o SmartScreen pode avisar.',
      );
    }
  }
  return { directory, files: [output], signed, label, minOs: `Windows 10/11 ${arch}` };
}

function buildMacos() {
  const env = {};
  if (!values['no-sign'] && !process.env.APPLE_SIGNING_IDENTITY && !process.env.APPLE_CERTIFICATE) {
    env.APPLE_SIGNING_IDENTITY = '-';
    log(
      '[installer] aviso: sem certificado Apple; usando assinatura ad-hoc. O Gatekeeper ainda vai avisar.',
    );
  }
  const extra = ['--bundles', 'app,dmg'];
  if (arch === 'universal') extra.push('--target', 'universal-apple-darwin');
  tauriBuild(extra, env);

  const label = platformLabel('darwin', arch);
  const directory = cleanPlatformOut(label);
  const bundleRoot =
    arch === 'universal'
      ? path.join(root, 'src-tauri/target/universal-apple-darwin/release/bundle')
      : path.join(root, 'src-tauri/target/release/bundle');
  const dmgs = walk(path.join(bundleRoot, 'dmg')).filter((file) => file.endsWith('.dmg'));
  if (!dmgs.length) fail(`DMG não encontrado em ${bundleRoot}/dmg`);
  const output = path.join(directory, `Lumina-${version}-macos-${arch}.dmg`);
  copyFileSync(dmgs[0], output);
  const signed = Boolean(process.env.APPLE_SIGNING_IDENTITY && process.env.APPLE_SIGNING_IDENTITY !== '-');
  return { directory, files: [output], signed, label, minOs: 'macOS 11+' };
}

function buildLinux() {
  tauriBuild(['--bundles', 'deb,rpm,appimage']);
  const label = platformLabel('linux', arch);
  const directory = cleanPlatformOut(label);
  const bundleRoot = path.join(root, 'src-tauri/target/release/bundle');
  const deb = walk(path.join(bundleRoot, 'deb')).find((file) => file.endsWith('.deb'));
  const rpm = walk(path.join(bundleRoot, 'rpm')).find((file) => file.endsWith('.rpm'));
  const appimage = walk(path.join(bundleRoot, 'appimage')).find((file) => file.endsWith('.AppImage'));
  if (!deb && !rpm && !appimage) fail(`Nenhum pacote Linux encontrado em ${bundleRoot}`);
  const files = [];
  if (deb) {
    const output = path.join(directory, `Lumina-${version}-linux-${arch}.deb`);
    copyFileSync(deb, output);
    files.push(output);
  }
  if (rpm) {
    const output = path.join(directory, `Lumina-${version}-linux-${arch}.rpm`);
    copyFileSync(rpm, output);
    files.push(output);
  }
  if (appimage) {
    const output = path.join(directory, `Lumina-${version}-linux-${arch}.AppImage`);
    copyFileSync(appimage, output);
    files.push(output);
  }
  return {
    directory,
    files,
    signed: false,
    label,
    minOs: `glibc 2.35+ (Ubuntu 22.04 baseline, ${arch})`,
  };
}

function writePlatformMetadata(result, git) {
  const artifacts = listArtifacts(result.files);
  writeChecksums(result.directory, result.files);
  const manifest = buildManifest({
    version,
    commit: git.commit,
    branch: git.branch,
    platform: result.label,
    arch,
    files: result.files,
    signed: result.signed,
    channel: values.channel,
    minOs: result.minOs,
    dirty: git.dirty,
  });
  writeFileSync(path.join(result.directory, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // Aggregate checksum file for the whole version (kept appendable across CI
  // jobs; each file name is unique per platform).
  const aggregate = path.join(outRoot, version, 'SHA256SUMS.txt');
  const platformDir = path.basename(result.directory);
  const existing = existsSync(aggregate)
    ? readFileSync(aggregate, 'utf8')
        .split('\n')
        .filter((line) => line && !line.includes(`  ${platformDir}/`))
    : [];
  const lines = artifacts.map(
    (artifact) => `${artifact.sha256}  ${path.relative(path.join(outRoot, version), path.join(result.directory, artifact.name)).replaceAll('\\', '/')}`,
  );
  writeFileSync(aggregate, `${[...existing, ...lines].filter(Boolean).join('\n')}\n`);
  return { artifacts, manifest };
}

function updateGithubOutput(result) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = [
    `artifact_dir=${result.directory}`,
    `version=${version}`,
    ...result.files.map((file) => `artifact=${file}`),
  ];
  writeFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`, { flag: 'a' });
}

function printPlan(versionValue, git) {
  log('\n[installer] plano');
  log(`  plataforma : ${platform} (${arch})`);
  log(`  versão     : ${versionValue}`);
  log(`  commit     : ${git.commit}${git.dirty ? ' (árvore suja)' : ''}`);
  const labelHost = platform === 'windows' ? 'win32' : platform === 'macos' ? 'darwin' : 'linux';
  log(`  saída      : ${path.join(outRoot, versionValue, platformLabel(labelHost, arch))}`);
  log(`  testes     : ${values['skip-tests'] ? 'pulados' : 'typecheck + vitest + cargo test'}`);
  log(`  assinatura : ${values['no-sign'] ? 'desativada' : 'automática se as credenciais existirem'}`);
}

function main() {
  log('Lumina installer build');
  log(`host=${host} platform=${platform} arch=${arch}`);

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 20) fail('Node.js 20+ é necessário.');
  if (!capture('pnpm', ['--version'])) fail('pnpm não está disponível no PATH.');
  if (!capture('cargo', ['--version'])) fail('cargo não está disponível no PATH.');

  ensureAssets();
  const git = gitInfo();
  version = currentVersion();
  printPlan(version, git);

  if (values['dry-run']) {
    log('\n[installer] dry-run concluído; nada foi compilado.');
    return;
  }

  verifyTests();

  if (platform === 'macos' && arch === 'universal') {
    const installedTargets = capture('rustup', ['target', 'list', '--installed']);
    for (const target of ['x86_64-apple-darwin', 'aarch64-apple-darwin']) {
      if (!installedTargets.includes(target)) {
        fail(`Alvo Rust ausente para o build universal: ${target}. Rode "rustup target add ${target}".`);
      }
    }
  }
  if (platform === 'linux' && !capture('rpmbuild', ['--version'])) {
    fail('rpmbuild não está disponível. Instale rpm/rpm-build para gerar o pacote .rpm.');
  }

  let result;
  if (platform === 'windows') result = buildWindows();
  else if (platform === 'macos') result = buildMacos();
  else result = buildLinux();

  const meta = writePlatformMetadata(result, git);
  updateGithubOutput(result);

  log('\n[installer] pronto');
  log(`  pasta   : ${result.directory}`);
  for (const artifact of meta.artifacts) {
    log(`  artefato: ${artifact.name} (${artifact.size} bytes)`);
    log(`  sha256  : ${artifact.sha256}`);
  }
  log(`  assinado: ${result.signed ? 'sim' : 'não'}`);
  log(`  manifesto: ${path.join(result.directory, 'release.json')}`);
}

main();
