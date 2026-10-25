import { Download, ExternalLink, FileQuestion } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui';
import { artifactKindMeta } from './kinds';
import type { ArtifactViewProps } from './previewSupport';

async function saveArtifact(artifactId: string, name: string) {
  try {
    const path = await api.saveArtifact(artifactId, name);
    if (path) toast.success('Arquivo salvo', { description: path });
  } catch (error) {
    toast.error('Não foi possível salvar', {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

async function openArtifact(artifactId: string) {
  try {
    await api.openArtifact(artifactId);
  } catch (error) {
    toast.error('Não foi possível abrir o arquivo', {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface BinaryPreviewProps extends ArtifactViewProps {
  /** Extra explanation shown under the metadata (e.g. the backend "unsupported" reason). */
  detail?: string;
}

/** Last-resort card for artifacts the panel cannot render (binary files, failed previews). */
export function BinaryPreview({ content, className, detail }: BinaryPreviewProps) {
  const { artifact } = content;
  const meta = artifactKindMeta(artifact.kind);

  return (
    <div className={cn('flex h-full items-center justify-center p-6', className)}>
      <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border border-border bg-surface-raised p-6 text-center">
        <span className={cn('flex size-12 items-center justify-center rounded-xl', meta.tone)}>
          <FileQuestion aria-hidden className="size-6" />
        </span>
        <div>
          <p className="text-[13px] font-medium text-foreground">{artifact.name}</p>
          <p className="mt-0.5 text-[11px] text-foreground-subtle">
            {meta.label} · {formatBytes(artifact.size)} · prévia não disponível
          </p>
          {detail ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-foreground-muted">{detail}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Download className="size-3.5" />}
            onClick={() => void saveArtifact(artifact.id, artifact.name)}
          >
            Salvar como…
          </Button>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<ExternalLink className="size-3.5" />}
            onClick={() => void openArtifact(artifact.id)}
          >
            Abrir
          </Button>
        </div>
      </div>
    </div>
  );
}
