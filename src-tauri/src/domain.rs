//! Serializable domain types shared by the Tauri commands, the SQLite layer and
//! the React renderer. Every struct here is part of the IPC contract: keep field
//! names in sync with `src/lib/types.ts`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/* ------------------------------------------------------------------ */
/* Conversations & messages                                            */
/* ------------------------------------------------------------------ */

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
    #[serde(default)]
    pub cached_tokens: Option<u32>,
    #[serde(default)]
    pub total_tokens: Option<u32>,
    #[serde(default)]
    pub cost: Option<f64>,
    /// Wall-clock duration of the turn in milliseconds.
    #[serde(default)]
    pub duration_ms: Option<u64>,
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
            "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "avif" | "tif" | "tiff" => {
                return Self::Image
            }
            _ => {}
        }
        if mime.starts_with("image/") {
            return Self::Image;
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
    pub conversation_id: String,
    #[serde(default)]
    pub message_id: Option<String>,
    pub name: String,
    pub mime_type: String,
    pub kind: ArtifactKind,
    #[serde(default)]
    pub language: Option<String>,
    pub size: i64,
    pub created_at: i64,
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

/// Prévia estruturada de um artefato binário (docx/xlsx/pptx).
///
/// O PDF não aparece aqui: o renderer o desenha com pdf.js a partir do
/// conteúdo base64 (`get_artifact_content`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ArtifactPreview {
    Docx { html: String },
    Xlsx { sheets: Vec<SheetPreview> },
    Pptx { slides: Vec<SlidePreview> },
    Unsupported { reason: String },
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
    /// settings | env | opencode-cli | none
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub settings: Settings,
    pub keys: Vec<ProviderKeyStatus>,
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
    pub remote_refreshed_at: Option<i64>,
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
}
