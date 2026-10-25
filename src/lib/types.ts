/**
 * IPC contract with the Rust backend.
 *
 * Every interface here mirrors a struct in `src-tauri/src/domain.rs` (and the
 * catalog in `data/catalog.json`). Keep both sides in sync.
 */

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

export type WireProtocol = 'openai-chat' | 'openai-responses' | 'anthropic' | 'google';
export type ModelStatus = 'stable' | 'beta' | 'free' | 'unavailable';

export interface ReasoningOptionToggle {
  type: 'toggle';
}
export interface ReasoningOptionEffort {
  type: 'effort';
  values: string[];
}
export interface ReasoningOptionBudget {
  type: 'budget_tokens';
  min?: number;
  max?: number;
}
export type ReasoningOption =
  | ReasoningOptionToggle
  | ReasoningOptionEffort
  | ReasoningOptionBudget;

export interface Modalities {
  input: string[];
  output: string[];
}

export interface CostInfo {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  tiers?: unknown[];
}

export interface ModelInfo {
  id: string;
  name: string;
  family: string;
  protocols: WireProtocol[];
  reasoning: boolean;
  reasoningOptions: ReasoningOption[];
  attachment: boolean;
  modalities: Modalities;
  contextWindow: number;
  maxOutput: number;
  cost?: CostInfo | null;
  releaseDate?: string | null;
  knowledge?: string | null;
  openWeights: boolean;
  description?: string | null;
  tags: string[];
  status: ModelStatus;
}

export interface ProviderInfo {
  id: string;
  name: string;
  shortName: string;
  description: string;
  baseUrl: string;
  consoleUrl: string;
  endpoints: Record<string, string>;
  authEnv: string;
  defaultModelId: string;
  models: ModelInfo[];
  notes: string[];
}

export interface CatalogFile {
  version: number;
  generatedAt: string;
  sources: Record<string, unknown>;
  providers: ProviderInfo[];
}

/* ------------------------------------------------------------------ */
/* Conversations & messages                                            */
/* ------------------------------------------------------------------ */

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'streaming' | 'complete' | 'error' | 'cancelled';
export type ToolCallStatus = 'running' | 'done' | 'error';

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: string;
  result?: string | null;
  status: ToolCallStatus;
  summary?: string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
}

export interface Citation {
  id: string;
  title: string;
  url: string;
  snippet?: string | null;
  siteName?: string | null;
}

export interface AttachmentInfo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'code' | 'csv' | 'json' | 'unknown';
  textPreview?: string | null;
  pageCount?: number | null;
  width?: number | null;
  height?: number | null;
}

/**
 * One step of the agent loop (ARCHITECTURE §8): the reasoning the model
 * produced before acting and how many tool calls that step requested. The
 * calls themselves stay in `ChatMessage.toolCalls`, in chronological order, so
 * the count is enough to slice them back into the step that produced them.
 *
 * Persisted with the message and replayed by the thinking timeline; messages
 * from before the trace existed have no entries and fall back to a heuristic.
 */
export interface TraceStep {
  /** Visible reasoning of this step (`null` when the model emitted none). */
  reasoning?: string | null;
  /** Number of tool calls produced by this step. */
  toolCalls: number;
}

export interface UsageInfo {
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cachedTokens?: number | null;
  totalTokens?: number | null;
  cost?: number | null;
  durationMs?: number | null;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  reasoning?: string | null;
  status: MessageStatus;
  toolCalls: ToolCallRecord[];
  citations: Citation[];
  attachments: AttachmentInfo[];
  /** Agent loop trace (thinking timeline). Absent on legacy/non-agent turns. */
  trace?: TraceStep[];
  modelId?: string | null;
  providerId?: string | null;
  usage?: UsageInfo | null;
  createdAt: number;
  /** Opaque replay payload captured from the provider (never rendered). */
  providerState?: unknown;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  providerId: string;
  modelId: string;
  messageCount: number;
  preview?: string | null;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: ChatMessage[];
}

/* ------------------------------------------------------------------ */
/* Turns                                                               */
/* ------------------------------------------------------------------ */

export type ReasoningMode = 'off' | 'effort' | 'budget';

export interface ReasoningSelection {
  mode: ReasoningMode;
  effort?: string | null;
  budget?: number | null;
}

export interface TurnOptions {
  webSearch: boolean;
  createFiles: boolean;
  /** Execução de código (`run_code`); o backend ainda aplica o gate global. */
  runCode: boolean;
  maxSteps: number;
  temperature?: number | null;
  systemPromptOverride?: string | null;
  regenerate?: boolean;
}

export interface TurnPayload {
  conversationId: string;
  content: string;
  attachmentIds: string[];
  providerId: string;
  modelId: string;
  reasoning?: ReasoningSelection | null;
  options: TurnOptions;
  turnId?: string | null;
}

export interface TurnResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  usage?: UsageInfo | null;
  error?: string | null;
  conversation?: Conversation | null;
}

export type TurnEvent =
  | { type: 'turn_started'; turnId: string; userMessageId: string; assistantMessageId: string }
  | { type: 'step_started'; step: number }
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'reasoning_done' }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call_started'; toolCall: ToolCallRecord }
  | { type: 'tool_call_args'; id: string; delta: string }
  | {
      type: 'tool_call_finished';
      id: string;
      status: 'done' | 'error';
      result: string;
      summary?: string;
      citations?: Citation[];
    }
  | { type: 'artifact_created'; artifact: Artifact }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'message_updated'; message: ChatMessage }
  | { type: 'title_updated'; conversationId: string; title: string }
  | { type: 'done'; result: TurnResult }
  | { type: 'cancelled' }
  | { type: 'error'; message: string; code?: string };

