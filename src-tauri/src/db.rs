//! SQLite persistence (conversations, messages, attachments, artifacts, usage).
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
    now_ms, Artifact, ArtifactKind, AttachmentInfo, ChatMessage, Conversation, ConversationDetail,
    LibraryArtifact, MessageRole, MessageStatus, UsageInfo,
};

/* ------------------------------------------------------------------ */
/* Column lists                                                        */
/* ------------------------------------------------------------------ */

const CONVERSATION_COLUMNS: &str = "id, title, created_at, updated_at, pinned, \
     provider_id, model_id, message_count, preview";

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
  preview       TEXT
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

    pub fn create_conversation(
        &self,
        title: &str,
        provider_id: &str,
        model_id: &str,
    ) -> anyhow::Result<Conversation> {
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
                 provider_id, model_id, message_count, preview) \
                 VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, 0, NULL)",
                params![&id, title, now, now, provider_id, model_id],
            )
            .context("falha ao criar conversa")?;
        }
        self.get_conversation(&id)?
            .ok_or_else(|| anyhow::anyhow!("conversa recém-criada não encontrada"))
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
             c.provider_id, c.model_id, c.message_count, c.preview \
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

    /// Deletes every conversation, message, attachment and artifact record.
    pub fn reset(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction()?;
        for table in [
            "messages",
            "artifacts",
            "attachments",
            "usage_log",
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
}
