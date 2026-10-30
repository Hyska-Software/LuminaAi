//! **Objetivo persistente** da sessão do layout Code (`docs/goals/code-goals/PLAN.md`).
//!
//! Um objetivo único por sessão, modelado como **projeção append-only** sobre
//! `code_events` (mesmo padrão de plano/tarefas em [`super::session`]):
//!
//! | Kind | Payload | Quando |
//! | --- | --- | --- |
//! | `goal/state` | [`GoalView`] completo | create, edit, arm/disarm, pause/resume, complete/reopen/block, nota, início/fim de rodada |
//! | `goal/deleted` | `{ revision, at }` | encerrar (tombstone; a auditoria é preservada) |
//! | `goal/round-started` | `{ index, turnId, startedAt }` | abertura da rodada, antes do primeiro request |
//! | `goal/round` | [`GoalRound`] | fim do turno da rodada (`done/cancelled/error/interrupted`) |
//!
//! O **último** `goal/state` vence; um `goal/deleted` com `seq` maior fecha o
//! estado (e uma criação posterior continua a revisão). A `revision` é o CAS
//! das ações da UI (`expectedRevision` → [`GoalError`] `GOAL_STALE_REVISION`).
//!
//! Concorrência: todas as mutações (read-modify-append) são serializadas por
//! [`GOAL_WRITE_LOCK`] (instância única do app). A leitura do fold é livre.
//! Idempotência: `begin_round` com um `turnId` já aberto e `finish_round` de um
//! turno já fechado são no-op (não incrementam revisão nem contam rodada duas
//! vezes); ações da UI no estado alvo (armar um objetivo já armado etc.) também
//! são no-op.
//!
//! Limites/defaults são a **fonte única** da §5.3 do PLAN — a UI e a tool
//! consomem estas constantes.

use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::db::{Db, StoredCodeEvent};
use crate::domain::{
    now_ms, CreateGoalInput, GoalAction, GoalOrigin, GoalPauseReason, GoalRound, GoalStatus,
    GoalView, UpdateGoalInput, UsageInfo,
};

use super::session;

/* ------------------------------------------------------------------ */
/* Contrato                                                            */
/* ------------------------------------------------------------------ */

/// Evento de snapshot completo do objetivo (último vence).
pub const KIND_STATE: &str = "goal/state";
/// Tombstone do encerramento (fecha o fold; a auditoria continua no log).
pub const KIND_DELETED: &str = "goal/deleted";
/// Abertura de rodada (`{ index, turnId, startedAt }`).
pub const KIND_ROUND_STARTED: &str = "goal/round-started";
/// Fecho de rodada ([`GoalRound`] completo).
pub const KIND_ROUND: &str = "goal/round";

/* Limites e defaults (PLAN §5.3) — fonte única. */
pub const GOAL_MAX_OBJECTIVE_CHARS: usize = 4_000;
pub const GOAL_MAX_TITLE_CHARS: usize = 120;
pub const GOAL_MAX_NOTE_CHARS: usize = 2_000;
pub const GOAL_MAX_REASON_CHARS: usize = 500;
pub const GOAL_MAX_ROUNDS_DEFAULT: u32 = 25;
pub const GOAL_MAX_ROUNDS_HARD_CAP: u32 = 100;
/// Rodadas consecutivas sem progresso até pausar por estol.
pub const GOAL_STALL_ROUNDS: u32 = 3;
/// Motivos iguais consecutivos até a tool `blocked` bloquear.
pub const GOAL_BLOCKED_STREAK: u32 = 3;
/// Teto de rodadas devolvidas pelo histórico (`list_goal_rounds`).
pub const GOAL_ROUNDS_LIST_LIMIT: u32 = 200;
/// No máximo uma rodada aberta por conversa (preflight/checagem de turno).
pub const GOAL_MAX_RUNNING_ROUNDS_PER_CONVERSATION: u32 = 1;

/// Códigos estáveis devolvidos pelo harness para recusas de rodada que não são
/// do [`GoalError`] (validadas no `run_turn` antes de qualquer persistência).
pub const GOAL_TURN_REQUIRES_CODE: &str = "GOAL_TURN_REQUIRES_CODE";
pub const GOAL_REQUIRES_TOP_LEVEL: &str = "GOAL_REQUIRES_TOP_LEVEL";

/// Serializa mutações (read-modify-append); instância única do app.
static GOAL_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Erro de domínio do objetivo: código estável + mensagem acionável (pt-BR).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoalError {
    pub code: &'static str,
    pub message: String,
}

impl GoalError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn not_found() -> Self {
        Self::new("GOAL_NOT_FOUND", "não há objetivo nesta sessão")
    }

    pub fn not_active(status: GoalStatus) -> Self {
        Self::new(
            "GOAL_NOT_ACTIVE",
            format!(
                "o objetivo não está ativo (status atual: {})",
                status_name(status)
            ),
        )
    }

    pub fn already_exists() -> Self {
        Self::new(
            "GOAL_ALREADY_EXISTS",
            "a sessão já tem um objetivo ativo; conclua ou encerre o atual antes de criar outro",
        )
    }

    pub fn stale_revision(expected: u64, actual: u64) -> Self {
        Self::new(
            "GOAL_STALE_REVISION",
            format!("revisão desatualizada (esperada {expected}, atual {actual}); recarregue o objetivo"),
        )
    }

    pub fn max_rounds(rounds: u32, max_rounds: u32) -> Self {
        Self::new(
            "GOAL_MAX_ROUNDS",
            format!("limite de rodadas atingido ({rounds}/{max_rounds}); estenda o limite para continuar"),
        )
    }

    pub fn plan_mode() -> Self {
        Self::new(
            "GOAL_PLAN_MODE",
            "o modo Plano está ativo; conclua a revisão do plano antes de iniciar uma rodada",
        )
    }

    pub fn invalid_args(message: impl Into<String>) -> Self {
        Self::new("GOAL_INVALID_ARGS", message)
    }

    pub fn requires_user_turn() -> Self {
        Self::new(
            "GOAL_REQUIRES_USER_TURN",
            "criar ou editar o objetivo só vale em um turno humano, nunca em uma rodada automática",
        )
    }

    pub fn not_armed() -> Self {
        Self::new(
            "GOAL_NOT_ARMED",
            "a continuidade automática do objetivo não está armada",
        )
    }

    pub fn busy(message: impl Into<String>) -> Self {
        Self::new("GOAL_BUSY", message)
    }

    pub fn no_workspace() -> Self {
        Self::new(
            "GOAL_NO_WORKSPACE",
            "a rodada do objetivo exige um workspace aberto",
        )
    }

    /// Falha ao ler/gravar o log da sessão (não é erro do modelo/usuário).
    pub fn persistence(message: impl Into<String>) -> Self {
        Self::new("GOAL_PERSIST_FAILED", message)
    }
}

impl std::fmt::Display for GoalError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for GoalError {}

/// Resultado da tool `blocked`: a rodada segue quando o bloqueio ainda não foi
/// confirmado em [`GOAL_BLOCKED_STREAK`] rodadas.
#[derive(Debug, Clone)]
pub struct BlockerReport {
    pub goal: GoalView,
    /// `true` quando o objetivo passou para `blocked` nesta chamada.
    pub blocked: bool,
}

/* ------------------------------------------------------------------ */
/* Fold (leitura)                                                      */
/* ------------------------------------------------------------------ */

fn parse_goal(payload: &str) -> Option<GoalView> {
    serde_json::from_str::<GoalView>(payload).ok()
}

fn parse_state_event(event: &StoredCodeEvent) -> Option<GoalView> {
    (event.kind == KIND_STATE)
        .then(|| parse_goal(&event.payload))
        .flatten()
}

/// Objetivo atual da sessão: o último `goal/state` vence, a menos que um
/// `goal/deleted` mais novo o tenha encerrado. Payload corrompido é ignorado
/// (a projeção se comporta como "sem objetivo", nunca derruba o turno).
pub fn current(db: &Db, conversation_id: &str) -> anyhow::Result<Option<GoalView>> {
    let Some(state) = db.latest_code_event(conversation_id, KIND_STATE)? else {
        return Ok(None);
    };
    if let Some(deleted) = db.latest_code_event(conversation_id, KIND_DELETED)? {
        if deleted.seq > state.seq {
            return Ok(None);
        }
    }
    Ok(parse_goal(&state.payload))
}

/// Rodada de abertura (`goal/round-started`) já parseada do log.
#[derive(Debug, Clone, PartialEq, Eq)]
struct RoundStart {
    seq: i64,
    index: u32,
    turn_id: String,
    started_at: i64,
}

fn parse_round_start(event: &StoredCodeEvent) -> Option<RoundStart> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Payload {
        index: u32,
        turn_id: String,
        started_at: i64,
    }
    let payload: Payload = serde_json::from_str(&event.payload).ok()?;
    Some(RoundStart {
        seq: event.seq,
        index: payload.index,
        turn_id: payload.turn_id,
        started_at: payload.started_at,
    })
}

fn parse_round_end(event: &StoredCodeEvent) -> Option<GoalRound> {
    (event.kind == KIND_ROUND)
        .then(|| serde_json::from_str::<GoalRound>(&event.payload).ok())
        .flatten()
}

/// `seq` do snapshot que **criou** o objetivo atual.
///
/// A criação (inclusive a substituição de um objetivo concluído) é o último
/// `goal/state` com `rounds == 0` e `createdAt` do objetivo. O escopo das
/// rodadas usa esse `seq` (e não só timestamps) para não misturar o histórico
/// de um objetivo anterior criado no mesmo milissegundo.
fn goal_boundary_seq(events: &[StoredCodeEvent], goal: &GoalView) -> i64 {
    let mut boundary = 0;
    for event in events {
        let Some(view) = parse_state_event(event) else {
            continue;
        };
        if view.rounds == 0 && view.created_at == goal.created_at {
            boundary = event.seq;
        }
    }
    boundary
}

fn round_starts(events: &[StoredCodeEvent], boundary: i64) -> Vec<RoundStart> {
    events
        .iter()
        .filter(|event| event.seq > boundary && event.kind == KIND_ROUND_STARTED)
        .filter_map(parse_round_start)
        .collect()
}

fn round_ends(events: &[StoredCodeEvent], boundary: i64) -> Vec<GoalRound> {
    events
        .iter()
        .filter(|event| event.seq > boundary)
        .filter_map(parse_round_end)
        .collect()
}

