import { useEffect, useLayoutEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen } from '@tauri-apps/api/event';
import { AppShell } from '@/components/layout/AppShell';
import { WorkspaceCenter } from '@/components/layout/WorkspaceCenter';
import { AgentSidebar } from '@/components/agents/AgentSidebar';
import { CodePanel, CodeSidebar } from '@/components/code';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { ModelPickerDialog } from '@/components/models/ModelPickerDialog';
import { ArtifactPanel } from '@/components/artifacts/ArtifactPanel';
import { SourcesPanel } from '@/components/chat/SourcesPanel';
import { CommandPalette } from '@/components/palette/CommandPalette';
import { TooltipProvider } from '@/components/ui';
import { useAgentStore, useAppStore, useChatStore, useUiStore } from '@/lib/store';
import { SIDE_PANEL_DOCK_MIN_VIEWPORT, useViewportWidth } from '@/lib/sidePanel';
import { resolveHotkey, type HotkeyCommand } from '@/lib/hotkeys';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SplashScreen } from '@/components/SplashScreen';
import type { AgentRoutineRunEvent, AgentTaskUpdatedEvent } from '@/lib/types';
import { useUpdateCheck } from '@/components/layout/useUpdateCheck';

/** Ensures bootstrap runs once even under React StrictMode double-effects. */
let bootstrapPromise: Promise<void> | null = null;

function bootstrap(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    const ui = useUiStore.getState();
    ui.applyTheme();
    await useAppStore.getState().init();
    const settings = useAppStore.getState().settings;
    if (settings.theme !== useUiStore.getState().theme) {
      useUiStore.getState().setTheme(settings.theme);
    }
    applyFontScale(settings.fontScale);
    await useChatStore.getState().init();
    await useAgentStore.getState().initialize();
    // Persisted agent FIFOs resume when the app opens straight into Agentes.
    if (useUiStore.getState().layoutMode === 'agent') {
      await useChatStore.getState().drainAgentQueues();
    }
  })();
  return bootstrapPromise;
}

function applyFontScale(scale: number) {
  const safe = Number.isFinite(scale) ? Math.min(1.3, Math.max(0.85, scale)) : 1;
  document.documentElement.style.fontSize = `${(16 * safe).toFixed(2)}px`;
}

/** Runs the command resolved by `lib/hotkeys`. */
function runHotkey(command: HotkeyCommand, event: KeyboardEvent): void {
  const ui = useUiStore.getState();
  const chat = useChatStore.getState();
  event.preventDefault();
  switch (command) {
    case 'toggle-command-palette':
      ui.setCommandPaletteOpen(!ui.commandPaletteOpen);
      break;
    case 'toggle-sidebar':
      ui.toggleSidebar();
      break;
    case 'new-conversation':
      if (ui.layoutMode === 'agent') {
        const agentId = ui.activeAgentId;
        if (agentId) void chat.startNewConversation('agent', { agentId });
      } else {
        void chat.startNewConversation();
      }
      break;
    case 'open-settings':
      ui.openSettings();
      break;
    case 'close-overlays':
      ui.closeAllOverlays();
      ui.closeArtifactPanel();
      ui.closeSourcesPanel();
      break;
    case 'return-to-chat':
      // In the Code layout, Escape/“return” only leaves the Skills page; the
      // Chat layout is a separate surface the user switches explicitly.
      if (ui.layoutMode === 'code' && ui.codeView === 'skills') {
        ui.setCodeView('session');
        break;
      }
      if (ui.layoutMode === 'agent') {
        if (chat.activeId) {
          chat.clearActiveConversation();
        } else {
          ui.setActiveAgentId(null);
        }
        break;
      }
      ui.setLayoutMode('chat');
      ui.setActiveView('chat');
      ui.setCodeView('session');
      break;
    case 'stop-streaming':
      void chat.stop();
      break;
    case 'focus-composer':
      window.dispatchEvent(new CustomEvent('lumina:focus-composer'));
      break;
    default:
      break;
  }
}

