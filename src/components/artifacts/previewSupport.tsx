import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import type { ArtifactContent, ArtifactPreview } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button, Spinner } from '@/components/ui';

/** Props shared by every artifact preview branch (`ArtifactPreview` and the format-specific views). */
export interface ArtifactViewProps {
  content: ArtifactContent;
  className?: string;
  /** `false` hides artifact-only actions (Salvar como…/Abrir). */
  showArtifactActions?: boolean;
}

/**
 * Preview loader used by the format-specific views. The default reads artifact
 * previews; the attachment dialog overrides it with `getAttachmentPreview`.
 */
export type PreviewLoader = (id: string) => Promise<ArtifactPreview | null>;

const loadArtifactPreview: PreviewLoader = (id) => api.getArtifactPreview(id);

const PreviewLoaderContext = createContext<PreviewLoader>(loadArtifactPreview);

/** Overrides the structured-preview loader for a subtree. */
export function PreviewLoaderProvider({
  loader,
  children,
}: {
  loader: PreviewLoader;
  children: ReactNode;
}) {
  return <PreviewLoaderContext.Provider value={loader}>{children}</PreviewLoaderContext.Provider>;
}

export type ArtifactPreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; preview: ArtifactPreview | null };

/**
 * Loads the structured preview of an attachment/artifact (DOCX/XLSX/PPTX/…)
 * through the IPC bridge. Keeps the previous result out of the way while
 * retrying so the UI can show a clean loading state.
 */
export function useArtifactPreview(artifactId: string): {
  state: ArtifactPreviewState;
  retry: () => void;
} {
  const [state, setState] = useState<ArtifactPreviewState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const loadPreview = useContext(PreviewLoaderContext);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loadPreview(artifactId)
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
  }, [artifactId, attempt, loadPreview]);

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
  title,
  message,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  const { t } = useTranslation('artifacts');
  return (
    <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-center', className)}>
      <AlertTriangle aria-hidden className="size-5 text-danger" />
      <p className="text-[13px] font-medium text-foreground">
        {title ?? t('artifacts:preview.errorTitle')}
      </p>
      <p className="max-w-sm text-xs leading-relaxed text-foreground-muted">{message}</p>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        {t('artifacts:panel.retry')}
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
