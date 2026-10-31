//! Serializable domain types shared by the Tauri commands, the SQLite layer and
//! the React renderer. Every struct here is part of the IPC contract: keep field
//! names in sync with `src/lib/types.ts`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/* ------------------------------------------------------------------ */
/* Conversations & messages                                            */
/* ------------------------------------------------------------------ */

/// Layout onde a sessão nasceu: o Chat ou o Code.
pub const CONVERSATION_MODE_CHAT: &str = "chat";
pub const CONVERSATION_MODE_CODE: &str = "code";

fn default_conversation_mode() -> String {
    CONVERSATION_MODE_CHAT.to_string()
}

/// Normaliza o `mode` recebido do renderer (IPC/SQLite): só `"code"` é aceito
/// como alternativa; ausente, vazio ou desconhecido cai em `"chat"` — o layout
/// padrão do app e o modo de todas as conversas dos bancos legados.
pub fn conversation_mode_or_default(mode: Option<&str>) -> String {
    match mode.map(str::trim) {
        Some(value) if value == CONVERSATION_MODE_CODE => CONVERSATION_MODE_CODE.to_string(),
        _ => CONVERSATION_MODE_CHAT.to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub pinned: bool,
    pub provider_id: String,
    pub model_id: String,
    #[serde(default)]
    pub message_count: i64,
    #[serde(default)]
    pub preview: Option<String>,
    /// Layout onde a sessão nasceu (`"chat"` | `"code"`): conversas do Chat só
    /// aparecem no Chat, conversas do Code só no Code.
    #[serde(default = "default_conversation_mode")]
    pub mode: String,
    /// Sessão do Chat explicitamente adicionada ao Code: passa a aparecer nos
    /// dois layouts. Só existe para `mode == "chat"`.
    #[serde(default)]
    pub code_linked: bool,
    /// Workspace de código ao qual a sessão pertence (NULL = sem workspace).
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// Motor do agente: `lumina` (nativo). Reservado para `acp:<agente>` no futuro.
    #[serde(default = "default_agent_kind")]
    pub agent_kind: String,
    /// Modo de permissão da sessão de código (Chat ignora).
    #[serde(default)]
    pub permission_mode: PermissionMode,
    /// Parent conversation when this row is a retained subagent transcript.
    #[serde(default)]
    pub parent_conversation_id: Option<String>,
    /// `task` tool call that spawned this subagent (audit/deep link).
    #[serde(default)]
    pub subagent_task_call_id: Option<String>,
    /// Subagent kind (`explore`, `review`, `general`).
    #[serde(default)]
    pub subagent_type: Option<String>,
}

fn default_agent_kind() -> String {
    "lumina".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDetail {
    pub conversation: Conversation,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageStatus {
    Streaming,
    Complete,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolCallStatus {
    Running,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub arguments: String,
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default = "default_tool_status")]
    pub status: ToolCallStatus,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub finished_at: Option<i64>,
    /// Apresentação estruturada do resultado (diff, lista de tarefas, plano,
    /// job, aprovação) usada pelos cards do renderer e persistida no DB.
    /// JSON opaco versionado por `kind` — ver `docs/goals/code-harness/TOOLS.md` §1.1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presentation: Option<Value>,
}

fn default_tool_status() -> ToolCallStatus {
    ToolCallStatus::Running
}

impl ToolCallRecord {
    pub fn running(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            arguments: String::new(),
            result: None,
            status: ToolCallStatus::Running,
            summary: None,
            started_at: Some(now_ms()),
            finished_at: None,
            presentation: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    pub id: String,
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub snippet: Option<String>,
    #[serde(default)]
    pub site_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: i64,
    /// image | pdf | docx | xlsx | pptx | text | code | csv | json | unknown
    pub kind: String,
    #[serde(default)]
    pub text_preview: Option<String>,
    #[serde(default)]
    pub page_count: Option<u32>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageInfo {
    #[serde(default)]
    pub input_tokens: Option<u32>,
    #[serde(default)]
    pub output_tokens: Option<u32>,
    #[serde(default)]
    pub reasoning_tokens: Option<u32>,
    /// Legacy aggregate: tokens read from the provider cache (subset of input).
    #[serde(default)]
    pub cached_tokens: Option<u32>,
    /// Tokens read from the prompt cache (normalized across protocols).
    #[serde(default)]
    pub cache_read_tokens: Option<u32>,
    /// Tokens written to the prompt cache this request (Anthropic cache_creation,
    /// OpenAI cache_write_tokens, ...).
    #[serde(default)]
    pub cache_write_tokens: Option<u32>,
    /// Input tokens that were neither read from nor written to the cache.
    #[serde(default)]
    pub uncached_input_tokens: Option<u32>,
    /// True when the provider reported cache counters for this request.
    #[serde(default)]
    pub cache_reported: bool,
    #[serde(default)]
    pub total_tokens: Option<u32>,
    #[serde(default)]
    pub cost: Option<f64>,
    /// Wall-clock duration of the turn in milliseconds.
    #[serde(default)]
    pub duration_ms: Option<u64>,
}

/// Normalized cache usage for one provider request.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsage {
    #[serde(default)]
    pub cache_read_tokens: Option<u32>,
    #[serde(default)]
    pub cache_write_tokens: Option<u32>,
    #[serde(default)]
    pub uncached_input_tokens: Option<u32>,
    #[serde(default)]
    pub input_total_tokens: Option<u32>,
    #[serde(default)]
    pub reported: bool,
}

impl UsageInfo {
    /// Cache view normalized from the flat usage fields.
    pub fn cache_usage(&self) -> CacheUsage {
        let read = self.cache_read_tokens.or(self.cached_tokens);
        let write = self.cache_write_tokens;
        let uncached = self.uncached_input_tokens;
        let total = match (read, write, uncached) {
            (Some(read), Some(write), Some(uncached)) => {
                Some(read.saturating_add(write).saturating_add(uncached))
            }
            _ => self.input_tokens,
        };
        CacheUsage {
            cache_read_tokens: read,
            cache_write_tokens: write,
            uncached_input_tokens: uncached,
            input_total_tokens: total,
            reported: self.cache_reported,
        }
    }

    /// Fold cache counters from another usage sample (turn aggregation).
    pub fn merge_cache(&mut self, other: &UsageInfo) {
        if other.cache_reported || other.cache_read_tokens.is_some() {
            self.cache_reported = true;
        }
        self.cache_read_tokens = add_optional(self.cache_read_tokens, other.cache_read_tokens);
        self.cache_write_tokens = add_optional(self.cache_write_tokens, other.cache_write_tokens);
        self.uncached_input_tokens =
            add_optional(self.uncached_input_tokens, other.uncached_input_tokens);
    }
}

fn add_optional(left: Option<u32>, right: Option<u32>) -> Option<u32> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.saturating_add(right)),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

/// Cache state shown by the context meter (dashboard/monitor).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CacheState {
    /// First request of an epoch: nothing to reuse yet.
    #[default]
    Cold,
    /// Requests are still populating the cache.
    Warming,
    /// Steady-state requests are being served from the cache.
    Stable,
    /// A persistent-prefix break happened (or the hit% dropped for a known cause).
    Degraded,
    /// Provider/gateway does not report or support prompt caching.
    Unsupported,
    /// Provider policy prevents reuse for this request (e.g. Gemini 4 <2.050 new tokens).
    ProviderPolicy,
}

/// Why a persistent prefix was broken (or a request could not reuse it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CacheBreakReason {
    FirstRequest,
    SystemPrompt,
    ToolDefinitions,
    HistoryRewrite,
    HeadTrim,
    Compaction,
    ModelSwitch,
    ProtocolFallback,
    Attachments,
    ConfigChange,
    TtlExpired,
    ProviderPolicy,
}

