import type { Agent, Conversation } from '@/lib/types';

export function AgentWorkspaceNotice({ agent, conversation }: { agent: Agent; conversation: Conversation | null }) {
  if (conversation ? conversation.workspaceId : agent.workspaceId) return null;

  return (
    <p className="text-[11px] text-foreground-muted">
      {conversation
        ? 'Esta conversa usa uma pasta interna do aplicativo, separada das demais conversas.'
        : 'Sem uma pasta escolhida, cada conversa usa uma pasta interna do aplicativo.'}
    </p>
  );
}
