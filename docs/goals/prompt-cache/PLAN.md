# Cache de prompt 98–99% em todos os provedores — Implementation Plan

**Intent:** fazer o Lumina reutilizar o prefixo de prompt cobrado pelos provedores em
todos os turnos e protocolos (`openai-chat`, `openai-responses`, `anthropic`,
`google`) e provedores (OpenCode Go, OpenCode Zen, OpenAI direto, Anthropic direto),
com meta de **98–99% de cache hit** em regime estável, medido pelo `usage` reportado
pelo provedor e visível **em tempo real** no medidor de contexto.

**Current Behavior:** o cache é passivo, acidental e invisível.
- **O próprio Lumina quebra o prefixo a cada turno no perfil Code**: relógio com
  minuto (`%Y-%m-%d %H:%M`) no topo do system prompt (`harness/mod.rs:1005` →
  `harness/code/prompt.rs:276-280`) e reconstrução por turno de git status/árvore/
  plano/tarefas/AGENTS.md/modo (`harness/code/prompt.rs:81-230`,
  `harness/code/context.rs:103-132`).
- Notas de modo são anexadas ao system prompt no meio do turno
  (`harness/mod.rs:631-636,1199-1209`); o **final forçado** troca o system prompt e
  zera as tools (`harness/mod.rs:1476-1500`) no request mais caro do turno.
- O prompt do Chat embute a data do dia no topo (`harness/prompt.rs:31,36-56,623`).
- O histórico é reescrito: corte deslizante por orçamento de caracteres
  (`harness/mod.rs:2022-2050,2185-2188`), imagens que podem virar texto em mensagens
  antigas (`harness/mod.rs:2209-2235`) e compactação que troca a cabeça
  (`harness/code/compaction.rs:137-143,214,261-274`).
- Nenhum protocolo envia campo de cache: Anthropic sem `cache_control`
  (`providers/anthropic.rs:50-117`), OpenAI sem `prompt_cache_key`/retenção
  (`providers/openai_responses.rs:63-137`), Google sem `cachedContent`
  (`providers/google.rs:47-88`). O único gancho pronto é `x-opencode-session`
  estável (`providers/mod.rs:174-176,222-240`).
- Medição insuficiente: `UsageInfo` só tem `cached_tokens`
  (`domain.rs:175-193`); Anthropic não lê `cache_creation_input_tokens`
  (`providers/anthropic.rs:425-439`); `usage` só sai no fim do turno
  (`harness/mod.rs:1663-1668`); `context_stats` só no Code
  (`harness/mod.rs:1099-1110,1214-1231`); `usage_log` tem `cached_tokens` mas não
  write/uncached/hit% (`db.rs:131-144`).

**Expected Outcome:**
1. Prefixo **append-only** por conversa/rota: o request do turno N+1 começa com os
   mesmos bytes do request do N; só a cauda nova difere. Caudas transitórias (ex.:
   instrução de wrap-up) não fazem parte do surface persistente.
2. Cada provedor usa o mecanismo que realmente suporta, sem inventar campo:
   Anthropic `cache_control`, OpenAI `prompt_cache_key`/retenção/TTL, gateways
   OpenCode com `x-opencode-session` + pass-through, Google implícito,
   DeepSeek/híbridos sem campo.
3. Hit% real (tokens cobrados) calculado por **request de wire**, persistido e
   exibido com estado (`aquecendo`/`estável`/`caiu`/`não reportado`), causa da quebra
   e **teto teórico** (`P/(P+Δ)`) para o número ser interpretável.
4. O medidor de contexto (Code) e o chip do Chat mostram **cache NN% em tempo real**
   (atualiza ao fim de cada request do provedor), com popover de diagnóstico, teto,
   TTL e economia estimada.
5. Compactação e poda deixam de ser quebras silenciosas: o resumo reusa o prefixo
   (cache read) e a quebra vira epoch registrado; Chat e Code têm política própria.
6. Baseline e resultado medidos por **perfil × provedor × protocolo**, com protocolo
   de benchmark fixo e artefato bruto: meta atingida nos provedores que reportam
   cache; exceções (Gemini 4, plano OAuth, gateway sem pass-through) documentadas com
   o número real — nunca maquiadas.

**Target-Perspective Output:**
- **Code:** ao lado do anel de contexto, um selo `cache 98%` que atualiza ao fim de
  cada request durante o streaming; popover com `lido do cache / gravado / novo`, teto
  teórico, estado, última quebra (causa), TTL e economia.
- **Chat:** um chip `cache 98%` no composer (antes do `ModelPill`), cache-first (sem
  anel de contexto na v1), mesma informação essencial no popover. `% de contexto` no
  Chat fica como P2 (§12).
- **Verificação:** o Lead executa `cargo test --lib cache_bench -- --ignored` e
  registra a matriz real em `EVIDENCE.md`; a verificação manual no app empacotado
  mostra o mesmo número do `usage` do provedor (diferença ≤1 p.p.), com o `usage`
  bruto copiável no painel de diagnóstico.

**Truth Owner:** o backend é dono da verdade.
- `providers::cache` é o **único dono** da identidade do wire prefix (digest dos
  segmentos canônicos do body final, com metadados de cache removidos do hash) e da
  normalização do `usage`.
- `harness::cache` consome o digest e é dono do `RequestSurface` (o que o modelo vê
  por turno), do epoch, da atribuição de causa e da amostra.
- `db` persiste `prompt_snapshots`, `surface_items`, `cache_state`, `cache_samples`.
- O renderer **só projeta** — nunca deriva hit% de heurística local nem inventa
  estado.

**Contract Boundary:**
- `CompletionRequest` → corpo de request por protocolo (breakpoints, chaves, headers).
- `UsageInfo` (Rust/TS) → `CacheUsage` normalizado `{read, write, uncached, total}`,
  com `reported: bool`.
- `TurnEvent` → `cache_stats` (uma amostra por request de wire); `usage` continua com
  totais do turno.
- `data/catalog.json` → `provider.cache`/`model.cache` (modo, mínimo, granularidade,
  TTL, key/retention, o que é reportado; `minTokens: null` = desconhecido).
- SQLite → `prompt_snapshots`, `surface_items`, `render_decisions`, `cache_state`,
  `cache_samples`, `usage_log` estendido (migrações aditivas).
- `Settings.cache` (mostrar indicador, TTL Anthropic, retenção OpenAI) — contrato
  Lead em `domain.rs`/`config.rs`.
- Comando IPC `get_cache_stats` (restauração do indicador ao reabrir a sessão).

**Cutover:** F0a mede o baseline sem mudar comportamento; F0b fecha contratos; F2 vira
o caminho dominante do Chat (snapshot de prompt, surface append-only, contexto na
cauda); F3 faz o mesmo no Code e na compactação; F4 liga os mecanismos explícitos por
provedor (probe primeiro); F5 fecha a UI; F6 **remove** o caminho deslocado (corte
deslizante, relógio no prompt, final forçado que muda prefixo, prompt antigo).
**Não há feature flag de produto**: rollback é reverter o release (o pacote entra por
fases com gates); só `Settings.cache.show_indicator` é preferência de UI.

**Displaced Path:** (a) corte deslizante `history_budget`; (b) system prompt volátil
(relógio, git, tree, plano/todos, modo, data); (c) `mode_notes` no head e final forçado
com prompt/tools diferentes; (d) compactação com prompt próprio e `to_seq`
inconsistente; (e) decisão de imagem recalculada; (f) `ContextMeter` só de contexto;
(g) `usage_summary` `#[cfg(test)]`. **Não** é deslocado: `usage` por turno (continua
como total de billing); `context_stats` por passo no Code (continua; ganha o bloco de
cache via evento próprio).

**Value Density:** com `P/(P+Δ)` alto, o input cacheado custa `cost.cache_read` por
token. Fator de economia sem writes = `1 / (1 − h·(1−r))`: com `r=0,1` e `h=98%` →
**~8,5×**; `h=99%` → **~9,2×**; com `r=0,05` → **~14×**. O alvo de custo é por
provedor/modelo e **inclui writes/cold starts** (§2.4), não uma promessa universal de
10×.

**Evidence Gate:** a fase só fecha com (1) teste automatizado novo passando,
(2) número de cache reportado pelo provedor em benchmark roteirizado (mediana de N
repetições + artefato JSON bruto) quando houver credencial, (3) indicador da UI
coerente com esse número, (4) entrada em `EVIDENCE.md`. Provedor sem credencial
disponível é marcado **“implementado, não provado”** e não bloqueia os demais — mas
não entra na afirmação de meta global. "Compilou" ou "o body tem o campo" não é
evidência de cache hit.

**Acceptance Evidence:** `docs/goals/prompt-cache/EVIDENCE.md` com baseline e
resultado por perfil × provedor × protocolo/modelo, artefatos JSON brutos em
`docs/goals/prompt-cache/evidence/`, custo medido, testes (`cargo test --lib`,
`pnpm test`, `pnpm typecheck`, `pnpm build`), e verificação manual no app empacotado.

**Evidence Lane:** backend (`cd src-tauri && cargo test --lib`; live
`cargo test --lib cache_bench -- --ignored`), renderer (`pnpm typecheck`, `pnpm test`,
`pnpm build`), manual de release.

**Kill Criteria:**
- Provedor/gateway rejeitar campo explícito (400): adaptador cai no modo automático,
  UI mostra `não suportado`; sem retry infinito nem campo proibido.
- Se o prefixo persistente não puder ser append-only em um fluxo de produto (troca de
  modelo, regenerar, truncar), vira epoch novo com causa explícita — nunca quebra
  silenciosa.
- Se um caso inesperado quebrar o prefixo em regime estável, o teste falha (gate de
  CI).
- Se o provedor não reporta cache, o indicador mostra `—`/`não reportado`; é proibido
  derivar % de heurística local e chamar de hit.
- Se a meta não for atingível em um provedor mesmo com prefixo estável (regra dos
  2.050 tokens do Gemini 4, TTL, gateway), documentar como exceção com o número real
  e o teto teórico.
- Se a reestruturação do prompt degradar qualidade (testes de prompt/comportamento),
  rollback da fase de prompt e reavaliação: cache não vale regressão funcional.

**Architecture Slice:**
- Criar: `src-tauri/src/providers/cache.rs` (capabilities/digest/apply/normalize),
  `src-tauri/src/providers/cache_bench.rs` (benchmark `#[ignore]`, dono provider-dev,
  matriz definida pelo Lead), `src-tauri/src/harness/cache/` (`mod.rs`, `prefix.rs`,
  `epoch.rs`, `surface.rs`, `snapshot.rs`), `src-tauri/src/commands/cache.rs`,
  `src/lib/cache.ts`, `src/lib/store/cacheStore.ts`,
  `src/components/agent/CacheHitChip.tsx` (ou dentro de `ContextMeter.tsx`),
  `scripts/probe-cache.mjs` (opcional, probe de campos), `docs/goals/prompt-cache/*`.
- Modificar: `domain.rs`, `events.rs`, `catalog.rs`, `data/catalog.json`,
  `scripts/build-catalog.mjs`, `providers/{mod,openai_chat,openai_responses,anthropic,google}.rs`,
  `harness/mod.rs`, `harness/prompt.rs`, `harness/code/{prompt,context,compaction}.rs`,
  `harness/{batch,code/subagent}.rs`, `db.rs`, `config.rs`,
  `commands/{turn,code,conversations,mod}.rs`, `lib.rs`, `src/lib/types.ts`, `api.ts`,
  `store/{chatStore,codeStore}.ts`, `components/agent/{ContextMeter,index}.tsx`,
  `components/code/{CodeAgentWidgets,CodeSessionHeader}.tsx`, `components/composer/*`,
  `components/settings/*`, `src/styles/globals.css` (só se faltar token).
- Evitar: áreas de outro dono sem mensagem ao Lead; `src/lib/genui/**`,
  `data/genui-*`; `src-tauri/target`.
- Source of truth: bytes do request por protocolo (prefixo) + `usage` do provedor
  (hit%) + `RequestSurface` canônico (replay) + `prompt_snapshots`/`surface_items`
  (persistência).
- Read path: `run_turn` → prompt snapshot/surface → `build_body` →
  `cache::apply` → `cache::digest` (body final, metadados fora do hash) → stream →
  `cache::normalize_usage` → `CacheSample` → `cache_stats` → store → `ContextMeter`.