/// One wire segment covered by the prompt-cache digest, in request order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SegmentKind {
    System,
    Tools,
    Message,
    /// Request-only tail (e.g. forced wrap-up) that is not part of the surface.
    TransientTail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentDigest {
    pub kind: SegmentKind,
    pub index: u32,
    /// SHA-256 of the canonical wire bytes of this segment.
    pub sha256: [u8; 32],
    /// Characters covered by the segment (used for the P/Δ estimate).
    pub chars: u32,
}

/// Canonical digest of a provider request body, used to detect prefix reuse and
/// attribute breaks. Cache metadata (`cache_control`, `prompt_cache_key`, TTL) is
/// intentionally excluded so enabling caching never looks like a break.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefixDigest {
    pub protocol: String,
    #[serde(default)]
    pub segments: Vec<SegmentDigest>,
    #[serde(default)]
    pub total_chars: u32,
    #[serde(default)]
    pub estimated_tokens: u32,
}

impl PrefixDigest {
    /// First index where `self` and `previous` diverge (`== len` when one is a
    /// prefix of the other).
    pub fn common_prefix_segments(&self, previous: &PrefixDigest) -> usize {
        let mut index = 0;
        while index < self.segments.len()
            && index < previous.segments.len()
            && self.segments[index].sha256 == previous.segments[index].sha256
        {
            index += 1;
        }
        index
    }

    /// Characters covered by the first `segments` segments.
    pub fn chars_up_to(&self, segments: usize) -> u32 {
        self.segments
            .iter()
            .take(segments)
            .map(|segment| segment.chars)
            .fold(0u32, u32::saturating_add)
    }
}

/// One cache sample per provider request (wire request), emitted in real time.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheSample {
    pub turn_id: String,
    pub step: u32,
    pub provider_id: String,
    pub model_id: String,
    pub protocol: String,
    pub epoch: u32,
    pub input_total: u32,
    pub cache_read: u32,
    pub cache_write: u32,
    pub uncached: u32,
    /// Provider-reported hit percent; `None` when the provider did not report cache.
    #[serde(default)]
    pub hit_percent: Option<f32>,
    /// Theoretical ceiling `P/(P+Δ)` for this request.
    #[serde(default)]
    pub ceiling_percent: Option<f32>,
    #[serde(default)]
    pub prefix_tokens_est: u32,
    #[serde(default)]
    pub delta_tokens_est: u32,
    pub eligible: bool,
    #[serde(default)]
    pub excluded_reason: Option<String>,
    pub state: CacheState,
    #[serde(default)]
    pub break_reason: Option<CacheBreakReason>,
    #[serde(default)]
    pub break_detail: Option<String>,
    /// Raw provider usage block (trimmed) for the diagnostics panel.
    #[serde(default)]
    pub raw_usage: Option<serde_json::Value>,
    pub at: i64,
}

/// Aggregated cache view for a conversation (restored by `get_cache_stats`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    #[serde(default)]
    pub hit_percent: Option<f32>,
    #[serde(default)]
    pub session_hit_percent: Option<f32>,
    #[serde(default)]
    pub steady_hit_percent: Option<f32>,
    #[serde(default)]
    pub ceiling_percent: Option<f32>,
    #[serde(default)]
    pub input_total: u32,
    #[serde(default)]
    pub cache_read: u32,
    #[serde(default)]
    pub cache_write: u32,
    #[serde(default)]
    pub uncached: u32,
    pub eligible: bool,
    #[serde(default)]
    pub excluded_reason: Option<String>,
    pub state: CacheState,
    #[serde(default)]
    pub epoch: u32,
    #[serde(default)]
    pub samples: u32,
    #[serde(default)]
    pub min_cacheable_tokens: Option<u32>,
    #[serde(default)]
    pub ttl_seconds: Option<u32>,
    #[serde(default)]
    pub break_reason: Option<CacheBreakReason>,
    #[serde(default)]
    pub break_detail: Option<String>,
    #[serde(default)]
    pub provider_policy: Option<String>,
    pub at: i64,
    #[serde(default)]
    pub savings_usd: Option<f64>,
}

/// Snapshot returned by `get_cache_stats`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatsView {
    pub conversation_id: String,
    #[serde(default)]
    pub current: Option<CacheStats>,
    #[serde(default)]
    pub session: Option<CacheStats>,
    #[serde(default)]
    pub epoch: u32,
    #[serde(default)]
    pub recent: Vec<CacheSample>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceStep {
    /// Visible reasoning emitted by the model in this step.
    #[serde(default)]
    pub reasoning: Option<String>,
    /// Tool calls requested by this step; they are stored in `ChatMessage.tool_calls`
    /// in chronological order, so the count is enough to slice them back.
    #[serde(default)]
    pub tool_calls: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: MessageRole,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub reasoning: Option<String>,
    pub status: MessageStatus,
    #[serde(default)]
    pub tool_calls: Vec<ToolCallRecord>,
    #[serde(default)]
    pub citations: Vec<Citation>,
    #[serde(default)]
    pub attachments: Vec<AttachmentInfo>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub usage: Option<UsageInfo>,
    pub created_at: i64,
    /// Opaque, backend-only protocol payload (Anthropic thinking blocks,
    /// Responses items, Google parts) replayed verbatim on the next turn of the
    /// same conversation. It is persisted in SQLite but never serialized to the
    /// renderer: the UI does not use it and, from v2 on, it stores one replay
    /// block per agent-loop step (see harness::build_history), which would only
    /// inflate the IPC payload.
    #[serde(default, skip_serializing)]
    pub provider_state: Option<Value>,
    /// Agent loop trace for the thinking timeline (reasoning + tool counts per step).
    #[serde(default)]
    pub trace: Vec<TraceStep>,
    /// Origem da mensagem: `user` (default) ou `goal_round` (rodada automática
    /// do objetivo). Só tem significado em mensagens de usuário.
    #[serde(default)]
    pub origin: TurnKind,
}

impl ChatMessage {
    pub fn user(conversation_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conversation_id.into(),
            role: MessageRole::User,
            content: content.into(),
            reasoning: None,
            status: MessageStatus::Complete,
            tool_calls: Vec::new(),
            citations: Vec::new(),
            attachments: Vec::new(),
            model_id: None,
            provider_id: None,
            usage: None,
            created_at: now_ms(),
            provider_state: None,
            trace: Vec::new(),
            origin: TurnKind::User,
        }
    }

    pub fn assistant(conversation_id: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conversation_id.into(),
            role: MessageRole::Assistant,
            content: String::new(),
            reasoning: None,
            status: MessageStatus::Streaming,
            tool_calls: Vec::new(),
            citations: Vec::new(),
            attachments: Vec::new(),
            model_id: None,
            provider_id: None,
            usage: None,
            created_at: now_ms(),
            provider_state: None,
            trace: Vec::new(),
            origin: TurnKind::User,
        }
    }
}

