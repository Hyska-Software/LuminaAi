//! Artifact creation tool.
//!
//! Writes the generated file to `<app-data>/artifacts/<artifact-id>/<name>`,
//! registers the metadata in SQLite and returns the artifact so the harness can
//! emit `artifact_created`.

use std::path::PathBuf;

use serde_json::{json, Value};

use crate::db::StoredArtifact;
use crate::domain::{now_ms, Artifact, ArtifactKind};
use crate::providers::ToolDefinition;

use super::{clean_inline, json_str, ToolOutcome, ToolRuntime};

const MAX_ARTIFACT_BYTES: usize = 10 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 120;

/// Extensions rendered with syntax highlighting / treated as source code.
const CODE_EXTENSIONS: &[&str] = &[
    "rs", "go", "py", "rb", "java", "kt", "kts", "c", "h", "cpp", "cc", "cxx", "hpp", "cs",
    "php", "swift", "sh", "bash", "zsh", "ps1", "sql", "lua", "pl", "r", "scala", "dart", "ex",
    "exs", "erl", "hs", "clj", "elm", "zig", "nim", "vue", "svelte", "astro", "ts", "tsx",
    "js", "jsx", "mjs", "cjs",
];

pub fn definition() -> ToolDefinition {
    ToolDefinition {
        name: "create_file".to_string(),
        description: "Create a downloadable file (artifact) for the user: markdown documents, \
                      HTML/SVG previews, CSV/JSON data, source code, etc. The file appears in the \
                      artifact panel with preview and a \"Save as…\" action. Use this instead of \
                      pasting very long content in the chat. Returns the artifact id and a short \
                      confirmation; never repeat the whole file in your answer."
            .to_string(),
        parameters: json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "File name including extension, e.g. \"relatorio.md\", \"index.html\", \"dados.csv\", \"app.tsx\"."
                },
                "content": {
                    "type": "string",
                    "description": "Full UTF-8 file content."
                },
                "mime": {
                    "type": "string",
                    "description": "Optional MIME type. When omitted it is inferred from the extension."
                }
            },
            "required": ["name", "content"],
            "additionalProperties": false
        }),
    }
}

pub async fn run(rt: &ToolRuntime, args: &Value) -> ToolOutcome {
    let raw_name = match json_str(args, "name") {
        Some(name) if !name.trim().is_empty() => name,
        _ => return ToolOutcome::error("o argumento `name` é obrigatório"),
    };
    let content = match args.get("content") {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Null) | None => return ToolOutcome::error("o argumento `content` é obrigatório"),
        Some(other) => serde_json::to_string_pretty(other).unwrap_or_else(|_| other.to_string()),
    };
    if content.len() > MAX_ARTIFACT_BYTES {
        return ToolOutcome::error(format!(
            "conteúdo grande demais ({} bytes); o limite é 10 MB",
            content.len()
        ));
    }

    let mut name = sanitize_filename(&raw_name);
    let provided_mime = clean_mime(&json_str(args, "mime").unwrap_or_default());

    if !has_extension(&name) {
        let extension = extension_for_mime(&provided_mime).unwrap_or_else(|| "txt".to_string());
        name.push('.');
        name.push_str(&extension);
    }

    let initial_mime = if provided_mime.is_empty() {
        mime_guess::from_path(&name)
            .first_raw()
            .map(str::to_string)
            .unwrap_or_else(|| "text/plain".to_string())
    } else {
        provided_mime
    };
    let kind = artifact_kind(&initial_mime, &name);
    // `.ts`/`.mjs` are typed as video/javascript by the MIME database; source
    // files are plain text for storage and preview purposes.
    let mime = if kind == ArtifactKind::Code
        && (initial_mime.starts_with("video/") || initial_mime == "application/octet-stream")
    {
        "text/plain".to_string()
    } else {
        initial_mime
    };
    let language = if kind.is_textual() || kind == ArtifactKind::Code {
        language_for(&name)
    } else {
        None
    };

    let Some(app) = rt.app.as_ref() else {
        return ToolOutcome::error("AppHandle indisponível para criar o artefato");
    };
    let data_dir = match crate::config::data_dir(app) {
        Ok(dir) => dir,
        Err(error) => {
            return ToolOutcome::error(format!("diretório de dados indisponível: {error}"))
        }
    };
    let artifact_id = uuid::Uuid::new_v4().to_string();
    let directory: PathBuf = data_dir.join("artifacts").join(&artifact_id);
    if let Err(error) = std::fs::create_dir_all(&directory) {
        return ToolOutcome::error(format!("não foi possível criar o diretório do artefato: {error}"));
    }
    let path = directory.join(&name);
    if let Err(error) = std::fs::write(&path, content.as_bytes()) {
        return ToolOutcome::error(format!("não foi possível gravar o arquivo: {error}"));
    }

    let artifact = Artifact {
        id: artifact_id.clone(),
        conversation_id: rt.conversation_id.clone(),
        message_id: Some(rt.message_id.clone()),
        name: name.clone(),
        mime_type: mime.clone(),
        kind,
        language,
        size: content.len() as i64,
        created_at: now_ms(),
    };
    if let Err(error) = rt.db.insert_artifact(&StoredArtifact {
        artifact: artifact.clone(),
        path: path.to_string_lossy().into_owned(),
    }) {
        return ToolOutcome::error(format!(
            "o arquivo foi gravado, mas o registro do artefato falhou: {error}"
        ));
    }

    ToolOutcome {
        content: format!(
            "Arquivo `{name}` criado com sucesso ({} bytes, tipo `{mime}`). Artifact id: {artifact_id}. \
             O arquivo já está disponível no painel de artefatos do Lumina para visualização e download; \
             não repita o conteúdo completo no chat.",
            content.len()
        ),
        summary: Some(format!("{name} · {} bytes", content.len())),
        artifacts: vec![artifact],
        ..Default::default()
    }
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
        "application/xml" | "text/xml" => Some("xml"),
        _ => None,
    };
    if let Some(extension) = preferred {
        return Some(extension.to_string());
    }
    mime_guess::get_mime_extensions_str(mime)
        .and_then(|extensions| extensions.first().map(|extension| extension.to_string()))
}

fn sanitize_filename(input: &str) -> String {
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
    use super::*;

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
        assert_eq!(extension_for_mime("application/x-unknown"), None);
    }
}
