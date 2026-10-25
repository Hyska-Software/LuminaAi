/**
 * Tiny RFC-4180-ish CSV parser for artifact previews (quotes, escaped quotes,
 * CRLF). Caps the number of parsed rows so huge files cannot freeze the UI.
 *
 * The delimiter is auto-detected from the first record among `,` `;` `\t` `|`
 * so TSV files and semicolon-separated exports (common in pt-BR locales) also
 * render as tables. Quoted fields are respected by the heuristic: a comma
 * inside a quoted value never wins over a real semicolon separator.
 */
export interface ParsedCsv {
  rows: string[][];
  truncated: boolean;
  /** Total number of parsed rows before truncation. */
  totalRows: number;
  /** Delimiter that produced `rows` (auto-detected unless explicitly given). */
  delimiter: string;
}

/** Candidates for the delimiter heuristic, in priority order for ties. */
export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;

export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

export const CSV_DEFAULT_DELIMITER: CsvDelimiter = ',';

const MAX_HEADER_PROBE_RECORDS = 20;

/** Removes a UTF-8 BOM so it does not end up glued to the first header cell. */
function stripBom(source: string): string {
  return source.replace(/^\uFEFF/, '');
}

/** Number of delimiter occurrences in `record` that are not inside quotes. */
function countDelimitersOutsideQuotes(record: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (let index = 0; index < record.length; index += 1) {
    const char = record[index];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) count += 1;
  }
  return count;
}

/** Splits a text into logical records (line breaks outside quotes). */
function logicalRecords(text: string): string[] {
  const records: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (current.length > 0) records.push(current);
      current = '';
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      continue;
    }
    current += char;
  }
  if (current.length > 0) records.push(current);
  return records;
}

/**
 * Picks the delimiter that yields the most columns on the first record with at
 * least two columns. Falls back to `,` when no candidate splits the content.
 */
export function detectDelimiter(source: string): CsvDelimiter {
  const text = stripBom(source);
  const records = logicalRecords(text).slice(0, MAX_HEADER_PROBE_RECORDS);
  for (const record of records) {
    let best: CsvDelimiter | null = null;
    let bestOccurrences = 0;
    for (const candidate of CSV_DELIMITERS) {
      const occurrences = countDelimitersOutsideQuotes(record, candidate);
      if (occurrences === 0) continue;
      // More occurrences = more columns; ties keep the priority order above.
      if (occurrences > bestOccurrences) {
        best = candidate;
        bestOccurrences = occurrences;
      }
    }
    if (best) return best;
  }
  return CSV_DEFAULT_DELIMITER;
}

function resolveDelimiter(source: string, delimiter?: string | null): string {
  if (delimiter && delimiter.length > 0) return delimiter;
  return detectDelimiter(source);
}

/**
 * Parses `source` into rows. `maxRows` caps the returned rows (the caller shows
 * a truncation notice); `delimiter` skips auto-detection when already known.
 */
export function parseCsv(source: string, maxRows = 501, delimiter?: string | null): ParsedCsv {
  const text = stripBom(source);
  const selected = resolveDelimiter(text, delimiter);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let totalRows = 0;

  const pushRow = () => {
    row.push(field);
    totalRows += 1;
    if (rows.length < maxRows) rows.push(row);
    row = [];
    field = '';
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === selected) {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      pushRow();
      continue;
    }
    if (char === '\r') continue;
    field += char;
  }

  if (field !== '' || row.length > 0) pushRow();

  return { rows, truncated: totalRows > rows.length, totalRows, delimiter: selected };
}
