import { ArrowLeft, ArrowUpDown, ChevronDown, LayoutGrid, List, Search, Upload, X } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  IconButton,
  SegmentedControl,
} from '@/components/ui';
import { LIBRARY_SORTS, librarySortLabel, type LibrarySortId } from './filters';

export type LibraryViewMode = 'grid' | 'list';

const VIEW_OPTIONS = [
  {
    value: 'grid',
    title: 'Grade',
    label: (
      <span className="inline-flex items-center">
        <LayoutGrid aria-hidden className="size-4" strokeWidth={1.9} />
        <span className="sr-only">Grade</span>
      </span>
    ),
  },
  {
    value: 'list',
    title: 'Lista',
    label: (
      <span className="inline-flex items-center">
        <List aria-hidden className="size-4" strokeWidth={1.9} />
        <span className="sr-only">Lista</span>
      </span>
    ),
  },
];

interface LibrarySearchProps {
  query: string;
  onQueryChange: (value: string) => void;
}

/** Pill search box over the whole library (name, kind and origin conversation). */
function LibrarySearch({ query, onQueryChange }: LibrarySearchProps) {
  return (
    <div className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised pl-2.5 pr-0.5 transition-colors focus-within:border-border-strong focus-within:ring-2 focus-within:ring-accent/20 sm:w-64">
      <Search aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        aria-label="Pesquisar na biblioteca"
        placeholder="Pesquisar na biblioteca"
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-subtle [&::-webkit-search-cancel-button]:appearance-none"
      />
      {query ? (
        <IconButton
          label="Limpar busca"
          size="sm"
          className="size-7 rounded-full"
          onClick={() => onQueryChange('')}
        >
          <X aria-hidden className="size-3.5" />
        </IconButton>
      ) : null}
    </div>
  );
}

interface SortMenuProps {
  sort: LibrarySortId;
  onSortChange: (sort: LibrarySortId) => void;
}

function SortMenu({ sort, onSortChange }: SortMenuProps) {
  const label = librarySortLabel(sort);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Ordenar: ${label}`}
          leftIcon={<ArrowUpDown aria-hidden className="size-3.5" />}
          rightIcon={<ChevronDown aria-hidden className="size-3.5" />}
        >
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
        {LIBRARY_SORTS.map((option) => (
          <DropdownMenuItem
            key={option.id}
            checked={option.id === sort}
            onSelect={() => onSortChange(option.id)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface LibraryHeaderProps {
  query: string;
  onQueryChange: (value: string) => void;
  sort: LibrarySortId;
  onSortChange: (sort: LibrarySortId) => void;
  view: LibraryViewMode;
  onViewChange: (view: LibraryViewMode) => void;
  importing: boolean;
  onUpload: () => void;
  onBack: () => void;
}

/**
 * Page header (PLAN §4.2): “Voltar ao chat”, title/description and the right
 * side tools — search, ordering, grid/list toggle and the primary upload
 * button. The category pills live below, above the grid.
 */
export function LibraryHeader({
  query,
  onQueryChange,
  sort,
  onSortChange,
  view,
  onViewChange,
  importing,
  onUpload,
  onBack,
}: LibraryHeaderProps) {
  return (
    <header className="shrink-0 border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 pb-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<ArrowLeft aria-hidden className="size-4" />}
            onClick={onBack}
          >
            Voltar ao chat
          </Button>
        </div>

        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold leading-6 tracking-tight text-foreground">
              Biblioteca
            </h1>
            <p className="mt-0.5 text-[13px] leading-relaxed text-foreground-muted">
              Todos os arquivos das suas conversas e os que você enviar. O agente pode consultá-los
              durante a conversa.
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <LibrarySearch query={query} onQueryChange={onQueryChange} />
            <SortMenu sort={sort} onSortChange={onSortChange} />
            <SegmentedControl
              size="sm"
              ariaLabel="Modo de visualização"
              options={VIEW_OPTIONS}
              value={view}
              onChange={(value) => onViewChange(value === 'list' ? 'list' : 'grid')}
            />
            <Button
              size="sm"
              variant="primary"
              loading={importing}
              leftIcon={<Upload aria-hidden className="size-3.5" />}
              onClick={onUpload}
            >
              {importing ? 'Enviando arquivos…' : 'Enviar arquivos'}
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default LibraryHeader;
