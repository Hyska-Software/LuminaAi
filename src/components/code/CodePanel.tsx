import { useCallback, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  FileDiff,
  Files,
  FolderOpen,
  GitBranch,
  PanelRightClose,
  RefreshCw,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import { IconButton, Spinner, Tooltip } from '@/components/ui';
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
import type { FileChange, WorkspaceFileContent } from '@/lib/types';
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
              {panel.gitStatus?.isRepo ? (
                <span className="ml-auto shrink-0 text-[11px] tabular-nums">
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
                entries={panel.files}
                loading={panel.filesLoading}
                error={panel.filesError}
                selectedPath={selectedPath ?? undefined}
                totalCount={panel.files.length}
                onSelectFile={(path) => {
                  void selectFile(path);
                }}
                onToggleDir={() => {
                  /* Árvore já vem expandida por profundidade; recarregar é feito pelo refresh. */
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
