import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  FileDiff,
  Files,
  GitBranch,
  PanelRightClose,
  type LucideIcon,
} from 'lucide-react';
import { Button, IconButton, Tooltip } from '@/components/ui';
import { PanelResizer } from '@/components/layout/PanelResizer';
import {
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MIN,
  SIDE_PANEL_WIDTH_STEP,
  useUiStore,
  type CodePanelTab,
} from '@/lib/store';
import { resolveSidePanelLayout, useViewportWidth } from '@/lib/sidePanel';
import { cn } from '@/lib/utils';

/** Tabs of the Code right panel (PLAN §3.4). */
const PANEL_TABS: ReadonlyArray<{ id: CodePanelTab; label: string; icon: LucideIcon }> = [
  { id: 'files', label: 'Arquivos', icon: Files },
  { id: 'changes', label: 'Alterações', icon: FileDiff },
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
 * Code right panel (PLAN §3.4): docked Arquivos/Alterações tabs with the
 * workspace/branch bar and an honest harness-empty state. Width shares the
 * persisted right-panel width and the accessible divider of the Chat panels;
 * it is only rendered on windows wide enough for the docked layout, so the
 * conversation always keeps at least 480px.
 */
export function CodePanel() {
  const open = useUiStore((state) => state.codePanelOpen);
  const tab = useUiStore((state) => state.codePanelTab);
  const setTab = useUiStore((state) => state.setCodePanelTab);
  const setOpen = useUiStore((state) => state.setCodePanelOpen);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const sidebarWidth = useUiStore((state) => state.sidebarWidth);
  const persistedWidth = useUiStore((state) => state.sidePanelWidth);
  const setSidePanelWidth = useUiStore((state) => state.setSidePanelWidth);
  const viewportWidth = useViewportWidth();

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

        <Tooltip content="Recolher painel" side="bottom">
          <IconButton label="Recolher painel" size="sm" onClick={() => setOpen(false)}>
            <PanelRightClose className="size-4" />
          </IconButton>
        </Tooltip>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3 text-[12px] text-foreground-muted">
        <GitBranch aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="truncate">Sem workspace</span>
      </div>

      {tab === 'changes' ? (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
          <span className="text-[12px] text-foreground-muted">Sem commit</span>
          <span className="flex items-center gap-1.5 text-[11.5px] tabular-nums">
            <span className="text-success">+0</span>
            <span className="text-danger">−0</span>
          </span>
          <Tooltip content="Disponível com o harness de código" side="bottom">
            {/* Disabled buttons swallow pointer events: the wrapper carries the hint. */}
            <span className="ml-auto inline-flex" title="Disponível com o harness de código">
              <Button size="sm" variant="primary" disabled>
                Commit
              </Button>
            </span>
          </Tooltip>
        </div>
      ) : null}

      <div
        role="tabpanel"
        id={PANEL_BODY_ID}
        aria-labelledby={`code-panel-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {tab === 'changes' ? (
          <PanelEmptyState
            icon={FileDiff}
            title="Nenhuma alteração pendente"
            description="As mudanças do agente aparecerão aqui para revisão e commit."
          />
        ) : (
          <PanelEmptyState
            icon={Files}
            title="Nenhum arquivo para mostrar"
            description="A árvore do workspace aparece aqui quando o harness estiver ativo."
          />
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
