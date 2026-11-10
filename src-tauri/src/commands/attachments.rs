//! Attachment import / inspection commands (implemented by the storage module).

use std::io::BufReader;
use std::path::{Path, PathBuf};

use image::ImageEncoder as _;
use tauri::{AppHandle, State};

use crate::commands::artifacts::{
    payload_for, payload_strings, preview_for, render_thumbnail, ArtifactPayload,
};
use crate::db::{Db, StoredAttachment};
use crate::domain::{
    now_ms, ArtifactKind, ArtifactPreview, ArtifactThumbnail, AttachmentContent, AttachmentInfo,
};
use crate::state::AppState;

/// Upper bound for a single imported file (25 MB).
const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

/// Content sniffing first (pdf/docx/images with wrong extension), then the
/// file extension, then a safe fallback.
fn detect_mime(path: &Path, bytes: &[u8]) -> String {
    if let Some(kind) = infer::get(bytes) {
        return kind.mime_type().to_string();
    }
    if let Some(mime) = mime_guess::from_path(path).first_raw() {
        return mime.to_string();
    }
    "application/octet-stream".to_string()
}

/// Extension sanitized for the stored copy (`<uuid>.<ext>`).
fn safe_extension(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.trim().to_lowercase();
    if extension.is_empty()
        || extension.len() > 12
        || !extension
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return None;
    }
    Some(extension)
}

fn attachments_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("attachments")
}

fn prepare_attachments_dir(data_dir: &Path) -> Result<PathBuf, String> {
    let directory = attachments_dir(data_dir);
    std::fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "falha ao preparar a pasta de anexos {}: {error}",
            directory.display()
        )
    })?;
    Ok(directory)
}

/// Persists `bytes` as an attachment: sniffs the MIME, extracts text/metadata
/// through `documents::extract`, copies the file to
/// `<attachments_dir>/<uuid>.<ext>` and inserts the row. The stored file is
/// removed when the INSERT fails, so an orphan never survives a failed import.
fn store_attachment(
    db: &Db,
    attachments_dir: &Path,
    name: &str,
    bytes: &[u8],
) -> Result<AttachmentInfo, String> {
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "{name}: excede o limite de {} MB",
            MAX_ATTACHMENT_BYTES / (1024 * 1024)
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let stored_name = match safe_extension(Path::new(name)) {
        Some(extension) => format!("{id}.{extension}"),
        None => format!("{id}.bin"),
    };
    let stored_path = attachments_dir.join(&stored_name);
    if let Err(error) = std::fs::write(&stored_path, bytes) {
        return Err(format!(
            "{name}: falha ao copiar para a pasta de dados ({error})"
        ));
    }

    let mime_type = detect_mime(Path::new(name), bytes);
    // Extraction failures never abort the import: keep the file with an
    // empty text body so the user can still attach it.
    let (kind, text, page_count, width, height) =
        match crate::documents::extract(bytes, name, &mime_type) {
            Ok(document) => (
                document.kind,
                document.text,
                document.page_count,
                document.width,
                document.height,
            ),
            Err(_) => ("unknown".to_string(), String::new(), None, None, None),
        };

    let attachment = StoredAttachment {
        id,
        name: name.to_string(),
        mime_type,
        size: i64::try_from(bytes.len()).unwrap_or(i64::MAX),
        kind,
        text,
        page_count,
        width,
        height,
        file_path: Some(stored_path.to_string_lossy().to_string()),
        created_at: now_ms(),
    };
    if let Err(error) = db.insert_attachment(&attachment) {
        let _ = std::fs::remove_file(&stored_path);
        return Err(format!(
            "{}: falha ao salvar no banco ({})",
            attachment.name,
            to_error(error)
        ));
    }
    Ok(attachment.info())
}

