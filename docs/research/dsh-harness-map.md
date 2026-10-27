# Mapa do DeepSeek Harness (DSH) — o que transplanta para um harness nativo no Lumina

> **Escopo.** Mapa técnico do harness empacotado em
> `C:\Users\estev\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`
> (`/dsh/node_modules/@deepseek-ai/*`, 307 pacotes). Extraído para
> `.research/asar-out/dsh/node_modules/@deepseek-ai/<pkg>/` (README.md oficial + `lib/*.js`;
> `src/*.ts` nos pacotes publicados com fonte).
> **Método.** Leitura dos READMEs oficiais (Summary / Use this package / Implementation
> internals / Model Experience / Known Limitations) e de source maps citados neles.
> Onde a evidência é indireta (ex.: gateway, montagem do prompt), está marcado
> **[inferido]**. Nenhuma afirmação abaixo depende de execução do app.
> **Alvo.** Plano de um harness de código **nativo em Rust/Tauri**, local-first, sem
> Cordis/plugin loader, sem servidor HTTP. Por isso o texto separa *mecânica
> transplantável* de *acoplamento de infraestrutura*.

Legenda de confiança: ✅ lido no README do pacote · ⚠️ inferido de consumidores/nomes · 🧪 detalhe de implementação citado em source map.

---

## 0. Arquitetura em uma página

O DSH é um **runtime de agentes em processo Node** montado por plugins Cordis sobre um
**log de sessão append-only**, com um **host Electron/Web** que fala com o runtime por
comandos/eventos e renderiza uma UI React por slots. Não há banco relacional no caminho
crítico: sessão = log; estado de UI = projeções determinísticas desse log.

