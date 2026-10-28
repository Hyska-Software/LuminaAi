import { describe, expect, it } from 'vitest';
import { FILE_ICON_FALLBACK, FILE_ICON_KEYS, fileIconKeyFor, type FileIconKey } from '@/lib/fileIcons';
import { FILE_ICON_SVG } from '@/lib/fileIconAssets';

/**
 * Adversarial pass over the resolver plus integrity of the bundled marks:
 * the workbench must never throw (an icon is decoration, not a data path), and
 * every asset must stay a self-contained colored SVG — no script, no external
 * reference, no `currentColor` (these icons are multi-colored by design).
 */
describe('fileIconKeyFor — entradas hostis', () => {
  it('normaliza caixa e espaços em volta', () => {
    expect(fileIconKeyFor('  SRC/APP.TS  ')).toBe('typescript');
    expect(fileIconKeyFor('README.MD')).toBe('readme');
    expect(fileIconKeyFor('Photo.JPEG')).toBe('image');
    expect(fileIconKeyFor('DOCKERFILE')).toBe('docker');
  });

  it('aceita separadores Windows, POSIX e barras finais', () => {
    expect(fileIconKeyFor('src\\main.rs')).toBe('rust');
    expect(fileIconKeyFor('src/main.rs')).toBe('rust');
    expect(fileIconKeyFor('/a/b/c/schema.sql')).toBe('database');
    expect(fileIconKeyFor('a/b/readme.md')).toBe('readme');
    expect(fileIconKeyFor('src\\nested\\deep\\file.tsx')).toBe('react_ts');
  });

  it('cobre famílias de nome por padrão', () => {
    expect(fileIconKeyFor('Dockerfile.dev')).toBe('docker');
    expect(fileIconKeyFor('docker-compose.test.yml')).toBe('docker');
    expect(fileIconKeyFor('Makefile.am')).toBe('makefile');
    expect(fileIconKeyFor('tsconfig.build.json')).toBe('tsconfig');
    expect(fileIconKeyFor('vite.config.mts')).toBe('vite');
    expect(fileIconKeyFor('tailwind.config.cjs')).toBe('tailwindcss');
    expect(fileIconKeyFor('svelte.config.js')).toBe('svelte');
    expect(fileIconKeyFor('astro.config.mjs')).toBe('astro');
    expect(fileIconKeyFor('eslint.config.ts')).toBe('eslint');
    expect(fileIconKeyFor('prettier.config.mjs')).toBe('prettier');
    expect(fileIconKeyFor('requirements-dev.txt')).toBe('python-misc');
    expect(fileIconKeyFor('.prettierrc.yaml')).toBe('prettier');
    expect(fileIconKeyFor('.env.production.local')).toBe('tune');
    expect(fileIconKeyFor('.bashrc')).toBe('console');
    expect(fileIconKeyFor('.zshrc')).toBe('console');
    expect(fileIconKeyFor('LICENSE-MIT')).toBe('license');
    expect(fileIconKeyFor('README.rst')).toBe('readme');
  });

  it('não é enganado por pontos no diretório ou nome composto', () => {
    expect(fileIconKeyFor('pasta.pdf/arquivo.md')).toBe('markdown');
    expect(fileIconKeyFor('./src/./app.ts')).toBe('typescript');
    expect(fileIconKeyFor('../../scripts/run.py')).toBe('python');
    // Prefixos de docs só valem para o nome exato: README.PT.md é Markdown comum.
    expect(fileIconKeyFor('README.PT.md')).toBe('markdown');
    expect(fileIconKeyFor('package.json.bak')).toBe(FILE_ICON_FALLBACK);
  });

  it('protege contra chaves de protótipo e nomes reservados', () => {
    for (const name of [
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
      'valueOf',
      'prototype',
      'file.constructor',
      'x.__proto__',
      'x.toString',
    ]) {
      expect(fileIconKeyFor(name), name).toBe(FILE_ICON_FALLBACK);
    }
  });

  it('não lança para entradas vazias ou de tipo inesperado', () => {
    const hostile = [
      '',
      '   ',
      '\t\n',
      undefined as unknown as string,
      null as unknown as string,
      42 as unknown as string,
      {} as unknown as string,
      [] as unknown as string,
    ];
    for (const value of hostile) {
      expect(() => fileIconKeyFor(value)).not.toThrow();
      expect(fileIconKeyFor(value)).toBe(FILE_ICON_FALLBACK);
    }
  });

  it('processa nomes e caminhos muito longos sem estourar', () => {
    const longName = `${'a'.repeat(10_000)}.ts`;
    expect(fileIconKeyFor(longName)).toBe('typescript');
    expect(fileIconKeyFor(`${'dir/'.repeat(2_000)}main.rs`)).toBe('rust');
    expect(fileIconKeyFor('a'.repeat(10_000))).toBe(FILE_ICON_FALLBACK);
  });

  it('sempre devolve uma chave disponível no bundle', () => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789./\\_-';
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let index = 0; index < 500; index += 1) {
      let value = '';
      const length = Math.floor(random() * 40);
      for (let cursor = 0; cursor < length; cursor += 1) {
        value += alphabet[Math.floor(random() * alphabet.length)];
      }
      const key = fileIconKeyFor(value);
      expect(FILE_ICON_KEYS, value).toContain(key);
      expect(FILE_ICON_SVG[key], value).toBeTruthy();
    }
  });
});