/* ------------------------------------------------------------------ */
/* Turn input / output                                                 */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningMode {
    Off,
    Effort,
    Budget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningSelection {
    pub mode: ReasoningMode,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub budget: Option<u32>,
}

/// Upper bound accepted for the agent loop steps per turn. The renderer,
/// the settings file and the harness all clamp to this value.
pub const MAX_STEPS_LIMIT: u32 = 1_000;

/// Default number of agent loop steps per turn (fresh installs).
pub const MAX_STEPS_DEFAULT: u32 = 64;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TurnOptions {
    pub web_search: bool,
    pub create_files: bool,
    /// Execução de código (`run_code`); o harness ainda aplica o gate global
    /// `Settings::code_execution_enabled`.
    pub run_code: bool,
    pub max_steps: u32,
    pub temperature: Option<f32>,
    pub system_prompt_override: Option<String>,
    /// Regenerate the last assistant answer (drops it before running).
    pub regenerate: bool,
    /// Profundidade de delegação (0 = sessão do usuário; 1 = subagente).
    /// Subagentes nao recebem a tool `task` (max. 1 nivel).
    #[serde(default)]
    pub delegation_depth: u32,
    /// Stable id sent as `x-opencode-session` for gateway affinity/cache.
    /// Internal field: never accepted from the renderer; the subagent runner
    /// fills it with the parent conversation id. `None` uses the turn's
    /// `conversation_id`.
    #[serde(skip)]
    pub wire_session_id: Option<String>,
}

impl Default for TurnOptions {
    fn default() -> Self {
        Self {
            web_search: true,
            create_files: true,
            run_code: true,
            max_steps: MAX_STEPS_DEFAULT,
            temperature: None,
            system_prompt_override: None,
            regenerate: false,
            delegation_depth: 0,
            wire_session_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnPayload {
    pub conversation_id: String,
    pub content: String,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
    pub provider_id: String,
    pub model_id: String,
    #[serde(default)]
    pub reasoning: Option<ReasoningSelection>,
    #[serde(default)]
    pub options: TurnOptions,
    /// Perfil do turno: `chat` (default, retrocompatível) ou `code`.
    #[serde(default)]
    pub profile: TurnProfile,
    /// Tipo do turno: `user` (default) ou `goal_round` (rodada automática de um
    /// objetivo; exige perfil `code` e sessão do layout Code).
    #[serde(default)]
    pub turn_kind: TurnKind,
    /// O usuário pediu um objetivo pelo fluxo `/goal` (chip no composer). O
    /// turno continua humano; o runtime context instrui o agente a chamar a
    /// tool `goal` (action `create`) com os parâmetros do pedido. Não persiste
    /// em `messages` — é intenção do turno, não conteúdo da mensagem.
    #[serde(default)]
    pub goal_request: bool,
    /// Client generated id used to cancel the stream.
    #[serde(default)]
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnResult {
    pub user_message: ChatMessage,
    pub assistant_message: ChatMessage,
    #[serde(default)]
    pub usage: Option<UsageInfo>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub conversation: Option<Conversation>,
}

/* ------------------------------------------------------------------ */
/* Artifacts                                                           */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactKind {
    Markdown,
    Code,
    Text,
    Html,
    Csv,
    Json,
    Svg,
    Image,
    Pdf,
    Docx,
    Xlsx,
    Pptx,
    /// Áudio (mp3, wav, ogg, m4a, flac, …): player nativo no renderer.
    Audio,
    /// Vídeo (mp4, webm, ogv, mov, …): player nativo no renderer.
    Video,
    /// Arquivo compactado (zip; outros contêineres caem no cartão binário).
    Archive,
    Binary,
}

impl ArtifactKind {
    pub fn from_mime_and_name(mime: &str, name: &str) -> Self {
        let lower = name.to_lowercase();
        let ext = lower.rsplit('.').next().unwrap_or("");
        match ext {
            "md" | "markdown" | "mdx" => return Self::Markdown,
            "html" | "htm" => return Self::Html,
            "csv" | "tsv" => return Self::Csv,
            "json" | "jsonl" => return Self::Json,
            "svg" => return Self::Svg,
            "pdf" => return Self::Pdf,
            "docx" => return Self::Docx,
            "xlsx" | "xls" | "ods" => return Self::Xlsx,
            "pptx" | "ppt" | "odp" => return Self::Pptx,
            "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "avif" | "tif" | "tiff" | "ico"
            | "jfif" | "apng" => return Self::Image,
            "mp3" | "wav" | "ogg" | "oga" | "opus" | "m4a" | "aac" | "flac" | "weba" | "mid"
            | "midi" | "amr" => return Self::Audio,
            "mp4" | "m4v" | "webm" | "ogv" | "mov" | "mkv" | "avi" | "wmv" | "flv" => {
                return Self::Video
            }
            "zip" | "zipx" | "tar" | "gz" | "tgz" | "bz2" | "xz" | "7z" | "rar" | "jar"
            | "epub" | "cbz" => return Self::Archive,
            _ => {}
        }
        if mime.starts_with("image/") {
            return Self::Image;
        }
        if mime.starts_with("audio/") {
            return Self::Audio;
        }
        if mime.starts_with("video/") {
            return Self::Video;
        }
        if mime.contains("zip")
            || mime.contains("tar")
            || mime.contains("gzip")
            || mime.contains("compress")
        {
            return Self::Archive;
        }
        if mime.starts_with("text/") {
            if mime.contains("html") {
                return Self::Html;
            }
            if mime.contains("csv") {
                return Self::Csv;
            }
            if mime.contains("json") {
                return Self::Json;
            }
            return Self::Text;
        }
        if mime.contains("json") {
            return Self::Json;
        }
        Self::Binary
    }

    pub fn is_textual(&self) -> bool {
        matches!(
            self,
            Self::Markdown | Self::Code | Self::Text | Self::Html | Self::Csv | Self::Json | Self::Svg
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    /// `None` = arquivo enviado pelo usuário direto à Biblioteca (sem conversa).
    /// Os artefatos criados pelo agente continuam sempre associados a uma
    /// conversa.
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub message_id: Option<String>,
    pub name: String,
    pub mime_type: String,
    pub kind: ArtifactKind,
    #[serde(default)]
    pub language: Option<String>,
    pub size: i64,
    pub created_at: i64,
    /// Marcado pelo usuário na Biblioteca; não influencia o agente.
    #[serde(default)]
    pub favorite: bool,
}

/// Artefato + título da conversa de origem, usado pela página Biblioteca.
///
/// `conversation_title == None` identifica os arquivos enviados direto à
/// biblioteca (sem conversa). `#[serde(flatten)]` mantém o JSON achatado: os
/// campos de [`Artifact`] aparecem no topo, seguidos de `conversationTitle`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryArtifact {
    #[serde(flatten)]
    pub artifact: Artifact,
    #[serde(default)]
    pub conversation_title: Option<String>,
}

/// Miniatura PNG gerada no backend para os cards de imagem da Biblioteca.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactThumbnail {
    /// Sempre `image/png` (a miniatura é reencodada).
    pub mime: String,
    pub data_base64: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactContent {
    pub artifact: Artifact,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub data_base64: Option<String>,
}

/* ------------------------------------------------------------------ */
/* Code execution / skills / previews                                  */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InterpreterInfo {
    pub path: String,
    pub version: String,
    /// settings | path
    pub source: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CodePackageStatus {
    pub name: String,
    pub available: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SkillSummary {
    pub name: String,
    pub description: String,
    /// bundled | user | agents | codex | claude | opencode
    pub source: String,
    /// Desativada em Configurações → Skills; o agente não a vê no prompt nem
    /// nas ferramentas `list_skills`/`read_skill`.
    pub enabled: bool,
    /// Apenas skills do Lumina (`source == user`) podem ser excluídas pela
    /// interface; skills de repositórios externos são somente leitura.
    pub deletable: bool,
}

/// Conteúdo de uma skill para a pré-visualização em Markdown na interface de
/// gestão: o corpo do `SKILL.md` (Markdown após o frontmatter) e os metadados do
/// cabeçalho. `dir` é o diretório absoluto da skill, só para exibição.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SkillContent {
    pub name: String,
    pub description: String,
    /// bundled | user | agents | codex | claude | opencode
    pub source: String,
    /// Diretório absoluto da skill (contém o `SKILL.md`).
    pub dir: String,
    /// Corpo do `SKILL.md` (Markdown sem o frontmatter).
    pub content: String,
}

/// Status do ambiente de código exibido em Configurações → Ferramentas.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CodeEnvironmentStatus {
    pub enabled: bool,
    pub python: Option<InterpreterInfo>,
    pub node: Option<InterpreterInfo>,
    pub packages: Vec<CodePackageStatus>,
    /// Comando sugerido para instalar os pacotes opcionais.
    pub install_hint: String,
    pub skills: Vec<SkillSummary>,
}

/// Prévia estruturada de um artefato binário (docx/xlsx/pptx/imagem/zip/binário).
///
/// O PDF não aparece aqui: o renderer o desenha com pdf.js a partir do
/// conteúdo base64 (`get_artifact_content`). Áudio e vídeo também usam o
/// payload base64 direto no player nativo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ArtifactPreview {
    Docx {
        html: String,
    },
    Xlsx {
        sheets: Vec<SheetPreview>,
    },
    Pptx {
        slides: Vec<SlidePreview>,
    },
    /// Imagem com metadados; `data_base64` só vem preenchido quando o formato
    /// original não abre no WebView e foi convertido para PNG (ex.: TIFF).
    Image {
        /// MIME do payload exibido (o original ou `image/png` após conversão).
        mime: String,
        #[serde(default)]
        width: Option<u32>,
        #[serde(default)]
        height: Option<u32>,
        #[serde(default)]
        data_base64: Option<String>,
    },
    /// Listagem de arquivo compactado (ZIP). Outros contêineres → Unsupported.
    Archive {
        format: String,
        entries: Vec<ArchiveEntryPreview>,
        total_entries: u32,
        truncated: bool,
    },
    /// Binário sem prévia: mime detectado + primeiros bytes em base64 (hexdump).
    Binary {
        format: String,
        preview_base64: String,
        preview_bytes: u32,
    },
    Unsupported {
        reason: String,
    },
}

/// Entrada de um arquivo compactado exibida na prévia de ZIP.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ArchiveEntryPreview {
    pub name: String,
    pub size: u64,
    pub compressed_size: u64,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SheetPreview {
    pub name: String,
    pub rows: Vec<Vec<String>>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SlidePreview {
    pub index: u32,
    pub texts: Vec<String>,
    #[serde(default)]
    pub notes: Option<String>,
}


/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/// TTL accepted by the Anthropic prompt cache strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum CacheTtl {
    #[serde(rename = "5m")]
    FiveMinutes,
    #[default]
    #[serde(rename = "1h")]
    OneHour,
}

impl CacheTtl {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FiveMinutes => "5m",
            Self::OneHour => "1h",
        }
    }

    pub fn seconds(self) -> u32 {
        match self {
            Self::FiveMinutes => 300,
            Self::OneHour => 3_600,
        }
    }
}

/// Prompt-cache preferences (docs/goals/prompt-cache/PLAN.md §5.4). There is no
/// product "enabled" flag: rollback is a release rollback; `show_indicator` only
/// hides the UI chip and never disables measurement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CacheSettings {
    pub show_indicator: bool,
    pub anthropic_ttl: CacheTtl,
    /// `None` = adapter decides (probe-driven); e.g. `in_memory`/`24h`.
    pub openai_retention: Option<String>,
}

impl Default for CacheSettings {
    fn default() -> Self {
        Self {
            show_indicator: true,
            anthropic_ttl: CacheTtl::OneHour,
            openai_retention: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: String,
    pub locale: String,
    pub default_provider: String,
    pub default_model: String,
    pub reasoning_default: String,
    pub system_prompt: String,
    pub web_search_enabled: bool,
    pub file_creation_enabled: bool,
    pub max_steps: u32,
    pub send_key: String,
    pub show_token_usage: bool,
    pub reduce_motion: bool,
    /// Mantém o bloco de raciocínio/passos do assistente recolhido por padrão
    /// (não abre sozinho durante o streaming; o usuário pode expandir).
    pub thinking_collapsed_by_default: bool,
    pub font_scale: f32,
    pub temperature: Option<f32>,
    pub include_attachments: bool,
    pub auto_title: bool,
    /// Opt-in: permite ao agente executar código (`run_code`) no computador.
    pub code_execution_enabled: bool,
    /// Tempo máximo de uma execução de código (segundos).
    pub code_timeout_secs: u32,
    /// Interpretador Python explícito; vazio = auto-detecção no PATH.
    pub code_python_path: String,
    /// Interpretador Node explícito; vazio = auto-detecção no PATH.
    pub code_node_path: String,
    /// Mostra o item "Skills" na barra lateral (o diálogo continua acessível
    /// por Configurações → Ferramentas).
    pub skills_panel_enabled: bool,
    /// Nomes de skills desativadas; o agente as ignora no prompt e nas tools.
    pub disabled_skills: Vec<String>,
    /* ---- harness de código (docs/goals/code-harness/PLAN.md §7) ---- */
    /// Máximo de passos por turno no perfil Code (1..=MAX_STEPS_LIMIT).
    pub code_max_steps: u32,
    /// Permite ao agente executar comandos de shell (`run_command`).
    pub shell_enabled: bool,
    /// Compacta o contexto automaticamente quando a janela aperta.
    pub auto_compact: bool,
    /// Retenção dos arquivos de spill (saída completa de tools), em dias.
    pub spill_retention_days: u32,
    /// Tempo máximo para o usuário responder uma aprovação (segundos).
    pub approval_timeout_secs: u32,
    /// Notificações do sistema no fim de turnos em segundo plano.
    pub notifications_enabled: bool,
    /// Modo de permissão inicial de novas sessões do Code (padrão: Autônomo),
    /// configurável em Configurações → Ferramentas. O Chat ignora os modos.
    pub code_default_permission_mode: PermissionMode,
    /// Confia automaticamente em workspaces já abertos antes (o usuário pode
    /// revogar por workspace); quando falso, cada pasta nova pede confirmação.
    pub trust_workspaces_by_default: bool,
    /// Onde o diff de um arquivo abre ao clicar em Alterações: `tab` (aba do
    /// chat, padrão) ou `panel` (inline no painel direito). Ver WORKBENCH §7.2.
    pub diff_open_mode: String,
    /// Preferências de cache de prompt (medidor/indicador e parâmetros por provedor).
    pub cache: CacheSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            locale: "pt-BR".into(),
            default_provider: "opencode-go".into(),
            default_model: "deepseek-v4.1-flash".into(),
            reasoning_default: "max".into(),
            system_prompt: String::new(),
            web_search_enabled: true,
            file_creation_enabled: true,
            max_steps: MAX_STEPS_DEFAULT,
            send_key: "enter".into(),
            show_token_usage: true,
            reduce_motion: false,
            thinking_collapsed_by_default: false,
            font_scale: 1.0,
            temperature: None,
            include_attachments: true,
            auto_title: true,
            code_execution_enabled: false,
            code_timeout_secs: 120,
            code_python_path: String::new(),
            code_node_path: String::new(),
            skills_panel_enabled: true,
            disabled_skills: Vec::new(),
            code_max_steps: 120,
            shell_enabled: true,
            auto_compact: true,
            spill_retention_days: 30,
            approval_timeout_secs: 600,
            notifications_enabled: true,
            // Padrão do produto: o Code nasce Autônomo (o usuário troca em
            // Configurações → Ferramentas e por sessão no chip do composer).
            code_default_permission_mode: PermissionMode::Autonomous,
            trust_workspaces_by_default: false,
            diff_open_mode: "tab".into(),
            cache: CacheSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyStatus {
    pub provider_id: String,
    pub has_key: bool,
    #[serde(default)]
    pub masked: Option<String>,
    /// settings | env | opencode-cli | chatgpt | none
    pub source: String,
    /// api-key | oauth
    #[serde(default)]
    pub mode: String,
}

/// Two-phase login attempt handle returned by `openai_login_start`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginChallenge {
    pub attempt_id: String,
    pub auth_url: String,
    pub expires_at: i64,
}

/// Auth state of one provider, derived from stored credentials (no network).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAuthStatus {
    pub provider_id: String,
    /// "oauth" | "api-key"
    pub mode: String,
    /// "signed-in" | "signed-out" | "reauth-required" | "plan-disabled"
    pub state: String,
    #[serde(default)]
    pub account_label: Option<String>,
    #[serde(default)]
    pub plan_usage: bool,
    #[serde(default)]
    pub expires_at: Option<i64>,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub client_id_masked: Option<String>,
    #[serde(default)]
    pub host_id_masked: Option<String>,
    #[serde(default)]
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub settings: Settings,
    pub keys: Vec<ProviderKeyStatus>,
    #[serde(default)]
    pub auth: Vec<ProviderAuthStatus>,
    /// Present when the app secrets file could not be parsed; the UI surfaces it
    /// and never overwrites the file automatically.
    #[serde(default)]
    pub secrets_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub platform: String,
    pub started_at: i64,
    pub data_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderValidation {
    pub provider_id: String,
    pub ok: bool,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub latency_ms: Option<u64>,
    #[serde(default)]
    pub models: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogView {
    pub catalog: crate::catalog::CatalogFile,
    pub keys: Vec<ProviderKeyStatus>,
    #[serde(default)]
    pub auth: Vec<ProviderAuthStatus>,
    #[serde(default)]
    pub remote_refreshed_at: Option<i64>,
}

/* ------------------------------------------------------------------ */
/* Harness de código — contratos de sessão, workspace e permissões      */
/* (docs/goals/code-harness/HARNESS.md §4–§12)                          */
/* ------------------------------------------------------------------ */

/// Perfil de um turno do agente: conversa (Chat) ou trabalho de código (Code).
///
/// O perfil muda prompt, catálogo de tools, política e orçamentos do mesmo
/// loop (`harness::run_turn`); nunca cria um segundo loop.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TurnProfile {
    #[default]
    Chat,
    Code,
}

impl TurnProfile {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Code => "code",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "code" => Self::Code,
            _ => Self::Chat,
        }
    }
}

/// Modo de permissão da sessão de código (chip no header; `HARNESS.md` §6).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    /// Só leitura: nenhuma mutação de arquivo, sem shell.
    ReadOnly,
    /// Padrão: edita dentro do workspace; shell pede aprovação.
    #[default]
    Edit,
    /// Escritas e comandos liberados, exceto comandos destrutivos.
    Autonomous,
    /// Saída do modo Plano: edita o workspace, mas **cada escrita pede
    /// aprovação** (`WORKBENCH.md` §5.4, "Aprovar e revisar cada edição").
    Review,
}

impl PermissionMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnly => "read_only",
            Self::Edit => "edit",
            Self::Autonomous => "autonomous",
            Self::Review => "review",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "read_only" | "readonly" | "leitura" => Self::ReadOnly,
            "autonomous" | "autonomo" | "autônomo" => Self::Autonomous,
            "review" | "revisar" | "revisão" => Self::Review,
            _ => Self::Edit,
        }
    }
}