- Write path: `prompt_snapshots`, `surface_items`, `render_decisions`, `cache_state`,
  `cache_samples`, `usage_log`; settings; catálogo gerado.
- Integration points: `providers/mod.rs::stream_one`, loop do `harness/mod.rs`,
  `commands/cache.rs`, `ContextMeter`/Chat, Settings.

**Plan Review Gate:** PRE concluído (rodadas 1–3, verdict `aligned`/GO em
`REVIEW-PRE.md`). **Execução concluída** — revisão final em `REVIEW-FINAL.md`
rodada 4: **`complete with documented exceptions`**. Evidência em `EVIDENCE.md`:
baseline por ablação (plan None → 0,0%), probes por rota, bench E2E `run_turn` com
cold-start real (steady 99,70%, ciclo 92,87%, baseline 0,0%) e gates Rust
937/13 + renderer 2216/2216. Exceções documentadas: OpenAI/Anthropic diretos sem
credencial válida, gateway `openai-chat` sem reporte, gateway `google`
indisponível, N=5/p50/p10 run-level reduzido a uma run e verificação visual manual
no app empacotado não executada.

### 0.1 Como ler este pacote

| Arquivo | Conteúdo |
| --- | --- |
| [`PLAN.md`](PLAN.md) | este plano (contrato, diagnóstico, arquitetura, fases, tarefas, evidência) |
| [`GOAL.md`](GOAL.md) | prompt curto de execução (Krypton Execution) |
| [`EVIDENCE.md`](EVIDENCE.md) | evidência real preenchida durante a execução |
| [`REVIEW-PRE.md`](REVIEW-PRE.md) | review PRE independente (rodadas 1–3; verdict final `aligned`/GO) |
| [`prompt-caching.md`](../../research/prompt-caching.md) | mecânica por provedor + OpenCode + DSH (fontes) |
| [`cache-audit-backend.md`](../../research/cache-audit-backend.md) | auditoria do backend atual |
| [`cache-audit-ui.md`](../../research/cache-audit-ui.md) | auditoria do medidor/UI + spec do indicador |

### 0.2 Rodada 1 do PRE — como os blockers foram resolvidos

| Finding | Resolução neste plano |
| --- | --- |
| B1 — meta não mensurável | §2: unidade = request de wire; fórmula `hit = 1 − Δ/P` e teto `P/(P+Δ)`; três números separados (reuso com `transient_tail` excluído, steady sem cold/write-only com ceiling, ciclo de vida com condição `(P_cold+P_write+ΣΔ)/ΣP ≤ 2%`); elegibilidade com `minTokens` do catálogo (`null` = desconhecido) e contagem de excluídos; Gemini 4 em `P/δ`. |
| B2 — persistência prometida sem contrato | §4.2/§5.3: `prompt_snapshots` (system + tools + hashes), `surface_items`, `render_decisions`, colunas exatas de `cache_samples`; granularidade de `usage_log` declarada (por turno, billing; canônico por request = `cache_samples`); testes de restart/reabertura. |
| B3 — posição de conteúdo injetado no replay | §4.3/§4.4: `surface_items` com `after_step` (posição dentro do replay multi-step) e `seq`; caudas transitórias (wrap-up) explicitamente fora do surface; testes cross-turn com troca de modo e final forçado. |
| B4 — dono/entrada do digest ambíguo | §4.3/§4.5: dono único `providers::cache::digest`, entrada = segmentos canônicos do body final **com metadados de cache removidos do hash**; `harness::cache` só consome; teste restart + TTL/breakpoint mudando sem quebra falsa. |
| B5 — ordem F3 antes de F4 | Fases renumeradas: F2 = estabilidade Chat, F3 = estabilidade Code + compactação, **F4 = mecanismos explícitos** (probe F4.0 primeiro), gates por `profile × provider × protocol`; Anthropic ≥99% restrito a Anthropic direto (gateway condicional). |
| B6 — evidência fraca/circular | §9.2 protocolo fixo (fixture longa 120 requests com `P`/`Δ` coerentes, smoke 12, modo `e2e` que dirige `run_turn`, TTL, N=5, p50/p10, JSON bruto); aceite por mediana + artefato; assert duro só no provider fake; matriz de credenciais; gate de integração obrigatório (fake provider → body final → `CacheSample` → evento → store → chip); `usage` bruto no diagnóstico. |

---

## 1. Resumo executivo

O Lumina já tem a base difícil: histórico neutro, `provider_state` v2 com replay por
passo, loop multi-step, streaming nos 4 protocolos e um medidor de contexto. Falta a
**invariante de prefixo**: hoje o request seguinte não é uma extensão byte-a-byte do
anterior (relógio de minuto no Code, prompt mutável, corte deslizante, head reescrito
no final forçado) e nenhum provedor é instruído a cachear. O plano ataca em 4 eixos:

1. **Estabilidade do prefixo** (harness): prompt em camadas com `prompt_snapshots`
   persistido, contexto volátil em `surface_items` na cauda, surface append-only,
   final forçado sem trocar system/tools, tools/protocolos em ordem determinística.
2. **Mecanismo por provedor** (`providers::cache`): Anthropic explícito (breakpoints
   `tools` → `system` → `messages`, máx. 4 slots, TTL 5m/1h), OpenAI
   `prompt_cache_key` + retenção/TTL, gateways OpenCode com `x-opencode-session` e
   pass-through, Google implícito (regra dos 2.050 tokens do Gemini 4 documentada),
   DeepSeek/híbridos sem campo.
3. **Medição e diagnóstico** (`CacheTracker` + `cache_bench`): digest canônico por
   segmento, comparação com o request anterior, causa da quebra, amostra por request
   de wire, persistência e agregação por sessão.
4. **UX**: cache% em tempo real no medidor de contexto (Code) e no composer (Chat),
   com teto teórico, diagnóstico e economia; estado honesto sem reporte.

**Ordem obrigatória:** medir baseline (F0a) → fechar contratos (F0b) → estabilizar
prefixo Chat (F2) → estabilizar prefixo Code (F3) → ligar mecanismos explícitos (F4,
com probe antes) → UI final (F5) → matriz final e remoção do caminho antigo (F6).
Ligar `cache_control` antes de estabilizar o prefixo produz cache write pago e quase
nenhum read: pior custo, não melhoria.

## 2. Meta, métrica e escopo

### 2.1 Unidade, fórmula e teto

A unidade é o **request de wire** (cada chamada ao provedor, identificada por
`turn_id + step`) — não o turno, que pode ter vários requests (loop de tools).

```
P            = tokens do prefixo cacheável (system + tools + histórico já enviado)
Δ            = tokens novos do request (assistant anterior + tool results + user/contexto)
input_total  = cache_read + cache_write + uncached_input
hit_percent  = cache_read / input_total * 100
ceiling      = P / (P + Δ) * 100                  # teto teórico daquele request
```

- `P` e `Δ` são estimados para o teto (heurística char/4 documentada); o `hit%` exibido
  e aceito é **sempre o do `usage` reportado**, com `ceiling` só como contexto para o
  número não ser mal interpretado.
- **Anthropic**: `input_total = input_tokens + cache_read_input_tokens +
  cache_creation_input_tokens` (`input_tokens` é só o que vem depois do último
  breakpoint); `cache_read = cache_read_input_tokens`; `cache_write =
  cache_creation_input_tokens`.
- **OpenAI Chat/Responses**: `input_total = input_tokens` (inclusivo);
  `cache_read = cached_tokens`; `cache_write = cache_write_tokens` quando existir.
- **Google**: `input_total = promptTokenCount`; `cache_read =
  cachedContentTokenCount`.
- **DeepSeek via gateway**: `input_total = prompt_tokens`; `cache_read =
  cached_tokens` ou `prompt_cache_hit_tokens`; `uncached = prompt_cache_miss_tokens`.
- **OpenCode gateway**: quando o nativo vier ausente, ler
  `usage.opencode.tokens.cache_read` / `cache_write_5m` / `cache_write_1h`;
  `usage.opencode.tokens.input` **exclui** cache.
- `reported` = o provedor devolveu (ou não) tokens de cache. Se não devolveu,
  `hit_percent = None` → UI mostra `—` (nunca 100%).

### 2.2 Elegibilidade

Elegível = `P ≥ minTokens` do provedor/modelo **e** `minTokens` conhecido no catálogo.
Mínimos conhecidos (`docs/research/prompt-caching.md`): Anthropic 512–4.096 tokens por
modelo; OpenAI ~1.024 visíveis (GPT-5.6+; intervalos de 2.048 no GPT-5.5); Gemini
2.048 (2.5) / 4.096 (Gemini 4 e 3.x); DeepSeek sem mínimo documentado. O catálogo
guarda `minTokens`; `null`/desconhecido ⇒ o request é **excluído da meta** e contado
em `excluded_unknown_min` (não vira "não elegível" silencioso). Abaixo do mínimo o
provedor não cacheia e a UI mostra `aquecendo`/`não elegível`.

### 2.3 Regime e conjunto incluído (explícito)

- **Reuso de prefixo** (determinístico, bytes): em requests consecutivos sem mudança
  de config, o prefixo do request N+1 é extensão byte-a-byte do N. Meta: 100%.
  Cada segmento do digest tem `kind`: `system`, `tools`, `message`, `transient_tail`.
  `transient_tail` (ex.: instrução de wrap-up do final forçado) não pertence ao
  surface persistente e é **excluído** da meta de reuso — quebrá-lo não é quebra.
- **Steady-state por request**: requests com `request_index ≥ 3` no epoch,
  elegíveis, `ceiling ≥ 98%` e **não write-only** (`cache_read = 0` enquanto
  `cache_write > 0`). Cold (request 1) e write-only ficam **fora do steady** e são
  contados/reportados. Meta: ≥98% nos requests com `ceiling ≥ 98%`; ≥99% nos com
  `ceiling ≥ 99%`. O benchmark publica quantos requests entraram em cada faixa (não
  se esconde o denominador).
- **Ciclo de vida do epoch (inclui cold/write/TTL)**: agregado token-weighted
  `Σ cache_read / Σ input_total` de **todos** os requests elegíveis, incluindo o
  request 1 (0%) e cada write-only (renovação de TTL, novo epoch). A meta de 98% no
  ciclo de vida só é declarada quando `(P_cold + P_write + ΣΔ) / ΣP ≤ 2%` (fixture
  longa, §9.2); caso contrário o número real é publicado sem meta (uma sessão curta
  não tem como diluir o cold start). O teto do ciclo é sempre publicado.
- **Fora da meta (com contagem)**: request 1 de cada epoch; write-only após TTL;
  requests abaixo do mínimo; requests com `ceiling < 98%` (continuam medidos, na
  faixa “limitados por Δ”); epochs legítimos (`model_switch`, `compaction`,
  `truncate`, `regenerate`, `config_change`).
- **Gemini 4**: `δ_efetivo = max(Δ, 2050)` (output/thought/function results contam).
  O teto é `P/(P+δ_efetivo)`; ≥95% exige `P ≳ 39k`; a meta da linha do Gemini é
  condicional a `P ≥ 40k` e o benchmark mede também turnos pequenos para documentar
  o limite.

### 2.4 Aceite de desempenho

| Métrica | Meta | Onde medir |
| --- | --- | --- |
| Reuso de prefixo (bytes) em regime estável | **100%** (0 quebras) | teste de propriedade |
| Hit% steady-state, requests com `ceiling ≥ 98%` | **≥98%** | `cache_bench` (mediana) |
| Hit% steady-state, requests com `ceiling ≥ 99%` | **≥99%** (aspiracional) | `cache_bench` |
| Hit% de ciclo de vida (inclui cold/write/TTL) | **≥98%** quando `(P_cold+P_write+ΣΔ)/ΣP ≤ 2%` (fixture longa); sempre publicado com o teto | `cache_bench` |
| Custo steady-state vs. baseline | **≥8,4×** com `read=0,1×`; **≥14×** com `read=0,05×` | cálculo com `cost.*` + benchmark |
| Custo de ciclo de vida (inclui writes/cold/TTL 1h) | **≥7×** com `read=0,1×`; **≥12×** com `read=0,05×`; número real publicado por provedor | cálculo com `cost.*` + benchmark |
| Quebras inesperadas de prefixo | **0** | teste de propriedade + diagnóstico |
| Indicador da UI vs. `usage` do provedor | ≤1 p.p. | teste + comparação manual com `usage` bruto |
| Anthropic direto (API key) | **≥99%** no steady-state com `ceiling ≥99%` | live |
| Anthropic via gateway | condicional ao pass-through (probe F4.0) | live |
| Gemini 4 (`P ≥ 40k`) | **≥95%**; turnos pequenos documentados | live |
| Plano ChatGPT/OAuth | melhor esforço; `não suportado` se o probe falhar | probe + live |

