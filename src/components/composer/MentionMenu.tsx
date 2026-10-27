import { FileCode, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export const MENTION_LISTBOX_ID = 'composer-mention-listbox';

export function mentionOptionId(index: number): string {
  return `composer-mention-option-${index}`;
}

export interface MentionMenuProps {
  /** Termo digitado depois de `@` (sem o `@`). */
  query: string;
  results: string[];
  loading: boolean;
  error: string | null;
  activeIndex: number;
  onSelect: (path: string) => void;
  /** Mantém o item ativo em sincronia com o hover do mouse. */
  onHoverIndex: (index: number) => void;
}

/**
 * Listbox de arquivos do workspace para o `@` do composer
 * (WORKBENCH §6/item 1): `role="listbox"`/`option`, navegação por teclado no
 * textarea via `aria-activedescendant`, estado honesto de busca/erro/vazio.
 */
export function MentionMenu({
  query,
  results,
  loading,
  error,
  activeIndex,
  onSelect,
  onHoverIndex,
}: MentionMenuProps) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-1.5">
        <Search aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
        <p className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
          Arquivos do workspace
        </p>
        {query ? (
          <span className="max-w-40 truncate font-mono text-[11px] text-foreground-muted">@{query}</span>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mx-1 rounded-lg border border-danger/30 bg-danger-soft px-2.5 py-2 text-[12px] leading-relaxed text-danger"
        >
          {error}
        </p>
      ) : loading && results.length === 0 ? (
        <p role="status" className="px-2.5 py-2 text-[12px] text-foreground-muted">
          Buscando arquivos…
        </p>
      ) : results.length === 0 ? (
        <p className="px-2.5 py-2 text-[12px] leading-relaxed text-foreground-muted">
          {query
            ? `Nenhum arquivo encontrado para “${query}”.`
            : 'Nenhum arquivo encontrado neste workspace.'}
        </p>
      ) : (
        <div
          role="listbox"
          id={MENTION_LISTBOX_ID}
          aria-label="Arquivos do workspace"
          className="max-h-64 overflow-y-auto overscroll-contain p-1"
        >
          {results.map((path, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={path}
                type="button"
                role="option"
                id={mentionOptionId(index)}
                aria-selected={active}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHoverIndex(index)}
                onClick={() => onSelect(path)}
                className={cn(
                  'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left',
                  'transition-colors duration-100',
                  active ? 'bg-surface-active text-foreground' : 'text-foreground-muted hover:bg-surface-hover',
                )}
              >
                <FileCode aria-hidden className="size-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{path}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading && results.length > 0 ? (
        <p role="status" className="px-2.5 pb-1.5 text-[11px] text-foreground-subtle">
          Atualizando…
        </p>
      ) : null}
    </div>
  );
}

export default MentionMenu;
