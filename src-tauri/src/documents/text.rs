//! Plain text, source code, JSON and CSV/TSV extraction.

use serde_json::json;

use super::ExtractedDocument;

const MAX_CSV_ROWS: usize = 2_000;
const MAX_CSV_COLUMNS: usize = 100;
const MAX_CELL_CHARS: usize = 2_000;

/// Decode raw bytes into a UTF-8 string, returning the detected encoding label.
pub fn decode(bytes: &[u8], declared_charset: Option<&str>) -> (String, String) {
    if bytes.is_empty() {
        return (String::new(), "utf-8".to_string());
    }

    // Byte order marks are authoritative.
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return (String::from_utf8_lossy(rest).into_owned(), "utf-8".to_string());
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let (text, _, _) = encoding_rs::UTF_16LE.decode(rest);
        return (text.into_owned(), "utf-16le".to_string());
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let (text, _, _) = encoding_rs::UTF_16BE.decode(rest);
        return (text.into_owned(), "utf-16be".to_string());
    }

    if let Some(label) = declared_charset.map(str::trim).filter(|l| !l.is_empty()) {
        if let Some(encoding) = encoding_rs::Encoding::for_label(label.as_bytes()) {
            let (text, _, _) = encoding.decode(bytes);
            return (text.into_owned(), encoding.name().to_lowercase());
        }
    }

    if let Ok(text) = std::str::from_utf8(bytes) {
        return (text.to_string(), "utf-8".to_string());
    }

    // UTF-16 without a BOM: a lot of NUL bytes in every other position.
    if let Some((text, name)) = decode_utf16_guess(bytes) {
        return (text, name);
    }

    let mut detector =
        chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Deny);
    detector.feed(bytes, true);
    let encoding = detector.guess(None, chardetng::Utf8Detection::Allow);
    let (text, _, _) = encoding.decode(bytes);
    (text.into_owned(), encoding.name().to_lowercase())
}

fn decode_utf16_guess(bytes: &[u8]) -> Option<(String, String)> {
    if bytes.len() < 8 {
        return None;
    }
    let pairs = bytes.len() / 2;
    let nul_even = bytes.iter().step_by(2).filter(|b| **b == 0).count();
    let nul_odd = bytes.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
    let threshold = pairs / 3;
    if nul_even > threshold {
        let (text, _, _) = encoding_rs::UTF_16BE.decode(bytes);
        return Some((text.into_owned(), "utf-16be".to_string()));
    }
    if nul_odd > threshold {
        let (text, _, _) = encoding_rs::UTF_16LE.decode(bytes);
        return Some((text.into_owned(), "utf-16le".to_string()));
    }
    None
}

/// Plain text / code / JSON: decode and keep the text as-is.
pub fn extract_plain(bytes: &[u8], kind: &str, mime: &str) -> ExtractedDocument {
    let (text, encoding) = decode(bytes, None);
    ExtractedDocument {
        kind: kind.to_string(),
        text,
        metadata: json!({
            "format": mime_or_kind(mime, kind),
            "encoding": encoding,
            "bytes": bytes.len(),
        }),
        ..Default::default()
    }
}

fn mime_or_kind(mime: &str, kind: &str) -> String {
    if mime.trim().is_empty() {
        kind.to_string()
    } else {
        mime.trim().to_string()
    }
}

/// CSV / TSV: parse into rows (quote aware) and render as tab separated rows.
pub fn extract_csv(bytes: &[u8], filename: &str, mime: &str) -> ExtractedDocument {
    let (text, encoding) = decode(bytes, None);
    let delimiter = detect_delimiter(&text, filename, mime);
    let (rows, row_overflow) = parse_records(&text, delimiter);
    let columns = rows.iter().map(|r| r.len()).max().unwrap_or(0);

    let mut out = String::new();
    for row in &rows {
        let mut end = row.len();
        while end > 0 && row[end - 1].is_empty() {
            end -= 1;
        }
        if end == 0 {
            continue;
        }
        for (index, cell) in row[..end].iter().enumerate() {
            if index > 0 {
                out.push('\t');
            }
            out.push_str(cell);
        }
        out.push('\n');
    }
    let truncated = row_overflow;
    if truncated {
        out.push_str("… (linhas adicionais omitidas)\n");
    }

    ExtractedDocument {
        kind: "csv".to_string(),
        text: out,
        truncated,
        metadata: json!({
            "format": if delimiter == '\t' { "tsv" } else { "csv" },
            "encoding": encoding,
            "rows": rows.len(),
            "columns": columns,
            "delimiter": delimiter.to_string(),
            "bytes": bytes.len(),
        }),
        ..Default::default()
    }
}

