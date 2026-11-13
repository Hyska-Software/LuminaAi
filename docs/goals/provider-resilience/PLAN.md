# Resiliência de requests aos provedores — retry, timeouts e persistência de falhas

**Intent:** todo request de completion (4 protocolos × todos os provedores do catálogo) passa a
ter classificação de erro tipada, retry automático com backoff/jitter e `Retry-After`,
timeouts completos (headers, primeiro evento, idle, total) e detecção de stream truncado.
Uma falha deixa de "apagar" o turno: a mensagem do usuário, o placeholder do assistente, o
texto parcial, o `usage` e o erro estruturado (código + dica + tentativas) ficam no SQLite e
sobrevivem a reload/reabertura do app. O histórico enviado depois de um erro continua válido
para os quatro protocolos.

**Truth Owner:** o backend é dono da verdade.
- `providers::retry` é o **único dono** da classificação (retryable/permanente), do cálculo de
  backoff/jitter e da leitura de `Retry-After`.
- `providers::sse` é dono dos deadlines do stream; cada adapter só informa o sinal terminal do
  seu protocolo.
- O harness é dono do loop de tentativas (só ele sabe se já houve output para a UI), do
  `TurnEvent::Retrying` e da persistência do erro.
- O renderer só projeta: não recalcula backoff, não decide retry e não inventa código de erro.

---

## 1. Estado atual (evidências)

### 1.1 Retry

| Local | Comportamento hoje |
|---|---|
| `providers/mod.rs:931` (`stream_completion`) | Tenta o próximo **protocolo** apenas em `UnsupportedProtocol`. Qualquer outro erro encerra. |
| `providers/mod.rs:780` (`send_stream_with_cache_fallback`) | Um único fallback: remove o plano de cache quando o 400 nomeia um campo de cache. |
| `harness/mod.rs:2887-2952` | Uma tentativa extra para `StreamStalled` (somente se o attempt está vazio) e um refresh OAuth para 401 com bearer. Nada mais. |
| `harness/mod.rs:3356-3408` | A resposta final forçada tem o mesmo retry único de 401, e **nenhum** retry de stall. |
| `providers/mod.rs:505` (`from_http`) | 5xx e 408 → `Other` (permanente, sem código/dica). 529 (Anthropic overloaded) não é tratado. `Retry-After` nunca é lido. |
| Adapters | Erro dentro do stream vira `ProviderError::Other` e nunca é classificado (`openai_chat.rs:354`, `google.rs:303`, `anthropic.rs:468`); só `openai_responses.rs:345` usa `from_stream_error`. |

Consequência: um 429, um 503, um reset de conexão ou um timeout encerra o turno imediatamente,
mesmo quando o request não produziu nenhum token.

### 1.2 Timeouts

| Local | Comportamento hoje |
|---|---|
| `http.rs:5-16` | `connect_timeout` 20 s, sem timeout total (correto para streaming, mas não cobre um proxy que aceita a conexão e nunca responde headers). |
| `providers/mod.rs:702` (`send_stream`) | `builder.json(body).send()` sem deadline: se os headers não chegam, o request fica pendurado (o watchdog do SSE só começa depois dos headers). |
| `providers/sse.rs:29-31` | `FIRST_EVENT_TIMEOUT = 180 s`, `IDLE_TIMEOUT = 120 s`, constantes não configuráveis. |
| `providers/sse.rs:181` | Não há deadline **total** do stream: um provedor que emite 1 token a cada 119 s mantém o request vivo indefinidamente. |
| `commands/models.rs:353` | Listagem de modelos tem 25 s por página e nenhum retry. |
| `harness/mod.rs:62` | Checkpoint do stream a cada 500 ms (bom; preserva parciais durante o request). |

### 1.3 Classificação

`ProviderError` (`providers/mod.rs:459-625`) não tem variante para timeout nem para stream
interrompido; `Network` é usada para tudo (`send_stream`, leitura de SSE, canal de eventos
fechado). `from_http` transforma **qualquer** 400 com `code` em `UnsupportedCapability`
(`mod.rs:517-523`) e qualquer 5xx em `Other`, então a UI não recebe código nem consegue decidir
retry.

### 1.4 Persistência

- Falha **no request** (depois do setup): o turno persiste a mensagem do usuário e o
  placeholder, grava `usage` do attempt e chama `update_message` (`harness/mod.rs:3570-3592`).
- Falha **antes do request**: credencial ausente/inválida, modelo inexistente ou nenhum
  protocolo resolvem **antes** de persistir qualquer coisa (`harness/mod.rs:4987-4998`; teste
  explícito em `harness/mod.rs:8022-8068`). O renderer só recebe
  `TurnEvent::Error` em memória (`commands/turn.rs:141-153`). Ao recarregar, a mensagem que o
  usuário digitou desaparece — exatamente o sintoma reportado.
- O erro não é persistido: `ChatMessage`/`messages` não têm coluna de erro
  (`domain.rs:544-580`, `db.rs:438-458`), `TurnResult.error` é só `String`
  (`domain.rs:814-823`), e `openConversation` não reidrata `error/errorCode/errorHint`
  (`chatStore.ts:1788-1900`). Depois de um reload o banner some e a bolha do assistente fica
  vazia, sem motivo nem dica.
