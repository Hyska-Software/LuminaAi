import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  CircleAlert,
  File,
  FileArchive,
  FileBraces,
  FileCode,
  FileCog,
  FileImage,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  Folder,
  FolderOpen,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Input, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { WorkspaceFileEntry } from '@/lib/types';

/** Row of the flattened tree rendered by `FileTree`. */
interface TreeRow {
  entry: WorkspaceFileEntry;
  /** Visual depth (0 = root). */
  depth: number;
  /** Ancestor directory paths (outermost first), used to hide collapsed subtrees. */
  ancestors: string[];
}

export interface FileTreeProps {
  /** Entries returned by `api.listWorkspaceFiles` (files and expanded dirs). */
  entries: WorkspaceFileEntry[];
  loading?: boolean;
  /** Read error shown instead of the list (`null`/omitted = no error). */
  error?: string | null;
  /** Controlled selection; when omitted the tree keeps the last selection itself. */
  selectedPath?: string | null;
  /**
   * Total files in the workspace when the backend capped the listing ("mostrando
   * X de Y"). Ignored when smaller than the visible count.
   */
  totalCount?: number;
  onSelectFile?: (path: string) => void;
  /** Fired when a directory is expanded/collapsed; the container may fetch children. */
  onToggleDir?: (path: string) => void;
  className?: string;
}

const GIT_BADGES: Record<string, { label: string; className: string }> = {
  M: { label: 'Modificado', className: 'text-warning' },
  A: { label: 'Adicionado', className: 'text-success' },
  D: { label: 'Removido', className: 'text-danger' },
  R: { label: 'Renomeado', className: 'text-accent' },
  C: { label: 'Copiado', className: 'text-accent' },
  U: { label: 'Com conflito', className: 'text-danger' },
  '?': { label: 'Não rastreado', className: 'text-foreground-subtle' },
  '!': { label: 'Ignorado', className: 'text-foreground-subtle' },
};

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt', 'kts', 'rb', 'php', 'cs',
  'c', 'h', 'cc', 'cpp', 'hpp', 'swift', 'scala', 'dart', 'lua', 'pl', 'r', 'ex', 'exs', 'hs', 'clj',
  'vue', 'svelte', 'astro', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'sql', 'graphql', 'proto',
]);
const DATA_EXTENSIONS = new Set(['json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf']);
const TEXT_EXTENSIONS = new Set(['md', 'mdx', 'txt', 'text', 'log', 'diff', 'patch']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar']);
const SHELL_EXTENSIONS = new Set(['sh', 'bash', 'zsh', 'ps1', 'pwsh', 'bat', 'cmd']);
const SHEET_EXTENSIONS = new Set(['csv', 'tsv', 'xls', 'xlsx', 'ods']);

/** Best-effort icon by extension; folders get the open/closed pair. */
function iconFor(entry: WorkspaceFileEntry, expanded: boolean): LucideIcon {
  if (entry.isDir) return expanded ? FolderOpen : Folder;
  const name = entry.name.toLowerCase();
  if (name.endsWith('.lock') || name === 'package-lock.json') return FileLock;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (CODE_EXTENSIONS.has(ext)) return FileCode;
  if (DATA_EXTENSIONS.has(ext)) return FileBraces;
  if (TEXT_EXTENSIONS.has(ext)) return FileText;
  if (IMAGE_EXTENSIONS.has(ext)) return FileImage;
  if (ARCHIVE_EXTENSIONS.has(ext)) return FileArchive;
  if (SHELL_EXTENSIONS.has(ext)) return FileTerminal;
  if (SHEET_EXTENSIONS.has(ext)) return FileSpreadsheet;
  if (ext === 'env' || name.startsWith('.env')) return FileCog;
  return File;
}

/** Recursively flattens the tree into rows; handles nested `children` and flat depth lists. */
function flatten(
  entries: WorkspaceFileEntry[],
  ancestors: string[] = [],
  parentDepth = -1,
): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const entry of entries) {
    const depth = Math.max(entry.depth ?? 0, parentDepth + 1);
    rows.push({ entry, depth, ancestors });
    if (entry.children?.length) rows.push(...flatten(entry.children, [...ancestors, entry.path], depth));
  }
  return rows;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** True when `row` is under any collapsed ancestor directory. */
function isHiddenByCollapse(row: TreeRow, collapsed: ReadonlySet<string>): boolean {
  return row.ancestors.some((path) => collapsed.has(path));
}

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

