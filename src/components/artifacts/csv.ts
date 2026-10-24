/**
 * Tiny RFC-4180-ish CSV parser for artifact previews (quotes, escaped quotes,
 * CRLF). Caps the number of parsed rows so huge files cannot freeze the UI.
 */
export interface ParsedCsv {
  rows: string[][];
  truncated: boolean;
  /** Total number of parsed rows before truncation. */
  totalRows: number;
}

export function parseCsv(source: string, maxRows = 501): ParsedCsv {
  const text = source.replace(/^\uFEFF/, '');
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
    if (char === ',') {
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

  return { rows, truncated: totalRows > rows.length, totalRows };
}
