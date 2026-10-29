//! Bench de cache ponta-a-ponta (F6.3-fix/B1, PLAN §9.3).
//!
//! - **sintético** (não-ignored): provider fake simula o cache de prefixo por
//!   120 requests e valida o pipeline `cache_stats`/steady sem rede;
//! - **live** (`#[ignore]`): roda `run_turn` real contra o gateway
//!   anthropic/haiku por >=10 turnos, grava o JSON bruto em
//!   `docs/goals/prompt-cache/evidence/bench-e2e-live-<data>.json` e compara com
//!   um baseline (mesmo benchmark com catálogo **sem** `cache`).
//!
//! Gate: `cargo test --lib cache_bench -- --ignored` encontra o teste live
//! (`cache_bench_e2e_live`); sem credencial/fixture ele imprime skip e retorna.

use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::db::Db;
use crate::domain::{CacheSample, Conversation, Settings, TurnOptions, TurnPayload, TurnProfile};
use crate::events::TurnEvent;
use crate::harness::ProviderStreamer;
use crate::harness::{EventEmitter, HarnessDeps};
use crate::providers::{CompletionRequest, ProviderEvent};
use tokio_util::sync::CancellationToken;

const EVIDENCE_DIR: &str = "docs/goals/prompt-cache/evidence";
const SYNTHETIC_REQUESTS: usize = 120;
const SYNTHETIC_STEPS_PER_TURN: u32 = 10;
const TARGET_STEADY_HIT: f64 = 95.0;
const HARD_FLOOR_STEADY_HIT: f64 = 90.0;
const STEADY_CEILING: f32 = 98.0;

/// Fixture `bench-fixture.json` (Lead). Campos extras são ignorados.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchFixture {
    pub provider_id: String,
    pub model_id: String,
    /// Um texto de usuário por turno; o bench roda um turno por item.
    pub turns: Vec<String>,
}

/// Coletor de amostras por request a partir dos `TurnEvent::CacheStats`.
#[derive(Clone, Default)]
pub struct CacheBenchCollector {
    pub samples: Arc<Mutex<Vec<CacheSample>>>,
}

impl EventEmitter for CacheBenchCollector {
    fn emit(&self, event: TurnEvent) {
        if let TurnEvent::CacheStats { sample } = event {
            if let Ok(mut samples) = self.samples.lock() {
                samples.push(sample);
            }
        }
    }
}

/// Métricas steady/hard de uma lista de amostras.
#[derive(Debug, Clone, Default)]
pub struct BenchMetrics {
    pub requests: usize,
    pub steady_requests: usize,
    pub steady_mean_hit: Option<f64>,
    pub all_mean_hit: Option<f64>,
    pub min_steady_hit: Option<f32>,
}

pub fn metrics(samples: &[CacheSample]) -> BenchMetrics {
    let hits: Vec<f32> = samples
        .iter()
        .filter_map(|sample| sample.hit_percent)
        .collect();
    let all_mean_hit = mean(&hits);
    // "Steady": requests >=3º da conversa, ceiling conhecido >= 98% e existe
    // hit reportado (cold/compaction/not-reported ficam fora).
    let steady: Vec<f32> = samples
        .iter()
        .enumerate()
        .filter(|(index, sample)| {
            *index >= 2
                && sample
                    .ceiling_percent
                    .is_some_and(|ceiling| ceiling >= STEADY_CEILING)
        })
        .filter_map(|(_, sample)| sample.hit_percent)
        .collect();
    BenchMetrics {
        requests: samples.len(),
        steady_requests: steady.len(),
        steady_mean_hit: mean(&steady),
        all_mean_hit,
        min_steady_hit: steady.iter().copied().reduce(f32::min),
    }
}

fn mean(values: &[f32]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    Some(values.iter().map(|value| f64::from(*value)).sum::<f64>() / values.len() as f64)
}

fn workspace_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_default()
}

fn fixture_paths() -> [std::path::PathBuf; 2] {
    let root = workspace_root().join("docs/goals/prompt-cache");
    [
        root.join("evidence/bench-fixture.json"),
        root.join("bench-fixture.json"),
    ]
}

fn load_fixture() -> anyhow::Result<Option<BenchFixture>> {
    for path in fixture_paths() {
        if !path.is_file() {
            continue;
        }
        let raw = std::fs::read_to_string(&path)?;
        let fixture: BenchFixture = serde_json::from_str(&raw)?;
        if fixture.turns.len() < 10 {
            anyhow::bail!(
                "bench-fixture.json precisa de >=10 turnos (tem {})",
                fixture.turns.len()
            );
        }
        return Ok(Some(fixture));
    }
    Ok(None)
}

