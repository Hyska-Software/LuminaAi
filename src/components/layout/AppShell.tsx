import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { clampSidebarWidth, SIDEBAR_WIDTH_DEFAULT, useUiStore } from '@/lib/store';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import { SidebarResizer } from './SidebarResizer';
import { useIsCompact, useReduceMotion } from './hooks';

const EASE_OUT_SOFT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export interface AppShellProps {
  children: ReactNode;
  /**
   * Optional slot for global overlays (dialogs, command palette, artifact
   * panel) rendered by `App.tsx` above the shell content.
   */
  overlays?: ReactNode;
}

/**
 * Application frame (DESIGN §5): custom title bar, sidebar (inline on desktop,
 * drawer below 1024px) and the main content column.
 *
 * The desktop sidebar is resizable: `liveWidth` keeps the drag preview local
 * (no persistence on every pointer move) while the committed value lives in
 * `useUiStore` with the rest of the persisted UI state.
 */
export function AppShell({ children, overlays }: AppShellProps) {
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const sidebarWidth = useUiStore((state) => state.sidebarWidth);
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth);
  const isCompact = useIsCompact();
  const reduceMotion = useReduceMotion();

  /** Width previewed while dragging; `null` means "use the persisted width". */
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const width = clampSidebarWidth(liveWidth ?? sidebarWidth);
  const drawerWidth = clampSidebarWidth(sidebarWidth);

  /* A persisted "open" sidebar must not cover the chat on small windows. */
  useEffect(() => {
    if (isCompact) setSidebarOpen(false);
  }, [isCompact, setSidebarOpen]);

  /* Sidebar keyboard toggle (⌘/Ctrl+B) lives in App.tsx's global shortcuts. */

  /* A drag interrupted by a layout switch/sidebar collapse never receives its
     release: drop the stale preview so the persisted width takes over. */
  useEffect(() => {
    if (!sidebarOpen || isCompact) setLiveWidth(null);
  }, [sidebarOpen, isCompact]);

  /* Escape closes the compact drawer. */
  useEffect(() => {
    if (!isCompact) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && useUiStore.getState().sidebarOpen) setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCompact, setSidebarOpen]);

  const handleResize = useCallback((next: number) => {
    setLiveWidth(clampSidebarWidth(next));
  }, []);

  const handleResizeEnd = useCallback(
    (next: number) => {
      // The store clamps as well; the local preview disappears in the same commit.
      setSidebarWidth(next);
      setLiveWidth(null);
    },
    [setSidebarWidth],
  );

  const handleReset = useCallback(() => {
    setSidebarWidth(SIDEBAR_WIDTH_DEFAULT);
    setLiveWidth(null);
  }, [setSidebarWidth]);

  /* Width stays transition-free while dragging (DESIGN §11); the collapse and
     the compact drawer keep the regular 220ms ease-out-soft. */
  const sidebarTransition =
    liveWidth !== null
      ? { duration: 0, ease: EASE_OUT_SOFT }
      : { duration: reduceMotion ? 0 : 0.22, ease: EASE_OUT_SOFT };
  const transition = { duration: reduceMotion ? 0 : 0.22, ease: EASE_OUT_SOFT };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <TitleBar />

        <div className="relative flex min-h-0 flex-1">
          {!isCompact ? (
            <motion.div
              initial={false}
              animate={{ width: sidebarOpen ? width : 0 }}
              transition={sidebarTransition}
              className="relative z-20 shrink-0 overflow-hidden"
            >
              <div className="h-full" style={{ width }} inert={!sidebarOpen}>
                <Sidebar />
              </div>
            </motion.div>
          ) : null}

          {/* Absolutely positioned after the sidebar edge: no layout width and no
              overlap with the conversation list scrollbar. */}
          {!isCompact && sidebarOpen ? (
            <div className="absolute inset-y-0 z-30" style={{ left: width }}>
              <SidebarResizer
                width={width}
                onResize={handleResize}
                onResizeEnd={handleResizeEnd}
                onReset={handleReset}
              />
            </div>
          ) : null}

          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
        </div>

        <AnimatePresence>
          {isCompact && sidebarOpen
            ? [
                <motion.div
                  key="sidebar-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.18 }}
                  onClick={() => setSidebarOpen(false)}
                  aria-hidden
                  className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
                />,
                <motion.div
                  key="sidebar-drawer"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Conversas"
                  initial={{ x: reduceMotion ? 0 : -drawerWidth }}
                  animate={{ x: 0 }}
                  exit={{ x: reduceMotion ? 0 : -drawerWidth }}
                  transition={transition}
                  style={{ width: drawerWidth }}
                  className="fixed inset-y-0 left-0 z-50 max-w-[calc(100vw-3rem)] shadow-2xl"
                >
                  <Sidebar onClose={() => setSidebarOpen(false)} />
                </motion.div>,
              ]
            : null}
        </AnimatePresence>

        {overlays}
    </div>
  );
}
