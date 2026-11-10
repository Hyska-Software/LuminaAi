//! Web search tool.
//!
//! Bing's RSS endpoint is the primary engine (clean XML, no JavaScript and
//! rarely challenged); Bing HTML and DuckDuckGo HTML/lite are fallbacks because
//! DuckDuckGo sometimes answers bot challenges (HTTP 202 + "anomaly" page) to
//! non-browser TLS clients.

use std::time::Duration;

use base64::prelude::{Engine as _, BASE64_STANDARD};
use scraper::{ElementRef, Html};
use serde_json::{json, Value};

use crate::domain::Citation;
use crate::i18n;
use crate::providers::ToolDefinition;

use super::{
    citation_id, clean_inline, host_of, json_str, json_u32, selector, truncate_chars, ToolOutcome,
    ToolRuntime,
};

const MAX_RESULTS: usize = 8;
const MAX_SNIPPET_CHARS: usize = 500;
const MAX_DOWNLOAD_BYTES: usize = 3 * 1024 * 1024;

#[derive(Debug, Clone)]
struct SearchResult {
    title: String,
    url: String,
    snippet: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Engine {
    BingRss,
    Bing,
    DuckDuckGoHtml,
    DuckDuckGoLite,
}

impl Engine {
    fn name(self) -> &'static str {
        match self {
            Self::BingRss => "bing-rss",
            Self::Bing => "bing",
            Self::DuckDuckGoHtml => "duckduckgo-html",
            Self::DuckDuckGoLite => "duckduckgo-lite",
        }
    }
}

pub fn definition() -> ToolDefinition {
    ToolDefinition {
        name: "web_search".to_string(),
        description: "Search the web. Use it whenever the user asks about recent news, current \
                      facts, prices, people, documentation versions or anything that may have \
                      changed after your training data. Returns a JSON object with a list of \
                      results (title, url, snippet). Cite the URLs you use in your answer."
            .to_string(),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query, in the same language as the user's question."
                },
                "max_results": {
                    "type": "integer",
                    "description": "How many results to return (1-8). Defaults to 8.",
                    "minimum": 1,
                    "maximum": 8
                }
            },
            "required": ["query"],
            "additionalProperties": false
        }),
    }
}

pub async fn run(rt: &ToolRuntime, args: &Value) -> ToolOutcome {
    let query = match json_str(args, "query") {
        Some(query) if !query.trim().is_empty() => query.trim().to_string(),
        _ => return ToolOutcome::error(i18n::t("tools.web_search.queryRequired")),
    };
    let limit = json_u32(args, "max_results")
        .unwrap_or(MAX_RESULTS as u32)
        .clamp(1, MAX_RESULTS as u32) as usize;

    let (results, engine) = search(&rt.http, &query, limit).await;

    if results.is_empty() {
        let payload = json!({
            "query": query,
            "results": [],
            "note": i18n::t("tools.web_search.emptyNote")
        });
        return ToolOutcome {
            content: payload.to_string(),
            summary: Some(i18n::t_count("tools.web_search.summary", 0, &[])),
            presentation: Some(json!({ "kind": "search", "total": 0 })),
            ..Default::default()
        };
    }

    let citations: Vec<Citation> = results
        .iter()
        .map(|result| Citation {
            id: citation_id(&result.url),
            title: result.title.clone(),
            url: result.url.clone(),
            snippet: Some(result.snippet.clone()),
            site_name: host_of(&result.url),
        })
        .collect();

    let payload = json!({
        "query": query,
        "engine": engine,
        "results": results.iter().map(|result| json!({
            "title": result.title,
            "url": result.url,
            "snippet": result.snippet,
        })).collect::<Vec<_>>(),
    });

    ToolOutcome {
        content: payload.to_string(),
        summary: Some(i18n::t_count(
            "tools.web_search.summary",
            results.len(),
            &[("count", &results.len().to_string())],
        )),
        citations,
        presentation: Some(json!({ "kind": "search", "total": results.len() })),
        ..Default::default()
    }
}

