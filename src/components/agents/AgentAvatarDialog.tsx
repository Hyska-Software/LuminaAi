import { toast } from 'sonner';

import { AgentAvatarPicker } from './AgentAvatarPicker';
import { AgentDialogBody } from './AgentDialogBody';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';
import { useAgentStore, useUiStore } from '@/lib/store';

/** Quick avatar editor opened from the agent home/sidebar. Persists on change. */
export function AgentAvatarDialog() {
  const agentId = useUiStore((state) => state.agentAvatarEditor);
  const close = useUiStore((state) => state.closeAgentAvatarEditor);
  const agent = useAgentStore((state) =>
    agentId ? (state.agentsById[agentId] ?? null) : null,
  );
  const updateAvatar = useAgentStore((state) => state.updateAvatar);

  return (
    <Dialog
      open={agentId !== null && agent !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent size="sm" className="max-h-[calc(100dvh-2rem)]">
        <DialogHeader className="pb-3 pr-12">
          <DialogTitle>Avatar</DialogTitle>
          <DialogDescription>
            Personalize o avatar de {agent?.name ?? 'agente'}.
          </DialogDescription>
        </DialogHeader>
        <AgentDialogBody className="pb-5">
          {agent ? (
            <AgentAvatarPicker
              value={agent.avatar}
              onChange={(avatar) => {
                void updateAvatar(agent.id, avatar).catch((error) => {
                  toast.error('Não foi possível salvar o avatar', {
                    description: String(error),
                  });
                });
              }}
            />
          ) : null}
        </AgentDialogBody>
      </DialogContent>
    </Dialog>
  );
}
