import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// TypeScript 7 ships a native compiler without the JS AST API, so this gate is
// a lexical approximation: strip comments, then report Portuguese string
// literals, hardcoded UI attributes and simple JSX text nodes. The catalog
// parity test + `pnpm i18n:check` remain the authoritative key checks.
const ROOT = process.cwd();
const UI_ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
const PT_WORDS =
  /\b(não|arquivo|pasta|sessão|usuário|permissão|mensagem|provedor|agente|tarefa|conclu|alteraç|comando|salvar|abrir|buscar|necessári|inválid|disponível|nenhum|você|padrão|ferramenta)\w*/i;
const ACCENT = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/;

let allowlist = [];
try {
  allowlist = JSON.parse(await readFile(path.join(ROOT, 'scripts/i18n-allowlist.json'), 'utf8'));
} catch {
  allowlist = [];
}
const allowed = new Set(allowlist.map((entry) => `${entry.file}\u0000${entry.text}`));

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['locales', 'i18n', '__tests__', 'node_modules'].includes(entry.name)) continue;
      out.push(...(await walk(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(source) {
  let out = '';
  let index = 0;
  let block = false;
  let quote = null;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (block) {
      if (char === '*' && next === '/') {
        block = false;
        index += 2;
      } else index += 1;
      continue;
    }
    if (quote) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      block = true;
      index += 2;
      continue;
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    out += char;
    index += 1;
  }
  return out;
}

const problems = [];
for (const file of await walk(path.join(ROOT, 'src'))) {
  const relative = path.relative(ROOT, file).replaceAll('\\', '/');
  if (/^src\/lib\/genui\/(normalize|lint|diagnostics|schema)\.ts$/.test(relative)) continue;
  const source = stripComments(await readFile(file, 'utf8'));
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = index + 1;

    if (file.endsWith('.tsx')) for (const attr of UI_ATTRS) {
      for (const match of line.matchAll(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'g'))) {
        const text = match[1].trim();
        if (text && !text.startsWith('{') && !allowed.has(`${relative}\u0000${text}`)) {
          problems.push(`${relative}:${lineNo}  UI attribute: ${text.slice(0, 80)}`);
        }
      }
    }

    for (const match of line.matchAll(/(["'])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
      const text = match[2];
      if (!text || allowed.has(`${relative}\u0000${text}`)) continue;
      if (
        text.startsWith('.') ||
        text.startsWith('@') ||
        text.startsWith('/') ||
        /^[a-z0-9_-]+$/.test(text) ||
        /^[a-z][\w-]*(?:[.:][\w-]+)+$/i.test(text) ||
        text.includes('|')
      ) {
        continue;
      }
      if (ACCENT.test(text) || PT_WORDS.test(text)) {
        problems.push(`${relative}:${lineNo}  Portuguese literal: ${text.slice(0, 80)}`);
      }
    }

    if (file.endsWith('.tsx')) for (const match of line.matchAll(/>([^<>{}]*[A-Za-zÀ-ÿ][^<>{}]*)</g)) {
      const text = match[1].replace(/\s+/g, ' ').trim();
      if (
        text.length >= 2 &&
        !/^Promise\b/.test(text) &&
        !/[=;:?(){}|]|=>|&&|\|\|/.test(text) &&
        !allowed.has(`${relative}\u0000${text}`)
      ) {
        problems.push(`${relative}:${lineNo}  JSX text: ${text.slice(0, 80)}`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`ui copy check failed (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('no hardcoded UI copy found.');
