import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Pencil,
  Star,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ArtifactContent, LibraryArtifact } from '@/lib/types';
import { cn, formatBytes } from '@/lib/utils';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  Spinner,
} from '@/components/ui';
import { ArtifactPreview } from '@/components/artifacts/ArtifactPreview';
import { artifactKindMeta } from '@/components/artifacts/kinds';
import { formatLibraryDate, libraryArtifactOrigin } from './filters';

/** Opening context requested by the page (menu “Renomear”/“Excluir”). */
export type LibraryDialogIntent = 'preview' | 'rename' | 'delete';

export interface LibraryPreviewDialogProps {
  /** Artifact currently previewed; the page remounts the dialog when it changes. */
  artifact: LibraryArtifact;
  /** Artifacts in the current filter/search order, used by previous/next and “X de N”. */
  siblings: LibraryArtifact[];
  /** Opens the dialog already in rename/edit or delete-confirmation mode. */
  intent?: LibraryDialogIntent;
  onClose: () => void;
  onNavigate: (artifactId: string) => void;
  onToggleFavorite: (artifact: LibraryArtifact) => void;
  /** Renames the file/metadata; rejections are shown inline in the dialog. */
  onRename: (artifact: LibraryArtifact, name: string) => Promise<void>;
  onSave: (artifact: LibraryArtifact) => void;
  onOpenExternal: (artifact: LibraryArtifact) => void;
  /** Deletes the artifact and closes the dialog on success. */
  onDelete: (artifact: LibraryArtifact) => Promise<void>;
}

