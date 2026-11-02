import { useEffect, useState } from 'react';
import { Check, Loader2, Sparkles, WandSparkles } from 'lucide-react';
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
import { useAgentStore, useAppStore } from '@/lib/store';
import type { Agent, AgentChange, AgentRevision } from '@/lib/types';

function changeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Ligada' : 'Desligada';
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
      .join('\n');
  }
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value, null, 2);
}

function ChangeBlock({ change }: { change: AgentChange }) {
  const before = changeValue(change.before);
  const after = changeValue(change.after);
  const long = before.length > 160 || after.length > 160;
  return (
    <div className="rounded-xl border border-border bg-surface-raised/40 p-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
        {change.label}
      </p>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-foreground-subtle">
            Antes
          </p>
          <pre
            className={`whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-surface px-2 py-1.5 text-[11px] leading-relaxed text-foreground-muted ${
              long ? 'max-h-40 overflow-y-auto' : ''
            }`}
          >
            {before || '—'}
          </pre>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-accent">
            Depois
          </p>
          <pre
            className={`whitespace-pre-wrap break-words rounded-lg border border-accent/30 bg-accent-soft/30 px-2 py-1.5 text-[11px] leading-relaxed text-foreground ${
              long ? 'max-h-40 overflow-y-auto' : ''
            }`}
          >
            {after || '—'}
          </pre>
        </div>
      </div>
    </div>
  );
}

const EXAMPLES = [
  'Deixe o tom mais direto e sem rodeios.',
  'Adicione uma instrução para citar fontes sempre que pesquisar.',
  'Transforme as sugestões em perguntas curtas de diagnóstico.',
];

/**
 * Conversational agent editor: the model proposes a JSON patch, the backend
 * normalizes/validates it and this dialog shows a field-level diff. Nothing is
 * persisted until the user applies the revision.
 */
export function AgentRevisionDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const selection = useAppStore((state) => state.selection);
  const update = useAgentStore((state) => state.update);
  const [prompt, setPrompt] = useState('');
  const [revision, setRevision] = useState<AgentRevision | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPrompt('');
      setRevision(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    setRevision(null);
    setError(null);
  }, [agent?.id]);

  const propose = async () => {
    if (!agent) return;
    const value = prompt.trim();
    if (!value) return;
    if (!selection.providerId || !selection.modelId) {
      toast.error('Selecione um modelo no composer antes de editar com IA');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.reviseAgent(
        agent.id,
        value,
        selection.providerId,
        selection.modelId,
      );
      setRevision(result);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!revision) return;
    setApplying(true);
    try {
      const updated = await update(revision.agentId, revision.after);
      toast.success('Agente atualizado', { description: updated.name });
      onOpenChange(false);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WandSparkles className="size-4 text-accent" />
            Editar {agent?.name ?? 'agente'} com IA
          </DialogTitle>
          <DialogDescription>
            Descreva a mudança. A IA propõe um patch; você revisa o diff antes de aplicar. Rotas,
            permissões, workspace e capacidades não mudam por aqui.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-3 overflow-y-auto pr-1">
          <Textarea
            value={prompt}
            rows={3}
            maxLength={4000}
            autoFocus
            className="min-h-20 resize-y"
            placeholder="Ex.: deixe as respostas mais curtas e sempre termine com o próximo passo."
            aria-label="Pedido de alteração do agente"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void propose();
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

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger"
            >
              {error}
            </p>
          ) : null}

          {revision ? (
            revision.changes.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface-raised px-3 py-4 text-center text-[12px] text-foreground-muted">
                O modelo não propôs nenhuma alteração. Tente ser mais específico.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground-muted">
                  <Sparkles className="size-3.5 text-accent" />
                  {revision.changes.length} campo(s) alterado(s) — nada foi salvo ainda
                </p>
                {revision.changes.map((change) => (
                  <ChangeBlock key={change.field} change={change} />
                ))}
              </div>
            )
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading || applying}>
            Cancelar
          </Button>
          <Button
            variant="secondary"
            disabled={loading || applying || !prompt.trim()}
            onClick={() => void propose()}
          >
            {loading ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 size-4" />
            )}
            {revision ? 'Gerar outra proposta' : 'Gerar revisão'}
          </Button>
          <Button
            variant="primary"
            disabled={applying || !revision || revision.changes.length === 0}
            onClick={() => void apply()}
          >
            {applying ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Check className="mr-1.5 size-4" />
            )}
            Aplicar revisão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
