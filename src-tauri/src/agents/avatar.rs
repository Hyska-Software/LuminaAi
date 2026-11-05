//! Agent avatar contract: built-in mascot, uploaded image or legacy emoji.
//!
//! Images are normalized to a small data URL so `list_agents` stays bounded;
//! small animated GIF/WebP files keep their original bytes.

use std::io::Cursor;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use image::{ImageEncoder as _, ImageReader};
use serde::{Deserialize, Serialize};

use crate::documents::image::{sniff_format, ImageFormat};

const MAX_AVATAR_SOURCE_BYTES: usize = 10 * 1024 * 1024;
const MAX_ANIMATED_BYTES: usize = 512 * 1024;
const MAX_AVATAR_DATA_URL_CHARS: usize = 2_000_000;
const MAX_AVATAR_SIDE: u32 = 8_192;
const AVATAR_SIDE: u32 = 256;
const MAX_EMOJI_BYTES: usize = 64;

const IMAGE_PREFIXES: [&str; 4] = [
    "data:image/png;base64,",
    "data:image/jpeg;base64,",
    "data:image/gif;base64,",
    "data:image/webp;base64,",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentAvatarShape {
    Mascot,
    Circle,
    Rounded,
    Square,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum AgentAvatarFace {
    #[default]
    White,
    Black,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentAvatarBody {
    Mascot,
    Circle,
    Bubble,
    Rounded,
    Square,
    Drop,
    Blob,
    Hex,
    Diamond,
    Star,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentAvatarExpression {
    Neutral,
    Happy,
    Grin,
    Wink,
    Surprised,
    Angry,
    Sad,
    Sleepy,
    Smug,
    Dizzy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentAvatarColor {
    Green,
    Blue,
    Red,
    Orange,
    Purple,
    Teal,
    Pink,
    Yellow,
    Emerald,
    Coral,
    Gray,
    Silver,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentAvatarSource {
    Mascot {
        body: AgentAvatarBody,
        expression: AgentAvatarExpression,
        color: AgentAvatarColor,
        #[serde(default)]
        face: AgentAvatarFace,
    },
    Image {
        #[serde(rename = "dataUrl")]
        data_url: String,
    },
    Emoji {
        value: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAvatar {
    #[serde(flatten)]
    pub source: AgentAvatarSource,
    pub shape: AgentAvatarShape,
}

impl Default for AgentAvatar {
    fn default() -> Self {
        Self {
            source: AgentAvatarSource::Mascot {
                body: AgentAvatarBody::Mascot,
                expression: AgentAvatarExpression::Neutral,
                color: AgentAvatarColor::Blue,
                face: AgentAvatarFace::White,
            },
            shape: AgentAvatarShape::Mascot,
        }
    }
}

impl AgentAvatar {
    /// Legacy emoji avatars keep the old rounded tile look.
    pub fn emoji(value: impl Into<String>) -> Self {
        let value = value.into();
        let value = value.trim();
        Self {
            source: AgentAvatarSource::Emoji {
                value: if value.is_empty() {
                    "🤖".to_string()
                } else {
                    value.to_string()
                },
            },
            shape: AgentAvatarShape::Rounded,
        }
    }

    pub fn image(data_url: impl Into<String>) -> Self {
        Self {
            source: AgentAvatarSource::Image {
                data_url: data_url.into(),
            },
            shape: AgentAvatarShape::Circle,
        }
    }

    /// Random built-in mascot for model-created personas. Never an emoji.
    pub fn random_mascot() -> Self {
        let mut seed = [0u8; 8];
        // Entropy failure leaves zeros; the caller still gets a valid mascot.
        let _ = getrandom::getrandom(&mut seed);
        mascot_from_seed(seed)
    }

    /// Compact form for model-facing JSON: an image never leaks its data URL.
    pub fn summary(&self) -> serde_json::Value {
        match &self.source {
            AgentAvatarSource::Image { .. } => {
                serde_json::json!({ "kind": "image", "shape": self.shape })
            }
            _ => serde_json::to_value(self).unwrap_or(serde_json::Value::Null),
        }
    }
}

fn mascot_from_seed(seed: [u8; 8]) -> AgentAvatar {
    const BODIES: [AgentAvatarBody; 10] = [
        AgentAvatarBody::Mascot,
        AgentAvatarBody::Circle,
        AgentAvatarBody::Bubble,
        AgentAvatarBody::Rounded,
        AgentAvatarBody::Square,
        AgentAvatarBody::Drop,
        AgentAvatarBody::Blob,
        AgentAvatarBody::Hex,
        AgentAvatarBody::Diamond,
        AgentAvatarBody::Star,
    ];
    const EXPRESSIONS: [AgentAvatarExpression; 10] = [
        AgentAvatarExpression::Neutral,
        AgentAvatarExpression::Happy,
        AgentAvatarExpression::Grin,
        AgentAvatarExpression::Wink,
        AgentAvatarExpression::Surprised,
        AgentAvatarExpression::Angry,
        AgentAvatarExpression::Sad,
        AgentAvatarExpression::Sleepy,
        AgentAvatarExpression::Smug,
        AgentAvatarExpression::Dizzy,
    ];
    const COLORS: [AgentAvatarColor; 12] = [
        AgentAvatarColor::Green,
        AgentAvatarColor::Blue,
        AgentAvatarColor::Red,
        AgentAvatarColor::Orange,
        AgentAvatarColor::Purple,
        AgentAvatarColor::Teal,
        AgentAvatarColor::Pink,
        AgentAvatarColor::Yellow,
        AgentAvatarColor::Emerald,
        AgentAvatarColor::Coral,
        AgentAvatarColor::Gray,
        AgentAvatarColor::Silver,
    ];
    const FACES: [AgentAvatarFace; 2] = [AgentAvatarFace::White, AgentAvatarFace::Black];
    let index = |offset: usize, len: usize| -> usize {
        (u16::from_le_bytes([seed[offset], seed[offset + 1]]) as usize) % len
    };
    AgentAvatar {
        source: AgentAvatarSource::Mascot {
            body: BODIES[index(0, BODIES.len())],
            expression: EXPRESSIONS[index(2, EXPRESSIONS.len())],
            color: COLORS[index(4, COLORS.len())],
            face: FACES[index(6, FACES.len())],
        },
        shape: AgentAvatarShape::Mascot,
    }
}

/// Validates ids/limits and trims the emoji. Enums already reject unknown
/// mascot ids at deserialization time.
pub fn normalize_avatar(mut avatar: AgentAvatar) -> Result<AgentAvatar, String> {
    match &mut avatar.source {
        AgentAvatarSource::Emoji { value } => {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                *value = "🤖".to_string();
            } else if trimmed.len() > MAX_EMOJI_BYTES {
                return Err("AGENT_AVATAR_INVALID: o emoji é grande demais.".to_string());
            } else {
                *value = trimmed;
            }
        }
        AgentAvatarSource::Image { data_url } => {
            let Some(prefix) = IMAGE_PREFIXES
                .iter()
                .find(|prefix| data_url.starts_with(**prefix))
            else {
                return Err(
                    "AGENT_AVATAR_INVALID: a imagem deve ser PNG, JPEG, GIF ou WebP.".to_string(),
                );
            };
            if data_url.len() > MAX_AVATAR_DATA_URL_CHARS {
                return Err("AGENT_AVATAR_TOO_LARGE: a imagem do avatar é grande demais.".to_string());
            }
            if data_url.len() <= prefix.len() {
                return Err("AGENT_AVATAR_INVALID: a imagem do avatar está vazia.".to_string());
            }
        }
        AgentAvatarSource::Mascot { .. } => {}
    }
    Ok(avatar)
}

fn decode_limits() -> image::Limits {
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_AVATAR_SIDE);
    limits.max_image_height = Some(MAX_AVATAR_SIDE);
    limits.max_alloc = Some(256 * 1024 * 1024);
    limits
}

fn read_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| format!("AGENT_AVATAR_INVALID: falha ao identificar a imagem: {error}"))?;
    reader.limits(decode_limits());
    reader
        .into_dimensions()
        .map_err(|error| format!("AGENT_AVATAR_INVALID: falha ao ler a imagem: {error}"))
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", BASE64_STANDARD.encode(bytes))
}

/// Reads an image from disk, validates it and returns a bounded data URL.
///
/// PNG/JPEG are center-cropped and resized to 256x256. Animated GIF/WebP up to
/// 512 KiB keep their original bytes (and animation); larger ones are flattened
/// to the first frame.
pub fn normalize_avatar_image(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("AGENT_AVATAR_INVALID: a imagem está vazia.".to_string());
    }
    if bytes.len() > MAX_AVATAR_SOURCE_BYTES {
        return Err("AGENT_AVATAR_TOO_LARGE: a imagem passa de 10 MB.".to_string());
    }
    let format = sniff_format(bytes);
    let mime = match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::Gif => "image/gif",
        ImageFormat::Webp => "image/webp",
        _ => {
            return Err(
                "AGENT_AVATAR_UNSUPPORTED: a imagem deve ser PNG, JPEG, GIF ou WebP.".to_string(),
            )
        }
    };

    let (width, height) = read_dimensions(bytes)?;
    if width > MAX_AVATAR_SIDE || height > MAX_AVATAR_SIDE {
        return Err("AGENT_AVATAR_INVALID: a imagem passa de 8192 px.".to_string());
    }

    if matches!(format, ImageFormat::Gif | ImageFormat::Webp) && bytes.len() <= MAX_ANIMATED_BYTES {
        let url = data_url(mime, bytes);
        if url.len() > MAX_AVATAR_DATA_URL_CHARS {
            return Err("AGENT_AVATAR_TOO_LARGE: a imagem do avatar é grande demais.".to_string());
        }
        return Ok(url);
    }

    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| format!("AGENT_AVATAR_INVALID: falha ao identificar a imagem: {error}"))?;
    reader.limits(decode_limits());
    let decoded = reader
        .decode()
        .map_err(|error| format!("AGENT_AVATAR_INVALID: falha ao decodificar a imagem: {error}"))?;
    let side = decoded.width().min(decoded.height());
    if side == 0 {
        return Err("AGENT_AVATAR_INVALID: a imagem não tem dimensões válidas.".to_string());
    }
    let x = (decoded.width() - side) / 2;
    let y = (decoded.height() - side) / 2;
    let cropped = decoded.crop_imm(x, y, side, side);
    let resized = cropped.resize_exact(AVATAR_SIDE, AVATAR_SIDE, image::imageops::FilterType::Lanczos3);
    let rgba = resized.into_rgba8();
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(
            rgba.as_raw(),
            AVATAR_SIDE,
            AVATAR_SIDE,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| format!("AGENT_AVATAR_INVALID: falha ao gerar a imagem: {error}"))?;
    let url = data_url("image/png", &png);
    if url.len() > MAX_AVATAR_DATA_URL_CHARS {
        return Err("AGENT_AVATAR_TOO_LARGE: a imagem do avatar é grande demais.".to_string());
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbaImage::from_fn(width, height, |x, y| {
            image::Rgba([(x % 255) as u8, (y % 255) as u8, 120, 255])
        });
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(
                image.as_raw(),
                width,
                height,
                image::ExtendedColorType::Rgba8,
            )
            .expect("png");
        bytes
    }

    const GIF_1X1: &[u8] = &[
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00,
        0x00, 0xFF, 0xFF, 0xFF, 0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2C, 0x00, 0x00,
        0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3B,
    ];

    #[test]
    fn legacy_mascot_without_face_defaults_to_white() {
        let json = r#"{"kind":"mascot","body":"mascot","expression":"neutral","color":"blue","shape":"mascot"}"#;
        let avatar: AgentAvatar = serde_json::from_str(json).expect("legacy avatar");
        match avatar.source {
            AgentAvatarSource::Mascot { face, .. } => assert_eq!(face, AgentAvatarFace::White),
            other => panic!("unexpected source: {other:?}"),
        }
    }

    fn mascot_parts(
        avatar: &AgentAvatar,
    ) -> (AgentAvatarBody, AgentAvatarExpression, AgentAvatarColor, AgentAvatarFace) {
        match &avatar.source {
            AgentAvatarSource::Mascot {
                body,
                expression,
                color,
                face,
            } => (*body, *expression, *color, *face),
            other => panic!("unexpected source: {other:?}"),
        }
    }

    #[test]
    fn seeded_mascot_varies_each_component() {
        let base = mascot_from_seed([0; 8]);
        assert_eq!(base.shape, AgentAvatarShape::Mascot);
        assert_eq!(
            mascot_parts(&base),
            (
                AgentAvatarBody::Mascot,
                AgentAvatarExpression::Neutral,
                AgentAvatarColor::Green,
                AgentAvatarFace::White,
            )
        );

        let body = mascot_from_seed([1, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(mascot_parts(&body).0, AgentAvatarBody::Circle);
        let expression = mascot_from_seed([0, 0, 1, 0, 0, 0, 0, 0]);
        assert_eq!(mascot_parts(&expression).1, AgentAvatarExpression::Happy);
        let color = mascot_from_seed([0, 0, 0, 0, 1, 0, 0, 0]);
        assert_eq!(mascot_parts(&color).2, AgentAvatarColor::Blue);
        let face = mascot_from_seed([0, 0, 0, 0, 0, 0, 1, 0]);
        assert_eq!(mascot_parts(&face).3, AgentAvatarFace::Black);
    }

    #[test]
    fn random_mascot_is_always_a_mascot_avatar() {
        let avatar = AgentAvatar::random_mascot();
        assert_eq!(avatar.shape, AgentAvatarShape::Mascot);
        assert!(matches!(
            avatar.source,
            AgentAvatarSource::Mascot { .. }
        ));
    }

    #[test]
    fn avatar_serde_roundtrip_keeps_data_url_field_name() {
        let avatar = AgentAvatar::image("data:image/png;base64,AAAA");
        let json = serde_json::to_string(&avatar).expect("json");
        assert!(json.contains("\"dataUrl\":"));
        assert!(json.contains("\"shape\":\"circle\""));
        let decoded: AgentAvatar = serde_json::from_str(&json).expect("decode");
        assert_eq!(decoded, avatar);
    }

    #[test]
    fn normalize_avatar_trims_emoji_and_rejects_bad_images() {
        let avatar = normalize_avatar(AgentAvatar::emoji("  🛠️  ")).expect("emoji");
        match avatar.source {
            AgentAvatarSource::Emoji { value } => assert_eq!(value, "🛠️"),
            other => panic!("unexpected source: {other:?}"),
        }
        assert!(normalize_avatar(AgentAvatar::image("data:text/html;base64,AAAA")).is_err());
        assert!(normalize_avatar(AgentAvatar::image("data:image/png;base64,")).is_err());
    }

    #[test]
    fn normalizes_png_to_a_square_256_png() {
        let url = normalize_avatar_image(&png(320, 200)).expect("normalize");
        assert!(url.starts_with("data:image/png;base64,"));
        let bytes = BASE64_STANDARD
            .decode(url.trim_start_matches("data:image/png;base64,"))
            .expect("base64");
        let decoded = image::load_from_memory(&bytes).expect("decode");
        assert_eq!((decoded.width(), decoded.height()), (AVATAR_SIDE, AVATAR_SIDE));
    }

    #[test]
    fn preserves_small_gif_animation() {
        let url = normalize_avatar_image(GIF_1X1).expect("gif");
        assert!(url.starts_with("data:image/gif;base64,"));
    }

    #[test]
    fn rejects_svg_and_oversized_input() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>"#;
        assert!(normalize_avatar_image(svg).expect_err("svg").contains("AGENT_AVATAR_UNSUPPORTED"));
        assert!(
            normalize_avatar_image(&vec![0u8; MAX_AVATAR_SOURCE_BYTES + 1])
                .expect_err("too large")
                .contains("AGENT_AVATAR_TOO_LARGE")
        );
    }

    #[test]
    fn image_summary_never_exposes_the_data_url() {
        let avatar = AgentAvatar::image("data:image/png;base64,AAAA");
        let summary = avatar.summary().to_string();
        assert!(summary.contains("\"kind\":\"image\""));
        assert!(!summary.contains("data:"));
    }
}