```
┌──────────────────────────── Host (Electron main / Web server) ───────────────────────────┐
│  app-boot → dsh-base (bundle de plugins) → cordis.yml/presets                             │
│                                                                                           │
│  ctx.agents ──► dsh-agent-loop (driver) ──► ctx.llm.stream() ──► provider adapter          │
│      │                 │  ▲                                                                │
│      │                 │  └── ctx.tools (registry + pipeline) ──► ctx.fs / ctx.shell /     │
│      │                 │                                          ctx.subprocess / ctx.web │
│      │                 ├── ctx.session (log append-only) ──► session-persistence-jsonl     │
│      │                 ├── ctx.sessionProjections (todo, goal, stats, title, permissions…) │
│      │                 ├── ctx.tokenMeter / ctx.compaction / ctx.spillStore                 │
│      │                 └── ctx.sandboxPolicy / ctx.approval / ctx.userQuestions             │
│      │                                                                                     │
│  dsh-api-gateway + *-controller (session/workspace/jobs/terminal/models/settings)          │
│      │        Remote events/commands por RPC (transporte trocável)                          │
│  dsh-client-ui-* (React por slots, sem acoplamento a stores)                               │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

Três invariantes que explicam quase todo o resto:

1. **O log é a verdade.** Todo fato model-visible vira evento durável; histórico do
   modelo (`deriveMessages()`) é derivado do log + projeção de superfície. Compactação
   não apaga: insere um evento de substituição (`surfaceOp: replace`). Replay é
   determinístico (`@deepseek-ai/dsh-session/README.md`).
2. **Tudo é evento ou capability tipada.** Plugins se comunicam por serviços
   (`ctx.foo`) e por eventos/waterfalls (`agent/pre-step`, `agent/request`,
   `tools/pre-execute`, `fs/*`, `compaction/*`). O loop não conhece tools concretas; o
   registry não conhece o loop.
3. **Política não mora no schema.** Sandbox, aprovação e read-before-write são gates
   de evento/execução; os schemas são estáveis e o modelo recebe instruções de
   recuperação em texto (`@deepseek-ai/dsh-sandbox/README.md` §Escalation,
   `@deepseek-ai/dsh-fs-observation-policy/README.md`).

### 0.1 Caminhos de referência (extração)

| Assunto | Pacote (`/dsh/node_modules/@deepseek-ai/…`) | Fonte principal |
|---|---|---|
| Loop turno/passo | `dsh-agent-loop` | `README.md`; `src/agent.ts`, `src/inbox.ts`, `src/tool-calls.ts` |
| Handle/registro/eventos `agent/*` | `dsh-agent` | `README.md`; `src/runtime-types.ts`, `src/dispatch.ts` |
| Registro/pipeline de tools | `dsh-tools` | `README.md`; `src/index.ts`, `src/ptc.ts`, `src/schema.ts` |
| Log de sessão + superfície | `dsh-session`, `dsh-session-format`, `dsh-session-format-v0..v4` | READMEs; `src/surface.ts`, `src/types.ts` |
| Persistência JSONL | `dsh-session-persistence-jsonl` | `README.md`; `src/storage.ts`, `src/format.ts`, `src/generation.ts` |
| Projeções | `dsh-session-projection`, `dsh-session-turn-outline`, `dsh-session-stats` | READMEs |
| Contexto/compactação | `dsh-token-meter`, `dsh-compaction{,-basic,-tool-result-pruner,-image-offload}`, `dsh-spill*`, `dsh-output-retention` | READMEs |
| Permissões | `dsh-permission-presets`, `dsh-sandbox*`, `dsh-fs-sandbox`, `dsh-fs-observation-policy`, `dsh-user-approval` | READMEs |
| Workspace/git | `dsh-workspace`, `dsh-workspace-changes`, `dsh-experimental-worktree` | READMEs |
| Terminal/jobs/subagentes | `dsh-terminal*`, `dsh-jobs*`, `dsh-subagent*`, `dsh-experimental-agent-team` | READMEs |
| Tools concretas | `dsh-tool-*` (26 pacotes) | READMEs por tool |
| UI do layout Code | `dsh-client-ui-layout`, `-workspace`, `-sidebar-files`, `-sidebar-terminal`, `-trajectory`, `-plan`, `-jobs`, `-approval`, `-subagent`, `-tool`, `-conversation` | READMEs |

---

## 1. Agent loop: turno, passo, inbox, paralelismo, cancelamento

Fonte: `@deepseek-ai/dsh-agent-loop/README.md` e `@deepseek-ai/dsh-agent/README.md`.

### 1.1 Fluxo de um turno (com os pontos exatos de extensão)

```
turno começa
  └─ abre turno durável (turn/start)
  └─ CLAIM atômico: 1 prompt pendente de next-turn + inputs pendentes de next-step
     (splice puro = deleção; agent/inbox/claimed; itens inseridos depois do claim ficam p/ o próximo)
  └─ monta prompt (system/message efetiva = último nó não-vazio) + schemas visíveis
  └─ agent/pre-step  →  { kind:'reject' } | { kind:'enter', messages, startsRequestSeries? }
        · reject/empty batch ⇒ nenhum step, nenhum request
        · fallback projeta runtime-context DEPOIS dos listeners
  └─ step/start
       └─ [1ª tentativa] agent/request (waterfall) → ctx.llm.prepareCall()
             (resolve route, reasoning effort, maxTokens; pode ser retry via listener)
       └─ reconciliação do system prompt (§1.3) + refresh de runtime facts
       └─ só na 1ª tentativa: append do batch user/message aceito
       └─ request = header.config + deriveMessages() + header.tools   (sem campo `system`!)
       └─ stream: start → chunks (cada chunk só emite após settlement durável do frame
          assistant) → commit assistant/message | assistant/attempt → end
       └─ tool calls: agrupa em paralelo-safe (até maxParallelToolCalls=10) e
          exclusivas como barreiras de ordenação (§1.4)
       └─ cada resultado aceito é gravado no log ANTES do próximo step derivar
  └─ step/end; se houver steering/next-step ⇒ outro step no MESMO turno
  └─ agent/turn-stopping (pode steer e manter o turno aberto)
  └─ turn/end (TurnEndCancelCause quando cancelado)
```

Detalhes que importam para um harness novo:

- **Sem orçamento de turno embutido.** Tool calls e steering continuam o turno; limitar
  runaway é responsabilidade de um listener em `agent/turn-stopping` (limitação
  declarada no README do `dsh-agent-loop`).
- **Request congelado.** O request é profundo-congelado (`Object.freeze`), e o header
  (`request/header`) só é reemitido quando o "envelope" muda (config, tools, série de
  mensagens nova, substituição de superfície/offload de imagem, resume). Prompt não faz
  parte do header. Isso é otimização de prefix cache e também um contrato de
  auditabilidade (o log diz exatamente o que foi enviado).
- **Retry de modelo ≠ retry de tool.** `dsh-llm-retry` reexecuta o step falho no mesmo
  turno aberto, com eventos `llm/retry`/`llm/retry-started` gravados antes do backoff;
  streams diretos (`ctx.llm.stream()`) são single-attempt.
- **Recuperação de ferramentas sem resposta** (crash/falha de step): antes de fechar o
  step, cada `tool/call` sem `tool/result` recebe erro sintético —
  `TOOL_OUTCOME_UNKNOWN` ("Its outcome is unknown") para call registrada e
  `TOOL_NOT_STARTED` para request sem call; chamadas não despachadas por cancelamento
  recebem `ABORTED_BEFORE_DISPATCH`. O texto orienta o modelo a só repetir se for
  read-only/idempotente. **Nunca reexecuta automaticamente.**
- **`maxParallelToolCalls`** (default 10, `1` = serial) é campo volátil amostrado para o
  próximo grupo; `executionMode()` classifica unária e declarativamente cada tool
  (paralelo-safe × exclusiva) — não é um gate de evento (limitação explícita).

### 1.2 Inbox durável (o "composer" do agente)

`Agent.inbox` tem duas filas: `nextTurn` e `nextStep`. Mutação por `append`, `prepend`,
`replace`, `remove`, `clear`, `splice`; cada mutação commita **um**
`agent/inbox/spliced`, com o fold de projeção síncrono (quem lê a projeção após
`Session.append()` já vê o splice). Ordinais de splice inválidos/duplicados são
rejeitados no replay citando o `seq` ofensor. Operações semânticas:

| API do handle | Entra na fila | Acorda o driver? | Efeito |
|---|---|---|---|
| `followup()` | `nextTurn` (prompt comum) | sim | novo turno quando ocioso |
| `steer()` | `nextStep` | sim | mais um step no turno atual (interrupção cooperativa) |
| `inject()` | contexto model-facing | **não** | cai no próximo step admitido |
| `cancel(cause, {keepInbox})` | — | — | aborta atividade; por padrão limpa inbox; `keepInbox` preserva fila |
| `whenIdle()` | — | — | resolve na quiescência do agente |

Eventos: `agent/inbox/inserted`, `.../claimed`, `.../discarded` (remoção carrega
`outcome:'canceled'`). `MessageId` é único entre as duas filas.

### 1.3 Reconciliação do system prompt (detalhe valioso)

O prompt efetivo é o último nó `system/message` não-vazio; mas a forma como ele é
**enviado** depende da capability da rota (`prepareCall()`): rotas com suporte a
`systemPromptUpdate`/`toolUpdate` podem **anexar** atualizações no histórico
(`in-history`), preservando o prefixo cacheado; rotas incapazes (ou nova série de
request) exigem **consolidar no nó 0**, reescrevendo o head e emitindo substituições
vazias por nó. Mudança de tool schema força consolidação só quando a rota não declara
`toolUpdate`. Prompt vazio limpa todos os nós via substituições logadas. É a peça que
faz "instruções mudam no meio da sessão" sem quebrar KV cache.

### 1.4 Concorrência de tools e cancelamento

`src/tool-calls.ts`: pool limitado para calls paralelo-safe + barreiras para exclusivas
(preservam ordem de submissão). Cancelamento é **cooperativo e quiescente**: toda tool
recebe `exec.signal` e deve observá-lo; antes do body = `ABORTED_BEFORE_DISPATCH`;
depois = `ABORTED` (substitui só outcome de sucesso). Timeouts são **declarativos** no
`defineTool` (`timeoutMs`) e só são aplicados pelo wrapper
`dsh-tool-call-timeout-policy` (cooperativo, nunca hard-kill; tools que ignoram o sinal
seguram o caller). Texto já emitido ao usuário sobrevive ao cancelamento.

### 1.5 Eventos do agente (vocabulário)

| Evento | Papel | Semântica de dispatch |
|---|---|---|
| `agent/created`, `agent/disposed`, `agent/status` | ciclo de vida/coordenação | registro |
| `agent/pre-step` | admite/recusa step | waterfall serial, decisão final |
| `agent/request` | resolve/edita rota antes do prepareCall | waterfall |
| `agent/request-error` | retry terminal (listener devolve `{kind:'retry'}`) | waterfall |
| `agent/turn-stopping` | antes de fechar turno; pode steer | waterfall |
| `agent/assistant-stream` | frames start/chunk/end process-local (apresentação) | evento |
| `agent/inbox/*` | splice por mensagem | evento |
| `step/*`, `turn/*`, `request/header`, `request/context`, `tool/call`, `tool/result` | log durável | evento de sessão |

Highlights de implementação: criação é transação rollback-covered (sessão+agente+
contexto escopado, `session/created` só é anunciado depois); `AgentHandle.dispose()` é
a capability de teardown; escopo de agente (`Agent.ctx`) permite tool/prompt/listener
por agente; `withInitiator()` (AsyncLocalStorage) atribui trabalho assíncrono ao agente
— **process-local, não é autorização**.

---

## 2. Sessão, persistência, projeções e formato

### 2.1 Log append-only e superfície

`@deepseek-ai/dsh-session/README.md`: cada sessão é um stream de `SessionEvent`
(`src/types.ts`, `SessionEventMap` extensível por declaration merging). Histórico do
modelo = `deriveMessages()` sobre a **superfície** (`src/surface.ts`): conjunto ordenado
de nós `user/message`, `assistant/message`, `tool/result`; `assistant` carrega
`tool/call` e `tool/result` casa por `callId`. Eventos log-only (`request/*`,
`compaction/*`, `turn/*`, `step/*`, `agent/inbox/*`) nunca entram na superfície.

**Substituição de superfície:** apenas `user/message`/`assistant/message`/`tool/result`
podem ter `surfaceOp`; compactação insere um `user/message` com
`surfaceOp:{op:'replace', startSeq, endSeq}`. O log bruto permanece ⇒ replay
determinístico, "fork" e export fiéis. O loop reescreve o nó 0 quando a projeção do
system prompt difere (ver §1.3).

**Checkpoint policy** (`dsh-session-checkpoint-policy`): grava durabilidade
**fail-closed** em três pontos: antes de um model request, antes de uma tool de topo
poder causar efeito externo, e antes do próximo step começar. Contrato: registra
*intenção durável*, não "exactly-once"; tools com efeito colateral devem usar
`exec.callId` como idempotency key. Stream assistant não commitado é transiente;
ferramenta iniciada sem resultado recupera como *outcome unknown*.

### 2.2 Persistência JSONL

`@deepseek-ai/dsh-session-persistence-jsonl`: um arquivo por sessão, append-only,
frames Zstandard checksumados por padrão (`compression:'zstd'`) ou linhas UTF-8
(`'none'`); gerações históricas imutáveis com migração de formato suportada
(`dsh-session-format`, `dsh-session-format-v0-to-v1 … v3-to-v4`,
`dsh-session-format-catalog`), reparo de tail truncado e publicação exclusiva de nova
geração. Config: `root` (obrigatório), `compression`, `listConcurrency:3`. Handles de
escrita pertencem ao loop (`persistence.create(header)` / `open(id,'write')`);
`appendUnstoredSuffix` cobre eventos da janela de setup; `session/flush` é barreira.
Sem backend, sessão é memory-only.

### 2.3 Projeções (o segredo da UI barata)

`dsh-session-projection`: registra "domínios" que dobram eventos de sessão em valores
JSON **completos e validados** por chave, entregues por snapshot + notificações. Cada
snapshot identifica o último evento refletido (para casar estado com corte de
histórico); pode ser checkpointado para cold start. Exemplos empacotados:

| Pacote | Projeção | Conteúdo |
|---|---|---|
| `dsh-tool-todo` | `todos` | lista inteira (single-owner, replace total) |
| `dsh-goal` | goal | objetivo/phase/rounds/armed/blocker |
| `dsh-session-stats` | `sessionStats` | turns, steps, llmMs, toolMs, ttft, decode |
| `dsh-session-title` | `title` | título durável (nunca entra no input do modelo) |
| `dsh-session-turn-outline` | `turnOutline` | outline de todos os turnos com previews (50/120 chars), `seq` para paginação reversa |
| `dsh-permission-presets` | `permissions` | preset atual + knobs efetivos |
| `dsh-token-meter` | `tokenUsage`, `contextPressure`, `contextBreakdown` | métricas |
| `dsh-tool-terminal`/`dsh-jobs` | 6 APIs/tool views | terminal/jobs |

Limitações: cada página carrega todas as chaves visíveis; o registro de unidades é
process-wide; drive eager por evento (barato por gates de referência).

### 2.4 Consulta, títulos, export

`dsh-session-query` (serviço; backend SQLite em `dsh-session-query-sqlite`): listar,
filtrar, ler log/superfície, trace de sessão/evento, busca full-text paginada. **Sem
autorização embutida** ("trusted context-wide infrastructure") — quem expõe ao modelo
precisa impor escopo: é o que `dsh-tool-session-query` faz, exigindo `cwd` exato igual
ao do chamador e excluindo a própria sessão. `dsh-session-log-export`: ZIP da árvore de
sessões+attachments via `/export` (rota autenticada no host). `dsh-session-title-llm`:
título por chamada auxiliar (input/output/timeout caps, route explícita ou última
rota), nunca atrasa a resposta principal.

**Formato versionado:** `SESSION_FORMAT_VERSION` + cadeia de migrações adjacentes
(v0→v4); leitura rejeita headers/eventos aposentados; write-open pagina o legado antes
de construir a `Session`. Para o Lumina: adotar um **número de versão no header** e uma
tabela de migração `vN→vN+1` desde o dia 1 (barato; salva o futuro).

---

## 3. Contexto: tokens, compactação, spill, retenção

### 3.1 Medição — `dsh-token-meter`

Um único serviço mede pressão de contexto e preço por mensagem, reproduzindo o log
durável (sem chamada de modelo, determinístico). Heurística: **4 caracteres/token +
overhead estrutural por bloco/papel** (`src/estimate.ts`); uso reportado pelo provider é
reusado só para envelope canônico idêntico; imagens usam preço visual declarado pela
rota. Projeções: `tokenUsage`, `contextPressure`, `contextBreakdown`. Custo: cada
medição clona a superfície (O(surface)). Limitação honesta: não é tokenizer exato
(subestima CJK e JSON Schema).

### 3.2 Compactação — `dsh-compaction` (seam) + `-basic` (backend)

Gatilho automático (default): `threshold = floor(min(W×0.8, W − O − 65536))`
(W = context window, O = output cap efetivo, headroom 65.536). Retenção: `retainRatio
0.16` de `W − O` verbatim (ou `retainTokens` absoluto). Per-model override via
`modelPolicies`. `maxOverflowRetries:1` reage a `CONTEXT_WINDOW_EXCEEDED` (classificado
pelo adapter) condensando e tentando de novo; `/compact` força manual.

Transação "bracket-first" no log (lock registrado):

```
compaction/start  → seleciona região balanceada (nunca corta par tool/call↔result)
                 → chama resumo (ctx.llm.stream, purpose:'compaction',
                    replay do system prompt + tools + região sombreada byte-a-byte
                    para reusar prefix cache)
                 → valida que o resumo encolheu
                 → compaction/summary (log-only)
                 → UMA user/message com surfaceOp replace (única mutação de superfície)
                 → compaction/end (uma tentativa; falha deixa lock órfão = busy)
```

O resumo é embrulhado em `<compacted-summary>` com preamble fixo ("automatically
generated checkpoint… Continue the task directly…"), e a instrução de sumarização é
um template markdown de 8 seções (Primary Request, Key Technical Concepts, Files and
Code, Errors and Fixes, Pending Jobs, Current Work, Next Step, Critical Context) com
regras de preservar paths/comandos/erros literais e não mencionar a compactação. Esse
template é diretamente reutilizável.

### 3.3 Poda e offload

- `dsh-compaction-tool-result-pruner`: só roda **depois** de um gatilho de compactação;
  resultado de tool acima de `thresholdChars:8192` vira head `4096` + marker "middle
  pruned" + tail `1024`; zero chamada de modelo; pode evitar o resumo. Original permanece
  no log (replay exato).
- `dsh-compaction-image-offload`: quando a rota rejeita imagens por budget, substitui
  permanentemente imagens antigas por texto (nome + path read-only) e retenta uma vez;
  a decisão fica no log e sobrevive a resume/rota nova. **Sem volta automática.**

### 3.4 Spill (arquivos de transbordo) e retenção

`dsh-spill` (serviço `ctx.spillStore.saveText` → locator opaco + bytes exatos + hint de
recuperação) + `dsh-spill-local` (arquivo privado por sessão, nome imprevisível,
root 0700, cleanup de 30 dias, `cleanupPeriodDays:0` desliga) + `dsh-spill-policy`
(resultado de tool acima de `maxInlineTokens` é trocado por head/tail + path completo;
imagens continuam em attachment storage; se a recuperação falhar, mantém inline).
Não há API de leitura/remoção de spill: o modelo lê/grepa o arquivo com as tools de fs.
`dsh-output-retention`: biblioteca `ItemRetainer`/`TextRetainer`/`formatRetentionNotice`
para caps consistentes (glob/grep/bash/web_fetch) — head-only para itens, bytes para
texto, sem cortar surrogate pair.

### 3.5 Anti-loop e tempo

- `dsh-repeat-tool-reminder`: detecta mesma tool + mesmos argumentos (match exato por
  deep key-sort), lembretes em `[3, 5, 8]` repetições, por agente, limpos por nova
  mensagem do usuário, **advisório** (não bloqueia). Compaction não reseta a cadeia.
- `dsh-time-context`: injeta leitura durável de relógio + fuso do browser + tempo desde
  a última mensagem, com intervalo mínimo de 10 min (`refreshIntervalMs:0` = todo step);
  se o turno tem fusos mistos, instrui o modelo a perguntar.

---

## 4. Tools: contrato, pipeline, catálogo completo

Fonte: `@deepseek-ai/dsh-tools/README.md` + READMEs de `dsh-tool-*`.

### 4.1 Contrato (`defineTool`)

```ts
ctx.tools.register(defineTool({
  name, description,
  parameters: { /* DSL: string|number|integer|boolean|null|array|object|json|oneOf */ },
  output: { schema, render? },              // valor canônico JSON validado
  executionMode?,                            // 'parallel' | 'exclusive' (classificação unária)
  timeoutMs?,                                // DECLARATIVO; só o timeout-policy aplica
  deferLoading?,                             // carregamento diferido de definição
  presentCall?/presentResult?,               // host-only; Web não consome
  async execute(args, exec) { /* usa exec.signal, retorna só output.schema */ },
}))
```

Pipeline fixo: `tools/pre-execute` (allow/deny/**ask**, extensível, reordenável) →
`guards` monotônicos (deny irreversível) → `tools/execute` (wrappers: timeout/retry/
métricas; único estágio que pode trocar o signal) → `tools/post-execute` (inspeciona/
substitui/bloqueia/atrela contexto) → `finalizeContent` da definição → `tools/result`
(observação imutável). Só `name`/`description`/JSON Schema vão para o modelo; `output`,
`execute` etc. nunca vazam para o wire. Erros viram resultado `Error: <message>` e
**não encerram o turno**; `UNKNOWN_TOOL`, `TOOL_TIMEOUT`, `ABORTED*` são códigos
estruturados. Restrições por agente: `ctx.tools.restrict(filter)` (máscaras
interseção) e `get/schemas(scope)`.

**Modos de apresentação:** `native` (todas as schemas) ou `ptc` (só `run_code` + SDK
gerado em TS/Python; cada sub-call passa pelo scheduler com o mesmo contrato de
concorrência; `run_code` default 120 s, cap 600 s; sub-calls têm id `<parent>:ptc:<n>`).
Para o Lumina, começar em `native` é o caminho de menor risco; PTC é ganho de contexto
com custo de runtime (eval de código) — deixar como fase 3.

### 4.2 Catálogo de tools (assinaturas e limites)

Concorrência: `read`, `glob`, `grep`, `web_search`, `web_fetch` e leituras são
declaradas paralelo-safe; toda mutação (`write`, `edit`, `str_replace_editor`,
`bash`/`pwsh`, `terminal_*`, `todo`, delegações) é **exclusiva** (barreira). O pool
máximo é do loop (`maxParallelToolCalls`).

| Tool (pacote) | Entrada | Saída model-facing | Limites/caps | Conc. |
|---|---|---|---|---|
| `read` (`dsh-tool-fs`) | `file_path`, `offset?`, `limit?` | `<path>`, `<type>`, linhas numeradas, footer de paginação | `readLimit 2000` linhas, `readMaxLineLength 2000`, `readMaxBytes 51200`, stream ≥10 MiB | paralelo |
| `read_image` (`dsh-tool-fs`) | `file_path` | envelope + image block nativo | requer attachment store + rota com image input; PNG/JPEG/WebP/GIF; downscale | paralelo |
| `write` (`dsh-tool-fs`) | `file_path`, `content` | `Created file`/`Updated file` | exige read prévio (policy); atômico; `diffBasisMaxBytes 10 MiB` | exclusiva |
| `edit` (`dsh-tool-fs`) | `file_path`, `old_string`, `new_string`, `replace_all?` | "updated successfully" | match único salvo `replace_all`; exige read + versão fresca | exclusiva |
| `glob` (`dsh-tool-fs-search`) | `pattern`, `path?` | paths ordenados por mtime, hidden+ignored, sem VCS | `globMaxResults 100`; `sampleOverCapGlobResults` obrigatório | paralelo |
| `grep` (`dsh-tool-fs-search`) | `pattern`, `path?`, `include?` | matches agrupados `Line N:` | `grepMaxMatches 250`, linha ≤2000 B, timeout 30 s, spill p/ excedente | paralelo |
| `str_replace_editor` (`dsh-tool-str-replace-editor`) | `command: view/create/str_replace/insert` + path | view numerada/dir listing raso | `maxOutputChars 16000`; sem `replace_all`; UTF-8 | exclusiva |
| `bash` (`dsh-tool-bash`) | `command`, `workdir?`, `timeout?`, `run_in_background?`, `sandbox_permissions?`, `justification?` | stdout/stderr/markers de saída; job id | executor: timeout 120 s (cap 600 s), `maxOutputBytes 64 KB`, spill 64 MiB | exclusiva |
| `bash` persistente (`dsh-tool-bash-persistent`) | mesmos + shell por agente | saída com estado preservado | `timeoutMs 300000`, `maxOutputChars 16000`; exit/timeout resetam shell | exclusiva |
| `pwsh` / `pwsh` persistente (`dsh-tool-pwsh*`) | análogos | análogo (paths Windows, `$env:`) | idem; sandbox Windows: ConstrainedLanguage em read-only, named pipes negados | exclusiva |
| `terminal_open/send/read/signal/close/list` (`dsh-tool-terminal`) | cwd, backend, texto, paginação | id/status/pid, saída bounded, `delivered` | `maxResultBytes 262144`; owner-scoped; sem TUI/keys; `signal` só do caller | exclusiva |
| `todo` (`dsh-tool-todo`) | lista inteira `{content,status}` | confirmação | single-owner; replace total; `allowParallelInProgress` obrigatório | exclusiva |
| `subagent` (`dsh-tool-subagent`) | task, `cwd?`, preset/modelo opcionais | child id (não espera resultado) | `maxDepth` 1 (default host); fork não escolhe rota; completion notice | exclusiva |
| `send_message`/`interrupt_agent` (`dsh-tool-subagent-control`) | `agent_id` + mensagem | messageId / ack | só pai↔filho direto continuável; sem resultado independente | exclusiva |
| `list_agents` (plugin separado) | filtros | snapshot de filhos | status pode correr com publicação | leitura |
| `workflow` (`dsh-tool-workflow`) | `meta`, `script` (JS), `args?`, `run_in_background?` | valor JSON final (ou job id) | `maxResultChars 50000`; só orquestração multi-agente explícita | exclusiva |
| `ralph` (`dsh-tool-ralph`) | `objective`, `maxRounds?` | `complete`/`blocked`/`budget-limited` | `maxRounds 256`, handoff 16 KiB; só a pedido humano explícito | exclusiva |
| `web_search` (`dsh-tool-web`) | 1–4 queries | resposta opcional + URLs; texto externo não confiável | `searchMaxResults 8`, `searchMaxQueries 4`, timeout 30 s | paralelo |
| `web_fetch` (`dsh-tool-web`) | URL | texto convertido (HTML→md) | `fetchMaxOutputChars 200000`, timeout 30 s; remove conteúdo ativo/oculto | paralelo |
| `ask_user_question` (`dsh-tool-ask-user`) | pergunta + opções/select | resposta (ou pending em modo timed) | bloqueante por default; filho ativo não pode perguntar; `-1` = infinito | exclusiva |
| `get_goal`/`create_goal`/`update_goal` (`dsh-tool-goal`) | objective, `max_goal_rounds?`, id+revision+action | JSON compacto do goal | criação/edição exige turno humano direto; CAS por revision; block exige 3 rounds | exclusiva |
| `exit_plan_mode` (`dsh-plan-mode`) | plano | aprovação/feedback | **só orientação textual**, não restringe tools; filho vivo não abre review | exclusiva |
| `skill` (`dsh-tool-skill`) | nome da skill | instruções completas | catálogo no pre-step (nome + descrição ≤ `catalogDescriptionMaxLength 500`); corpo sem cap | leitura |
| `session_search`/`session_event_search`/`session_trace`/`session_event_trace`/`session_event_read` (`dsh-tool-session-query`) | query/ids | texto cursor-free | `maxSearchResults 100`; só sessões com `cwd` exato; sem continuação | leitura |
| `present` (`dsh-tool-present`) | `files:[{path,description?}]` | paths absolutos p/ abrir | `maxFiles 8`; regular files; não copia conteúdo | exclusiva |
| `schedule_create/list/update/delete` (`dsh-tool-schedule`) | título ≤120, prompt, 1 seletor | lembrete durável | exige `ctx.schedule`; subagente delegado recusado; delete não retira entrega | leitura/exclusiva |
| `job_output`/`job_list`/`job_kill` (`dsh-tool-jobs`) | job id, `wait?`, `timeout_ms?` | saída incremental + `[status: …]` | `waitTimeoutMs 30000`, cap 600000; leitura single-consumer | exclusiva |
| `working_directory` (`dsh-tool-working-directory`) | `{}` ou `{cd}` | cwd absoluto | muda sessão, não processos nem permissões | exclusiva |
| `workspace_dependencies` (`dsh-tool-workspace-dependencies`) | — | paths de Python/Node/pnpm + versões | config `source` absoluto; não altera PATH | leitura |
| `run_code` (`dsh-tools`, modo PTC) | `code`, `description`, `timeoutMs?` | stdout/return; imagens atreladas | 120 s default / 600 s cap; valores intermediários exec-local | exclusiva |
| `cordis_inspect_list/query` (`dsh-tool-cordis`) | provider/página | APIs/types do host | creator mode apenas; read-only | leitura |

Observações transversais: resultados são **caps em bytes/tokens com aviso de omissão +
caminho de recuperação** (spill); erros sempre `Error: <mensagem>` com código estável;
nomes/args em snake_case por compatibilidade com schemas de harness existentes
(`dsh-tool-fs`).

---

## 5. Permissões, sandbox e aprovação

### 5.1 Modelo em três camadas

1. **Modo de sandbox** (efeito de arquivos): `read-only` / `workspace-write` /
   `danger-full-access`. Vale por chamada, resolvido por sessão: `SessionHeader.cwd`
   (root imutável) + override de sessão + default de deployment (`dsh-sandbox-policy`,
   default `read-only`, `workspaceRoot = process.cwd()`). `workspace-write` = workspace
   root + temp da plataforma (lista canônica compartilhada entre fence de fs e runner
   de shell — `src/roots.ts`).
2. **Política de aprovação**: `ask` (default) ou `never`; grant é **one-shot**
   (`allowed-once`), sem allow-always/memória de regra/revogação; sem answerer ⇒
   `unavailable` e **fail closed**; requests só dentro de turno aberto e cada
   request/outcome vai para o audit log da sessão (`dsh-user-approval`).
3. **Presets**: nome → (sandbox, approval). Defaults `workspace-write`/`ask` e
   `danger-full-access`/`never`; `custom` derivado (não selecionável); Auto = full
   access + ask, só com integração viva; aplica em sessões novas, sessão existente nunca
   muda por settings (`dsh-permission-presets`).

**Escalonamento:** após negação, o modelo pode repetir **a mesma call uma vez** com
`sandbox_permissions` (modo estritamente mais amplo) + `justification`; ladder fechada
(`read-only→workspace-write|danger-full-access`; `workspace-write→danger-full-access`),
aprovação humana, grant só para aquela call. Chamar com o modo já efetivo passa sem
aprovação; alvo mais estreito é inválido. Textos exatos:
`[sandbox: file access denied under <mode> mode]` + hint de escalonamento.

**Fail-closed:** sem runner capaz → `SANDBOX_UNAVAILABLE` (nunca roda sem confinamento);
`enforcement: 'full' | 'partial'` por chamada (Windows ACL e Landlock antigos = partial);
a semântica cobre **somente efeitos de arquivo** — rede/processo/credenciais fora do
vocabulário. Implementações: bwrap/Landlock/Seatbelt (`dsh-sandbox-local`), ACL
restricted-token no Windows (`dsh-sandbox-windows-acl`, Low integrity + capability SID,
um allowlist por workspace, hard links/filas em AppContainer = limites documentados).

### 5.2 Read-before-write (observation policy)

`dsh-fs-observation-policy`: gate de evento no intent slot de fs (não é método de
serviço). `write` cria arquivo novo, mas recusa sobrescrever não-lido; `edit` exige
leitura prévia; arquivo mudou desde a leitura ⇒ `FS_STALE_VERSION`; ler arquivo ausente
grava "confirmed absent" e autoriza criação guardada. Erros normalizados para o modelo:
`cannot modify "<path>": file has not been read — read the file, then retry` /
`— re-read the file, then retry`. Observações **não persistem** entre resumes e são
invalidadas em HMR/dispose. Autorização = frescor de versão, não completude de visão
(leitura janelada basta para overwrite total) — trade-off declarado.

### 5.3 Fence de fs × runner de shell × terminal

`dsh-fs-sandbox` faz canonicalize-then-contain por mutação (proteção em código confiável,
TOCTOU residual aceito); `dsh-bash-sandbox`/`dsh-pwsh-sandbox` embrulham o spawn no
runner e **inferem denial por stderr** (dialeto documentado, classificável); terminal
persistente (`dsh-terminal-bash`) compartilha a política. Todos derivam do mesmo
`SandboxPolicy`, então fs e shell não divergem de root. No Lumina isso vira:
**um `PermissionPolicy` em Rust com três modos, aplicado tanto ao fs quanto ao spawn e
ao PTY**, e um gate de observação em memória por sessão.

---

## 6. Workspace, git e terminal

- `dsh-workspace`: registry durável de projetos (diretórios) + sessões agrupadas;
  adicionar/remover/renomear/reordenar; remover **não apaga** pasta/arquivos/sessões;
  identidade por `realpath`; invisível ao modelo. Requer sessão persistente + storage.
- `dsh-working-directory`: troca o cwd da sessão (sobrevive a replay, aparece no user
  context); processos/shells existentes mantêm o cwd de nascimento; se o diretório
  original e o atual somem, **todo turno falha** até restaurar (não recria repo).
- `dsh-workspace-changes`: por turno de topo, snapshot git no início/fim + cópia de
  arquivos editados por tool (cobre o que git não cobre), gera `workspace/changes` no
  log e cards de diff por arquivo; caps (`maxFiles 500`, `maxFileBytes 2 MiB`,
  `timeoutMs 30 s`, `outputMaxBytes 8 MiB`, degradação para whole-file em 100 ms).
- `dsh-experimental-worktree`: cria checkout isolado de um commit local em branch nova,
  muda a sessão para lá, mantém a origem intacta; sandbox existente governa; sem fetch/
  submodules/LFS/untracked; sair mantém branch+arquivos.
- Terminal: `dsh-terminal` é o serviço (sessões owner-scoped, ids opacos, backends,
  cleanup quiescente); `dsh-terminal-bash` é backend PTY com readiness heurística,
  `maxReadBytes 262144`, `timeoutMs 30 s`; sessões process-local, sem compartilhamento
  entre agentes; full-screen TUI fora do contrato.
- Jobs: `dsh-jobs` (registry abstrato; ids `<kind>-<uuid>`; owner session; leitura
  consumidora × `readAt` não-consumidora; notices de conclusão) + `dsh-jobs-local`
  (`maxConcurrentJobsPerOwner 10`, ring `retainBytes 262144`, `settledRetainBytes
  16384`, pump 150 ms). Completion delivery `wakeup` (abre turno) × `quiet`.
- Subagentes: `dsh-subagent` (providers nomeados; spawn/fork in-process; ACP/SDK/Codex/
  Claude Code one-shot; activations com locks, capacity, catálogo/projeção, mensagens
  adjacentes) — `spawn` = filho sem transcrição, herda cwd/linhagem/rota; `fork` =
  seed dos turnos concluídos do pai (snapshot único, preserva prefix cache se o request
  casar byte-a-byte); `maxDepth` default 1. `dsh-experimental-agent-team`: Lead +
  teammates + task board com CAS e DAG, mesmos 9 tools, um processo/um checkout,
  escopos de escrita consultivos.
- `dsh-goal` + `dsh-goal-round-driver`: objetivo único persistente (256 rounds default),
  continua sozinho enquanto ocioso e armado; sem avaliador independente; `dsh-plan-mode`
  é orientação textual (`/plan`), não sandbox.

---

## 7. Prompt, skills, MCP e plugins

### 7.1 Prompt

- `dsh-system-prompt`: montagem por **seções ordenadas** com `order`, condições de
  visibilidade, variáveis interpoladas; plugins contribuem seções (ex.: guidance de
  `read`/`write`/`edit` só renderiza se a tool está visível para aquele agente — cada
  tool README documenta o texto exato e o custo de tokens/cache).
- `dsh-agent-instructions`: carrega instruções do repositório (AGENTS.md) — é exatamente
  o mecanismo que injetou este documento no system prompt. `dsh-persona`: persona por
  deployment/agente. `dsh-scope`, `dsh-home-paths`: escopos de configuração e paths
  (`~/.dsh`, cache, sessões) sem hardcode no código.
- Custo: system prompt + schemas pagos **a cada step**; guidance condicionada à
  visibilidade evita pagar por tool escondida. Mudança de prefixo invalida cache KV a
  partir do primeiro token alterado.

### 7.2 Skills

`dsh-skill` + providers (`dsh-skill-filesystem`, `-badge`, `-office`): descoberta por
cwd da sessão; antes do primeiro request, catálogo durável (nome + descrição capada) é
injetado via pre-step se a tool `skill` está visível; `/nome` invoca skill user-invocable
(injeta as mesmas instruções naquele step); mudanças de catálogo anexam substituição
completa (inclusive vazio para aposentar nomes). Corpo carregado **sem cap** e one-shot
(sem streaming/cache); tool só reporta base dir/URL, não enumera recursos.
No Lumina, o equivalente é ler `skills/<name>/SKILL.md` + frontmatter, injetar catálogo
no prompt e ter uma tool `skill`.

### 7.3 MCP

`dsh-mcp-client`: descobre tools/resources de servidores MCP e registra as tools no
mesmo `ctx.tools` com os schemas do servidor (portanto entram no mesmo pipeline de
política/apresentação); `dsh-mcp-resources` expõe resources. Transporte/spawn do MCP é
do SDK e não passa pelo `ctx.subprocess` (env scrub reutilizado).

### 7.4 Cordis (arquitetura de plugins) — e por que não copiar

Cordis: contexto hierárquico de serviços (`ctx.x`), plugins com `apply`/`inject`,
escopos/fibras com efeitos reversíveis, `cordis.yml`/presets com `config.plugins`,
loader com HMR, eventos e waterfalls (`ctx.waterfall`, `ctx.on`, `ctx.emit`), serviços
podem ser "merge-extensible" por declaration merging (SessionEventMap, SessionProjectionMap).
O DSH ganha: composição declarativa, bundles (`dsh-base`, `dsh-sdk-minimal`), reload
parcial, testes de integração por composição, e presets por tipo de agente.

Custo: dependência do loader/HMR, nomes de serviços virando contrato público,
`inject`/`pending` (plugin fica pendente se serviço falta), ordem de plugin afetando
semântica (ex.: "first-wins" na observation policy), e a limitação de que
projeções/eventos são process-wide. Para um app Rust/Tauri **sem plugin system**, copiar
os *seams* (traits + eventos tipados + waterfall de interceptação) e não o loader.

---

## 8. Gateway e padrões de UI do layout Code

> Seção **inferida** de READMEs de `dsh-client-ui-*` e de consumidores; o
> `dsh-api-gateway` não foi lido em detalhe (pacote de 23,8 KB).

### 8.1 Transporte

`dsh-api-gateway` + controllers (`dsh-api-session-controller`, `-workspace-controller`,
`-job-controller`, `-terminal-controller`, `-workspace-files`, `-settings-controller`,
`-models` etc.) expõem comandos e **Remote events**; o cliente (`dsh-client-connection`)
reconecta e re-sincroniza. Padrão importante: a UI não monta transcript por conta
própria — `ui-conversation` consome feeds do Session Controller
(`SessionEventLikeEntry`), e projeções viajam como snapshots completos por chave.

### 8.2 Layout de três colunas (`dsh-client-ui-layout`)

AppFrame com coluna esquerda (rail 56 px + sidebar), centro (conversa) e direita
(inspeção). A direita **cede espaço antes do centro**; ocupante pode renderizar
fullscreen mantendo a track larga por baixo; animação de squeeze compartilha uma única
curva/duração via `data-animating` (evita descolar painel da conversa); geometria é
transiente (reload volta ao default, sem persistência por sessão); mínimo ~400 px no
centro.

### 8.3 Painéis e superfícies

| Pacote | Superfície | Padrão de UX |
|---|---|---|
| `-sidebar-files` | árvore do workspace da sessão | refresh automático por watch de entradas diretas + reload manual; abrir arquivo = recurso `dsh-resource://file/session/<id>/<path>` na aba; dirs "other" acinzentados; sem busca/drag-highlight |
| `-sidebar-terminal` | terminais do usuário | escolher shell na Start page, rodar no cwd da sessão, renomear tabs, colapsar mantendo processo, fechar tab pede término; permissões do usuário do SO independentes das do agente |
| `-trajectory` | ledger por turno/step | agrupa User/Assistant/Tool/Subtool/compaction, marca boundaries, inspector de token/tempo/IO/imagens; abre no tail, pagina para trás, virtualiza; streaming segue tail até scroll up, in-flight mostra start sem inventar duração |
| `-plan` | review de plano | `/plan` abre direto na sidebar direita; aprovado/rejeitado/descartado vira card no artifact area do turno; reabrir foca aba existente; reload restaura do histórico |
| `-jobs` | header control | live rows com duração ticking + kind/status, painéis expansíveis que param stream ao colapsar; settled fold sob heading; canais stdout/stderr concatenados |
| `-approval` | toma o composer | request pendente publicada por Remote Event, painel com decisão allow-once/reject + detalhe de tool correlacionado; copy localizada do requester sem alterar audit reason |
| `-subagent` | header do pai | conversas locais (atividade/tokens/duração), follow-up e Stop em filhos continuáveis, externos como folhas não-navegáveis, one-shot read-only; sidebar normal omite subagentes |
| `-workflow-run` | nó de chat por run | nó → fases → membros; níveis running/failed/cancelled/interrupted abertos; membro abre child session só se local/da sessão atual; só identidade/status (sem script/output/erro) |
| `-tool` | renderer de tool calls | `ui-conversation` despacha nó `tool-call` por slot `tool.call.toolview`; cards genéricos para não registrados; business packages registram só nomes/views e não pareiam eventos (runtime é autoridade de pairing/lifecycle/subCalls) |
| `-user-questions` | card junto ao composer | opções + texto, skip, batch de resposta; timed card com countdown (foco pausa, "Take time" segura), expira e mantém answerable; draft local do browser, pergunta durável no host |
| `-conversation`/`-chat`/`-renderer` | shell de conversa | registries React-free + bindings por sessão; scroll com follow por scrollport (outer/group independentes, botão back-to-bottom quando ambos detidos); local echo de submissões sai atomicamente quando chega o registro autoritativo |

