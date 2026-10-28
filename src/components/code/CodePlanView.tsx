import { useMemo } from 'react';

import type { CodePlanTab } from '@/lib/store';
import type { WorkspaceFileContent } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FilePreview } from './FilePreview';

export interface CodePlanViewProps {
  tab: CodePlanTab;
  className?: string;
}

/** Nome virtual exibido no cabeçalho/preview (extensão `.md` = Markdown). */
const PLAN_PREVIEW_PATH = 'Plano.md';

/**
 * Aba central do plano aprovado (WORKBENCH §5.4).
 *
 * Reusa o `FilePreview` da filetree (Documento ⇄ Código, Markdown GFM/KaTeX,
 * copiar, quebra de linha global) com um conteúdo virtual em memória — o plano
 * não é um arquivo do workspace e não passa pelo backend.
 */
export function CodePlanView({ tab, className }: CodePlanViewProps) {
  const content = useMemo<WorkspaceFileContent>(
    () => ({
      path: PLAN_PREVIEW_PATH,
      text: tab.markdown,
      truncated: false,
      size: new TextEncoder().encode(tab.markdown).length,
      encoding: 'utf-8',
      binary: false,
    }),
    [tab.markdown],
  );

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <FilePreview content={content} className="min-h-0 flex-1" />
    </div>
  );
}

export default CodePlanView;
