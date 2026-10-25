import { describe, expect, it } from 'vitest';
import { Search } from 'lucide-react';
import type { Conversation } from '@/lib/types';
import type { PaletteAction } from '@/lib/palette/types';
import {
  matchCommand,
  matchConversation,
  matchText,
  mergeConversationResults,
  mergeRanges,
  normalizeText,
  normalizeWithMap,
  parsePaletteQuery,
  rankCommands,
  rankConversations,
  splitHighlight,
  tokenize,
} from '@/lib/palette/search';

function action(overrides: Partial<PaletteAction> = {}): PaletteAction {
  return {
    id: 'nova-conversa',
    group: 'conversas',
    label: 'Novo chat',
    description: 'Comece uma conversa em branco',
    icon: Search,
    keywords: 'nova conversa criar',
    run: () => undefined,
    ...overrides,
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 'Planejamento do projeto',
    createdAt: 1,
    updatedAt: 10,
    pinned: false,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    messageCount: 4,
    preview: 'Quero revisar as metas do trimestre',
    ...overrides,
  };
}

describe('normalizeText', () => {
  it('folds case and diacritics used in pt-BR', () => {
    expect(normalizeText('Configurações')).toBe('configuracoes');
    expect(normalizeText('AÇÃO ÍÓ ÚÜ')).toBe('acao io uu');
    expect(normalizeText('Café — à noite')).toBe('cafe — a noite');
  });

  it('keeps a map back to the original indices', () => {
    const { text, origin } = normalizeWithMap('Ação');

    expect(text).toBe('acao');
    expect(origin).toHaveLength(text.length);
    // 'ç' and 'ã' are single original characters that fold to one letter each.
    expect(origin[0]).toBe(0); // a ← A
    expect(origin[1]).toBe(1); // c ← ç
    expect(origin[3]).toBe(3); // o ← ã
  });

  it('handles characters that expand while lowercasing', () => {
    const { text, origin } = normalizeWithMap('İ');
    expect(text).toBe('i');
    expect(origin).toEqual([0]);
  });
});

