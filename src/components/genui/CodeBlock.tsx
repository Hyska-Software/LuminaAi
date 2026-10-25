import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Highlight } from 'prism-react-renderer';
import { languageLabel, normalizeLanguage, prism, SYNTAX_THEME } from '@/lib/highlight';
import { cn, copyText } from '@/lib/utils';
import { IconButton, Tooltip } from '@/components/ui';

export interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  className?: string;
  /** Max height of the scrollable body (px). */
  maxHeight?: number;
  showLineNumbers?: boolean;
  copyable?: boolean;
  /**
   * Quebra linhas longas (padrão). `false` mantém a rolagem horizontal, sem
   * quebrar o código — útil para JSON, diffs e linhas largas.
   */
  wrap?: boolean;
  /** Texto secundário discreto no header (ex.: "42 linhas"). */
  meta?: string;
  /** Controles extras no header, antes do botão copiar. */
  actions?: ReactNode;
}

/** Code block with Prism highlighting, optional title bar and copy button. */
export function CodeBlock({
  code,
  language = 'text',
  title,
  className,
  maxHeight = 420,
  showLineNumbers = false,
  copyable = true,
  wrap = true,
  meta,
  actions,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(code);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const normalized = normalizeLanguage(language);
  const badge = title || (normalized === 'text' ? '' : languageLabel(normalized));
  const showHeader = Boolean(badge || meta || actions || copyable);
  // Very large artifacts skip Prism to keep the UI responsive.
  const tooLarge = code.length > 200_000;
  const lineClass = wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre';

  return (
    <div className={cn('group/code relative overflow-hidden rounded-xl border border-border bg-surface', className)}>
      {showHeader ? (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-3 py-1.5">
          <span className="flex min-w-0 items-baseline gap-2 font-mono text-[11px] text-foreground-subtle">
            <span className="min-w-0 truncate">{badge}</span>
            {meta ? <span className="shrink-0 text-foreground-subtle/70">{meta}</span> : null}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            {copyable ? (
              <Tooltip content={copied ? 'Copiado!' : 'Copiar código'} side="top">
                <IconButton
                  label={copied ? 'Copiado' : 'Copiar código'}
                  size="sm"
                  onClick={handleCopy}
                  className="size-8 text-foreground-subtle hover:text-foreground"
                >
                  {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                </IconButton>
              </Tooltip>
            ) : null}
          </div>
        </div>
      ) : null}
      {tooLarge ? (
        <pre className="overflow-auto p-3 font-mono text-[12.5px] leading-[1.65]" style={{ maxHeight }}>
          <code className={lineClass}>{code}</code>
        </pre>
      ) : (
        <Highlight prism={prism} theme={SYNTAX_THEME} code={code.replace(/\n$/, '')} language={normalized}>
          {({ tokens, getLineProps, getTokenProps }) => (
            <pre
              className="overflow-auto p-3 font-mono text-[12.5px] leading-[1.65]"
              style={{ maxHeight }}
            >
              <code>
                {tokens.map((line, lineIndex) => {
                  const lineProps = getLineProps({ line });
                  return (
                    <div key={lineIndex} {...lineProps} className={cn('table-row', lineProps.className)}>
                      {showLineNumbers ? (
                        <span className="table-cell select-none pr-3 text-right text-foreground-subtle/70">
                          {lineIndex + 1}
                        </span>
                      ) : null}
                      <span className={cn('table-cell', lineClass)}>
                        {line.map((token, tokenIndex) => (
                          <span key={tokenIndex} {...getTokenProps({ token })} />
                        ))}
                      </span>
                    </div>
                  );
                })}
              </code>
            </pre>
          )}
        </Highlight>
      )}
    </div>
  );
}