Meta global só é declarada para provedores **com cache reportado e credencial
disponível**; os demais entram em `EVIDENCE.md` com status `implementado, não provado`
ou `não suportado`.

### 2.5 Benchmark (protocolo resumido; completo em §9.2)

Fixture fixa versionada em `docs/goals/prompt-cache/evidence/bench-fixture.json`:
- **Longa (aceite de ciclo de vida/custo):** **120 requests de wire**; `P` cresce de
  ~20k para ~121k tokens estimados; `Δ` ≈ 850 tokens por request (histórico
  sintético semeado; user ~100 + resposta simulada ~750), registrado por request.
  Conta: `ΣP ≈ 8,47M`, `P_cold = 20k`, `P_write ≈ 20,9k`, `ΣΔ ≈ 101k` ⇒
  `(P_cold+P_write+ΣΔ)/ΣP ≈ 1,7% ≤ 2%`. Sem tool use.
- **Curta (smoke rápido):** 12 requests com a mesma regra de `Δ`; ciclo de vida é
  **reportado sem meta** (cold não dilui em 12 requests).
- **Code:** 12 requests com tool results de ~1k tokens, plano/todos e uma
  compactação no meio; `P`/`Δ` registrados.
- **E2E:** o benchmark tem dois modos — `synthetic` (constrói requests isolados para
  capacidades/isolamento) e **`e2e`** (executa o caminho do produto: `run_turn` com
  DB/config de teste, clock/fs fake e provedor real ou fake que registra bodies e
  digests). Baseline F0a.4, F2.9, F3.5, F4.6 e F6.1 usam `e2e` para medir as
  quebras reais D1–D6; `synthetic` complementa.
- Rota/modelo fixos por linha; TTL respeitado (espera declarada); **5 repetições**,
  aceite por mediana (p50) e p10; JSON bruto em
  `evidence/<provider>-<protocol>-<model>-<date>.json`. O benchmark não escolhe o
  cenário: `P`, `Δ` e N são da fixture, não do executor.

### 2.6 Não-objetivos

- Tokenizer exato (heurística char/4 para `P`/`Δ`; hit% é do provedor).
- Cache explícito do Gemini (`cachedContents`) na v1 — só se o spike F4.5 provar
  suporte no gateway e ganho; Gemini 4 Argon+ não aceita.
- Warming pago do gateway OpenCode (4/30 min): avaliar em F6, não na v1.
- `% de contexto` no Chat (P2; o requisito é cache%).
- Mudar gateway, plugins, PTC, ACP; cache compartilhado entre conversas/usuários
  (proibido; chaves derivadas por conversa e hasheadas).
- Reescrita visual ampla: o indicador entra no medidor/chip existentes.

## 3. Diagnóstico do estado atual (auditado)

> Auditoria completa (linhas e severidade, produzidas junto deste planejamento):
> `docs/research/cache-audit-backend.md` e `docs/research/cache-audit-ui.md`.

| # | Defeito | Evidência | Sev. | Fase |
| --- | --- | --- | --- | --- |
| D1 | Relógio com **minuto** no topo do system prompt Code → todo turno em outro minuto perde system+tools+histórico | `harness/mod.rs:1005`; `harness/code/prompt.rs:276-280` | blocker | F3 |
| D2 | System prompt Code mutável por estado (modo/plano, git/tree/projeto, AGENTS.md, todos/plano) | `harness/code/prompt.rs:81-230,264-296`; `harness/code/context.rs:103-132` | blocker | F3 |
| D3 | Data do dia no head do prompt Chat | `harness/prompt.rs:31,36-56,623` | blocker | F2 |
| D4 | `mode_notes` anexadas ao system prompt no meio do turno | `harness/mod.rs:631-636,1199-1209` | blocker | F2/F3 |
| D5 | Final forçado troca system (`# Wrap-up`) e zera `tools` no request mais caro | `harness/mod.rs:1476-1500` | blocker | F2/F3 |
| D6 | `build_history` corta histórico sem histerese; início desliza a cada turno | `harness/mod.rs:2022-2050,2185-2188` | blocker | F2 |
| D7 | Budget de imagens pode transformar imagem já enviada em texto | `harness/mod.rs:2209-2235` | major | F2 |
| D8 | Anthropic sem `cache_control` e sem ler `cache_creation_input_tokens` | `providers/anthropic.rs:50-117,425-439` | blocker | F4 |
| D9 | OpenAI sem `prompt_cache_key`/retenção; whitelist do plano OAuth remove campo novo | `providers/openai_responses.rs:63-72,74-137,141-156` | major | F4 |
| D10 | `openai-chat` sem chave de cache nem fallback se o gateway rejeitar campo | `providers/openai_chat.rs:50-105` | major | F4 |
| D11 | Google: cache implícito sem verificação; `cachedContentTokenCount` não vira hit% | `providers/google.rs:47-88,317` | minor | F4 |
| D12 | `UsageInfo` sem write/uncached normalizado; Anthropic subconta input total | `domain.rs:175-193`; `providers/anthropic.rs:228-250,430-505` | blocker | F0a |
| D13 | `usage` só no fim do turno; sem evento por request; sem hit% | `harness/mod.rs:1663-1668`; `events.rs:51-52` | blocker | F0a |
| D14 | `context_stats`/medidor só no Code; Chat sem medidor (chip cache-first resolve a v1) | `harness/mod.rs:1099-1110,1214-1231`; `src/lib/store/codeStore.ts:144` | major | F1/F5 |
| D15 | Compactação reescreve cabeça com prompt de resumo próprio; `to_seq` inconsistente (⚠️ confirmar com teste) | `harness/code/compaction.rs:137-143,214,218-223,261-274`; `harness/mod.rs:889-918,1146-1170` | blocker | F3 |
| D16 | Sem registro de epoch/quebra/causa; UI não distingue queda de crescimento | `db.rs:131-149`; `src/components/agent/ContextMeter.tsx` | major | F0a/F1 |
| D17 | Ordem de protocolos via `HashMap`; tools MCP sem sort | `harness/mod.rs:2452-2476,1008-1044`; `mcp/mod.rs:395-430` | minor | F2 |
| D18 | Troca de modelo/provedor invalida replay de todo o histórico | `harness/mod.rs:2067-2097` | major (epoch aceitável) | F3/F6 |
| D19 | DeepSeek nativo não lê `prompt_cache_hit_tokens`/`miss` | `providers/openai_chat.rs:360-368` | minor | F0a/F4 |
| D20 | Batch usa `x-opencode-session: "batch"`; subagente id efêmero — resumo/compactação não herda sessão | `harness/batch.rs:51-61`; `harness/code/subagent.rs:160-199` | major (m3 PRE) | F3.3a/F4.3b |
| D21 | Skills/`# Code execution` recalculados por turno quebram head sem diagnóstico | `harness/prompt.rs:269-328,350-367`; `harness/mod.rs:941-949` | minor | F2/F3 |
| D22 | `x-opencode-session` correto (= `conversation_id`, só OpenCode) — preservar | `providers/mod.rs:174-176,222-240` | — (bom) | F4 |
| D23 | Calibração do contexto usa `input_tokens` cru (Anthropic exclui cache) | `harness/mod.rs:1305-1327`; `harness/code/session.rs:481-511` | major | F0a |
| D24 | `usage_summary` só em `#[cfg(test)]`; sem agregação de produção | `db.rs:2193-2194` | minor | F0b/F6 |
| D25 | `/compact` manual grava evento `context/stats` com payload incompatível (⚠️) | `commands/code.rs:838-929`; `session.rs:377-404` | major | F3 |

**Conclusão:** não é "faltar um campo". Mesmo ligando `cache_control` hoje, o hit%
ficaria baixo porque o prefixo muda por design em quase todo turno. A ordem é medir →
estabilizar prefixo → ligar mecanismo → medir de novo.

## 4. Arquitetura alvo

### 4.1 Visão em uma página

```
turno N
  ├─ prompt_snapshots (system + tools congelados por sessão)       ──┐
  ├─ surface_items (contexto/plano/modo; append-only, after_step)    │ bytes canônicos
  ├─ mensagens persistidas (append-only, replay v2)                  │
  │                                                                  ▼
  │                                                        build_body(protocolo)
  │                                                                  │
  │                                       providers::cache::apply  ──┤ (breakpoints/chave/TTL)
  │                                       providers::cache::digest ──┤ (SHA-256 por segmento;
  │                                                                  │  metadados de cache fora do hash)
  │                                                                  ▼
  │                                                          request HTTP
  │                                                                  │
  │                                       cache::normalize_usage ◄────┘ (usage nativo + opencode.tokens)
  │                                                                  │
  │                      CacheSample {P, Δ, read, write, uncached, hit%, ceiling, epoch, causa}
  │                                                                  │
  │                              cache_state/cache_samples ◄─────────┤
  │                                                                  ▼
  └──────────────────────────────► cache_stats (por request) ──► UI (tempo real)
```

### 4.2 `PromptSnapshot` persistido (estável de verdade)

- Na primeira execução de uma conversa (`provider_id + model_id + profile +
  workspace_id + prompt_version`), montar system prompt **e** catálogo wire de tools e
  persistir em `prompt_snapshots`. Turnos seguintes **reusam** o snapshot — não
  reconstroem prompt nem tools. Isso mata D1, D2 e a variação de skills/settings, e
  sobrevive a restart.
- Camadas dentro do snapshot: `stable` (identidade, idioma, estilo, Markdown, UI
  generativa, segurança, guia de tools/skills) + `session` (modelo, plataforma,
  workspace nome/path, perfil de projeto, `session_date` = data de criação da
  conversa, `PROMPT_VERSION`). **Sem relógio, git, tree, todos, plano ou modo.**
- **Invalidação explícita** (epoch novo com causa): troca de modelo/provedor, troca de
  workspace, edição de `AGENTS.md`/instruções do usuário, mudança de skills
  habilitadas, mudança de gates (`web_search`/`create_files`/`run_code`), upgrade do
  app (`PROMPT_VERSION`). Mudanças de estado de sessão (plano, permissão, git, tree,
  todos, hora) **não** invalidam o snapshot.
- Tools package é parte do snapshot: nunca trocar schema silenciosamente; mudança de
  conjunto (MCP ligou/desligou) = epoch `config_change` com causa e teste.
- Contexto dinâmico (`surface_items`, §4.4): o que muda com frequência vira mensagem
  de contexto na cauda; o modelo consulta git/tree por tool (`git_status`,
  `list_dir`, `read_file`).
- Data/hora: `session_date` congelada; se o dia/hora for realmente necessário, um
  `surface_item` de `kind=date` é anexado quando o digest muda — nunca a cada turno.

### 4.3 `RequestSurface` append-only

- Surface = `prompt_snapshot` + `surface_items` + mensagens persistidas (replay v2) +
  resumo de compactação (substituição explícita). `build_history` deixa de cortar a
  cabeça no Chat (D6).
- **Watermark com histerese** para o corte de emergência: persistir o id/seq da
  primeira mensagem incluída; o watermark só avança em salto grande (≥20% do budget)
  e em fronteira de turno, nunca 1 mensagem por turno. Com compactação funcionando, o
  corte vira exceção.
- **Final forçado (D5):** system prompt e tools **idênticos** ao resto do turno; a
  instrução de wrap-up é uma **cauda transitória** (não persistida em
  `surface_items`), anexada só ao request final. A cauda transitória não faz parte do
  invariante append-only do surface; o próximo turno reconstrói a partir do surface
  persistente (o prefixo cacheado anterior continua válido até o último item estável).
- **Decisões de render congeladas** (`render_decisions`): imagem vs. texto, anexo
  truncado, replay bruto vs. fallback neutro. Uma vez que a mensagem entrou no
  surface, o render não muda silenciosamente; se o orçamento de imagem apertar, só as
  **novas** mensagens pagam o custo.