fn detect_delimiter(text: &str, filename: &str, mime: &str) -> char {
    let lower = filename.to_lowercase();
    if lower.ends_with(".tsv") || mime.contains("tab-separated") {
        return '\t';
    }
    let sample: String = text.lines().take(5).collect::<Vec<_>>().join("\n");
    let candidates = [',', ';', '\t', '|'];
    let mut best = (',', 0usize);
    for candidate in candidates {
        let count = sample.matches(candidate).count();
        if count > best.1 {
            best = (candidate, count);
        }
    }
    best.0
}

/// Parse delimited text respecting quoted cells (including quoted newlines).
fn parse_records(text: &str, delimiter: char) -> (Vec<Vec<String>>, bool) {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut cell = String::new();
    let mut in_quotes = false;
    let mut overflow = false;
    let mut chars = text.chars().peekable();

    let push_cell = |row: &mut Vec<String>, cell: &mut String, overflow: &mut bool| {
        if row.len() < MAX_CSV_COLUMNS {
            let value = if cell.chars().count() > MAX_CELL_CHARS {
                *overflow = true;
                cell.chars().take(MAX_CELL_CHARS).collect()
            } else {
                cell.clone()
            };
            row.push(value);
        } else {
            *overflow = true;
        }
        cell.clear();
    };

    let push_row = |rows: &mut Vec<Vec<String>>, row: &mut Vec<String>, overflow: &mut bool| {
        let finished = std::mem::take(row);
        if rows.len() < MAX_CSV_ROWS {
            rows.push(finished);
        } else {
            *overflow = true;
        }
    };

    while let Some(ch) = chars.next() {
        if rows.len() >= MAX_CSV_ROWS && !in_quotes {
            overflow = true;
            break;
        }
        if in_quotes {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    cell.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                cell.push(ch);
            }
            continue;
        }
        match ch {
            '"' if cell.trim().is_empty() => {
                cell.clear();
                in_quotes = true;
            }
            c if c == delimiter => push_cell(&mut row, &mut cell, &mut overflow),
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                push_cell(&mut row, &mut cell, &mut overflow);
                push_row(&mut rows, &mut row, &mut overflow);
            }
            '\n' => {
                push_cell(&mut row, &mut cell, &mut overflow);
                push_row(&mut rows, &mut row, &mut overflow);
            }
            _ => cell.push(ch),
        }
    }
    if !cell.is_empty() || !row.is_empty() {
        push_cell(&mut row, &mut cell, &mut overflow);
        push_row(&mut rows, &mut row, &mut overflow);
    }
    (rows, overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_roundtrip() {
        let (text, encoding) = decode("ação ✓".as_bytes(), None);
        assert_eq!(text, "ação ✓");
        assert_eq!(encoding, "utf-8");
    }

    #[test]
    fn declared_charset_wins() {
        let (text, encoding) = decode(b"caf\xe9", Some("windows-1252"));
        assert_eq!(text, "café");
        assert_eq!(encoding, "windows-1252");
    }

    #[test]
    fn parses_quoted_csv() {
        let (rows, overflow) = parse_records("a,\"b,c\"\n1,\"linha\nquebrada\"\n", ',');
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], vec!["a".to_string(), "b,c".to_string()]);
        assert_eq!(rows[1][1], "linha\nquebrada");
        assert!(!overflow);
    }

    #[test]
    fn sniffs_semicolon_delimiter() {
        assert_eq!(detect_delimiter("a;b;c\n1;2;3", "dados.csv", "text/csv"), ';');
    }
}
