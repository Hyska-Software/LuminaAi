import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { AlertTriangle, Library, SearchX, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Artifact, LibraryArtifact } from '@/lib/types';
import { useUiStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button, Spinner } from '@/components/ui';
import {
  applyLibraryQuery,
  importResultMessage,
  libraryArtifactCounts,
  pluralizeFiles,
  type LibraryFilterId,
  type LibrarySortId,
} from './filters';
import { LibraryCard, LibraryCardSkeleton, LibraryRow } from './LibraryCard';
import { LibraryFilters } from './LibraryFilters';
import { LibraryPreviewDialog, type LibraryDialogIntent } from './LibraryPreviewDialog';
import { LibraryHeader, type LibraryViewMode } from './LibraryToolbar';

type LibraryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; artifacts: LibraryArtifact[] };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads `{ paths }`/`{ active }` from the events emitted by App.tsx. */
function eventDetail<T>(event: Event): T | null {
  const detail = (event as CustomEvent<unknown>).detail;
  return detail && typeof detail === 'object' ? (detail as T) : null;
}

/**
 * Biblioteca page (PLAN §4.2): every artifact of the user — from all
 * conversations plus uploaded files — rendered in place of the chat column, in
 * the same pattern as `SkillsView`. Search, category pills, ordering,
 * grid/list, native upload, drag & drop and the preview/management dialog all
 * live here; persistence stays in the backend (no parallel index).
 */
