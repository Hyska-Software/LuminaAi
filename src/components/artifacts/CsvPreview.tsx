import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { isNumericCell } from './XlsxPreview';
import { parseCsv } from './csv';
import { PreviewEmpty, type ArtifactViewProps } from './previewSupport';

/**
 * CSV/TSV preview: parses the artifact text, auto-detects the delimiter
 * (`,` `;` tab `|`) and renders a scrollable table with a sticky header.
 * Numbers are right-aligned like a spreadsheet; huge files stop at 501 rows.
 */
export function CsvPreview({ content, className }: ArtifactViewProps) {
  const { t } = useTranslation('artifacts');
  const parsed = useMemo(() => parseCsv(content.content ?? ''), [content.content]);
  const header = parsed.rows[0] ?? [];
  const body = parsed.rows.slice(1);

  if (!parsed.rows.length || !header.length) {
    return <PreviewEmpty message={t('artifacts:csv.empty')} className={className} />;
  }

  const columnCount = parsed.rows.reduce((max, row) => Math.max(max, row.length), header.length);

  return (
    <div className={cn('h-full overflow-auto', className)}>
      <table className="w-full border-collapse text-left text-[12px]">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            {Array.from({ length: columnCount }, (_, index) => (
              <th
                key={index}
                scope="col"
                className="whitespace-nowrap border-b border-border px-3 py-2 font-semibold text-foreground"
              >
                {header[index] ?? ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-surface-raised even:bg-surface/40">
              {Array.from({ length: columnCount }, (_, cellIndex) => {
                const value = row[cellIndex] ?? '';
                return (
                  <td
                    key={cellIndex}
                    title={value}
                    className={cn(
                      'max-w-[280px] truncate border-b border-border px-3 py-1.5 text-foreground-muted',
                      isNumericCell(value) && 'text-right tabular-nums',
                    )}
                  >
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {parsed.truncated ? (
        <p className="border-t border-border px-3 py-2 text-[11px] text-foreground-subtle">
          {t('artifacts:csv.truncated', {
            shown: parsed.rows.length - 1,
            total: parsed.totalRows - 1,
          })}
        </p>
      ) : null}
    </div>
  );
}