Padrões que valem para o workbench Code do Lumina: **três colunas com painel direito
sacrificável**, **tabs de recurso com endereço estável** (`dsh-resource://`), **ledger
de trajetória por turno/step com inspector**, **cards de mudança por turno**, **jobs no
header com painel**, **approval takeover do composer**, **subagentes no header do pai**,
e — o mais importante — **estado de UI = projeções completas do log**, não stores
sincronizados à mão.

---

## 9. Headless, SDK e ACP

- `dsh-headless` (16 KB): composição sem GUI para rodar o mesmo runtime por CLI/CI,
  útil como referência de "qual o mínimo de plugins para um agente funcional".
- `dsh-sdk-protocol`/`dsh-sdk-jsonrpc-server`/`dsh-sdk-app`/`dsh-sdk-minimal`:
  superfície pública (JSON-RPC) para dirigir agentes de fora; `dsh-sdk-minimal` é o
  bundle mínimo (loop+agent+session+llm+tools).
- `dsh-acp`/`dsh-acp-app` (13 KB): integração Agent Client Protocol para orquestrar
  agentes externos (backend de subagente ACP, one-shot, sem follow-up local).
Para o Lumina: o análogo do SDK é uma camada `commands/events` Tauri estável; ACP pode
esperar (relevante só se o produto for orquestrar agentes externos).

