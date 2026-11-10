//! Prévia estruturada de artefatos binários.
//!
//! Diferente de [`super::extract`] (que gera texto para o modelo), este módulo
//! produz uma representação que o painel de artefatos consegue desenhar:
//!
//! - DOCX → HTML restrito a uma allowlist de tags;
//! - XLSX → grade de células por planilha;
//! - PPTX → cartões de slide com textos e notas do apresentador;
//! - imagens → metadados (pass-through) ou PNG convertido (TIFF);
//! - ZIP → listagem das primeiras entradas;
//! - outros binários → MIME detectado + primeiros bytes em base64 (hexdump).
//!
//! Os parsers nunca panicam em arquivo do usuário: entrada corrompida vira
//! `Err` com uma mensagem em pt-BR. Nenhum deles confia no tamanho declarado no
//! arquivo (ZIP/XML são lidos com limites fixos).

use std::collections::HashMap;
use std::io::{Cursor, Read};

use anyhow::{anyhow, bail, Context, Result};
use base64::prelude::{Engine as _, BASE64_STANDARD};
use calamine::{
    open_workbook_auto_from_rs, Data as CellData, ExcelDateTime, Reader as CalamineReader,
};
use quick_xml::events::{BytesRef, BytesStart, Event};
use quick_xml::reader::Reader;
use zip::ZipArchive;

use super::image::{header_dimensions, sniff_format, ImageFormat};
use crate::domain::{ArchiveEntryPreview, ArtifactPreview, SheetPreview, SlidePreview};
use image::ImageEncoder as _;

/// Teto de tamanho do HTML gerado para o preview de DOCX (512 KB).
pub const MAX_DOCX_HTML_BYTES: usize = 512 * 1024;
/// Planilhas exibidas por preview de XLSX.
const MAX_XLSX_SHEETS: usize = 50;
/// Linhas exibidas por planilha.
const MAX_XLSX_ROWS: usize = 200;
/// Colunas exibidas por planilha.
const MAX_XLSX_COLUMNS: usize = 40;
/// Slides exibidos por preview de PPTX.
const MAX_PPTX_SLIDES: usize = 100;
/// Entradas listadas por preview de ZIP.
pub const MAX_ARCHIVE_ENTRIES: usize = 400;
/// Caracteres mantidos no nome de cada entrada do ZIP.
pub const MAX_ARCHIVE_ENTRY_NAME_CHARS: usize = 240;
/// Bytes de hexdump (base64) exibidos na prévia de binários.
pub const MAX_BINARY_PREVIEW_BYTES: usize = 4096;
/// Lado maior máximo da prévia PNG gerada a partir de um TIFF.
pub const MAX_TIFF_PREVIEW_SIDE: u32 = 2560;
/// Profundidade máxima de aninhamento aceita ao percorrer o XML.
const MAX_XML_DEPTH: usize = 64;
/// Quantidade de itens de lista acumulados antes de fechar um `<ul>`/`<ol>`.
const MAX_PENDING_LIST_ITEMS: usize = 256;

/* ------------------------------------------------------------------ */
/* ZIP helpers                                                        */
/* ------------------------------------------------------------------ */

fn is_zip(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08")
}

fn open_zip(bytes: &[u8]) -> Result<ZipArchive<Cursor<&[u8]>>> {
    if bytes.is_empty() {
        bail!("arquivo vazio");
    }
    if !is_zip(bytes) {
        bail!("assinatura ZIP ausente: o arquivo não é um pacote OOXML válido");
    }
    ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| anyhow!("pacote ZIP inválido: {error}"))
}

fn zip_string(zip: &mut ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<String> {
    let mut entry = zip
        .by_name(name)
        .map_err(|error| anyhow!("entrada `{name}` não encontrada no pacote: {error}"))?;
    let mut buffer = Vec::new();
    entry
        .read_to_end(&mut buffer)
        .map_err(|error| anyhow!("falha ao ler `{name}`: {error}"))?;
    let buffer = buffer.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&buffer);
    Ok(String::from_utf8_lossy(buffer).into_owned())
}

/* ------------------------------------------------------------------ */
/* XML helpers                                                        */
/* ------------------------------------------------------------------ */

type XmlReader<'a> = Reader<&'a [u8]>;

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

/// Interpreta atributos booleanos de OOXML (`w:b`, `w:i`, `w:u`, ...).
fn ooxml_flag(value: Option<&str>, default: bool) -> bool {
    match value.map(|value| value.trim().to_ascii_lowercase()) {
        None => default,
        Some(value) => !matches!(value.as_str(), "0" | "false" | "off" | "none"),
    }
}

fn push_raw_text(buffer: &mut String, raw: &str) {
    if raw.contains('&') {
        if let Ok(unescaped) = quick_xml::escape::unescape(raw) {
            buffer.push_str(&unescaped);
            return;
        }
    }
    buffer.push_str(raw);
}

fn push_reference(buffer: &mut String, reference: BytesRef<'_>) {
    if reference.is_char_ref() {
        if let Ok(Some(ch)) = reference.resolve_char_ref() {
            buffer.push(ch);
            return;
        }
    }
    let name = reference.into_inner();
    if let Some(value) = quick_xml::escape::resolve_predefined_entity(&name) {
        buffer.push_str(value);
    }
}

/// Consome o elemento atual até o seu `End` correspondente.
fn skip_element(reader: &mut XmlReader<'_>) -> Result<()> {
    let mut depth = 1usize;
    loop {
        match reader.read_event() {
            Ok(Event::Start(_)) => depth += 1,
            Ok(Event::End(_)) => {
                depth -= 1;
                if depth == 0 {
                    return Ok(());
                }
            }
            Ok(Event::Eof) => bail!("XML terminou inesperadamente no meio de um elemento"),
            Err(error) => return Err(anyhow!("XML inválido: {error}")),
            _ => {}
        }
    }
}

fn escape_html(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            _ => output.push(ch),
        }
    }
    output
}

/* ------------------------------------------------------------------ */
/* DOCX → HTML                                                         */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Default)]
struct RunProps {
    bold: bool,
    italic: bool,
    underline: bool,
}

#[derive(Debug, Clone)]
enum Inline {
    Text {
        text: String,
        props: RunProps,
    },
    Break,
}

#[derive(Debug, Default)]
struct ParsedParagraph {
    runs: Vec<Inline>,
    style: String,
    outline_level: Option<usize>,
    num_id: Option<u32>,
}

impl ParsedParagraph {
    fn push_text(&mut self, text: &str, props: &RunProps) {
        if text.is_empty() {
            return;
        }
        if let Some(Inline::Text {
            text: last,
            props: last_props,
        }) = self.runs.last_mut()
        {
            if last_props.bold == props.bold
                && last_props.italic == props.italic
                && last_props.underline == props.underline
            {
                last.push_str(text);
                return;
            }
        }
        self.runs.push(Inline::Text {
            text: text.to_string(),
            props: props.clone(),
        });
    }

    fn push_break(&mut self) {
        if matches!(self.runs.last(), Some(Inline::Text { .. })) {
            self.runs.push(Inline::Break);
        }
    }

    fn is_empty(&self) -> bool {
        self.runs.is_empty()
            || self
                .runs
                .iter()
                .all(|run| matches!(run, Inline::Text { text, .. } if text.trim().is_empty()))
    }

    fn runs_html(&self) -> String {
        let mut output = String::new();
        for run in &self.runs {
            match run {
                Inline::Break => output.push_str("<br/>"),
                Inline::Text { text, props } => {
                    if text.is_empty() {
                        continue;
                    }
                    let escaped = escape_html(text);
                    if props.bold {
                        output.push_str("<strong>");
                    }
                    if props.italic {
                        output.push_str("<em>");
                    }
                    if props.underline {
                        output.push_str("<u>");
                    }
                    output.push_str(&escaped);
                    if props.underline {
                        output.push_str("</u>");
                    }
                    if props.italic {
                        output.push_str("</em>");
                    }
                    if props.bold {
                        output.push_str("</strong>");
                    }
                }
            }
        }
        while output.ends_with("<br/>") {
            output.truncate(output.len() - "<br/>".len());
        }
        output
    }
}

#[derive(Debug)]
struct PendingList {
    ordered: bool,
    items: Vec<String>,
}

/// Converte `word/document.xml` em HTML com allowlist de tags.
///
/// Tags emitidas: `h1..h6`, `p`, `strong`, `em`, `u`, `ul`, `ol`, `li`,
/// `table`, `thead`, `tbody`, `tr`, `th`, `td`, `br` e `blockquote`.
pub fn docx_html(bytes: &[u8]) -> Result<String> {
    if bytes.is_empty() {
        bail!("arquivo vazio");
    }
    let mut zip = open_zip(bytes).context("DOCX inválido")?;
    let xml = zip_string(&mut zip, "word/document.xml")
        .context("DOCX sem `word/document.xml` (documento corrompido ou formato antigo)")?;
    let numbering = zip_string(&mut zip, "word/numbering.xml")
        .ok()
        .map(|xml| parse_numbering(&xml))
        .unwrap_or_default();

    let mut parser = DocxParser::new(&xml, numbering);
    parser.run()?;
    Ok(parser.finish())
}

struct DocxParser<'a> {
    reader: XmlReader<'a>,
    numbering: HashMap<u32, bool>,
    html: String,
    truncated: bool,
    pending_list: Option<PendingList>,
}

impl<'a> DocxParser<'a> {
    fn new(xml: &'a str, numbering: HashMap<u32, bool>) -> Self {
        Self {
            reader: Reader::from_str(xml),
            numbering,
            html: String::new(),
            truncated: false,
            pending_list: None,
        }
    }

    fn run(&mut self) -> Result<()> {
        let mut open_depth = 0usize;
        loop {
            match self
                .reader
                .read_event()
                .context("XML inválido em word/document.xml")?
            {
                Event::Start(start) => match local_name(&start).as_str() {
                    // Elementos transparentes no topo do documento.
                    "document" | "body" => open_depth += 1,
                    "p" => {
                        let paragraph = self.parse_paragraph(0)?;
                        self.emit_paragraph(paragraph);
                    }
                    "tbl" => {
                        self.flush_list();
                        let table = self.parse_table(0)?;
                        self.push_html(&table);
                    }
                    _ => skip_element(&mut self.reader)?,
                },
                Event::Empty(_) => {}
                Event::End(end) => match end.local_name().into_inner() {
                    "document" | "body" => open_depth = open_depth.saturating_sub(1),
                    _ => {}
                },
                Event::Eof => break,
                _ => {}
            }
        }
        if open_depth > 0 {
            bail!("XML truncado: o documento Word terminou antes de fechar w:body");
        }
        self.flush_list();
        Ok(())
    }

    fn finish(mut self) -> String {
        self.flush_list();
        if self.truncated {
            let marker = "<p>Prévia truncada: o documento é grande demais.</p>";
            if self.html.len() + marker.len() <= MAX_DOCX_HTML_BYTES {
                self.html.push_str(marker);
            }
        }
        self.html
    }

    fn push_html(&mut self, element: &str) {
        if element.is_empty() {
            return;
        }
        if self.html.len() + element.len() <= MAX_DOCX_HTML_BYTES {
            self.html.push_str(element);
        } else {
            self.truncated = true;
        }
    }

