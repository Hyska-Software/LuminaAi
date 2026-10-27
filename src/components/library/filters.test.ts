// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ArtifactKind, LibraryArtifact } from '@/lib/types';
import {
  LIBRARY_FILTER_IDS,
  applyLibraryQuery,
  formatLibraryDate,
  importResultMessage,
  libraryArtifactCounts,
  libraryArtifactOrigin,
  libraryFilterLabel,
  librarySortLabel,
  matchesLibraryFilter,
  normalizeLibraryQuery,
  pluralizeFiles,
  searchLibraryArtifacts,
  sortLibraryArtifacts,
} from './filters';

function artifact(overrides: Partial<LibraryArtifact> = {}): LibraryArtifact {
  return {
    id: 'artifact-1',
    conversationId: 'conv-1',
    name: 'relatorio.pdf',
    mimeType: 'application/pdf',
    kind: 'pdf',
    size: 2048,
    createdAt: 1_700_000_000_000,
    favorite: false,
    conversationTitle: 'Projeto Aurora',
    ...overrides,
  };
}

function byKind(kind: ArtifactKind, overrides: Partial<LibraryArtifact> = {}): LibraryArtifact {
  return artifact({ id: `artifact-${kind}`, kind, name: `arquivo.${kind}`, ...overrides });
}

describe('library filter helpers', () => {
  it('normaliza busca removendo acentos, caixa e espaços', () => {
    expect(normalizeLibraryQuery('  Relatório AÇÃO  ')).toBe('relatorio acao');
  });

  it('mapeia cada tipo para exatamente um filtro de categoria', () => {
    const expectations: Array<[ArtifactKind, string]> = [
      ['image', 'images'],
      ['svg', 'images'],
      ['pdf', 'documents'],
      ['docx', 'documents'],
      ['markdown', 'documents'],
      ['code', 'code'],
      ['json', 'code'],
      ['audio', 'media'],
      ['video', 'media'],
      ['archive', 'others'],
      ['binary', 'others'],
    ];

    for (const [kind, expected] of expectations) {
      const matches = LIBRARY_FILTER_IDS.filter((filter) =>
        matchesLibraryFilter(byKind(kind), filter),
      );
      // `all` always matches, so drop it before asserting the single category.
      expect(matches.filter((filter) => filter !== 'all')).toEqual([expected]);
    }
  });

  it('favoritos filtra somente artefatos marcados', () => {
    expect(matchesLibraryFilter(artifact({ favorite: true }), 'favorites')).toBe(true);
    expect(matchesLibraryFilter(artifact({ favorite: false }), 'favorites')).toBe(false);
    expect(matchesLibraryFilter(artifact(), 'favorites')).toBe(false);
  });

  it('tudo casa qualquer artefato', () => {
    expect(matchesLibraryFilter(artifact(), 'all')).toBe(true);
  });

  it('conta cada categoria de forma independente', () => {
    const artifacts = [
      byKind('image', { favorite: true }),
      byKind('pdf'),
      byKind('code', { favorite: true }),
      byKind('audio'),
      byKind('archive'),
    ];

    expect(libraryArtifactCounts(artifacts)).toEqual({
      all: 5,
      favorites: 2,
      images: 1,
      documents: 1,
      code: 1,
      media: 1,
      others: 1,
    });
  });

  it('expõe rótulos estáveis para pills e ordenação', () => {
    expect(libraryFilterLabel('documents')).toBe('Documentos');
    expect(libraryFilterLabel('media')).toBe('Mídia');
    expect(librarySortLabel('recent')).toBe('Recentes');
    expect(librarySortLabel('name')).toBe('Nome (A–Z)');
  });
});

describe('library search', () => {
  it('busca pelo nome sem acentos e sem caixa', () => {
    const artifacts = [
      artifact({ id: 'a', name: 'Relatório Final.pdf' }),
      artifact({ id: 'b', name: 'contrato.pdf' }),
    ];

    expect(searchLibraryArtifacts(artifacts, 'relatorio').map((entry) => entry.id)).toEqual(['a']);
    expect(searchLibraryArtifacts(artifacts, 'RELATÓRIO').map((entry) => entry.id)).toEqual(['a']);
  });

  it('busca pelo label do tipo e pelo título da conversa de origem', () => {
    const spreadsheet = artifact({
      id: 'planilha',
      name: 'vendas.xlsx',
      kind: 'xlsx',
      conversationTitle: 'Reunião de segunda',
    });

    expect(searchLibraryArtifacts([spreadsheet], 'planilha').map((entry) => entry.id)).toEqual([
      'planilha',
    ]);
    expect(searchLibraryArtifacts([spreadsheet], 'reuniao').map((entry) => entry.id)).toEqual([
      'planilha',
    ]);
  });

  it('não casa uploads pelo rótulo genérico “Biblioteca”', () => {
    const upload = artifact({ id: 'upload', name: 'contrato.pdf', conversationId: null, conversationTitle: null });
    const generated = artifact({ id: 'generated', name: 'relatorio.pdf' });

    expect(searchLibraryArtifacts([upload, generated], 'biblioteca')).toEqual([]);
  });

  it('query vazia devolve todos os itens', () => {
    const artifacts = [artifact(), artifact({ id: 'b' })];
    expect(searchLibraryArtifacts(artifacts, '   ')).toHaveLength(2);
  });
});

