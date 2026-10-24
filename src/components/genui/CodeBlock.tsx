import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Highlight, type Language, type PrismTheme } from 'prism-react-renderer';
import { cn, copyText } from '@/lib/utils';
import { IconButton, Tooltip } from '@/components/ui';

/**
 * Token-based Prism theme: colors are CSS variables so the block follows the
 * design tokens in light/dark without duplicating palettes.
 */
const LUMINA_THEME: PrismTheme = {
  plain: { color: 'var(--foreground)', backgroundColor: 'transparent' },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: 'var(--foreground-subtle)', fontStyle: 'italic' } },
    { types: ['punctuation'], style: { color: 'var(--foreground-muted)' } },
    { types: ['property', 'tag', 'constant', 'symbol', 'deleted'], style: { color: 'var(--accent)' } },
    { types: ['boolean', 'number'], style: { color: 'var(--warning)' } },
    { types: ['selector', 'attr-name', 'string', 'char', 'builtin', 'inserted'], style: { color: 'var(--success)' } },
    { types: ['operator', 'entity', 'url'], style: { color: 'var(--foreground-muted)' } },
    { types: ['atrule', 'attr-value', 'keyword'], style: { color: 'var(--accent)' } },
    { types: ['function', 'class-name'], style: { color: 'var(--foreground)' } },
    { types: ['regex', 'important', 'variable'], style: { color: 'var(--warning)' } },
  ],
};

const LANGUAGE_ALIASES: Record<string, string> = {
  md: 'markdown',
  ts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  tsx: 'tsx',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  py: 'python',
  rb: 'ruby',
  yml: 'yaml',
  yaml: 'yaml',
  html: 'markup',
  svg: 'markup',
  xml: 'markup',
  htm: 'markup',
  json5: 'json',
  jsonc: 'json',
  plaintext: 'text',
  txt: 'text',
};

export interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  className?: string;
  /** Max height of the scrollable body (px). */
  maxHeight?: number;
  showLineNumbers?: boolean;
  copyable?: boolean;
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
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(code);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const normalized = LANGUAGE_ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  const label = language.toLowerCase() === 'text' ? '' : language.toLowerCase();
  // Very large artifacts skip Prism to keep the UI responsive.
  const tooLarge = code.length > 200_000;

  return (
    <div className={cn('group/code relative overflow-hidden rounded-xl border border-border bg-surface', className)}>
      {(title || copyable) && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-3 py-1.5">
          <span className="min-w-0 truncate font-mono text-[11px] text-foreground-subtle">
            {title ?? label ?? ''}
          </span>
          {copyable ? (
            <Tooltip content={copied ? 'Copiado!' : 'Copiar código'} side="top">
              <IconButton
                label={copied ? 'Copiado' : 'Copiar código'}
                size="sm"
                onClick={handleCopy}
                className="size-7 text-foreground-subtle hover:text-foreground"
              >
                {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              </IconButton>
            </Tooltip>
          ) : null}
        </div>
      )}
      {tooLarge ? (
        <pre className="overflow-auto p-3 font-mono text-[12.5px] leading-[1.65]" style={{ maxHeight }}>
          <code className="whitespace-pre-wrap break-words">{code}</code>
        </pre>
      ) : (
        <Highlight theme={LUMINA_THEME} code={code.replace(/\n$/, '')} language={normalized as Language}>
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
                      <span className="table-cell whitespace-pre-wrap break-words">
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
