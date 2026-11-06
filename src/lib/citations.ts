/**
 * Citation/source helpers shared by the chat chips and the sources side panel
 * (DESIGN §6.3): the panel lists every source used in the conversation, while
 * the message keeps only the first chips visible.
 */
import type { ChatMessage, Citation } from './types';
import { hostnameOf } from './utils';

/** Maximum inline source chips; the rest is shown in the sources side panel. */
export const MAX_INLINE_CITATIONS = 2;

/** Human-readable domain of a source (site name wins, `www.` stripped). */
export function citationDomain(citation: Citation): string {
  const site = citation.siteName?.trim();
  const raw = site || hostnameOf(citation.url);
  return raw.replace(/^www\./i, '');
}

/** Deduplicates sources by URL, preserving the order they were discovered. */
export function uniqueCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const unique: Citation[] = [];
  for (const citation of citations) {
    const url = citation.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    unique.push(citation);
  }
  return unique;
}

/**
 * Every source used in a conversation, in first-use order. Citations live on
 * assistant messages, so flattening them is enough to feed the side panel.
 */
export function conversationCitations(messages: ChatMessage[]): Citation[] {
  return uniqueCitations(messages.flatMap((message) => message.citations ?? []));
}