- Texto parcial perdido: no branch de falha, `step_text` entra só no `trace`
  (`harness/mod.rs:3084-3093`) e **não** em `full_text` (que só é atribuído no passo final,
  `mod.rs:3149`). O usuário viu o texto durante o streaming; depois do reload ele não existe.

### 1.5 Replay depois do erro (o que está correto e o que não está)

Correto hoje:
- Os quatro adapters descartam mensagens `assistant` vazias: `openai_chat.rs:204-210`,
  `anthropic.rs:145-184`, `google.rs:152-177`, `openai_responses.rs:221-251`. Um erro sem texto
  não gera bloco vazio no wire.
- Tool calls que falharam continuam pareadas com um tool result sintético
  (`harness/mod.rs:3078-3093`), então o próximo request não é rejeitado por tool result órfão
  (`debug_assert_tool_results_are_paired`).
- `arguments` são saneados no replay (`valid_json_arguments`, `parse_arguments`), então JSON
  parcial não quebra 400 na Anthropic/Google.
- `provider_state` é congelado por modelo/provedor; um passo falho não tem estado verbatim e cai
  no fallback neutro.
- Retry não muda o prefixo: o body é recomputado igual, e o digest de cache permanece o mesmo.

Incorreto/vulnerável:
- O resultado sintético diz `"Interrompida por um erro do provedor."` — em português, embora
  seja conteúdo enviado ao modelo. Deve ser um texto neutro em inglês que deixe claro que a
  ferramenta **não foi executada**.
- Mensagem de erro vazia (`status = error`, sem texto, sem tool calls) continua entrando no
  histórico (`mod.rs:4216` só ignora `Streaming` + vazio). Hoje é inofensivo porque os adapters
  ignoram, mas polui o cálculo de contexto e depende de cada adapter.
- Sem detecção de stream truncado: `stream_sse` retorna `Ok(())` no EOF
  (`sse.rs:218-236`) e `handler.finish()` é chamado sempre (`openai_chat.rs:44-56`). Um stream
  cortado no meio é persistido como `Complete`, e o próximo turno reenvia esse texto
  incompleto como se fosse resposta do modelo.

### 1.6 UI atual

- `TurnErrorBanner` só aparece com `errorCode` no store (memória); após reload não há banner.
- `MessageItem` mostra o card de falha só com `status === 'error'` e esconde o conteúdo nesse
  status (`MessageItem.tsx:282`), então texto parcial + erro não podem coexistir na UI atual.
- O botão "Tentar novamente" chama `regenerate()` para qualquer erro, inclusive permanentes.
- O front trata o invoke que rejeita marcando a bolha como erro em memória
  (`chatStore.ts:1340-1379`), sem nada persistido quando a falha foi pré-request.
- Não existe fase de UI para "tentando de novo".

---

## 2. Problemas confirmados

| ID | Sintoma | Evidência | Correção |
|---|---|---|---|
| R1 | Nenhum retry para 429/5xx/rede/timeout | §1.1 | Política central de retry no harness + classificação em `ProviderError` |
| R2 | `Retry-After` ignorado; sem jitter/backoff | §1.1 | `providers::retry` lê headers e calcula backoff com jitter |
| R3 | Request pode pendurar antes dos headers | §1.2 | Deadline de headers em `send_stream` |
| R4 | Stream sem deadline total e sem sinal terminal | §1.2/§1.5 | `StreamTimeouts` + detecção de término por protocolo |
| R5 | Erro vira `Other`: sem código, sem dica, sem retry | §1.3 | Taxonomia tipada (`Transient`, `Timeout`, `StreamInterrupted`, …) |
| R6 | Falha pré-request não persiste nada | §1.4 | Persistir usuário + erro para turnos novos |
| R7 | Erro não persiste (banner/código somem no reload) | §1.4 | `messages.error` + `MessageUpdated`/`TurnResult` |
| R8 | Texto parcial some do banco após erro | §1.4 | `full_text = step_text` no branch de falha (com trace sem duplicar) |
| R9 | Stream truncado salvo como sucesso | §1.5 | `StreamInterrupted` quando falta sinal terminal |
| R10 | Retry manual oferecido a erros permanentes | §1.6 | `retryable` persistido e respeitado pela UI |
| R11 | Listagem de modelos sem resiliência | §1.2 | Reusar `providers::retry` (P2) |

---

## 3. Comportamento alvo

### 3.1 Taxonomia de erro (`providers/mod.rs`)

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeoutPhase {
    Headers,
    FirstEvent,
    Idle,
    Total,
}

/// Política única aplicada a todos os provedores/protocolos.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryClass {
    /// Pode repetir o mesmo request quando nada foi emitido para a UI.
    Transient,
    /// 401 com bearer: renovar a credencial uma vez e repetir.
    AuthRefresh,
    /// Nunca repetir; superfície para o usuário.
    Permanent,
}

