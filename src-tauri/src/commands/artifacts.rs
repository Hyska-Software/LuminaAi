//! Artifact commands (implemented by the storage module).

use std::path::Path;

use base64::Engine as _;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::db::remove_artifact_files;
use crate::documents::preview::{
    archive_preview, binary_preview, docx_html, image_preview, pptx_slides, xlsx_sheets,
};
use crate::domain::{Artifact, ArtifactContent, ArtifactKind, ArtifactPreview};
use crate::state::AppState;

fn to_error(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

fn read_artifact_file(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path)
        .map_err(|error| format!("falha ao ler o arquivo do artefato ({path}): {error}"))
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
enum ArtifactPayload {
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
fn payload_for(kind: &ArtifactKind, mime_type: &str, size: i64) -> ArtifactPayload {
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
fn payload_strings(payload: ArtifactPayload, bytes: &[u8]) -> (Option<String>, Option<String>) {
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
}