fn benchmark_payload(
    conversation: &Conversation,
    provider_id: &str,
    model_id: &str,
    content: &str,
) -> TurnPayload {
    TurnPayload {
        conversation_id: conversation.id.clone(),
        content: content.to_string(),
        attachment_ids: Vec::new(),
        provider_id: provider_id.to_string(),
        model_id: model_id.to_string(),
        reasoning: None,
        options: TurnOptions::default(),
        profile: TurnProfile::Chat,
        turn_id: None,
    }
}

async fn run_fixture(
    deps: HarnessDeps,
    provider_id: &str,
    model_id: &str,
    fixture: &BenchFixture,
    settings: Settings,
) -> anyhow::Result<Vec<CacheSample>> {
    let conversation = deps
        .db
        .create_conversation("Cache bench", provider_id, model_id)?;
    let collector = CacheBenchCollector::default();
    let emitter: Arc<dyn EventEmitter> = Arc::new(collector.clone());
    for (index, turn) in fixture.turns.iter().enumerate() {
        let payload = benchmark_payload(&conversation, provider_id, model_id, turn);
        crate::harness::run_turn(
            deps.clone(),
            payload,
            settings.clone(),
            emitter.clone(),
            CancellationToken::new(),
        )
        .await
        .with_context_turn(index)?;
    }
    let samples = collector
        .samples
        .lock()
        .map(|samples| samples.clone())
        .unwrap_or_default();
    Ok(samples)
}

trait WithTurnContext<T> {
    fn with_context_turn(self, index: usize) -> anyhow::Result<T>;
}

impl<T> WithTurnContext<T> for anyhow::Result<T> {
    fn with_context_turn(self, index: usize) -> anyhow::Result<T> {
        self.map_err(|error| anyhow::anyhow!("bench turno {}: {error:#}", index + 1))
    }
}

/// Baseline: mesmo catálogo, mas **sem** `provider.cache`/`model.cache` (o
/// harness então não planeja cache explícito — `plan=None`; mede-se o hit real
/// do gateway sem plano).
fn catalog_without_cache(catalog: &crate::catalog::CatalogFile) -> crate::catalog::CatalogFile {
    let mut catalog = catalog.clone();
    for provider in &mut catalog.providers {
        provider.cache = None;
        for model in &mut provider.models {
            model.cache = None;
        }
    }
    catalog
}

fn write_evidence(artifact: &Value) -> anyhow::Result<std::path::PathBuf> {
    let directory = workspace_root().join(EVIDENCE_DIR);
    std::fs::create_dir_all(&directory)?;
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let path = directory.join(format!("bench-e2e-live-{date}.json"));
    std::fs::write(&path, serde_json::to_vec_pretty(artifact)?)?;
    Ok(path)
}

fn print_metrics(label: &str, fixture: &BenchFixture, metrics: &BenchMetrics) {
    eprintln!(
        "lumina bench {label} ({} / {}): requests={} steady={} hit_steady={:?}% hit_all={:?}% min_steady={:?}%",
        fixture.provider_id,
        fixture.model_id,
        metrics.requests,
        metrics.steady_requests,
        metrics
            .steady_mean_hit
            .map(|value| (value * 10.0).round() / 10.0),
        metrics
            .all_mean_hit
            .map(|value| (value * 10.0).round() / 10.0),
        metrics.min_steady_hit,
    );
}

/* ------------------------------------------------------------------ */
/* Bench live (gateway)                                                */
/* ------------------------------------------------------------------ */

