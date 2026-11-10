import { FileQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Artifact } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ArtifactCard } from './ArtifactCard';

export interface ArtifactListProps {
  artifacts: Artifact[];
  /** Artifact currently open in the panel preview. */
  activeId?: string | null;
  /** Overrides the default action (open the artifact preview). */
  onSelect?: (artifact: Artifact) => void;
  className?: string;
}

/**
 * Vertical list of compact artifact cards used by the side panel (DESIGN §5).
 * The order comes from the store (canonical `createdAt, id`) and is preserved.
 */
export function ArtifactList({ artifacts, activeId = null, onSelect, className }: ArtifactListProps) {
  const { t } = useTranslation('artifacts');

  if (!artifacts.length) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <FileQuestion aria-hidden className="size-6 text-foreground-subtle" strokeWidth={1.9} />
          <p className="text-[13px] font-medium text-foreground">{t('artifacts:list.emptyTitle')}</p>
          <p className="max-w-64 text-xs leading-relaxed text-foreground-muted">
            {t('artifacts:list.emptyDescription')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul aria-label={t('artifacts:list.ariaLabel')} className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {artifacts.map((artifact) => (
        <li key={artifact.id} className="min-w-0">
          <ArtifactCard
            artifact={artifact}
            active={artifact.id === activeId}
            compact
            onOpen={onSelect}
          />
        </li>
      ))}
    </ul>
  );
}
