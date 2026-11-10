//! Backend localization for user-facing messages.
//!
//! The language is process-global in production (the desktop app serves one
//! user) and thread-local under `cfg(test)` so the existing pt-BR assertions
//! stay stable without racing when tests run in parallel.
//!
//! English is the fallback catalog. Catalogs are flat JSON objects keyed by
//! dotted paths (`"approvals.allowOnce"`); interpolation uses `{name}`.
//! Model-facing prompts/tool content are intentionally not routed here.

use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};

use chrono::TimeZone;

/// Language served when the persisted setting is absent/invalid.
pub const DEFAULT_LANGUAGE: &str = "en";

pub struct LanguageMeta {
    pub code: &'static str,
    pub prompt_name: &'static str,
    pub date_pattern: &'static str,
    pub accept_language: &'static str,
}

pub const LANGUAGES: &[LanguageMeta] = &[
    LanguageMeta {
        code: "en",
        prompt_name: "English",
        date_pattern: "%m/%d/%Y %H:%M",
        accept_language: "en;q=0.9,pt;q=0.5",
    },
    LanguageMeta {
        code: "pt-BR",
        prompt_name: "Brazilian Portuguese",
        date_pattern: "%d/%m/%Y %H:%M",
        accept_language: "pt-BR,pt;q=0.9,en;q=0.8",
    },
    LanguageMeta {
        code: "es",
        prompt_name: "Spanish",
        date_pattern: "%d/%m/%Y %H:%M",
        accept_language: "es;q=0.9,en;q=0.5",
    },
];

pub fn supported_languages() -> impl Iterator<Item = &'static str> {
    LANGUAGES.iter().map(|meta| meta.code)
}

pub fn is_supported(code: &str) -> bool {
    LANGUAGES.iter().any(|meta| meta.code == code)
}

/// Supported locale or the English fallback. Never panics.
pub fn normalize_language(code: &str) -> &'static str {
    LANGUAGES
        .iter()
        .find(|meta| meta.code == code)
        .map(|meta| meta.code)
        .unwrap_or(DEFAULT_LANGUAGE)
}

pub fn language_meta(code: &str) -> &'static LanguageMeta {
    let normalized = normalize_language(code);
    LANGUAGES
        .iter()
        .find(|meta| meta.code == normalized)
        .unwrap_or(&LANGUAGES[0])
}

static PRODUCTION_LANGUAGE: LazyLock<RwLock<&'static str>> =
    LazyLock::new(|| RwLock::new(DEFAULT_LANGUAGE));

#[cfg(test)]
thread_local! {
    static TEST_LANGUAGE: std::cell::Cell<&'static str> =
        const { std::cell::Cell::new("pt-BR") };
}

pub fn set_language(code: &str) {
    let normalized = normalize_language(code);
    #[cfg(test)]
    TEST_LANGUAGE.with(|cell| cell.set(normalized));
    #[cfg(not(test))]
    {
        *PRODUCTION_LANGUAGE
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = normalized;
    }
}

pub fn language() -> &'static str {
    #[cfg(test)]
    {
        TEST_LANGUAGE.with(|cell| cell.get())
    }
    #[cfg(not(test))]
    {
        *PRODUCTION_LANGUAGE
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub fn prompt_name() -> &'static str {
    language_meta(language()).prompt_name
}

pub fn accept_language() -> &'static str {
    language_meta(language()).accept_language
}

fn parse_catalog(raw: &str) -> HashMap<String, String> {
    serde_json::from_str::<HashMap<String, String>>(raw).unwrap_or_else(|error| {
        eprintln!("zylara: catálogo de i18n inválido: {error}");
        HashMap::new()
    })
}

fn parse_catalogs(raws: &[&str]) -> HashMap<String, String> {
    let mut merged = HashMap::new();
    for raw in raws {
        merged.extend(parse_catalog(raw));
    }
    merged
}

static EN_CATALOG: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
    parse_catalogs(&[
        include_str!("../locales/en.json"),
        include_str!("../locales/en/tools.json"),
    ])
});
static PT_CATALOG: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
    parse_catalogs(&[
        include_str!("../locales/pt-BR.json"),
        include_str!("../locales/pt-BR/tools.json"),
    ])
});
static ES_CATALOG: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
    parse_catalogs(&[
        include_str!("../locales/es.json"),
        include_str!("../locales/es/tools.json"),
    ])
});

