import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CircleAlert,
  Copy,
  ExternalLink,
  FileExclamationPoint,
  FileQuestionMark,
} from 'lucide-react';
import { Badge, IconButton, Spinner, Tooltip } from '@/components/ui';
import { languageLabel, normalizeLanguage, prism, SYNTAX_THEME } from '@/lib/highlight';
import { cn, copyText, formatBytes } from '@/lib/utils';
import type { WorkspaceFileContent } from '@/lib/types';
import { Highlight } from 'prism-react-renderer';
import { toast } from 'sonner';
import { FileIcon } from './FileIcon';

export interface FilePreviewProps {
  /** File content returned by `api.readWorkspaceFile`. */
  content?: WorkspaceFileContent | null;
  loading?: boolean;
  error?: string | null;
  /** Opens the file in the user's external editor (container owns the action). */
  onOpenExternal?: (path: string) => void;
  className?: string;
}

/** Maps a path extension to a Prism language id. */
export function languageForPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  const lowered = name.toLowerCase();
  if (lowered === 'dockerfile' || lowered === 'containerfile') return 'docker';
  if (lowered === 'makefile') return 'makefile';
  if (lowered.startsWith('.env')) return 'ini';
  const dot = lowered.lastIndexOf('.');
  if (dot < 0) return 'text';
  return normalizeLanguage(lowered.slice(dot + 1));
}

/**
 * Read-only workspace file preview for the Code panel (WORKBENCH §7.1/§15).
 *
 * Renders highlighted source with line numbers (shared Prism instance of
 * `src/lib/highlight`), and honest states for binary/truncated/non-UTF-8
 * files, loading and read errors. Copy path and "abrir no editor externo"
 * live in the header; the external action is delegated to the container.
 */