/// Bench E2E **live**: `run_turn` real contra o gateway anthropic/haiku por
/// >=10 turnos + baseline sem catálogo de cache. Grava o JSON bruto e falha se o
/// steady ficar abaixo do alvo (hard floor 90%).
#[tokio::test]
#[ignore = "live gateway: requer OPENCODE_API_KEY/auth.json e bench-fixture.json; rodar com --ignored"]
async fn cache_bench_e2e_live() {
    let Some(fixture) = load_fixture().unwrap_or_else(|error| {
        eprintln!("lumina bench: fixture inválida: {error:#}");
        None
    }) else {
        eprintln!(
            "lumina bench: bench-fixture.json ausente (esperado em {}); skip.",
            fixture_paths()[0].display()
        );
        return;
    };
    let catalog = crate::catalog::CatalogFile::load().expect("catálogo bundled");
    let provider = catalog.provider(&fixture.provider_id).cloned();
    let Some(provider) = provider else {
        eprintln!(
            "lumina bench: provedor `{}` não está no catálogo; skip.",
            fixture.provider_id
        );
        return;
    };
    let Some(model) = catalog
        .model(&fixture.provider_id, &fixture.model_id)
        .cloned()
    else {
        eprintln!(
            "lumina bench: modelo `{}` do provedor `{}` ausente; skip.",
            fixture.model_id, fixture.provider_id
        );
        return;
    };
    if model
        .protocols
        .iter()
        .all(|protocol| protocol != "anthropic")
    {
        eprintln!(
            "lumina bench: modelo `{}` não usa o protocolo anthropic; skip.",
            fixture.model_id
        );
        return;
    }

    let temp_dir =
        std::env::temp_dir().join(format!("lumina-cache-bench-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir).expect("criar data_dir do bench");
    let db_path = temp_dir.join("bench.db");
    let db = Arc::new(Db::open(&db_path).expect("abrir DB do bench"));
    let base_deps = HarnessDeps {
        app: None,
        db: db.clone(),
        http: reqwest::Client::new(),
        search_http: reqwest::Client::new(),
        catalog: catalog.clone(),
        streamer: None,
        credential_override: None,
        refresh_override: None,
        model_source: None,
        api_key_override: None,
        data_dir: Some(temp_dir.clone()),
        skills_roots: Some(Vec::new()),
        approvals: None,
        observed: None,
        jobs: None,
        questions: None,
        mcp: None,
    };
    // Skip gracioso sem credencial utilizável.
    if let Err(error) = crate::harness::resolve_credential(&base_deps, &provider).await {
        eprintln!(
            "lumina bench: sem credencial para {} ({error}); skip.",
            provider.id
        );
        return;
    }

    let settings = Settings::default();
    let steady = run_fixture(
        base_deps.clone(),
        &fixture.provider_id,
        &fixture.model_id,
        &fixture,
        settings.clone(),
    )
    .await
    .expect("bench live");
    let steady_metrics = metrics(&steady);
    print_metrics("live", &fixture, &steady_metrics);

    // Baseline: catálogo sem cache → sem plano explícito; mede o hit real.
    let mut baseline_deps = base_deps.clone();
    baseline_deps.catalog = catalog_without_cache(&catalog);
    let baseline = run_fixture(
        baseline_deps,
        &fixture.provider_id,
        &fixture.model_id,
        &fixture,
        settings,
    )
    .await
    .expect("bench baseline");
    let baseline_metrics = metrics(&baseline);
    print_metrics("baseline", &fixture, &baseline_metrics);
    eprintln!(
        "lumina bench: baseline sem catálogo cache (plan None) — hit steady {:?}%",
        baseline_metrics.steady_mean_hit
    );

    let artifact = json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "fixture": fixture_paths()[0].display().to_string(),
        "providerId": fixture.provider_id,
        "modelId": fixture.model_id,
        "turns": fixture.turns.len(),
        "steady": {
            "requests": steady_metrics.requests,
            "steadyRequests": steady_metrics.steady_requests,
            "steadyMeanHit": steady_metrics.steady_mean_hit,
            "allMeanHit": steady_metrics.all_mean_hit,
            "minSteadyHit": steady_metrics.min_steady_hit,
            "targetHit": TARGET_STEADY_HIT,
            "hardFloorHit": HARD_FLOOR_STEADY_HIT,
        },
        "baseline": {
            "plan": "none (catálogo sem cache)",
            "requests": baseline_metrics.requests,
            "steadyMeanHit": baseline_metrics.steady_mean_hit,
            "allMeanHit": baseline_metrics.all_mean_hit,
        },
        "samples": steady.iter().map(|sample| json!({
            "turnId": sample.turn_id,
            "step": sample.step,
            "protocol": sample.protocol,
            "epoch": sample.epoch,
            "hitPercent": sample.hit_percent,
            "ceilingPercent": sample.ceiling_percent,
            "state": sample.state,
            "eligible": sample.eligible,
            "rawUsage": sample.raw_usage,
        })).collect::<Vec<_>>(),
    });
    match write_evidence(&artifact) {
        Ok(path) => eprintln!("lumina bench: evidência gravada em {}", path.display()),
        Err(error) => eprintln!("lumina bench: falha ao gravar evidência: {error:#}"),
    }

    if steady_metrics.steady_requests == 0 {
        panic!("bench live sem requests steady (ceiling >=98%) — resultado inválido");
    }
    let steady_hit = steady_metrics
        .steady_mean_hit
        .expect("bench live sem hit steady");
    assert!(
        steady_hit >= HARD_FLOOR_STEADY_HIT,
        "steady hit {steady_hit:.1}% abaixo do hard floor {HARD_FLOOR_STEADY_HIT}%"
    );
    assert!(
        steady_hit >= TARGET_STEADY_HIT,
        "steady hit {steady_hit:.1}% abaixo da meta {TARGET_STEADY_HIT}%"
    );
}

