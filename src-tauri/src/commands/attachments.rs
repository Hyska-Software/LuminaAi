//! Attachment import / inspection commands (implemented by the storage module).

use std::path::Path;

use tauri::{AppHandle, State};

use crate::db::StoredAttachment;
use crate::domain::{now_ms, AttachmentInfo};
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

    let attachments_dir = state.data_dir.join("attachments");
    std::fs::create_dir_all(&attachments_dir).map_err(|error| {
        format!(
            "falha ao preparar a pasta de anexos {}: {error}",
            attachments_dir.display()
        )
    })?;

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

        let id = uuid::Uuid::new_v4().to_string();
        let stored_name = match safe_extension(path) {
            Some(extension) => format!("{id}.{extension}"),
            None => format!("{id}.bin"),
        };
        let stored_path = attachments_dir.join(&stored_name);
        if let Err(error) = std::fs::write(&stored_path, &bytes) {
            errors.push(format!(
                "{name}: falha ao copiar para a pasta de dados ({error})"
            ));
            continue;
        }

        let mime_type = detect_mime(path, &bytes);
        // Extraction failures never abort the import: keep the file with an
        // empty text body so the user can still attach it.
        let (kind, text, page_count, width, height) =
            match crate::documents::extract(&bytes, &name, &mime_type) {
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
            name,
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
        if let Err(error) = state.db.insert_attachment(&attachment) {
            let _ = std::fs::remove_file(&stored_path);
            errors.push(format!(
                "{}: falha ao salvar no banco ({})",
                attachment.name,
                to_error(error)
            ));
            continue;
        }
        imported.push(attachment.info());
    }

    if imported.is_empty() && !errors.is_empty() {
        return Err(format!(
            "nenhum arquivo pôde ser importado:\n- {}",
            errors.join("\n- ")
        ));
    }
    if !errors.is_empty() {
        // Partial import: the UI still gets the good attachments.
        eprintln!("[lumina] anexos ignorados: {}", errors.join("; "));
    }
    Ok(imported)
}

/// Normalizes/trims the incoming list, dropping empty entries.
fn path_list(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect()
}

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
            if path.starts_with(state.data_dir.join("attachments")) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    Ok(())
}
