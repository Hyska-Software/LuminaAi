import { describe, expect, it } from 'vitest';
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
});

describe('artifactLanguage', () => {
  it('respeita a linguagem explícita do artefato', () => {
    expect(artifactLanguage(artifact('code', { language: 'python' }))).toBe('python');
  });

  it('infere a linguagem pelo tipo', () => {
    expect(artifactLanguage(artifact('markdown'))).toBe('markdown');
    expect(artifactLanguage(artifact('json'))).toBe('json');
    expect(artifactLanguage(artifact('csv'))).toBe('csv');
    expect(artifactLanguage(artifact('html'))).toBe('markup');
    expect(artifactLanguage(artifact('binary'))).toBe('text');
  });
});