/// Imports every readable path, accumulating per-file errors. A partial import
/// still returns the attachments that succeeded; `Err` only when nothing did.
fn import_paths_impl(
    db: &Db,
    attachments_dir: &Path,
    paths: Vec<String>,
) -> Result<Vec<AttachmentInfo>, String> {
    let mut imported: Vec<AttachmentInfo> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for raw_path in path_list(paths) {
        let path = Path::new(&raw_path);
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("arquivo")
            .to_string();

        let metadata = match std::fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) => {
                errors.push(format!("{raw_path}: {error}"));
                continue;
            }
        };
        if !metadata.is_file() {
            errors.push(format!("{raw_path}: não é um arquivo"));
            continue;
        }
        if metadata.len() > MAX_ATTACHMENT_BYTES {
            errors.push(format!(
                "{name}: excede o limite de {} MB",
                MAX_ATTACHMENT_BYTES / (1024 * 1024)
            ));
            continue;
        }
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) => {
                errors.push(format!("{name}: falha ao ler o arquivo ({error})"));
                continue;
            }
        };
        match store_attachment(db, attachments_dir, &name, &bytes) {
            Ok(info) => imported.push(info),
            Err(error) => errors.push(error),
        }
    }

    if imported.is_empty() && !errors.is_empty() {
        return Err(format!(
            "nenhum arquivo pôde ser importado:\n- {}",
            errors.join("\n- ")
        ));
    }
    if !errors.is_empty() {
        // Partial import: the UI still gets the good attachments.
        eprintln!("[zylara] anexos ignorados: {}", errors.join("; "));
    }
    Ok(imported)
}

#[tauri::command]
pub fn import_attachments(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<AttachmentInfo>, String> {
    let _ = &app;
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let directory = prepare_attachments_dir(&state.data_dir)?;
    import_paths_impl(&state.db, &directory, paths)
}

/// Normalizes/trims the incoming list, dropping empty entries.
fn path_list(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect()
}

/// Resolves attachment ids from the renderer into stored metadata (order kept).
pub(crate) fn resolve_attachments(
    db: &Db,
    ids: &[String],
) -> Result<Vec<AttachmentInfo>, String> {
    let mut attachments = Vec::with_capacity(ids.len());
    for id in ids {
        let stored = db
            .get_attachment(id)
            .map_err(to_error)?
            .ok_or_else(|| format!("o anexo `{id}` não existe"))?;
        attachments.push(stored.info());
    }
    Ok(attachments)
}

/* ------------------------------------------------------------------ */
/* Clipboard paste (Ctrl+V)                                            */
/* ------------------------------------------------------------------ */

enum ClipboardPayload {
    Files(Vec<PathBuf>),
    Image {
        width: usize,
        height: usize,
        rgba: Vec<u8>,
    },
}

/// Reads files (CF_HDROP on Windows) or a bitmap from the system clipboard.
/// `Ok(None)` means "text only / empty": nothing to attach.
fn read_clipboard_payload() -> Result<Option<ClipboardPayload>, String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("falha ao acessar a área de transferência: {error}"))?;
    if let Ok(paths) = clipboard.get().file_list() {
        if !paths.is_empty() {
            return Ok(Some(ClipboardPayload::Files(paths)));
        }
    }
    if let Ok(image) = clipboard.get().image() {
        return Ok(Some(ClipboardPayload::Image {
            width: image.width,
            height: image.height,
            rgba: image.bytes.into_owned(),
        }));
    }
    // Plain text or empty clipboard: the native paste handles it.
    Ok(None)
}

/// RGBA8 → PNG (same encoder used by the artifact thumbnails).
fn rgba_to_png(width: usize, height: usize, rgba: &[u8]) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err("a imagem da área de transferência não tem dimensões válidas".to_string());
    }
    let expected = width.checked_mul(height).and_then(|pixels| pixels.checked_mul(4));
    if expected != Some(rgba.len()) {
        return Err("a imagem da área de transferência está corrompida".to_string());
    }
    let width = u32::try_from(width)
        .map_err(|_| "a imagem da área de transferência é grande demais".to_string())?;
    let height = u32::try_from(height)
        .map_err(|_| "a imagem da área de transferência é grande demais".to_string())?;
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(rgba, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|error| format!("falha ao codificar a imagem colada: {error}"))?;
    Ok(png)
}