pub enum ProviderError {
    // ... variantes atuais mantidas ...
    RateLimited { message: String, retry_after: Option<Duration> },
    Timeout { phase: TimeoutPhase, detail: String },
    StreamInterrupted { detail: String },
    Transient {
        status: Option<u16>,
        code: Option<String>,
        message: String,
        retry_after: Option<Duration>,
    },
}
```

Métodos novos (contrato lido pelo harness):

```rust
impl ProviderError {
    /// Código neutro para `TurnEvent::Error.code` / `MessageError.code`.
    pub fn code(&self) -> Option<&'static str>;          // existente, ampliado
    pub fn retry_class(&self) -> RetryClass;
    pub fn retry_after(&self) -> Option<Duration>;
    pub fn is_transient(&self) -> bool;                  // RetryClass::Transient
}
```

Mapeamento de status (`from_http`):

| Status | Variante | Classe | Código neutro |
|---|---|---|---|
| 400 com `subscription_sharing_unsupported_capability` ou `param` de request | `UnsupportedCapability` | Permanent | `unsupported_capability` |
| 400 genérico | `BadRequest` | Permanent | `bad_request` |
| 401 `subscription_sharing_invalid_user` | `AuthRequired` | AuthRefresh | `auth_required` |
| 401 genérico | `Unauthorized` | AuthRefresh (só bearer) | `auth_required` |
| 402 | `BadRequest` | Permanent | `insufficient_credit` |
| 403 codes atuais | inalterado | Permanent | inalterado |
| 408 / 425 | `Transient` | Transient | `upstream_error` |
| 409 | `Transient` (sem retry automático por padrão) | Transient | `upstream_error` |
| 429 (não-plan) | `RateLimited` | Transient | `rate_limited` |
| 429 `subscription_sharing_usage_limit_exceeded` | `PlanLimit` | Permanent | `plan_limit` (novo neutro) |
| 500/502/503/504/529/520-599 | `Transient` | Transient | `upstream_error` |
| 404/422 e demais 4xx | `BadRequest` | Permanent | `bad_request` |
| `ModelProtocolUnsupported` | `UnsupportedProtocol` | Permanent | — (fallback de protocolo) |
| canal de eventos fechado | `Other` → **nova** `Cancelled` | Permanent | — |

`from_stream_error` ganha os códigos transitórios de cada provedor:
`server_error`, `rate_limit_exceeded`, `overloaded_error`, `api_error`, `internal_error`,
`timeout`, `RESOURCE_EXHAUSTED`, `UNAVAILABLE`, `INTERNAL`, `DEADLINE_EXCEEDED`.
Os adapters passam a usar `from_stream_error` (não `Other`) para erro dentro do stream.

Conflito de código a resolver: hoje `PlanLimit` e `RateLimited` devolvem o mesmo neutro
`rate_limited` (`providers/mod.rs:581`), e a UI usa `rate_limited` + provedor de plano para
mostrar o banner de cota sem retry (`turnError.ts:39-68`). Um 429 transitório em provedor de
plano seria tratado como cota esgotada. Correção: `PlanLimit` passa a devolver `plan_limit`
(o código raw `subscription_sharing_usage_limit_exceeded` continua tendo precedência em
`TurnFailure`), `rate_limited` fica reservado ao 429 transitório, e `turnErrorKind` deixa de
depender do heurístico `planProvider` (basta `plan_limit` ou o código raw). Atualizar
`ChatView.test.tsx` e `TurnErrorBanner.test.tsx`.

Mensagens de corpo HTTP: truncar em 2 KiB e remover tags HTML antes de exibir/armazenar.

`ProviderError::Cancelled` (canal de eventos fechado porque o turno foi cancelado) nunca é
retryable; `run_stream_attempt` o converte em `AttemptOutcome::Cancelled(attempt)` em vez de
`Failed`, preservando o texto parcial já coletado.

### 3.2 Timeouts

`CompletionRequest` ganha `timeouts: StreamTimeouts` (defaults abaixo), construído pelo harness
a partir das settings. `send_stream` e `sse::stream_sse` leem daí.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamTimeouts {
    /// Conexão aberta até os headers da resposta.
    pub headers: Duration,        // default 120 s
    /// Primeiro evento SSE com dados.
    pub first_event: Duration,    // default 180 s
    /// Gap máximo entre eventos com dados.
    pub idle: Duration,           // default 120 s
    /// Teto absoluto do stream; None = sem teto.
    pub total: Option<Duration>,  // default 30 min
}
```

- `connect_timeout` continua 20 s no client compartilhado (constante documentada); os demais
  deadlines são por request, porque o client é compartilhado com busca/web.
- Deadline de headers via `tokio::time::timeout` em `send_stream`.
- `stream_sse` aplica `total` como deadline absoluto e devolve
  `SseOutcome { done_sentinel: bool }`.
- Timeout de leitura do corpo vem do `reqwest`/SO e é classificado como
  `StreamInterrupted` (transitório), não como `Network` genérica.

### 3.3 Detecção de stream truncado

