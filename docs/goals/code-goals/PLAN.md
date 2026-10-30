# PLAN — Sistema de Goal (Objetivos persistentes) no layout Code

> **Status**: aprovado em 2026-10-29. **Base analisada**: working tree de
> `H:\ChatTauri` em 2026-10-29. **Pedido**: [`GOAL.md`](GOAL.md).
> **Evidência**: [`EVIDENCE.md`](EVIDENCE.md).
>
> **Referências**: [`HARNESS.md`](../code-harness/HARNESS.md),
> [`TOOLS.md`](../code-harness/TOOLS.md),
> [`WORKBENCH.md`](../code-harness/WORKBENCH.md),
> [`dsh-harness-map.md`](../../research/dsh-harness-map.md),
> [`agent-harness-patterns.md`](../../research/agent-harness-patterns.md),
> [`paseo-workbench.md`](../../research/paseo-workbench.md) e o precedente de
> plano/tarefas em [`harness-plan-tasks/PLAN.md`](../harness-plan-tasks/PLAN.md).
>
> **Limite de pesquisa**: `web_search` está sem API key nesta sessão. As
> afirmações sobre DSH/Codex/Paseo vêm dos dossiês locais; onde o dossiê não
> confirma um objeto "goal" no Codex, o item está marcado `[NC]`.

---

## 1. Objetivo, escopo e critérios de sucesso

### 1.1 O que será construído

Um **objetivo único e persistente por sessão do layout Code** que:

1. descreve um resultado de longo prazo (título + objetivo);
2. tem estado persistido (`active | paused | completed | blocked`) e
   continuidade automática opcional (`autoContinue`);
3. permite **rodadas automáticas**: ao fim de um turno bem-sucedido, o agente
   continua sozinho no objetivo, com orçamento de rodadas, até concluir,
   bloquear, pausar, errar ou estourar o limite;
4. é controlável na UI: pill no composer, popover, badge/aba no header, painel
   central com histórico de rodadas, diálogo de edição e divisores de
   rodada no transcript;
5. é visível ao agente no contexto volátil do turno e reportável pela tool
   `goal` (`progress`, `complete`, `blocked`; `create`/`edit` só em turno
   humano).

### 1.2 Princípios não negociáveis

- **Sem segundo loop**: cada rodada é um turno normal de `harness::run_turn`
  com `turnKind = goal_round`.
- **O usuário decide o gasto**: rodadas automáticas só com `autoContinue`
  explicado na UI; default 25 rodadas, hard cap 100.
- **Honestidade de estado**: rodada do objetivo nunca se disfarça de mensagem
  do usuário (divisor próprio no transcript).
- **Política existente vale integralmente**: objetivo não cria caminho de
  escrita/shell/commit; aprovações, plano, permissões, journal e confinamento
  ficam iguais.
- **Prefix cache preservado**: estado do objetivo vive no contexto volátil
  (`surface_item`), nunca no system prompt congelado.
- **Sem retomada invisível**: após reiniciar o app, objetivo armado não roda
  sozinho; o usuário vê o estado e retoma.

### 1.3 Critérios de sucesso (mensuráveis)

1. Criar objetivo pela interface **`/goal` + mensagem** (o agente chama a tool
   `create` com objective/título/limite/continuidade), persiste
   (`code_events` + snapshot), sobrevive a reload e renomeia sessão com título
   placeholder.
2. O turno de criação inicia o trabalho e, com `autoContinue=true`, a rodada 1
   começa ao fim do turno com `turnKind = goal_round`, mensagem de origem
   `goal_round`, contexto de objetivo e tool `goal`.
3. Ao fim de um `done`, no máximo **uma** próxima rodada inicia, e só com:
   objetivo ativo + armado, `rounds < maxRounds`, sem plano, sem
   aprovação/pergunta pendente, sessão ativa no Code e sem streaming.
4. `goal(complete)` encerra a cadeia; `goal(blocked)` só bloqueia após o mesmo
   motivo em 3 rodadas; 3 rodadas sem progresso pausam.
5. Erro/cancel pausa (`error`/`user`); limite pausa (`max_rounds`);
   crash/reload degrada para `interrupted` sem contar rodada duas vezes.
6. Pausar/retomar/reabrir/editar/concluir/encerrar funcionam com CAS por
   `revision` e snapshot autoritativo.
7. System prompt/tools estáveis entre rodadas (teste de hash); contexto volátil
   carrega objetivo, rodada, nota e bloqueio.
8. UI acessível (roles, foco, Esc, `aria-busy`, `aria-live`), pt-BR, tokens do
   design system; sem automação de navegador como evidência.
9. `cargo check`, `cargo test --lib`, `pnpm typecheck`, `pnpm test`,
   `pnpm build` verdes; docs + `EVIDENCE.md`.

### 1.4 Fora de escopo da v1

Múltiplos objetivos/quadro global; indicador na sidebar; notificações;
cron/heartbeat; rodadas em segundo plano com sessão não ativa; orçamento de
tokens/custo; autoaprovação; commit automático; worktrees; multi-agente;
templates; i18n; goal no Chat. Evolução na §17.

---

## 2. Base de referência: o que copiamos e o que não copiamos

| Fonte | Mecânica aproveitada | O que **não** copiamos | Evidência local |
| --- | --- | --- | --- |
| **DSH** (`dsh-goal`, `dsh-goal-round-driver`, `dsh-tool-goal`, `dsh-tool-ralph`) | objetivo único persistente por sessão; projeção `goal/phase/rounds/armed/blocker`; rodadas automáticas com orçamento; `create/edit` só em turno humano; `complete/blocked` em rodada automática; `blocked` exige o mesmo bloqueio ≥3 rodadas; CAS por `revision`; desarme ao retomar | round driver process-wide sem UI; projeções/eventos process-wide; Cordis/plugin loader; rodar sem canal de aprovação visível; default 256 num app desktop pago pelo usuário | [`dsh-harness-map.md`](../../research/dsh-harness-map.md) §6, projeções e tool goal |
| **Codex** | sessão retomável, plano como artefato persistido, compactação automática, turno como unidade de custo/estado, revisão final | app-server/daemon, worktrees, `auto_review` por classificador, cloud | [`agent-harness-patterns.md`](../../research/agent-harness-patterns.md) §2.3 e §7. Dossiê **não** identifica objeto "goal" de primeira classe no Codex — `[NC]` |
| **Paseo** | estado explícito Working/Ready/Done, fecho de turno com tempo/tokens, **heartbeat reenviando prompt ao mesmo agente** (ancestral do round automático), notificação de fim | daemon + CLIs externos, control plane, schedules/cron na v1, worktrees, multi-host, plugins, mobile/web | [`paseo-workbench.md`](../../research/paseo-workbench.md) §3.3 e §4.4 |

**Adaptação declarada**: o Lumina é dono do loop e da UI; o análogo do round
driver do DSH corre no renderer, no app visível, usando o transporte de turno
existente (`runTurn` + `Channel`). Isso preserva aprovações/perguntas
interativas e evita um barramento global de eventos. Rodadas em segundo plano
ficam desenhadas na §17.

---

## 3. Análise do estado atual (o que existe e o que falta)

| Peça existente | Hoje | Reaproveitamento |
| --- | --- | --- |
| `src-tauri/src/harness/code/session.rs` | projeção única sobre `code_events` (plano, tarefas, contexto, compactação) | mesmo padrão: `goal/state` + `goal/round` + fold |
| `code_events` (`db.rs`) | log append-only por conversa (`seq` monotônico) | guardar `goal/state`, `goal/deleted`, `goal/round-started`, `goal/round` |
| `CodeSessionState` + `get_code_session_state` | snapshot da sessão | incluir `goal` e degradar rodada órfã |
| `TurnEvent` (`events.rs`) | streaming + eventos de sessão | adicionar `goal_updated` |
| `run_turn` (`harness/mod.rs`) | loop, `turn/ended`, journal, usage | `turnKind`, validação/abertura/fecho de rodada, contexto de objetivo |
| `TurnPayload` | perfil `chat|code`, opções, turn id | adicionar `turnKind` |
| `ChatMessage` + `messages` | sem origem | `origin` aditivo (`user`/`goal_round`) + migração + renderer próprio |
| `tools/registry.rs` | 23 tools do Code, `ToolSpec` com política/guidance | 24ª tool `goal` |
| `CodeSessionControls` | pills de permissão, Plano, popover "Plano e tarefas" | pill/popover "Objetivo" |
| `CodeSessionHeader` | abas + badges | aba "Objetivo" + badge de atenção |
| `WorkspaceCenter` | views centrais (`plan`, `diff`, `file`, `commits`) | view `goal` com `GoalPanel` |
| `PlanCard` | card acessível com estados/readOnly/edição | molde do `GoalCard`/`GoalAttentionCard` |
| `MessageItem` | bolha do usuário | origem `goal_round` → divisor compacto |
| `chatStore` | `send`/`runTurn`/`done`/`stop` | rodada automática após `done`; `stop` pausa |
| `codeStore` | estado da sessão + reducer | `goal`, `goalRounds`, ações e guardas |
| `AppState` | turnos por id | `has_active_turn_for(conversationId)` |
| `usage`/`turn/ended`/`file_journal`/`todos`/plano | métricas e progresso por turno | agregação e detecção de estol |

