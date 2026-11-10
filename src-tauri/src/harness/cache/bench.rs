//! Bench de cache ponta-a-ponta (F6.3-fix/B1, PLAN §9.3).
//!
//! - **sintético** (não-ignored): provider fake simula o cache de prefixo por
//!   120 requests e valida o pipeline `cache_stats`/steady sem rede;
//! - **live** (`#[ignore]`): roda `run_turn` real contra o gateway
//!   anthropic/haiku por >=10 turnos, grava o JSON bruto num artifact **único
//!   por run** em `docs/goals/prompt-cache/evidence/bench-e2e-live-<data>T<HHMMSS>.json`
//!   e compara com um baseline (mesmo benchmark com catálogo **sem** `cache`).
//!
//! Estatísticas: média, mínimo e percentis **p50/p10** dos hits por request
//! (por run; com `ZYLARA_BENCH_REPETITIONS>1` os hits de todas as runs são
//! agregados antes dos percentis). Gate live: target 98%, hard floor 95%.
//!
//! Gate: `cargo test --lib cache_bench -- --ignored` encontra o teste live
//! (`cache_bench_e2e_live`); sem credencial/fixture ele grava um artifact de
//! `{skipped:true, reason, at}` e retorna sem falhar o CI.

use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::db::Db;
use crate::domain::{
    CacheSample, Conversation, PrefixDigest, SegmentDigest, SegmentKind, Settings, TurnOptions,
    TurnPayload, TurnProfile, UsageInfo,
};
use crate::events::TurnEvent;
use crate::harness::{EventEmitter, HarnessDeps, ProviderStreamer};
use crate::providers::{CompletionRequest, ProviderEvent};
use tokio_util::sync::CancellationToken;

const EVIDENCE_DIR: &str = "docs/goals/prompt-cache/evidence";
const SYNTHETIC_REQUESTS: usize = 120;
const SYNTHETIC_STEPS_PER_TURN: u32 = 10;
const TARGET_STEADY_HIT: f64 = 98.0;
const HARD_FLOOR_STEADY_HIT: f64 = 95.0;
const STEADY_CEILING: f32 = 98.0;
/// Repetições run-level do cenário live (PLAN §2.4/fixture `repetitions`).
/// Default 1 para não onerar a execução; `ZYLARA_BENCH_REPETITIONS=5` reproduz
/// o protocolo p50/p10 de N runs. Cada run usa DB/conversa novas.
const REPETITIONS_ENV: &str = "ZYLARA_BENCH_REPETITIONS";

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

/// Métricas steady/hard de uma lista de amostras (por request).
#[derive(Debug, Clone, Default)]
pub struct BenchMetrics {
    pub requests: usize,
    pub steady_requests: usize,
    pub steady_mean_hit: Option<f64>,
    pub all_mean_hit: Option<f64>,
    pub min_steady_hit: Option<f32>,
    pub steady_p50_hit: Option<f32>,
    pub steady_p10_hit: Option<f32>,
    pub all_p50_hit: Option<f32>,
    pub all_p10_hit: Option<f32>,
    /// Write de cache da **1ª amostra** do run (cold-start: deve ser >0).
    pub cold_write_tokens: u32,
    /// Hit% do **1º request** do run (cold-start: deve ser ≈0).
    pub first_request_hit: Option<f32>,
    /// Lifecycle: `Σ cache_read / Σ input_total` do run inteiro (inclui o cold).
    pub lifecycle_hit: Option<f64>,
    /// Totais usados para agregar o lifecycle de N runs.
    pub lifecycle_read: u64,
    pub lifecycle_input: u64,
    /// Hits por request (steady/all) — usados para agregar N runs.
    pub steady_hits: Vec<f32>,
    pub all_hits: Vec<f32>,
}

