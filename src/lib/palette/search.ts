/**
 * Command palette search: accent/case folding, scope prefixes, multi-token
 * matching, scoring, ranking and highlight ranges (docs/COMMAND_PALETTE.md
 * §4.3). Pure functions only — the palette UI never reimplements matching.
 */
import type { Conversation } from '../types';
import {
  PALETTE_GROUP_ORDER,
  paletteGroupLabel,
  type PaletteAction,
  type PaletteCommandResult,
  type PaletteConversationResult,
  type PaletteScope,
  type TextRanges,
} from './types';

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

const COMBINING_MARKS = /[\u0300-\u036f]/g;
/** Characters treated as word boundaries when scoring "prefix of a word". */
const WORD_SEPARATORS = /[\s\-_/.:,()[\]{}'"|]+/;

export interface NormalizedText {
  /** Folded text (lowercase, no diacritics). */
  text: string;
  /** `origin[i]` is the index of the original character that produced `text[i]`. */
  origin: number[];
}

/**
 * Folds case and diacritics while remembering where every folded character came
 * from, so match ranges can be highlighted on the original (accented) text.
 */
export function normalizeWithMap(value: string): NormalizedText {
  let text = '';
  const origin: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const folded = value[index]
      .normalize('NFD')
      .replace(COMBINING_MARKS, '')
      .toLowerCase();
    for (const unit of folded) {
      text += unit;
      origin.push(index);
    }
  }
  return { text, origin };
}

/** Case/diacritic-insensitive form used for comparisons. */
export function normalizeText(value: string): string {
  return normalizeWithMap(value).text;
}

/** Splits a query into folded tokens; empty tokens are dropped. */
export function tokenize(query: string): string[] {
  return normalizeText(query)
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/* ------------------------------------------------------------------ */
/* Scopes                                                              */
/* ------------------------------------------------------------------ */

export interface ParsedPaletteQuery {
  scope: PaletteScope;
  /** Query without the scope prefix, trimmed at the start. */
  query: string;
  hasScopePrefix: boolean;
}

/** `>` forces commands, `#` forces conversations; everything else searches both. */
export function parsePaletteQuery(raw: string): ParsedPaletteQuery {
  const leading = raw.trimStart();
  if (leading.startsWith('>')) {
    return { scope: 'commands', query: leading.slice(1).trimStart(), hasScopePrefix: true };
  }
  if (leading.startsWith('#')) {
    return { scope: 'conversations', query: leading.slice(1).trimStart(), hasScopePrefix: true };
  }
  return { scope: 'all', query: raw, hasScopePrefix: false };
}

/* ------------------------------------------------------------------ */
/* Ranges                                                              */
/* ------------------------------------------------------------------ */

function mergeRangeList(ranges: TextRanges): Array<[number, number]> {
  const sorted = ranges
    .map(([start, end]) => [Math.max(0, start), Math.max(0, end)] as [number, number])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  return merged;
}

/** Merges overlapping/adjacent ranges so `<mark>` never nests. */
export function mergeRanges(ranges: TextRanges): TextRanges {
  return mergeRangeList(ranges);
}

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

/**
 * Splits a text into plain/highlighted segments for rendering. Invalid ranges
 * (negative, inverted, out of bounds) are clamped or dropped.
 */
export function splitHighlight(value: string, ranges: TextRanges): HighlightSegment[] {
  const merged = mergeRangeList(ranges);
  if (!merged.length) return value ? [{ text: value, highlighted: false }] : [];
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    const from = Math.min(Math.max(start, 0), value.length);
    const to = Math.min(Math.max(end, 0), value.length);
    if (to <= cursor) continue;
    if (from > cursor) segments.push({ text: value.slice(cursor, Math.max(cursor, from)), highlighted: false });
    segments.push({ text: value.slice(Math.max(cursor, from), to), highlighted: true });
    cursor = to;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), highlighted: false });
  return segments.filter((segment) => segment.text.length > 0);
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export interface TextMatch {
  score: number;
  ranges: TextRanges;
}

function mapRange(origin: number[], start: number, end: number): [number, number] {
  const from = origin[start] ?? 0;
  const to = (origin[end - 1] ?? from) + 1;
  return [from, to];
}

/** First index where `needle` starts a word inside `text`, or `-1`. */
function wordPrefixIndex(text: string, needle: string): number {
  let index = text.indexOf(needle);
  while (index >= 0) {
    if (index === 0 || WORD_SEPARATORS.test(text[index - 1])) return index;
    index = text.indexOf(needle, index + 1);
  }
  return -1;
}

