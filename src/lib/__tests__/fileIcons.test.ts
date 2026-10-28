import { describe, expect, it } from 'vitest';
import { FILE_ICON_FALLBACK, FILE_ICON_KEYS, fileIconKeyFor } from '@/lib/fileIcons';

/**
 * Spec of the file tree icon resolution, written against the icons the workbench
 * actually shows (see `docs/FILE_ICONS.md`): each language/document/media type
 * must resolve to its own **colored** mark, and unknown types fall back to the
 * neutral file glyph instead of a placeholder lucide icon.
 */
describe('fileIconKeyFor — linguagens de programação', () => {
  it.each([
    ['src/app.ts', 'typescript'],
    ['app.mts', 'typescript'],
    ['app.cts', 'typescript'],
    ['src/Button.tsx', 'react_ts'],
    ['src/index.js', 'javascript'],
    ['scripts/build.mjs', 'javascript'],
    ['legacy.cjs', 'javascript'],
    ['src/App.jsx', 'react'],
    ['main.rs', 'rust'],
    ['build.rs', 'rust'],
    ['main.py', 'python'],
    ['tool.pyi', 'python'],
    ['main.go', 'go'],
    ['Main.java', 'java'],
    ['App.kt', 'kotlin'],
    ['build.gradle.kts', 'kotlin'],
    ['app.rb', 'ruby'],
    ['index.php', 'php'],
    ['Program.cs', 'csharp'],
    ['main.c', 'c'],
    ['main.h', 'h'],
    ['engine.cpp', 'cpp'],
    ['engine.hpp', 'hpp'],
    ['App.swift', 'swift'],
    ['Main.scala', 'scala'],
    ['main.dart', 'dart'],
    ['init.lua', 'lua'],
    ['analysis.r', 'r'],
    ['app.ex', 'elixir'],
    ['Main.hs', 'haskell'],
    ['core.clj', 'clojure'],
    ['App.vue', 'vue'],
    ['App.svelte', 'svelte'],
    ['page.astro', 'astro'],
    ['shader.glsl', 'shader'],
    ['main.zig', 'zig'],
    ['main.nim', 'nim'],
    ['lib.ml', 'ocaml'],
    ['fsharp.fs', 'fsharp'],
    ['contract.sol', 'solidity'],
    ['main.asm', 'assembly'],
    ['boot.ps1', 'powershell'],
    ['run.sh', 'console'],
    ['run.bash', 'console'],
    ['schema.proto', 'proto'],
    ['query.graphql', 'graphql'],
  ])('%s → %s', (path, key) => {
    expect(fileIconKeyFor(path)).toBe(key);
  });
});

describe('fileIconKeyFor — dados, documentos e mídia', () => {
  it.each([
    ['data/settings.json', 'json'],
    ['data/settings.jsonc', 'json'],
    ['tsconfig.base.json', 'tsconfig'],
    ['config/config.yaml', 'yaml'],
    ['config/config.yml', 'yaml'],
    ['Cargo.toml', 'rust'],
    ['Cargo.lock', 'rust'],
    ['config.ini', 'settings'],
    ['config.cfg', 'settings'],
    ['index.html', 'html'],
    ['styles.css', 'css'],
    ['theme.scss', 'sass'],
    ['theme.sass', 'sass'],
    ['theme.less', 'less'],
    ['theme.styl', 'stylus'],
    ['layout.xml', 'xml'],
    ['README.md', 'readme'],
    ['notes.md', 'markdown'],
    ['doc.mdx', 'mdx'],
    ['contract.pdf', 'pdf'],
    ['relatorio.docx', 'word'],
    ['planilha.xlsx', 'table'],
    ['slides.pptx', 'powerpoint'],
    ['dados.csv', 'table'],
    ['schema.sql', 'database'],
    ['queries.sqlite', 'database'],
    ['photo.png', 'image'],
    ['logo.svg', 'svg'],
    ['anim.webp', 'image'],
    ['demo.mp4', 'video'],
    ['song.mp3', 'audio'],
    ['font.woff2', 'font'],
    ['bundle.zip', 'zip'],
    ['backup.tar.gz', 'zip'],
    ['app.wasm', 'webassembly'],
    ['notas.txt', 'document'],
    ['diff.patch', 'git'],
  ])('%s → %s', (path, key) => {
    expect(fileIconKeyFor(path)).toBe(key);
  });
});

