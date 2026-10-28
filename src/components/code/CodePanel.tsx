import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  FileDiff,
  Files,
  FolderOpen,
  GitBranch,
  History,
  PanelRightClose,
  RefreshCw,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import { Button, IconButton, Spinner, Tooltip } from '@/components/ui';
import { PanelResizer } from '@/components/layout/PanelResizer';
import { api } from '@/lib/api';
import {
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MIN,
  SIDE_PANEL_WIDTH_STEP,
  useAppStore,
  useChatStore,
  useCodeStore,
  useUiStore,
  type CodePanelTab,
} from '@/lib/store';
import { resolveSidePanelLayout, useViewportWidth } from '@/lib/sidePanel';
import type { FileChange, WorkspaceFileContent, WorkspaceFileEntry } from '@/lib/types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ChangesPanel } from './ChangesPanel';
import { FilePreview } from './FilePreview';
import { FileTree } from './FileTree';
import { TerminalPanel } from './TerminalPanel';
import { useWorkspacePanel } from './useWorkspacePanel';
import { useWorkspaces } from './useWorkspaces';

/** Tabs of the Code right panel (WORKBENCH §7). */
const PANEL_TABS: ReadonlyArray<{ id: CodePanelTab; label: string; icon: LucideIcon }> = [
  { id: 'files', label: 'Arquivos', icon: Files },
  { id: 'changes', label: 'Alterações', icon: FileDiff },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
];

/** Single content region controlled by both tabs (only the active one renders). */
const PANEL_BODY_ID = 'code-panel-body';

/**
 * Mescla os filhos carregados sob demanda (lazy) na árvore do backend.
 *
 * A recursão precisa descer **sempre**, mesmo quando o diretório atual não tem
 * cache próprio: no caso real (apps > desktop > public) o cache existe num
 * neto ('apps/desktop/public'); retornar cedo no primeiro nível sem cache
 * descartava esse carregamento e o clique parecia não fazer nada.
 */
function withLazyChildren(
  entries: WorkspaceFileEntry[],
  cache: Record<string, WorkspaceFileEntry[]>,
): WorkspaceFileEntry[] {
  return entries.map((entry) => {
    if (!entry.isDir) return entry;
    const source = cache[entry.path] ?? entry.children ?? [];
    return { ...entry, children: withLazyChildren(source, cache) };
  });
}

/** Procura um nó da árvore pelo path (para saber se os filhos já estão carregados). */
function findTreeEntry(
  entries: WorkspaceFileEntry[],
  path: string,
): WorkspaceFileEntry | null {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    if (entry.children?.length) {
      const found = findTreeEntry(entry.children, path);
      if (found) return found;
    }
  }
  return null;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

function PanelEmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface-hover text-foreground-muted">
        <Icon aria-hidden className="size-5" strokeWidth={1.75} />
      </span>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="max-w-64 text-[12px] leading-relaxed text-foreground-muted">{description}</p>
    </div>
  );
}

/**
 * Code right panel: real Arquivos/Alterações tabs for the active session's
 * workspace (`WORKBENCH.md` §7). Width shares the persisted right-panel width
 * and the accessible divider of the Chat panels; it is only rendered on
 * windows wide enough for the docked layout, so the conversation always keeps
 * at least 480px.
 */