---

## 10. O que copiar / o que NÃO copiar para o Lumina

### 10.1 Copiar (com prioridade)

| # | Mecanismo | Onde está no DSH | Por que copiar | Como no Lumina (Rust/Tauri) | Prio |
|---|---|---|---|---|---|
| 1 | **Log append-only como fonte da verdade + `deriveMessages()`** | `dsh-session`, `session-persistence-jsonl` | replay determinístico, crash recovery, fork/export, compactação sem perda, UI barata | `SessionEvent` enum serde (tag `type`), arquivo JSONL por sessão em `app_data/sessions/<id>.jsonl`, superfície derivada em memória; gravador com flush/fsync e correção de tail truncado | P0 |
| 2 | **Turno/passo com checkpoint fail-closed** | `dsh-agent-loop`, `dsh-session-checkpoint-policy` | evita efeito externo sem registro; recuperação "unknown outcome" em vez de retry cego | loop tokio: `before_request`/`before_tool`/`before_step` chamando `Session::append_durable()`; `tool_call` sem resultado ⇒ resultado sintético `outcome_unknown` | P0 |
| 3 | **Pipeline de tools com waterfall allow/deny/ask + resultado estruturado** | `dsh-tools` | um lugar para política, timeout, presentação e caps; tools não desviam | trait `Tool` (schema/execute/present) + `Vec<Box<dyn ToolInterceptor>>`; erros `ToolError{code,message,recovery}` e `Error: <msg>` no wire | P0 |
| 4 | **Leitura antes de escrita + versão (CAS)** | `dsh-fs-observation-policy` | evita overwrite de arquivo não visto/alterado; é o que torna agentes de código seguros sem sandbox total | `HashMap<PathBuf, FileVersion>` por sessão; `write`/`edit` exigem entrada fresca; erro com instrução de re-leitura | P0 |
| 5 | **Modo sandbox por chamada + escalonamento one-shot + fail-closed** | `dsh-sandbox*`, `dsh-permission-presets` | é o modelo de confiança que usuários entendem: read-only/workspace-write/full + ask/never | enum `SandboxMode` + `ApprovalPolicy`; aplicar em spawn de shell e em mutações de fs; sem implementação de runner ⇒ recusar (fail-closed) | P0 |
| 6 | **Caps + spill + aviso de omissão em toda saída de tool** | `dsh-output-retention`, `dsh-spill*` | contexto previsível, recuperação completa via arquivo, UX de "truncado" | `Retention{head,tail,marker}` + gravar excedente em `spills/<sessão>/<uuid>.txt` e devolver path | P0 |
| 7 | **Compactação bracket-first com template de checkpoint** | `dsh-compaction`, `-basic`, `-tool-result-pruner` | mantém sessões longas vivas; o template de 8 seções é reaproveitável; pruning barato antes do resumo | evento `compaction/start..end`, substituição de superfície por range, resumo via chamada auxiliar reutilizando prefixo; pruner de tool output antes | P1 |
| 8 | **Projeções por chave (todos, stats, título, permissions, outline)** | `dsh-session-projection` + pacotes | UI reativa sem replay e sem divergência; stats consistentes após compactação | `Projection` trait fold(evento) → valor; emitir snapshots via `tauri::emit`; derivar sidebar/stats/outline do mesmo fold | P1 |
| 9 | **Inbox com followup/steer/inject** | `dsh-agent` | separa "próximo turno", "mais um step" e "contexto sem acordar" — base de UX de chat com fila | `VecDeque<QueuedPrompt>` + `steering: Vec<Message>` + `injected: Vec<ContextBlock>`; eventos de splice no log | P1 |
| 10 | **Classificação paralelo-safe × exclusiva + barreira** | `dsh-agent-loop/src/tool-calls.ts` | latência de leitura e ordem de mutação sem locks espalhados | `execution_mode()` no trait; `JoinSet` para paralelas, mutex/serial para exclusivas | P1 |
| 11 | **Workspace changes por turno (git + cópia de edits)** | `dsh-workspace-changes` | card de arquivos alterados confiável mesmo sem git/arquivos não rastreados | rodar `git status/diff` no start/end do turno; copiar arquivos editados por tool; emitir `workspace/changes` | P1 |
| 12 | **Ledger de trajetória + outline de turnos** | `dsh-client-ui-trajectory`, `dsh-session-turn-outline` | inspeção de custo/tempo por passo; navegação sem carregar tudo | eventos de step/usage no log; UI com virtualização e paginação por seq | P1 |
| 13 | **Jobs/PTY owner-scoped com notices** | `dsh-jobs*`, `dsh-terminal*` | comandos longos sem travar o agente; terminal persistente é requisito do layout Code | `JobRegistry` tokio + ring buffer; PTY via `portable-pty`; notice no inbox ao terminar | P2 |
| 14 | **Subagentes com providers + fork sem copiar sessão** | `dsh-subagent*` | delegação barata e auditável; fork preserva prefix cache | `SubagentBackend` trait; fork = seed dos eventos de turnos concluídos | P2 |
| 15 | **Skills e AGENTS.md** | `dsh-skill`, `dsh-agent-instructions` | capacidade de projeto sem MCP; barato | ler `AGENTS.md` do workspace + catálogo de `skills/*/SKILL.md` no prompt; tool `skill` | P2 |