/** Greedy subsequence match; returns matched indices and the gap count. */
function subsequenceMatch(text: string, needle: string): { indices: number[]; gaps: number } | null {
  const indices: number[] = [];
  let cursor = 0;
  for (const char of needle) {
    const found = text.indexOf(char, cursor);
    if (found < 0) return null;
    indices.push(found);
    cursor = found + 1;
  }
  const spread = indices[indices.length - 1] - indices[0] + 1;
  return { indices, gaps: spread - needle.length };
}

/**
 * Matches one folded token against a single field of the original text.
 * Returns the score (higher is better) and the original-text ranges to
 * highlight. Ranking: whole field > prefix > word prefix > substring >
 * subsequence; length penalties keep exact/short matches on top.
 */
export function matchText(value: string, token: string): TextMatch | null {
  const needle = normalizeText(token);
  if (!needle || !value) return null;
  const { text, origin } = normalizeWithMap(value);
  if (!text) return null;

  if (text === needle) {
    return { score: 1000, ranges: [[0, value.length]] };
  }

  if (text.startsWith(needle)) {
    return {
      score: 800 - Math.min(240, (text.length - needle.length) * 2),
      ranges: [mapRange(origin, 0, needle.length)],
    };
  }

  const wordIndex = wordPrefixIndex(text, needle);
  if (wordIndex >= 0) {
    return {
      score: 700 - Math.min(220, (text.length - needle.length) * 2),
      ranges: [mapRange(origin, wordIndex, wordIndex + needle.length)],
    };
  }

  const substringIndex = text.indexOf(needle);
  if (substringIndex >= 0) {
    return {
      score: 600 - Math.min(160, substringIndex * 2) - Math.min(60, text.length - needle.length),
      ranges: [mapRange(origin, substringIndex, substringIndex + needle.length)],
    };
  }

  const subsequence = subsequenceMatch(text, needle);
  if (subsequence) {
    const ranges = subsequence.indices.map((index) => mapRange(origin, index, index + 1));
    return {
      score:
        300 -
        Math.min(180, subsequence.gaps * 4) -
        Math.min(60, subsequence.indices[0] ?? 0) -
        Math.min(40, Math.max(0, text.length - needle.length)),
      ranges: mergeRangeList(ranges),
    };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Command ranking                                                     */
/* ------------------------------------------------------------------ */

interface ScoredField {
  text: string;
  weight: number;
  target: 'label' | 'keywords' | 'description' | 'group';
}

function actionFields(action: PaletteAction): ScoredField[] {
  return [
    { text: action.label, weight: 3, target: 'label' },
    { text: action.keywords ?? '', weight: 2, target: 'keywords' },
    { text: action.description ?? '', weight: 1, target: 'description' },
    { text: paletteGroupLabel(action.group), weight: 0.5, target: 'group' },
  ];
}

export interface CommandMatch {
  score: number;
  labelRanges: TextRanges;
  descriptionRanges: TextRanges;
}

/**
 * Scores an action for a query. Every token must match at least one field
 * (logical AND); the token is highlighted in the field where it scored best,
 * so a token that matches the label is not also highlighted in the description.
 */
export function matchCommand(action: PaletteAction, query: string): CommandMatch | null {
  const tokens = tokenize(query);
  if (!tokens.length) return { score: 0, labelRanges: [], descriptionRanges: [] };

  const fields = actionFields(action);
  let total = 0;
  const labelRanges: Array<[number, number]> = [];
  const descriptionRanges: Array<[number, number]> = [];

  for (const token of tokens) {
    let best: { score: number; field: ScoredField; ranges: TextRanges } | null = null;
    for (const field of fields) {
      const match = matchText(field.text, token);
      if (!match) continue;
      const score = match.score * field.weight;
      if (!best || score > best.score) best = { score, field, ranges: match.ranges };
    }
    if (!best) return null;
    total += best.score;
    if (best.field.target === 'label') {
      for (const range of best.ranges) labelRanges.push([range[0], range[1]]);
    }
    if (best.field.target === 'description') {
      for (const range of best.ranges) descriptionRanges.push([range[0], range[1]]);
    }
  }

  return {
    score: total,
    labelRanges: mergeRangeList(labelRanges),
    descriptionRanges: mergeRangeList(descriptionRanges),
  };
}

function groupOrderIndex(group: PaletteAction['group']): number {
  const index = PALETTE_GROUP_ORDER.indexOf(group);
  return index < 0 ? PALETTE_GROUP_ORDER.length : index;
}

/**
 * Filters + ranks actions for a query. `recentIds` (most recent first) only
 * breaks ties; score always wins. Empty queries keep the canonical group order.
 */
export function rankCommands(
  actions: readonly PaletteAction[],
  query: string,
  recentIds: readonly string[] = [],
): PaletteCommandResult[] {
  const tokens = tokenize(query);
  if (!tokens.length) {
    return [...actions]
      .sort((left, right) => groupOrderIndex(left.group) - groupOrderIndex(right.group))
      .map((action) => ({
        kind: 'command' as const,
        key: `command-${action.id}`,
        action,
        labelRanges: [],
        descriptionRanges: [],
        score: 0,
      }));
  }

  const recentPosition = new Map<string, number>();
  recentIds.forEach((id, index) => recentPosition.set(id, index));

  const matches: PaletteCommandResult[] = [];
  for (const action of actions) {
    const match = matchCommand(action, query);
    if (!match) continue;
    matches.push({
      kind: 'command',
      key: `command-${action.id}`,
      action,
      labelRanges: match.labelRanges,
      descriptionRanges: match.descriptionRanges,
      score: match.score,
    });
  }

  return matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftRecent = recentPosition.get(left.action.id);
    const rightRecent = recentPosition.get(right.action.id);
    if (leftRecent !== undefined || rightRecent !== undefined) {
      if (leftRecent === undefined) return 1;
      if (rightRecent === undefined) return -1;
      if (leftRecent !== rightRecent) return leftRecent - rightRecent;
    }
    return (
      groupOrderIndex(left.action.group) - groupOrderIndex(right.action.group) ||
      left.action.label.localeCompare(right.action.label, 'pt-BR')
    );
  });
}

