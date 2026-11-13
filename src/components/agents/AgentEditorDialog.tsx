import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { AgentMemoryPanel } from './AgentMemoryPanel';
import { AgentAvatar } from './AgentAvatar';
import { AgentAvatarPicker } from './AgentAvatarPicker';
import { AgentWorkspacePicker } from './AgentWorkspacePicker';
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
import { DEFAULT_AGENT_AVATAR } from '@/lib/agentAvatar';
import { DEFAULT_AGENT_CAPABILITIES } from '@/lib/agentDefaults';
import { reasoningForModel } from '@/lib/modelMenu';
import { AUTONOMOUS_MODE_WARNING_KEY } from '@/lib/permissionModes';
import { selectAgent, useAgentStore, useAppStore, useChatStore, useUiStore } from '@/lib/store';
import type {
  AgentAvatar as AgentAvatarSpec,
  AgentCapabilities,
  AgentInput,
  ComputerEnvironment,
  McpServerSummary,
  PermissionMode,
  ReasoningSelection,
  SkillSummary,
  Workspace,
} from '@/lib/types';
import { cn } from '@/lib/utils';

/** Stable catalog of tools an agent can be limited to. Kept in sync with the
 * Chat and Code registries; names not present remain globally gated. */
const TOOL_OPTIONS: Array<{ name: string; labelKey: string; groupKey: string }> = [
  { name: 'web_search', labelKey: 'editor.tools.web_search', groupKey: 'editor.toolGroups.pesquisa' },
  { name: 'fetch_url', labelKey: 'editor.tools.fetch_url', groupKey: 'editor.toolGroups.pesquisa' },
  { name: 'create_file', labelKey: 'editor.tools.create_file', groupKey: 'editor.toolGroups.arquivos' },
  { name: 'run_code', labelKey: 'editor.tools.run_code', groupKey: 'editor.toolGroups.arquivos' },
  { name: 'read_file', labelKey: 'editor.tools.read_file', groupKey: 'editor.toolGroups.workspace' },
  { name: 'list_dir', labelKey: 'editor.tools.list_dir', groupKey: 'editor.toolGroups.workspace' },
  { name: 'search_files', labelKey: 'editor.tools.search_files', groupKey: 'editor.toolGroups.workspace' },
  { name: 'search_text', labelKey: 'editor.tools.search_text', groupKey: 'editor.toolGroups.workspace' },
  { name: 'read_tool_output', labelKey: 'editor.tools.read_tool_output', groupKey: 'editor.toolGroups.workspace' },
  { name: 'write_file', labelKey: 'editor.tools.write_file', groupKey: 'editor.toolGroups.workspace' },
  { name: 'edit_file', labelKey: 'editor.tools.edit_file', groupKey: 'editor.toolGroups.workspace' },
  { name: 'run_command', labelKey: 'editor.tools.run_command', groupKey: 'editor.toolGroups.workspace' },
  { name: 'job_list', labelKey: 'editor.tools.job_list', groupKey: 'editor.toolGroups.jobs' },
  { name: 'job_output', labelKey: 'editor.tools.job_output', groupKey: 'editor.toolGroups.jobs' },
  { name: 'job_kill', labelKey: 'editor.tools.job_kill', groupKey: 'editor.toolGroups.jobs' },
  { name: 'git_status', labelKey: 'editor.tools.git_status', groupKey: 'editor.toolGroups.git' },
  { name: 'git_diff', labelKey: 'editor.tools.git_diff', groupKey: 'editor.toolGroups.git' },
  { name: 'git_log', labelKey: 'editor.tools.git_log', groupKey: 'editor.toolGroups.git' },
  { name: 'todo_write', labelKey: 'editor.tools.todo_write', groupKey: 'editor.toolGroups.sessao' },
  { name: 'submit_plan', labelKey: 'editor.tools.submit_plan', groupKey: 'editor.toolGroups.sessao' },
  { name: 'ask_user', labelKey: 'editor.tools.ask_user', groupKey: 'editor.toolGroups.sessao' },
  { name: 'goal', labelKey: 'editor.tools.goal', groupKey: 'editor.toolGroups.sessao' },
  { name: 'run_checks', labelKey: 'editor.tools.run_checks', groupKey: 'editor.toolGroups.sessao' },
  { name: 'task', labelKey: 'editor.tools.task', groupKey: 'editor.toolGroups.sessao' },
  { name: 'list_skills', labelKey: 'editor.tools.list_skills', groupKey: 'editor.toolGroups.skills' },
  { name: 'read_skill', labelKey: 'editor.tools.read_skill', groupKey: 'editor.toolGroups.skills' },
  { name: 'skill_save', labelKey: 'editor.tools.skill_save', groupKey: 'editor.toolGroups.skills' },
  { name: 'list_artifacts', labelKey: 'editor.tools.list_artifacts', groupKey: 'editor.toolGroups.biblioteca' },
  { name: 'read_artifact', labelKey: 'editor.tools.read_artifact', groupKey: 'editor.toolGroups.biblioteca' },
  { name: 'validate_ui', labelKey: 'editor.tools.validate_ui', groupKey: 'editor.toolGroups.interface' },
  { name: 'memory', labelKey: 'editor.tools.memory', groupKey: 'editor.toolGroups.memoria' },
  { name: 'delegate_task', labelKey: 'editor.tools.delegate_task', groupKey: 'editor.toolGroups.delegacao' },
  { name: 'task_list', labelKey: 'editor.tools.task_list', groupKey: 'editor.toolGroups.delegacao' },
  { name: 'task_get', labelKey: 'editor.tools.task_get', groupKey: 'editor.toolGroups.delegacao' },
  { name: 'task_wait', labelKey: 'editor.tools.task_wait', groupKey: 'editor.toolGroups.delegacao' },
  { name: 'task_cancel', labelKey: 'editor.tools.task_cancel', groupKey: 'editor.toolGroups.delegacao' },
  { name: 'accept_task', labelKey: 'editor.tools.accept_task', groupKey: 'editor.toolGroups.delegacao' },
  { name: 'decline_task', labelKey: 'editor.tools.decline_task', groupKey: 'editor.toolGroups.delegacao' },
  { name: 'handoff_task', labelKey: 'editor.tools.handoff_task', groupKey: 'editor.toolGroups.delegacao' },
  { name: 'update_task', labelKey: 'editor.tools.update_task', groupKey: 'editor.toolGroups.delegacao' },
  { name: 'finish_task', labelKey: 'editor.tools.finish_task', groupKey: 'editor.toolGroups.delegacao' },
  { name: 'send_message', labelKey: 'editor.tools.send_message', groupKey: 'editor.toolGroups.delegacao' },
  { name: 'agent_directory', labelKey: 'editor.tools.agent_directory', groupKey: 'editor.toolGroups.agentes' },
  { name: 'agent_usage', labelKey: 'editor.tools.agent_usage', groupKey: 'editor.toolGroups.agentes' },
  { name: 'agent_inbox', labelKey: 'editor.tools.agent_inbox', groupKey: 'editor.toolGroups.agentes' },
  { name: 'agent_message', labelKey: 'editor.tools.agent_message', groupKey: 'editor.toolGroups.agentes' },
  { name: 'create_agent', labelKey: 'editor.tools.create_agent', groupKey: 'editor.toolGroups.agentes' },
  { name: 'routine_list', labelKey: 'editor.tools.routine_list', groupKey: 'editor.toolGroups.automacao' },
  { name: 'routine_create', labelKey: 'editor.tools.routine_create', groupKey: 'editor.toolGroups.automacao' },
  { name: 'routine_update', labelKey: 'editor.tools.routine_update', groupKey: 'editor.toolGroups.automacao' },
  { name: 'routine_delete', labelKey: 'editor.tools.routine_delete', groupKey: 'editor.toolGroups.automacao' },
  { name: 'computer_screenshot', labelKey: 'editor.tools.computer_screenshot', groupKey: 'editor.toolGroups.computador' },
  { name: 'computer_windows', labelKey: 'editor.tools.computer_windows', groupKey: 'editor.toolGroups.computador' },
  { name: 'computer_ui_tree', labelKey: 'editor.tools.computer_ui_tree', groupKey: 'editor.toolGroups.computador' },
  { name: 'computer_click', labelKey: 'editor.tools.computer_click', groupKey: 'editor.toolGroups.computador' },
  { name: 'computer_type', labelKey: 'editor.tools.computer_type', groupKey: 'editor.toolGroups.computador' },
  { name: 'computer_key', labelKey: 'editor.tools.computer_key', groupKey: 'editor.toolGroups.computador' },
  { name: 'computer_focus', labelKey: 'editor.tools.computer_focus', groupKey: 'editor.toolGroups.computador' },
  { name: 'browser_open', labelKey: 'editor.tools.browser_open', groupKey: 'editor.toolGroups.computador' },
];