/// Classe de risco de uma tool/chamada — insumo da política de permissões.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskClass {
    /// Leitura local (arquivos, busca, git read).
    Read,
    /// Escrita/edição dentro do workspace.
    Write,
    /// Execução de comando de shell.
    Shell,
    /// Alvo fora do workspace.
    Outside,
    /// Arquivo que casa com padrões de segredo (`.env`, `*.pem`, …).
    Secret,
    /// Operação destrutiva (rm -rf, git reset --hard, force-push, …).
    Destroy,
    /// Tráfego de rede (busca/fetch).
    Network,
    /// Pausa explícita para o usuário (plano/pergunta).
    Ask,
}

/// Escopo de uma regra "sempre permitir/negar".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalScope {
    Session,
    Workspace,
    Global,
}

impl ApprovalScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Session => "session",
            Self::Workspace => "workspace",
            Self::Global => "global",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "session" | "sessao" | "sessão" => Self::Session,
            "workspace" => Self::Workspace,
            _ => Self::Global,
        }
    }
}

/// Decisão de uma aprovação (ou de uma regra persistida).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalDecision {
    Approved,
    Denied,
    Cancelled,
    Expired,
}

impl ApprovalDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Approved => "approved",
            Self::Denied => "denied",
            Self::Cancelled => "cancelled",
            Self::Expired => "expired",
        }
    }
}

