//! Attachment text extraction.
//!
//! Every supported file type is converted into plain text (and, for images,
//! base64 data) that the harness injects into the conversation context.

use serde_json::{json, Value};

pub mod image;
pub mod office;
pub mod pdf;
pub mod preview;
pub mod text;

/// Maximum number of characters kept per document (roughly 100k tokens).
pub const MAX_TEXT_CHARS: usize = 400_000;

#[derive(Debug, Clone, Default)]
pub struct ExtractedDocument {
    /// image | pdf | docx | xlsx | pptx | text | code | csv | json | unknown
    pub kind: String,
    pub text: String,
    pub page_count: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Saída documentada da extração de imagens (ARCHITECTURE: "Imagens |
    /// metadados + base64"), parte do contrato de `ExtractedDocument` e lida
    /// pelos testes de extração; ainda não consumida pelo fluxo de produção.
    #[allow(dead_code)]
    pub image_base64: Option<String>,
    /// MIME da imagem extraída, par de `image_base64` no contrato de extração.
    #[allow(dead_code)]
    pub image_mime: Option<String>,
    pub truncated: bool,
    pub metadata: Value,
}

impl ExtractedDocument {
    fn failed(kind: impl Into<String>, message: impl Into<String>) -> Self {
        let kind = kind.into();
        Self {
            metadata: json!({ "error": message.into(), "format": kind }),
            kind,
            ..Default::default()
        }
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
        "pptx" | "ppt" => "pptx",
        "xlsx" | "xls" | "ods" => "xlsx",
        "csv" | "tsv" => "csv",
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "svg" | "avif" => "image",
        "json" | "jsonl" => "json",
        "txt" | "log" => "text",
        "md" | "markdown" | "rst" | "html" | "htm" | "xml" => "text",
        "rs" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "py" | "rb" | "go" | "java"
        | "kt" | "kts" | "c" | "h" | "cpp" | "cc" | "cxx" | "hpp" | "cs" | "php" | "swift"
        | "sh" | "bash" | "zsh" | "ps1" | "sql" | "lua" | "r" | "scala" | "dart" | "ex"
        | "exs" | "erl" | "hs" | "clj" | "elm" | "zig" | "nim" | "vue" | "svelte" => "code",
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

/// Decode raw text bytes, honouring a declared charset and falling back to
/// BOM / UTF-8 / charset detection. Shared with the web tools.
pub(crate) fn decode_text(bytes: &[u8], declared_charset: Option<&str>) -> String {
    text::decode(bytes, declared_charset).0
}

/// Extract text (and image data) from an attachment.
///
/// Never panics on malformed input: parse failures are reported as an empty
/// document whose `metadata.error` explains what happened.
pub fn extract(bytes: &[u8], filename: &str, mime_type: &str) -> anyhow::Result<ExtractedDocument> {
    if bytes.is_empty() {
        let kind = guess_kind(filename, mime_type);
        return Ok(ExtractedDocument::failed(kind, "arquivo vazio"));
    }

    let mut mime = mime_type.trim().to_lowercase();
    if mime.is_empty() || mime == "application/octet-stream" {
        if let Some(kind) = infer::get(bytes) {
            mime = kind.mime_type().to_string();
        }
    }

    let kind = guess_kind(filename, &mime);
    let doc = match kind.as_str() {
        "pdf" => guarded("pdf", || pdf::extract(bytes)),
        "docx" => guarded("docx", || office::extract_docx(bytes)),
        "pptx" => guarded("pptx", || office::extract_pptx(bytes)),
        "xlsx" => guarded("xlsx", || office::extract_spreadsheet(bytes, filename, &mime)),
        "csv" => guarded("csv", || text::extract_csv(bytes, filename, &mime)),
        "image" => guarded("image", || image::extract(bytes, &mime)),
        "unknown" => {
            if looks_like_text(bytes) {
                guarded("text", || text::extract_plain(bytes, "text", &mime))
            } else {
                ExtractedDocument::failed("unknown", "formato de arquivo não suportado")
            }
        }
        _ => guarded(kind.as_str(), || text::extract_plain(bytes, &kind, &mime)),
    };

    Ok(finalize(doc))
}

/// Run an extraction routine, turning panics from third-party parsers into a
/// graceful failure document. (`panic = "abort"` in release builds means this
/// only guards debug/test runs, but the parsers are also written to return
/// errors rather than panic.)
fn guarded(
    kind: &str,
    run: impl FnOnce() -> ExtractedDocument + std::panic::UnwindSafe,
) -> ExtractedDocument {
    match std::panic::catch_unwind(run) {
        Ok(doc) => doc,
        Err(_) => ExtractedDocument::failed(kind, "falha inesperada ao processar o arquivo"),
    }
}

fn looks_like_text(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(4096)];
    if std::str::from_utf8(sample).is_ok() {
        return true;
    }
    sample.iter().filter(|b| **b == 0).count() * 20 < sample.len()
}

fn finalize(mut doc: ExtractedDocument) -> ExtractedDocument {
    let was_truncated = doc.truncated;
    if doc.text.len() > MAX_TEXT_CHARS {
        let count = doc.text.chars().count();
        if count > MAX_TEXT_CHARS {
            let mut out = String::with_capacity(MAX_TEXT_CHARS);
            for (index, ch) in doc.text.chars().enumerate() {
                if index >= MAX_TEXT_CHARS {
                    break;
                }
                out.push(ch);
            }
            doc.text = out;
            doc.truncated = true;
        }
    }
    doc.truncated |= was_truncated;
    if doc.metadata.is_null() {
        doc.metadata = json!({});
    }
    doc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guesses_common_kinds() {
        assert_eq!(guess_kind("relatorio.PDF", ""), "pdf");
        assert_eq!(guess_kind("notas.docx", ""), "docx");
        assert_eq!(guess_kind("slides.pptx", ""), "pptx");
        assert_eq!(guess_kind("dados.xlsx", ""), "xlsx");
        assert_eq!(guess_kind("dados.csv", ""), "csv");
        assert_eq!(guess_kind("tabela.tsv", ""), "csv");
        assert_eq!(guess_kind("main.rs", "text/plain"), "code");
        assert_eq!(guess_kind("app.tsx", ""), "code");
        assert_eq!(guess_kind("foto.png", ""), "image");
        assert_eq!(guess_kind("blob.bin", "application/octet-stream"), "unknown");
    }

    #[test]
    fn extracts_plain_utf8_text() {
        let doc = extract("olá mundo\nsegunda linha".as_bytes(), "nota.txt", "text/plain")
            .expect("extract should succeed");
        assert_eq!(doc.kind, "text");
        assert!(doc.text.contains("olá mundo"));
        assert!(!doc.truncated);
    }

    #[test]
    fn decodes_windows_1252_text() {
        // "Ação" encoded as windows-1252 (0xE7 = ç, 0xE3 = ã).
        let bytes = b"A\xe7\xe3o conclu\xedda";
        let doc = extract(bytes, "nota.txt", "text/plain").expect("extract should succeed");
        assert!(doc.text.contains("Ação concluída"), "got {:?}", doc.text);
    }

    #[test]
    fn corrupt_pdf_does_not_panic() {
        let doc = extract(b"%PDF-1.4 definitely-not-a-pdf", "ruim.pdf", "application/pdf")
            .expect("extract should succeed");
        assert_eq!(doc.kind, "pdf");
        assert!(doc.text.is_empty());
        assert!(doc.metadata.get("error").is_some());
    }

    #[test]
    fn unknown_binary_is_reported() {
        let doc = extract(&[0u8, 159, 146, 150, 0, 1], "blob.bin", "application/octet-stream")
            .expect("extract should succeed");
        assert_eq!(doc.kind, "unknown");
        assert!(doc.text.is_empty());
    }

    #[test]
    fn extracts_csv_with_quotes_and_metadata() {
        let csv = "nome,valor\n\"silva, joão\",12\nmaria,7\n";
        let doc = extract(csv.as_bytes(), "dados.csv", "text/csv").expect("extract should succeed");
        assert_eq!(doc.kind, "csv");
        assert!(doc.text.contains("silva, joão"));
        assert_eq!(doc.metadata["rows"], 3);
        assert_eq!(doc.metadata["columns"], 2);
    }

    #[test]
    fn extracts_tsv_by_extension() {
        let tsv = "a\tb\tc\n1\t2\t3\n";
        let doc = extract(tsv.as_bytes(), "dados.tsv", "").expect("extract should succeed");
        assert_eq!(doc.kind, "csv");
        assert_eq!(doc.metadata["delimiter"], "\t");
        assert!(doc.text.contains("1\t2\t3"));
    }

    /* ---------------- real-world fixtures (TDD) ---------------- */

    const PDF: &[u8] = include_bytes!("testdata/contrato-servicos.pdf");
    const DOCX: &[u8] = include_bytes!("testdata/relatorio-trimestral.docx");
    const XLSX: &[u8] = include_bytes!("testdata/vendas-q3.xlsx");
    const PPTX: &[u8] = include_bytes!("testdata/apresentacao-q3.pptx");
    const PNG: &[u8] = include_bytes!("testdata/grafico-receita.png");
    const MD: &[u8] = include_bytes!("testdata/notas-reuniao.md");

    #[test]
    fn extracts_pdf_text_from_every_page() {
        let doc = extract(PDF, "contrato-servicos.pdf", "application/pdf").expect("pdf extract");
        assert_eq!(doc.kind, "pdf");
        assert!(doc.text.contains("Aurora Analytics"), "got {:?}", &doc.text[..doc.text.len().min(400)]);
        assert!(doc.text.contains("Clausula 2"), "first page clause missing");
        assert!(doc.text.contains("Anexo I"), "second page content missing");
    }

    #[test]
    fn extracts_docx_paragraphs_list_and_table() {
        let doc = extract(
            DOCX,
            "relatorio-trimestral.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        .expect("docx extract");
        assert_eq!(doc.kind, "docx");
        assert!(doc.text.contains("Relatório Trimestral"));
        assert!(doc.text.contains("26"), "list item count missing");
        assert!(doc.text.contains("Plataforma"), "table cell missing");
        assert!(doc.text.contains("2.910.000"), "table value missing");
    }

    #[test]
    fn extracts_xlsx_sheets_and_cells() {
        let doc = extract(
            XLSX,
            "vendas-q3.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .expect("xlsx extract");
        assert_eq!(doc.kind, "xlsx");
        assert!(doc.text.contains("Vendas"), "sheet name missing");
        assert!(doc.text.contains("Setembro"));
        assert!(doc.text.contains("1830000") || doc.text.contains("1.830.000"));
        assert!(doc.text.contains("Metas"), "second sheet missing");
    }

    #[test]
    fn extracts_pptx_slides() {
        let doc = extract(
            PPTX,
            "apresentacao-q3.pptx",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
        .expect("pptx extract");
        assert_eq!(doc.kind, "pptx");
        assert!(doc.text.contains("Resultados Q3 2026"));
        assert!(doc.text.contains("Próximos passos"));
        assert!(doc.text.contains("engenheiros de dados"));
    }

    #[test]
    fn extracts_image_dimensions_and_base64() {
        let doc = extract(PNG, "grafico-receita.png", "image/png").expect("image extract");
        assert_eq!(doc.kind, "image");
        assert_eq!(doc.width, Some(960));
        assert_eq!(doc.height, Some(540));
        let encoded = doc.image_base64.expect("image payload");
        assert!(encoded.starts_with("iVBOR"), "expected PNG base64 prefix");
        assert_eq!(doc.image_mime.as_deref(), Some("image/png"));
    }

    #[test]
    fn detects_image_mime_when_only_bytes_are_known() {
        let doc = extract(PNG, "captura-sem-extensao", "").expect("image extract");
        assert_eq!(doc.kind, "image");
        assert_eq!(doc.width, Some(960));
    }

    #[test]
    fn extracts_markdown_notes() {
        let doc = extract(MD, "notas-reuniao.md", "text/markdown").expect("markdown extract");
        assert_eq!(doc.kind, "text");
        assert!(doc.text.contains("Decisões"));
        assert!(doc.text.contains("conector de ERP"));
    }

    #[test]
    fn truncates_very_large_documents() {
        let mut big = String::with_capacity(MAX_TEXT_CHARS + 200_000);
        while big.chars().count() < MAX_TEXT_CHARS + 100_000 {
            big.push_str("linha de teste com acentuação é ção\n");
        }
        let doc = extract(big.as_bytes(), "grande.txt", "text/plain").expect("extract should succeed");
        assert!(doc.truncated, "large document must be flagged as truncated");
        assert!(doc.text.chars().count() <= MAX_TEXT_CHARS);
    }
}
