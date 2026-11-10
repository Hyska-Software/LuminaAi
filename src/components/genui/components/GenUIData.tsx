import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { asStringArray, chartFromProps, propArray, propString, type GenUIValue } from '@/lib/genui/schema';
import { ChartSvg } from '../ChartSvg';
import type { GenUINodeProps } from './GenUILayout';

/* ------------------------------- table ------------------------------- */

export function GenUITable({ props }: GenUINodeProps) {
  const { t } = useTranslation('genui');
  const columns = asStringArray(props?.columns);
  const rows = propArray(props, 'rows') ?? [];
  const caption = propString(props, 'caption');

  if (!columns.length || !rows.length) {
    return (
      <p className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs text-foreground-subtle">
        {t('table.empty')}
      </p>
    );
  }

  const header = columns.length ? columns : asStringArray(rows[0]);

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full border-collapse text-left text-[12.5px]">
          {caption ? <caption className="px-3 py-2 text-left text-[11px] text-foreground-subtle">{caption}</caption> : null}
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              {header.map((column, index) => (
                <th
                  key={`${column}-${index}`}
                  scope="col"
                  className="whitespace-nowrap border-b border-border px-3 py-2 font-semibold text-foreground"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const cells = Array.isArray(row) ? row : [];
              return (
                <tr key={rowIndex} className="odd:bg-surface-raised even:bg-surface/50">
                  {header.map((_, cellIndex) => {
                    const cell = cells[cellIndex];
                    const text =
                      typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean'
                        ? String(cell)
                        : '';
                    return (
                      <td key={cellIndex} className="border-b border-border px-3 py-2 align-top text-foreground-muted last:border-b-0">
                        {text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------- chart ------------------------------- */

export function GenUIChart({ props }: GenUINodeProps) {
  const { t } = useTranslation('genui');
  const { chart, error } = chartFromProps(props);
  const title = propString(props, 'title') || chart?.title;

  if (!chart) {
    return (
      <div className="rounded-xl border border-border bg-surface px-3 py-2.5 text-xs text-foreground-subtle">
        {error ?? t('chart.invalid')}
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border border-border bg-surface-raised p-3.5')}>
      {title ? <h4 className="mb-3 text-[12.5px] font-semibold tracking-tight text-foreground">{title}</h4> : null}
      <ChartSvg spec={{ ...chart, title: chart.title ?? title }} />
    </div>
  );
}
