//! Artifact commands (implemented by the storage module).

use std::path::Path;

use base64::Engine as _;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::db::remove_artifact_files;
use crate::documents::preview::{docx_html, pptx_slides, xlsx_sheets};
use crate::domain::{Artifact, ArtifactContent, ArtifactKind, ArtifactPreview};
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

/* ------------------------------------------------------------------ */
/* Structured previews (DOCX / XLSX / PPTX)                            */
/* ------------------------------------------------------------------ */

/// Converte tipo + bytes de um artefato em uma prévia estruturada.
///
/// Função pura (sem Tauri e sem disco) para ser testada com as fixtures reais de
/// `documents/testdata/`. Tipos sem prévia estruturada (PDF, imagens e texto)
/// devolvem `Unsupported` com o motivo: o renderer desenha esses a partir de
/// `get_artifact_content` (pdf.js/base64/texto). Arquivo corrompido é `Err` —
/// nunca uma prévia vazia fingindo sucesso.
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
        ArtifactKind::Pdf => Ok(ArtifactPreview::Unsupported {
            reason: "o PDF é renderizado no visualizador (pdf.js) a partir do conteúdo base64"
                .to_string(),
        }),
        ArtifactKind::Image => Ok(ArtifactPreview::Unsupported {
            reason: "imagens são exibidas diretamente a partir do conteúdo base64".to_string(),
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
        ArtifactKind::Binary => Ok(ArtifactPreview::Unsupported {
            reason: "prévia não disponível para arquivos binários genéricos".to_string(),
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
    let stored = state.db.get_artifact(&id).map_err(to_error)?;
    state.db.delete_artifact(&id).map_err(to_error)?;
    if let Some(stored) = stored {
        remove_artifact_files(&id, &stored.path);
    }
    Ok(())
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
            (ArtifactKind::Image, PNG),
            (ArtifactKind::Binary, PDF),
            (ArtifactKind::Markdown, b"# titulo".as_slice()),
            (ArtifactKind::Csv, b"a,b\n1,2".as_slice()),
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
    }
}