/// Rodadas do objetivo atual, **mais recentes primeiro** (limite 1..=200).
///
/// Pareia `goal/round-started`/`goal/round` por `turnId` (fallback por
/// `index`). Uma abertura sem fecho e **sem** turno ativo vira `interrupted`
/// (crash/reload no meio da rodada); com `active_turn = true` a rodada mais
/// recente fica "em andamento" (`outcome = None`).
///
/// O chamador informa `active_turn` (ex.: `AppState::has_active_turn_for`) para
/// que o fold continue puro e testável.
pub fn rounds(
    db: &Db,
    conversation_id: &str,
    limit: u32,
    active_turn: bool,
) -> anyhow::Result<Vec<GoalRound>> {
    let limit = usize::try_from(limit.clamp(1, GOAL_ROUNDS_LIST_LIMIT)).unwrap_or(1);
    let Some(goal) = current(db, conversation_id)? else {
        return Ok(Vec::new());
    };
    let events = db.list_code_events(conversation_id, 1)?;
    let boundary = goal_boundary_seq(&events, &goal);
    let starts = round_starts(&events, boundary);
    if starts.is_empty() {
        return Ok(Vec::new());
    }
    let ends = round_ends(&events, boundary);
    let latest_index = starts.iter().map(|start| start.index).max().unwrap_or(0);
    let in_progress_allowed = active_turn && goal.status == GoalStatus::Active;

    let mut rounds: Vec<GoalRound> = starts
        .iter()
        .map(|start| {
            let ended = ends
                .iter()
                .find(|round| round.turn_id == start.turn_id)
                .or_else(|| ends.iter().find(|round| round.index == start.index));
            match ended {
                Some(ended) => GoalRound {
                    index: start.index,
                    turn_id: start.turn_id.clone(),
                    started_at: start.started_at,
                    ended_at: ended.ended_at,
                    outcome: ended.outcome.clone(),
                    duration_ms: ended.duration_ms,
                    tokens: ended.tokens,
                    cost: ended.cost,
                    files_changed: ended.files_changed,
                    note: ended.note.clone(),
                },
                None => {
                    let in_progress = in_progress_allowed && start.index == latest_index;
                    GoalRound {
                        index: start.index,
                        turn_id: start.turn_id.clone(),
                        started_at: start.started_at,
                        ended_at: None,
                        outcome: if in_progress {
                            None
                        } else {
                            Some(INTERRUPTED.to_string())
                        },
                        duration_ms: None,
                        tokens: None,
                        cost: None,
                        files_changed: 0,
                        note: None,
                    }
                }
            }
        })
        .collect();
    rounds.sort_by(|left, right| right.index.cmp(&left.index));
    rounds.truncate(limit);
    Ok(rounds)
}

const INTERRUPTED: &str = "interrupted";
const DONE: &str = "done";
const CANCELLED: &str = "cancelled";
const ERROR: &str = "error";

/// Normaliza o `outcome` do fecho (`done|cancelled|error|interrupted`).
fn normalize_outcome(outcome: &str) -> &'static str {
    match outcome.trim().to_ascii_lowercase().as_str() {
        "cancelled" | "canceled" | "cancel" => CANCELLED,
        "error" | "failed" | "failure" => ERROR,
        "interrupted" => INTERRUPTED,
        _ => DONE,
    }
}

/* ------------------------------------------------------------------ */
/* Helpers de leitura/gravação                                         */
/* ------------------------------------------------------------------ */

fn load_current(db: &Db, conversation_id: &str) -> Result<Option<GoalView>, GoalError> {
    current(db, conversation_id).map_err(|error| {
        GoalError::persistence(format!("não foi possível ler o objetivo: {error:#}"))
    })
}

fn ensure_goal(db: &Db, conversation_id: &str) -> Result<GoalView, GoalError> {
    load_current(db, conversation_id)?.ok_or_else(GoalError::not_found)
}

/// Revisão do último tombstone (`goal/deleted`), para a criação posterior
/// continuar a numeração da sessão (PLAN §6.1).
fn deleted_revision(db: &Db, conversation_id: &str) -> Result<u64, GoalError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DeletedPayload {
        #[serde(default)]
        revision: u64,
    }
    let Some(deleted) = db
        .latest_code_event(conversation_id, KIND_DELETED)
        .map_err(|error| {
            GoalError::persistence(format!("não foi possível ler o encerramento: {error:#}"))
        })?
    else {
        return Ok(0);
    };
    Ok(serde_json::from_str::<DeletedPayload>(&deleted.payload)
        .map(|payload| payload.revision)
        .unwrap_or(0))
}

fn list_events(db: &Db, conversation_id: &str) -> Result<Vec<StoredCodeEvent>, GoalError> {
    // Só os kinds que o fold/histórico consomem (evita ler o log inteiro de
    // sessões longas). `todos`/`plan/*` entram porque `finish_round` mede
    // progresso comparando o `seq` desses eventos com o `round-started`.
    // A query de `db` devolve `seq DESC`; o fold espera ASC.
    let mut events = db
        .list_code_events_by_kinds(
            conversation_id,
            &[
                KIND_STATE,
                KIND_DELETED,
                KIND_ROUND_STARTED,
                KIND_ROUND,
                session::KIND_TODOS,
                session::KIND_PLAN_MODE,
                session::KIND_PLAN_SUBMITTED,
                session::KIND_PLAN_FEEDBACK,
                session::KIND_PLAN_APPROVED,
            ],
            None,
        )
        .map_err(|error| {
            GoalError::persistence(format!("não foi possível ler o log da sessão: {error:#}"))
        })?;
    events.reverse();
    Ok(events)
}

/// Fecha rodadas deixadas abertas por crash/reinício como `interrupted`.
///
/// Usado pelo `update_goal` (antes de Retomar/Reabrir/editar) quando **não há
/// turno ativo** na conversa: sem isso a degradação de leitura do snapshot vira
/// um loop (`resume` no estado persistido `active` é no-op — QA F4, achado
/// ALTO). Não altera estado nem revisão; só grava os `goal/round` faltantes.
pub fn reconcile_interrupted_rounds(
    db: &Db,
    conversation_id: &str,
) -> Result<Option<GoalView>, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    let Some(view) = load_current(db, conversation_id)? else {
        return Ok(None);
    };
    reconcile_interrupted_rounds_locked(db, conversation_id, &view)?;
    Ok(Some(view))
}

fn reconcile_interrupted_rounds_locked(
    db: &Db,
    conversation_id: &str,
    view: &GoalView,
) -> Result<(), GoalError> {
    let events = list_events(db, conversation_id)?;
    let boundary = goal_boundary_seq(&events, view);
    let starts = round_starts(&events, boundary);
    let ends = round_ends(&events, boundary);
    let now = now_ms();
    for start in starts.iter().filter(|start| {
        !ends
            .iter()
            .any(|round| round.turn_id == start.turn_id || round.index == start.index)
    }) {
        let interrupted = GoalRound {
            index: start.index,
            turn_id: start.turn_id.clone(),
            started_at: start.started_at,
            ended_at: Some(now),
            outcome: Some(INTERRUPTED.to_string()),
            duration_ms: Some(
                u64::try_from(now.saturating_sub(start.started_at).max(0)).unwrap_or(0),
            ),
            tokens: None,
            cost: None,
            files_changed: 0,
            note: None,
        };
        append_round(db, conversation_id, &interrupted)?;
    }
    Ok(())
}

fn encode(view: &GoalView) -> Result<Value, GoalError> {
    serde_json::to_value(view).map_err(|error| {
        GoalError::persistence(format!("não foi possível serializar o objetivo: {error}"))
    })
}

fn append_state(
    db: &Db,
    conversation_id: &str,
    turn_id: Option<&str>,
    view: &GoalView,
) -> Result<(), GoalError> {
    let payload = encode(view)?;
    session::append(db, conversation_id, turn_id, KIND_STATE, &payload).map_err(|error| {
        GoalError::persistence(format!("não foi possível salvar o objetivo: {error:#}"))
    })
}

fn append_round(db: &Db, conversation_id: &str, round: &GoalRound) -> Result<(), GoalError> {
    let payload = serde_json::to_value(round).map_err(|error| {
        GoalError::persistence(format!("não foi possível serializar a rodada: {error}"))
    })?;
    session::append(
        db,
        conversation_id,
        Some(&round.turn_id),
        KIND_ROUND,
        &payload,
    )
    .map_err(|error| {
        GoalError::persistence(format!("não foi possível salvar a rodada: {error:#}"))
    })
}

fn bump(view: &mut GoalView) {
    view.revision = view.revision.saturating_add(1);
    view.updated_at = now_ms();
}

fn set_paused(view: &mut GoalView, reason: GoalPauseReason, detail: Option<String>) {
    view.status = GoalStatus::Paused;
    view.pause_reason = Some(reason);
    view.pause_detail = detail;
}

fn clear_pause(view: &mut GoalView) {
    view.pause_reason = None;
    view.pause_detail = None;
}

fn clear_blocker(view: &mut GoalView) {
    view.blocker_reason = None;
    view.blocker_streak = 0;
    view.stalled_rounds = 0;
}

fn status_name(status: GoalStatus) -> &'static str {
    match status {
        GoalStatus::Active => "active",
        GoalStatus::Paused => "paused",
        GoalStatus::Completed => "completed",
        GoalStatus::Blocked => "blocked",
    }
}

fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut truncated: String = text.chars().take(max.saturating_sub(1)).collect();
    truncated.push('…');
    truncated
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn validate_objective(objective: &str) -> Result<String, GoalError> {
    let objective = objective.trim();
    if objective.is_empty() {
        return Err(GoalError::invalid_args("o objetivo não pode ficar vazio"));
    }
    if objective.chars().count() > GOAL_MAX_OBJECTIVE_CHARS {
        return Err(GoalError::invalid_args(format!(
            "o objetivo excede {GOAL_MAX_OBJECTIVE_CHARS} caracteres"
        )));
    }
    Ok(objective.to_string())
}

/// Título vazio ⇒ primeira linha do objetivo (até 80 chars + reticências).
fn derive_title(objective: &str) -> String {
    let first_line = objective
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let collapsed = collapse_whitespace(first_line);
    if collapsed.is_empty() {
        return "Objetivo".to_string();
    }
    truncate_chars(&collapsed, 80)
}

fn validate_title(title: &str) -> Result<String, GoalError> {
    let title = collapse_whitespace(title);
    if title.is_empty() {
        return Err(GoalError::invalid_args("o título não pode ficar vazio"));
    }
    if title.chars().count() > GOAL_MAX_TITLE_CHARS {
        return Err(GoalError::invalid_args(format!(
            "o título excede {GOAL_MAX_TITLE_CHARS} caracteres"
        )));
    }
    Ok(title)
}