    fn flush_list(&mut self) {
        let Some(pending) = self.pending_list.take() else {
            return;
        };
        if pending.items.is_empty() {
            return;
        }
        let tag = if pending.ordered { "ol" } else { "ul" };
        let mut element = format!("<{tag}>");
        for item in pending.items {
            element.push_str("<li>");
            element.push_str(&item);
            element.push_str("</li>");
        }
        element.push_str("</");
        element.push_str(tag);
        element.push('>');
        self.push_html(&element);
    }

    fn emit_paragraph(&mut self, paragraph: ParsedParagraph) {
        if paragraph.is_empty() {
            return;
        }
        let style = paragraph.style.to_ascii_lowercase();
        let item_html = paragraph.runs_html();

        let list_kind = if paragraph.num_id.is_some() {
            let num_id = paragraph.num_id.unwrap_or(0);
            Some(self.numbering.get(&num_id).copied().unwrap_or(false))
        } else if style.starts_with("listbullet") {
            Some(false)
        } else if style.starts_with("listnumber") {
            Some(true)
        } else {
            None
        };

        if let Some(ordered) = list_kind {
            let needs_flush = self
                .pending_list
                .as_ref()
                .is_some_and(|list| list.ordered != ordered);
            if needs_flush {
                self.flush_list();
            }
            let list = self
                .pending_list
                .get_or_insert_with(|| PendingList {
                    ordered,
                    items: Vec::new(),
                });
            list.items.push(item_html);
            if list.items.len() >= MAX_PENDING_LIST_ITEMS {
                self.flush_list();
            }
            return;
        }

        self.flush_list();

        if let Some(level) = heading_level(&style, paragraph.outline_level) {
            self.push_html(&format!("<h{level}>{item_html}</h{level}>"));
        } else if style.contains("quote") {
            self.push_html(&format!("<blockquote><p>{item_html}</p></blockquote>"));
        } else {
            self.push_html(&format!("<p>{item_html}</p>"));
        }
    }

    fn parse_paragraph(&mut self, depth: usize) -> Result<ParsedParagraph> {
        if depth > MAX_XML_DEPTH {
            bail!("estrutura XML aninhada demais em word/document.xml");
        }
        let mut paragraph = ParsedParagraph::default();
        loop {
            match self
                .reader
                .read_event()
                .context("XML inválido em word/document.xml")?
            {
                Event::Start(start) => match local_name(&start).as_str() {
                    "pPr" => self.parse_paragraph_props(&mut paragraph)?,
                    "r" => self.parse_run(&mut paragraph, depth)?,
                    // Texto removido/não exibido não entra na prévia.
                    "del" | "moveFrom" | "Fallback" => skip_element(&mut self.reader)?,
                    "AlternateContent" => {
                        self.parse_alternate_content(&mut paragraph, depth)?
                    }
                    _ => self.parse_inline_container(&mut paragraph, depth)?,
                },
                Event::Empty(empty) => match local_name(&empty).as_str() {
                    "br" | "cr" => paragraph.push_break(),
                    "tab" => paragraph.push_text("\t", &RunProps::default()),
                    "noBreakHyphen" => paragraph.push_text("-", &RunProps::default()),
                    _ => {}
                },
                Event::End(end) => {
                    if end.local_name().into_inner() == "p" {
                        return Ok(paragraph);
                    }
                }
                Event::Eof => bail!("XML terminou no meio de um parágrafo"),
                _ => {}
            }
        }
    }

    fn parse_inline_container(
        &mut self,
        paragraph: &mut ParsedParagraph,
        depth: usize,
    ) -> Result<()> {
        if depth > MAX_XML_DEPTH {
            bail!("estrutura XML aninhada demais em word/document.xml");
        }
        loop {
            match self
                .reader
                .read_event()
                .context("XML inválido em word/document.xml")?
            {
                Event::Start(start) => match local_name(&start).as_str() {
                    "r" => self.parse_run(paragraph, depth)?,
                    "del" | "moveFrom" | "Fallback" => skip_element(&mut self.reader)?,
                    "AlternateContent" => self.parse_alternate_content(paragraph, depth)?,
                    "pPr" => self.parse_paragraph_props(paragraph)?,
                    _ => self.parse_inline_container(paragraph, depth + 1)?,
                },
                Event::Empty(empty) => match local_name(&empty).as_str() {
                    "br" | "cr" => paragraph.push_break(),
                    "tab" => paragraph.push_text("\t", &RunProps::default()),
                    _ => {}
                },
                Event::End(_) => return Ok(()),
                Event::Eof => bail!("XML terminou no meio de um elemento inline"),
                _ => {}
            }
        }
    }

    fn parse_alternate_content(
        &mut self,
        paragraph: &mut ParsedParagraph,
        depth: usize,
    ) -> Result<()> {
        loop {
            match self
                .reader
                .read_event()
                .context("XML inválido em word/document.xml")?
            {
                Event::Start(start) => match local_name(&start).as_str() {
                    "Choice" => self.parse_inline_container(paragraph, depth + 1)?,
                    "Fallback" => skip_element(&mut self.reader)?,
                    _ => skip_element(&mut self.reader)?,
                },
                Event::End(_) => return Ok(()),
                Event::Eof => bail!("XML terminou no meio de mc:AlternateContent"),
                _ => {}
            }
        }
    }

    fn parse_run(&mut self, paragraph: &mut ParsedParagraph, depth: usize) -> Result<()> {
        let mut props = RunProps::default();
        loop {
            match self
                .reader
                .read_event()
                .context("XML inválido em word/document.xml")?
            {
                Event::Start(start) => match local_name(&start).as_str() {
                    "rPr" => self.parse_run_props(&mut props)?,
                    "t" => {
                        let text = self.read_text_content()?;
                        paragraph.push_text(&text, &props);
                    }
                    "br" | "cr" => paragraph.push_break(),
                    "tab" => paragraph.push_text("\t", &props),
                    "noBreakHyphen" => paragraph.push_text("-", &props),
                    "softHyphen" => {}
                    "del" | "moveFrom" | "Fallback" => skip_element(&mut self.reader)?,
                    "AlternateContent" => {
                        self.parse_alternate_content(paragraph, depth)?
                    }
                    _ => skip_element(&mut self.reader)?,
                },
                Event::Empty(empty) => match local_name(&empty).as_str() {
                    "br" | "cr" => paragraph.push_break(),
                    "tab" => paragraph.push_text("\t", &props),
                    "noBreakHyphen" => paragraph.push_text("-", &props),
                    "softHyphen" => {}
                    _ => {}
                },
                Event::End(end) => {
                    if end.local_name().into_inner() == "r" {
                        return Ok(());
                    }
                }
                Event::Eof => bail!("XML terminou no meio de um run"),
                _ => {}
            }
        }
    }

    fn read_text_content(&mut self) -> Result<String> {
        let mut text = String::new();
        loop {
            match self
                .reader
                .read_event()
                .context("XML inválido em word/document.xml")?
            {
                Event::Text(raw) => push_raw_text(&mut text, &raw.into_inner()),
                Event::GeneralRef(reference) => push_reference(&mut text, reference),
                Event::CData(data) => text.push_str(&data.into_inner()),
                Event::Start(_) | Event::Empty(_) => {
                    // Runs com marcação inesperada dentro de `w:t` não são
                    // renderizados, mas não devem derrubar a prévia.
                }
                Event::End(end) => {
                    if end.local_name().into_inner() == "t" {
                        return Ok(text);
                    }
                }
                Event::Eof => bail!("XML terminou no meio de um texto"),
                _ => {}
            }
        }
    }

    fn parse_paragraph_props(&mut self, paragraph: &mut ParsedParagraph) -> Result<()> {
        loop {
            match self
                .reader
                .read_event()
                .context("XML inválido em word/document.xml")?
            {
                Event::Start(start) => match local_name(&start).as_str() {
                    "pStyle" => {
                        if let Some(value) = attribute(&start, "val") {
                            paragraph.style = value;
                        }
                        skip_element(&mut self.reader)?;
                    }
                    "outlineLvl" => {
                        if let Some(level) = attribute(&start, "val")
                            .and_then(|value| value.parse::<usize>().ok())
                        {
                            paragraph.outline_level = Some(level + 1);
                        }
                        skip_element(&mut self.reader)?;
                    }
                    "numPr" => self.parse_numbering_props(paragraph)?,
                    _ => skip_element(&mut self.reader)?,
                },
                Event::Empty(empty) => match local_name(&empty).as_str() {
                    "pStyle" => {
                        if let Some(value) = attribute(&empty, "val") {
                            paragraph.style = value;
                        }
                    }
                    "outlineLvl" => {
                        if let Some(level) = attribute(&empty, "val")
                            .and_then(|value| value.parse::<usize>().ok())
                        {
                            paragraph.outline_level = Some(level + 1);
                        }
                    }
                    _ => {}
                },
                Event::End(end) => {
                    if end.local_name().into_inner() == "pPr" {
                        return Ok(());
                    }
                }
                Event::Eof => bail!("XML terminou no meio de w:pPr"),
                _ => {}
            }
        }
    }

    fn parse_numbering_props(&mut self, paragraph: &mut ParsedParagraph) -> Result<()> {
        loop {
            match self
                .reader
                .read_event()
                .context("XML inválido em word/document.xml")?
            {
                Event::Start(start) => match local_name(&start).as_str() {
                    "numId" => {
                        paragraph.num_id = attribute(&start, "val")
                            .and_then(|value| value.parse::<u32>().ok());
                        skip_element(&mut self.reader)?;
                    }
                    _ => skip_element(&mut self.reader)?,
                },
                Event::Empty(empty) => {
                    if local_name(&empty) == "numId" {
                        paragraph.num_id = attribute(&empty, "val")
                            .and_then(|value| value.parse::<u32>().ok());
                    }
                }
                Event::End(end) => {
                    if end.local_name().into_inner() == "numPr" {
                        return Ok(());
                    }
                }
                Event::Eof => bail!("XML terminou no meio de w:numPr"),
                _ => {}
            }
        }
    }

    fn parse_run_props(&mut self, props: &mut RunProps) -> Result<()> {
        loop {
            match self
                .reader
                .read_event()
                .context("XML inválido em word/document.xml")?
            {
                Event::Start(start) => {
                    let name = local_name(&start);
                    self.apply_run_prop(&name, attribute(&start, "val").as_deref(), props);
                    skip_element(&mut self.reader)?;
                }
                Event::Empty(empty) => {
                    let name = local_name(&empty);
                    self.apply_run_prop(&name, attribute(&empty, "val").as_deref(), props);
                }
                Event::End(end) => {
                    if end.local_name().into_inner() == "rPr" {
                        return Ok(());
                    }
                }
                Event::Eof => bail!("XML terminou no meio de w:rPr"),
                _ => {}
            }
        }
    }

    fn apply_run_prop(&self, name: &str, value: Option<&str>, props: &mut RunProps) {
        match name {
            "b" | "bCs" => props.bold = ooxml_flag(value, true),
            "i" | "iCs" => props.italic = ooxml_flag(value, true),
            "u" => {
                props.underline = match value {
                    None => true,
                    Some(value) => !value.eq_ignore_ascii_case("none"),
                }
            }
            "rStyle" => match value.unwrap_or("").to_ascii_lowercase().as_str() {
                "strong" | "intensestrong" => props.bold = true,
                "emphasis" | "intenseemphasis" => props.italic = true,
                _ => {}
            },
            _ => {}
        }
    }