describe('library sort', () => {
  const artifacts = [
    artifact({ id: 'antigo', name: 'b.pdf', createdAt: 10, size: 100 }),
    artifact({ id: 'recente', name: 'a.pdf', createdAt: 30, size: 300 }),
    artifact({ id: 'meio', name: 'c.pdf', createdAt: 20, size: 200 }),
  ];

  it('Recentes ordena do mais novo para o mais antigo', () => {
    expect(sortLibraryArtifacts(artifacts, 'recent').map((entry) => entry.id)).toEqual([
      'recente',
      'meio',
      'antigo',
    ]);
  });

  it('Mais antigos inverte a ordem', () => {
    expect(sortLibraryArtifacts(artifacts, 'oldest').map((entry) => entry.id)).toEqual([
      'antigo',
      'meio',
      'recente',
    ]);
  });

  it('Nome usa collation pt-BR', () => {
    expect(sortLibraryArtifacts(artifacts, 'name').map((entry) => entry.name)).toEqual([
      'a.pdf',
      'b.pdf',
      'c.pdf',
    ]);
  });

  it('Tamanho coloca os maiores primeiro', () => {
    expect(sortLibraryArtifacts(artifacts, 'size').map((entry) => entry.size)).toEqual([
      300, 200, 100,
    ]);
  });

  it('não muta a lista recebida', () => {
    const input = [...artifacts];
    sortLibraryArtifacts(input, 'name');
    expect(input.map((entry) => entry.id)).toEqual(['antigo', 'recente', 'meio']);
  });
});

describe('applyLibraryQuery', () => {
  it('aplica busca, filtro e ordenação na ordem da página', () => {
    const artifacts = [
      artifact({ id: 'img', name: 'logo.png', kind: 'image', createdAt: 5, favorite: true }),
      artifact({ id: 'doc1', name: 'relatorio.pdf', kind: 'pdf', createdAt: 10 }),
      artifact({ id: 'doc2', name: 'Relatorio Final.docx', kind: 'docx', createdAt: 20 }),
      artifact({ id: 'code', name: 'relatorio.py', kind: 'code', createdAt: 30 }),
    ];

    expect(
      applyLibraryQuery(artifacts, { query: 'relatorio', filter: 'documents', sort: 'name' }).map(
        (entry) => entry.id,
      ),
    ).toEqual(['doc2', 'doc1']);

    expect(
      applyLibraryQuery(artifacts, { query: '', filter: 'favorites', sort: 'recent' }).map(
        (entry) => entry.id,
      ),
    ).toEqual(['img']);

    expect(
      applyLibraryQuery(artifacts, { query: '', filter: 'all', sort: 'size' }).map(
        (entry) => entry.id,
      ),
    ).toHaveLength(4);
  });
});

describe('library labels', () => {
  it('origem é o título da conversa ou “Biblioteca” para uploads', () => {
    expect(libraryArtifactOrigin(artifact({ conversationTitle: 'Projeto Aurora' }))).toBe(
      'Projeto Aurora',
    );
    expect(libraryArtifactOrigin(artifact({ conversationTitle: '  ' }))).toBe('Biblioteca');
    expect(
      libraryArtifactOrigin(artifact({ conversationId: null, conversationTitle: null })),
    ).toBe('Biblioteca');
  });

  it('pluraliza contagens em pt-BR', () => {
    expect(pluralizeFiles(1)).toBe('1 arquivo');
    expect(pluralizeFiles(3)).toBe('3 arquivos');
    expect(importResultMessage(1)).toBe('1 arquivo enviado');
    expect(importResultMessage(2)).toBe('2 arquivos enviados');
  });

  it('formata a data curta e tolera timestamp inválido', () => {
    expect(formatLibraryDate(Number.NaN)).toBe('—');
    expect(formatLibraryDate(new Date(2026, 9, 27).getTime())).toMatch(/27/);
  });
});