### 10.2 Não copiar (e por quê)

| Mecanismo do DSH | Por que **não** transplantar |
|---|---|
| **Cordis + loader + HMR + `cordis.yml`/presets** | É um sistema de plugins completo com lifecycle assíncrono, `inject`/pending, merge de tipos TS e ordem de plugin semanticamente relevante. Num app Tauri fechado isso vira complexidade de framework sem usuário; os seams (trait + evento + interceptor) entregam 80% do valor com 5% do custo. |
| **Arquitetura de bundles/presets por agente** (`dsh-base`, `standard`/`minimal`/`ptc`, `agent-presets`) | Só faz sentido com plugin system; no Lumina o "preset" deve ser configuração tipada do app (modo Chat × Code × Plan), não composição de pacotes. |
| **PTC (`run_code` + SDK gerado)** | Exige runtime de avaliação de código, sandbox extra, IDs duráveis de sub-call e semântica de valores intermediários não reconstruíveis por replay. Alto risco e superfície de segurança; ganho de tokens não justifica na v1. |
| **Gateway HTTP + controllers + Remote events** | Lumina já tem IPC Tauri tipado; um servidor local paralelo duplica autorização, reconexão e re-sync. Copiar o *contrato* (comandos finos, eventos, snapshots de projeção), não o transporte. |
| **UI por slots e plugins client-side** (`dsh-client-ui-*` como pacotes) | A modularidade é para um ecossistema de plugins; no Lumina o workbench é código do app. Copiar os **padrões de layout/interação** (§8), não a arquitetura de slots. |
| **Zstd por frame + gerações imutáveis + cadeia v0→v4** | Over-engineering para v1. JSONL puro + versão no header + função de migração é suficiente; comprimir/generation só se arquivos crescerem. |
| **Sessão "memory-only" por padrão** | O DSH pode operar sem persistência; um app desktop local-first precisa persistir desde o primeiro turno (ou o usuário perde histórico em crash). |
| **Escalonamento via argumentos no schema** (`sandbox_permissions`/`justification` por call) | O schema fica estável, mas o modelo gasta tokens e pode errar; no Lumina o diálogo de permissão deve ser acionado pelo app (UI) com um evento de tool pendente, sem depender do modelo pedir de novo. |
| **Workspace/agent-team experimental** | Task board com CAS/DAG e broadcast de roster inteiro é experimento com contratos instáveis; implementar só se houver requisito de multi-agente real. |
| **Time context com fuso do browser** | Relevante para chat web multi-fuso; num desktop de usuário único, relógio local no prompt é suficiente. |

