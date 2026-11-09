//! Artifact commands (implemented by the storage module).

use std::io::{BufRead, Seek};
use std::path::{Path, PathBuf};

use base64::Engine as _;
use image::ImageEncoder as _;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::db::{remove_artifact_files, Db};
use crate::documents::preview::{
    archive_preview, binary_preview, docx_html, image_preview, pptx_slides, xlsx_sheets,
};
use crate::domain::{
    Artifact, ArtifactContent, ArtifactKind, ArtifactPreview, ArtifactThumbnail, LibraryArtifact,
};
use crate::state::AppState;
use crate::tools::artifacts::{classify_file, sanitize_filename, write_artifact_file};

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

fn read_artifact_file(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path)
        .map_err(|error| format!("falha ao ler o arquivo do artefato ({path}): {error}"))
}

/* ------------------------------------------------------------------ */
/* Biblioteca do usuário: limites, import e gestão                     */
/* ------------------------------------------------------------------ */

/// Máximo de arquivos importados por uma única chamada de
/// `import_library_files` (seletor múltiplo / drag & drop).
pub const MAX_LIBRARY_IMPORT_FILES: usize = 100;
/// Teto de tamanho por arquivo importado: 256 MiB.
pub const MAX_LIBRARY_IMPORT_BYTES: u64 = 256 * 1024 * 1024;
/// Lado maior máximo da miniatura gerada para os cards da Biblioteca.
pub const THUMBNAIL_MAX_PX: u32 = 512;
/// Bytes lidos do início do arquivo para reclassificar um rename (magic bytes
/// vivem no cabeçalho; o arquivo inteiro nunca é carregado na memória).
const CLASSIFY_PREFIX_BYTES: usize = 16 * 1024;
/// Lado maior aceito ao decodificar uma imagem para miniatura. Acima disso
/// (ou se a decodificação falhar) o card cai no ícone do tipo.
const THUMBNAIL_MAX_DECODE_SIDE: u32 = 16_384;
/// Memória máxima aproximada alocada pelo decodificador da miniatura.
const THUMBNAIL_MAX_ALLOC_BYTES: u64 = 256 * 1024 * 1024;

/// Biblioteca do usuário: todos os artefatos (de todas as conversas + os
/// enviados direto à biblioteca), mais recentes primeiro, com o título da
/// conversa de origem.
pub fn list_library_artifacts_impl(db: &Db) -> Result<Vec<LibraryArtifact>, String> {
    db.list_library_artifacts().map_err(to_error)
}

#[tauri::command]
pub fn list_library_artifacts(state: State<'_, AppState>) -> Result<Vec<LibraryArtifact>, String> {
    list_library_artifacts_impl(&state.db)
}

/// Valida e importa um arquivo do usuário para a biblioteca (`conversation_id
/// = None`). O limite é checado **antes** da cópia.
fn import_library_file(db: &Db, data_dir: &Path, raw: &str) -> Result<Artifact, String> {
    let source = Path::new(raw);
    let metadata = std::fs::metadata(source)
        .map_err(|error| format!("não foi possível ler `{raw}`: {error}"))?;
    if !metadata.is_file() {
        return Err(format!(
            "`{raw}` não é um arquivo regular e não pode ser enviado à biblioteca"
        ));
    }
    if metadata.len() > MAX_LIBRARY_IMPORT_BYTES {
        return Err(format!(
            "`{raw}` tem {} MiB e excede o limite de {} MiB por arquivo da biblioteca",
            metadata.len() / (1024 * 1024),
            MAX_LIBRARY_IMPORT_BYTES / (1024 * 1024)
        ));
    }
    write_artifact_file(db, data_dir, None, source)
        .map_err(|error| format!("falha ao importar `{raw}` para a biblioteca: {error:#}"))
}

/// Importa até [`MAX_LIBRARY_IMPORT_FILES`] arquivos, em best-effort: um
/// arquivo ruim não impede os demais. Só devolve `Err` quando **nenhum**
/// arquivo foi importado; nesse caso a mensagem é a do primeiro erro.
fn import_library_files_impl(
    db: &Db,
    data_dir: &Path,
    paths: &[String],
) -> Result<Vec<Artifact>, String> {
    let mut imported = Vec::new();
    let mut first_error: Option<String> = None;
    for raw in paths.iter().take(MAX_LIBRARY_IMPORT_FILES) {
        match import_library_file(db, data_dir, raw) {
            Ok(artifact) => imported.push(artifact),
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }
    if imported.is_empty() {
        if let Some(error) = first_error {
            return Err(error);
        }
    }
    Ok(imported)
}

#[tauri::command]
pub fn import_library_files(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<Artifact>, String> {
    import_library_files_impl(&state.db, &state.data_dir, &paths)
}

/// Lê só o prefixo do arquivo (magic bytes + `infer` usam apenas o cabeçalho).
fn read_prefix(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read as _;

    let mut file = std::fs::File::open(path).map_err(|error| {
        format!(
            "o arquivo do artefato não está acessível ({}): {error}",
            path.display()
        )
    })?;
    let mut buffer = vec![0u8; CLASSIFY_PREFIX_BYTES];
    let mut filled = 0usize;
    while filled < buffer.len() {
        match file.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(error) => {
                return Err(format!(
                    "falha ao ler o arquivo do artefato ({}): {error}",
                    path.display()
                ))
            }
        }
    }
    buffer.truncate(filled);
    Ok(buffer)
}

/// Extensão (minúscula, sem o ponto) de um nome de arquivo. Dotfiles como
/// `.gitignore` não têm extensão — mesma regra do writer.
fn file_extension(name: &str) -> Option<String> {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .filter(|extension| !extension.is_empty())
}

/// Nome final de um rename: sanitizado (sem traversal/caracteres inválidos) e
/// com a extensão do nome original preservada quando o novo nome não tem uma.
fn renamed_file_name(requested: &str, current_name: &str) -> Result<String, String> {
    let requested = requested.trim();
    if requested.is_empty() {
        return Err("o nome do arquivo não pode ficar vazio".to_string());
    }
    if requested == "." || requested == ".." {
        return Err(format!("nome de arquivo inválido: `{requested}`"));
    }
    let mut name = sanitize_filename(requested);
    if file_extension(&name).is_none() {
        if let Some(extension) = file_extension(current_name) {
            name.push('.');
            name.push_str(&extension);
        }
    }
    Ok(name)
}

/// Renomeia o registro + o arquivo em `artifacts/<id>/`. Recalcula MIME, kind
/// e language com a **mesma** classificação do writer (nome novo + primeiros
/// bytes), preserva a extensão original quando o novo nome não tem uma,
/// rejeita colisão no diretório e id inexistente. O arquivo é renomeado antes
/// do UPDATE: se o banco falhar, o rename é revertido para não divergir.
fn rename_artifact_impl(db: &Db, id: &str, name: &str) -> Result<Artifact, String> {
    let stored = db
        .get_artifact(id)
        .map_err(to_error)?
        .ok_or_else(|| format!("artefato não encontrado: {id}"))?;
    let current_path = PathBuf::from(&stored.path);
    let current_name = current_path
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| stored.artifact.name.clone());
    let directory = current_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("caminho inválido para o artefato {id}: {}", stored.path))?;
    let final_name = renamed_file_name(name, &current_name)?;
    let target_path = directory.join(&final_name);
    let same_path = target_path == current_path;
    if !same_path && target_path.exists() {
        return Err(format!(
            "já existe um arquivo chamado `{final_name}` na pasta do artefato"
        ));
    }

    // Classificação só pelos primeiros bytes: o arquivo pode ser grande.
    let head = read_prefix(&current_path)?;
    let (_, mime_type, kind, language) = classify_file(&final_name, &head);
    if !same_path {
        std::fs::rename(&current_path, &target_path)
            .map_err(|error| format!("falha ao renomear o arquivo do artefato: {error}"))?;
    }
    let new_path = target_path.to_string_lossy().into_owned();
    let updated = db.update_artifact_rename(
        id,
        &final_name,
        &mime_type,
        kind,
        language.as_deref(),
        &new_path,
    );
    match updated {
        Ok(Some(artifact)) => Ok(artifact),
        Ok(None) => {
            if !same_path {
                let _ = std::fs::rename(&target_path, &current_path);
            }
            Err(format!("artefato não encontrado: {id}"))
        }
        Err(error) => {
            if !same_path {
                let _ = std::fs::rename(&target_path, &current_path);
            }
            Err(to_error(error))
        }
    }
}