type ContentState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; content: ArtifactContent };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatCreatedAt(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Artifact preview dialog for the Biblioteca page (PLAN §4.2): reuses the same
 * `ArtifactPreview` renderers as the side panel, with type/size/origin/date
 * badges, favorite, inline rename, save/open/delete (inline confirmation) and
 * previous/next navigation across the filtered library.
 */
export function LibraryPreviewDialog({
  artifact,
  siblings,
  intent = 'preview',
  onClose,
  onNavigate,
  onToggleFavorite,
  onRename,
  onSave,
  onOpenExternal,
  onDelete,
}: LibraryPreviewDialogProps) {
  const meta = artifactKindMeta(artifact.kind);
  const Icon = meta.icon;
  const origin = libraryArtifactOrigin(artifact);
  const favorite = artifact.favorite === true;

  const [state, setState] = useState<ContentState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [renaming, setRenaming] = useState(intent === 'rename');
  const [renameValue, setRenameValue] = useState(artifact.name);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(intent === 'delete');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    api
      .getArtifactContent(artifact.id)
      .then((content) => {
        if (cancelled) return;
        setState(
          content
            ? { status: 'ready', content }
            : { status: 'error', message: 'Conteúdo do artefato não encontrado.' },
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.id, attempt]);

  useEffect(() => {
    if (!renaming) return;
    const input = renameInputRef.current;
    input?.focus();
    input?.select();
  }, [renaming]);

  const index = siblings.findIndex((entry) => entry.id === artifact.id);
  const navigate = (delta: number) => {
    if (siblings.length < 2) return;
    const base = index >= 0 ? index : 0;
    const next = siblings[(base + delta + siblings.length) % siblings.length];
    if (next && next.id !== artifact.id) onNavigate(next.id);
  };

  const startRename = () => {
    setRenameValue(artifact.name);
    setRenameError(null);
    setRenaming(true);
  };

  const cancelRename = () => {
    setRenaming(false);
    setRenameError(null);
    setRenameValue(artifact.name);
  };

  const submitRename = async () => {
    const name = renameValue.trim();
    if (!name) {
      setRenameError('Informe um nome para o arquivo.');
      return;
    }
    if (name === artifact.name) {
      setRenaming(false);
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      await onRename(artifact, name);
      setRenaming(false);
    } catch (error) {
      setRenameError(describeError(error));
    } finally {
      setRenameBusy(false);
    }
  };

  const confirmDelete = async () => {
    setDeleteBusy(true);
    try {
      await onDelete(artifact);
    } catch (error) {
      toast.error('Não foi possível excluir o arquivo', { description: describeError(error) });
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="2xl"
        className="gap-0"
        onEscapeKeyDown={(event) => {
          // Escape first cancels the rename / delete confirmation instead of
          // closing the whole dialog.
          if (renaming) {
            event.preventDefault();
            cancelRename();
            return;
          }
          if (confirmingDelete) {
            event.preventDefault();
            setConfirmingDelete(false);
          }
        }}
      >
        <DialogHeader className="gap-2 pr-12">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              aria-hidden
              className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', meta.tone)}
            >
              <Icon className="size-4" strokeWidth={1.9} />
            </span>
            <DialogTitle
              className={cn(
                'min-w-0 truncate text-[16px] leading-6',
                renaming && 'sr-only',
              )}
            >
              {artifact.name}
            </DialogTitle>
            {renaming ? (
              <form
                className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitRename();
                }}
              >
                <Input
                  ref={renameInputRef}
                  value={renameValue}
                  invalid={Boolean(renameError)}
                  aria-label="Renomear arquivo"
                  className="h-8 min-w-0 max-w-sm flex-1 text-[13px]"
                  onChange={(event) => {
                    setRenameValue(event.target.value);
                    setRenameError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      // Esc cancels the rename instead of closing the dialog.
                      event.preventDefault();
                      event.stopPropagation();
                      cancelRename();
                    }
                  }}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  loading={renameBusy}
                  disabled={!renameValue.trim()}
                >
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelRename} disabled={renameBusy}>
                  Cancelar
                </Button>
              </form>
            ) : null}
          </div>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            <Badge tone="muted">{meta.label}</Badge>
            <Badge tone="muted">{formatBytes(artifact.size)}</Badge>
            <Badge tone="outline" title={origin}>
              {origin}
            </Badge>
            <Badge tone="muted">{formatLibraryDate(artifact.createdAt)}</Badge>
          </DialogDescription>
          {renameError ? (
            <p role="alert" className="text-[11px] leading-relaxed text-danger">
              {renameError}
            </p>
          ) : null}
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-1 border-y border-border bg-surface px-6 py-1.5">
          <IconButton
            label="Arquivo anterior"
            size="sm"
            disabled={siblings.length < 2}
            onClick={() => navigate(-1)}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </IconButton>
          <IconButton
            label="Próximo arquivo"
            size="sm"
            disabled={siblings.length < 2}
            onClick={() => navigate(1)}
          >
            <ChevronRight aria-hidden className="size-4" />
          </IconButton>
          <span className="ml-1 text-[11px] tabular-nums text-foreground-subtle">
            {index >= 0 ? `${index + 1} de ${siblings.length}` : `— de ${siblings.length}`}
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-1">
            <IconButton
              label={favorite ? 'Desfavoritar' : 'Favoritar'}
              size="sm"
              active={favorite}
              onClick={() => onToggleFavorite(artifact)}
            >
              <Star
                aria-hidden
                className="size-4"
                strokeWidth={1.9}
                fill={favorite ? 'currentColor' : 'none'}
              />
            </IconButton>
            <IconButton
              label="Renomear"
              size="sm"
              disabled={renaming}
              onClick={startRename}
            >
              <Pencil aria-hidden className="size-4" />
            </IconButton>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Download aria-hidden className="size-3.5" />}
              onClick={() => onSave(artifact)}
            >
              Salvar como…
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<ExternalLink aria-hidden className="size-3.5" />}
              onClick={() => onOpenExternal(artifact)}
            >
              Abrir
            </Button>
            <IconButton
              label="Excluir arquivo"
              size="sm"
              className="hover:text-danger"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 aria-hidden className="size-4" />
            </IconButton>
          </div>
        </div>

        {confirmingDelete ? (
          <div
            role="group"
            aria-label={`Confirmar exclusão de ${artifact.name}`}
            className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-danger-soft px-6 py-2 text-[12px] text-danger"
          >
            <AlertTriangle aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 leading-snug">
              Excluir “{artifact.name}”? Esta ação não pode ser desfeita.
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={deleteBusy}
              onClick={() => setConfirmingDelete(false)}
            >
              Cancelar
            </Button>
            <Button size="sm" variant="danger" loading={deleteBusy} onClick={() => void confirmDelete()}>
              Excluir
            </Button>
          </div>
        ) : null}

        <div
          role="region"
          aria-label={`Prévia de ${artifact.name}`}
          className="h-[min(64vh,520px)] min-h-0 overflow-hidden"
        >
          {state.status === 'loading' ? (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <Spinner size="md" className="text-accent" label="Carregando prévia" />
              <span className="text-xs text-foreground-muted">Carregando prévia…</span>
            </div>
          ) : null}

          {state.status === 'error' ? (
            <div
              role="alert"
              className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
            >
              <AlertTriangle aria-hidden className="size-5 text-danger" />
              <p className="text-[13px] font-medium text-foreground">
                Não foi possível carregar a prévia
              </p>
              <p className="max-w-md text-xs leading-relaxed text-foreground-muted">
                {state.message}
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setState({ status: 'loading' });
                  setAttempt((value) => value + 1);
                }}
              >
                Tentar novamente
              </Button>
            </div>
          ) : null}

          {state.status === 'ready' ? <ArtifactPreview content={state.content} /> : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-2 text-[11px] text-foreground-subtle">
          <span className="tabular-nums">
            {index >= 0 ? `${index + 1} de ${siblings.length}` : `— de ${siblings.length}`}
          </span>
          <span className="min-w-0 truncate">
            {origin} · Criado em {formatCreatedAt(artifact.createdAt)}
          </span>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export default LibraryPreviewDialog;