- **Ordem determinística:** protocolos por lista fixa (não `HashMap`), tools MCP por
  `(server, wire_name)`, skills ordenadas, headers estáticos ordenados; desempate de
  mensagens `(created_at, id)`. Serialização serde_json já é determinística (mapas
  ordenados).
- **Digest (dono único):** `providers::cache::digest(protocol, provider, body)`
  extrai segmentos canônicos na ordem do wire (system, tools, messages) do body
  **final** e calcula a cadeia `h_i = sha256(h_{i-1} || bytes)`, **removendo do hash
  os metadados de cache** (`cache_control`, `prompt_cache_key`, `prompt_cache_options`,
  `ttl`, `cachedContent`) — `apply` pode reestruturar o system em blocos, mas não
  mudar o texto. `harness::cache` consome o digest e persiste `prefix_hash`/
  `prefix_segments` em `cache_state`. Teste: mudar TTL/breakpoint não gera quebra;
  restart lê o mesmo hash.
- **Troca de modelo/provedor:** epoch `model_switch` (caches de provedores diferentes
  nunca se comunicam; replay v3 multi-modelo fica para F6/fora da v1).

### 4.4 `surface_items` (o volátil no lugar certo, com posição exata)

Nova tabela (migração aditiva), substitui a ideia de `after_message_id` simples:

```sql
CREATE TABLE IF NOT EXISTS surface_items (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL,
  after_message_id TEXT,          -- mensagem após a qual o item entra (NULL = início)
  after_step       INTEGER,       -- passo do replay multi-step (NULL = fim do grupo)
  seq              INTEGER NOT NULL, -- desempate estável no mesmo ponto
  kind             TEXT NOT NULL, -- runtime | plan | todo | mode | workspace | date
  digest           TEXT NOT NULL, -- sha256 do texto (dedupe)
  text             TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_surface_items_dedupe
  ON surface_items(conversation_id, digest);
CREATE INDEX IF NOT EXISTS idx_surface_items_conv
  ON surface_items(conversation_id, created_at);
```

- **Renderização/replay:** ao reconstruir o histórico, o replay v2 expande cada
  assistant em N `HistoryMessage` (um por passo). Itens com `after_step = k` entram
  **depois do grupo assistant + tool results daquele passo k** (nunca entre
  `tool_use` e `tool_result`, o que quebraria o pareamento); itens com
  `after_step = NULL` entram depois do grupo inteiro (ou no início quando
  `after_message_id = NULL`). Ordem canônica:
  `(after_message_id, after_step, seq)`. O texto é renderizado como **user-role
  marcado** (`<contexto-da-sessao …>`) — nunca `system`, porque
  `providers::system_text` hoista `HistoryRole::System` para o head
  (`providers/mod.rs:656-670`). Itens órfãos (mensagem âncora removida por
  cancelamento/regeneração/truncamento) são apagados no mesmo passo.
- **Criação por digest:** só quando o conteúdo muda (plano submetido/aprovado, modo de
  permissão, workspace, virada de dia). Git dirty/tree/todos não entram a cada turno;
  o agente consulta por tool.
- **Retenção:** itens são pequenos; manter os últimos 200 por conversa e apagar os
  mais antigos **só quando a compactação os cobrir** (não no meio de um epoch). O
  transcript da compactação inclui os `surface_items` cobertos antes de removê-los
  (§4.6); `UNIQUE(conversation_id, digest)` garante idempotência.
- Como fica no meio do histórico já enviado, não reescreve o head: o prefixo anterior
  continua cacheável e só o item novo é cauda não cacheada.

### 4.5 `providers::cache` (mecanismo por protocolo)

```rust
// src-tauri/src/providers/cache.rs
pub struct CacheCapabilities {
    pub mode: CacheMode,            // Auto | Explicit | None
    pub min_tokens: Option<u32>,    // None = desconhecido (excluído da meta)
    pub block_tokens: u32,
    pub ttl_options: &'static [&'static str],
    pub supports_key: bool,
    pub supports_retention: bool,
    pub supports_explicit_breakpoints: bool,
    pub reports_read: bool,
    pub reports_write: bool,
}

pub struct CachePlan {
    pub mode: CacheMode,
    pub breakpoints: Vec<CacheBreakpoint>, // posições no wire
    pub prompt_cache_key: Option<String>,  // <= 64 chars, hash estável
    pub retention: Option<String>,
    pub ttl: Option<String>,
}

pub fn capabilities(protocol: WireProtocol, provider: &str, model: &ModelInfo) -> CacheCapabilities;
pub fn plan(protocol: WireProtocol, provider: &str, caps: &CacheCapabilities,
            request: &CompletionRequest) -> Option<CachePlan>;
pub fn apply(protocol: WireProtocol, plan: Option<&CachePlan>, body: &mut Value);
pub fn normalize_usage(protocol: WireProtocol, provider: &str, raw: &Value) -> CacheUsage;
pub fn digest(protocol: WireProtocol, provider: &str, body: &Value) -> PrefixDigest;
```

**Anthropic** (`providers/anthropic.rs`): `system` vira array de blocos; breakpoints
em (a) fim de `tools`, (b) fim do bloco system estável, (c) última mensagem/último
tool result do turno — **3 explícitos, sem o automático top-level** (o automático
consome 1 slot e mistura de TTL/4 explícitos dá 400 — doc/`prompt-caching.md`).
`cache_control: {type:"ephemeral", ttl?}`; TTL **padrão 1h** (write 2×, read 0,1×) e
5m como opção em Settings; *lookback* de 20 blocos: em turnos com muitos tool calls,
um 4º breakpoint pode ir no “primeiro system + primeiro user estável” (posições
distintas, um em `system`, um em `messages`). Fallback: 400 citando breakpoints/TTL
→ reduzir para 2 breakpoints e registrar `degraded`; nunca usar automático +
explícitos juntos. Normalizar `cache_creation_input_tokens`.

**OpenAI** (`openai_chat.rs`/`openai_responses.rs`): `prompt_cache_key` =
`sha256(conversation_id + provider + model + PROMPT_VERSION + tool_schema_hash)` com
≤64 chars (limite prático do OpenCode), opt-in por `supportsKey` do modelo/rota;
`prompt_cache_retention` (`in_memory`/`24h`) só em modelos antigos; no GPT-5.6+
`prompt_cache_options: {ttl:"30m"|"12h"}`; modo explícito do Responses
(`prompt_cache_options.mode="explicit"` + breakpoints) é opcional e exige mover
`instructions` para `developer`/`input_text` (não fazer na v1). No perfil
ChatGPT-plan/OAuth, `prompt_cache_key` **não está documentado** — só enviar se o probe
F4.0 provar; `CHATGPT_PLAN_ALLOWED_FIELDS` só muda após probe. Fallback único (retry
sem o campo) em 400 citando o parâmetro. `prompt_cache_options` no endpoint
`chat/completions` não é confirmado — gate por probe, não enviar às cegas.

**Google** (`google.rs`): v1 é cache implícito — `systemInstruction`/`contents`
estáveis e leitura de `cachedContentTokenCount`. Regra dos 2.050 tokens do Gemini 4 é
`ProviderPolicy` (não “cache caiu”); SLO condicional (§2.3). `cachedContents` explícito
só se F4.5 provar suporte/ganho; Gemini 4 Argon+ não aceita.

**DeepSeek/híbridos via `openai-chat`**: nenhum campo; prefixo estável e fallback de
leitura `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`.

**OpenCode Go/Zen**: `x-opencode-session` = `conversation_id` estável (D22),
preservar e testar; ler `usage.opencode.tokens.*`. **Batch, compactação e subagente
usam o `conversation_id` da conversa** — no subagente, o id da conversa **pai** (ou
um id estável derivado dele), nunca o id efêmero do filho; D20 corrigido em
F3.3a/F4.3b. Warming pago (4/30 min) fica para F6.

**Regras transversais:**
1. Nunca enviar campo que o provedor não declara; 400 → fallback único sem o campo +
   `degraded` (padrão de auto-healing do reasoning).
2. `prompt_cache_key`/session id nunca contém texto do usuário.
3. Digest sobre o body final com metadados de cache fora do hash (§4.3).
4. Fallback de protocolo = epoch `protocol_fallback`.
5. **Gate de custo do cache explícito**: só ativar write quando `request_index ≥ 2`
   no epoch (o request 1 é frio por definição) e `P ≥ max(2×minTokens, 4.096)`.
   Assim o request 2 escreve e o request 3 já lê (steady-state a partir do 3º). O
   request 2 é registrado como `write_only` (fora do steady, dentro do ciclo de
   vida). `savings_usd` usa `cost.cache_read`/`cost.cache_write` do catálogo.
6. **Probe antes de prometer** (F4.0): matriz provider × rota × campo × reporte.

### 4.6 Compactação cache-safe (Chat e Code)

- Dispara só em **fronteira de turno**, nunca no meio de um passo.
- A chamada de resumo **reusa o último request** (system + tools + prefixo de
  mensagens byte-a-byte) e anexa no fim a instrução de sumarizar; usa o
  `conversation_id` da conversa como sessão (D20) para o provedor ler o cache. Padrão
  DSH (`dsh-compaction-basic`).
- Só depois substitui a superfície por `[resumo] + cauda` e registra epoch
  `compaction`; o turno seguinte aquece o novo prefixo (1 request frio previsível).
- Poda de tool results antigos entra junto da compactação e no mesmo epoch.
- **Corrigir D15/D25** antes de fechar: fronteira persistida como id/seq estável da
  primeira mensagem mantida (não `messages.len()`), transcript cobrindo exatamente as
  mensagens removidas (inclusive a user do turno e os `surface_items` cobertos, se
  removidos), reconstrução de dois turnos byte-a-byte, e evento de `/compact`
  compatível com o `CodeSessionState`
  (`context_stats`/`context/compacted` corretos). Teste de regressão obrigatório.
- **Chat:** a compactação passa a ser a única redução de histórico (ver F2.4) — sem
  ela, remover o trim estouraria a janela.
- Política: threshold de 80% da janela ou `W − output − headroom`, `retain` explícito
  (16% de `W − output`, como DSH), override por modelo.

### 4.7 Medição, telemetria e diagnóstico

- `UsageInfo` ganha `cache_read_tokens`, `cache_write_tokens`,
  `uncached_input_tokens` e `reported` (aditivo; `cached_tokens` fica como alias).
- `CacheSample` por request de wire (não por turno), incluindo `P`, `Δ`, `ceiling` e o
  `raw_usage` recortado do provedor:

```rust
pub struct CacheSample {
    pub turn_id: String,
    pub step: u32,
    pub provider_id: String,
    pub model_id: String,
    pub protocol: String,
    pub epoch: u32,
    pub input_total: u32,
    pub cache_read: u32,
    pub cache_write: u32,
    pub uncached: u32,
    pub hit_percent: Option<f32>,       // None = não reportado
    pub ceiling_percent: Option<f32>,   // P/(P+Δ)
    pub prefix_tokens_est: u32,         // P
    pub delta_tokens_est: u32,          // Δ
    pub eligible: bool,
    pub excluded_reason: Option<String>,// below_min | unknown_min | cold | ceiling<target
    pub state: CacheState,              // Cold | Warming | Stable | Degraded | Unsupported | ProviderPolicy
    pub break_reason: Option<CacheBreakReason>,
    pub break_detail: Option<String>,
    pub raw_usage: Option<serde_json::Value>, // recorte copiável no diagnóstico
    pub at: i64,
}
```

- `CacheTracker` compara o `PrefixDigest` com o último do `cache_state`: prefixo
  comum, primeiro segmento divergente, causa (`first_request`, `system_prompt`,
  `tool_definitions`, `history_rewrite`, `head_trim`, `compaction`, `model_switch`,
  `protocol_fallback`, `attachments`, `config_change`, `ttl_expired`,
  `provider_policy`).
- Evento novo `TurnEvent::CacheStats { sample }` por request, nos dois perfis, emitido
  após a resposta do provedor (não reutilizar `usage`: o `chatStore` faz merge raso,
  `src/lib/store/chatStore.ts:502-507`). `usage` final continua com totais do turno.
- IPC `get_cache_stats(conversationId, limit?) -> CacheStatsView` restaura o
  indicador ao abrir a sessão.