fn validate_note(note: &str) -> Result<String, GoalError> {
    let note = note.trim();
    if note.is_empty() {
        return Err(GoalError::invalid_args("a nota não pode ficar vazia"));
    }
    if note.chars().count() > GOAL_MAX_NOTE_CHARS {
        return Err(GoalError::invalid_args(format!(
            "a nota excede {GOAL_MAX_NOTE_CHARS} caracteres"
        )));
    }
    Ok(note.to_string())
}

fn validate_reason(reason: &str) -> Result<String, GoalError> {
    let reason = collapse_whitespace(reason);
    if reason.is_empty() {
        return Err(GoalError::invalid_args("o motivo não pode ficar vazio"));
    }
    Ok(truncate_chars(&reason, GOAL_MAX_REASON_CHARS))
}

fn optional_detail(detail: Option<&str>) -> Option<String> {
    detail
        .map(collapse_whitespace)
        .filter(|detail| !detail.is_empty())
        .map(|detail| truncate_chars(&detail, GOAL_MAX_REASON_CHARS))
}

fn clamp_max_rounds(max_rounds: u32) -> u32 {
    max_rounds.clamp(1, GOAL_MAX_ROUNDS_HARD_CAP)
}

fn ensure_revision(goal: &GoalView, expected: Option<u64>) -> Result<(), GoalError> {
    if let Some(expected) = expected {
        if expected != goal.revision {
            return Err(GoalError::stale_revision(expected, goal.revision));
        }
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Mutações (públicas; adquirem o lock)                                */
/* ------------------------------------------------------------------ */

/// Cria o objetivo da sessão.
///
/// - `origin = User` (criação explícita pela UI/commands): `autoContinue`
///   default **true**;
/// - `origin = Agent` (tool em turno humano, fluxo `/goal` + mensagem): honra
///   `auto_continue` explícito; sem o parâmetro nasce **desarmado**
///   (retrocompatível e seguro — a UI de `/goal` envia `true`).
///
/// Com um objetivo `completed` na sessão, cria um novo substituindo-o e
/// **continua a revisão** (PLAN §6.1). Com objetivo ativo/pausado/bloqueado
/// recusa com `GOAL_ALREADY_EXISTS`.
pub fn create(
    db: &Db,
    conversation_id: &str,
    input: &CreateGoalInput,
    origin: GoalOrigin,
) -> Result<GoalView, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    create_locked(db, conversation_id, input, origin)
}

fn create_locked(
    db: &Db,
    conversation_id: &str,
    input: &CreateGoalInput,
    origin: GoalOrigin,
) -> Result<GoalView, GoalError> {
    let existing = load_current(db, conversation_id)?;
    if let Some(existing) = &existing {
        if existing.status != GoalStatus::Completed {
            return Err(GoalError::already_exists());
        }
    }
    let objective = validate_objective(&input.objective)?;
    let title = match input.title.as_deref() {
        Some(title) if !title.trim().is_empty() => validate_title(title)?,
        _ => derive_title(&objective),
    };
    let max_rounds = clamp_max_rounds(input.max_rounds.unwrap_or(GOAL_MAX_ROUNDS_DEFAULT));
    let auto_continue = match origin {
        // Tool `create` roda só em turno humano (`/goal` + mensagem): o pedido
        // explícito do usuário pode armar a continuidade; sem parâmetro, a
        // proposta do agente nasce desarmada (retrocompatível/seguro).
        GoalOrigin::Agent => input.auto_continue.unwrap_or(false),
        GoalOrigin::User => input.auto_continue.unwrap_or(true),
    };
    let now = now_ms();
    // Revisão monotônica por sessão: um objetivo novo (inclusive depois de um
    // `completed` substituído ou de um `delete`) continua a numeração.
    let revision = match &existing {
        Some(goal) => goal.revision.saturating_add(1),
        None => deleted_revision(db, conversation_id)?.saturating_add(1),
    };
    let view = GoalView {
        title,
        objective,
        status: GoalStatus::Active,
        auto_continue,
        rounds: 0,
        max_rounds,
        revision,
        origin,
        created_at: now,
        updated_at: now,
        completed_at: None,
        last_round_at: None,
        last_note: None,
        pause_reason: None,
        pause_detail: None,
        blocker_reason: None,
        blocker_streak: 0,
        stalled_rounds: 0,
        tokens: 0,
        cost: 0.0,
    };
    append_state(db, conversation_id, None, &view)?;
    // Sessão recém-criada: o objetivo vira o título útil do sidebar (mesma
    // regra do `create_goal`; no fluxo `/goal` quem cria é a tool). Best-effort:
    // falha de rename não desfaz o objetivo.
    if let Ok(Some(conversation)) = db.get_conversation(conversation_id) {
        if crate::harness::should_auto_title(&conversation.title) {
            let _ = db.rename_conversation(conversation_id, &view.title);
        }
    }
    Ok(view)
}

/// Edita título/objetivo/limite de rodadas (o que vier em `input`).
/// Valores iguais são no-op (não incrementa a revisão).
pub fn edit(
    db: &Db,
    conversation_id: &str,
    input: &UpdateGoalInput,
) -> Result<GoalView, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    edit_locked(db, conversation_id, input)
}

fn edit_locked(
    db: &Db,
    conversation_id: &str,
    input: &UpdateGoalInput,
) -> Result<GoalView, GoalError> {
    let mut view = ensure_goal(db, conversation_id)?;
    let mut changed = false;
    if let Some(raw) = input.title.as_deref() {
        let title = validate_title(raw)?;
        if title != view.title {
            view.title = title;
            changed = true;
        }
    }
    if let Some(raw) = input.objective.as_deref() {
        let objective = validate_objective(raw)?;
        if objective != view.objective {
            view.objective = objective;
            changed = true;
        }
    }
    if let Some(max_rounds) = input.max_rounds {
        let max_rounds = clamp_max_rounds(max_rounds);
        if max_rounds != view.max_rounds {
            view.max_rounds = max_rounds;
            changed = true;
        }
    }
    if !changed {
        return Ok(view);
    }
    bump(&mut view);
    append_state(db, conversation_id, None, &view)?;
    Ok(view)
}

/// Arma a continuidade automática (idempotente). Exige `active`.
pub fn arm(db: &Db, conversation_id: &str) -> Result<GoalView, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    arm_locked(db, conversation_id)
}

fn arm_locked(db: &Db, conversation_id: &str) -> Result<GoalView, GoalError> {
    let mut view = ensure_goal(db, conversation_id)?;
    if view.status != GoalStatus::Active {
        return Err(GoalError::not_active(view.status));
    }
    if view.auto_continue {
        return Ok(view);
    }
    view.auto_continue = true;
    bump(&mut view);
    append_state(db, conversation_id, None, &view)?;
    Ok(view)
}

/// Desarma a continuidade automática (idempotente). Exige `active`.
pub fn disarm(db: &Db, conversation_id: &str) -> Result<GoalView, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    disarm_locked(db, conversation_id)
}

fn disarm_locked(db: &Db, conversation_id: &str) -> Result<GoalView, GoalError> {
    let mut view = ensure_goal(db, conversation_id)?;
    if view.status != GoalStatus::Active {
        return Err(GoalError::not_active(view.status));
    }
    if !view.auto_continue {
        return Ok(view);
    }
    view.auto_continue = false;
    bump(&mut view);
    append_state(db, conversation_id, None, &view)?;
    Ok(view)
}

/// Pausa o objetivo com um motivo estável (`error`, `stalled`, `max_rounds`,
/// `interrupted`…). Pausar um objetivo já pausado é no-op.
pub fn pause(
    db: &Db,
    conversation_id: &str,
    reason: GoalPauseReason,
    detail: Option<&str>,
) -> Result<GoalView, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    pause_locked(db, conversation_id, reason, detail)
}

fn pause_locked(
    db: &Db,
    conversation_id: &str,
    reason: GoalPauseReason,
    detail: Option<&str>,
) -> Result<GoalView, GoalError> {
    let mut view = ensure_goal(db, conversation_id)?;
    if view.status == GoalStatus::Paused {
        return Ok(view);
    }
    if view.status != GoalStatus::Active {
        return Err(GoalError::not_active(view.status));
    }
    set_paused(&mut view, reason, optional_detail(detail));
    bump(&mut view);
    append_state(db, conversation_id, None, &view)?;
    Ok(view)
}

/// Retoma um objetivo pausado/bloqueado: volta a `active` **rearmado** e limpa
/// os motivos de pausa/estol/bloqueio (PLAN §7.1).
pub fn resume(db: &Db, conversation_id: &str) -> Result<GoalView, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    resume_locked(db, conversation_id)
}

fn resume_locked(db: &Db, conversation_id: &str) -> Result<GoalView, GoalError> {
    let mut view = ensure_goal(db, conversation_id)?;
    match view.status {
        GoalStatus::Active => return Ok(view),
        GoalStatus::Paused | GoalStatus::Blocked => {}
        GoalStatus::Completed => return Err(GoalError::not_active(view.status)),
    }
    view.status = GoalStatus::Active;
    view.auto_continue = true;
    view.completed_at = None;
    clear_pause(&mut view);
    clear_blocker(&mut view);
    bump(&mut view);
    append_state(db, conversation_id, None, &view)?;
    Ok(view)
}

/// Conclui o objetivo (`complete` da tool ou ação da UI). Idempotente quando
/// já concluído; `summary` vira a última nota (≤2000 chars).
pub fn complete(
    db: &Db,
    conversation_id: &str,
    summary: Option<&str>,
) -> Result<GoalView, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    complete_locked(db, conversation_id, summary)
}

fn complete_locked(
    db: &Db,
    conversation_id: &str,
    summary: Option<&str>,
) -> Result<GoalView, GoalError> {
    let mut view = ensure_goal(db, conversation_id)?;
    if view.status == GoalStatus::Completed {
        return Ok(view);
    }
    let note = match summary.map(str::trim).filter(|summary| !summary.is_empty()) {
        Some(summary) => Some(validate_note(summary)?),
        None => None,
    };
    view.status = GoalStatus::Completed;
    view.auto_continue = false;
    view.completed_at = Some(now_ms());
    clear_pause(&mut view);
    clear_blocker(&mut view);
    if note.is_some() {
        view.last_note = note;
    }
    if view.stalled_rounds != 0 {
        view.stalled_rounds = 0;
    }
    bump(&mut view);
    append_state(db, conversation_id, None, &view)?;
    Ok(view)
}

/// Reabre um objetivo `completed`/`blocked` como `active` **manual**
/// (`autoContinue = false`), preservando as rodadas (PLAN §7.1).
pub fn reopen(db: &Db, conversation_id: &str) -> Result<GoalView, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    reopen_locked(db, conversation_id)
}

