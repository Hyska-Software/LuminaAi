/**
 * Reads and rewrites every version source used by the Zylara app, updater and
 * installer. All platforms share one version; there is no per-platform copy.
 *
 * Sources:
 * - package.json                (release workflow + artifact names)
 * - src-tauri/Cargo.toml        (CARGO_PKG_VERSION: app_info, installer, updater)
 * - src-tauri/tauri.conf.json   (bundle metadata)
 * - src/lib/appVersion.ts       (renderer fallback before app_info resolves)
 * - src-tauri/Cargo.lock        (generated package record)
 */
import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { VERSION_PATTERN, parseSemver, readVersionState } from './shared.mjs';

const PACKAGE_FILE = 'package.json';
const TAURI_FILE = 'src-tauri/tauri.conf.json';
const CARGO_FILE = 'src-tauri/Cargo.toml';
const UI_FILE = 'src/lib/appVersion.ts';
const LOCK_FILE = 'src-tauri/Cargo.lock';

/** Removes a leading `v` and surrounding whitespace. */
export function normalizeVersion(value) {
  return String(value ?? '')
    .trim()
    .replace(/^v/i, '');
}

/** Strict SemVer used by the bump workflow (no build metadata). */
export function isVersion(value) {
  const normalized = normalizeVersion(value);
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(normalized);
  if (!match || !VERSION_PATTERN.test(normalized)) return false;
  if (!match[4]) return true;
  if (match[4].includes('..') || match[4].endsWith('.')) return false;
  return match[4]
    .split('.')
    .every((identifier) => identifier.length > 0 && /^[0-9A-Za-z-]+$/.test(identifier));
}

/** Computes the next stable version for a `patch`, `minor` or `major` bump. */
export function nextVersion(current, bump) {
  const parsed = parseSemver(normalizeVersion(current));
  if (!parsed) throw new Error(`versão inválida: ${current}`);
  let { major, minor, patch } = parsed;
  switch (bump) {
    case 'major':
      major += 1;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor += 1;
      patch = 0;
      break;
    case 'patch':
      patch += 1;
      break;
    default:
      throw new Error(`bump inválido: ${bump} (use patch, minor ou major)`);
  }
  return `${major}.${minor}.${patch}`;
}

function prereleaseOf(value) {
  const withoutBuild = normalizeVersion(value).split('+')[0];
  const dash = withoutBuild.indexOf('-');
  return dash === -1 ? [] : withoutBuild.slice(dash + 1).split('.');
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
      const diff = Number(a) - Number(b);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    } else if (aNumeric) {
      return -1;
    } else if (bNumeric) {
      return 1;
    } else if (a !== b) {
      return a > b ? 1 : -1;
    }
  }
  return left.length === right.length ? 0 : left.length > right.length ? 1 : -1;
}

/** Full SemVer ordering (`1.0.0` > `1.0.0-rc.1`). */
export function compareSemver(left, right) {
  const leftCore = parseSemver(normalizeVersion(left));
  const rightCore = parseSemver(normalizeVersion(right));
  if (!leftCore || !rightCore) {
    throw new Error(`versão inválida: ${!leftCore ? left : right}`);
  }
  for (const key of ['major', 'minor', 'patch']) {
    if (leftCore[key] !== rightCore[key]) return leftCore[key] > rightCore[key] ? 1 : -1;
  }
  return comparePrerelease(prereleaseOf(left), prereleaseOf(right));
}

function readRequired(file) {
  if (!existsSync(file)) throw new Error(`arquivo não encontrado: ${file}`);
  return readFileSync(file, 'utf8');
}

function replaceOnce(text, pattern, append, label) {
  const matches = text.match(new RegExp(pattern.source, `${pattern.flags}g`));
  if (!matches || matches.length !== 1) {
    throw new Error(
      `${label}: esperava exatamente uma ocorrência de versão, encontrou ${matches?.length ?? 0}`,
    );
  }
  return text.replace(pattern, (...args) => {
    const groups = args.slice(1, -2);
    return `${groups[0] ?? ''}${append}${groups[1] ?? ''}`;
  });
}

function update(label, file) {
  const before = readRequired(file);
  return { label, path: file, before };
}

