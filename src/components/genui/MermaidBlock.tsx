import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { sanitizeSvg } from '@/lib/genui/sanitize';
import { CodeBlock } from './CodeBlock';
import { useIsDark } from './useIsDark';

export interface MermaidBlockProps {
  code: string;
  className?: string;
}

let renderCounter = 0;

/**
 * Lazy-loaded Mermaid diagrams. The SVG is generated locally with
 * `securityLevel: 'strict'` and then sanitized before injection.
 */
export function MermaidBlock({ code, className }: MermaidBlockProps) {
  const dark = useIsDark();
  const reactId = useId();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSvg(null);
    setError(null);

    const renderId = `zylara-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}-${++renderCounter}`;

    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: dark ? 'dark' : 'neutral',
          fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif",
          flowchart: { htmlLabels: false, useMaxWidth: true },
          sequence: { useMaxWidth: true },
        });
        const result = await mermaid.render(renderId, code);
        if (cancelled) return;
        setSvg(sanitizeSvg(result.svg));
      } catch (renderError) {
        if (cancelled) return;
        setError(renderError instanceof Error ? renderError.message : String(renderError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, dark, reactId]);

  if (error) {
    return (
      <div className={cn('my-3 flex flex-col gap-2', className)}>
        <CodeBlock code={code} language="mermaid" title="Diagrama Mermaid" maxHeight={340} />
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          Não foi possível renderizar o diagrama: {error}
        </p>
      </div>
    );
  }

  if (loading || !svg) {
    return (
      <div
        className={cn(
          'my-3 flex h-32 animate-pulse items-center justify-center rounded-xl border border-border bg-surface',
          'motion-reduce:animate-none',
          className,
        )}
        aria-busy
        aria-label="Renderizando diagrama"
      >
        <span className="text-[11px] text-foreground-subtle">Renderizando diagrama…</span>
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label="Diagrama Mermaid"
      className={cn(
        'my-3 overflow-x-auto rounded-xl border border-border bg-surface px-4 py-3',
        '[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full [&_svg]:font-sans',
        className,
      )}
      // Sanitized above: no scripts, event handlers or javascript: URLs.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
