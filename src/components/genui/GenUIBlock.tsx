import { useMemo } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseGenUI, type GenUIDiagnostic } from '@/lib/genui';
import { CodeBlock } from './CodeBlock';
import { GenUIRenderer } from './GenUIRenderer';

export interface GenUIBlockProps {
  source: string;
  className?: string;
}

/** Diagnósticos mostrados no fallback de erro (o restante fica de fora para não poluir). */
const MAX_VISIBLE_DIAGNOSTICS = 3;
/** Avisos listados na faixa de DEV (o total aparece no resumo). */
const MAX_VISIBLE_WARNINGS = 5;

/** Em produção a faixa de diagnóstico é silenciosa; em DEV ela é expansível. */
const SHOW_DEV_DIAGNOSTICS = import.meta.env.DEV;

function DiagnosticItem({ diagnostic }: { diagnostic: GenUIDiagnostic }) {
  return (
    <li className="flex min-w-0 items-start gap-1.5" title={diagnostic.hint}>
      <AlertTriangle aria-hidden className="mt-px size-4 shrink-0 text-warning" />
      <span className="min-w-0 break-words">
        <code className="font-mono text-[10.5px] text-foreground-muted">{diagnostic.code}</code>
        <span className="font-mono text-foreground-subtle"> · {diagnostic.path || '$'}</span>
        <span> — {diagnostic.message}</span>
      </span>
    </li>
  );
}

/**
 * Lista discreta de diagnósticos. Se o parser não emitir nenhum diagnóstico
 * (ex.: falha bruta de JSON), o erro textual vira a única entrada.
 */
function DiagnosticList({ diagnostics, error }: { diagnostics: GenUIDiagnostic[]; error: string | null }) {
  const fallback: GenUIDiagnostic = {
    code: 'parse',
    severity: 'error',
    path: '$',
    message: error ?? 'Não foi possível interpretar o bloco de UI generativa.',
  };
  const visible = (diagnostics.length ? diagnostics : [fallback]).slice(0, MAX_VISIBLE_DIAGNOSTICS);

  return (
    <ul
      aria-label="Diagnósticos da UI generativa"
      className="flex flex-col gap-1 text-[11px] leading-relaxed text-foreground-subtle"
    >
      {visible.map((diagnostic, index) => (
        <DiagnosticItem key={`${diagnostic.code}-${diagnostic.path}-${index}`} diagnostic={diagnostic} />
      ))}
    </ul>
  );
}

/** Faixa de DEV: UI renderizada a partir de um spec normalizado, com avisos expansíveis. */
function DevWarningsBanner({ warnings }: { warnings: GenUIDiagnostic[] }) {
  const suffix = warnings.length === 1 ? 'aviso' : 'avisos';
  const hidden = warnings.length - MAX_VISIBLE_WARNINGS;

  return (
    <details className="group/dev rounded-lg border border-dashed border-border bg-surface px-2.5 py-1.5">
      <summary
        className={
          'flex min-h-8 cursor-pointer select-none list-none items-center gap-1.5 rounded text-[11px] ' +
          'text-foreground-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ' +
          '[&::-webkit-details-marker]:hidden'
        }
      >
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 transition-transform duration-150 group-open/dev:rotate-90 motion-reduce:transition-none"
        />
        <span>
          UI normalizada · {warnings.length} {suffix}
        </span>
      </summary>
      <ul
        aria-label="Avisos da UI generativa"
        className="mt-1.5 flex flex-col gap-1 border-t border-border pb-1 pl-5 pt-1.5 text-[11px] leading-relaxed text-foreground-subtle"
      >
        {warnings.slice(0, MAX_VISIBLE_WARNINGS).map((warning, index) => (
          <li key={`${warning.code}-${warning.path}-${index}`} className="min-w-0 break-words" title={warning.hint}>
            <code className="font-mono text-[10.5px] text-foreground-muted">{warning.code}</code>
            <span className="font-mono"> · {warning.path || '$'}</span>
            <span> — {warning.message}</span>
          </li>
        ))}
        {hidden > 0 ? <li>+{hidden} outros avisos.</li> : null}
      </ul>
    </details>
  );
}

/**
 * Entry point for ` ```ui ` fenced blocks: parses the declarative JSON and
 * renders it. On any validation error it degrades to the raw code block with a
 * discreet diagnostic list instead of failing the message.
 */
export function GenUIBlock({ source, className }: GenUIBlockProps) {
  const result = useMemo(() => parseGenUI(source), [source]);
  const { spec, diagnostics, error, warnings } = result;

  if (!spec) {
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    return (
      <div className={cn('my-3 flex flex-col gap-2', className)}>
        <CodeBlock code={source.trim()} language="json" title="UI generativa" maxHeight={300} />
        {errors.length || error ? (
          <DiagnosticList diagnostics={errors} error={error} />
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn('my-3 flex flex-col gap-2', className)}>
      {SHOW_DEV_DIAGNOSTICS && warnings.length > 0 ? <DevWarningsBanner warnings={warnings} /> : null}
      <GenUIRenderer spec={spec} />
    </div>
  );
}
