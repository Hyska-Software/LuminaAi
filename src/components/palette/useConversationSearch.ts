import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { filterConversationsForLayout, isConversationVisibleIn } from '@/lib/conversations';
import { mergeConversationResults, rankConversations } from '@/lib/palette/search';
import type { PaletteConversationResult } from '@/lib/palette/types';
import { useChatStore, useUiStore } from '@/lib/store';

/** Conversation search debounce (docs/COMMAND_PALETTE.md §4.1). */
export const CONVERSATION_SEARCH_DEBOUNCE_MS = 160;
/** Below this length the backend is not queried (avoids huge result sets). */
export const MIN_CONVERSATION_QUERY_LENGTH = 2;
/** How many conversation matches the palette shows. */
export const MAX_CONVERSATION_RESULTS = 5;

export interface ConversationSearchState {
  results: PaletteConversationResult[];
  loading: boolean;
  /** Backend search failed; results come from the local title/preview index. */
  fallback: boolean;
}

const EMPTY: ConversationSearchState = { results: [], loading: false, fallback: false };

/**
 * Inline conversation search for the command palette.
 *
 * - 160 ms debounce + minimum of 2 characters (never queries the backend for an
 *   empty/whitespace query — `search_conversations('')` returns everything).
 * - A monotonic token drops out-of-order/obsolete responses and unmounts.
 * - Local matches (normalized title/preview) are always merged with the backend
 *   results: SQLite `LIKE` does not fold accents, so "reuniao" only finds
 *   "Reunião" through the local index.
 * - On failure, falls back to the local index and flags `fallback`.
 */
export function useConversationSearch(query: string, enabled: boolean): ConversationSearchState {
  const conversations = useChatStore((state) => state.conversations);
  const layoutMode = useUiStore((state) => state.layoutMode);
  const conversationsRef = useRef(conversations);
  // Update the ref in an effect (not during render) so the debounced callback
  // always folds the latest local titles/previews without restarting the timer.
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const [state, setState] = useState<ConversationSearchState>(EMPTY);
  const requestToken = useRef(0);
  const trimmedQuery = query.trim();
  const eligible = enabled && trimmedQuery.length >= MIN_CONVERSATION_QUERY_LENGTH;

  useEffect(() => {
    const token = requestToken.current + 1;
    requestToken.current = token;

    if (!eligible) {
      setState(EMPTY);
      return;
    }

    setState({ results: [], loading: true, fallback: false });

    const timer = setTimeout(() => {
      void (async () => {
        // Only sessions of the active layout are searchable: Chat never finds
        // Code sessions and vice versa (shared Chat sessions appear in both).
        const localResults = rankConversations(
          filterConversationsForLayout(conversationsRef.current, layoutMode),
          trimmedQuery,
          {
            requireMatch: true,
            limit: MAX_CONVERSATION_RESULTS,
          },
        );
        try {
          const backendResults = await api.searchConversations(trimmedQuery);
          if (token !== requestToken.current) return;
          const visibleBackendResults = (Array.isArray(backendResults) ? backendResults : []).filter(
            (conversation) => isConversationVisibleIn(conversation, layoutMode),
          );
          const merged = mergeConversationResults(
            localResults.map((entry) => entry.conversation),
            visibleBackendResults,
          );
          setState({
            results: rankConversations(merged, trimmedQuery, { limit: MAX_CONVERSATION_RESULTS }),
            loading: false,
            fallback: false,
          });
        } catch {
          if (token !== requestToken.current) return;
          setState({ results: localResults, loading: false, fallback: true });
        }
      })();
    }, CONVERSATION_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [eligible, trimmedQuery, layoutMode]);

  // Dropping the last request on unmount prevents "setState after unmount".
  useEffect(
    () => () => {
      requestToken.current += 1;
    },
    [],
  );

  return state;
}