### 10.3 Ordem de implementação sugerida (para o plano do Lead)

1. **P0 — espinha dorsal** (1ª entrega): `SessionEvent` + log JSONL + `deriveMessages` +
   fixtures de replay; loop turno/passo com `before_request`/`before_tool` checkpoints;
   tool registry/pipeline; tools de fs (`read`/`write`/`edit`) + `glob`/`grep`; bash com
   captura de saída e exit markers; caps + spill; `todos` e `stats` como primeiras
   projeções.
2. **P0.5 — segurança**: observation policy (versão/CAS), modos de sandbox aplicados ao
   fs e ao spawn, aprovação `ask`/`never` com request/response tipados (comando Tauri +
   evento `approval/requested`), teste de "fail-closed sem runner".
3. **P1 — contexto e UI de código**: token meter heurístico + pressão; compactação com
   template de 8 seções + pruner; workspace-changes por turno; trajetória com
   step/usage; layout de três colunas com tabs de recurso.
4. **P2 — orquestração**: jobs/PTY; subagentes (spawn + fork), skills/AGENTS.md,
   `present`, `schedule`, `workflow` eventualmente.

### 10.4 Riscos e armadilhas observadas no DSH (evitar repetir)

- **Política declarada mas não aplicada**: `timeoutMs` no `defineTool` é decorativo; o
  loop só aplica via wrapper. No Lumina, se `timeout` está no contrato, o runtime deve
  aplicá-lo (abort do future + resultado `TOOL_TIMEOUT`).
