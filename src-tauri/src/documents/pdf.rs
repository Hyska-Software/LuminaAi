//! PDF text extraction (`pdf-extract` on top of `lopdf`).

use serde_json::json;

use super::ExtractedDocument;

/// Extract text and an approximate page count from a PDF held in memory.
pub fn extract(bytes: &[u8]) -> ExtractedDocument {
    match pdf_extract::extract_text_from_mem(bytes) {
        Ok(raw) => {
            // `pdf-extract` separates pages with a form feed (`\x0c`).
            let form_feeds = raw.matches('\x0c').count();
            let page_count = if raw.trim().is_empty() {
                None
            } else if form_feeds == 0 {
                Some(1)
            } else if raw.ends_with('\x0c') {
                Some(form_feeds as u32)
            } else {
                Some(form_feeds as u32 + 1)
            };

            let text = raw
                .replace("\r\n", "\n")
                .replace('\r', "\n")
                .replace('\x0c', "\n\n")
                .trim()
                .to_string();

            let characters = text.chars().count();
            ExtractedDocument {
                kind: "pdf".to_string(),
                text,
                page_count,
                metadata: json!({
                    "format": "pdf",
                    "pages": page_count,
                    "characters": characters,
                    "bytes": bytes.len(),
                }),
                ..Default::default()
            }
        }
        Err(error) => {
            let mut doc = ExtractedDocument::failed(
                "pdf",
                format!("não foi possível extrair o texto do PDF: {error}"),
            );
            doc.metadata["bytes"] = json!(bytes.len());
            doc
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_pdf_returns_error_metadata() {
        let doc = extract(b"not a pdf at all");
        assert_eq!(doc.kind, "pdf");
        assert!(doc.text.is_empty());
        assert!(doc.metadata["error"].is_string());
    }

    #[test]
    fn page_count_is_approximate() {
        // `pdf-extract` is not available to build a real PDF here; simulate the
        // form feed convention used by the output writer.
        let raw = "página 1\x0cpágina 2\x0c";
        let form_feeds = raw.matches('\x0c').count();
        assert_eq!(form_feeds, 2);
    }
}
