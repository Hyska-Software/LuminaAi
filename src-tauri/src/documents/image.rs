//! Image attachments: dimensions + base64 payload for vision models.

use base64::prelude::{Engine as _, BASE64_STANDARD};
use serde_json::json;

use super::{text, ExtractedDocument};

/// Do not inline images larger than this into the model context (base64 would
/// waste a huge amount of tokens).
const MAX_INLINE_BYTES: usize = 32 * 1024 * 1024;

/// Raster formats accepted by the vision models of the OpenCode gateway.
pub(crate) fn is_raster_mime(mime: &str) -> bool {
    matches!(
        mime,
        "image/png" | "image/jpeg" | "image/jpg" | "image/webp" | "image/gif"
    )
}

pub fn extract(bytes: &[u8], mime: &str) -> ExtractedDocument {
    let detected = infer::get(bytes)
        .map(|kind| kind.mime_type().to_string())
        .unwrap_or_else(|| mime.to_string());
    let normalized = normalize_mime(&detected, bytes);
    let (width, height) = dimensions(bytes, &normalized);

    // SVG is XML: the model can read it as text, and providers do not accept it
    // as an image part.
    if normalized.contains("svg") {
        let (text, encoding) = text::decode(bytes, None);
        return ExtractedDocument {
            kind: "image".to_string(),
            text,
            width,
            height,
            image_mime: Some("image/svg+xml".to_string()),
            metadata: json!({
                "format": "image/svg+xml",
                "encoding": encoding,
                "bytes": bytes.len(),
            }),
            ..Default::default()
        };
    }

    let mut metadata = json!({
        "format": normalized,
        "bytes": bytes.len(),
        "width": width,
        "height": height,
    });

    let image_base64 = if bytes.len() > MAX_INLINE_BYTES {
        metadata["warning"] =
            json!("imagem grande demais para ser enviada ao modelo; apenas metadados disponíveis");
        None
    } else if !is_raster_mime(&normalized) && !normalized.starts_with("image/") {
        None
    } else {
        Some(BASE64_STANDARD.encode(bytes))
    };

    ExtractedDocument {
        kind: "image".to_string(),
        text: String::new(),
        width,
        height,
        image_base64,
        image_mime: Some(normalized),
        metadata,
        ..Default::default()
    }
}

fn normalize_mime(detected: &str, bytes: &[u8]) -> String {
    match detected {
        "image/jpg" => "image/jpeg".to_string(),
        "application/octet-stream" => sniff_header(bytes),
        other if other.is_empty() => sniff_header(bytes),
        other => other.to_string(),
    }
}

fn sniff_header(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png".into()
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg".into()
    } else if bytes.starts_with(b"GIF8") {
        "image/gif".into()
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp".into()
    } else if bytes.starts_with(b"BM") {
        "image/bmp".into()
    } else if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
        "image/svg+xml".into()
    } else {
        "image/unknown".into()
    }
}

fn dimensions(bytes: &[u8], mime: &str) -> (Option<u32>, Option<u32>) {
    let dims = match mime {
        "image/png" => png_dimensions(bytes),
        "image/jpeg" => jpeg_dimensions(bytes),
        "image/gif" => gif_dimensions(bytes),
        "image/webp" => webp_dimensions(bytes),
        "image/bmp" => bmp_dimensions(bytes),
        _ => None,
    };
    match dims {
        Some((width, height)) => (Some(width), Some(height)),
        None => (None, None),
    }
}

fn u32_be(bytes: &[u8]) -> Option<u32> {
    let slice = bytes.get(..4)?;
    Some(u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn u16_le(bytes: &[u8]) -> Option<u16> {
    let slice = bytes.get(..2)?;
    Some(u16::from_le_bytes([slice[0], slice[1]]))
}

fn u32_le(bytes: &[u8]) -> Option<u32> {
    let slice = bytes.get(..4)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || !bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return None;
    }
    Some((u32_be(&bytes[16..20])?, u32_be(&bytes[20..24])?))
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut index = 2usize;
    while index + 9 < bytes.len() {
        if bytes[index] != 0xFF {
            index += 1;
            continue;
        }
        let marker = bytes[index + 1];
        // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
        if (0xC0..=0xCF).contains(&marker) && marker != 0xC4 && marker != 0xC8 && marker != 0xCC {
            let height = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]) as u32;
            let width = u16::from_be_bytes([bytes[index + 7], bytes[index + 8]]) as u32;
            return Some((width, height));
        }
        if marker == 0xD8 || marker == 0xD9 || (0xD0..=0xD7).contains(&marker) {
            index += 2;
            continue;
        }
        let length = u16::from_be_bytes([bytes[index + 2], bytes[index + 3]]) as usize;
        if length < 2 {
            return None;
        }
        index += 2 + length;
    }
    None
}

fn gif_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 10 || !bytes.starts_with(b"GIF8") {
        return None;
    }
    Some((u16_le(&bytes[6..8])? as u32, u16_le(&bytes[8..10])? as u32))
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 30 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    match &bytes[12..16] {
        b"VP8X" => {
            let width = 1 + (bytes[24] as u32 | ((bytes[25] as u32) << 8) | ((bytes[26] as u32) << 16));
            let height = 1 + (bytes[27] as u32 | ((bytes[28] as u32) << 8) | ((bytes[29] as u32) << 16));
            Some((width, height))
        }
        b"VP8 " => {
            let width = u16::from_le_bytes([bytes[26], bytes[27]]) as u32 & 0x3FFF;
            let height = u16::from_le_bytes([bytes[28], bytes[29]]) as u32 & 0x3FFF;
            Some((width, height))
        }
        b"VP8L" => {
            let bits = u32_le(&bytes[21..25])?;
            let width = (bits & 0x3FFF) + 1;
            let height = ((bits >> 14) & 0x3FFF) + 1;
            Some((width, height))
        }
        _ => None,
    }
}

fn bmp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 26 || !bytes.starts_with(b"BM") {
        return None;
    }
    let width = u32_le(&bytes[18..22])? as i32;
    let height = u32_le(&bytes[22..26])? as i32;
    Some((width.unsigned_abs(), height.unsigned_abs()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1x1 transparent PNG.
    const PNG_1X1: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    #[test]
    fn reads_png_dimensions() {
        let doc = extract(PNG_1X1, "image/png");
        assert_eq!(doc.kind, "image");
        assert_eq!(doc.width, Some(1));
        assert_eq!(doc.height, Some(1));
        assert!(doc.image_base64.is_some());
        assert_eq!(doc.image_mime.as_deref(), Some("image/png"));
    }

    #[test]
    fn reads_gif_dimensions() {
        let mut gif = b"GIF89a".to_vec();
        gif.extend_from_slice(&[0x20, 0x00, 0x10, 0x00]);
        gif.extend_from_slice(&[0u8; 8]);
        let doc = extract(&gif, "image/gif");
        assert_eq!(doc.width, Some(32));
        assert_eq!(doc.height, Some(16));
    }

    #[test]
    fn svg_is_kept_as_text() {
        let doc = extract(b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "image/svg+xml");
        assert_eq!(doc.kind, "image");
        assert!(doc.image_base64.is_none());
        assert!(doc.text.contains("<svg"));
    }
}