- **Fonte canônica do agregado**: `cache_samples` + `cache_state` (por request);
  `ChatMessage.usage` é fallback legado apenas para payloads antigos (nunca somar as
  duas). `cacheStore` faz seed **substitutivo idempotente** (não acumula) e reconcilia
  em `done`/`cancelled`/`error`.
- **Calibração do contexto** por `input_total` normalizado (D23): o `% de contexto`
  não pode cair artificialmente quando o cache hit sobe.
- `usage_summary` `#[cfg(test)]` é substituído pela agregação de `get_cache_stats`
  (D24) ou ganha uso de produção com dono explícito.

### 4.8 Invariantes do loop do agente

1. Prompt e tools são imutáveis por sessão (snapshot), salvo eventos de invalidação
   explícitos; dentro do turno são imutáveis sempre.
2. O surface persistente só cresce (assistant + tool results + user + surface_items),
   exceto compactação explícita no início do turno.
3. O request de cada passo = prefixo do passo anterior + (assistant do passo anterior
   + tool results) byte-a-byte; caudas transitórias (wrap-up) não entram no surface.
4. O final forçado não muda system/tools.
5. Fallback de protocolo não tenta reaproveitar cache (epoch novo).
6. O evento de cache sai por request, para o medidor atualizar durante o streaming.

## 5. Contratos compartilhados

### 5.1 Rust (`domain.rs`, `events.rs`, `catalog.rs`)

```rust
// domain.rs (aditivo; camelCase no IPC)
pub struct CacheUsage {
    pub cache_read_tokens: Option<u32>,
    pub cache_write_tokens: Option<u32>,
    pub uncached_input_tokens: Option<u32>,
    pub input_total_tokens: Option<u32>,
    pub reported: bool,
}

pub enum CacheState { Cold, Warming, Stable, Degraded, Unsupported, ProviderPolicy }

pub struct CacheStats {
    pub hit_percent: Option<f32>,
    pub session_hit_percent: Option<f32>,
    pub steady_hit_percent: Option<f32>,
    pub ceiling_percent: Option<f32>,
    pub input_total: u32,
    pub cache_read: u32,
    pub cache_write: u32,
    pub uncached: u32,
    pub eligible: bool,
    pub excluded_reason: Option<String>,
    pub state: CacheState,
    pub epoch: u32,
    pub samples: u32,
    pub min_cacheable_tokens: Option<u32>,
    pub ttl_seconds: Option<u32>,
    pub break_reason: Option<CacheBreakReason>,
    pub break_detail: Option<String>,
    pub provider_policy: Option<String>,
    pub at: i64,
    pub savings_usd: Option<f64>,
}

pub enum CacheBreakReason {
    FirstRequest, SystemPrompt, ToolDefinitions, HistoryRewrite, HeadTrim, Compaction,
    ModelSwitch, ProtocolFallback, Attachments, ConfigChange, TtlExpired, ProviderPolicy,
}

pub struct CacheStatsView {
    pub conversation_id: String,
    pub current: Option<CacheStats>,   // último request
    pub session: Option<CacheStats>,   // agregado canônico
    pub epoch: u32,
    pub recent: Vec<CacheSample>,      // últimas N amostras (diagnóstico)
}

// `PrefixDigest`/`SegmentDigest` vivem em `providers/cache.rs` (dono único do digest);
// `domain.rs` só re-exporta se algum consumidor de IPC precisar.
pub struct SegmentDigest { pub kind: SegmentKind, pub index: u32, pub sha256: [u8; 32], pub chars: u32 }
pub struct PrefixDigest {
    pub protocol: String,
    pub segments: Vec<SegmentDigest>,
    pub common_prefix_segments: u32,
    pub total_chars: u32,
    pub common_chars: u32,
    pub estimated_tokens: u32,
}

// UsageInfo: campos atuais + cache_read_tokens/cache_write_tokens/uncached_input_tokens/reported.
// events.rs: TurnEvent::CacheStats { sample: CacheSample } (novo, por request).
// catalog.rs: ProviderInfo/ModelInfo.cache: Option<CacheInfo>.
```

Catálogo (gerado em `scripts/build-catalog.mjs`):

```json
"cache": {
  "mode": "explicit",
  "minTokens": 1024,
  "blockTokens": 128,
  "ttlOptions": ["5m", "1h"],
  "supportsKey": false,
  "supportsRetention": false,
  "supportsExplicitBreakpoints": true,
  "reports": { "read": true, "write": true }
}
```

`minTokens: null` = desconhecido (request excluído da meta e contado). O gerador usa
defaults por protocolo/família, marcando `source: "family-default"` para o probe F4.0
substituir por valor medido.

### 5.2 TypeScript (`types.ts`, `api.ts`, stores)

- Espelhar `CacheUsage`, `CacheStats`, `CacheState`, `CacheBreakReason`, `CacheSample`,
  `CacheStatsView` e os campos novos de `UsageInfo`.
- `api.getCacheStats(conversationId, limit?)`.
- `src/lib/cache.ts`: funções puras `hitPercent`, `ceilingPercent`,
  `cacheStateFor` (mapeia o `state` **já normalizado pelo backend** para tom/texto;
  nunca recalcula hit%), `formatCacheHit`, `mergeCacheUsage`, `normalizeLegacyUsage`
  (payload antigo → `—`).
- `src/lib/store/cacheStore.ts`: por conversa `{ current, session, epoch, lastBreak,
  recentSamples }`; aplica `cache_stats`, restaura de `get_cache_stats`; seed
  substitutivo idempotente; reconcilia em `done`/`cancelled`/`error`.
- `chatStore` repassa `cache_stats` ao `cacheStore`; `codeStore` idem (Code já trata
  `context_stats` para o medidor de contexto).

### 5.3 SQLite (migrações aditivas; colunas exatas)

```sql
-- system+tools congelados por sessão (F0b)
CREATE TABLE IF NOT EXISTS prompt_snapshots (
  conversation_id TEXT NOT NULL,
  snapshot_key    TEXT NOT NULL,   -- provider|model|profile|workspace|prompt_version
  provider_id     TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  profile         TEXT NOT NULL,
  workspace_id    TEXT,
  prompt_version  INTEGER NOT NULL,
  system_text     TEXT NOT NULL,
  tools_json      TEXT NOT NULL,
  stable_hash     TEXT NOT NULL,
  tools_hash      TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  invalidated_at  INTEGER,
  PRIMARY KEY (conversation_id, snapshot_key)
);

-- decisão de render congelada por mensagem (F2.7a)
CREATE TABLE IF NOT EXISTS render_decisions (
  message_id   TEXT NOT NULL,
  kind         TEXT NOT NULL,      -- image|document|attachment|replay
  digest       TEXT NOT NULL,
  payload      TEXT NOT NULL,      -- JSON (ex.: referência de imagem vs. texto)
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (message_id, kind)
);

-- contexto/plano/modo na cauda (F2.5a; §4.4)
CREATE TABLE IF NOT EXISTS surface_items (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
  after_message_id TEXT, after_step INTEGER,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL, digest TEXT NOT NULL, text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_surface_items_order
  ON surface_items(conversation_id, after_message_id, after_step, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_surface_items_dedupe ON surface_items(conversation_id, digest);
CREATE INDEX IF NOT EXISTS idx_surface_items_conv ON surface_items(conversation_id, created_at);

-- estado por conversa (F0b)
CREATE TABLE IF NOT EXISTS cache_state (
  conversation_id TEXT PRIMARY KEY,
  provider_id TEXT, model_id TEXT, protocol TEXT,
  epoch INTEGER NOT NULL DEFAULT 0,
  prefix_hash TEXT, prefix_segments TEXT,     -- JSON compacto, cap 500 segmentos
  prompt_snapshot_hash TEXT,
  cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0,
  uncached INTEGER NOT NULL DEFAULT 0, samples INTEGER NOT NULL DEFAULT 0,
  last_hit_percent REAL, last_ceiling_percent REAL, last_at INTEGER,
  last_break_reason TEXT, last_break_detail TEXT,
  updated_at INTEGER NOT NULL
);

-- amostra por request de wire (criada na F0b.3; a amostra nasce em memória na F0a.2; §4.7)
CREATE TABLE IF NOT EXISTS cache_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL, turn_id TEXT, step INTEGER NOT NULL,
  provider_id TEXT, model_id TEXT, protocol TEXT,
  epoch INTEGER NOT NULL, prefix_hash TEXT,
  input_total INTEGER, cache_read INTEGER, cache_write INTEGER, uncached INTEGER,
  hit_percent REAL, ceiling_percent REAL, prefix_tokens_est INTEGER, delta_tokens_est INTEGER,
  eligible INTEGER NOT NULL DEFAULT 1, excluded_reason TEXT, state TEXT NOT NULL,
  break_reason TEXT, break_detail TEXT, raw_usage TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cache_samples_conv ON cache_samples(conversation_id, created_at);
```

- `usage_log` ganha `cache_read_tokens`, `cache_write_tokens`, `uncached_input_tokens`,
  `cache_hit_percent`, `cache_epoch`, `prefix_hash`, `break_reason`, `protocol`.
  **Granularidade:** continua 1 linha por turno (billing); a verdade por request é
  `cache_samples` (o benchmark e o diagnóstico leem dela).
- Não criar `context_snapshots`: `surface_items` a substitui.
- Retenção: `cache_samples` mantém as 500 amostras mais recentes por conversa e as
  demais são agregadas/descartadas em rotação; `surface_items` mantém as 200 mais
  recentes, removendo só as cobertas por compactação. Teste de idempotência/dedupe.

### 5.4 `Settings.cache` (contrato Lead; F0b)

```rust
pub struct CacheSettings {
    pub show_indicator: bool,          // default true (preferência de UI)
    pub anthropic_ttl: CacheTtl,       // default OneHour (5m | 1h)
    pub openai_retention: Option<String>, // default None = decisão do adapter/probe
}
// Settings ganha #[serde(default)] cache: CacheSettings (banco/settings antigos ok).
```

Não há `enabled` de produto (rollback = release). `show_indicator=false` só esconde o
chip, nunca desliga a medição. `config.rs` normaliza/valida; `SettingsView` espelha.

## 6. Estratégia por provedor e protocolo

> Parâmetros, mínimos, TTL, usage e links oficiais/OpenCode/DSH:
> **`docs/research/prompt-caching.md`**.

| Provedor | Protocolo(s) | Mecanismo real | O que o Lumina faz | Meta |
| --- | --- | --- | --- | --- |
| OpenCode Go | openai-chat, openai-responses, anthropic, google | gateway traduz protocolos; cache do provedor + billing; `x-opencode-session` p/ afinidade | session id estável; prefixo append-only; `cache_control`/`prompt_cache_key` **só se F4.0 provar pass-through**; ler `usage.opencode.tokens.*`; warming pago em F6 | ≥98% quando reportado |
| OpenCode Zen | idem | idem | idem | ≥98% |
| OpenAI direto | openai-responses (+ `chatgpt-plan` OAuth) | automático (1.024 tokens GPT-5.6+), `prompt_cache_key` ≤64, retention 24h/antigos ou ttl 30m/12h (GPT-5.6+), breakpoints explícitos no Responses | chave hash estável; retention/TTL por capability; `instructions` estável; OAuth só após probe; fallback em 400 | ≥98% API key; OAuth melhor esforço |
| Anthropic direto | anthropic | explícito: `cache_control` em `tools`/`system`/`messages`, 4 slots, TTL 5m (write 1,25×) ou 1h (2×), read 0,1× | system em blocos; 3 breakpoints (tools, system, cauda); TTL 1h default; normalizar read+creation | **≥99%** |
| Modelos via gateway (DeepSeek/GLM/Kimi/Qwen/MiniMax/…) | openai-chat/anthropic | cache automático do upstream (DeepSeek em disco) | prefixo estável; sem campo no chat; `prompt_cache_hit_tokens`/`miss`; `cache_control` no anthropic se pass-through | ≥98% quando reportado |
| Google/Gemini | google | implícito; Gemini 4 exige ≥2.050 tokens novos; mínimos 2.048/4.096 | prefixo estável; `cachedContentTokenCount`; `ProviderPolicy`; explicit só se F4.5 provar | ≥95% Gemini 4 (P≥40k); ≥98% 2.5/3 quando reportado |