describe('tokenize', () => {
  it('splits, folds and drops empty tokens', () => {
    expect(tokenize('  Nova   CONVERSA ')).toEqual(['nova', 'conversa']);
    expect(tokenize('Configuração')).toEqual(['configuracao']);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('parsePaletteQuery', () => {
  it('defaults to the combined scope', () => {
    expect(parsePaletteQuery('projeto')).toEqual({
      scope: 'all',
      query: 'projeto',
      hasScopePrefix: false,
    });
  });

  it('parses the command prefix', () => {
    expect(parsePaletteQuery('  > novo chat')).toMatchObject({
      scope: 'commands',
      query: 'novo chat',
      hasScopePrefix: true,
    });
  });

  it('parses the conversation prefix', () => {
    expect(parsePaletteQuery('#ontem')).toMatchObject({
      scope: 'conversations',
      query: 'ontem',
      hasScopePrefix: true,
    });
  });

  it('treats a lone prefix as an empty scoped query', () => {
    expect(parsePaletteQuery('>')).toMatchObject({ scope: 'commands', query: '' });
    expect(parsePaletteQuery('#')).toMatchObject({ scope: 'conversations', query: '' });
  });
});

describe('matchText', () => {
  it('scores whole-field and prefix matches above substring matches', () => {
    const exact = matchText('Tema', 'tema');
    const prefix = matchText('Tema escuro', 'tema');
    const substring = matchText('Alternar tema', 'tema');
    const subsequence = matchText('Temperature', 'tmpr');

    expect(exact?.score).toBe(1000);
    expect(prefix?.score).toBeGreaterThan(substring?.score ?? 0);
    expect(substring?.score).toBeGreaterThan(subsequence?.score ?? 0);
  });

  it('is accent and case insensitive', () => {
    const match = matchText('Configurações', 'configuracoes');
    expect(match).not.toBeNull();
    expect(match?.ranges).toEqual([[0, 'Configurações'.length]]);
  });

  it('highlights only the matched slice of an accented word', () => {
    const match = matchText('Abrir configurações', 'configuracoes');
    expect(match?.ranges).toEqual([[6, 6 + 'configurações'.length]]);
  });

  it('prefers a word-boundary match over an inner substring', () => {
    const match = matchText('Buscar conversas', 'conversas');
    expect(match?.ranges).toEqual([[7, 16]]);
  });

  it('returns null for empty needles and empty values', () => {
    expect(matchText('Tema', '   ')).toBeNull();
    expect(matchText('', 'tema')).toBeNull();
  });

  it('returns null when the token is absent', () => {
    expect(matchText('Alternar tema', 'arquivo')).toBeNull();
  });
});

describe('ranges and highlights', () => {
  it('merges overlapping and adjacent ranges', () => {
    expect(mergeRanges([[0, 2], [2, 4], [6, 8], [7, 9], [12, 12]])).toEqual([
      [0, 4],
      [6, 9],
    ]);
  });

  it('splits a text into highlighted segments clamped to the string', () => {
    const segments = splitHighlight('Configurações', [[0, 2], [4, 6], [10, 999], [2, 4]]);
    expect(segments).toEqual([
      { text: 'Config', highlighted: true },
      { text: 'uraç', highlighted: false },
      { text: 'ões', highlighted: true },
    ]);

    expect(splitHighlight('abc', [])).toEqual([{ text: 'abc', highlighted: false }]);
    expect(splitHighlight('', [])).toEqual([]);
  });
});

describe('matchCommand', () => {
  it('matches the label irrespective of accents and case', () => {
    const match = matchCommand(action({ label: 'Configurações' }), 'configuracoes');
    expect(match).not.toBeNull();
    expect(match?.labelRanges).toEqual([[0, 'Configurações'.length]]);
  });

  it('requires every token to match somewhere (AND semantics)', () => {
    expect(matchCommand(action(), 'novo chat')).not.toBeNull();
    expect(matchCommand(action(), 'novo arquivo')).toBeNull();
  });

  it('matches keywords without inventing label highlights', () => {
    const match = matchCommand(action(), 'criar');
    expect(match).not.toBeNull();
    expect(match?.labelRanges).toEqual([]);
    expect(match?.descriptionRanges).toEqual([]);
  });

  it('highlights the description when that is where the token matched', () => {
    const match = matchCommand(action(), 'branco');
    expect(match?.descriptionRanges.length).toBe(1);
    expect(match?.labelRanges).toEqual([]);
  });

  it('matches the group label with a smaller weight', () => {
    const groupMatch = matchCommand(action(), 'conversas');
    const labelMatch = matchCommand(action({ description: 'Conversas recentes' }), 'conversas');
    expect(groupMatch?.score).toBeGreaterThan(0);
    expect(labelMatch?.score ?? 0).toBeGreaterThan(groupMatch?.score ?? 0);
  });

  it('does not match unrelated commands', () => {
    expect(matchCommand(action(), 'xyz')).toBeNull();
  });
});

describe('rankCommands', () => {
  const actions = [
    action({ id: 'tema', group: 'aparencia', label: 'Alternar tema', keywords: 'dark light' }),
    action({ id: 'tema-sistema', group: 'aparencia', label: 'Tema do sistema', keywords: 'auto' }),
    action({ id: 'config', group: 'configuracoes', label: 'Abrir configurações', keywords: 'ajustes' }),
    action({ id: 'conversa', group: 'conversas', label: 'Nova conversa', keywords: 'chat' }),
  ];

  it('keeps the canonical group order for an empty query', () => {
    const results = rankCommands(actions, '');
    expect(results.map((entry) => entry.action.id)).toEqual([
      'conversa',
      'tema',
      'tema-sistema',
      'config',
    ]);
  });

  it('ranks exact label matches first and filters unrelated actions', () => {
    const exact = rankCommands([...actions, action({ id: 'outro', label: 'Outra coisa' })], 'tema');
    expect(exact[0].action.id).toBe('tema-sistema');
    expect(exact.map((entry) => entry.action.id)).not.toContain('outro');
  });

  it('is accent insensitive', () => {
    const results = rankCommands(actions, 'configuracoes');
    expect(results.map((entry) => entry.action.id)).toEqual(['config']);
  });

  it('uses recents only to break ties', () => {
    const tied = [
      action({ id: 'a', label: 'Mesma coisa', group: 'conversas' }),
      action({ id: 'b', label: 'Mesma coisa', group: 'conversas' }),
    ];
    const results = rankCommands(tied, 'mesma', ['b']);
    expect(results.map((entry) => entry.action.id)).toEqual(['b', 'a']);
  });

  it('exposes stable DOM keys', () => {
    const [result] = rankCommands(actions, 'configuracoes');
    expect(result.key).toBe('command-config');
  });
});

describe('conversation ranking', () => {
  const list = [
    conversation({ id: 'old', title: 'Notas antigas', preview: 'notas soltas', updatedAt: 5 }),
    conversation({ id: 'pinned', title: 'Reunião', preview: 'reunião semanal', pinned: true, updatedAt: 1 }),
    conversation({
      id: 'match',
      title: 'Planejamento do trimestre',
      preview: 'metas do período',
      updatedAt: 20,
    }),
  ];

  it('matches title and preview with accents folded', () => {
    const match = matchConversation(conversation({ title: 'Configurações do app' }), 'configuracoes');
    expect(match).not.toBeNull();
    expect(match?.titleRanges).toEqual([[0, 'Configurações'.length]]);

    const previewMatch = matchConversation(conversation({ preview: 'as metas do período' }), 'periodo');
    expect(previewMatch?.previewRanges.length).toBe(1);
  });

  it('requires a match for the local fallback', () => {
    const results = rankConversations(list, 'trimestre', { requireMatch: true });
    expect(results.map((entry) => entry.conversation.id)).toEqual(['match']);
  });

  it('surfaces title matches above unmatched backend results', () => {
    const results = rankConversations(list, 'trimestre', { requireMatch: false, limit: 3 });
    expect(results[0].conversation.id).toBe('match');
    expect(results).toHaveLength(3);
  });

  it('keeps the input order for an empty query and honours the limit', () => {
    const results = rankConversations([...list], '', { limit: 2 });
    expect(results.map((entry) => entry.conversation.id)).toEqual(['old', 'pinned']);
  });

  it('merges results without duplicating ids', () => {
    const merged = mergeConversationResults([list[0]], [list[0], list[1]]);
    expect(merged.map((entry) => entry.id)).toEqual(['old', 'pinned']);
  });
});