**Lacunas**: não existe objetivo persistente, rodada automática, origem de
mensagem, visão de objetivo no header/painel, preflight de rodada, agregação de
progresso nem checagem de turno ativo por conversa.

---

## 4. Decisões de arquitetura (fechadas)

| # | Decisão | Alternativa descartada | Motivo |
| --- | --- | --- | --- |
| D1 | **Um objetivo por sessão** (novo substitui concluído; ativo/pausado/bloqueado exige encerrar) | múltiplos | DSH modela objetivo único; prompt/UI simples |
| D2 | **Projeção em `code_events`** com snapshots `goal/state` + revisão; histórico em eventos | tabela `goals` | fonte única append-only já usada por plano/tarefas |
| D3 | **`status` separado de `autoContinue`** | "armed" como único estado | "ativo manual" é estado real |
| D4 | **Rodada = turno normal** com `turnKind = goal_round` | segundo loop/daemon | reaproveita streaming, cancelamento, aprovações, replay, journal e custo |
| D5 | **Driver no renderer**, só com a sessão ativa no Code | driver Rust com barramento global | turnos/aprovações já viajam pelo `Channel`; evita segundo transporte e rodada sem UI |
| D6 | **Backend autoritativo**: valida antes de persistir, fecha a rodada no fim; `goal_can_continue` é o preflight | confiar só no renderer | corrida/erro de UI não gera rodada inválida nem contagem dupla |
| D7 | **Objetivo só no contexto volátil** | system prompt congelado | preserva prefix cache |
| D8 | **Tool `goal` com `create|edit|progress|complete|blocked`**; pause/resume/arm/disarm/delete são da UI | tool com todas as ações | espelha DSH; o modelo não se autoarma |
| D9 | **Bloqueio após 3 motivos iguais** + **pausa após 3 rodadas sem progresso** | confiar só no autorrelato | DSH não tem avaliador independente; protege custo |
| D10 | **Sem retomada automática após reinício** | rearmar no boot | gasto invisível; DSH desarma em resume/fork |
| D11 | **Default 25 rodadas, cap 100**, override 1..100 | default 256 | app desktop paga tokens do usuário |
| D12 | **`messages.origin` aditivo**; rodada vira divisor | prefixo mágico / não persistir | honestidade e render correto após reload |
| D13 | **Superfícies**: pill+popover, badge/aba, painel central, diálogo, divisor + card de atenção | só um painel | descoberta no composer, detalhe no centro |
| D14 | **Sem flag global**: a existência do objetivo é o gate | `Settings.goalsEnabled` | precedente do prompt-cache; feature inerte sem objetivo |
| D15 | **Objetivo exige workspace aberto** | objetivo sem workspace | rodada de código sem arquivos estola |
| D16 | **Modelo/provider travados na conversa** | escolher por rodada | replay/`provider_state` e custo previsível |
| D17 | **Sem auto-title em rodada**; create renomeia título placeholder | título nascer do prompt | sessão precisa de nome útil |
| D18 | **Somente layout Code** (nativo ou `codeLinked` visto no Code); Chat vê mensagens, sem controles | goal no Chat | pedido explícito; sessões separadas por layout |
| D19 | **Métricas agregadas** sem teto de custo na v1 | orçamento de tokens | escopo; métricas visíveis inibem abuso |
| D20 | **Instância única + checagem de turno ativo por conversa** | locks distribuídos | decisão #13 do repo |

---

## 5. Modelo de domínio (Rust ↔ TypeScript)

### 5.1 Rust (`src-tauri/src/domain.rs`)

```rust
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnKind { #[default] User, GoalRound }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus { Active, Paused, Completed, Blocked }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalPauseReason { User, Error, MaxRounds, Stalled, Interrupted }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalOrigin { User, Agent }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalView {
    pub title: String,
    pub objective: String,
    pub status: GoalStatus,
    pub auto_continue: bool,
    pub rounds: u32,
    pub max_rounds: u32,
    pub revision: u64,
    pub origin: GoalOrigin,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)] pub completed_at: Option<i64>,
    #[serde(default)] pub last_round_at: Option<i64>,
    #[serde(default)] pub last_note: Option<String>,
    #[serde(default)] pub pause_reason: Option<GoalPauseReason>,
    #[serde(default)] pub pause_detail: Option<String>,
    #[serde(default)] pub blocker_reason: Option<String>,
    #[serde(default)] pub blocker_streak: u32,
    #[serde(default)] pub stalled_rounds: u32,
    #[serde(default)] pub tokens: u64,
    #[serde(default)] pub cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalRound {
    pub index: u32,
    pub turn_id: String,
    pub started_at: i64,
    #[serde(default)] pub ended_at: Option<i64>,
    /// `done` | `cancelled` | `error` | `interrupted` (None = em andamento).
    #[serde(default)] pub outcome: Option<String>,
    #[serde(default)] pub duration_ms: Option<u64>,
    #[serde(default)] pub tokens: Option<u32>,
    #[serde(default)] pub cost: Option<f64>,
    #[serde(default)] pub files_changed: u32,
    #[serde(default)] pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalContinuation {
    pub ok: bool,
    #[serde(default)] pub reason: Option<String>,
    #[serde(default)] pub goal: Option<GoalView>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalInput {
    pub objective: String,
    #[serde(default)] pub title: Option<String>,
    #[serde(default)] pub max_rounds: Option<u32>,
    #[serde(default)] pub auto_continue: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalAction { Edit, Arm, Disarm, Pause, Resume, Complete, Reopen, Block, Delete }

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateGoalInput {
    pub title: Option<String>,
    pub objective: Option<String>,
    pub max_rounds: Option<u32>,
    pub summary: Option<String>,
    pub reason: Option<String>,
}
```

- `TurnPayload`: `#[serde(default)] pub turn_kind: TurnKind` e
  `#[serde(default)] pub goal_request: bool` (fluxo `/goal`; intenção do turno,
  não persiste em `messages`).
- `ChatMessage`: `#[serde(default)] pub origin: TurnKind` (relevante em
  `role = user`; assistant usa `User`).
- `CodeSessionState`: `#[serde(default)] pub goal: Option<GoalView>`.
- `events.rs`: `GoalUpdated { goal: GoalView }`.

### 5.2 TypeScript (`src/lib/types.ts`)

```ts
export type TurnKind = 'user' | 'goal_round';
export type GoalStatus = 'active' | 'paused' | 'completed' | 'blocked';
export type GoalPauseReason = 'user' | 'error' | 'max_rounds' | 'stalled' | 'interrupted';
export type GoalOrigin = 'user' | 'agent';
export type GoalAction =
  | 'edit' | 'arm' | 'disarm' | 'pause' | 'resume'
  | 'complete' | 'reopen' | 'block' | 'delete';

export interface GoalView { /* espelho camelCase */ }
export interface GoalRound { /* idem */ }
export interface GoalContinuation { ok: boolean; reason?: string | null; goal?: GoalView | null }
export interface CreateGoalInput { objective: string; title?: string | null; maxRounds?: number | null; autoContinue?: boolean | null }
export interface UpdateGoalInput { title?: string | null; objective?: string | null; maxRounds?: number | null; summary?: string | null; reason?: string | null }

// ChatMessage.origin?: TurnKind
// TurnPayload.turnKind?: TurnKind
// TurnPayload.goalRequest?: boolean (fluxo /goal; instrução vai no runtime context)
// CodeSessionState.goal?: GoalView | null
// TurnEvent | { type: 'goal_updated'; goal: GoalView }
// ToolPresentation | { kind: 'goal'; ...GoalView } (flat, como o plano)
```

