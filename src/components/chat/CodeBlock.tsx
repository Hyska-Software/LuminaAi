import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Highlight } from 'prism-react-renderer';
import { prism, SYNTAX_THEME, normalizeLanguage } from '@/lib/highlight';
import { cn, copyText } from '@/lib/utils';
import { toast } from 'sonner';

// Markdown.tsx keeps importing `normalizeLanguage` from here; the language
// aliases and the Prism theme now live in `@/lib/highlight` (shared with the
// artifacts/genui code blocks).
export { normalizeLanguage };

export interface CodeBlockProps {
  code: string;
  /** Prism language (normalized). */
  language?: string;
  /** Label shown in the header (fence info string as written). */
  label?: string;
  className?: string;
}

/** Fenced code block with a language header and a copy action. */
export function CodeBlock({ code, language = 'text', label, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleCopy = async () => {
    const ok = await copyText(code);
    if (!ok) {
      toast.error('Não foi possível copiar o código');
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={cn('my-3 overflow-hidden rounded-xl border border-border bg-surface', className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-foreground-subtle">
          {label || language || 'text'}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label={copied ? 'Código copiado' : 'Copiar código'}
          className={cn(
            'ml-auto flex h-8 items-center gap-1 rounded-md px-2 text-[11px] text-foreground-subtle',
            'transition-colors duration-150 hover:bg-surface-hover hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          )}
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          <span>{copied ? 'Copiado' : 'Copiar'}</span>
        </button>
      </div>
      <Highlight prism={prism} theme={SYNTAX_THEME} language={normalizeLanguage(language)} code={code}>
        {({ className: highlightClassName, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={cn(
              'max-h-[440px] overflow-auto p-3 font-mono text-[12.5px] leading-6',
              highlightClassName,
            )}
          >
            {tokens.map((line, lineIndex) => {
              const lineProps = getLineProps({ line });
              return (
                <div key={lineIndex} {...lineProps} className={cn(lineProps.className, 'min-h-6')}>
                  {line.map((token, tokenIndex) => (
                    <span key={tokenIndex} {...getTokenProps({ token })} />
                  ))}
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
