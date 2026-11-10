/**
 * Badge (pill) do modo Plano dentro do campo de mensagem do composer.
 *
 * Pedido de produto: quando o modo Plano está ativo, ele aparece como um pill
 * accent no campo — no mesmo lugar/estilo do chip `/goal` — com o ícone e o
 * rótulo escrito "Plano" (na versão anterior era somente o ícone). O clique
 * desativa o modo; o estado vem do `codeStore` (snapshot autoritativo, com
 * atualização otimista e rollback feitos pelo próprio store).
 *
 * O componente é puro: só lê o snapshot e dispara `setPlanMode`. A linha de
 * chips que o hospeda (ao lado do chip `/goal`) fica no `Composer`.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListChecks } from 'lucide-react';

import { Tooltip } from '@/components/ui';
import { useCodeStore } from '@/lib/store';
import { cn } from '@/lib/utils';

export interface PlanModeChipProps {
  conversationId: string;
  className?: string;
}

/**
 * Pill accent com ícone `ListChecks` + rótulo "Plano": visível apenas com
 * `planMode` ativo; clicar (em qualquer parte) desativa pelo `codeStore`.
 */
export function PlanModeChip({ conversationId, className }: PlanModeChipProps) {
  const { t } = useTranslation('composer');
  const planMode = useCodeStore(
    (state) => state.byConversation[conversationId]?.planMode ?? false,
  );
  const [pending, setPending] = useState(false);

  if (!planMode) return null;

  const deactivate = async () => {
    if (pending) return;
    setPending(true);
    try {
      await useCodeStore.getState().setPlanMode(conversationId, false);
    } finally {
      setPending(false);
    }
  };

  return (
    <Tooltip content={t('planMode.tooltip')} side="top">
      <button
        type="button"
        aria-label={t('planMode.disable')}
        aria-pressed={true}
        disabled={pending}
        onClick={() => void deactivate()}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-2.5',
          'text-[12px] font-medium text-foreground',
          'transition-colors duration-150 hover:bg-accent-soft/80',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          'disabled:pointer-events-none disabled:opacity-60',
          className,
        )}
      >
        <ListChecks aria-hidden className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} />
        <span>{t('planMode.label')}</span>
      </button>
    </Tooltip>
  );
}
