import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Copy, FileExclamationPoint } from 'lucide-react';
import { Highlight } from 'prism-react-renderer';
import { Spinner } from '@/components/ui';
import { prism, SYNTAX_THEME } from '@/lib/highlight';
import { cn, copyText } from '@/lib/utils';
import { toast } from 'sonner';
import { languageForPath } from './FilePreview';

export interface DiffViewProps {
  /** Path shown in the header (relative to the workspace). */
  path: string;
  /** Unified diff (`git diff` output). Empty/omitted means "no differences". */
  diff?: string | null;
  loading?: boolean;
  error?: string | null;
  /** Forces the binary card when the backend already knows there is no text diff. */
  binary?: boolean;
  className?: string;
}

type DiffLineKind = 'context' | 'add' | 'remove' | 'meta' | 'note';

interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface ParsedDiff {
  meta: DiffLine[];
  hunks: DiffHunk[];
  added: number;
  removed: number;
  binary: boolean;
}

/** Hunks above this size start collapsed (WORKBENCH §7.2/§15). */
export const BIG_HUNK_THRESHOLD = 200;
/** Number of lines visible when a big hunk is collapsed. */
export const COLLAPSED_HUNK_LINES = 40;
/**
 * Teto de linhas para o syntax highlight: acima disso o diff continua legível
 * em texto puro (evita tokenizar milhares de linhas ao expandir um hunk).
 */
export const SYNTAX_HIGHLIGHT_LINE_LIMIT = 4_000;

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseDiff(raw: string): ParsedDiff {
  const parsed: ParsedDiff = { meta: [], hunks: [], added: 0, removed: 0, binary: false };
  let current: DiffHunk | null = null;
  let oldNumber: number | undefined;
  let newNumber: number | undefined;

  for (const text of raw.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^Binary files .* differ$/.test(text) || text.startsWith('GIT binary patch')) {
      parsed.binary = true;
      parsed.meta.push({ kind: 'meta', text });
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(text);
    if (hunkMatch) {
      oldNumber = Number.parseInt(hunkMatch[1], 10);
      newNumber = Number.parseInt(hunkMatch[3], 10);
      current = { header: text, lines: [] };
      parsed.hunks.push(current);
      continue;
    }

    if (
      text.startsWith('diff --git ') ||
      text.startsWith('index ') ||
      text.startsWith('--- ') ||
      text.startsWith('+++ ') ||
      text.startsWith('new file mode') ||
      text.startsWith('deleted file mode') ||
      text.startsWith('old mode') ||
      text.startsWith('new mode') ||
      text.startsWith('similarity index') ||
      text.startsWith('rename from') ||
      text.startsWith('rename to')
    ) {
      parsed.meta.push({ kind: 'meta', text });
      continue;
    }

    if (!current) continue;

    if (text.startsWith('\\')) {
      current.lines.push({ kind: 'note', text });
      continue;
    }

    if (text.startsWith('+')) {
      current.lines.push({ kind: 'add', text: text.slice(1), newNumber });
      parsed.added += 1;
      if (newNumber !== undefined) newNumber += 1;
      continue;
    }

    if (text.startsWith('-')) {
      current.lines.push({ kind: 'remove', text: text.slice(1), oldNumber });
      parsed.removed += 1;
      if (oldNumber !== undefined) oldNumber += 1;
      continue;
    }

    current.lines.push({ kind: 'context', text: text.startsWith(' ') ? text.slice(1) : text, oldNumber, newNumber });
    if (oldNumber !== undefined) oldNumber += 1;
    if (newNumber !== undefined) newNumber += 1;
  }

  return parsed;
}

/**
 * Unified diff viewer for the Code panel (WORKBENCH §7.2/§15).
 *
 * Parses the raw `git diff` string into hunks with both line numbers (old/new),
 * renders additions/removals on the theme tokens (`bg-success-soft` /
 * `bg-danger-soft`) and collapses hunks over 200 lines behind "ver mais".
 * Binary/large/empty diffs have honest states instead of a fake patch.
 */
