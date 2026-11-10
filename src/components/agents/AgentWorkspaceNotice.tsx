import { useTranslation } from 'react-i18next';

import type { Agent, Conversation } from '@/lib/types';

export function AgentWorkspaceNotice({ agent, conversation }: { agent: Agent; conversation: Conversation | null }) {
  const { t } = useTranslation('agents');
  if (conversation ? conversation.workspaceId : agent.workspaceId) return null;

  return (
    <p className="text-[11px] text-foreground-muted">
      {conversation
        ? t('workspace.notice.conversation')
        : t('workspace.notice.noWorkspace')}
    </p>
  );
}