/* ------------------------------------------------------------------ */
/* Conversation ranking                                                */
/* ------------------------------------------------------------------ */

export interface ConversationMatch {
  score: number;
  titleRanges: TextRanges;
  previewRanges: TextRanges;
}

/** Matches a query against a conversation title (weight 2) and preview (1). */
export function matchConversation(conversation: Conversation, query: string): ConversationMatch | null {
  const tokens = tokenize(query);
  if (!tokens.length) return { score: 0, titleRanges: [], previewRanges: [] };

  let total = 0;
  const titleRanges: Array<[number, number]> = [];
  const previewRanges: Array<[number, number]> = [];
  const preview = conversation.preview ?? '';

  for (const token of tokens) {
    const title = matchText(conversation.title, token);
    const snippet = preview ? matchText(preview, token) : null;
    const titleScore = title ? title.score * 2 : 0;
    const snippetScore = snippet ? snippet.score : 0;
    if (!title && !snippet) return null;
    if (titleScore >= snippetScore) {
      total += titleScore;
      if (title) for (const range of title.ranges) titleRanges.push([range[0], range[1]]);
    } else {
      total += snippetScore;
      if (snippet) for (const range of snippet.ranges) previewRanges.push([range[0], range[1]]);
    }
  }

  return {
    score: total,
    titleRanges: mergeRangeList(titleRanges),
    previewRanges: mergeRangeList(previewRanges),
  };
}

export interface RankConversationsOptions {
  /** Local fallback drops conversations without a title/preview match. */
  requireMatch?: boolean;
  limit?: number;
}

/**
 * Orders conversation results. Backend results already come pinned-first and
 * updated-first; matches on the title surface above unmatched ones but never
 * drop a result (the backend may have matched the message content, which the
 * conversation payload does not contain).
 */
export function rankConversations(
  conversations: readonly Conversation[],
  query: string,
  { requireMatch = false, limit = 5 }: RankConversationsOptions = {},
): PaletteConversationResult[] {
  const hasQuery = tokenize(query).length > 0;
  const results: Array<{ result: PaletteConversationResult; index: number; score: number }> = [];

  conversations.forEach((conversation, index) => {
    const match = matchConversation(conversation, query);
    if (!match && requireMatch) return;
    results.push({
      index,
      score: match?.score ?? 0,
      result: {
        kind: 'conversation',
        key: `conversation-${conversation.id}`,
        conversation,
        titleRanges: match?.titleRanges ?? [],
        previewRanges: match?.previewRanges ?? [],
      },
    });
  });

  // With no query the caller's order is authoritative (the backend/getter
  // already returns pinned-first, updated-first); never reshuffle it.
  if (hasQuery) {
    results.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.result.conversation.pinned !== right.result.conversation.pinned) {
        return left.result.conversation.pinned ? -1 : 1;
      }
      return left.index - right.index;
    });
  }

  return results.slice(0, Math.max(0, limit)).map((entry) => entry.result);
}

/**
 * Folds a locally known conversation (`title` + `preview`) so the palette can
 * still find conversations when the backend search is unavailable, and merge
 * them ahead of backend results without duplicating ids.
 */
export function mergeConversationResults(
  primary: readonly Conversation[],
  secondary: readonly Conversation[],
): Conversation[] {
  const seen = new Set<string>();
  const merged: Conversation[] = [];
  for (const conversation of [...primary, ...secondary]) {
    if (seen.has(conversation.id)) continue;
    seen.add(conversation.id);
    merged.push(conversation);
  }
  return merged;
}
