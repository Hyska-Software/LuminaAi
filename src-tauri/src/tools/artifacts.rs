//! Shared artifact writer.
//!
//! Both `create_file` (text content) and `run_code` (files produced by a script)
//! funnel through [`write_artifact`]: the name is sanitized, the MIME type and
//! the [`ArtifactKind`] are inferred (explicit hint → extension → magic bytes),
//! the bytes are written to `<app-data>/artifacts/<id>/<name>` and the metadata
//! is persisted in SQLite.

use std::path::Path;

use anyhow::Context;

use crate::db::{Db, StoredArtifact};
use crate::domain::{now_ms, Artifact, ArtifactKind};

use super::clean_inline;

const MAX_NAME_CHARS: usize = 120;

/// Extensions rendered with syntax highlighting / treated as source code.
pub(crate) const CODE_EXTENSIONS: &[&str] = &[
    "rs", "go", "py", "rb", "java", "kt", "kts", "c", "h", "cpp", "cc", "cxx", "hpp", "cs",
    "php", "swift", "sh", "bash", "zsh", "ps1", "sql", "lua", "pl", "r", "scala", "dart", "ex",
    "exs", "erl", "hs", "clj", "elm", "zig", "nim", "vue", "svelte", "astro", "ts", "tsx", "js",
    "jsx", "mjs", "cjs",
];

/// Writes `bytes` as a new artifact, registers it in the database and returns
/// the persisted [`Artifact`] (whose `name` may have been sanitized/extended).
pub fn write_artifact(
    db: &Db,
    data_dir: &Path,
    conversation_id: &str,
    message_id: &str,
    name: &str,
    bytes: &[u8],
    mime_hint: Option<&str>,
) -> anyhow::Result<Artifact> {
    let mut name = sanitize_filename(name);
    let hint = clean_mime(mime_hint.unwrap_or_default());

    if !has_extension(&name) {
        let extension = extension_for_mime(&hint)
            .or_else(|| infer::get(bytes).map(|kind| kind.extension().to_string()))
            .unwrap_or_else(|| "txt".to_string());
        name.push('.');
        name.push_str(&extension);
    }

    let mut mime = resolve_mime(&name, &hint, bytes);
    let kind = artifact_kind(&mime, &name);
    // `.ts`/`.mjs` are typed as video/javascript by the MIME database; source
    // files are plain text for storage and preview purposes.
    if kind == ArtifactKind::Code
        && (mime.starts_with("video/") || mime == "application/octet-stream")
    {
        mime = "text/plain".to_string();
    }
    let language = if kind.is_textual() || kind == ArtifactKind::Code {
        language_for(&name)
    } else {
        None
    };

    let artifact_id = uuid::Uuid::new_v4().to_string();
    let directory = data_dir.join("artifacts").join(&artifact_id);
    std::fs::create_dir_all(&directory).with_context(|| {
        format!(
            "não foi possível criar o diretório do artefato: {}",
            directory.display()
        )
    })?;
    let path = directory.join(&name);
    std::fs::write(&path, bytes)
        .with_context(|| format!("não foi possível gravar `{name}` em {}", path.display()))?;

    let artifact = Artifact {
        id: artifact_id,
        conversation_id: conversation_id.to_string(),
        message_id: (!message_id.is_empty()).then(|| message_id.to_string()),
        name,
        mime_type: mime,
        kind,
        language,
        size: bytes.len() as i64,
        created_at: now_ms(),
    };
    db.insert_artifact(&StoredArtifact {
        artifact: artifact.clone(),
        path: path.to_string_lossy().into_owned(),
    })
    .with_context(|| {
        format!(
            "o arquivo `{}` foi gravado, mas o registro do artefato falhou",
            artifact.name
        )
    })?;
    Ok(artifact)
}

