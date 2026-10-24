//! SQLite persistence (conversations, messages, attachments, artifacts, usage).

use std::path::Path;

use crate::domain::{
    Artifact, AttachmentInfo, ChatMessage, Conversation, ConversationDetail, UsageInfo,
};

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

pub struct Db {
    conn: parking_lot::Mutex<rusqlite::Connection>,
}

impl Db {
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        let _ = path;
        todo!("implemented by the storage module")
    }

    /* ---------------- conversations ---------------- */

    pub fn list_conversations(&self) -> anyhow::Result<Vec<Conversation>> {
        todo!("implemented by the storage module")
    }

    pub fn create_conversation(
        &self,
        title: &str,
        provider_id: &str,
        model_id: &str,
    ) -> anyhow::Result<Conversation> {
        let _ = (title, provider_id, model_id);
        todo!("implemented by the storage module")
    }

    pub fn get_conversation(&self, id: &str) -> anyhow::Result<Option<Conversation>> {
        let _ = id;
        todo!("implemented by the storage module")
    }

    pub fn get_conversation_detail(
        &self,
        id: &str,
    ) -> anyhow::Result<Option<ConversationDetail>> {
        let _ = id;
        todo!("implemented by the storage module")
    }

    pub fn rename_conversation(&self, id: &str, title: &str) -> anyhow::Result<()> {
        let _ = (id, title);
        todo!("implemented by the storage module")
    }

    pub fn delete_conversation(&self, id: &str) -> anyhow::Result<()> {
        let _ = id;
        todo!("implemented by the storage module")
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> anyhow::Result<()> {
        let _ = (id, pinned);
        todo!("implemented by the storage module")
    }

    pub fn search_conversations(&self, query: &str) -> anyhow::Result<Vec<Conversation>> {
        let _ = query;
        todo!("implemented by the storage module")
    }

    pub fn touch_conversation(&self, id: &str) -> anyhow::Result<()> {
        let _ = id;
        todo!("implemented by the storage module")
    }

    pub fn update_conversation_model(
        &self,
        id: &str,
        provider_id: &str,
        model_id: &str,
    ) -> anyhow::Result<()> {
        let _ = (id, provider_id, model_id);
        todo!("implemented by the storage module")
    }

    /* ---------------- messages ---------------- */

    pub fn list_messages(&self, conversation_id: &str) -> anyhow::Result<Vec<ChatMessage>> {
        let _ = conversation_id;
        todo!("implemented by the storage module")
    }

    pub fn get_message(&self, id: &str) -> anyhow::Result<Option<ChatMessage>> {
        let _ = id;
        todo!("implemented by the storage module")
    }

    pub fn insert_message(&self, message: &ChatMessage) -> anyhow::Result<()> {
        let _ = message;
        todo!("implemented by the storage module")
    }

    pub fn update_message(&self, message: &ChatMessage) -> anyhow::Result<()> {
        let _ = message;
        todo!("implemented by the storage module")
    }

    /// Deletes `message_id` and every message after it (used by edit/regenerate).
    pub fn delete_messages_from(
        &self,
        conversation_id: &str,
        message_id: &str,
    ) -> anyhow::Result<()> {
        let _ = (conversation_id, message_id);
        todo!("implemented by the storage module")
    }

    /* ---------------- attachments ---------------- */

    pub fn insert_attachment(&self, attachment: &StoredAttachment) -> anyhow::Result<()> {
        let _ = attachment;
        todo!("implemented by the storage module")
    }

    pub fn get_attachment(&self, id: &str) -> anyhow::Result<Option<StoredAttachment>> {
        let _ = id;
        todo!("implemented by the storage module")
    }

    pub fn delete_attachment(&self, id: &str) -> anyhow::Result<()> {
        let _ = id;
        todo!("implemented by the storage module")
    }

    /* ---------------- artifacts ---------------- */

    pub fn insert_artifact(&self, artifact: &StoredArtifact) -> anyhow::Result<()> {
        let _ = artifact;
        todo!("implemented by the storage module")
    }

    pub fn list_artifacts(&self, conversation_id: &str) -> anyhow::Result<Vec<Artifact>> {
        let _ = conversation_id;
        todo!("implemented by the storage module")
    }

    pub fn get_artifact(&self, id: &str) -> anyhow::Result<Option<StoredArtifact>> {
        let _ = id;
        todo!("implemented by the storage module")
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
        let _ = (conversation_id, message_id, provider_id, model_id, usage);
        todo!("implemented by the storage module")
    }

    pub fn usage_summary(&self) -> anyhow::Result<serde_json::Value> {
        todo!("implemented by the storage module")
    }

    /// Deletes every conversation, message, attachment and artifact.
    pub fn reset(&self) -> anyhow::Result<()> {
        todo!("implemented by the storage module")
    }
}
