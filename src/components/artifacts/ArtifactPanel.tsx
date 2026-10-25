import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileQuestion,
  Files,
  List,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ArtifactContent } from '@/lib/types';
import { cn, formatBytes } from '@/lib/utils';
import { useUiStore } from '@/lib/store';
import { Badge, Button, IconButton, Spinner, Tooltip } from '@/components/ui';
import { artifactKindMeta } from './kinds';
import { ArtifactPreview } from './ArtifactPreview';
import { ArtifactList } from './ArtifactList';

function formatCreatedAt(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Canvas-like side panel for artifacts (DESIGN §5/§11): slide-in from the right,
 * with two store-driven views — the conversation artifact list and a single
 * artifact preview (kind-aware, with navigation, save/open/delete actions).
 * Visibility is driven by `useUiStore`.
 */
export function ArtifactPanel() {
  const open = useUiStore((state) => state.artifactPanelOpen);
  const panelView = useUiStore((state) => state.artifactPanelView);
  const artifacts = useUiStore((state) => state.artifacts);
  const activeId = useUiStore((state) => state.activeArtifactId);
  const setActiveArtifact = useUiStore((state) => state.setActiveArtifact);
  const setArtifactPanelView = useUiStore((state) => state.setArtifactPanelView);
  const closeArtifactPanel = useUiStore((state) => state.closeArtifactPanel);

  const [content, setContent] = useState<ArtifactContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);

  const artifact = artifacts.find((entry) => entry.id === activeId) ?? null;
  const meta = artifact ? artifactKindMeta(artifact.kind) : null;
  const ArtifactIcon = meta?.icon ?? FileQuestion;
  // A preview without an active artifact falls back to the list, so the panel
  // never shows an empty/stale preview surface.
  const mode = panelView === 'preview' && artifact ? 'preview' : 'list';

  // Move focus into the panel when it opens (and when the list preview swaps),
  // so keyboard users can reach the actions of the new view.
  useEffect(() => {
    if (!open) return;
    const handle = window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => window.cancelAnimationFrame(handle);
  }, [open, mode]);

  const index = artifact ? artifacts.findIndex((entry) => entry.id === artifact.id) : -1;

  useEffect(() => {
    setConfirmDelete(false);
    if (!open || !activeId) {
      setContent(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    api
      .getArtifactContent(activeId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setError('Conteúdo do artefato não encontrado.');
          return;
        }
        setContent(result);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeId]);

  const navigate = (delta: number) => {
    if (!artifact || artifacts.length < 2) return;
    const next = artifacts[(index + delta + artifacts.length) % artifacts.length];
    if (next) setActiveArtifact(next.id);
  };

  const handleSave = async () => {
    if (!artifact) return;
    try {
      const path = await api.saveArtifact(artifact.id, artifact.name);
      if (path) toast.success('Arquivo salvo', { description: path });
    } catch (saveError) {
      toast.error('Não foi possível salvar', {
        description: saveError instanceof Error ? saveError.message : String(saveError),
      });
    }
  };

  const handleOpen = async () => {
    if (!artifact) return;
    try {
      await api.openArtifact(artifact.id);
    } catch (openError) {
      toast.error('Não foi possível abrir o arquivo', {
        description: openError instanceof Error ? openError.message : String(openError),
      });
    }
  };

  const handleDelete = async () => {
    if (!artifact) return;
    setBusy(true);
    try {
      await api.deleteArtifact(artifact.id);
      const rest = useUiStore.getState().artifacts.filter((entry) => entry.id !== artifact.id);
      useUiStore.getState().setArtifacts(rest);
      if (rest.length) {
        useUiStore.getState().setActiveArtifact(rest[0].id);
      } else {
        closeArtifactPanel();
      }
      toast.success('Artefato excluído');
      setConfirmDelete(false);
    } catch (deleteError) {
      toast.error('Não foi possível excluir', {
        description: deleteError instanceof Error ? deleteError.message : String(deleteError),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label="Painel de artefatos"
      aria-hidden={!open || undefined}
      inert={!open}
      className={cn(
        'fixed inset-y-0 right-0 z-40 flex w-[min(560px,92vw)] flex-col border-l border-border bg-surface-raised shadow-2xl outline-none',
        'transition-transform duration-[240ms] ease-[var(--ease-out-soft)] motion-reduce:transition-none',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
    >
      {mode === 'preview' && artifact && meta ? (
        <>
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', meta.tone)}>
              <ArtifactIcon aria-hidden className="size-4" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
                {artifact.name}
              </h2>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-foreground-subtle">
                <Badge tone="muted">{meta.label}</Badge>
                <span className="tabular-nums">{formatBytes(artifact.size)}</span>
                {artifact.language ? <span>· {artifact.language}</span> : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Tooltip content="Ver lista" side="bottom">
                <IconButton
                  label="Ver lista de artefatos"
                  size="sm"
                  onClick={() => setArtifactPanelView('list')}
                >
                  <List className="size-4" />
                </IconButton>
              </Tooltip>
              <Tooltip content="Artefato anterior" side="bottom">
                <IconButton
                  label="Artefato anterior"
                  size="sm"
                  onClick={() => navigate(-1)}
                  disabled={artifacts.length < 2}
                >
                  <ChevronLeft className="size-4" />
                </IconButton>
              </Tooltip>
              <Tooltip content="Próximo artefato" side="bottom">
                <IconButton
                  label="Próximo artefato"
                  size="sm"
                  onClick={() => navigate(1)}
                  disabled={artifacts.length < 2}
                >
                  <ChevronRight className="size-4" />
                </IconButton>
              </Tooltip>
              <Tooltip content="Salvar como…" side="bottom">
                <IconButton label="Salvar como…" size="sm" onClick={() => void handleSave()}>
                  <Download className="size-4" />
                </IconButton>
              </Tooltip>
              <Tooltip content="Abrir no aplicativo padrão" side="bottom">
                <IconButton label="Abrir no aplicativo padrão" size="sm" onClick={() => void handleOpen()}>
                  <ExternalLink className="size-4" />
                </IconButton>
              </Tooltip>
              <Tooltip content="Excluir" side="bottom">
                <IconButton
                  label="Excluir artefato"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  className="hover:text-danger"
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </Tooltip>
              <Tooltip content="Fechar" side="bottom">
                <IconButton label="Fechar painel de artefatos" size="sm" onClick={closeArtifactPanel}>
                  <X className="size-4" />
                </IconButton>
              </Tooltip>
            </div>
          </header>

          {confirmDelete ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-danger-soft px-3 py-2 text-[12px] text-danger">
              <AlertTriangle aria-hidden className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 leading-snug">
                Excluir “{artifact.name}”? Esta ação não pode ser desfeita.
              </span>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button size="sm" variant="danger" loading={busy} onClick={() => void handleDelete()}>
                Excluir
              </Button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-hidden">
            {loading ? (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <Spinner size="md" className="text-accent" label="Carregando artefato" />
                <span className="text-xs text-foreground-muted">Carregando artefato…</span>
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertTriangle aria-hidden className="size-5 text-danger" />
                <p className="text-[13px] font-medium text-foreground">Não foi possível carregar</p>
                <p className="text-xs leading-relaxed text-foreground-muted">{error}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (activeId) {
                      setLoading(true);
                      api
                        .getArtifactContent(activeId)
                        .then((result) => {
                          setContent(result);
                          setError(result ? null : 'Conteúdo do artefato não encontrado.');
                        })
                        .catch((retryError: unknown) =>
                          setError(retryError instanceof Error ? retryError.message : String(retryError)),
                        )
                        .finally(() => setLoading(false));
                    }
                  }}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : content ? (
              <ArtifactPreview content={content} />
            ) : null}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2 text-[11px] text-foreground-subtle">
            <span className="tabular-nums">
              {index >= 0 ? `${index + 1} de ${artifacts.length}` : '—'} artefato
              {artifacts.length === 1 ? '' : 's'}
            </span>
            <span>Criado em {formatCreatedAt(artifact.createdAt)}</span>
          </footer>
        </>
      ) : (
        <>
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-foreground-muted">
              <Files aria-hidden className="size-4" strokeWidth={1.9} />
            </span>
            <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-foreground">
              Artefatos
            </h2>
            <Badge
              tone="muted"
              size="md"
              title={pluralize(artifacts.length, 'artefato', 'artefatos')}
              className="tabular-nums"
            >
              {artifacts.length}
            </Badge>
            <Tooltip content="Fechar" side="bottom">
              <IconButton label="Fechar painel de artefatos" size="sm" onClick={closeArtifactPanel}>
                <X className="size-4" />
              </IconButton>
            </Tooltip>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
            <ArtifactList artifacts={artifacts} activeId={activeId} />
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2 text-[11px] text-foreground-subtle">
            <span className="tabular-nums">
              {pluralize(artifacts.length, 'artefato', 'artefatos')}
            </span>
            {artifacts.length ? <span>Selecione “Abrir” para ver a prévia</span> : null}
          </footer>
        </>
      )}
    </aside>
  );
}

export default ArtifactPanel;
