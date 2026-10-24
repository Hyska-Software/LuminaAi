import { useEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { AppShell } from '@/components/layout/AppShell';
import { ChatView } from '@/components/chat/ChatView';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { ModelPickerDialog } from '@/components/models/ModelPickerDialog';
import { ArtifactPanel } from '@/components/artifacts/ArtifactPanel';
import { CommandPalette } from '@/components/palette/CommandPalette';
import { TooltipProvider } from '@/components/ui';
import { useAppStore, useChatStore, useUiStore } from '@/lib/store';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SplashScreen } from '@/components/SplashScreen';

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
  })();
  return bootstrapPromise;
}

function applyFontScale(scale: number) {
  const safe = Number.isFinite(scale) ? Math.min(1.3, Math.max(0.85, scale)) : 1;
  document.documentElement.style.fontSize = `${(16 * safe).toFixed(2)}px`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null
  );
}

export default function App() {
  const ready = useAppStore((state) => state.ready);
  const initializing = useAppStore((state) => state.initializing);
  const error = useAppStore((state) => state.error);
  const theme = useUiStore((state) => state.theme);
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

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);

  useEffect(() => {
    if (!error) return;
    toast.error('Algo deu errado', { description: error });
    useAppStore.getState().setError(null);
  }, [error]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const ui = useUiStore.getState();
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        ui.setCommandPaletteOpen(!ui.commandPaletteOpen);
        return;
      }
      if (mod && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        ui.toggleSidebar();
        return;
      }
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void useChatStore.getState().startNewConversation();
        return;
      }
      if (mod && event.key === ',') {
        event.preventDefault();
        ui.setSettingsOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        if (ui.commandPaletteOpen) {
          ui.setCommandPaletteOpen(false);
          return;
        }
        if (ui.modelPickerOpen || ui.settingsOpen || ui.artifactPanelOpen) {
          ui.closeAllOverlays();
          ui.closeArtifactPanel();
          return;
        }
        if (useChatStore.getState().streaming) {
          void useChatStore.getState().stop();
        }
        return;
      }
      if (mod && event.key.toLowerCase() === 'j' && !isEditableTarget(event.target)) {
        // Focus composer shortcut.
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('lumina:focus-composer'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Native file drag & drop -> attachments.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    try {
      const webview = getCurrentWebview();
      void webview
        .onDragDropEvent((event) => {
          if (disposed) return;
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
        <AppShell>
          <ChatView />
        </AppShell>
        <SettingsDialog />
        <ModelPickerDialog />
        <ArtifactPanel />
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