/// Try every engine in order until one returns parseable results.
async fn search(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
) -> (Vec<SearchResult>, &'static str) {
    let encoded: String = url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
    let engines = [
        (
            Engine::BingRss,
            format!("https://www.bing.com/search?q={encoded}&format=rss"),
        ),
        (
            Engine::Bing,
            format!("https://www.bing.com/search?q={encoded}"),
        ),
        (
            Engine::DuckDuckGoHtml,
            format!("https://html.duckduckgo.com/html/?q={encoded}"),
        ),
        (
            Engine::DuckDuckGoLite,
            format!("https://lite.duckduckgo.com/lite/?q={encoded}"),
        ),
    ];

    for (engine, url) in engines {
        let html = match fetch_html(client, &url).await {
            Ok(html) => html,
            Err(_) => continue,
        };
        let results = match engine {
            Engine::BingRss => parse_bing_rss(&html, limit),
            Engine::Bing => parse_bing_results(&html, limit),
            Engine::DuckDuckGoHtml => parse_html_results(&html, limit),
            Engine::DuckDuckGoLite => parse_lite_results(&html, limit),
        };
        if !results.is_empty() {
            return (results, engine.name());
        }
    }
    (Vec::new(), "")
}

async fn fetch_html(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        )
        .header(
            reqwest::header::ACCEPT_LANGUAGE,
            i18n::accept_language(),
        )
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|error| {
            i18n::t_args("tools.web_search.requestFailed", &[("error", &error.to_string())])
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(i18n::t_args(
            "tools.web_search.httpStatus",
            &[("status", &status.to_string())],
        ));
    }
    if let Some(length) = response.content_length() {
        if length > MAX_DOWNLOAD_BYTES as u64 {
            return Err(i18n::t("tools.web_search.tooLarge"));
        }
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| {
            i18n::t_args("tools.web_search.readFailed", &[("error", &error.to_string())])
        })?;
    Ok(crate::documents::decode_text(&bytes, None))
}

/* ------------------------------------------------------------------ */
/* Bing RSS                                                            */
/* ------------------------------------------------------------------ */

/// Parses Bing's RSS search feed (`format=rss`), which is plain, stable XML.
fn parse_bing_rss(xml: &str, limit: usize) -> Vec<SearchResult> {
    let mut results = Vec::new();
    let mut rest = xml;
    while results.len() < limit {
        let Some(open) = rest.find("<item>").or_else(|| rest.find("<item ")) else {
            break;
        };
        let item_start = &rest[open..];
        let Some(close) = item_start.find("</item>") else {
            break;
        };
        let item = &item_start[..close];
        rest = &item_start[close + "</item>".len()..];

        let title = clean_inline(&strip_xml_markup(&xml_tag(item, "title")));
        let url = xml_tag(item, "link").trim().to_string();
        let snippet = truncate_chars(
            &clean_inline(&strip_xml_markup(&xml_tag(item, "description"))),
            MAX_SNIPPET_CHARS,
        );
        if title.is_empty() || !url.starts_with("http") {
            continue;
        }
        results.push(SearchResult { title, url, snippet });
    }
    results
}

fn xml_tag(xml: &str, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let Some(start) = xml.find(&open) else {
        return String::new();
    };
    let body = &xml[start + open.len()..];
    let Some(end) = body.find(&close) else {
        return String::new();
    };
    let raw = &body[..end];
    let raw = raw
        .strip_prefix("<![CDATA[")
        .and_then(|value| value.strip_suffix("]]>"))
        .unwrap_or(raw);
    raw.trim().to_string()
}

fn strip_xml_markup(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut inside_tag = false;
    for character in text.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => output.push(character),
            _ => {}
        }
    }
    decode_xml_entities(&output)
}

