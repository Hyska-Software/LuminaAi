import { Activity, Square, Timer } from 'lucide-react';

import { AgentAvatar } from './AgentAvatar';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui';
import { useAgentStore, useChatStore } from '@/lib/store';
import { cn } from '@/lib/utils';

function elapsedLabel(startedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/** Global view of every active turn, including background agent threads. */
export function AgentActivityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const streams = useChatStore((state) => state.streamsByConversation);
  const conversations = useChatStore((state) => state.conversations);
  const agents = useAgentStore((state) => state.agentsById);
  const stopConversation = useChatStore((state) => state.stopConversation);
  const stopAll = useChatStore((state) => state.stopAllTurns);
  const entries = Object.values(streams);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="size-4 text-accent" />
            Atividade
          </DialogTitle>
          <DialogDescription>
            Turnos rodando agora, inclusive threads em segundo plano. Parar libera o slot de
            concorrência imediatamente.
          </DialogDescription>
        </DialogHeader>
        {entries.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-foreground-muted">
            Nenhum turno em andamento.
          </p>
        ) : (
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {entries.map((stream) => {
              const conversation = conversations.find((entry) => entry.id === stream.conversationId);
              const agent = conversation?.agentId ? agents[conversation.agentId] : undefined;
              return (
                <article
                  key={stream.turnId}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised/50 p-2.5"
                >
                  {agent ? <AgentAvatar emoji={agent.emoji} size="sm" /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {agent?.name ?? 'Sessão'} · {conversation?.title ?? stream.conversationId}
                    </p>
                    <p className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
                      <Timer className="size-3" />
                      {elapsedLabel(stream.startedAt)} · {stream.phase} · passo {stream.step}
                      {stream.turnKind === 'goal_round' ? ' · objetivo' : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn('shrink-0')}
                    onClick={() => void stopConversation(stream.conversationId)}
                  >
                    <Square className="mr-1.5 size-3.5" />
                    Parar
                  </Button>
                </article>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="danger"
            disabled={entries.length === 0}
            onClick={() => void stopAll()}
          >
            <Square className="mr-1.5 size-4" />
            Parar tudo
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
