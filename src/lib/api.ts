/**
 * Typed wrappers around the Tauri command surface (`src-tauri/src/commands/`).
 */
import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  AppInfo,
  ApprovalDecision,
  ApprovalRule,
  ApprovalRuleInput,
  ApprovalScope,
  Artifact,
  ArtifactContent,
  ArtifactPreview,
  ArtifactThumbnail,
  AskUserAnswer,
  AttachmentInfo,
  CatalogView,
  CodeEnvironmentStatus,
  CodeSessionState,
  Conversation,
  ConversationDetail,
  ConversationMode,
  FileChange,
  JobView,
  LibraryArtifact,
  LoginChallenge,
  PermissionMode,
  ProviderAuthStatus,
  ProviderValidation,
  Settings,
  SettingsView,
  SkillContent,
  SkillSummary,
  TerminalEvent,
  TerminalInfo,
  TurnEvent,
  TurnPayload,
  TurnResult,
  Workspace,
  WorkspaceCommitDetail,
  WorkspaceContext,
  WorkspaceFileContent,
  WorkspaceFileEntry,
  WorkspaceGitCommit,
  WorkspaceGitStatus,
} from './types';

export const api = {
  /* -------- app / settings -------- */
  appInfo: () => invoke<AppInfo>('app_info'),
  getSettings: () => invoke<SettingsView>('get_settings'),
  saveSettings: (settings: Settings) => invoke<SettingsView>('save_settings', { settings }),
  setProviderKey: (providerId: string, key: string | null) =>
    invoke<SettingsView>('set_provider_key', { providerId, key }),
  validateProvider: (providerId: string) =>
    invoke<ProviderValidation>('validate_provider', { providerId }),
  openDataDir: () => invoke<void>('open_data_dir'),
  resetAppData: () => invoke<void>('reset_app_data'),
  getCodeEnvironment: () => invoke<CodeEnvironmentStatus>('get_code_environment'),
  openSkillsDir: () => invoke<void>('open_skills_dir'),

  /* -------- skills (gestão) -------- */
  getSkills: () => invoke<SkillSummary[]>('get_skills'),
  setSkillEnabled: (name: string, enabled: boolean) =>
    invoke<SkillSummary[]>('set_skill_enabled', { name, enabled }),
  deleteSkill: (name: string) => invoke<SkillSummary[]>('delete_skill', { name }),
  getSkillContent: (name: string) => invoke<SkillContent>('get_skill_content', { name }),

  /* -------- catalog -------- */
  getCatalog: () => invoke<CatalogView>('get_catalog'),
  refreshCatalog: () => invoke<CatalogView>('refresh_catalog'),
  listRemoteModels: (providerId: string) =>
    invoke<string[]>('list_remote_models', { providerId }),
  refreshProviderModels: (providerId: string) =>
    invoke<CatalogView>('refresh_provider_models', { providerId }),

  /* -------- OpenAI ChatGPT plan auth (two-phase login) -------- */
  openaiLoginStart: (providerId: string, forceConsent = false) =>
    invoke<LoginChallenge>('openai_login_start', { providerId, forceConsent }),
  openaiLoginWait: (attemptId: string) =>
    invoke<ProviderAuthStatus>('openai_login_wait', { attemptId }),
  openaiLoginCancel: (attemptId: string) =>
    invoke<void>('openai_login_cancel', { attemptId }),
  openaiSignOut: (providerId: string) =>
    invoke<ProviderAuthStatus>('openai_sign_out', { providerId }),
  openaiAuthStatus: () => invoke<ProviderAuthStatus[]>('openai_auth_status'),

  /* -------- conversations -------- */
  listConversations: () => invoke<Conversation[]>('list_conversations'),
  createConversation: (
    title?: string,
    providerId?: string,
    modelId?: string,
    mode?: ConversationMode,
  ) =>
    invoke<Conversation>('create_conversation', {
      title: title ?? null,
      providerId: providerId ?? null,
      modelId: modelId ?? null,
      mode: mode ?? null,
    }),
  getConversation: (id: string) =>
    invoke<ConversationDetail | null>('get_conversation', { id }),
  renameConversation: (id: string, title: string) =>
    invoke<void>('rename_conversation', { id, title }),
  deleteConversation: (id: string) => invoke<void>('delete_conversation', { id }),
  setConversationPinned: (id: string, pinned: boolean) =>
    invoke<void>('set_conversation_pinned', { id, pinned }),
  /** Compartilha uma sessão do Chat com o layout Code (ou remove o vínculo). */
  setConversationCodeLinked: (id: string, linked: boolean) =>
    invoke<Conversation>('set_conversation_code_linked', { id, linked }),
  searchConversations: (query: string) =>
    invoke<Conversation[]>('search_conversations', { query }),
  truncateConversation: (conversationId: string, fromMessageId: string) =>
    invoke<void>('truncate_conversation', { conversationId, fromMessageId }),
  exportConversation: (id: string, format: 'markdown' | 'json' = 'markdown') =>
    invoke<string | null>('export_conversation', { id, format }),

  /* -------- attachments -------- */
  importAttachments: (paths: string[]) =>
    invoke<AttachmentInfo[]>('import_attachments', { paths }),
  deleteAttachment: (id: string) => invoke<void>('delete_attachment', { id }),

  /* -------- artifacts -------- */
  listArtifacts: (conversationId: string) =>
    invoke<Artifact[]>('list_artifacts', { conversationId }),
  /** Biblioteca do usuário: todos os artefatos (todas as conversas + enviados). */
  listLibraryArtifacts: () => invoke<LibraryArtifact[]>('list_library_artifacts'),
  /** Importa arquivos do disco para a biblioteca (sem conversa associada). */
  importLibraryFiles: (paths: string[]) =>
    invoke<Artifact[]>('import_library_files', { paths }),
  /** Renomeia o arquivo no disco + metadados; devolve o artefato atualizado. */
  renameArtifact: (id: string, name: string) =>
    invoke<Artifact>('rename_artifact', { id, name }),
  setArtifactFavorite: (id: string, favorite: boolean) =>
    invoke<Artifact>('set_artifact_favorite', { id, favorite }),
  /** Miniatura PNG (≤512 px) para os cards de imagem; `null` se não houver. */
  getArtifactThumbnail: (id: string) =>
    invoke<ArtifactThumbnail | null>('get_artifact_thumbnail', { id }),
  getArtifactContent: (id: string) =>
    invoke<ArtifactContent | null>('get_artifact_content', { id }),
  getArtifactPreview: (id: string) =>
    invoke<ArtifactPreview | null>('get_artifact_preview', { id }),
  saveArtifact: (id: string, suggestedName?: string) =>
    invoke<string | null>('save_artifact', { id, suggestedName: suggestedName ?? null }),
  openArtifact: (id: string) => invoke<void>('open_artifact', { id }),
  deleteArtifact: (id: string) => invoke<void>('delete_artifact', { id }),

  /* -------- turn streaming -------- */
  cancelTurn: (turnId: string) => invoke<boolean>('cancel_turn', { turnId }),

  /* -------- workspace (harness de código) -------- */
  /** Abre o seletor nativo de pasta e devolve o caminho escolhido (null = cancelado). */
  pickWorkspaceFolder: () => invoke<string | null>('pick_workspace_folder'),
  /** Registra/abre uma pasta como workspace (cria a linha no DB). */
  addWorkspace: (path: string, trusted = false) =>
    invoke<Workspace>('add_workspace', { path, trusted }),
  listWorkspaces: () => invoke<Workspace[]>('list_workspaces'),
  getWorkspace: (id: string) => invoke<WorkspaceContext | null>('get_workspace_context', { id }),
  renameWorkspace: (id: string, name: string) =>
    invoke<Workspace>('rename_workspace', { id, name }),
  removeWorkspace: (id: string) => invoke<void>('remove_workspace', { id }),
  setWorkspaceTrusted: (id: string, trusted: boolean) =>
    invoke<Workspace>('set_workspace_trusted', { id, trusted }),
  setConversationWorkspace: (conversationId: string, workspaceId: string | null) =>
    invoke<Conversation>('set_conversation_workspace', { conversationId, workspaceId }),
  openWorkspaceInExplorer: (id: string) => invoke<void>('open_workspace_in_explorer', { id }),
  listWorkspaceFiles: (workspaceId: string, path = '.', depth = 2) =>
    invoke<WorkspaceFileEntry[]>('list_workspace_files', { workspaceId, path, depth }),
  searchWorkspaceFiles: (workspaceId: string, query: string, limit = 50) =>
    invoke<string[]>('search_workspace_files', { workspaceId, query, limit }),
  readWorkspaceFile: (workspaceId: string, path: string) =>
    invoke<WorkspaceFileContent>('read_workspace_file', { workspaceId, path }),

  /* -------- sessão de código -------- */
  getCodeSessionState: (conversationId: string) =>
    invoke<CodeSessionState>('get_code_session_state', { conversationId }),
  setPermissionMode: (conversationId: string, mode: PermissionMode) =>
    invoke<CodeSessionState>('set_permission_mode', { conversationId, mode }),
  setPlanMode: (conversationId: string, planMode: boolean) =>
    invoke<CodeSessionState>('set_plan_mode', { conversationId, planMode }),
  respondApproval: (
    approvalId: string,
    decision: ApprovalDecision,
    options?: { scope?: ApprovalScope | null; feedback?: string | null },
  ) =>
    invoke<boolean>('respond_approval', {
      approvalId,
      decision,
      scope: options?.scope ?? null,
      feedback: options?.feedback ?? null,
    }),
  listApprovalRules: (conversationId: string) =>
    invoke<ApprovalRule[]>('list_approval_rules', { conversationId }),
  saveApprovalRule: (input: ApprovalRuleInput) =>
    invoke<ApprovalRule>('save_approval_rule', { input }),
  deleteApprovalRule: (id: string) => invoke<void>('delete_approval_rule', { id }),
  getWorkspaceChanges: (conversationId: string) =>
    invoke<FileChange[]>('get_workspace_changes', { conversationId }),
  getFileDiff: (workspaceId: string, path: string, staged = false) =>
    invoke<string>('get_file_diff', { workspaceId, path, staged }),
  revertFile: (conversationId: string, path: string) =>
    invoke<boolean>('revert_file', { conversationId, path }),
  revertTurn: (conversationId: string, turnId: string) =>
    invoke<boolean>('revert_turn', { conversationId, turnId }),
  compactSession: (conversationId: string) => invoke<boolean>('compact_session', { conversationId }),

  respondQuestion: (requestId: string, answers: AskUserAnswer[], skipped = false) =>
    invoke<boolean>('respond_question', { requestId, answers, skipped }),

  /* -------- terminal PTY (layout Code) -------- */
  openTerminal: (
    conversationId: string,
    cols: number,
    rows: number,
    onEvent: (event: TerminalEvent) => void,
  ) => {
    const channel = new Channel<TerminalEvent>();
    channel.onmessage = onEvent;
    return invoke<TerminalInfo>('open_terminal', {
      conversationId,
      cols,
      rows,
      onEvent: channel,
    });
  },
  writeTerminal: (id: string, data: string) =>
    invoke<void>('write_terminal', { id, data }),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    invoke<void>('resize_terminal', { id, cols, rows }),
  closeTerminal: (id: string) => invoke<boolean>('close_terminal', { id }),
  listTerminals: (conversationId: string) =>
    invoke<TerminalInfo[]>('list_terminals', { conversationId }),

  /* -------- git (painel) -------- */
  gitStatus: (workspaceId: string) => invoke<WorkspaceGitStatus>('git_status', { workspaceId }),
  gitDiff: (workspaceId: string, paths: string[], staged = false) =>
    invoke<string>('git_diff', { workspaceId, paths, staged }),
  gitStage: (workspaceId: string, paths: string[]) =>
    invoke<WorkspaceGitStatus>('git_stage', { workspaceId, paths }),
  gitUnstage: (workspaceId: string, paths: string[]) =>
    invoke<WorkspaceGitStatus>('git_unstage', { workspaceId, paths }),
  gitDiscard: (workspaceId: string, paths: string[]) =>
    invoke<WorkspaceGitStatus>('git_discard', { workspaceId, paths }),
  gitCommit: (workspaceId: string, message: string, paths?: string[]) =>
    invoke<WorkspaceGitStatus>('git_commit', { workspaceId, message, paths: paths ?? null }),
  gitBranches: (workspaceId: string) =>
    invoke<{ current: string | null; branches: string[] }>('git_branches', { workspaceId }),
  gitSwitchBranch: (workspaceId: string, branch: string) =>
    invoke<WorkspaceGitStatus>('git_switch_branch', { workspaceId, branch }),
  gitLog: (workspaceId: string, limit = 20) =>
    invoke<WorkspaceGitCommit[]>('git_log', { workspaceId, limit }),
  gitCommitDetail: (workspaceId: string, revision: string) =>
    invoke<WorkspaceCommitDetail>('git_commit_detail', { workspaceId, revision }),
  suggestCommitMessage: (workspaceId: string) =>
    invoke<string>('suggest_commit_message', { workspaceId }),

  /* -------- jobs (processos em background) -------- */
  listJobs: (conversationId: string) => invoke<JobView[]>('list_jobs', { conversationId }),
  getJobOutput: (jobId: string, cursor = 0) =>
    invoke<{ output: string; nextCursor: number; job: JobView }>('get_job_output', {
      jobId,
      cursor,
    }),
  killJob: (jobId: string) => invoke<JobView>('kill_job', { jobId }),

  /**
   * Starts a turn. `onEvent` receives every streamed event; the promise
   * resolves with the persisted user/assistant messages when the turn ends.
   */
  runTurn: (payload: TurnPayload, onEvent: (event: TurnEvent) => void) => {
    const channel = new Channel<TurnEvent>();
    channel.onmessage = onEvent;
    return invoke<TurnResult>('run_turn', { payload, onEvent: channel });
  },
};

export type Api = typeof api;
