import { Bot, Sparkles } from 'lucide-react';

import { AgentDialogBody } from './AgentDialogBody';
import { AGENT_TEMPLATES, type AgentTemplate } from '@/lib/agentTemplates';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
} from '@/components/ui';

/**
 * Local template gallery. Picking one creates a normal agent with the current
 * provider/model; the editor remains the source of truth for changes.
 */
export function AgentTemplatesDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (template: AgentTemplate) => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="pb-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" />
            Templates de agentes
          </DialogTitle>
          <DialogDescription>
            Comece por um papel testado e ajuste identidade, instruções e modelo no editor.
          </DialogDescription>
        </DialogHeader>
        <AgentDialogBody>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {AGENT_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => void onPick(template)}
                className="group flex min-h-32 flex-col rounded-xl border border-border bg-surface/50 p-3.5 text-left transition-colors hover:border-border-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface-raised text-[17px]"
                  >
                    {template.emoji}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-foreground">
                      {template.name}
                    </span>
                    <span className="block truncate text-[11px] text-foreground-muted">
                      {template.role} · {template.department}
                    </span>
                  </span>
                </span>
                <span className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-foreground-muted">
                  {template.description}
                </span>
                <span className="mt-auto flex items-center gap-1 pt-2 text-[10px] text-accent">
                  <Bot className="size-3" />
                  Usar template
                </span>
              </button>
            ))}
          </div>
        </AgentDialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
