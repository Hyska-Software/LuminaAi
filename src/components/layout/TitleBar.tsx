import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, PanelLeft, Search, Square, X } from 'lucide-react';
import { ModelPill } from '@/components/models/ModelPill';
import { IconButton, Kbd, Tooltip } from '@/components/ui';
import { useUiStore } from '@/lib/store';
import { cn, modKey } from '@/lib/utils';
import { BrandMark } from '@/components/chat/BrandMark';

/** Resolves the Tauri window lazily so the renderer also boots outside Tauri. */
function appWindow(): ReturnType<typeof getCurrentWindow> | null {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

const CONTROL_BASE =
  'no-drag flex h-8 w-10 items-center justify-center rounded-md text-foreground-muted ' +
  'transition-colors duration-150 hover:bg-surface-hover hover:text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/**
 * Frameless window chrome (DESIGN §5): drag region, brand, command search,
 * active model and native window controls.
 */
export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const setModelPickerOpen = useUiStore((state) => state.setModelPickerOpen);

  useEffect(() => {
    const win = appWindow();
    if (!win) return;
    let alive = true;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const maximized = await win.isMaximized();
        if (alive) setIsMaximized(maximized);
        unlisten = await win.onResized(() => {
          void win
            .isMaximized()
            .then((value) => {
              if (alive) setIsMaximized(value);
            })
            .catch(() => undefined);
        });
      } catch {
        /* window API unavailable (e.g. plain browser preview) */
      }
    })();

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const handleMinimize = useCallback(() => {
    void appWindow()?.minimize().catch(() => undefined);
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    const win = appWindow();
    if (!win) return;
    try {
      const maximized = await win.isMaximized();
      if (maximized) {
        await win.unmaximize();
        setIsMaximized(false);
      } else {
        await win.maximize();
        setIsMaximized(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const handleClose = useCallback(() => {
    void appWindow()?.close().catch(() => undefined);
  }, []);

  const handleDragDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('button, a, input, [role="button"]')) return;
      void handleToggleMaximize();
    },
    [handleToggleMaximize],
  );

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={handleDragDoubleClick}
      className={cn(
        'drag-region relative z-30 flex h-14 shrink-0 select-none items-center gap-2',
        'border-b border-border bg-surface pl-2 pr-1',
      )}
    >
      <Tooltip
        content={
          <span className="flex items-center gap-1.5">
            Alternar barra lateral
            <Kbd>{modKey}</Kbd>
            <Kbd>B</Kbd>
          </span>
        }
        side="bottom"
      >
        <IconButton label="Alternar barra lateral" size="sm" variant="ghost" onClick={toggleSidebar} className="no-drag">
          <PanelLeft className="size-4" />
        </IconButton>
      </Tooltip>

      <div data-tauri-drag-region className="flex items-center gap-2 pl-1 pr-1">
        <BrandMark size={22} />
        <span className="text-[14px] font-semibold tracking-tight text-foreground">Lumina</span>
      </div>

      <div data-tauri-drag-region className="h-full min-w-0 flex-1" />

      <div className="no-drag flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          aria-label="Buscar conversas e comandos"
          className={cn(
            'flex h-8 items-center gap-2 rounded-lg border border-border bg-background px-2.5',
            'text-[13px] text-foreground-subtle transition-colors duration-150',
            'hover:border-border-strong hover:bg-surface-hover hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          )}
        >
          <Search className="size-3.5" />
          <span className="hidden sm:inline">Buscar</span>
          <span className="hidden items-center gap-0.5 sm:flex">
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>

        <ModelPill onClick={() => setModelPickerOpen(true)} />
      </div>

      <div className="no-drag ml-1 flex items-center gap-0.5">
        <button type="button" aria-label="Minimizar" onClick={handleMinimize} className={CONTROL_BASE}>
          <Minus className="size-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label={isMaximized ? 'Restaurar' : 'Maximizar'}
          onClick={() => void handleToggleMaximize()}
          className={CONTROL_BASE}
        >
          {isMaximized ? <Copy className="size-3.5" strokeWidth={2} /> : <Square className="size-3.5" strokeWidth={2} />}
        </button>
        <button
          type="button"
          aria-label="Fechar"
          onClick={handleClose}
          className={cn(CONTROL_BASE, 'hover:bg-danger hover:text-background')}
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      </div>
    </header>
  );
}
