import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import type { SheetPreview } from '@/lib/types';
import { cn } from '@/lib/utils';
import { BinaryPreview } from './BinaryPreview';
import {
  PreviewEmpty,
  PreviewError,
  PreviewLoading,
  useArtifactPreview,
  type ArtifactViewProps,
} from './previewSupport';

const NUMERIC_CELL =
  /^[+-]?(?:\d{1,3}(?:[.\s]\d{3})+|\d+)(?:[.,]\d+)?%?$/;

/** Formats the backend sends are plain strings; align numbers to the right like a spreadsheet. */
export function isNumericCell(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && NUMERIC_CELL.test(trimmed);
}

function SheetGrid({ sheet }: { sheet: SheetPreview }) {
  const columnCount = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const header = sheet.rows[0] ?? [];
  const body = sheet.rows.slice(1);

  if (!columnCount) return <PreviewEmpty message="Planilha vazia." />;

  return (
    <>
      <table className="w-max min-w-full border-collapse text-left text-[12px]">
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
          {body.length ? (
            body.map((row, rowIndex) => (
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
            ))
          ) : (
            <tr>
              <td colSpan={columnCount} className="px-3 py-6 text-center text-xs text-foreground-subtle">
                Sem linhas de dados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {sheet.truncated ? (
        <p role="status" className="border-t border-border px-3 py-2 text-[11px] text-foreground-subtle">
          Prévia truncada: exibindo apenas parte das linhas desta planilha.
        </p>
      ) : null}
    </>
  );
}

/**
 * Excel preview: one tab per sheet (`aria-selected`), sticky header row and
 * numbers right-aligned. Data comes from `api.getArtifactPreview`.
 */
export function XlsxPreview({ content, className }: ArtifactViewProps) {
  const { state, retry } = useArtifactPreview(content.artifact.id);
  const [activeIndex, setActiveIndex] = useState(0);
  const tabId = useId();

  const sheets = state.status === 'ready' && state.preview?.kind === 'xlsx' ? state.preview.sheets : [];

  useEffect(() => {
    setActiveIndex((current) => (current < sheets.length ? current : 0));
  }, [sheets.length]);

  if (state.status === 'loading') {
    return <PreviewLoading label="Carregando planilha…" className={className} />;
  }
  if (state.status === 'error') {
    return <PreviewError message={state.message} onRetry={retry} className={className} />;
  }

  const preview = state.preview;
  if (!preview || preview.kind !== 'xlsx') {
    return (
      <BinaryPreview
        content={content}
        className={className}
        detail={preview?.kind === 'unsupported' ? preview.reason : undefined}
      />
    );
  }
  if (!preview.sheets.length) {
    return <PreviewEmpty message="Planilha sem abas para exibir." className={className} />;
  }

  const currentIndex = Math.min(activeIndex, preview.sheets.length - 1);
  const activeSheet = preview.sheets[currentIndex];

  const focusTab = (index: number) => {
    const target = document.getElementById(`${tabId}-tab-${index}`);
    target?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % preview.sheets.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + preview.sheets.length) % preview.sheets.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = preview.sheets.length - 1;
    if (next === null) return;
    event.preventDefault();
    setActiveIndex(next);
    focusTab(next);
  };

  if (!activeSheet) return <PreviewEmpty message="Planilha sem abas para exibir." className={className} />;

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div
        role="tablist"
        aria-label="Planilhas do arquivo"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface-raised px-2 py-1.5"
      >
        {preview.sheets.map((sheet, index) => {
          const selected = index === currentIndex;
          return (
            <button
              key={`${sheet.name}-${index}`}
              id={`${tabId}-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${tabId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveIndex(index)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={cn(
                'h-7 shrink-0 rounded-lg px-2.5 text-[12px] font-medium outline-none transition-colors duration-150 motion-reduce:transition-none',
                'focus-visible:ring-2 focus-visible:ring-accent/40',
                selected
                  ? 'bg-accent-soft text-accent'
                  : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
              )}
            >
              {sheet.name || `Planilha ${index + 1}`}
            </button>
          );
        })}
      </div>
      <div
        id={`${tabId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabId}-tab-${currentIndex}`}
        className="min-h-0 flex-1 overflow-auto"
      >
        <SheetGrid sheet={activeSheet} />
      </div>
    </div>
  );
}
