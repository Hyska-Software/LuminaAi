import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { ChartBlock, GenUIBlock, HtmlPreview, MermaidBlock } from '@/components/genui';
import { cn } from '@/lib/utils';
import { CodeBlock, normalizeLanguage } from './CodeBlock';
import { isExternalUrl, openExternalUrl } from './external';

/** Fence languages rendered by dedicated components instead of Prism. */
const DELEGATED_LANGUAGES = new Set(['ui', 'mermaid', 'chart', 'html', 'svg']);

function childrenToText(children: unknown): string {
  if (Array.isArray(children)) {
    return children.map((child) => (typeof child === 'string' ? child : '')).join('');
  }
  return typeof children === 'string' ? children : '';
}

const components: Components = {
  // The `<pre>` wrapper would nest block-level components (genui/code cards).
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const match = /language-([\w+-]+)/.exec(className ?? '');
    if (!match) {
      const text = childrenToText(children);
      // Fenced blocks without an info string still render as code, not inline.
      if (text.includes('\n')) {
        return <CodeBlock code={text.replace(/\n$/, '')} label="text" />;
      }
      return <code>{children}</code>;
    }
    const fenceLanguage = match[1].toLowerCase();
    const code = childrenToText(children).replace(/\n$/, '');
    if (!code.trim()) return null;

    if (DELEGATED_LANGUAGES.has(fenceLanguage)) {
      switch (fenceLanguage) {
        case 'ui':
          return <GenUIBlock source={code} />;
        case 'mermaid':
          return <MermaidBlock code={code} />;
        case 'chart':
          return <ChartBlock spec={code} />;
        case 'html':
          return <HtmlPreview html={code} title="HTML" />;
        case 'svg':
          return <HtmlPreview html={code} title="SVG" />;
        default:
          break;
      }
    }

    return <CodeBlock code={code} language={normalizeLanguage(fenceLanguage)} label={fenceLanguage} />;
  },
  a: ({ href, children, title }) => (
    <a
      href={href}
      title={title}
      rel="noreferrer noopener"
      target="_blank"
      onClick={(event) => {
        if (!isExternalUrl(href)) return;
        event.preventDefault();
        void openExternalUrl(href);
      }}
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-3 w-full overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  img: ({ src, alt, title }) => <img src={src} alt={alt ?? ''} title={title} loading="lazy" />,
};

const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

export interface MarkdownProps {
  content: string;
  className?: string;
}

/** GFM + math markdown renderer tuned by the global `.lumina-prose` styles. */
export const Markdown = memo(function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn('lumina-prose text-[15px]', className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
