import { useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { AgentMemoryPanel } from './AgentMemoryPanel';
import { inputFromAgent } from './agentUtils';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui';
import { ThinkingSelector } from '@/components/models/ThinkingSelector';
import { api } from '@/lib/api';
import { reasoningForModel } from '@/lib/modelMenu';
import { selectAgent, useAgentStore, useAppStore, useUiStore } from '@/lib/store';
import type {
  AgentCapabilities,
  AgentInput,
  McpServerSummary,
  PermissionMode,
  ReasoningSelection,
  SkillSummary,
  Workspace,
} from '@/lib/types';
import { cn } from '@/lib/utils';

const DEFAULT_CAPABILITIES: AgentCapabilities = {
  webSearch: true,
  fileAccess: true,
  codeExecution: true,
  skills: null,
  tools: null,
  mcpServers: null,
};

/** Stable catalog of tools an agent can be limited to. Kept in sync with the
 * Chat and Code registries; names not present remain globally gated. */
const TOOL_OPTIONS: Array<{ name: string; label: string; group: string }> = [
  { name: 'web_search', label: 'Busca web', group: 'Pesquisa' },
  { name: 'fetch_url', label: 'Ler página web', group: 'Pesquisa' },
  { name: 'create_file', label: 'Criar arquivos', group: 'Arquivos' },
  { name: 'run_code', label: 'Executar código', group: 'Arquivos' },
  { name: 'read_file', label: 'Ler arquivo', group: 'Workspace' },
  { name: 'list_dir', label: 'Listar pasta', group: 'Workspace' },
  { name: 'search_files', label: 'Buscar arquivos', group: 'Workspace' },
  { name: 'search_text', label: 'Buscar texto', group: 'Workspace' },
  { name: 'read_tool_output', label: 'Ler saída de ferramenta', group: 'Workspace' },
  { name: 'write_file', label: 'Escrever arquivo', group: 'Workspace' },
  { name: 'edit_file', label: 'Editar arquivo', group: 'Workspace' },
  { name: 'run_command', label: 'Executar comando', group: 'Workspace' },
  { name: 'job_list', label: 'Listar jobs', group: 'Jobs' },
  { name: 'job_output', label: 'Saída de job', group: 'Jobs' },
  { name: 'job_kill', label: 'Encerrar job', group: 'Jobs' },
  { name: 'git_status', label: 'Git status', group: 'Git' },
  { name: 'git_diff', label: 'Git diff', group: 'Git' },
  { name: 'git_log', label: 'Git log', group: 'Git' },
  { name: 'todo_write', label: 'Tarefas', group: 'Sessão' },
  { name: 'submit_plan', label: 'Enviar plano', group: 'Sessão' },
  { name: 'ask_user', label: 'Perguntar ao usuário', group: 'Sessão' },
  { name: 'goal', label: 'Objetivo', group: 'Sessão' },
  { name: 'run_checks', label: 'Verificações do projeto', group: 'Sessão' },
  { name: 'task', label: 'Subagente', group: 'Sessão' },
  { name: 'list_skills', label: 'Listar skills', group: 'Skills' },
  { name: 'read_skill', label: 'Ler skill', group: 'Skills' },
  { name: 'list_artifacts', label: 'Listar artefatos', group: 'Biblioteca' },
  { name: 'read_artifact', label: 'Ler artefato', group: 'Biblioteca' },
  { name: 'validate_ui', label: 'Validar interface', group: 'Interface' },
  { name: 'memory', label: 'Memória durável', group: 'Memória' },
];

const TOOL_GROUPS = [...new Set(TOOL_OPTIONS.map((tool) => tool.group))];

interface FormState {
  name: string;
  role: string;
  description: string;
  emoji: string;
  department: string;
  providerId: string;
  modelId: string;
  fallbackProviderId: string;
  fallbackModelId: string;
  reasoning: ReasoningSelection | null;
  instructions: string;
  starters: string;
  capabilities: AgentCapabilities;
  memoryEnabled: boolean;
  workspaceId: string;
  permissionMode: PermissionMode;
}

function emptyForm(providerId: string, modelId: string): FormState {
  return {
    name: '',
    role: 'Assistente',
    description: '',
    emoji: '🤖',
    department: 'Geral',
    providerId,
    modelId,
    fallbackProviderId: '',
    fallbackModelId: '',
    reasoning: null,
    instructions: '',
    starters: '',
    capabilities: { ...DEFAULT_CAPABILITIES },
    memoryEnabled: false,
    workspaceId: '',
    permissionMode: 'edit',
  };
}

function toggleList(values: string[] | null, name: string): string[] {
  const current = values ?? [];
  return current.includes(name)
    ? current.filter((value) => value !== name)
    : [...current, name];
}

export function AgentEditorDialog() {
  const editor = useUiStore((state) => state.agentEditor);
  const close = useUiStore((state) => state.closeAgentEditor);
  const setActiveAgentId = useUiStore((state) => state.setActiveAgentId);
  const providers = useAppStore((state) => state.providers);
  const selection = useAppStore((state) => state.selection);
  const agent = useAgentStore((state) =>
    editor?.mode === 'edit' ? selectAgent(state, editor.agentId) : null,
  );
  const createAgent = useAgentStore((state) => state.create);
  const updateAgent = useAgentStore((state) => state.update);
  const saving = useAgentStore((state) =>
    editor?.mode === 'edit' ? state.mutationById[editor.agentId] === 'saving' : false,
  );

  const fallbackProvider =
    providers.find((provider) => provider.id === selection.providerId) ?? providers[0];
  const [form, setForm] = useState<FormState>(() =>
    emptyForm(fallbackProvider?.id ?? '', fallbackProvider?.defaultModelId ?? ''),
  );
  const [tab, setTab] = useState('identity');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);

  useEffect(() => {
    if (!editor) return;
    setError(null);
    setTab('identity');
    if (editor.mode === 'edit' && agent) {
      const input = inputFromAgent(agent);
      setForm({
        name: input.name,
        role: input.role,
        description: input.description,
        emoji: input.emoji,
        department: input.department,
        providerId: input.providerId,
        modelId: input.modelId,
        fallbackProviderId: input.fallbackProviderId ?? '',
        fallbackModelId: input.fallbackModelId ?? '',
        reasoning: input.reasoning,
        instructions: input.instructions,
        starters: input.starters.join('\n'),
        capabilities: input.capabilities,
        memoryEnabled: input.memoryEnabled,
        workspaceId: input.workspaceId ?? '',
        permissionMode: input.permissionMode,
      });
    } else if (editor.mode === 'create' && editor.draft) {
      const draft = editor.draft;
      setForm({
        name: draft.name,
        role: draft.role,
        description: draft.description,
        emoji: draft.emoji,
        department: draft.department,
        providerId: draft.providerId,
        modelId: draft.modelId,
        fallbackProviderId: draft.fallbackProviderId ?? '',
        fallbackModelId: draft.fallbackModelId ?? '',
        reasoning: draft.reasoning,
        instructions: draft.instructions,
        starters: draft.starters.join('\n'),
        capabilities: draft.capabilities,
        memoryEnabled: draft.memoryEnabled,
        workspaceId: draft.workspaceId ?? '',
        permissionMode: draft.permissionMode,
      });
    } else {
      setForm(emptyForm(fallbackProvider?.id ?? '', fallbackProvider?.defaultModelId ?? ''));
    }
    // `agent?.updatedAt` refreshes the form after the store receives the save.
  }, [editor?.mode, editor?.mode === 'edit' ? editor.agentId : null, agent?.updatedAt]);

  useEffect(() => {
    if (!editor) return;
    let disposed = false;
    setSkillsLoading(true);
    void api
      .getSkills()
      .then((list) => {
        if (!disposed) setSkills(list);
      })
      .catch(() => {
        if (!disposed) setSkills([]);
      })
      .finally(() => {
        if (!disposed) setSkillsLoading(false);
      });
    setWorkspacesLoading(true);
    void api
      .listWorkspaces()
      .then((list) => {
        if (!disposed) setWorkspaces(list);
      })
      .catch(() => {
        if (!disposed) setWorkspaces([]);
      })
      .finally(() => {
        if (!disposed) setWorkspacesLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [editor !== null]);

  // MCP discovery starts servers; only do it when the capabilities tab is
  // actually opened.
  useEffect(() => {
    if (!editor || tab !== 'capabilities' || mcpServers.length > 0) return;
    let disposed = false;
    setMcpLoading(true);
    void api
      .mcpStatus()
      .then((status) => {
        if (!disposed) setMcpServers(Array.isArray(status.servers) ? status.servers : []);
      })
      .catch(() => {
        if (!disposed) setMcpServers([]);
      })
      .finally(() => {
        if (!disposed) setMcpLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [editor, tab, mcpServers.length]);

  const provider = useMemo(
    () => providers.find((entry) => entry.id === form.providerId) ?? fallbackProvider,
    [providers, form.providerId, fallbackProvider],
  );
  const model = useMemo(
    () => provider?.models.find((entry) => entry.id === form.modelId) ?? null,
    [provider, form.modelId],
  );
  const backupProvider = useMemo(
    () => providers.find((entry) => entry.id === form.fallbackProviderId),
    [providers, form.fallbackProviderId],
  );

  const set = <Key extends keyof FormState>(key: Key, value: FormState[Key]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const setCapability = <Key extends keyof AgentCapabilities>(
    key: Key,
    value: AgentCapabilities[Key],
  ) => setForm((current) => ({ ...current, capabilities: { ...current.capabilities, [key]: value } }));

  const onOpenChange = (open: boolean) => {
    if (!open && !saving && !submitting) close();
  };

  const submit = async () => {
    if (submitting) return;
    if (!form.name.trim()) {
      setError('Dê um nome ao agente.');
      setTab('identity');
      return;
    }
    if (!form.role.trim()) {
      setError('Informe o papel do agente.');
      setTab('identity');
      return;
    }
    if (!form.providerId || !form.modelId) {
      setError('Selecione um modelo.');
      setTab('model');
      return;
    }
    const input: AgentInput = {
      name: form.name.trim(),
      role: form.role.trim(),
      description: form.description.trim(),
      emoji: form.emoji.trim() || '🤖',
      department: form.department.trim() || 'Geral',
      providerId: form.providerId,
      modelId: form.modelId,
      fallbackProviderId: form.fallbackProviderId.trim() || null,
      fallbackModelId: form.fallbackModelId.trim() || null,
      reasoning: form.reasoning,
      instructions: form.instructions,
      starters: form.starters
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3),
      capabilities: form.capabilities,
      memoryEnabled: form.memoryEnabled,
      workspaceId: form.workspaceId.trim() || null,
      permissionMode: form.permissionMode,
    };
    setError(null);
    setSubmitting(true);
    try {
      if (editor?.mode === 'edit') {
        const updated = await updateAgent(editor.agentId, input);
        toast.success('Agente atualizado', { description: updated.name });
      } else {
        const created = await createAgent(input);
        setActiveAgentId(created.id);
        toast.success('Agente criado', { description: created.name });
      }
      close();
    } catch (caught) {
      setError(String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={editor !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editor?.mode === 'edit' ? 'Editar agente' : 'Criar agente'}</DialogTitle>
          <DialogDescription>
            Identidade, comportamento, modelo e limites. As instruções não concedem permissões ao
            agente.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="min-h-0">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="identity">Identidade</TabsTrigger>
            <TabsTrigger value="model">Modelo</TabsTrigger>
            <TabsTrigger value="behavior">Comportamento</TabsTrigger>
            <TabsTrigger value="capabilities">Capacidades</TabsTrigger>
            <TabsTrigger value="memory">Memória</TabsTrigger>
          </TabsList>

          <div className="max-h-[62vh] overflow-y-auto pr-1">
            <TabsContent value="identity" className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_5rem]">
                <div className="space-y-1.5">
                  <Label htmlFor="agent-name">Nome</Label>
                  <Input
                    id="agent-name"
                    value={form.name}
                    maxLength={40}
                    placeholder="Ex.: Irineu"
                    onChange={(event) => set('name', event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agent-emoji">Emoji</Label>
                  <Input
                    id="agent-emoji"
                    value={form.emoji}
                    onChange={(event) => set('emoji', event.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="agent-role">Papel</Label>
                  <Input
                    id="agent-role"
                    value={form.role}
                    maxLength={80}
                    placeholder="Engenheiro Fullstack"
                    onChange={(event) => set('role', event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agent-department">Departamento</Label>
                  <Input
                    id="agent-department"
                    value={form.department}
                    maxLength={40}
                    placeholder="Geral"
                    onChange={(event) => set('department', event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="agent-description">Descrição</Label>
                <Input
                  id="agent-description"
                  value={form.description}
                  maxLength={500}
                  placeholder="Uma frase sobre o que este agente faz."
                  onChange={(event) => set('description', event.target.value)}
                />
              </div>

              <div className="rounded-xl border border-border bg-surface-raised/50 p-3">
                <div className="flex items-center gap-2 text-[12px] text-foreground-muted">
                  <Bot className="size-4 text-accent" />
                  Cada conversa com este agente fica isolada na barra lateral e usa o modelo
                  definido abaixo.
                </div>
              </div>
            </TabsContent>

            <TabsContent value="model" className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="agent-provider">Provedor</Label>
                  <NativeSelect
                    id="agent-provider"
                    value={form.providerId}
                    onChange={(event) => {
                      const next = providers.find((entry) => entry.id === event.target.value);
                      const nextModel = next?.models.find(
                        (entry) => entry.id === next.defaultModelId,
                      );
                      setForm((current) => ({
                        ...current,
                        providerId: event.target.value,
                        modelId: next?.defaultModelId ?? '',
                        reasoning: reasoningForModel(nextModel, current.reasoning),
                      }));
                    }}
                  >
                    {providers.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agent-model">Modelo</Label>
                  <NativeSelect
                    id="agent-model"
                    value={form.modelId}
                    onChange={(event) => {
                      const nextModel = provider?.models.find(
                        (entry) => entry.id === event.target.value,
                      );
                      setForm((current) => ({
                        ...current,
                        modelId: event.target.value,
                        reasoning: reasoningForModel(nextModel, current.reasoning),
                      }));
                    }}
                  >
                    {provider &&
                    form.modelId &&
                    !provider.models.some((entry) => entry.id === form.modelId) ? (
                      <option value={form.modelId}>{form.modelId} (indisponível)</option>
                    ) : null}
                    {(provider?.models ?? []).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface-raised/50 p-3">
                <ThinkingSelector
                  model={model}
                  value={form.reasoning}
                  onChange={(reasoning) => set('reasoning', reasoning)}
                />
              </div>

              <div className="space-y-3 rounded-xl border border-border p-3">
                <div>
                  <p className="text-[12px] font-medium text-foreground">Modelo de reserva</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-foreground-subtle">
                    Se o provedor/modelo principal não estiver disponível ou não tiver
                    credencial, o turno começa no modelo de reserva. A conversa continua a mesma.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-fallback-provider">Provedor de reserva</Label>
                    <NativeSelect
                      id="agent-fallback-provider"
                      value={form.fallbackProviderId}
                      onChange={(event) => {
                        const value = event.target.value;
                        const next = providers.find((entry) => entry.id === value);
                        const nextModel =
                          next?.models.find((entry) => entry.id === next.defaultModelId) ??
                          next?.models[0];
                        setForm((current) => ({
                          ...current,
                          fallbackProviderId: value,
                          fallbackModelId: value ? (nextModel?.id ?? '') : '',
                        }));
                      }}
                    >
                      <option value="">Nenhum</option>
                      {providers.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-fallback-model">Modelo de reserva</Label>
                    <NativeSelect
                      id="agent-fallback-model"
                      value={form.fallbackModelId}
                      disabled={!form.fallbackProviderId}
                      onChange={(event) => set('fallbackModelId', event.target.value)}
                    >
                      {!form.fallbackProviderId ? <option value="">—</option> : null}
                      {(backupProvider?.models ?? []).map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-foreground-subtle">
                O modelo do agente fica congelado por conversa: as respostas antigas mantêm o
                modelo que as produziu. Trocar o provedor aqui vale para as próximas conversas.
              </p>
            </TabsContent>

            <TabsContent value="behavior" className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="agent-instructions">Instruções do agente</Label>
                <Textarea
                  id="agent-instructions"
                  value={form.instructions}
                  rows={9}
                  maxLength={32 * 1024}
                  className="min-h-52 resize-y"
                  placeholder="Como este agente fala, o que prioriza e como trabalha."
                  onChange={(event) => set('instructions', event.target.value)}
                />
                <p className="text-[11px] text-foreground-subtle">
                  As alterações valem a partir da próxima resposta. O prompt base de segurança
                  continua acima destas instruções.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="agent-starters">Sugestões para começar</Label>
                <Textarea
                  id="agent-starters"
                  value={form.starters}
                  rows={3}
                  className="min-h-20 resize-y"
                  placeholder={'Uma sugestão por linha (até 3)'}
                  onChange={(event) => set('starters', event.target.value)}
                />
              </div>
            </TabsContent>

            <TabsContent value="capabilities" className="mt-4 space-y-5">
              <div className="space-y-2 rounded-xl border border-border bg-surface-raised/50 p-3">
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                  <Sparkles className="size-3.5 text-accent" />
                  Ações básicas
                </p>
                <Switch
                  checked={form.capabilities.webSearch}
                  onCheckedChange={(checked) => setCapability('webSearch', checked)}
                  label="Busca web"
                  description="Permite pesquisar na web e citar fontes."
                />
                <Switch
                  checked={form.capabilities.fileAccess}
                  onCheckedChange={(checked) => setCapability('fileAccess', checked)}
                  label="Acesso a arquivos"
                  description="Permite ler/escrever no workspace (quando houver) e criar artefatos."
                />
                <Switch
                  checked={form.capabilities.codeExecution}
                  onCheckedChange={(checked) => setCapability('codeExecution', checked)}
                  label="Executar código"
                  description="Usa o sandbox de código do app (quando habilitado nas configurações)."
                />
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-surface-raised/50 p-3">
                <div>
                  <p className="text-[12px] font-medium text-foreground">Workspace e permissões</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-foreground-subtle">
                    Com um workspace, o agente usa o perfil de código (arquivos, terminal,
                    alterações e aprovações). Sem workspace, ele conversa e cria artefatos.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-workspace">Pasta de trabalho</Label>
                    <NativeSelect
                      id="agent-workspace"
                      value={form.workspaceId}
                      disabled={workspacesLoading}
                      onChange={(event) => set('workspaceId', event.target.value)}
                    >
                      <option value="">Nenhum workspace</option>
                      {workspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                          {workspace.trusted ? '' : ' (não confiável)'}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-permission">Permissões</Label>
                    <NativeSelect
                      id="agent-permission"
                      value={form.permissionMode}
                      disabled={!form.workspaceId}
                      onChange={(event) =>
                        set('permissionMode', event.target.value as PermissionMode)
                      }
                    >
                      <option value="read_only">Leitura</option>
                      <option value="review">Revisar cada edição</option>
                      <option value="edit">Editar</option>
                      <option value="autonomous">Autônomo</option>
                    </NativeSelect>
                  </div>
                </div>
                {form.workspaceId && workspaces.find((workspace) => workspace.id === form.workspaceId)?.trusted === false ? (
                  <p className="text-[11px] text-warning">
                    Confie nesta pasta no layout Code antes de usá-la no agente.
                  </p>
                ) : null}
                {!form.workspaceId ? (
                  <p className="text-[11px] text-foreground-subtle">
                    Abra uma pasta no layout Code para criar workspaces.
                  </p>
                ) : null}
              </div>

              <CapabilityList
                title="Ferramentas"
                description="Quando desligado, o agente herda todas as ferramentas disponíveis. Ao limitar, apenas as marcadas entram no catálogo do turno."
                inherit={form.capabilities.tools === null}
                onInherit={(inherit) =>
                  setCapability('tools', inherit ? null : TOOL_OPTIONS.map((tool) => tool.name))
                }
                items={TOOL_OPTIONS.map((tool) => ({
                  value: tool.name,
                  label: tool.label,
                  hint: tool.group,
                }))}
                selected={form.capabilities.tools ?? []}
                onToggle={(name) =>
                  setCapability('tools', toggleList(form.capabilities.tools, name))
                }
                loading={false}
                empty="Nenhuma ferramenta catalogada."
              />

              <CapabilityList
                title="Skills"
                description="Quando desligado, o agente herda todas as skills ativas do app. Ao limitar, apenas as marcadas ficam visíveis no prompt e nas ferramentas."
                inherit={form.capabilities.skills === null}
                onInherit={(inherit) =>
                  setCapability('skills', inherit ? null : skills.map((skill) => skill.name))
                }
                items={skills.map((skill) => ({
                  value: skill.name,
                  label: skill.name,
                  hint: `${skill.source}${skill.enabled === false ? ' · desativada globalmente' : ''}`,
                }))}
                selected={form.capabilities.skills ?? []}
                onToggle={(name) =>
                  setCapability('skills', toggleList(form.capabilities.skills, name))
                }
                loading={skillsLoading}
                empty="Nenhuma skill instalada."
              />

              <CapabilityList
                title="Servidores MCP"
                description="Quando desligado, o agente herda todos os servidores MCP habilitados. Ao limitar, apenas os marcados ficam disponíveis (no perfil de código)."
                inherit={form.capabilities.mcpServers === null}
                onInherit={(inherit) =>
                  setCapability(
                    'mcpServers',
                    inherit ? null : mcpServers.map((server) => server.name),
                  )
                }
                items={mcpServers.map((server) => ({
                  value: server.name,
                  label: server.name,
                  hint: server.enabled === false ? 'desativado' : 'MCP',
                }))}
                selected={form.capabilities.mcpServers ?? []}
                onToggle={(name) =>
                  setCapability('mcpServers', toggleList(form.capabilities.mcpServers, name))
                }
                loading={mcpLoading}
                empty="Nenhum servidor MCP configurado."
              />
            </TabsContent>

            <TabsContent value="memory" className="mt-4 space-y-4">
              <Switch
                checked={form.memoryEnabled}
                onCheckedChange={(checked) => set('memoryEnabled', checked)}
                label="Memória durável"
                description="Guarda fatos, preferências e procedimentos entre todas as conversas deste agente."
              />
              <AgentMemoryPanel
                agentId={editor?.mode === 'edit' ? editor.agentId : null}
                memoryEnabled={form.memoryEnabled}
              />
            </TabsContent>
          </div>
        </Tabs>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={saving || submitting}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving || submitting}>
            {saving || submitting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            Salvar agente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CapabilityList({
  title,
  description,
  inherit,
  onInherit,
  items,
  selected,
  onToggle,
  loading,
  empty,
}: {
  title: string;
  description: string;
  inherit: boolean;
  onInherit: (inherit: boolean) => void;
  items: Array<{ value: string; label: string; hint?: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  loading: boolean;
  empty: string;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <Switch
        checked={inherit}
        onCheckedChange={onInherit}
        label={title}
        description={description}
      />
      {inherit ? (
        <p className="text-[11px] text-foreground-subtle">Herdando todas as opções disponíveis.</p>
      ) : loading ? (
        <p className="text-[11px] text-foreground-muted">Carregando…</p>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-foreground-subtle">{empty}</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {items.map((item) => (
            <label
              key={item.value}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[12px]',
                selected.includes(item.value) ? 'border-accent/40 bg-accent-soft/50' : 'bg-surface-raised/40',
              )}
            >
              <input
                type="checkbox"
                checked={selected.includes(item.value)}
                onChange={() => onToggle(item.value)}
                className="size-3.5 accent-accent"
              />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint ? (
                <span className="shrink-0 text-[10px] text-foreground-subtle">{item.hint}</span>
              ) : null}
            </label>
          ))}
        </div>
      )}
      {!inherit && items.length > 0 && selected.length === 0 ? (
        <p className="text-[11px] text-warning">
          Nenhum item marcado: o agente ficará sem acesso a {title.toLowerCase()}.
        </p>
      ) : null}
    </div>
  );
}
