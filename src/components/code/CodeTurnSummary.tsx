import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, FileDiff } from 'lucide-react';
import { buildCodeTurnSummary } from '@/lib/codeTurnSummary';
import { formatNumber } from '@/lib/i18n/format';
import { useUiStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FileIcon } from './FileIcon';

/** Linhas visíveis com o card recolhido (WORKBENCH §5.1). */
export const CODE_TURN_SUMMARY_VISIBLE_FILES = 4;

export interface CodeTurnSummaryProps {
  message: ChatMessage;
  /**
   * Workspace da sessão. Quando é uma string não vazia, cada linha abre o diff
   * do arquivo como aba central (WORKBENCH §7.2), reusando o `knownDiff` do
   * modelo; sem workspace o card continua apenas informativo.
   */
  workspaceId?: string | null;
  className?: string;
}

/** Contagem no padrão do locale (`1,234` / `1.234`), como o resto do workbench. */

/**
 * Fecho de turno do layout Code (WORKBENCH §5.1): o card "Edited N files" dos
 * agentes de código adaptado ao design system. Resume os arquivos alterados no
 * turno com `+N −M` por arquivo e os totais, a partir do modelo puro
 * `buildCodeTurnSummary` (persistido em `ChatMessage.toolCalls[].presentation`).
 *
 * Com o `workspaceId` da sessão, cada linha abre o diff do arquivo como aba
 * central (`useUiStore.openCodeDiff`, como o painel Alterações): o `knownDiff`
 * do modelo evita o IPC e, quando ausente, o `CodeDiffView` busca via
 * `get_file_diff`. Sem workspace as linhas são apenas informativas.
 *
 * A montagem no transcript — e a checagem de `layoutMode === 'code'` e de fim
 * de streaming — é da ui-core em `MessageItem`. Recolhido por padrão, mostra
 * {@link CODE_TURN_SUMMARY_VISIBLE_FILES} linhas e, acima disso, o botão
 * full-width "Todos os N arquivos" / "Mostrar menos".
 */
export function CodeTurnSummary({ message, workspaceId, className }: CodeTurnSummaryProps) {
  const { t } = useTranslation('code');
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => buildCodeTurnSummary(message), [message]);

  // Sem tool de escrita no turno: o card não deve aparecer.
  if (!summary) return null;

  // Só abre diff com um workspace real; sem ele a linha continua informativa.
  const workspace =
    typeof workspaceId === 'string' && workspaceId.trim().length > 0 ? workspaceId : null;

  const total = summary.files.length;
  const collapsible = total > CODE_TURN_SUMMARY_VISIBLE_FILES;
  const visibleFiles =
    collapsible && !expanded
      ? summary.files.slice(0, CODE_TURN_SUMMARY_VISIBLE_FILES)
      : summary.files;

  return (
    <section
      role="group"
      aria-label={t('code:turnSummary.region')}
      className={cn(
        'mt-3 overflow-hidden rounded-xl border border-border bg-surface-raised',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"
        >
          <FileDiff className="size-4" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-snug text-foreground">
            {t('code:turnSummary.files', { count: total })}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug tabular-nums text-foreground-muted">
            <span className="text-success">+{formatNumber(summary.added)}</span>{' '}
            <span className="text-danger">−{formatNumber(summary.removed)}</span>
          </p>
        </div>
      </div>

      <ul id={listId} aria-label={t('code:turnSummary.changedFilesAria')} className="border-t border-border py-1">
        {visibleFiles.map((file) => {
          const row = (
            <>
              <FileIcon path={file.path} className="size-3.5" />
              <span
                title={file.path}
                className={cn(
                  'min-w-0 flex-1 truncate text-[12px] text-foreground-muted',
                  workspace && 'group-hover/row:text-foreground',
                )}
              >
                {file.path}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums">
                <span className="text-success">+{formatNumber(file.added)}</span>{' '}
                <span className="text-danger">−{formatNumber(file.removed)}</span>
              </span>
            </>
          );

          return (
            <li key={file.path} className="min-w-0">
              {workspace ? (
                <button
                  type="button"
                  onClick={() =>
                    useUiStore.getState().openCodeDiff({
                      workspaceId: workspace,
                      path: file.path,
                      staged: false,
                      knownDiff: file.diff ?? null,
                    })
                  }
                  aria-label={t('code:turnSummary.openDiff', { path: file.path })}
                  className={cn(
                    'group/row flex h-7 w-full min-w-0 items-center gap-2 px-3 text-left',
                    'transition-colors duration-150 hover:bg-surface-hover',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
                    'motion-reduce:transition-none',
                  )}
                >
                  {row}
                </button>
              ) : (
                <div className="flex h-7 min-w-0 items-center gap-2 px-3">{row}</div>
              )}
            </li>
          );
        })}
      </ul>

      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={listId}
          className={cn(
            'flex w-full items-center justify-center gap-1 border-t border-border px-3 py-2',
            'text-[12px] font-medium text-foreground-muted transition-colors duration-150',
            'hover:bg-surface-hover hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
            'motion-reduce:transition-none',
          )}
        >
          {expanded
            ? t('code:turnSummary.showLess')
            : t('code:turnSummary.showAll', { count: total })}
          <ChevronDown
            aria-hidden
            strokeWidth={2}
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none',
              expanded && 'rotate-180',
            )}
          />
        </button>
      ) : null}
    </section>
  );
}

export default CodeTurnSummary;
