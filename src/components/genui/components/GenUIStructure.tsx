import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { openExternal } from '@/lib/genui/open-external';
import { propBool, propObjectArray, propString } from '@/lib/genui';
import { genUIIcon } from '../icons';
import { GenUIIconBadge } from './GenUIIconBadge';
import { statusKey, statusMeta } from './status';
import type { GenUINodeProps } from './GenUILayout';

/* ------------------------------- section ------------------------------ */

/**
 * Cabeçalho de seção (eyebrow/título/ícone/descrição) com conteúdo abaixo,
 * sem moldura de card — é a hierarquia dos feeds e relatórios.
 */
export function GenUISection({ props, children }: GenUINodeProps) {
  const icon = propString(props, 'icon');
  const eyebrow = propString(props, 'eyebrow');
  const title = propString(props, 'title');
  const description = propString(props, 'description');
  const divider = propBool(props, 'divider');
  const hasHeader = Boolean(icon || eyebrow || title || description);

  return (
    <section className="flex min-w-0 flex-col gap-3">
      {hasHeader ? (
        <header className="flex min-w-0 items-start gap-2.5">
          <GenUIIconBadge icon={icon} />
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              <p className="text-[10.5px] font-medium uppercase tracking-wider text-foreground-subtle">{eyebrow}</p>
            ) : null}
            {title ? (
              <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">{description}</p>
            ) : null}
          </div>
        </header>
      ) : null}
      {children ? <div className="flex min-w-0 flex-col gap-3">{children}</div> : null}
      {divider ? <hr className="border-0 border-t border-border" /> : null}
    </section>
  );
}

/* -------------------------------- text -------------------------------- */

const TEXT_VARIANTS = {
  body: 'text-[13px] leading-relaxed text-foreground',
  muted: 'text-[12.5px] leading-relaxed text-foreground-muted',
  lead: 'text-[15px] leading-relaxed text-foreground',
  strong: 'text-[13px] font-semibold leading-relaxed text-foreground',
  small: 'text-[11.5px] leading-relaxed text-foreground-subtle',
} as const;

type GenUITextVariant = keyof typeof TEXT_VARIANTS;

/** Parágrafo de texto puro (Markdown não é renderizado dentro de props). */
export function GenUIText({ props }: GenUINodeProps) {
  const text = propString(props, 'text');
  if (!text) return null;
  const variantRaw = propString(props, 'variant', 'body');
  const variant: GenUITextVariant = variantRaw in TEXT_VARIANTS ? (variantRaw as GenUITextVariant) : 'body';
  return <p className={TEXT_VARIANTS[variant]}>{text}</p>;
}

/* ------------------------------- source ------------------------------- */

const SOURCE_SQUARE =
  'flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-surface-active text-[10px] font-semibold uppercase text-foreground-muted';
const SOURCE_BASE =
  'inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface px-2 ' +
  'text-[12.5px] font-medium text-foreground transition-colors duration-150 motion-reduce:transition-none';

/** Chip de fonte/link externo: quadrado com a inicial do domínio + label. */
export function GenUISource({ props }: GenUINodeProps) {
  const { t } = useTranslation('genui');
  const label = propString(props, 'label');
  const href = propString(props, 'href');
  const title = propString(props, 'title');
  if (!label) return null;

  const initial = label.trim().charAt(0).toUpperCase();
  const safeHref = /^https?:\/\//i.test(href) ? href : '';
  const content = (
    <>
      <span aria-hidden className={SOURCE_SQUARE}>
        {initial || '?'}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      <ExternalLink aria-hidden className="size-3 shrink-0 text-foreground-subtle" />
    </>
  );

  if (!safeHref) {
    return <span className={SOURCE_BASE}>{content}</span>;
  }

  return (
    <button
      type="button"
      // O `title` é um detalhe opcional (ex.: manchete); o nome acessível é o
      // aria-label explícito para não depender do texto truncado.
      title={title || undefined}
      aria-label={t('source.openAria', { label })}
      onClick={() => void openExternal(safeHref)}
      className={cn(
        SOURCE_BASE,
        'hover:bg-surface-hover hover:underline',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
      )}
    >
      {content}
    </button>
  );
}

/* ------------------------------ checklist ----------------------------- */

/** Lista com ícone/estado por item (simulações, etapas, capacidades). */
export function GenUIChecklist({ props }: GenUINodeProps) {
  useTranslation('genui');
  const items = propObjectArray(props, 'items');
  if (!items.length) return null;

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, index) => {
        const label = propString(item, 'label', propString(item, 'title'));
        if (!label) return null;
        const description = propString(item, 'description');
        const status = statusKey(propString(item, 'status'));
        const meta = statusMeta(status);
        const customIcon = genUIIcon(propString(item, 'icon'));
        const Icon = customIcon ?? meta.icon;
        return (
          <li key={index} data-status={status} className="flex items-start gap-2.5">
            <Icon
              aria-hidden
              className={cn('mt-0.5 size-4 shrink-0', customIcon ? 'text-foreground-muted' : meta.className)}
            />
            <div className="min-w-0">
              <p
                className={cn(
                  'text-[12.5px] font-semibold',
                  status === 'disabled' ? 'text-foreground-muted' : 'text-foreground',
                )}
              >
                {label}
              </p>
              {description ? (
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-foreground-muted">{description}</p>
              ) : null}
              {/* O estado nunca é só cor/ícone: leitores de tela recebem o texto. */}
              <span className="sr-only">{meta.label}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