export function DiffView({ path, diff, loading, error, binary = false, className }: DiffViewProps) {
  const [copied, setCopied] = useState(false);
  const [expandedHunks, setExpandedHunks] = useState<ReadonlySet<number>>(() => new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parsed = useMemo(() => parseDiff(diff ?? ''), [diff]);
  const isBinary = binary || parsed.binary;
  const hasChanges = parsed.hunks.length > 0;
  const language = useMemo(() => {
    const detected = languageForPath(path);
    // Gramática ausente no Prism compartilhado → texto puro (sem quebrar a linha).
    return prism.languages[detected] ? detected : 'text';
  }, [path]);
  const totalLines = useMemo(
    () => parsed.hunks.reduce((total, hunk) => total + hunk.lines.length, 0),
    [parsed],
  );
  // Guarda de custo: diffs gigantes continuam em texto puro (hunks recolhidos
  // já limitam a renderização, mas um "ver mais" pode abrir milhares de linhas).
  const highlightEnabled = language !== 'text' && totalLines <= SYNTAX_HIGHLIGHT_LINE_LIMIT;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /* New diff resets the transient feedback and the expansion state. */
  useEffect(() => {
    setCopied(false);
    setExpandedHunks(new Set());
  }, [diff]);

  const toggleHunk = (index: number) => {
    setExpandedHunks((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleCopyPatch = async () => {
    const ok = await copyText(diff ?? '');
    if (!ok) {
      toast.error('Não foi possível copiar o patch');
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground" title={path}>
          {path}
        </span>
        {loading ? <Spinner size="xs" label="Carregando diff" /> : null}
        {hasChanges ? (
          <>
            <span className="shrink-0 text-[11.5px] tabular-nums">
              <span className="text-success">+{parsed.added}</span>{' '}
              <span className="text-danger">−{parsed.removed}</span>
            </span>
            <button
              type="button"
              onClick={() => void handleCopyPatch()}
              aria-label={copied ? 'Patch copiado' : 'Copiar patch'}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Copy aria-hidden={false} className={cn('size-3.5', copied && 'text-success')} strokeWidth={1.75} />
            </button>
          </>
        ) : null}
      </div>

      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
          <span className="flex size-9 items-center justify-center rounded-xl border border-danger/30 bg-danger-soft text-danger">
            <CircleAlert aria-hidden className="size-4" strokeWidth={1.75} />
          </span>
          <p className="text-[12.5px] font-medium text-foreground">Não foi possível carregar o diff</p>
          <p className="max-w-64 text-[12px] leading-relaxed text-foreground-muted">{error}</p>
        </div>
      ) : loading && !diff ? (
        <div aria-hidden className="flex-1 space-y-2 p-3">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div
              key={row}
              className="h-3 animate-pulse rounded bg-surface-hover motion-reduce:animate-none"
              style={{ width: `${92 - row * 10}%` }}
            />
          ))}
        </div>
      ) : isBinary ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
          <span className="flex size-9 items-center justify-center rounded-xl border border-border bg-surface-hover text-foreground-muted">
            <FileExclamationPoint aria-hidden className="size-4" strokeWidth={1.75} />
          </span>
          <p className="text-[12.5px] font-medium text-foreground">Arquivo binário</p>
          <p className="max-w-64 text-[12px] leading-relaxed text-foreground-muted">
            Este arquivo não tem diff de texto. Abra no editor externo para revisar a alteração.
          </p>
        </div>
      ) : !hasChanges ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
          <p className="text-[12.5px] font-medium text-foreground">Sem diferenças para mostrar</p>
          <p className="max-w-64 text-[12px] leading-relaxed text-foreground-muted">
            O arquivo não tem alterações de texto pendentes.
          </p>
        </div>
      ) : (
        <div
          role="group"
          aria-label={`Diff de ${path}`}
          className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[12px] leading-[1.7]"
        >
          {parsed.meta.map((line, index) => (
            <div key={`meta-${index}`} className="truncate px-3 text-[11.5px] text-foreground-subtle">
              {line.text}
            </div>
          ))}

          {parsed.hunks.map((hunk, hunkIndex) => {
            const big = hunk.lines.length > BIG_HUNK_THRESHOLD;
            const expanded = expandedHunks.has(hunkIndex);
            const visible = big && !expanded ? hunk.lines.slice(0, COLLAPSED_HUNK_LINES) : hunk.lines;
            const hidden = hunk.lines.length - visible.length;

            return (
              <div key={`hunk-${hunkIndex}`} className="mt-2 first:mt-0">
                <div
                  tabIndex={0}
                  aria-label={`Trecho do diff: ${hunk.header}`}
                  className="sticky left-0 select-none bg-accent-soft px-3 py-1 text-[11.5px] text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                >
                  {hunk.header}
                </div>

                {visible.map((line, lineIndex) => (
                  <DiffLineRow
                    key={`${hunkIndex}-${lineIndex}`}
                    line={line}
                    language={highlightEnabled ? language : 'text'}
                  />
                ))}

                {big ? (
                  <div className="border-y border-border bg-surface px-3 py-1">
                    <button
                      type="button"
                      onClick={() => toggleHunk(hunkIndex)}
                      aria-expanded={expanded}
                      className="text-[11.5px] font-medium text-accent transition-colors duration-150 hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      {expanded
                        ? 'Recolher trecho'
                        : `Ver mais (${hidden} ${hidden === 1 ? 'linha' : 'linhas'})`}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const LINE_STYLES: Record<DiffLineKind, string> = {
  add: 'bg-success-soft text-foreground',
  remove: 'bg-danger-soft text-foreground',
  context: 'text-foreground-muted',
  note: 'text-foreground-subtle italic',
  meta: 'text-foreground-subtle',
};

const DiffLineRow = memo(function DiffLineRow({
  line,
  language,
}: {
  line: DiffLine;
  language: string;
}) {
  const numberClass =
    'w-10 shrink-0 select-none pr-2 text-right text-[10.5px] tabular-nums text-foreground-subtle';
  const prefix =
    line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : line.kind === 'context' ? ' ' : '';

  if (line.kind === 'note') {
    return <div className="px-3 text-[11px] text-foreground-subtle">{line.text}</div>;
  }

  const content = line.text || '\u00A0';
  const highlighted = language !== 'text';

  return (
    <div className={cn('flex min-h-[20px] items-start', LINE_STYLES[line.kind])}>
      <span aria-hidden className={numberClass}>
        {line.oldNumber ?? ''}
      </span>
      <span aria-hidden className={numberClass}>
        {line.newNumber ?? ''}
      </span>
      <span aria-hidden className="w-4 shrink-0 select-none text-center text-foreground-subtle">
        {prefix}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-3">
        {highlighted ? (
          <Highlight prism={prism} theme={SYNTAX_THEME} language={language} code={content}>
            {({ tokens, getTokenProps }) => (
              <>
                {(tokens[0] ?? []).map((token, tokenIndex) => (
                  <span key={tokenIndex} {...getTokenProps({ token })} />
                ))}
              </>
            )}
          </Highlight>
        ) : (
          content
        )}
      </span>
    </div>
  );
});

export default DiffView;
