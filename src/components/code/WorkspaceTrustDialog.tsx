import { useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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
  /** Confiar: libera leitura, edição e comandos (mantém o modo da sessão). */
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
  const { t } = useTranslation('code');
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
          <DialogTitle>{t('trust.title')}</DialogTitle>
          <DialogDescription>{t('trust.description')}</DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-1">
          <p
            className="break-all rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground-muted"
            title={workspace.path}
          >
            {workspace.path}
          </p>
          <p className="mt-3 text-[12.5px] leading-relaxed text-foreground-muted">
            <Trans
              ns="code"
              i18nKey="trust.body"
              components={{ code: <code className="rounded bg-surface-hover px-1 py-0.5 text-[11.5px]" /> }}
            />
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-foreground-subtle">
            <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            <span>{t('trust.readOnly')}</span>
          </p>
        </div>

        <DialogFooter className="mt-4 justify-between">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            {t('common:actions.cancel')}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              leftIcon={<BookOpen className="size-4" />}
              onClick={onReadOnly}
            >
              {t('trust.openReadOnly')}
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
              {t('trust.confirm')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default WorkspaceTrustDialog;
