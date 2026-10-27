//! SQLite persistence (conversations, messages, attachments, artifacts, usage
//! and the code-harness tables: workspaces, code events, file journal, session
//! summaries and approval rules).
//!
//! One shared `rusqlite::Connection` guarded by a `parking_lot::Mutex` keeps
//! `Db` `Send + Sync`, which is what the Tauri state requires. All JSON columns
//! (`tool_calls`, `citations`, `attachments`, `usage`, `provider_state`,
//! `trace`) are (de)serialized here; the rest of the app only sees domain types.

use std::path::Path;

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use crate::domain::{
    conversation_mode_or_default, now_ms, ApprovalDecision, ApprovalRule, ApprovalScope, Artifact,
    ArtifactKind, AttachmentInfo, ChatMessage, Conversation, ConversationDetail, FileChangeKind,
    LibraryArtifact, MessageRole, MessageStatus, PermissionMode, UsageInfo, Workspace,
    CONVERSATION_MODE_CHAT,
};

/* ------------------------------------------------------------------ */
/* Column lists                                                        */
/* ------------------------------------------------------------------ */

const CONVERSATION_COLUMNS: &str = "id, title, created_at, updated_at, pinned, \
     provider_id, model_id, message_count, preview, mode, code_linked, workspace_id, \
     agent_kind, permission_mode";

const WORKSPACE_COLUMNS: &str = "id, name, path, created_at, updated_at, last_opened_at, \
     pinned, trusted";

const MESSAGE_COLUMNS: &str = "id, conversation_id, role, content, reasoning, status, \
     tool_calls, citations, attachments, model_id, provider_id, usage, provider_state, created_at, trace";

const ATTACHMENT_COLUMNS: &str = "id, name, mime_type, size, kind, text, page_count, \
     width, height, file_path, created_at";

const ARTIFACT_COLUMNS: &str = "id, conversation_id, message_id, name, mime_type, kind, \
     language, size, created_at, favorite";

/// Mesmas colunas de [`ARTIFACT_COLUMNS`], qualificadas para a query com
/// `LEFT JOIN conversations` de [`Db::list_library_artifacts`]. Um teste garante
/// que as duas listas continuam na mesma ordem (o mapper lê por posição).
const ARTIFACT_JOIN_COLUMNS: &str = "a.id, a.conversation_id, a.message_id, a.name, \
     a.mime_type, a.kind, a.language, a.size, a.created_at, a.favorite";

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

const PRAGMAS: &str = "
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
";

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  pinned        INTEGER NOT NULL DEFAULT 0,
  provider_id   TEXT NOT NULL,
  model_id      TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  preview       TEXT,
  -- Layout onde a sessão nasceu ('chat' | 'code'); bancos legados viram 'chat'.
  mode          TEXT NOT NULL DEFAULT 'chat',
  -- Sessão do Chat adicionada ao Code (compartilhada nos dois layouts).
  code_linked   INTEGER NOT NULL DEFAULT 0,
  -- Harness de código: workspace da sessão (NULL = sem workspace), motor do
  -- agente ('lumina'; 'acp:<agente>' fica reservado) e modo de permissão
  -- ('read_only' | 'edit' | 'autonomous'). O Chat ignora os três.
  workspace_id    TEXT,
  agent_kind      TEXT NOT NULL DEFAULT 'lumina',
  permission_mode TEXT NOT NULL DEFAULT 'edit'
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  reasoning       TEXT,
  status          TEXT NOT NULL,
  tool_calls      TEXT NOT NULL DEFAULT '[]',
  citations       TEXT NOT NULL DEFAULT '[]',
  attachments     TEXT NOT NULL DEFAULT '[]',
  model_id        TEXT,
  provider_id     TEXT,
  usage           TEXT,
  provider_state  TEXT,
  created_at      INTEGER NOT NULL,
  trace           TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  size       INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL DEFAULT '',
  page_count INTEGER,
  width      INTEGER,
  height     INTEGER,
  file_path  TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id              TEXT PRIMARY KEY,
  -- NULL = arquivo enviado pelo usuário direto à Biblioteca (sem conversa).
  conversation_id TEXT,
  message_id      TEXT,
  name            TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  kind            TEXT NOT NULL,
  language        TEXT,
  size            INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  path            TEXT NOT NULL,
  favorite        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS usage_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  TEXT,
  message_id       TEXT,
  provider_id      TEXT,
  model_id         TEXT,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  reasoning_tokens INTEGER,
  cached_tokens    INTEGER,
  total_tokens     INTEGER,
  cost             REAL,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

/* ---- harness de código (docs/goals/code-harness/PLAN.md §7) ---- */

CREATE TABLE IF NOT EXISTS workspaces (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  path           TEXT NOT NULL UNIQUE,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  last_opened_at INTEGER,
  pinned         INTEGER NOT NULL DEFAULT 0,
  trusted        INTEGER NOT NULL DEFAULT 0
);

-- Trilha persistida do agente de código: um evento por passo/ferramenta, com
-- `seq` monotônico por conversa (usado pelo replay/compactação).
CREATE TABLE IF NOT EXISTS code_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  turn_id         TEXT,
  seq             INTEGER NOT NULL,
  kind            TEXT NOT NULL,
  payload         TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_code_events_conv_seq ON code_events(conversation_id, seq);

-- Journal das escritas de arquivo feitas pelo agente (painel Alterações/replay).
CREATE TABLE IF NOT EXISTS file_journal (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  turn_id         TEXT NOT NULL,
  path            TEXT NOT NULL,
  change_kind     TEXT NOT NULL,
  before_hash     TEXT,
  after_hash      TEXT,
  added           INTEGER,
  removed         INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_journal_conv_turn ON file_journal(conversation_id, turn_id);

-- Resumos de compactação: cobrem a faixa de `seq` de code_events.
CREATE TABLE IF NOT EXISTS session_summaries (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  from_seq        INTEGER NOT NULL,
  to_seq          INTEGER NOT NULL,
  content         TEXT NOT NULL,
  tokens          INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_summaries_conv
  ON session_summaries(conversation_id, created_at);

-- Regras de aprovacao (sempre permitir/negar) por escopo sessao/workspace/global.
CREATE TABLE IF NOT EXISTS approval_rules (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL,
  scope_id   TEXT,
  tool       TEXT NOT NULL,
  matcher    TEXT NOT NULL,
  pattern    TEXT NOT NULL,
  decision   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_rules_scope ON approval_rules(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_approval_rules_tool ON approval_rules(tool);
";

/* ------------------------------------------------------------------ */
/* Stored rows                                                         */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone)]
pub struct StoredAttachment {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: i64,
    pub kind: String,
    pub text: String,
    pub page_count: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_path: Option<String>,
    pub created_at: i64,
}

impl StoredAttachment {
    pub fn info(&self) -> AttachmentInfo {
        AttachmentInfo {
            id: self.id.clone(),
            name: self.name.clone(),
            mime_type: self.mime_type.clone(),
            size: self.size,
            kind: self.kind.clone(),
            text_preview: if self.text.trim().is_empty() {
                None
            } else {
                Some(self.text.chars().take(280).collect())
            },
            page_count: self.page_count,
            width: self.width,
            height: self.height,
        }
    }
}

#[derive(Debug, Clone)]
pub struct StoredArtifact {
    pub artifact: Artifact,
    pub path: String,
}

/* ---- harness de código: linhas persistidas ---- */

/// Evento da trilha do agente de código (`code_events`). `payload` é o JSON
/// opaco do evento (o renderer/replay decide como interpretar por `kind`).
#[derive(Debug, Clone)]
pub struct StoredCodeEvent {
    pub id: i64,
    pub conversation_id: String,
    pub turn_id: Option<String>,
    /// Monotônico por conversa, começando em 1 (garantido por índice único).
    pub seq: i64,
    pub kind: String,
    pub payload: String,
    pub created_at: i64,
}

/// Entrada do journal de escritas de arquivo (`file_journal`).
#[derive(Debug, Clone)]
pub struct FileJournalEntry {
    pub id: i64,
    pub conversation_id: String,
    pub turn_id: String,
    pub path: String,
    pub change_kind: FileChangeKind,
    pub before_hash: Option<String>,
    pub after_hash: Option<String>,
    pub added: Option<u32>,
    pub removed: Option<u32>,
    pub created_at: i64,
}

impl FileJournalEntry {
    /// Entrada mínima (sem hashes/contagem); `created_at` = agora.
    pub fn new(
        conversation_id: impl Into<String>,
        turn_id: impl Into<String>,
        path: impl Into<String>,
        change_kind: FileChangeKind,
    ) -> Self {
        Self {
            id: 0,
            conversation_id: conversation_id.into(),
            turn_id: turn_id.into(),
            path: path.into(),
            change_kind,
            before_hash: None,
            after_hash: None,
            added: None,
            removed: None,
            created_at: now_ms(),
        }
    }

    /// Hashes de conteúdo antes/depois da escrita (para "desfazer"/comparar).
    pub fn with_hashes(mut self, before: Option<&str>, after: Option<&str>) -> Self {
        self.before_hash = before.map(str::to_string);
        self.after_hash = after.map(str::to_string);
        self
    }

    /// Linhas adicionadas/removidas do arquivo (contagem do diff).
    pub fn with_line_counts(mut self, added: u32, removed: u32) -> Self {
        self.added = Some(added);
        self.removed = Some(removed);
        self
    }
}

/// Resumo de compactação que cobre a faixa `[from_seq, to_seq]` de
/// `code_events` de uma conversa (`session_summaries`).
#[derive(Debug, Clone)]
pub struct SessionSummary {
    pub id: String,
    pub conversation_id: String,
    pub from_seq: i64,
    pub to_seq: i64,
    pub content: String,
    pub tokens: Option<u32>,
    pub created_at: i64,
}

/// Dados para criar uma regra de aprovação; o `Db` gera `id` e `created_at`.
#[derive(Debug, Clone)]
pub struct NewApprovalRule<'a> {
    pub scope: ApprovalScope,
    pub scope_id: Option<&'a str>,
    pub tool: &'a str,
    pub matcher: &'a str,
    pub pattern: &'a str,
    pub decision: ApprovalDecision,
}

/* ------------------------------------------------------------------ */
/* JSON helpers                                                        */
/* ------------------------------------------------------------------ */

fn encode_json<T: Serialize + ?Sized>(value: &T) -> Result<String> {
    serde_json::to_string(value).context("falha ao serializar coluna JSON")
}

/// Decode a JSON column produced by this module. Corrupt/legacy values fall
/// back to the type default instead of breaking an entire conversation read.
fn decode_json<T: DeserializeOwned + Default>(raw: &str) -> T {
    serde_json::from_str(raw).unwrap_or_default()
}

fn decode_opt<T: DeserializeOwned>(raw: Option<String>) -> Option<T> {
    raw.and_then(|raw| serde_json::from_str(&raw).ok())
}

fn decode_opt_value(raw: Option<String>) -> Option<Value> {
    raw.and_then(|raw| serde_json::from_str(&raw).ok())
}

/// Adds `column` to `table` when an older database is missing it.
fn ensure_column(conn: &Connection, table: &str, column: &str, ddl: &str) -> Result<()> {
    let has_column = {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .with_context(|| format!("falha ao inspecionar a tabela {table}"))?;
        let names = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .with_context(|| format!("falha ao listar colunas de {table}"))?;
        names
            .collect::<rusqlite::Result<Vec<String>>>()
            .with_context(|| format!("falha ao ler colunas de {table}"))?
            .iter()
            .any(|name| name == column)
    };
    if !has_column {
        conn.execute(ddl, [])
            .with_context(|| format!("falha ao adicionar a coluna {column} em {table}"))?;
    }
    Ok(())
}

/// Leh `(nome, notnull)` de cada coluna da tabela (ordem do `PRAGMA table_info`).
fn table_columns(conn: &Connection, table: &str) -> Result<Vec<(String, bool)>> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .with_context(|| format!("falha ao inspecionar a tabela {table}"))?;
    let rows = stmt
        .query_map([], |row| {
            let name: String = row.get(1)?;
            let not_null: i64 = row.get(3)?;
            Ok((name, not_null != 0))
        })
        .with_context(|| format!("falha ao listar colunas de {table}"))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .with_context(|| format!("falha ao ler colunas de {table}"))
}

/// Migração aditiva e idempotente da tabela `artifacts`:
///
/// 1. bancos anteriores à Biblioteca ganham `favorite INTEGER NOT NULL DEFAULT 0`;
/// 2. bancos em que `conversation_id` ainda é `NOT NULL` são reconstruídos (a
///    coluna passa a aceitar `NULL`, que identifica um arquivo enviado pelo
///    usuário direto à biblioteca). A reconstrução roda em transação e copia
///    todas as linhas — nenhum artefato é perdido e os antigos ficam
///    `favorite = 0`.
fn migrate_artifacts_schema(conn: &Connection) -> Result<()> {
    ensure_column(
        conn,
        "artifacts",
        "favorite",
        "ALTER TABLE artifacts ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0",
    )?;

    let conversation_id_is_required = table_columns(conn, "artifacts")?
        .iter()
        .any(|(name, not_null)| name == "conversation_id" && *not_null);
    if !conversation_id_is_required {
        return Ok(());
    }

    let tx = conn
        .unchecked_transaction()
        .context("falha ao abrir a transação de migração da tabela artifacts")?;
    // `artifacts_new` só existiria se uma migração anterior tivesse sido
    // interrompida fora da transação; o DROP defensivo mantém a migração
    // idempotente sem arriscar a tabela atual (que só cai depois da cópia).
    tx.execute_batch(
        "DROP TABLE IF EXISTS artifacts_new;
         CREATE TABLE artifacts_new (
           id              TEXT PRIMARY KEY,
           conversation_id TEXT,
           message_id      TEXT,
           name            TEXT NOT NULL,
           mime_type       TEXT NOT NULL,
           kind            TEXT NOT NULL,
           language        TEXT,
           size            INTEGER NOT NULL,
           created_at      INTEGER NOT NULL,
           path            TEXT NOT NULL,
           favorite        INTEGER NOT NULL DEFAULT 0
         );
         INSERT INTO artifacts_new (id, conversation_id, message_id, name, mime_type, kind,
                                    language, size, created_at, path, favorite)
           SELECT id, conversation_id, message_id, name, mime_type, kind, language, size,
                  created_at, path, favorite
           FROM artifacts;
         DROP TABLE artifacts;
         ALTER TABLE artifacts_new RENAME TO artifacts;",
    )
    .context("falha ao reconstruir a tabela artifacts para aceitar uploads da biblioteca")?;
    tx.commit()
        .context("falha ao confirmar a migração da tabela artifacts")?;
    Ok(())
}

/// Migração aditiva e idempotente da tabela `conversations`:
///
/// 1. separação Chat/Code: bancos criados antes dos dois layouts ganham `mode`
///    (`'chat'` em todas as linhas existentes) e `code_linked` (`0`);
/// 2. harness de código: bancos criados antes do harness ganham `workspace_id`
///    (`NULL` = sem workspace), `agent_kind` (`'lumina'`) e `permission_mode`
///    (`'edit'`). O Chat ignora os três; `workspace_id` é preenchido quando o
///    usuário abre uma sessão de código com workspace.
///
/// Nenhuma linha é perdida e a migração pode rodar quantas vezes for preciso.
fn migrate_conversations_schema(conn: &Connection) -> Result<()> {
    ensure_column(
        conn,
        "conversations",
        "mode",
        "ALTER TABLE conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat'",
    )?;
    ensure_column(
        conn,
        "conversations",
        "code_linked",
        "ALTER TABLE conversations ADD COLUMN code_linked INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "conversations",
        "workspace_id",
        "ALTER TABLE conversations ADD COLUMN workspace_id TEXT",
    )?;
    ensure_column(
        conn,
        "conversations",
        "agent_kind",
        "ALTER TABLE conversations ADD COLUMN agent_kind TEXT NOT NULL DEFAULT 'lumina'",
    )?;
    ensure_column(
        conn,
        "conversations",
        "permission_mode",
        "ALTER TABLE conversations ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'edit'",
    )?;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Enum <-> TEXT helpers                                               */
/* ------------------------------------------------------------------ */

fn role_to_str(role: MessageRole) -> &'static str {
    match role {
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
        MessageRole::System => "system",
    }
}

fn role_from_str(raw: &str) -> MessageRole {
    match raw {
        "assistant" => MessageRole::Assistant,
        "system" => MessageRole::System,
        _ => MessageRole::User,
    }
}

fn status_to_str(status: MessageStatus) -> &'static str {
    match status {
        MessageStatus::Streaming => "streaming",
        MessageStatus::Complete => "complete",
        MessageStatus::Error => "error",
        MessageStatus::Cancelled => "cancelled",
    }
}

fn status_from_str(raw: &str) -> MessageStatus {
    match raw {
        "streaming" => MessageStatus::Streaming,
        "error" => MessageStatus::Error,
        "cancelled" => MessageStatus::Cancelled,
        _ => MessageStatus::Complete,
    }
}