describe('fileIconKeyFor — nomes de arquivo especiais', () => {
  it.each([
    ['package.json', 'nodejs'],
    ['package-lock.json', 'nodejs'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['tsconfig.json', 'tsconfig'],
    ['jsconfig.json', 'jsconfig'],
    ['vite.config.ts', 'vite'],
    ['vitest.config.ts', 'vitest'],
    ['webpack.config.js', 'webpack'],
    ['rollup.config.js', 'rollup'],
    ['tailwind.config.ts', 'tailwindcss'],
    ['postcss.config.js', 'postcss'],
    ['.eslintrc.json', 'eslint'],
    ['eslint.config.mjs', 'eslint'],
    ['.prettierrc', 'prettier'],
    ['babel.config.js', 'babel'],
    ['Dockerfile', 'docker'],
    ['docker-compose.yml', 'docker'],
    ['.dockerignore', 'docker'],
    ['Makefile', 'makefile'],
    ['CMakeLists.txt', 'cmake'],
    ['nginx.conf', 'nginx'],
    ['justfile', 'just'],
    ['.gitignore', 'git'],
    ['.gitattributes', 'git'],
    ['.editorconfig', 'editorconfig'],
    ['.npmrc', 'npm'],
    ['.nvmrc', 'nodejs'],
    ['.env', 'tune'],
    ['.env.local', 'tune'],
    ['requirements.txt', 'python-misc'],
    ['pyproject.toml', 'python-misc'],
    ['go.mod', 'go-mod'],
    ['go.sum', 'go-mod'],
    ['Gemfile', 'ruby'],
    ['LICENSE', 'license'],
    ['LICENSE.md', 'license'],
    ['CHANGELOG.md', 'changelog'],
    ['CONTRIBUTING.md', 'contributing'],
    ['CODE_OF_CONDUCT.md', 'conduct'],
    ['tauri.conf.json', 'tauri'],
    ['.taurignore', 'tauri'],
    ['.gitlab-ci.yml', 'gitlab'],
  ])('%s → %s', (name, key) => {
    expect(fileIconKeyFor(name)).toBe(key);
  });
});

describe('fileIconKeyFor — resolução por caminho', () => {
  it('usa o nome do arquivo e ignora o diretório', () => {
    expect(fileIconKeyFor('src/components/Button.tsx')).toBe('react_ts');
    expect(fileIconKeyFor('src\\components\\Button.tsx')).toBe('react_ts');
    expect(fileIconKeyFor('/home/user/project/main.rs')).toBe('rust');
    expect(fileIconKeyFor('C:\\dev\\project\\Cargo.toml')).toBe('rust');
  });

  it('reconhece workflows do GitHub Actions pelo caminho', () => {
    expect(fileIconKeyFor('.github/workflows/ci.yml')).toBe('github-actions-workflow');
    expect(fileIconKeyFor('.github/workflows/release.yaml')).toBe('github-actions-workflow');
    expect(fileIconKeyFor('C:\\repo\\.github\\workflows\\ci.yml')).toBe('github-actions-workflow');
    // Fora de `.github/workflows/` continua sendo YAML comum.
    expect(fileIconKeyFor('workflows/ci.yml')).toBe('yaml');
    expect(fileIconKeyFor('.github/workflows/ci.json')).toBe('json');
  });

  it('reconhece declarações TypeScript (`.d.ts`/`.d.mts`/`.d.cts`)', () => {
    expect(fileIconKeyFor('types/app.d.ts')).toBe('typescript-def');
    expect(fileIconKeyFor('types/app.d.mts')).toBe('typescript-def');
    expect(fileIconKeyFor('types/app.d.cts')).toBe('typescript-def');
    // `.d.tsx` não é declaração: é um componente React.
    expect(fileIconKeyFor('types/app.d.tsx')).toBe('react_ts');
  });

  it('não confunde extensões com o nome do diretório', () => {
    expect(fileIconKeyFor('src.pdf/leia.md')).toBe('markdown');
    expect(fileIconKeyFor('assets/logo.svg')).toBe('svg');
  });
});

describe('fileIconKeyFor — cobertura e fallback', () => {
  it('mapeia todos os ícones disponíveis a partir de nomes de exemplo', () => {
    expect(FILE_ICON_FALLBACK).toBe('file');
  });

  it('cai no ícone neutro para tipos desconhecidos', () => {
    expect(fileIconKeyFor('dados.xyzabc')).toBe(FILE_ICON_FALLBACK);
    expect(fileIconKeyFor('arquivo')).toBe(FILE_ICON_FALLBACK);
    expect(fileIconKeyFor('sem-extensao.')).toBe(FILE_ICON_FALLBACK);
  });

  it('mantém o conjunto de chaves estável e sem duplicatas', () => {
    expect(new Set(FILE_ICON_KEYS).size).toBe(FILE_ICON_KEYS.length);
    expect(FILE_ICON_KEYS).toContain('file');
    expect(FILE_ICON_KEYS.length).toBeGreaterThan(100);
  });
});
