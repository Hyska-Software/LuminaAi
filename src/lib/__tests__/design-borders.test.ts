// @vitest-environment node
/**
 * Design guard — the product draws no solid outline around elements.
 *
 * Rule (docs/DESIGN.md §3): containment comes from surface contrast, never from
 * a closed `border`. 1px content dividers stay: `border-t|b|l|r|x|y`, `divide-*`,
 * `Separator`, `hr`, resizer lines and scrollbars are allowed, as are transient
 * `focus-visible` rings and reset utilities (`border-0`, `border-none`,
 * `border-transparent`).
 *
 * GenUI blocks and Markdown rendering are exempt: they keep their current look.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = 'src';

/** Side utilities keep working as 1px dividers. */
const SIDE = /^border-(t|b|l|r|x|y|s|e)(-|$)/;
/** Reset/no-op utilities that never draw an outline. */
const RESETS = new Set(['0', 'none', 'transparent', 'collapse', 'spacing', 'color']);
/** Border color tokens: only valid next to a side utility. */
const COLORS = new Set([
  'border',
  'border-strong',
  'accent',
  'accent-hover',
  'accent-foreground',
  'success',
  'warning',
  'danger',
  'foreground',
  'foreground-muted',
  'foreground-subtle',
  'background',
  'surface',
  'surface-raised',
  'surface-hover',
  'surface-active',
  'user-bubble',
  'white',
  'black',
]);
const OUTLINE_STYLES = /^(dashed|dotted|double|solid)$/;
/** GenUI blocks and Markdown rendering keep their current look. */
const EXCLUDED_PREFIXES = ['src/components/genui/', 'src/components/chat/markdown/'];
const EXCLUDED_FILES = new Set(['src/components/chat/Markdown.tsx', 'src/components/chat/CodeBlock.tsx']);

function utilityOf(token: string): string | null {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ':' && depth === 0) start = i + 1;
  }
  const cls = token.slice(start);
  if (!cls || cls.includes('$')) return null;
  return cls;
}

function isRemovable(cls: string): boolean {
  if (cls === 'border') return true;
  if (SIDE.test(cls)) return false;
  const rest = cls.slice('border-'.length);
  if (OUTLINE_STYLES.test(rest)) return false;
  if (RESETS.has(rest)) return false;
  if (/^\d+$/.test(rest)) return true;
  if (rest.startsWith('[') && /\d(px|rem|em)/.test(rest)) return true;
  if (COLORS.has(rest.split('/')[0])) return true;
  // Unknown `border-*` utility: treat as an outline so new ones are reviewed.
  return true;
}

/**
 * A literal that also declares a side utility (`border-b`, `border-x`…) keeps its
 * color/style tokens: those paint a 1px content divider, which is allowed.
 */
function removableTokens(tokens: string[]): string[] {
  const hasSide = tokens.some((token) => {
    const cls = utilityOf(token);
    return cls !== null && SIDE.test(cls);
  });
  return tokens.filter((token) => {
    const cls = utilityOf(token);
    if (!cls || !(cls === 'border' || cls.startsWith('border-'))) return false;
    if (SIDE.test(cls)) return false;
    const rest = cls.slice('border-'.length);
    if (hasSide && (COLORS.has(rest.split('/')[0]) || OUTLINE_STYLES.test(rest))) return false;
    return isRemovable(cls);
  });
}

/**
 * Class-like string literals. A tiny lexer skips comments and treats an
 * apostrophe inside a word (`don't`) as text, so JSX copy is never parsed as a
 * class list. Only single-line quotes and `${`-free templates are inspected.
 */
function classStringSpans(source: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let previous = '';
  let i = 0;

  const isIdentifier = (char: string) => /[A-Za-z0-9_$]/.test(char);

  while (i < source.length) {
    const char = source[i];
    if (char === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      const insideWord = isIdentifier(previous);
      let end = i + 1;
      let closed = false;
      while (end < source.length) {
        const next = source[end];
        if (next === '\\') {
          end += 2;
          continue;
        }
        if (next === '\n' && quote !== '`') break;
        if (next === quote) {
          closed = true;
          break;
        }
        end += 1;
      }
      if (closed && !insideWord) {
        const body = source.slice(i + 1, end);
        if (isClassList(body)) spans.push([i + 1, end]);
        previous = quote;
        i = end + 1;
        continue;
      }
      previous = char;
      i += 1;
      continue;
    }
    if (!/\s/.test(char)) previous = char;
    i += 1;
  }

  return spans;
}

/** Heuristic: every token is a Tailwind-ish class and at least one has a dash. */
function isClassList(body: string): boolean {
  if (!body.includes('border') || body.includes('${')) return false;
  if (/[<>;$\\]/.test(body)) return false;
  const tokens = body.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || !tokens.some((token) => token.includes('-'))) return false;
  return tokens.every((token) => /^[\w:.\-\[\]&%!/()!,]+$/.test(token));
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

interface Violation {
  file: string;
  cls: string;
}

function collectViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const file of listSourceFiles(SRC)) {
    const relative = file.replace(/\\/g, '/');
    if (relative.endsWith('design-borders.test.ts')) continue;
    if (EXCLUDED_FILES.has(relative)) continue;
    if (EXCLUDED_PREFIXES.some((prefix) => relative.startsWith(prefix))) continue;
    const source = readFileSync(file, 'utf8');
    if (!source.includes('border')) continue;
    for (const [start, end] of classStringSpans(source)) {
      const tokens = source.slice(start, end).split(/\s+/).filter(Boolean);
      for (const token of removableTokens(tokens)) {
        violations.push({ file: relative, cls: utilityOf(token) ?? token });
      }
    }
  }
  return violations;
}

describe('design guard — outlines', () => {
  it('no element declares a closed border (use a surface token instead)', () => {
    const violations = collectViolations();
    const report = violations.slice(0, 80).map((item) => `${item.file} → ${item.cls}`);
    expect(report, `borders without a side are not allowed:\n${report.join('\n')}`).toEqual([]);
  });
});
