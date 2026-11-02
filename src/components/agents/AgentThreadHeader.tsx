import { ArrowLeft, PanelRight, Pencil } from 'lucide-react';

import { AgentAvatar } from './AgentAvatar';
import { modelLabel } from './agentUtils';
import { CodeContextMeterChip } from '@/components/code/CodeAgentWidgets';
import { Button, IconButton } from '@/components/ui';
import { useAppStore, useUiStore } from '@/lib/store';
import type { Agent, Conversation } from '@/lib/types';

export function AgentThreadHeader({
  agent,
  conversation,
  onBack,
}: {
  agent: Agent;
  conversation: Conversation;
  onBack: () => void;
}) {
  const providers = useAppStore((state) => state.providers);
  const openEditor = useUiStore((state) => state.openAgentEditor);
  const panelOpen = useUiStore((state) => state.codePanelOpen);
  const setPanelOpen = useUiStore((state) => state.setCodePanelOpen);
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-3">
      <IconButton label="Voltar para o agente" size="sm" variant="ghost" onClick={onBack}>
        <ArrowLeft className="size-4" />
      </IconButton>
      <AgentAvatar emoji={agent.emoji} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">{agent.name}</p>
        <p className="truncate text-[11px] text-foreground-muted">
          {conversation.title} · {modelLabel(providers, conversation.providerId, conversation.modelId)}
        </p>
      </div>
      {conversation.workspaceId ? (
        <CodeContextMeterChip conversationId={conversation.id} />
      ) : null}
      {conversation.workspaceId ? (
        <IconButton
          label={panelOpen ? 'Recolher painel do workspace' : 'Abrir painel do workspace'}
          size="sm"
          variant="ghost"
          active={panelOpen}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          <PanelRight className="size-4" />
        </IconButton>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => openEditor({ mode: 'edit', agentId: agent.id })}
      >
        <Pencil className="mr-1.5 size-3.5" />
        Editar agente
      </Button>
    </header>
  );
}
