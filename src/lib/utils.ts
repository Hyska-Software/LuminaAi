import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { t } from './i18n';
import { formatDate } from './i18n/format';
import type { Conversation, ConversationGroup } from './types';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const isMacPlatform = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export const isMac = isMacPlatform;
export const modKey = isMac ? '⌘' : 'Ctrl';
export const shiftKey = isMac ? '⇧' : 'Shift';
export const altKey = isMac ? '⌥' : 'Alt';

export function modShortcut(key: string): string {
  return `${modKey}+${key}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

export function formatTokens(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

export function formatCost(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatDuration(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

/**
 * Duration of a thinking phase shown in the timeline header: rounded to whole
 * seconds so "Pensou por 10s" (Chat) / "Trabalhou por 10s" (Code) does not
 * flicker while streaming.
 */
export function formatThinkingDuration(ms?: number | null): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return t('common:time.thinking.lessThanSecond');
  if (seconds < 60) return t('common:time.thinking.seconds', { count: seconds });
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) {
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes
      ? t('common:time.thinking.hoursMinutes', { hours, minutes })
      : t('common:time.thinking.hours', { count: hours });
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest
    ? t('common:time.thinking.minutesSeconds', { minutes, seconds: rest })
    : t('common:time.thinking.minutes', { count: minutes });
}

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < 45_000) return t('common:time.justNow');
  if (diff < hour) return t('common:time.minutesShort', { count: Math.max(1, Math.round(diff / minute)) });
  if (diff < day) return t('common:time.hoursShort', { count: Math.round(diff / hour) });
  if (diff < 7 * day) return t('common:time.daysShort', { count: Math.round(diff / day) });
  return formatDate(timestamp, { day: '2-digit', month: 'short' });
}

export function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export type ConversationGroupId =
  | 'pinned'
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'older';

/** A sidebar history section: stable id plus the translated label. */
export interface ConversationGroupBucket extends ConversationGroup {
  id: ConversationGroupId;
}

function groupLabel(id: ConversationGroupId): string {
  switch (id) {
    case 'pinned':
      return t('common:time.groups.pinned');
    case 'today':
      return t('common:time.groups.today');
    case 'yesterday':
      return t('common:time.groups.yesterday');
    case 'last7':
      return t('common:time.groups.last7');
    case 'last30':
      return t('common:time.groups.last30');
    case 'older':
      return t('common:time.groups.older');
  }
}

/** Groups conversations like ChatGPT: pinned, today, yesterday, 7 days, 30 days, older. */
export function groupConversations(conversations: Conversation[]): ConversationGroupBucket[] {
  const pinned = conversations.filter((c) => c.pinned);
  const rest = conversations.filter((c) => !c.pinned);
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const week = today - 7 * 86_400_000;
  const month = today - 30 * 86_400_000;

  const groups: ConversationGroupBucket[] = [];
  if (pinned.length) groups.push({ id: 'pinned', label: groupLabel('pinned'), conversations: pinned });

  const buckets: { id: Exclude<ConversationGroupId, 'pinned'>; conversations: Conversation[] }[] = [
    { id: 'today', conversations: [] },
    { id: 'yesterday', conversations: [] },
    { id: 'last7', conversations: [] },
    { id: 'last30', conversations: [] },
    { id: 'older', conversations: [] },
  ];
  for (const conversation of rest) {
    const updated = conversation.updatedAt;
    if (updated >= today) buckets[0].conversations.push(conversation);
    else if (updated >= yesterday) buckets[1].conversations.push(conversation);
    else if (updated >= week) buckets[2].conversations.push(conversation);
    else if (updated >= month) buckets[3].conversations.push(conversation);
    else buckets[4].conversations.push(conversation);
  }
  for (const bucket of buckets) {
    if (bucket.conversations.length) {
      groups.push({ id: bucket.id, label: groupLabel(bucket.id), conversations: bucket.conversations });
    }
  }
  return groups;
}

/** Sidebar order: agent primary first, then pinned, manual position, recency. */
export function compareConversationOrder(left: Conversation, right: Conversation): number {
  return (
    Number(Boolean(right.isMain)) - Number(Boolean(left.isMain)) ||
    Number(right.pinned) - Number(left.pinned) ||
    (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
    right.updatedAt - left.updatedAt
  );
}

/** Manual position without separating pinned rows (Code sessions). */
export function compareConversationPosition(left: Conversation, right: Conversation): number {
  return (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || right.updatedAt - left.updatedAt;
}

/**
 * Orders `ids` by a persisted order (drag-and-drop tab strips). Ids present in
 * `order` follow it; ids missing from `order` stay next to their natural
 * predecessor instead of jumping to the end (a freshly opened tab keeps its
 * place). Duplicates and stale order entries are dropped.
 */
export function sortStableByOrder(ids: string[], order: readonly string[]): string[] {
  const unique = [...new Set(ids)];
  const present = new Set(unique);
  const seen = new Set<string>();
  const known: string[] = [];
  for (const id of order) {
    if (!present.has(id) || seen.has(id)) continue;
    seen.add(id);
    known.push(id);
  }
  const knownSet = new Set(known);
  const anchored = new Map<string | null, string[]>();
  let previous: string | null = null;
  for (const id of unique) {
    if (knownSet.has(id)) {
      previous = id;
      continue;
    }
    const list = anchored.get(previous) ?? [];
    list.push(id);
    anchored.set(previous, list);
  }
  const result = [...(anchored.get(null) ?? [])];
  for (const id of known) {
    result.push(id);
    const extra = anchored.get(id);
    if (extra) result.push(...extra);
  }
  return result;
}

/** Runs async tasks one at a time, preserving the call order. */
export function createSerialRunner(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait = 250,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}

/** Splits text into a short conversation title. */
export function deriveTitle(text: string, max = 48): string {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return t('common:conversation.defaultTitle');
  return truncate(clean, max);
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function nextTick(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

export function stopEvent(event: { preventDefault: () => void; stopPropagation: () => void }): void {
  event.preventDefault();
  event.stopPropagation();
}
