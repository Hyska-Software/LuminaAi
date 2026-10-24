import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
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
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
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

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < 45_000) return 'agora';
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} min`;
  if (diff < day) return `${Math.round(diff / hour)} h`;
  if (diff < 7 * day) return `${Math.round(diff / day)} d`;
  return new Date(timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Groups conversations like ChatGPT: fixadas, hoje, ontem, 7 dias, 30 dias, mais antigas. */
export function groupConversations(conversations: Conversation[]): ConversationGroup[] {
  const pinned = conversations.filter((c) => c.pinned);
  const rest = conversations.filter((c) => !c.pinned);
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const week = today - 7 * 86_400_000;
  const month = today - 30 * 86_400_000;

  const groups: ConversationGroup[] = [];
  if (pinned.length) groups.push({ label: 'Fixadas', conversations: pinned });

  const buckets: Record<string, Conversation[]> = {
    Hoje: [],
    Ontem: [],
    'Últimos 7 dias': [],
    'Últimos 30 dias': [],
    'Mais antigas': [],
  };
  for (const conversation of rest) {
    const updated = conversation.updatedAt;
    if (updated >= today) buckets.Hoje.push(conversation);
    else if (updated >= yesterday) buckets.Ontem.push(conversation);
    else if (updated >= week) buckets['Últimos 7 dias'].push(conversation);
    else if (updated >= month) buckets['Últimos 30 dias'].push(conversation);
    else buckets['Mais antigas'].push(conversation);
  }
  for (const [label, list] of Object.entries(buckets)) {
    if (list.length) groups.push({ label, conversations: list });
  }
  return groups;
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
  if (!clean) return 'Nova conversa';
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