**Lições adotadas:** OpenCode V2 usa `cache-policy` `auto` com breakpoints em *last
tool + first/last system + tail* e cap 4, clampa `prompt_cache_key` em 64 chars e
manda retention/TTL conforme a rota; a V1 aplicava 2 primeiros system + 2 últimas
mensagens. DSH mantém o system prompt **dentro do histórico** (surface node 0), faz
update **in-history** (anexa depois do prefixo cacheado), replaya o prefixo
byte-a-byte na compactação e projeta `cacheReadTokens`/`cacheWriteTokens`/
`uncachedInputTokens`. O Lumina adota snapshot estável + append in-history + replay na
compactação, mantém breakpoints explícitos próprios (DSH não emite) e preserva
`x-opencode-session` (DSH não envia).

## 7. UI/UX — indicador de cache em tempo real

> Spec detalhada (linhas, tokens, acessibilidade, testes):
> **`docs/research/cache-audit-ui.md`**; divergências conscientes listadas ao final.

- **Code**: dentro do `ContextMeter` existente (`ContextMeter.tsx:141-227`, montado
  por `CodeAgentWidgets.tsx:175-184` / `CodeSessionHeader.tsx:547-550`): anel de
  contexto + `%` + divisor + ícone `Zap` + `%` de cache, com largura reservada (sem
  layout shift). Remover `hidden lg:block` para aparecer abaixo de 1024px.
- **Chat (v1)**: chip cache-first no composer, antes do `ModelPill`
  (`Composer.tsx:677`), sem anel de contexto (`% contexto` fica P2). Mesmo componente,
  `placement: 'composer'`.
- **“Tempo real”**: atualiza ao fim de **cada request de wire** (evento
  `cache_stats`); **durante** o request/streaming mostra a última amostra (não há
  usage antes da resposta do provedor). Ao reabrir, restaura de `get_cache_stats`.
- **Estados**: `aquecendo` (sem amostra/primeiro request ou `—`), `estável` (hit ≥
  threshold e sem quebra), `atenção` (entre thresholds), `caiu` (quebra detectada para
  prefixo persistente), `política do provedor` (Gemini 4/Gemini abaixo do δ),
  `não reportado/não suportado` (muted). Thresholds vêm de `src/lib/cache.ts`
  (ex.: estável ≥95% do ceiling, atenção 60–95%, caiu <60% ou quebra).
- **Popover**: “Cache de prompt”; número grande (último request), “sessão NN%
  (ponderado)”, “estável NN%”, **“teto deste request NN%”**; barra
  `role="progressbar"` com `lido do cache / gravado / novo`; estado; última quebra
  com causa legível; TTL; economia estimada (usa `cost.cache_read`/`cache_write`);
  rodapé com “N amostras” e ação “Copiar usage bruto” (diagnóstico F5.4). Sem dados:
  mensagem honesta, nunca `100%`.
- **Textos pt-BR**: “Cache de prompt”, “Cache hit”, “Teto”, “Lido do cache”, “Gravado
  no cache”, “Tokens novos”, “Aquecendo…”, “Estável”, “Cache caiu”, “Política do
  provedor”, “Não reportado pelo provedor”, “Última quebra”, “Economia estimada”,
  “Sessão”.
- **Cores/tokens**: `--success`/`--warning`/`--danger` existentes; `--success` tem
  ~3,3:1 no tema claro, então o **número fica neutro** e a cor vai no ícone/barra (ou
  token novo `--success-text`). Sem hex solto.
- **Acessibilidade**: `aria-label` no gatilho (“Cache hit: 98% do prompt lido do
  cache”), `aria-describedby` preservando o nome testado, progressbar com
  `aria-valuetext`, foco visível, popover por teclado, `motion-reduce`.
- **Testes**: `ContextMeter.test.tsx` (estados, payload antigo, teto, clamp, a11y,
  popover), `cacheStore` (evento → estado, restore, seed idempotente), Chat
  (indicador presente), Settings (persistência).
- **Divergências conscientes** com `docs/research/cache-audit-ui.md` (registrar na
  F5.5): o plano persiste `cache_samples`/`cache_state` (a auditoria propôs só
  `ChatMessage.usage` sem migração) porque o diagnóstico e o benchmark exigem por
  request; o plano manda `state`/`hit_percent` normalizados do backend (a auditoria
  sugeria derivar estado só na UI) porque a UI não deve recalcular hit%; e a v1 tem
  `Settings.cache` mínimo (a auditoria recomendava nenhum) para TTL/esconder chip.

## 8. Fases, tarefas e dependências

> Convenções: cada tarefa tem dono único por arquivo (AGENTS.md), escopo de escrita
> explícito, verificação e evidência. Tarefas com dois donos foram quebradas em
> subtarefas. A atualização de ownership no `AGENTS.md` é **F0b.0**, antes de criar
> arquivos novos.

### F0a — Medição mínima e baseline (primeiro PR de valor)

| ID | Tarefa | Dono | Escopo (arquivos) | Verificação |
| --- | --- | --- | --- | --- |
| F0a.1 | `UsageInfo` + `CacheUsage` + parsing normalizado por protocolo (Anthropic read+creation, Responses cached/write, Google cachedContent, DeepSeek hit/miss, bloco `opencode.tokens`); `reported`; testes com fixtures reais | Lead + provider-dev | `domain.rs`, `providers/{anthropic,openai_chat,openai_responses,google,mod}.rs` | `cargo test --lib` |
| F0a.2 | `CacheSample` + `TurnEvent::CacheStats` + emissão por request nos dois perfis (inclusive final forçado); provider fake reportando cache; `merge_usage` soma cache; calibração por `input_total` (D23) | Lead + harness-dev | `domain.rs`, `events.rs`, `harness/mod.rs`, `harness/code/session.rs` | `cargo test --lib harness` |
| F0a.3 | `providers::cache::digest` canônico (body final, metadados fora do hash) + `harness::cache` hash chain/causa (sem persistência ainda, em memória); testes de propriedade `N+1 ⊇ N` | provider-dev + harness-dev | `providers/cache.rs`, `harness/cache/{mod,prefix,epoch}.rs` | `cargo test --lib cache` |
| F0a.4 | `cache_bench` com modos `synthetic` e **`e2e`** (dirige `run_turn`/prompt builder com DB/config de teste, clock/fs fake e provedor real ou fake), fixture de §9.2; baseline bruto em `evidence/` e EVIDENCE. Elegibilidade usa `minTokens` da pesquisa/fixture; `unknown` é registrado e reclassificado na F0b.2 | provider-dev (arquivo; matriz definida pelo Lead) | `providers/cache_bench.rs`, `docs/goals/prompt-cache/evidence/` | `cargo test --lib cache_bench -- --ignored` |
| F0a.5 | Prova de integração mínima: `run_turn` com provider fake → body final → `CacheSample` → `TurnEvent` (sem UI/DB); teste de 3 requests | harness-dev | `harness/mod.rs` (testes) | `cargo test --lib harness` |

**Gate F0a:** baseline por provedor disponível (ou “não provado” sem credencial); teste
de integração fake passando; nenhuma mudança de comportamento de prompt/body (diff
zero além dos campos novos de usage).

### F0b — Contratos, catálogo e fundação

| ID | Tarefa | Dono | Escopo | Verificação |
| --- | --- | --- | --- | --- |
| F0b.0 | Atualizar `AGENTS.md`: donos de `providers/cache*`, `harness/cache/**`, `commands/cache.rs`, `src/lib/cache.ts`, `cacheStore.ts`; apontar o pacote `docs/goals/prompt-cache/*` | Lead | `AGENTS.md` | revisão |
| F0b.1 | DTOs completos Rust (`CacheStats`, `CacheState`, `CacheBreakReason`, `CacheStatsView`; `PrefixDigest`/`SegmentDigest` ficam em `providers/cache.rs`); TS espelhado + `src/lib/cache.ts` + `cacheStore.ts`; testes | Lead | `domain.rs`, `events.rs`, `types.ts`, `src/lib/cache.ts`, `src/lib/store/cacheStore.ts` | `cargo test --lib` + `pnpm test src/lib/cache` |
| F0b.2 | Catálogo `cache` provider/model + `build-catalog.mjs` + `data/catalog.json` regenerado + testes de loader/paridade | Lead | `catalog.rs`, `data/catalog.json`, `scripts/build-catalog.mjs` | `node scripts/build-catalog.mjs` + testes |
| F0b.3 | Migrações + CRUD: `prompt_snapshots`, `render_decisions`, `surface_items`, `cache_state`, `cache_samples`; `usage_log` estendido; retenção/dedupe; testes com banco antigo e restart | storage-dev | `db.rs` | `cargo test --lib db` |
| F0b.4 | `Settings.cache` (`domain.rs`/`config.rs`/`SettingsView`) + normalização de valores antigos + testes; sem `enabled` | Lead + storage-dev | `domain.rs`, `config.rs`, `src/lib/types.ts` | `cargo test --lib config` + `pnpm typecheck` |
| F0b.5 | IPC `get_cache_stats` + wrapper `api.getCacheStats` + registro | Lead | `commands/cache.rs`, `commands/mod.rs`, `lib.rs`, `api.ts` | `cargo check` + `pnpm typecheck` |
| F0b.6 | Componente visual puro do chip/popover (Code ring+cache; Chat cache-first) com fixtures, estados, teto e a11y | ui-agent + ui-core | `src/components/agent/*`, `src/components/composer/*` | `pnpm test ContextMeter` |

**Gate F0b:** `cargo check`, `cargo test --lib`, `pnpm typecheck`, `pnpm test` verdes;
contratos revisados; migração de banco antigo testada.

### F1 — Indicador em tempo real (UI + persistência)

| ID | Tarefa | Dono | Escopo | Depende | Verificação |
| --- | --- | --- | --- | --- | --- |
| F1.1 | Harness persiste `cache_samples`/`cache_state` por request, calcula sessão/steady/ceiling, restaura em `get_cache_stats`; testes de restart | harness-dev | `harness/mod.rs`, `harness/cache/epoch.rs`, `commands/cache.rs` | F0a.2, F0b.3 | `cargo test --lib` |
| F1.2a | `cacheStore`/wiring dos stores (`cache_stats`, `get_cache_stats`, seed idempotente) — contrato Lead | Lead | `src/lib/store/cacheStore.ts`, `src/lib/store/{chatStore,codeStore}.ts` | F0b.1, F1.1 | `pnpm test src/lib/cache` |
| F1.2b | Chip no Code (ui-agent no `ContextMeter`; ui-code em `CodeAgentWidgets`/`CodeSessionHeader`) + restauração/reconciliação | ui-agent + ui-code | `src/components/agent/*`, `src/components/code/*` | F1.2a, F0b.6 | `pnpm test` |
| F1.2c | Chip cache-first no composer do Chat + restauração | ui-core | `src/components/composer/*` | F1.2a, F0b.6 | `pnpm test` |
| F1.3 | Diagnóstico v1: “copiar usage bruto” e lista de amostras no popover; testes | ui-agent | `src/components/agent/*` | F1.2a | `pnpm test` |

**Gate F1:** chip atualiza ao fim de cada request no app (manual) e em teste; reconstrói
ao reabrir; `usage` bruto copiável.

### F2 — Prefixo estável no Chat (coração da meta)

