import {
  Download,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryArtifact } from '@/lib/types';
import { cn, formatBytes } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '@/components/ui';
import { artifactKindMeta } from '@/components/artifacts/kinds';
import { formatLibraryDate, libraryArtifactOrigin } from './filters';
import { LibraryThumbnail } from './LibraryThumbnail';

export interface LibraryCardActions {
  onOpen: () => void;
  onToggleFavorite: () => void;
  onRename: () => void;
  onSave: () => void;
  onOpenExternal: () => void;
  onDelete: () => void;
}

export interface LibraryCardProps extends LibraryCardActions {
  artifact: LibraryArtifact;
}

interface FavoriteButtonProps {
  artifact: LibraryArtifact;
  onClick: () => void;
  className?: string;
}

function FavoriteButton({ artifact, onClick, className }: FavoriteButtonProps) {
  const { t } = useTranslation('library');
  const favorite = artifact.favorite === true;
  return (
    <IconButton
      label={
        favorite
          ? t('library:card.unfavorite', { name: artifact.name })
          : t('library:card.favorite', { name: artifact.name })
      }
      size="sm"
      active={favorite}
      onClick={onClick}
      className={cn(
        'text-foreground-subtle',
        favorite
          ? 'text-accent'
          : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
        className,
      )}
    >
      <Star
        aria-hidden
        className="size-4"
        strokeWidth={1.9}
        fill={favorite ? 'currentColor' : 'none'}
      />
    </IconButton>
  );
}

function ActionsMenu({ artifact, actions }: { artifact: LibraryArtifact; actions: LibraryCardActions }) {
  const { t } = useTranslation('library');
  const favorite = artifact.favorite === true;
  const item = (label: string, icon: ReactNode, onSelect: () => void, danger = false) => (
    <DropdownMenuItem
      icon={icon}
      variant={danger ? 'danger' : 'default'}
      onSelect={onSelect}
    >
      {label}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={t('library:card.actionsAria', { name: artifact.name })}
          size="sm"
          className="text-foreground-subtle"
        >
          <MoreHorizontal aria-hidden className="size-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel className="max-w-52 truncate normal-case tracking-normal text-foreground-muted">
          {artifact.name}
        </DropdownMenuLabel>
        {item(t('library:card.rename'), <Pencil aria-hidden />, actions.onRename)}
        {item(
          favorite ? t('library:card.unfavoriteAction') : t('library:card.favoriteAction'),
          favorite ? <StarOff aria-hidden /> : <Star aria-hidden />,
          actions.onToggleFavorite,
        )}
        {item(t('library:card.saveAs'), <Download aria-hidden />, actions.onSave)}
        {item(t('library:card.open'), <ExternalLink aria-hidden />, actions.onOpenExternal)}
        <DropdownMenuSeparator />
        {item(t('library:card.delete'), <Trash2 aria-hidden />, actions.onDelete, true)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Grid card (PLAN §4.2): type tile, two-line name, favorite star + actions menu
 * on the corner, thumbnail for images (or the big kind icon) and a footer with
 * kind · size, short date and origin. The whole card is a button; the corner
 * controls are siblings layered above it, so no interactive element is nested.
 */
export function LibraryCard({ artifact, ...actions }: LibraryCardProps) {
  const { t } = useTranslation('library');
  const meta = artifactKindMeta(artifact.kind);
  const Icon = meta.icon;
  const origin = libraryArtifactOrigin(artifact);

  return (
    <li className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl bg-surface-hover transition-colors duration-150 ">
      <button
        type="button"
        onClick={actions.onOpen}
        aria-label={t('library:card.openAria', {
          name: artifact.name,
          kind: meta.label,
          origin,
        })}
        className="flex min-w-0 flex-1 flex-col rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        <span className="flex items-start gap-2 pb-2 pl-3 pr-16 pt-3">
          <span
            aria-hidden
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg',
              meta.tone,
            )}
          >
            <Icon className="size-4" strokeWidth={1.9} />
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-medium leading-snug tracking-tight text-foreground">
            {artifact.name}
          </span>
        </span>

        <span className="flex h-28 w-full items-center justify-center overflow-hidden px-3">
          <LibraryThumbnail artifact={artifact} className="size-full" />
        </span>

        <span className="mt-auto flex flex-col gap-1 border-t border-border px-3 py-2">
          <span className="flex items-baseline justify-between gap-2 text-[11px] leading-snug text-foreground-muted">
            <span className="min-w-0 truncate">
              {meta.label} · <span className="tabular-nums">{formatBytes(artifact.size)}</span>
            </span>
            <span className="shrink-0 text-foreground-subtle">
              {formatLibraryDate(artifact.createdAt)}
            </span>
          </span>
          <span className="truncate text-[11px] leading-snug text-foreground-subtle" title={origin}>
            {origin}
          </span>
        </span>
      </button>

      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
        <FavoriteButton artifact={artifact} onClick={actions.onToggleFavorite} />
        <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <ActionsMenu artifact={artifact} actions={actions} />
        </span>
      </div>
    </li>
  );
}

/** List row (PLAN §4.2): same information as the card, laid out horizontally. */
export function LibraryRow({ artifact, ...actions }: LibraryCardProps) {
  const { t } = useTranslation('library');
  const meta = artifactKindMeta(artifact.kind);
  const Icon = meta.icon;
  const origin = libraryArtifactOrigin(artifact);

  return (
    <li className="group relative flex min-w-0 items-center gap-2 rounded-xl bg-surface-hover px-2 py-2 transition-colors duration-150 ">
      <button
        type="button"
        onClick={actions.onOpen}
        aria-label={t('library:card.openAria', {
          name: artifact.name,
          kind: meta.label,
          origin,
        })}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span
          aria-hidden
          className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', meta.tone)}
        >
          <Icon className="size-4" strokeWidth={1.9} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium leading-snug tracking-tight text-foreground">
            {artifact.name}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-snug text-foreground-subtle">
            <span className="shrink-0">{meta.label}</span>
            <span aria-hidden>·</span>
            <span className="truncate" title={origin}>
              {origin}
            </span>
          </span>
        </span>
        <span className="hidden shrink-0 flex-col items-end gap-0.5 text-[11px] leading-snug text-foreground-subtle sm:flex">
          <span className="tabular-nums">{formatBytes(artifact.size)}</span>
          <span>{formatLibraryDate(artifact.createdAt)}</span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        <FavoriteButton artifact={artifact} onClick={actions.onToggleFavorite} />
        <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <ActionsMenu artifact={artifact} actions={actions} />
        </span>
      </div>
    </li>
  );
}

/** Placeholder card shown while the library loads (keeps the grid from jumping). */
export function LibraryCardSkeleton() {
  return (
    <li
      aria-hidden
      className="flex h-52 flex-col overflow-hidden rounded-xl bg-surface-hover"
    >
      <span className="mx-3 mt-3 h-4 w-2/3 rounded bg-surface-hover animate-pulse motion-reduce:animate-none" />
      <span className="mx-3 mt-3 h-24 rounded-lg bg-surface-hover animate-pulse motion-reduce:animate-none" />
      <span className="mx-3 mt-3 h-3 w-1/2 rounded bg-surface-hover animate-pulse motion-reduce:animate-none" />
    </li>
  );
}

export default LibraryCard;