/// Rótulo de uma opção do card de aprovação.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalOption {
    /// `allow` | `deny` | `allow_session` | `allow_workspace` | `allow_global`
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub scope: Option<ApprovalScope>,
}

/// O que a aprovação está autorizando (mostrado no card).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ApprovalDetail {
    Command {
        command: String,
        workdir: String,
    },
    Paths {
        paths: Vec<String>,
        change: String,
    },
    Secret {
        path: String,
    },
    Outside {
        path: String,
    },
    Other {
        text: String,
    },
}

/// Pedido de aprovação enviado ao renderer (`TurnEvent::ApprovalRequested`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    /// Sessão que pediu a aprovação (o snapshot da sessão filtra por ela).
    #[serde(default)]
    pub conversation_id: String,
    pub tool_call_id: String,
    pub tool: String,
    pub title: String,
    pub detail: ApprovalDetail,
    pub risk: RiskClass,
    #[serde(default)]
    pub preview: Option<String>,
    #[serde(default)]
    pub options: Vec<ApprovalOption>,
    pub created_at: i64,
}

/// Regra persistida em `approval_rules` (`HARNESS.md` §6.2).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRule {
    pub id: String,
    pub scope: ApprovalScope,
    #[serde(default)]
    pub scope_id: Option<String>,
    pub tool: String,
    /// `exact` | `prefix` | `glob`
    pub matcher: String,
    pub pattern: String,
    pub decision: ApprovalDecision,
    pub created_at: i64,
}

/// Opção de uma pergunta ao usuário (`ask_user`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskOption {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Uma pergunta ao usuário (até 4 por chamada).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskQuestion {
    pub id: String,
    pub question: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    #[serde(default)]
    pub options: Vec<AskOption>,
    #[serde(default)]
    pub multi_select: bool,
}

/// Pedido de resposta ao usuário (evento `question_requested`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskUserRequest {
    pub id: String,
    pub conversation_id: String,
    pub tool_call_id: String,
    pub questions: Vec<AskQuestion>,
    pub created_at: i64,
}

/// Resposta a uma pergunta.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskUserAnswer {
    pub question_id: String,
    #[serde(default)]
    pub selected: Vec<String>,
    #[serde(default)]
    pub custom: Option<String>,
}

/// Resposta completa a um pedido (`respond_question`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskUserResponse {
    pub request_id: String,
    #[serde(default)]
    pub answers: Vec<AskUserAnswer>,
    #[serde(default)]
    pub skipped: bool,
}

/// Workspace = pasta do usuário (git opcional) que agrupa sessões de código.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    /// Caminho absoluto canonicalizado; o renderer só exibe.
    pub path: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub last_opened_at: Option<i64>,
    #[serde(default)]
    pub pinned: bool,
    /// Aprovado pelo usuário na primeira abertura ("Confiar nesta pasta").
    #[serde(default)]
    pub trusted: bool,
    #[serde(default)]
    pub git: Option<GitInfo>,
}

/// Resumo do estado git do workspace (branch/upstream/dirty).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub root: String,
    pub branch: String,
    #[serde(default)]
    pub ahead: u32,
    #[serde(default)]
    pub behind: u32,
    #[serde(default)]
    pub dirty: bool,
    #[serde(default)]
    pub staged: u32,
    #[serde(default)]
    pub unstaged: u32,
    #[serde(default)]
    pub untracked: u32,
}