fn artifact_kind_to_str(kind: &ArtifactKind) -> &'static str {
    match kind {
        ArtifactKind::Markdown => "markdown",
        ArtifactKind::Code => "code",
        ArtifactKind::Text => "text",
        ArtifactKind::Html => "html",
        ArtifactKind::Csv => "csv",
        ArtifactKind::Json => "json",
        ArtifactKind::Svg => "svg",
        ArtifactKind::Image => "image",
        ArtifactKind::Pdf => "pdf",
        ArtifactKind::Docx => "docx",
        ArtifactKind::Xlsx => "xlsx",
        ArtifactKind::Pptx => "pptx",
        ArtifactKind::Audio => "audio",
        ArtifactKind::Video => "video",
        ArtifactKind::Archive => "archive",
        ArtifactKind::Binary => "binary",
    }
}

fn artifact_kind_from_str(raw: &str) -> ArtifactKind {
    match raw {
        "markdown" => ArtifactKind::Markdown,
        "code" => ArtifactKind::Code,
        "text" => ArtifactKind::Text,
        "html" => ArtifactKind::Html,
        "csv" => ArtifactKind::Csv,
        "json" => ArtifactKind::Json,
        "svg" => ArtifactKind::Svg,
        "image" => ArtifactKind::Image,
        "pdf" => ArtifactKind::Pdf,
        "docx" => ArtifactKind::Docx,
        "xlsx" => ArtifactKind::Xlsx,
        "pptx" => ArtifactKind::Pptx,
        "audio" => ArtifactKind::Audio,
        "video" => ArtifactKind::Video,
        "archive" => ArtifactKind::Archive,
        _ => ArtifactKind::Binary,
    }
}

/// `FileChangeKind` <-> TEXT do `file_journal.change_kind`.
fn file_change_kind_to_str(kind: FileChangeKind) -> &'static str {
    match kind {
        FileChangeKind::Created => "created",
        FileChangeKind::Modified => "modified",
        FileChangeKind::Deleted => "deleted",
        FileChangeKind::Renamed => "renamed",
    }
}

fn file_change_kind_from_str(raw: &str) -> FileChangeKind {
    match raw.trim().to_ascii_lowercase().as_str() {
        "created" => FileChangeKind::Created,
        "deleted" => FileChangeKind::Deleted,
        "renamed" => FileChangeKind::Renamed,
        _ => FileChangeKind::Modified,
    }
}

/// `ApprovalDecision` <-> TEXT de `approval_rules.decision`. Valor desconhecido
/// cai em `Denied` (regra persistida nunca vira permissão por engano).
fn approval_decision_from_str(raw: &str) -> ApprovalDecision {
    match raw.trim().to_ascii_lowercase().as_str() {
        "approved" => ApprovalDecision::Approved,
        "cancelled" => ApprovalDecision::Cancelled,
        "expired" => ApprovalDecision::Expired,
        _ => ApprovalDecision::Denied,
    }
}

/// True when the error is a SQLite constraint violation (path de workspace
/// duplicado, id repetido, …), usado para devolver mensagens amigáveis.
fn is_constraint_violation(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(inner, _)
            if inner.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

/* ------------------------------------------------------------------ */
/* Small value helpers                                                 */
/* ------------------------------------------------------------------ */

/// ~120 characters of the first user text, used by the sidebar preview.
fn preview_from_text(content: &str) -> Option<String> {
    let collapsed = content.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        None
    } else {
        Some(collapsed.chars().take(120).collect())
    }
}

/// Escape `LIKE` wildcards so user input is matched literally.
fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn u32_from_db(value: Option<i64>) -> Option<u32> {
    value.and_then(|v| u32::try_from(v).ok())
}

/* ------------------------------------------------------------------ */
/* Row mappers                                                         */
/* ------------------------------------------------------------------ */

fn conversation_from_row(row: &Row<'_>) -> rusqlite::Result<Conversation> {
    let permission_mode: String = row.get(13)?;
    Ok(Conversation {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        pinned: row.get::<_, i64>(4)? != 0,
        provider_id: row.get(5)?,
        model_id: row.get(6)?,
        message_count: row.get(7)?,
        preview: row.get(8)?,
        mode: row.get(9)?,
        code_linked: row.get::<_, i64>(10)? != 0,
        // Sessões do harness de código. A migração aditiva preenche os bancos
        // legados com NULL/'lumina'/'edit'; o Chat ignora os três campos.
        workspace_id: row.get(11)?,
        agent_kind: row.get(12)?,
        permission_mode: PermissionMode::from_str(&permission_mode),
    })
}

fn workspace_from_row(row: &Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        last_opened_at: row.get(5)?,
        pinned: row.get::<_, i64>(6)? != 0,
        trusted: row.get::<_, i64>(7)? != 0,
        // `git` é detectado em memória pelo módulo `workspace`; não é coluna.
        git: None,
    })
}

fn code_event_from_row(row: &Row<'_>) -> rusqlite::Result<StoredCodeEvent> {
    Ok(StoredCodeEvent {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        turn_id: row.get(2)?,
        seq: row.get(3)?,
        kind: row.get(4)?,
        payload: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn file_journal_from_row(row: &Row<'_>) -> rusqlite::Result<FileJournalEntry> {
    let change_kind: String = row.get(4)?;
    Ok(FileJournalEntry {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        turn_id: row.get(2)?,
        path: row.get(3)?,
        change_kind: file_change_kind_from_str(&change_kind),
        before_hash: row.get(5)?,
        after_hash: row.get(6)?,
        added: u32_from_db(row.get(7)?),
        removed: u32_from_db(row.get(8)?),
        created_at: row.get(9)?,
    })
}

fn session_summary_from_row(row: &Row<'_>) -> rusqlite::Result<SessionSummary> {
    Ok(SessionSummary {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        from_seq: row.get(2)?,
        to_seq: row.get(3)?,
        content: row.get(4)?,
        tokens: u32_from_db(row.get(5)?),
        created_at: row.get(6)?,
    })
}

fn approval_rule_from_row(row: &Row<'_>) -> rusqlite::Result<ApprovalRule> {
    let scope: String = row.get(1)?;
    let decision: String = row.get(6)?;
    Ok(ApprovalRule {
        id: row.get(0)?,
        scope: ApprovalScope::from_str(&scope),
        scope_id: row.get(2)?,
        tool: row.get(3)?,
        matcher: row.get(4)?,
        pattern: row.get(5)?,
        decision: approval_decision_from_str(&decision),
        created_at: row.get(7)?,
    })
}

fn message_from_row(row: &Row<'_>) -> rusqlite::Result<ChatMessage> {
    let role: String = row.get(2)?;
    let status: String = row.get(5)?;
    let tool_calls: String = row.get(6)?;
    let citations: String = row.get(7)?;
    let attachments: String = row.get(8)?;
    Ok(ChatMessage {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        role: role_from_str(&role),
        content: row.get(3)?,
        reasoning: row.get(4)?,
        status: status_from_str(&status),
        tool_calls: decode_json(&tool_calls),
        citations: decode_json(&citations),
        attachments: decode_json(&attachments),
        model_id: row.get(9)?,
        provider_id: row.get(10)?,
        usage: decode_opt::<UsageInfo>(row.get(11)?),
        created_at: row.get(13)?,
        provider_state: decode_opt_value(row.get(12)?),
        trace: decode_json(&row.get::<_, String>(14)?),
    })
}

fn attachment_from_row(row: &Row<'_>) -> rusqlite::Result<StoredAttachment> {
    Ok(StoredAttachment {
        id: row.get(0)?,
        name: row.get(1)?,
        mime_type: row.get(2)?,
        size: row.get(3)?,
        kind: row.get(4)?,
        text: row.get(5)?,
        page_count: u32_from_db(row.get(6)?),
        width: u32_from_db(row.get(7)?),
        height: u32_from_db(row.get(8)?),
        file_path: row.get(9)?,
        created_at: row.get(10)?,
    })
}

fn artifact_from_row(row: &Row<'_>) -> rusqlite::Result<Artifact> {
    let kind: String = row.get(5)?;
    Ok(Artifact {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        message_id: row.get(2)?,
        name: row.get(3)?,
        mime_type: row.get(4)?,
        kind: artifact_kind_from_str(&kind),
        language: row.get(6)?,
        size: row.get(7)?,
        created_at: row.get(8)?,
        favorite: row.get::<_, i64>(9)? != 0,
    })
}

/// Lê um artefato pela PK com a conexão já travada (usado pelos updates que
/// devolvem o registro atualizado).
fn artifact_by_id(conn: &Connection, id: &str) -> anyhow::Result<Option<Artifact>> {
    let sql = format!("SELECT {ARTIFACT_COLUMNS} FROM artifacts WHERE id = ?1");
    conn.query_row(&sql, [id], |row| artifact_from_row(row))
        .optional()
        .context("falha ao ler artefato")
}

/* ------------------------------------------------------------------ */
/* Message persistence helpers                                         */
/* ------------------------------------------------------------------ */

struct MessageColumns {
    tool_calls: String,
    citations: String,
    attachments: String,
    usage: Option<String>,
    provider_state: Option<String>,
    trace: String,
}

fn serialize_message(message: &ChatMessage) -> Result<MessageColumns> {
    Ok(MessageColumns {
        tool_calls: encode_json(&message.tool_calls)?,
        citations: encode_json(&message.citations)?,
        attachments: encode_json(&message.attachments)?,
        usage: message.usage.as_ref().map(encode_json).transpose()?,
        provider_state: message
            .provider_state
            .as_ref()
            .map(encode_json)
            .transpose()?,
        trace: encode_json(&message.trace)?,
    })
}

fn insert_message_row(
    conn: &Connection,
    message: &ChatMessage,
    cols: &MessageColumns,
) -> Result<()> {
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, reasoning, status, \
         tool_calls, citations, attachments, model_id, provider_id, usage, provider_state, \
         created_at, trace) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            &message.id,
            &message.conversation_id,
            role_to_str(message.role),
            &message.content,
            &message.reasoning,
            status_to_str(message.status),
            &cols.tool_calls,
            &cols.citations,
            &cols.attachments,
            &message.model_id,
            &message.provider_id,
            &cols.usage,
            &cols.provider_state,
            message.created_at,
            &cols.trace,
        ],
    )
    .with_context(|| format!("falha ao inserir mensagem {}", message.id))?;
    Ok(())
}

fn update_message_row(
    conn: &Connection,
    message: &ChatMessage,
    cols: &MessageColumns,
) -> Result<usize> {
    let changed = conn
        .execute(
            "UPDATE messages SET role = ?2, content = ?3, reasoning = ?4, status = ?5, \
             tool_calls = ?6, citations = ?7, attachments = ?8, model_id = ?9, \
             provider_id = ?10, usage = ?11, provider_state = ?12, created_at = ?13, \
             trace = ?14 \
             WHERE id = ?1",
            params![
                &message.id,
                role_to_str(message.role),
                &message.content,
                &message.reasoning,
                status_to_str(message.status),
                &cols.tool_calls,
                &cols.citations,
                &cols.attachments,
                &message.model_id,
                &message.provider_id,
                &cols.usage,
                &cols.provider_state,
                message.created_at,
                &cols.trace,
            ],
        )
        .with_context(|| format!("falha ao atualizar mensagem {}", message.id))?;
    Ok(changed)
}

/// Recomputes `message_count`, `updated_at` and `preview` for a conversation.
fn refresh_conversation_stats(conn: &Connection, conversation_id: &str) -> Result<()> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1",
            [conversation_id],
            |row| row.get(0),
        )
        .context("falha ao contar mensagens da conversa")?;
    let first_user_text: Option<String> = conn
        .query_row(
            "SELECT content FROM messages WHERE conversation_id = ?1 AND role = 'user' \
             AND TRIM(content) <> '' ORDER BY created_at, id LIMIT 1",
            [conversation_id],
            |row| row.get(0),
        )
        .optional()
        .context("falha ao ler a prévia da conversa")?;
    let preview = first_user_text.as_deref().and_then(preview_from_text);
    conn.execute(
        "UPDATE conversations SET message_count = ?2, updated_at = ?3, preview = ?4 \
         WHERE id = ?1",
        params![conversation_id, count, now_ms(), preview],
    )
    .context("falha ao atualizar estatísticas da conversa")?;
    Ok(())
}

/// Best-effort removal of an artifact file and its `<artifact-id>` folder.
/// Only directories that look like `.../artifacts/<id>` are removed.
pub(crate) fn remove_artifact_files(artifact_id: &str, path: &str) {
    let artifact_path = Path::new(path);
    let removed = std::fs::remove_file(artifact_path).is_ok();
    if !removed {
        return;
    }
    let Some(parent) = artifact_path.parent() else {
        return;
    };
    let looks_like_artifact_dir = parent
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name == artifact_id)
        .unwrap_or(false)
        && artifact_path
            .components()
            .any(|part| part.as_os_str() == "artifacts");
    if looks_like_artifact_dir {
        let _ = std::fs::remove_dir_all(parent);
    }
}

/* ------------------------------------------------------------------ */
/* Db                                                                  */
/* ------------------------------------------------------------------ */

pub struct Db {
    conn: parking_lot::Mutex<rusqlite::Connection>,
}

