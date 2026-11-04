import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/lib/types';
import {
  cn,
  createSerialRunner,
  deriveTitle,
  formatBytes,
  formatCost,
  formatDuration,
  formatThinkingDuration,
  formatTokens,
  groupConversations,
  hostnameOf,
  safeJsonParse,
  truncate,
} from '@/lib/utils';

function conversation(id: string, updatedAt: number, pinned = false): Conversation {
  return {
    id,
    title: `Conversa ${id}`,
    createdAt: updatedAt,
    updatedAt,
    pinned,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    messageCount: 2,
  };
}

describe('cn', () => {
  it('merges conflicting tailwind classes, keeping the last one', () => {
    expect(cn('px-2 text-sm', 'px-4')).toBe('text-sm px-4');
    expect(cn('flex', false && 'hidden', undefined, 'gap-2')).toBe('flex gap-2');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [5 * 1024 * 1024, '5 MB'],
  ])('formats %i bytes as %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it('handles invalid input', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('formatTokens', () => {
  it.each([
    [null, '—'],
    [undefined, '—'],
    [420, '420'],
    [1500, '1.5K'],
    [15_000, '15K'],
    [1_500_000, '1.5M'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatTokens(input as number | null | undefined)).toBe(expected);
  });
});

describe('formatCost', () => {
  it.each([
    [0, '$0.00'],
    [0.0005, '$0.0005'],
    [1.5, '$1.50'],
    [null, '—'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatCost(input as number | null)).toBe(expected);
  });
});

describe('formatDuration', () => {
  it.each([
    [420, '420ms'],
    [2500, '2.5s'],
    [65_000, '1m 5s'],
    [null, '—'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatDuration(input as number | null)).toBe(expected);
  });
});

describe('formatThinkingDuration', () => {
  it.each([
    [0, 'menos de 1s'],
    [420, 'menos de 1s'],
    [1_400, '1s'],
    [10_000, '10s'],
    [65_000, '1 min 5s'],
    [120_000, '2 min'],
    [null, null],
  ])('formats %s as %s', (input, expected) => {
    expect(formatThinkingDuration(input as number | null)).toBe(expected);
  });
});

describe('deriveTitle', () => {
  it('strips code fences and collapses whitespace', () => {
    const title = deriveTitle('Veja isto:\n\n```ts\nconst a = 1;\n```\n\nExplique o código acima.');
    expect(title).toBe('Veja isto: Explique o código acima.');
  });

  it('falls back to a friendly title for empty input', () => {
    expect(deriveTitle('   \n  ')).toBe('Nova conversa');
  });

  it('truncates long titles with an ellipsis', () => {
    const title = deriveTitle('a'.repeat(200), 48);
    expect(title.length).toBe(48);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('truncate', () => {
  it('keeps short text untouched', () => {
    expect(truncate('curto', 10)).toBe('curto');
  });

  it('adds an ellipsis when truncating', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
  });
});

describe('hostnameOf', () => {
  it('strips www and keeps the host', () => {
    expect(hostnameOf('https://www.tauri.app/blog/post')).toBe('tauri.app');
  });

  it('returns the input when the URL is invalid', () => {
    expect(hostnameOf('not a url')).toBe('not a url');
  });
});

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('returns the fallback for invalid JSON', () => {
    expect(safeJsonParse('{oops}', { fallback: true })).toEqual({ fallback: true });
  });
});

describe('groupConversations', () => {
  const day = 86_400_000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfToday = today.getTime();

  it('puts pinned conversations first and buckets the rest by recency', () => {
    const groups = groupConversations([
      conversation('fixada', startOfToday - 40 * day, true),
      conversation('hoje', startOfToday + 60_000),
      conversation('ontem', startOfToday - 60_000),
      conversation('semana', startOfToday - 3 * day),
      conversation('mes', startOfToday - 20 * day),
      conversation('antiga', startOfToday - 90 * day),
    ]);

    expect(groups[0].label).toBe('Fixadas');
    expect(groups[0].conversations.map((c) => c.id)).toEqual(['fixada']);
    expect(groups.map((group) => group.label)).toEqual([
      'Fixadas',
      'Hoje',
      'Ontem',
      'Últimos 7 dias',
      'Últimos 30 dias',
      'Mais antigas',
    ]);
    expect(groups[1].conversations[0].id).toBe('hoje');
    expect(groups[2].conversations[0].id).toBe('ontem');
    expect(groups[3].conversations[0].id).toBe('semana');
    expect(groups[4].conversations[0].id).toBe('mes');
    expect(groups[5].conversations[0].id).toBe('antiga');
  });

  it('omits empty groups', () => {
    const groups = groupConversations([conversation('hoje', startOfToday + 1_000)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Hoje');
  });

  it('returns no groups for an empty list', () => {
    expect(groupConversations([])).toEqual([]);
  });
});

describe('createSerialRunner', () => {
  it('runs tasks in call order even when the first is slow', async () => {
    const run = createSerialRunner();
    const events: string[] = [];
    const slow = run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push('slow');
    });
    const fast = run(async () => {
      events.push('fast');
    });
    await Promise.all([slow, fast]);
    expect(events).toEqual(['slow', 'fast']);
  });

  it('keeps running after a rejection', async () => {
    const run = createSerialRunner();
    await expect(
      run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(run(async () => 'ok')).resolves.toBe('ok');
  });
});
