/**
 * Chip de cache do composer do Chat (PLAN §7 / cache-audit-ui §4.2).
 *
 * Cache-first: o Chat ainda não tem `%` de contexto na v1, então o composer
 * hospeda apenas o indicador de cache, antes do `ModelPill`. O container lê o
 * `cacheStore` (evento `cache_stats` por request + restauração do agregado) e
 * respeita `Settings.cache.showIndicator` — desligar o indicador não desliga a
 * medição.
 */
import { CacheHitChip } from '@/components/agent';
import { useAppStore } from '@/lib/store';
import { useCacheStore } from '@/lib/store/cacheStore';

export function CacheMeterChip({ conversationId }: { conversationId: string }) {
  const cache = useCacheStore((state) => state.byConversation[conversationId] ?? null);
  const showIndicator = useAppStore((state) => state.settings.cache?.showIndicator !== false);
  if (!showIndicator || !cache) return null;
  // Antes da primeira amostra/restauração não há número: nada de chip vazio.
  if (!cache.current && !cache.session) return null;
  return <CacheHitChip cache={cache} />;
}