Cada `Handler` ganha `completed: bool` com o sinal terminal do protocolo:

| Protocolo | Sinal terminal |
|---|---|
| `openai-chat` | `choices[].finish_reason != null` **ou** sentinela `[DONE]` |
| `openai-responses` | `response.completed` ou `response.incomplete` |
| `anthropic` | `message_stop` |
| `google` | chunk com `finishReason` não vazio |

Depois do `stream_sse`, se não foi cancelado e `!completed && !done_sentinel`:
`Err(ProviderError::StreamInterrupted("stream ended without <signal>"))`.
`handler.finish()` só roda em stream completo; hoje ele roda em qualquer EOF.

### 3.4 Política de retry

```rust
pub struct RetryPolicy {
    pub max_retries: u32,        // tentativas extras; default 3 (4 requests)
    pub base_delay_ms: u64,      // default 800
    pub max_delay_ms: u64,       // default 20_000
    pub max_elapsed_ms: u64,     // default 90_000; 0 = sem teto
    pub retry_after_cap_ms: u64, // default 60_000
}

pub enum RetryDecision {
    Retry { delay: Duration, reason: RetryReason },
    Stop { retry_after: Option<Duration> },
}
```

Regra (função pura, testável com jitter injetado):

1. `retry_class()` precisa ser `Transient` (ou `AuthRefresh`, tratado à parte) **e**
   `attempt_empty` (sem `text`, `reasoning` e `tool_calls`).
2. Se `Retry-After` existir: `delay = retry_after`; se `retry_after > retry_after_cap_ms`,
   **não** repete e devolve `Stop { retry_after }` (a UI mostra "aguarde N s").
3. Caso contrário: `exp = base * 2^(failures-1)`, limitado a `max_delay_ms`;
   `delay = uniform(0, exp)` (full jitter, semeado por `getrandom`; no teste, injetado).
4. Se `max_elapsed_ms > 0` e `elapsed + delay > max_elapsed_ms` → `Stop`.
5. `failures >= max_retries` → `Stop`.
6. Cancelamento durante o sleep (`tokio::select!`) vira `Cancelled`, não erro.

Auth refresh (401) continua separado: uma vez por passo, não consome o orçamento de retries,
é emitido como `Retrying { reason: "auth_refresh" }` e reconstrói o request com o token novo.

Nunca repetir quando:
- houve output para a UI (`text|reasoning|tool_calls` não vazios) — repetir duplicaria texto e
  cobraria duas vezes;
- o protocolo é `UnsupportedProtocol` (o fallback de protocolo já cobre);
- o erro é `PlanLimit`, `PlanNotEligible`, `UnsupportedCapability`, `RouteNotSupported`,
  `AuthRequired` após refresh falho, `BadRequest`, `Cancelled`.

### 3.5 Persistência da falha

