//! Artifact commands (implemented by the storage module).

use std::path::Path;

use base64::Engine as _;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::db::remove_artifact_files;
use crate::domain::{Artifact, ArtifactContent};
use crate::state::AppState;

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

fn read_artifact_file(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path)
        .map_err(|error| format!("falha ao ler o arquivo do artefato ({path}): {error}"))
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
    let bytes = read_artifact_file(&stored.path)?;
    let (content, data_base64) = if stored.artifact.kind.is_textual() {
        (Some(String::from_utf8_lossy(&bytes).to_string()), None)
    } else {
        (
            None,
            Some(base64::engine::general_purpose::STANDARD.encode(&bytes)),
        )
    };
    Ok(Some(ArtifactContent {
        artifact: stored.artifact,
        content,
        data_base64,
    }))
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
    let stored = state.db.get_artifact(&id).map_err(to_error)?;
    state.db.delete_artifact(&id).map_err(to_error)?;
    if let Some(stored) = stored {
        remove_artifact_files(&id, &stored.path);
    }
    Ok(())
}
