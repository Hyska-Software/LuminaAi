import { describe, expect, it } from 'vitest';
import {
  MAX_INLINE_CITATIONS,
  citationDomain,
  conversationCitations,
  uniqueCitations,
} from '@/lib/citations';
import type { ChatMessage, Citation } from '@/lib/types';

function citation(overrides: Partial<Citation> = {}): Citation {
  return {
    id: 'cit-1',
    title: 'MIBR - MIBR',
    url: 'https://mibr.gg/',
    siteName: 'mibr.gg',
    ...overrides,
  };
}

function message(citations: Citation[]): ChatMessage {
  return {
    id: `message-${citations[0]?.id ?? 'empty'}`,
    conversationId: 'conv-1',
    role: 'assistant',
    content: '',
    status: 'complete',
    toolCalls: [],
    citations,
    attachments: [],
    createdAt: 1,
  };
}

describe('citationDomain', () => {
  it('prefers the site name and strips the www prefix', () => {
    expect(citationDomain(citation({ siteName: 'www.vlr.gg' }))).toBe('vlr.gg');
    expect(citationDomain(citation({ siteName: '  hltv.org  ' }))).toBe('hltv.org');
  });

  it('falls back to the URL hostname and keeps unparsable input readable', () => {
    expect(citationDomain(citation({ siteName: null, url: 'https://www.youtube.com/watch?v=1' }))).toBe(
      'youtube.com',
    );
    expect(citationDomain(citation({ siteName: '', url: 'não é uma url' }))).toBe('não é uma url');
  });
});

describe('uniqueCitations', () => {
  it('deduplicates by URL preserving discovery order', () => {
    const unique = uniqueCitations([
      citation({ id: 'a', url: 'https://mibr.gg/' }),
      citation({ id: 'b', url: 'https://vlr.gg/team/1' }),
      citation({ id: 'c', url: 'https://mibr.gg/' }),
      citation({ id: 'd', url: 'https://hltv.org/' }),
    ]);

    expect(unique.map((entry) => entry.id)).toEqual(['a', 'b', 'd']);
  });

  it('ignores citations without a usable URL', () => {
    expect(uniqueCitations([citation({ url: '  ' }), citation({ url: '' })])).toEqual([]);
  });
});

describe('conversationCitations', () => {
  it('flattens the messages and deduplicates across turns', () => {
    const sources = conversationCitations([
      message([
        citation({ id: 'cit-1', url: 'https://mibr.gg/' }),
        citation({ id: 'cit-2', url: 'https://vlr.gg/' }),
      ]),
      message([]),
      message([
        citation({ id: 'cit-3', url: 'https://vlr.gg/' }),
        citation({ id: 'cit-4', url: 'https://youtube.com/' }),
      ]),
    ]);

    expect(sources.map((entry) => entry.id)).toEqual(['cit-1', 'cit-2', 'cit-4']);
  });

  it('caps the inline chips at two sources', () => {
    expect(MAX_INLINE_CITATIONS).toBe(2);
  });
});
