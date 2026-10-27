import { useRef } from 'react';
import { BookOpen, Folder, ShieldCheck } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';
import type { Workspace } from '@/lib/types';

export interface WorkspaceTrustDialogProps {
  open: boolean;
  /** Workspace recém-aberto (null = diálogo fechado, nada é renderizado). */
  workspace: Workspace | null;
  /** Requisição em andamento: mantém o diálogo aberto e desabilita as ações. */
  busy?: boolean;
  /** Confiar: libera leitura, edição e comandos (modo Editar). */
  onConfirm: () => void;
  /** Abrir em leitura: o agente só pode ler até o usuário confiar depois. */
  onReadOnly: () => void;
  /** Cancelar: remove o workspace recém-criado (a pasta no disco fica intacta). */
  onCancel: () => void;
}

/**
 * Pergunta de confiança da primeira abertura de uma pasta
 * (docs/goals/code-harness/WORKBENCH.md §8.2). É a medida de segurança contra
 * um repositório clonado malicioso: sem confiança o agente não edita arquivos,
 * não executa comandos e não carrega `AGENTS.md`/skills do projeto.
 *
 * Acessibilidade: Radix Dialog com título/descrição, foco inicial em "Confiar",
 * `Esc` cancela (equivalente a "Cancelar") e as ações ficam desabilitadas
 * enquanto a requisição está em andamento.
 */
export function WorkspaceTrustDialog({
  open,
  workspace,
  busy = false,
  onConfirm,
  onReadOnly,
  onCancel,
}: WorkspaceTrustDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  if (!workspace) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Fechar pelo X/Esc equivale a cancelar; nunca fecha durante a ação.
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent
        size="md"
        className="gap-0"
        onOpenAutoFocus={(event) => {
          // Foco inicial no botão primário, que é a ação recomendada.
          event.preventDefault();
          confirmRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className="gap-2 pr-10">
          <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface-hover text-warning">
            <Folder aria-hidden className="size-5" strokeWidth={1.75} />
          </span>
          <DialogTitle>Confiar nesta pasta?</DialogTitle>
          <DialogDescription>
            O agente poderá ler, editar e executar comandos em:
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-1">
          <p
            className="break-all rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground-muted"
            title={workspace.path}
          >
            {workspace.path}
          </p>
          <p className="mt-3 text-[12.5px] leading-relaxed text-foreground-muted">
            As instruções do projeto (<code className="rounded bg-surface-hover px-1 py-0.5 text-[11.5px]">AGENTS.md</code>)
            e as skills locais serão carregadas no prompt. Você pode mudar a confiança depois nas opções
            do workspace.
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-foreground-subtle">
            <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            <span>
              Abrir em leitura libera apenas leitura: sem edições, sem comandos e sem instruções do
              repositório.
            </span>
          </p>
        </div>

        <DialogFooter className="mt-4 justify-between">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            Cancelar
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              leftIcon={<BookOpen className="size-4" />}
              onClick={onReadOnly}
            >
              Abrir em Leitura
            </Button>
            <Button
              ref={confirmRef}
              variant="primary"
              size="sm"
              disabled={busy}
              loading={busy}
              leftIcon={<ShieldCheck className="size-4" />}
              onClick={onConfirm}
            >
              Confiar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default WorkspaceTrustDialog;