export function CodePanel() {
  const open = useUiStore((state) => state.codePanelOpen);
  const tab = useUiStore((state) => state.codePanelTab);
  const setTab = useUiStore((state) => state.setCodePanelTab);
  const setOpen = useUiStore((state) => state.setCodePanelOpen);
  const openCodeDiff = useUiStore((state) => state.openCodeDiff);
  const openCodeCommits = useUiStore((state) => state.openCodeCommits);
  // Padrão de fábrica: diff abre como aba do chat; pode ser trocado em
  // Configurações → Ferramentas (Settings.diffOpenMode).
  const diffOpenMode = useAppStore((state) => state.settings.diffOpenMode ?? 'tab');
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const sidebarWidth = useUiStore((state) => state.sidebarWidth);
  const persistedWidth = useUiStore((state) => state.sidePanelWidth);
  const setSidePanelWidth = useUiStore((state) => state.setSidePanelWidth);
  const viewportWidth = useViewportWidth();

  const activeId = useChatStore((state) => state.activeId);
  const conversation = useChatStore((state) =>
    state.conversations.find((entry) => entry.id === state.activeId),
  );
  const workspaceId = conversation?.workspaceId ?? null;
  const panel = useWorkspacePanel(workspaceId);
  const { workspaces } = useWorkspaces();
  const workspace = workspaces.find((entry) => entry.id === workspaceId) ?? null;
  const sessionChangeFiles = useCodeStore((state) =>
    activeId ? (state.byConversation[activeId]?.changes?.files ?? null) : null,
  );
  const refreshSession = useCodeStore((state) => state.refresh);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<WorkspaceFileContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  /** Width previewed while dragging; `null` means "use the persisted width". */
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const tabRefs = useRef(new Map<CodePanelTab, HTMLButtonElement>());
  /* Expansão sob demanda: o backend lista a árvore até 2 níveis; diretórios
     mais profundos carregam os filhos quando o usuário abre. */
  const [lazyChildren, setLazyChildren] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [lazyLoading, setLazyLoading] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setLazyChildren({});
    setLazyLoading(new Set());
  }, [workspaceId]);

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!workspaceId) return;
      setLazyLoading((current) => new Set(current).add(path));
      try {
        const entries = await api.listWorkspaceFiles(workspaceId, path, 2);
        setLazyChildren((current) => ({ ...current, [path]: entries ?? [] }));
      } catch (error) {
        toast.error('Não foi possível abrir a pasta', { description: String(error) });
      } finally {
        setLazyLoading((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [workspaceId],
  );

  const treeEntries = useMemo(
    () => withLazyChildren(panel.files, lazyChildren),
    [panel.files, lazyChildren],
  );

  const layout = useMemo(
    () =>
      resolveSidePanelLayout({
        mode: 'docked',
        viewportWidth,
        sidebarOpen,
        sidebarWidth,
        width: persistedWidth,
        previewWidth,
      }),
    [viewportWidth, sidebarOpen, sidebarWidth, persistedWidth, previewWidth],
  );

  const selectFile = useCallback(
    async (path: string) => {
      setSelectedPath(path);
      if (!workspaceId) return;
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const content = await api.readWorkspaceFile(workspaceId, path);
        setPreview(content);
      } catch (error) {
        setPreview(null);
        setPreviewError(String(error));
      } finally {
        setPreviewLoading(false);
      }
    },
    [workspaceId],
  );

  const refreshAll = useCallback(() => {
    // Recarrega a raiz e descarta os filhos carregados sob demanda (podem ter
    // mudado no disco).
    setLazyChildren({});
    setLazyLoading(new Set());
    void panel.refresh();
    if (activeId) void refreshSession(activeId);
  }, [panel, activeId, refreshSession]);

  const sessionChanges: FileChange[] | null = useMemo(() => {
    if (!sessionChangeFiles || sessionChangeFiles.length === 0) return null;
    return sessionChangeFiles.map((file) => ({
      path: file.path,
      kind: file.kind,
      added: file.added ?? 0,
      removed: file.removed ?? 0,
      diff: null,
    }));
  }, [sessionChangeFiles]);

  /* All hooks above run unconditionally; visibility is decided afterwards. */
  if (!open || !layout.canDock) return null;

  const clampWidth = (next: number) =>
    Math.min(layout.maxWidth, Math.max(SIDE_PANEL_WIDTH_MIN, Math.round(next)));

  const handleResize = (next: number) => setPreviewWidth(clampWidth(next));

  const handleResizeEnd = (next: number) => {
    setSidePanelWidth(clampWidth(next));
    setPreviewWidth(null);
  };

  const handleReset = () => {
    setSidePanelWidth(SIDE_PANEL_WIDTH_DEFAULT);
    setPreviewWidth(null);
  };

  const selectTab = (next: CodePanelTab) => {
    setTab(next);
    tabRefs.current.get(next)?.focus();
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: CodePanelTab) => {
    const index = PANEL_TABS.findIndex((entry) => entry.id === current);
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (index + 1) % PANEL_TABS.length;
        break;
      case 'ArrowLeft':
        nextIndex = (index - 1 + PANEL_TABS.length) % PANEL_TABS.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = PANEL_TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = PANEL_TABS[nextIndex];
    if (next) selectTab(next.id);
  };

  const branch = panel.gitStatus?.branch ?? workspace?.git?.branch ?? null;

  return (
    <aside
      aria-label="Painel de arquivos e alterações"
      style={{ width: layout.width }}
      className="relative z-10 flex h-full shrink-0 flex-col border-l border-border bg-surface-raised"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <div
          role="tablist"
          aria-label="Conteúdo do painel"
          className="flex min-w-0 flex-1 items-center gap-0.5"
        >
          {PANEL_TABS.map((entry) => {
            const selected = tab === entry.id;
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`code-panel-tab-${entry.id}`}
                aria-selected={selected}
                aria-controls={PANEL_BODY_ID}
                tabIndex={selected ? 0 : -1}
                ref={(node) => {
                  if (node) tabRefs.current.set(entry.id, node);
                  else tabRefs.current.delete(entry.id);
                }}
                onClick={() => setTab(entry.id)}
                onKeyDown={(event) => handleTabKeyDown(event, entry.id)}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium',
                  'transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  selected
                    ? 'bg-surface-hover text-foreground'
                    : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                )}
              >
                <Icon aria-hidden className="size-3.5" strokeWidth={1.75} />
                {entry.label}
              </button>
            );
          })}
        </div>

        <Tooltip content="Atualizar" side="bottom">
          <IconButton label="Atualizar painel" size="sm" onClick={refreshAll}>
            <RefreshCw aria-hidden className="size-3.5" />
          </IconButton>
        </Tooltip>
        <Tooltip content="Recolher painel" side="bottom">
          <IconButton label="Recolher painel" size="sm" onClick={() => setOpen(false)}>
            <PanelRightClose className="size-4" />
          </IconButton>
        </Tooltip>
      </div>

      <div
        role="tabpanel"
        id={PANEL_BODY_ID}
        aria-labelledby={`code-panel-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {tab === 'changes' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Workspace + branch só na aba Alterações (as abas Arquivos/Terminal
                já têm o próprio contexto no cabeçalho/título). */}
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3 text-[12px] text-foreground-muted">
              <GitBranch aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span className="truncate">
                {workspace ? workspace.name : 'Sem workspace'}
                {branch ? ` · ${branch}` : ''}
              </span>
              {workspaceId && panel.gitStatus?.isRepo ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 shrink-0 px-2 text-[11px]"
                  leftIcon={<History className="size-3.5" strokeWidth={1.75} />}
                  onClick={() => openCodeCommits(workspaceId)}
                  aria-label="Ver histórico de commits"
                >
                  Histórico
                </Button>
              ) : null}
              {panel.gitStatus?.isRepo ? (
                <span className={cn('shrink-0 text-[11px] tabular-nums', !workspaceId && 'ml-auto')}>
                  {panel.gitStatus.ahead ? `↑${panel.gitStatus.ahead}` : ''}
                  {panel.gitStatus.behind ? ` ↓${panel.gitStatus.behind}` : ''}
                </span>
              ) : null}
            </div>
            {workspaceId ? (
              <ChangesPanel
                workspaceId={workspaceId}
                conversationId={activeId}
                gitStatus={panel.gitStatus}
                gitLoading={panel.gitLoading}
                gitError={panel.gitError}
                sessionChanges={sessionChanges}
                sessionLoading={false}
                sessionError={null}
                onRefresh={refreshAll}
                onOpenDiffTab={
                  diffOpenMode === 'panel'
                    ? null
                    : (row) => {
                        if (!workspaceId) return;
                        openCodeDiff({
                          workspaceId,
                          path: row.path,
                          staged: row.staged,
                          knownDiff: row.knownDiff ?? null,
                        });
                      }
                }
                className="min-h-0 flex-1"
              />
            ) : (
              <PanelEmptyState
                icon={FolderOpen}
                title="Nenhum workspace aberto"
                description="Abra uma pasta na barra lateral para o agente ler, editar e rodar comandos aqui."
              />
            )}
          </div>
        ) : !workspaceId ? (
          <PanelEmptyState
            icon={FolderOpen}
            title="Nenhum workspace aberto"
            description="Abra uma pasta na barra lateral para o agente ler, editar e rodar comandos aqui."
          />
        ) : tab === 'terminal' ? (
          activeId ? (
            <TerminalPanel conversationId={activeId} className="min-h-0 flex-1" />
          ) : (
            <PanelEmptyState
              icon={SquareTerminal}
              title="Nenhuma sessão ativa"
              description="Abra uma sessão para usar o terminal no diretório do workspace."
            />
          )
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className={cn('min-h-0 overflow-y-auto', selectedPath ? 'flex-[1.1]' : 'flex-1')}>
              <FileTree
                entries={treeEntries}
                loading={panel.filesLoading}
                error={panel.filesError}
                selectedPath={selectedPath ?? undefined}
                totalCount={panel.files.length}
                loadingPaths={lazyLoading}
                onSelectFile={(path) => {
                  void selectFile(path);
                }}
                onToggleDir={(path) => {
                  // Só busca quando o diretório ainda não tem filhos carregados;
                  // abrir/colapsar diretórios já carregados é só estado local.
                  if (lazyChildren[path] !== undefined) return;
                  const node = findTreeEntry(treeEntries, path);
                  if (!node || node.children?.length) return;
                  void loadDirectory(path);
                }}
              />
            </div>
            {selectedPath ? (
              <div className="min-h-0 flex-1 border-t border-border">
                <FilePreview
                  content={preview}
                  loading={previewLoading}
                  error={previewError}
                  onOpenExternal={() => {
                    if (workspaceId) void api.openWorkspaceInExplorer(workspaceId);
                  }}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <PanelResizer
        side="end"
        value={layout.width}
        min={SIDE_PANEL_WIDTH_MIN}
        max={layout.maxWidth}
        step={SIDE_PANEL_WIDTH_STEP}
        label="Redimensionar painel de arquivos"
        className="absolute inset-y-0 -left-2 z-10"
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
        onReset={handleReset}
      />
    </aside>
  );
}

export default CodePanel;