fn reopen_locked(db: &Db, conversation_id: &str) -> Result<GoalView, GoalError> {
    let mut view = ensure_goal(db, conversation_id)?;
    match view.status {
        GoalStatus::Active => return Ok(view),
        GoalStatus::Completed | GoalStatus::Blocked => {}
        GoalStatus::Paused => return Err(GoalError::not_active(view.status)),
    }
    view.status = GoalStatus::Active;
    view.auto_continue = false;
    view.completed_at = None;
    clear_pause(&mut view);
    clear_blocker(&mut view);
    bump(&mut view);
    append_state(db, conversation_id, None, &view)?;
    Ok(view)
}

/// Bloqueio **pelo usuário**: imediato, com motivo obrigatório (PLAN §7.5).
pub fn block(db: &Db, conversation_id: &str, reason: &str) -> Result<GoalView, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    block_locked(db, conversation_id, reason)
}

fn block_locked(db: &Db, conversation_id: &str, reason: &str) -> Result<GoalView, GoalError> {
    let mut view = ensure_goal(db, conversation_id)?;
    let reason = validate_reason(reason)?;
    if view.status == GoalStatus::Blocked && view.blocker_reason.as_deref() == Some(&reason) {
        return Ok(view);
    }
    if view.status == GoalStatus::Completed {
        return Err(GoalError::not_active(view.status));
    }
    view.status = GoalStatus::Blocked;
    view.auto_continue = false;
    view.blocker_reason = Some(reason);
    view.blocker_streak = GOAL_BLOCKED_STREAK;
    clear_pause(&mut view);
    bump(&mut view);
    append_state(db, conversation_id, None, &view)?;
    Ok(view)
}

/// Encerra o objetivo (tombstone `goal/deleted`). A auditoria permanece no log;
/// uma criação posterior é permitida e continua a revisão.
pub fn delete(db: &Db, conversation_id: &str) -> Result<(), GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    delete_locked(db, conversation_id)
}

fn delete_locked(db: &Db, conversation_id: &str) -> Result<(), GoalError> {
    let view = ensure_goal(db, conversation_id)?;
    let payload = json!({
        "revision": view.revision,
        "at": now_ms(),
    });
    session::append(db, conversation_id, None, KIND_DELETED, &payload).map_err(|error| {
        GoalError::persistence(format!("não foi possível encerrar o objetivo: {error:#}"))
    })
}

/// Registra uma nota de progresso (tool `progress` ou UI) e **zera o estol**.
/// Exige objetivo `active` ou `paused` (PLAN §8.3).
pub fn note_progress(
    db: &Db,
    conversation_id: &str,
    note: &str,
) -> Result<GoalView, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    note_progress_locked(db, conversation_id, note)
}

fn note_progress_locked(
    db: &Db,
    conversation_id: &str,
    note: &str,
) -> Result<GoalView, GoalError> {
    let mut view = ensure_goal(db, conversation_id)?;
    if !matches!(view.status, GoalStatus::Active | GoalStatus::Paused) {
        return Err(GoalError::not_active(view.status));
    }
    let note = validate_note(note)?;
    view.last_note = Some(note);
    view.stalled_rounds = 0;
    bump(&mut view);
    append_state(db, conversation_id, None, &view)?;
    Ok(view)
}

/// Bloqueio **pela tool**: o mesmo motivo em [`GOAL_BLOCKED_STREAK`] rodadas
/// consecutivas vira `blocked`; antes disso a rodada segue (`blocked = false`).
///
/// O motivo é normalizado (trim/lowercase/espaços) para a comparação, mas
/// exibido como o modelo escreveu (`blocker_reason`, ≤500 chars).
pub fn report_blocker(
    db: &Db,
    conversation_id: &str,
    reason: &str,
) -> Result<BlockerReport, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    report_blocker_locked(db, conversation_id, reason)
}

fn report_blocker_locked(
    db: &Db,
    conversation_id: &str,
    reason: &str,
) -> Result<BlockerReport, GoalError> {
    let mut view = ensure_goal(db, conversation_id)?;
    if view.status != GoalStatus::Active {
        return Err(GoalError::not_active(view.status));
    }
    let note = validate_note(reason)?;
    let normalized = collapse_whitespace(&note).to_ascii_lowercase();
    let previous = view
        .blocker_reason
        .as_deref()
        .map(|reason| collapse_whitespace(reason).to_ascii_lowercase());
    let streak = if previous.as_deref() == Some(normalized.as_str()) {
        view.blocker_streak.saturating_add(1)
    } else {
        1
    };
    view.blocker_reason = Some(truncate_chars(&collapse_whitespace(&note), GOAL_MAX_REASON_CHARS));
    view.blocker_streak = streak;
    view.last_note = Some(note);
    let blocked = streak >= GOAL_BLOCKED_STREAK;
    if blocked {
        view.status = GoalStatus::Blocked;
        view.auto_continue = false;
        clear_pause(&mut view);
    }
    bump(&mut view);
    append_state(db, conversation_id, None, &view)?;
    Ok(BlockerReport {
        goal: view,
        blocked,
    })
}

/* ------------------------------------------------------------------ */
/* Ação da UI com CAS                                                  */
/* ------------------------------------------------------------------ */

/// Aplica uma [`GoalAction`] da UI sob CAS por `expected_revision`
/// (`GOAL_STALE_REVISION` quando a revisão mudou). Devolve o snapshot novo, ou
/// `None` quando a ação foi `delete` (tombstone).
///
/// Ações idempotentes no estado alvo (armar um objetivo armado, concluir um
/// concluído etc.) devolvem o estado atual sem incrementar a revisão.
pub fn update(
    db: &Db,
    conversation_id: &str,
    action: GoalAction,
    input: &UpdateGoalInput,
    expected_revision: Option<u64>,
) -> Result<Option<GoalView>, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    let current = ensure_goal(db, conversation_id)?;
    ensure_revision(&current, expected_revision)?;
    let updated = match action {
        GoalAction::Edit => edit_locked(db, conversation_id, input)?,
        GoalAction::Arm => arm_locked(db, conversation_id)?,
        GoalAction::Disarm => disarm_locked(db, conversation_id)?,
        GoalAction::Pause => pause_locked(
            db,
            conversation_id,
            GoalPauseReason::User,
            input.reason.as_deref(),
        )?,
        GoalAction::Resume => resume_locked(db, conversation_id)?,
        GoalAction::Complete => complete_locked(db, conversation_id, input.summary.as_deref())?,
        GoalAction::Reopen => reopen_locked(db, conversation_id)?,
        GoalAction::Block => block_locked(
            db,
            conversation_id,
            input.reason.as_deref().unwrap_or_default(),
        )?,
        GoalAction::Delete => {
            delete_locked(db, conversation_id)?;
            return Ok(None);
        }
    };
    Ok(Some(updated))
}

/* ------------------------------------------------------------------ */
/* Rodadas (abertura/fecho)                                            */
/* ------------------------------------------------------------------ */

/// Abre a rodada `turn_id` (chamado pelo `run_turn` **antes** de persistir as
/// mensagens): reconcilia uma rodada órfã como `interrupted`, incrementa
/// `rounds`, grava `goal/round-started` + `goal/state` e devolve o snapshot.
///
/// Idempotente por `turnId`. Exige objetivo `active` e orçamento de rodadas.
pub fn begin_round(
    db: &Db,
    conversation_id: &str,
    turn_id: &str,
) -> Result<GoalView, GoalError> {
    let _guard = GOAL_WRITE_LOCK.lock();
    begin_round_locked(db, conversation_id, turn_id)
}

fn begin_round_locked(
    db: &Db,
    conversation_id: &str,
    turn_id: &str,
) -> Result<GoalView, GoalError> {
    let turn_id = turn_id.trim();
    if turn_id.is_empty() {
        return Err(GoalError::invalid_args("o id do turno da rodada não pode ser vazio"));
    }
    let mut view = ensure_goal(db, conversation_id)?;
    if view.status != GoalStatus::Active {
        return Err(GoalError::not_active(view.status));
    }
    let events = list_events(db, conversation_id)?;
    let boundary = goal_boundary_seq(&events, &view);
    let starts = round_starts(&events, boundary);
    if starts.iter().any(|start| start.turn_id == turn_id) {
        // Reabertura do mesmo turno (retry do renderer): não conta de novo.
        return Ok(view);
    }
    if view.rounds >= view.max_rounds {
        return Err(GoalError::max_rounds(view.rounds, view.max_rounds));
    }
    // Crash/reload deixou uma rodada sem `goal/round`: fecha como interrompida
    // antes de abrir a nova (PLAN §6.3) — nunca conta a rodada duas vezes.
    reconcile_interrupted_rounds_locked(db, conversation_id, &view)?;
    let index = view.rounds.saturating_add(1);
    let now = now_ms();
    let payload = json!({ "index": index, "turnId": turn_id, "startedAt": now });
    session::append(
        db,
        conversation_id,
        Some(turn_id),
        KIND_ROUND_STARTED,
        &payload,
    )
    .map_err(|error| {
        GoalError::persistence(format!("não foi possível abrir a rodada: {error:#}"))
    })?;
    view.rounds = index;
    view.last_round_at = Some(now);
    bump(&mut view);
    append_state(db, conversation_id, Some(turn_id), &view)?;
    Ok(view)
}

fn usage_tokens(usage: &UsageInfo) -> u64 {
    if let Some(total) = usage.total_tokens {
        return u64::from(total);
    }
    u64::from(usage.input_tokens.unwrap_or(0))
        .saturating_add(u64::from(usage.output_tokens.unwrap_or(0)))
}

fn optional_u32(value: u64) -> Option<u32> {
    if value == 0 {
        None
    } else {
        Some(u32::try_from(value).unwrap_or(u32::MAX))
    }
}

/// Fecha a rodada `turn_id` com métricas, agrega tokens/custo, detecta progresso
/// e pausa quando necessário (`cancelled → paused(user)`, `error →
/// paused(error)`, limite → `paused(max_rounds)`, estol → `paused(stalled)`).
///
/// - **Progresso** (por `seq` desde o `round-started`): arquivos alterados > 0,
///   novo `todos`, novo `plan/*` ou nota diferente (zera o estol);
/// - **só muda o estado se o objetivo ainda estiver `active`** (conclusão,
///   bloqueio ou pausa do usuário durante a rodada vencem);
/// - **idempotente**: um turno já fechado (ou sem `round-started`, ex.: objetivo
///   criado no meio do turno) é no-op;
/// - devolve `None` quando o objetivo foi encerrado no meio da rodada.
pub fn finish_round(
    db: &Db,
    conversation_id: &str,
    turn_id: &str,
    outcome: &str,
    usage: &UsageInfo,
    files_changed: u32,
) -> anyhow::Result<Option<GoalView>> {
    let _guard = GOAL_WRITE_LOCK.lock();
    finish_round_locked(db, conversation_id, turn_id, outcome, usage, files_changed)
        .map_err(|error| anyhow::anyhow!("{error}"))
}