/// Explicit hint wins; otherwise the extension is authoritative and magic
/// bytes fill the gaps (unknown/missing/generic extension such as `.dat`).
fn resolve_mime(name: &str, hint: &str, bytes: &[u8]) -> String {
    if !hint.is_empty() {
        return hint.to_string();
    }
    let guessed = mime_guess::from_path(name).first_raw();
    if let Some(mime) = guessed.filter(|mime| !is_generic_mime(mime)) {
        return mime.to_string();
    }
    if let Some(kind) = infer::get(bytes) {
        return kind.mime_type().to_string();
    }
    guessed
        .unwrap_or("application/octet-stream")
        .to_string()
}

fn is_generic_mime(mime: &str) -> bool {
    matches!(
        mime,
        "application/octet-stream" | "binary/octet-stream" | "application/binary"
    )
}

fn clean_mime(raw: &str) -> String {
    raw.trim()
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

fn has_extension(name: &str) -> bool {
    let (stem, extension) = split_extension(name);
    !stem.is_empty() && !extension.is_empty()
}

fn split_extension(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(index) if index > 0 && index + 1 < name.len() => (
            name[..index].to_string(),
            name[index + 1..].to_ascii_lowercase(),
        ),
        _ => (name.to_string(), String::new()),
    }
}

fn extension_for_mime(mime: &str) -> Option<String> {
    if mime.is_empty() {
        return None;
    }
    // Prefer the conventional extension over whatever the MIME database lists
    // first (`text/markdown` lists "markdown" before "md").
    let preferred = match mime {
        "text/markdown" | "text/x-markdown" => Some("md"),
        "text/plain" => Some("txt"),
        "text/html" => Some("html"),
        "text/css" => Some("css"),
        "text/csv" => Some("csv"),
        "text/tab-separated-values" => Some("tsv"),
        "application/json" => Some("json"),
        "application/pdf" => Some("pdf"),
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        "application/zip" => Some("zip"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => Some("docx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some("xlsx"),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => {
            Some("pptx")
        }
        "application/xml" | "text/xml" => Some("xml"),
        _ => None,
    };
    if let Some(extension) = preferred {
        return Some(extension.to_string());
    }
    mime_guess::get_mime_extensions_str(mime)
        .and_then(|extensions| extensions.first().map(|extension| extension.to_string()))
}

pub(crate) fn sanitize_filename(input: &str) -> String {
    let unified = input.replace('\\', "/");
    let basename = unified.rsplit('/').next().unwrap_or(&unified);
    let mut cleaned: String = basename
        .chars()
        .filter(|ch| !ch.is_control() && !matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        .collect();
    cleaned = clean_inline(&cleaned).trim_matches(['.', ' ']).to_string();
    if cleaned.is_empty() || cleaned == ".." {
        cleaned = "arquivo.txt".to_string();
    }

    if cleaned.chars().count() > MAX_NAME_CHARS {
        let (stem, extension) = split_extension(&cleaned);
        let keep = MAX_NAME_CHARS.saturating_sub(extension.len() + 1);
        let stem: String = stem.chars().take(keep).collect();
        cleaned = if extension.is_empty() {
            stem
        } else {
            format!("{stem}.{extension}")
        };
    }
    cleaned
}

fn artifact_kind(mime: &str, name: &str) -> ArtifactKind {
    let (_, extension) = split_extension(name);
    if CODE_EXTENSIONS.contains(&extension.as_str()) {
        ArtifactKind::Code
    } else {
        ArtifactKind::from_mime_and_name(mime, name)
    }
}

fn language_for(name: &str) -> Option<String> {
    let (_, extension) = split_extension(name);
    let language = match extension.as_str() {
        "rs" => "rust",
        "ts" => "typescript",
        "tsx" => "tsx",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "jsx",
        "py" => "python",
        "rb" => "ruby",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "php" => "php",
        "swift" => "swift",
        "sh" | "bash" | "zsh" => "bash",
        "ps1" => "powershell",
        "sql" => "sql",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" => "scss",
        "less" => "less",
        "json" | "jsonl" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" => "xml",
        "md" | "markdown" | "mdx" => "markdown",
        "mermaid" => "mermaid",
        "csv" | "tsv" => "csv",
        "graphql" | "gql" => "graphql",
        "vue" => "vue",
        "svelte" => "svelte",
        "txt" | "log" => "text",
        _ => return None,
    };
    Some(language.to_string())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "lumina-artifacts-test-{}",
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

    fn test_db() -> Db {
        Db::open_in_memory().expect("abrir banco em memória")
    }

    /// Minimal but valid magic headers used to exercise `infer`.
    fn png_bytes() -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&[0u8; 16]);
        bytes
    }

    fn pdf_bytes() -> Vec<u8> {
        b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n".to_vec()
    }

    fn pptx_bytes() -> Vec<u8> {
        // OOXML files are ZIP containers; the writer trusts the extension for
        // the specific Office MIME type.
        b"PK\x03\x04\x14\x00\x00\x00\x00\x00fake ooxml payload".to_vec()
    }

    #[test]
    fn writes_bytes_to_disk_and_registers_the_artifact() {
        let temp = TempDir::new();
        let db = test_db();
        let artifact = write_artifact(
            &db,
            &temp.path,
            "conv-1",
            "msg-1",
            "grafico",
            &png_bytes(),
            None,
        )
        .expect("gravar artefato");

        assert_eq!(artifact.name, "grafico.png");
        assert_eq!(artifact.mime_type, "image/png");
        assert_eq!(artifact.kind, ArtifactKind::Image);
        assert_eq!(artifact.size, png_bytes().len() as i64);
        assert!(artifact.language.is_none());
        assert_eq!(artifact.conversation_id, "conv-1");
        assert_eq!(artifact.message_id.as_deref(), Some("msg-1"));

        let path = temp
            .path
            .join("artifacts")
            .join(&artifact.id)
            .join("grafico.png");
        assert!(path.is_file(), "arquivo deve existir em {}", path.display());
        assert_eq!(std::fs::read(&path).expect("ler arquivo"), png_bytes());

        let stored = db.list_artifacts("conv-1").expect("listar artefatos");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].id, artifact.id);
        assert_eq!(stored[0].name, "grafico.png");
    }

    #[test]
    fn infers_mime_from_magic_bytes_when_the_extension_is_unknown() {
        let temp = TempDir::new();
        let db = test_db();
        let artifact = write_artifact(
            &db,
            &temp.path,
            "conv",
            "msg",
            "arquivo.dat",
            &pdf_bytes(),
            None,
        )
        .expect("gravar artefato");
        assert_eq!(artifact.mime_type, "application/pdf");
        assert_eq!(artifact.name, "arquivo.dat");
        assert_eq!(artifact.kind, ArtifactKind::Binary);
    }

    #[test]
    fn mime_hint_extends_the_name() {
        let temp = TempDir::new();
        let db = test_db();
        let artifact = write_artifact(
            &db,
            &temp.path,
            "conv",
            "msg",
            "relatorio",
            b"# Titulo\n",
            Some("text/markdown"),
        )
        .expect("gravar artefato");
        assert_eq!(artifact.name, "relatorio.md");
        assert_eq!(artifact.mime_type, "text/markdown");
        assert_eq!(artifact.kind, ArtifactKind::Markdown);
        assert_eq!(artifact.language.as_deref(), Some("markdown"));
    }

    #[test]
    fn derives_office_and_image_kinds_from_the_extension() {
        let temp = TempDir::new();
        let db = test_db();

        let pptx = write_artifact(
            &db,
            &temp.path,
            "conv",
            "msg",
            "apresentacao.pptx",
            &pptx_bytes(),
            None,
        )
        .expect("gravar pptx");
        assert_eq!(pptx.kind, ArtifactKind::Pptx);
        assert_eq!(
            pptx.mime_type,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        );

        let image = write_artifact(
            &db,
            &temp.path,
            "conv",
            "msg",
            "foto.PNG",
            &png_bytes(),
            None,
        )
        .expect("gravar imagem");
        assert_eq!(image.kind, ArtifactKind::Image);
        assert_eq!(image.mime_type, "image/png");
    }

    #[test]
    fn sanitizes_dangerous_names_before_writing() {
        let temp = TempDir::new();
        let db = test_db();
        let artifact = write_artifact(
            &db,
            &temp.path,
            "conv",
            "msg",
            "../../evil.md",
            b"# x",
            None,
        )
        .expect("gravar artefato");
        assert_eq!(artifact.name, "evil.md");
        let path = temp
            .path
            .join("artifacts")
            .join(&artifact.id)
            .join(&artifact.name);
        assert!(path.is_file());
        // The file must stay inside the artifact directory (no traversal).
        assert!(path.starts_with(temp.path.join("artifacts")));
        assert!(!path.to_string_lossy().contains(".."));
    }

    #[test]
    fn code_files_get_a_language_and_text_mime() {
        let temp = TempDir::new();
        let db = test_db();
        let artifact = write_artifact(
            &db,
            &temp.path,
            "conv",
            "msg",
            "app.ts",
            b"export const x = 1;\n",
            None,
        )
        .expect("gravar artefato");
        assert_eq!(artifact.kind, ArtifactKind::Code);
        assert_eq!(artifact.mime_type, "text/plain");
        assert_eq!(artifact.language.as_deref(), Some("typescript"));
    }

    #[test]
    fn handles_files_larger_than_ten_megabytes() {
        let temp = TempDir::new();
        let db = test_db();
        let bytes = vec![b'a'; 10 * 1024 * 1024 + 1];
        let artifact = write_artifact(
            &db,
            &temp.path,
            "conv",
            "msg",
            "grande.txt",
            &bytes,
            None,
        )
        .expect("gravar artefato grande");
        assert_eq!(artifact.size, bytes.len() as i64);
        assert_eq!(artifact.kind, ArtifactKind::Text);
        let written = std::fs::metadata(
            temp.path
                .join("artifacts")
                .join(&artifact.id)
                .join("grande.txt"),
        )
        .expect("metadata do arquivo");
        assert_eq!(written.len(), bytes.len() as u64);
    }

    #[test]
    fn sanitizes_dangerous_names() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("C:\\temp\\nota.md"), "nota.md");
        assert_eq!(sanitize_filename("  relatório final.md  "), "relatório final.md");
        assert_eq!(sanitize_filename("..."), "arquivo.txt");
        assert_eq!(sanitize_filename("nome:inválido?.txt"), "nomeinválido.txt");
    }

    #[test]
    fn keeps_extension_when_truncating() {
        let long = format!("{}.md", "a".repeat(300));
        let name = sanitize_filename(&long);
        assert!(name.chars().count() <= MAX_NAME_CHARS);
        assert!(name.ends_with(".md"));
    }

    #[test]
    fn derives_kind_and_language() {
        assert_eq!(artifact_kind("text/plain", "main.rs"), ArtifactKind::Code);
        assert_eq!(language_for("main.rs").as_deref(), Some("rust"));
        assert_eq!(artifact_kind("video/mp2t", "app.ts"), ArtifactKind::Code);
        assert_eq!(language_for("app.tsx").as_deref(), Some("tsx"));
        assert_eq!(artifact_kind("text/markdown", "relatorio.md"), ArtifactKind::Markdown);
        assert_eq!(artifact_kind("text/csv", "dados.csv"), ArtifactKind::Csv);
        assert_eq!(language_for("dados.csv").as_deref(), Some("csv"));
        assert_eq!(language_for("arquivo.bin"), None);
    }

    #[test]
    fn extensions_for_common_mimes() {
        assert_eq!(extension_for_mime("text/markdown").as_deref(), Some("md"));
        assert_eq!(extension_for_mime("application/json").as_deref(), Some("json"));
        assert_eq!(
            extension_for_mime(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )
            .as_deref(),
            Some("xlsx")
        );
        assert_eq!(extension_for_mime("application/x-unknown"), None);
    }
}
