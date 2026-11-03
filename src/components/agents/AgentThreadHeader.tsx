import { ArrowLeft, FolderKanban, PanelRight, Pencil } from 'lucide-react';

import { AgentAvatar } from './AgentAvatar';
import { AgentConversationWorkspace } from './AgentConversationWorkspace';
import { modelLabel } from './agentUtils';
import { CodeContextMeterChip } from '@/components/code/CodeAgentWidgets';
import { Button, IconButton } from '@/components/ui';
import { useAppStore, useChatStore, useUiStore } from '@/lib/store';
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
  const turnActive = useChatStore((state) => Boolean(state.streamsByConversation[conversation.id]));
  const openEditor = useUiStore((state) => state.openAgentEditor);
  const panelOpen = useUiStore((state) => state.agentPanelOpen);
  const setPanelOpen = useUiStore((state) => state.setAgentPanelOpen);
  const rightPanel = useUiStore((state) => state.agentRightPanel);
  const setRightPanel = useUiStore((state) => state.setAgentRightPanel);
  const codePanelOpen = useUiStore((state) => state.codePanelOpen);
  const setCodePanelOpen = useUiStore((state) => state.setCodePanelOpen);
  const agentPanelActive = panelOpen && rightPanel === 'agent';
  const workspacePanelActive = codePanelOpen && rightPanel === 'workspace';
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
      <AgentConversationWorkspace conversation={conversation} busy={turnActive} onChanged={(updated) => {
        useChatStore.setState((state) => ({
          conversations: state.conversations.map((item) => item.id === updated.id ? updated : item),
        }));
      }} />
      {conversation.workspaceId ? (
        <CodeContextMeterChip conversationId={conversation.id} />
      ) : null}
      <IconButton
        label={agentPanelActive ? 'Recolher painel do agente' : 'Abrir painel do agente'}
        size="sm"
        variant="ghost"
        active={agentPanelActive}
        onClick={() => {
          setRightPanel('agent');
          setPanelOpen(!agentPanelActive);
          if (!agentPanelActive) setCodePanelOpen(false);
        }}
      >
        <PanelRight className="size-4" />
      </IconButton>
      {conversation.workspaceId ? (
        <IconButton
          label={
            workspacePanelActive
              ? 'Recolher ferramentas do workspace'
              : 'Abrir ferramentas do workspace'
          }
          size="sm"
          variant="ghost"
          active={workspacePanelActive}
          onClick={() => {
            setRightPanel('workspace');
            setCodePanelOpen(!workspacePanelActive);
            if (!workspacePanelActive) setPanelOpen(false);
          }}
        >
          <FolderKanban className="size-4" />
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
