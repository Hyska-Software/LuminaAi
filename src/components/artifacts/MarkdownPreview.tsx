import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/chat/Markdown';
import { CodeBlock } from '@/components/genui';
import { SegmentedControl } from '@/components/ui';
import { cn } from '@/lib/utils';
import { PreviewEmpty, type ArtifactViewProps } from './previewSupport';

type MarkdownViewMode = 'document' | 'code';

/**
 * Markdown artifact preview: rendered document by default (same GFM + KaTeX +
 * Zylara prose pipeline as the chat) with a "Código" tab that shows the raw
 * source in a copyable code block.
 */
export function MarkdownPreview({ content, className }: ArtifactViewProps) {
  const { t } = useTranslation('artifacts');
  const { artifact, content: raw } = content;
  const markdown = raw ?? '';
  const [mode, setMode] = useState<MarkdownViewMode>('document');
  const viewOptions = [
    { value: 'document', label: t('artifacts:markdown.document') },
    { value: 'code', label: t('artifacts:markdown.code') },
  ];

  if (!markdown.trim()) {
    return <PreviewEmpty message={t('artifacts:markdown.empty')} className={className} />;
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-raised px-3 py-1.5">
        <SegmentedControl
          size="sm"
          ariaLabel={t('artifacts:markdown.viewAria')}
          options={viewOptions}
          value={mode}
          onChange={(value) => setMode(value === 'code' ? 'code' : 'document')}
        />
      </div>
      {mode === 'document' ? (
        <div
          role="region"
          aria-label={t('artifacts:markdown.previewAria')}
          className="min-h-0 flex-1 overflow-auto p-4"
        >
          <Markdown content={markdown} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <CodeBlock
            code={markdown}
            language="markdown"
            title={artifact.name}
            showLineNumbers
            wrap={false}
          />
        </div>
      )}
    </div>
  );
}