### 5.3 Limites e defaults (fonte única em `harness/code/goal.rs`)

| Constante | Valor | Uso |
| --- | --- | --- |
| `GOAL_MAX_OBJECTIVE_CHARS` | 4 000 | validação/UI |
| `GOAL_MAX_TITLE_CHARS` | 120 | título/renome |
| `GOAL_MAX_NOTE_CHARS` | 2 000 | nota de progresso/completação |
| `GOAL_MAX_REASON_CHARS` | 500 | motivo de bloqueio/pausa |
| `GOAL_MAX_ROUNDS_DEFAULT` | 25 | criação |
| `GOAL_MAX_ROUNDS_HARD_CAP` | 100 | clamp no backend |
| `GOAL_STALL_ROUNDS` | 3 | pausa por falta de progresso |
| `GOAL_BLOCKED_STREAK` | 3 | bloqueio por motivo repetido |
| `GOAL_ROUNDS_LIST_LIMIT` | 200 | `list_goal_rounds` |
| `GOAL_MAX_RUNNING_ROUNDS_PER_CONVERSATION` | 1 | preflight/checagem de turno |

Título vazio ⇒ primeira linha do objetivo (até 80 chars + reticências).
`maxRounds` clamp 1..=100. `autoContinue` default: **true na UI**, **false na
tool** (proposta).

---

## 6. Persistência e projeção

### 6.1 Eventos novos em `code_events`

| Kind | Payload | Quando |
| --- | --- | --- |
| `goal/state` | `GoalView` completo | create, edit, arm/disarm, pause/resume, complete/reopen/block, início/fim de rodada, nota |
| `goal/deleted` | `{ revision, at }` | encerrar (tombstone; auditoria preservada) |
| `goal/round-started` | `{ index, turnId, startedAt }` | abertura da rodada, antes do primeiro request |
| `goal/round` | `GoalRound` | fim do turno da rodada (`done/cancelled/error/interrupted`) |

- Snapshots completos simplificam fold e CAS (padrão de `todos`).
- `goal/deleted` fecha o estado; create posterior continua a revisão; fold
  considera `state.seq > deleted.seq`.
- Eventos log-only, nunca entram na superfície do modelo.

### 6.2 Fold (`harness/code/goal.rs`)

```rust
pub fn current(db, conversation_id) -> anyhow::Result<Option<GoalView>>;
pub fn rounds(db, conversation_id, limit: u32) -> anyhow::Result<Vec<GoalRound>>;
```

- `current`: último `goal/state` com `seq` maior que o último `goal/deleted`.
- `rounds`: pareia `round-started`/`round` por `index`/`turnId`, escopo
  `started_at >= goal.created_at`; sem `round` e sem turno ativo ⇒
  `interrupted`; sem `round` com turno ativo ⇒ `None` ("em andamento"); mais
  recentes primeiro, limite 200.
- **Concorrência**: `static GOAL_WRITE_LOCK: parking_lot::Mutex<()>` serializa
  mutações (read-modify-append); instância única. CAS por `expectedRevision`
  para ações da UI.
- **Idempotência**: `begin_round` com `turnId` já registrado retorna o estado;
  `finish_round` de turno já fechado é no-op.

### 6.3 Interrupção e reconciliação

- `commands/code.rs` degrada em leitura (como `degrade_orphan_review`): última
  rodada sem `goal/round` e **sem** turno ativo ⇒ snapshot
  `paused/interrupted`, `autoContinue=false`, `pause_detail` amigável — sem
  gravar.
- `begin_round` reconcilia: grava `goal/round` com `outcome: "interrupted"`
  para a órfã, depois incrementa.
- `AppState` guarda `TurnEntry { cancel, conversation_id }` e expõe
  `has_active_turn_for(conversation_id)` (testável em `TurnRegistry`, sem
  Tauri).

### 6.4 Migração `messages.origin`

- DDL: `origin TEXT NOT NULL DEFAULT 'user'` em `messages` (`db.rs`).
- Migração aditiva `ensure_column` (padrão de `trace`); row
  mapping/insert/update; `ChatMessage::user/assistant` inicializam.
- Bancos antigos: tudo vira `user` (visualização atual). Teste com banco legado
  preservando linhas.

### 6.5 Queries novas

- `db.list_code_events_by_kinds(conversation_id, &[&str], limit)` para o painel
  e o fold.
- `latest_code_event`, `list_file_journal_for_turn`/`turn_changes` já existem.

---

## 7. Ciclo de vida e driver de rodadas

### 7.1 Máquina de estados

```
                 create(auto=true)                  resume
      none ───────────────────────▶ active ◀──────────────── paused
        ▲                             │  ▲                    ▲
        │ delete                      │  │ arm/disarm (idem)  │ pause(user|error|max_rounds|stalled|interrupted)
        └──────────────◀──────────────┘  └────────────────────┘
                                      │ complete
                                      ▼
                                  completed ──reopen──▶ active (manual)
                                      │
                                      └ block(reason) ◀── blocked ──resume──▶ active
```

- `active`: pode rodar (automático se `autoContinue`, manual caso contrário).
- `paused`: só roda após `resume` (rearma); `pauseReason` explica.
- `completed`: terminal; `reopen` volta a `active` **manual**, preservando
  rodadas.
- `blocked`: terminal até `resume`/`reopen` (limpa bloqueio/estol).
- `delete`: tombstone; nova criação permitida.
- `create` com ativo/pausado/bloqueado ⇒ `GOAL_ALREADY_EXISTS`; com
  `completed` ⇒ substitui.

### 7.2 Abertura da rodada (harness)

Depois de provider/modelo/credencial, antes de persistir mensagens:

1. Exigir `profile == Code` e `delegation_depth == 0`.
2. `goal::validate_round_start` — objetivo existe e `active`; `rounds <
   maxRounds`; modo Plano inativo; sem aprovação/pergunta pendente; workspace
   no disco; sem rodada aberta/turno ativo.
3. `goal::begin_round` ⇒ `rounds+1`, `revision+1`, grava `round-started` +
   `state`.
4. `payload.content = goal::round_prompt(&goal, round)`.
5. `prepare_new_turn` grava mensagem com `origin = GoalRound`.
6. Emite `turn_started` e `goal_updated`.

### 7.3 Fecho da rodada (fim do bloco Code)

Depois de `turn/ended`:

1. `outcome = cancelled | error | done`.
2. `files_changed` = journal do turno; `usage` agregado.
3. `goal::finish_round`:
   - fecha `goal/round` com métricas; agrega `tokens`/`cost`;
   - progresso = arquivos > 0 **ou** novo `todos` **ou** novo `plan/*` **ou**
     nota diferente (comparação por `seq` do `round-started`); zera ou
     incrementa `stalled_rounds`;
   - `cancelled` ⇒ `paused(user)`; `error` ⇒ `paused(error, detail)`; senão
     `rounds >= maxRounds` ⇒ `paused(max_rounds)`; senão `stalled >= 3` ⇒
     `paused(stalled)`; senão permanece `active`;
   - **só** altera se o estado ainda estiver `active` (conclusão/bloqueio/pausa
     do usuário vence);
   - revisão +1, grava `goal/state`.
4. Emite `goal_updated` antes de `Done`/`Error`/`Cancelled`.

### 7.4 Preflight oficial (`goal_can_continue`)

Ordem/códigos: `no_goal`, `not_code`, `completed`, `blocked`, `paused`,
`not_armed`, `max_rounds`, `plan_mode`, `pending_approval`, `busy`,
`no_workspace`, `interrupted`. Retorna `{ ok, reason, goal }`; a UI traduz.
`auto=true` exige `autoContinue`; `auto=false` ("Nova rodada") basta `active` +
orçamento + sem plano/aprovação/busy.

### 7.5 Estol, bloqueio e conclusão

- **Estol**: 3 rodadas consecutivas sem arquivos/todos/plano/nota ⇒
  `paused(stalled)`.
- **Bloqueio pela tool**: `blocked` exige `note`; normaliza
  (trim/lowercase/espaços); motivo igual ⇒ `streak+1`, senão `streak=1`;
  `>=3` ⇒ `blocked`, `autoContinue=false`; `<3` responde "registrado (N/3)" e a
  rodada segue.