/* ------------------------------------------------------------------ */
/* Artifacts                                                           */
/* ------------------------------------------------------------------ */

export type ArtifactKind =
  | 'markdown'
  | 'code'
  | 'text'
  | 'html'
  | 'csv'
  | 'json'
  | 'svg'
  | 'image'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'audio'
  | 'video'
  | 'archive'
  | 'binary';

export interface Artifact {
  id: string;
  conversationId: string;
  messageId?: string | null;
  name: string;
  mimeType: string;
  kind: ArtifactKind;
  language?: string | null;
  size: number;
  createdAt: number;
}

export interface ArtifactContent {
  artifact: Artifact;
  content?: string | null;
  dataBase64?: string | null;
}

/* ------------------------------------------------------------------ */
/* Previews / code environment / skills                                */
/* ------------------------------------------------------------------ */

export interface SheetPreview {
  name: string;
  rows: string[][];
  truncated: boolean;
}

export interface SlidePreview {
  index: number;
  texts: string[];
  notes?: string | null;
}

/** Entrada de um arquivo compactado (prévia de ZIP). */
export interface ArchiveEntryPreview {
  name: string;
  size: number;
  compressedSize: number;
  isDir: boolean;
}

/**
 * Prévia estruturada de artefatos binários. PDF, áudio e vídeo usam o payload
 * base64 de `get_artifact_content` (pdf.js/player nativo); imagens ganham
 * metadados e payload convertido quando o formato não abre no WebView (TIFF);
 * ZIP vira listagem e binários sem prévia mostram os primeiros bytes (hexdump).
 */
export type ArtifactPreview =
  | { kind: 'docx'; html: string }
  | { kind: 'xlsx'; sheets: SheetPreview[] }
  | { kind: 'pptx'; slides: SlidePreview[] }
  | {
      kind: 'image';
      /** MIME do payload exibido (o original ou `image/png` após conversão). */
      mime: string;
      width?: number | null;
      height?: number | null;
      /** Presente apenas quando o formato original foi convertido para PNG. */
      dataBase64?: string | null;
    }
  | {
      kind: 'archive';
      format: string;
      entries: ArchiveEntryPreview[];
      totalEntries: number;
      truncated: boolean;
    }
  | { kind: 'binary'; format: string; previewBase64: string; previewBytes: number }
  | { kind: 'unsupported'; reason: string };

export interface InterpreterInfo {
  path: string;
  version: string;
  /** settings | path */
  source: string;
}

export interface CodePackageStatus {
  name: string;
  available: boolean;
}

export interface SkillSummary {
  name: string;
  description: string;
  /** bundled | user | agents | codex | claude | opencode */
  source: string;
  /** `false` quando a skill está desativada nas configurações. */
  enabled: boolean;
  /** Só skills do Lumina (`user`) podem ser excluídas; externas são somente leitura. */
  deletable: boolean;
}

export interface CodeEnvironmentStatus {
  enabled: boolean;
  python?: InterpreterInfo | null;
  node?: InterpreterInfo | null;
  packages: CodePackageStatus[];
  installHint: string;
  skills: SkillSummary[];
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export type ThemeMode = 'light' | 'dark' | 'system';

export interface Settings {
  theme: ThemeMode;
  locale: 'pt-BR' | 'en';
  defaultProvider: string;
  defaultModel: string;
  reasoningDefault: 'auto' | 'off' | 'low' | 'medium' | 'high' | 'max';
  systemPrompt: string;
  webSearchEnabled: boolean;
  fileCreationEnabled: boolean;
  maxSteps: number;
  sendKey: 'enter' | 'ctrl+enter';
  showTokenUsage: boolean;
  reduceMotion: boolean;
  fontScale: number;
  temperature?: number | null;
  includeAttachments: boolean;
  autoTitle: boolean;
  /** Opt-in: permite ao agente executar código (`run_code`). */
  codeExecutionEnabled: boolean;
  /** Tempo máximo de uma execução de código (segundos). */
  codeTimeoutSecs: number;
  /** Interpretador Python explícito; vazio = auto-detecção. */
  codePythonPath: string;
  /** Interpretador Node explícito; vazio = auto-detecção. */
  codeNodePath: string;
  /** Mostra o item "Skills" na barra lateral. */
  skillsPanelEnabled: boolean;
  /** Nomes de skills desativadas; o agente as ignora. */
  disabledSkills: string[];
}

export interface ProviderKeyStatus {
  providerId: string;
  hasKey: boolean;
  masked?: string | null;
  source: 'settings' | 'env' | 'opencode-cli' | 'none';
}

export interface SettingsView {
  settings: Settings;
  keys: ProviderKeyStatus[];
}

export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  platform: string;
  startedAt: number;
  dataDir: string;
}

export interface ProviderValidation {
  providerId: string;
  ok: boolean;
  message?: string | null;
  latencyMs?: number | null;
  models: number;
}

export interface CatalogView {
  catalog: CatalogFile;
  keys: ProviderKeyStatus[];
  remoteRefreshedAt?: number | null;
}

/* ------------------------------------------------------------------ */
/* UI-only helpers                                                     */
/* ------------------------------------------------------------------ */

export interface ModelSelection {
  providerId: string;
  modelId: string;
  reasoning: ReasoningSelection | null;
}

export interface ConversationGroup {
  label: string;
  conversations: Conversation[];
}