pub fn metrics(samples: &[CacheSample]) -> BenchMetrics {
    let all_hits: Vec<f32> = samples
        .iter()
        .filter_map(|sample| sample.hit_percent)
        .collect();
    let all_mean_hit = mean(&all_hits);
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
    let lifecycle_read: u64 = samples
        .iter()
        .map(|sample| u64::from(sample.cache_read))
        .sum();
    let lifecycle_input: u64 = samples
        .iter()
        .map(|sample| u64::from(sample.input_total))
        .sum();
    let lifecycle_hit = if lifecycle_input == 0 {
        None
    } else {
        Some(lifecycle_read as f64 / lifecycle_input as f64 * 100.0)
    };
    let first = samples.first();
    BenchMetrics {
        requests: samples.len(),
        steady_requests: steady.len(),
        steady_mean_hit: mean(&steady),
        all_mean_hit,
        min_steady_hit: steady.iter().copied().reduce(f32::min),
        steady_p50_hit: percentile(&steady, 50.0),
        steady_p10_hit: percentile(&steady, 10.0),
        all_p50_hit: percentile(&all_hits, 50.0),
        all_p10_hit: percentile(&all_hits, 10.0),
        cold_write_tokens: first.map_or(0, |sample| sample.cache_write),
        first_request_hit: first.and_then(|sample| sample.hit_percent),
        lifecycle_hit,
        lifecycle_read,
        lifecycle_input,
        steady_hits: steady,
        all_hits,
    }
}

/// Agrega métricas de N runs (`ZYLARA_BENCH_REPETITIONS`): percentis sobre todos
/// os hits steady de todas as runs; requests/steady somados.
pub fn aggregate_metrics(runs: &[BenchMetrics]) -> BenchMetrics {
    let steady_hits: Vec<f32> = runs
        .iter()
        .flat_map(|run| run.steady_hits.clone())
        .collect();
    let all_hits: Vec<f32> = runs.iter().flat_map(|run| run.all_hits.clone()).collect();
    let lifecycle_read: u64 = runs.iter().map(|run| run.lifecycle_read).sum();
    let lifecycle_input: u64 = runs.iter().map(|run| run.lifecycle_input).sum();
    let first_hits: Vec<f32> = runs
        .iter()
        .filter_map(|run| run.first_request_hit)
        .collect();
    BenchMetrics {
        requests: runs.iter().map(|run| run.requests).sum(),
        steady_requests: runs.iter().map(|run| run.steady_requests).sum(),
        steady_mean_hit: mean(&steady_hits),
        all_mean_hit: mean(&all_hits),
        min_steady_hit: steady_hits.iter().copied().reduce(f32::min),
        steady_p50_hit: percentile(&steady_hits, 50.0),
        steady_p10_hit: percentile(&steady_hits, 10.0),
        all_p50_hit: percentile(&all_hits, 50.0),
        all_p10_hit: percentile(&all_hits, 10.0),
        cold_write_tokens: runs.iter().map(|run| run.cold_write_tokens).sum(),
        first_request_hit: mean(&first_hits).map(|value| value as f32),
        lifecycle_hit: if lifecycle_input == 0 {
            None
        } else {
            Some(lifecycle_read as f64 / lifecycle_input as f64 * 100.0)
        },
        lifecycle_read,
        lifecycle_input,
        steady_hits,
        all_hits,
    }
}

/// Percentil nearest-rank (`percent` em 0..=100) de valores de hit.
fn percentile(values: &[f32], percent: f64) -> Option<f32> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    let rank = ((sorted.len() - 1) as f64 * (percent / 100.0)).round() as usize;
    sorted.get(rank).copied()
}

fn mean(values: &[f32]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    Some(values.iter().map(|value| f64::from(*value)).sum::<f64>() / values.len() as f64)
}

