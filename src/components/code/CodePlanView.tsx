import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodePlanTab } from '@/lib/store';
import type { WorkspaceFileContent } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FilePreview } from './FilePreview';

export interface CodePlanViewProps {
  tab: CodePlanTab;
  className?: string;
}

/** Nome virtual exibido no cabeçalho/preview (extensão `.md` = Markdown). */

/**
 * Aba central do plano aprovado (WORKBENCH §5.4).
 *
 * Reusa o `FilePreview` da filetree (Documento ⇄ Código, Markdown GFM/KaTeX,
 * copiar, quebra de linha global) com um conteúdo virtual em memória — o plano
 * não é um arquivo do workspace e não passa pelo backend.
 */
export function CodePlanView({ tab, className }: CodePlanViewProps) {
  const { t } = useTranslation('code');
  const content = useMemo<WorkspaceFileContent>(
    () => ({
      path: t('code:plan.previewPath'),
      text: tab.markdown,
      truncated: false,
      size: new TextEncoder().encode(tab.markdown).length,
      encoding: 'utf-8',
      binary: false,
    }),
    [tab.markdown, t],
  );

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <FilePreview content={content} className="min-h-0 flex-1" />
    </div>
  );
}

export default CodePlanView;