/// Comando de verificação detectado do projeto (test/lint/build).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCheckInfo {
    pub id: String,
    pub label: String,
    pub command: String,
}

/// Perfil detectado do projeto do workspace.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    /// `node` | `rust` | `python` | `go` | `dotnet` | `unknown`
    pub kind: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub checks: Vec<ProjectCheckInfo>,
}

/// Estado do workspace para o header/painel (`get_workspace_context`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContext {
    pub workspace: Workspace,
    #[serde(default)]
    pub project: Option<ProjectInfo>,
}

/// Item de tarefa mantida pelo agente (`todo_write`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub content: String,
    pub status: TodoStatus,
}

/// Estado do modo Plano (`HARNESS.md` §6; `WORKBENCH.md` §5.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanState {
    Inactive,
    Planning,
    Reviewing,
    Approved,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanView {
    pub state: PlanState,
    #[serde(default)]
    pub markdown: Option<String>,
    /// Feedback do usuário quando "Continuar planejando" foi escolhido
    /// (persistido em `plan/feedback`; usado pelo card e pelo prompt).
    #[serde(default)]
    pub feedback: Option<String>,
    pub updated_at: i64,
}

/* ------------------------------------------------------------------ */
/* Objetivos (Goal) do layout Code (docs/goals/code-goals/PLAN.md)     */
/* ------------------------------------------------------------------ */

/// Origem de um turno e de uma mensagem de usuário. O default `user` mantém
/// payloads antigos e testes existentes retrocompatíveis.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnKind {
    #[default]
    User,
    /// Rodada automática/manual de um objetivo, gerada pelo driver do renderer.
    GoalRound,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    Active,
    Paused,
    Completed,
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalPauseReason {
    User,
    Error,
    MaxRounds,
    Stalled,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalOrigin {
    User,
    Agent,
}

/// Estado completo de um objetivo (projeção de `code_events`; o último
/// `goal/state` vence e a `revision` é o CAS das ações da UI).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalView {
    pub title: String,
    pub objective: String,
    pub status: GoalStatus,
    /// Continuar sozinho após cada turno bem-sucedido.
    pub auto_continue: bool,
    pub rounds: u32,
    pub max_rounds: u32,
    pub revision: u64,
    pub origin: GoalOrigin,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub completed_at: Option<i64>,
    #[serde(default)]
    pub last_round_at: Option<i64>,
    #[serde(default)]
    pub last_note: Option<String>,
    #[serde(default)]
    pub pause_reason: Option<GoalPauseReason>,
    #[serde(default)]
    pub pause_detail: Option<String>,
    #[serde(default)]
    pub blocker_reason: Option<String>,
    #[serde(default)]
    pub blocker_streak: u32,
    #[serde(default)]
    pub stalled_rounds: u32,
    #[serde(default)]
    pub tokens: u64,
    #[serde(default)]
    pub cost: f64,
}

/// Uma rodada do objetivo (registro do histórico/painel).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalRound {
    pub index: u32,
    pub turn_id: String,
    pub started_at: i64,
    #[serde(default)]
    pub ended_at: Option<i64>,
    /// `done` | `cancelled` | `error` | `interrupted` (None = em andamento).
    #[serde(default)]
    pub outcome: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub tokens: Option<u32>,
    #[serde(default)]
    pub cost: Option<f64>,
    #[serde(default)]
    pub files_changed: u32,
    #[serde(default)]
    pub note: Option<String>,
}

/// Resposta do preflight `goal_can_continue` (códigos estáveis em `reason`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalContinuation {
    pub ok: bool,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub goal: Option<GoalView>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalInput {
    pub objective: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub max_rounds: Option<u32>,
    #[serde(default)]
    pub auto_continue: Option<bool>,
}

/// Ações da UI sobre o objetivo (`update_goal`). A tool do modelo tem um
/// contrato próprio (`create|edit|progress|complete|blocked`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalAction {
    Edit,
    Arm,
    Disarm,
    Pause,
    Resume,
    Complete,
    Reopen,
    Block,
    Delete,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateGoalInput {
    pub title: Option<String>,
    pub objective: Option<String>,
    pub max_rounds: Option<u32>,
    pub summary: Option<String>,
    pub reason: Option<String>,
}

/// Tipo de alteração de um arquivo (journal/presentation).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileChangeKind {
    Created,
    Modified,
    Deleted,
    Renamed,
}

/// Alteração de um arquivo (card de tool / evento `FileChanged`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub kind: FileChangeKind,
    #[serde(default)]
    pub added: u32,
    #[serde(default)]
    pub removed: u32,
    #[serde(default)]
    pub diff: Option<String>,
}

/// Resumo compacto por arquivo (painel Alterações / evento `WorkspaceChanges`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeSummary {
    pub path: String,
    pub kind: FileChangeKind,
    #[serde(default)]
    pub added: u32,
    #[serde(default)]
    pub removed: u32,
    /// `session` (journal do agente), `git` (working tree) ou `both`.
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default)]
    pub staged: bool,
}

/// Alterações de um turno (evento `WorkspaceChanges` / painel).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangesSummary {
    #[serde(default)]
    pub turn_id: Option<String>,
    pub files: Vec<FileChangeSummary>,
    #[serde(default)]
    pub added: u32,
    #[serde(default)]
    pub removed: u32,
}

/// Quebra estimada do contexto consumido, em tokens, para o medidor/popover
/// (`WORKBENCH.md` §4/§9, `HARNESS.md` §10.1). A soma deve acompanhar `used`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBreakdown {
    /// System prompt (identidade, política, projeto, skills…).
    #[serde(default)]
    pub system_prompt: u32,
    /// Definições wire das tools (nome + descrição + JSON Schema).
    #[serde(default)]
    pub tool_definitions: u32,
    /// Histórico (mensagens, reasoning, argumentos de tool calls e resultados).
    #[serde(default)]
    pub messages: u32,
}

/// Uso de contexto estimado (medidor do header).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextStats {
    pub used: u32,
    pub window: u32,
    pub output_cap: u32,
    pub percent: f32,
    #[serde(default)]
    pub compacted: u32,
    #[serde(default)]
    pub messages: u32,
    /// Payloads antigos persistidos antes do breakdown não têm este campo.
    #[serde(default)]
    pub breakdown: ContextBreakdown,
}

/// Estado de um job de processo em background.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Running,
    Done,
    Failed,
    Killed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub id: String,
    pub command: String,
    pub status: JobStatus,
    pub started_at: i64,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub output_preview: Option<String>,
}

/// Snapshot completo da sessão de código (`get_code_session_state`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSessionState {
    pub conversation_id: String,
    pub permission_mode: PermissionMode,
    pub plan_mode: bool,
    #[serde(default)]
    pub plan: Option<PlanView>,
    /// Objetivo persistente da sessão (`docs/goals/code-goals/PLAN.md`).
    #[serde(default)]
    pub goal: Option<GoalView>,
    #[serde(default)]
    pub todos: Vec<TodoItem>,
    #[serde(default)]
    pub workspace: Option<Workspace>,
    #[serde(default)]
    pub project: Option<ProjectInfo>,
    #[serde(default)]
    pub context: Option<ContextStats>,
    #[serde(default)]
    pub changes: Option<ChangesSummary>,
    #[serde(default)]
    pub jobs: Vec<JobView>,
    #[serde(default)]
    pub approvals: Vec<ApprovalRequest>,
    #[serde(default)]
    pub questions: Vec<AskUserRequest>,
}