fn repetitions() -> usize {
    std::env::var(REPETITIONS_ENV)
        .ok()
        .and_then(|raw| raw.trim().parse::<usize>().ok())
        .unwrap_or(1)
        .clamp(1, 10)
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

/// Clona o fixture e prefixa o **primeiro turno** com um nonce único da run e
/// injeta o mesmo nonce no `settings.system_prompt` (primeiro segmento do
/// request). O 1º request fica frio mesmo quando system/tools são idênticos a
/// uma execução anterior — sem o nonce no system prompt, o provedor ainda lê
/// system+tools do cache da run anterior (observado: ~99% de hit no 1º
/// request). O arquivo de fixture não é alterado.
fn fixture_with_nonce(fixture: &BenchFixture) -> (BenchFixture, String) {
    let nonce = format!("bench-run-{}", uuid::Uuid::new_v4());
    let mut scenario = fixture.clone();
    if let Some(first) = scenario.turns.first_mut() {
        *first = format!("[bench-run {nonce}] {first}");
    }
    (scenario, nonce)
}

/// Settings da run com o nonce no system prompt (reforça o cold-start).
fn settings_with_nonce(settings: &Settings, nonce: &str) -> Settings {
    let mut settings = settings.clone();
    let prefix = format!("[bench-run {nonce}]");
    settings.system_prompt = if settings.system_prompt.trim().is_empty() {
        prefix
    } else {
        format!("{prefix}\n{}", settings.system_prompt)
    };
    settings
}

/// Catálogo da run com um **display name** único para o modelo. O nome aparece
/// no início do system prompt (Identity), então o prefixo cacheável do gateway
/// difere desde os primeiros bytes — sem isso, system+tools iguais aos de uma
/// execução anterior fazem o 1º request ler cache (cold-start falso). O `id` do
/// modelo (wire) não muda.
fn catalog_with_unique_model_name(
    catalog: &crate::catalog::CatalogFile,
    provider_id: &str,
    model_id: &str,
    nonce: &str,
) -> crate::catalog::CatalogFile {
    let mut catalog = catalog.clone();
    for provider in &mut catalog.providers {
        if provider.id != provider_id {
            continue;
        }
        for model in &mut provider.models {
            if model.id == model_id {
                model.name = format!("{} (bench-run {nonce})", model.name);
            }
        }
    }
    catalog
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
        turn_kind: crate::domain::TurnKind::User,
        goal_request: false,
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

/// Caminho **único** do artifact da run
/// (`bench-e2e-live-<data>T<HHMMSS>.json`). Nunca sobrescreve uma execução
/// anterior: se o segundo já existir, acrescenta `-<n>`.
fn unique_evidence_path() -> anyhow::Result<std::path::PathBuf> {
    let directory = workspace_root().join(EVIDENCE_DIR);
    std::fs::create_dir_all(&directory)?;
    let stamp = chrono::Utc::now().format("%Y-%m-%dT%H%M%S").to_string();
    let base = directory.join(format!("bench-e2e-live-{stamp}.json"));
    if !base.exists() {
        return Ok(base);
    }
    for suffix in 2..1000u32 {
        let candidate = directory.join(format!("bench-e2e-live-{stamp}-{suffix}.json"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    anyhow::bail!("não foi possível escolher um nome único para o artifact do bench")
}

fn write_artifact(artifact: &Value) -> anyhow::Result<std::path::PathBuf> {
    let path = unique_evidence_path()?;
    std::fs::write(&path, serde_json::to_vec_pretty(artifact)?)?;
    Ok(path)
}

/// Skip auditável: grava `{ skipped: true, reason, at }` num artifact único e
/// imprime o caminho (não falha o CI). O EVIDENCE distingue skip de prova.
fn skip_artifact(reason: &str) {
    eprintln!("zylara bench: SKIP ({reason})");
    let artifact = json!({
        "skipped": true,
        "reason": reason,
        "at": chrono::Utc::now().to_rfc3339(),
        "fixture": fixture_paths()[0].display().to_string(),
    });
    match write_artifact(&artifact) {
        Ok(path) => eprintln!("zylara bench: skip auditável em {}", path.display()),
        Err(error) => eprintln!("zylara bench: falha ao gravar skip auditável: {error:#}"),
    }
}

fn print_metrics(label: &str, fixture: &BenchFixture, metrics: &BenchMetrics) {
    eprintln!(
        "zylara bench {label} ({} / {}): requests={} steady={} hit_steady={:?}% hit_all={:?}% min_steady={:?}% p50={:?}% p10={:?}% coldWrite={} firstHit={:?}% lifecycle={:?}%",
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
        metrics.steady_p50_hit,
        metrics.steady_p10_hit,
        metrics.cold_write_tokens,
        metrics.first_request_hit,
        metrics
            .lifecycle_hit
            .map(|value| (value * 100.0).round() / 100.0),
    );
}

fn metrics_json(metrics: &BenchMetrics) -> Value {
    json!({
        "requests": metrics.requests,
        "steadyRequests": metrics.steady_requests,
        "hitSteady": metrics.steady_mean_hit,
        "hitAll": metrics.all_mean_hit,
        "minSteady": metrics.min_steady_hit,
        "p50": metrics.steady_p50_hit,
        "p10": metrics.steady_p10_hit,
        "allP50": metrics.all_p50_hit,
        "allP10": metrics.all_p10_hit,
        "coldWriteTokens": metrics.cold_write_tokens,
        "firstRequestHit": metrics.first_request_hit,
        "lifecycleHit": metrics.lifecycle_hit,
    })
}

/* ------------------------------------------------------------------ */
/* Bench live (gateway)                                                */
/* ------------------------------------------------------------------ */

/// Bench E2E **live**: `run_turn` real contra o gateway anthropic/haiku por
/// >=10 turnos + baseline sem catálogo de cache. Grava um artifact **único por
/// run** e falha se o steady ficar abaixo do hard floor (95%); exige a meta de
/// 98% do PLAN §2.4.
#[tokio::test]
#[ignore = "live gateway: requer OPENCODE_API_KEY/auth.json e bench-fixture.json; rodar com --ignored"]
async fn cache_bench_e2e_live() {
    let Some(fixture) = load_fixture().unwrap_or_else(|error| {
        eprintln!("zylara bench: fixture inválida: {error:#}");
        None
    }) else {
        skip_artifact("bench-fixture.json ausente em docs/goals/prompt-cache/evidence/");
        return;
    };
    let catalog = crate::catalog::CatalogFile::load().expect("catálogo bundled");
    let Some(provider) = catalog.provider(&fixture.provider_id).cloned() else {
        skip_artifact(&format!(
            "provedor `{}` ausente no catálogo",
            fixture.provider_id
        ));
        return;
    };
    let Some(model) = catalog
        .model(&fixture.provider_id, &fixture.model_id)
        .cloned()
    else {
        skip_artifact(&format!(
            "modelo `{}` ausente no provedor `{}`",
            fixture.model_id, fixture.provider_id
        ));
        return;
    };
    if model
        .protocols
        .iter()
        .all(|protocol| protocol != "anthropic")
    {
        skip_artifact(&format!(
            "modelo `{}` não usa o protocolo anthropic",
            fixture.model_id
        ));
        return;
    }
    let reps = repetitions();

    let temp_dir =
        std::env::temp_dir().join(format!("zylara-cache-bench-{}", uuid::Uuid::new_v4()));
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
    // Skip gracioso e auditável sem credencial utilizável.
    if let Err(error) = crate::harness::resolve_credential(&base_deps, &provider).await {
        skip_artifact(&format!("sem credencial para {}: {error}", provider.id));
        return;
    }
    eprintln!(
        "zylara bench: live gateway {}/{} x{reps} run(s) (ZYLARA_BENCH_REPETITIONS; artifact único)",
        fixture.provider_id, fixture.model_id
    );

    let settings = Settings::default();
    // Protocolo p50/p10: cada repetição é uma run independente (DB/conversa
    // novas) e os hits são agregados antes dos percentis.
    let mut live_runs: Vec<BenchMetrics> = Vec::with_capacity(reps);
    let mut live_samples: Vec<CacheSample> = Vec::new();
    let mut live_nonces: Vec<String> = Vec::with_capacity(reps);
    for run_index in 0..reps {
        // Nonce por run: garante cold-start mesmo com prefixo de fixture igual
        // ao de execuções anteriores (cache do gateway é por prefixo).
        let (scenario, nonce) = fixture_with_nonce(&fixture);
        let run_settings = settings_with_nonce(&settings, &nonce);
        let mut run_deps = base_deps.clone();
        run_deps.catalog = catalog_with_unique_model_name(
            &catalog,
            &fixture.provider_id,
            &fixture.model_id,
            &nonce,
        );
        eprintln!(
            "zylara bench: live run {}/{} nonce={nonce} (1º request frio)",
            run_index + 1,
            reps
        );
        live_nonces.push(nonce);
        let samples = run_fixture(
            run_deps,
            &fixture.provider_id,
            &fixture.model_id,
            &scenario,
            run_settings,
        )
        .await
        .expect("bench live");
        let run_metrics = metrics(&samples);
        print_metrics(
            &format!("live run {}/{}", run_index + 1, reps),
            &fixture,
            &run_metrics,
        );
        live_samples.extend(samples);
        live_runs.push(run_metrics);
    }
    let steady_metrics = aggregate_metrics(&live_runs);
    print_metrics("live agregado", &fixture, &steady_metrics);
    // Cold-start real: o nonce no 1º turno força o 1º request frio. Se vier
    // quente, o nonce não entrou no prefixo do request.
    eprintln!(
        "zylara bench: cold-start coldWriteTokens={} firstRequestHit={:?}% lifecycleHit={:?}%",
        steady_metrics.cold_write_tokens,
        steady_metrics.first_request_hit,
        steady_metrics.lifecycle_hit
    );

    // Baseline: catálogo sem cache → sem plano explícito; mede o hit real.
    let mut baseline_deps = base_deps.clone();
    baseline_deps.catalog = catalog_without_cache(&catalog);
    let mut baseline_runs: Vec<BenchMetrics> = Vec::with_capacity(reps);
    let mut baseline_nonces: Vec<String> = Vec::with_capacity(reps);
    for run_index in 0..reps {
        let (scenario, nonce) = fixture_with_nonce(&fixture);
        baseline_nonces.push(nonce);
        let samples = run_fixture(
            baseline_deps.clone(),
            &fixture.provider_id,
            &fixture.model_id,
            &scenario,
            settings.clone(),
        )
        .await
        .expect("bench baseline");
        let run_metrics = metrics(&samples);
        print_metrics(
            &format!("baseline run {}/{}", run_index + 1, reps),
            &fixture,
            &run_metrics,
        );
        baseline_runs.push(run_metrics);
    }
    let baseline_metrics = aggregate_metrics(&baseline_runs);
    print_metrics("baseline agregado", &fixture, &baseline_metrics);
    eprintln!(
        "zylara bench: baseline sem catálogo cache (plan=None) — hit_steady={:?}% (esperado ~0)",
        baseline_metrics.steady_mean_hit
    );

    let now = chrono::Utc::now();
    let artifact = json!({
        "runId": now.format("%Y-%m-%dT%H%M%S").to_string(),
        "skipped": false,
        "at": now.to_rfc3339(),
        "fixture": fixture_paths()[0].display().to_string(),
        "providerId": fixture.provider_id,
        "modelId": fixture.model_id,
        "turns": fixture.turns.len(),
        "repetitions": reps,
        "statistics": ["p50", "p10", "mean", "min"],
        "coldStartMethod": "nonce único por run no display name do modelo (início do system prompt) + settings.system_prompt + 1º turno; prefixo estável depois",
        "nonces": live_nonces,
        "baselineNonces": baseline_nonces,
        "live": {
            "requests": steady_metrics.requests,
            "steadyRequests": steady_metrics.steady_requests,
            "hitSteady": steady_metrics.steady_mean_hit,
            "hitAll": steady_metrics.all_mean_hit,
            "minSteady": steady_metrics.min_steady_hit,
            "p50": steady_metrics.steady_p50_hit,
            "p10": steady_metrics.steady_p10_hit,
            "allP50": steady_metrics.all_p50_hit,
            "allP10": steady_metrics.all_p10_hit,
            "coldWriteTokens": steady_metrics.cold_write_tokens,
            "firstRequestHit": steady_metrics.first_request_hit,
            "lifecycleHit": steady_metrics.lifecycle_hit,
            "targetHit": TARGET_STEADY_HIT,
            "hardFloorHit": HARD_FLOOR_STEADY_HIT,
        },
        // Compat com o artifact anterior (EVIDENCE usa `steady`).
        "steady": {
            "requests": steady_metrics.requests,
            "steadyRequests": steady_metrics.steady_requests,
            "steadyMeanHit": steady_metrics.steady_mean_hit,
            "allMeanHit": steady_metrics.all_mean_hit,
            "minSteadyHit": steady_metrics.min_steady_hit,
            "p50": steady_metrics.steady_p50_hit,
            "p10": steady_metrics.steady_p10_hit,
            "coldWriteTokens": steady_metrics.cold_write_tokens,
            "firstRequestHit": steady_metrics.first_request_hit,
            "lifecycleHit": steady_metrics.lifecycle_hit,
            "targetHit": TARGET_STEADY_HIT,
            "hardFloorHit": HARD_FLOOR_STEADY_HIT,
        },
        "baseline": {
            "plan": "none (catálogo sem cache)",
            "requests": baseline_metrics.requests,
            "steadyRequests": baseline_metrics.steady_requests,
            "hitSteady": baseline_metrics.steady_mean_hit,
            "hitAll": baseline_metrics.all_mean_hit,
            "minSteady": baseline_metrics.min_steady_hit,
            "p50": baseline_metrics.steady_p50_hit,
            "p10": baseline_metrics.steady_p10_hit,
            "steadyMeanHit": baseline_metrics.steady_mean_hit,
            "allMeanHit": baseline_metrics.all_mean_hit,
            "coldWriteTokens": baseline_metrics.cold_write_tokens,
            "firstRequestHit": baseline_metrics.first_request_hit,
            "lifecycleHit": baseline_metrics.lifecycle_hit,
        },
        "runs": {
            "live": live_runs.iter().map(metrics_json).collect::<Vec<_>>(),
            "baseline": baseline_runs.iter().map(metrics_json).collect::<Vec<_>>(),
        },
        "samples": live_samples.iter().map(|sample| json!({
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
    match write_artifact(&artifact) {
        Ok(path) => eprintln!("zylara bench: evidência gravada em {}", path.display()),
        Err(error) => eprintln!("zylara bench: falha ao gravar evidência: {error:#}"),
    }

    eprintln!(
        "zylara bench: GATE live steady hit {:.1}% (target {:.0}%, hard floor {:.0}%); baseline {:.1}%",
        steady_metrics.steady_mean_hit.unwrap_or(0.0),
        TARGET_STEADY_HIT,
        HARD_FLOOR_STEADY_HIT,
        baseline_metrics.steady_mean_hit.unwrap_or(0.0)
    );
    if steady_metrics.steady_requests == 0 {
        panic!("bench live sem requests steady (ceiling >=98%) — resultado inválido");
    }
    assert!(
        steady_metrics.cold_write_tokens > 0,
        "cold-start inválido: 1ª amostra não escreveu cache (coldWriteTokens=0)"
    );
    // O bloco de **tools** é idêntico entre runs e o plano anthropic tem um
    // breakpoint nele: o gateway lê ~2.4k tokens de tools mesmo com system/história
    // frios (cold write real). Por isso o limite considera essa parcela imutável;
    // acima disso o nonce não entrou no prefixo.
    assert!(
        steady_metrics.first_request_hit.unwrap_or(0.0) < 30.0,
        "cold-start inválido: 1º request veio quente ({:?}%) — nonce fora do prefixo?",
        steady_metrics.first_request_hit
    );
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
    let previous: Arc<Mutex<Option<PrefixDigest>>> = Arc::new(Mutex::new(None));
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
        let usage = UsageInfo {
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
            }
            emit_event(&sink, ProviderEvent::Done);
            Ok(())
        })
    })
}

fn emit_event(sink: &crate::providers::EventSink, event: ProviderEvent) {
    let _ = sink.send(event);
}

/// Digest do prefixo de um request (mesmo formato do fake dos testes do loop):
/// system → tools → histórico, com SHA-256 encadeado por segmento.
fn request_digest(request: &CompletionRequest) -> PrefixDigest {
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
        "cache_bench synthetic: requests={} steady={} hit_steady={:?}% p50={:?}% p10={:?}% min={:?}%",
        metrics.requests,
        metrics.steady_requests,
        metrics.steady_mean_hit,
        metrics.steady_p50_hit,
        metrics.steady_p10_hit,
        metrics.min_steady_hit
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
            "zylara-cache-bench-synthetic-{}.db",
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
        std::env::temp_dir().join(format!("zylara-cache-bench-data-{}", uuid::Uuid::new_v4()));
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
