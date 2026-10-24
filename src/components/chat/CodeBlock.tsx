import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Highlight, type PrismTheme } from 'prism-react-renderer';
import { toast } from 'sonner';
import { cn, copyText } from '@/lib/utils';

/**
 * Prism theme built exclusively from Lumina design tokens so syntax colors
 * follow light/dark themes instead of shipping a third-party palette.
 */
const luminaPrismTheme: PrismTheme = {
  plain: {
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
  },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: { color: 'var(--foreground-subtle)', fontStyle: 'italic' },
    },
    { types: ['punctuation'], style: { color: 'var(--foreground-muted)' } },
    { types: ['property', 'tag', 'constant', 'symbol', 'deleted'], style: { color: 'var(--danger)' } },
    { types: ['boolean', 'number'], style: { color: 'var(--warning)' } },
    { types: ['selector', 'attr-name', 'string', 'char', 'builtin', 'inserted'], style: { color: 'var(--success)' } },
    { types: ['operator', 'entity', 'url'], style: { color: 'var(--foreground-muted)' } },
    { types: ['atrule', 'attr-value', 'keyword'], style: { color: 'var(--accent)' } },
    { types: ['function', 'class-name'], style: { color: 'var(--accent-hover)' } },
    { types: ['regex', 'important', 'variable'], style: { color: 'var(--warning)' } },
  ],
};

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  kt: 'kotlin',
  cs: 'csharp',
  'c++': 'cpp',
  hpp: 'cpp',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  vue: 'markup',
  svg: 'markup',
  json: 'javascript',
  jsonc: 'javascript',
  json5: 'javascript',
  toml: 'ini',
  dotenv: 'bash',
  java: 'clike',
  c: 'clike',
  h: 'clike',
  cpp: 'clike',
  cxx: 'clike',
  csharp: 'clike',
  go: 'clike',
  golang: 'clike',
  dart: 'clike',
  scala: 'clike',
  php: 'clike',
  text: 'text',
  txt: 'text',
  plaintext: 'text',
};

/** Maps fence info strings (```ts, ```yml, …) to Prism languages. */
export function normalizeLanguage(raw?: string | null): string {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return 'text';
  return LANGUAGE_ALIASES[value] ?? value;
}

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
      <Highlight theme={luminaPrismTheme} language={language} code={code}>
        {({ className: highlightClassName, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={cn(
              'max-h-[440px] overflow-auto p-3 font-mono text-[12.5px] leading-6',
              highlightClassName,
            )}
            style={style}
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
