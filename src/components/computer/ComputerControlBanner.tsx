import { MonitorStop, Square } from 'lucide-react';
import { toast } from 'sonner';

import { useActiveComputerSessions } from './useActiveComputerSessions';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useAgentStore, useChatStore, useUiStore } from '@/lib/store';

/**
 * Global fail-safe while a computer-use session is active outside the agent
 * thread header. Inside an agent thread, its topbar owns the status/stop
 * control; App passes that conversation as `hideConversationId` so the same
 * state is never shown twice.
 */
export function ComputerControlBanner({
  hideConversationId = null,
}: {
  hideConversationId?: string | null;
}) {
  const { sessions, clear } = useActiveComputerSessions();
  const agents = useAgentStore((state) => state.agentsById);
  const conversations = useChatStore((state) => state.conversations);
  const openConversation = useChatStore((state) => state.openConversation);
  const stopAllTurns = useChatStore((state) => state.stopAllTurns);

  const visible = sessions.filter(
    (entry) => entry.conversationId !== hideConversationId,
  );
  if (visible.length === 0) return null;
  const session = visible[0];
  const agent = session.agentId ? agents[session.agentId] : undefined;
  const conversation = conversations.find((entry) => entry.id === session.conversationId);

  const stopAll = async () => {
    try {
      await api.stopAllComputerSessions();
      await stopAllTurns();
      clear();
      toast.success('Computer use interrompido');
    } catch (error) {
      toast.error('Não foi possível parar', { description: String(error) });
    }
  };

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-50 flex max-w-sm items-center gap-3 rounded-2xl border border-warning/40 bg-surface-raised px-3 py-2.5 shadow-lg"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning">
        <MonitorStop className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-foreground">
          Lumina está controlando o computador
        </p>
        <p className="truncate text-[11px] text-foreground-muted">
          {agent?.name ?? 'Agente'} · {conversation?.title ?? session.conversationId} ·{' '}
          {session.backend}
        </p>
        <button
          type="button"
          className="mt-0.5 text-[10px] text-accent hover:underline"
          onClick={() => {
            if (session.agentId) {
              useUiStore.getState().setActiveAgentId(session.agentId);
            }
            void openConversation(session.conversationId);
          }}
        >
          Abrir thread
        </button>
      </div>
      <Button size="sm" variant="danger" onClick={() => void stopAll()}>
        <Square className="mr-1.5 size-3.5" />
        Parar
      </Button>
    </div>
  );
}