interface FormState {
  name: string;
  role: string;
  description: string;
  avatar: AgentAvatarSpec;
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
  dockerImage: string;
  computerEnvironment: ComputerEnvironment;
}

function emptyForm(providerId: string, modelId: string): FormState {
  return {
    name: '',
    role: '',
    description: '',
    avatar: DEFAULT_AGENT_AVATAR,
    department: '',
    providerId,
    modelId,
    fallbackProviderId: '',
    fallbackModelId: '',
    reasoning: null,
    instructions: '',
    starters: '',
    capabilities: { ...DEFAULT_AGENT_CAPABILITIES },
    memoryEnabled: false,
    workspaceId: '',
    permissionMode: 'autonomous',
    dockerImage: '',
    computerEnvironment: 'auto',
  };
}

function toggleList(values: string[] | null, name: string): string[] {
  const current = values ?? [];
  return current.includes(name)
    ? current.filter((value) => value !== name)
    : [...current, name];
}

export function AgentEditorDialog() {
  const { t } = useTranslation('agents');
  const { t: tc } = useTranslation('code');
  const editor = useUiStore((state) => state.agentEditor);
  const close = useUiStore((state) => state.closeAgentEditor);
  const setActiveAgentId = useUiStore((state) => state.setActiveAgentId);
  const providers = useAppStore((state) => state.providers);
  const selection = useAppStore((state) => state.selection);
  const settings = useAppStore((state) => state.settings);
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
  const globalDockerImage = settings.dockerImage?.trim() || 'node:22-bookworm';
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
  const bodyRef = useRef<HTMLDivElement>(null);

  /* Each tab starts at the top: the body is shared so the previous scroll
     position would otherwise leak into a shorter tab. */
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [tab]);

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
        avatar: input.avatar,
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
        dockerImage: input.dockerImage ?? '',
        computerEnvironment: input.computerEnvironment ?? 'auto',
      });
    } else if (editor.mode === 'create' && editor.draft) {
      const draft = editor.draft;
      setForm({
        name: draft.name,
        role: draft.role,
        description: draft.description,
        avatar: draft.avatar,
        department: draft.department,
        providerId: draft.providerId,
        modelId: draft.modelId,
        fallbackProviderId: draft.fallbackProviderId ?? '',
        fallbackModelId: draft.fallbackModelId ?? '',
        reasoning: draft.reasoning,
        instructions: draft.instructions,
        starters: draft.starters.join('\n'),
        capabilities: { ...DEFAULT_AGENT_CAPABILITIES, ...draft.capabilities },
        memoryEnabled: draft.memoryEnabled,
        workspaceId: draft.workspaceId ?? '',
        permissionMode: draft.permissionMode,
        dockerImage: draft.dockerImage ?? '',
        computerEnvironment: draft.computerEnvironment ?? 'auto',
      });
    } else {
      setForm({
        ...emptyForm(fallbackProvider?.id ?? '', fallbackProvider?.defaultModelId ?? ''),
        role: t('editor.roleDefault'),
        department: t('departments.general'),
      });
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
      setError(t('editor.validation.name'));
      setTab('identity');
      return;
    }
    if (!form.role.trim()) {
      setError(t('editor.validation.role'));
      setTab('identity');
      return;
    }
    if (!form.providerId || !form.modelId) {
      setError(t('editor.validation.model'));
      setTab('model');
      return;
    }
    const input: AgentInput = {
      name: form.name.trim(),
      role: form.role.trim(),
      description: form.description.trim(),
      avatar: form.avatar,
      department: form.department.trim() || t('departments.general'),
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
      dockerImage: form.dockerImage.trim() || null,
      computerEnvironment: form.computerEnvironment,
    };
    setError(null);
    setSubmitting(true);
    try {
      if (editor?.mode === 'edit') {
        const updated = await updateAgent(editor.agentId, input);
        await useChatStore.getState().refreshConversations();
        toast.success(t('editor.updated'), { description: updated.name });
      } else {
        const created = await createAgent(input);
        await useChatStore.getState().refreshConversations();
        setActiveAgentId(created.id);
        toast.success(t('editor.created'), { description: created.name });
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
      <DialogContent className="h-[720px] max-w-3xl">
        <DialogHeader className="pb-4 pr-12">
          <DialogTitle>{editor?.mode === 'edit' ? t('editor.titleEdit') : t('editor.titleCreate')}</DialogTitle>
          <DialogDescription>
            {t('editor.description')}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-6">
            <TabsList className="w-full justify-start overflow-x-auto scrollbar-none">
              <TabsTrigger value="identity">{t('editor.tabs.identity')}</TabsTrigger>
              <TabsTrigger value="avatar">{t('editor.tabs.avatar')}</TabsTrigger>
              <TabsTrigger value="model">{t('editor.tabs.model')}</TabsTrigger>
              <TabsTrigger value="behavior">{t('editor.tabs.behavior')}</TabsTrigger>
              <TabsTrigger value="capabilities">{t('editor.tabs.capabilities')}</TabsTrigger>
              <TabsTrigger value="memory">{t('editor.tabs.memory')}</TabsTrigger>
            </TabsList>
          </div>

          <div
            ref={bodyRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-5 pt-4"
          >
            <TabsContent value="identity" className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl bg-surface p-3">
                <AgentAvatar avatar={form.avatar} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-foreground">{t('editor.avatar.title')}</p>
                  <p className="text-[11px] text-foreground-subtle">
                    {t('editor.avatar.hint')}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setTab('avatar')}>
                  {t('editor.avatar.customize')}
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="agent-name">{t('editor.name')}</Label>
                <Input
                  id="agent-name"
                  value={form.name}
                  maxLength={40}
                  placeholder={t('editor.namePlaceholder')}
                  onChange={(event) => set('name', event.target.value)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="agent-role">{t('editor.role')}</Label>
                  <Input
                    id="agent-role"
                    value={form.role}
                    maxLength={80}
                    placeholder={t('editor.rolePlaceholder')}
                    onChange={(event) => set('role', event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agent-department">{t('editor.department')}</Label>
                  <Input
                    id="agent-department"
                    value={form.department}
                    maxLength={40}
                    placeholder={t('editor.departmentPlaceholder')}
                    onChange={(event) => set('department', event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="agent-description">{t('editor.descriptionField')}</Label>
                <Input
                  id="agent-description"
                  value={form.description}
                  maxLength={500}
                  placeholder={t('editor.descriptionPlaceholder')}
                  onChange={(event) => set('description', event.target.value)}
                />
              </div>

              <div className="rounded-xl bg-surface p-4">
                <div className="flex items-center gap-2 text-[12px] text-foreground-muted">
                  <Bot className="size-4 text-accent" />
                  {t('editor.identityNote')}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="avatar" className="space-y-4">
              <AgentAvatarPicker
                value={form.avatar}
                onChange={(avatar) => set('avatar', avatar)}
              />
            </TabsContent>

            <TabsContent value="model" className="space-y-4">
              <div className="space-y-4 rounded-xl bg-surface p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-provider">{t('editor.provider')}</Label>
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
                    <Label htmlFor="agent-model">{t('editor.model')}</Label>
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
                        <option value={form.modelId}>{t('editor.modelUnavailable', { model: form.modelId })}</option>
                      ) : null}
                      {(provider?.models ?? []).map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                </div>
                <ThinkingSelector
                  model={model}
                  value={form.reasoning}
                  onChange={(reasoning) => set('reasoning', reasoning)}
                />
              </div>

              <div className="space-y-3 rounded-xl bg-surface p-4">
                <div>
                  <p className="text-[12px] font-medium text-foreground">{t('editor.fallback.title')}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-foreground-subtle">
                    {t('editor.fallback.description')}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-fallback-provider">{t('editor.fallback.provider')}</Label>
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
                      <option value="">{t('editor.fallback.none')}</option>
                      {providers.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-fallback-model">{t('editor.fallback.model')}</Label>
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
                {t('editor.modelNote')}
              </p>
            </TabsContent>

            <TabsContent value="behavior" className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="agent-instructions">{t('editor.instructions')}</Label>
                <Textarea
                  id="agent-instructions"
                  value={form.instructions}
                  rows={9}
                  maxLength={32 * 1024}
                  className="min-h-52 resize-y"
                  placeholder={t('editor.instructionsPlaceholder')}
                  onChange={(event) => set('instructions', event.target.value)}
                />
                <p className="text-[11px] text-foreground-subtle">
                  {t('editor.instructionsNote')}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="agent-starters">{t('editor.starters')}</Label>
                <Textarea
                  id="agent-starters"
                  value={form.starters}
                  rows={3}
                  className="min-h-20 resize-y"
                  placeholder={t('editor.startersPlaceholder')}
                  onChange={(event) => set('starters', event.target.value)}
                />
              </div>
            </TabsContent>

            <TabsContent value="capabilities" className="space-y-4">
              <div className="space-y-2 rounded-xl bg-surface p-4">
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                  <Sparkles className="size-3.5 text-accent" />
                  {t('editor.basicActions')}
                </p>
                <Switch
                  checked={form.capabilities.webSearch}
                  onCheckedChange={(checked) => setCapability('webSearch', checked)}
                  label={t('editor.capabilities.webSearch.label')}
                  description={t('editor.capabilities.webSearch.description')}
                />
                <Switch
                  checked={form.capabilities.fileAccess}
                  onCheckedChange={(checked) => setCapability('fileAccess', checked)}
                  label={t('editor.capabilities.fileAccess.label')}
                  description={t('editor.capabilities.fileAccess.description')}
                />
                <Switch
                  checked={form.capabilities.codeExecution}
                  onCheckedChange={(checked) => setCapability('codeExecution', checked)}
                  label={t('editor.capabilities.codeExecution.label')}
                  description={t('editor.capabilities.codeExecution.description')}
                />
                <Switch
                  checked={form.capabilities.delegation ?? false}
                  onCheckedChange={(checked) => setCapability('delegation', checked)}
                  label={t('editor.capabilities.delegation.label')}
                  description={t('editor.capabilities.delegation.description')}
                />
                <Switch
                  checked={form.capabilities.automation ?? false}
                  onCheckedChange={(checked) => setCapability('automation', checked)}
                  label={t('editor.capabilities.automation.label')}
                  description={t('editor.capabilities.automation.description')}
                />
                <Switch
                  checked={form.capabilities.sharedMemory ?? false}
                  onCheckedChange={(checked) => setCapability('sharedMemory', checked)}
                  label={t('editor.capabilities.sharedMemory.label')}
                  description={t('editor.capabilities.sharedMemory.description')}
                />
                <Switch
                  checked={form.capabilities.skillsWrite ?? false}
                  onCheckedChange={(checked) => setCapability('skillsWrite', checked)}
                  label={t('editor.capabilities.skillsWrite.label')}
                  description={t('editor.capabilities.skillsWrite.description')}
                />
                <Switch
                  checked={form.capabilities.createAgents ?? false}
                  onCheckedChange={(checked) => setCapability('createAgents', checked)}
                  label={t('editor.capabilities.createAgents.label')}
                  description={t('editor.capabilities.createAgents.description')}
                />
                <Switch
                  checked={form.capabilities.computerUse ?? false}
                  onCheckedChange={(checked) => setCapability('computerUse', checked)}
                  label={t('editor.capabilities.computerUse.label')}
                  description={t('editor.capabilities.computerUse.description')}
                />
                <Switch
                  checked={form.capabilities.screenCapture ?? false}
                  onCheckedChange={(checked) => setCapability('screenCapture', checked)}
                  label={t('editor.capabilities.screenCapture.label')}
                  description={t('editor.capabilities.screenCapture.description')}
                />
                <Switch
                  checked={form.capabilities.browserUse ?? false}
                  onCheckedChange={(checked) => setCapability('browserUse', checked)}
                  label={t('editor.capabilities.browserUse.label')}
                  description={t('editor.capabilities.browserUse.description')}
                />
                <Switch
                  checked={form.capabilities.dockerExecution ?? false}
                  onCheckedChange={(checked) => setCapability('dockerExecution', checked)}
                  label={t('editor.capabilities.dockerExecution.label')}
                  description={t('editor.capabilities.dockerExecution.description')}
                />
              </div>

              <div className="space-y-3 rounded-xl bg-surface p-4">
                <div>
                  <p className="text-[12px] font-medium text-foreground">{t('editor.workspace.title')}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-foreground-subtle">
                    {t('editor.workspace.description')}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-workspace">{t('editor.workspace.folder')}</Label>
                    <NativeSelect
                      id="agent-workspace"
                      value={form.workspaceId}
                      disabled={workspacesLoading}
                      onChange={(event) => set('workspaceId', event.target.value)}
                    >
                      <option value="">{t('editor.workspace.internal')}</option>
                      {workspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.trusted
                            ? workspace.name
                            : t('editor.workspace.untrusted', { name: workspace.name })}
                        </option>
                      ))}
                    </NativeSelect>
                    <AgentWorkspacePicker onSelected={(workspace) => {
                      setWorkspaces((current) => [...current.filter((item) => item.id !== workspace.id), workspace]);
                      set('workspaceId', workspace.id);
                    }} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-permission">{t('editor.permissionsLabel')}</Label>
                    <NativeSelect
                      id="agent-permission"
                      value={form.permissionMode}
                      onChange={(event) =>
                        set('permissionMode', event.target.value as PermissionMode)
                      }
                    >
                      <option value="read_only">{t('editor.permissions.readOnly')}</option>
                      <option value="review">{t('editor.permissions.review')}</option>
                      <option value="edit">{t('editor.permissions.edit')}</option>
                      <option value="autonomous">{t('editor.permissions.autonomous')}</option>
                    </NativeSelect>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agent-docker-image">{t('editor.dockerImage')}</Label>
                  <Input
                    id="agent-docker-image"
                    value={form.dockerImage}
                    maxLength={200}
                    placeholder={globalDockerImage}
                    disabled={!form.capabilities.dockerExecution}
                    onChange={(event) => set('dockerImage', event.target.value)}
                  />
                  <p className="text-[11px] text-foreground-subtle">
                    {t('editor.dockerImageNote', { image: globalDockerImage })}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agent-computer-environment">{t('editor.environmentLabel')}</Label>
                  <NativeSelect
                    id="agent-computer-environment"
                    value={form.computerEnvironment}
                    onChange={(event) =>
                      set('computerEnvironment', event.target.value as ComputerEnvironment)
                    }
                  >
                    <option value="auto">{t('editor.environment.auto')}</option>
                    <option value="private_desktop">{t('editor.environment.privateDesktop')}</option>
                    <option value="this_computer">{t('editor.environment.thisComputer')}</option>
                    <option value="browser">{t('editor.environment.browser')}</option>
                    <option value="off">{t('editor.environment.off')}</option>
                  </NativeSelect>
                  <p className="text-[11px] text-foreground-subtle">
                    {t('editor.environmentNote')}
                  </p>
                </div>
                {form.workspaceId && workspaces.find((workspace) => workspace.id === form.workspaceId)?.trusted === false ? (
                  <p className="text-[11px] text-warning">
                    {t('editor.trustFolderWarning')}
                  </p>
                ) : null}
                {!form.workspaceId ? (
                  <p className="text-[11px] text-foreground-subtle">
                    {t('editor.internalFolderNote')}
                  </p>
                ) : null}
              </div>

              <CapabilityList
                title={t('editor.capabilities.tools.title')}
                description={t('editor.capabilities.tools.description')}
                inherit={form.capabilities.tools === null}
                onInherit={(inherit) =>
                  setCapability('tools', inherit ? null : TOOL_OPTIONS.map((tool) => tool.name))
                }
                items={TOOL_OPTIONS.map((tool) => ({
                  value: tool.name,
                  label: t(tool.labelKey as never),
                  hint: t(tool.groupKey as never),
                }))}
                selected={form.capabilities.tools ?? []}
                onToggle={(name) =>
                  setCapability('tools', toggleList(form.capabilities.tools, name))
                }
                loading={false}
                empty={t('editor.capabilities.tools.empty')}
              />

              <CapabilityList
                title={t('editor.capabilities.skills.title')}
                description={t('editor.capabilities.skills.description')}
                inherit={form.capabilities.skills === null}
                onInherit={(inherit) =>
                  setCapability('skills', inherit ? null : skills.map((skill) => skill.name))
                }
                items={skills.map((skill) => ({
                  value: skill.name,
                  label: skill.name,
                  hint: `${skill.source}${skill.enabled === false ? t('editor.capabilities.skills.disabledGlobally') : ''}`,
                }))}
                selected={form.capabilities.skills ?? []}
                onToggle={(name) =>
                  setCapability('skills', toggleList(form.capabilities.skills, name))
                }
                loading={skillsLoading}
                empty={t('editor.capabilities.skills.empty')}
              />

              <CapabilityList
                title={t('editor.capabilities.mcp.title')}
                description={t('editor.capabilities.mcp.description')}
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
                  hint: server.enabled === false ? t('editor.capabilities.mcp.disabled') : 'MCP',
                }))}
                selected={form.capabilities.mcpServers ?? []}
                onToggle={(name) =>
                  setCapability('mcpServers', toggleList(form.capabilities.mcpServers, name))
                }
                loading={mcpLoading}
                empty={t('editor.capabilities.mcp.empty')}
              />
            </TabsContent>

            <TabsContent value="memory" className="space-y-4">
              <Switch
                checked={form.memoryEnabled}
                onCheckedChange={(checked) => set('memoryEnabled', checked)}
                label={t('editor.memory.label')}
                description={t('editor.memory.description')}
              />
              <AgentMemoryPanel
                agentId={editor?.mode === 'edit' ? editor.agentId : null}
                memoryEnabled={form.memoryEnabled}
              />
            </TabsContent>
          </div>
        </Tabs>

        {error ? (
          <div className="shrink-0 px-6 pb-3">
            <p
              role="alert"
              className="rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger"
            >
              {error}
            </p>
          </div>
        ) : null}

        {form.permissionMode === 'autonomous' ? (
          <div className="shrink-0 px-6 pb-3">
            <p
              role="status"
              className="rounded-lg bg-warning-soft px-3 py-2 text-[12px] leading-relaxed text-warning"
            >
              {tc(AUTONOMOUS_MODE_WARNING_KEY)}
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={saving || submitting}>
            {t('common:actions.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving || submitting}>
            {saving || submitting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            {t('editor.save')}
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
  const { t } = useTranslation('agents');
  return (
    <div className="space-y-3 rounded-xl bg-surface p-4">
      <Switch
        checked={inherit}
        onCheckedChange={onInherit}
        label={title}
        description={description}
      />
      {inherit ? (
        <p className="text-[11px] text-foreground-subtle">{t('editor.inheritAll')}</p>
      ) : loading ? (
        <p className="text-[11px] text-foreground-muted">{t('editor.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-foreground-subtle">{empty}</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {items.map((item) => (
            <label
              key={item.value}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px]',
                selected.includes(item.value) ? ' bg-accent-soft/50' : 'bg-surface-hover',
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
          {t('editor.noneSelected', { scope: title.toLowerCase() })}
        </p>
      ) : null}
    </div>
  );
}