Novo tipo compartilhado (`domain.rs`):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageError {
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    /// Um novo request manual pode resolver (transitório/auth).
    pub retryable: bool,
    /// O provedor pediu espera explícita (`Retry-After`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
    /// Requests do passo que falhou (1 = sem retry automático; 0 = nenhum
    /// request chegou a ser feito, ex.: credencial ausente).
    pub attempts: u32,
}
```

- `ChatMessage.error: Option<MessageError>` (novo campo, `skip_serializing_if`).
- `messages.error TEXT` (JSON, nullable) + migração idempotente via `ensure_column`.
- `MESSAGE_COLUMNS` ganha a coluna no fim (índice 16); `message_from_row` lê por posição.
- `TurnResult.error: Option<MessageError>` substitui `Option<String>`.
- `TurnEvent::Error` ganha `retryable: bool` e `attempts: u32`.
- Finalização do turno: `assistant_message.error = turn_failure.map(MessageError::from)`,
  mesmo quando há texto parcial (status continua `Complete` para o texto aparecer; o card de
  erro usa o campo novo, não o status).
- `status = Error` somente quando não há conteúdo visível.
- `TurnFailure::from_provider` ganha hints para os novos neutros (`timeout`, `network`,
  `stream_interrupted`, `upstream_error`, `bad_request`, `insufficient_credit`), com chaves em
  `src-tauri/locales/*` — a UI nunca precisa inventar copy.

### 3.6 Turno que falha antes do request

- `prepare_new_turn` passa a receber `provider_id`/`model_id` como `&str` (não exige
  `ProviderInfo`/`ModelInfo` resolvidos).
- `resolve_turn_route` falhou em turno novo (`TurnKind::User`, sem `regenerate`):
  1. persistir a mensagem do usuário e o placeholder do assistente;
  2. gravar `MessageError` com `code`/`hint`/`retryable` do `CredentialError` ou do erro de
     modelo/protocolo;
  3. emitir `TurnStarted` → `MessageUpdated` → `Error`;
  4. retornar `Ok(TurnResult { error: Some(...) })` (o comando não devolve `Err`).
- Continuam **sem** persistir (recusas de preflight, não falhas de request): `TURN_BUSY`,
  `BUDGET_EXCEEDED`, agente arquivado/inexistente, `CONVERSATION_NOT_CODE`, validação de rodada
  de objetivo, `SYSTEM_PROMPT_OVERRIDE_TOO_LARGE`.
- Rodada de objetivo (`GoalRound`) com falha pré-request: não cria mensagem fantasma; emite
  `Error` e mantém a rodada como estava.
- `regenerate` com falha pré-request: não apaga a resposta anterior; apenas emite `Error`.

Com isso, `commands/turn.rs:145-153` deixa de emitir `TurnEvent::Error` para `CredentialError`
(seria duplicado): o erro passa a sair de dentro de `run_turn`, junto com a mensagem
persistida. O fecho de sessão de computador (`end_computer_session`) passa a usar
`assistant_message.error.is_none()`/status em vez de `result.is_ok()` para marcar
`completed`/`failed`.

### 3.7 Replay correto depois do erro

- No branch de falha: `full_text = step_text.trim()` e `push_trace_step(..., text = "")`,
  igual ao passo final (`mod.rs:3127-3150`), para o texto parcial aparecer em `content` sem
  duplicar no timeline. `replay_steps` continua guardando `step_text` (fonte do wire).
- `build_history` ignora `assistant` com `status == Error` **e** `content`/`reasoning`/
  `tool_calls` vazios (além do caso `Streaming` atual).
- Tool results sintéticos de calls interrompidas passam a ser em inglês e explícitos:
  `"Tool call was not executed: the provider stream failed before the call completed."`.
  As calls continuam pareadas (obrigatório para Anthropic/OpenAI) e `arguments` continuam
  saneados.
- Um passo que falhou nunca contribui com `provider_state` incompleto para o replay: o estado
  verbatim só existe no caminho de sucesso (`Handler::finish`).

---

## 4. Algoritmo

```mermaid
stateDiagram-v2
    [*] --> Attempt
    Attempt --> Completed: stream com sinal terminal
    Attempt --> Cancelled: usuário cancelou
    Attempt --> Classify: erro tipado
    Classify --> Stop: permanente / output já emitido
    Classify --> Refresh: 401 + bearer (1x)
    Refresh --> Attempt: token renovado
    Refresh --> Stop: refresh falhou
    Classify --> Decide: transitório + attempt vazio
    Decide --> Stop: orçamento/tentativas esgotados
    Decide --> Stop: Retry-After acima do teto
    Decide --> Backoff: delay calculado
    Backoff --> Attempt: sleep ok + TurnEvent::Retrying
    Backoff --> Cancelled: cancel durante o sleep
    Completed --> [*]
    Stop --> Persist
    Cancelled --> Persist
    Persist --> [*]
```

Loop (substitui `harness/mod.rs:2887-2955` e `3356-3410`, extraído para
`run_step_with_retry`, reaproveitado pelos dois pontos):

```text
failures = 0; elapsed = 0; auth_refreshed = false
loop:
  request = build(credential)                  // inclui cache_plan
  outcome = run_stream_attempt(request)
  match outcome:
    Completed/Cancelled -> return
    Failed(error):
      if auth_required(error) && bearer && !auth_refreshed:
          auth_refreshed = true
          emit Retrying{attempt: failures+2, reason: "auth_refresh"}
          credential = refresh_credential()?     // falha -> Stop(auth_required)
          continue
      if !attempt_empty(outcome.attempt) -> Stop
      failures += 1
      decision = retry::decide(error, failures, elapsed, policy)
      Retry{delay, reason}:
          emit Retrying{attempt: failures+1, maxAttempts, delayMs, reason, code}
          select(cancel, sleep(delay)) -> cancel => Cancelled
          elapsed += delay
          continue
      Stop{retry_after} -> return Failed{ attempts: failures + 1, retry_after }
```

Detalhes:

- `run_step_with_retry` recebe o builder do request (não o request pronto), porque o token OAuth
  pode mudar entre tentativas.
- `attempts` no `MessageError` conta requests do passo que falhou (inclui o primeiro).
- Não reemitir `StepStarted` em retry (a UI não cria passo novo); só `Retrying`.
- Nenhum checkpoint é escrito em attempt vazio; um checkpoint de attempt descartado não existe
  porque `on_partial` só roda após evento com dados.
- O protocolo é reescolhido do topo a cada tentativa (`stream_completion`); como não houve
  output, repetir um protocolo que já respondeu `UnsupportedProtocol` é determinístico e
  barato.
- Attempts que serão repetidos são descartados com seu `usage`/digest/telemetria; o último
  attempt (o que falha em definitivo ou conclui) é o que entra no total do turno e nos
  `cache_samples`, como hoje. Ou seja: um retry pode subnotificar o custo de um input cobrado
  pelo provedor antes da falha — dado aceito e documentado, nunca "inventado".
- Cada retry registra uma linha de log (`eprintln!`, mesmo padrão de `providers/mod.rs:800`)
  com provider, model, classe, status/código, tentativa e delay. Nunca corpo, headers ou
  tokens.

---

## 5. Contratos

### 5.1 Rust

| Símbolo | Arquivo | Mudança |
|---|---|---|
| `ProviderError` | `providers/mod.rs` | variantes `RateLimited` (struct), `Timeout`, `StreamInterrupted`, `Transient`, `Cancelled`; `retry_class`, `retry_after`, `code` ampliado |
| `TimeoutPhase`, `StreamTimeouts`, `SseOutcome` | `providers/mod.rs`, `providers/sse.rs` | novos tipos |
| `RetryClass`, `RetryPolicy::from_settings`, `RetryReason`, `RetryDecision`, `decide`, `backoff_delay`, `parse_retry_after` | `providers/retry.rs` (novo) | política pura, sem I/O |
| `CompletionRequest` | `providers/mod.rs` | `+ timeouts: StreamTimeouts` (migração mecânica dos ~30 literais). `run_turn` usa `StreamTimeouts::from_settings`; `BatchRequest`/`ManualSummaryRequest` ganham o campo e os comandos chamadores passam o valor das settings (testes usam `Default`) |
| `ProviderError::from_http` / `from_stream_error` | `providers/mod.rs` | tabela §3.1 + `Retry-After` |
| `send_stream` / `send_stream_with_cache_fallback` | `providers/mod.rs` | deadline de headers, `retry_after`, body capado |
| `Handler` (4 adapters) | `providers/*.rs` | `completed: bool` + `from_stream_error` |
| `MessageError` | `domain.rs` | novo |
| `ChatMessage.error` | `domain.rs` | `Option<MessageError>` |
| `TurnResult.error` | `domain.rs` | `Option<MessageError>` |
| `TurnEvent::Retrying` / `TurnEvent::Error{retryable, attempts}` | `events.rs` | novo/ampliado; novos campos com `#[serde(default)]` (turnos gravados antes da mudança continuam desserializáveis) |
| `Settings` (novos campos) | `domain.rs` + `config.rs` | ver §5.3 |
| `TurnFailure` | `harness/mod.rs` | ganha `retryable`, `retry_after_ms`, `attempts`; converte para `MessageError` |
| `messages.error` | `db.rs` | coluna + migração + mapper + insert/update |
| `run_turn` | `harness/mod.rs` | persistência pré-request; `full_text` na falha; history hygiene |
| `commands::run_turn` | `commands/turn.rs` | `Ok(TurnResult)` para falhas já persistidas; `Err` só para preflight |
| `harness::batch::complete_text` / `finish_manual_summary` | `harness/batch.rs`, `harness/compaction.rs` | retry com a mesma política (attempt vazio = nenhum `TextDelta` recebido), máx. 2; não atravessa `run_turn` |
| `fetch_remote_models` (P2) | `commands/models.rs` | retry com a mesma política |

### 5.2 TypeScript

```ts
export interface MessageError {
  message: string;
  code?: string | null;
  hint?: string | null;
  retryable: boolean;
  retryAfterMs?: number | null;
  attempts: number;
}

export interface ChatMessage { /* ... */ error?: MessageError | null; }

