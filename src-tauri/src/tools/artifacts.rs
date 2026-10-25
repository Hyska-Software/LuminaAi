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
///
/// Markdown extensions (`.md`, `.markdown`, `.mdx`) are deliberately **absent**:
/// they stay [`ArtifactKind::Markdown`] so the rendered-document preview wins
/// over the code preview.
pub(crate) const CODE_EXTENSIONS: &[&str] = &[
    // Linguagens de programação.
    "rs", "go", "py", "rb", "java", "kt", "kts", "c", "h", "cpp", "cc", "cxx", "hpp", "cs",
    "php", "swift", "sh", "bash", "zsh", "ps1", "sql", "lua", "pl", "r", "scala", "dart", "ex",
    "exs", "erl", "hs", "clj", "elm", "zig", "nim", "vue", "svelte", "astro", "ts", "tsx", "js",
    "jsx", "mjs", "cjs",
    // Estilos, marcação e dados de configuração.
    "css", "scss", "sass", "less", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "props",
    "env",
    // Shell/desktop, infraestrutura, contratos e patches.
    "diff", "patch", "graphql", "gql", "bat", "cmd", "vb", "vbs", "tf", "hcl", "cmake", "mk",
    "proto", "http", "nginx", "dockerfile",
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

    // Toolchain/config full names (`Dockerfile`, `Makefile`, `.gitignore`,
    // `.env`) have no extension to add — appending `.txt` would hide the very
    // name the syntax/language detection relies on.
    if !has_extension(&name) && full_name_language(&name).is_none() {
        let extension = extension_for_mime(&hint)
            .or_else(|| infer::get(bytes).map(|kind| kind.extension().to_string()))
            .unwrap_or_else(|| "txt".to_string());
        name.push('.');
        name.push_str(&extension);
    }

    let mut mime = resolve_mime(&name, &hint, bytes);
    // Extensionless toolchain/config files have no MIME-database entry and are
    // plain text; without this they would be typed as opaque binaries.
    if is_generic_mime(&mime) && full_name_language(&name).is_some() {
        mime = "text/plain".to_string();
    }
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
    // first (`text/markdown` lists "markdown" before "md"). Media/archive
    // formats are listed explicitly because their canonical extension is what
    // the artifact panel keys on.
    let preferred = match mime {
        "text/markdown" | "text/x-markdown" => Some("md"),
        "text/plain" => Some("txt"),
        "text/html" => Some("html"),
        "text/css" => Some("css"),
        "text/csv" => Some("csv"),
        "text/tab-separated-values" => Some("tsv"),
        "application/json" => Some("json"),
        "application/pdf" => Some("pdf"),
        // Imagens.
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        "image/tiff" => Some("tif"),
        "image/x-icon" | "image/vnd.microsoft.icon" => Some("ico"),
        "image/avif" => Some("avif"),
        "image/bmp" => Some("bmp"),
        // Áudio.
        "audio/mpeg" | "audio/mp3" => Some("mp3"),
        "audio/wav" | "audio/x-wav" | "audio/wave" => Some("wav"),
        "audio/ogg" | "application/ogg" => Some("ogg"),
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => Some("m4a"),
        "audio/aac" => Some("aac"),
        "audio/flac" | "audio/x-flac" => Some("flac"),
        "audio/opus" => Some("opus"),
        // Vídeo.
        "video/mp4" => Some("mp4"),
        "video/webm" => Some("webm"),
        "video/quicktime" => Some("mov"),
        "video/x-matroska" => Some("mkv"),
        "video/ogg" => Some("ogv"),
        // Compactados.
        "application/zip" => Some("zip"),
        "application/gzip" | "application/x-gzip" => Some("gz"),
        "application/x-tar" => Some("tar"),
        "application/x-7z-compressed" => Some("7z"),
        "application/vnd.rar" | "application/x-rar-compressed" => Some("rar"),
        "application/epub+zip" => Some("epub"),
        // Office.
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
    // `clean_inline` collapses whitespace and trims both ends. A **leading**
    // dot is preserved on purpose: dotfiles (`.gitignore`, `.env`) must keep
    // their name to be detected by [`language_for`]. Trailing dots are dropped
    // (invalid on Windows) and a name made only of dots is not a real file.
    cleaned = clean_inline(&cleaned);
    while cleaned.ends_with('.') {
        cleaned.pop();
    }
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

/// Full file names (case-insensitive, matched without the leading dot) that map
/// to a known Prism grammar. These are the files an agent commonly generates
/// without an extension or with a meaningless one (`Dockerfile`,
/// `Makefile`, `CMakeLists.txt`, `.gitignore`, `.env`, `LICENSE`).
const FULL_NAME_LANGUAGES: &[(&str, &str)] = &[
    ("dockerfile", "docker"),
    ("containerfile", "docker"),
    ("makefile", "makefile"),
    ("gnumakefile", "makefile"),
    ("justfile", "makefile"),
    ("cmakelists.txt", "cmake"),
    ("rakefile", "ruby"),
    ("gemfile", "ruby"),
    ("gitignore", "git"),
    ("gitattributes", "git"),
    ("dockerignore", "git"),
    ("npmrc", "ini"),
    ("editorconfig", "ini"),
    ("procfile", "text"),
    ("license", "text"),
    ("leiame", "text"),
];

/// Returns the Prism language of a well-known full file name (`Dockerfile`,
/// `.gitignore`, `.env.production`, `CMakeLists.txt`, …).
///
/// The comparison is case-insensitive, uses only the basename and ignores the
/// leading dot of dotfiles, so `.gitignore`/`gitignore` and `.env`/`env` both
/// resolve. `.env*` variants (`.env`, `.env.local`, `.env.production`) are all
/// shell-style configuration, i.e. `ini`.
fn full_name_language(name: &str) -> Option<&'static str> {
    let unified = name.replace('\\', "/");
    let basename = unified.rsplit('/').next().unwrap_or(&unified).trim();
    if basename.is_empty() {
        return None;
    }
    let lower = basename.to_ascii_lowercase();
    if lower == ".env" || lower == "env" || lower.starts_with(".env.") {
        return Some("ini");
    }
    let without_dot = lower.trim_start_matches('.');
    FULL_NAME_LANGUAGES
        .iter()
        .find(|(candidate, _)| *candidate == lower || *candidate == without_dot)
        .map(|(_, language)| *language)
}

/// Full-name source files that should be [`ArtifactKind::Code`] even though the
/// MIME database types them as `text/plain`/`application/octet-stream`.
fn code_file_name(name: &str) -> bool {
    matches!(
        full_name_language(name),
        Some("docker" | "makefile" | "cmake" | "ruby")
    )
}

fn artifact_kind(mime: &str, name: &str) -> ArtifactKind {
    let (_, extension) = split_extension(name);
    // Extensions listed here are code by definition, even when the MIME
    // database types them differently (`.ts` is `video/mp2t` for mime_guess,
    // `.xml` is `text/xml`). This check comes **before** the domain mapping so
    // `.css`/`.yaml`/`.toml`/`.ini` become Code instead of Text; media and
    // archive extensions are not in this list, so `.zip` stays Archive and
    // `.tif` stays Image.
    if CODE_EXTENSIONS.contains(&extension.as_str()) || code_file_name(name) {
        return ArtifactKind::Code;
    }
    // Extensionless configuration files (`.gitignore`, `.env`, `Procfile`,
    // `LICENSE`) are readable text, never opaque binaries.
    if full_name_language(name).is_some() {
        return ArtifactKind::Text;
    }
    ArtifactKind::from_mime_and_name(mime, name)
}

fn language_for(name: &str) -> Option<String> {
    if let Some(language) = full_name_language(name) {
        return Some(language.to_string());
    }
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
        "sass" => "sass",
        "less" => "less",
        "json" | "jsonl" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" => "xml",
        "ini" | "cfg" | "conf" | "props" | "env" | "properties" => "ini",
        "md" | "markdown" | "mdx" => "markdown",
        "mermaid" => "mermaid",
        "csv" | "tsv" => "csv",
        "graphql" | "gql" => "graphql",
        "proto" => "protobuf",
        "diff" | "patch" => "diff",
        "http" => "http",
        "nginx" => "nginx",
        "cmake" => "cmake",
        "mk" => "makefile",
        "dockerfile" => "docker",
        "bat" | "cmd" => "batch",
        "vb" | "vbs" => "vbnet",
        // Prism não tem gramática HCL registrada na UI: `ini` mantém os pares
        // chave/valor legíveis (o mesmo fallback da task).
        "tf" | "hcl" => "ini",
        // Templates de componente: o `markup` do Prism cobre a marcação.
        "vue" | "svelte" | "astro" => "markup",
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
        // Dotfiles preservam o ponto inicial (detecção por nome completo).
        assert_eq!(sanitize_filename(".gitignore"), ".gitignore");
        assert_eq!(sanitize_filename(".env.local"), ".env.local");
        assert_eq!(sanitize_filename("nota.md..."), "nota.md");
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
        // Mídia e compactados não podem ser capturados por CODE_EXTENSIONS.
        assert_eq!(artifact_kind("text/plain", "trilha.mp3"), ArtifactKind::Audio);
        assert_eq!(artifact_kind("text/plain", "clipe.webm"), ArtifactKind::Video);
        assert_eq!(artifact_kind("text/plain", "pacote.zip"), ArtifactKind::Archive);
        assert_eq!(artifact_kind("image/tiff", "scan.tif"), ArtifactKind::Image);
    }

    #[test]
    fn derives_media_and_archive_kinds_when_writing_the_artifact() {
        let temp = TempDir::new();
        let db = test_db();
        let cases: Vec<(&str, Vec<u8>, ArtifactKind)> = vec![
            ("trilha.mp3", b"ID3 fake mp3".to_vec(), ArtifactKind::Audio),
            ("voz.wav", b"RIFF fake wav".to_vec(), ArtifactKind::Audio),
            ("podcast.ogg", b"OggS fake".to_vec(), ArtifactKind::Audio),
            ("audio.m4a", b"ftypM4A fake".to_vec(), ArtifactKind::Audio),
            (
                "master.flac",
                b"fLaC fake".to_vec(),
                ArtifactKind::Audio,
            ),
            ("clipe.mp4", b"ftypmp42 fake".to_vec(), ArtifactKind::Video),
            ("clipe.webm", b"webm fake".to_vec(), ArtifactKind::Video),
            ("clipe.mov", b"ftypqt fake".to_vec(), ArtifactKind::Video),
            ("clipe.mkv", b"mkv fake".to_vec(), ArtifactKind::Video),
            ("pacote.zip", b"PK\x03\x04 fake zip".to_vec(), ArtifactKind::Archive),
            ("backup.tar", b"fake tar".to_vec(), ArtifactKind::Archive),
            ("log.gz", b"\x1f\x8b fake gzip".to_vec(), ArtifactKind::Archive),
            ("dados.7z", b"7z fake".to_vec(), ArtifactKind::Archive),
            ("dados.rar", b"Rar! fake".to_vec(), ArtifactKind::Archive),
            ("livro.epub", b"PK\x03\x04 fake epub".to_vec(), ArtifactKind::Archive),
            (
                "scan.tif",
                b"II*\x00 fake tiff".to_vec(),
                ArtifactKind::Image,
            ),
        ];
        for (name, bytes, expected) in cases {
            let artifact = write_artifact(&db, &temp.path, "conv", "msg", name, &bytes, None)
                .unwrap_or_else(|error| panic!("gravar `{name}`: {error:#}"));
            assert_eq!(artifact.kind, expected, "kind de `{name}`");
            assert_eq!(artifact.name, name);
            assert!(artifact.language.is_none(), "`{name}` não deveria ter linguagem");
        }
    }

    #[test]
    fn code_extensions_cover_styles_config_and_infra_files() {
        let cases = [
            ("style.css", "css"),
            ("tema.scss", "scss"),
            ("tema.sass", "sass"),
            ("tema.less", "less"),
            ("pagina.xml", "xml"),
            ("config.yaml", "yaml"),
            ("config.yml", "yaml"),
            ("Cargo.toml", "toml"),
            ("app.ini", "ini"),
            ("setup.cfg", "ini"),
            ("app.conf", "ini"),
            ("app.props", "ini"),
            ("runtime.env", "ini"),
            ("mudancas.diff", "diff"),
            ("correcao.patch", "diff"),
            ("schema.graphql", "graphql"),
            ("consulta.gql", "graphql"),
            ("script.bat", "batch"),
            ("script.cmd", "batch"),
            ("modulo.vb", "vbnet"),
            ("modulo.vbs", "vbnet"),
            ("main.tf", "ini"),
            ("main.hcl", "ini"),
            ("build.cmake", "cmake"),
            ("regras.mk", "makefile"),
            ("servico.proto", "protobuf"),
            ("api.http", "http"),
            ("site.nginx", "nginx"),
            ("deploy.dockerfile", "docker"),
        ];
        for (name, language) in cases {
            assert_eq!(
                artifact_kind("text/plain", name),
                ArtifactKind::Code,
                "kind de `{name}`"
            );
            assert_eq!(
                language_for(name).as_deref(),
                Some(language),
                "linguagem de `{name}`"
            );
        }
        // `.md` continua documento renderizado (não entra em CODE_EXTENSIONS).
        assert_eq!(artifact_kind("text/markdown", "notas.md"), ArtifactKind::Markdown);
        assert_eq!(language_for("notas.md").as_deref(), Some("markdown"));
    }

    #[test]
    fn full_file_names_map_to_languages_and_kinds() {
        let languages = [
            ("Dockerfile", "docker"),
            ("dockerfile", "docker"),
            ("Containerfile", "docker"),
            ("Makefile", "makefile"),
            ("GNUmakefile", "makefile"),
            ("Justfile", "makefile"),
            ("CMakeLists.txt", "cmake"),
            ("Rakefile", "ruby"),
            ("Gemfile", "ruby"),
            (".gitignore", "git"),
            ("gitignore", "git"),
            (".gitattributes", "git"),
            (".dockerignore", "git"),
            (".npmrc", "ini"),
            (".editorconfig", "ini"),
            (".env", "ini"),
            (".env.local", "ini"),
            (".env.production", "ini"),
            ("Procfile", "text"),
            ("LICENSE", "text"),
            ("LEIAME", "text"),
        ];
        for (name, language) in languages {
            assert_eq!(
                language_for(name).as_deref(),
                Some(language),
                "linguagem de `{name}`"
            );
        }
        // Toolchain/source full names são Code; dotfiles de configuração são Text.
        for name in ["Dockerfile", "Makefile", "Justfile", "CMakeLists.txt", "Rakefile"] {
            assert_eq!(artifact_kind("text/plain", name), ArtifactKind::Code, "{name}");
        }
        for name in [".gitignore", ".env", ".env.local", "Procfile", "LICENSE"] {
            assert_eq!(artifact_kind("text/plain", name), ArtifactKind::Text, "{name}");
        }
    }

    #[test]
    fn extensionless_toolchain_files_keep_their_name_end_to_end() {
        let temp = TempDir::new();
        let db = test_db();

        let dockerfile = write_artifact(
            &db,
            &temp.path,
            "conv",
            "msg",
            "Dockerfile",
            b"FROM node:20\nWORKDIR /app\n",
            None,
        )
        .expect("gravar Dockerfile");
        assert_eq!(dockerfile.name, "Dockerfile");
        assert_eq!(dockerfile.kind, ArtifactKind::Code);
        assert_eq!(dockerfile.mime_type, "text/plain");
        assert_eq!(dockerfile.language.as_deref(), Some("docker"));

        let makefile = write_artifact(
            &db,
            &temp.path,
            "conv",
            "msg",
            "Makefile",
            b"all:\n\t@echo ok\n",
            None,
        )
        .expect("gravar Makefile");
        assert_eq!(makefile.name, "Makefile");
        assert_eq!(makefile.kind, ArtifactKind::Code);
        assert_eq!(makefile.language.as_deref(), Some("makefile"));

        let gitignore = write_artifact(
            &db,
            &temp.path,
            "conv",
            "msg",
            ".gitignore",
            b"node_modules/\n",
            None,
        )
        .expect("gravar .gitignore");
        assert_eq!(gitignore.name, ".gitignore");
        assert_eq!(gitignore.kind, ArtifactKind::Text);
        assert_eq!(gitignore.mime_type, "text/plain");
        assert_eq!(gitignore.language.as_deref(), Some("git"));
        assert!(temp
            .path
            .join("artifacts")
            .join(&gitignore.id)
            .join(".gitignore")
            .is_file());
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

    #[test]
    fn extension_for_mime_prefers_media_and_archive_extensions() {
        let cases = [
            ("audio/mpeg", "mp3"),
            ("audio/wav", "wav"),
            ("audio/x-wav", "wav"),
            ("audio/ogg", "ogg"),
            ("audio/mp4", "m4a"),
            ("audio/flac", "flac"),
            ("video/mp4", "mp4"),
            ("video/webm", "webm"),
            ("video/quicktime", "mov"),
            ("video/x-matroska", "mkv"),
            ("application/zip", "zip"),
            ("application/gzip", "gz"),
            ("application/x-tar", "tar"),
            ("application/x-7z-compressed", "7z"),
            ("application/epub+zip", "epub"),
            ("image/tiff", "tif"),
            ("image/x-icon", "ico"),
            ("image/avif", "avif"),
        ];
        for (mime, extension) in cases {
            assert_eq!(
                extension_for_mime(mime).as_deref(),
                Some(extension),
                "extensão de `{mime}`"
            );
        }
    }
}
