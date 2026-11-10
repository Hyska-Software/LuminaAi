import { useState } from 'react';
import { WrapText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CodeBlock } from '@/components/genui';
import { Badge, IconButton, Tooltip } from '@/components/ui';
import { languageLabel } from '@/lib/highlight';
import { cn } from '@/lib/utils';
import { artifactLanguage } from './kinds';
import { PreviewEmpty, type ArtifactViewProps } from './previewSupport';

/** Number of visual lines, ignoring a single trailing newline. */
function countLines(source: string): number {
  const normalized = source.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  return normalized ? normalized.split('\n').length : 0;
}

/**
 * Preview for `code`/`text` artifacts: highlighted source with the language
 * badge, line count and a wrap toggle (wrapping is on for plain text and off
 * for code, where horizontal scrolling preserves indentation).
 */
export function CodePreview({ content, className }: ArtifactViewProps) {
  const { t } = useTranslation('artifacts');
  const { artifact, content: raw } = content;
  const code = raw ?? '';
  const language = artifactLanguage(artifact);
  const [wrapOverrides, setWrapOverrides] = useState<Record<string, boolean>>({});
  const wrap = wrapOverrides[artifact.id] ?? artifact.kind === 'text';
  const lineCount = countLines(code);

  if (!code.trim()) {
    return <PreviewEmpty message={t('artifacts:code.empty')} className={className} />;
  }

  const toggleWrap = () => {
    setWrapOverrides((current) => ({ ...current, [artifact.id]: !wrap }));
  };

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div
        role="toolbar"
        aria-label={t('artifacts:code.toolbar')}
        className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3 py-1.5"
      >
        <Badge tone="neutral" size="md">
          {languageLabel(language)}
        </Badge>
        <Tooltip content={wrap ? t('artifacts:code.noWrap') : t('artifacts:code.wrap')} side="top">
          <IconButton
            label={t('artifacts:code.wrap')}
            size="sm"
            active={wrap}
            aria-pressed={wrap}
            onClick={toggleWrap}
            className="ml-auto"
          >
            <WrapText aria-hidden className="size-4" />
          </IconButton>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <CodeBlock
          code={code}
          language={language}
          title={artifact.name}
          meta={t('artifacts:code.lineCount', { count: lineCount })}
          showLineNumbers={artifact.kind === 'code' || language !== 'text'}
          wrap={wrap}
          maxHeight={100_000}
        />
      </div>
    </div>
  );
}