- **Bloqueio pelo usuário**: ação `block` com motivo ⇒ `blocked` imediato.
- **Conclusão**: `goal(complete)` ou ação `complete` ⇒ `completed`,
  `autoContinue=false`, `completedAt`. Sem avaliador independente; o usuário
  pode `reopen`.
- **Limite**: ao fechar a rodada que atinge `maxRounds` ⇒
  `paused(max_rounds)`; "Estender" edita e retoma.

### 7.6 Autocontinuação no renderer

```ts
// chatStore, case 'done':
void (async () => {
  await useCodeStore.getState().refresh(conversationId);
  await get().maybeContinueGoal(conversationId);
})();

maybeContinueGoal(conversationId):
  if (streaming) return;
  const session = codeStore.byConversation[conversationId];
  if (!shouldContinueGoal({ goal: session?.goal, planMode, approvals, questions,
                            streaming, activeId, conversationId, layoutMode })) return;
  const gate = await api.goalCanContinue(conversationId, true);
  if (!gate.ok) return;
  await get().runGoalRound(conversationId);
```

- `done` é o **único** gatilho (não `error`/`cancelled`).
- `shouldContinueGoal` é pura em `src/lib/goalRunner.ts`: `status==='active'`,
  `autoContinue`, `rounds<maxRounds`, `!planMode`, zero aprovações/perguntas,
  `!streaming`, `activeId===conversationId`, `layoutMode==='code'`.
- `goalStarting` (codeStore) + `streaming` (chatStore) evitam dupla rodada.
- Troca de sessão durante a rodada: a rodada termina, a próxima não inicia;
  objetivo segue armado e o usuário vê "Retomar" ao voltar.

### 7.7 `runGoalRound` no `chatStore`

- Refatorar `send` para um `dispatchTurn` privado reutilizado (sem mudar
  comportamento; testes existentes são a rede).
- Payload: `{ conversationId, content: '', attachmentIds: [], providerId/modelId
  da conversa, reasoning travado, options: turnOptionsFromSettings(),
  profile:'code', turnKind:'goal_round', turnId }`.
- Otimistas: usuário com `origin:'goal_round'` + assistant streaming;
  `streaming.turnKind='goal_round'`.
- Falha antes de `turn_started` ⇒ remove otimistas + toast.
- `stop()`: cancela; se `turnKind==='goal_round'`, `updateGoal('pause')`
  idempotente (o backend também pausa no fecho).

---

## 8. Harness, prompt e tool

### 8.1 Contexto do turno

`CodeTurnContext` ganha `goal: Option<GoalView>` e `turn_kind`;
`prompt_context()` leva ambos. `build_runtime_context(ctx, has_todo_write)` ganha
**## Objective** (volátil, após plano/tarefas):

```markdown
## Objective

Status: active — automatic rounds armed · round 3 of 25 · revision 9
Objective: <objetivo completo>
Tasks: 4/7 completed · Last round: <nota ou "sem resumo">
Blocker: <motivo> (2/3)

- Work autonomously through the objective; do not wait for confirmation for steps the permission policy allows.
- Keep `todo_write` updated; at the end of the round call `goal` with action "progress" and a one-line note.
- Call "complete" only when the objective is fully met, listing the evidence; call "blocked" only if the same real impediment persists for 3 rounds.
- If a user decision is genuinely required, explain it and stop. Do not fabricate progress.
```

Em turno humano, começa com "Session objective (context; follow the user's
message)". O system prompt estável só ganha a guidance da tool, nunca o estado.

### 8.2 Prompt da rodada (mensagem de usuário, em inglês)

```
Continue the session objective — round {n} of {max}.

Objective: {objective}

Work autonomously in this round. When the round is finished, call `goal` with action "progress" and a one-line note; if the objective is fully met, use "complete"; if a real impediment persists, use "blocked". Do not ask for confirmation for anything the permission policy already allows.
```

Custo ~1,1k tokens no pior caso (objetivo de 4k chars), uma vez por rodada.

### 8.3 Tool `goal`

- `name:"goal"`, `parallel: Exclusive`, `risk: Read`, `mutating:false`,
  `requires_workspace:true`, `profiles:[Code]`.
- Schema: `{ action: create|edit|progress|complete|blocked; objective?; title?;
  max_rounds? 1..100; auto_continue?; note? }`, `required:["action"]`,
  `additionalProperties:false`.
- Ativação (v1.12): o usuário usa **`/goal` + mensagem**. O comando apenas ativa
  o chip `/goal` (sem texto automático); `TurnPayload.goalRequest=true` faz o
  harness injetar uma seção volátil `## Goal request` no runtime context dizendo
  para o agente chamar `create` com `objective`, `title`, `max_rounds` e
  `auto_continue` (default do fluxo: **true**); o driver inicia a rodada ao fim
  do turno. Regras: `create` exige objetivo e turno humano
  (`GOAL_REQUIRES_USER_TURN`), sem objetivo ativo (`GOAL_ALREADY_EXISTS`) e
  honra `auto_continue` explícito (sem parâmetro, proposta nasce desarmada);
  `origin=Agent`; `edit` só em turno humano; `progress` exige ativo/pausado e
  zera estol; `complete` em qualquer turno; `blocked` exige `note` e aplica
  streak; sem objetivo `GOAL_NOT_FOUND`.
- Saída curta (1–3 linhas), `presentation` flat `{kind:"goal", ...GoalView}`,
  emite `GoalUpdated`.
- Fora de `readonly_tools()` do subagente (teste).
- Catálogo Code: 23 → 24 tools (ordem estável, após `ask_user` e antes de
  `task`); atualizar contagens em docs/testes.

### 8.4 Política, título e cache

- Objetivo não altera permissões; `goal` é metadado de sessão (como
  `todo_write`).
- Modo Plano: preflight recusa; durante a rodada o agente pode `submit_plan` e
  aguardar; após aprovação continua.
- `Leitura`: rodadas permitidas; estol pausa após 3 sem progresso.
- `auto_title` nunca em `GoalRound`; `create_goal` renomeia título placeholder
  (usar `should_auto_title` como `pub(crate)`).
- Cache: objetivo só em runtime context/surface item; teste garante system
  prompt sem estado e hash system/tools estável entre rodadas.

---

## 9. IPC

### 9.1 Comandos (registrar em `src-tauri/src/lib.rs`)

| Comando | Assinatura | Retorno | Observações |
| --- | --- | --- | --- |
| `create_goal` | `conversationId, input` | `CodeSessionState` | valida Code/workspace/limites; renomeia placeholder; grava `goal/state` |
| `update_goal` | `conversationId, action, input?, expectedRevision?` | `CodeSessionState` | CAS (`GOAL_STALE_REVISION`); idempotente no estado alvo |
| `list_goal_rounds` | `conversationId, limit?` | `GoalRound[]` | mais recentes primeiro; 1..=200 |
| `goal_can_continue` | `conversationId, auto?` | `GoalContinuation` | preflight oficial; usa `has_active_turn_for` |
| `run_turn` (existente) | payload + `turnKind`/`goalRequest` | inalterado | `goal_round` validado; `goalRequest` injeta `## Goal request` no runtime context (turno humano, Code) |
| `get_code_session_state` | — | + `goal` | degrada rodada órfã |

`api.ts`: `createGoal`, `updateGoal`, `listGoalRounds`, `goalCanContinue` +
`TurnPayload.turnKind`.

### 9.2 Evento novo

```ts
| { type: 'goal_updated'; goal: GoalView }
```

Emitido na tool, no início e no fecho da rodada; comandos de UI retornam
snapshot. `codeStore.isCodeEvent` inclui; `applyCodeEvent` seta `goal`.

### 9.3 Fluxo feliz

```
UI: criar → create_goal → snapshot (active, armed)
UI: runGoalRound → run_turn {turnKind: goal_round, content: ""}
  backend: validate → begin_round → turn_started + goal_updated
  loop normal (tools, aprovações, plano, journal, usage)
  tool goal(...) → state + goal_updated
  fim: turn/ended → finish_round → goal_updated → done
UI (done): refresh → goal_can_continue → runGoalRound
```

---

## 10. Interface gráfica (UX/UI)

### 10.1 Superfícies