/// Entrada da árvore de arquivos do workspace (`list_workspace_files`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileEntry {
    /// Path relativo ao workspace, sempre com `/`.
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    /// Profundidade relativa ao diretório pedido (0 = raiz da listagem).
    pub depth: u32,
    #[serde(default)]
    pub size: Option<u64>,
    /// Estado no git (`M`, `A`, `D`, `U`, `?`) quando disponível.
    #[serde(default)]
    pub git_status: Option<String>,
    #[serde(default)]
    pub children: Vec<WorkspaceFileEntry>,
}

/// Conteúdo de um arquivo do workspace para prévia read-only (aba central).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileContent {
    pub path: String,
    pub text: String,
    /// O backend truncou o conteúdo textual (arquivo maior que o limite de prévia).
    pub truncated: bool,
    /// Tamanho total em bytes.
    pub size: u64,
    #[serde(default)]
    pub binary: bool,
    /// Encoding detectado quando o conteúdo não era UTF-8.
    #[serde(default)]
    pub encoding: Option<String>,
    /// MIME inferido pela extensão para prévias binárias suportadas
    /// (imagem/PDF). `None` para texto e binários sem prévia.
    #[serde(default)]
    pub mime_type: Option<String>,
    /// Payload base64 (sem prefixo `data:`) de imagens/PDF até o limite inline.
    #[serde(default)]
    pub data_base64: Option<String>,
    /// Payload binário omitido por exceder o limite de prévia inline.
    #[serde(default)]
    pub preview_omitted: bool,
}

/// Arquivo no status do git (painel Alterações).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitFile {
    pub path: String,
    pub status: String,
}

/// Status do git de um workspace (working tree + staged).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitStatus {
    pub is_repo: bool,
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub ahead: u32,
    #[serde(default)]
    pub behind: u32,
    #[serde(default)]
    pub staged: Vec<WorkspaceGitFile>,
    #[serde(default)]
    pub unstaged: Vec<WorkspaceGitFile>,
    #[serde(default)]
    pub untracked: Vec<String>,
    #[serde(default)]
    pub conflicted: Vec<String>,
}

/// Commit recente para o painel (git log).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitCommit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

/// Um arquivo alterado por um commit (patch completo por arquivo).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCommitFile {
    pub path: String,
    #[serde(default)]
    pub old_path: Option<String>,
    /// `A` | `M` | `D` | `R` | `C` | `T`.
    pub status: String,
    pub added: u32,
    pub removed: u32,
    #[serde(default)]
    pub binary: bool,
    pub diff: String,
}

/// Commit completo para a aba de histórico do Code (metadados + arquivos).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCommitDetail {
    pub hash: String,
    pub author: String,
    pub email: String,
    pub date: String,
    pub subject: String,
    #[serde(default)]
    pub body: String,
    pub files: Vec<WorkspaceCommitFile>,
    #[serde(default)]
    pub truncated: bool,
}

impl ToolCallRecord {
    /// Constrói o record com apresentação estruturada (diff/todo/plano/job).
    pub fn with_presentation(mut self, presentation: Option<Value>) -> Self {
        self.presentation = presentation;
        self
    }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_session_id_is_internal_and_never_accepted_from_ipc() {
        let options: TurnOptions =
            serde_json::from_str("{}").expect("TurnOptions com defaults");
        assert_eq!(options.wire_session_id, None);
        let json = serde_json::to_string(&options).expect("serialize TurnOptions");
        assert!(!json.contains("wireSessionId"), "{json}");
        assert!(!json.contains("wire_session_id"), "{json}");
    }

    /// Auth-status DTOs are renderer-facing: they may carry account labels and
    /// masked ids, but never any credential material.
    #[test]
    fn auth_status_never_serializes_tokens() {
        let status = ProviderAuthStatus {
            provider_id: "openai".into(),
            mode: "oauth".into(),
            state: "signed-in".into(),
            account_label: Some("user@example.com".into()),
            plan_usage: true,
            expires_at: Some(1_700_000_000_000),
            scopes: vec!["openid".into(), "chatgpt.tokens.use.direct".into()],
            client_id_masked: Some("oaiapp…1234".into()),
            host_id_masked: Some("urn:uuid:…".into()),
            hint: None,
        };
        let json = serde_json::to_string(&status).expect("serialize auth status");
        for forbidden in ["access_token", "refresh_token", "id_token", "accessToken", "refreshToken"] {
            assert!(!json.contains(forbidden), "{forbidden} vazou no status: {json}");
        }
        assert!(json.contains("\"planUsage\":true"));
        assert!(json.contains("\"clientIdMasked\""));

        let view = SettingsView {
            settings: Settings::default(),
            keys: Vec::new(),
            auth: vec![status],
            secrets_error: None,
        };
        let json = serde_json::to_string(&view).expect("serialize settings view");
        assert!(json.contains("\"auth\""));
        assert!(json.contains("\"secretsError\":null"));
    }

    #[test]
    fn login_challenge_uses_camel_case() {
        let challenge = LoginChallenge {
            attempt_id: "a1".into(),
            auth_url: "https://auth.openai.com/api/accounts/authorize?x=1".into(),
            expires_at: 123,
        };
        let json = serde_json::to_value(&challenge).expect("serialize challenge");
        assert_eq!(json["attemptId"], "a1");
        assert_eq!(json["authUrl"], "https://auth.openai.com/api/accounts/authorize?x=1");
        assert_eq!(json["expiresAt"], 123);
    }

    /// O replay opaco do provedor fica só no backend (SQLite): o renderer nunca
    /// usou o campo e, a partir do formato v2, ele carrega o estado de todos os
    /// passos do loop — mandá-lo no IPC só inflaria as mensagens.
    #[test]
    fn provider_state_is_not_serialized_to_the_renderer() {
        let mut message = ChatMessage::assistant("conv-1");
        message.provider_state = Some(serde_json::json!({
            "version": 2,
            "steps": [{"state": {"output": []}, "text": "ok", "toolCallIds": []}],
        }));

        let json = serde_json::to_value(&message).expect("serialize assistant message");
        assert!(
            json.get("providerState").is_none(),
            "provider_state não deve cruzar o IPC: {json}"
        );

        // Desserialização continua tolerante (não quebra payloads antigos).
        let parsed: ChatMessage = serde_json::from_value(json).expect("deserialize message");
        assert!(parsed.provider_state.is_none());
    }

    #[test]
    fn detects_media_and_archive_kinds_by_extension_and_mime() {
        for (mime, name, expected) in [
            ("audio/mpeg", "trilha.mp3", ArtifactKind::Audio),
            ("audio/wav", "voz.wav", ArtifactKind::Audio),
            ("", "sem-extensao.ogg", ArtifactKind::Audio),
            ("audio/ogg", "audio", ArtifactKind::Audio),
            ("video/mp4", "demo.mp4", ArtifactKind::Video),
            ("video/webm", "captura.webm", ArtifactKind::Video),
            ("application/octet-stream", "clipe.mov", ArtifactKind::Video),
            ("video/mp4", "video", ArtifactKind::Video),
            ("application/zip", "pacote.zip", ArtifactKind::Archive),
            ("application/octet-stream", "backup.7z", ArtifactKind::Archive),
            ("application/x-tar", "fontes.tar", ArtifactKind::Archive),
            ("application/gzip", "dados.gz", ArtifactKind::Archive),
            ("image/tiff", "scan.tif", ArtifactKind::Image),
            ("image/x-icon", "icone.ico", ArtifactKind::Image),
        ] {
            assert_eq!(
                ArtifactKind::from_mime_and_name(mime, name),
                expected,
                "{name} ({mime})"
            );
        }
        // Tipos textuais continuam com a classificação anterior.
        assert_eq!(
            ArtifactKind::from_mime_and_name("text/markdown", "notas.md"),
            ArtifactKind::Markdown
        );
        assert_eq!(
            ArtifactKind::from_mime_and_name("text/plain", "LEIAME"),
            ArtifactKind::Text
        );
    }

