import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { propBool, propString, type GenUIValue } from '@/lib/genui';

export interface GenUIRevealProps {
  props?: Record<string, GenUIValue>;
  children?: ReactNode;
}

/**
 * Seção recolhível da UI generativa.
 *
 * Usa `<details>/<summary>` nativo de propósito: teclado, leitor de tela e
 * "encontrar no texto" funcionam sem JavaScript. O chevron é só decoração
 * (150ms) e respeita `prefers-reduced-motion`.
 */
export function GenUIReveal({ props, children }: GenUIRevealProps) {
  const { t } = useTranslation('genui');
  const title = propString(props, 'title') || t('reveal.defaultTitle');
  const open = propBool(props, 'open');

  return (
    <details
      open={open || undefined}
      className="group/reveal overflow-hidden rounded-xl border border-border bg-surface-raised"
    >
      <summary
        className={
          'flex min-h-9 cursor-pointer select-none list-none items-center gap-2 rounded-xl px-3.5 py-2 ' +
          'text-[13px] font-semibold tracking-tight text-foreground transition-colors duration-150 ' +
          'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ' +
          'focus-visible:ring-accent/40 motion-reduce:transition-none [&::-webkit-details-marker]:hidden'
        }
      >
        <ChevronRight
          aria-hidden
          className={
            'size-4 shrink-0 text-foreground-subtle transition-transform duration-150 ' +
            'group-open/reveal:rotate-90 motion-reduce:transition-none'
          }
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </summary>
      {children ? (
        <div className="flex flex-col gap-3 border-t border-border px-3.5 py-3">{children}</div>
      ) : null}
    </details>
  );
}
