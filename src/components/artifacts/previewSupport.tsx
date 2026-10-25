import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import type { ArtifactContent, ArtifactPreview } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button, Spinner } from '@/components/ui';

/** Props shared by every artifact preview branch (`ArtifactPreview` and the format-specific views). */
export interface ArtifactViewProps {
  content: ArtifactContent;
  className?: string;
}

export type ArtifactPreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; preview: ArtifactPreview | null };

/**
 * Loads the structured preview of an artifact (DOCX/XLSX/PPTX) through the IPC
 * bridge. Keeps the previous result out of the way while retrying so the UI can
 * show a clean loading state.
 */
export function useArtifactPreview(artifactId: string): {
  state: ArtifactPreviewState;
  retry: () => void;
} {
  const [state, setState] = useState<ArtifactPreviewState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    api
      .getArtifactPreview(artifactId)
      .then((preview) => {
        if (!cancelled) setState({ status: 'ready', preview });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [artifactId, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}

export function PreviewLoading({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('flex h-full flex-col items-center justify-center gap-2 p-6', className)}>
      <Spinner size="md" className="text-accent" label={label} />
      <span className="text-xs text-foreground-muted">{label}</span>
    </div>
  );
}

export function PreviewError({
  title = 'Não foi possível carregar a prévia',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-center', className)}>
      <AlertTriangle aria-hidden className="size-5 text-danger" />
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs leading-relaxed text-foreground-muted">{message}</p>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  );
}

/** Empty-state text used when a preview loaded but has nothing to show. */
export function PreviewEmpty({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn('flex h-full items-center justify-center p-6', className)}>
      <p className="text-xs text-foreground-subtle">{message}</p>
    </div>
  );
}