/* ------------------------------------------------------------------ */
/* Bench sintético (sempre roda)                                       */
/* ------------------------------------------------------------------ */

/// Provider fake que simula o cache de prefixo do provedor: `cache_read` é
/// derivado do prefixo comum com o request anterior (como o provedor faria).
fn synthetic_streamer() -> ProviderStreamer {
    let previous: Arc<Mutex<Option<crate::domain::PrefixDigest>>> = Arc::new(Mutex::new(None));
    let counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    Arc::new(move |request: CompletionRequest, sink| {
        let digest = request_digest(&request);
        let common_chars = previous
            .lock()
            .ok()
            .and_then(|guard| {
                guard
                    .as_ref()
                    .map(|prev| digest.chars_up_to(digest.common_prefix_segments(prev)))
            })
            .unwrap_or(0);
        let cached = u32::try_from(common_chars / 4)
            .unwrap_or(u32::MAX)
            .min(1_000);
        let usage = crate::domain::UsageInfo {
            input_tokens: Some(1_000),
            cached_tokens: Some(cached),
            cache_read_tokens: Some(cached),
            uncached_input_tokens: Some(1_000 - cached),
            cache_reported: true,
            ..Default::default()
        };
        if let Ok(mut guard) = previous.lock() {
            *guard = Some(digest.clone());
        }
        let index = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let final_step =
            index % SYNTHETIC_STEPS_PER_TURN as usize == SYNTHETIC_STEPS_PER_TURN as usize - 1;
        Box::pin(async move {
            emit_event(&sink, ProviderEvent::CacheDigest(digest));
            emit_event(&sink, ProviderEvent::Usage(usage));
            if final_step {
                emit_event(
                    &sink,
                    ProviderEvent::TextDelta("Resposta final do bench.".to_string()),
                );
                emit_event(&sink, ProviderEvent::Done);
            } else {
                emit_event(
                    &sink,
                    ProviderEvent::ToolCallStart {
                        index: 0,
                        id: format!("call-{index}"),
                        name: "bench_tool_inexistente".to_string(),
                    },
                );
                emit_event(
                    &sink,
                    ProviderEvent::ToolCallArgsDelta {
                        index: 0,
                        delta: "{}".to_string(),
                    },
                );
                emit_event(&sink, ProviderEvent::Done);
            }
            Ok(())
        })
    })
}

/// 120 requests sintéticos com cache de prefixo simulado (sem rede): valida o
/// pipeline `cache_stats` + steady e que o tracker não mostra quebra.
#[tokio::test]
async fn cache_bench_synthetic_120_requests_steady_state() {
    let temp = TempDbBench::new();
    let conversation = temp
        .db
        .create_conversation("Bench sintético", "opencode-go", "deepseek-v4.1-flash")
        .expect("conversa do bench");
    let collector = CacheBenchCollector::default();
    let emitter: Arc<dyn EventEmitter> = Arc::new(collector.clone());
    let turns = SYNTHETIC_REQUESTS / SYNTHETIC_STEPS_PER_TURN as usize;
    let deps = synthetic_deps(temp.db.clone());
    for turn in 0..turns {
        let payload = benchmark_payload(
            &conversation,
            "opencode-go",
            "deepseek-v4.1-flash",
            &format!("Pedido sintético {turn}"),
        );
        crate::harness::run_turn(
            deps.clone(),
            payload,
            Settings::default(),
            emitter.clone(),
            CancellationToken::new(),
        )
        .await
        .expect("turno sintético do bench");
    }
    let samples = collector
        .samples
        .lock()
        .map(|samples| samples.clone())
        .unwrap_or_default();
    assert_eq!(
        samples.len(),
        SYNTHETIC_REQUESTS,
        "um cache_stats por request de wire"
    );
    let metrics = metrics(&samples);
    eprintln!(
        "cache_bench synthetic: requests={} steady={} hit_steady={:?}%",
        metrics.requests, metrics.steady_requests, metrics.steady_mean_hit
    );
    assert!(
        metrics.steady_requests >= SYNTHETIC_REQUESTS - 12,
        "quase todos os requests devem ser steady: {:?}",
        metrics
    );
    let steady_hit = metrics.steady_mean_hit.expect("steady hit do bench");
    assert!(
        steady_hit >= HARD_FLOOR_STEADY_HIT,
        "steady hit {steady_hit:.1}% abaixo do hard floor"
    );
    assert!(
        steady_hit >= TARGET_STEADY_HIT,
        "steady hit {steady_hit:.1}% abaixo da meta {TARGET_STEADY_HIT}%"
    );
    // Pipeline do evento: tracker em epoch 1, sem quebra espúria depois do 1º.
    assert!(samples.iter().all(|sample| sample.epoch == 1));
    assert!(samples
        .iter()
        .skip(1)
        .all(|sample| sample.break_reason.is_none()));
}

