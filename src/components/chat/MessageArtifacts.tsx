import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { ArtifactCard } from '@/components/artifacts/ArtifactCard';
import { Button } from '@/components/ui';
import { compareText } from '@/lib/i18n/format';
import { useUiStore } from '@/lib/store';
import type { Artifact } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Inline artifact cards per message before the rest moves to the panel list
 * (DESIGN §6.3): long turns stop stretching the chat with one card per file.
 */
export const MAX_INLINE_ARTIFACTS = 4;

export interface MessageArtifactsProps {
  artifacts: Artifact[];
  className?: string;
}

/**
 * Artifacts created by a single turn: a compact grid with the first cards and,
 * past the limit, the "+" button that opens the full list in the artifact
 * panel. Sorting mirrors `db::list_artifacts` (createdAt, then id) so the inline
 * cut is stable no matter how the events arrived.
 */
export function MessageArtifacts({ artifacts, className }: MessageArtifactsProps) {
  const { t } = useTranslation('chat');
  const ordered = useMemo(
    () =>
      [...artifacts].sort(
        (left, right) => left.createdAt - right.createdAt || compareText(left.id, right.id),
      ),
    [artifacts],
  );

  if (ordered.length === 0) return null;

  const visible = ordered.slice(0, MAX_INLINE_ARTIFACTS);
  const total = ordered.length;

  return (
    <div className={cn('mt-3 grid', className)}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map((artifact) => (
          <ArtifactCard key={artifact.id} artifact={artifact} compact />
        ))}
      </div>

      {total > MAX_INLINE_ARTIFACTS ? (
        <Button
          size="sm"
          variant="secondary"
          className="mt-2 justify-self-start"
          aria-label={t('artifacts.viewAllAria', { count: total })}
          onClick={() => useUiStore.getState().openArtifactList()}
        >
          <Plus aria-hidden className="size-3.5" />
          {t('artifacts.viewAll', { count: total })}
        </Button>
      ) : null}
    </div>
  );
}