- **Classificação de concorrência unária**: tools que dependem de comparar irmãos/
  recursos precisam ser exclusivas; documentar isso no trait (default = exclusiva).
- **Estado de observação não persiste**: resumir sessão exige re-leitura; se o Lumina
  persistir observações, incluir hash de conteúdo no evento para sobreviver a resume.
- **Falha de fechamento de lock deixa órfão**: escolher deliberadamente entre "lock
  órfão = busy" (DSH) e recuperação automática; documentar o comportamento de crash.
- **Cancelar limpa a inbox por default** e não existe "abortar só o step"; definir
  semântica de stop do usuário no Lumina (parar turno × limpar fila × manter fila).
- **Custo de medir**: token meter clona a superfície por medição; no Rust, manter
  contadores incrementais por evento e só re-medir em compactação/UI.
- **Eventos projeção são process-wide e carregam todas as chaves**: se a UI do Lumina
  assinar projeções, preferir chaves por sessão e filtros no `emit` para não vazar
  estado entre abas.

### 10.5 Síntese de arquitetura alvo (Lumina, harness de código nativo)

```
src-tauri/src/harness/
  session/     log.rs (append/derive/replay), surface.rs (surfaceOp), projections/
  loop/        turn.rs, step.rs, tools_sched.rs (parallel/exclusive), cancel.rs
  tools/       registry.rs (trait Tool + schema), intercept.rs, result.rs, caps.rs
  tools/fs/    read.rs write.rs edit.rs glob.rs grep.rs observe.rs
  tools/exec/  shell.rs (bash/pwsh, jobs, PTY), timeout.rs
  policy/      sandbox.rs (modes + escalation), approval.rs, presets.rs
  context/     token_meter.rs, compaction.rs, pruner.rs, spill.rs
  workspace/   registry.rs, changes.rs (git snapshots), worktree.rs
  prompt/      system_prompt.rs (seções), instructions.rs (AGENTS.md), skills.rs
  subagent/    backend.rs (spawn/fork), messages.rs
  events/      emit.rs (TurnEvent/ProjectionEvent/ApprovalEvent) → src/lib/api.ts
```