/// `imagem-colada-20261109-143000.png` (local time).
fn clipboard_image_name() -> String {
    format!(
        "imagem-colada-{}.png",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    )
}

/// Imports whatever the clipboard holds: copied files or a bitmap. Text-only
/// and empty clipboards return an empty list (the renderer keeps native paste).
#[tauri::command]
pub fn import_clipboard_attachments(
    state: State<'_, AppState>,
) -> Result<Vec<AttachmentInfo>, String> {
    let Some(payload) = read_clipboard_payload()? else {
        return Ok(Vec::new());
    };
    let directory = prepare_attachments_dir(&state.data_dir)?;
    match payload {
        ClipboardPayload::Files(paths) => import_paths_impl(
            &state.db,
            &directory,
            paths
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
        ),
        ClipboardPayload::Image {
            width,
            height,
            rgba,
        } => {
            let png = rgba_to_png(width, height, &rgba)?;
            let info = store_attachment(&state.db, &directory, &clipboard_image_name(), &png)?;
            Ok(vec![info])
        }
    }
}

/* ------------------------------------------------------------------ */
/* Attachment content / preview / thumbnail                            */
/* ------------------------------------------------------------------ */

/// Resolves the on-disk copy: the persisted `file_path`, or the legacy fallback
/// `<attachments_dir>/<id>.<ext>` used by older rows.
fn resolve_attachment_path(
    stored: &StoredAttachment,
    attachments_dir: &Path,
) -> Option<PathBuf> {
    if let Some(file_path) = stored.file_path.as_deref() {
        let path = Path::new(file_path);
        if path.is_file() {
            return Some(path.to_path_buf());
        }
    }
    for entry in std::fs::read_dir(attachments_dir).ok()?.flatten() {
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            if name
                .strip_prefix(&stored.id)
                .is_some_and(|rest| rest.starts_with('.'))
            {
                return Some(path);
            }
        }
    }
    None
}

fn read_attachment_bytes(
    stored: &StoredAttachment,
    attachments_dir: &Path,
) -> Result<Vec<u8>, String> {
    let path = resolve_attachment_path(stored, attachments_dir)
        .ok_or_else(|| "arquivo do anexo não encontrado no disco".to_string())?;
    std::fs::read(&path).map_err(|error| format!("falha ao ler o arquivo do anexo: {error}"))
}

/// Maps the attachment `kind` slug to the artifact preview kind.
fn attachment_artifact_kind(kind: &str) -> ArtifactKind {
    match kind {
        "image" => ArtifactKind::Image,
        "pdf" => ArtifactKind::Pdf,
        "docx" => ArtifactKind::Docx,
        "xlsx" => ArtifactKind::Xlsx,
        "pptx" => ArtifactKind::Pptx,
        "csv" => ArtifactKind::Csv,
        "json" => ArtifactKind::Json,
        "code" => ArtifactKind::Code,
        "text" => ArtifactKind::Text,
        _ => ArtifactKind::Binary,
    }
}

fn get_attachment_content_impl(
    db: &Db,
    attachments_dir: &Path,
    id: &str,
) -> Result<Option<AttachmentContent>, String> {
    let Some(stored) = db.get_attachment(id).map_err(to_error)? else {
        return Ok(None);
    };
    let kind = attachment_artifact_kind(&stored.kind);
    let payload = payload_for(&kind, &stored.mime_type, stored.size);
    let (content, data_base64) = if payload == ArtifactPayload::Omitted {
        (None, None)
    } else {
        let bytes = read_attachment_bytes(&stored, attachments_dir)?;
        payload_strings(payload, &bytes)
    };
    Ok(Some(AttachmentContent {
        attachment: stored.info(),
        content,
        data_base64,
    }))
}

fn get_attachment_preview_impl(
    db: &Db,
    attachments_dir: &Path,
    id: &str,
) -> Result<Option<ArtifactPreview>, String> {
    let Some(stored) = db.get_attachment(id).map_err(to_error)? else {
        return Ok(None);
    };
    let bytes = read_attachment_bytes(&stored, attachments_dir)?;
    preview_for(&attachment_artifact_kind(&stored.kind), &bytes).map(Some)
}

