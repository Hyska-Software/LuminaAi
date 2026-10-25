import { cn } from '@/lib/utils';
import { HtmlPreview } from '@/components/genui';
import { BinaryPreview } from './BinaryPreview';
import {
  PreviewError,
  PreviewLoading,
  useArtifactPreview,
  type ArtifactViewProps,
} from './previewSupport';

/**
 * Word preview: the backend converts `word/document.xml` to sanitized HTML and
 * the panel renders it in the existing sandboxed `HtmlPreview` iframe.
 */
export function DocxPreview({ content, className }: ArtifactViewProps) {
  const { state, retry } = useArtifactPreview(content.artifact.id);

  if (state.status === 'loading') {
    return <PreviewLoading label="Carregando documento…" className={className} />;
  }
  if (state.status === 'error') {
    return <PreviewError message={state.message} onRetry={retry} className={className} />;
  }

  const preview = state.preview;
  if (!preview || preview.kind !== 'docx') {
    return (
      <BinaryPreview
        content={content}
        className={className}
        detail={preview?.kind === 'unsupported' ? preview.reason : undefined}
      />
    );
  }

  return (
    <div className={cn('h-full overflow-auto bg-surface p-3', className)}>
      <HtmlPreview
        html={preview.html}
        title={content.artifact.name}
        className="my-0"
        minHeight={320}
        maxHeight={2400}
      />
    </div>
  );
}
