import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useUiStore } from '@/lib/store';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import { useIsCompact, useReduceMotion } from './hooks';

const SIDEBAR_WIDTH = 272;
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
 */
export function AppShell({ children, overlays }: AppShellProps) {
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const isCompact = useIsCompact();
  const reduceMotion = useReduceMotion();

  /* A persisted "open" sidebar must not cover the chat on small windows. */
  useEffect(() => {
    if (isCompact) setSidebarOpen(false);
  }, [isCompact, setSidebarOpen]);

  /* Sidebar keyboard toggle (⌘/Ctrl+B) lives in App.tsx's global shortcuts. */

  /* Escape closes the compact drawer. */
  useEffect(() => {
    if (!isCompact) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && useUiStore.getState().sidebarOpen) setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCompact, setSidebarOpen]);

  const transition = { duration: reduceMotion ? 0 : 0.22, ease: EASE_OUT_SOFT };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <TitleBar />

        <div className="flex min-h-0 flex-1">
          {!isCompact ? (
            <motion.div
              initial={false}
              animate={{ width: sidebarOpen ? SIDEBAR_WIDTH : 0 }}
              transition={transition}
              className="relative z-20 shrink-0 overflow-hidden"
            >
              <div className="h-full w-[272px]" inert={!sidebarOpen}>
                <Sidebar />
              </div>
            </motion.div>
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
                  initial={{ x: reduceMotion ? 0 : -SIDEBAR_WIDTH }}
                  animate={{ x: 0 }}
                  exit={{ x: reduceMotion ? 0 : -SIDEBAR_WIDTH }}
                  transition={transition}
                  className="fixed inset-y-0 left-0 z-50 shadow-2xl"
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