struct TempDbBench {
    db: Arc<Db>,
    path: std::path::PathBuf,
}

impl TempDbBench {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "lumina-cache-bench-synthetic-{}.db",
            uuid::Uuid::new_v4()
        ));
        let db = Arc::new(Db::open(&path).expect("abrir DB do bench"));
        Self { db, path }
    }
}

impl Drop for TempDbBench {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", self.path.display()));
        }
    }
}

fn synthetic_deps(db: Arc<Db>) -> HarnessDeps {
    let temp_dir =
        std::env::temp_dir().join(format!("lumina-cache-bench-data-{}", uuid::Uuid::new_v4()));
    let _ = std::fs::create_dir_all(&temp_dir);
    HarnessDeps {
        app: None,
        db,
        http: reqwest::Client::new(),
        search_http: reqwest::Client::new(),
        catalog: crate::catalog::CatalogFile::load().expect("catálogo bundled"),
        streamer: Some(synthetic_streamer()),
        credential_override: None,
        refresh_override: None,
        model_source: None,
        api_key_override: Some("bench-key".to_string()),
        data_dir: Some(temp_dir),
        skills_roots: Some(Vec::new()),
        approvals: None,
        observed: None,
        jobs: None,
        questions: None,
        mcp: None,
    }
}

fn emit_event(sink: &crate::providers::EventSink, event: ProviderEvent) {
    let _ = sink.send(event);
}

/// Digest do prefixo de um request (mesmo formato do provider fake dos testes):
/// system → tools → histórico, com SHA-256 encadeado por segmento.
fn request_digest(request: &CompletionRequest) -> crate::domain::PrefixDigest {
    use crate::domain::{PrefixDigest, SegmentDigest, SegmentKind};
    use sha2::{Digest, Sha256};

    let mut segments: Vec<SegmentDigest> = Vec::new();
    let mut chain: Option<[u8; 32]> = None;
    let mut push = |kind: SegmentKind, text: String, segments: &mut Vec<SegmentDigest>| {
        let mut hasher = Sha256::new();
        if let Some(previous) = chain {
            hasher.update(previous);
        }
        hasher.update(text.as_bytes());
        let mut sha = [0u8; 32];
        sha.copy_from_slice(&hasher.finalize());
        let chars = u32::try_from(text.chars().count()).unwrap_or(u32::MAX);
        segments.push(SegmentDigest {
            kind,
            index: u32::try_from(segments.len()).unwrap_or(u32::MAX),
            sha256: sha,
            chars,
        });
        chain = Some(sha);
    };
    push(
        SegmentKind::System,
        format!("system:{}", request.system_prompt),
        &mut segments,
    );
    let tools = request
        .tools
        .iter()
        .map(|tool| format!("{}:{}:{}", tool.name, tool.description, tool.parameters))
        .collect::<Vec<_>>()
        .join("\n");
    push(SegmentKind::Tools, format!("tools:{tools}"), &mut segments);
    for message in &request.history {
        let mut canonical = format!("{:?}:{}", message.role, message.text);
        if let Some(tool_call_id) = &message.tool_call_id {
            canonical.push_str(tool_call_id);
        }
        for call in &message.tool_calls {
            canonical.push_str(&format!("{}:{}:{}", call.id, call.name, call.arguments));
        }
        push(SegmentKind::Message, canonical, &mut segments);
    }
    let total_chars = segments
        .iter()
        .map(|segment| segment.chars)
        .fold(0u32, u32::saturating_add);
    PrefixDigest {
        protocol: "openai-chat".to_string(),
        segments,
        total_chars,
        estimated_tokens: total_chars / 4,
    }
}
