import { cn } from '@/lib/utils';
import { genUIIcon } from '../icons';

export interface GenUIIconBadgeProps {
  /** Nome do ícone na whitelist do contrato. */
  icon: string;
  className?: string;
}

/**
 * Quadrado 24px de ícone usado nos cabeçalhos de `section` e `card`.
 * Decorativo por definição (sempre acompanha um título/label textual): fica
 * `aria-hidden`. Nome fora da whitelist não renderiza nada.
 */
export function GenUIIconBadge({ icon, className }: GenUIIconBadgeProps) {
  const Icon = genUIIcon(icon);
  if (!Icon) return null;
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md bg-surface text-foreground-muted',
        className,
      )}
    >
      <Icon aria-hidden className="size-4" />
    </span>
  );
}