function finish(item, after, validate) {
  if (validate) validate(after);
  if (after === item.before) {
    throw new Error(`${item.label}: o conteúdo da versão não mudou`);
  }
  return { ...item, after };
}

/** Builds every new file content in memory before touching the disk. */
export function buildVersionUpdates(root, target) {
  const version = normalizeVersion(target);
  if (!isVersion(version)) throw new Error(`versão inválida: ${target}`);

  const packageFile = update(PACKAGE_FILE, path.join(root, PACKAGE_FILE));
  const tauriFile = update(TAURI_FILE, path.join(root, TAURI_FILE));
  const cargoFile = update(CARGO_FILE, path.join(root, CARGO_FILE));
  const uiFile = update(UI_FILE, path.join(root, UI_FILE));
  const lockFile = update(LOCK_FILE, path.join(root, LOCK_FILE));

  return [
    finish(
      packageFile,
      replaceOnce(
        packageFile.before,
        /^(\s*"version"\s*:\s*")[^"]+(")/m,
        version,
        PACKAGE_FILE,
      ),
      (text) => JSON.parse(text),
    ),
    finish(
      tauriFile,
      replaceOnce(
        tauriFile.before,
        /^(\s*"version"\s*:\s*")[^"]+(")/m,
        version,
        TAURI_FILE,
      ),
      (text) => JSON.parse(text),
    ),
    finish(
      cargoFile,
      replaceOnce(
        cargoFile.before,
        /^(version\s*=\s*")[^"]+(")/m,
        version,
        CARGO_FILE,
      ),
    ),
    finish(
      uiFile,
      replaceOnce(
        uiFile.before,
        /(APP_VERSION_FALLBACK\s*=\s*')[^']+(')/,
        version,
        UI_FILE,
      ),
    ),
    finish(
      lockFile,
      replaceOnce(
        lockFile.before,
        /(\[\[package\]\]\r?\nname = "zylara"\r?\nversion = ")[^"]+(")/,
        version,
        LOCK_FILE,
      ),
    ),
  ];
}

function restore(updates) {
  for (const update of updates) {
    try {
      writeFileSync(update.path, update.before, 'utf8');
    } catch {
      /* best effort: the original content is also available in git */
    }
  }
}

/**
 * Applies a version to all sources. Lower/equal versions require an explicit
 * opt-in so an accidental downgrade is not silent.
 */
export function applyVersion(
  root,
  target,
  { dryRun = false, allowDowngrade = false, force = false } = {},
) {
  const version = normalizeVersion(target);
  if (!isVersion(version)) throw new Error(`versão inválida: ${target}`);

  const state = readVersionState(root);
  const current = state.packageVersion;
  if (!current) throw new Error('versão atual ausente em package.json');

  const comparison = compareSemver(version, current);
  if (!force && comparison === 0) {
    throw new Error(`a versão já é ${current}`);
  }
  if (!force && !allowDowngrade && comparison < 0) {
    throw new Error(
      `a versão ${version} é menor que a atual (${current}); use --allow-downgrade para rebaixar`,
    );
  }

  const updates = buildVersionUpdates(root, version);
  if (dryRun) {
    return {
      current,
      target: version,
      files: updates.map((item) => item.label),
      applied: false,
      state,
    };
  }

  const written = [];
  const temporary = [];
  try {
    for (const item of updates) {
      const temp = `${item.path}.${process.pid}.${Date.now()}.${written.length}.tmp`;
      writeFileSync(temp, item.after, 'utf8');
      temporary.push(temp);
      renameSync(temp, item.path);
      written.push(item);
    }
  } catch (error) {
    restore(written);
    for (const temp of temporary) {
      try {
        unlinkSync(temp);
      } catch {
        /* already renamed */
      }
    }
    throw error;
  }

  try {
    const after = readVersionState(root);
    const values = [
      after.packageVersion,
      after.tauriVersion,
      after.cargoVersion,
      after.uiVersion,
      after.lockVersion,
    ];
    if (values.some((value) => value !== version)) {
      throw new Error(
        `a verificação final falhou: ${values.map((value) => value ?? '?').join(', ')}`,
      );
    }
    return {
      current,
      target: version,
      files: updates.map((item) => item.label),
      applied: true,
      state: after,
    };
  } catch (error) {
    restore(written);
    throw error;
  }
}