/**
 * Workspace file tree for the Code right panel (WORKBENCH §7.1/§15).
 *
 * Rendering is flattened (one DOM row per visible entry, no recursive markup),
 * which keeps thousands of entries cheap without adding a virtualization
 * dependency. Expansion is controlled by the container through `entries` +
 * `onToggleDir`; the component only tracks the user's collapsed set and the
 * roving focus, so keyboard navigation stays local. Full a11y contract:
 * `role="tree"`/`treeitem`, `aria-expanded`, `aria-selected`, ↑/↓/←/→/Home/End/Enter.
 */
export function FileTree({
  entries,
  loading = false,
  error = null,
  selectedPath,
  totalCount,
  onSelectFile,
  onToggleDir,
  className,
}: FileTreeProps) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [uncontrolledSelected, setUncontrolledSelected] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const allRows = useMemo(() => flatten(entries), [entries]);
  const selected = selectedPath !== undefined ? selectedPath : uncontrolledSelected;
  const normalizedQuery = normalize(query.trim());

  const visibleRows = useMemo(() => {
    const expandedRows = allRows.filter((row) => !isHiddenByCollapse(row, collapsed));
    if (!normalizedQuery) return expandedRows;
    return expandedRows.filter(
      (row) =>
        normalize(row.entry.name).includes(normalizedQuery) ||
        normalize(row.entry.path).includes(normalizedQuery),
    );
  }, [allRows, collapsed, normalizedQuery]);

  const collapsedRecord = collapsed;

  const setFocused = (path: string | null) => {
    setFocusedPath(path);
    if (path) rowRefs.current.get(path)?.focus();
  };

  const toggleDirectory = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    onToggleDir?.(path);
  };

  const selectFile = (path: string) => {
    if (selectedPath === undefined) setUncontrolledSelected(path);
    onSelectFile?.(path);
  };

  /** Index of the focused row inside `visibleRows` (defaults to the first row). */
  const focusedIndex = () => {
    if (!focusedPath) return -1;
    return visibleRows.findIndex((row) => row.entry.path === focusedPath);
  };

  const handleRowClick = (event: MouseEvent<HTMLDivElement>, row: TreeRow) => {
    // Let the copy/clear buttons inside the header and nested controls win.
    if (event.defaultPrevented) return;
    setFocusedPath(row.entry.path);
    if (row.entry.isDir) toggleDirectory(row.entry.path);
    else selectFile(row.entry.path);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!visibleRows.length) return;
    let index = focusedIndex();
    const current = index >= 0 ? visibleRows[index] : null;

    const focusRow = (nextIndex: number) => {
      const row = visibleRows[Math.max(0, Math.min(visibleRows.length - 1, nextIndex))];
      if (row) setFocused(row.entry.path);
    };

    switch (event.key) {
      case 'ArrowDown':
        if (index < 0) focusRow(0);
        else focusRow(index + 1);
        break;
      case 'ArrowUp':
        if (index < 0) focusRow(visibleRows.length - 1);
        else focusRow(index - 1);
        break;
      case 'Home':
        focusRow(0);
        break;
      case 'End':
        focusRow(visibleRows.length - 1);
        break;
      case 'ArrowRight': {
        if (!current) return;
        if (current.entry.isDir) {
          if (collapsedRecord.has(current.entry.path)) toggleDirectory(current.entry.path);
          else if (index + 1 < visibleRows.length && visibleRows[index + 1].depth > current.depth) {
            focusRow(index + 1);
          }
        }
        break;
      }
      case 'ArrowLeft': {
        if (!current) return;
        if (current.entry.isDir && !collapsedRecord.has(current.entry.path)) {
          toggleDirectory(current.entry.path);
        } else if (current.depth > 0) {
          /* Focus the nearest ancestor row. */
          for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
            if (visibleRows[cursor].depth < current.depth) {
              focusRow(cursor);
              break;
            }
          }
        }
        break;
      }
      case 'Enter':
      case ' ': {
        if (!current) return;
        if (current.entry.isDir) toggleDirectory(current.entry.path);
        else selectFile(current.entry.path);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  const treeTabIndex = (path: string): number => {
    if (focusedPath === path) return 0;
    if (focusedPath === null && visibleRows[0]?.entry.path === path) return 0;
    return -1;
  };

  const visibleFileCount = visibleRows.length;
  const total = totalCount != null && totalCount > 0 ? totalCount : allRows.length;
  const showCount = total > 0 && (normalizedQuery.length > 0 || visibleFileCount < total);

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-foreground-subtle"
            strokeWidth={1.75}
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filtrar arquivos…"
            aria-label="Filtrar arquivos"
            className="h-8 pl-7 pr-7 text-[12px]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Limpar filtro"
              className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-foreground-subtle transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <X aria-hidden className="size-3.5" strokeWidth={2} />
            </button>
          ) : null}
        </div>
        {loading ? <Spinner size="xs" label="Carregando arquivos" /> : null}
      </div>

      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
          <span className="flex size-9 items-center justify-center rounded-xl border border-danger/30 bg-danger-soft text-danger">
            <CircleAlert aria-hidden className="size-4" strokeWidth={1.75} />
          </span>
          <p className="text-[12.5px] font-medium text-foreground">Não foi possível ler a pasta</p>
          <p className="max-w-64 text-[12px] leading-relaxed text-foreground-muted">{error}</p>
        </div>
      ) : loading && entries.length === 0 ? (
        <div role="status" aria-label="Carregando a árvore" className="flex-1 space-y-1.5 p-2">
          {SKELETON_ROWS.map((row) => (
            <div
              key={row}
              className="h-6 animate-pulse rounded-md bg-surface-hover motion-reduce:animate-none"
              style={{ width: `${88 - row * 9}%` }}
            />
          ))}
        </div>
      ) : visibleFileCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
          <Folder aria-hidden className="size-5 text-foreground-subtle" strokeWidth={1.75} />
          <p className="text-[12.5px] font-medium text-foreground">
            {normalizedQuery ? 'Nenhum arquivo corresponde à busca' : 'Nenhum arquivo para mostrar'}
          </p>
          <p className="max-w-64 text-[12px] leading-relaxed text-foreground-muted">
            {normalizedQuery
              ? 'Refine a busca ou limpe o filtro para ver a árvore.'
              : 'A árvore do workspace aparece aqui quando a pasta estiver disponível.'}
          </p>
        </div>
      ) : (
        <div
          role="tree"
          aria-label="Árvore de arquivos do workspace"
          aria-busy={loading || undefined}
          onKeyDown={handleKeyDown}
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {visibleRows.map((row) => {
            const { entry, depth } = row;
            const expanded = entry.isDir && !!entry.children?.length && !collapsedRecord.has(entry.path);
            const hasChildren = !!entry.children?.length;
            const isSelected = !entry.isDir && selected === entry.path;
            const badge = entry.gitStatus ? GIT_BADGES[entry.gitStatus] : undefined;
            const Icon = iconFor(entry, expanded);
            return (
              <div
                key={entry.path}
                ref={(node) => {
                  if (node) rowRefs.current.set(entry.path, node);
                  else rowRefs.current.delete(entry.path);
                }}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={isSelected}
                aria-expanded={entry.isDir ? hasChildren && expanded : undefined}
                tabIndex={treeTabIndex(entry.path)}
                onClick={(event) => handleRowClick(event, row)}
                onFocus={() => setFocusedPath(entry.path)}
                style={{ paddingLeft: 8 + depth * 12 }}
                className={cn(
                  'group flex h-7 cursor-pointer select-none items-center gap-1.5 pr-2 text-[12.5px] outline-none',
                  'transition-colors duration-150 motion-reduce:transition-none',
                  isSelected
                    ? 'bg-accent-soft text-foreground'
                    : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
                  'focus-visible:bg-surface-hover focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
                )}
              >
                {entry.isDir ? (
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-3.5 shrink-0 items-center justify-center text-foreground-subtle transition-transform duration-150 motion-reduce:transition-none',
                      expanded && 'rotate-90',
                    )}
                  >
                    <svg viewBox="0 0 16 16" fill="none" className="size-3">
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                ) : (
                  <span aria-hidden className="w-3.5 shrink-0" />
                )}
                <Icon
                  aria-hidden
                  className={cn('size-3.5 shrink-0', entry.isDir ? 'text-accent' : 'text-foreground-subtle')}
                  strokeWidth={1.75}
                />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {badge ? (
                  <span
                    aria-label={`Estado no Git: ${badge.label}`}
                    title={`Estado no Git: ${badge.label}`}
                    className={cn('shrink-0 font-mono text-[11px] font-semibold', badge.className)}
                  >
                    {entry.gitStatus}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {showCount ? (
        <div
          role="status"
          className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] tabular-nums text-foreground-subtle"
        >
          Mostrando {visibleFileCount} de {total} arquivos — refine a busca
        </div>
      ) : null}
    </div>
  );
}

export default FileTree;