export interface TurnResult { /* ... */ error?: MessageError | null; }

export type TurnEvent =
  // ...
  | { type: 'retrying'; attempt: number; maxAttempts: number; delayMs: number;
      reason: 'transient' | 'auth_refresh'; code?: string }
  | { type: 'error'; message: string; code?: string; hint?: string;
      retryable?: boolean; attempts?: number };
```

`StreamingState.phase` ganha `'retrying'`.

### 5.3 Settings

Flat, camelCase no JSON, com default e clamp em `normalize_settings`:

| Campo | Default | Faixa |
|---|---|---|
| `providerHeadersTimeoutSecs` | 120 | 30–600 |
| `providerFirstEventTimeoutSecs` | 180 | 30–900 |
| `providerIdleTimeoutSecs` | 120 | 15–600 |
| `providerTotalTimeoutSecs` | 1800 | 0 (off)–7200 |
| `providerMaxRetries` | 3 | 0–8 |
| `providerRetryBaseDelayMs` | 800 | 100–5000 |
| `providerRetryMaxDelayMs` | 20000 | 500–60000 |
| `providerRetryMaxElapsedMs` | 90000 | 0–600000 |
| `providerRetryAfterCapMs` | 60000 | 1000–600000 |

UI: seção "Confiabilidade" em `ProvidersTab` (avançado, colapsada por padrão). Os cinco últimos
campos são avançados; os quatro timeouts ficam visíveis.

---

## 6. UI / UX

- **Durante retry:** a bolha do assistente mostra
  `Conexão instável · tentando novamente em {delay}s ({attempt}/{maxAttempts})`, sem criar
  passo no timeline. O botão Stop cancela também durante o sleep.
- **Erro final:** o card da mensagem usa `message.error.hint ?? message.error.message` e mostra
  `{attempts} tentativa(s)`; o botão "Tentar novamente" só aparece quando `retryable`.
  Para `auth_required`/`missing_credentials`, mantém "Abrir configurações"; para
  `plan_limit`/`plan_not_eligible`, mantém o banner sem retry.
- **Parcial + erro:** quando há texto parcial, o conteúdo é renderizado normalmente e o card de
  erro aparece abaixo (status `complete` + `error`).
- **Reload:** `openConversation` semeia `error/errorCode/errorHint` a partir de
  `lastMessage.error` (última mensagem assistant), então banner e botão continuam corretos.
  `ChatView.lastAssistantFailed` passa a aceitar `status === 'error'` **ou** `message.error`
  presente (texto parcial + erro tem status `complete`). `MessageItem.isKeyError` passa a usar
  `message.error.code` em vez do padrão no conteúdo.
- **Agent/Code:** `TurnEvent::Retrying` entra na whitelist de `code/subagent.rs:275-286`;
  `streaming.phase` novo é lido pelo indicador do composer e pelo `AgentSteps`.
- **i18n:** novas chaves em `src-tauri/locales/{en,pt-BR,es}.json` (mensagens de timeout/
  interrupção/upstream, hints de retry) e em `src/locales/{en,pt-BR,es}/chat.json`
  (retrying, attempts, retry-after).

---

## 7. Plano de testes

### 7.1 Backend — unitário (sem rede)

`providers/retry.rs`:
- matriz de classificação de `from_http` (400 capability vs 400 genérico, 401, 402, 403, 408,
  425, 429 normal vs plan, 500/502/503/504/529/520, 404/422);
- `from_stream_error` para `overloaded_error`, `RESOURCE_EXHAUSTED`, `UNAVAILABLE`, etc.;
- `parse_retry_after`: segundos, `retry-after-ms`, HTTP-date, inválido, negativo, > teto;
- backoff: exponencial, cap, jitter injetado dentro do intervalo, orçamento esgotado.

`providers/sse.rs` (`#[tokio::test(start_paused = true)]`, requer feature `test-util` no tokio):
- primeiro evento estoura → `Timeout/StreamStalled` com fase correta;
- keep-alive não renova deadline; evento com dados renova;
- deadline total encerra stream que sempre progride;
- cancelamento vence os deadlines.

