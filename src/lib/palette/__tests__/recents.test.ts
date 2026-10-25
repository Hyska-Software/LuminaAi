import { describe, expect, it } from 'vitest';
import {
  clearRecentCommandIds,
  MAX_RECENT_COMMANDS,
  orderByRecents,
  PALETTE_RECENTS_KEY,
  readRecentCommandIds,
  recordRecentCommandId,
  type PaletteRecentsStorage,
} from '@/lib/palette/recents';

function memoryStorage(initial: Record<string, string> = {}): PaletteRecentsStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('readRecentCommandIds', () => {
  it('returns an empty list for missing, corrupted or non-array values', () => {
    expect(readRecentCommandIds(memoryStorage())).toEqual([]);
    expect(readRecentCommandIds(memoryStorage({ [PALETTE_RECENTS_KEY]: '{oops' }))).toEqual([]);
    expect(readRecentCommandIds(memoryStorage({ [PALETTE_RECENTS_KEY]: '{"a":1}' }))).toEqual([]);
    expect(readRecentCommandIds(null)).toEqual([]);
  });

  it('drops invalid entries, duplicates and respects the cap', () => {
    const stored = JSON.stringify([
      'novo',
      42,
      '  ',
      'novo',
      'tema',
      ...Array.from({ length: MAX_RECENT_COMMANDS * 2 }, (_, index) => `cmd-${index}`),
    ]);
    const ids = readRecentCommandIds(memoryStorage({ [PALETTE_RECENTS_KEY]: stored }));

    expect(ids.slice(0, 2)).toEqual(['novo', 'tema']);
    expect(ids).toHaveLength(MAX_RECENT_COMMANDS);
  });
});

describe('recordRecentCommandId', () => {
  it('puts the newest id first and deduplicates', () => {
    const storage = memoryStorage();
    recordRecentCommandId('novo', storage);
    recordRecentCommandId('tema', storage);
    const ids = recordRecentCommandId('novo', storage);

    expect(ids).toEqual(['novo', 'tema']);
    expect(JSON.parse(storage.values.get(PALETTE_RECENTS_KEY) ?? '[]')).toEqual(['novo', 'tema']);
  });

  it('caps the list at MAX_RECENT_COMMANDS', () => {
    const storage = memoryStorage();
    for (let index = 0; index < MAX_RECENT_COMMANDS + 4; index += 1) {
      recordRecentCommandId(`cmd-${index}`, storage);
    }
    const ids = readRecentCommandIds(storage);
    expect(ids).toHaveLength(MAX_RECENT_COMMANDS);
    expect(ids[0]).toBe(`cmd-${MAX_RECENT_COMMANDS + 3}`);
  });

  it('ignores blank ids', () => {
    const storage = memoryStorage();
    recordRecentCommandId('   ', storage);
    expect(readRecentCommandIds(storage)).toEqual([]);
  });

  it('never throws when storage rejects writes', () => {
    const storage: PaletteRecentsStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => recordRecentCommandId('novo', storage)).not.toThrow();
  });
});

describe('clearRecentCommandIds', () => {
  it('empties the stored list', () => {
    const storage = memoryStorage();
    recordRecentCommandId('novo', storage);
    clearRecentCommandIds(storage);
    expect(readRecentCommandIds(storage)).toEqual([]);
  });
});

describe('orderByRecents', () => {
  it('puts known recent ids first, then the remaining candidates', () => {
    const ordered = orderByRecents(['a', 'b', 'c', 'd'], ['c', 'x', 'a'], (id) => id !== 'b');
    expect(ordered).toEqual(['c', 'a', 'd']);
  });
});
