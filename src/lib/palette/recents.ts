/**
 * Recently used palette commands (docs/COMMAND_PALETTE.md §4.4).
 *
 * Persisted in `localStorage` under its own key (not in the zustand stores) so
 * a corrupted value can never break the app state rehydration. Reads/writes are
 * defensive: invalid JSON, wrong types and unavailable storage degrade to an
 * empty list instead of throwing.
 */

export const PALETTE_RECENTS_KEY = 'lumina.palette.recents';
export const MAX_RECENT_COMMANDS = 6;

export interface PaletteRecentsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): PaletteRecentsStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    /* localStorage can throw in private modes / disabled storage */
    return null;
  }
}

/** Reads the stored command ids, dropping anything invalid and duplicates. */
export function readRecentCommandIds(
  storage: PaletteRecentsStorage | null = defaultStorage(),
): string[] {
  if (!storage) return [];
  let parsed: unknown;
  try {
    const raw = storage.getItem(PALETTE_RECENTS_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of parsed) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length === MAX_RECENT_COMMANDS) break;
  }
  return ids;
}

/**
 * Records a command as the most recent one and returns the new list. The same
 * id is never duplicated; the list is capped at `MAX_RECENT_COMMANDS`.
 */
export function recordRecentCommandId(
  id: string,
  storage: PaletteRecentsStorage | null = defaultStorage(),
): string[] {
  const trimmed = id.trim();
  if (!trimmed) return readRecentCommandIds(storage);
  const next = [trimmed, ...readRecentCommandIds(storage).filter((entry) => entry !== trimmed)].slice(
    0,
    MAX_RECENT_COMMANDS,
  );
  if (storage) {
    try {
      storage.setItem(PALETTE_RECENTS_KEY, JSON.stringify(next));
    } catch {
      /* storage full/unavailable: recents are a convenience, never a hard error */
    }
  }
  return next;
}

/** Clears the stored recents (used by tests and by a future "reset" action). */
export function clearRecentCommandIds(storage: PaletteRecentsStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(PALETTE_RECENTS_KEY, JSON.stringify([]));
  } catch {
    /* ignore */
  }
}

/**
 * Orders `ids` (candidates) by the recents list, keeping the recency order and
 * dropping ids that are not in `known`. Useful for an availability-aware
 * "Sugestões" section.
 */
export function orderByRecents(
  ids: readonly string[],
  recents: readonly string[],
  known: (id: string) => boolean,
): string[] {
  const candidates = new Set(ids.filter(known));
  const ordered: string[] = [];
  for (const id of recents) {
    if (!candidates.has(id) || ordered.includes(id)) continue;
    ordered.push(id);
  }
  for (const id of ids) {
    if (!candidates.has(id) || ordered.includes(id)) continue;
    ordered.push(id);
  }
  return ordered;
}
