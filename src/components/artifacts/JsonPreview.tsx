import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { languageLabel } from '@/lib/highlight';
import { cn } from '@/lib/utils';
import { CodeBlock } from '@/components/genui';
import { SegmentedControl, type SegmentedOption } from '@/components/ui';
import { JsonTree } from './JsonTree';
import type { ArtifactViewProps } from './previewSupport';

export type JsonPreviewProps = ArtifactViewProps;

type ViewMode = 'tree' | 'code';

type JsonParseResult =
  | { status: 'empty' }
  | { status: 'invalid'; raw: string; looksLikeJson: boolean }
  | { status: 'valid'; value: unknown; pretty: string; lineCount: number };

/** First non-space character hint that the content was at least meant as JSON. */
function looksLikeJson(text: string): boolean {
  const first = text.charAt(0);
  if (!first) return false;
  if ('{["-tfn'.includes(first)) return true;
  return first >= '0' && first <= '9';
}

function parseJson(raw: string): JsonParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { status: 'empty' };
  try {
    const value: unknown = JSON.parse(trimmed);
    const pretty = JSON.stringify(value, null, 2) ?? 'null';
    return { status: 'valid', value, pretty, lineCount: pretty.split('\n').length };
  } catch {
    return { status: 'invalid', raw, looksLikeJson: looksLikeJson(trimmed) };
  }
}

/** Discreet empty state consistent with the other artifact previews. */
function JsonEmpty({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn('flex h-full items-center justify-center p-6', className)}>
      <p className="text-xs text-foreground-subtle">{message}</p>
    </div>
  );
}

/**
 * Preview for `kind: 'json'` artifacts: an interactive, collapsible tree plus a
 * highlighted source mode. Invalid JSON degrades to the raw text with a
 * discrete warning instead of a broken preview.
 */
export function JsonPreview({ content, className }: JsonPreviewProps) {
  const { t } = useTranslation('artifacts');
  const { artifact, content: text } = content;
  const parsed = useMemo(() => parseJson(text ?? ''), [text]);
  const [mode, setMode] = useState<ViewMode>('tree');
  const modeOptions: SegmentedOption[] = [
    { value: 'tree', label: t('artifacts:json.tree') },
    { value: 'code', label: t('artifacts:json.code') },
  ];

  if (parsed.status === 'empty') {
    return <JsonEmpty message={t('artifacts:json.empty')} className={className} />;
  }

  if (parsed.status === 'invalid') {
    // Prose/base64 masquerading as JSON: an empty state is more honest than a
    // giant invalid-code card.
    if (!parsed.looksLikeJson) {
      return <JsonEmpty message={t('artifacts:json.noJson')} className={className} />;
    }
    return (
      <div className={cn('flex h-full flex-col gap-2 p-3', className)}>
        <p className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
          <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-warning" />
          {t('artifacts:json.invalid')}
        </p>
        <div className="min-h-0 flex-1 overflow-auto">
          <CodeBlock
            code={parsed.raw}
            language="json"
            title={artifact.name}
            showLineNumbers
            wrap={false}
            maxHeight={100_000}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-foreground-subtle">
          {languageLabel(artifact.language ?? 'json')}
        </span>
        <SegmentedControl
          size="sm"
          value={mode}
          onChange={(value) => setMode(value === 'code' ? 'code' : 'tree')}
          options={modeOptions}
          ariaLabel={t('artifacts:json.viewAria')}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {mode === 'tree' ? (
          <JsonTree
            value={parsed.value}
            ariaLabel={t('artifacts:json.treeAria', { name: artifact.name })}
          />
        ) : (
          <CodeBlock
            code={parsed.pretty}
            language="json"
            title={artifact.name}
            showLineNumbers
            wrap={false}
            maxHeight={100_000}
            meta={t('artifacts:json.lineCount', { count: parsed.lineCount })}
          />
        )}
      </div>
    </div>
  );
}