fn decode_xml_entities(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

/* ------------------------------------------------------------------ */
/* DuckDuckGo                                                          */
/* ------------------------------------------------------------------ */

fn parse_html_results(html: &str, limit: usize) -> Vec<SearchResult> {
    let document = Html::parse_document(html);
    let result_selector = match selector("div.result") {
        Some(selector) => selector,
        None => return Vec::new(),
    };
    let link_selector = match selector("a.result__a") {
        Some(selector) => selector,
        None => return Vec::new(),
    };
    let snippet_selector = selector(".result__snippet");

    let mut results = Vec::new();
    for block in document.select(&result_selector) {
        if results.len() >= limit {
            break;
        }
        let Some(link) = block.select(&link_selector).next() else {
            continue;
        };
        if let Some(result) = build_ddg_result(
            &link,
            snippet_selector
                .as_ref()
                .and_then(|selector| block.select(selector).next()),
        ) {
            results.push(result);
        }
    }

    // DuckDuckGo occasionally changes the wrapper markup; fall back to the
    // anchors themselves so the tool keeps working.
    if results.is_empty() {
        for link in document.select(&link_selector) {
            if results.len() >= limit {
                break;
            }
            if let Some(result) = build_ddg_result(&link, None) {
                results.push(result);
            }
        }
    }
    results
}

fn parse_lite_results(html: &str, limit: usize) -> Vec<SearchResult> {
    let document = Html::parse_document(html);
    let link_selector = match selector("a.result-link").or_else(|| selector("a[href]")) {
        Some(selector) => selector,
        None => return Vec::new(),
    };
    let snippet_selector = selector("td.result-snippet");

    let links: Vec<ElementRef<'_>> = document.select(&link_selector).collect();
    let snippets: Vec<String> = match snippet_selector {
        Some(selector) => document
            .select(&selector)
            .map(|element| clean_inline(&element.text().collect::<String>()))
            .collect(),
        None => Vec::new(),
    };

    let mut results = Vec::new();
    for (index, link) in links.iter().enumerate() {
        if results.len() >= limit {
            break;
        }
        let snippet = snippets.get(index).cloned().unwrap_or_default();
        if let Some(mut result) = build_ddg_result(link, None) {
            if result.snippet.is_empty() {
                result.snippet = truncate_chars(&snippet, MAX_SNIPPET_CHARS);
            }
            results.push(result);
        }
    }
    results
}

fn build_ddg_result(
    link: &ElementRef<'_>,
    snippet: Option<ElementRef<'_>>,
) -> Option<SearchResult> {
    let title = clean_inline(&link.text().collect::<String>());
    if title.is_empty() {
        return None;
    }
    let url = resolve_ddg_url(link.attr("href").unwrap_or_default())?;
    let snippet = snippet
        .map(|element| clean_inline(&element.text().collect::<String>()))
        .map(|text| truncate_chars(&text, MAX_SNIPPET_CHARS))
        .unwrap_or_default();
    Some(SearchResult {
        title: truncate_chars(&title, 240),
        url,
        snippet,
    })
}

/// Resolve a DuckDuckGo result href to the real destination URL.
fn resolve_ddg_url(href: &str) -> Option<String> {
    let href = href.trim();
    if href.is_empty() {
        return None;
    }
    if let Some(rest) = href.strip_prefix("//") {
        return resolve_ddg_url(&format!("https:{rest}"));
    }
    let parsed = if href.starts_with("http://") || href.starts_with("https://") {
        url::Url::parse(href).ok()?
    } else {
        url::Url::parse("https://duckduckgo.com").ok()?.join(href).ok()?
    };

    for (key, value) in parsed.query_pairs() {
        if key == "uddg" && !value.is_empty() {
            return Some(value.into_owned());
        }
    }
    match parsed.scheme() {
        "http" | "https" => Some(parsed.to_string()),
        _ => None,
    }
}

/* ------------------------------------------------------------------ */
/* Bing                                                                */
/* ------------------------------------------------------------------ */

fn parse_bing_results(html: &str, limit: usize) -> Vec<SearchResult> {
    let document = Html::parse_document(html);
    let result_selector = match selector("li.b_algo") {
        Some(selector) => selector,
        None => return Vec::new(),
    };
    let link_selector = selector("h2 a");
    let snippet_selector = selector(".b_caption p").or_else(|| selector(".b_caption"));

    let mut results = Vec::new();
    for block in document.select(&result_selector) {
        if results.len() >= limit {
            break;
        }
        let link = match link_selector.as_ref().and_then(|selector| block.select(selector).next()) {
            Some(link) => link,
            None => continue,
        };
        let title = clean_inline(&link.text().collect::<String>());
        if title.is_empty() {
            continue;
        }
        let Some(url) = resolve_bing_url(link.attr("href").unwrap_or_default()) else {
            continue;
        };
        let snippet = snippet_selector
            .as_ref()
            .and_then(|selector| block.select(selector).next())
            .map(|element| clean_inline(&element.text().collect::<String>()))
            .map(|text| truncate_chars(&text, MAX_SNIPPET_CHARS))
            .unwrap_or_default();
        results.push(SearchResult {
            title: truncate_chars(&title, 240),
            url,
            snippet,
        });
    }
    results
}

/// Bing wraps outbound links in `bing.com/ck/a?...&u=a1<base64url>`.
fn resolve_bing_url(href: &str) -> Option<String> {
    let href = href.trim();
    if href.is_empty() {
        return None;
    }
    if (href.starts_with("http://") || href.starts_with("https://"))
        && !href.contains("bing.com/ck/")
        && !href.contains("go.microsoft.com")
    {
        return Some(href.to_string());
    }
    let absolute = if let Some(rest) = href.strip_prefix("//") {
        format!("https:{rest}")
    } else if href.starts_with('/') {
        format!("https://www.bing.com{href}")
    } else {
        href.to_string()
    };
    let parsed = url::Url::parse(&absolute).ok()?;
    for (key, value) in parsed.query_pairs() {
        if key == "u" {
            let encoded = value.strip_prefix("a1").unwrap_or(&value);
            if let Some(decoded) = decode_base64_url(encoded) {
                if decoded.starts_with("http://") || decoded.starts_with("https://") {
                    return Some(decoded);
                }
            }
        }
    }
    if href.starts_with("http") {
        Some(href.to_string())
    } else {
        None
    }
}

fn decode_base64_url(encoded: &str) -> Option<String> {
    if encoded.is_empty() {
        return None;
    }
    let mut padded: String = encoded
        .chars()
        .map(|character| match character {
            '-' => '+',
            '_' => '/',
            other => other,
        })
        .collect();
    while padded.len() % 4 != 0 {
        padded.push('=');
    }
    let bytes = BASE64_STANDARD.decode(padded).ok()?;
    String::from_utf8(bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_ddg_redirect_links() {
        let href = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc&rut=abc";
        assert_eq!(
            resolve_ddg_url(href).as_deref(),
            Some("https://example.com/doc")
        );
        assert_eq!(
            resolve_ddg_url("/l/?uddg=https%3A%2F%2Frust-lang.org").as_deref(),
            Some("https://rust-lang.org")
        );
        assert_eq!(
            resolve_ddg_url("https://opencode.ai/docs").as_deref(),
            Some("https://opencode.ai/docs")
        );
        assert_eq!(resolve_ddg_url("javascript:void(0)"), None);
    }

    #[test]
    fn resolves_bing_redirect_links() {
        // "https://example.com/x" base64url = aHR0cHM6Ly9leGFtcGxlLmNvbS94
        let href =
            "https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS94&ntb=1";
        assert_eq!(
            resolve_bing_url(href).as_deref(),
            Some("https://example.com/x")
        );
        assert_eq!(
            resolve_bing_url("https://example.com/direct").as_deref(),
            Some("https://example.com/direct")
        );
    }

    #[test]
    fn parses_html_results() {
        let html = r##"
        <div class="result results_links">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Exemplo A</a>
          </h2>
          <a class="result__snippet">Primeiro <b>snippet</b>.</a>
        </div>
        <div class="result">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Exemplo B</a>
          <div class="result__snippet">Segundo snippet.</div>
        </div>"##;
        let results = parse_html_results(html, 8);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Exemplo A");
        assert_eq!(results[0].url, "https://example.com/a");
        assert!(results[0].snippet.contains("snippet"));
        assert_eq!(results[1].url, "https://example.com/b");
    }

    #[test]
    fn parses_lite_results() {
        let html = r##"
        <table>
          <tr><td><a class="result-link" href="https://example.com/lite">Lite A</a></td></tr>
          <tr><td class="result-snippet">Snippet lite.</td></tr>
        </table>"##;
        let results = parse_lite_results(html, 8);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Lite A");
        assert_eq!(results[0].snippet, "Snippet lite.");
    }

    #[test]
    fn parses_bing_rss_items() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?><rss><channel>
            <item><title>Tauri 2.12 released</title><link>https://tauri.app/blog/tauri-2-12/</link>
            <description><![CDATA[<p>Announcing **Tauri 2.12** with fixes &amp; more</p>]]></description></item>
            <item><title>Missing link</title><link></link><description>x</description></item>
        </channel></rss>"#;
        let results = parse_bing_rss(xml, 8);
        assert_eq!(results.len(), 1, "only items with an http link are kept");
        assert_eq!(results[0].url, "https://tauri.app/blog/tauri-2-12/");
        assert!(results[0].title.contains("Tauri 2.12"));
        assert!(!results[0].snippet.contains('<'));
        assert!(results[0].snippet.contains("Tauri 2.12"));
    }

    #[test]
    fn parses_bing_results() {
        let html = r##"
        <ol id="b_results">
          <li class="b_algo">
            <h2><a href="https://example.com/bing">Resultado Bing</a></h2>
            <div class="b_caption"><p>Descrição do resultado.</p></div>
          </li>
        </ol>"##;
        let results = parse_bing_results(html, 8);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Resultado Bing");
        assert_eq!(results[0].url, "https://example.com/bing");
        assert!(results[0].snippet.contains("Descrição"));
    }

    #[tokio::test]
    #[ignore = "live network access"]
    async fn live_search_parses_results() {
        let client = crate::http::search_client();
        let (results, engine) = search(&client, "tauri 2", 5).await;
        assert!(!results.is_empty(), "no results parsed (engine {engine})");
        assert!(!engine.is_empty());
        assert!(results.iter().all(|result| result.url.starts_with("http")));
        assert!(results.iter().all(|result| !result.title.is_empty()));
    }
}
