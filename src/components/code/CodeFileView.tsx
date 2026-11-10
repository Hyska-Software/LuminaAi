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

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return t('code:codeFile.readError');
}

/**
 * Aba central de arquivo do layout Code (WORKBENCH §7.1).
 *
 * O clique na árvore do painel Arquivos chama `openCodeFile` e o `uiStore`
 * guarda o alvo; esta view carrega o conteúdo com `api.readWorkspaceFile` e
 * entrega ao `FilePreview` (código com highlight, imagem real ou PDF via
 * pdf.js). O carregamento ignora respostas velhas: cada requisição recebe um
 * token e só a mais recente escreve no estado — trocar de arquivo com uma
 * resposta em voo nunca sobrescreve o arquivo atual.
 */
export function CodeFileView({ target, className }: CodeFileViewProps) {
  const { workspaceId, path } = target;
  const [content, setContent] = useState<WorkspaceFileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Token da requisição mais recente (respostas de tokens antigos são descartadas). */
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const next = await api.readWorkspaceFile(workspaceId, path);
      if (requestRef.current !== requestId) return;
      setContent(next);
    } catch (loadError) {
      if (requestRef.current !== requestId) return;
      setContent(null);
      setError(describeError(loadError));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
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
        onReload={() => void load()}
        onOpenExternal={openExternal}
        className="min-h-0 flex-1"
      />
    </div>
  );
}

export default CodeFileView;
