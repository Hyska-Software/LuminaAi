import { FILE_ICON_SVG } from '@/lib/fileIconAssets';
import { fileIconKeyFor } from '@/lib/fileIcons';
import { cn } from '@/lib/utils';

export interface FileIconProps {
  /** Workspace path or bare file name; resolved by `fileIconKeyFor` (never throws). */
  path: string;
  /** Extra classes merged after the accessible-size defaults (e.g. `size-3.5`). */
  className?: string;
}

/**
 * Colored file-type glyph of the Code workbench (file tree, preview header,
 * changes list). The SVG is a **trusted internal constant** bundled from
 * `material-icon-theme` (MIT) — never user input — so it can be injected
 * inline. The marks already carry the type's brand color: never tint them with
 * `text-*` tokens (folders keep the mono lucide `Folder`/`FolderOpen` pair).
 *
 * Decorative by design: the file name is always adjacent, so the icon is
 * `aria-hidden` and carries `data-file-icon` for tests/inspection.
 */
export function FileIcon({ path, className }: FileIconProps) {
  const icon = fileIconKeyFor(path);
  return (
    <span
      aria-hidden
      data-file-icon={icon}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center [&>svg]:block [&>svg]:size-full',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: FILE_ICON_SVG[icon] }}
    />
  );
}

export default FileIcon;
