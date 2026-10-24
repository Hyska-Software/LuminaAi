//! Attachment text extraction.
//!
//! Every supported file type is converted into plain text (and, for images,
//! base64 data) that the harness injects into the conversation context.

use serde_json::Value;

/// Maximum number of characters kept per document (roughly 100k tokens).
pub const MAX_TEXT_CHARS: usize = 400_000;

#[derive(Debug, Clone)]
pub struct ExtractedDocument {
    /// image | pdf | docx | xlsx | pptx | text | code | csv | json | unknown
    pub kind: String,
    pub text: String,
    pub page_count: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub image_base64: Option<String>,
    pub image_mime: Option<String>,
    pub truncated: bool,
    pub metadata: Value,
}

impl ExtractedDocument {
    pub fn text_preview(&self) -> Option<String> {
        if self.text.trim().is_empty() {
            return None;
        }
        let preview: String = self.text.chars().take(280).collect();
        Some(preview)
    }
}

pub fn is_image_mime(mime: &str) -> bool {
    mime.starts_with("image/")
}

/// Classify a file into a stable `kind` slug used by the UI.
pub fn guess_kind(filename: &str, mime: &str) -> String {
    let lower = filename.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    let kind = match ext {
        "pdf" => "pdf",
        "docx" | "doc" => "docx",
        "xlsx" | "xls" | "ods" | "csv" | "tsv" => "xlsx",
        "pptx" | "ppt" => "pptx",
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "svg" | "avif" => "image",
        "json" | "jsonl" => "json",
        "txt" | "log" => "text",
        "md" | "markdown" | "rst" | "html" | "htm" | "xml" => "text",
        "csv" | "tsv" => "csv",
        _ => {
            if mime.starts_with("image/") {
                "image"
            } else if mime.starts_with("text/") || mime.contains("json") || mime.contains("xml") {
                "code"
            } else {
                "unknown"
            }
        }
    };
    kind.to_string()
}

/// Extract text (and image data) from an attachment.
pub fn extract(bytes: &[u8], filename: &str, mime_type: &str) -> anyhow::Result<ExtractedDocument> {
    let _ = (bytes, filename, mime_type);
    todo!("implemented by the documents module")
}
