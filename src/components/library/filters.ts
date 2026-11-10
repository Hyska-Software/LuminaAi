/**
 * Pure helpers for the Biblioteca page (docs/goals/library-page/PLAN.md §4.2):
 * category pills, accent/case-insensitive search, ordering and small labels.
 *
 * Kept free of React so the whole filter/search/sort matrix can be unit tested
 * without a DOM — the view only composes these functions.
 */
import { artifactKindMeta } from '@/components/artifacts/kinds';
import { compareText, formatDate } from '@/lib/i18n/format';
import { t } from '@/lib/i18n';
import type { ArtifactKind, LibraryArtifact } from '@/lib/types';

/** Categories shown as pills, in canonical order (PLAN §4.2). */
export const LIBRARY_FILTER_IDS = [
  'all',
  'favorites',
  'images',
  'documents',
  'code',
  'media',
  'others',
] as const;

export type LibraryFilterId = (typeof LIBRARY_FILTER_IDS)[number];

export interface LibraryFilterDefinition {
  id: LibraryFilterId;
  labelKey: `library:filters.${LibraryFilterId}`;
}

export const LIBRARY_FILTERS: readonly LibraryFilterDefinition[] = [
  { id: 'all', labelKey: 'library:filters.all' },
  { id: 'favorites', labelKey: 'library:filters.favorites' },
  { id: 'images', labelKey: 'library:filters.images' },
  { id: 'documents', labelKey: 'library:filters.documents' },
  { id: 'code', labelKey: 'library:filters.code' },
  { id: 'media', labelKey: 'library:filters.media' },
  { id: 'others', labelKey: 'library:filters.others' },
];

/** Kind → category mapping. Every `ArtifactKind` belongs to exactly one pill. */
const FILTER_KINDS: Record<Exclude<LibraryFilterId, 'all' | 'favorites'>, ReadonlySet<ArtifactKind>> =
  {
    images: new Set<ArtifactKind>(['image', 'svg']),
    documents: new Set<ArtifactKind>(['pdf', 'docx', 'xlsx', 'pptx', 'markdown', 'html', 'text', 'csv']),
    code: new Set<ArtifactKind>(['code', 'json']),
    media: new Set<ArtifactKind>(['audio', 'video']),
    others: new Set<ArtifactKind>(['archive', 'binary']),
  };

export function libraryFilterLabel(id: LibraryFilterId): string {
  const definition = LIBRARY_FILTERS.find((filter) => filter.id === id);
  return definition ? t(definition.labelKey) : id;
}

/** True when the artifact belongs to the selected category (`all` matches everything). */
export function matchesLibraryFilter(
  artifact: LibraryArtifact,
  filter: LibraryFilterId,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'favorites') return artifact.favorite === true;
  return FILTER_KINDS[filter].has(artifact.kind);
}

/**
 * Search key: accents removed, lowercased and trimmed — same tolerance the
 * backend applies to artifact names (PLAN §4.2).
 */
export function normalizeLibraryQuery(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Human origin of an artifact: the conversation title, or the library label for uploads. */
export function libraryArtifactOrigin(artifact: LibraryArtifact): string {
  const title = artifact.conversationTitle?.trim();
  return title ? title : t('library:card.originFallback');
}

/** Everything the search box matches: name, kind label/description and origin. */
function searchHaystack(artifact: LibraryArtifact): string {
  const meta = artifactKindMeta(artifact.kind);
  const conversationTitle = artifact.conversationTitle?.trim();
  return normalizeLibraryQuery(
    [artifact.name, meta.label, meta.description, conversationTitle ?? ''].join(' '),
  );
}

export function searchLibraryArtifacts(
  artifacts: readonly LibraryArtifact[],
  query: string,
): LibraryArtifact[] {
  const needle = normalizeLibraryQuery(query);
  if (!needle) return [...artifacts];
  return artifacts.filter((artifact) => searchHaystack(artifact).includes(needle));
}

export const LIBRARY_SORT_IDS = ['recent', 'oldest', 'name', 'size'] as const;

export type LibrarySortId = (typeof LIBRARY_SORT_IDS)[number];

export interface LibrarySortDefinition {
  id: LibrarySortId;
  labelKey: `library:sorts.${LibrarySortId}`;
}

export const LIBRARY_SORTS: readonly LibrarySortDefinition[] = [
  { id: 'recent', labelKey: 'library:sorts.recent' },
  { id: 'oldest', labelKey: 'library:sorts.oldest' },
  { id: 'name', labelKey: 'library:sorts.name' },
  { id: 'size', labelKey: 'library:sorts.size' },
];

export function librarySortLabel(id: LibrarySortId): string {
  const definition = LIBRARY_SORTS.find((sort) => sort.id === id);
  return definition ? t(definition.labelKey) : id;
}

/** Orders a copy of the list according to the selected sort (Recent by default). */
export function sortLibraryArtifacts(
  artifacts: readonly LibraryArtifact[],
  sort: LibrarySortId,
): LibraryArtifact[] {
  const sorted = [...artifacts];
  switch (sort) {
    case 'oldest':
      return sorted.sort(
        (left, right) => left.createdAt - right.createdAt || compareText(left.id, right.id),
      );
    case 'name':
      return sorted.sort(
        (left, right) => compareText(left.name, right.name) || compareText(left.id, right.id),
      );
    case 'size':
      return sorted.sort((left, right) => right.size - left.size || compareText(left.id, right.id));
    case 'recent':
    default:
      return sorted.sort(
        (left, right) => right.createdAt - left.createdAt || compareText(right.id, left.id),
      );
  }
}

/** Number of artifacts matching each pill; the pills never depend on each other. */
export function libraryArtifactCounts(
  artifacts: readonly LibraryArtifact[],
): Record<LibraryFilterId, number> {
  const counts = {
    all: artifacts.length,
    favorites: 0,
    images: 0,
    documents: 0,
    code: 0,
    media: 0,
    others: 0,
  } satisfies Record<LibraryFilterId, number>;

  for (const artifact of artifacts) {
    for (const filter of LIBRARY_FILTER_IDS) {
      if (filter === 'all') continue;
      if (matchesLibraryFilter(artifact, filter)) counts[filter] += 1;
    }
  }
  return counts;
}

export interface LibraryQuery {
  query: string;
  filter: LibraryFilterId;
  sort: LibrarySortId;
}

/** Applies search → category → ordering, the exact order used by the page. */
export function applyLibraryQuery(
  artifacts: readonly LibraryArtifact[],
  { query, filter, sort }: LibraryQuery,
): LibraryArtifact[] {
  const searched = searchLibraryArtifacts(artifacts, query);
  const filtered = searched.filter((artifact) => matchesLibraryFilter(artifact, filter));
  return sortLibraryArtifacts(filtered, sort);
}

/** Short creation date for card footers and dialog badges. */
export function formatLibraryDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return formatDate(
    date,
    sameYear
      ? { day: '2-digit', month: 'short' }
      : { day: '2-digit', month: 'short', year: 'numeric' },
  );
}

/** “1 arquivo” / “3 arquivos”. */
export function pluralizeFiles(count: number): string {
  return t('library:view.count', { count });
}

/** “1 arquivo enviado” / “3 arquivos enviados”. */
export function importResultMessage(count: number): string {
  return t('library:view.import', { count });
}