describe('FILE_ICON_SVG — integridade dos assets', () => {
  const keys = Object.keys(FILE_ICON_SVG) as FileIconKey[];

  it('cobre exatamente o conjunto FILE_ICON_KEYS', () => {
    expect([...keys].sort()).toEqual([...FILE_ICON_KEYS].sort());
  });

  it('cada ícone é um SVG quadrado, multicolorido e autocontido', () => {
    for (const key of FILE_ICON_KEYS) {
      const svg = FILE_ICON_SVG[key];
      expect(svg, key).toBeTruthy();
      expect(svg.trimStart().startsWith('<svg'), key).toBe(true);
      expect(svg, key).toMatch(/viewBox="[^"]+"/);
      expect(svg.length, key).toBeLessThan(20_000);
      // Coloridos (fill/stop-color hex), nunca monocromáticos/currentColor.
      expect(svg, key).toMatch(/(fill|stop-color)="#[0-9a-fA-F]{3,8}"/);
      expect(svg, key).not.toContain('currentColor');
      // Conteúdo confiável: sem script, handlers inline nem refs externas.
      expect(svg, key).not.toMatch(/<script/i);
      expect(svg, key).not.toMatch(/\son[a-z]+\s*=/i);
      expect(svg, key).not.toMatch(/href="https?:/i);
      expect(svg, key).not.toMatch(/<image|<foreignObject|<title/i);
    }
  });

  it('mantém a cor de marca da linguagem/tipo', () => {
    const expected: Readonly<Record<string, string>> = {
      rust: '#ff7043',
      pdf: '#ef5350',
      typescript: '#0288d1',
      react: '#00bcd4',
      javascript: '#ffca28',
      markdown: '#42a5f5',
      json: '#f9a825',
      python: '#0288d1',
      go: '#00acc1',
      java: '#f44336',
      docker: '#0288d1',
      vue: '#41b883',
      svelte: '#ff5722',
      css: '#7e57c2',
      sass: '#ec407a',
      yaml: '#ff5252',
      html: '#e65100',
      git: '#e64a19',
      lock: '#ffd54f',
      file: '#90a4ae',
    };
    for (const [key, color] of Object.entries(expected)) {
      expect(FILE_ICON_SVG[key as FileIconKey].toLowerCase(), key).toContain(color);
    }
    // Python é bicolor (azul/amarelo) — o azul sozinho não basta.
    expect(FILE_ICON_SVG.python).toContain('#fdd835');
  });
});
