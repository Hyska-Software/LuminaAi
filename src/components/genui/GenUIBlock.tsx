import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
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

/** Avisos de design são visíveis apenas para quem desenvolve (console do DevTools). */
const LOG_DEV_WARNINGS = import.meta.env.DEV;

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
  const { t } = useTranslation('genui');
  const fallback: GenUIDiagnostic = {
    code: 'parse',
    severity: 'error',
    path: '$',
    message: error ?? t('block.parseError'),
  };
  const visible = (diagnostics.length ? diagnostics : [fallback]).slice(0, MAX_VISIBLE_DIAGNOSTICS);

  return (
    <ul
      aria-label={t('block.diagnosticsAria')}
      className="flex flex-col gap-1 text-[11px] leading-relaxed text-foreground-subtle"
    >
      {visible.map((diagnostic, index) => (
        <DiagnosticItem key={`${diagnostic.code}-${diagnostic.path}-${index}`} diagnostic={diagnostic} />
      ))}
    </ul>
  );
}

/**
 * Entry point for ` ```ui ` fenced blocks: parses the declarative JSON and
 * renders it. On any validation error it degrades to the raw code block with a
 * discreet diagnostic list instead of failing the message.
 *
 * Avisos de design não aparecem na interface: em DEV vão para o console do
 * DevTools (o `normalized` já é o que o usuário vê).
 */
export function GenUIBlock({ source, className }: GenUIBlockProps) {
  const { t } = useTranslation('genui');
  const result = useMemo(() => parseGenUI(source), [source]);
  const { spec, diagnostics, error, warnings } = result;

  useEffect(() => {
    if (!LOG_DEV_WARNINGS || warnings.length === 0) return;
    console.warn(
      `[Zylara GenUI] UI normalized with ${warnings.length} design ${
        warnings.length === 1 ? 'warning' : 'warnings'
      }`,
      warnings.map((warning) => ({
        code: warning.code,
        path: warning.path,
        message: warning.message,
        hint: warning.hint,
      })),
    );
  }, [warnings]);

  if (!spec) {
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    return (
      <div className={cn('my-3 flex flex-col gap-2', className)}>
        <CodeBlock code={source.trim()} language="json" title={t('block.title')} maxHeight={300} />
        {errors.length || error ? (
          <DiagnosticList diagnostics={errors} error={error} />
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn('zylara-genui my-3', className)}>
      <GenUIRenderer spec={spec} />
    </div>
  );
}