impl Db {
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).with_context(|| {
                    format!("falha ao criar diretório do banco: {}", parent.display())
                })?;
            }
        }
        let conn = Connection::open(path)
            .with_context(|| format!("falha ao abrir banco de dados: {}", path.display()))?;
        Self::init_connection(&conn)?;
        Ok(Self {
            conn: parking_lot::Mutex::new(conn),
        })
    }

    fn init_connection(conn: &Connection) -> Result<()> {
        conn.execute_batch(PRAGMAS)
            .context("falha ao configurar o SQLite (WAL/foreign keys)")?;
        conn.execute_batch(SCHEMA)
            .context("falha ao aplicar o schema do banco")?;
        // Databases created before the agent trace existed get the column on
        // open; new databases already have it from `SCHEMA`.
        ensure_column(
            conn,
            "messages",
            "trace",
            "ALTER TABLE messages ADD COLUMN trace TEXT NOT NULL DEFAULT '[]'",
        )?;
        // Separação Chat/Code: conversas antigas viram mode='chat', sem vínculo.
        migrate_conversations_schema(conn)?;
        // Biblioteca: `favorite` + `conversation_id` nullable (uploads do usuário).
        migrate_artifacts_schema(conn)?;
        Ok(())
    }

    #[cfg(test)]
    pub fn open_in_memory() -> anyhow::Result<Self> {
        let conn = Connection::open_in_memory().context("falha ao abrir SQLite em memória")?;
        Self::init_connection(&conn)?;
        Ok(Self {
            conn: parking_lot::Mutex::new(conn),
        })
    }

    /* ---------------- conversations ---------------- */

    pub fn list_conversations(&self) -> anyhow::Result<Vec<Conversation>> {
        let conn = self.conn.lock();
        let sql = format!(
            "SELECT {CONVERSATION_COLUMNS} FROM conversations \
             ORDER BY pinned DESC, updated_at DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| conversation_from_row(row))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar conversas")
    }

    /// Cria uma conversa no layout padrão (Chat). Mantido como wrapper para os
    /// chamadores existentes (harness, tools e testes) — o modo explícito usa
    /// [`Db::create_conversation_with_mode`].
    pub fn create_conversation(
        &self,
        title: &str,
        provider_id: &str,
        model_id: &str,
    ) -> anyhow::Result<Conversation> {
        self.create_conversation_with_mode(title, provider_id, model_id, CONVERSATION_MODE_CHAT)
    }

    /// Cria uma conversa no layout `mode` (`"chat"` | `"code"`; qualquer outro
    /// valor, inclusive vazio, cai em `"chat"`). Sessões novas nunca nascem
    /// compartilhadas com o outro layout (`code_linked = 0`).
    pub fn create_conversation_with_mode(
        &self,
        title: &str,
        provider_id: &str,
        model_id: &str,
        mode: &str,
    ) -> anyhow::Result<Conversation> {
        let mode = conversation_mode_or_default(Some(mode));
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        let title = title.trim();
        let title = if title.is_empty() {
            "Nova conversa"
        } else {
            title
        };
        {
            let conn = self.conn.lock();
            conn.execute(
                "INSERT INTO conversations (id, title, created_at, updated_at, pinned, \
                 provider_id, model_id, message_count, preview, mode, code_linked) \
                 VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, 0, NULL, ?7, 0)",
                params![&id, title, now, now, provider_id, model_id, &mode],
            )
            .context("falha ao criar conversa")?;
        }
        self.get_conversation(&id)?
            .ok_or_else(|| anyhow::anyhow!("conversa recém-criada não encontrada"))
    }

    /// Compartilha (`linked = true`) ou remove o vínculo de uma sessão do Chat
    /// com o layout Code. Só sessões `mode == "chat"` podem ser compartilhadas:
    /// uma conversa criada no Code pertence somente ao Code.
    pub fn set_conversation_code_linked(
        &self,
        id: &str,
        linked: bool,
    ) -> anyhow::Result<Conversation> {
        let conversation = self
            .get_conversation(id)?
            .ok_or_else(|| anyhow::anyhow!("conversa não encontrada: {id}"))?;
        if conversation.mode != CONVERSATION_MODE_CHAT {
            return Err(anyhow::anyhow!(
                "somente sessões do Chat podem ser compartilhadas com o Code"
            ));
        }
        {
            let conn = self.conn.lock();
            conn.execute(
                "UPDATE conversations SET code_linked = ?2 WHERE id = ?1",
                params![id, if linked { 1i64 } else { 0i64 }],
            )
            .context("falha ao atualizar o vínculo da conversa com o Code")?;
        }
        self.get_conversation(id)?
            .ok_or_else(|| anyhow::anyhow!("conversa não encontrada: {id}"))
    }

    pub fn get_conversation(&self, id: &str) -> anyhow::Result<Option<Conversation>> {
        let conn = self.conn.lock();
        let sql = format!("SELECT {CONVERSATION_COLUMNS} FROM conversations WHERE id = ?1");
        conn.query_row(&sql, [id], |row| conversation_from_row(row))
            .optional()
            .context("falha ao ler conversa")
    }

    pub fn get_conversation_detail(&self, id: &str) -> anyhow::Result<Option<ConversationDetail>> {
        let Some(conversation) = self.get_conversation(id)? else {
            return Ok(None);
        };
        let messages = self.list_messages(id)?;
        Ok(Some(ConversationDetail {
            conversation,
            messages,
        }))
    }

    pub fn rename_conversation(&self, id: &str, title: &str) -> anyhow::Result<()> {
        let title = title.trim();
        let title = if title.is_empty() {
            "Nova conversa"
        } else {
            title
        };
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE conversations SET title = ?2 WHERE id = ?1",
            params![id, title],
        )
        .context("falha ao renomear conversa")?;
        Ok(())
    }

    pub fn delete_conversation(&self, id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        let artifact_paths: Vec<(String, String)> = {
            let mut stmt =
                conn.prepare("SELECT id, path FROM artifacts WHERE conversation_id = ?1")?;
            let rows = stmt.query_map([id], |row| Ok((row.get(0)?, row.get(1)?)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        {
            let tx = conn.unchecked_transaction()?;
            tx.execute("DELETE FROM messages WHERE conversation_id = ?1", [id])?;
            tx.execute("DELETE FROM artifacts WHERE conversation_id = ?1", [id])?;
            // Trilha/journal/resumos da sessão de código.
            tx.execute("DELETE FROM code_events WHERE conversation_id = ?1", [id])?;
            tx.execute("DELETE FROM file_journal WHERE conversation_id = ?1", [id])?;
            tx.execute("DELETE FROM session_summaries WHERE conversation_id = ?1", [id])?;
            // Regras "sempre permitir/negar" com escopo de sessão.
            tx.execute(
                "DELETE FROM approval_rules WHERE scope = 'session' AND scope_id = ?1",
                [id],
            )?;
            tx.execute("DELETE FROM conversations WHERE id = ?1", [id])?;
            tx.commit()?;
        }
        drop(conn);
        for (artifact_id, path) in artifact_paths {
            remove_artifact_files(&artifact_id, &path);
        }
        Ok(())
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE conversations SET pinned = ?2 WHERE id = ?1",
            params![id, if pinned { 1i64 } else { 0i64 }],
        )
        .context("falha ao fixar/desafixar conversa")?;
        Ok(())
    }

    pub fn search_conversations(&self, query: &str) -> anyhow::Result<Vec<Conversation>> {
        let query = query.trim();
        if query.is_empty() {
            return self.list_conversations();
        }
        let pattern = like_pattern(query);
        let conn = self.conn.lock();
        let sql = format!(
            "SELECT DISTINCT c.id, c.title, c.created_at, c.updated_at, c.pinned, \
             c.provider_id, c.model_id, c.message_count, c.preview, c.mode, c.code_linked, \
             c.workspace_id, c.agent_kind, c.permission_mode \
             FROM conversations c \
             LEFT JOIN messages m ON m.conversation_id = c.id \
             WHERE c.title LIKE ?1 ESCAPE '\\' OR m.content LIKE ?1 ESCAPE '\\' \
             ORDER BY c.pinned DESC, c.updated_at DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([&pattern], |row| conversation_from_row(row))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao buscar conversas")
    }

    pub fn touch_conversation(&self, id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE conversations SET updated_at = ?2 WHERE id = ?1",
            params![id, now_ms()],
        )
        .context("falha ao atualizar a data da conversa")?;
        Ok(())
    }

    pub fn update_conversation_model(
        &self,
        id: &str,
        provider_id: &str,
        model_id: &str,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE conversations SET provider_id = ?2, model_id = ?3, updated_at = ?4 \
             WHERE id = ?1",
            params![id, provider_id, model_id, now_ms()],
        )
        .context("falha ao atualizar o modelo da conversa")?;
        Ok(())
    }

    /* ---------------- harness de código: workspaces ---------------- */

    /// Cria um workspace; o caminho é único (o mesmo diretório não entra duas
    /// vezes). `git` não é persistido — é detectado em memória pelo módulo
    /// `workspace`.
    pub fn create_workspace(&self, name: &str, path: &str) -> anyhow::Result<Workspace> {
        let path = path.trim();
        if path.is_empty() {
            return Err(anyhow::anyhow!("o caminho do workspace não pode ser vazio"));
        }
        let name = name.trim();
        let name = if name.is_empty() {
            path.to_string()
        } else {
            name.to_string()
        };
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        {
            let conn = self.conn.lock();
            if let Err(error) = conn.execute(
                "INSERT INTO workspaces \
                 (id, name, path, created_at, updated_at, last_opened_at, pinned, trusted) \
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, 0, 0)",
                params![&id, &name, path, now, now],
            ) {
                if is_constraint_violation(&error) {
                    return Err(anyhow::anyhow!(
                        "já existe um workspace para o caminho `{path}`"
                    ));
                }
                return Err(error).context("falha ao criar workspace");
            }
        }
        self.get_workspace(&id)?
            .ok_or_else(|| anyhow::anyhow!("workspace recém-criado não encontrado"))
    }

    pub fn get_workspace(&self, id: &str) -> anyhow::Result<Option<Workspace>> {
        let conn = self.conn.lock();
        let sql = format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?1");
        conn.query_row(&sql, [id], workspace_from_row)
            .optional()
            .context("falha ao ler workspace")
    }

    pub fn find_workspace_by_path(&self, path: &str) -> anyhow::Result<Option<Workspace>> {
        let conn = self.conn.lock();
        let sql = format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE path = ?1");
        conn.query_row(&sql, [path.trim()], workspace_from_row)
            .optional()
            .context("falha ao buscar workspace pelo caminho")
    }

    /// Lista na ordem da sidebar: fixados primeiro, depois os abertos mais
    /// recentemente, depois os atualizados mais recentemente.
    pub fn list_workspaces(&self) -> anyhow::Result<Vec<Workspace>> {
        let conn = self.conn.lock();
        let sql = format!(
            "SELECT {WORKSPACE_COLUMNS} FROM workspaces \
             ORDER BY pinned DESC, COALESCE(last_opened_at, 0) DESC, \
             name COLLATE NOCASE ASC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| workspace_from_row(row))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar workspaces")
    }

    /// Atualiza os metadados editáveis do workspace (nome, caminho, fixado,
    /// confiável e último acesso). Use [`Db::touch_workspace`] /
    /// [`Db::mark_workspace_opened`] para os carimbos de tempo.
    pub fn update_workspace(&self, workspace: &Workspace) -> anyhow::Result<()> {
        let name = workspace.name.trim();
        let path = workspace.path.trim();
        if path.is_empty() {
            return Err(anyhow::anyhow!("o caminho do workspace não pode ser vazio"));
        }
        let conn = self.conn.lock();
        let changed = match conn.execute(
            "UPDATE workspaces SET name = ?2, path = ?3, pinned = ?4, trusted = ?5, \
             last_opened_at = ?6, updated_at = ?7 WHERE id = ?1",
            params![
                &workspace.id,
                name,
                path,
                if workspace.pinned { 1i64 } else { 0i64 },
                if workspace.trusted { 1i64 } else { 0i64 },
                workspace.last_opened_at,
                now_ms(),
            ],
        ) {
            Ok(changed) => changed,
            Err(error) if is_constraint_violation(&error) => {
                return Err(anyhow::anyhow!(
                    "já existe um workspace para o caminho `{path}`"
                ));
            }
            Err(error) => return Err(error).context("falha ao atualizar workspace"),
        };
        if changed == 0 {
            return Err(anyhow::anyhow!("workspace não encontrado: {}", workspace.id));
        }
        Ok(())
    }

    pub fn touch_workspace(&self, id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE workspaces SET updated_at = ?2 WHERE id = ?1",
            params![id, now_ms()],
        )
        .context("falha ao atualizar a data do workspace")?;
        Ok(())
    }

    /// Marca o workspace como aberto agora (ordena a sidebar).
    pub fn mark_workspace_opened(&self, id: &str) -> anyhow::Result<()> {
        let now = now_ms();
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE workspaces SET last_opened_at = ?2, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )
        .context("falha ao marcar o workspace como aberto")?;
        Ok(())
    }

    pub fn set_workspace_pinned(&self, id: &str, pinned: bool) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE workspaces SET pinned = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, if pinned { 1i64 } else { 0i64 }, now_ms()],
        )
        .context("falha ao fixar/desafixar workspace")?;
        Ok(())
    }

    /// Marca a pasta como confiável ("Confiar nesta pasta") ou revoga.
    pub fn set_workspace_trusted(&self, id: &str, trusted: bool) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE workspaces SET trusted = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, if trusted { 1i64 } else { 0i64 }, now_ms()],
        )
        .context("falha ao alterar a confiança do workspace")?;
        Ok(())
    }

    /// Remove o workspace. As sessões sobrevivem (ficam sem workspace) e as
    /// regras de aprovação com escopo de workspace são apagadas junto.
    /// Devolve `true` quando havia um workspace para remover.
    pub fn delete_workspace(&self, id: &str) -> anyhow::Result<bool> {
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE conversations SET workspace_id = NULL WHERE workspace_id = ?1",
            [id],
        )
        .context("falha ao desvincular as sessões do workspace")?;
        tx.execute(
            "DELETE FROM approval_rules WHERE scope = 'workspace' AND scope_id = ?1",
            [id],
        )
        .context("falha ao apagar as regras do workspace")?;
        let removed = tx
            .execute("DELETE FROM workspaces WHERE id = ?1", [id])
            .context("falha ao remover o workspace")?;
        tx.commit()?;
        Ok(removed > 0)
    }

    /// Sessões de código de um workspace (ordem da sidebar).
    pub fn list_conversations_for_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<Conversation>> {
        let conn = self.conn.lock();
        let sql = format!(
            "SELECT {CONVERSATION_COLUMNS} FROM conversations WHERE workspace_id = ?1 \
             ORDER BY pinned DESC, updated_at DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([workspace_id], |row| conversation_from_row(row))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar as sessões do workspace")
    }

    /* ---------------- harness de código: eventos ---------------- */

    /// Anexa um evento à trilha da conversa com `seq` monotônico (1, 2, 3…).
    /// A leitura/inserção roda numa transação, então dois appends concorrentes
    /// nunca repetem `seq` (há também um índice único como rede de segurança).
    pub fn append_code_event(
        &self,
        conversation_id: &str,
        turn_id: Option<&str>,
        kind: &str,
        payload: &str,
    ) -> anyhow::Result<StoredCodeEvent> {
        let kind = kind.trim();
        if kind.is_empty() {
            return Err(anyhow::anyhow!("o tipo do evento não pode ser vazio"));
        }
        let turn_id = turn_id.map(str::trim).filter(|value| !value.is_empty());
        let created_at = now_ms();
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction()?;
        let seq: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM code_events WHERE conversation_id = ?1",
                [conversation_id],
                |row| row.get(0),
            )
            .context("falha ao calcular o seq do evento")?;
        tx.execute(
            "INSERT INTO code_events (conversation_id, turn_id, seq, kind, payload, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![conversation_id, turn_id, seq, kind, payload, created_at],
        )
        .context("falha ao gravar o evento do agente")?;
        let id = tx.last_insert_rowid();
        tx.commit()?;
        Ok(StoredCodeEvent {
            id,
            conversation_id: conversation_id.to_string(),
            turn_id: turn_id.map(str::to_string),
            seq,
            kind: kind.to_string(),
            payload: payload.to_string(),
            created_at,
        })
    }

    /// Eventos da conversa a partir de `from_seq` **inclusive** (replay).
    pub fn list_code_events(
        &self,
        conversation_id: &str,
        from_seq: i64,
    ) -> anyhow::Result<Vec<StoredCodeEvent>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, turn_id, seq, kind, payload, created_at \
             FROM code_events WHERE conversation_id = ?1 AND seq >= ?2 ORDER BY seq ASC",
        )?;
        let rows = stmt.query_map(params![conversation_id, from_seq], |row| {
            code_event_from_row(row)
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar os eventos do agente")
    }

    /// Último evento de um `kind` (projeção de estado, ex.: plano/todos/uso).
    pub fn latest_code_event(
        &self,
        conversation_id: &str,
        kind: &str,
    ) -> anyhow::Result<Option<StoredCodeEvent>> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT id, conversation_id, turn_id, seq, kind, payload, created_at \
             FROM code_events WHERE conversation_id = ?1 AND kind = ?2 \
             ORDER BY seq DESC LIMIT 1",
            params![conversation_id, kind.trim()],
            |row| code_event_from_row(row),
        )
        .optional()
        .context("falha ao ler o último evento do agente")
    }

    /* ---------------- harness de código: journal ---------------- */

    /// Registra uma escrita/edição de arquivo feita pelo agente.
    /// Devolve o id da linha inserida.
    pub fn append_file_journal(&self, entry: &FileJournalEntry) -> anyhow::Result<i64> {
        let path = entry.path.trim();
        if path.is_empty() {
            return Err(anyhow::anyhow!("o caminho do arquivo não pode ser vazio"));
        }
        if entry.turn_id.trim().is_empty() {
            return Err(anyhow::anyhow!("o turno do journal não pode ser vazio"));
        }
        let created_at = if entry.created_at > 0 {
            entry.created_at
        } else {
            now_ms()
        };
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO file_journal \
             (conversation_id, turn_id, path, change_kind, before_hash, after_hash, added, \
              removed, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                &entry.conversation_id,
                entry.turn_id.trim(),
                path,
                file_change_kind_to_str(entry.change_kind),
                entry.before_hash,
                entry.after_hash,
                entry.added.map(i64::from),
                entry.removed.map(i64::from),
                created_at,
            ],
        )
        .context("falha ao gravar o journal de arquivos")?;
        Ok(conn.last_insert_rowid())
    }

    /// Journal de um turno (painel Alterações), em ordem cronológica.
    pub fn list_file_journal_for_turn(
        &self,
        conversation_id: &str,
        turn_id: &str,
    ) -> anyhow::Result<Vec<FileJournalEntry>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, turn_id, path, change_kind, before_hash, after_hash, \
             added, removed, created_at \
             FROM file_journal WHERE conversation_id = ?1 AND turn_id = ?2 ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![conversation_id, turn_id], |row| {
            file_journal_from_row(row)
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar o journal do turno")
    }

    /// Journal completo da sessão, em ordem cronológica.
    pub fn list_file_journal(
        &self,
        conversation_id: &str,
    ) -> anyhow::Result<Vec<FileJournalEntry>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, turn_id, path, change_kind, before_hash, after_hash, \
             added, removed, created_at \
             FROM file_journal WHERE conversation_id = ?1 ORDER BY id ASC",
        )?;
        let rows = stmt.query_map([conversation_id], |row| file_journal_from_row(row))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar o journal da sessão")
    }

    /* ---------------- harness de código: resumos ---------------- */

    /// Registra um resumo de compactação para a faixa `[from_seq, to_seq]`.
    pub fn insert_session_summary(
        &self,
        conversation_id: &str,
        from_seq: i64,
        to_seq: i64,
        content: &str,
        tokens: Option<u32>,
    ) -> anyhow::Result<SessionSummary> {
        if from_seq < 1 || to_seq < from_seq {
            return Err(anyhow::anyhow!(
                "faixa de compactação inválida: {from_seq}..{to_seq}"
            ));
        }
        let summary = SessionSummary {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_string(),
            from_seq,
            to_seq,
            content: content.to_string(),
            tokens,
            created_at: now_ms(),
        };
        {
            let conn = self.conn.lock();
            conn.execute(
                "INSERT INTO session_summaries \
                 (id, conversation_id, from_seq, to_seq, content, tokens, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    &summary.id,
                    &summary.conversation_id,
                    summary.from_seq,
                    summary.to_seq,
                    &summary.content,
                    summary.tokens.map(i64::from),
                    summary.created_at,
                ],
            )
            .context("falha ao gravar o resumo da sessão")?;
        }
        Ok(summary)
    }

    pub fn list_session_summaries(
        &self,
        conversation_id: &str,
    ) -> anyhow::Result<Vec<SessionSummary>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, from_seq, to_seq, content, tokens, created_at \
             FROM session_summaries WHERE conversation_id = ?1 ORDER BY from_seq ASC, created_at ASC",
        )?;
        let rows = stmt.query_map([conversation_id], |row| session_summary_from_row(row))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar os resumos da sessão")
    }

    /// Resumo mais recente (maior `to_seq`), usado para montar o contexto.
    pub fn latest_session_summary(
        &self,
        conversation_id: &str,
    ) -> anyhow::Result<Option<SessionSummary>> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT id, conversation_id, from_seq, to_seq, content, tokens, created_at \
             FROM session_summaries WHERE conversation_id = ?1 \
             ORDER BY to_seq DESC, created_at DESC LIMIT 1",
            [conversation_id],
            |row| session_summary_from_row(row),
        )
        .optional()
        .context("falha ao ler o resumo mais recente da sessão")
    }

    /* ---------------- harness de código: regras de aprovação ---------------- */

    /// Persiste uma regra já montada (id/created_at fornecidos pelo chamador).
    pub fn insert_approval_rule(&self, rule: &ApprovalRule) -> anyhow::Result<()> {
        if rule.tool.trim().is_empty() {
            return Err(anyhow::anyhow!("a regra precisa de uma ferramenta"));
        }
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO approval_rules \
             (id, scope, scope_id, tool, matcher, pattern, decision, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &rule.id,
                rule.scope.as_str(),
                rule.scope_id,
                rule.tool.trim(),
                rule.matcher.trim(),
                rule.pattern.trim(),
                rule.decision.as_str(),
                rule.created_at,
            ],
        )
        .context("falha ao gravar a regra de aprovação")?;
        Ok(())
    }

    /// Cria a regra gerando `id`/`created_at` (caminho usado pelos comandos).
    pub fn create_approval_rule(
        &self,
        spec: &NewApprovalRule<'_>,
    ) -> anyhow::Result<ApprovalRule> {
        let tool = spec.tool.trim();
        if tool.is_empty() {
            return Err(anyhow::anyhow!("a regra precisa de uma ferramenta"));
        }
        let matcher = spec.matcher.trim();
        if matcher.is_empty() {
            return Err(anyhow::anyhow!("a regra precisa de um matcher"));
        }
        let rule = ApprovalRule {
            id: uuid::Uuid::new_v4().to_string(),
            scope: spec.scope,
            scope_id: spec.scope_id.map(str::to_string),
            tool: tool.to_string(),
            matcher: matcher.to_string(),
            pattern: spec.pattern.trim().to_string(),
            decision: spec.decision,
            created_at: now_ms(),
        };
        self.insert_approval_rule(&rule)?;
        Ok(rule)
    }

    pub fn list_approval_rules(&self) -> anyhow::Result<Vec<ApprovalRule>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, scope, scope_id, tool, matcher, pattern, decision, created_at \
             FROM approval_rules ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |row| approval_rule_from_row(row))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar as regras de aprovação")
    }

    /// Regras de um escopo exato (`scope_id` `None` casa com NULL).
    pub fn list_approval_rules_for_scope(
        &self,
        scope: ApprovalScope,
        scope_id: Option<&str>,
    ) -> anyhow::Result<Vec<ApprovalRule>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, scope, scope_id, tool, matcher, pattern, decision, created_at \
             FROM approval_rules WHERE scope = ?1 AND scope_id IS ?2 \
             ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![scope.as_str(), scope_id], |row| {
            approval_rule_from_row(row)
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar as regras do escopo")
    }

    /// Regras que valem para uma sessão: globais + as da sessão + as do
    /// workspace dela (insumo direto da política de permissões).
    pub fn list_approval_rules_for_context(
        &self,
        conversation_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> anyhow::Result<Vec<ApprovalRule>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, scope, scope_id, tool, matcher, pattern, decision, created_at \
             FROM approval_rules \
             WHERE scope = 'global' \
                OR (scope = 'session' AND scope_id = ?1) \
                OR (scope = 'workspace' AND scope_id = ?2) \
             ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![conversation_id, workspace_id], |row| {
            approval_rule_from_row(row)
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar as regras de aprovação aplicáveis")
    }

    /// Devolve `true` quando existia uma regra com o id.
    pub fn delete_approval_rule(&self, id: &str) -> anyhow::Result<bool> {
        let conn = self.conn.lock();
        let removed = conn
            .execute("DELETE FROM approval_rules WHERE id = ?1", [id])
            .context("falha ao remover a regra de aprovação")?;
        Ok(removed > 0)
    }

    pub fn delete_approval_rules_for_scope(
        &self,
        scope: ApprovalScope,
        scope_id: Option<&str>,
    ) -> anyhow::Result<usize> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM approval_rules WHERE scope = ?1 AND scope_id IS ?2",
            params![scope.as_str(), scope_id],
        )
        .context("falha ao remover as regras do escopo")
    }

    /* ---------------- harness de código: sessão ---------------- */

    /// Associa (ou desassocia, com `None`) a sessão a um workspace. O workspace
    /// precisa existir; a conversa também (erro claro em ambos os casos).
    pub fn set_conversation_workspace(
        &self,
        id: &str,
        workspace_id: Option<&str>,
    ) -> anyhow::Result<()> {
        if let Some(workspace_id) = workspace_id {
            if self.get_workspace(workspace_id)?.is_none() {
                return Err(anyhow::anyhow!(
                    "workspace não encontrado: {workspace_id}"
                ));
            }
        }
        let conn = self.conn.lock();
        let changed = conn
            .execute(
                "UPDATE conversations SET workspace_id = ?2 WHERE id = ?1",
                params![id, workspace_id],
            )
            .context("falha ao associar a sessão ao workspace")?;
        if changed == 0 {
            return Err(anyhow::anyhow!("conversa não encontrada: {id}"));
        }
        Ok(())
    }

    pub fn clear_conversation_workspace(&self, id: &str) -> anyhow::Result<()> {
        self.set_conversation_workspace(id, None)
    }

    /// Define o motor do agente da sessão (`lumina` hoje). Vazio é rejeitado.
    pub fn set_conversation_agent_kind(&self, id: &str, agent_kind: &str) -> anyhow::Result<()> {
        let agent_kind = agent_kind.trim();
        if agent_kind.is_empty() {
            return Err(anyhow::anyhow!("o motor do agente não pode ser vazio"));
        }
        let conn = self.conn.lock();
        let changed = conn
            .execute(
                "UPDATE conversations SET agent_kind = ?2 WHERE id = ?1",
                params![id, agent_kind],
            )
            .context("falha ao atualizar o motor do agente")?;
        if changed == 0 {
            return Err(anyhow::anyhow!("conversa não encontrada: {id}"));
        }
        Ok(())
    }

    pub fn set_conversation_permission_mode(
        &self,
        id: &str,
        mode: PermissionMode,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        let changed = conn
            .execute(
                "UPDATE conversations SET permission_mode = ?2 WHERE id = ?1",
                params![id, mode.as_str()],
            )
            .context("falha ao atualizar o modo de permissão da sessão")?;
        if changed == 0 {
            return Err(anyhow::anyhow!("conversa não encontrada: {id}"));
        }
        Ok(())
    }

    pub fn get_conversation_permission_mode(
        &self,
        id: &str,
    ) -> anyhow::Result<Option<PermissionMode>> {
        let conn = self.conn.lock();
        let raw: Option<String> = conn
            .query_row(
                "SELECT permission_mode FROM conversations WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .context("falha ao ler o modo de permissão da sessão")?;
        Ok(raw.map(|value| PermissionMode::from_str(&value)))
    }

    /* ---------------- messages ---------------- */

    pub fn list_messages(&self, conversation_id: &str) -> anyhow::Result<Vec<ChatMessage>> {
        let conn = self.conn.lock();
        let sql = format!(
            "SELECT {MESSAGE_COLUMNS} FROM messages WHERE conversation_id = ?1 \
             ORDER BY created_at, id"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([conversation_id], |row| message_from_row(row))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar mensagens")
    }

    // Somente os testes de persistência leem mensagens individuais; a produção não usa.
    #[cfg(test)]
    pub fn get_message(&self, id: &str) -> anyhow::Result<Option<ChatMessage>> {
        let conn = self.conn.lock();
        let sql = format!("SELECT {MESSAGE_COLUMNS} FROM messages WHERE id = ?1");
        conn.query_row(&sql, [id], |row| message_from_row(row))
            .optional()
            .context("falha ao ler mensagem")
    }

    pub fn insert_message(&self, message: &ChatMessage) -> anyhow::Result<()> {
        let cols = serialize_message(message)?;
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction()?;
        insert_message_row(&tx, message, &cols)?;
        refresh_conversation_stats(&tx, &message.conversation_id)?;
        tx.commit()?;
        Ok(())
    }

    pub fn update_message(&self, message: &ChatMessage) -> anyhow::Result<()> {
        let cols = serialize_message(message)?;
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction()?;
        let changed = update_message_row(&tx, message, &cols)?;
        if changed == 0 {
            // Self-heal: the harness may persist a message it never inserted.
            insert_message_row(&tx, message, &cols)?;
        }
        refresh_conversation_stats(&tx, &message.conversation_id)?;
        tx.commit()?;
        Ok(())
    }

    /// Deletes `message_id` and every message after it (used by edit/regenerate).
    pub fn delete_messages_from(
        &self,
        conversation_id: &str,
        message_id: &str,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction()?;
        let target_created_at: Option<i64> = tx
            .query_row(
                "SELECT created_at FROM messages WHERE id = ?1 AND conversation_id = ?2",
                params![message_id, conversation_id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(created_at) = target_created_at {
            tx.execute(
                "DELETE FROM messages WHERE conversation_id = ?1 \
                 AND (created_at > ?2 OR (created_at = ?2 AND id >= ?3))",
                params![conversation_id, created_at, message_id],
            )?;
            refresh_conversation_stats(&tx, conversation_id)?;
        }
        tx.commit()?;
        Ok(())
    }

    /* ---------------- attachments ---------------- */

    pub fn insert_attachment(&self, attachment: &StoredAttachment) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO attachments (id, name, mime_type, size, kind, text, page_count, \
             width, height, file_path, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                &attachment.id,
                &attachment.name,
                &attachment.mime_type,
                attachment.size,
                &attachment.kind,
                &attachment.text,
                attachment.page_count.map(i64::from),
                attachment.width.map(i64::from),
                attachment.height.map(i64::from),
                &attachment.file_path,
                attachment.created_at,
            ],
        )
        .with_context(|| format!("falha ao inserir anexo {}", attachment.id))?;
        Ok(())
    }

    pub fn get_attachment(&self, id: &str) -> anyhow::Result<Option<StoredAttachment>> {
        let conn = self.conn.lock();
        let sql = format!("SELECT {ATTACHMENT_COLUMNS} FROM attachments WHERE id = ?1");
        conn.query_row(&sql, [id], |row| attachment_from_row(row))
            .optional()
            .context("falha ao ler anexo")
    }

    pub fn delete_attachment(&self, id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM attachments WHERE id = ?1", [id])
            .context("falha ao remover anexo")?;
        Ok(())
    }

    /* ---------------- artifacts ---------------- */

    pub fn insert_artifact(&self, artifact: &StoredArtifact) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO artifacts (id, conversation_id, message_id, name, mime_type, kind, \
             language, size, created_at, path, favorite) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                &artifact.artifact.id,
                &artifact.artifact.conversation_id,
                &artifact.artifact.message_id,
                &artifact.artifact.name,
                &artifact.artifact.mime_type,
                artifact_kind_to_str(&artifact.artifact.kind),
                &artifact.artifact.language,
                artifact.artifact.size,
                artifact.artifact.created_at,
                &artifact.path,
                artifact.artifact.favorite as i64,
            ],
        )
        .with_context(|| format!("falha ao inserir artefato {}", artifact.artifact.id))?;
        Ok(())
    }

    pub fn list_artifacts(&self, conversation_id: &str) -> anyhow::Result<Vec<Artifact>> {
        let conn = self.conn.lock();
        let sql = format!(
            "SELECT {ARTIFACT_COLUMNS} FROM artifacts WHERE conversation_id = ?1 \
             ORDER BY created_at, id"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([conversation_id], |row| artifact_from_row(row))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar artefatos")
    }

    /// Todos os artefatos do usuário (todas as conversas), na ordem canônica de
    /// criação (`created_at, id`). É a fonte de verdade da biblioteca global do
    /// agente; o recorte por conversa continua em [`Db::list_artifacts`].
    pub fn list_all_artifacts(&self) -> anyhow::Result<Vec<Artifact>> {
        let conn = self.conn.lock();
        let sql = format!("SELECT {ARTIFACT_COLUMNS} FROM artifacts ORDER BY created_at, id");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| artifact_from_row(row))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar os artefatos")
    }

    /// Biblioteca do usuário: todos os artefatos (gerados em qualquer conversa
    /// **e** os enviados direto à biblioteca, `conversation_id IS NULL`), mais
    /// recentes primeiro, com o título da conversa de origem (`None` para
    /// uploads). Uma única query com `LEFT JOIN`.
    pub fn list_library_artifacts(&self) -> anyhow::Result<Vec<LibraryArtifact>> {
        let conn = self.conn.lock();
        let sql = format!(
            "SELECT {ARTIFACT_JOIN_COLUMNS}, c.title \
             FROM artifacts a LEFT JOIN conversations c ON c.id = a.conversation_id \
             ORDER BY a.created_at DESC, a.id DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            Ok(LibraryArtifact {
                artifact: artifact_from_row(row)?,
                conversation_title: row.get(10)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao listar a biblioteca de artefatos")
    }

    pub fn get_artifact(&self, id: &str) -> anyhow::Result<Option<StoredArtifact>> {
        let conn = self.conn.lock();
        let sql = format!("SELECT {ARTIFACT_COLUMNS}, path FROM artifacts WHERE id = ?1");
        conn.query_row(&sql, [id], |row| {
            Ok(StoredArtifact {
                artifact: artifact_from_row(row)?,
                path: row.get(10)?,
            })
        })
        .optional()
        .context("falha ao ler artefato")
    }

    pub fn delete_artifact(&self, id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM artifacts WHERE id = ?1", [id])
            .context("falha ao remover artefato")?;
        Ok(())
    }

    /// Marca/desmarca o favorito na Biblioteca e devolve o artefato atualizado.
    /// `None` quando o id não existe (o comando transforma em erro).
    pub fn set_artifact_favorite(
        &self,
        id: &str,
        favorite: bool,
    ) -> anyhow::Result<Option<Artifact>> {
        let conn = self.conn.lock();
        let changed = conn
            .execute(
                "UPDATE artifacts SET favorite = ?2 WHERE id = ?1",
                params![id, if favorite { 1i64 } else { 0i64 }],
            )
            .context("falha ao atualizar o favorito do artefato")?;
        if changed == 0 {
            return Ok(None);
        }
        artifact_by_id(&conn, id)
    }

    /// Atualiza os metadados de um artefato renomeado (o arquivo em disco é
    /// renomeado pelo comando). O `path` da linha é atualizado em
    /// [`Db::update_artifact_rename`], no mesmo UPDATE do rename — por isso o
    /// comando de produção usa o método combinado; este fica coberto pelos
    /// testes da API do banco.
    /// `None` quando o id não existe.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn update_artifact_metadata(
        &self,
        id: &str,
        name: &str,
        mime_type: &str,
        kind: ArtifactKind,
        language: Option<&str>,
    ) -> anyhow::Result<Option<Artifact>> {
        let conn = self.conn.lock();
        let changed = conn
            .execute(
                "UPDATE artifacts SET name = ?2, mime_type = ?3, kind = ?4, language = ?5 \
                 WHERE id = ?1",
                params![id, name, mime_type, artifact_kind_to_str(&kind), language],
            )
            .context("falha ao atualizar os metadados do artefato")?;
        if changed == 0 {
            return Ok(None);
        }
        artifact_by_id(&conn, id)
    }

    /// Rename: grava metadados **e** o novo caminho do arquivo em um único
    /// UPDATE (evita linha com path/metadados divergentes). `None` quando o id
    /// não existe.
    pub fn update_artifact_rename(
        &self,
        id: &str,
        name: &str,
        mime_type: &str,
        kind: ArtifactKind,
        language: Option<&str>,
        path: &str,
    ) -> anyhow::Result<Option<Artifact>> {
        let conn = self.conn.lock();
        let changed = conn
            .execute(
                "UPDATE artifacts SET name = ?2, mime_type = ?3, kind = ?4, language = ?5, \
                 path = ?6 WHERE id = ?1",
                params![id, name, mime_type, artifact_kind_to_str(&kind), language, path],
            )
            .context("falha ao renomear o artefato no banco")?;
        if changed == 0 {
            return Ok(None);
        }
        artifact_by_id(&conn, id)
    }

    /* ---------------- usage ---------------- */

    pub fn record_usage(
        &self,
        conversation_id: &str,
        message_id: &str,
        provider_id: &str,
        model_id: &str,
        usage: &UsageInfo,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO usage_log (conversation_id, message_id, provider_id, model_id, \
             input_tokens, output_tokens, reasoning_tokens, cached_tokens, total_tokens, \
             cost, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                conversation_id,
                message_id,
                provider_id,
                model_id,
                usage.input_tokens.map(i64::from),
                usage.output_tokens.map(i64::from),
                usage.reasoning_tokens.map(i64::from),
                usage.cached_tokens.map(i64::from),
                usage.total_tokens.map(i64::from),
                usage.cost,
                now_ms(),
            ],
        )
        .context("falha ao registrar uso de tokens")?;
        Ok(())
    }

    // Somente os testes de persistência agregam o uso; a produção não usa.
    #[cfg(test)]
    pub fn usage_summary(&self) -> anyhow::Result<serde_json::Value> {
        const SUM_COLUMNS: &str = "COUNT(*), COALESCE(SUM(input_tokens), 0), \
             COALESCE(SUM(output_tokens), 0), COALESCE(SUM(reasoning_tokens), 0), \
             COALESCE(SUM(cached_tokens), 0), COALESCE(SUM(total_tokens), 0), \
             COALESCE(SUM(cost), 0.0)";

        fn stats(row: &Row<'_>, offset: usize) -> rusqlite::Result<serde_json::Value> {
            let requests: i64 = row.get(offset)?;
            let input_tokens: i64 = row.get(offset + 1)?;
            let output_tokens: i64 = row.get(offset + 2)?;
            let reasoning_tokens: i64 = row.get(offset + 3)?;
            let cached_tokens: i64 = row.get(offset + 4)?;
            let total_tokens: i64 = row.get(offset + 5)?;
            let cost: f64 = row.get(offset + 6)?;
            Ok(serde_json::json!({
                "requests": requests,
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "reasoningTokens": reasoning_tokens,
                "cachedTokens": cached_tokens,
                "totalTokens": total_tokens,
                "cost": cost,
            }))
        }

        let conn = self.conn.lock();

        let totals_sql = format!("SELECT {SUM_COLUMNS} FROM usage_log");
        let totals = conn
            .query_row(&totals_sql, [], |row| stats(row, 0))
            .context("falha ao somar uso de tokens")?;

        let by_provider_sql = format!(
            "SELECT provider_id, {SUM_COLUMNS} FROM usage_log GROUP BY provider_id \
             ORDER BY provider_id"
        );
        let mut stmt = conn.prepare(&by_provider_sql)?;
        let rows = stmt.query_map([], |row| {
            let provider_id: Option<String> = row.get(0)?;
            let mut value = stats(row, 1)?;
            if let Some(object) = value.as_object_mut() {
                object.insert(
                    "providerId".into(),
                    Value::String(provider_id.unwrap_or_default()),
                );
            }
            Ok(value)
        })?;
        let by_provider = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao agrupar uso por provedor")?;

        let by_model_sql = format!(
            "SELECT provider_id, model_id, {SUM_COLUMNS} FROM usage_log \
             GROUP BY provider_id, model_id ORDER BY provider_id, model_id"
        );
        let mut stmt = conn.prepare(&by_model_sql)?;
        let rows = stmt.query_map([], |row| {
            let provider_id: Option<String> = row.get(0)?;
            let model_id: Option<String> = row.get(1)?;
            let mut value = stats(row, 2)?;
            if let Some(object) = value.as_object_mut() {
                object.insert(
                    "providerId".into(),
                    Value::String(provider_id.unwrap_or_default()),
                );
                object.insert(
                    "modelId".into(),
                    Value::String(model_id.unwrap_or_default()),
                );
            }
            Ok(value)
        })?;
        let by_model = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .context("falha ao agrupar uso por modelo")?;

        Ok(serde_json::json!({
            "totals": totals,
            "byProvider": by_provider,
            "byModel": by_model,
        }))
    }

    /// Deletes every conversation, message, attachment, artifact, code-harness
    /// record (workspaces/journal/eventos/resumos/regras) and meta key.
    pub fn reset(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction()?;
        for table in [
            "messages",
            "artifacts",
            "attachments",
            "usage_log",
            "code_events",
            "file_journal",
            "session_summaries",
            "approval_rules",
            "workspaces",
            "conversations",
            "meta",
        ] {
            tx.execute(&format!("DELETE FROM {table}"), [])
                .with_context(|| format!("falha ao limpar a tabela {table}"))?;
        }
        tx.commit()?;
        Ok(())
    }
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Citation, MessageStatus, ToolCallRecord, ToolCallStatus, TraceStep};

    fn test_db() -> Db {
        Db::open_in_memory().expect("in-memory database")
    }

    fn user_message(conversation_id: &str, content: &str, created_at: i64) -> ChatMessage {
        let mut message = ChatMessage::user(conversation_id, content);
        message.created_at = created_at;
        message
    }

    fn assistant_message(conversation_id: &str, created_at: i64) -> ChatMessage {
        let mut message = ChatMessage::assistant(conversation_id);
        message.created_at = created_at;
        message
    }

    fn stored_attachment(id: &str, text: &str) -> StoredAttachment {
        StoredAttachment {
            id: id.to_string(),
            name: "nota.txt".to_string(),
            mime_type: "text/plain".to_string(),
            size: 42,
            kind: "text".to_string(),
            text: text.to_string(),
            page_count: None,
            width: None,
            height: None,
            file_path: Some(format!("attachments/{id}.txt")),
            created_at: 1_700_000_000_000,
        }
    }

    fn stored_artifact(id: &str, conversation_id: &str) -> StoredArtifact {
        StoredArtifact {
            artifact: Artifact {
                id: id.to_string(),
                conversation_id: Some(conversation_id.to_string()),
                message_id: None,
                name: "resumo.md".to_string(),
                mime_type: "text/markdown".to_string(),
                kind: ArtifactKind::Markdown,
                language: None,
                size: 12,
                created_at: 1_700_000_000_000,
                favorite: false,
            },
            path: std::env::temp_dir()
                .join("lumina-db-tests")
                .join("artifacts")
                .join(id)
                .join("resumo.md")
                .to_string_lossy()
                .to_string(),
        }
    }

    /// Artefato enviado pelo usuário direto à Biblioteca: não tem conversa.
    fn library_artifact(id: &str, name: &str, created_at: i64) -> StoredArtifact {
        StoredArtifact {
            artifact: Artifact {
                id: id.to_string(),
                conversation_id: None,
                message_id: None,
                name: name.to_string(),
                mime_type: "application/pdf".to_string(),
                kind: ArtifactKind::Pdf,
                language: None,
                size: 4_096,
                created_at,
                favorite: false,
            },
            path: std::env::temp_dir()
                .join("lumina-db-tests")
                .join("artifacts")
                .join(id)
                .join(name)
                .to_string_lossy()
                .to_string(),
        }
    }

    #[test]
    fn creates_and_lists_conversations() {
        let db = test_db();
        let conversation = db
            .create_conversation("Primeira", "opencode-go", "glm-5.3-flash")
            .expect("create conversation");
        assert_eq!(conversation.title, "Primeira");
        assert_eq!(conversation.provider_id, "opencode-go");
        assert_eq!(conversation.model_id, "glm-5.3-flash");
        assert!(!conversation.pinned);
        assert_eq!(conversation.message_count, 0);
        assert!(conversation.preview.is_none());

        // Empty titles fall back to the default label.
        let untitled = db
            .create_conversation("   ", "opencode-go", "glm-5.3-flash")
            .expect("create untitled");
        assert_eq!(untitled.title, "Nova conversa");

        let listed = db.list_conversations().expect("list");
        assert_eq!(listed.len(), 2);
    }

    #[test]
    fn messages_roundtrip_and_conversation_stats() {
        let db = test_db();
        let conversation = db
            .create_conversation("Chat", "opencode-go", "glm-5.3-flash")
            .expect("create");

        let mut user = user_message(&conversation.id, "  Olá   mundo, tudo bem?  ", 1_000);
        user.citations = vec![Citation {
            id: "c1".to_string(),
            title: "Exemplo".to_string(),
            url: "https://example.com".to_string(),
            snippet: None,
            site_name: None,
        }];
        db.insert_message(&user).expect("insert user");

        let mut assistant = assistant_message(&conversation.id, 2_000);
        assistant.content = "Tudo ótimo!".to_string();
        assistant.status = MessageStatus::Complete;
        assistant.model_id = Some("glm-5.3-flash".to_string());
        assistant.provider_id = Some("opencode-go".to_string());
        assistant.reasoning = Some("pensando...".to_string());
        assistant.tool_calls = vec![ToolCallRecord::running("t1", "web_search")];
        assistant.usage = Some(UsageInfo {
            input_tokens: Some(10),
            output_tokens: Some(20),
            reasoning_tokens: Some(5),
            cached_tokens: Some(2),
            total_tokens: Some(30),
            cost: Some(0.001),
            duration_ms: Some(1500),
        });
        assistant.provider_state = Some(serde_json::json!({ "items": [1, 2, 3] }));
        assistant.trace = vec![
            TraceStep {
                reasoning: Some("vou pesquisar".to_string()),
                tool_calls: 1,
            },
            TraceStep {
                reasoning: Some("resumo final".to_string()),
                tool_calls: 0,
            },
        ];
        db.insert_message(&assistant).expect("insert assistant");

        let messages = db.list_messages(&conversation.id).expect("list messages");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].id, user.id);
        assert_eq!(messages[1].id, assistant.id);
        assert_eq!(messages[1].role, MessageRole::Assistant);
        assert_eq!(messages[1].status, MessageStatus::Complete);
        assert_eq!(messages[1].tool_calls.len(), 1);
        assert_eq!(messages[1].tool_calls[0].status, ToolCallStatus::Running);
        assert_eq!(
            messages[1].provider_state,
            Some(serde_json::json!({ "items": [1, 2, 3] }))
        );
        assert_eq!(
            messages[1].usage.as_ref().and_then(|u| u.total_tokens),
            Some(30)
        );
        assert_eq!(messages[1].trace, assistant.trace);

        let refreshed = db
            .get_conversation(&conversation.id)
            .expect("get")
            .expect("present");
        assert_eq!(refreshed.message_count, 2);
        assert_eq!(refreshed.preview.as_deref(), Some("Olá mundo, tudo bem?"));

        // Updates keep every JSON column intact.
        assistant.content = "Tudo ótimo! (editado)".to_string();
        assistant.status = MessageStatus::Cancelled;
        db.update_message(&assistant).expect("update");
        let stored = db
            .get_message(&assistant.id)
            .expect("get message")
            .expect("present");
        assert_eq!(stored.content, "Tudo ótimo! (editado)");
        assert_eq!(stored.status, MessageStatus::Cancelled);
        assert_eq!(stored.citations.len(), 0);
        assert_eq!(stored.provider_state, assistant.provider_state);
        assert_eq!(stored.trace, assistant.trace, "trace survives updates");

        // update_message creates the row when it does not exist yet.
        let mut orphan = assistant_message(&conversation.id, 3_000);
        orphan.content = "recurso".to_string();
        db.update_message(&orphan).expect("upsert");
        assert!(db.get_message(&orphan.id).expect("get orphan").is_some());
    }

    #[test]
    fn migrates_legacy_databases_with_the_trace_column() {
        // A database created before the thinking trace existed.
        let conn = Connection::open_in_memory().expect("in-memory connection");
        conn.execute_batch(
            "CREATE TABLE messages (
               id              TEXT PRIMARY KEY,
               conversation_id TEXT NOT NULL,
               role            TEXT NOT NULL,
               content         TEXT NOT NULL DEFAULT '',
               reasoning       TEXT,
               status          TEXT NOT NULL,
               tool_calls      TEXT NOT NULL DEFAULT '[]',
               citations       TEXT NOT NULL DEFAULT '[]',
               attachments     TEXT NOT NULL DEFAULT '[]',
               model_id        TEXT,
               provider_id     TEXT,
               usage           TEXT,
               provider_state  TEXT,
               created_at      INTEGER NOT NULL
             );
             INSERT INTO messages (id, conversation_id, role, status, created_at)
               VALUES ('m1', 'c1', 'assistant', 'complete', 1);",
        )
        .expect("legacy schema");

        Db::init_connection(&conn).expect("migration");
        let trace: String = conn
            .query_row("SELECT trace FROM messages WHERE id = 'm1'", [], |row| row.get(0))
            .expect("trace column");
        assert_eq!(trace, "[]");

        // Opening the same database again is a no-op.
        Db::init_connection(&conn).expect("idempotent migration");
    }

    /// Banco legado (anterior à separação Chat/Code): a tabela `conversations`
    /// não tem `mode` nem `code_linked`.
    fn legacy_conversations_table(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE conversations (
               id            TEXT PRIMARY KEY,
               title         TEXT NOT NULL,
               created_at    INTEGER NOT NULL,
               updated_at    INTEGER NOT NULL,
               pinned        INTEGER NOT NULL DEFAULT 0,
               provider_id   TEXT NOT NULL,
               model_id      TEXT NOT NULL,
               message_count INTEGER NOT NULL DEFAULT 0,
               preview       TEXT
             );
             INSERT INTO conversations
               (id, title, created_at, updated_at, pinned, provider_id, model_id,
                message_count, preview)
               VALUES ('legacy-1', 'Conversa antiga', 10, 20, 1, 'opencode-go',
                       'glm-5.3-flash', 0, NULL);",
        )
        .expect("legacy conversations schema");
    }

    #[test]
    fn migrates_legacy_conversations_to_chat_mode_preserving_rows() {
        let conn = Connection::open_in_memory().expect("in-memory connection");
        legacy_conversations_table(&conn);

        Db::init_connection(&conn).expect("migration");
        // Migração aditiva é idempotente: reabrir o banco não recria nada.
        Db::init_connection(&conn).expect("idempotent migration");

        let columns = table_columns(&conn, "conversations").expect("columns");
        assert!(columns.iter().any(|(name, _)| name == "mode"));
        assert!(columns.iter().any(|(name, _)| name == "code_linked"));

        let raw: (String, i64) = conn
            .query_row(
                "SELECT mode, code_linked FROM conversations WHERE id = 'legacy-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("legacy row migrated");
        assert_eq!(raw, ("chat".to_string(), 0));

        // O mapper e o `Conversation` devolvido ao renderer refletem a migração.
        let db = Db {
            conn: parking_lot::Mutex::new(conn),
        };
        let conversation = db
            .get_conversation("legacy-1")
            .expect("get legacy")
            .expect("legacy row preserved");
        assert_eq!(conversation.title, "Conversa antiga");
        assert!(conversation.pinned);
        assert_eq!(conversation.mode, "chat");
        assert!(!conversation.code_linked);

        let listed = db.list_conversations().expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].mode, "chat");
    }

    #[test]
    fn create_conversation_defaults_to_chat_mode() {
        let db = test_db();
        let conversation = db
            .create_conversation("Chat", "opencode-go", "glm-5.3-flash")
            .expect("create");
        assert_eq!(conversation.mode, "chat");
        assert!(!conversation.code_linked);

        let listed = db.list_conversations().expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].mode, "chat");
        assert!(!listed[0].code_linked);
    }

    #[test]
    fn creates_conversations_with_code_mode_and_normalizes_invalid_modes() {
        let db = test_db();
        let code = db
            .create_conversation_with_mode("Projeto Aurora", "opencode-go", "glm-5.3-flash", "code")
            .expect("create code");
        assert_eq!(code.mode, "code");
        assert!(!code.code_linked, "sessão nova não nasce compartilhada");

        let fallback = db
            .create_conversation_with_mode("Banana", "opencode-go", "glm-5.3-flash", "banana")
            .expect("create fallback");
        assert_eq!(fallback.mode, "chat");
        let empty = db
            .create_conversation_with_mode("Vazio", "opencode-go", "glm-5.3-flash", "")
            .expect("create empty");
        assert_eq!(empty.mode, "chat");

        let listed = db.list_conversations().expect("list");
        assert_eq!(listed.len(), 3);
        let listed_code = listed
            .iter()
            .find(|conversation| conversation.id == code.id)
            .expect("code conversation listed");
        assert_eq!(listed_code.mode, "code");
        let listed_chat = listed
            .iter()
            .find(|conversation| conversation.id == fallback.id)
            .expect("chat conversation listed");
        assert_eq!(listed_chat.mode, "chat");

        // A busca também devolve o modo (colunas qualificadas do JOIN).
        let found = db.search_conversations("Projeto").expect("search code");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].mode, "code");
    }

    #[test]
    fn links_and_unlinks_a_chat_conversation_to_code() {
        let db = test_db();
        let conversation = db
            .create_conversation("Chat", "opencode-go", "glm-5.3-flash")
            .expect("create");

        let linked = db
            .set_conversation_code_linked(&conversation.id, true)
            .expect("link");
        assert!(linked.code_linked);
        assert_eq!(linked.mode, "chat");
        assert!(db
            .get_conversation(&conversation.id)
            .expect("get")
            .expect("present")
            .code_linked);

        let unlinked = db
            .set_conversation_code_linked(&conversation.id, false)
            .expect("unlink");
        assert!(!unlinked.code_linked);
        assert!(!db.list_conversations().expect("list")[0].code_linked);
    }

    #[test]
    fn code_conversations_cannot_be_shared_with_the_code_layout() {
        let db = test_db();
        let conversation = db
            .create_conversation_with_mode("Projeto", "opencode-go", "glm-5.3-flash", "code")
            .expect("create code");

        let error = db
            .set_conversation_code_linked(&conversation.id, true)
            .expect_err("linking a code conversation must fail");
        assert!(
            format!("{error:#}").contains("somente sessões do Chat"),
            "mensagem clara em pt-BR: {error:#}"
        );

        // Desvincular também só faz sentido para sessões do Chat.
        let unlink_error = db
            .set_conversation_code_linked(&conversation.id, false)
            .expect_err("unlinking a code conversation must fail");
        assert!(format!("{unlink_error:#}").contains("somente sessões do Chat"));
        assert!(!db
            .get_conversation(&conversation.id)
            .expect("get")
            .expect("present")
            .code_linked);
    }

    #[test]
    fn linking_an_unknown_conversation_returns_a_clear_error() {
        let db = test_db();
        let error = db
            .set_conversation_code_linked("inexistente", true)
            .expect_err("unknown conversation must fail");
        assert!(
            format!("{error:#}").contains("conversa não encontrada"),
            "mensagem clara em pt-BR: {error:#}"
        );
    }

    #[test]
    fn search_matches_title_and_message_content() {
        let db = test_db();
        let cake = db
            .create_conversation("Receita de bolo", "opencode-go", "glm-5.3-flash")
            .expect("create cake");
        let other = db
            .create_conversation("Outro assunto", "opencode-go", "glm-5.3-flash")
            .expect("create other");

        let message = user_message(&other.id, "os ingredientes secretos são...", 1_000);
        db.insert_message(&message).expect("insert");

        let by_title = db.search_conversations("bolo").expect("search title");
        assert_eq!(by_title.len(), 1);
        assert_eq!(by_title[0].id, cake.id);

        let by_content = db
            .search_conversations("ingredientes")
            .expect("search content");
        assert_eq!(by_content.len(), 1);
        assert_eq!(by_content[0].id, other.id);

        // Wildcards are matched literally, not as LIKE patterns.
        assert!(db.search_conversations("%").expect("search %").is_empty());
        assert!(db.search_conversations("").expect("search empty").len() == 2);
        assert!(db
            .search_conversations("inexistente")
            .expect("search none")
            .is_empty());
    }

    #[test]
    fn delete_messages_from_drops_the_tail() {
        let db = test_db();
        let conversation = db
            .create_conversation("Chat", "opencode-go", "glm-5.3-flash")
            .expect("create");
        let first = user_message(&conversation.id, "primeira", 1_000);
        let second = assistant_message(&conversation.id, 2_000);
        let third = user_message(&conversation.id, "terceira", 3_000);
        db.insert_message(&first).expect("insert 1");
        db.insert_message(&second).expect("insert 2");
        db.insert_message(&third).expect("insert 3");

        db.delete_messages_from(&conversation.id, &second.id)
            .expect("truncate");
        let remaining = db.list_messages(&conversation.id).expect("list");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, first.id);

        let refreshed = db
            .get_conversation(&conversation.id)
            .expect("get")
            .expect("present");
        assert_eq!(refreshed.message_count, 1);
        assert_eq!(refreshed.preview.as_deref(), Some("primeira"));

        // Unknown message id is a no-op.
        db.delete_messages_from(&conversation.id, "missing")
            .expect("noop");
        assert_eq!(db.list_messages(&conversation.id).expect("list").len(), 1);
    }

    #[test]
    fn delete_conversation_cascades_but_keeps_orphan_attachments() {
        let db = test_db();
        let conversation = db
            .create_conversation("Chat", "opencode-go", "glm-5.3-flash")
            .expect("create");
        let message = user_message(&conversation.id, "oi", 1_000);
        db.insert_message(&message).expect("insert message");
        db.insert_artifact(&stored_artifact("art-1", &conversation.id))
            .expect("insert artifact");
        db.insert_attachment(&stored_attachment("att-1", "texto"))
            .expect("insert attachment");

        db.delete_conversation(&conversation.id).expect("delete");

        assert!(db
            .get_conversation(&conversation.id)
            .expect("get")
            .is_none());
        assert!(db
            .list_messages(&conversation.id)
            .expect("messages")
            .is_empty());
        assert!(db
            .list_artifacts(&conversation.id)
            .expect("artifacts")
            .is_empty());
        assert!(db.get_artifact("art-1").expect("get artifact").is_none());
        // Attachments stay behind (they are not tied to a conversation row).
        assert!(db
            .get_attachment("att-1")
            .expect("get attachment")
            .is_some());
    }

    #[test]
    fn attachments_roundtrip() {
        let db = test_db();
        let attachment = stored_attachment("att-42", "conteúdo extraído do PDF");
        db.insert_attachment(&attachment).expect("insert");
        let stored = db.get_attachment("att-42").expect("get").expect("present");
        assert_eq!(stored.name, "nota.txt");
        assert_eq!(stored.text, "conteúdo extraído do PDF");
        let info = stored.info();
        assert_eq!(info.kind, "text");
        assert_eq!(
            info.text_preview.as_deref(),
            Some("conteúdo extraído do PDF")
        );

        db.delete_attachment("att-42").expect("delete");
        assert!(db.get_attachment("att-42").expect("get").is_none());
    }

    #[test]
    fn artifacts_roundtrip() {
        let db = test_db();
        let conversation = db
            .create_conversation("Chat", "opencode-go", "glm-5.3-flash")
            .expect("create");
        let artifact = stored_artifact("art-7", &conversation.id);
        db.insert_artifact(&artifact).expect("insert");

        let listed = db.list_artifacts(&conversation.id).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].kind, ArtifactKind::Markdown);
        assert_eq!(listed[0].name, "resumo.md");

        let stored = db.get_artifact("art-7").expect("get").expect("present");
        assert_eq!(stored.path, artifact.path);

        db.delete_artifact("art-7").expect("delete");
        assert!(db.get_artifact("art-7").expect("get").is_none());
    }

    #[test]
    fn list_all_artifacts_orders_by_creation_across_conversations() {
        let db = test_db();
        let first = db
            .create_conversation("Primeira", "opencode-go", "glm-5.3-flash")
            .expect("create first");
        let second = db
            .create_conversation("Segunda", "opencode-go", "glm-5.3-flash")
            .expect("create second");

        // Inserção fora de ordem de propósito: a ordenação vem do SQL, não da
        // sequência de inserts. Dois artefatos empatam em `created_at` para
        // exercitar o desempate por `id`.
        let mut newest = stored_artifact("art-3", &first.id);
        newest.artifact.created_at = 3_000;
        let mut middle = stored_artifact("art-2", &second.id);
        middle.artifact.created_at = 2_000;
        let mut tied = stored_artifact("art-9", &first.id);
        tied.artifact.created_at = 1_000;
        let mut oldest = stored_artifact("art-1", &second.id);
        oldest.artifact.created_at = 1_000;
        for artifact in [&newest, &middle, &tied, &oldest] {
            db.insert_artifact(artifact).expect("insert artifact");
        }

        let all = db.list_all_artifacts().expect("list all");
        let ids: Vec<&str> = all.iter().map(|artifact| artifact.id.as_str()).collect();
        assert_eq!(
            ids,
            ["art-1", "art-9", "art-2", "art-3"],
            "ordem canônica created_at, id"
        );
        assert_eq!(
            all[0].conversation_id.as_deref(),
            Some(second.id.as_str()),
            "artefato da segunda conversa entra na biblioteca do usuário"
        );
        assert_eq!(all[1].conversation_id.as_deref(), Some(first.id.as_str()));
        assert_eq!(all[2].conversation_id.as_deref(), Some(second.id.as_str()));
        assert_eq!(all[3].conversation_id.as_deref(), Some(first.id.as_str()));
    }

    #[test]
    fn list_all_artifacts_is_empty_without_artifacts() {
        let db = test_db();
        assert!(
            db.list_all_artifacts().expect("list all").is_empty(),
            "sem artefatos a biblioteca do usuário é vazia"
        );

        // Uma conversa sem artefatos não inventa linhas na biblioteca global.
        db.create_conversation("Vazia", "opencode-go", "glm-5.3-flash")
            .expect("create");
        assert!(db.list_all_artifacts().expect("list all").is_empty());
    }

    #[test]
    fn list_all_artifacts_keeps_metadata_of_every_conversation() {
        let db = test_db();
        let first = db
            .create_conversation("Primeira", "opencode-go", "glm-5.3-flash")
            .expect("create first");
        let second = db
            .create_conversation("Segunda", "opencode-go", "glm-5.3-flash")
            .expect("create second");

        db.insert_artifact(&stored_artifact("art-first", &first.id))
            .expect("insert first");
        let mut artifact = stored_artifact("art-second", &second.id);
        artifact.artifact.name = "relatorio-q3.md".to_string();
        artifact.artifact.language = Some("markdown".to_string());
        db.insert_artifact(&artifact).expect("insert second");

        let all = db.list_all_artifacts().expect("list all");
        assert_eq!(all.len(), 2, "artefatos das duas conversas");
        let listed = all
            .iter()
            .find(|row| row.id == "art-second")
            .expect("artefato da segunda conversa listado");
        assert_eq!(listed.conversation_id.as_deref(), Some(second.id.as_str()));
        assert_eq!(listed.name, "relatorio-q3.md");
        assert_eq!(listed.kind, ArtifactKind::Markdown);

        // `get_artifact` continua sendo a fonte do path e dos metadados.
        let stored = db
            .get_artifact("art-second")
            .expect("get")
            .expect("artefato presente");
        assert_eq!(
            stored.artifact.conversation_id.as_deref(),
            Some(second.id.as_str())
        );
        assert_eq!(stored.artifact.name, "relatorio-q3.md");
        assert_eq!(stored.artifact.kind, ArtifactKind::Markdown);
        assert_eq!(stored.artifact.language.as_deref(), Some("markdown"));
        assert_eq!(stored.path, artifact.path, "path round-trip");
    }

    /// Todos os variants do contrato. A lista é mantida à mão de propósito: um
    /// kind novo em `domain.rs` quebra `artifact_kind_to_str` (match exaustivo)
    /// e deve ser adicionado aqui para o round-trip continuar completo.
    fn all_artifact_kinds() -> [ArtifactKind; 16] {
        [
            ArtifactKind::Markdown,
            ArtifactKind::Code,
            ArtifactKind::Text,
            ArtifactKind::Html,
            ArtifactKind::Csv,
            ArtifactKind::Json,
            ArtifactKind::Svg,
            ArtifactKind::Image,
            ArtifactKind::Pdf,
            ArtifactKind::Docx,
            ArtifactKind::Xlsx,
            ArtifactKind::Pptx,
            ArtifactKind::Audio,
            ArtifactKind::Video,
            ArtifactKind::Archive,
            ArtifactKind::Binary,
        ]
    }

    #[test]
    fn artifact_kind_slugs_roundtrip_and_match_the_ipc_json() {
        for kind in all_artifact_kinds() {
            let stored = artifact_kind_to_str(&kind);
            assert_eq!(
                artifact_kind_from_str(stored),
                kind,
                "{kind:?} não sobrevive ao round-trip pelo banco"
            );
            // A coluna `kind` precisa usar o mesmo slug que o renderer recebe
            // (`ArtifactKind` é `#[serde(rename_all = "lowercase")]`).
            assert_eq!(
                serde_json::to_value(&kind).expect("serializar kind"),
                serde_json::Value::String(stored.to_string()),
                "slug do banco divergente do IPC para {kind:?}"
            );
        }
    }

    #[test]
    fn unknown_artifact_kind_falls_back_to_binary() {
        for raw in ["", "desconhecido", "imagem", "AUDIO", "video ", "binary-"] {
            assert_eq!(
                artifact_kind_from_str(raw),
                ArtifactKind::Binary,
                "valor legado/desconhecido {raw:?} deve cair em Binary"
            );
        }
    }

    #[test]
    fn media_and_archive_kinds_persist_through_the_artifacts_table() {
        let db = test_db();
        let conversation = db
            .create_conversation("Chat", "opencode-go", "glm-5.3-flash")
            .expect("create");
        for (index, kind) in all_artifact_kinds().into_iter().enumerate() {
            let mut artifact = stored_artifact(&format!("art-{index:02}"), &conversation.id);
            artifact.artifact.kind = kind;
            db.insert_artifact(&artifact).expect("insert");
        }

        let listed = db.list_artifacts(&conversation.id).expect("list");
        let stored_kinds: Vec<ArtifactKind> = listed.into_iter().map(|row| row.kind).collect();
        assert_eq!(
            stored_kinds,
            all_artifact_kinds().to_vec(),
            "todos os kinds, inclusive áudio/vídeo/compactado, devem voltar iguais"
        );

        // `get_artifact` (usado por preview/conteúdo) faz o mesmo mapeamento.
        let audio = db
            .get_artifact("art-12")
            .expect("get")
            .expect("artefato de áudio presente");
        assert_eq!(audio.artifact.kind, ArtifactKind::Audio);
        let archive = db
            .get_artifact("art-14")
            .expect("get")
            .expect("artefato compactado presente");
        assert_eq!(archive.artifact.kind, ArtifactKind::Archive);
    }

    #[test]
    fn usage_summary_aggregates_by_provider_and_model() {
        let db = test_db();
        let usage = |input, output: u32| UsageInfo {
            input_tokens: Some(input),
            output_tokens: Some(output),
            reasoning_tokens: Some(1),
            cached_tokens: Some(0),
            total_tokens: Some(input + output),
            cost: Some(0.5),
            duration_ms: None,
        };
        db.record_usage(
            "conv-1",
            "msg-1",
            "opencode-go",
            "glm-5.3-flash",
            &usage(10, 20),
        )
        .expect("usage 1");
        db.record_usage(
            "conv-1",
            "msg-2",
            "opencode-go",
            "glm-5.3-flash",
            &usage(1, 2),
        )
        .expect("usage 2");
        db.record_usage(
            "conv-2",
            "msg-3",
            "opencode-zen",
            "gpt-6-luna",
            &usage(5, 5),
        )
        .expect("usage 3");

        let summary = db.usage_summary().expect("summary");
        let totals = &summary["totals"];
        assert_eq!(totals["requests"], 3);
        assert_eq!(totals["inputTokens"], 16);
        assert_eq!(totals["outputTokens"], 27);
        assert_eq!(totals["totalTokens"], 43);
        assert_eq!(summary["byProvider"].as_array().expect("array").len(), 2);
        assert_eq!(summary["byModel"].as_array().expect("array").len(), 2);
    }

    #[test]
    fn reset_clears_every_table() {
        let db = test_db();
        let conversation = db
            .create_conversation("Chat", "opencode-go", "glm-5.3-flash")
            .expect("create");
        db.insert_message(&user_message(&conversation.id, "oi", 1_000))
            .expect("insert");
        db.insert_artifact(&stored_artifact("art-9", &conversation.id))
            .expect("artifact");
        db.insert_attachment(&stored_attachment("att-9", "texto"))
            .expect("attachment");

        db.reset().expect("reset");
        assert!(db.list_conversations().expect("conversations").is_empty());
        assert!(db
            .list_artifacts(&conversation.id)
            .expect("artifacts")
            .is_empty());
        assert!(db.get_attachment("att-9").expect("attachment").is_none());
        assert_eq!(
            db.usage_summary().expect("summary")["totals"]["requests"],
            0
        );
    }

    #[test]
    fn pinned_conversations_sort_first() {
        let db = test_db();
        let older = db
            .create_conversation("Antiga", "opencode-go", "glm-5.3-flash")
            .expect("create old");
        let newer = db
            .create_conversation("Nova", "opencode-go", "glm-5.3-flash")
            .expect("create new");
        db.touch_conversation(&older.id).expect("touch");
        db.set_pinned(&older.id, true).expect("pin");
        let listed = db.list_conversations().expect("list");
        assert_eq!(listed[0].id, older.id);
        assert_eq!(listed[1].id, newer.id);
        let stored = db
            .get_conversation(&older.id)
            .expect("get")
            .expect("present");
        assert!(stored.pinned);
    }

    /* -------------------------------------------------------------- */
    /* Biblioteca: uploads sem conversa, favoritos e migração          */
    /* -------------------------------------------------------------- */

    struct TempDir {
        path: std::path::PathBuf,
    }

    impl TempDir {
        fn new(prefix: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "{prefix}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).expect("criar diretório temporário");
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// Banco no schema anterior à Biblioteca: `conversation_id NOT NULL` e sem
    /// a coluna `favorite`.
    fn create_legacy_database(path: &Path) {
        let conn = Connection::open(path).expect("abrir banco legado");
        conn.execute_batch(
            "CREATE TABLE artifacts (
               id              TEXT PRIMARY KEY,
               conversation_id TEXT NOT NULL,
               message_id      TEXT,
               name            TEXT NOT NULL,
               mime_type       TEXT NOT NULL,
               kind            TEXT NOT NULL,
               language        TEXT,
               size            INTEGER NOT NULL,
               created_at      INTEGER NOT NULL,
               path            TEXT NOT NULL
             );
             INSERT INTO artifacts (id, conversation_id, message_id, name, mime_type, kind,
                                    language, size, created_at, path)
               VALUES ('art-legacy', 'conv-1', 'msg-1', 'antigo.md', 'text/markdown',
                       'markdown', NULL, 12, 1000,
                       'C:\\dados\\artifacts\\art-legacy\\antigo.md');
             INSERT INTO artifacts (id, conversation_id, message_id, name, mime_type, kind,
                                    language, size, created_at, path)
               VALUES ('art-legacy-2', 'conv-1', NULL, 'relatorio.pdf', 'application/pdf',
                       'pdf', NULL, 2048, 2000,
                       'C:\\dados\\artifacts\\art-legacy-2\\relatorio.pdf');",
        )
        .expect("criar schema legado com dados");
    }

    #[test]
    fn joined_artifact_columns_stay_in_sync_with_the_row_mapper() {
        let plain: Vec<&str> = ARTIFACT_COLUMNS.split(',').map(str::trim).collect();
        let prefixed: Vec<&str> = ARTIFACT_JOIN_COLUMNS
            .split(',')
            .map(|column| column.trim().strip_prefix("a.").unwrap_or_else(|| column.trim()))
            .collect();
        assert_eq!(
            prefixed, plain,
            "a query com JOIN precisa listar as colunas na mesma ordem do mapper"
        );
        assert_eq!(plain.len(), 10);
        assert_eq!(plain[9], "favorite", "favorite é a última coluna do mapper");
    }

    #[test]
    fn insert_artifact_roundtrips_a_library_upload_without_conversation() {
        let db = test_db();
        db.insert_artifact(&library_artifact("art-upload", "contrato.pdf", 1_000))
            .expect("inserir upload");

        let stored = db
            .get_artifact("art-upload")
            .expect("ler upload")
            .expect("upload presente");
        assert!(stored.artifact.conversation_id.is_none());
        assert!(!stored.artifact.favorite);
        assert_eq!(stored.artifact.name, "contrato.pdf");
        assert_eq!(stored.artifact.kind, ArtifactKind::Pdf);

        // Aparece na listagem global do agente (todas as origens).
        let all = db.list_all_artifacts().expect("list all");
        assert_eq!(all.len(), 1);
        assert!(all[0].conversation_id.is_none());
    }

    #[test]
    fn list_library_artifacts_orders_desc_and_joins_conversation_titles() {
        let db = test_db();
        let first = db
            .create_conversation("Receitas de bolo", "opencode-go", "glm-5.3-flash")
            .expect("create first");
        let second = db
            .create_conversation("Segunda conversa", "opencode-go", "glm-5.3-flash")
            .expect("create second");

        let mut oldest = stored_artifact("art-a", &first.id);
        oldest.artifact.created_at = 1_000;
        db.insert_artifact(&oldest).expect("insert old");
        // Upload e artefato gerado empatam em `created_at`: o desempate é por
        // `id DESC` (art-c antes de art-b).
        db.insert_artifact(&library_artifact("art-b", "contrato.pdf", 2_000))
            .expect("insert upload");
        let mut generated = stored_artifact("art-c", &second.id);
        generated.artifact.created_at = 2_000;
        generated.artifact.favorite = true;
        db.insert_artifact(&generated).expect("insert generated");

        let library = db.list_library_artifacts().expect("listar biblioteca");
        let ids: Vec<&str> = library
            .iter()
            .map(|row| row.artifact.id.as_str())
            .collect();
        assert_eq!(
            ids,
            ["art-c", "art-b", "art-a"],
            "mais recentes primeiro, id DESC no empate"
        );

        let upload = &library[1];
        assert!(upload.artifact.conversation_id.is_none());
        assert!(
            upload.conversation_title.is_none(),
            "upload não tem conversa de origem"
        );
        assert_eq!(upload.artifact.name, "contrato.pdf");

        assert_eq!(
            library[0].conversation_title.as_deref(),
            Some("Segunda conversa")
        );
        assert!(library[0].artifact.favorite);
        assert_eq!(
            library[2].conversation_title.as_deref(),
            Some("Receitas de bolo")
        );
        assert!(!library[2].artifact.favorite);
    }

    #[test]
    fn set_artifact_favorite_persists_and_returns_the_updated_artifact() {
        let db = test_db();
        let conversation = db
            .create_conversation("Chat", "opencode-go", "glm-5.3-flash")
            .expect("create");
        db.insert_artifact(&stored_artifact("art-fav", &conversation.id))
            .expect("insert");

        let favorited = db
            .set_artifact_favorite("art-fav", true)
            .expect("favoritar")
            .expect("artefato presente");
        assert!(favorited.favorite);
        assert_eq!(favorited.id, "art-fav");
        // O recorte por conversa também vê o favorito.
        let listed = db.list_artifacts(&conversation.id).expect("list");
        assert!(listed[0].favorite);

        let unfavorited = db
            .set_artifact_favorite("art-fav", false)
            .expect("desfavoritar")
            .expect("artefato presente");
        assert!(!unfavorited.favorite);

        assert!(
            db.set_artifact_favorite("inexistente", true)
                .expect("id desconhecido não é erro de SQL")
                .is_none(),
            "id inexistente devolve None para o comando virar erro"
        );
    }

    #[test]
    fn update_artifact_metadata_changes_name_mime_kind_and_language() {
        let db = test_db();
        let conversation = db
            .create_conversation("Chat", "opencode-go", "glm-5.3-flash")
            .expect("create");
        db.insert_artifact(&stored_artifact("art-meta", &conversation.id))
            .expect("insert");

        let updated = db
            .update_artifact_metadata(
                "art-meta",
                "renomeado.pdf",
                "application/pdf",
                ArtifactKind::Pdf,
                None,
            )
            .expect("atualizar metadados")
            .expect("artefato presente");
        assert_eq!(updated.name, "renomeado.pdf");
        assert_eq!(updated.mime_type, "application/pdf");
        assert_eq!(updated.kind, ArtifactKind::Pdf);
        assert!(updated.language.is_none());
        // O path continua o mesmo: o arquivo em disco é movido pelo comando.
        let stored = db
            .get_artifact("art-meta")
            .expect("get")
            .expect("presente");
        assert_eq!(
            stored.path,
            std::env::temp_dir()
                .join("lumina-db-tests")
                .join("artifacts")
                .join("art-meta")
                .join("resumo.md")
                .to_string_lossy()
                .to_string()
        );

        assert!(
            db.update_artifact_metadata(
                "inexistente",
                "x.txt",
                "text/plain",
                ArtifactKind::Text,
                Some("text")
            )
            .expect("id desconhecido não é erro de SQL")
            .is_none()
        );
    }

    #[test]
    fn update_artifact_rename_saves_metadata_and_path_together() {
        let db = test_db();
        db.insert_artifact(&library_artifact("art-rename", "antigo.pdf", 1_000))
            .expect("insert");

        let new_path = std::env::temp_dir()
            .join("lumina-db-tests")
            .join("artifacts")
            .join("art-rename")
            .join("contrato-final.pdf")
            .to_string_lossy()
            .to_string();
        let renamed = db
            .update_artifact_rename(
                "art-rename",
                "contrato-final.pdf",
                "application/pdf",
                ArtifactKind::Pdf,
                None,
                &new_path,
            )
            .expect("renomear")
            .expect("artefato presente");
        assert_eq!(renamed.name, "contrato-final.pdf");

        let stored = db
            .get_artifact("art-rename")
            .expect("get")
            .expect("presente");
        assert_eq!(stored.path, new_path, "path do rename gravado no mesmo UPDATE");
        assert_eq!(stored.artifact.name, "contrato-final.pdf");
    }

    #[test]
    fn delete_conversation_keeps_library_uploads() {
        let db = test_db();
        let conversation = db
            .create_conversation("Chat", "opencode-go", "glm-5.3-flash")
            .expect("create");
        db.insert_artifact(&stored_artifact("art-conv", &conversation.id))
            .expect("insert generated");
        db.insert_artifact(&library_artifact("art-upload", "contrato.pdf", 1_000))
            .expect("insert upload");

        db.delete_conversation(&conversation.id).expect("delete");

        let library = db.list_library_artifacts().expect("listar");
        assert_eq!(library.len(), 1, "upload sem conversa sobrevive");
        assert_eq!(library[0].artifact.id, "art-upload");
    }

    #[test]
    fn migrates_legacy_artifacts_table_preserving_rows_and_allowing_uploads() {
        let temp = TempDir::new("lumina-db-migrate");
        let path = temp.path.join("lumina.db");
        create_legacy_database(&path);

        // `Db::open` roda o schema novo (idempotente) e a migração.
        let db = Db::open(&path).expect("abrir e migrar banco legado");
        let legacy = db
            .get_artifact("art-legacy")
            .expect("ler artefato legado")
            .expect("nenhum artefato antigo pode ser perdido");
        assert_eq!(legacy.artifact.name, "antigo.md");
        assert_eq!(legacy.artifact.conversation_id.as_deref(), Some("conv-1"));
        assert_eq!(legacy.artifact.created_at, 1_000);
        assert!(
            !legacy.artifact.favorite,
            "linha antiga entra com favorite = 0"
        );
        assert_eq!(
            legacy.path,
            "C:\\dados\\artifacts\\art-legacy\\antigo.md",
            "path original preservado"
        );
        assert_eq!(db.list_all_artifacts().expect("listar").len(), 2);

        // A coluna `conversation_id` agora aceita NULL (upload da Biblioteca),
        // e `favorite` funciona nas linhas antigas e novas.
        db.insert_artifact(&library_artifact("art-upload", "contrato.pdf", 3_000))
            .expect("upload sem conversa depois da migração");
        db.set_artifact_favorite("art-upload", true)
            .expect("favoritar upload")
            .expect("upload presente");
        let upload = db
            .get_artifact("art-upload")
            .expect("ler upload")
            .expect("presente");
        assert!(upload.artifact.conversation_id.is_none());
        assert!(upload.artifact.favorite);
        drop(db);

        // Reabrir (migração idempotente) mantém tudo.
        let reopened = Db::open(&path).expect("reabrir banco migrado");
        assert!(reopened.get_artifact("art-legacy").expect("legado").is_some());
        let upload = reopened
            .get_artifact("art-upload")
            .expect("upload")
            .expect("presente");
        assert!(upload.artifact.favorite);
        assert_eq!(reopened.list_all_artifacts().expect("listar").len(), 3);
    }

    #[test]
    fn migration_is_idempotent_when_favorite_already_exists() {
        // Estado intermediário: `favorite` já foi adicionada, mas a tabela ainda
        // tem `conversation_id NOT NULL` (uma migração anterior foi interrompida
        // entre os dois passos). O rebuild precisa copiar a coluna existente.
        let temp = TempDir::new("lumina-db-migrate-partial");
        let path = temp.path.join("lumina.db");
        create_legacy_database(&path);
        {
            let conn = Connection::open(&path).expect("abrir legado");
            conn.execute_batch(
                "ALTER TABLE artifacts ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
                 UPDATE artifacts SET favorite = 1 WHERE id = 'art-legacy';",
            )
            .expect("adicionar favorite manualmente");
        }

        let db = Db::open(&path).expect("abrir e terminar a migração");
        let legacy = db
            .get_artifact("art-legacy")
            .expect("get")
            .expect("presente");
        assert!(
            legacy.artifact.favorite,
            "o rebuild preserva o favorite já gravado"
        );
        assert_eq!(legacy.artifact.name, "antigo.md");
        db.insert_artifact(&library_artifact("art-upload", "contrato.pdf", 3_000))
            .expect("upload depois da migração");
        drop(db);

        // E segue idempotente na terceira abertura.
        let reopened = Db::open(&path).expect("reabrir");
        assert_eq!(reopened.list_all_artifacts().expect("listar").len(), 3);
    }

    #[test]
    fn reset_clears_library_uploads_too() {
        let db = test_db();
        db.insert_artifact(&library_artifact("art-upload", "contrato.pdf", 1_000))
            .expect("insert upload");
        db.reset().expect("reset");
        assert!(db.list_library_artifacts().expect("biblioteca").is_empty());
        assert!(db.list_all_artifacts().expect("artefatos").is_empty());
    }

    /* -------------------------------------------------------------- */
    /* Harness de código: migração e persistência                     */
    /* -------------------------------------------------------------- */

    fn code_conversation(db: &Db) -> Conversation {
        db.create_conversation_with_mode(
            "Sessão de código",
            "opencode-go",
            "glm-5.3-flash",
            "code",
        )
        .expect("criar conversa de código")
    }

    fn code_harness_rule<'a>(
        scope: ApprovalScope,
        scope_id: Option<&'a str>,
        tool: &'a str,
    ) -> NewApprovalRule<'a> {
        NewApprovalRule {
            scope,
            scope_id,
            tool,
            matcher: "prefix",
            pattern: "npm run",
            decision: ApprovalDecision::Approved,
        }
    }

    /// Banco legado (anterior ao harness de código) com a tabela `conversations`
    /// sem `workspace_id`/`agent_kind`/`permission_mode`.
    fn create_legacy_code_harness_database(path: &Path) {
        let conn = Connection::open(path).expect("abrir banco legado");
        legacy_conversations_table(&conn);
    }

    #[test]
    fn migrates_legacy_conversations_with_the_code_harness_columns() {
        let temp = TempDir::new("lumina-db-code-harness-migrate");
        let path = temp.path.join("lumina.db");
        create_legacy_code_harness_database(&path);

        // `Db::open` roda o schema novo (idempotente) e as migrações aditivas.
        let db = Db::open(&path).expect("abrir e migrar banco legado");
        let conversation = db
            .get_conversation("legacy-1")
            .expect("ler conversa legada")
            .expect("conversa antiga preservada");
        assert_eq!(conversation.title, "Conversa antiga");
        assert!(conversation.pinned);
        assert_eq!(conversation.mode, "chat");
        assert_eq!(conversation.workspace_id, None);
        assert_eq!(conversation.agent_kind, "lumina");
        assert_eq!(conversation.permission_mode, PermissionMode::Edit);
        drop(db);

        // As colunas existem fisicamente e os defaults valem para a linha antiga.
        let conn = Connection::open(&path).expect("reabrir banco migrado");
        let columns = table_columns(&conn, "conversations").expect("colunas");
        for column in ["workspace_id", "agent_kind", "permission_mode"] {
            assert!(
                columns.iter().any(|(name, _)| name == column),
                "coluna {column} ausente após a migração"
            );
        }
        let raw: (Option<String>, String, String) = conn
            .query_row(
                "SELECT workspace_id, agent_kind, permission_mode FROM conversations \
                 WHERE id = 'legacy-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("valores migrados");
        assert_eq!(raw, (None, "lumina".to_string(), "edit".to_string()));
        drop(conn);

        // A migração é idempotente: reabrir o arquivo mantém tudo.
        let reopened = Db::open(&path).expect("reabrir");
        let conversation = reopened
            .get_conversation("legacy-1")
            .expect("get")
            .expect("presente");
        assert_eq!(conversation.permission_mode, PermissionMode::Edit);
    }

    #[test]
    fn creates_lists_and_finds_workspaces() {
        let db = test_db();
        let alpha = db
            .create_workspace("  Alpha  ", "C:\\projetos\\alpha")
            .expect("criar alpha");
        assert_eq!(alpha.name, "Alpha", "nome é aparado");
        assert_eq!(alpha.path, "C:\\projetos\\alpha");
        assert!(alpha.last_opened_at.is_none());
        assert!(!alpha.pinned);
        assert!(!alpha.trusted);
        assert!(alpha.git.is_none(), "git não é coluna; é detectado em memória");

        let found = db
            .find_workspace_by_path("  C:\\projetos\\alpha  ")
            .expect("buscar por caminho")
            .expect("workspace presente");
        assert_eq!(found.id, alpha.id);
        assert!(db
            .find_workspace_by_path("C:\\projetos\\inexistente")
            .expect("buscar")
            .is_none());

        let duplicate = db.create_workspace("Outro nome", "C:\\projetos\\alpha");
        let error = duplicate.expect_err("caminho duplicado é rejeitado");
        assert!(
            format!("{error}").contains("já existe"),
            "erro amigável: {error}"
        );
        assert!(db.create_workspace("Vazio", "   ").is_err());

        let beta = db
            .create_workspace("Beta", "C:\\projetos\\beta")
            .expect("criar beta");
        let listed = db.list_workspaces().expect("listar");
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, alpha.id, "empate de data: ordena por nome");
        assert_eq!(listed[1].id, beta.id);
    }

    #[test]
    fn updates_pins_trusts_and_opens_workspaces() {
        let db = test_db();
        let workspace = db
            .create_workspace("Projeto", "C:\\projetos\\p")
            .expect("criar");
        let created_at = workspace.created_at;

        db.set_workspace_pinned(&workspace.id, true)
            .expect("fixar");
        db.set_workspace_trusted(&workspace.id, true)
            .expect("confiar");
        db.mark_workspace_opened(&workspace.id).expect("abrir");
        let mut loaded = db
            .get_workspace(&workspace.id)
            .expect("get")
            .expect("presente");
        assert!(loaded.pinned);
        assert!(loaded.trusted);
        assert!(
            loaded.last_opened_at.is_some_and(|value| value >= created_at),
            "last_opened_at carimbado"
        );
        assert!(loaded.updated_at >= created_at);

        // `update_workspace` grava o estado completo do struct (inclusive
        // pinned/trusted), por isso parte do estado recém-lido.
        loaded.name = "Projeto renomeado".to_string();
        loaded.pinned = false;
        db.update_workspace(&loaded).expect("atualizar metadados");
        let reloaded = db
            .get_workspace(&workspace.id)
            .expect("get")
            .expect("presente");
        assert_eq!(reloaded.name, "Projeto renomeado");
        assert!(!reloaded.pinned);
        assert!(reloaded.trusted);

        // `mark_workspace_opened` ordena a sidebar pelo último acesso.
        let other = db
            .create_workspace("Outro", "C:\\projetos\\o")
            .expect("criar outro");
        db.mark_workspace_opened(&other.id).expect("abrir outro");
        let listed = db.list_workspaces().expect("listar");
        assert_eq!(listed[0].id, other.id, "último aberto vem primeiro");

        db.touch_workspace(&other.id).expect("touch");
        let missing = Workspace {
            id: "ws-inexistente".to_string(),
            ..other.clone()
        };
        assert!(
            db.update_workspace(&missing).is_err(),
            "update de workspace desconhecido é erro claro"
        );
    }

    #[test]
    fn deletes_workspace_unlinks_sessions_and_drops_its_rules() {
        let db = test_db();
        let workspace = db
            .create_workspace("App", "C:\\projetos\\app")
            .expect("criar workspace");
        let conversation = code_conversation(&db);
        db.set_conversation_workspace(&conversation.id, Some(&workspace.id))
            .expect("associar");
        db.create_approval_rule(&code_harness_rule(
            ApprovalScope::Workspace,
            Some(&workspace.id),
            "shell",
        ))
        .expect("regra do workspace");
        assert_eq!(db.list_approval_rules().expect("regras").len(), 1);

        assert!(db.delete_workspace(&workspace.id).expect("remover"));
        assert!(
            !db.delete_workspace(&workspace.id).expect("remover de novo"),
            "segunda remoção devolve false"
        );
        let reloaded = db
            .get_conversation(&conversation.id)
            .expect("get")
            .expect("sessão sobrevive");
        assert!(reloaded.workspace_id.is_none(), "sessão fica sem workspace");
        assert!(
            db.list_approval_rules().expect("regras").is_empty(),
            "regras de escopo do workspace são apagadas junto"
        );
    }

    #[test]
    fn appends_code_events_with_monotonic_seq_per_conversation() {
        let db = test_db();
        let first = db
            .append_code_event("conv-1", Some("turn-1"), "step", r#"{"step":1}"#)
            .expect("evento 1");
        let second = db
            .append_code_event("conv-1", None, "tool", r#"{"tool":"read"}"#)
            .expect("evento 2");
        let third = db
            .append_code_event("conv-1", Some("turn-2"), "step", r#"{"step":2}"#)
            .expect("evento 3");
        assert_eq!((first.seq, second.seq, third.seq), (1, 2, 3));
        assert_eq!(first.turn_id.as_deref(), Some("turn-1"));
        assert_eq!(second.turn_id, None);
        assert_eq!(first.conversation_id, "conv-1");
        assert_eq!(first.kind, "step");

        let other = db
            .append_code_event("conv-2", None, "step", "{}")
            .expect("outra conversa");
        assert_eq!(other.seq, 1, "o seq é por conversa");

        let from_two = db.list_code_events("conv-1", 2).expect("listar desde seq 2");
        assert_eq!(
            from_two.iter().map(|event| event.seq).collect::<Vec<_>>(),
            vec![2, 3]
        );
        assert!(db
            .list_code_events("conv-1", 9)
            .expect("listar")
            .is_empty());

        let latest_step = db
            .latest_code_event("conv-1", "step")
            .expect("último step")
            .expect("presente");
        assert_eq!(latest_step.seq, 3);
        assert!(db
            .latest_code_event("conv-1", "inexistente")
            .expect("último")
            .is_none());
        assert!(db
            .append_code_event("conv-1", None, "   ", "{}")
            .is_err());
    }

    #[test]
    fn journals_file_changes_per_turn_and_conversation() {
        let db = test_db();
        let created = FileJournalEntry::new(
            "conv-1",
            "turn-1",
            "src/main.rs",
            FileChangeKind::Created,
        )
        .with_hashes(None, Some("abc123"))
        .with_line_counts(12, 0);
        let id = db.append_file_journal(&created).expect("journal");
        assert!(id > 0);

        let modified = FileJournalEntry::new(
            "conv-1",
            "turn-1",
            "src/lib.rs",
            FileChangeKind::Modified,
        )
        .with_hashes(Some("old"), Some("new"))
        .with_line_counts(4, 2);
        db.append_file_journal(&modified).expect("journal 2");
        db.append_file_journal(&FileJournalEntry::new(
            "conv-1",
            "turn-2",
            "README.md",
            FileChangeKind::Deleted,
        ))
        .expect("journal 3");

        let turn = db
            .list_file_journal_for_turn("conv-1", "turn-1")
            .expect("por turno");
        assert_eq!(turn.len(), 2);
        assert_eq!(turn[0].path, "src/main.rs");
        assert_eq!(turn[0].change_kind, FileChangeKind::Created);
        assert_eq!(turn[0].after_hash.as_deref(), Some("abc123"));
        assert_eq!((turn[0].added, turn[0].removed), (Some(12), Some(0)));
        assert_eq!(turn[1].change_kind, FileChangeKind::Modified);
        assert_eq!(turn[1].before_hash.as_deref(), Some("old"));

        let all = db.list_file_journal("conv-1").expect("por conversa");
        assert_eq!(all.len(), 3);
        assert_eq!(all[2].change_kind, FileChangeKind::Deleted);
        assert!(db
            .list_file_journal_for_turn("conv-1", "turn-9")
            .expect("vazio")
            .is_empty());

        assert!(db
            .append_file_journal(&FileJournalEntry::new(
                "conv-1",
                "turn-1",
                "  ",
                FileChangeKind::Modified,
            ))
            .is_err());
        assert!(db
            .append_file_journal(&FileJournalEntry::new(
                "conv-1",
                "  ",
                "a.txt",
                FileChangeKind::Modified,
            ))
            .is_err());
    }

    #[test]
    fn session_summaries_roundtrip_and_latest() {
        let db = test_db();
        let first = db
            .insert_session_summary("conv-1", 1, 10, "Resumo inicial", Some(500))
            .expect("resumo 1");
        assert_eq!(first.from_seq, 1);
        assert_eq!(first.tokens, Some(500));
        assert_eq!(first.content, "Resumo inicial");
        db.insert_session_summary("conv-1", 11, 20, "Resumo seguinte", None)
            .expect("resumo 2");
        db.insert_session_summary("conv-2", 1, 5, "Outra sessão", Some(1))
            .expect("outra sessão");

        let listed = db.list_session_summaries("conv-1").expect("listar");
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].from_seq, 1);
        let latest = db
            .latest_session_summary("conv-1")
            .expect("último")
            .expect("presente");
        assert_eq!(latest.to_seq, 20);
        assert_eq!(latest.tokens, None);
        assert!(db
            .latest_session_summary("conv-9")
            .expect("último")
            .is_none());

        assert!(db
            .insert_session_summary("conv-1", 0, 5, "x", None)
            .is_err());
        assert!(db
            .insert_session_summary("conv-1", 10, 5, "x", None)
            .is_err());
    }

    #[test]
    fn approval_rules_scope_lookup_and_delete() {
        let db = test_db();
        db.create_approval_rule(&code_harness_rule(ApprovalScope::Global, None, "shell"))
            .expect("global");
        db.create_approval_rule(&code_harness_rule(
            ApprovalScope::Session,
            Some("conv-1"),
            "shell",
        ))
        .expect("sessão 1");
        db.create_approval_rule(&code_harness_rule(
            ApprovalScope::Session,
            Some("conv-2"),
            "shell",
        ))
        .expect("sessão 2");
        db.create_approval_rule(&code_harness_rule(
            ApprovalScope::Workspace,
            Some("ws-1"),
            "shell",
        ))
        .expect("workspace 1");
        db.create_approval_rule(&code_harness_rule(
            ApprovalScope::Workspace,
            Some("ws-2"),
            "shell",
        ))
        .expect("workspace 2");

        assert_eq!(db.list_approval_rules().expect("todas").len(), 5);
        assert_eq!(
            db.list_approval_rules_for_scope(ApprovalScope::Global, None)
                .expect("global")
                .len(),
            1
        );
        let session = db
            .list_approval_rules_for_scope(ApprovalScope::Session, Some("conv-1"))
            .expect("sessão");
        assert_eq!(session.len(), 1);
        assert_eq!(session[0].scope_id.as_deref(), Some("conv-1"));
        assert_eq!(session[0].decision, ApprovalDecision::Approved);
        assert_eq!(session[0].matcher, "prefix");
        assert_eq!(session[0].pattern, "npm run");

        // Contexto da política: globais + regras da sessão + regras do workspace.
        let context = db
            .list_approval_rules_for_context(Some("conv-1"), Some("ws-1"))
            .expect("contexto");
        assert_eq!(context.len(), 3);
        let only_session = db
            .list_approval_rules_for_context(Some("conv-2"), None)
            .expect("contexto sem workspace");
        assert_eq!(only_session.len(), 2);

        assert!(db
            .create_approval_rule(&NewApprovalRule {
                scope: ApprovalScope::Global,
                scope_id: None,
                tool: "  ",
                matcher: "exact",
                pattern: "x",
                decision: ApprovalDecision::Denied,
            })
            .is_err());
        assert!(db
            .create_approval_rule(&NewApprovalRule {
                scope: ApprovalScope::Global,
                scope_id: None,
                tool: "shell",
                matcher: " ",
                pattern: "x",
                decision: ApprovalDecision::Denied,
            })
            .is_err());

        assert_eq!(
            db.delete_approval_rules_for_scope(ApprovalScope::Workspace, Some("ws-1"))
                .expect("apagar escopo"),
            1
        );
        assert_eq!(db.list_approval_rules().expect("todas").len(), 4);
        let single = db
            .create_approval_rule(&code_harness_rule(
                ApprovalScope::Session,
                Some("conv-1"),
                "shell",
            ))
            .expect("regra individual");
        assert!(db.delete_approval_rule(&single.id).expect("apagar"));
        assert!(!db.delete_approval_rule(&single.id).expect("apagar de novo"));
    }

    #[test]
    fn associates_workspace_and_updates_session_settings() {
        let db = test_db();
        let workspace = db
            .create_workspace("App", "C:\\projetos\\app")
            .expect("workspace");
        let conversation = code_conversation(&db);
        assert!(conversation.workspace_id.is_none());
        assert_eq!(conversation.agent_kind, "lumina");
        assert_eq!(conversation.permission_mode, PermissionMode::Edit);

        db.set_conversation_workspace(&conversation.id, Some(&workspace.id))
            .expect("associar workspace");
        let loaded = db
            .get_conversation(&conversation.id)
            .expect("get")
            .expect("presente");
        assert_eq!(
            loaded.workspace_id.as_deref(),
            Some(workspace.id.as_str())
        );
        assert_eq!(
            db.list_conversations_for_workspace(&workspace.id)
                .expect("sessões do workspace")
                .len(),
            1
        );

        db.set_conversation_permission_mode(&conversation.id, PermissionMode::ReadOnly)
            .expect("modo de permissão");
        assert_eq!(
            db.get_conversation_permission_mode(&conversation.id)
                .expect("ler modo"),
            Some(PermissionMode::ReadOnly)
        );
        let loaded = db
            .get_conversation(&conversation.id)
            .expect("get")
            .expect("presente");
        assert_eq!(loaded.permission_mode, PermissionMode::ReadOnly);

        db.set_conversation_agent_kind(&conversation.id, " acp:codex ")
            .expect("motor do agente");
        let loaded = db
            .get_conversation(&conversation.id)
            .expect("get")
            .expect("presente");
        assert_eq!(loaded.agent_kind, "acp:codex");

        db.clear_conversation_workspace(&conversation.id)
            .expect("desassociar");
        let loaded = db
            .get_conversation(&conversation.id)
            .expect("get")
            .expect("presente");
        assert!(loaded.workspace_id.is_none());

        // Erros orientativos para ids/campos inválidos.
        assert!(db
            .set_conversation_workspace(&conversation.id, Some("ws-inexistente"))
            .is_err());
        assert!(db
            .set_conversation_workspace("conv-inexistente", None)
            .is_err());
        assert!(db
            .set_conversation_agent_kind(&conversation.id, "   ")
            .is_err());
        assert!(db
            .set_conversation_permission_mode("conv-inexistente", PermissionMode::Edit)
            .is_err());
        assert_eq!(
            db.get_conversation_permission_mode("conv-inexistente")
                .expect("sem conversa"),
            None
        );
        assert!(db
            .list_conversations_for_workspace("ws-inexistente")
            .expect("workspace sem sessões")
            .is_empty());
    }

    #[test]
    fn delete_conversation_cleans_code_harness_records() {
        let db = test_db();
        let workspace = db
            .create_workspace("App", "C:\\projetos\\app")
            .expect("workspace");
        let conversation = code_conversation(&db);
        db.set_conversation_workspace(&conversation.id, Some(&workspace.id))
            .expect("associar");
        db.append_code_event(&conversation.id, Some("turn-1"), "step", "{}")
            .expect("evento");
        db.append_file_journal(&FileJournalEntry::new(
            &conversation.id,
            "turn-1",
            "a.txt",
            FileChangeKind::Created,
        ))
        .expect("journal");
        db.insert_session_summary(&conversation.id, 1, 5, "resumo", None)
            .expect("resumo");
        db.create_approval_rule(&NewApprovalRule {
            scope: ApprovalScope::Session,
            scope_id: Some(&conversation.id),
            tool: "shell",
            matcher: "exact",
            pattern: "ls",
            decision: ApprovalDecision::Approved,
        })
        .expect("regra da sessão");
        db.create_approval_rule(&NewApprovalRule {
            scope: ApprovalScope::Workspace,
            scope_id: Some(&workspace.id),
            tool: "shell",
            matcher: "exact",
            pattern: "ls",
            decision: ApprovalDecision::Approved,
        })
        .expect("regra do workspace");

        db.delete_conversation(&conversation.id)
            .expect("excluir sessão");

        assert!(db
            .list_code_events(&conversation.id, 0)
            .expect("eventos")
            .is_empty());
        assert!(db
            .list_file_journal(&conversation.id)
            .expect("journal")
            .is_empty());
        assert!(db
            .list_session_summaries(&conversation.id)
            .expect("resumos")
            .is_empty());
        let rules = db.list_approval_rules().expect("regras restantes");
        assert_eq!(rules.len(), 1, "só a regra do workspace sobrevive");
        assert_eq!(rules[0].scope, ApprovalScope::Workspace);
        assert!(
            db.get_workspace(&workspace.id)
                .expect("workspace")
                .is_some(),
            "apagar a sessão não apaga o workspace"
        );
    }

    #[test]
    fn reset_clears_code_harness_records() {
        let db = test_db();
        let workspace = db
            .create_workspace("App", "C:\\projetos\\app")
            .expect("workspace");
        let conversation = code_conversation(&db);
        db.set_conversation_workspace(&conversation.id, Some(&workspace.id))
            .expect("associar");
        db.append_code_event(&conversation.id, Some("turn-1"), "step", "{}")
            .expect("evento");
        db.append_file_journal(&FileJournalEntry::new(
            &conversation.id,
            "turn-1",
            "a.txt",
            FileChangeKind::Modified,
        ))
        .expect("journal");
        db.insert_session_summary(&conversation.id, 1, 5, "resumo", None)
            .expect("resumo");
        db.create_approval_rule(&code_harness_rule(ApprovalScope::Global, None, "shell"))
            .expect("regra global");

        db.reset().expect("reset");

        assert!(db.list_workspaces().expect("workspaces").is_empty());
        assert!(db
            .list_code_events(&conversation.id, 0)
            .expect("eventos")
            .is_empty());
        assert!(db
            .list_file_journal(&conversation.id)
            .expect("journal")
            .is_empty());
        assert!(db
            .list_session_summaries(&conversation.id)
            .expect("resumos")
            .is_empty());
        assert!(db.list_approval_rules().expect("regras").is_empty());
    }
}
