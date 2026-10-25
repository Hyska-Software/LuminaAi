import { useMemo } from 'react';
import { isSvgMarkup, sanitizeSvg } from '@/lib/genui/sanitize';
import { cn } from '@/lib/utils';
import { CodeBlock, HtmlPreview } from '@/components/genui';
import { artifactLanguage } from './kinds';
import { parseCsv } from './csv';
import { BinaryPreview } from './BinaryPreview';
import { DocxPreview } from './DocxPreview';
import { PdfPreview } from './PdfPreview';
import { PptxPreview } from './PptxPreview';
import { XlsxPreview } from './XlsxPreview';
import type { ArtifactViewProps } from './previewSupport';

export type ArtifactPreviewProps = ArtifactViewProps;

function TextPreview({ content, className }: ArtifactPreviewProps) {
  const { artifact, content: text } = content;
  const code = useMemo(() => {
    if (artifact.kind !== 'json') return text ?? '';
    try {
      return JSON.stringify(JSON.parse(text ?? ''), null, 2);
    } catch {
      return text ?? '';
    }
  }, [artifact.kind, text]);

  return (
    <div className={cn('h-full overflow-auto p-3', className)}>
      <CodeBlock
        code={code}
        language={artifactLanguage(artifact)}
        title={artifact.name}
        maxHeight={100_000}
        showLineNumbers={artifact.kind === 'code'}
      />
    </div>
  );
}

function SvgPreview({ content, className }: ArtifactPreviewProps) {
  const svg = content.content ?? '';
  const sanitized = useMemo(() => sanitizeSvg(svg), [svg]);
  if (!isSvgMarkup(sanitized)) return <TextPreview content={content} className={className} />;
  return (
    <div
      className={cn(
        'flex h-full items-start justify-center overflow-auto bg-surface-raised p-5',
        '[&_svg]:h-auto [&_svg]:max-w-full',
        className,
      )}
      // sanitizeSvg strips scripts, event handlers and javascript: URLs.
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

function ImagePreview({ content, className }: ArtifactPreviewProps) {
  const { artifact, dataBase64, content: text } = content;
  const src = dataBase64
    ? dataBase64.startsWith('data:')
      ? dataBase64
      : `data:${artifact.mimeType || 'image/png'};base64,${dataBase64}`
    : text && /^data:image\//i.test(text)
      ? text
      : null;

  if (!src) {
    return (
      <div className={cn('flex h-full items-center justify-center p-6 text-xs text-foreground-subtle', className)}>
        Imagem sem dados para visualização.
      </div>
    );
  }

  return (
    <div className={cn('flex h-full items-center justify-center overflow-auto bg-surface p-4', className)}>
      <img
        src={src}
        alt={artifact.name}
        className="max-h-full max-w-full rounded-lg border border-border object-contain shadow-sm"
      />
    </div>
  );
}

function CsvPreview({ content, className }: ArtifactPreviewProps) {
  const parsed = useMemo(() => parseCsv(content.content ?? ''), [content.content]);
  const header = parsed.rows[0] ?? [];
  const body = parsed.rows.slice(1);

  if (!header.length) {
    return (
      <div className={cn('flex h-full items-center justify-center p-6 text-xs text-foreground-subtle', className)}>
        CSV vazio.
      </div>
    );
  }

  return (
    <div className={cn('h-full overflow-auto', className)}>
      <table className="w-full border-collapse text-left text-[12px]">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            {header.map((cell, index) => (
              <th
                key={index}
                scope="col"
                className="whitespace-nowrap border-b border-border px-3 py-2 font-semibold text-foreground"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-surface-raised even:bg-surface/40">
              {header.map((_, cellIndex) => (
                <td
                  key={cellIndex}
                  className="max-w-[280px] truncate border-b border-border px-3 py-1.5 text-foreground-muted"
                  title={row[cellIndex] ?? ''}
                >
                  {row[cellIndex] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {parsed.truncated ? (
        <p className="border-t border-border px-3 py-2 text-[11px] text-foreground-subtle">
          Mostrando as primeiras {parsed.rows.length - 1} linhas de {parsed.totalRows - 1}.
        </p>
      ) : null}
    </div>
  );
}

/** Type-aware artifact preview used by the side panel. */
export function ArtifactPreview({ content, className }: ArtifactPreviewProps) {
  const { artifact } = content;

  switch (artifact.kind) {
    case 'html':
      return (
        <div className={cn('h-full overflow-auto p-3', className)}>
          <HtmlPreview html={content.content ?? ''} title={artifact.name} />
        </div>
      );
    case 'svg':
      return <SvgPreview content={content} className={className} />;
    case 'image':
      return <ImagePreview content={content} className={className} />;
    case 'csv':
      return <CsvPreview content={content} className={className} />;
    case 'pdf':
      return <PdfPreview content={content} className={className} />;
    case 'docx':
      return <DocxPreview content={content} className={className} />;
    case 'xlsx':
      return <XlsxPreview content={content} className={className} />;
    case 'pptx':
      return <PptxPreview content={content} className={className} />;
    case 'markdown':
    case 'code':
    case 'text':
    case 'json':
      return <TextPreview content={content} className={className} />;
    case 'binary':
    default:
      return <BinaryPreview content={content} className={className} />;
  }
}
