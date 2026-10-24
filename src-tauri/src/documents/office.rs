//! Office documents: DOCX/PPTX (ZIP + XML) and XLSX/ODS (calamine).

use std::collections::HashMap;
use std::io::{Cursor, Read};

use calamine::{open_workbook_auto_from_rs, Reader as CalamineReader};
use quick_xml::events::{BytesRef, BytesStart, Event};
use quick_xml::reader::Reader;
use serde_json::json;
use zip::ZipArchive;

use super::ExtractedDocument;

const MAX_SHEET_ROWS: usize = 2_000;
const MAX_SHEET_COLUMNS: usize = 100;
const MAX_SLIDES: usize = 300;

/* ------------------------------------------------------------------ */
/* ZIP helpers                                                         */
/* ------------------------------------------------------------------ */

fn is_zip(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") || bytes.starts_with(b"PK\x07\x08")
}

fn open_zip(bytes: &[u8]) -> Result<ZipArchive<Cursor<&[u8]>>, String> {
    ZipArchive::new(Cursor::new(bytes)).map_err(|error| format!("arquivo ZIP inválido: {error}"))
}

fn zip_entry(zip: &mut ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<Vec<u8>, String> {
    let mut file = zip
        .by_name(name)
        .map_err(|error| format!("entrada `{name}` não encontrada: {error}"))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)
        .map_err(|error| format!("falha ao ler `{name}`: {error}"))?;
    Ok(buf)
}