`providers/mod.rs`:
- `send_stream` com listener TCP local que aceita e não responde → timeout de headers;
- stream sem sinal terminal (fake de handler por protocolo) → `StreamInterrupted`;
- body de erro > 2 KiB/HTML → mensagem capada e limpa;
- `emit` com canal fechado → `Cancelled`, não `Network` (nunca retry).

### 7.2 Backend — harness (streamer mock, sem rede)

- transitório depois sucesso → 2 requests, 1 `Retrying`, texto emitido **uma vez**, mensagem
  `Complete`, sem `error`;
- esgotamento → `max_retries + 1` requests, status `Error`, `error.attempts`, `retryable`,
  sem deltas duplicados;
- permanente (400) → exatamente 1 request;
- queda após output parcial → 1 request, texto preservado em `content` e em `provider_state`,
  `status = Complete`, `error.retryable = true`, trace sem texto duplicado;
- 401 → refresh 1× + retry (teste existente mantém) e `Retrying{auth_refresh}`;
- cancel durante o sleep → 0 requests extras, `Cancelled`, sem `error`;
- credencial ausente → 2 linhas persistidas, `error.code = missing_credentials`, eventos
  `TurnStarted`+`Error`, nenhum request (substitui o teste de "não persiste");
- próximo turno após erro → `build_history` não inclui a linha vazia de erro, inclui tool calls
  falhas pareadas e o texto neutro "not executed";
- retry não muda o body: digest e bytes do request idênticos; `cache_samples` com 1 linha por
  passo;
- migration: banco legado sem `messages.error` → coluna criada, `ChatMessage.error = None`.

### 7.3 Renderer (Vitest)

- `chatStore` aplica `retrying` (fase, sem passo novo, sem toast);
- `error` final persiste no estado e o card respeita `retryable`;
- `openConversation` reidrata banner a partir da última mensagem com `error`;
- `reconcileTerminalResult` aplica `result.error` (mensagem + store) sem apagar o texto
  parcial já visível;
- `MessageItem` mostra conteúdo parcial + card de erro quando `status = complete` com `error`;
- `turnErrorKind`: `plan_limit` e `subscription_sharing_usage_limit_exceeded` → banner de cota;
  `rate_limited` transitório **não** vira banner de cota em provedor de plano;
- `TurnErrorBanner` continua sem retry para cota/inelegível.

### 7.4 Integração real (manual/`#[ignore]`)

Uma execução por protocolo (`openai-chat`, `openai-responses`, `anthropic`, `google`) contra o
gateway/API real confirmando:
- sinal terminal reconhecido no caminho feliz (nenhum falso `StreamInterrupted`);
- tool call + replay continua funcionando;
- `Retry-After` real (429) respeitado quando presente.

---

## 8. Fases

**P0 — Taxonomia e timeouts** (base para tudo)
1. `ProviderError` + `RetryClass` + `TimeoutPhase` + `providers/retry.rs` (testes §7.1).
2. `StreamTimeouts` em `CompletionRequest`; deadline de headers; `sse.rs` configurável + total.
3. Sinal terminal nos 4 handlers + `StreamInterrupted`.
4. `from_stream_error` em todos os adapters e `Retry-After` no `send_stream`.
5. Habilitar `test-util` no tokio (`Cargo.toml`, Lead) para testes de deadline com
   `start_paused`.

