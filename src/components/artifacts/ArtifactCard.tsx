import { Download } from 'lucide-react';
import { toast } from 'sonner';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { api } from '@/lib/api';
import type { Artifact } from '@/lib/types';
import { cn, formatBytes } from '@/lib/utils';
import { useUiStore } from '@/lib/store';
import { Badge, Button, IconButton, Tooltip } from '@/components/ui';
import { artifactKindMeta } from './kinds';

export interface ArtifactCardProps {
  artifact: Artifact;
  /** Overrides the default action (open the artifact panel). */
  onOpen?: (artifact: Artifact) => void;
  compact?: boolean;
  className?: string;
}

async function saveArtifact(artifact: Artifact) {
  try {
    const path = await api.saveArtifact(artifact.id, artifact.name);
    if (path) toast.success('Arquivo salvo', { description: path });
  } catch (error) {
    toast.error('Não foi possível salvar', {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Inline artifact card shown in the chat flow (DESIGN §6.3/§11): kind icon,
 * name, size and the "Abrir" / "Salvar como…" actions.
 */
export function ArtifactCard({ artifact, onOpen, compact = false, className }: ArtifactCardProps) {
  const meta = artifactKindMeta(artifact.kind);
  const Icon = meta.icon;

  const open = () => {
    if (onOpen) {
      onOpen(artifact);
      return;
    }
    useUiStore.getState().setActiveArtifact(artifact.id);
  };

  const handleSave = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void saveArtifact(artifact);
  };

  return (
    <div
      className={cn(
        'group/artifact flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface-raised p-2.5',
        'transition-colors duration-150 hover:border-border-strong motion-reduce:transition-none',
        compact && 'gap-2 p-2',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          meta.tone,
          compact && 'size-8',
        )}
      >
        <Icon className={cn('size-4', compact && 'size-3.5')} strokeWidth={1.9} />
      </span>

      <button
        type="button"
        onClick={open}
        className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="block truncate text-[13px] font-medium text-foreground decoration-border-strong underline-offset-2 group-hover/artifact:underline">
          {artifact.name}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-foreground-subtle">
          <Badge tone="muted">{meta.label}</Badge>
          <span className="tabular-nums">{formatBytes(artifact.size)}</span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="secondary" onClick={open}>
          Abrir
        </Button>
        <Tooltip content="Salvar como…" side="top">
          <IconButton label={`Salvar ${artifact.name} como…`} size="sm" onClick={handleSave}>
            <Download className="size-3.5" />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}