fn finish_round_locked(
    db: &Db,
    conversation_id: &str,
    turn_id: &str,
    outcome: &str,
    usage: &UsageInfo,
    files_changed: u32,
) -> Result<Option<GoalView>, GoalError> {
    let turn_id = turn_id.trim();
    let Some(current) = load_current(db, conversation_id)? else {
        return Ok(None);
    };
    if turn_id.is_empty() {
        return Ok(Some(current));
    }
    let events = list_events(db, conversation_id)?;
    let boundary = goal_boundary_seq(&events, &current);
    let starts = round_starts(&events, boundary);
    let Some(start) = starts.iter().rev().find(|start| start.turn_id == turn_id) else {
        // Sem abertura de rodada, nada a fechar (ex.: objetivo criado no meio).
        return Ok(Some(current));
    };
    let ends = round_ends(&events, boundary);
    if ends.iter().any(|round| round.turn_id == turn_id) {
        // Já fechada: no-op (nunca conta duas vezes).
        return Ok(Some(current));
    }
    let prior_note = events
        .iter()
        .rev()
        .filter(|event| event.kind == KIND_STATE && event.seq < start.seq)
        .find_map(|event| parse_state_event(event))
        .and_then(|view| view.last_note);
    let now = now_ms();
    let tokens = usage_tokens(usage);
    let cost = usage.cost.unwrap_or(0.0);
    let duration_ms = usage
        .duration_ms
        .unwrap_or_else(|| u64::try_from(now.saturating_sub(start.started_at).max(0)).unwrap_or(0));
    let note_changed = current.last_note != prior_note;
    let plan_or_todos_changed = events.iter().any(|event| {
        event.seq > start.seq
            && (event.kind == session::KIND_TODOS || event.kind.starts_with("plan/"))
    });
    let progressed = files_changed > 0 || plan_or_todos_changed || note_changed;
    let normalized = normalize_outcome(outcome);
    let round = GoalRound {
        index: start.index,
        turn_id: turn_id.to_string(),
        started_at: start.started_at,
        ended_at: Some(now),
        outcome: Some(normalized.to_string()),
        duration_ms: Some(duration_ms),
        tokens: optional_u32(tokens),
        cost: if cost > 0.0 { Some(cost) } else { None },
        files_changed,
        note: if note_changed {
            current.last_note.clone()
        } else {
            None
        },
    };
    append_round(db, conversation_id, &round)?;

    let mut view = current;
    if view.status != GoalStatus::Active {
        // Conclusão/bloqueio/pausa do usuário durante a rodada vencem.
        return Ok(Some(view));
    }
    view.tokens = view.tokens.saturating_add(tokens);
    if cost > 0.0 {
        view.cost += cost;
    }
    view.stalled_rounds = if progressed {
        0
    } else {
        view.stalled_rounds.saturating_add(1)
    };
    view.updated_at = now;
    match normalized {
        CANCELLED => set_paused(
            &mut view,
            GoalPauseReason::User,
            Some("Rodada cancelada; o objetivo continua quando você retomar.".to_string()),
        ),
        ERROR => set_paused(
            &mut view,
            GoalPauseReason::Error,
            Some("A rodada terminou com erro; verifique e retome o objetivo.".to_string()),
        ),
        _ => {
            if view.rounds >= view.max_rounds {
                let max_rounds = view.max_rounds;
                set_paused(
                    &mut view,
                    GoalPauseReason::MaxRounds,
                    Some(format!(
                        "Limite de {max_rounds} rodadas atingido; estenda o limite para continuar."
                    )),
                );
            } else if view.stalled_rounds >= GOAL_STALL_ROUNDS {
                set_paused(
                    &mut view,
                    GoalPauseReason::Stalled,
                    Some(
                        "Sem progresso em 3 rodadas — objetivo pausado para você decidir."
                            .to_string(),
                    ),
                );
            }
        }
    }
    bump(&mut view);
    append_state(db, conversation_id, Some(turn_id), &view)?;
    Ok(Some(view))
}

/* ------------------------------------------------------------------ */
/* Preflight e prompt                                                  */
/* ------------------------------------------------------------------ */

/// Validação da abertura de rodada no `run_turn` (PLAN §7.2/§7.4):
///
/// 1. objetivo existe (`GOAL_NOT_FOUND`) e está `active` (`GOAL_NOT_ACTIVE`);
/// 2. `rounds < maxRounds` (`GOAL_MAX_ROUNDS`);
/// 3. modo Plano inativo (`GOAL_PLAN_MODE`);
/// 4. sem aprovação/pergunta pendente (`GOAL_BUSY`);
/// 5. sem turno/rodada ativos (`GOAL_BUSY`);
/// 6. workspace aberto (`GOAL_NO_WORKSPACE`).
///
/// O harness conhece 3–6 pela sessão e pelo `AppState`; o turno ativo é
/// validado pela camada de comandos (que tem `TurnRegistry`) e rechecado aqui
/// pelo booleano.
pub fn validate_round_start(
    db: &Db,
    conversation_id: &str,
    plan_mode: bool,
    pending_approvals: bool,
    has_workspace: bool,
    has_active_turn: bool,
) -> Result<GoalView, GoalError> {
    let view = ensure_goal(db, conversation_id)?;
    if view.status != GoalStatus::Active {
        return Err(GoalError::not_active(view.status));
    }
    if view.rounds >= view.max_rounds {
        return Err(GoalError::max_rounds(view.rounds, view.max_rounds));
    }
    if plan_mode {
        return Err(GoalError::plan_mode());
    }
    if pending_approvals {
        return Err(GoalError::busy(
            "há uma aprovação ou pergunta pendente; responda antes de iniciar uma rodada",
        ));
    }
    if has_active_turn {
        return Err(GoalError::busy("já existe um turno ativo nesta sessão"));
    }
    if !has_workspace {
        return Err(GoalError::no_workspace());
    }
    Ok(view)
}

/// Mensagem de usuário da rodada (em inglês, PLAN §8.2). É o `content` do turno
/// `goal_round`; o objetivo aparece uma vez por rodada (~1,1k tokens no pior
/// caso com o objetivo de 4k chars).
pub fn round_prompt(goal: &GoalView, round: u32) -> String {
    format!(
        "Continue the session objective — round {} of {}.\n\n\
         Objective: {}\n\n\
         Work autonomously in this round. When the round is finished, call `goal` with action \
         \"progress\" and a one-line note; if the objective is fully met, use \"complete\"; if a \
         real impediment persists, use \"blocked\". Do not ask for confirmation for anything the \
         permission policy already allows.\n",
        round, goal.max_rounds, goal.objective
    )
}