fn catalog(language: &str) -> &'static HashMap<String, String> {
    match normalize_language(language) {
        "pt-BR" => &PT_CATALOG,
        "es" => &ES_CATALOG,
        _ => &EN_CATALOG,
    }
}

fn interpolate(template: &str, args: &[(&str, &str)]) -> String {
    let mut out = template.to_string();
    for (name, value) in args {
        out = out.replace(&format!("{{{name}}}"), value);
    }
    out
}

/// Translates `key` for an explicit language (pure; used by tests and for
/// language lists such as default titles).
pub fn translate_for(language: &str, key: &str, args: &[(&str, &str)]) -> String {
    let template = catalog(language)
        .get(key)
        .or_else(|| EN_CATALOG.get(key))
        .map(String::as_str)
        .unwrap_or(key);
    interpolate(template, args)
}

pub fn t(key: &str) -> String {
    translate_for(language(), key, &[])
}

pub fn t_args(key: &str, args: &[(&str, &str)]) -> String {
    translate_for(language(), key, args)
}

/// Plural lookup with zero support: `key.zero` (count 0), `key.one` (1),
/// otherwise `key.other`; falls back to the base key when no variant exists.
pub fn t_count(key: &str, count: usize, args: &[(&str, &str)]) -> String {
    let variant = if count == 0 {
        format!("{key}.zero")
    } else if count == 1 {
        format!("{key}.one")
    } else {
        format!("{key}.other")
    };
    let selected = if catalog(language()).contains_key(&variant) {
        variant
    } else if catalog(language()).contains_key(&format!("{key}.other")) {
        format!("{key}.other")
    } else {
        key.to_string()
    };
    translate_for(language(), &selected, args)
}

pub fn format_datetime(ms: i64) -> String {
    let pattern = language_meta(language()).date_pattern;
    if let Some(moment) = chrono::Local.timestamp_millis_opt(ms).single() {
        return moment.format(pattern).to_string();
    }
    if let Some(moment) = chrono::Utc.timestamp_millis_opt(ms).single() {
        return moment.format(pattern).to_string();
    }
    "—".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(raw: &str) -> Vec<String> {
        let mut keys: Vec<String> = parse_catalog(raw).into_keys().collect();
        keys.sort();
        keys
    }

    #[test]
    fn catalogs_share_the_same_keys() {
        let en = keys(include_str!("../locales/en.json"));
        for raw in [
            include_str!("../locales/pt-BR.json"),
            include_str!("../locales/es.json"),
        ] {
            assert_eq!(en, keys(raw));
        }
    }

    #[test]
    fn catalogs_have_placeholders_matching_english() {
        fn placeholders(value: &str) -> Vec<String> {
            let mut out = Vec::new();
            let mut rest = value;
            while let Some(start) = rest.find('{') {
                let tail = &rest[start + 1..];
                let Some(end) = tail.find('}') else { break };
                out.push(tail[..end].to_string());
                rest = &tail[end + 1..];
            }
            out.sort();
            out
        }
        let en = parse_catalog(include_str!("../locales/en.json"));
        for (code, raw) in [
            ("pt-BR", include_str!("../locales/pt-BR.json")),
            ("es", include_str!("../locales/es.json")),
        ] {
            let catalog = parse_catalog(raw);
            for (key, value) in &en {
                assert_eq!(
                    placeholders(value),
                    placeholders(catalog.get(key).map(String::as_str).unwrap_or("")),
                    "{code}:{key}"
                );
            }
        }
    }

    #[test]
    fn default_language_is_english() {
        assert_eq!(DEFAULT_LANGUAGE, "en");
        assert_eq!(normalize_language("xx"), "en");
        assert_eq!(normalize_language("es"), "es");
        assert_eq!(normalize_language("pt-BR"), "pt-BR");
    }

    #[test]
    fn translates_with_fallback_and_interpolation() {
        assert_eq!(
            translate_for("en", "common.defaultConversationTitle", &[]),
            "New chat"
        );
        assert_eq!(
            translate_for("es", "common.defaultConversationTitle", &[]),
            "Nuevo chat"
        );
        assert_eq!(translate_for("xx", "missing.key", &[]), "missing.key");
    }

    #[test]
    fn formats_dates_per_language() {
        let value = 1_700_000_000_000;
        assert!(translate_for("en", "common.defaultConversationTitle", &[]).contains("New"));
        assert!(format_datetime(value).contains('/') || format_datetime(value).contains('-'));
    }
}