fn zip_entry_string(zip: &mut ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<String, String> {
    let bytes = zip_entry(zip, name)?;
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    Ok(String::from_utf8_lossy(bytes).into_owned())
}

/* ------------------------------------------------------------------ */
/* XML helpers                                                         */
/* ------------------------------------------------------------------ */

fn push_raw_text(buf: &mut String, raw: &str) {
    if raw.contains('&') {
        if let Ok(unescaped) = quick_xml::escape::unescape(raw) {
            buf.push_str(&unescaped);
            return;
        }
    }
    buf.push_str(raw);
}

fn push_reference(buf: &mut String, reference: BytesRef<'_>) {
    if reference.is_char_ref() {
        if let Ok(Some(ch)) = reference.resolve_char_ref() {
            buf.push(ch);
            return;
        }
    }
    let name = reference.into_inner();
    if let Some(value) = quick_xml::escape::resolve_predefined_entity(&name) {
        buf.push_str(value);
    }
}

fn local_name(start: &BytesStart<'_>) -> String {
    start.local_name().into_inner().to_string()
}

fn attribute(start: &BytesStart<'_>, name: &str) -> Option<String> {
    start
        .attributes()
        .with_checks(false)
        .filter_map(|attribute| attribute.ok())
        .find(|attribute| attribute.key.local_name().into_inner() == name)
        .and_then(|attribute| {
            attribute
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .ok()
                .map(|value| value.into_owned())
        })
}

/* ------------------------------------------------------------------ */
/* DOCX                                                                */
/* ------------------------------------------------------------------ */

#[derive(Default)]
struct DocxState {
    output: String,
    paragraph: String,
    in_paragraph: bool,
    in_text: bool,
    heading: usize,
    list_item: bool,
    in_cell: bool,
    cell: String,
    row: Vec<String>,
    table_rows: Vec<Vec<String>>,
    paragraphs: usize,
    tables: usize,
}

impl DocxState {
    fn paragraph_buffer(&mut self) -> &mut String {
        if self.in_cell {
            &mut self.cell
        } else {
            &mut self.paragraph
        }
    }
}

pub fn extract_docx(bytes: &[u8]) -> ExtractedDocument {
    if !is_zip(bytes) {
        return ExtractedDocument::failed(
            "docx",
            "arquivo .doc antigo ou binário não suportado; salve como .docx",
        );
    }
    let mut zip = match open_zip(bytes) {
        Ok(zip) => zip,
        Err(error) => return ExtractedDocument::failed("docx", error),
    };
    let xml = match zip_entry_string(&mut zip, "word/document.xml") {
        Ok(xml) => xml,
        Err(error) => return ExtractedDocument::failed("docx", error),
    };

    let (text, paragraphs, tables) = docx_text(&xml);
    if text.trim().is_empty() {
        return ExtractedDocument::failed("docx", "o documento não contém texto extraível");
    }
    ExtractedDocument {
        kind: "docx".to_string(),
        text,
        metadata: json!({
            "format": "docx",
            "paragraphs": paragraphs,
            "tables": tables,
            "bytes": bytes.len(),
        }),
        ..Default::default()
    }
}

fn docx_text(xml: &str) -> (String, usize, usize) {
    let mut reader = Reader::from_str(xml);
    let mut state = DocxState::default();

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) => match local_name(&start).as_str() {
                "p" => {
                    state.in_paragraph = true;
                    state.paragraph.clear();
                    state.heading = 0;
                    state.list_item = false;
                }
                "t" => state.in_text = true,
                "numPr" => state.list_item = true,
                "tbl" => state.table_rows.clear(),
                "tr" => state.row.clear(),
                "tc" => {
                    state.in_cell = true;
                    state.cell.clear();
                }
                "tab" => state.paragraph_buffer().push('\t'),
                "br" | "cr" => state.paragraph_buffer().push('\n'),
                _ => {}
            },
            Ok(Event::Empty(empty)) => match local_name(&empty).as_str() {
                "pStyle" => {
                    if let Some(value) = attribute(&empty, "val") {
                        state.heading = heading_level(&value);
                    }
                }
                "tab" => {
                    let buffer = state.paragraph_buffer();
                    buffer.push('\t');
                }
                "br" | "cr" => {
                    let buffer = state.paragraph_buffer();
                    buffer.push('\n');
                }
                _ => {}
            },
            Ok(Event::Text(text)) => {
                if state.in_text {
                    let buffer = state.paragraph_buffer();
                    push_raw_text(buffer, &text.into_inner());
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                if state.in_text {
                    let buffer = state.paragraph_buffer();
                    push_reference(buffer, reference);
                }
            }
            Ok(Event::CData(data)) => {
                if state.in_text {
                    let buffer = state.paragraph_buffer();
                    buffer.push_str(&data.into_inner());
                }
            }
            Ok(Event::End(end)) => match end.local_name().into_inner() {
                "t" => state.in_text = false,
                "p" => {
                    state.in_paragraph = false;
                    finalize_paragraph(&mut state);
                }
                "tc" => {
                    state.in_cell = false;
                    let cell = state.cell.trim().to_string();
                    state.row.push(cell);
                    state.cell.clear();
                }
                "tr" => {
                    let row = std::mem::take(&mut state.row);
                    if !row.is_empty() {
                        state.table_rows.push(row);
                    }
                }
                "tbl" => {
                    state.tables += 1;
                    render_table_rows(&mut state);
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    (state.output, state.paragraphs, state.tables)
}

fn finalize_paragraph(state: &mut DocxState) {
    let text = state.paragraph.trim().to_string();
    state.paragraph.clear();
    if text.is_empty() {
        if state.in_cell && !state.cell.ends_with('\n') {
            state.cell.push('\n');
        }
        return;
    }
    let mut line = String::new();
    if state.heading > 0 {
        line.push_str(&"#".repeat(state.heading.min(6)));
        line.push(' ');
    } else if state.list_item {
        line.push_str("- ");
    }
    line.push_str(&text);

    if state.in_cell {
        state.cell.push_str(&line);
        state.cell.push('\n');
    } else {
        state.paragraphs += 1;
        state.output.push_str(&line);
        state.output.push('\n');
    }
}

fn render_table_rows(state: &mut DocxState) {
    let rows = std::mem::take(&mut state.table_rows);
    if rows.is_empty() {
        return;
    }
    let mut rendered = String::new();
    for row in rows {
        let end = row.iter().rposition(|cell| !cell.is_empty());
        let end = match end {
            Some(end) => end + 1,
            None => continue,
        };
        rendered.push_str(&row[..end].join(" | "));
        rendered.push('\n');
    }
    if rendered.is_empty() {
        return;
    }
    rendered.push('\n');
    if state.in_cell {
        state.cell.push_str(&rendered);
    } else {
        state.output.push_str(&rendered);
    }
}

fn heading_level(style: &str) -> usize {
    let lower = style.to_lowercase().replace(' ', "");
    if lower.contains("heading")
        || lower.contains("titulo")
        || lower.contains("título")
        || lower.contains("ttulo")
        || lower.contains("title")
    {
        let digits: String = lower.chars().filter(|ch| ch.is_ascii_digit()).collect();
        return digits.parse::<usize>().unwrap_or(1).clamp(1, 6);
    }
    0
}

/* ------------------------------------------------------------------ */
/* PPTX                                                                */
/* ------------------------------------------------------------------ */

pub fn extract_pptx(bytes: &[u8]) -> ExtractedDocument {
    if !is_zip(bytes) {
        return ExtractedDocument::failed(
            "pptx",
            "arquivo .ppt antigo ou binário não suportado; salve como .pptx",
        );
    }
    let mut zip = match open_zip(bytes) {
        Ok(zip) => zip,
        Err(error) => return ExtractedDocument::failed("pptx", error),
    };

    let names: Vec<String> = zip
        .file_names()
        .filter_map(|name| name.ok().map(|name| name.into_owned()))
        .collect();

    let mut slides: Vec<u32> = names
        .iter()
        .filter_map(|name| numbered_entry(name, "ppt/slides/slide", ".xml"))
        .collect();
    slides.sort_unstable();
    slides.dedup();
    slides.truncate(MAX_SLIDES);

    let mut notes: HashMap<u32, String> = HashMap::new();
    for name in &names {
        if let Some(index) = numbered_entry(name, "ppt/notesSlides/notesSlide", ".xml") {
            if let Ok(xml) = zip_entry_string(&mut zip, name) {
                let (text, _) = collect_paragraphs(&xml);
                if !text.trim().is_empty() {
                    notes.insert(index, text);
                }
            }
        }
    }

    let mut output = String::new();
    let mut slide_count = 0u32;
    for index in slides {
        let name = format!("ppt/slides/slide{index}.xml");
        let xml = match zip_entry_string(&mut zip, &name) {
            Ok(xml) => xml,
            Err(_) => continue,
        };
        let (text, _) = collect_paragraphs(&xml);
        if text.trim().is_empty() && notes.get(&index).is_none() {
            continue;
        }
        slide_count += 1;
        output.push_str(&format!("## Slide {index}\n"));
        output.push_str(text.trim());
        output.push('\n');
        if let Some(note) = notes.get(&index) {
            output.push_str("\n**Notas do apresentador**\n");
            output.push_str(note.trim());
            output.push('\n');
        }
        output.push('\n');
    }

    if output.trim().is_empty() {
        return ExtractedDocument::failed("pptx", "a apresentação não contém texto extraível");
    }
    ExtractedDocument {
        kind: "pptx".to_string(),
        text: output,
        page_count: Some(slide_count),
        metadata: json!({
            "format": "pptx",
            "slides": slide_count,
            "notes": notes.len(),
            "bytes": bytes.len(),
        }),
        ..Default::default()
    }
}

fn numbered_entry(name: &str, prefix: &str, suffix: &str) -> Option<u32> {
    let rest = name.strip_prefix(prefix)?.strip_suffix(suffix)?;
    rest.parse::<u32>().ok()
}

/// Collect the text of every `<a:p>` paragraph (works for slides and notes).
fn collect_paragraphs(xml: &str) -> (String, usize) {
    let mut reader = Reader::from_str(xml);
    let mut output = String::new();
    let mut paragraph = String::new();
    let mut in_paragraph = false;
    let mut count = 0usize;

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) => match local_name(&start).as_str() {
                "p" => {
                    in_paragraph = true;
                    paragraph.clear();
                }
                "tab" => paragraph.push('\t'),
                "br" => paragraph.push('\n'),
                _ => {}
            },
            Ok(Event::Empty(empty)) => match local_name(&empty).as_str() {
                "tab" => paragraph.push('\t'),
                "br" => paragraph.push('\n'),
                _ => {}
            },
            Ok(Event::Text(text)) => push_raw_text(&mut paragraph, &text.into_inner()),
            Ok(Event::GeneralRef(reference)) => push_reference(&mut paragraph, reference),
            Ok(Event::CData(data)) => paragraph.push_str(&data.into_inner()),
            Ok(Event::End(end)) => {
                if end.local_name().into_inner() == "p" && in_paragraph {
                    in_paragraph = false;
                    let line = paragraph.trim().to_string();
                    paragraph.clear();
                    if !line.is_empty() {
                        count += 1;
                        output.push_str("- ");
                        output.push_str(&line);
                        output.push('\n');
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    (output, count)
}

/* ------------------------------------------------------------------ */
/* XLSX / ODS / XLS                                                    */
/* ------------------------------------------------------------------ */

pub fn extract_spreadsheet(bytes: &[u8], filename: &str, mime: &str) -> ExtractedDocument {
    let cursor = Cursor::new(bytes);
    let mut workbook = match open_workbook_auto_from_rs(cursor) {
        Ok(workbook) => workbook,
        Err(error) => {
            return ExtractedDocument::failed(
                "xlsx",
                format!("não foi possível abrir a planilha: {error}"),
            )
        }
    };

    let sheet_names = workbook.sheet_names();
    let mut output = String::new();
    let mut sheet_count = 0u32;
    let mut total_rows = 0usize;
    let mut max_columns = 0usize;
    let mut failed_sheets = 0u32;

    for name in &sheet_names {
        let range = match workbook.worksheet_range(name) {
            Ok(range) => range,
            Err(_) => {
                failed_sheets += 1;
                continue;
            }
        };
        let (height, width) = (range.height(), range.width());
        if height == 0 {
            continue;
        }
        sheet_count += 1;
        output.push_str(&format!("## Planilha: {name}\n"));
        let mut rendered_rows = 0usize;
        for row in range.rows().take(MAX_SHEET_ROWS) {
            let cells: Vec<String> = row.iter().take(MAX_SHEET_COLUMNS).map(cell_text).collect();
            let end = match cells.iter().rposition(|cell| !cell.trim().is_empty()) {
                Some(end) => end + 1,
                None => continue,
            };
            max_columns = max_columns.max(end);
            output.push_str(&cells[..end].join("\t"));
            output.push('\n');
            rendered_rows += 1;
        }
        if height > MAX_SHEET_ROWS {
            output.push_str("… (linhas adicionais omitidas)\n");
        }
        output.push('\n');
        total_rows += rendered_rows;
        let _ = width;
    }

    if output.trim().is_empty() {
        return ExtractedDocument::failed(
            "xlsx",
            format!(
                "a planilha não contém dados legíveis ({} planilhas encontradas)",
                sheet_names.len()
            ),
        );
    }

    let format = if filename.to_lowercase().ends_with(".ods") || mime.contains("opendocument") {
        "ods"
    } else {
        "xlsx"
    };
    ExtractedDocument {
        kind: "xlsx".to_string(),
        text: output,
        page_count: Some(sheet_count),
        metadata: json!({
            "format": format,
            "sheets": sheet_count,
            "failedSheets": failed_sheets,
            "rows": total_rows,
            "columns": max_columns,
            "bytes": bytes.len(),
        }),
        ..Default::default()
    }
}

fn cell_text(cell: &calamine::Data) -> String {
    match cell {
        calamine::Data::Empty => String::new(),
        calamine::Data::Bool(value) => value.to_string(),
        calamine::Data::Float(value) => format_float(*value),
        calamine::Data::Int(value) => value.to_string(),
        other => other.to_string(),
    }
}

fn format_float(value: f64) -> String {
    if !value.is_finite() {
        return value.to_string();
    }
    if value.fract() == 0.0 && value.abs() < 1e15 {
        return format!("{}", value as i64);
    }
    value.to_string()
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    fn zip_bytes(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut cursor);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            for (name, content) in entries {
                writer.start_file(*name, options).expect("start_file");
                writer.write_all(content.as_bytes()).expect("write");
            }
            writer.finish().expect("finish");
        }
        cursor.into_inner()
    }

    #[test]
    fn extracts_docx_paragraphs_headings_and_tables() {
        let document = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Relatório</w:t></w:r></w:p>
    <w:p><w:r><w:t>Primeiro parágrafo.</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Item</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Nome</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Valor</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Receita</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>R$ 10</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>"#;
        let bytes = zip_bytes(&[("word/document.xml", document)]);
        let doc = extract_docx(&bytes);
        assert_eq!(doc.kind, "docx");
        assert!(doc.text.contains("# Relatório"), "text: {}", doc.text);
        assert!(doc.text.contains("Primeiro parágrafo."));
        assert!(doc.text.contains("- Item"));
        assert!(doc.text.contains("Receita | R$ 10"), "text: {}", doc.text);
        assert_eq!(doc.metadata["tables"], 1);
    }

    #[test]
    fn extracts_pptx_slides_and_notes() {
        let slide = r#"<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>Resultados do trimestre</a:t></a:r></a:p>
    <a:p><a:r><a:t>Crescimento de 12%</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>"#;
        let notes = r#"<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>Mencionar margem bruta</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>"#;
        let bytes = zip_bytes(&[
            ("ppt/slides/slide1.xml", slide),
            ("ppt/notesSlides/notesSlide1.xml", notes),
        ]);
        let doc = extract_pptx(&bytes);
        assert_eq!(doc.kind, "pptx");
        assert!(doc.text.contains("## Slide 1"));
        assert!(doc.text.contains("Crescimento de 12%"));
        assert!(doc.text.contains("Mencionar margem bruta"));
        assert_eq!(doc.page_count, Some(1));
    }

    #[test]
    fn legacy_doc_is_reported() {
        let doc = extract_docx(b"not a zip");
        assert_eq!(doc.kind, "docx");
        assert!(doc.metadata["error"].is_string());
    }
}