/* ------------------------------------------------------------------ */
/* Testes                                                              */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::TodoStatus;

    fn test_db() -> Db {
        Db::open_in_memory().expect("banco em memória")
    }

    fn input(objective: &str) -> CreateGoalInput {
        CreateGoalInput {
            objective: objective.to_string(),
            title: None,
            max_rounds: Some(5),
            auto_continue: Some(true),
        }
    }

    fn new_goal(db: &Db, objective: &str) -> GoalView {
        create(db, "conv-1", &input(objective), GoalOrigin::User).expect("criar objetivo")
    }

    fn usage(input_tokens: u32, output_tokens: u32, cost: f64) -> UsageInfo {
        UsageInfo {
            input_tokens: Some(input_tokens),
            output_tokens: Some(output_tokens),
            total_tokens: Some(input_tokens.saturating_add(output_tokens)),
            cost: Some(cost),
            duration_ms: Some(1_500),
            ..Default::default()
        }
    }

    fn assert_error(result: Result<impl std::fmt::Debug, GoalError>, code: &str) {
        match result {
            Ok(value) => panic!("esperava erro {code}, veio {value:?}"),
            Err(error) => assert_eq!(error.code, code, "{}", error.message),
        }
    }

    /* ---------------- fold ---------------- */

    #[test]
    fn create_fold_delete_and_recreate_continue_the_revision() {
        let db = test_db();
        assert!(current(&db, "conv-1").expect("fold").is_none());

        let goal = new_goal(&db, "Migrar o módulo de pagamentos");
        assert_eq!(goal.status, GoalStatus::Active);
        assert_eq!(goal.revision, 1);
        assert_eq!(goal.rounds, 0);
        assert_eq!(goal.title, "Migrar o módulo de pagamentos");
        assert!(goal.auto_continue);
        let loaded = current(&db, "conv-1").expect("fold").expect("objetivo");
        assert_eq!(loaded.revision, 1);
        assert_eq!(loaded.objective, "Migrar o módulo de pagamentos");
        assert_eq!(
            db.latest_code_event("conv-1", KIND_STATE)
                .expect("evento")
                .expect("presente")
                .payload
                .contains("\"revision\":1"),
            true
        );

        // Tombstone fecha o fold; nova criação continua a revisão.
        delete(&db, "conv-1").expect("encerrar");
        assert!(current(&db, "conv-1").expect("fold").is_none());
        let recreated = new_goal(&db, "Objetivo novo");
        assert_eq!(recreated.revision, 2);
        assert_eq!(recreated.created_at >= goal.created_at, true);
        assert!(current(&db, "conv-1").expect("fold").is_some());
    }

    #[test]
    fn create_rejects_a_goal_in_progress_and_replaces_a_completed_one() {
        let db = test_db();
        let first = new_goal(&db, "Primeiro objetivo");
        assert_error(
            create(&db, "conv-1", &input("Outro"), GoalOrigin::User),
            "GOAL_ALREADY_EXISTS",
        );

        complete(&db, "conv-1", Some("feito")).expect("concluir");
        let replaced = create(&db, "conv-1", &input("Segundo objetivo"), GoalOrigin::User)
            .expect("substituir concluído");
        assert_eq!(replaced.revision, first.revision + 2, "revisão continua");
        assert_eq!(replaced.rounds, 0);
        assert_eq!(replaced.objective, "Segundo objetivo");
        assert_eq!(replaced.status, GoalStatus::Active);
    }

    #[test]
    fn create_renames_only_a_placeholder_conversation_title() {
        let db = test_db();
        let conversation = db
            .create_conversation_with_mode(
                "Nova conversa",
                "opencode-go",
                "deepseek-v4.1-flash",
                "code",
            )
            .expect("conversa");
        let created = create(
            &db,
            &conversation.id,
            &input("Refatorar o parser"),
            GoalOrigin::Agent,
        )
        .expect("criar via tool");
        let renamed = db
            .get_conversation(&conversation.id)
            .expect("get")
            .expect("conversa");
        assert_eq!(renamed.title, created.title);

        // Título real do usuário nunca é sobrescrito.
        let other = db
            .create_conversation_with_mode(
                "Meu título",
                "opencode-go",
                "deepseek-v4.1-flash",
                "code",
            )
            .expect("conversa 2");
        create(&db, &other.id, &input("Outro objetivo"), GoalOrigin::Agent).expect("criar 2");
        let kept = db
            .get_conversation(&other.id)
            .expect("get 2")
            .expect("conversa 2");
        assert_eq!(kept.title, "Meu título");
    }

    #[test]
    fn create_validates_limits_defaults_and_origin() {
        let db = test_db();
        assert_error(
            create(&db, "conv-1", &input("   "), GoalOrigin::User),
            "GOAL_INVALID_ARGS",
        );
        let oversized = "x".repeat(GOAL_MAX_OBJECTIVE_CHARS + 1);
        assert_error(
            create(&db, "conv-1", &input(&oversized), GoalOrigin::User),
            "GOAL_INVALID_ARGS",
        );

        // Título derivado da primeira linha (≤80 + reticências).
        let long_line = format!("{}\nsegunda linha", "palavras ".repeat(20));
        let goal = create(
            &db,
            "conv-2",
            &CreateGoalInput {
                objective: long_line,
                title: None,
                max_rounds: Some(0),
                auto_continue: Some(true),
            },
            GoalOrigin::User,
        )
        .expect("criar");
        assert!(goal.title.chars().count() <= 80, "{}", goal.title);
        assert!(goal.title.ends_with('…'));
        assert_eq!(goal.max_rounds, 1, "clamp inferior 1");

        // Clamp superior 100.
        let high = create(
            &db,
            "conv-3",
            &CreateGoalInput {
                objective: "Objetivo".into(),
                title: Some("Título".into()),
                max_rounds: Some(GOAL_MAX_ROUNDS_HARD_CAP + 50),
                auto_continue: None,
            },
            GoalOrigin::User,
        )
        .expect("criar");
        assert_eq!(high.max_rounds, GOAL_MAX_ROUNDS_HARD_CAP);
        assert!(high.auto_continue, "default da UI é armar");

        // Tool (agent) no fluxo `/goal`: honra o `auto_continue` explícito do
        // pedido humano (o modelo passa `true` na criação).
        let agent = create(
            &db,
            "conv-4",
            &CreateGoalInput {
                objective: "Objetivo pedido via /goal".into(),
                title: None,
                max_rounds: None,
                auto_continue: Some(true),
            },
            GoalOrigin::Agent,
        )
        .expect("criar objetivo do /goal");
        assert!(agent.auto_continue, "fluxo /goal arma a continuidade");
        assert_eq!(agent.max_rounds, GOAL_MAX_ROUNDS_DEFAULT);
        assert_eq!(agent.title, "Objetivo pedido via /goal");

        // Proposta do agente sem `auto_continue` continua nascendo desarmada
        // (compatibilidade/segurança para chamadas que não são o fluxo /goal).
        let proposal = create(
            &db,
            "conv-5",
            &CreateGoalInput {
                objective: "Proposta do agente".into(),
                title: None,
                max_rounds: None,
                auto_continue: None,
            },
            GoalOrigin::Agent,
        )
        .expect("criar proposta");
        assert!(!proposal.auto_continue, "proposta sem parâmetro nasce desarmada");
    }

    /* ---------------- transições ---------------- */

    #[test]
    fn pause_resume_complete_reopen_and_idempotency() {
        let db = test_db();
        let goal = new_goal(&db, "Refatorar o serviço de cobrança");

        let paused = pause(
            &db,
            "conv-1",
            GoalPauseReason::Error,
            Some("provider caiu"),
        )
        .expect("pausar");
        assert_eq!(paused.status, GoalStatus::Paused);
        assert_eq!(paused.pause_reason, Some(GoalPauseReason::Error));
        assert_eq!(paused.pause_detail.as_deref(), Some("provider caiu"));
        let revision = paused.revision;
        let again = pause(&db, "conv-1", GoalPauseReason::User, None).expect("pausar de novo");
        assert_eq!(again.revision, revision, "pausa é idempotente");

        let resumed = resume(&db, "conv-1").expect("retomar");
        assert_eq!(resumed.status, GoalStatus::Active);
        assert!(resumed.auto_continue, "retomar rearma");
        assert!(resumed.pause_reason.is_none());
        assert!(resumed.pause_detail.is_none());
        let revision = resumed.revision;
        assert_eq!(
            resume(&db, "conv-1").expect("retomar ativo").revision,
            revision,
            "retomar ativo é no-op"
        );

        let completed = complete(&db, "conv-1", Some("Tudo verde: 42 testes")).expect("concluir");
        assert_eq!(completed.status, GoalStatus::Completed);
        assert!(!completed.auto_continue);
        assert!(completed.completed_at.is_some());
        assert_eq!(completed.last_note.as_deref(), Some("Tudo verde: 42 testes"));
        let revision = completed.revision;
        assert_eq!(
            complete(&db, "conv-1", Some("de novo"))
                .expect("concluir de novo")
                .revision,
            revision,
            "concluir é idempotente"
        );

        let reopened = reopen(&db, "conv-1").expect("reabrir");
        assert_eq!(reopened.status, GoalStatus::Active);
        assert!(!reopened.auto_continue, "reabrir volta manual");
        assert!(reopened.completed_at.is_none());
        let revision = reopened.revision;
        assert_eq!(
            reopen(&db, "conv-1").expect("reabrir ativo").revision,
            revision,
            "reabrir ativo é no-op"
        );
        assert_eq!(reopened.rounds, goal.rounds, "rodadas preservadas");
    }

    #[test]
    fn block_by_user_resume_clears_it_and_completed_blocks_actions() {
        let db = test_db();
        new_goal(&db, "Investigar vazamento");
        let blocked = block(&db, "conv-1", "Dependência externa fora do ar").expect("bloquear");
        assert_eq!(blocked.status, GoalStatus::Blocked);
        assert!(!blocked.auto_continue);
        assert_eq!(
            blocked.blocker_reason.as_deref(),
            Some("Dependência externa fora do ar")
        );
        assert_eq!(blocked.blocker_streak, GOAL_BLOCKED_STREAK);
        let revision = blocked.revision;
        assert_eq!(
            block(&db, "conv-1", "Dependência externa fora do ar")
                .expect("bloquear de novo")
                .revision,
            revision
        );

        let resumed = resume(&db, "conv-1").expect("retomar bloqueado");
        assert_eq!(resumed.status, GoalStatus::Active);
        assert!(resumed.blocker_reason.is_none());
        assert_eq!(resumed.blocker_streak, 0);

        // Concluído: pause/resume/reopen têm regras; complete funciona.
        complete(&db, "conv-1", None).expect("concluir");
        assert_error(pause(&db, "conv-1", GoalPauseReason::Error, None), "GOAL_NOT_ACTIVE");
        assert_error(resume(&db, "conv-1"), "GOAL_NOT_ACTIVE");
        complete(&db, "conv-1", None).expect("concluir idempotente");
    }

    #[test]
    fn arm_and_disarm_are_idempotent() {
        let db = test_db();
        let goal = create(
            &db,
            "conv-1",
            &CreateGoalInput {
                objective: "Objetivo manual".into(),
                title: None,
                max_rounds: Some(3),
                auto_continue: Some(false),
            },
            GoalOrigin::User,
        )
        .expect("criar manual");
        assert!(!goal.auto_continue);
        let armed = arm(&db, "conv-1").expect("armar");
        assert!(armed.auto_continue);
        let revision = armed.revision;
        assert_eq!(
            arm(&db, "conv-1").expect("armar de novo").revision,
            revision,
            "armar é idempotente"
        );
        let disarmed = disarm(&db, "conv-1").expect("desarmar");
        assert!(!disarmed.auto_continue);
        let revision = disarmed.revision;
        assert_eq!(
            disarm(&db, "conv-1")
                .expect("desarmar de novo")
                .revision,
            revision,
            "desarmar é idempotente"
        );
    }

    #[test]
    fn edit_validates_and_is_idempotent() {
        let db = test_db();
        new_goal(&db, "Objetivo original");
        let edited = edit(
            &db,
            "conv-1",
            &UpdateGoalInput {
                title: Some("  Novo   título ".into()),
                objective: Some("Objetivo revisado".into()),
                max_rounds: Some(9),
                summary: None,
                reason: None,
            },
        )
        .expect("editar");
        assert_eq!(edited.title, "Novo título");
        assert_eq!(edited.objective, "Objetivo revisado");
        assert_eq!(edited.max_rounds, 9);
        let revision = edited.revision;
        let again = edit(
            &db,
            "conv-1",
            &UpdateGoalInput {
                title: Some("Novo título".into()),
                objective: None,
                max_rounds: Some(9),
                summary: None,
                reason: None,
            },
        )
        .expect("editar valores iguais");
        assert_eq!(again.revision, revision, "edição sem mudança é no-op");
        assert_error(
            edit(
                &db,
                "conv-1",
                &UpdateGoalInput {
                    title: Some("   ".into()),
                    ..Default::default()
                },
            ),
            "GOAL_INVALID_ARGS",
        );
    }

    #[test]
    fn update_applies_cas_and_dispatches_actions() {
        let db = test_db();
        let goal = new_goal(&db, "Objetivo CAS");
        assert_eq!(goal.revision, 1);
        let stale = update(
            &db,
            "conv-1",
            GoalAction::Pause,
            &UpdateGoalInput::default(),
            Some(0),
        );
        assert_error(stale, "GOAL_STALE_REVISION");

        let paused = update(
            &db,
            "conv-1",
            GoalAction::Pause,
            &UpdateGoalInput {
                reason: Some("decisão do usuário".into()),
                ..Default::default()
            },
            Some(1),
        )
        .expect("pausar com CAS")
        .expect("snapshot");
        assert_eq!(paused.status, GoalStatus::Paused);
        assert_eq!(
            paused.pause_detail.as_deref(),
            Some("decisão do usuário")
        );

        let resumed = update(
            &db,
            "conv-1",
            GoalAction::Resume,
            &UpdateGoalInput::default(),
            Some(paused.revision),
        )
        .expect("retomar")
        .expect("snapshot");
        assert_eq!(resumed.status, GoalStatus::Active);

        let deleted = update(
            &db,
            "conv-1",
            GoalAction::Delete,
            &UpdateGoalInput::default(),
            Some(resumed.revision),
        )
        .expect("encerrar");
        assert!(deleted.is_none());
        assert!(current(&db, "conv-1").expect("fold").is_none());
        assert_error(
            update(
                &db,
                "conv-1",
                GoalAction::Resume,
                &UpdateGoalInput::default(),
                None,
            ),
            "GOAL_NOT_FOUND",
        );
    }

    #[test]
    fn note_progress_and_stall_reset() {
        let db = test_db();
        new_goal(&db, "Objetivo com nota");
        let with_note = note_progress(&db, "conv-1", "  li os arquivos  ").expect("nota");
        assert_eq!(with_note.last_note.as_deref(), Some("li os arquivos"));
        assert_error(note_progress(&db, "conv-1", "   "), "GOAL_INVALID_ARGS");
        complete(&db, "conv-1", None).expect("concluir");
        assert_error(
            note_progress(&db, "conv-1", "depois de concluído"),
            "GOAL_NOT_ACTIVE",
        );
    }

    /* ---------------- bloqueio pela tool ---------------- */

    #[test]
    fn report_blocker_streaks_and_blocks_on_the_third_same_reason() {
        let db = test_db();
        new_goal(&db, "Objetivo bloqueado pela tool");
        let first = report_blocker(&db, "conv-1", "testes falham").expect("1/3");
        assert!(!first.blocked);
        assert_eq!(first.goal.blocker_streak, 1);
        assert_eq!(first.goal.status, GoalStatus::Active);

        let second = report_blocker(&db, "conv-1", "  TESTES   falham ").expect("2/3");
        assert!(!second.blocked);
        assert_eq!(second.goal.blocker_streak, 2, "normaliza caixa/espaços");

        let different = report_blocker(&db, "conv-1", "outra coisa").expect("reset");
        assert!(!different.blocked);
        assert_eq!(different.goal.blocker_streak, 1);

        let _ = report_blocker(&db, "conv-1", "outra coisa").expect("2/3");
        let third = report_blocker(&db, "conv-1", "outra coisa").expect("3/3");
        assert!(third.blocked);
        assert_eq!(third.goal.status, GoalStatus::Blocked);
        assert!(!third.goal.auto_continue);
    }

    /* ---------------- rodadas ---------------- */

    #[test]
    fn begin_round_increments_persists_and_is_idempotent_by_turn() {
        let db = test_db();
        new_goal(&db, "Objetivo com rodadas");
        let first = begin_round(&db, "conv-1", "turn-1").expect("rodada 1");
        assert_eq!(first.rounds, 1);
        assert_eq!(first.revision, 2);
        assert!(first.last_round_at.is_some());
        let revision = first.revision;
        let again = begin_round(&db, "conv-1", "turn-1").expect("retry");
        assert_eq!(again.rounds, 1);
        assert_eq!(again.revision, revision, "retry do turno não conta de novo");

        let second = begin_round(&db, "conv-1", "turn-2").expect("rodada 2");
        assert_eq!(second.rounds, 2);
        let last_started = db
            .latest_code_event("conv-1", KIND_ROUND_STARTED)
            .expect("evento")
            .expect("presente");
        assert!(last_started.payload.contains("\"index\":2"));
        assert_eq!(last_started.turn_id.as_deref(), Some("turn-2"));
    }

    #[test]
    fn begin_round_requires_active_goal_and_round_budget() {
        let db = test_db();
        create(
            &db,
            "conv-1",
            &CreateGoalInput {
                objective: "Objetivo curto".into(),
                title: None,
                max_rounds: Some(1),
                auto_continue: None,
            },
            GoalOrigin::User,
        )
        .expect("criar");
        begin_round(&db, "conv-1", "turn-1").expect("rodada 1");
        assert_error(begin_round(&db, "conv-1", "turn-2"), "GOAL_MAX_ROUNDS");

        pause(&db, "conv-1", GoalPauseReason::User, None).expect("pausar");
        assert_error(begin_round(&db, "conv-1", "turn-3"), "GOAL_NOT_ACTIVE");
        assert_error(
            begin_round(&db, "conv-9", "turn-1"),
            "GOAL_NOT_FOUND",
        );
    }

    #[test]
    fn begin_round_reconciles_an_orphan_round_as_interrupted() {
        let db = test_db();
        new_goal(&db, "Objetivo com crash");
        begin_round(&db, "conv-1", "turn-1").expect("rodada 1");
        // Simula crash/reload: nenhum `goal/round` para o turn-1.
        let starts = db
            .list_code_events("conv-1", 1)
            .expect("eventos")
            .into_iter()
            .filter(|event| event.kind == KIND_ROUND_STARTED)
            .count();
        assert_eq!(starts, 1);
        assert!(rounds(&db, "conv-1", 10, false)
            .expect("rodadas")
            .iter()
            .all(|round| round.outcome.as_deref() == Some(INTERRUPTED)));

        let second = begin_round(&db, "conv-1", "turn-2").expect("rodada 2");
        assert_eq!(second.rounds, 2);
        let all = rounds(&db, "conv-1", 10, false).expect("rodadas");
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].index, 2);
        assert_eq!(all[0].outcome.as_deref(), Some(INTERRUPTED));
        assert_eq!(all[1].index, 1);
        assert_eq!(all[1].outcome.as_deref(), Some(INTERRUPTED));
    }

    #[test]
    fn reconcile_interrupted_rounds_unblocks_resume_after_a_crash() {
        let db = test_db();
        new_goal(&db, "Objetivo que sobrevive a crash");
        begin_round(&db, "conv-1", "turn-1").expect("rodada 1");
        // Simula crash: nenhum `goal/round` para o turn-1. O snapshot de
        // `commands::code` degrada a leitura para `paused/interrupted`; o
        // "Retomar" precisa reconciliar antes de aplicar a ação (achado ALTO do
        // QA F4), senão `resume` no estado persistido `active` é no-op e a UI
        // fica em loop no snapshot degradado.
        let viewed = reconcile_interrupted_rounds(&db, "conv-1")
            .expect("reconciliar")
            .expect("objetivo");
        assert_eq!(viewed.status, GoalStatus::Active);
        let listed = rounds(&db, "conv-1", 10, false).expect("rodadas");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].outcome.as_deref(), Some(INTERRUPTED));
        assert!(listed[0].ended_at.is_some());

        // Segunda reconciliação é no-op (não duplica o fecho).
        reconcile_interrupted_rounds(&db, "conv-1").expect("reconciliar 2");
        assert_eq!(rounds(&db, "conv-1", 10, false).expect("rodadas").len(), 1);

        // Depois de reconciliar, a ação da UI devolve o snapshot ativo e a
        // próxima rodada abre normalmente (sem loop paused/interrupted).
        let resumed = update(
            &db,
            "conv-1",
            GoalAction::Resume,
            &UpdateGoalInput::default(),
            None,
        )
        .expect("resume")
        .expect("snapshot");
        assert_eq!(resumed.status, GoalStatus::Active);
        let next = begin_round(&db, "conv-1", "turn-2").expect("rodada 2");
        assert_eq!(next.rounds, 2);
    }

    #[test]
    fn finish_round_aggregates_usage_files_and_closes_the_round() {
        let db = test_db();
        create(
            &db,
            "conv-1",
            &CreateGoalInput {
                objective: "Objetivo medido".into(),
                title: None,
                max_rounds: Some(10),
                auto_continue: Some(true),
            },
            GoalOrigin::User,
        )
        .expect("criar");
        begin_round(&db, "conv-1", "turn-1").expect("abrir");
        let finished = finish_round(
            &db,
            "conv-1",
            "turn-1",
            "done",
            &usage(1_200, 300, 0.05),
            3,
        )
        .expect("fechar")
        .expect("snapshot");
        assert_eq!(finished.tokens, 1_500);
        assert!((finished.cost - 0.05).abs() < f64::EPSILON);
        assert_eq!(finished.stalled_rounds, 0);
        assert_eq!(finished.status, GoalStatus::Active);

        let listed = rounds(&db, "conv-1", 10, false).expect("rodadas");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].index, 1);
        assert_eq!(listed[0].outcome.as_deref(), Some(DONE));
        assert_eq!(listed[0].tokens, Some(1_500));
        assert_eq!(listed[0].files_changed, 3);
        assert_eq!(listed[0].duration_ms, Some(1_500));
    }

    #[test]
    fn finish_round_pauses_on_error_cancel_and_max_rounds() {
        // error ⇒ paused(error)
        let db = test_db();
        new_goal(&db, "Objetivo com erro");
        begin_round(&db, "conv-1", "turn-1").expect("abrir");
        let error = finish_round(&db, "conv-1", "turn-1", "error", &usage(10, 0, 0.0), 0)
            .expect("fechar")
            .expect("snapshot");
        assert_eq!(error.status, GoalStatus::Paused);
        assert_eq!(error.pause_reason, Some(GoalPauseReason::Error));
        assert_eq!(
            rounds(&db, "conv-1", 10, false).expect("rodadas")[0]
                .outcome
                .as_deref(),
            Some("error")
        );

        // cancelled ⇒ paused(user)
        let db = test_db();
        new_goal(&db, "Objetivo cancelado");
        begin_round(&db, "conv-1", "turn-1").expect("abrir");
        let cancelled = finish_round(&db, "conv-1", "turn-1", "cancelled", &UsageInfo::default(), 0)
            .expect("fechar")
            .expect("snapshot");
        assert_eq!(cancelled.status, GoalStatus::Paused);
        assert_eq!(cancelled.pause_reason, Some(GoalPauseReason::User));

        // limite ⇒ paused(max_rounds)
        let db = test_db();
        create(
            &db,
            "conv-1",
            &CreateGoalInput {
                objective: "Objetivo de 1 rodada".into(),
                title: None,
                max_rounds: Some(1),
                auto_continue: Some(true),
            },
            GoalOrigin::User,
        )
        .expect("criar");
        begin_round(&db, "conv-1", "turn-1").expect("abrir");
        let maxed = finish_round(&db, "conv-1", "turn-1", "done", &UsageInfo::default(), 1)
            .expect("fechar")
            .expect("snapshot");
        assert_eq!(maxed.status, GoalStatus::Paused);
        assert_eq!(maxed.pause_reason, Some(GoalPauseReason::MaxRounds));
    }

    #[test]
    fn three_rounds_without_progress_pause_stalled_and_progress_resets() {
        let db = test_db();
        create(
            &db,
            "conv-1",
            &CreateGoalInput {
                objective: "Objetivo que estola".into(),
                title: None,
                max_rounds: Some(10),
                auto_continue: Some(true),
            },
            GoalOrigin::User,
        )
        .expect("criar");

        begin_round(&db, "conv-1", "turn-1").expect("abrir 1");
        let first = finish_round(&db, "conv-1", "turn-1", "done", &UsageInfo::default(), 0)
            .expect("fechar 1")
            .expect("snapshot");
        assert_eq!(first.stalled_rounds, 1);
        assert_eq!(first.status, GoalStatus::Active);

        begin_round(&db, "conv-1", "turn-2").expect("abrir 2");
        let second = finish_round(&db, "conv-1", "turn-2", "done", &UsageInfo::default(), 0)
            .expect("fechar 2")
            .expect("snapshot");
        assert_eq!(second.stalled_rounds, 2);
        assert_eq!(second.status, GoalStatus::Active);

        begin_round(&db, "conv-1", "turn-3").expect("abrir 3");
        let third = finish_round(&db, "conv-1", "turn-3", "done", &UsageInfo::default(), 0)
            .expect("fechar 3")
            .expect("snapshot");
        assert_eq!(third.stalled_rounds, GOAL_STALL_ROUNDS);
        assert_eq!(third.status, GoalStatus::Paused);
        assert_eq!(third.pause_reason, Some(GoalPauseReason::Stalled));

        // Progresso detectado: notas e `todos` resetam o estol.
        let db = test_db();
        create(
            &db,
            "conv-1",
            &CreateGoalInput {
                objective: "Objetivo com progresso".into(),
                title: None,
                max_rounds: Some(10),
                auto_continue: Some(true),
            },
            GoalOrigin::User,
        )
        .expect("criar");
        begin_round(&db, "conv-1", "turn-1").expect("abrir 1");
        finish_round(&db, "conv-1", "turn-1", "done", &UsageInfo::default(), 0).expect("1");
        begin_round(&db, "conv-1", "turn-2").expect("abrir 2");
        finish_round(&db, "conv-1", "turn-2", "done", &UsageInfo::default(), 0).expect("2");
        let before = current(&db, "conv-1").expect("fold").expect("objetivo");
        assert_eq!(before.stalled_rounds, 2);

        begin_round(&db, "conv-1", "turn-3").expect("abrir 3");
        note_progress(&db, "conv-1", "implementei a migração").expect("nota");
        let after_note =
            finish_round(&db, "conv-1", "turn-3", "done", &UsageInfo::default(), 0)
                .expect("fechar 3")
                .expect("snapshot");
        assert_eq!(after_note.stalled_rounds, 0, "nota é progresso");
        assert_eq!(after_note.status, GoalStatus::Active);
        let listed = rounds(&db, "conv-1", 10, false).expect("rodadas");
        assert_eq!(
            listed[0].note.as_deref(),
            Some("implementei a migração"),
            "nota da rodada"
        );

        // Arquivos e `todos` também são progresso.
        begin_round(&db, "conv-1", "turn-4").expect("abrir 4");
        session::save_todos(
            &db,
            "conv-1",
            "turn-4",
            &[crate::domain::TodoItem {
                content: "passo".into(),
                status: TodoStatus::InProgress,
            }],
        )
        .expect("todos");
        let after_todos = finish_round(&db, "conv-1", "turn-4", "done", &UsageInfo::default(), 0)
            .expect("fechar 4")
            .expect("snapshot");
        assert_eq!(after_todos.stalled_rounds, 0, "todos é progresso");
    }

    #[test]
    fn finish_round_is_idempotent_and_respects_user_state() {
        let db = test_db();
        new_goal(&db, "Objetivo idempotente");
        begin_round(&db, "conv-1", "turn-1").expect("abrir");
        let first = finish_round(&db, "conv-1", "turn-1", "done", &usage(10, 5, 0.01), 1)
            .expect("fechar")
            .expect("snapshot");
        let revision = first.revision;
        let again = finish_round(&db, "conv-1", "turn-1", "done", &usage(10, 5, 0.01), 1)
            .expect("fechar de novo")
            .expect("snapshot");
        assert_eq!(again.revision, revision, "fecho repetido é no-op");
        assert_eq!(again.tokens, first.tokens, "não agrega duas vezes");
        let unknown = finish_round(&db, "conv-1", "turn-x", "done", &usage(10, 5, 0.01), 1)
            .expect("turno desconhecido")
            .expect("snapshot");
        assert_eq!(unknown.revision, revision, "turno sem abertura é no-op");

        // Conclusão do usuário durante a rodada vence o fecho.
        begin_round(&db, "conv-1", "turn-2").expect("abrir 2");
        let completed = complete(&db, "conv-1", Some("concluído no meio")).expect("concluir");
        let closed = finish_round(&db, "conv-1", "turn-2", "error", &usage(10, 5, 0.01), 0)
            .expect("fechar")
            .expect("snapshot");
        assert_eq!(closed.status, GoalStatus::Completed);
        assert_eq!(closed.revision, completed.revision, "usuário vence");
        assert_eq!(
            rounds(&db, "conv-1", 10, false).expect("rodadas")[0]
                .outcome
                .as_deref(),
            Some("error"),
            "a rodada ainda é registrada para auditoria"
        );

        // Objetivo encerrado no meio: fecho devolve None.
        delete(&db, "conv-1").expect("encerrar");
        assert!(finish_round(&db, "conv-1", "turn-2", "done", &UsageInfo::default(), 0)
            .expect("fechar sem objetivo")
            .is_none());
    }

    #[test]
    fn rounds_fold_orders_limits_and_marks_the_active_one() {
        let db = test_db();
        create(
            &db,
            "conv-1",
            &CreateGoalInput {
                objective: "Objetivo histórico".into(),
                title: None,
                max_rounds: Some(10),
                auto_continue: Some(true),
            },
            GoalOrigin::User,
        )
        .expect("criar");
        begin_round(&db, "conv-1", "turn-1").expect("abrir 1");
        finish_round(&db, "conv-1", "turn-1", "done", &UsageInfo::default(), 1).expect("fechar 1");
        begin_round(&db, "conv-1", "turn-2").expect("abrir 2");
        finish_round(&db, "conv-1", "turn-2", "done", &UsageInfo::default(), 0).expect("fechar 2");
        begin_round(&db, "conv-1", "turn-3").expect("abrir 3");

        let listed = rounds(&db, "conv-1", 10, true).expect("rodadas");
        assert_eq!(listed.len(), 3);
        assert_eq!(
            listed.iter().map(|round| round.index).collect::<Vec<_>>(),
            vec![3, 2, 1],
            "mais recentes primeiro"
        );
        assert_eq!(listed[0].outcome, None, "rodada em andamento");
        assert_eq!(listed[1].outcome.as_deref(), Some(DONE));

        let limited = rounds(&db, "conv-1", 1, true).expect("limite");
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].index, 3);
        let clamped = rounds(&db, "conv-1", 0, false).expect("limite 0");
        assert_eq!(clamped.len(), 1, "limite mínimo 1");

        // Sem turno ativo a rodada sem fecho é interrompida.
        let interrupted = rounds(&db, "conv-1", 10, false).expect("rodadas");
        assert_eq!(interrupted[0].outcome.as_deref(), Some(INTERRUPTED));

        // Encerrado o objetivo, o histórico some do fold.
        delete(&db, "conv-1").expect("encerrar");
        assert!(rounds(&db, "conv-1", 10, false).expect("rodadas").is_empty());
    }

    #[test]
    fn finish_round_marks_progress_from_file_journal() {
        let db = test_db();
        new_goal(&db, "Objetivo com arquivo");
        begin_round(&db, "conv-1", "turn-1").expect("abrir");
        let snapshot = finish_round(
            &db,
            "conv-1",
            "turn-1",
            "done",
            &UsageInfo::default(),
            2,
        )
        .expect("fechar")
        .expect("snapshot");
        assert_eq!(snapshot.stalled_rounds, 0);
        assert_eq!(snapshot.status, GoalStatus::Active);
        assert_eq!(
            rounds(&db, "conv-1", 10, false).expect("rodadas")[0].files_changed,
            2
        );
    }

    /* ---------------- preflight/prompt ---------------- */

    #[test]
    fn validate_round_start_checks_the_round_contract_in_order() {
        let db = test_db();
        assert_error(
            validate_round_start(&db, "conv-1", false, false, true, false),
            "GOAL_NOT_FOUND",
        );
        let goal = new_goal(&db, "Objetivo validado");

        assert!(validate_round_start(&db, "conv-1", false, false, true, false).is_ok());

        pause(&db, "conv-1", GoalPauseReason::User, None).expect("pausar");
        assert_error(
            validate_round_start(&db, "conv-1", false, false, true, false),
            "GOAL_NOT_ACTIVE",
        );
        resume(&db, "conv-1").expect("retomar");

        assert_error(
            validate_round_start(&db, "conv-1", true, false, true, false),
            "GOAL_PLAN_MODE",
        );
        assert_error(
            validate_round_start(&db, "conv-1", false, true, true, false),
            "GOAL_BUSY",
        );
        assert_error(
            validate_round_start(&db, "conv-1", false, false, true, true),
            "GOAL_BUSY",
        );
        assert_error(
            validate_round_start(&db, "conv-1", false, false, false, false),
            "GOAL_NO_WORKSPACE",
        );

        // Orçamento esgotado: a 5ª rodada aberta já bate o limite (maxRounds 5).
        for turn in ["turn-1", "turn-2", "turn-3", "turn-4"] {
            begin_round(&db, "conv-1", turn).expect("abrir");
            finish_round(&db, "conv-1", turn, "done", &UsageInfo::default(), 1)
                .expect("fechar");
        }
        begin_round(&db, "conv-1", "turn-5").expect("abrir a 5ª rodada");
        let current_goal = current(&db, "conv-1").expect("fold").expect("objetivo");
        assert_eq!(current_goal.rounds, 5);
        assert_error(
            validate_round_start(&db, "conv-1", false, false, true, false),
            "GOAL_MAX_ROUNDS",
        );
        assert_eq!(goal.objective, "Objetivo validado");
    }

    #[test]
    fn round_prompt_has_the_round_and_objective() {
        let db = test_db();
        let goal = create(
            &db,
            "conv-1",
            &CreateGoalInput {
                objective: "Migrar o módulo de pagamentos para o novo SDK".into(),
                title: None,
                max_rounds: Some(25),
                auto_continue: Some(true),
            },
            GoalOrigin::User,
        )
        .expect("criar");
        let prompt = round_prompt(&goal, 3);
        assert!(prompt.contains("round 3 of 25"), "{prompt}");
        assert!(
            prompt.contains("Objective: Migrar o módulo de pagamentos para o novo SDK"),
            "{prompt}"
        );
        assert!(prompt.contains("action \"progress\""), "{prompt}");
        assert!(prompt.contains("use \"complete\""), "{prompt}");
        assert!(prompt.contains("use \"blocked\""), "{prompt}");
    }
}