**P1 — Retry no harness**
6. `run_step_with_retry` substituindo os flags atuais (loop principal e resposta forçada).
7. `TurnEvent::Retrying` + whitelist de subagente + fase `retrying` no renderer.
8. Settings de resiliência (backend + tipos + UI + i18n).
9. Documentar em `docs/MODELS.md`: sinal terminal por protocolo, timeouts, retry (o que repete
   e o que nunca repete) e `Retry-After`. Atualizar `docs/ARCHITECTURE.md` §providers.

**P2 — Persistência e pós-erro**
10. `MessageError` + `ChatMessage.error` + migração + `TurnResult.error`/`TurnEvent::Error`.
11. Persistência pré-request (credencial/modelo/protocolo) e ajuste do teste de invariante.
12. `full_text` no branch de falha + history hygiene + tool result neutro.
13. UI: card com erro persistido, retry condicionado, reidratação no `openConversation`.
14. Retry com a mesma política em `batch::complete_text`/compactação (máx. 2) e na listagem de
    modelos (máx. 2).

**P3 — Endurecimento**
15. Diagnóstico: contador de retries por turno no painel de diagnóstico (opcional).
16. Testes ignorados contra os 4 protocolos reais.

---

## 9. Riscos e decisões

| Decisão | Alternativa rejeitada | Motivo |
|---|---|---|
| Sem retry após output para a UI | Bufferizar a resposta e só emitir no fim | Quebraria o streaming (produto é streaming-first) e dobraria o custo de memória |
| Retry reinicia o request do zero | Retomar stream por offset | Nenhum provedor oferece retomada; não existe protocolo para isso |
| Política global, sem override por provedor | Config por provedor no catálogo | Os 4 protocolos compartilham a semântica; `Retry-After` cobre a diferença. Override no catálogo também exigiria mudar `scripts/` e regenerar `data/catalog.json` |
| Persistir falha de credencial/modelo em turno novo | Manter o invariante "não persiste sem credencial" | Sintoma reportado; sem persistência o texto do usuário some no reload |
| Teto total de 30 min por request | Sem teto / teto curto | O idle de 2 min é o detector real de travamento; o teto total evita stream infinito sem matar raciocínio longo |
| `Retry-After` acima do teto não espera | Esperar sempre | Prender o turno por minutos é pior que informar "aguarde N s" e devolver o controle |
| `error.retryable` separa "pode tentar" de "auto-repetiu" | Usar só o status | Erro transitório após output parcial não é auto-repetido, mas o retry manual pode resolver |

Riscos:
- **Falso positivo de stream truncado no Google/gateway**: se algum gateway omitir
  `finishReason`, o turno falharia no caminho feliz. Mitigação: teste real ignorado nos 4
  protocolos antes de fechar P0; se o gateway omitir o sinal, aceitar `usageMetadata` final
  como terminal **apenas** nessa rota, documentado em `docs/MODELS.md`.
- **Dupla cobrança**: retry só ocorre sem output; mesmo assim pode cobrar input duas vezes.
  Aceitável e documentado em `docs/MODELS.md`.
- **Cache TTL**: esperas longas de `Retry-After` podem expirar o cache do prefixo (Anthropic
  5 min). O teto de 60 s limita o dano; a amostra de cache já reporta a quebra.
- **Migração**: coluna aditiva e `ensure_column`, sem reescrita de tabela; rollback é ignorar a
  coluna.

Fora de escopo: retry de tools/execução de código, OAuth token exchange, atualizações/downloads,
reconexão resiliente de SSE (EventSource/Last-Event-ID), fallback automático de modelo
(não-agent), retry de requests de busca web.

---

## 10. Critérios de aceite

- [ ] Um 503/429/timeout/reset em request sem output não encerra o turno; há até
      `providerMaxRetries` novas tentativas com `Retrying` visível e jitter.
- [ ] `Retry-After` é respeitado quando ≤ teto; acima do teto o erro volta com espera explícita.
- [ ] Nenhum texto/tool call é duplicado na UI ou no banco por causa de retry.
- [ ] Stream cortado sem sinal terminal vira erro, não resposta completa.
- [ ] Turno novo com credencial ausente/ inválida persiste usuário + bolha de erro; reload
      mantém texto, código, dica e botão de retry.
- [ ] Texto parcial de um passo que falhou aparece em `content` e sobrevive ao reload.
- [ ] Após qualquer erro, o próximo request é válido nos 4 protocolos (sem assistant vazio,
      sem tool result órfão, com argumentos JSON saneados).
- [ ] Erro permanente não oferece retry; erro transitório oferece.
- [ ] `cargo check`, `cargo test --lib`, `pnpm typecheck`, `pnpm test` verdes.
- [ ] Smoke real (ignorado) do caminho feliz nos 4 protocolos sem falso `StreamInterrupted`.