export default function App() {
  const ready = useAppStore((state) => state.ready);
  const initializing = useAppStore((state) => state.initializing);
  const error = useAppStore((state) => state.error);
  const theme = useUiStore((state) => state.theme);
  const layoutMode = useUiStore((state) => state.layoutMode);
  const codePanelOpen = useUiStore((state) => state.codePanelOpen);
  const artifactPanelOpen = useUiStore((state) => state.artifactPanelOpen);
  const sourcesPanelOpen = useUiStore((state) => state.sourcesPanelOpen);
  const activeConversation = useChatStore((state) => {
    const id = state.activeId;
    return id ? state.conversations.find((conversation) => conversation.id === id) : undefined;
  });
  const agentWorkspaceSession =
    layoutMode === 'agent' &&
    activeConversation?.mode === 'agent' &&
    Boolean(activeConversation.workspaceId);
  const viewportWidth = useViewportWidth();
  const settingsTheme = useAppStore((state) => state.settings.theme);
  const fontScale = useAppStore((state) => state.settings.fontScale);
  const reduceMotion = useAppStore((state) => state.settings.reduceMotion);
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void bootstrap();
  }, []);

  // Keep the backend settings in sync with theme changes coming from the UI.
  useEffect(() => {
    if (!ready) return;
    if (theme !== settingsTheme) {
      void useAppStore.getState().saveSettings({ theme });
    }
  }, [ready, theme, settingsTheme]);

  // Follow the OS theme while "system" is selected.
  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => useUiStore.getState().applyTheme();
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [theme]);

  useEffect(() => {
    applyFontScale(fontScale);
  }, [fontScale]);

  // Automatic update checks (hydrate the cached release immediately, check
  // once the bootstrap is done and then once per day while the app is open).
  useUpdateCheck(ready);

  // Routine runs happen in the Rust scheduler, outside the renderer. Refresh
  // the conversation list and surface the outcome without stealing the active
  // thread.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<AgentRoutineRunEvent>('lumina:agent-routine-run', (event) => {
      if (disposed) return;
      const run = event.payload;
      if (run.status === 'ok') {
        toast.success(`Rotina concluída: ${run.title}`, {
          description: 'O resultado está na conversa da rotina.',
        });
      } else if (run.status === 'error' || run.status === 'blocked') {
        toast.error(`Rotina falhou: ${run.title}`, {
          description: run.error ?? undefined,
        });
      }
      window.dispatchEvent(new CustomEvent('lumina:agent-routine-run', { detail: run }));
      void useChatStore.getState().refreshConversations();
      void useAgentStore.getState().refresh();
      if (run.conversationId && useChatStore.getState().activeId === run.conversationId) {
        void useChatStore.getState().openConversation(run.conversationId);
      }
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* event bridge unavailable outside Tauri */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Delegated tasks run in Rust. Refresh the task board/listeners without
  // stealing the active thread; task detail opens on demand.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<AgentTaskUpdatedEvent>('lumina:agent-task-updated', (event) => {
      if (disposed) return;
      window.dispatchEvent(
        new CustomEvent('lumina:agent-task-updated', { detail: event.payload }),
      );
      void useChatStore.getState().refreshConversations();
      void useAgentStore.getState().refresh();
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* event bridge unavailable outside Tauri */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Chat and Code have separate session lists; switching layouts restores each
  // layout's own active session instead of leaking the other one.
  useLayoutEffect(() => {
    if (!ready) return;
    void useChatStore.getState().enterLayout(layoutMode);
  }, [layoutMode, ready]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);

  useEffect(() => {
    if (!error) return;
    toast.error('Algo deu errado', { description: error });
    useAppStore.getState().setError(null);
  }, [error]);

  // Global keyboard shortcuts. The decision itself is pure (lib/hotkeys), so
  // precedence (palette ownership, Esc cascade, editable targets) is unit-tested.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ui = useUiStore.getState();
      const command = resolveHotkey(event, {
        commandPaletteOpen: ui.commandPaletteOpen,
        modelPickerOpen: ui.modelPickerOpen,
        settingsOpen: ui.settingsOpen,
        artifactPanelOpen: ui.artifactPanelOpen,
        sourcesPanelOpen: ui.sourcesPanelOpen,
        // The Chat views only own Escape while the Chat layout is active; in
        // the Code layout a stale `activeView` must not hijack Esc (the Code
        // Skills page has its own `codeSkillsView` flag).
        skillsView: ui.layoutMode === 'chat' && ui.activeView === 'skills',
        libraryView: ui.layoutMode === 'chat' && ui.activeView === 'library',
        codeSkillsView: ui.layoutMode === 'code' && ui.codeView === 'skills',
        streaming: useChatStore.getState().streaming !== null,
      });
      if (command) runHotkey(command, event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Native file drag & drop -> attachments (chat) or library upload.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const dispatchLibraryDrag = (active: boolean) => {
      window.dispatchEvent(new CustomEvent('lumina:library-drag', { detail: { active } }));
    };
    try {
      const webview = getCurrentWebview();
      void webview
        .onDragDropEvent((event) => {
          if (disposed) return;
          // The Biblioteca page replaces the chat column: a drop there imports
          // files into the user library instead of attaching them to the
          // composer (library-page PLAN §2.6). The view owns the import. It only
          // exists in the Chat layout (docs/goals/chat-code-layout/PLAN §3.5).
          const uiState = useUiStore.getState();
          if (uiState.layoutMode === 'chat' && uiState.activeView === 'library') {
            if (event.payload.type === 'drop') {
              dispatchLibraryDrag(false);
              const paths = event.payload.paths ?? [];
              if (paths.length) {
                window.dispatchEvent(
                  new CustomEvent('lumina:library-drop', { detail: { paths } }),
                );
              }
            } else if (event.payload.type === 'enter' || event.payload.type === 'over') {
              dispatchLibraryDrag(true);
            } else if (event.payload.type === 'leave') {
              dispatchLibraryDrag(false);
            }
            return;
          }
          if (event.payload.type === 'drop') {
            const paths = event.payload.paths ?? [];
            if (paths.length) {
              void useChatStore.getState().addAttachments(paths);
            }
          }
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => {
          /* drag & drop unsupported outside Tauri */
        });
    } catch {
      /* ignore */
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!ready && initializing) {
    return <SplashScreen />;
  }

  return (
    <TooltipProvider delayDuration={280}>
      <ErrorBoundary>
        <AppShell
          sidebar={
            layoutMode === 'code' ? (
              (context) => <CodeSidebar {...context} />
            ) : layoutMode === 'agent' ? (
              (context) => <AgentSidebar {...context} />
            ) : undefined
          }
          sidebarLabel={
            layoutMode === 'code' ? 'Sessões' : layoutMode === 'agent' ? 'Agentes' : 'Conversas'
          }
          rightPanel={
            layoutMode === 'code' ? (
              <CodePanel />
            ) : agentWorkspaceSession && !artifactPanelOpen && !sourcesPanelOpen ? (
              <CodePanel />
            ) : (
              <>
                <ArtifactPanel />
                <SourcesPanel />
              </>
            )
          }
          // The Code panel only docks from this width up (see CodePanel); the
          // chat mirrors that with its top-right corner.
          rightPanelOpen={
            (layoutMode === 'code' ||
              (agentWorkspaceSession && !artifactPanelOpen && !sourcesPanelOpen)) &&
            codePanelOpen &&
            viewportWidth >= SIDE_PANEL_DOCK_MIN_VIEWPORT
          }
        >
          <WorkspaceCenter />
        </AppShell>
        <SettingsDialog />
        <ModelPickerDialog />
        <CommandPalette />
      </ErrorBoundary>
      <Toaster
        position="bottom-right"
        theme="system"
        closeButton
        toastOptions={{
          classNames: {
            toast:
              'rounded-xl border border-border bg-surface-raised text-foreground shadow-lg text-[13px]',
            description: 'text-foreground-muted',
          },
        }}
      />
    </TooltipProvider>
  );
}
