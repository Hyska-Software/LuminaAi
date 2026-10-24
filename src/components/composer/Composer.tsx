import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { ArrowUp, FilePlus, Globe, Plus, Square } from 'lucide-react';
import { toast } from 'sonner';
import { useReduceMotion } from '@/components/layout/hooks';
import { ModelPill } from '@/components/models/ModelPill';
import { IconButton } from '@/components/ui';
import { useAppStore, useChatStore, useUiStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { AttachmentChips } from './AttachmentChips';
import { ToolsToggle } from './ToolsToggle';

/** Native picker filters: images and the documents `documents::extract` handles. */
const ATTACHMENT_FILTERS = [
  { name: 'Documentos', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'json', 'csv'] },
  { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
  { name: 'Todos os arquivos', extensions: ['*'] },
];

/** The textarea grows up to ten lines before scrolling (DESIGN §7). */
const MAX_LINES = 10;

/** Message composer pinned to the bottom of the chat column. */
export function Composer() {
  const [value, setValue] = useState('');
  const [attaching, setAttaching] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const reduceMotion = useReduceMotion();

  const streaming = useChatStore((state) => state.streaming);
  const pendingAttachments = useChatStore((state) => state.pendingAttachments);
  const sendKey = useAppStore((state) => state.settings.sendKey);
  const webSearchEnabled = useAppStore((state) => state.settings.webSearchEnabled);
  const fileCreationEnabled = useAppStore((state) => state.settings.fileCreationEnabled);
  const setModelPickerOpen = useUiStore((state) => state.setModelPickerOpen);

  const isStreaming = streaming !== null;
  const canSend = !isStreaming && (value.trim().length > 0 || pendingAttachments.length > 0);

  const resizeTextarea = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = '0px';
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 22;
    const maxHeight = lineHeight * MAX_LINES;
    const nextHeight = Math.min(element.scrollHeight, maxHeight);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [value, resizeTextarea]);

  /* Welcome-screen suggestions and global "focus composer" shortcut. */
  useEffect(() => {
    const onSuggest = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== 'string') return;
      setValue(detail);
      requestAnimationFrame(() => {
        const element = textareaRef.current;
        if (!element) return;
        element.focus();
        const end = element.value.length;
        element.setSelectionRange(end, end);
        resizeTextarea();
      });
    };
    const onFocusComposer = () => {
      textareaRef.current?.focus();
    };
    window.addEventListener('lumina:suggest', onSuggest);
    window.addEventListener('lumina:focus-composer', onFocusComposer);
    return () => {
      window.removeEventListener('lumina:suggest', onSuggest);
      window.removeEventListener('lumina:focus-composer', onFocusComposer);
    };
  }, [resizeTextarea]);

  const submit = useCallback(() => {
    if (!canSend) return;
    const text = value.trim();
    setValue('');
    requestAnimationFrame(resizeTextarea);
    window.dispatchEvent(new CustomEvent('lumina:scroll-bottom'));
    void useChatStore.getState().send(text);
  }, [canSend, resizeTextarea, value]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key !== 'Enter') return;
    const withModifier = event.metaKey || event.ctrlKey;
    const shouldSend = sendKey === 'ctrl+enter' ? withModifier : withModifier || !event.shiftKey;
    if (!shouldSend) return;
    event.preventDefault();
    submit();
  };

  const handleAttach = async () => {
    if (attaching) return;
    setAttaching(true);
    try {
      const selection = await open({
        multiple: true,
        title: 'Anexar arquivos',
        filters: ATTACHMENT_FILTERS,
      });
      const paths = Array.isArray(selection) ? selection : selection ? [selection] : [];
      if (paths.length) await useChatStore.getState().addAttachments(paths);
    } catch (error) {
      toast.error('Não foi possível anexar', { description: String(error) });
    } finally {
      setAttaching(false);
    }
  };

  const toggleWebSearch = () => {
    void useAppStore.getState().saveSettings({ webSearchEnabled: !webSearchEnabled });
  };

  const toggleFileCreation = () => {
    void useAppStore.getState().saveSettings({ fileCreationEnabled: !fileCreationEnabled });
  };

  return (
    <div>
      <div
        className={cn(
          'relative overflow-hidden rounded-3xl border border-border bg-surface-raised shadow-sm',
          'transition-colors duration-150 focus-within:border-border-strong',
        )}
      >
        {isStreaming ? (
          <div aria-hidden className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-accent-soft">
            <div
              className={cn(
                'h-full w-1/2 rounded-full bg-linear-to-r from-transparent via-accent to-transparent',
                'bg-[length:200%_100%]',
                !reduceMotion && 'animate-shimmer',
              )}
            />
          </div>
        ) : null}

        <div className="px-3 pb-1 pt-3">
          {pendingAttachments.length > 0 ? (
            <AttachmentChips
              attachments={pendingAttachments}
              onRemove={(id) => void useChatStore.getState().removeAttachment(id)}
              className="mb-2"
            />
          ) : null}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Pergunte alguma coisa…"
            aria-label="Mensagem para o Lumina"
            className={cn(
              'block max-h-[220px] w-full resize-none bg-transparent px-1.5 py-0.5',
              'text-[15px] leading-relaxed text-foreground placeholder:text-foreground-subtle',
              'focus:outline-none',
            )}
          />
        </div>

        <div className="flex items-center gap-1 px-2 pb-2 pt-1">
          <IconButton
            label="Anexar arquivos"
            size="sm"
            variant="ghost"
            loading={attaching}
            onClick={() => void handleAttach()}
          >
            <Plus className="size-4" />
          </IconButton>

          <ToolsToggle icon={Globe} label="Busca web" active={webSearchEnabled} onToggle={toggleWebSearch} />
          <ToolsToggle
            icon={FilePlus}
            label="Criar arquivos"
            active={fileCreationEnabled}
            onToggle={toggleFileCreation}
          />

          <div className="ml-auto flex items-center gap-1.5">
            <ModelPill onClick={() => setModelPickerOpen(true)} />

            {isStreaming ? (
              <button
                type="button"
                onClick={() => void useChatStore.getState().stop()}
                aria-label="Parar resposta"
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background',
                  'transition-colors duration-150 hover:bg-foreground/90',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
              >
                <Square className="size-3.5 fill-current" strokeWidth={2} />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                aria-label="Enviar mensagem"
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  canSend
                    ? 'bg-linear-to-br from-accent to-accent-hover text-accent-foreground hover:brightness-105'
                    : 'cursor-not-allowed bg-surface-active text-foreground-subtle',
                  canSend && !reduceMotion && 'active:scale-95',
                )}
              >
                <ArrowUp className="size-4" strokeWidth={2.25} />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-1.5 text-center text-[11px] leading-relaxed text-foreground-subtle">
        Lumina pode cometer erros. Verifique informações importantes.
      </p>
    </div>
  );
}