export function LibraryView() {
  const setActiveView = useUiStore((state) => state.setActiveView);

  const [state, setState] = useState<LibraryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilterId>('all');
  const [sort, setSort] = useState<LibrarySortId>('recent');
  const [view, setView] = useState<LibraryViewMode>('grid');
  const [importing, setImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialogIntent, setDialogIntent] = useState<LibraryDialogIntent>('preview');
  const importingRef = useRef(false);
  const viewRef = useRef<HTMLElement | null>(null);

  // The view replaces the chat: move focus into it so keyboard users do not
  // stay on a control that was just unmounted.
  useEffect(() => {
    viewRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    api
      .listLibraryArtifacts()
      .then((artifacts) => {
        if (!cancelled) setState({ status: 'ready', artifacts });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const applyArtifactUpdate = useCallback((updated: Artifact) => {
    setState((previous) => {
      if (previous.status !== 'ready') return previous;
      return {
        ...previous,
        artifacts: previous.artifacts.map((entry) =>
          entry.id === updated.id ? { ...entry, ...updated } : entry,
        ),
      };
    });
  }, []);

  const importFiles = useCallback(
    async (paths: string[]) => {
      if (importingRef.current) return;
      const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
      if (!unique.length) return;
      importingRef.current = true;
      setImporting(true);
      try {
        const imported = await api.importLibraryFiles(unique);
        if (!imported.length) {
          toast.info('Nenhum arquivo enviado');
          return;
        }
        // Re-read from the backend so the origin (conversation title) is exactly
        // what the database returns; fall back to the imported rows if it fails.
        try {
          const fresh = await api.listLibraryArtifacts();
          setState({ status: 'ready', artifacts: fresh });
        } catch {
          setState({ status: 'ready', artifacts: imported });
        }
        toast.success(importResultMessage(imported.length));
      } catch (error) {
        toast.error('Não foi possível enviar os arquivos', { description: describeError(error) });
      } finally {
        importingRef.current = false;
        setImporting(false);
      }
    },
    [],
  );

  const pickFiles = useCallback(async () => {
    if (importingRef.current) return;
    try {
      const selection = await open({
        multiple: true,
        title: 'Enviar arquivos para a biblioteca',
      });
      const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
      if (paths.length) await importFiles(paths);
    } catch (error) {
      toast.error('Não foi possível abrir o seletor de arquivos', {
        description: describeError(error),
      });
    }
  }, [importFiles]);

  /* Global drag & drop (App.tsx) and the palette/hotkey import trigger. */
  useEffect(() => {
    const onDrop = (event: Event) => {
      setDragActive(false);
      const detail = eventDetail<{ paths?: unknown }>(event);
      const paths = Array.isArray(detail?.paths)
        ? detail.paths.filter((path): path is string => typeof path === 'string')
        : [];
      if (paths.length) void importFiles(paths);
    };
    const onDrag = (event: Event) => {
      const detail = eventDetail<{ active?: unknown }>(event);
      setDragActive(detail?.active === true);
    };
    const onImport = () => {
      void pickFiles();
    };

    window.addEventListener('lumina:library-drop', onDrop);
    window.addEventListener('lumina:library-drag', onDrag);
    window.addEventListener('lumina:library-import', onImport);
    return () => {
      window.removeEventListener('lumina:library-drop', onDrop);
      window.removeEventListener('lumina:library-drag', onDrag);
      window.removeEventListener('lumina:library-import', onImport);
    };
  }, [importFiles, pickFiles]);

  const toggleFavorite = (artifact: LibraryArtifact) => {
    const next = artifact.favorite !== true;
    // Optimistic star: the list re-sorts only by creation date, so the flip is
    // safe; a failure reverts to the previous value with a toast.
    applyArtifactUpdate({ ...artifact, favorite: next });
    void api
      .setArtifactFavorite(artifact.id, next)
      .then((updated) => applyArtifactUpdate(updated))
      .catch((error: unknown) => {
        applyArtifactUpdate({ ...artifact, favorite: !next });
        toast.error(next ? 'Não foi possível favoritar o arquivo' : 'Não foi possível desfavoritar o arquivo', {
          description: describeError(error),
        });
      });
  };

  const renameArtifact = async (artifact: LibraryArtifact, name: string) => {
    const updated = await api.renameArtifact(artifact.id, name);
    applyArtifactUpdate(updated);
    toast.success('Arquivo renomeado', { description: updated.name });
  };

  const deleteArtifact = async (artifact: LibraryArtifact) => {
    await api.deleteArtifact(artifact.id);
    setState((previous) => {
      if (previous.status !== 'ready') return previous;
      return {
        ...previous,
        artifacts: previous.artifacts.filter((entry) => entry.id !== artifact.id),
      };
    });
    setActiveId(null);
    toast.success('Arquivo excluído', { description: artifact.name });
  };

  const saveArtifact = (artifact: LibraryArtifact) => {
    void api
      .saveArtifact(artifact.id, artifact.name)
      .then((path) => {
        if (path) toast.success('Arquivo salvo', { description: path });
      })
      .catch((error: unknown) => {
        toast.error('Não foi possível salvar', { description: describeError(error) });
      });
  };

  const openExternal = (artifact: LibraryArtifact) => {
    void api.openArtifact(artifact.id).catch((error: unknown) => {
      toast.error('Não foi possível abrir o arquivo', { description: describeError(error) });
    });
  };

  const artifacts = state.status === 'ready' ? state.artifacts : [];
  const counts = useMemo(() => libraryArtifactCounts(artifacts), [artifacts]);
  const visible = useMemo(
    () => applyLibraryQuery(artifacts, { query, filter, sort }),
    [artifacts, query, filter, sort],
  );
  const activeArtifact = activeId
    ? (artifacts.find((artifact) => artifact.id === activeId) ?? null)
    : null;
  const Item = view === 'grid' ? LibraryCard : LibraryRow;
  const filteredEmpty =
    state.status === 'ready' && artifacts.length > 0 && visible.length === 0;
  const libraryEmpty = state.status === 'ready' && artifacts.length === 0;

  const openArtifact = (artifact: LibraryArtifact, intent: LibraryDialogIntent = 'preview') => {
    setDialogIntent(intent);
    setActiveId(artifact.id);
  };

  const clearFilters = () => {
    setQuery('');
    setFilter('all');
  };

  const cardActions = (artifact: LibraryArtifact) => ({
    onOpen: () => openArtifact(artifact),
    onToggleFavorite: () => toggleFavorite(artifact),
    onRename: () => openArtifact(artifact, 'rename'),
    onSave: () => saveArtifact(artifact),
    onOpenExternal: () => openExternal(artifact),
    onDelete: () => openArtifact(artifact, 'delete'),
  });

  return (
    <section
      ref={viewRef}
      tabIndex={-1}
      aria-label="Biblioteca de arquivos"
      aria-busy={importing || undefined}
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
    >
      <LibraryHeader
        query={query}
        onQueryChange={setQuery}
        sort={sort}
        onSortChange={setSort}
        view={view}
        onViewChange={setView}
        importing={importing}
        onUpload={() => void pickFiles()}
        onBack={() => setActiveView('chat')}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-5">
          <LibraryFilters filter={filter} counts={counts} onChange={setFilter} />

          {state.status === 'loading' ? (
            <div className="flex flex-col gap-3">
              <p
                role="status"
                className="flex items-center gap-2 text-xs text-foreground-muted"
              >
                <Spinner size="sm" />
                Carregando biblioteca…
              </p>
              <ul
                aria-hidden
                className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3"
              >
                {Array.from({ length: 8 }, (_, index) => (
                  <LibraryCardSkeleton key={index} />
                ))}
              </ul>
            </div>
          ) : null}

          {state.status === 'error' ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
              <AlertTriangle aria-hidden className="size-5 text-danger" />
              <p className="text-[13px] font-medium text-foreground">
                Não foi possível carregar a biblioteca
              </p>
              <p className="max-w-md text-xs leading-relaxed text-foreground-muted">
                {state.message}
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Tentar novamente
              </Button>
            </div>
          ) : null}

          {libraryEmpty ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
              <Library aria-hidden className="size-6 text-foreground-subtle" />
              <p className="text-[14px] font-medium text-foreground">
                Sua biblioteca está vazia
              </p>
              <p className="max-w-md text-xs leading-relaxed text-foreground-muted">
                Os arquivos criados pelo agente durante as conversas aparecem aqui. Você também
                pode enviar arquivos próprios para consultá-los no chat.
              </p>
              <Button
                size="sm"
                variant="primary"
                loading={importing}
                leftIcon={<Upload aria-hidden className="size-3.5" />}
                onClick={() => void pickFiles()}
              >
                {importing ? 'Enviando arquivos…' : 'Enviar arquivos'}
              </Button>
            </div>
          ) : null}

          {filteredEmpty ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 text-center">
              <SearchX aria-hidden className="size-6 text-foreground-subtle" />
              <p className="text-[13px] font-medium text-foreground">
                Nenhum artefato encontrado
              </p>
              <p className="max-w-md text-xs leading-relaxed text-foreground-muted">
                Nenhum arquivo corresponde à busca ou ao filtro selecionado.
              </p>
              <Button size="sm" variant="secondary" onClick={clearFilters}>
                Limpar filtros
              </Button>
            </div>
          ) : null}

          {state.status === 'ready' && visible.length > 0 ? (
            <>
              <p className="sr-only" role="status" aria-live="polite">
                {visible.length === artifacts.length
                  ? pluralizeFiles(artifacts.length)
                  : `${visible.length} de ${pluralizeFiles(artifacts.length)}`}
              </p>
              <ul
                aria-label="Arquivos da biblioteca"
                className={cn(
                  view === 'grid'
                    ? 'grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3'
                    : 'flex flex-col gap-2',
                )}
              >
                {visible.map((artifact) => (
                  <Item key={artifact.id} artifact={artifact} {...cardActions(artifact)} />
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>

      {dragActive ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-accent/60 bg-surface-raised px-10 py-8 text-center shadow-lg">
            <Upload aria-hidden className="size-6 text-accent" />
            <p className="text-[13px] font-medium text-foreground">
              Solte para enviar à biblioteca
            </p>
          </div>
        </div>
      ) : null}

      {activeArtifact ? (
        <LibraryPreviewDialog
          key={`${activeArtifact.id}:${dialogIntent}`}
          artifact={activeArtifact}
          siblings={visible}
          intent={dialogIntent}
          onClose={() => setActiveId(null)}
          onNavigate={(artifactId) => {
            setDialogIntent('preview');
            setActiveId(artifactId);
          }}
          onToggleFavorite={toggleFavorite}
          onRename={renameArtifact}
          onSave={saveArtifact}
          onOpenExternal={openExternal}
          onDelete={deleteArtifact}
        />
      ) : null}
    </section>
  );
}

export default LibraryView;