| Superfície | Componente | Pasta/dono | Função |
| --- | --- | --- | --- |
| Pill no composer | `GoalControls` | `components/composer` (ui-core) | estado/rounds, abrir popover/criar |
| Popover | `GoalControls` + `GoalCard` | composer + agent | resumo, progresso, ações |
| Badge no header | `CodeSessionHeader` | `components/code` (ui-code) | atenção/rodada; abre a aba |
| Aba central | `GoalPanel` | `components/code` (ui-code) | objetivo + histórico |
| Diálogo criar/editar | `GoalDialog` | `components/code` (ui-code) | formulário/limites/perigo |
| Divisor de rodada | `GoalRoundDivider` | `components/chat` (ui-core) | origem `goal_round` |
| Card de atenção | `GoalAttentionCard` | `components/agent` (ui-agent) | pausado/bloqueado/concluído |
| Card da tool | `GoalCard` compact | agent + presentation | timeline |
| `/goal` | `commands.ts` + `Composer` | composer (ui-core) | vira chip de intenção; o agente cria o objetivo |
| Estado global | `uiStore`/`codeStore` | `lib/store` (Lead) | view, diálogo, dados |

### 10.2 Pill + popover

- **Botão somente ícone** (`Target`), sem rótulo/`N/M` (pedido de produto v1.12):
  o estado é comunicado pela cor do ícone, pelo spinner durante a rodada e pelo
  `aria-label`/tooltip (`Objetivo: <status> — Rodada N de M`).
- **Sem objetivo**: o ícone tracejado ativa o chip `/goal` no composer
  (`requestGoalCreation` → evento `lumina:goal-intent`) e foca o campo — a
  criação é sempre "mensagem do usuário → tool `goal` create do agente", nunca
  um formulário nem um prompt automático.
- **Com objetivo**: ativo+auto (`accent-soft`), ativo+manual (outline), pausado
  (`warning-soft`), bloqueado (`danger-soft`), concluído (`success-soft`).
  `aria-label` completo e `aria-expanded` vêm do Radix.
- **Popover** (`w-96 max-w-[calc(100vw-2rem)]`, scroll): título, badge, `N/M`,
  última atividade, tokens/custo, objetivo (2–3 linhas + "Abrir objetivo"),
  progresso, nota/bloqueio, ações: Pausar/Retomar (otimista+rollback), "Nova
  rodada" (desabilitada em streaming), Concluir (confirmação inline), Editar,
  Encerrar (leva ao diálogo), "Abrir objetivo".
- Durante streaming: Pausar = "Pausar após esta rodada" (desarma); demais
  desabilitados; Parar do composer é "parar agora".
- Ações via `codeStore` (snapshot autoritativo); CAS stale ⇒ refresh + toast.

### 10.3 Painel central "Objetivo" (`codeView==='goal'`)

- Abre por pill/badge ou card de atenção (o `/goal` ativa o chip; não abre o
  painel).
- Cabeçalho: `Target`, título, badge, `N/M`, ações.
- Resumo: rodadas, tempo total, tokens, custo, última atividade.
- Objetivo em Markdown sanitizado com scroll/copiar.
- Timeline (`list_goal_rounds`): índice, resultado, duração, arquivos, tokens,
  nota; badges "Em andamento", "Interrompida", "Erro"; cap 200.
- Estados: vazio (CTA), carregando, erro/retry, concluído (Reabrir/Novo),
  bloqueado (motivo + Retomar).
- `role="region" aria-label="Objetivo da sessão"`; foco inicial ao abrir por
  teclado.

### 10.4 Diálogo editar (e modo criação legado)

- **Ativação (v1.12)**: não há mais formulário de criação como caminho de
  produto. O fluxo é `/goal` + mensagem do usuário; o agente cria o objetivo
  com os parâmetros (título/objetivo/limite/continuidade) via tool `goal`.
- O diálogo continua sendo o caminho de **edição** (`Editar objetivo`,
  `Estender limite`) e da zona de perigo `Encerrar objetivo` (confirmação).
- O componente ainda aceita `mode: 'create'` (e o comando `create_goal` segue
  existindo para back-compat/administração), mas **nenhum caminho de UI o abre**
  — `"Criar e começar"`/`"Criar sem começar"` ficam cobertos por testes de
  regressão do componente.
- Campos: título (≤120), objetivo (≤4 000, obrigatório, contador), "Continuar
  automaticamente" (Switch; só editável com objetivo ativo), "Limite de
  rodadas" (1..100), aviso de custo.
- Radix Dialog (foco preso, `Esc`, labels/erros); aberto por
  `uiStore.goalDialog`, renderizado no `WorkspaceCenter`.

### 10.5 Transcript