O app React (Code layout) consome: `ProjectionEvent` (snapshots completos por chave),
`TurnEvent` (streaming de step/chunk/tool) e `ApprovalEvent`/`QuestionEvent` (takeover
de composer). Nenhuma tela recalcula transcript: ela renderiza o que o log projeta —
que é a lição central do DSH, independente do Cordis.

---

## Apêndice A — evidências (todos os caminhos sob `.research/asar-out/dsh/node_modules/@deepseek-ai/`)

- **Loop/inbox/paralelismo**: `dsh-agent-loop/README.md` (§§Use this package, Understand…, Model Experience, Known Limitations; source map `src/agent.ts`, `src/inbox.ts`, `src/tool-calls.ts`), `dsh-agent/README.md` (`src/runtime-types.ts`, `src/dispatch.ts`, `src/model-selection.ts`).
- **Tools**: `dsh-tools/README.md` (`src/index.ts`, `src/schema.ts`, `src/ptc.ts`) e READMEs de `dsh-tool-fs`, `dsh-tool-fs-search`, `dsh-tool-str-replace-editor`, `dsh-tool-bash{,-persistent}`, `dsh-tool-pwsh{,-persistent}`, `dsh-tool-terminal`, `dsh-tool-todo`, `dsh-tool-subagent{,-control}`, `dsh-tool-workflow`, `dsh-tool-ralph`, `dsh-tool-web`, `dsh-tool-ask-user`, `dsh-tool-goal`, `dsh-plan-mode`, `dsh-tool-skill`, `dsh-tool-session-query`, `dsh-tool-present`, `dsh-tool-schedule`, `dsh-tool-jobs`, `dsh-tool-working-directory`, `dsh-tool-workspace-dependencies`, `dsh-tool-call-timeout-policy`.
- **Sessão/contexto**: `dsh-session`, `dsh-session-format{,-v0..v4}`, `dsh-session-persistence-jsonl`, `dsh-session-projection`, `dsh-session-checkpoint-policy`, `dsh-session-turn-outline`, `dsh-session-stats`, `dsh-session-title{,-llm}`, `dsh-session-query`, `dsh-session-log-export`, `dsh-token-meter`, `dsh-compaction{,-basic,-tool-result-pruner,-image-offload}`, `dsh-spill{,-policy,-local}`, `dsh-output-retention`, `dsh-repeat-tool-reminder`, `dsh-time-context`, `dsh-llm{,-retry,-deepseek}`.
- **Permissões/sandbox**: `dsh-sandbox{,-policy,-local,-windows-acl}`, `dsh-fs{,-local,-sandbox}`, `dsh-fs-observation-policy`, `dsh-{bash,pwsh}-sandbox`, `dsh-user-approval`, `dsh-permission-presets`, `dsh-shell`, `dsh-subprocess`.
- **Workspace/orquestração**: `dsh-workspace{,-changes}`, `dsh-experimental-worktree`, `dsh-working-directory`, `dsh-terminal{,-bash}`, `dsh-jobs{,-local}`, `dsh-subagent{,-fork-in-process,-spawn-in-process}`, `dsh-experimental-agent-team`, `dsh-goal{,-round-driver}`.
- **Prompt/skills/MCP** [parcialmente inferido de consumidores]: `dsh-system-prompt`, `dsh-agent-instructions`, `dsh-persona`, `dsh-skill`, `dsh-tool-skill`, `dsh-mcp-client`, `dsh-scope`, `dsh-home-paths`.
- **UI**: `dsh-client-ui-{layout,workspace,sidebar-files,sidebar-terminal,trajectory,plan,jobs,approval,subagent,workflow-run,tool,conversation,chat,renderer,session,user-questions,commands,goal}`.
- **Headless/SDK/ACP** [parcial]: `dsh-headless`, `dsh-sdk-{protocol,jsonrpc-server,minimal,app}`, `dsh-acp{,-app}`.