    /// Percorre `w:tbl` (o `Start` já foi consumido) e devolve o HTML.
    fn parse_table(&mut self, depth: usize) -> Result<String> {
        let mut rows: Vec<Vec<String>> = Vec::new();
        self.parse_table_rows(&mut rows, depth)?;
        Ok(render_table_html(&rows))
    }

    fn parse_table_rows(&mut self, rows: &mut Vec<Vec<String>>, depth: usize) -> Result<()> {
        if depth > MAX_XML_DEPTH {
            bail!("estrutura XML aninhada demais em uma tabela");
        }
        loop {
            match self
                .reader
                .read_event()
                .context("XML inválido em word/document.xml")?
            {
                Event::Start(start) => match local_name(&start).as_str() {
                    "tr" => {
                        let row = self.parse_table_row(depth + 1)?;
                        if !row.is_empty() {
                            rows.push(row);
                        }
                    }
                    "tblPr" | "tblGrid" => skip_element(&mut self.reader)?,
                    "sdt" | "sdtContent" | "customXml" | "ins" => {
                        self.parse_table_rows(rows, depth + 1)?
                    }
                    _ => skip_element(&mut self.reader)?,
                },
                Event::End(_) => return Ok(()),
                Event::Eof => bail!("XML terminou no meio de uma tabela"),
                _ => {}
            }
        }
    }

    fn parse_table_row(&mut self, depth: usize) -> Result<Vec<String>> {
        let mut cells: Vec<String> = Vec::new();
        loop {
            match self
                .reader
                .read_event()
                .context("XML inválido em word/document.xml")?
            {
                Event::Start(start) => match local_name(&start).as_str() {
                    "tc" => {
                        let cell = self.parse_table_cell(depth + 1)?;
                        cells.push(cell);
                    }
                    "trPr" | "tblPrEx" => skip_element(&mut self.reader)?,
                    _ => skip_element(&mut self.reader)?,
                },
                Event::End(end) => {
                    if end.local_name().into_inner() == "tr" {
                        return Ok(cells);
                    }
                }
                Event::Eof => bail!("XML terminou no meio de uma linha de tabela"),
                _ => {}
            }
        }
    }

    fn parse_table_cell(&mut self, depth: usize) -> Result<String> {
        let mut paragraphs: Vec<String> = Vec::new();
        loop {
            match self
                .reader
                .read_event()
                .context("XML inválido em word/document.xml")?
            {
                Event::Start(start) => match local_name(&start).as_str() {
                    "p" => {
                        let paragraph = self.parse_paragraph(depth + 1)?;
                        paragraphs.push(paragraph.runs_html());
                    }
                    "tcPr" | "tbl" => skip_element(&mut self.reader)?,
                    _ => skip_element(&mut self.reader)?,
                },
                Event::End(end) => {
                    if end.local_name().into_inner() == "tc" {
                        return Ok(paragraphs.join("<br/>"));
                    }
                }
                Event::Eof => bail!("XML terminou no meio de uma célula de tabela"),
                _ => {}
            }
        }
    }
}

fn heading_level(style: &str, outline_level: Option<usize>) -> Option<usize> {
    if let Some(level) = outline_level {
        return Some(level.clamp(1, 6));
    }
    if style.contains("heading") || style.contains("titulo") || style.contains("título") {
        let digits: String = style.chars().filter(|ch| ch.is_ascii_digit()).collect();
        return Some(digits.parse::<usize>().unwrap_or(1).clamp(1, 6));
    }
    if style == "title" {
        return Some(1);
    }
    None
}

fn render_table_html(rows: &[Vec<String>]) -> String {
    if rows.is_empty() {
        return String::new();
    }
    let mut html = String::from("<table><thead><tr>");
    for cell in &rows[0] {
        html.push_str("<th>");
        html.push_str(cell);
        html.push_str("</th>");
    }
    html.push_str("</tr></thead>");
    if rows.len() > 1 {
        html.push_str("<tbody>");
        for row in &rows[1..] {
            html.push_str("<tr>");
            for cell in row {
                html.push_str("<td>");
                html.push_str(cell);
                html.push_str("</td>");
            }
            html.push_str("</tr>");
        }
        html.push_str("</tbody>");
    }
    html.push_str("</table>");
    html
}

/// Mapeia `w:numId` → lista ordenada (true) ou com marcadores (false).
fn parse_numbering(xml: &str) -> HashMap<u32, bool> {
    let mut reader = Reader::from_str(xml);
    let mut abstract_formats: HashMap<u32, bool> = HashMap::new();
    let mut num_abstract: HashMap<u32, u32> = HashMap::new();
    let mut current_abstract: Option<u32> = None;
    let mut current_format: Option<bool> = None;
    let mut current_num: Option<u32> = None;

    loop {
        let event = match reader.read_event() {
            Ok(event) => event,
            Err(_) => break,
        };
        match event {
            Event::Start(start) => match local_name(&start).as_str() {
                "abstractNum" => {
                    current_abstract = attribute(&start, "abstractNumId")
                        .and_then(|value| value.parse::<u32>().ok());
                    current_format = None;
                }
                "numFmt" => {
                    if current_format.is_none() {
                        if let Some(format) = attribute(&start, "val") {
                            current_format = Some(!matches!(
                                format.to_ascii_lowercase().as_str(),
                                "bullet" | "none"
                            ));
                        }
                    }
                    if skip_element(&mut reader).is_err() {
                        break;
                    }
                }
                "abstractNumId" => {
                    if let (Some(num), Some(abstract_id)) = (
                        current_num,
                        attribute(&start, "val").and_then(|value| value.parse::<u32>().ok()),
                    ) {
                        num_abstract.insert(num, abstract_id);
                    }
                    if skip_element(&mut reader).is_err() {
                        break;
                    }
                }
                "num" => {
                    current_num =
                        attribute(&start, "numId").and_then(|value| value.parse::<u32>().ok());
                }
                _ => {}
            },
            Event::Empty(empty) => match local_name(&empty).as_str() {
                "numFmt" => {
                    if current_format.is_none() {
                        if let Some(format) = attribute(&empty, "val") {
                            current_format = Some(!matches!(
                                format.to_ascii_lowercase().as_str(),
                                "bullet" | "none"
                            ));
                        }
                    }
                }
                "abstractNumId" => {
                    if let (Some(num), Some(abstract_id)) = (
                        current_num,
                        attribute(&empty, "val").and_then(|value| value.parse::<u32>().ok()),
                    ) {
                        num_abstract.insert(num, abstract_id);
                    }
                }
                _ => {}
            },
            Event::End(end) => match end.local_name().into_inner() {
                "abstractNum" => {
                    if let (Some(id), Some(format)) = (current_abstract.take(), current_format.take())
                    {
                        abstract_formats.insert(id, format);
                    }
                }
                "num" => current_num = None,
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }

    let mut formats = HashMap::new();
    for (num_id, abstract_id) in num_abstract {
        if let Some(format) = abstract_formats.get(&abstract_id) {
            formats.insert(num_id, *format);
        }
    }
    formats
}

/* ------------------------------------------------------------------ */
/* XLSX → grade de células                                             */
/* ------------------------------------------------------------------ */

/// Converte a primeira planilha (ou todas) de um XLSX em grades de células.
pub fn xlsx_sheets(bytes: &[u8]) -> Result<Vec<SheetPreview>> {
    if bytes.is_empty() {
        bail!("arquivo vazio");
    }
    let mut workbook = open_workbook_auto_from_rs(Cursor::new(bytes))
        .map_err(|error| anyhow!("não foi possível abrir a planilha: {error}"))?;

    let names = workbook.sheet_names();
    let mut sheets = Vec::new();
    for (index, name) in names.iter().take(MAX_XLSX_SHEETS).enumerate() {
        let range = workbook
            .worksheet_range(name)
            .map_err(|error| anyhow!("falha ao ler a planilha `{name}`: {error}"))?;
        let mut truncated = range.height() > MAX_XLSX_ROWS || range.width() > MAX_XLSX_COLUMNS;
        if index + 1 == MAX_XLSX_SHEETS && names.len() > MAX_XLSX_SHEETS {
            truncated = true;
        }

        let mut rows: Vec<Vec<String>> = Vec::new();
        for row in range.rows().take(MAX_XLSX_ROWS) {
            let mut cells: Vec<String> = row
                .iter()
                .take(MAX_XLSX_COLUMNS)
                .map(preview_cell)
                .collect();
            while cells.last().is_some_and(|cell| cell.is_empty()) {
                cells.pop();
            }
            rows.push(cells);
        }
        while rows.last().is_some_and(|row| row.is_empty()) {
            rows.pop();
        }
        sheets.push(SheetPreview {
            name: name.clone(),
            rows,
            truncated,
        });
    }
    Ok(sheets)
}

fn preview_cell(cell: &CellData) -> String {
    match cell {
        CellData::Empty => String::new(),
        CellData::String(value) => value.clone(),
        CellData::Float(value) => format_preview_float(*value),
        CellData::Int(value) => value.to_string(),
        CellData::Bool(value) => {
            if *value {
                "VERDADEIRO".to_string()
            } else {
                "FALSO".to_string()
            }
        }
        CellData::DateTime(datetime) => format_excel_datetime(datetime),
        CellData::DateTimeIso(value) | CellData::DurationIso(value) => value.clone(),
        other => other.to_string(),
    }
}

fn format_preview_float(value: f64) -> String {
    if !value.is_finite() {
        return value.to_string();
    }
    if value.fract() == 0.0 && value.abs() < 1e15 {
        return format!("{}", value as i64);
    }
    let mut text = format!("{value}");
    if text.contains('.') {
        while text.ends_with('0') {
            text.pop();
        }
        if text.ends_with('.') {
            text.pop();
        }
    }
    text
}

fn format_excel_datetime(datetime: &ExcelDateTime) -> String {
    let value = datetime.as_f64();
    if datetime.is_duration() {
        let total_seconds = (value * 86_400.0).round() as i64;
        let hours = total_seconds / 3600;
        let minutes = (total_seconds % 3600).abs() / 60;
        let seconds = (total_seconds % 60).abs();
        return format!("{hours:02}:{minutes:02}:{seconds:02}");
    }
    let (year, month, day, hour, minute, second, milli) = datetime.to_ymd_hms_milli();
    if (0.0..1.0).contains(&value) {
        return format!("{hour:02}:{minute:02}:{second:02}");
    }
    let date = format!("{year:04}-{month:02}-{day:02}");
    if hour == 0 && minute == 0 && second == 0 && milli == 0 {
        date
    } else {
        format!("{date} {hour:02}:{minute:02}")
    }
}

/* ------------------------------------------------------------------ */
/* PPTX → slides                                                       */
/* ------------------------------------------------------------------ */

/// Extrai os slides de um PPTX em ordem numérica.
///
/// Cada `a:p` vira uma string em [`SlidePreview::texts`]; as notas vêm de
/// `ppt/notesSlides/notesSlideN.xml` quando existirem.
pub fn pptx_slides(bytes: &[u8]) -> Result<Vec<SlidePreview>> {
    if bytes.is_empty() {
        bail!("arquivo vazio");
    }
    let mut zip = open_zip(bytes).context("PPTX inválido")?;
    let names: Vec<String> = zip
        .file_names()
        .filter_map(|name| name.ok().map(|name| name.into_owned()))
        .collect();

    let mut slide_numbers: Vec<u32> = names
        .iter()
        .filter_map(|name| numbered_entry(name, "ppt/slides/slide", ".xml"))
        .collect();
    slide_numbers.sort_unstable();
    slide_numbers.dedup();
    slide_numbers.truncate(MAX_PPTX_SLIDES);
    if slide_numbers.is_empty() {
        bail!("apresentação sem slides (nenhum ppt/slides/slideN.xml encontrado)");
    }

    let mut notes: HashMap<u32, String> = HashMap::new();
    for name in &names {
        let Some(number) = numbered_entry(name, "ppt/notesSlides/notesSlide", ".xml") else {
            continue;
        };
        let Ok(xml) = zip_string(&mut zip, name) else {
            continue;
        };
        if let Ok(paragraphs) = pptx_paragraphs(&xml) {
            let text = paragraphs.join("\n");
            if !text.trim().is_empty() {
                notes.insert(number, text.trim().to_string());
            }
        }
    }

    // Em PowerPoint cada slide aponta para o seu slide de notas pelo
    // relacionamento; o número do arquivo de notas pode não coincidir com o
    // número do slide (ex.: slides sem notas no meio). Resolve pelo rels e usa
    // o número como fallback (convenção dos helpers embutidos).
    if !notes.is_empty() {
        for number in &slide_numbers {
            let rels_name = format!("ppt/slides/_rels/slide{number}.xml.rels");
            let Ok(rels_xml) = zip_string(&mut zip, &rels_name) else {
                continue;
            };
            let Some(notes_number) = notes_slide_number_from_rels(&rels_xml) else {
                continue;
            };
            if let Some(text) = notes.get(&notes_number) {
                notes.insert(*number, text.clone());
            }
        }
    }

    let mut slides = Vec::new();
    for (position, number) in slide_numbers.into_iter().enumerate() {
        let name = format!("ppt/slides/slide{number}.xml");
        let xml = zip_string(&mut zip, &name)?;
        let texts = pptx_paragraphs(&xml).with_context(|| format!("falha ao ler `{name}`"))?;
        slides.push(SlidePreview {
            index: position as u32 + 1,
            texts,
            notes: notes.get(&number).cloned(),
        });
    }
    Ok(slides)
}

/// Extrai o número do `notesSlide` referenciado pelo rels de um slide.
fn notes_slide_number_from_rels(xml: &str) -> Option<u32> {
    let mut reader = Reader::from_str(xml);
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) | Ok(Event::Empty(element)) => {
                if local_name(&element) != "Relationship" {
                    continue;
                }
                let target = attribute(&element, "Target")?;
                let rest = target.split("notesSlides/notesSlide").nth(1)?;
                let digits: String = rest.chars().take_while(|ch| ch.is_ascii_digit()).collect();
                return digits.parse::<u32>().ok();
            }
            Ok(Event::Eof) => return None,
            Err(_) => return None,
            _ => {}
        }
    }
}