| ID | Tarefa | Dono | Escopo | Depende | Verificação |
| --- | --- | --- | --- | --- | --- |
| F2.1 | `prompt_snapshots` no Chat: montar/gravar/reusar (system+tools), `session_date`, `PROMPT_VERSION`, sem data no head; teste restart e igualdade byte-a-byte | harness-dev | `harness/{mod,prompt}.rs`, `harness/cache/snapshot.rs` | F0b.3, F0a.3 | `cargo test --lib` |
| F2.2 | Tools determinísticas (ordem fixa, schema hash), MCP ordenado, protocolos por lista, desempate `(created_at,id)` | harness-dev | `harness/mod.rs`, `mcp/mod.rs` | F2.1 | teste de ordem/hash |
| F2.3 | Surface append-only no Chat: remove trim deslizante; watermark com histerese para emergência; testes de propriedade | harness-dev | `harness/mod.rs`, `harness/cache/surface.rs` | F0a.3 | `cargo test --lib harness::cache` |
| F2.4 | Compactação do Chat (generalizar `compaction.rs`): fronteira de turno, threshold/retain, resumo reusando prefixo, epoch `compaction`, teste de janela | harness-dev | `harness/code/compaction.rs` (+ módulo compartilhado), `harness/mod.rs` | F2.3 | testes + live |
| F2.5a | `surface_items`: geração por digest (data/plano/modo/workspace), `after_step`, render user-role na cauda nos 4 protocolos, dedupe e órfãos | harness-dev | `harness/mod.rs`, `harness/cache/surface.rs` | F0b.3, F2.1 | `cargo test --lib` |
| F2.5b | Persistência de `surface_items` (CRUD, ordem canônica `(after_message_id, after_step, seq)`, dedupe, retenção) | storage-dev | `db.rs` | F0b.3 | `cargo test --lib db` |
| F2.6 | `mode_notes` como `surface_item` (nunca system); final forçado com system/tools idênticos e wrap-up transitório | harness-dev | `harness/mod.rs` | F2.5a | teste system/tools iguais |
| F2.7a | `render_decisions`: congelar imagem/anexo/replay no surface; nunca reescrever mensagem passada | harness-dev | `harness/mod.rs`, `harness/cache/surface.rs` | F0b.3 | teste de dois turnos |
| F2.7b | CRUD de `render_decisions` | storage-dev | `db.rs` | F0b.3 | `cargo test --lib db` |
| F2.8 | `CacheTracker` persistente: digest final, epoch/causa, `cache_stats` por request; teste 3 turnos com 0 quebras (Chat) | harness-dev | `harness/cache/*`, `harness/mod.rs` | F0a.3, F1.1 | `cargo test --lib` |
| F2.9 | Benchmark Chat pós-F2 (modo `e2e`, matriz de §9.2) e EVIDENCE | Lead | `providers/cache_bench.rs`, EVIDENCE | F2.1–F2.8 | `cache_bench --ignored` |

**Gate F2:** 10 requests de wire Chat (E2E) sem mudança de config ⇒ 0 quebras (teste + digest);
hit% medido com ceiling publicado; compactação de janela testada; nenhuma quebra
inesperada em troca de modo (via surface_item).

### F3 — Prefixo estável no Code e compactação

| ID | Tarefa | Dono | Escopo | Depende | Verificação |
| --- | --- | --- | --- | --- | --- |
| F3.1 | Code: `prompt_snapshots` por sessão — remover relógio, git/tree/todos/plano/modo do head; `AGENTS.md` por hash | harness-dev | `harness/code/{prompt,context}.rs`, `harness/mod.rs` | F2.1 | teste: git/todos mudam, prompt não |
| F3.2 | `surface_items` do Code (plano/modo/workspace/data) com dedupe; render no replay | harness-dev | `harness/code/*`, `harness/cache/surface.rs` | F2.5a, F3.1 | testes de loop |
| F3.3a | Compactação cache-safe do Code: resumo reusa prefixo com `conversation_id` (D20), substituição com epoch, corrigir D15, reconstrução de 2 turnos | harness-dev | `harness/code/compaction.rs`, `harness/batch.rs` | F3.1, F3.2, F2.4 | testes + live |
| F3.3b | Corrigir D25 (`/compact` manual: evento `context/stats` compatível com `CodeSessionState`) | code-runtime-dev | `commands/code.rs` | F3.3a | teste de `/compact` |
| F3.4 | Política de compactação Code (turno, threshold/retain, poda de tool results) e tools package por sessão (MCP/`run_code`) | harness-dev | `harness/mod.rs`, `harness/code/*` | F3.3a | testes |
| F3.5 | Benchmark Code (modo `e2e`: edição+shell+plano+compactação) e EVIDENCE | Lead | `providers/cache_bench.rs`, EVIDENCE | F3.1–F3.4 | `cache_bench --ignored` |

**Gate F3:** 10 requests de wire Code (E2E) sem mudança de config ⇒ 0 quebras; troca de plano/modo no
meio do turno não quebra o prefixo persistente (surface_item); compactação registrada
e recuperação no turno seguinte; `/compact` mantém `context` válido.

### F4 — Mecanismos explícitos por provedor (probe primeiro)

| ID | Tarefa | Dono | Escopo | Depende | Verificação |
| --- | --- | --- | --- | --- | --- |
| F4.0 | **Probe de capacidades** (script/teste `#[ignore]`): provider × rota × campo aceito × usage reportado (incl. gateway pass-through, OAuth, `prompt_cache_options` no chat, `cachedContent`), `minTokens` real; alimenta `catalog.cache` (Lead edita) | provider-dev (matriz Lead) | `scripts/probe-cache.mjs` / `providers/cache_bench.rs`, EVIDENCE | F0a.1, F2.9, F3.5 | relatório no EVIDENCE |
| F4.1 | Anthropic: system em blocos + 3 breakpoints (tools/system/cauda), TTL 1h default, 400→2 breakpoints `degraded`, normalização read+creation | provider-dev | `providers/anthropic.rs`, `providers/cache.rs` | F4.0, F2.8, F3.5 | testes + live |
| F4.2 | OpenAI Responses: `prompt_cache_key` hash ≤64, retention/TTL por capability, whitelist OAuth só após probe, fallback em 400 | provider-dev | `providers/openai_responses.rs`, `providers/cache.rs` | F4.0 | testes + live |
| F4.3a | openai-chat/gateway: `prompt_cache_key` condicionado, fallback em 400, `x-opencode-session` estável, parse `opencode.tokens`/DeepSeek hit-miss | provider-dev | `providers/openai_chat.rs`, `providers/cache.rs` | F4.0, F3.3a | testes + live |
| F4.3b | Batch/compactação/subagente com session id estável (pai para subagente); teste de afinidade | harness-dev | `harness/{batch,code/subagent}.rs` | F4.3a, F3.3a | teste + live |
| F4.4 | Google: implícito estável, `cachedContentTokenCount`, `ProviderPolicy` (2.050), teste live | provider-dev | `providers/google.rs`, `providers/cache.rs` | F4.0 | live + nota |
| F4.5 | Spike timeboxed `cachedContents` explícito (go/no-go documentado; Gemini 4 Argon fora) | provider-dev | `.research/` (fora do código de produção) | F4.4 | nota de decisão |
| F4.6 | Matriz de benchmark pós-mecanismos por `profile × provider × protocol` (modo `e2e`); atualizar catálogo/EVIDENCE | Lead | `providers/cache_bench.rs`, EVIDENCE | F4.1–F4.4 | `cache_bench --ignored` |

**Gate F4:** matriz real por perfil/provedor/protocolo; ≥98% steady-state (ceiling
≥98%) nos que reportam; Anthropic direto ≥99%; exceções documentadas; fallback 400
testado; nenhuma promessa sem probe.

### F5 — UI final, settings, diagnóstico e docs

| ID | Tarefa | Dono | Escopo | Depende | Verificação |
| --- | --- | --- | --- | --- | --- |
| F5.1 | `ContextMeter` final: selo + popover completo (números, teto, barra, estado, quebra, TTL, economia, amostras, copiar usage); a11y; integração header Code | ui-agent + ui-code | `src/components/agent/*`, `src/components/code/*` | F1.2b, F4.6 | `pnpm test` |
| F5.2 | Composer do Chat: chip cache-first final + popover; testes | ui-core | `src/components/composer/*` | F1.2c, F4.6 | `pnpm test` |
| F5.3 | Settings → Ferramentas: seção “Cache de prompt” (mostrar indicador, TTL Anthropic, retenção OpenAI, diagnóstico); persistência via `Settings.cache`; testes | ui-systems | `src/components/settings/*` | F0b.4 | `pnpm test settings` |
| F5.4 | Diagnóstico: comando na paleta abre painel/relatório da conversa (epochs, quebras, amostras, usage bruto, copiar JSON) | ui-agent + ui-systems | `src/components/agent/*`, `src/components/palette/*` | F0b.5, F1.1 | `pnpm test` |
| F5.5 | Docs: `ARCHITECTURE.md`, `MODELS.md` (remove “melhoria futura”), `DESIGN.md`, `HARNESS.md` §10 (“volátil no fim do prompt” corrigido para “última mensagem”), divergências com `cache-audit-ui.md`, pacote do goal | Lead | docs citados | F5.1–F5.4 | revisão + testes |

**Gate F5:** `pnpm typecheck`, `pnpm test`, `pnpm build`, `cargo check`,
`cargo test --lib`; app empacotado mostra chip em tempo real e `usage` bruto copiável;
baseline E2E (F0a.4) e matriz E2E (F4.6/F6.1) registrados no EVIDENCE.

### F6 — Entrega, matriz final e remoção do caminho deslocado

| ID | Tarefa | Dono | Escopo | Verificação |
| --- | --- | --- | --- | --- |
| F6.1 | Matriz final de benchmark (todos os provedores × protocolos × perfis × modelos; modo `e2e`), custo antes/depois, mediana/p10; EVIDENCE completo | Lead | `providers/cache_bench.rs`, `EVIDENCE.md`, `evidence/` | `cache_bench --ignored` |
| F6.2a | Remover prompt/paths deslocados no harness (trim, prompt volátil, `build_system_prompt` legado) | harness-dev | `harness/{mod,prompt}.rs`, `harness/code/*` | diff + testes |
| F6.2b | Remover `usage_summary` test-only e código morto de storage; revisão final do diff de schema | storage-dev | `db.rs` | diff + testes |
| F6.3 | Avaliar warming pago do gateway e replay v3 multi-modelo como follow-up documentado; revisão final do pacote (GO/EVIDENCE/AGENTS) | Lead | `docs/goals/prompt-cache/*`, `AGENTS.md` | checklist + revisão |

**Gate F6 (aceite final):** §2.4 cumprido ou exceções documentadas; nenhum caminho
duplicado; docs atualizados.

### 8.1 DAG resumido

```
F0a.1 ─┬─ F0a.2 ─┬─ F0a.4 ─ F0a.5
F0a.3 ─┴─────────┘
F0b.1 ─ F0b.2 ─ F0b.3 ─┬─ F1.1 ─ F1.2a ─ F1.2b/c ─ F1.3
F0b.0 ─────────────────┘        └─ F2.1 ─ F2.2 ─ F2.3 ─ F2.4 ─ F2.5a/b ─ F2.6 ─ F2.7a/b ─ F2.8 ─ F2.9
F0b.6 ──────────────────────────────────────► F1.2b/c
                                        └─ F3.1 ─ F3.2 ─ F3.3a ─ F3.3b ─ F3.4 ─ F3.5
                                                            └─ F4.0 ─ F4.1..F4.5 ─ F4.6
                                                                                └─ F5.1..F5.5 ─ F6
F0b.4 ─ F5.3; F0b.5 ─ F5.4
```

### 8.2 Primeiro PR (F0a — medir antes de tocar no prompt)

1. **F0a.1**: normalização de usage por protocolo + testes de fixtures.
2. **F0a.2**: `CacheSample`/`TurnEvent::CacheStats` + emissão por request com provider
   fake + calibração do contexto.
3. **F0a.3**: digest canônico + hash chain/causa em memória + testes de propriedade.
4. **F0a.4**: `cache_bench` fake + live `#[ignore]` + baseline no EVIDENCE.
5. **F0a.5**: teste de integração `run_turn` fake.

Sem UI, sem migração/DB de produção e sem catálogo (DB/config de teste e provedor fake são permitidos no modo `e2e`); sem mudança de prompt. O baseline medido destrava o
resto; F0b/fundação vem no PR seguinte.

### 8.3 Ownership (proposta de atualização do `AGENTS.md`)

| Área nova | Dono |
| --- | --- |
| `providers/cache.rs`, `providers/cache_bench.rs`, campos de cache nos 4 adaptadores | provider-dev |
| `harness/cache/**`, `prompt_snapshots`, `surface_items`, compactação cache-safe | harness-dev |
| `prompt_snapshots`/`surface_items`/`render_decisions`/`cache_state`/`cache_samples` — accountable: harness-dev; schema/CRUD em `db.rs` delegado a storage-dev | harness-dev (storage-dev no `db.rs`) |
| `ContextMeter`/popover/diagnóstico — accountable ui-agent; integração no header Code (ui-code) | ui-agent (ui-code no header) |
| composer do Chat (ui-core); `cacheStore`/`src/lib/cache.ts` (Lead, contrato) | ui-core + Lead |
| Settings “Cache de prompt” | ui-systems |
| contratos Rust/TS, catálogo, IPC, benchmark (matriz), evidência | Lead |

