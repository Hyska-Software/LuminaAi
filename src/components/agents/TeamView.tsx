import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, BarChart3, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { AgentAvatar } from './AgentAvatar';
import { AgentBuilderDialog } from './AgentBuilderDialog';
import { AgentDialogBody } from './AgentDialogBody';
import { AgentTemplatesDialog } from './AgentTemplatesDialog';
import { formatUsageCost, formatUsageTokens, modelLabel, relativeTime } from './agentUtils';
import { AGENT_TEMPLATES, templateCapabilities, type AgentTemplate } from '@/lib/agentTemplates';
import { api } from '@/lib/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
} from '@/components/ui';
import {
  selectActiveAgents,
  selectArchivedAgents,
  useAgentStore,
  useAppStore,
  useChatStore,
  useUiStore,
} from '@/lib/store';
import type { Agent, AgentUsage } from '@/lib/types';

function AgentCard({
  agent,
  usage,
  onOpen,
  onTalk,
  onEdit,
  onArchive,
}: {
  agent: Agent;
  usage?: AgentUsage;
  onOpen: () => void;
  onTalk: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const providers = useAppStore((state) => state.providers);
  return (
    <article className="group flex min-h-44 flex-col rounded-2xl border border-border bg-surface-raised/60 p-4 transition-colors hover:border-border-strong hover:bg-surface-raised">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Abrir agente ${agent.name}`}
        className="flex min-w-0 items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <AgentAvatar avatar={agent.avatar} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold tracking-tight text-foreground">
            {agent.name}
          </span>
          <span className="block truncate text-[12px] text-foreground-muted">{agent.role}</span>
        </span>
      </button>
      <p className="mt-3 line-clamp-2 min-h-10 text-[13px] leading-relaxed text-foreground-muted">
        {agent.description || 'Sem descrição.'}
      </p>
      <p className="mt-3 truncate text-[11px] text-foreground-subtle">
        {modelLabel(providers, agent.providerId, agent.modelId)}
      </p>
      <p className="mt-1 truncate text-[11px] text-foreground-subtle">
        {agent.threadCount === 1 ? '1 conversa' : `${agent.threadCount} conversas`}
        {agent.lastActiveAt ? ` · ${relativeTime(agent.lastActiveAt)}` : ' · sem atividade'}
      </p>
      {usage && usage.turns > 0 ? (
        <p className="mt-1 truncate text-[11px] text-foreground-subtle">
          {formatUsageTokens(usage.totalTokens)} tokens · {formatUsageCost(usage.cost)}
        </p>
      ) : null}
      <div className="mt-auto flex items-center gap-2 pt-4">
        <Button size="sm" onClick={onTalk}>
          Conversar
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Editar
        </Button>
        <IconButton
          size="sm"
          label={`Arquivar agente ${agent.name}`}
          title="Arquivar"
          className="ml-auto"
          onClick={onArchive}
        >
          <Archive className="size-4" />
        </IconButton>
      </div>
    </article>
  );
}

export function TeamView() {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [usageById, setUsageById] = useState<Record<string, AgentUsage>>({});
  const agents = useAgentStore(useShallow(selectActiveAgents));
  const archived = useAgentStore(useShallow(selectArchivedAgents));
  const createAgent = useAgentStore((state) => state.create);
  const archive = useAgentStore((state) => state.archive);
  const restore = useAgentStore((state) => state.restore);
  const remove = useAgentStore((state) => state.remove);
  const refresh = useAgentStore((state) => state.refresh);
  const openEditor = useUiStore((state) => state.openAgentEditor);
  const setActiveAgentId = useUiStore((state) => state.setActiveAgentId);
  const setAgentView = useUiStore((state) => state.setAgentView);
  const startNewConversation = useChatStore((state) => state.startNewConversation);
  const clearActiveConversation = useChatStore((state) => state.clearActiveConversation);
  const conversations = useChatStore((state) => state.conversations);

  const agentIds = agents.map((agent) => agent.id).join('|');
  useEffect(() => {
    if (!agentIds) {
      setUsageById({});
      return;
    }
    let disposed = false;
    void api
      .listAgentUsage()
      .then((rows) => {
        if (disposed) return;
        setUsageById(
          Object.fromEntries(rows.map((usage) => [usage.agentId, usage] as const)),
        );
      })
      .catch(() => {
        if (!disposed) setUsageById({});
      });
    return () => {
      disposed = true;
    };
  }, [agentIds]);

  const openAgent = (agent: Agent) => {
    setActiveAgentId(agent.id);
    clearActiveConversation();
  };

  const talk = async (agent: Agent) => {
    setActiveAgentId(agent.id);
    await startNewConversation('agent', { agentId: agent.id });
  };

  const createFromTemplate = async (template: AgentTemplate) => {
    const providers = useAppStore.getState().providers;
    const selection = useAppStore.getState().selection;
    const provider = providers.find((entry) => entry.id === selection.providerId) ?? providers[0];
    if (!provider) {
      toast.error('Nenhum provedor configurado');
      return;
    }
    try {
      const agent = await createAgent({
        name: template.name,
        role: template.role,
        description: template.description,
        avatar: template.avatar,
        department: template.department,
        providerId: provider.id,
        modelId: provider.defaultModelId,
        reasoning: null,
        instructions: template.instructions,
        starters: template.starters,
        capabilities: templateCapabilities(template),
        memoryEnabled: template.memoryEnabled ?? false,
        workspaceId: null,
        permissionMode: 'autonomous',
      });
      await useChatStore.getState().refreshConversations();
      setActiveAgentId(agent.id);
      clearActiveConversation();
      setTemplatesOpen(false);
      toast.success('Agente criado a partir do template', { description: agent.name });
    } catch (error) {
      toast.error('Não foi possível criar o agente', { description: String(error) });
    }
  };

  const archiveAgent = async (agent: Agent) => {
    try {
      await archive(agent.id);
      toast.success('Agente arquivado', {
        description: agent.name,
        action: {
          label: 'Desfazer',
          onClick: () => void restore(agent.id),
        },
      });
    } catch (error) {
      toast.error('Não foi possível arquivar o agente', { description: String(error) });
    }
  };

  const restoreAgent = async (agent: Agent) => {
    try {
      await restore(agent.id);
      toast.success('Agente restaurado', { description: agent.name });
    } catch (error) {
      toast.error('Não foi possível restaurar o agente', { description: String(error) });
    }
  };

  const importAgent = async () => {
    try {
      const imported = await api.importAgent();
      if (!imported) return;
      await refresh();
      await useChatStore.getState().refreshConversations();
      setActiveAgentId(imported.id);
      clearActiveConversation();
      toast.success('Agente importado', { description: imported.name });
    } catch (error) {
      toast.error('Não foi possível importar o agente', { description: String(error) });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove(deleteTarget.id);
      await useChatStore.getState().refreshConversations();
      toast.success('Agente excluído', { description: deleteTarget.name });
      setDeleteTarget(null);
    } catch (error) {
      toast.error('Não foi possível excluir o agente', { description: String(error) });
    }
  };

  const deleteThreads = deleteTarget
    ? conversations.filter(
        (conversation) =>
          conversation.agentId === deleteTarget.id &&
          !conversation.channelId &&
          !conversation.isMain,
      ).length
    : 0;
  // Active agents keep the guard so their history is archived first; an
  // archived agent is already inactive, so permanent deletion removes every
  // conversation with it (the backend does the same).
  const deleteBlocked =
    deleteTarget !== null && deleteTarget.archivedAt === null && deleteThreads > 0;

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {agents.length === 0 ? (
        <div className="flex min-h-[70vh] items-center justify-center px-6 py-10">
          <div className="w-full max-w-2xl text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-border bg-surface-raised text-accent">
              <Sparkles className="size-6" />
            </div>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">Monte sua equipe</h1>
            <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-foreground-muted">
              Cada agente tem identidade, instruções, modelo e conversas próprias. Comece por um
              template ou crie do zero.
            </p>
            <div className="mt-6 grid gap-3 text-left sm:grid-cols-3">
              {AGENT_TEMPLATES.slice(0, 3).map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => void createFromTemplate(template)}
                  className="rounded-xl border border-border bg-surface-raised/60 p-4 text-left transition-colors hover:border-border-strong hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <AgentAvatar avatar={template.avatar} size="md" />
                  <span className="mt-2 block text-[13px] font-medium">{template.name}</span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-foreground-muted">
                    {template.description}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => openEditor({ mode: 'create' })}>
                <Plus className="mr-1.5 size-4" />
                Criar meu primeiro agente
              </Button>
              <Button variant="secondary" onClick={() => setBuilderOpen(true)}>
                <Sparkles className="mr-1.5 size-4" />
                Criar com IA
              </Button>
              <Button variant="ghost" onClick={() => setTemplatesOpen(true)}>
                Ver todos os templates
              </Button>
              <Button variant="ghost" onClick={() => setAgentView('stats')}>
                <BarChart3 className="mr-1.5 size-4" />
                Estatísticas
              </Button>
              <Button variant="ghost" onClick={() => void importAgent()}>
                <Upload className="mr-1.5 size-4" />
                Importar
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-5xl px-6 py-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Equipe</h1>
              <p className="mt-1 text-[13px] text-foreground-muted">
                Agentes que você pode chamar a qualquer momento.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAgentView('stats')}>
                <BarChart3 className="mr-1.5 size-4" />
                Estatísticas
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void importAgent()}>
                <Upload className="mr-1.5 size-4" />
                Importar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setTemplatesOpen(true)}>
                Templates
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setBuilderOpen(true)}>
                <Sparkles className="mr-1.5 size-4" />
                Criar com IA
              </Button>
              <Button variant="primary" size="sm" onClick={() => openEditor({ mode: 'create' })}>
                <Plus className="mr-1.5 size-4" />
                Criar agente
              </Button>
            </div>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                usage={usageById[agent.id]}
                onOpen={() => openAgent(agent)}
                onTalk={() => void talk(agent)}
                onEdit={() => {
                  setActiveAgentId(agent.id);
                  openEditor({ mode: 'edit', agentId: agent.id });
                }}
                onArchive={() => void archiveAgent(agent)}
              />
            ))}
          </div>
        </div>
      )}

      {archived.length > 0 ? (
        <section className="mx-auto w-full max-w-5xl px-6 pb-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Arquivados</h2>
              <p className="mt-1 text-[12px] text-foreground-muted">
                Arquivar preserva o histórico e as conversas.
              </p>
            </div>
            <span className="text-[11px] text-foreground-subtle">
              {archived.length === 1 ? '1 agente' : `${archived.length} agentes`}
            </span>
          </div>
          <div className="mt-4 space-y-2">
            {archived.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface/50 p-3"
              >
                <AgentAvatar avatar={agent.avatar} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{agent.name}</p>
                  <p className="truncate text-[11px] text-foreground-muted">
                    {agent.role} ·{' '}
                    {agent.threadCount === 1 ? '1 conversa' : `${agent.threadCount} conversas`}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => void restoreAgent(agent)}>
                  <ArchiveRestore className="mr-1.5 size-3.5" />
                  Restaurar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(agent)}>
                  <Trash2 className="mr-1.5 size-3.5" />
                  Excluir
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <AgentBuilderDialog open={builderOpen} onOpenChange={setBuilderOpen} />
      <AgentTemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onPick={createFromTemplate}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader className="pb-4 pr-12">
            <DialogTitle>Excluir agente?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? deleteTarget.archivedAt !== null && deleteThreads > 0
                  ? `“${deleteTarget.name}” será removido permanentemente junto com ${deleteThreads} outra(s) conversa(s). A conversa principal também é apagada.`
                  : `“${deleteTarget.name}” será removido permanentemente. A conversa principal é removida junto.`
                : 'Esta ação não pode ser desfeita.'}
            </DialogDescription>
          </DialogHeader>
          {deleteBlocked ? (
            <AgentDialogBody>
              <p className="rounded-lg border border-border bg-surface/50 px-3 py-2 text-[12px] text-foreground-muted">
                Este agente tem {deleteThreads} outra(s) conversa(s). Arquive-o para manter o
                histórico; a exclusão definitiva só é permitida sem outras conversas.
              </p>
            </AgentDialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={deleteBlocked}
              onClick={() => void confirmDelete()}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
