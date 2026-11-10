import { ArrowLeft, ArrowUpDown, ChevronDown, LayoutGrid, List, Search, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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

interface LibrarySearchProps {
  query: string;
  onQueryChange: (value: string) => void;
}

/** Pill search box over the whole library (name, kind and origin conversation). */
function LibrarySearch({ query, onQueryChange }: LibrarySearchProps) {
  const { t } = useTranslation('library');
  return (
    <div className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised pl-2.5 pr-0.5 transition-colors focus-within:border-border-strong focus-within:ring-2 focus-within:ring-accent/20 sm:w-64">
      <Search aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        aria-label={t('library:header.searchAria')}
        placeholder={t('library:header.searchPlaceholder')}
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-subtle [&::-webkit-search-cancel-button]:appearance-none"
      />
      {query ? (
        <IconButton
          label={t('library:header.clearSearch')}
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
  const { t } = useTranslation('library');
  const label = librarySortLabel(sort);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="secondary"
          aria-label={t('library:header.sortAria', { label })}
          leftIcon={<ArrowUpDown aria-hidden className="size-3.5" />}
          rightIcon={<ChevronDown aria-hidden className="size-3.5" />}
        >
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('library:header.sortMenu')}</DropdownMenuLabel>
        {LIBRARY_SORTS.map((option) => (
          <DropdownMenuItem
            key={option.id}
            checked={option.id === sort}
            onSelect={() => onSortChange(option.id)}
          >
            {librarySortLabel(option.id)}
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
  const { t } = useTranslation('library');
  const viewOptions = [
    {
      value: 'grid',
      title: t('library:header.grid'),
      label: (
        <span className="inline-flex items-center">
          <LayoutGrid aria-hidden className="size-4" strokeWidth={1.9} />
          <span className="sr-only">{t('library:header.grid')}</span>
        </span>
      ),
    },
    {
      value: 'list',
      title: t('library:header.list'),
      label: (
        <span className="inline-flex items-center">
          <List aria-hidden className="size-4" strokeWidth={1.9} />
          <span className="sr-only">{t('library:header.list')}</span>
        </span>
      ),
    },
  ];
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
            {t('library:header.back')}
          </Button>
        </div>

        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold leading-6 tracking-tight text-foreground">
              {t('library:header.title')}
            </h1>
            <p className="mt-0.5 text-[13px] leading-relaxed text-foreground-muted">
              {t('library:header.description')}
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <LibrarySearch query={query} onQueryChange={onQueryChange} />
            <SortMenu sort={sort} onSortChange={onSortChange} />
            <SegmentedControl
              size="sm"
              ariaLabel={t('library:header.viewAria')}
              options={viewOptions}
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
              {importing ? t('library:header.uploading') : t('library:header.upload')}
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default LibraryHeader;
