import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { CodeFileTab } from '@/lib/store';
import type { WorkspaceFileContent } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FilePreview } from './FilePreview';

export interface CodeFileViewProps {
  /** Arquivo aberto na aba central (workspace + caminho relativo). */
  target: CodeFileTab;
  className?: string;
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

/**
 * Aba central de arquivo do layout Code (WORKBENCH §7.1).
 *
 * O clique na árvore do painel Arquivos chama `openCodeFile` e o `uiStore`
 * guarda o alvo; esta view carrega o conteúdo com `api.readWorkspaceFile` e o
 * diff contra HEAD com `api.getFileDiffHead` em paralelo, e entrega os dois ao
 * `FilePreview` (código com highlight e marcas inline, imagem real ou PDF via
 * pdf.js). O carregamento ignora respostas velhas: cada requisição recebe um
 * token e só a mais recente escreve no estado — trocar de arquivo com uma
 * resposta em voo nunca sobrescreve o arquivo atual. Falha no diff nunca
 * derruba o conteúdo: o arquivo continua legível e só o aviso aparece.
 */
export function CodeFileView({ target, className }: CodeFileViewProps) {
  const { workspaceId, path } = target;
  const [content, setContent] = useState<WorkspaceFileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(true);
  const [diffError, setDiffError] = useState<string | null>(null);
  /** Token da requisição mais recente (respostas de tokens antigos são descartadas). */
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError(null);
    setDiff(null);
    setDiffError(null);
    setDiffLoading(true);

    const contentTask = (async () => {
      try {
        const next = await api.readWorkspaceFile(workspaceId, path);
        if (requestRef.current === requestId) setContent(next);
      } catch (loadError) {
        if (requestRef.current === requestId) {
          setContent(null);
          setError(describeError(loadError, t('code:codeFile.readError')));
        }
      } finally {
        if (requestRef.current === requestId) setLoading(false);
      }
    })();

    const diffTask = (async () => {
      try {
        const next = await api.getFileDiffHead(workspaceId, path);
        if (requestRef.current === requestId) setDiff(next);
      } catch (loadError) {
        if (requestRef.current === requestId) {
          setDiff(null);
          setDiffError(describeError(loadError, t('code:preview.diff.error')));
        }
      } finally {
        if (requestRef.current === requestId) setDiffLoading(false);
      }
    })();

    await Promise.allSettled([contentTask, diffTask]);
  }, [workspaceId, path]);

  useEffect(() => {
    setContent(null);
    setError(null);
    void load();
    return () => {
      /* Invalida a resposta em voo ao trocar de arquivo ou desmontar a aba. */
      requestRef.current += 1;
    };
  }, [load]);

  const openExternal = useCallback(() => {
    void api.openWorkspaceInExplorer(workspaceId);
  }, [workspaceId]);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <FilePreview
        content={content}
        loading={loading}
        error={error}
        diff={diff}
        diffLoading={diffLoading}
        diffError={diffError}
        onReload={() => void load()}
        onOpenExternal={openExternal}
        className="min-h-0 flex-1"
      />
    </div>
  );
}

export default CodeFileView;