## 9. Verificação, testes e evidência

### 9.1 Testes automatizados (TDD)

- **Backend** (`cargo test --lib`):
  - `providers::cache`: capabilities por protocolo; `normalize_usage` com fixtures dos
    4 formatos + bloco `opencode.tokens`; `apply` (Anthropic 3 breakpoints/limite,
    fallback 400; Responses com chave; chat sem chave quando não suporta; Google sem
    campo novo); `digest` estável com TTL/breakpoints mudando.
  - `harness::cache`: hash chain; prefixo comum (append/rewrite/remove); causa; epoch;
    propriedade: sem mudança de config, prefixo N+1 é extensão byte-a-byte do N;
    restart lê o mesmo hash.
  - Prompt/tools estáveis com clock congelado e fs fake; `surface_items` com
    `after_step` (modo no meio do turno, final forçado); `render_decisions`;
    compactação reusando prefixo (provider fake captura body e compara); regressão
    `to_seq` (D15) e `/compact` (D25); loop com provider fake emitindo `cache_stats`.
  - Paridade de contrato Rust↔TS e catálogo.
- **Renderer** (`pnpm test`): helpers de `src/lib/cache.ts`; `cacheStore` (seed
  idempotente, restore, reconciliação); chip Code/Chat; popover (teto, estados,
  quebra, custo); legado; a11y; Settings.
- **Integração (gate obrigatório em F0a/F1/F2/F3/F4):** `run_turn` com provider fake
  captura **body final pós-`apply`** por N requests, gera `CacheSample` → `TurnEvent`
  → `cacheStore` → props do chip; teste de 3 requests com 0 quebras e hit calculado.
- **Live** (`#[ignore]`): `cache_bench` (`synthetic` + `e2e`) com fixture de §9.2 e
  `probe-cache`; assert duro **só** no fake; live registra mediana/p10 e artefato bruto.

### 9.2 Protocolo do benchmark (fixo, versionado)

- **Fixture:** `docs/goals/prompt-cache/evidence/bench-fixture.json`, versão 1.
  - **Longa (ciclo de vida/custo):** 120 requests de wire; `P` cresce de ~20k para
    ~121k tokens estimados; `Δ ≈ 850` por request (histórico sintético semeado; user
    ~100 + resposta simulada ~750), registrado por request. Conta:
    `ΣP ≈ 8,47M`, `P_cold = 20k`, `P_write ≈ 20,9k`, `ΣΔ ≈ 101k` ⇒
    `(P_cold + P_write + ΣΔ)/ΣP ≈ 1,7% ≤ 2%`.
  - **Curta (smoke):** 12 requests com a mesma regra de `Δ`; ciclo de vida
    **reportado sem meta** (o cold não dilui em 12 requests).
  - **Code:** 12 requests com tool results de ~1k tokens, plano/todos e uma
    compactação no meio; `P`/`Δ` registrados.
  - **Modos do bench:** `synthetic` (requests isolados, capacidades/isolamento) e
    **`e2e`** (caminho do produto: `run_turn` com DB/config de teste, clock/fs fake e
    provedor real ou fake que registra bodies/digests). Baseline F0a.4, F2.9, F3.5,
    F4.6 e F6.1 usam `e2e`; `synthetic` complementa.
- **Rotas:** cada linha da matriz fixa `provider × protocol × model × request profile`
  (ex.: `opencode-go / openai-chat / deepseek-v4.1-flash / standard`,
  `anthropic / anthropic / claude-sonnet-5.5 / standard`,
  `openai / openai-responses / gpt-5.6 / standard` e `chatgpt-plan` se houver conta).
- **Execução:** TTL respeitado (espera declarada entre requests; 1h para Anthropic se
  o TTL for 1h); **5 repetições**; p50 e p10; custo máximo por run declarado; JSON
  bruto `<provider>-<protocol>-<model>-<timestamp>.json` com `usage` de cada request.
- **Aceite:** `hit%` p50 ≥ meta da tabela §2.4 **para requests com ceiling ≥ meta**;
  ciclo de vida publicado ao lado (inclui cold/write); diferença UI × usage bruto
  verificada manualmente; nenhum run isolado reprova o gate se a mediana e o artefato
  cumprirem.
- **Credenciais:** gateway OpenCode via `~/.local/share/opencode/auth.json` /
  `OPENCODE_API_KEY`; Anthropic via `ANTHROPIC_API_KEY`; OpenAI direto só se
  `OPENAI_API_KEY` existir (o caminho OAuth não é testável em CI). Matriz de
  disponibilidade registrada no EVIDENCE; provedor sem credencial = “não provado”.

### 9.3 Comandos (gates)

```bash
cd src-tauri && cargo check
cd src-tauri && cargo test --lib
cd src-tauri && cargo test --lib cache_bench -- --ignored   # chaves reais

pnpm typecheck
pnpm test
pnpm build
```

### 9.4 Evidência por fase

- F0a: baseline (hit% por request, P/Δ/ceiling, usage bruto) em `evidence/`.
- F1: teste de integração fake + verificação manual do chip; `usage` bruto copiável.
- F2: diff de bodies N/N+1 (prefixo idêntico), teste de 0 quebras, hit% Chat com
  ceiling, compactação do Chat.
- F3: benchmark Code, body do resumo com cache read, recuperação após compactação,
  `/compact` válido.
- F4: matriz por perfil/provedor/protocolo; probe de campos; Anthropic ≥99%; exceções.
- F5: testes de UI + verificação manual no app empacotado.
- F6: matriz final (modo `e2e`), custo antes/depois, revisão.

Sem automação de UI/navegador como critério (AGENTS.md); a numérica vem dos
testes/benchmark e a visual é manual no app empacotado.

## 10. Riscos e mitigação

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Gateway OpenCode não repassa `cache_control`/`prompt_cache_key` | Anthropic/OpenAI via gateway sem cache explícito | probe F4.0 antes de prometer; fallback automático; exceção documentada; `x-opencode-session` continua sendo o ganho de afinidade |
| Granularidade real do `x-opencode-session` não provada | expectativa otimista | F4.0 mede; não prometer número antes; UI só mostra reportado |
| TTL curto expira entre mensagens | cold start derruba a média | Anthropic TTL 1h default (5m opção); retention/TTL OpenAI; UI mostra “frio”; meta com ciclo de vida publicado |
| Gemini 4 exige ≥2.050 tokens novos | teto <98% em turnos pequenos | `ProviderPolicy`; SLO condicional `P≥40k`; não marcar “caiu” |
| Mínimos por modelo desconhecidos | elegibilidade errada/maquiagem | catálogo `minTokens`; `null` = excluído e contado; probe mede |
| Custo de write (1,25×–2,5×) > input em sessões curtas | pode piorar custo | gate de custo `P ≥ max(2×min, 4096)`; economia medida no benchmark incluindo writes |
| Reestruturar prompt piora respostas | regressão de qualidade | testes de prompt existentes; rollback da fase; cache não vale qualidade |
| `prompt_cache_key` no plano OAuth não documentado | perfil sem chave | probe; whitelist condicional; melhor esforço documentado |
| Mudanças de tools/skills/settings no meio da sessão | epoch break | snapshot por sessão; causa registrada; teste de toggle |
| Duplicar caminho de prompt | manutenção/divergência | cutover F6; sem feature flag; testes de regressão |
| Benchmark live flaky | evidência fraca | assert duro só no fake; live p50/p10 + artefato; N=5; TTL controlado |
| Sem credencial para um provedor | meta não comprovada | “implementado, não provado” no EVIDENCE; não bloqueia outros; não entra na média global |

## 11. Cutover e o que será removido (kill criteria de caminho)

| Caminho deslocado | Substituído por | Remoção |
| --- | --- | --- |
| `build_history` trim deslizante (`harness/mod.rs:2022-2050`) | watermark com histerese + compactação (Chat F2.4; Code F3.4) | deleção F6.2 |
| Relógio/data/estado volátil no system prompt | `prompt_snapshots` + `surface_items` | F2.1/F3.1, deleção F6.2 |
| `mode_notes` no head e final forçado com prompt/tools diferentes | `surface_items` + wrap-up transitório | F2.6 |
| `usage` só no fim (sem per-step) | `cache_stats` por request; `usage` continua como total | F0a.2/F1.1 |
| `ContextMeter` só de contexto | chip de cache integrado (Code ring+cache; Chat cache-first) | F5.1/F5.2 |
| Compactação com system prompt próprio e `to_seq` inconsistente | resumo reusando prefixo; fronteira estável | F2.4/F3.3a |
| Decisão de imagem recalculada | `render_decisions` congeladas | F2.7a |
| `usage_summary` `#[cfg(test)]` | `get_cache_stats`/agregação de produção | F0b.5/F6.2 |

Não deslocado (continua): `usage` por turno (billing), `context_stats` por passo no
Code (ganha cache via evento próprio), `provider_state` v2.

## 12. Decisões fechadas e confirmações pendentes

**Fechadas neste plano:**
1. **TTL Anthropic**: 1h default (write 2×, read 0,1×) porque o uso é desktop com
   pausas; 5m fica como opção em `Settings.cache`. O gate de custo de §4.5 evita write
   em prefixo pequeno.
2. **Sem feature flag de produto**: rollback = reverter release; só
   `show_indicator` é preferência de UI.
3. **Chat v1 cache-first**: sem anel de contexto; `% contexto` no Chat é P2.
4. **Persistência canônica**: `cache_samples` + `cache_state`; `ChatMessage.usage`
   legado só como fallback; `usage_log` continua por turno (billing).
5. **Ordem**: estabilidade Chat (F2) → estabilidade Code (F3) → mecanismos explícitos
   (F4), com probe F4.0 antes de qualquer campo novo.
6. **Benchmark**: arquivo `providers/cache_bench.rs` (dono provider-dev), matriz
   definida pelo Lead, fixture versionada e N=5.

**Confirmadas pelo usuário em 29/10 (registradas; nenhuma decisão aberta):**
1. **Chat v1 cache-first**, sem anel de contexto; `% de contexto` no Chat fica P2.
   `ContextMeter` do Code continua com anel + selo de cache; composer do Chat tem só
   o chip de cache.
2. **`prompt_cache_key` no perfil ChatGPT/OAuth**: ligar **se** o probe F4.0 provar
   que a rota aceita (custo zero, ganho incerto). Se rejeitar (400), manter sem a
   chave e registrar `não suportado`/`degraded` — nunca insistir. A whitelist
   `CHATGPT_PLAN_ALLOWED_FIELDS` só ganha o campo após o probe (F4.2).
3. **Warming pago do gateway (4/30 min)**: fica fora da v1; avaliar custo/ganho em
   F6.3 como follow-up documentado.
4. **`retain` da compactação**: 16% de `W − output` por perfil (como DSH), com
   override por modelo (F2.4/F3.4).

Com isso o pacote está **GO** para F0a (baseline/medição); F0b/F2 seguem a ordem do
§1. As decisões acima não mudam contratos nem fases — apenas fixam parâmetros.

## 13. Referências

- Pesquisa de mecanismos por provedor/OpenCode/DeepSeek Harness:
  `docs/research/prompt-caching.md` (matriz, fontes oficiais, código do OpenCode,
  READMEs do DSH; lacunas explícitas).
- Auditoria do backend atual: `docs/research/cache-audit-backend.md`.
- Auditoria de UI/IPC atual: `docs/research/cache-audit-ui.md`.
- DSH (fonte local extraída): `.research/asar-out/dsh/node_modules/@deepseek-ai/` —
  `dsh-agent-loop` (request/header + prefix reuse), `dsh-token-meter`
  (`cacheReadTokens`/`cacheWriteTokens`/`uncachedInputTokens`), `dsh-compaction-basic`
  (replay byte-a-byte), `dsh-system-prompt` (in-history/estável).
- Arquitetura do Lumina: `docs/ARCHITECTURE.md` §5/§8/§12; `docs/MODELS.md`
  (“Prompt caching fica como melhoria futura” — atualizar no F5.5).
- Medidor: `docs/DESIGN.md` §6.3 / WORKBENCH §4/§9;
  `src/components/agent/ContextMeter.tsx`.
- Custos: `data/catalog.json` (`cost.cache_read`/`cost.cache_write`).
