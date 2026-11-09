import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type {
  ArtifactContent,
  ArtifactKind,
  AttachmentContent,
  AttachmentInfo,
} from '@/lib/types';
import { formatBytes } from '@/lib/utils';
import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';
import { ArtifactPreview } from '@/components/artifacts/ArtifactPreview';
import {
  PreviewError,
  PreviewLoading,
  PreviewLoaderProvider,
  type PreviewLoader,
} from '@/components/artifacts/previewSupport';
import { attachmentFormatLabel } from './attachmentLabels';

/** Attachment kind → artifact preview kind (the preview views are shared). */
const PREVIEW_KINDS: Record<AttachmentInfo['kind'], ArtifactKind> = {
  image: 'image',
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
  text: 'text',
  code: 'code',
  csv: 'csv',
  json: 'json',
  unknown: 'binary',
};

const loadAttachmentPreview: PreviewLoader = (id) => api.getAttachmentPreview(id);

type ContentState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; content: AttachmentContent };

/** Builds the synthetic artifact content consumed by the shared preview views. */
function toArtifactContent(
  attachment: AttachmentInfo,
  content: AttachmentContent,
): ArtifactContent {
  return {
    artifact: {
      id: attachment.id,
      conversationId: null,
      name: attachment.name,
      mimeType: attachment.mimeType,
      kind: PREVIEW_KINDS[attachment.kind],
      size: attachment.size,
      createdAt: 0,
    },
    content: content.content ?? null,
    dataBase64: content.dataBase64 ?? null,
  };
}

export interface AttachmentPreviewDialogProps {
  attachment: AttachmentInfo;
  onClose: () => void;
}

/**
 * Preview dialog for a chat attachment. Reuses the artifact preview views with
 * an attachment-specific structured-preview loader and hides artifact-only
 * actions (Salvar como…/Abrir): attachments are viewed here, not exported.
 */
export function AttachmentPreviewDialog({
  attachment,
  onClose,
}: AttachmentPreviewDialogProps) {
  const [state, setState] = useState<ContentState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    api
      .getAttachmentContent(attachment.id)
      .then((content) => {
        if (cancelled) return;
        if (!content) {
          setState({ status: 'error', message: 'Anexo não encontrado.' });
          return;
        }
        setState({ status: 'ready', content });
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
  }, [attachment.id, attempt]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="2xl" className="gap-0">
        <DialogHeader className="gap-2 pr-12">
          <DialogTitle
            className="truncate text-[16px] leading-6"
            title={attachment.name}
          >
            {attachment.name}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            <Badge tone="muted">{attachmentFormatLabel(attachment)}</Badge>
            <Badge tone="muted">{formatBytes(attachment.size)}</Badge>
            {attachment.pageCount ? (
              <Badge tone="muted">{attachment.pageCount} pág.</Badge>
            ) : null}
            {attachment.width && attachment.height ? (
              <Badge tone="muted">
                {attachment.width}×{attachment.height}
              </Badge>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div
          role="region"
          aria-label={`Prévia de ${attachment.name}`}
          className="h-[min(64vh,520px)] min-h-0 overflow-hidden border-t border-border"
        >
          {state.status === 'loading' ? (
            <PreviewLoading label="Carregando prévia…" />
          ) : null}

          {state.status === 'error' ? (
            <PreviewError
              message={state.message}
              onRetry={() => setAttempt((value) => value + 1)}
            />
          ) : null}

          {state.status === 'ready' ? (
            <PreviewLoaderProvider loader={loadAttachmentPreview}>
              <ArtifactPreview
                content={toArtifactContent(attachment, state.content)}
                showArtifactActions={false}
              />
            </PreviewLoaderProvider>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AttachmentPreviewDialog;
