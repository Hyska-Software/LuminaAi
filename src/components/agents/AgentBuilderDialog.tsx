import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Sparkles, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';

import { AgentDialogBody } from './AgentDialogBody';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAppStore, useUiStore } from '@/lib/store';

const EXAMPLE_KEYS = [
  'builder.examples.reviewer',
  'builder.examples.researcher',
  'builder.examples.ops',
];

/** Prompt-driven agent creation: the model returns a draft, the editor validates
 * and the user still reviews it before saving. */
export function AgentBuilderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('agents');
  const selection = useAppStore((state) => state.selection);
  const openEditor = useUiStore((state) => state.openAgentEditor);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const create = async () => {
    const value = prompt.trim();
    if (!value) return;
    if (!selection.providerId || !selection.modelId) {
      toast.error(t('builder.noModel'));
      return;
    }
    setLoading(true);
    try {
      const draft = await api.suggestAgent(value, selection.providerId, selection.modelId);
      openEditor({ mode: 'create', draft });
      setPrompt('');
      onOpenChange(false);
    } catch (error) {
      toast.error(t('builder.error'), { description: String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="pb-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <WandSparkles className="size-4 text-accent" />
            {t('builder.title')}
          </DialogTitle>
          <DialogDescription>
            {t('builder.description')}
          </DialogDescription>
        </DialogHeader>
        <AgentDialogBody className="space-y-4">
          <Textarea
            value={prompt}
            rows={5}
            maxLength={4000}
            autoFocus
            className="min-h-32 resize-y"
            placeholder={t('builder.placeholder')}
            aria-label={t('builder.aria')}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void create();
            }}
          />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_KEYS.map((key) => {
              const example = t(key as never);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPrompt(example)}
                  className="max-w-full rounded-full bg-surface-hover px-2.5 py-1 text-left text-[11px] text-foreground-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <span className="line-clamp-1">{example}</span>
                </button>
              );
            })}
          </div>
          <p className="flex items-center gap-1.5 text-[10px] text-foreground-subtle">
            <Sparkles className="size-3" />
            {t('builder.hint')}
          </p>
        </AgentDialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={loading || !prompt.trim()}
            onClick={() => void create()}
          >
            {loading ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Sparkles className="mr-1.5 size-4" />}
            {t('builder.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
