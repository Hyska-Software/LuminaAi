/**
 * Unified-diff parsing shared by the diff viewer (`DiffView`) and the inline
 * decorations of the Code file tab (`FilePreview`).
 *
 * The parser is intentionally dependency-free: it understands the subset of
 * `git diff` output produced by the backend (`diff --git` headers, hunks and
 * context/add/remove/note lines) and ignores everything else.
 */

export type DiffLineKind = 'context' | 'add' | 'remove' | 'meta' | 'note';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
  /** First line number on the new side; 0 for a pure-removal hunk (`+0,0`). */
  newStart: number;
}

export interface ParsedDiff {
  meta: DiffLine[];
  hunks: DiffHunk[];
  added: number;
  removed: number;
  binary: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses a unified diff. File headers (`---`/`+++`) are meta only outside a
 * hunk; inside a hunk they are content lines whose text starts with `--`/`++`.
 * The final empty string produced by splitting a trailing newline is ignored,
 * so it never becomes a phantom context line.
 */
export function parseUnifiedDiff(raw: string): ParsedDiff {
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
      current = { header: text, lines: [], newStart: newNumber };
      parsed.hunks.push(current);
      continue;
    }

    if (text.startsWith('diff --git ')) {
      current = null;
      parsed.meta.push({ kind: 'meta', text });
      continue;
    }

    if (
      text.startsWith('index ') ||
      text.startsWith('new file mode') ||
      text.startsWith('deleted file mode') ||
      text.startsWith('old mode') ||
      text.startsWith('new mode') ||
      text.startsWith('similarity index') ||
      text.startsWith('rename from') ||
      text.startsWith('rename to') ||
      (current === null && (text.startsWith('--- ') || text.startsWith('+++ ')))
    ) {
      parsed.meta.push({ kind: 'meta', text });
      continue;
    }

    // Artifact of splitting a trailing newline; a real empty context line is a
    // single space (` `), never an empty string.
    if (text === '') continue;
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

    current.lines.push({
      kind: 'context',
      text: text.startsWith(' ') ? text.slice(1) : text,
      oldNumber,
      newNumber,
    });
    if (oldNumber !== undefined) oldNumber += 1;
    if (newNumber !== undefined) newNumber += 1;
  }

  return parsed;
}

export type InlineDiffTone = 'added' | 'modified';

export interface InlineDiff {
  /** 1-based new-file line → tone. */
  lineTones: ReadonlyMap<number, InlineDiffTone>;
  /** 1-based new-file line before which lines were removed; value = count. */
  deletions: ReadonlyMap<number, number>;
  added: number;
  removed: number;
  binary: boolean;
}

/** Last line number present on the new side of a hunk. */
function lastNewNumber(lines: readonly DiffLine[]): number | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const number = lines[index].newNumber;
    if (number !== undefined) return number;
  }
  return undefined;
}

/** First context line after `from` that has a new-side line number. */
function nextContextNewNumber(
  lines: readonly DiffLine[],
  from: number,
): number | undefined {
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.kind === 'context' && line.newNumber !== undefined) return line.newNumber;
  }
  return undefined;
}

/**
 * Turns a unified diff into the decorations of the current file content.
 *
 * A contiguous add/remove block is a replacement: the first `min(added,
 * removed)` added lines are `modified` (yellow) and the remaining additions are
 * `added` (green). Removed lines never carry content; they become a single
 * insertion point (red arrow) before the first new line of the block, before
 * the next context line, or at the end of the hunk.
 */
export function buildInlineDiff(raw: string, lineCount: number): InlineDiff {
  const parsed = parseUnifiedDiff(raw);
  const lineTones = new Map<number, InlineDiffTone>();
  const deletions = new Map<number, number>();
  const maxLine = Math.max(0, lineCount);

  for (const hunk of parsed.hunks) {
    let index = 0;
    while (index < hunk.lines.length) {
      const line = hunk.lines[index];
      if (line.kind !== 'add' && line.kind !== 'remove') {
        index += 1;
        continue;
      }

      const block: DiffLine[] = [];
      while (
        index < hunk.lines.length &&
        (hunk.lines[index].kind === 'add' || hunk.lines[index].kind === 'remove')
      ) {
        block.push(hunk.lines[index]);
        index += 1;
      }

      const addedLines = block.filter((entry) => entry.kind === 'add');
      const removedCount = block.length - addedLines.length;
      const paired = Math.min(addedLines.length, removedCount);

      addedLines.forEach((entry, addedIndex) => {
        const newNumber = entry.newNumber;
        if (newNumber === undefined || newNumber > maxLine) return;
        lineTones.set(newNumber, addedIndex < paired ? 'modified' : 'added');
      });

      if (removedCount === 0) continue;

      const lastNew = lastNewNumber(hunk.lines);
      const before =
        addedLines.find((entry) => entry.newNumber !== undefined)?.newNumber ??
        nextContextNewNumber(hunk.lines, index) ??
        (lastNew !== undefined ? lastNew + 1 : undefined) ??
        hunk.newStart + 1;

      const point = Math.min(Math.max(before, 1), maxLine + 1);
      deletions.set(point, (deletions.get(point) ?? 0) + removedCount);
    }
  }

  return {
    lineTones,
    deletions,
    added: parsed.added,
    removed: parsed.removed,
    binary: parsed.binary,
  };
}
