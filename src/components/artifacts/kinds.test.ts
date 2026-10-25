import { describe, expect, it } from 'vitest';
import { FileArchive, Film, Music2 } from 'lucide-react';
import { artifactKindMeta, artifactLanguage } from './kinds';
import type { Artifact, ArtifactKind } from '@/lib/types';

const KINDS: ArtifactKind[] = [
  'markdown',
  'code',
  'text',
  'html',
  'csv',
  'json',
  'svg',
  'image',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'audio',
  'video',
  'archive',
  'binary',
];

function artifact(kind: ArtifactKind, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: `artifact-${kind}`,
    conversationId: 'conv-1',
    name: `arquivo.${kind}`,
    mimeType: 'application/octet-stream',
    kind,
    size: 10,
    createdAt: 1,
    ...overrides,
  };
}

describe('artifactKindMeta', () => {
  it('tem metadados para todos os tipos de artefato', () => {
    for (const kind of KINDS) {
      const meta = artifactKindMeta(kind);
      expect(meta.kind).toBe(kind);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.icon).toBeTruthy();
      expect(meta.tone).toMatch(/bg-/);
    }
  });

  it('descreve apresentações PPTX com ícone e rótulo próprios', () => {
    const meta = artifactKindMeta('pptx');
    expect(meta.label).toBe('Apresentação');
    expect(meta.description).toMatch(/PowerPoint/);
    expect(meta.icon).not.toBe(artifactKindMeta('binary').icon);
  });

  it('dá rótulo, ícone e tom próprios a áudio, vídeo e arquivo compactado', () => {
    const audio = artifactKindMeta('audio');
    expect(audio.label).toBe('Áudio');
    expect(audio.icon).toBe(Music2);
    expect(audio.tone).toBe('bg-accent-soft text-accent');
    expect(audio.description).toMatch(/áudio/i);

    const video = artifactKindMeta('video');
    expect(video.label).toBe('Vídeo');
    expect(video.icon).toBe(Film);
    expect(video.tone).toBe('bg-warning-soft text-warning');
    expect(video.description).toMatch(/vídeo/i);

    const archive = artifactKindMeta('archive');
    expect(archive.label).toBe('Arquivo compactado');
    expect(archive.icon).toBe(FileArchive);
    expect(archive.tone).toBe('bg-surface-hover text-foreground-muted');
    expect(archive.description.length).toBeGreaterThan(0);
  });
});

describe('artifactLanguage', () => {
  it('respeita a linguagem explícita do artefato', () => {
    expect(artifactLanguage(artifact('code', { language: 'python' }))).toBe('python');
    expect(artifactLanguage(artifact('code', { language: 'rs' }))).toBe('rust');
    // A dica explícita vence a extensão do nome.
    expect(artifactLanguage(artifact('code', { language: 'rust', name: 'main.py' }))).toBe('rust');
  });

  it('mantém a linguagem padrão de cada tipo', () => {
    expect(artifactLanguage(artifact('markdown', { name: 'README.md' }))).toBe('markdown');
    expect(artifactLanguage(artifact('json', { name: 'dados.json' }))).toBe('json');
    expect(artifactLanguage(artifact('csv', { name: 'vendas.tsv' }))).toBe('csv');
    expect(artifactLanguage(artifact('html', { name: 'pagina.html' }))).toBe('markup');
    expect(artifactLanguage(artifact('svg', { name: 'grafico.svg' }))).toBe('markup');
  });

  it('infere a linguagem pela extensão em artefatos de código', () => {
    expect(artifactLanguage(artifact('code', { name: 'main.py' }))).toBe('python');
    expect(artifactLanguage(artifact('code', { name: 'index.ts' }))).toBe('typescript');
    expect(artifactLanguage(artifact('code', { name: 'App.tsx' }))).toBe('tsx');
    expect(artifactLanguage(artifact('code', { name: 'estilo.css' }))).toBe('css');
    expect(artifactLanguage(artifact('code', { name: 'script.sh' }))).toBe('bash');
    expect(artifactLanguage(artifact('code', { name: 'config.yaml' }))).toBe('yaml');
    expect(artifactLanguage(artifact('code', { name: 'src/lib/util.rs' }))).toBe('rust');
  });

  it('infere a linguagem pelo nome completo do arquivo', () => {
    expect(artifactLanguage(artifact('text', { name: 'Dockerfile' }))).toBe('docker');
    expect(artifactLanguage(artifact('text', { name: 'Makefile' }))).toBe('makefile');
    expect(artifactLanguage(artifact('text', { name: 'CMakeLists.txt' }))).toBe('cmake');
    expect(artifactLanguage(artifact('text', { name: '.gitignore' }))).toBe('git');
  });

  it('cai em texto quando não há dica reconhecível', () => {
    expect(artifactLanguage(artifact('text', { name: 'LEIAME' }))).toBe('text');
    expect(artifactLanguage(artifact('text', { name: 'notas.txt' }))).toBe('text');
    expect(artifactLanguage(artifact('text', { name: 'registro.log' }))).toBe('text');
    expect(artifactLanguage(artifact('binary', { name: 'arquivo.bin' }))).toBe('text');
    expect(artifactLanguage(artifact('audio', { name: 'musica.mp3' }))).toBe('text');
  });
});