fn numbered_entry(name: &str, prefix: &str, suffix: &str) -> Option<u32> {
    let rest = name.strip_prefix(prefix)?.strip_suffix(suffix)?;
    rest.parse::<u32>().ok()
}

/// Coleta os parágrafos `<a:p>` de um slide/notas de apresentação.
fn pptx_paragraphs(xml: &str) -> Result<Vec<String>> {
    let mut reader = Reader::from_str(xml);
    let mut paragraphs = Vec::new();
    let mut current = String::new();
    let mut in_paragraph = false;
    let mut in_text = false;
    let mut open_depth = 0usize;

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) => {
                open_depth += 1;
                match local_name(&start).as_str() {
                    "p" => {
                        in_paragraph = true;
                        current.clear();
                    }
                    "t" => in_text = true,
                    "br" => {
                        if in_paragraph {
                            current.push('\n');
                        }
                    }
                    "tab" => {
                        if in_paragraph {
                            current.push('\t');
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(empty)) => match local_name(&empty).as_str() {
                "br" => {
                    if in_paragraph {
                        current.push('\n');
                    }
                }
                "tab" => {
                    if in_paragraph {
                        current.push('\t');
                    }
                }
                _ => {}
            },
            Ok(Event::Text(text)) => {
                if in_text {
                    push_raw_text(&mut current, &text.into_inner());
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                if in_text {
                    push_reference(&mut current, reference);
                }
            }
            Ok(Event::CData(data)) => {
                if in_text {
                    current.push_str(&data.into_inner());
                }
            }
            Ok(Event::End(end)) => {
                open_depth = open_depth.saturating_sub(1);
                match end.local_name().into_inner() {
                    "t" => in_text = false,
                    "p" => {
                        in_paragraph = false;
                        let text = current.trim().to_string();
                        current.clear();
                        if !text.is_empty() {
                            paragraphs.push(text);
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => bail!("XML inválido no slide: {error}"),
            _ => {}
        }
    }
    if open_depth > 0 {
        bail!("XML truncado: o slide terminou antes de fechar todos os elementos");
    }
    Ok(paragraphs)
}

/* ------------------------------------------------------------------ */
/* Imagens                                                             */
/* ------------------------------------------------------------------ */

/// Prévia de imagem.
///
/// Formatos que o WebView desenha (PNG/JPEG/GIF/WebP/AVIF/BMP/ICO) viram
/// [`ArtifactPreview::Image`] só com metadados (`data_base64: None`): o
/// renderer busca os bytes originais em `get_artifact_content`. TIFF é
/// decodificado, redimensionado quando necessário e convertido para PNG (única
/// forma de exibi-lo no WebView). HEIC/HEIF e formatos desconhecidos viram
/// `Unsupported` com orientação de Salvar/Abrir; TIFF corrompido é `Err`.
pub fn image_preview(bytes: &[u8]) -> Result<ArtifactPreview> {
    let format = sniff_format(bytes);
    if format.opens_in_webview() {
        let (width, height) = header_dimensions(bytes, format);
        return Ok(ArtifactPreview::Image {
            mime: format.mime().to_string(),
            width,
            height,
            data_base64: None,
        });
    }
    match format {
        ImageFormat::Tiff => tiff_png_preview(bytes),
        ImageFormat::Heic => Ok(ArtifactPreview::Unsupported {
            reason: "imagens HEIC/HEIF não abrem no visualizador interno. Use \"Salvar como…\" \
                     para baixar o arquivo e \"Abrir\" para vê-lo no aplicativo do sistema."
                .to_string(),
        }),
        _ if bytes.is_empty() => Ok(ArtifactPreview::Unsupported {
            reason: "arquivo de imagem vazio. Use \"Salvar como…\" para baixar o arquivo e \
                     \"Abrir\" para vê-lo no aplicativo do sistema."
                .to_string(),
        }),
        _ => Ok(ArtifactPreview::Unsupported {
            reason: "formato de imagem não reconhecido. Use \"Salvar como…\" para baixar o \
                     arquivo e \"Abrir\" para vê-lo no aplicativo do sistema."
                .to_string(),
        }),
    }
}

/// Decodifica um TIFF real e o converte em PNG; reduz se o lado maior passar
/// de [`MAX_TIFF_PREVIEW_SIDE`]. Devolve as dimensões **originais** para a UI
/// exibir os metadados do arquivo.
fn tiff_png_preview(bytes: &[u8]) -> Result<ArtifactPreview> {
    let decoded = image::load_from_memory_with_format(bytes, image::ImageFormat::Tiff).context(
        "não foi possível decodificar a imagem TIFF (arquivo corrompido ou variante não suportada)",
    )?;
    let width = decoded.width();
    let height = decoded.height();
    if width == 0 || height == 0 {
        bail!("imagem TIFF sem dimensões válidas");
    }

    let mut rgba = decoded.into_rgba8();
    let long_side = width.max(height);
    if long_side > MAX_TIFF_PREVIEW_SIDE {
        let scale = f64::from(MAX_TIFF_PREVIEW_SIDE) / f64::from(long_side);
        let target_width = ((f64::from(width) * scale).round() as u32).max(1);
        let target_height = ((f64::from(height) * scale).round() as u32).max(1);
        rgba = image::imageops::resize(
            &rgba,
            target_width,
            target_height,
            image::imageops::FilterType::Lanczos3,
        );
    }

    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            image::ExtendedColorType::Rgba8,
        )
        .context("falha ao codificar a prévia PNG do TIFF")?;

    Ok(ArtifactPreview::Image {
        mime: "image/png".to_string(),
        width: Some(width),
        height: Some(height),
        data_base64: Some(BASE64_STANDARD.encode(png)),
    })
}

/* ------------------------------------------------------------------ */
/* Arquivos compactados (ZIP)                                          */
/* ------------------------------------------------------------------ */

/// Prévia de arquivo compactado: lista as primeiras
/// [`MAX_ARCHIVE_ENTRIES`] entradas de um ZIP (inclusive `.jar`, `.epub` e
/// `.cbz`).
///
/// Outros contêineres (TAR/7z/RAR) não são lidos aqui: devolvem `Unsupported`
/// com orientação para Salvar/Abrir. ZIP corrompido é `Err`.
pub fn archive_preview(bytes: &[u8]) -> Result<ArtifactPreview> {
    if !is_zip(bytes) {
        return Ok(ArtifactPreview::Unsupported {
            reason: if bytes.is_empty() {
                "arquivo vazio: não há conteúdo ZIP para listar. Use \"Salvar como…\" para \
                 baixar o arquivo e \"Abrir\" para vê-lo no aplicativo do sistema."
                    .to_string()
            } else {
                "somente arquivos ZIP (.zip, .jar, .epub e .cbz) têm lista de conteúdo. Para \
                 TAR, 7z ou RAR, use \"Salvar como…\" para baixar o arquivo e \"Abrir\" para \
                 vê-lo no aplicativo do sistema."
                    .to_string()
            },
        });
    }

    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).context("arquivo ZIP corrompido ou incompleto")?;
    let total = archive.len();
    let truncated = total > MAX_ARCHIVE_ENTRIES;
    let mut entries = Vec::with_capacity(total.min(MAX_ARCHIVE_ENTRIES));
    for index in 0..total.min(MAX_ARCHIVE_ENTRIES) {
        let entry = archive
            .by_index(index)
            .map_err(|error| anyhow!("entrada {index} ilegível no ZIP: {error}"))?;
        // Nome pode vir em UTF-8 (flag do ZIP) ou CP437; se a decodificação
        // falhar, usa a representação lossy para não perder a listagem.
        let name = entry
            .name()
            .map(|name| name.into_owned())
            .unwrap_or_else(|_| String::from_utf8_lossy(entry.name_raw()).into_owned());
        entries.push(ArchiveEntryPreview {
            is_dir: name.ends_with('/'),
            name: truncate_entry_name(&name),
            size: entry.size(),
            compressed_size: entry.compressed_size(),
        });
    }

    Ok(ArtifactPreview::Archive {
        format: "zip".to_string(),
        entries,
        total_entries: total.min(u32::MAX as usize) as u32,
        truncated,
    })
}

/// Mantém o nome da entrada legível na lista: corta em
/// [`MAX_ARCHIVE_ENTRY_NAME_CHARS`] caracteres e sinaliza o corte com `…`.
fn truncate_entry_name(name: &str) -> String {
    if name.chars().count() <= MAX_ARCHIVE_ENTRY_NAME_CHARS {
        return name.to_string();
    }
    let mut truncated: String = name
        .chars()
        .take(MAX_ARCHIVE_ENTRY_NAME_CHARS - 1)
        .collect();
    truncated.push('…');
    truncated
}

/* ------------------------------------------------------------------ */
/* Binário genérico (hexdump)                                          */
/* ------------------------------------------------------------------ */

/// Prévia de binário sem parser dedicado: MIME detectado por magic bytes e os
/// primeiros [`MAX_BINARY_PREVIEW_BYTES`] bytes em base64.
///
/// Nunca falha: arquivo vazio ou desconhecido vira `application/octet-stream`
/// com payload vazio (a UI mostra o cartão de binário com Salvar/Abrir).
pub fn binary_preview(bytes: &[u8]) -> ArtifactPreview {
    let format = infer::get(bytes)
        .map(|kind| kind.mime_type().to_string())
        .filter(|mime| !mime.is_empty())
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let preview = &bytes[..bytes.len().min(MAX_BINARY_PREVIEW_BYTES)];
    ArtifactPreview::Binary {
        format,
        preview_base64: BASE64_STANDARD.encode(preview),
        preview_bytes: preview.len() as u32,
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use super::*;

    const DOCX: &[u8] = include_bytes!("testdata/relatorio-trimestral.docx");
    const XLSX: &[u8] = include_bytes!("testdata/vendas-q3.xlsx");
    const PPTX: &[u8] = include_bytes!("testdata/apresentacao-q3.pptx");

    const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    fn zip_parts(parts: &[(String, String)]) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut cursor);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            for (name, content) in parts {
                writer.start_file(name.as_str(), options).expect("start_file");
                writer.write_all(content.as_bytes()).expect("write");
            }
            writer.finish().expect("finish");
        }
        cursor.into_inner()
    }

    fn document_xml(body: &str) -> String {
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
             <w:document xmlns:w=\"{W_NS}\"><w:body>{body}</w:body></w:document>"
        )
    }

    fn docx_package(body: &str) -> Vec<u8> {
        zip_parts(&[("word/document.xml".to_string(), document_xml(body))])
    }

    fn html_tags(html: &str) -> Vec<String> {
        let bytes = html.as_bytes();
        let mut tags = Vec::new();
        let mut index = 0usize;
        while index < bytes.len() {
            if bytes[index] == b'<' {
                let start = index + 1;
                let mut end = start;
                while end < bytes.len() && bytes[end] != b'>' {
                    end += 1;
                }
                let raw: String = html[start..end.min(html.len())]
                    .trim_start_matches('/')
                    .chars()
                    .take_while(|ch| ch.is_ascii_alphanumeric())
                    .collect();
                if !raw.is_empty() {
                    tags.push(raw);
                }
                index = end;
            }
            index += 1;
        }
        tags
    }

    const ALLOWED_TAGS: &[&str] = &[
        "h1", "h2", "h3", "h4", "h5", "h6", "p", "strong", "em", "u", "ul", "ol", "li",
        "table", "thead", "tbody", "tr", "th", "td", "br", "blockquote",
    ];

    /* ------------------------- DOCX ------------------------- */

    #[test]
    fn docx_fixture_renders_heading_list_table_and_text() {
        let html = docx_html(DOCX).expect("docx preview");
        assert!(
            html.contains("<h1>Relatório Trimestral"),
            "heading ausente: {html}"
        );
        assert!(html.contains("<h2>Destaques</h2>"), "heading 2 ausente");
        assert!(html.contains("<ul>"), "lista de bullets ausente");
        assert!(html.contains("<li>Receita total: R$ 4,82 milhões (+18% QoQ)</li>"));
        assert!(html.contains("<table>"), "tabela ausente");
        assert!(html.contains("<thead><tr><th>Produto</th><th>Receita (R$)</th>"));
        assert!(html.contains("<td>Plataforma</td><td>2.910.000</td>"));
        assert!(html.contains("Recomendamos manter o investimento em integrações"));
    }

    #[test]
    fn docx_fixture_only_emits_allowed_tags() {
        let html = docx_html(DOCX).expect("docx preview");
        for tag in html_tags(&html) {
            assert!(
                ALLOWED_TAGS.contains(&tag.as_str()),
                "tag não permitida no preview: <{tag}>"
            );
        }
        assert!(!html.contains("<script"));
        assert!(!html.contains("style="));
    }

    #[test]
    fn docx_inline_formatting_and_line_breaks() {
        let body = concat!(
            "<w:p>",
            "<w:r><w:rPr><w:b/></w:rPr><w:t>Negrito</w:t></w:r>",
            "<w:r><w:rPr><w:i/><w:u w:val=\"single\"/></w:rPr><w:t>itálico</w:t></w:r>",
            "<w:r><w:t>linha</w:t><w:br/><w:t>seguinte</w:t></w:r>",
            "</w:p>"
        );
        let html = docx_html(&docx_package(body)).expect("docx preview");
        assert!(html.contains("<strong>Negrito</strong>"), "html: {html}");
        assert!(html.contains("<em><u>itálico</u></em>"), "html: {html}");
        assert!(html.contains("linha<br/>seguinte"), "html: {html}");
    }

    #[test]
    fn docx_numbering_creates_ordered_list() {
        let document = document_xml(concat!(
            "<w:p><w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr></w:pPr>",
            "<w:r><w:t>Primeiro</w:t></w:r></w:p>",
            "<w:p><w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr></w:pPr>",
            "<w:r><w:t>Segundo</w:t></w:r></w:p>"
        ));
        let numbering = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
             <w:numbering xmlns:w=\"{W_NS}\">\
             <w:abstractNum w:abstractNumId=\"0\">\
             <w:lvl w:ilvl=\"0\"><w:numFmt w:val=\"decimal\"/></w:lvl>\
             </w:abstractNum>\
             <w:num w:numId=\"1\"><w:abstractNumId w:val=\"0\"/></w:num>\
             </w:numbering>"
        );
        let bytes = zip_parts(&[
            ("word/document.xml".to_string(), document),
            ("word/numbering.xml".to_string(), numbering),
        ]);
        let html = docx_html(&bytes).expect("docx preview");
        assert!(
            html.contains("<ol><li>Primeiro</li><li>Segundo</li></ol>"),
            "html: {html}"
        );
    }

    #[test]
    fn docx_bullet_style_and_quote_style() {
        let body = concat!(
            "<w:p><w:pPr><w:pStyle w:val=\"ListBullet\"/></w:pPr><w:r><w:t>Item A</w:t></w:r></w:p>",
            "<w:p><w:pPr><w:pStyle w:val=\"ListBullet\"/></w:pPr><w:r><w:t>Item B</w:t></w:r></w:p>",
            "<w:p><w:pPr><w:pStyle w:val=\"Quote\"/></w:pPr><w:r><w:t>Citação</w:t></w:r></w:p>"
        );
        let html = docx_html(&docx_package(body)).expect("docx preview");
        assert!(html.contains("<ul><li>Item A</li><li>Item B</li></ul>"));
        assert!(html.contains("<blockquote><p>Citação</p></blockquote>"));
    }

    #[test]
    fn docx_escapes_markup_from_the_document() {
        let body = "<w:p><w:r><w:t>5 &lt; 6 &amp; 7 &gt; 3 e &lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:p>";
        let html = docx_html(&docx_package(body)).expect("docx preview");
        assert!(html.contains("5 &lt; 6 &amp; 7 &gt; 3"), "html: {html}");
        assert!(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert!(!html.contains("<script>"));
    }

    #[test]
    fn docx_without_text_is_empty_but_valid() {
        let body = "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/></w:sectPr>";
        let html = docx_html(&docx_package(body)).expect("docx preview");
        assert!(html.is_empty(), "html: {html}");
    }

    #[test]
    fn docx_truncates_html_at_the_limit() {
        let mut body = String::new();
        let filler = "x".repeat(200);
        for _ in 0..3000 {
            body.push_str(&format!("<w:p><w:r><w:t>{filler}</w:t></w:r></w:p>"));
        }
        let html = docx_html(&docx_package(&body)).expect("docx preview");
        assert!(
            html.len() <= MAX_DOCX_HTML_BYTES,
            "html maior que o limite: {} bytes",
            html.len()
        );
        assert!(
            html.len() + 2_000 > MAX_DOCX_HTML_BYTES,
            "html truncado cedo demais: {} bytes",
            html.len()
        );
    }

    #[test]
    fn docx_corrupt_inputs_are_errors() {
        assert!(docx_html(b"").is_err(), "arquivo vazio deve falhar");
        assert!(docx_html(b"nao e um zip").is_err(), "não-ZIP deve falhar");
        let without_document =
            zip_parts(&[("word/styles.xml".to_string(), "<w:styles/>".to_string())]);
        assert!(docx_html(&without_document).is_err(), "sem document.xml");

        let truncated = zip_parts(&[(
            "word/document.xml".to_string(),
            "<w:document><w:body><w:p><w:r><w:t>sem fim".to_string(),
        )]);
        assert!(docx_html(&truncated).is_err(), "XML truncado deve falhar");
    }

    /* ------------------------- XLSX ------------------------- */

    fn column_letter(mut index: usize) -> String {
        let mut letters = String::new();
        while index > 0 {
            let remainder = (index - 1) % 26;
            letters.insert(0, (b'A' + remainder as u8) as char);
            index = (index - 1) / 26;
        }
        letters
    }

    fn simple_sheet_xml(rows: &[Vec<String>]) -> String {
        let mut xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
             <worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>"
        );
        for (row_index, row) in rows.iter().enumerate() {
            let number = row_index + 1;
            xml.push_str(&format!("<row r=\"{number}\">"));
            for (column_index, value) in row.iter().enumerate() {
                let reference = format!("{}{number}", column_letter(column_index + 1));
                xml.push_str(&format!(
                    "<c r=\"{reference}\" t=\"inlineStr\"><is><t>{}</t></is></c>",
                    value.replace('&', "&amp;").replace('<', "&lt;")
                ));
            }
            xml.push_str("</row>");
        }
        xml.push_str("</sheetData></worksheet>");
        xml
    }

    /// Pacote XLSX mínimo (sem estilo) para testar limites/tipos de célula.
    fn minimal_xlsx(sheets: &[(&str, String)], styles: Option<&str>) -> Vec<u8> {
        let mut parts: Vec<(String, String)> = Vec::new();
        let mut overrides = String::new();
        for index in 0..sheets.len() {
            overrides.push_str(&format!(
                "<Override PartName=\"/xl/worksheets/sheet{}.xml\" \
                 ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>",
                index + 1
            ));
        }
        if styles.is_some() {
            overrides.push_str(
                "<Override PartName=\"/xl/styles.xml\" \
                 ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>",
            );
        }
        parts.push((
            "[Content_Types].xml".to_string(),
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
                 <Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
                 <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
                 <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
                 <Override PartName=\"/xl/workbook.xml\" \
                 ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>\
                 {overrides}</Types>"
            ),
        ));
        parts.push((
            "_rels/.rels".to_string(),
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
             <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
             <Relationship Id=\"rId1\" \
             Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" \
             Target=\"xl/workbook.xml\"/></Relationships>"
                .to_string(),
        ));

        let mut sheet_entries = String::new();
        let mut rel_entries = String::new();
        for (index, (name, _)) in sheets.iter().enumerate() {
            let number = index + 1;
            sheet_entries.push_str(&format!(
                "<sheet name=\"{name}\" sheetId=\"{number}\" r:id=\"rId{number}\"/>"
            ));
            rel_entries.push_str(&format!(
                "<Relationship Id=\"rId{number}\" \
                 Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" \
                 Target=\"worksheets/sheet{number}.xml\"/>"
            ));
        }
        if styles.is_some() {
            let number = sheets.len() + 1;
            rel_entries.push_str(&format!(
                "<Relationship Id=\"rId{number}\" \
                 Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" \
                 Target=\"styles.xml\"/>"
            ));
        }
        parts.push((
            "xl/workbook.xml".to_string(),
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
                 <workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" \
                 xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
                 <sheets>{sheet_entries}</sheets></workbook>"
            ),
        ));
        parts.push((
            "xl/_rels/workbook.xml.rels".to_string(),
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
                 <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
                 {rel_entries}</Relationships>"
            ),
        ));
        for (index, (_, sheet_xml)) in sheets.iter().enumerate() {
            parts.push((
                format!("xl/worksheets/sheet{}.xml", index + 1),
                sheet_xml.clone(),
            ));
        }
        if let Some(styles) = styles {
            parts.push(("xl/styles.xml".to_string(), styles.to_string()));
        }
        zip_parts(&parts)
    }

    #[test]
    fn xlsx_fixture_has_two_sheets_and_values() {
        let sheets = xlsx_sheets(XLSX).expect("xlsx preview");
        assert_eq!(sheets.len(), 2, "esperava duas planilhas");
        assert_eq!(sheets[0].name, "Vendas");
        assert_eq!(sheets[1].name, "Metas");
        let rows = &sheets[0].rows;
        assert_eq!(
            rows[0].iter().map(String::as_str).collect::<Vec<_>>(),
            vec!["Mês", "Receita", "Clientes novos", "Churn %"]
        );
        assert_eq!(rows[1][0], "Julho");
        assert_eq!(rows[1][1], "1410000");
        assert!(
            !rows[1][1].contains('.'),
            "número não deve ter sufixo .0: {}",
            rows[1][1]
        );
        assert_eq!(rows[1][3], "1.6");
        assert_eq!(rows[3][0], "Setembro");
        assert_eq!(rows[3][1], "1830000");
        assert!(!sheets[0].truncated);
        assert!(!sheets[1].truncated);
        assert_eq!(
            sheets[1].rows[0].iter().map(String::as_str).collect::<Vec<_>>(),
            vec!["Meta anual", "20000000"]
        );
        assert_eq!(sheets[1].rows[1][0], "Realizado");
        assert_eq!(sheets[1].rows[1][1], "13420000");
        assert_eq!(sheets[1].rows[2][1], "0.671");
    }

    #[test]
    fn xlsx_formats_dates_as_readable_text() {
        let sheet = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
             <worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\
             <sheetData><row r=\"1\">\
             <c r=\"A1\" s=\"1\"><v>45292</v></c>\
             <c r=\"B1\" s=\"1\"><v>45292.5</v></c>\
             </row></sheetData></worksheet>";
        let styles = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
             <styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\
             <numFmts count=\"1\"><numFmt numFmtId=\"164\" formatCode=\"dd/mm/yyyy\"/></numFmts>\
             <fonts count=\"1\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>\
             <fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill>\
             <fill><patternFill patternType=\"gray125\"/></fill></fills>\
             <borders count=\"1\"><border/></borders>\
             <cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>\
             <cellXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>\
             <xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>\
             </cellXfs></styleSheet>";
        let bytes = minimal_xlsx(&[("Datas", sheet.to_string())], Some(styles));
        let sheets = xlsx_sheets(&bytes).expect("xlsx preview");
        assert_eq!(sheets.len(), 1);
        assert_eq!(sheets[0].rows[0][0], "2024-01-01");
        assert!(
            sheets[0].rows[0][1].starts_with("2024-01-01"),
            "data/hora legível esperada: {:?}",
            sheets[0].rows[0][1]
        );
    }

    #[test]
    fn xlsx_truncates_rows_and_columns_at_the_limits() {
        let mut rows: Vec<Vec<String>> = Vec::new();
        for row in 1..=260u32 {
            let cells: Vec<String> = (1..=45u32)
                .map(|column| (row * 100 + column).to_string())
                .collect();
            rows.push(cells);
        }
        let bytes = minimal_xlsx(&[("Grande", simple_sheet_xml(&rows))], None);
        let sheets = xlsx_sheets(&bytes).expect("xlsx preview");
        assert_eq!(sheets.len(), 1);
        let sheet = &sheets[0];
        assert!(sheet.truncated, "truncamento não sinalizado");
        assert_eq!(sheet.rows.len(), MAX_XLSX_ROWS);
        assert!(
            sheet.rows.iter().all(|row| row.len() <= MAX_XLSX_COLUMNS),
            "linha com mais de {MAX_XLSX_COLUMNS} colunas"
        );
        assert_eq!(sheet.rows[0][0], "101");
        assert_eq!(
            sheet.rows[0][MAX_XLSX_COLUMNS - 1],
            (100 + MAX_XLSX_COLUMNS).to_string()
        );
    }

    #[test]
    fn xlsx_corrupt_inputs_are_errors() {
        assert!(xlsx_sheets(b"").is_err());
        assert!(xlsx_sheets(b"isto nao e uma planilha").is_err());
        let empty_zip = zip_parts(&[("qualquer.txt".to_string(), "x".to_string())]);
        assert!(xlsx_sheets(&empty_zip).is_err());
    }

    /* ------------------------- PPTX ------------------------- */

    fn slide_entry(number: u32, text: &str) -> (String, String) {
        (
            format!("ppt/slides/slide{number}.xml"),
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
                 <p:sld xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" \
                 xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">\
                 <p:cSld><p:spTree><p:sp><p:txBody>\
                 <a:p><a:r><a:t>{text}</a:t></a:r></a:p>\
                 </p:txBody></p:sp></p:spTree></p:cSld></p:sld>"
            ),
        )
    }

    #[test]
    fn pptx_fixture_slides_in_numeric_order() {
        let slides = pptx_slides(PPTX).expect("pptx preview");
        assert_eq!(slides.len(), 3, "esperava três slides");
        assert_eq!(
            slides.iter().map(|slide| slide.index).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert!(
            slides[0]
                .texts
                .iter()
                .any(|text| text.contains("Aurora Analytics")),
            "capa sem título: {:?}",
            slides[0].texts
        );
        assert!(
            slides[0]
                .texts
                .iter()
                .any(|text| text.contains("Apresentação executiva")),
            "capa sem subtítulo: {:?}",
            slides[0].texts
        );
        assert!(
            slides[1]
                .texts
                .iter()
                .any(|text| text.contains("Principais números")),
            "slide 2: {:?}",
            slides[1].texts
        );
        assert!(
            slides[2]
                .texts
                .iter()
                .any(|text| text.contains("Próximos passos")),
            "slide 3: {:?}",
            slides[2].texts
        );
        assert!(
            slides.iter().all(|slide| slide.notes.is_none()),
            "a fixture não tem notas"
        );
    }

    #[test]
    fn pptx_notes_are_read_when_present() {
        let notes = (
            "ppt/notesSlides/notesSlide2.xml".to_string(),
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
             <p:notes xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" \
             xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">\
             <p:cSld><p:spTree><p:sp><p:txBody>\
             <a:p><a:r><a:t>Mencionar a margem bruta.</a:t></a:r></a:p>\
             <a:p><a:r><a:t>Não prometer prazos.</a:t></a:r></a:p>\
             </p:txBody></p:sp></p:spTree></p:cSld></p:notes>"
                .to_string(),
        );
        let bytes = zip_parts(&[
            slide_entry(1, "Capa"),
            slide_entry(2, "Números"),
            notes,
        ]);
        let slides = pptx_slides(&bytes).expect("pptx preview");
        assert_eq!(slides.len(), 2);
        assert!(slides[0].notes.is_none());
        let notes = slides[1].notes.as_deref().unwrap_or_default();
        assert!(notes.contains("margem bruta"), "notas: {notes}");
        assert!(notes.contains("Não prometer prazos"), "notas: {notes}");
    }

    #[test]
    fn pptx_truncates_after_one_hundred_slides() {
        let mut parts: Vec<(String, String)> = Vec::new();
        for number in 1..=120 {
            parts.push(slide_entry(number, &format!("Slide {number}")));
        }
        let slides = pptx_slides(&zip_parts(&parts)).expect("pptx preview");
        assert_eq!(slides.len(), MAX_PPTX_SLIDES);
        assert_eq!(slides[MAX_PPTX_SLIDES - 1].index, 100);
        assert!(slides[99].texts.iter().any(|text| text == "Slide 100"));
    }

    #[test]
    fn pptx_corrupt_inputs_are_errors() {
        assert!(pptx_slides(b"").is_err());
        assert!(pptx_slides(b"nao e um zip").is_err());
        let without_slides = zip_parts(&[(
            "ppt/presentation.xml".to_string(),
            "<p:presentation/>".to_string(),
        )]);
        assert!(pptx_slides(&without_slides).is_err());
        let truncated = zip_parts(&[(
            "ppt/slides/slide1.xml".to_string(),
            "<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p>".to_string(),
        )]);
        assert!(pptx_slides(&truncated).is_err());
    }

    /* ------------------- imagens (v1.5) ------------------- */

    const PNG: &[u8] = include_bytes!("testdata/grafico-receita.png");
    const TIFF: &[u8] = include_bytes!("testdata/scan-tiff.tif");
    const ZIPPED: &[u8] = include_bytes!("testdata/pacote-projeto.zip");

    fn image_parts(
        preview: ArtifactPreview,
    ) -> (String, Option<u32>, Option<u32>, Option<String>) {
        match preview {
            ArtifactPreview::Image {
                mime,
                width,
                height,
                data_base64,
            } => (mime, width, height, data_base64),
            other => panic!("esperado ArtifactPreview::Image, veio {other:?}"),
        }
    }

    #[test]
    fn image_png_passes_through_with_header_dimensions() {
        let (mime, width, height, data_base64) =
            image_parts(image_preview(PNG).expect("prévia do PNG"));
        assert_eq!(mime, "image/png");
        assert_eq!(width, Some(960));
        assert_eq!(height, Some(540));
        assert!(
            data_base64.is_none(),
            "PNG abre no WebView: pass-through sem payload"
        );
    }

    #[test]
    fn image_tiff_is_converted_to_png_with_original_dimensions() {
        let (mime, width, height, data_base64) =
            image_parts(image_preview(TIFF).expect("prévia do TIFF"));
        assert_eq!(mime, "image/png", "TIFF só abre convertido para PNG");
        assert_eq!(width, Some(160));
        assert_eq!(height, Some(100));
        let encoded = data_base64.expect("TIFF convertido precisa do payload PNG");
        assert!(
            encoded.starts_with("iVBOR"),
            "payload não é um PNG base64: {}",
            &encoded[..encoded.len().min(16)]
        );
        let png = BASE64_STANDARD
            .decode(encoded.as_bytes())
            .expect("payload base64 válido");
        assert_eq!(
            &png[..8],
            &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
            "assinatura PNG ausente"
        );
        let decoded = image::load_from_memory(&png).expect("PNG gerado deve decodificar");
        assert_eq!((decoded.width(), decoded.height()), (160, 100));
    }

    #[test]
    fn image_tiff_larger_than_the_limit_is_resized() {
        let source = image::RgbImage::from_fn(3200, 80, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, 96])
        });
        let source = image::DynamicImage::ImageRgb8(source);
        let mut tiff = Cursor::new(Vec::new());
        source
            .write_to(&mut tiff, image::ImageFormat::Tiff)
            .expect("codificar TIFF de teste");
        let tiff = tiff.into_inner();

        let (mime, width, height, data_base64) =
            image_parts(image_preview(&tiff).expect("prévia do TIFF grande"));
        assert_eq!(mime, "image/png");
        assert_eq!(width, Some(3200), "dimensões originais no metadado");
        assert_eq!(height, Some(80));
        let png = BASE64_STANDARD
            .decode(data_base64.expect("payload PNG").as_bytes())
            .expect("payload base64 válido");
        let decoded = image::load_from_memory(&png).expect("PNG gerado deve decodificar");
        assert_eq!(decoded.width(), MAX_TIFF_PREVIEW_SIDE);
        assert_eq!(decoded.height(), 64, "proporção 3200x80 → 2560x64");
    }

    #[test]
    fn image_heic_and_unknown_formats_are_unsupported() {
        // Cabeçalho ISO-BMFF (`ftyp` + brand `heic`), como um .heic real começa.
        let mut heic = vec![0, 0, 0, 0x18];
        heic.extend_from_slice(b"ftyp");
        heic.extend_from_slice(b"heic");
        heic.extend_from_slice(&[0, 0, 0, 0]);
        heic.extend_from_slice(b"mif1heic");
        match image_preview(&heic).expect("HEIC não é erro de parse") {
            ArtifactPreview::Unsupported { reason } => {
                assert!(reason.contains("Salvar como"), "sem orientação: {reason}");
                assert!(reason.contains("Abrir"), "sem orientação: {reason}");
            }
            other => panic!("esperado Unsupported para HEIC, veio {other:?}"),
        }

        match image_preview(b"isto nao e uma imagem, so texto").expect("lixo não é erro") {
            ArtifactPreview::Unsupported { reason } => {
                assert!(reason.contains("Salvar como"), "sem orientação: {reason}");
                assert!(reason.contains("Abrir"), "sem orientação: {reason}");
            }
            other => panic!("esperado Unsupported para formato desconhecido, veio {other:?}"),
        }
    }

    #[test]
    fn image_corrupt_tiff_is_an_error() {
        let mut corrupt = b"II*\0".to_vec();
        corrupt.extend_from_slice(&[0u8; 64]);
        let result = image_preview(&corrupt);
        assert!(
            result.is_err(),
            "TIFF corrompido deve ser Err, veio {result:?}"
        );
        let message = match result {
            Err(error) => format!("{error:#}"),
            Ok(preview) => panic!("esperava Err, veio {preview:?}"),
        };
        assert!(
            message.contains("TIFF"),
            "mensagem sem contexto do formato: {message}"
        );
    }

    #[test]
    fn empty_inputs_never_panic() {
        match image_preview(b"").expect("imagem vazia é Unsupported, não Err") {
            ArtifactPreview::Unsupported { reason } => {
                assert!(reason.contains("vazio"), "motivo: {reason}");
            }
            other => panic!("esperado Unsupported para imagem vazia, veio {other:?}"),
        }
        match archive_preview(b"").expect("vazio não é ZIP: Unsupported") {
            ArtifactPreview::Unsupported { reason } => {
                assert!(reason.contains("Salvar como"), "motivo: {reason}");
            }
            other => panic!("esperado Unsupported para ZIP vazio, veio {other:?}"),
        }
        match binary_preview(b"") {
            ArtifactPreview::Binary {
                format,
                preview_base64,
                preview_bytes,
            } => {
                assert_eq!(format, "application/octet-stream");
                assert_eq!(preview_bytes, 0);
                assert!(preview_base64.is_empty());
            }
            other => panic!("esperado Binary para arquivo vazio, veio {other:?}"),
        }
    }

    /* ------------------- ZIP (v1.5) ------------------- */

    #[test]
    fn archive_zip_fixture_lists_entries_in_order() {
        match archive_preview(ZIPPED).expect("prévia do ZIP") {
            ArtifactPreview::Archive {
                format,
                entries,
                total_entries,
                truncated,
            } => {
                assert_eq!(format, "zip");
                assert_eq!(total_entries, 4, "entradas: {entries:?}");
                assert!(!truncated);
                assert_eq!(entries.len(), 4);

                assert_eq!(entries[0].name, "pacote-projeto/");
                assert!(entries[0].is_dir, "pasta deve ser marcada como diretório");

                assert_eq!(entries[1].name, "pacote-projeto/LEIAME.md");
                assert!(!entries[1].is_dir);
                assert_eq!(entries[1].size, 67);
                assert!(entries[1].compressed_size > 0);

                assert_eq!(entries[2].name, "pacote-projeto/app.py");
                assert_eq!(entries[2].size, 77);

                assert_eq!(entries[3].name, "pacote-projeto/dados.csv");
                assert_eq!(entries[3].size, 41);
            }
            other => panic!("esperado ArtifactPreview::Archive, veio {other:?}"),
        }
    }

    #[test]
    fn archive_lists_at_most_400_entries_and_flags_truncation() {
        let mut parts: Vec<(String, String)> = Vec::new();
        for index in 0..420u32 {
            parts.push((
                format!("entradas/arquivo-{index:03}.txt"),
                format!("conteúdo {index}"),
            ));
        }
        let bytes = zip_parts(&parts);
        match archive_preview(&bytes).expect("prévia do ZIP grande") {
            ArtifactPreview::Archive {
                entries,
                total_entries,
                truncated,
                ..
            } => {
                assert_eq!(total_entries, 420, "total de entradas do ZIP");
                assert!(
                    truncated,
                    "mais de {MAX_ARCHIVE_ENTRIES} entradas deve sinalizar truncamento"
                );
                assert_eq!(entries.len(), MAX_ARCHIVE_ENTRIES);
                assert_eq!(entries[0].name, "entradas/arquivo-000.txt");
                assert_eq!(
                    entries[MAX_ARCHIVE_ENTRIES - 1].name,
                    format!("entradas/arquivo-{:03}.txt", MAX_ARCHIVE_ENTRIES - 1)
                );
            }
            other => panic!("esperado ArtifactPreview::Archive, veio {other:?}"),
        }
    }

    #[test]
    fn archive_truncates_long_entry_names() {
        let long_name = format!("docs/{}.txt", "a".repeat(400));
        let bytes = zip_parts(&[(long_name, "x".to_string())]);
        match archive_preview(&bytes).expect("prévia do ZIP") {
            ArtifactPreview::Archive { entries, .. } => {
                assert_eq!(entries.len(), 1);
                let name = &entries[0].name;
                assert!(
                    name.chars().count() <= MAX_ARCHIVE_ENTRY_NAME_CHARS,
                    "nome com {} chars",
                    name.chars().count()
                );
                assert!(name.ends_with('…'), "corte não sinalizado: {name}");
            }
            other => panic!("esperado ArtifactPreview::Archive, veio {other:?}"),
        }
    }

    #[test]
    fn archive_non_zip_containers_are_unsupported() {
        match archive_preview(b"conteudo de um TAR qualquer").expect("não-ZIP não é erro") {
            ArtifactPreview::Unsupported { reason } => {
                for formula in ["TAR", "7z", "RAR"] {
                    assert!(
                        reason.contains(formula),
                        "motivo deveria citar {formula}: {reason}"
                    );
                }
                assert!(reason.contains("Salvar como"), "sem orientação: {reason}");
                assert!(reason.contains("Abrir"), "sem orientação: {reason}");
            }
            other => panic!("esperado Unsupported para não-ZIP, veio {other:?}"),
        }
    }

    #[test]
    fn archive_corrupt_zip_is_an_error() {
        let corrupt = b"PK\x03\x04isto nao e um zip".as_slice();
        assert!(
            archive_preview(corrupt).is_err(),
            "assinatura ZIP sem diretório central deve ser Err"
        );
        let truncated = &ZIPPED[..ZIPPED.len() / 2];
        assert!(
            archive_preview(truncated).is_err(),
            "ZIP truncado deve ser Err"
        );
    }

    /* ------------------- binário (v1.5) ------------------- */

    #[test]
    fn binary_preview_truncates_the_hexdump_at_4096_bytes() {
        let data = vec![0xABu8; 10_000];
        match binary_preview(&data) {
            ArtifactPreview::Binary {
                format,
                preview_base64,
                preview_bytes,
            } => {
                assert_eq!(format, "application/octet-stream");
                assert_eq!(preview_bytes, MAX_BINARY_PREVIEW_BYTES as u32);
                let decoded = BASE64_STANDARD
                    .decode(preview_base64.as_bytes())
                    .expect("base64 válido");
                assert_eq!(decoded.len(), MAX_BINARY_PREVIEW_BYTES);
                assert!(decoded.iter().all(|byte| *byte == 0xAB));
            }
            other => panic!("esperado ArtifactPreview::Binary, veio {other:?}"),
        }
    }

    #[test]
    fn binary_preview_detects_the_mime_by_magic_bytes() {
        match binary_preview(b"%PDF-1.7\n") {
            ArtifactPreview::Binary {
                format,
                preview_base64,
                preview_bytes,
            } => {
                assert_eq!(format, "application/pdf");
                assert_eq!(preview_bytes, 9);
                assert_eq!(
                    BASE64_STANDARD
                        .decode(preview_base64.as_bytes())
                        .expect("base64 válido"),
                    b"%PDF-1.7\n"
                );
            }
            other => panic!("esperado ArtifactPreview::Binary, veio {other:?}"),
        }
    }

    #[test]
    fn new_preview_variants_serialize_with_camel_case_fields() {
        let image = serde_json::to_value(image_preview(TIFF).expect("prévia do TIFF"))
            .expect("serializar imagem");
        assert_eq!(image["kind"], "image");
        assert_eq!(image["mime"], "image/png");
        assert_eq!(image["width"], 160);
        assert!(image["dataBase64"].is_string(), "campo camelCase: {image}");

        let archive = serde_json::to_value(archive_preview(ZIPPED).expect("prévia do ZIP"))
            .expect("serializar ZIP");
        assert_eq!(archive["kind"], "archive");
        assert_eq!(archive["totalEntries"], 4);
        assert!(archive["truncated"].is_boolean());
        assert_eq!(archive["entries"][1]["isDir"], false);
        assert!(archive["entries"][1]["compressedSize"].is_number());

        let binary =
            serde_json::to_value(binary_preview(b"%PDF-1.7\n")).expect("serializar binário");
        assert_eq!(binary["kind"], "binary");
        assert_eq!(binary["previewBytes"], 9);
        assert!(
            binary["previewBase64"].is_string(),
            "campo camelCase: {binary}"
        );
    }

    /* ---------------- integração: scripts das skills ---------------- */

    const MAKE_DOCX: &str = include_str!("../../skills/office-docx/scripts/make_docx.py");
    const MAKE_XLSX: &str = include_str!("../../skills/office-xlsx/scripts/make_xlsx.py");
    const MAKE_PPTX: &str = include_str!("../../skills/office-pptx/scripts/make_pptx.py");
    const MAKE_PDF: &str = include_str!("../../skills/pdf/scripts/make_pdf.py");

    fn python_executable() -> Option<String> {
        for candidate in ["python", "python3"] {
            let output = Command::new(candidate).arg("--version").output().ok();
            if output.is_some_and(|output| output.status.success()) {
                return Some(candidate.to_string());
            }
        }
        None
    }

    struct TempWorkspace {
        path: PathBuf,
    }

    impl TempWorkspace {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "zylara-preview-skills-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).expect("criar diretório temporário");
            Self { path }
        }

        fn write(&self, name: &str, contents: &str) -> PathBuf {
            let path = self.path.join(name);
            std::fs::write(&path, contents).expect("escrever arquivo temporário");
            path
        }

        fn join(&self, name: &str) -> PathBuf {
            self.path.join(name)
        }
    }

    impl Drop for TempWorkspace {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn run_helper(
        python: &str,
        workspace: &TempWorkspace,
        script_name: &str,
        script: &str,
        spec_name: &str,
        spec: &str,
        out_name: &str,
    ) -> PathBuf {
        let script_path = workspace.write(script_name, script);
        let spec_path = workspace.write(spec_name, spec);
        let out_path = workspace.join(out_name);
        let output = Command::new(python)
            .arg(&script_path)
            .arg("--spec")
            .arg(&spec_path)
            .arg("--out")
            .arg(&out_path)
            .current_dir(&workspace.path)
            .output()
            .expect("executar python");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            output.status.success(),
            "helper {script_name} falhou: stdout={stdout} stderr={stderr}"
        );
        assert!(
            stdout.contains("OK "),
            "helper {script_name} não imprimiu `OK <path> <bytes>`: {stdout}"
        );
        assert!(out_path.is_file(), "arquivo de saída ausente: {out_path:?}");
        let size = std::fs::metadata(&out_path).expect("metadata").len();
        assert!(size > 0, "arquivo de saída vazio: {out_path:?}");
        out_path
    }

    fn read(path: &Path) -> Vec<u8> {
        std::fs::read(path).expect("ler arquivo gerado")
    }

    #[test]
    fn skill_scripts_generate_files_that_round_trip_through_the_previews() {
        let Some(python) = python_executable() else {
            eprintln!("Python não encontrado no PATH: teste de integração das skills pulado");
            return;
        };
        let workspace = TempWorkspace::new();

        // DOCX → docx_html
        let docx_spec = r#"{
            "title": "Relatório de Integração",
            "subtitle": "Gerado pelo script embutido",
            "footer": "Zylara · teste",
            "blocks": [
                {"type": "heading", "level": 1, "text": "Introdução"},
                {"type": "paragraph", "text": "Texto com acentuação: ação, coração, ção."},
                {"type": "bullets", "items": ["Primeiro item", "Segundo item"]},
                {"type": "table", "headers": ["Produto", "Receita"],
                 "rows": [["Plataforma", "2.910.000"]]},
                {"type": "page_break"},
                {"type": "heading", "level": 2, "text": "Segunda página"},
                {"type": "paragraph", "text": "Conteúdo final."}
            ]
        }"#;
        let docx_path = run_helper(
            &python,
            &workspace,
            "make_docx.py",
            MAKE_DOCX,
            "docx-spec.json",
            docx_spec,
            "relatorio.docx",
        );
        let html = docx_html(&read(&docx_path)).expect("preview do DOCX gerado");
        assert!(html.contains("<h1>Introdução</h1>"), "html: {html}");
        assert!(html.contains("<li>Primeiro item</li>"), "html: {html}");
        assert!(html.contains("<td>2.910.000</td>"), "html: {html}");
        assert!(html.contains("<h2>Segunda página</h2>"), "html: {html}");
        assert!(html.contains("ação, coração, ção"), "html: {html}");

        // XLSX → xlsx_sheets
        let xlsx_spec = r##"{
            "sheets": [
                {"name": "Vendas",
                 "rows": [["Mês", "Receita"], ["Julho", 1410000], ["Agosto", 1580000],
                          ["Total", "=SUM(B2:B3)"]],
                 "formats": {"B2": "#,##0", "B3": "#,##0"}},
                {"name": "Metas", "rows": [["Região", "Meta"], ["Sul", 900000]]}
            ]
        }"##;
        let xlsx_path = run_helper(
            &python,
            &workspace,
            "make_xlsx.py",
            MAKE_XLSX,
            "xlsx-spec.json",
            xlsx_spec,
            "vendas.xlsx",
        );
        let sheets = xlsx_sheets(&read(&xlsx_path)).expect("preview do XLSX gerado");
        assert_eq!(sheets.len(), 2, "planilhas geradas: {sheets:?}");
        assert_eq!(sheets[0].name, "Vendas");
        assert_eq!(sheets[1].name, "Metas");
        assert_eq!(sheets[0].rows[1][0], "Julho");
        assert_eq!(sheets[0].rows[1][1], "1410000");
        assert_eq!(sheets[0].rows[3][1], "2990000", "valor em cache da fórmula");
        assert!(!sheets[0].truncated);

        // PPTX → pptx_slides
        let pptx_spec = r#"{
            "title": "Aurora Q3",
            "subtitle": "Apresentação de integração",
            "slides": [
                {"title": "Números", "bullets": ["Receita: 4,82 mi", "Churn: 1,4%"],
                 "notes": "Falar da margem bruta."},
                {"title": "Próximos passos", "bullets": ["Contratar engenheiros"]}
            ]
        }"#;
        let pptx_path = run_helper(
            &python,
            &workspace,
            "make_pptx.py",
            MAKE_PPTX,
            "pptx-spec.json",
            pptx_spec,
            "apresentacao.pptx",
        );
        let slides = pptx_slides(&read(&pptx_path)).expect("preview do PPTX gerado");
        assert_eq!(slides.len(), 3, "capa + 2 slides: {slides:?}");
        assert_eq!(slides[0].index, 1);
        assert!(
            slides[0].texts.iter().any(|text| text.contains("Aurora Q3")),
            "capa: {:?}",
            slides[0].texts
        );
        assert_eq!(slides[1].texts[0], "Números");
        assert!(
            slides[1]
                .texts
                .iter()
                .any(|text| text.contains("Receita: 4,82 mi"))
        );
        let notes = slides[1].notes.as_deref().unwrap_or_default();
        assert!(notes.contains("margem bruta"), "notas: {notes}");
        assert!(
            slides[2]
                .texts
                .iter()
                .any(|text| text.contains("Próximos passos"))
        );

        // PDF → assinatura + pdf-extract
        let pdf_spec = r#"{
            "title": "Relatório de Integração",
            "subtitle": "PDF gerado pelo helper",
            "footer": "Zylara · teste",
            "blocks": [
                {"type": "heading", "level": 1, "text": "Introdução"},
                {"type": "paragraph", "text": "Texto com acentuação: ação, coração, ção."},
                {"type": "bullets", "items": ["Primeiro item", "Segundo item"]},
                {"type": "page_break"},
                {"type": "heading", "level": 1, "text": "Segunda página"},
                {"type": "paragraph", "text": "Conteúdo final do PDF."}
            ]
        }"#;
        let pdf_path = run_helper(
            &python,
            &workspace,
            "make_pdf.py",
            MAKE_PDF,
            "pdf-spec.json",
            pdf_spec,
            "relatorio.pdf",
        );
        let pdf = read(&pdf_path);
        assert!(pdf.starts_with(b"%PDF-"), "assinatura PDF ausente");
        assert!(
            pdf.windows(b"/Type /Catalog".len())
                .any(|window| window == b"/Type /Catalog"),
            "catálogo ausente"
        );
        assert!(
            pdf.windows(b"/Count 2".len())
                .any(|window| window == b"/Count 2"),
            "esperava duas páginas"
        );
        let text = pdf_extract::extract_text_from_mem(&pdf).expect("extrair texto do PDF gerado");
        assert!(
            text.contains("Relatório de Integração"),
            "texto extraído: {text}"
        );
        assert!(text.contains("Introdução"), "texto extraído: {text}");
        assert!(text.contains("Segunda página"), "texto extraído: {text}");
        assert!(
            text.contains("Conteúdo final do PDF."),
            "texto extraído: {text}"
        );
        assert!(
            text.contains("Page 1 of 2") && text.contains("Page 2 of 2"),
            "paginação ausente: {text}"
        );

        // Limites: planilha maior que 200 linhas × 40 colunas.
        let mut rows = Vec::new();
        for row in 1..=260u32 {
            let cells: Vec<String> = (1..=45u32)
                .map(|column| (row * 100 + column).to_string())
                .collect();
            rows.push(format!("[{}]", cells.join(",")));
        }
        let big_spec = format!(
            r#"{{"sheets":[{{"name":"Grande","rows":[{}]}}]}}"#,
            rows.join(",")
        );
        let big_path = run_helper(
            &python,
            &workspace,
            "make_xlsx_big.py",
            MAKE_XLSX,
            "xlsx-big-spec.json",
            &big_spec,
            "grande.xlsx",
        );
        let big_sheets = xlsx_sheets(&read(&big_path)).expect("preview da planilha grande");
        assert_eq!(big_sheets.len(), 1);
        assert!(big_sheets[0].truncated, "truncamento não sinalizado");
        assert_eq!(big_sheets[0].rows.len(), MAX_XLSX_ROWS);
        assert!(big_sheets[0]
            .rows
            .iter()
            .all(|row| row.len() <= MAX_XLSX_COLUMNS));

        // Spec inválido → exit code != 0 e nenhum arquivo gerado.
        let bad_spec_path = workspace.write("spec-invalido.json", "{ isto nao e json");
        let script_path = workspace.write("make_docx_bad.py", MAKE_DOCX);
        let out_path = workspace.join("nao-deve-existir.docx");
        let output = Command::new(&python)
            .arg(&script_path)
            .arg("--spec")
            .arg(&bad_spec_path)
            .arg("--out")
            .arg(&out_path)
            .current_dir(&workspace.path)
            .output()
            .expect("executar python com spec inválido");
        assert!(
            !output.status.success(),
            "spec inválido deveria falhar: stdout={}",
            String::from_utf8_lossy(&output.stdout)
        );
        assert!(!out_path.exists(), "não deveria gerar saída com spec inválido");
    }
}