- `origin==='goal_round'` ⇒ `GoalRoundDivider` (linha, `Target`, "Continuação
  do objetivo", `relativeTime`, spinner quando em andamento), **sem**
  editar/reenviar/regenerar.
- Assistant da rodada é mensagem normal.
- Tool `goal` ⇒ `GoalCard` compacto no `ToolPresentationCard` (`kind:'goal'`),
  sem botões mortos.
- `AgentSteps`: grupo `goal` com `Target` e labels pt-BR ("Progrediu no
  objetivo", "Objetivo concluído", "Objetivo bloqueado", "Falha ao atualizar o
  objetivo").
- `CodeSessionCards` hospeda `GoalAttentionCard`: pausado
  (error/stalled/max/interrupted) com motivo + Retomar/Estender/Abrir;
  bloqueado com Retomar/Concluir; concluído com resumo + Reabrir/Novo.
  Dispensável por revisão (`dismissedGoalRevision` no codeStore).
- Auto-scroll segue o comportamento atual (só se o usuário está no fim).

### 10.6 Header: badge + aba

- Badge após o de aprovações: rodada em andamento (accent+spinner),
  pausado/bloqueado (warning/danger), ativo (`N/M`); concluído não mostra.
  Botão `aria-label="Abrir objetivo"` → `openCodeGoal`.
- Aba "Objetivo" no padrão da aba do plano (`CodeSessionHeader`): `Target`, X
  fecha (`codeGoalOpen=false`), `aria-controls="code-goal-panel"`,
  setas/Home/End/Delete.
- `WorkspaceCenter` renderiza `GoalPanel`/`GoalDialog` conforme `uiStore`.

### 10.7 Composer

- `CodeSessionControls` ganha `<GoalControls>` entre "Plano" e "Plano e
  tarefas" — botão **somente ícone** (sem texto/rounds no botão).
- **Ativação (v1.12)**: `/goal` em `commands.ts` tem `action: 'intent'` — o
  comando vira um **chip `/goal`** dentro do composer (removível), **não altera
  o texto digitado** e não injeta prompt automático. O usuário digita a tarefa e
  envia; `TurnPayload.goalRequest = true` acompanha a mensagem e o runtime
  context instrui o agente a chamar a tool `goal` (action `create`) com
  objective/title/max_rounds/auto_continue. A mensagem do usuário permanece
  exatamente como ele digitou.
- O ícone sem objetivo ativa o mesmo chip (`requestGoalCreation` →
  `lumina:goal-intent`); com objetivo, abre o popover de controle. Nenhum
  caminho abre o formulário de criação.

### 10.8 Matriz de estados

| Estado | Pill | Ações | Badge | Card de atenção |
| --- | --- | --- | --- | --- |
| inexistente | ícone tracejado (sem texto) | ativa o chip `/goal` no composer | — | — |
| active+armed idle | accent (ícone) | pausar, concluir, editar, encerrar, abrir | `N/M` | — |
| active+armed rodando | accent+spinner | pausar após rodada, abrir | spinner+`N/M` | — |
| active+manual | outline (ícone) | armar, nova rodada, concluir, editar, encerrar | `N/M` | — |
| paused(user) | warning | retomar, editar, concluir, encerrar | warning | não |
| paused(error/stalled/max/interrupted) | warning/danger | retomar/estender, abrir, editar, encerrar | warning/danger | sim (dispensável) |
| blocked | danger | retomar, concluir, encerrar | danger | sim |
| completed | success | reabrir, novo objetivo, encerrar | — | sim (dispensável) |
| rodada interrompida | warning | retomar | warning | sim |
| sem workspace | desabilitado + tooltip | — | — | — |

### 10.9 Microcopy (pt-BR)

"Objetivo"; "Criar objetivo com /goal"; "Objetivo da sessão"; "Continuar
automaticamente"; "Até N rodadas"; "Rodada N de M"; "Pausar objetivo";
"Retomar objetivo"; "Nova rodada agora"; "Concluir objetivo"; "Reabrir
objetivo"; "Encerrar objetivo"; "Objetivo pausado"; "Objetivo concluído";
"Objetivo bloqueado"; "O agente continua sozinho até concluir, bloquear ou
atingir o limite de rodadas."; "Cada rodada é um turno completo e consome
tokens do provedor."; "A última rodada foi interrompida. Retome para
continuar."; "Limite de rodadas atingido. Estenda o limite para continuar.";
"Sem progresso em 3 rodadas — objetivo pausado para você decidir."; "Bloqueio
registrado (1 de 3)."; "Objetivo proposto pelo agente" + "Ativar"; "Aguardando
aprovação do plano para continuar."; "Rodada interrompida"; "Sem resumo nesta
rodada".

### 10.10 Acessibilidade, motion e responsivo

- Roles/aria: pill `button`+`aria-expanded`; popover/diálogo Radix
  (foco/Esc/labels/erros); aba `tablist`/`aria-selected`/`aria-controls`;
  divisor `role="separator"` com `aria-label`; card de atenção `role="status"`
  /`alert` quando bloqueado; `aria-live="polite"` anuncia início/fim/pausa.
- Teclado completo; `Esc` fecha; sem armadilha de foco.
- Contraste AA via tokens; nunca só cor — texto/símbolo.
- `prefers-reduced-motion`: sem pulso; transições 150–220 ms.
- Responsivo: pill esconde rótulo em telas estreitas; popover `max-w`; diálogo
  `max-w-lg` com scroll; texto longo `break-words`/truncamento/tooltip.

---

## 11. Fases, donos, escopos e tarefas

Sequência: **F0 → (F1a → F1b → F1c)** em paralelo com **F2** e **F3a**; depois
**F3b/F3c**; **F4** QA; **F5** docs/final. Nenhum dono edita área alheia;
mudanças de contrato passam pelo Lead.

### F0 — Contratos e docs (Lead) — pré-requisito

**Escopos**: `src-tauri/src/{domain,events,state}.rs`, `commands/turn.rs`,
`lib.rs`, `src/lib/{types,api}.ts`, `src/lib/store/uiStore.ts`,
`docs/goals/code-goals/**`, e **apenas linhas mecânicas de inicialização**
(`origin`/`turnKind`) em `db.rs`, `harness/{mod,render}.rs`,
`harness/code/subagent.rs` para o crate compilar (donos revisam).

- [ ] G0.1 tipos Rust (§5), `TurnPayload.turnKind`, `ChatMessage.origin`,
  `CodeSessionState.goal`, `TurnEvent::GoalUpdated`.
- [ ] G0.2 `TurnRegistry` (`register_turn(turn_id, conversation_id)`,
  `has_active_turn_for`), `commands/turn.rs`, testes.
- [ ] G0.3 tipos/API TS, `uiStore` (`codeView 'goal'`, `codeGoalOpen`,
  `goalDialog`, `openCodeGoal/closeCodeGoal/openGoalDialog/closeGoalDialog`).
- [ ] G0.4 `docs/goals/code-goals/{GOAL,PLAN}.md` + esqueleto de
  `EVIDENCE.md`.
- [ ] Gate: `cargo check` e `pnpm typecheck` verdes.

### F1a — Persistência (storage-dev)

**Escopo**: `src-tauri/src/db.rs`.

- [ ] G1.1 `messages.origin` + migração + row mapping/insert/update + teste de
  legado.
- [ ] G1.2 `list_code_events_by_kinds` + teste.
- [ ] Gate: `cargo test --lib` dos testes de db.

### F1b — Núcleo/harness/tool (harness-dev)

**Escopo**: `src-tauri/src/harness/**`, `src-tauri/src/tools/**` (exceto
`tools/genui/**`).

- [ ] G1.3 `harness/code/goal.rs` (constantes, `GoalError`, fold, mutações,
  begin/finish, preflight, `round_prompt`, lock/idempotência).
- [ ] G1.4 contexto/prompt (`CodeTurnContext`, seção `## Objective`).
- [ ] G1.5 `run_turn` (validação/abertura/fecho, `origin`, `GoalUpdated`, skip
  auto-title, recusa em Chat/subagente).
- [ ] G1.6 tool `goal` (spec/exec/registry 24/presentation/guidance) e
  exclusão em subagentes.
- [ ] G1.7 testes Rust da §12.1.
- [ ] Gate: `cargo check` + `cargo test --lib`.

### F1c — Comandos IPC (code-runtime-dev)

**Escopo**: `src-tauri/src/commands/code.rs`; Lead registra em `lib.rs`.

- [ ] G1.8 `create_goal`, `update_goal` (CAS/idempotência),
  `list_goal_rounds`, `goal_can_continue`; snapshot com `goal`; degradação de
  órfã; validação Code/workspace; renome placeholder.
- [ ] G1.9 testes de validação/serialização.
- [ ] Gate: `cargo check` + `cargo test --lib` completos.

### F2 — Renderer: stores, driver e labels (Lead)

**Escopo**: `src/lib/store/{codeStore,chatStore}.ts`,
`src/lib/goalRunner.ts` (novo), `src/lib/agentTrace.ts`, testes.

- [ ] G2.1 `codeStore` (`goal`, `goalRounds`, loading/erro, dismissed,
  `goalStarting`, ações, reducer, `fromSnapshot`).
- [ ] G2.2 `chatStore` (`dispatchTurn`, `runGoalRound`, `maybeContinueGoal`,
  `streaming.turnKind`, `stop`, rollback de otimistas).
- [ ] G2.3 `goalRunner` puro + labels do `agentTrace`.
- [ ] G2.4 testes TS da §12.2.
- [ ] Gate: `pnpm typecheck` + testes focados.

### F3a — Cards (ui-agent)

**Escopo**: `src/components/agent/**`.

- [ ] G3.1 `GoalCard` (full/compact/readOnly, estados, progresso, a11y).
- [ ] G3.2 `GoalAttentionCard` (motivos, ações, dismiss).
- [ ] G3.3 `ToolPresentationCard` `kind:'goal'` + testes.
- [ ] Gate: testes da pasta agent.

### F3b — Composer/chat/centro (ui-core)

**Escopo**: `src/components/composer/**`, `src/components/chat/**`,
`src/components/layout/WorkspaceCenter.tsx`.

- [ ] G3.4 `GoalControls` (pill/popover, ações, otimismo/CAS, streaming) no
  `CodeSessionControls`.
- [ ] G3.5 `/goal` (`commands.ts` + `Composer`).
- [ ] G3.6 `GoalRoundDivider` no `MessageItem`; ícone/labels no `AgentSteps`.
- [ ] G3.7 `WorkspaceCenter` renderiza `GoalPanel`/`GoalDialog`.
- [ ] Gate: testes composer/chat/layout.

### F3c — Superfícies Code (ui-code)

**Escopo**: `src/components/code/**`.

- [ ] G3.8 `GoalDialog` (criar/editar, Switch, validação, perigo, a11y).
- [ ] G3.9 `GoalPanel` (resumo, objetivo, timeline, estados/ações).
- [ ] G3.10 `CodeSessionHeader` (badge/aba/navegação) e `CodeAgentWidgets`
  (hospeda atenção).
- [ ] Gate: testes da pasta code.

### F4 — QA independente (qa-verifier)

- [ ] G4.1 rodar `cargo check`, `cargo test --lib`, `pnpm typecheck`,
  `pnpm test`, `pnpm build`; registrar números.
- [ ] G4.2 revisão adversarial contra o plano (contratos, corrida, custo,
  a11y, migração) e `git status` sem artefatos.
- [ ] G4.3 validar a matriz §1.3 e escrever `EVIDENCE.md`.
- [ ] Sem automação de UI/navegador como evidência (AGENTS.md).

### F5 — Docs e fechamento (Lead)

- [ ] G5.1 `ARCHITECTURE.md` (§4, §5, §8.3, §12, §15, §16 decisão #24).
- [ ] G5.2 `HARNESS.md`/`TOOLS.md`/`WORKBENCH.md` (§ novos, 24 tools,
  estados/copy/a11y, `/goal`).
- [ ] G5.3 `EVIDENCE.md` final + `PLAN.md` com resultado; sem commit salvo
  pedido.

---

## 12. Testes e verificação

### 12.1 Rust (`cargo test --lib`)

| Área | Casos |
| --- | --- |
| DB | migração `origin` preservando linhas; round-trip/default; `list_code_events_by_kinds` (ordem/limite) |
| Fold | create/estado/revisão; `deleted` vence; rounds pareadas; interrompida; `current` após delete |
| Transições | pause/resume/reopen/complete/block/delete; idempotência; `GOAL_STALE_REVISION`; create sobre ativo × completed |
| Rodada | begin incrementa/grava; idempotente por turnId; finish agrega usage/arquivos; error/cancel pausam; max pausa; turnId repetido no-op |
| Estol/bloqueio | 3 sem progresso ⇒ paused(stalled); arquivos/todos/plano/nota resetam; 3 motivos iguais ⇒ blocked; <3 mantém active |
| Tool | create/edit exigem turno humano; sem objetivo/ativo; progress/complete/blocked; limites; presentation+`GoalUpdated`; ausente em subagente |
| Harness | `goal_round` exige Code/top-level/ativo/workspace/plano inativo; recusa antes do provider; contexto; `origin`; skip auto-title; `goal_updated` início/fim; system prompt estável sem estado |
| Comandos | validação Code/workspace; CAS; snapshot com goal; `interrupted`; reasons de `goal_can_continue`; título placeholder |
| TurnRegistry | registra/finaliza/`has_active_turn_for`; não vaza entre conversas |

### 12.2 TypeScript (Vitest)

| Área | Casos |
| --- | --- |
| `goalRunner` | matriz `shouldContinueGoal` (ativo/armado/rounds/max/plano/aprovação/pergunta/streaming/sessão inativa/layout) |
| `codeStore` | `goal_updated`, `fromSnapshot`, create/update/pause/resume/complete/delete, CAS stale ⇒ refresh/toast, `goalStarting`, dismiss |
| `chatStore` | payload de `runGoalRound` (`turnKind`, origem, conteúdo vazio, seleção da conversa); `done` inicia uma rodada; não inicia em erro/cancel/max/plano/inativo; `stop` pausa; falha sem `turn_started` remove otimistas; `send` sem regressão |
| `GoalCard`/`GoalAttentionCard` | estados, readOnly, ações, motivos, dismiss, a11y, texto longo |
| `GoalControls` | pill sem/com objetivo, `aria-expanded`, status/rounds, ações, otimismo/rollback, streaming |
| `GoalDialog` | modo legado (sem entrada de UI), edição, Switch só com objetivo ativo, perigo, Esc/foco |
| `GoalPanel` | vazio (CTA → `/goal` volta para a sessão), carregando, erro/retry, timeline, ações, objetivo longo |
| `MessageItem` | `goal_round` ⇒ divisor, sem editar/regenerar; `user` normal inalterado |
| `Composer`/`commands` | `/goal` ativa o chip (mensagem intocada, sem enviar/abrir painel) e o envio leva `goalRequest: true`; remover o chip volta ao turno normal; filtro |
| `CodeSessionControls` | botão do objetivo somente ícone (`textContent` vazio), `aria-label` completo, ordem Plano → Objetivo → Plano/tarefas |
| `CodeSessionHeader` | badge/aba, teclado, fechamento |
| `WorkspaceCenter` | `codeView='goal'`; regressão das outras views |
| `ToolPresentationCard`/`agentTrace` | `kind:'goal'` real/legado/malformado; labels pt-BR; ícone |

### 12.3 Verificação

```bash
pnpm typecheck
pnpm test
pnpm build
cd src-tauri && cargo check && cargo test --lib
```

Proibido automação de navegador/screenshot como critério (AGENTS.md).
Evidência em `docs/goals/code-goals/EVIDENCE.md`.

---

## 13. Casos de borda, falhas, custo e segurança

| Caso | Comportamento |
| --- | --- |
| Erro de provider/auth na rodada | pausa `error` + detalhe; sem nova rodada; card; usuário retoma |
| Cancelamento | rodada `cancelled`; pausa `user`; `stop` da UI também pausa |
| Aprovação/pergunta pendente | turno bloqueia; preflight recusa `pending_approval`; gate existente |
| Modo Plano | preflight `plan_mode`; após aprovação, próxima rodada inicia |
| Sessão em Leitura | rodadas permitidas; sem progresso 3x ⇒ `paused(stalled)` |
| Workspace removido | preflight `no_workspace`; pill desabilitado/card com CTA |
| App fechado no meio da rodada | sem `goal/round`; snapshot `paused/interrupted`; retomar grava `interrupted` sem recontar |
| Troca de sessão durante a rodada | rodada termina; próxima não inicia; objetivo segue armado; "Retomar" ao voltar |
| Duplo clique/duas abas | `goalStarting` + `streaming` + preflight `busy` + validação no harness |
| `maxRounds` < `rounds` | permitido com aviso; preflight pausa; "Estender" corrige |
| Conclusão incorreta | usuário reabre (`reopen` manual); sem avaliador independente (documentado) |
| Delete durante a rodada | rodada termina; `finish_round` não ressuscita; painel fecha; nova criação permitida |
| Reinício com objetivo armado | não roda sozinho; snapshot ativo/armado; "Retomar" inicia |
| Custo | 25 default, cap 100, métricas visíveis, pausa por erro/estol/max, sem retomada no boot |
| Segurança | nenhum caminho novo de escrita/shell/commit; política/aprovação valem; objetivo é intenção do usuário ou proposta desarmada do agente |
| Prompt injection | objetivo de agente é proposta desarmada e visível; nenhum conteúdo externo é executado |
| Busca/preview | prompts de rodada entram no histórico/busca como mensagens normais; documentado |

---

## 14. Migração, compatibilidade e rollback

- **Aditivo**: coluna com default, campos serde `#[serde(default)]`, evento e
  comandos novos; snapshot antigo (sem `goal`) válido; UI degrada.
- Bancos antigos: migração na abertura preservando linhas; sem tabela nova.
- Rollback de release: código antigo ignora `goal/*` e `origin`; dados
  preservados para release futura.
- Sem flag global: feature inerte sem objetivo; tool `goal` no catálogo Code
  (uma invalidação de cache de tools, esperada).
- Instância única (decisão #13); rodadas usam checagem por conversa.

---

## 15. Documentação

| Documento | Mudanças |
| --- | --- |
| `docs/goals/code-goals/{GOAL,PLAN,EVIDENCE}.md` | novo |
| `docs/ARCHITECTURE.md` | §4 fluxo com `turnKind`; §5 `origin` + `goal/*`; §8.3 objetivo/24 tools; §12 IPC; §15 testes; §16 decisão #24 |
| `docs/goals/code-harness/HARNESS.md` | §3 ciclo de rodada; §6 objetivo × plano/permissões; §10.4 contexto volátil; §11.2 projeção; §12.1/12.2 eventos/comandos |
| `docs/goals/code-harness/TOOLS.md` | §1.2 classe; §2.5 `goal`; §4 orçamento; §5 testes; §6 códigos |
| `docs/goals/code-harness/WORKBENCH.md` | §4 badge/aba; §5.6 objetivo/divisor/card; §6 pill; §8.8 fluxo; §9 estados; §10 a11y; §12 `/goal`; §13 copy; §15 testes |
| `docs/DESIGN.md` | referência curta às superfícies (se necessário) |
| `AGENTS.md` | sem nova área/owner; nada a mudar |

---

## 16. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Custo descontrolado | default 25, cap 100, armar explícito, pausa por erro/estol, sem retomada no boot, métricas visíveis |
| Rodada dupla/corrida | `goalStarting`, `streaming`, preflight `busy`, lock de escrita, idempotência, validação no harness |
| Cache quebrado | objetivo só em runtime context/surface item; teste de hash system/tools |
| UI ruidosa | pill compacta, badge só em atenção, card dispensável, painel sob demanda |
| Modelo ignora/“finge” progresso | contexto com regras, tool, detector de estol, conclusão reabrível |
| Migração em bancos grandes | coluna aditiva, teste de legado, sem backfill complexo |
| Divergência Rust↔TS | contratos por lado + testes; `pnpm typecheck` |
| Escopo (segundo plano/notificações) | não-objetivos explícitos; contratos desenhados para evolução |
| Aprovações sem UI | driver só com sessão ativa; preflight; gates existentes |
| Falso “concluído” | sem avaliador independente; UI reabre; evidência pedida na nota |

---

## 17. Não-objetivos e evolução

1. **Rodadas em segundo plano** (sessão não ativa): exigiria barramento global
   (`AppHandle::emit` + `listen`) ou `streamingByConversation`; desenho:
   `GoalDriver` em Rust após `finish_round`, emitter global e UI reconstruindo
   por `message_updated`. Fase 6, sem mudar o domínio.
2. **Indicador na sidebar**: `list_goal_overviews()` + badge `Target` (query
   agregada).
3. **Notificações** ao concluir/bloquear: usa `Settings.notifications_enabled`
   (hoje sem implementação).
4. **Orçamento de tokens/custo** e estimativa de tempo: campos adicionais +
   preflight.
5. **Schedules/heartbeat** (Paseo): cron reenviando prompt; depende de executor
   em background.
6. Múltiplos objetivos/quadro global, templates, compartilhamento entre
   sessões, ACP, worktrees, commit automático.

---

## 18. Task board proposto

| ID | Fase | Dono (papel) | Escopo de escrita | Depende | Aceite |
| --- | --- | --- | --- | --- | --- |
| G0.1 | F0 | Lead | `domain/events/state.rs`, `commands/turn.rs`, `lib.rs` (+ literais mecânicos) | — | `cargo check` |
| G0.2 | F0 | Lead | `types/api.ts`, `store/uiStore.ts`, `docs/goals/code-goals/**` | — | `pnpm typecheck` |
| G1.1 | F1a | storage-dev | `src-tauri/src/db.rs` | G0.1 | testes db |
| G1.2 | F1b | harness-dev | `src-tauri/src/harness/**` | G0.1, G1.1 | `cargo test --lib` |
| G1.3 | F1b | harness-dev | `src-tauri/src/tools/**` | G1.2 | testes tool |
| G1.4 | F1c | code-runtime-dev | `src-tauri/src/commands/code.rs` | G1.2 | `cargo check/test` |
| G2.1 | F2 | Lead | `store/{codeStore,chatStore}.ts`, `goalRunner.ts`, `agentTrace.ts` | G0.2 | testes TS |
| G3.1 | F3a | ui-agent | `src/components/agent/**` | G0.2 | testes agent |
| G3.2 | F3b | ui-core | `components/{composer,chat}/**`, `layout/WorkspaceCenter.tsx` | G2.1, G3.1 | testes |
| G3.3 | F3c | ui-code | `src/components/code/**` | G2.1, G3.1 | testes |
| G4.1 | F4 | qa-verifier | leitura + `EVIDENCE.md` | todas | suítes verdes + revisão |
| G5.1 | F5 | Lead | `docs/**`, `EVIDENCE.md` final | todas | docs + aceite |

**Coordenação**: tasks com `write_scopes`; Lead distribui antes de spawnar;
ninguém edita escopo alheio; Lead revisa o diff final e roda a verificação
completa; QA independente não corrige código.

---

## 19. Checklist final de aceite

- [ ] Criar/editar/encerrar objetivo persiste e sobrevive a reload; título
  placeholder renomeado.
- [ ] `/goal` ativa um chip no composer sem alterar a mensagem; o usuário
  digita o pedido, envia (com `goalRequest=true`) e o agente cria o objetivo
  com os parâmetros; a rodada 1 inicia com `turnKind=goal_round`, origem
  correta, contexto e tool (quando `autoContinue=true`).
- [ ] Autocontinuação no máximo uma vez por `done`, só nas condições da §7.6;
  sem rodada em erro/cancel/max/plano/inativo.
- [ ] Pausar/retomar/reabrir/concluir/bloquear/estender consistentes e com CAS.
- [ ] Estol e bloqueio após 3 rodadas; erro/cancel pausam; rodada interrompida
  reconciliada.
- [ ] Prompt estável/cache preservados; runtime context com objetivo.
- [ ] UI completa (pill/popover, badge/aba, painel, diálogo, divisor, card),
  pt-BR, acessível, responsiva.
- [ ] `cargo check`, `cargo test --lib`, `pnpm typecheck`, `pnpm test`,
  `pnpm build` verdes.
- [ ] Docs (`ARCHITECTURE`, `HARNESS`, `TOOLS`, `WORKBENCH`) + `EVIDENCE.md`;
  sem automação de navegador; sem commit salvo pedido.

---

**Assunções explícitas**: instância única do app (decisão #13); renderer
confiável (backend revalida); uma sessão ativa por layout; modelo/provider da
conversa nas rodadas; default de 25 rodadas ajustável na revisão sem mudar
contratos; Codex não expôs um objeto "goal" nas fontes consultadas `[NC]` — se
houver feature específica a espelhar, entra como ajuste de fase 1 sem alterar a
arquitetura.

---

## 20. Resultado da execução (2026-10-29)

Executado na working tree de `feat/code-harness` **sem commit** (conforme o fluxo
do repo). Evidência detalhada em [`EVIDENCE.md`](EVIDENCE.md).

| Fase | Dono | Resultado |
| --- | --- | --- |
| F0 — contratos | Lead | `TurnKind`/`GoalView`/`GoalRound`/... em `domain.rs`, `TurnEvent::GoalUpdated`, `TurnPayload.turnKind`, `ChatMessage.origin`, `TurnRegistry` (`has_active_turn_for`), tipos/API/`uiStore` TS; docs criados |
| F1a — db | storage-dev | `messages.origin` (DDL + migração aditiva + round-trip), `list_code_events_by_kinds`; 3 testes novos |
| F1b — goal core | harness-dev | `harness/code/goal.rs` (fold/mutações/CAS/lock/begin/finish/estol/bloqueio), integração `run_turn`/contexto/prompt/tool `goal` (24 tools), 37 testes novos |
| F1c — IPC | code-runtime-dev | `create_goal`/`update_goal`/`list_goal_rounds`/`goal_can_continue`, snapshot com `goal` + degradação de órfã, renome de título placeholder; 8 testes novos |
| F2 — stores/driver | Lead | `codeStore` (goal/rounds/CAS/otimista), `chatStore` (`runGoalRound`/`maybeContinueGoal`/`turnKind`/`stop`), `goalRunner`, `agentTrace`; testes |
| F3a/b/c — UI | ui-agent/ui-core/ui-code | `GoalCard`/`GoalAttentionCard`, `GoalControls`/`/goal`/divisor/`WorkspaceCenter`, `GoalDialog`/`GoalPanel`/header/`CodeSessionCards`; +~150 testes TS |
| F4 — QA | qa-verifier | 5 suítes verdes, revisão adversarial, `EVIDENCE.md`; 1 ALTO + 2 MÉDIOS |
| F4.1 — correções | Lead | ALTO (reconciliação de rodada órfã em `update_goal`), MT1 (`list_code_events_by_kinds` no fold), MT2 (`onReopen`), BAIXOs (switch em objetivo não-ativo, rename propagado); revalidado pelo QA |
| F4.2 — fluxo `/goal` | Lead | Ativação trocada para **`/goal` + mensagem → agente cria o objetivo**; o comando ativa um **chip** no composer (sem prompt automático), a mensagem é enviada intacta com `goalRequest=true` e o runtime context instrui a tool `goal` create (objective/title/max_rounds/auto_continue=true); botão do objetivo **somente ícone**; diálogo fica só para edição; CTA do painel volta o centro para a sessão; rename do título placeholder na tool + auto-title relê o título vivo |
| F5 — docs | Lead | `ARCHITECTURE` (§4/§5/§8.3/§12/§15/§16), `HARNESS` §15, `TOOLS` §7, `WORKBENCH` §17; este resultado |

**Verificação final (working tree)**: `cargo check` ok; `cargo test --lib` **992
passed / 0 failed / 13 ignored**; `pnpm typecheck` ok; `pnpm test` **127 files /
2354 tests**; `pnpm build` ok. Sem automação de navegador. QA final (F4.1),
revalidação do fluxo `/goal` (F4.2) e do ajuste do CTA (F4.2.1): **aprovados**
(`EVIDENCE.md` §9–§12).

**Achados do QA tratados**: (1) ALTO — "Retomar" após crash ficava em loop
`paused/interrupted` (corrigido com `goal::reconcile_interrupted_rounds` chamado
por `update_goal` quando não há turno ativo + teste de fluxo); (2) MÉDIO — fold
lia o log inteiro (agora usa `list_code_events_by_kinds`); (3) MÉDIO — card de
atenção concluído sem "Reabrir" (adicionado `onReopen`). BAIXOS residuais
documentados no EVIDENCE (guards curtos, warnings de contrato, TOCTOU do busy,
appends não transacionais, aria-live/reduced-motion, rótulo de objetivo
proposto, fechamento de aba ao encerrar durante rodada).