export function FilePreview({ content, loading, error, onOpenExternal, className }: FilePreviewProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /* A new file resets the transient "copiado" feedback. */
  useEffect(() => {
    setCopied(false);
  }, [content?.path]);

  const path = content?.path ?? '';
  const language = useMemo(() => languageForPath(path), [path]);
  const lines = useMemo(() => {
    const text = content?.text ?? '';
    return text.length ? text.replace(/\r\n?/g, '\n').split('\n') : [];
  }, [content?.text]);

  const handleCopyPath = async () => {
    if (!path) return;
    const ok = await copyText(path);
    if (!ok) {
      toast.error('Não foi possível copiar o caminho');
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  if (loading) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
          <div className="h-3 w-40 animate-pulse rounded bg-surface-hover motion-reduce:animate-none" />
          <Spinner size="xs" label="Carregando arquivo" className="ml-auto" />
        </div>
        <div aria-hidden className="flex-1 space-y-2 p-3">
          {[0, 1, 2, 3, 4, 5, 6].map((row) => (
            <div
              key={row}
              className="h-3 animate-pulse rounded bg-surface-hover motion-reduce:animate-none"
              style={{ width: `${90 - row * 8}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          'flex h-full flex-col items-center justify-center gap-2 px-6 py-8 text-center',
          className,
        )}
      >
        <span className="flex size-9 items-center justify-center rounded-xl border border-danger/30 bg-danger-soft text-danger">
          <CircleAlert aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
        <p className="text-[12.5px] font-medium text-foreground">Não foi possível abrir o arquivo</p>
        <p className="max-w-64 text-[12px] leading-relaxed text-foreground-muted">{error}</p>
      </div>
    );
  }

  if (!content) {
    return (
      <div
        className={cn(
          'flex h-full flex-col items-center justify-center gap-1.5 px-6 py-8 text-center',
          className,
        )}
      >
        <FileQuestionMark aria-hidden className="size-5 text-foreground-subtle" strokeWidth={1.75} />
        <p className="text-[12.5px] font-medium text-foreground">Nenhum arquivo selecionado</p>
        <p className="max-w-64 text-[12px] leading-relaxed text-foreground-muted">
          Escolha um arquivo na aba Arquivos para ver a prévia.
        </p>
      </div>
    );
  }

  if (content.binary) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <PreviewHeader path={content.path}>
          <HeaderActions path={content.path} copied={copied} onCopy={handleCopyPath} onOpenExternal={onOpenExternal} />
        </PreviewHeader>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
          <span className="flex size-9 items-center justify-center rounded-xl border border-border bg-surface-hover text-foreground-muted">
            <FileExclamationPoint aria-hidden className="size-4" strokeWidth={1.75} />
          </span>
          <p className="text-[12.5px] font-medium text-foreground">Arquivo binário</p>
          <p className="max-w-64 text-[12px] leading-relaxed text-foreground-muted">
            Não há prévia de texto para este arquivo ({formatBytes(content.size)}). Abra no editor
            externo para inspecionar o conteúdo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <PreviewHeader path={content.path}>
        <Badge tone="neutral" size="sm" className="shrink-0 font-mono">
          {languageLabel(language)}
        </Badge>
        <span className="shrink-0 text-[11px] tabular-nums text-foreground-subtle">
          {lines.length} {lines.length === 1 ? 'linha' : 'linhas'} · {formatBytes(content.size)}
        </span>
        <HeaderActions path={content.path} copied={copied} onCopy={handleCopyPath} onOpenExternal={onOpenExternal} />
      </PreviewHeader>

      {content.encoding && !/^utf-?8$/i.test(content.encoding) ? (
        <p
          role="note"
          className="shrink-0 border-b border-warning/30 bg-warning-soft px-3 py-1.5 text-[11.5px] text-warning"
        >
          Encoding {content.encoding} detectado — o conteúdo pode aparecer com caracteres trocados.
        </p>
      ) : null}

      {content.truncated ? (
        <p
          role="note"
          className="shrink-0 border-b border-border bg-surface px-3 py-1.5 text-[11.5px] text-foreground-muted"
        >
          Prévia truncada: mostrando parte de {formatBytes(content.size)}. Abra no editor externo
          para ver o arquivo completo.
        </p>
      ) : null}

      {lines.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 py-8 text-center text-[12px] text-foreground-muted">
          Arquivo vazio.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <Highlight prism={prism} theme={SYNTAX_THEME} language={language} code={content.text}>
            {({ tokens, getLineProps, getTokenProps }) => (
              <pre
                aria-label={`Conteúdo de ${content.path}`}
                className="min-w-full py-2 font-mono text-[12px] leading-[1.7]"
              >
                {tokens.map((line, lineIndex) => {
                  const lineProps = getLineProps({ line });
                  return (
                    <div
                      key={lineIndex}
                      {...lineProps}
                      className={cn(lineProps.className, 'flex min-h-[20px] items-start')}
                    >
                      <span
                        aria-hidden
                        className="sticky left-0 w-10 shrink-0 select-none pr-3 text-right text-[11px] tabular-nums text-foreground-subtle"
                        style={{ backgroundColor: 'var(--surface-raised)' }}
                      >
                        {lineIndex + 1}
                      </span>
                      <span className="min-w-0 whitespace-pre pr-4">
                        {line.map((token, tokenIndex) => (
                          <span key={tokenIndex} {...getTokenProps({ token })} />
                        ))}
                      </span>
                    </div>
                  );
                })}
              </pre>
            )}
          </Highlight>
        </div>
      )}
    </div>
  );
}

function PreviewHeader({ path, children }: { path: string; children?: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
      <FileIcon path={path} className="size-3.5" />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground" title={path}>
        {path}
      </span>
      {children}
    </div>
  );
}

function HeaderActions({
  path,
  copied,
  onCopy,
  onOpenExternal,
}: {
  path: string;
  copied: boolean;
  onCopy: () => void;
  onOpenExternal?: (path: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Tooltip content={copied ? 'Caminho copiado' : 'Copiar caminho'} side="bottom">
        <IconButton
          label={copied ? 'Caminho copiado' : 'Copiar caminho'}
          size="sm"
          onClick={() => void onCopy()}
        >
          <Copy aria-hidden className={cn('size-3.5', copied && 'text-success')} strokeWidth={1.75} />
        </IconButton>
      </Tooltip>
      {onOpenExternal ? (
        <Tooltip content="Abrir no editor externo" side="bottom">
          <IconButton label="Abrir no editor externo" size="sm" onClick={() => onOpenExternal(path)}>
            <ExternalLink aria-hidden className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        </Tooltip>
      ) : null}
    </div>
  );
}

export default FilePreview;