#[tauri::command]
pub fn rename_artifact(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<Artifact, String> {
    rename_artifact_impl(&state.db, &id, &name)
}

fn set_artifact_favorite_impl(db: &Db, id: &str, favorite: bool) -> Result<Artifact, String> {
    db.set_artifact_favorite(id, favorite)
        .map_err(to_error)?
        .ok_or_else(|| format!("artefato não encontrado: {id}"))
}

#[tauri::command]
pub fn set_artifact_favorite(
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> Result<Artifact, String> {
    set_artifact_favorite_impl(&state.db, &id, favorite)
}

/// Gera a miniatura PNG (no máximo [`THUMBNAIL_MAX_PX`] no maior lado) a partir
/// de qualquer leitor de imagem. Formatos suportados: os decodificadores do
/// crate `image` habilitados em `Cargo.toml` (PNG/JPEG/GIF/WebP/BMP/ICO/TIFF).
/// O limite de dimensões evita bombas de descompressão; não faz upscale.
pub(crate) fn render_thumbnail<R: BufRead + Seek>(reader: R) -> Result<ArtifactThumbnail, String> {
    let mut reader = image::ImageReader::new(reader)
        .with_guessed_format()
        .map_err(|error| format!("falha ao identificar o formato da imagem: {error}"))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(THUMBNAIL_MAX_DECODE_SIDE);
    limits.max_image_height = Some(THUMBNAIL_MAX_DECODE_SIDE);
    limits.max_alloc = Some(THUMBNAIL_MAX_ALLOC_BYTES);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|error| format!("falha ao decodificar a imagem: {error}"))?;

    let thumbnail = if decoded.width().max(decoded.height()) > THUMBNAIL_MAX_PX {
        decoded.thumbnail(THUMBNAIL_MAX_PX, THUMBNAIL_MAX_PX)
    } else {
        decoded
    };
    let rgba = thumbnail.into_rgba8();
    let (width, height) = (rgba.width(), rgba.height());
    if width == 0 || height == 0 {
        return Err("a imagem não tem dimensões válidas".to_string());
    }
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(
            rgba.as_raw(),
            width,
            height,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| format!("falha ao codificar a miniatura em PNG: {error}"))?;
    Ok(ArtifactThumbnail {
        mime: "image/png".to_string(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(png),
        width,
        height,
    })
}

#[cfg(test)]
fn thumbnail_from_bytes(bytes: &[u8]) -> Result<ArtifactThumbnail, String> {
    render_thumbnail(std::io::Cursor::new(bytes))
}

/// Miniatura de um artefato de imagem; `Ok(None)` para não-imagem, arquivo
/// ausente ou imagem que o backend não consegue decodificar (a UI usa o ícone).
fn get_artifact_thumbnail_impl(db: &Db, id: &str) -> Result<Option<ArtifactThumbnail>, String> {
    let Some(stored) = db.get_artifact(id).map_err(to_error)? else {
        return Ok(None);
    };
    if stored.artifact.kind != ArtifactKind::Image {
        return Ok(None);
    }
    let Ok(file) = std::fs::File::open(&stored.path) else {
        return Ok(None);
    };
    // Decode/limites: qualquer falha cai no fallback do card, nunca em erro de
    // IPC que quebraria a grade inteira.
    Ok(render_thumbnail(std::io::BufReader::new(file)).ok())
}

#[tauri::command]
pub fn get_artifact_thumbnail(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ArtifactThumbnail>, String> {
    get_artifact_thumbnail_impl(&state.db, &id)
}

/// Remove o registro e os arquivos de um artefato (uploads da biblioteca
/// inclusive, já que o diretório é o mesmo `artifacts/<id>/`).
fn delete_artifact_impl(db: &Db, id: &str) -> Result<(), String> {
    let stored = db.get_artifact(id).map_err(to_error)?;
    db.delete_artifact(id).map_err(to_error)?;
    if let Some(stored) = stored {
        remove_artifact_files(id, &stored.path);
    }
    Ok(())
}


/* ------------------------------------------------------------------ */
/* Payload de get_artifact_content                                     */
/* ------------------------------------------------------------------ */

/// Teto do payload base64 inline de áudio/vídeo (24 MiB). Acima disso o
/// `get_artifact_content` não devolve bytes: a UI mostra o cartão do artefato
/// com as ações Salvar/Abrir (o player nativo fica indisponível).
pub const MAX_INLINE_MEDIA_BYTES: usize = 24 * 1024 * 1024;

/// O que `get_artifact_content` devolve junto dos metadados do artefato.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ArtifactPayload {
    /// Conteúdo textual em `content`.
    Text,
    /// Bytes originais em `dataBase64`.
    Base64,
    /// Nenhum payload: a prévia (`get_artifact_preview`) lê o arquivo no backend.
    Omitted,
}

/// MIME que o WebView desenha direto em `<img>`. Os demais formatos de imagem
/// (TIFF, HEIC) não abrem no `<img>`: a prévia do backend entrega o PNG
/// convertido (`ArtifactPreview::Image::dataBase64`).
fn webview_image_mime(mime: &str) -> bool {
    let mime = mime
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    matches!(
        mime.as_str(),
        "image/png"
            | "image/jpeg"
            | "image/gif"
            | "image/webp"
            | "image/avif"
            | "image/bmp"
            | "image/x-icon"
            | "image/vnd.microsoft.icon"
    )
}

/// Decide o payload de `get_artifact_content` sem tocar no disco (testável).
///
/// - textuais → texto;
/// - PDF → base64 (pdf.js no renderer);
/// - imagem → base64 só quando o WebView abre o MIME; TIFF/HEIC ficam sem
///   payload porque a prévia entrega o PNG convertido;
/// - áudio/vídeo → base64 até [`MAX_INLINE_MEDIA_BYTES`];
/// - DOCX/XLSX/PPTX/Archive/Binary → sem payload (a prévia lê o arquivo).
///
/// O match é exaustivo de propósito: um `ArtifactKind` novo precisa decidir
/// explicitamente o que trafega no IPC.
pub(crate) fn payload_for(kind: &ArtifactKind, mime_type: &str, size: i64) -> ArtifactPayload {
    match kind {
        ArtifactKind::Audio | ArtifactKind::Video => {
            if size >= 0 && size as u64 <= MAX_INLINE_MEDIA_BYTES as u64 {
                ArtifactPayload::Base64
            } else {
                ArtifactPayload::Omitted
            }
        }
        ArtifactKind::Pdf => ArtifactPayload::Base64,
        ArtifactKind::Image => {
            if webview_image_mime(mime_type) {
                ArtifactPayload::Base64
            } else {
                ArtifactPayload::Omitted
            }
        }
        ArtifactKind::Docx
        | ArtifactKind::Xlsx
        | ArtifactKind::Pptx
        | ArtifactKind::Archive
        | ArtifactKind::Binary => ArtifactPayload::Omitted,
        ArtifactKind::Markdown
        | ArtifactKind::Code
        | ArtifactKind::Text
        | ArtifactKind::Html
        | ArtifactKind::Csv
        | ArtifactKind::Json
        | ArtifactKind::Svg => ArtifactPayload::Text,
    }
}

/// Codifica os bytes do artefato conforme a decisão de [`payload_for`].
pub(crate) fn payload_strings(payload: ArtifactPayload, bytes: &[u8]) -> (Option<String>, Option<String>) {
    match payload {
        ArtifactPayload::Text => (Some(String::from_utf8_lossy(bytes).into_owned()), None),
        ArtifactPayload::Base64 => (
            None,
            Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
        ),
        ArtifactPayload::Omitted => (None, None),
    }
}

#[tauri::command]
pub fn list_artifacts(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<Artifact>, String> {
    state.db.list_artifacts(&conversation_id).map_err(to_error)
}

#[tauri::command]
pub fn get_artifact_content(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ArtifactContent>, String> {
    let Some(stored) = state.db.get_artifact(&id).map_err(to_error)? else {
        return Ok(None);
    };
    let payload = payload_for(
        &stored.artifact.kind,
        &stored.artifact.mime_type,
        stored.artifact.size,
    );
    let (content, data_base64) = if payload == ArtifactPayload::Omitted {
        // Sem payload útil não vale ler do disco um arquivo que pode ter
        // centenas de MB: a prévia lê o arquivo por conta própria.
        (None, None)
    } else {
        let bytes = read_artifact_file(&stored.path)?;
        payload_strings(payload, &bytes)
    };
    Ok(Some(ArtifactContent {
        artifact: stored.artifact,
        content,
        data_base64,
    }))
}

/* ------------------------------------------------------------------ */
/* Structured previews (DOCX / XLSX / PPTX / image / archive / binary) */
/* ------------------------------------------------------------------ */

/// Converte tipo + bytes de um artefato em uma prévia estruturada.
///
/// Função pura (sem Tauri e sem disco) para ser testada com as fixtures reais de
/// `documents/testdata/`. Áudio, vídeo, PDF e textuais devolvem `Unsupported`
/// com o motivo: o renderer os desenha a partir de `get_artifact_content`
/// (player nativo, pdf.js, texto/HTML). Arquivo corrompido é `Err` — nunca uma
/// prévia vazia fingindo sucesso.
pub fn preview_for(kind: &ArtifactKind, bytes: &[u8]) -> Result<ArtifactPreview, String> {
    match kind {
        ArtifactKind::Docx => docx_html(bytes)
            .map(|html| ArtifactPreview::Docx { html })
            .map_err(|error| format!("falha ao gerar a prévia do DOCX: {error:#}")),
        ArtifactKind::Xlsx => xlsx_sheets(bytes)
            .map(|sheets| ArtifactPreview::Xlsx { sheets })
            .map_err(|error| format!("falha ao gerar a prévia da planilha: {error:#}")),
        ArtifactKind::Pptx => pptx_slides(bytes)
            .map(|slides| ArtifactPreview::Pptx { slides })
            .map_err(|error| format!("falha ao gerar a prévia da apresentação: {error:#}")),
        ArtifactKind::Image => image_preview(bytes)
            .map_err(|error| format!("falha ao gerar a prévia da imagem: {error:#}")),
        ArtifactKind::Archive => archive_preview(bytes)
            .map_err(|error| format!("falha ao ler o arquivo compactado: {error:#}")),
        ArtifactKind::Binary => Ok(binary_preview(bytes)),
        ArtifactKind::Pdf => Ok(ArtifactPreview::Unsupported {
            reason: "o PDF é renderizado no visualizador (pdf.js) a partir do conteúdo base64"
                .to_string(),
        }),
        ArtifactKind::Audio | ArtifactKind::Video => Ok(ArtifactPreview::Unsupported {
            reason: "áudio e vídeo são reproduzidos no player nativo a partir do conteúdo base64"
                .to_string(),
        }),
        ArtifactKind::Markdown
        | ArtifactKind::Code
        | ArtifactKind::Text
        | ArtifactKind::Html
        | ArtifactKind::Csv
        | ArtifactKind::Json
        | ArtifactKind::Svg => Ok(ArtifactPreview::Unsupported {
            reason: "artefatos textuais são exibidos como texto/HTML por get_artifact_content"
                .to_string(),
        }),
    }
}

/// Prévia estruturada do artefato; `None` quando o id não existe.
#[tauri::command]
pub fn get_artifact_preview(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ArtifactPreview>, String> {
    let Some(stored) = state.db.get_artifact(&id).map_err(to_error)? else {
        return Ok(None);
    };
    let bytes = read_artifact_file(&stored.path)?;
    preview_for(&stored.artifact.kind, &bytes).map(Some)
}

/// Keeps only the file name portion of a user-supplied name.
fn sanitize_file_name(name: &str) -> String {
    let name = name.trim();
    let name = Path::new(name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .trim();
    if name.is_empty() {
        "artefato".to_string()
    } else {
        name.to_string()
    }
}

#[tauri::command]
pub fn save_artifact(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    suggested_name: Option<String>,
) -> Result<Option<String>, String> {
    let Some(stored) = state.db.get_artifact(&id).map_err(to_error)? else {
        return Err(format!("artefato não encontrado: {id}"));
    };
    let bytes = read_artifact_file(&stored.path)?;
    let file_name = suggested_name
        .as_deref()
        .map(sanitize_file_name)
        .unwrap_or_else(|| sanitize_file_name(&stored.artifact.name));

    let extension = Path::new(&file_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_lowercase())
        .filter(|extension| !extension.is_empty());
    let builder = app.dialog().file().set_file_name(&file_name);
    let builder = match extension.as_deref() {
        Some(extension) => {
            let label = extension.to_uppercase();
            builder.add_filter(label, &[extension])
        }
        None => builder,
    };
    let Some(selected) = builder.blocking_save_file() else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("caminho de destino inválido: {error}"))?;
    std::fs::write(&path, bytes)
        .map_err(|error| format!("falha ao gravar {}: {error}", path.display()))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn open_artifact(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let Some(stored) = state.db.get_artifact(&id).map_err(to_error)? else {
        return Err(format!("artefato não encontrado: {id}"));
    };
    if !Path::new(&stored.path).exists() {
        return Err(format!(
            "o arquivo do artefato não existe mais no disco: {}",
            stored.path
        ));
    }
    app.opener()
        .open_path(stored.path, None::<&str>)
        .map_err(|error| format!("falha ao abrir o artefato: {error}"))
}

#[tauri::command]
pub fn delete_artifact(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let _ = &app;
    delete_artifact_impl(&state.db, &id)
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    // Fixtures reais do repositório: o mesmo arquivo que o painel de anexos usa.
    const DOCX: &[u8] = include_bytes!("../documents/testdata/relatorio-trimestral.docx");
    const XLSX: &[u8] = include_bytes!("../documents/testdata/vendas-q3.xlsx");
    const PPTX: &[u8] = include_bytes!("../documents/testdata/apresentacao-q3.pptx");
    const PDF: &[u8] = include_bytes!("../documents/testdata/contrato-servicos.pdf");
    const PNG: &[u8] = include_bytes!("../documents/testdata/grafico-receita.png");
    const TIFF: &[u8] = include_bytes!("../documents/testdata/scan-tiff.tif");
    const ZIP: &[u8] = include_bytes!("../documents/testdata/pacote-projeto.zip");

    fn cells(rows: &[Vec<String>]) -> Vec<String> {
        rows.iter().flatten().cloned().collect()
    }

    fn digits_only(text: &str) -> String {
        text.chars()
            .filter(|character| character.is_ascii_digit())
            .collect()
    }

    #[test]
    fn docx_preview_returns_sanitized_html() {
        match preview_for(&ArtifactKind::Docx, DOCX).expect("prévia do DOCX") {
            ArtifactPreview::Docx { html } => {
                assert!(
                    html.contains("Relatório Trimestral — Aurora Analytics"),
                    "título ausente no HTML: {}",
                    &html[..html.len().min(300)]
                );
                assert!(html.contains("<h1"), "heading deve virar <h1>: {html}");
                assert!(html.contains("<li"), "lista deve virar <li>: {html}");
                assert!(html.contains("<table"), "tabela deve virar <table>: {html}");
                assert!(html.contains("Plataforma"), "célula da tabela ausente: {html}");
            }
            other => panic!("esperado ArtifactPreview::Docx, veio {other:?}"),
        }
    }

    #[test]
    fn xlsx_preview_returns_sheets_with_cells() {
        match preview_for(&ArtifactKind::Xlsx, XLSX).expect("prévia da planilha") {
            ArtifactPreview::Xlsx { sheets } => {
                let names: Vec<&str> = sheets.iter().map(|sheet| sheet.name.as_str()).collect();
                assert_eq!(names, vec!["Vendas", "Metas"]);

                let vendas = &sheets[0];
                assert_eq!(vendas.rows.len(), 4, "linhas: {:?}", vendas.rows);
                let vendas_cells = cells(&vendas.rows);
                assert!(vendas_cells.iter().any(|cell| cell == "Setembro"));
                assert!(
                    vendas_cells
                        .iter()
                        .any(|cell| digits_only(cell) == "1830000"),
                    "valor de Setembro ausente: {vendas_cells:?}"
                );
                assert!(!vendas.truncated, "fixture pequena não deve truncar");
            }
            other => panic!("esperado ArtifactPreview::Xlsx, veio {other:?}"),
        }
    }

    #[test]
    fn pptx_preview_returns_ordered_slides() {
        match preview_for(&ArtifactKind::Pptx, PPTX).expect("prévia da apresentação") {
            ArtifactPreview::Pptx { slides } => {
                assert_eq!(slides.len(), 3);
                assert_eq!(slides[0].index, 1);
                assert_eq!(slides[2].index, 3);

                let all_text: String = slides
                    .iter()
                    .flat_map(|slide| slide.texts.iter())
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n");
                assert!(all_text.contains("Resultados Q3 2026"), "capa: {all_text}");
                assert!(all_text.contains("Próximos passos"), "slide 3: {all_text}");
                assert!(
                    all_text.contains("engenheiros de dados"),
                    "bullets do slide 3: {all_text}"
                );
            }
            other => panic!("esperado ArtifactPreview::Pptx, veio {other:?}"),
        }
    }

    #[test]
    fn kinds_without_structured_preview_are_unsupported() {
        for (kind, bytes) in [
            (ArtifactKind::Pdf, PDF),
            (ArtifactKind::Audio, b"ID3\x04\x00\x00".as_slice()),
            (ArtifactKind::Video, b"\x00\x00\x00\x18ftypmp42".as_slice()),
            (ArtifactKind::Markdown, b"# titulo".as_slice()),
            (ArtifactKind::Csv, b"a,b\n1,2".as_slice()),
            (ArtifactKind::Json, b"{\"a\":1}".as_slice()),
            (ArtifactKind::Code, b"fn main() {}".as_slice()),
        ] {
            match preview_for(&kind, bytes).expect("unsupported não é erro de parse") {
                ArtifactPreview::Unsupported { reason } => {
                    assert!(!reason.trim().is_empty(), "motivo vazio para {kind:?}");
                }
                other => panic!("esperado Unsupported para {kind:?}, veio {other:?}"),
            }
        }
    }

    #[test]
    fn audio_and_video_previews_point_to_the_native_player() {
        for kind in [ArtifactKind::Audio, ArtifactKind::Video] {
            match preview_for(&kind, b"ignorado").expect("prévia de mídia") {
                ArtifactPreview::Unsupported { reason } => {
                    assert!(
                        reason.contains("player nativo"),
                        "motivo deve citar o player nativo para {kind:?}: {reason}"
                    );
                    assert!(
                        reason.contains("base64"),
                        "motivo deve citar o conteúdo base64 para {kind:?}: {reason}"
                    );
                }
                other => panic!("esperado Unsupported para {kind:?}, veio {other:?}"),
            }
        }
    }

    #[test]
    fn image_preview_keeps_the_original_mime_without_payload() {
        match preview_for(&ArtifactKind::Image, PNG).expect("prévia da imagem") {
            ArtifactPreview::Image {
                mime,
                width,
                height,
                data_base64,
            } => {
                assert_eq!(mime, "image/png");
                assert_eq!(width, Some(960));
                assert_eq!(height, Some(540));
                assert!(
                    data_base64.is_none(),
                    "PNG abre no WebView: o original vai por get_artifact_content"
                );
            }
            other => panic!("esperado ArtifactPreview::Image, veio {other:?}"),
        }
    }

    #[test]
    fn tiff_images_are_converted_to_png_by_the_preview() {
        match preview_for(&ArtifactKind::Image, TIFF).expect("prévia do TIFF") {
            ArtifactPreview::Image {
                mime,
                width,
                height,
                data_base64,
            } => {
                assert_eq!(mime, "image/png", "TIFF não abre no WebView");
                assert_eq!(width, Some(160));
                assert_eq!(height, Some(100));
                let payload = data_base64.expect("TIFF precisa do PNG convertido");
                assert!(
                    payload.starts_with("iVBORw0KGgo"),
                    "payload convertido deveria ser PNG: {}",
                    &payload[..payload.len().min(24)]
                );
            }
            other => panic!("esperado ArtifactPreview::Image, veio {other:?}"),
        }
    }

    #[test]
    fn archive_preview_lists_zip_entries() {
        match preview_for(&ArtifactKind::Archive, ZIP).expect("prévia do ZIP") {
            ArtifactPreview::Archive {
                format,
                entries,
                total_entries,
                truncated,
            } => {
                assert_eq!(format, "zip");
                assert_eq!(total_entries, 4);
                assert!(!truncated, "fixture pequena não deve truncar");
                let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
                for expected in [
                    "pacote-projeto/",
                    "pacote-projeto/LEIAME.md",
                    "pacote-projeto/app.py",
                    "pacote-projeto/dados.csv",
                ] {
                    assert!(
                        names.contains(&expected),
                        "entrada {expected} ausente: {names:?}"
                    );
                }
                assert_eq!(
                    entries.iter().filter(|entry| entry.is_dir).count(),
                    1,
                    "apenas o diretório do fixture deve ser is_dir"
                );
                let app = entries
                    .iter()
                    .find(|entry| entry.name.ends_with("app.py"))
                    .expect("app.py listado");
                assert!(app.size > 0 && app.compressed_size > 0);
            }
            other => panic!("esperado ArtifactPreview::Archive, veio {other:?}"),
        }
    }

    #[test]
    fn non_zip_archive_falls_back_to_unsupported() {
        match preview_for(&ArtifactKind::Archive, b"nao e um arquivo compactado")
            .expect("contêiner desconhecido não é erro de parse")
        {
            ArtifactPreview::Unsupported { reason } => {
                assert!(!reason.trim().is_empty(), "motivo vazio");
            }
            other => panic!("esperado Unsupported para TAR/7z/RAR, veio {other:?}"),
        }
    }

    #[test]
    fn binary_preview_returns_a_truncated_hexdump() {
        let bytes = [0u8, 1, 2, 0xff, b'a', b'b', b'c'];
        match preview_for(&ArtifactKind::Binary, &bytes).expect("prévia de binário") {
            ArtifactPreview::Binary {
                format,
                preview_base64,
                preview_bytes,
            } => {
                assert_eq!(format, "application/octet-stream");
                assert_eq!(preview_bytes, bytes.len() as u32);
                assert_eq!(
                    preview_base64,
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                );
            }
            other => panic!("esperado ArtifactPreview::Binary, veio {other:?}"),
        }

        // Arquivo vazio continua virando uma prévia válida (sem bytes).
        match preview_for(&ArtifactKind::Binary, b"").expect("binário vazio") {
            ArtifactPreview::Binary {
                preview_base64,
                preview_bytes,
                ..
            } => {
                assert!(preview_base64.is_empty());
                assert_eq!(preview_bytes, 0);
            }
            other => panic!("esperado ArtifactPreview::Binary, veio {other:?}"),
        }
    }

    #[test]
    fn corrupt_office_files_are_reported_as_errors() {
        let corrupt = b"isto nao e um arquivo OOXML";
        for kind in [ArtifactKind::Docx, ArtifactKind::Xlsx, ArtifactKind::Pptx] {
            let result = preview_for(&kind, corrupt);
            assert!(
                result.is_err(),
                "arquivo corrompido ({kind:?}) deve ser Err, veio {result:?}"
            );
        }
        assert!(preview_for(&ArtifactKind::Docx, b"").is_err());
    }

    #[test]
    fn preview_errors_use_a_portuguese_context() {
        let corrupt = b"isto nao e um arquivo valido";
        let docx = preview_for(&ArtifactKind::Docx, corrupt).expect_err("DOCX corrompido");
        assert!(
            docx.starts_with("falha ao gerar a prévia do DOCX:"),
            "contexto pt-BR ausente: {docx}"
        );

        // ZIP corrompido (assinatura válida, conteúdo inválido) vira Err com o
        // mesmo cuidado — nunca uma listagem vazia fingindo sucesso.
        let zip = preview_for(&ArtifactKind::Archive, b"PK\x03\x04lixo")
            .expect_err("ZIP corrompido deve ser Err");
        assert!(
            zip.starts_with("falha ao ler o arquivo compactado:"),
            "contexto pt-BR ausente: {zip}"
        );
        assert!(
            !zip.contains("ZipError"),
            "mensagem não deve vazar o debug cru do parser: {zip}"
        );
    }

    /* ---------------- payload de get_artifact_content ---------------- */

    #[test]
    fn textual_artifacts_ship_text_and_pdf_ships_base64() {
        for kind in [
            ArtifactKind::Markdown,
            ArtifactKind::Code,
            ArtifactKind::Text,
            ArtifactKind::Html,
            ArtifactKind::Csv,
            ArtifactKind::Json,
            ArtifactKind::Svg,
        ] {
            assert_eq!(
                payload_for(&kind, "text/plain", 10),
                ArtifactPayload::Text,
                "{kind:?} é textual"
            );
        }
        assert_eq!(
            payload_for(&ArtifactKind::Pdf, "application/pdf", 1_024),
            ArtifactPayload::Base64
        );
    }

    #[test]
    fn webview_images_ship_base64_and_converted_formats_do_not() {
        for mime in [
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "image/avif",
            "image/bmp",
            "image/x-icon",
            "image/vnd.microsoft.icon",
        ] {
            assert_eq!(
                payload_for(&ArtifactKind::Image, mime, 10),
                ArtifactPayload::Base64,
                "{mime} abre no WebView"
            );
        }
        // Caso e parâmetros do MIME gravado não mudam a decisão.
        assert_eq!(
            payload_for(&ArtifactKind::Image, "IMAGE/PNG; charset=binary", 10),
            ArtifactPayload::Base64
        );
        for mime in [
            "image/tiff",
            "image/heic",
            "image/heif",
            "application/octet-stream",
            "",
        ] {
            assert_eq!(
                payload_for(&ArtifactKind::Image, mime, 10),
                ArtifactPayload::Omitted,
                "{mime:?} não abre no WebView: a prévia entrega o PNG"
            );
        }
    }

    #[test]
    fn office_archive_and_binary_artifacts_ship_no_payload() {
        for kind in [
            ArtifactKind::Docx,
            ArtifactKind::Xlsx,
            ArtifactKind::Pptx,
            ArtifactKind::Archive,
            ArtifactKind::Binary,
        ] {
            assert_eq!(
                payload_for(&kind, "application/octet-stream", 10),
                ArtifactPayload::Omitted,
                "{kind:?} é lido pela prévia, não pelo IPC"
            );
        }
    }

    #[test]
    fn media_payload_is_capped_at_24_mib() {
        assert_eq!(MAX_INLINE_MEDIA_BYTES, 24 * 1024 * 1024);
        let cap = MAX_INLINE_MEDIA_BYTES as i64;
        for kind in [ArtifactKind::Audio, ArtifactKind::Video] {
            assert_eq!(
                payload_for(&kind, "audio/mpeg", 1),
                ArtifactPayload::Base64,
                "{kind:?} pequeno toca inline"
            );
            assert_eq!(
                payload_for(&kind, "video/mp4", cap),
                ArtifactPayload::Base64,
                "{kind:?} no limite ainda trafega"
            );
            assert_eq!(
                payload_for(&kind, "video/mp4", cap + 1),
                ArtifactPayload::Omitted,
                "{kind:?} acima do limite vira cartão com Abrir/Salvar"
            );
            assert_eq!(
                payload_for(&kind, "video/mp4", i64::MAX),
                ArtifactPayload::Omitted
            );
            assert_eq!(
                payload_for(&kind, "video/mp4", -1),
                ArtifactPayload::Omitted,
                "tamanho inválido/legado não trafega bytes"
            );
        }
    }

    #[test]
    fn payload_strings_encode_text_and_base64() {
        assert_eq!(
            payload_strings(ArtifactPayload::Text, "ação ção".as_bytes()),
            (Some("ação ção".to_string()), None)
        );
        assert_eq!(
            payload_strings(ArtifactPayload::Base64, &[0, 1, 2]),
            (None, Some("AAEC".to_string()))
        );
        assert_eq!(
            payload_strings(ArtifactPayload::Omitted, b"ignorado"),
            (None, None)
        );
        // UTF-8 inválido não derruba o comando: perde só o byte ruim.
        let (content, data) = payload_strings(ArtifactPayload::Text, &[b'o', b'k', 0xff]);
        let content = content.expect("conteúdo textual");
        assert!(content.starts_with("ok"));
        assert!(content.contains('\u{fffd}'));
        assert!(data.is_none());
    }

    #[test]
    fn preview_serializes_with_the_ipc_kind_tag() {
        let docx = serde_json::to_value(
            preview_for(&ArtifactKind::Docx, DOCX).expect("prévia do DOCX"),
        )
        .expect("serializar prévia");
        assert_eq!(docx["kind"], "docx");
        assert!(docx["html"].is_string());

        let xlsx = serde_json::to_value(
            preview_for(&ArtifactKind::Xlsx, XLSX).expect("prévia da planilha"),
        )
        .expect("serializar prévia");
        assert_eq!(xlsx["kind"], "xlsx");
        assert!(xlsx["sheets"].is_array());

        let unsupported = serde_json::to_value(
            preview_for(&ArtifactKind::Pdf, PDF).expect("prévia do PDF"),
        )
        .expect("serializar prévia");
        assert_eq!(unsupported["kind"], "unsupported");
        assert!(unsupported["reason"].is_string());

        let image = serde_json::to_value(
            preview_for(&ArtifactKind::Image, PNG).expect("prévia da imagem"),
        )
        .expect("serializar prévia");
        assert_eq!(image["kind"], "image");
        assert_eq!(image["mime"], "image/png");
        assert_eq!(image["width"], 960);
        // O campo precisa existir com o nome camelCase, mesmo quando é `None`
        // (o renderer o lê como `dataBase64`).
        assert!(
            image.get("dataBase64").is_some(),
            "payload opcional deve sair como dataBase64: {image}"
        );

        let archive = serde_json::to_value(
            preview_for(&ArtifactKind::Archive, ZIP).expect("prévia do ZIP"),
        )
        .expect("serializar prévia");
        assert_eq!(archive["kind"], "archive");
        assert_eq!(archive["format"], "zip");
        assert_eq!(archive["totalEntries"], 4);
        assert_eq!(archive["truncated"], false);
        assert!(archive["entries"].is_array());

        let binary = serde_json::to_value(
            preview_for(&ArtifactKind::Binary, b"\x00\x01bin").expect("prévia binária"),
        )
        .expect("serializar prévia");
        assert_eq!(binary["kind"], "binary");
        assert_eq!(binary["previewBytes"], 5);
        assert!(binary["previewBase64"].is_string());

        let audio = serde_json::to_value(
            preview_for(&ArtifactKind::Audio, b"ID3").expect("prévia de áudio"),
        )
        .expect("serializar prévia");
        assert_eq!(audio["kind"], "unsupported");
        assert!(audio["reason"]
            .as_str()
            .is_some_and(|reason| !reason.is_empty()));
    }

    /* -------------------------------------------------------------- */
    /* Biblioteca: upload, rename, favorito, miniatura e exclusão      */
    /* -------------------------------------------------------------- */

    use crate::tools::artifacts::write_artifact;

    struct TempDir {
        path: std::path::PathBuf,
    }

    impl TempDir {
        fn new(prefix: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
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
        Db::open_in_memory().expect("banco em memória")
    }

    /// Cria um arquivo real (fonte do upload) no diretório temporário.
    fn write_source(dir: &Path, name: &str, bytes: &[u8]) -> String {
        let path = dir.join(name);
        std::fs::write(&path, bytes).expect("gravar arquivo de origem");
        path.to_string_lossy().into_owned()
    }

    /// Cria um artefato usando o writer real (mesma classificação da produção).
    fn seed_artifact(db: &Db, data_dir: &Path, name: &str, bytes: &[u8]) -> Artifact {
        write_artifact(db, data_dir, None, None, name, bytes, None).expect("criar artefato")
    }

    fn artifact_path(db: &Db, id: &str) -> String {
        db.get_artifact(id)
            .expect("ler artefato")
            .expect("artefato presente")
            .path
    }

    fn decode_png(thumbnail: &ArtifactThumbnail) -> image::DynamicImage {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&thumbnail.data_base64)
            .expect("base64 da miniatura");
        assert!(bytes.starts_with(b"\x89PNG"), "miniatura deve ser PNG");
        image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
            .expect("decodificar a miniatura")
    }

    #[test]
    fn import_library_files_copies_real_files_without_a_conversation() {
        let data = TempDir::new("lib-import-data");
        let sources = TempDir::new("lib-import-src");
        let db = test_db();
        let png = write_source(&sources.path, "grafico.png", PNG);
        let pdf = write_source(&sources.path, "contrato final.pdf", PDF);
        let txt = write_source(&sources.path, "notas.txt", b"linha 1\nlinha 2\n");

        let imported =
            import_library_files_impl(&db, &data.path, &[png, pdf, txt]).expect("importar");
        assert_eq!(imported.len(), 3);
        assert!(
            imported.iter().all(|artifact| artifact.conversation_id.is_none()),
            "upload da biblioteca não pertence a conversa"
        );
        assert!(imported.iter().all(|artifact| !artifact.favorite));

        let image = imported
            .iter()
            .find(|artifact| artifact.name == "grafico.png")
            .expect("PNG importado");
        assert_eq!(image.kind, ArtifactKind::Image);
        assert_eq!(image.mime_type, "image/png");
        assert_eq!(image.size, PNG.len() as i64);
        let stored = db.get_artifact(&image.id).expect("get").expect("presente");
        assert_eq!(
            std::fs::read(&stored.path).expect("ler a cópia"),
            PNG,
            "conteúdo copiado byte a byte"
        );
        assert!(
            stored.path.contains("artifacts"),
            "cópia vive no diretório de artefatos: {}",
            stored.path
        );

        let document = imported
            .iter()
            .find(|artifact| artifact.name == "contrato final.pdf")
            .expect("PDF importado");
        assert_eq!(document.kind, ArtifactKind::Pdf);
        assert_eq!(document.mime_type, "application/pdf");

        let text = imported
            .iter()
            .find(|artifact| artifact.name == "notas.txt")
            .expect("TXT importado");
        assert_eq!(text.kind, ArtifactKind::Text);

        let library = list_library_artifacts_impl(&db).expect("listar a biblioteca");
        assert_eq!(library.len(), 3);
        assert!(
            library
                .iter()
                .all(|row| row.conversation_title.is_none()),
            "arquivos enviados não têm conversa de origem"
        );
    }

    #[test]
    fn import_library_files_is_best_effort_and_reports_the_first_error() {
        let data = TempDir::new("lib-import-fail-data");
        let sources = TempDir::new("lib-import-fail-src");
        let db = test_db();
        let directory = sources.path.to_string_lossy().into_owned();
        let missing = sources
            .path
            .join("nao-existe.pdf")
            .to_string_lossy()
            .into_owned();

        // Nenhum importou → Err com o primeiro erro (o diretório).
        let error =
            import_library_files_impl(&db, &data.path, &[directory.clone(), missing.clone()])
                .expect_err("diretório e arquivo ausente");
        assert!(
            error.contains("não é um arquivo regular"),
            "primeiro erro: {error}"
        );
        assert!(db
            .list_library_artifacts()
            .expect("listar")
            .is_empty());

        // Um válido + um inválido → best-effort devolve só o válido.
        let valid = write_source(&sources.path, "ok.png", PNG);
        let imported =
            import_library_files_impl(&db, &data.path, &[missing, valid]).expect("best-effort");
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].name, "ok.png");

        // Lista vazia é no-op (o seletor nativo não fecha com erro).
        assert!(import_library_files_impl(&db, &data.path, &[])
            .expect("vazio")
            .is_empty());
    }

    #[test]
    fn import_library_files_respects_the_file_count_and_size_caps() {
        let data = TempDir::new("lib-import-caps-data");
        let sources = TempDir::new("lib-import-caps-src");
        let db = test_db();

        // 100 arquivos é o teto: o excedente é ignorado.
        let paths: Vec<String> = (0..MAX_LIBRARY_IMPORT_FILES + 3)
            .map(|index| {
                write_source(
                    &sources.path,
                    &format!("nota-{index:03}.txt"),
                    b"conteudo",
                )
            })
            .collect();
        let imported = import_library_files_impl(&db, &data.path, &paths).expect("importar");
        assert_eq!(imported.len(), MAX_LIBRARY_IMPORT_FILES);
        assert_eq!(
            db.list_library_artifacts().expect("listar").len(),
            MAX_LIBRARY_IMPORT_FILES
        );

        // Acima de 256 MiB por arquivo é rejeitado antes de copiar (set_len não
        // grava os bytes: o teste não aloca 256 MiB em disco).
        let huge = sources.path.join("gigante.bin");
        let file = std::fs::File::create(&huge).expect("criar arquivo grande");
        file.set_len(MAX_LIBRARY_IMPORT_BYTES + 1)
            .expect("ajustar tamanho lógico");
        drop(file);
        let error =
            import_library_files_impl(&db, &data.path, &[huge.to_string_lossy().into_owned()])
                .expect_err("arquivo acima do limite");
        assert!(error.contains("excede o limite"), "mensagem: {error}");
    }

    #[test]
    fn import_library_files_keeps_the_sanitized_upload_name() {
        let data = TempDir::new("lib-import-name-data");
        let sources = TempDir::new("lib-import-name-src");
        let db = test_db();
        // Espaços repetidos/quebras são colapsados por `sanitize_filename`
        // (mesmo nome que o writer usa); acentos são preservados.
        let weird = write_source(&sources.path, "relatório   final.md", b"# Q3\n");
        let imported = import_library_files_impl(&db, &data.path, &[weird]).expect("importar");
        assert_eq!(imported[0].name, "relatório final.md", "sanitização do writer");
        assert_eq!(imported[0].kind, ArtifactKind::Markdown);
        let stored = db.get_artifact(&imported[0].id).expect("get").expect("presente");
        assert!(stored.path.ends_with("relatório final.md"));
    }

    #[test]
    fn rename_preserves_the_original_extension_and_moves_the_file() {
        let data = TempDir::new("lib-rename-data");
        let db = test_db();
        let artifact = seed_artifact(&db, &data.path, "grafico.png", PNG);
        let old_path = artifact_path(&db, &artifact.id);

        let renamed = rename_artifact_impl(&db, &artifact.id, "receita final")
            .expect("renomear sem extensão");
        assert_eq!(renamed.name, "receita final.png", "extensão original preservada");
        assert_eq!(renamed.kind, ArtifactKind::Image);
        assert_eq!(renamed.mime_type, "image/png");
        assert_eq!(renamed.id, artifact.id, "o id não muda");
        assert!(renamed.conversation_id.is_none());
        assert!(renamed.language.is_none());

        let new_path = artifact_path(&db, &artifact.id);
        assert!(new_path.ends_with("receita final.png"));
        assert!(!Path::new(&old_path).exists(), "arquivo antigo removido");
        assert_eq!(std::fs::read(&new_path).expect("ler arquivo novo"), PNG);

        let library = list_library_artifacts_impl(&db).expect("listar");
        assert_eq!(library[0].artifact.name, "receita final.png");
    }

    #[test]
    fn rename_recomputes_mime_kind_and_language_from_the_new_name() {
        let data = TempDir::new("lib-rename-kind-data");
        let db = test_db();
        let artifact = seed_artifact(&db, &data.path, "notas.txt", b"linha de anotacao\n");

        let renamed = rename_artifact_impl(&db, &artifact.id, "src/app.ts").expect("renomear");
        // Diretório é sempre a pasta do artefato: só o basename vale.
        assert_eq!(renamed.name, "app.ts");
        assert_eq!(renamed.kind, ArtifactKind::Code);
        assert_eq!(renamed.mime_type, "text/plain");
        assert_eq!(renamed.language.as_deref(), Some("typescript"));
        assert!(artifact_path(&db, &artifact.id).ends_with("app.ts"));
    }

    #[test]
    fn rename_keeps_an_explicit_extension_and_accepts_the_same_name() {
        let data = TempDir::new("lib-rename-explicit-data");
        let db = test_db();
        let artifact = seed_artifact(&db, &data.path, "notas.txt", b"texto\n");

        let renamed =
            rename_artifact_impl(&db, &artifact.id, "LEIAME.txt").expect("renomear com extensão");
        assert_eq!(renamed.name, "LEIAME.txt");
        assert_eq!(renamed.kind, ArtifactKind::Text);

        // Renomear para o mesmo nome é um no-op válido (não apaga o arquivo).
        let same = rename_artifact_impl(&db, &artifact.id, "LEIAME.txt").expect("mesmo nome");
        assert_eq!(same.name, "LEIAME.txt");
        assert!(Path::new(&artifact_path(&db, &artifact.id)).is_file());
    }

    #[test]
    fn rename_rejects_collisions_missing_ids_and_invalid_names() {
        let data = TempDir::new("lib-rename-fail-data");
        let db = test_db();
        let artifact = seed_artifact(&db, &data.path, "a.txt", b"a");
        let directory = data.path.join("artifacts").join(&artifact.id);
        std::fs::write(directory.join("ocupado.pdf"), b"x").expect("arquivo concorrente");

        let collision = rename_artifact_impl(&db, &artifact.id, "ocupado.pdf")
            .expect_err("colisão no diretório");
        assert!(collision.contains("já existe"), "mensagem: {collision}");
        // Nada mudou: o artefato continua com o nome/arquivo original.
        let stored = db
            .get_artifact(&artifact.id)
            .expect("get")
            .expect("presente");
        assert_eq!(stored.artifact.name, "a.txt");
        assert_eq!(stored.path, directory.join("a.txt").to_string_lossy());

        let missing = rename_artifact_impl(&db, "nao-existe", "b.txt").expect_err("id inválido");
        assert!(missing.contains("não encontrado"), "mensagem: {missing}");

        let empty = rename_artifact_impl(&db, &artifact.id, "   ").expect_err("nome vazio");
        assert!(empty.contains("vazio"), "mensagem: {empty}");
        assert!(db.get_artifact(&artifact.id).expect("get").is_some());
    }

    #[test]
    fn rename_reports_a_missing_file_instead_of_lying() {
        let data = TempDir::new("lib-rename-missing-file-data");
        let db = test_db();
        let artifact = seed_artifact(&db, &data.path, "notas.txt", b"texto\n");
        std::fs::remove_file(artifact_path(&db, &artifact.id)).expect("apagar o arquivo");

        let error =
            rename_artifact_impl(&db, &artifact.id, "novo.txt").expect_err("arquivo ausente");
        assert!(
            error.contains("não está acessível"),
            "o erro deve apontar o arquivo ausente: {error}"
        );
        let stored = db
            .get_artifact(&artifact.id)
            .expect("get")
            .expect("registro preservado");
        assert_eq!(stored.artifact.name, "notas.txt");
    }

    #[test]
    fn set_artifact_favorite_returns_the_updated_artifact_or_errors() {
        let data = TempDir::new("lib-favorite-data");
        let sources = TempDir::new("lib-favorite-src");
        let db = test_db();
        let source = write_source(&sources.path, "contrato.pdf", PDF);
        let imported =
            import_library_files_impl(&db, &data.path, &[source]).expect("importar");
        let id = imported[0].id.clone();

        let favorited =
            set_artifact_favorite_impl(&db, &id, true).expect("favoritar upload");
        assert!(favorited.favorite);
        assert_eq!(favorited.id, id);

        let error = set_artifact_favorite_impl(&db, "nao-existe", true).expect_err("id inválido");
        assert!(error.contains("não encontrado"), "mensagem: {error}");
    }

    #[test]
    fn list_library_artifacts_joins_the_origin_conversation_title() {
        let data = TempDir::new("lib-list-data");
        let sources = TempDir::new("lib-list-src");
        let db = test_db();
        let conversation = db
            .create_conversation("Conversa de origem", "opencode-go", "glm-5.3-flash")
            .expect("criar conversa");
        write_artifact(
            &db,
            &data.path,
            Some(&conversation.id),
            None,
            "resumo.md",
            b"# resumo",
            None,
        )
        .expect("artefato gerado");
        let source = write_source(&sources.path, "contrato.pdf", PDF);
        import_library_files_impl(&db, &data.path, &[source]).expect("upload");

        let library = list_library_artifacts_impl(&db).expect("listar");
        assert_eq!(library.len(), 2);
        let generated = library
            .iter()
            .find(|row| row.artifact.kind == ArtifactKind::Markdown)
            .expect("artefato gerado listado");
        assert_eq!(
            generated.conversation_title.as_deref(),
            Some("Conversa de origem")
        );
        let upload = library
            .iter()
            .find(|row| row.artifact.conversation_id.is_none())
            .expect("upload listado");
        assert!(upload.conversation_title.is_none());
    }

    #[test]
    fn thumbnail_resizes_a_png_to_the_card_size() {
        let data = TempDir::new("lib-thumb-png-data");
        let db = test_db();
        let artifact = seed_artifact(&db, &data.path, "grafico.png", PNG);
        let thumbnail = get_artifact_thumbnail_impl(&db, &artifact.id)
            .expect("miniatura")
            .expect("PNG tem miniatura");
        assert_eq!(thumbnail.mime, "image/png");
        assert_eq!(thumbnail.width, THUMBNAIL_MAX_PX);
        assert_eq!(thumbnail.height, 288, "960x540 reduzidos para 512x288");
        let decoded = decode_png(&thumbnail);
        assert_eq!(decoded.width(), THUMBNAIL_MAX_PX);
        assert_eq!(decoded.height(), 288);
    }

    #[test]
    fn thumbnail_converts_a_tiff_to_png_without_upscaling() {
        let data = TempDir::new("lib-thumb-tiff-data");
        let db = test_db();
        let artifact = seed_artifact(&db, &data.path, "scan.tif", TIFF);
        let thumbnail = get_artifact_thumbnail_impl(&db, &artifact.id)
            .expect("miniatura")
            .expect("TIFF tem miniatura (convertida para PNG)");
        assert_eq!(thumbnail.mime, "image/png");
        assert_eq!((thumbnail.width, thumbnail.height), (160, 100));
        let decoded = decode_png(&thumbnail);
        assert_eq!((decoded.width(), decoded.height()), (160, 100));
    }

    #[test]
    fn thumbnail_is_none_for_non_images_broken_images_and_missing_files() {
        let data = TempDir::new("lib-thumb-none-data");
        let db = test_db();

        // Não-imagem: nem tenta ler o arquivo.
        let pdf = seed_artifact(&db, &data.path, "contrato.pdf", PDF);
        assert!(get_artifact_thumbnail_impl(&db, &pdf.id)
            .expect("sem erro")
            .is_none());

        // Imagem indecodificável (extensão diz PNG, conteúdo não).
        let broken = seed_artifact(&db, &data.path, "quebrada.png", b"nao e uma imagem");
        assert!(get_artifact_thumbnail_impl(&db, &broken.id)
            .expect("sem erro")
            .is_none());

        // Arquivo ausente no disco.
        let missing = seed_artifact(&db, &data.path, "sumiu.png", PNG);
        std::fs::remove_file(artifact_path(&db, &missing.id)).expect("apagar arquivo");
        assert!(get_artifact_thumbnail_impl(&db, &missing.id)
            .expect("sem erro")
            .is_none());

        // Id inexistente.
        assert!(get_artifact_thumbnail_impl(&db, "nao-existe")
            .expect("sem erro")
            .is_none());

        // A miniatura em si não falha em imagem pequena (não faz upscale).
        let small = thumbnail_from_bytes(PNG).expect("miniatura direta");
        assert_eq!(small.width, THUMBNAIL_MAX_PX);
    }

    #[test]
    fn delete_artifact_removes_an_upload_and_its_files() {
        let data = TempDir::new("lib-delete-data");
        let sources = TempDir::new("lib-delete-src");
        let db = test_db();
        let source = write_source(&sources.path, "contrato.pdf", PDF);
        let imported =
            import_library_files_impl(&db, &data.path, &[source]).expect("importar");
        let id = imported[0].id.clone();
        let stored_path = artifact_path(&db, &id);
        let directory = data.path.join("artifacts").join(&id);
        assert!(Path::new(&stored_path).is_file());

        delete_artifact_impl(&db, &id).expect("excluir upload");
        assert!(db.get_artifact(&id).expect("get").is_none());
        assert!(!Path::new(&stored_path).exists(), "arquivo apagado");
        assert!(!directory.exists(), "diretório do artefato apagado");
        assert!(list_library_artifacts_impl(&db).expect("listar").is_empty());
    }
}