fn get_attachment_thumbnail_impl(
    db: &Db,
    attachments_dir: &Path,
    id: &str,
) -> Result<Option<ArtifactThumbnail>, String> {
    let Some(stored) = db.get_attachment(id).map_err(to_error)? else {
        return Ok(None);
    };
    if stored.kind != "image" {
        return Ok(None);
    }
    let Some(path) = resolve_attachment_path(&stored, attachments_dir) else {
        return Ok(None);
    };
    let Ok(file) = std::fs::File::open(&path) else {
        return Ok(None);
    };
    // Decode/limits: any failure falls back to the chip icon, never to an IPC
    // error that would break the composer row.
    Ok(render_thumbnail(BufReader::new(file)).ok())
}

#[tauri::command]
pub fn get_attachment_content(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<AttachmentContent>, String> {
    get_attachment_content_impl(&state.db, &attachments_dir(&state.data_dir), &id)
}

#[tauri::command]
pub fn get_attachment_preview(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ArtifactPreview>, String> {
    get_attachment_preview_impl(&state.db, &attachments_dir(&state.data_dir), &id)
}

#[tauri::command]
pub fn get_attachment_thumbnail(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<ArtifactThumbnail>, String> {
    get_attachment_thumbnail_impl(&state.db, &attachments_dir(&state.data_dir), &id)
}

/* ------------------------------------------------------------------ */
/* Attachment deletion                                                 */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub fn get_attachment(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<AttachmentInfo>, String> {
    Ok(state
        .db
        .get_attachment(&id)
        .map_err(to_error)?
        .map(|attachment| attachment.info()))
}

#[tauri::command]
pub fn delete_attachment(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let _ = &app;
    let stored = state.db.get_attachment(&id).map_err(to_error)?;
    state.db.delete_attachment(&id).map_err(to_error)?;
    if let Some(stored) = stored {
        if let Some(file_path) = stored.file_path.as_deref() {
            let path = Path::new(file_path);
            // Only touch files that live inside the app attachments folder.
            if path.starts_with(attachments_dir(&state.data_dir)) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = include_bytes!("../documents/testdata/grafico-receita.png");
    const PDF: &[u8] = include_bytes!("../documents/testdata/contrato-servicos.pdf");

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(prefix: &str) -> Self {
            let path = std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
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

    #[test]
    fn store_attachment_persists_a_real_png() {
        let data = TempDir::new("attach-png");
        let db = test_db();
        let info = store_attachment(&db, &data.path, "grafico.png", PNG).expect("importar png");

        assert_eq!(info.kind, "image");
        assert_eq!(info.mime_type, "image/png");
        assert!(info.width.unwrap_or(0) > 0, "largura preenchida");
        assert!(info.height.unwrap_or(0) > 0, "altura preenchida");

        let stored = db
            .get_attachment(&info.id)
            .expect("ler anexo")
            .expect("anexo presente");
        let path = stored.file_path.expect("caminho do arquivo");
        let path = Path::new(&path);
        assert!(path.is_file(), "arquivo copiado");
        assert!(path.starts_with(&data.path), "arquivo dentro da pasta");
    }

    #[test]
    fn store_attachment_rejects_files_above_the_limit() {
        let data = TempDir::new("attach-limit");
        let db = test_db();
        let mut bytes = vec![0u8; MAX_ATTACHMENT_BYTES as usize + 1];
        bytes[0] = 0x89;
        let error = store_attachment(&db, &data.path, "grande.bin", &bytes)
            .expect_err("acima do limite");
        assert!(error.contains("excede o limite"), "got {error}");
    }

    #[test]
    fn rgba_to_png_roundtrips() {
        let rgba = [
            255u8, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
        ];
        let png = rgba_to_png(2, 2, &rgba).expect("codificar png");
        assert!(png.starts_with(b"\x89PNG"), "assinatura PNG");
        let decoded = image::load_from_memory(&png).expect("decodificar png");
        assert_eq!((decoded.width(), decoded.height()), (2, 2));
    }

    #[test]
    fn rgba_to_png_rejects_bad_dimensions() {
        assert!(rgba_to_png(0, 1, &[]).is_err());
        assert!(rgba_to_png(2, 2, &[0, 0, 0, 255]).is_err());
    }

    #[test]
    fn attachment_artifact_kind_covers_every_attachment_kind() {
        assert_eq!(attachment_artifact_kind("image"), ArtifactKind::Image);
        assert_eq!(attachment_artifact_kind("pdf"), ArtifactKind::Pdf);
        assert_eq!(attachment_artifact_kind("docx"), ArtifactKind::Docx);
        assert_eq!(attachment_artifact_kind("xlsx"), ArtifactKind::Xlsx);
        assert_eq!(attachment_artifact_kind("pptx"), ArtifactKind::Pptx);
        assert_eq!(attachment_artifact_kind("csv"), ArtifactKind::Csv);
        assert_eq!(attachment_artifact_kind("json"), ArtifactKind::Json);
        assert_eq!(attachment_artifact_kind("code"), ArtifactKind::Code);
        assert_eq!(attachment_artifact_kind("text"), ArtifactKind::Text);
        assert_eq!(attachment_artifact_kind("unknown"), ArtifactKind::Binary);
        assert_eq!(attachment_artifact_kind("qualquer"), ArtifactKind::Binary);
    }

    #[test]
    fn get_attachment_content_returns_text_and_image_payloads() {
        let data = TempDir::new("attach-content");
        let db = test_db();

        let text = store_attachment(&db, &data.path, "nota.txt", b"ola mundo").expect("texto");
        let content = get_attachment_content_impl(&db, &data.path, &text.id)
            .expect("conteúdo")
            .expect("anexo");
        assert_eq!(content.attachment.kind, "text");
        assert!(
            content.content.unwrap_or_default().contains("ola mundo"),
            "texto extraído"
        );
        assert!(content.data_base64.is_none(), "texto não trafega base64");

        let image = store_attachment(&db, &data.path, "grafico.png", PNG).expect("imagem");
        let content = get_attachment_content_impl(&db, &data.path, &image.id)
            .expect("conteúdo")
            .expect("anexo");
        assert!(
            content
                .data_base64
                .unwrap_or_default()
                .starts_with("iVBORw0KGgo"),
            "base64 do PNG"
        );
        assert!(content.content.is_none(), "imagem não trafega texto");
    }

    #[test]
    fn resolve_attachments_keeps_order_and_rejects_missing_ids() {
        let data = TempDir::new("attach-resolve");
        let db = test_db();
        let first = store_attachment(&db, &data.path, "grafico.png", PNG).expect("imagem");
        let second = store_attachment(&db, &data.path, "nota.txt", b"ola").expect("texto");

        let resolved = resolve_attachments(&db, &[second.id.clone(), first.id.clone()])
            .expect("resolver anexos");
        assert_eq!(resolved[0].id, second.id);
        assert_eq!(resolved[1].id, first.id);
        assert!(resolve_attachments(&db, &["nao-existe".to_string()]).is_err());
    }

    #[test]
    fn get_attachment_thumbnail_only_for_images() {
        let data = TempDir::new("attach-thumb");
        let db = test_db();

        let image = store_attachment(&db, &data.path, "grafico.png", PNG).expect("imagem");
        let thumbnail = get_attachment_thumbnail_impl(&db, &data.path, &image.id)
            .expect("miniatura")
            .expect("miniatura presente");
        assert_eq!(thumbnail.mime, "image/png");
        assert!(!thumbnail.data_base64.is_empty());

        let pdf = store_attachment(&db, &data.path, "contrato.pdf", PDF).expect("pdf");
        assert!(
            get_attachment_thumbnail_impl(&db, &data.path, &pdf.id)
                .expect("miniatura")
                .is_none(),
            "PDF não gera miniatura"
        );
    }
}