    #[test]
    fn media_kinds_are_not_textual() {
        for kind in [ArtifactKind::Audio, ArtifactKind::Video, ArtifactKind::Archive] {
            assert!(!kind.is_textual(), "{kind:?} não é textual");
        }
        assert_eq!(
            serde_json::to_string(&ArtifactKind::Audio).expect("serialize"),
            "\"audio\""
        );
        assert_eq!(
            serde_json::to_string(&ArtifactKind::Archive).expect("serialize"),
            "\"archive\""
        );
    }

    #[test]
    fn new_preview_variants_serialize_with_the_ipc_kind_tag() {
        let image = serde_json::to_value(ArtifactPreview::Image {
            mime: "image/tiff".into(),
            width: Some(640),
            height: Some(480),
            data_base64: Some("iVBOR".into()),
        })
        .expect("serialize image preview");
        assert_eq!(image["kind"], "image");
        assert_eq!(image["width"], 640);
        assert_eq!(image["dataBase64"], "iVBOR");

        let archive = serde_json::to_value(ArtifactPreview::Archive {
            format: "zip".into(),
            entries: vec![ArchiveEntryPreview {
                name: "src/main.rs".into(),
                size: 120,
                compressed_size: 80,
                is_dir: false,
            }],
            total_entries: 1,
            truncated: false,
        })
        .expect("serialize archive preview");
        assert_eq!(archive["kind"], "archive");
        assert_eq!(archive["entries"][0]["isDir"], false);
        assert_eq!(archive["totalEntries"], 1);

        let binary = serde_json::to_value(ArtifactPreview::Binary {
            format: "application/octet-stream".into(),
            preview_base64: "AAEC".into(),
            preview_bytes: 3,
        })
        .expect("serialize binary preview");
        assert_eq!(binary["kind"], "binary");
        assert_eq!(binary["previewBytes"], 3);
    }

    /// Contrato da página Biblioteca (`list_library_artifacts`): o
    /// `serde(flatten)` precisa manter os campos de `Artifact` no topo, em
    /// camelCase, junto de `conversationTitle` — o renderer tipa o retorno como
    /// `LibraryArtifact extends Artifact`.
    #[test]
    fn library_artifact_serializes_flattened_with_camel_case() {
        let generated = LibraryArtifact {
            artifact: Artifact {
                id: "art-1".into(),
                conversation_id: Some("conv-1".into()),
                message_id: Some("msg-1".into()),
                name: "relatorio.md".into(),
                mime_type: "text/markdown".into(),
                kind: ArtifactKind::Markdown,
                language: Some("markdown".into()),
                size: 42,
                created_at: 1_700_000_000_000,
                favorite: true,
            },
            conversation_title: Some("Planejamento".into()),
        };
        let json = serde_json::to_value(&generated).expect("serialize library artifact");
        assert_eq!(json["id"], "art-1");
        assert_eq!(json["conversationId"], "conv-1");
        assert_eq!(json["messageId"], "msg-1");
        assert_eq!(json["mimeType"], "text/markdown");
        assert_eq!(json["createdAt"], 1_700_000_000_000_i64);
        assert_eq!(json["favorite"], true);
        assert_eq!(json["conversationTitle"], "Planejamento");
        // Achatado: nada de subobjeto `artifact` vazando no IPC.
        assert!(json.get("artifact").is_none());

        let upload = LibraryArtifact {
            artifact: Artifact {
                conversation_id: None,
                message_id: None,
                favorite: false,
                ..generated.artifact
            },
            conversation_title: None,
        };
        let json = serde_json::to_value(&upload).expect("serialize upload");
        assert!(json["conversationId"].is_null(), "upload não tem conversa");
        assert!(json["conversationTitle"].is_null());
        assert_eq!(json["favorite"], false);
    }

    #[test]
    fn artifact_thumbnail_uses_camel_case_for_the_ipc_payload() {
        let thumbnail = ArtifactThumbnail {
            mime: "image/png".into(),
            data_base64: "iVBOR".into(),
            width: 512,
            height: 288,
        };
        let json = serde_json::to_value(&thumbnail).expect("serialize thumbnail");
        assert_eq!(json["mime"], "image/png");
        assert_eq!(json["dataBase64"], "iVBOR");
        assert_eq!(json["width"], 512);
        assert_eq!(json["height"], 288);
    }

    /// Contrato da separação Chat/Code: o renderer lê `mode` e `codeLinked` no
    /// IPC (camelCase) e precisa receber `mode` mesmo em conversas antigas.
    #[test]
    fn conversation_serializes_mode_and_code_linked_in_camel_case() {
        let conversation = Conversation {
            id: "conv-1".into(),
            title: "Projeto Aurora".into(),
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_001_000,
            pinned: false,
            provider_id: "opencode-go".into(),
            model_id: "glm-5.3-flash".into(),
            message_count: 3,
            preview: Some("primeira pergunta".into()),
            mode: CONVERSATION_MODE_CODE.to_string(),
            code_linked: true,
            workspace_id: Some("ws-1".into()),
            agent_kind: "lumina".into(),
            permission_mode: PermissionMode::Edit,
            parent_conversation_id: None,
            subagent_task_call_id: None,
            subagent_type: None,
        };
        let json = serde_json::to_value(&conversation).expect("serialize conversation");
        assert_eq!(json["mode"], "code");
        assert_eq!(json["codeLinked"], true);
        assert!(
            json.get("code_linked").is_none(),
            "o IPC usa camelCase: {json}"
        );
        // Sessão criada no Code nunca nasce compartilhada; o campo é lido como
        // enviado (a regra de vínculo é do `Db`).
        assert_eq!(conversation.mode, CONVERSATION_MODE_CODE);
        assert!(conversation.code_linked);

        // Payloads antigos (sem os campos novos) continuam desserializáveis e
        // caem no modo Chat, sem vínculo.
        let legacy = serde_json::json!({
            "id": "conv-2",
            "title": "Conversa antiga",
            "createdAt": 10,
            "updatedAt": 20,
            "pinned": false,
            "providerId": "opencode-go",
            "modelId": "glm-5.3-flash",
            "messageCount": 0,
            "preview": null,
        });
        let parsed: Conversation =
            serde_json::from_value(legacy).expect("deserialize legacy conversation");
        assert_eq!(parsed.mode, CONVERSATION_MODE_CHAT);
        assert!(!parsed.code_linked);
    }

    #[test]
    fn normalizes_unknown_conversation_modes_to_chat() {
        assert_eq!(conversation_mode_or_default(None), CONVERSATION_MODE_CHAT);
        assert_eq!(
            conversation_mode_or_default(Some("")),
            CONVERSATION_MODE_CHAT
        );
        assert_eq!(
            conversation_mode_or_default(Some("   ")),
            CONVERSATION_MODE_CHAT
        );
        assert_eq!(
            conversation_mode_or_default(Some("chat")),
            CONVERSATION_MODE_CHAT
        );
        assert_eq!(
            conversation_mode_or_default(Some("code")),
            CONVERSATION_MODE_CODE
        );
        assert_eq!(
            conversation_mode_or_default(Some(" code ")),
            CONVERSATION_MODE_CODE,
            "espaços em volta do modo são tolerados"
        );
        for invalid in ["Chat", "CODE", "codex", "workspace", "projeto"] {
            assert_eq!(
                conversation_mode_or_default(Some(invalid)),
                CONVERSATION_MODE_CHAT,
                "{invalid:?} não é um modo válido"
            );
        }
    }
}
