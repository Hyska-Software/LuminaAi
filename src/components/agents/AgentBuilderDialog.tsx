import { useState } from 'react';
import { Loader2, Sparkles, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';

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

const EXAMPLES = [
  'Um revisor de código rigoroso, que aponta riscos e pede testes antes de aprovar.',
  'Uma pesquisadora que compara fontes, cita links e separa fatos de opinião.',
  'Um assistente de operações que transforma pedidos vagos em checklists executáveis.',
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
  const selection = useAppStore((state) => state.selection);
  const openEditor = useUiStore((state) => state.openAgentEditor);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const create = async () => {
    const value = prompt.trim();
    if (!value) return;
    if (!selection.providerId || !selection.modelId) {
      toast.error('Configure um provedor e um modelo antes de usar o construtor');
      return;
    }
    setLoading(true);
    try {
      const draft = await api.suggestAgent(value, selection.providerId, selection.modelId);
      openEditor({ mode: 'create', draft });
      setPrompt('');
      onOpenChange(false);
    } catch (error) {
      toast.error('Não foi possível montar o agente', { description: String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WandSparkles className="size-4 text-accent" />
            Criar agente com IA
          </DialogTitle>
          <DialogDescription>
            Descreva o trabalho, o tom e o que o agente deve priorizar. A IA devolve um rascunho
            editável — nada é salvo sem a sua revisão.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={prompt}
            rows={5}
            maxLength={4000}
            autoFocus
            className="min-h-32 resize-y"
            placeholder="Ex.: um agente de suporte que responde em português, cita a documentação e escala casos de cobrança."
            aria-label="Descrição do agente"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void create();
            }}
          />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrompt(example)}
                className="max-w-full rounded-full border border-border bg-surface-raised px-2.5 py-1 text-left text-[11px] text-foreground-muted hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <span className="line-clamp-1">{example}</span>
              </button>
            ))}
          </div>
          <p className="flex items-center gap-1.5 text-[10px] text-foreground-subtle">
            <Sparkles className="size-3" />
            Usa o modelo selecionado no composer. Você poderá ajustar tudo antes de salvar.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={loading || !prompt.trim()}
            onClick={() => void create()}
          >
            {loading ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Sparkles className="mr-1.5 size-4" />}
            Montar agente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
