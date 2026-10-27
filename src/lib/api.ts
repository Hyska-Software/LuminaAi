/**
 * Typed wrappers around the Tauri command surface (`src-tauri/src/commands/`).
 */
import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  AppInfo,
  Artifact,
  ArtifactContent,
  ArtifactPreview,
  AttachmentInfo,
  CatalogView,
  CodeEnvironmentStatus,
  Conversation,
  ConversationDetail,
  LoginChallenge,
  ProviderAuthStatus,
  ProviderValidation,
  Settings,
  SettingsView,
  SkillContent,
  SkillSummary,
  TurnEvent,
  TurnPayload,
  TurnResult,
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
  createConversation: (title?: string, providerId?: string, modelId?: string) =>
    invoke<Conversation>('create_conversation', {
      title: title ?? null,
      providerId: providerId ?? null,
      modelId: modelId ?? null,
    }),
  getConversation: (id: string) =>
    invoke<ConversationDetail | null>('get_conversation', { id }),
  renameConversation: (id: string, title: string) =>
    invoke<void>('rename_conversation', { id, title }),
  deleteConversation: (id: string) => invoke<void>('delete_conversation', { id }),
  setConversationPinned: (id: string, pinned: boolean) =>
    invoke<void>('set_conversation_pinned', { id, pinned }),
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
