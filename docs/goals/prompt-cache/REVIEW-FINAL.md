# Revisão final independente — F6.3 (cache de prompt)

**Verdict: incomplete**

**Base revisada:** `docs/goals/prompt-cache/PLAN.md` — 1292 linhas, SHA-256
`9BA2708E5B74AA5F323865CB9345EFE059534C263ACDCD05017BEB1388E943A7`; `EVIDENCE.md`
com 222 linhas; worktree local com a implementação F0a–F6 (inclui arquivos não
commitados). Revisão **read-only** fora deste arquivo: li PLAN/EVIDENCE, amostrei o
código e os testes, executei os gates e reproduzi os testes live; não editei
PLAN/GOAL/EVIDENCE/código.

**Resumo.** A implementação é substancial e, no essencial, real: contratos, tracker,
persistência, snapshots/surface, compactação cache-safe, IPC, chip/popover,
diagnóstico, catálogo com probe e o caminho provider (catálogo → plano → `apply` →
digest → usage) existem e os testes de unidade passam. A prova live do gateway
OpenCode/anthropic é genuína e **eu a reproduzi**: 99,92% no roundtrip e 98,48% no
steady de 8 requests, com sessão de 89,30% na fixture curta. Porém o **aceite do
plano não foi executado** (baseline, fixture longa, N=5/p50/p10, `e2e`, custo,
matriz), a **UI promete TTL/economia/usage bruto que o backend não popula** e o
`pnpm test` não é estável sob carga. Por isso o veredito honesto é `incomplete`;
só seria `complete with documented exceptions` se o usuário aceitar formalmente um
escopo de evidência reduzido (uma rota provider-level provada) e as pendências de UI.

---

## Gates executados (independentemente)

| Gate | Resultado |
| --- | --- |
| `cd src-tauri && cargo check` | exit 0 (warnings) |
| `cd src-tauri && cargo test --lib` | **919 passed, 0 failed, 12 ignored** (32,78 s) |
| `cd src-tauri && cargo build` | exit 0 (72 warnings no build lib) |
| `pnpm typecheck` | exit 0 |
| `pnpm test` (run isolada, sem outro job) | **120 arquivos / 2216 passed** (128,74 s) |
| `pnpm build` | exit 0 |
| `cargo test --lib live_cache_gateway -- --ignored --nocapture` | **2 passed**; 99,92% (5207/5211) e 98,48% steady (131.501/133.529); sessão 89,30% (146.881/164.487) |
| `cargo test --lib cache_bench -- --ignored` | **0 tests** (931 filtrados) — o gate de benchmark do PLAN §9.3 não executa nada |

Observação: duas execuções independentes de `pnpm test` feitas **em paralelo com
cargo/live** falharam (primeira: 5 `vitest-pool` worker timeouts; segunda: 5 timeouts
de 5 s em `ModelPickerDialog.auth`/`ModelPill.edge`, 2211/2216). Rodando os arquivos
falhos isoladamente: 26/26 passed; a suíte inteira isolada: 2216/2216. O gate é
**sensível a carga** (o EVIDENCE não registra essa flutuação final).

---

## Findings — blockers

### B1 — [blocker] O protocolo de aceite do PLAN não foi executado; o EVIDENCE superestima o que foi provado

**Evidência.**
- O PLAN exige baseline F0a.4 (`PLAN.md:969-979`; §9.4 `:1197-1207`), fixture longa de
  120 requests, `e2e` via `run_turn`, 5 repetições, p50/p10 e JSON bruto
  (`PLAN.md:332-348,1153-1183`), além da matriz F6.1 (`:1077-1088`).
- O EVIDENCE deixa a seção **Baseline** explicitamente vazia (“_a preencher na
  F0a.4_”) — `EVIDENCE.md:46-53` — e não há `bench-fixture.json` nem
  `providers/cache_bench.rs`: `docs/goals/prompt-cache/evidence/` contém apenas os
  três probes; `Test-Path` falso para os dois artefatos. O comando de gate do PLAN
  `cargo test --lib cache_bench -- --ignored` retorna **0 testes**.
- A única prova numérica de steady (98,48%) vem de
  `providers::cache::tests::live_cache_gateway_anthropic_bench`
  (`providers/cache.rs:3064-3282`): **10 requests, uma execução**, caminho direto
  `stream_completion`/`build_body`/`cache::apply`, **não** `run_turn`/prompt
  snapshot/surface do harness. A fixture é ajustada para 36k chars
  (`providers/cache.rs:3084-3094`) para caber no ceiling≥98%. O assert duro do teste
  é **≥90%** (WARN <95%) — `providers/cache.rs:3252-3280` — não a meta de 98% do
  PLAN (`PLAN.md:308-327`).
- O ciclo de vida de 89,30% é da fixture curta (10 requests) e está publicado com
  honestidade (`EVIDENCE.md:113-123`), mas o PLAN só declara 98% de ciclo na fixture
  longa (`PLAN.md:315`), que não foi rodada. Custo: `n/d` na matriz
  (`EVIDENCE.md:137`), embora §2.4 exija ≥8,4×/14× steady e ≥7×/12× de ciclo
  (`PLAN.md:316-317`).
- O EVIDENCE afirma “**F0–F6 executados**” e a linha “Chat/Code (**harness
  completo**)” como **provado** (`EVIDENCE.md:7-10,137`), mas a prova live é do
  caminho provider (o próprio texto de §1.2 lista `capabilities_for → plan_with_caps
  → stream_completion`, sem `run_turn`; `EVIDENCE.md:70-92`) e a matriz só tem uma
  rota (`EVIDENCE.md:135-141`).

**Impacto:** não é possível afirmar o aceite global 98–99% do PLAN, nem “sessão
longa/E2E provada”, nem “antes/depois”; o que existe é uma prova correta e
reprodutível do mecanismo em **uma** rota/modelo no caminho provider-level. O número
98,48% em si **não está maquiado** (a aritmética 131.501/133.529 = 98,48% confere),
mas está rotulado acima do que o protocolo do plano define.

**Correção mínima:** implementar/executar o `e2e` de F0a.4/F2.9/F3.5/F4.6/F6.1 com
`run_turn` (DB/config de teste + clock/fs fake), a fixture longa de 120 requests,
N=5, p50/p10, JSON bruto e custo; criar `bench-fixture.json` e o módulo
`providers/cache_bench.rs` (ou corrigir o comando do PLAN); registrar o baseline ou
declará-lo formalmente indisponível; corrigir os rótulos “harness completo” e
“F0–F6 executados” no EVIDENCE. Alternativa: o usuário aceitar explicitamente o
escopo reduzido (uma rota provider-level provada) → reclassificar como
`complete with documented exceptions`.

### B2 — [blocker] TTL, economia e “usage bruto” do popover não existem no backend; o EVIDENCE afirma que sim

**Evidência.**
- `commands/cache.rs` preenche `min_cacheable_tokens: None`, `ttl_seconds: None`,
  `provider_policy: None` e `savings_usd: None` tanto em `current` quanto em
  `session` (`commands/cache.rs:16-38,70-101`).
- `CacheHitChip` lê esses campos (`CacheHitChip.tsx:96-97`), mostra TTL sempre como
  `—` (`:328`) e só mostra “Economia estimada” quando `savingsUsd != null`
  (`:329-330`); na prática a economia nunca é exibida. O helper
  `cacheSavingsUsd` (`src/lib/cache.ts:196`) não tem chamador de produção (só teste).
- `CacheSample.raw_usage` nunca é preenchido: o tracker cria a amostra com
  `raw_usage: None` (`harness/cache/mod.rs:264-285`) e não há preenchimento posterior;
  o botão “Copiar usage bruto” fica escondido (`CacheHitChip.tsx:255-260,348-358`) e
  o diálogo de diagnóstico copia `rawUsage: null`. Os testes do chip usam `stats({
  ttlSeconds: 3600, savingsUsd: 0.42 })` sintéticos (`CacheHitChip.test.tsx:336-337`),
  não o caminho real.
- O EVIDENCE marca como concluídos “TTL”, “economia” e “Copiar usage bruto”
  (`EVIDENCE.md:168-176`) e exige no aceite a comparação UI × `usage` bruto
  (`EVIDENCE.md:143-150`); sem `raw_usage` essa verificação manual não é possível.

**Impacto:** o Target-Perspective Output do PLAN (`PLAN.md:56-66`; §7
`PLAN.md:916-920`) não é
entregue; a evidência de UI é sintética, não do app. Isso é uma **afirmação falsa**
no EVIDENCE, não apenas uma feature secundária ausente.

**Correção mínima:** popular TTL/min/provider policy a partir das capabilities do
catálogo (`providers::cache::capabilities_for`), calcular `savings_usd` com
`cost.cache_read/cost.cache_write`, e propagar o `usage` bruto do provedor para
`CacheSample.raw_usage`/diagnóstico; adicionar teste de integração e atualizar
EVIDENCE (ou remover as colunas/copy e declarar o escopo).

### B3 — [blocker] A decisão de render de imagem/anexo continua recalculada por turno (D7 não fechou)

**Evidência.**
- `image_enabled_messages` continua sendo calculada a cada `build_history`
  (`harness/mod.rs:2999-3024,3259-3286`) com o budget global
  `MAX_HISTORY_IMAGE_BASE64_CHARS` (`harness/mod.rs:45-46`). Mensagens antigas podem
  passar de imagem para texto quando uma imagem nova entra no orçamento — exatamente
  o D7 do diagnóstico (`PLAN.md:362-396`).
- `render_decisions` está implementado apenas para poda de **tool result**
  (`harness/compaction.rs:49-50,94-109`; `harness/mod.rs:2956-2974`); não há
  `render_decision` para imagem/anexo/replay. O PLAN exige congelar
  imagem/anexo/replay (F2.7a, `PLAN.md:1022`; §4.3 `:464`).
- O EVIDENCE lista apenas “Poda de tool results … `render_decisions` kind
  `tool_result`” (`EVIDENCE.md:198,219`), não cobre imagens; não há teste de dois
  turnos com orçamento de imagem mudando.

**Impacto:** em conversas com imagens o invariante de prefixo pode quebrar sem
epoch/causa; a meta “0 quebras em regime estável” não está provada para esse fluxo.

**Correção mínima:** congelar a decisão de render (imagem vs texto, anexo truncado,
replay) por mensagem na primeira inclusão no surface e reusar em replay/restart;
adicionar teste de dois turnos com budget de imagem estourando e registrar a
cobertura no EVIDENCE. Se ficar fora do v1, declarar a exceção explicitamente.

---

## Findings — majors

1. **Prova live é adapter-level, não o caminho do produto.** `collect_live_stream`
   (`providers/cache.rs:2814-2841`) chama `stream_completion` diretamente; não há
   `run_turn`, snapshot/surface, `CacheTracker` nem `cache_stats` no teste live. O
   EVIDENCE chama a linha de “Chat/Code (harness completo)” (`EVIDENCE.md:137`),
   o que é falso. O 98,48% prova o mecanismo do provedor, não o produto inteiro.
2. **Baseline ausente.** `EVIDENCE.md:46-53` está vazio; F0a.4/Gate F0a
   (`PLAN.md:969-979`) e §9.4 (`:1197-1207`) exigem baseline. Sem ele não há
   “antes/depois” nem como atribuir ganho ao plano.
3. **Custo não medido.** A matriz diz `n/d` (`EVIDENCE.md:137`); as metas de custo
   steady/ciclo (`PLAN.md:316-317`) não têm evidência.
4. **Matriz incompleta.** Só `opencode-go/anthropic/claude-haiku-5-5` foi provado.
   As rotas `opencode-go`/`zen` em `openai-responses`/`google` aparecem como “sem
   probe específico” (`EVIDENCE.md:141`), embora a credencial do gateway esteja
   disponível; Gemini 4 não foi testado. O PLAN permite “não provado” só para
   provedor sem credencial (`PLAN.md:325-327`).
5. **Artefatos/gate do benchmark ausentes.** Não existem
   `docs/goals/prompt-cache/evidence/bench-fixture.json` nem
   `providers/cache_bench.rs`; o gate do PLAN
   `cargo test --lib cache_bench -- --ignored` roda **0 testes**
   (`PLAN.md:969-979,1077-1088`). É um gate falso-positivo se usado como está.
6. **Verificação manual no app empacotado não registrada.** O EVIDENCE §4 tem
   checkboxes de testes de componente (`EVIDENCE.md:161-176`), mas o PLAN exige
   verificação manual do chip e comparação UI × usage ≤1 p.p.
   (`PLAN.md:122-125`; §7). Com `raw_usage`/TTL/economia nulos (B2), essa verificação
   não foi possível; não há artefato de app empacotado.
7. **Gate `pnpm test` instável sob carga.** Suíte isolada: 2216/2216; duas execuções
   independentes concorrentes com cargo/live falharam por timeouts de worker/teste
   (5 e 5). O EVIDENCE registra 2216/2216 sem nota (`EVIDENCE.md:187,221`); o gate
   precisa de `testTimeout`/pool/CI ou da nota de flakiness.
8. **EVIDENCE com claims não sustentados além dos acima.** “F0–F6 executados”
   (`EVIDENCE.md:7-10`), “warnings do harness 10 → 0” (`EVIDENCE.md:218`; cargo
   build/test emitiu 51–72 warnings, incluindo warning de harness em teste), e o
   `probe-opencode-go-live.json` registra o provider `cache` como
   `mode=auto/source=family-default` enquanto `data/catalog.json` diz
   `mode=explicit/source=probe` (`EVIDENCE.md:89-92`); o artefato precisa ser
   sincronizado.
9. **`render_decisions` cobre só tool result** (além do B3, é uma lacuna de
   implementação em relação ao contrato do PLAN).
10. **Cutover F6.2 não é literal.** `summary_system_prompt` segue no código com
    `#[allow(dead_code)]` (`harness/compaction.rs:278-284`) e `usage_summary`
    continua `#[cfg(test)]`; `history_budget`/`build_system_prompt` permanecem como
    fallback/builder. Não há caminho deslocado **dominante** (bom), mas o EVIDENCE
    “dead code removido”/`F6.2` não fecha a leitura literal do §11
    (`PLAN.md:1229-1240`).

## Findings — minors

- `CacheStatsView`/`CacheStats` continuam com `ttl_seconds`, `min_cacheable_tokens`,
  `provider_policy` e `savings_usd` sempre `None` no caminho IPC
  (`commands/cache.rs:31-37,90-100`).
- O `EVIDENCE` ainda tem a seção “Pendências para as próximas rodadas: F2…F3…F4”
  (`EVIDENCE.md:43-44`) depois de declarar F0–F6 executados; texto obsoleto.
- Mocks de teste que não expõem `api.getCacheStats` geram warnings repetidos
  (`failed to sync conversation cache stats TypeError: … getCacheStats is not a
  function`, `chatStore.ts:353`) em vários testes de UI; o caminho de restauração
  real do store não é exercitado por esses mocks.
- `EVIDENCE` linha 137 chama o resultado de “Hit% p50” com uma única execução; e
  linha 115 fala em hard assert ≥90% — o rótulo “p50” e a meta de 98% não são o
  mesmo contrato.
- O worktree tem alterações não relacionadas ao goal de cache (ex.:
  `data/genui-contract.json`, `docs/goals/thinking-markdown/PLAN.md`,
  `src/components/models/**`); a revisão de escopo não as avaliou.
- A superfície `surface_items` é usada no perfil Code; o F2.5a do PLAN fala em
  `surface_items` também na fase Chat. Não vi violação de prefixo no Chat (data fixa
  no snapshot), mas a cobertura do task não é a prometida.

---

## Exceções aceitas

Aceito como documentadas e compatíveis com a regra “implementado, não provado /
não reportado” do PLAN (`PLAN.md:325-327`):

- **OpenAI direto (API key e OAuth/ChatGPT-plan)**: sem `OPENAI_API_KEY` e access
  token OAuth expirado (`EVIDENCE.md:68,158,195`); não provado.
- **Anthropic direto (API key)**: sem `ANTHROPIC_API_KEY` no ambiente
  (`EVIDENCE.md:159,196`); não provado.
- **Gateway `openai-chat` (DeepSeek/GLM/…)**: probe com 2 requests idênticos
  devolveu read/write=0; tratar como **não reportado**
  (`EVIDENCE.md:67,138,197`).

Não aceito como exceção (são pendências do plano, não falta de credencial):
- rotas `opencode-go`/`zen` `openai-responses`/`google` sem probe específico;
- Gemini 4 / `google` sem teste;
- fixture longa, N=5/p50/p10, `e2e`, custo, baseline e matriz completa.

## Pendências antes de declarar `complete`

1. **Aceite**: executar/implementar o `e2e` de F0a.4/F2.9/F3.5/F4.6/F6.1 com
   `run_turn`, fixture longa 120, N=5, p50/p10, custo e JSON bruto; criar
   `bench-fixture.json`/`providers/cache_bench.rs` ou corrigir o gate.
2. **Baseline**: registrar ou declarar formalmente indisponível (F0a.4).
3. **UI**: popular TTL/min/savings e `raw_usage`; ou remover as promessas do popover
   e do EVIDENCE; verificar manualmente no app empacotado.
4. **Imagem/anexo**: congelar `render_decisions` e testar orçamento de imagem entre
   turnos/restart.
5. **Matriz**: provar as rotas de gateway com credencial; documentar Gemini 4 e
   demais exceções.
6. **Qualidade do gate**: estabilizar `pnpm test` (timeout/pool/CI) e atualizar
   claims de warnings/`F0–F6`/p50 no EVIDENCE.
7. **Cutover**: remover/justificar `summary_system_prompt` e `usage_summary`
   test-only, e atualizar o §11/§9.3 do PLAN.

**Conclusão:** o produto implementado tem uma base real e a rota gateway anthropic
está provada no caminho provider-level com números honestos (99,92%/98,48%/89,30%,
reproduzidos por mim). Sob os critérios de aceite do próprio PLAN, porém, faltam
evidências obrigatórias (baseline/fixture longa/E2E/custo/matriz) e duas entregas
funcionais (TTL/economia/usage bruto e congelamento de imagem/anexo), além de o
EVIDENCE conter claims que o código não sustenta. Por isso: **incomplete**.
Se o usuário aceitar explicitamente o escopo reduzido de evidência e as pendências
de UI, o veredito pode ser reclassificado como `complete with documented exceptions`;
caso contrário, deve haver uma rodada F6.3-fix + re-prova antes do GO final.

---

## Rodada 2 — após F6.3-fix

**Base revisada:** `docs/goals/prompt-cache/PLAN.md` (1292 linhas, SHA-256
`9BA2708E…E943A7`); `EVIDENCE.md` com 257 linhas; worktree com os arquivos novos
`harness/cache/bench.rs`, `harness/render.rs`, `bench-fixture.json`,
`bench-e2e-live-2026-10-29.json`, probes atualizados. Revisão read-only fora deste
arquivo; executei os gates abaixo e o live `cache_bench`.

**Verdict final: `complete with documented exceptions`** — não há blocker de
implementação; há duas pendências **major** de evidência/documentação que não mudam
o código (p50/p10 e sincronização de claims) e uma pendência **parcial** de UI em
tempo real (TTL/economia só após restauração). O escopo reduzido abaixo precisa ser
aceito explicitamente; sob o protocolo §9.2 estrito (N=5/p50/p10 live), o veredito
seria `incomplete`.

### Gates reexecutados (29/10/2026, após o fix)

| Gate | Resultado |
| --- | --- |
| `cd src-tauri && cargo check` | exit 0 (warnings) |
| `cd src-tauri && cargo test --lib` | **937 passed, 0 failed, 13 ignored** (31,23 s) |
| `cd src-tauri && cargo test --lib cache_bench -- --ignored --nocapture` | **1 passed** (`cache_bench_e2e_live`): live steady **100,0%** (min 99,97), baseline **0,0%**, 12 requests, artefato regravado em `evidence/bench-e2e-live-2026-10-29.json` |
| `pnpm typecheck` | exit 0 |
| `pnpm test` (isolado) | **120 arquivos / 2216 passed** (150,6 s); `testTimeout: 15_000` em `vitest.config.ts:17-20` |
| `pnpm build` | exit 0 |

Os números de `cargo test`/`pnpm test` do EVIDENCE estão defasados: ele registra
**919/12** e **2216** (`EVIDENCE.md:213,256`), mas o gate real agora é **937/13**.
O E2E live de 12 turnos é genuíno: `run_fixture` chama `run_turn`
(`src-tauri/src/harness/cache/bench.rs:156-186`), o baseline remove
`provider.cache`/`model.cache` (`:198-210`) e o artefato contém `steadyMeanHit`
99,696%/baseline 0,0 na execução do Lead; a minha reexecução deu 100,0%/0,0 — a
meta ≥98% é atingida, mas o número é **mean**, não p50.

### Status B1/B2/B3

| Finding | Status | Evidência e menor correção restante |
| --- | --- | --- |
| **B1** — aceite/protocolo e gate | **parcial** | Resolvido o essencial: `cache_bench_e2e_live` roda `run_turn` real, baseline 0,0 vs live 99,7/100, `cargo test --lib cache_bench -- --ignored` **não é mais gate vazio** (1 teste executado, exit 0) e a fixture/artefato existem. Resta: (a) **p50/p10 não existem no código**: `BenchMetrics` calcula só `mean`/`min` (`bench.rs:59-95`) e o teste sintético usa `steady_mean_hit` (`:479-535`), apesar de o EVIDENCE dizer “p50/p10 ficam no sintético” (`EVIDENCE.md:147-148,233`) e o `bench-fixture.json` declarar `repetitions:5/statistics:[p50,p10]`; (b) o gate live aceita **target 95%/hard floor 90%** (`bench.rs:29-31,399-404`), não a meta 98% da §2.4; (c) a tabela F0a de baseline continua vazia (`EVIDENCE.md:55`) — o baseline 0,0 é uma ablação no E2E, não o baseline histórico; (d) a linha da matriz ainda mostra o provider-level 98,48% como “Chat/Code (harness completo)” (`EVIDENCE.md:164`) e não o E2E 99,7% de §1.4; (e) a fixture `e2e.turns=10` mas o array tem 12 turnos. **Menor correção:** implementar p50/p10 (ou remover a afirmação e declarar mean), alinhar o hard floor a 98% do fixture/PLAN (ou documentar o gate live como observacional), atualizar baseline/matriz/contagens. |
| **B2** — raw usage + TTL/economia/UI | **parcial** | Resolvido o raw usage: `ProviderEvent::UsageRaw` com allowlist ≤4 KB (`providers/mod.rs:309-315,646-663`; `providers/cache.rs:845-893`), harness preenche/persiste `CacheSample.raw_usage` (`harness/cache/mod.rs:197-208,315`; teste `harness/mod.rs:10351-10412`), e o chip copia (`CacheHitChip.tsx:255-260,348-358`). `get_cache_stats` enriquece `ttl_seconds`/`min_cacheable_tokens`/`savings_usd` via capabilities/cost (`commands/cache.rs:84-101,130-201`). Resta: **o enriquecimento só ocorre no `get_cache_stats`**; o evento por request (`cache_stats`) não carrega TTL/savings e `syncCacheStats` é chamado só ao abrir a conversa (`chatStore.ts:741,766`). Em conversa nova, no primeiro turno o popover mostra TTL `—` e esconde economia até reabrir a conversa (o `cacheStore` só preserva valores prévios, `cacheStore.ts:84-91`). **Menor correção:** enriquecer o `CacheStats` do evento (ou chamar `syncCacheStats` ao fim do turno) e ajustar o claim do EVIDENCE. |
| **B3** — imagem/anexo/replay | **resolvido** | `harness/render.rs` congela `image`/`attachment`/`replay` na primeira inclusão (`render.rs:1-13,151,312,411`), o replay usa `frozen_image_inclusions`/`frozen_include_attachments`/`frozen_replay_mode` (`harness/mod.rs:3015,3033,3141`), `image_enabled_messages` foi removido e há testes de budget de imagem entre turnos + restart (`render.rs:312-454`). `EVIDENCE.md:235` está de acordo. |

### Extras verificados

- `/compact` manual usa `summarize_manual_for_conversation` (comando `commands/code.rs:880-965`; teste de projeção `context/compacted`), como o EVIDENCE afirma.
- Poda de tool results continua congelada em `render_decisions` (`compaction.rs:49-50`).
- Probes atualizados: gateway `openai-responses` reporta write/read 1113 (`evidence/probe-gateway-responses-live.json`), `google` 400 “Model is unavailable” (`probe-gateway-google-live.json`), `opencode-go` sincronizado com `mode: explicit/source: probe` (`probe-opencode-go-live.json`).
- `vitest.config.ts` tem `testTimeout: 15_000`/`hookTimeout: 15_000`, e a suíte isolada passou 2216/2216; a reexecução concorrente com cargo/live ainda pode flakear, mas com os timeouts atuais o gate fica mais estável.

### Achados major remanescentes (não bloqueiam o código)

1. **p50/p10 não implementado.** Conforme B1: `bench-fixture.json` declara 5 repetições e p50/p10, mas `bench.rs` só calcula média/mínimo; a afirmação “p50/p10 ficam no sintético” (`EVIDENCE.md:147-148,233`) não tem suporte. Correção: implementar amostragem/repetição e percentis, ou declarar mean como exceção.
2. **Gate live abaixo da meta.** O teste E2E tem `TARGET_STEADY_HIT=95` e `HARD_FLOOR_STEADY_HIT=90` (`bench.rs:29-31`) enquanto §2.4 exige ≥98%; uma regressão para 96% passaria no gate. O valor atual (99,7/100) cumpre a meta, mas o gate não a protege. Alinhar o floor a 98% ou documentar explicitamente que o gate live é observacional.
3. **Baseline F0a e matriz desatualizados.** `EVIDENCE.md:55` continua “a preencher na F0a.4”; `EVIDENCE.md:164` mantém o provider-level 98,48% na linha “Chat/Code (harness completo)”, enquanto §1.4 tem o E2E 99,7%. O baseline 0,0 do E2E é uma ablação válida, mas o baseline histórico F0a não está registrado.
4. **Contagens/claims de gate defasados.** EVIDENCE registra 919/12 e `cache_bench` antigo; o real é 937/13 e o novo teste live; `warnings do harness 10→0` (`EVIDENCE.md:46,253`) não confere com os 72 warnings do `cargo build`/52 do `cargo test` (incluindo `render.rs:295` unused import). Atualizar a §5/§6.
5. **Artifact dinâmico.** O teste live regrava `bench-e2e-live-2026-10-29.json` em cada execução; minha execução substituiu o 99,7% do Lead por 100,0% (min 99,97). O EVIDENCE deve citar a execução ou o artefato deve ser imutável por run, para não haver divergência.
6. **Fixture E2E.** `bench-fixture.json` declara `e2e.turns:10` mas contém 12 turnos; o teste usa o array (12). Corrigir o campo para 12.
7. **Skip-as-pass.** Sem credencial/fixture, `cache_bench_e2e_live` imprime skip e retorna `Ok`; o gate passaria sem prova. Isso é aceitável se o runner validar o artefato/`cache_bench` de outra forma, mas deve ser declarado no EVIDENCE.

### Exceções aceitas nesta rodada

- **N=5/p50/p10 live não executados**: uma execução E2E (custo/latência) + bench sintético; aceito **somente** se o usuário aceitar mean/uma execução como evidência e o EVIDENCE for corrigido (p50/p10 não existem no sintético hoje).
- **OpenAI direto / Anthropic direto sem credencial**: não provados, mantidos como exceção (como na rodada 1).
- **Gateway `openai-chat` sem reporte**: read/write=0 no probe; aceito como “não reportado”.
- **Gateway `google` indisponível (400)** e **OpenAI OAuth expirado**: exceções de campo documentadas.
- **Verificação manual no app empacotado não executada**: declarada no EVIDENCE §6 (`EVIDENCE.md:236`); aceita como pendência não bloqueante, mas o alvo visual manual continua não evidado.

Não aceito como exceção: p50/p10 declarado no sintético sem implementação; gate live com floor 95/90 abaixo da meta; baseline F0a ausente; matriz/contagens desatualizadas. São correções de evidência/documentação, não reabrem a arquitetura.

### Recomendação de gate: GO condicionado

- **GO** para a implementação: B1/B2/B3 tiveram seus pontos centrais corrigidos, os gates compilam/passam e o E2E live `run_turn` prova 99,7/100% contra baseline 0,0.
- **Antes de publicar o EVIDENCE final**, fechar as 7 correções acima (principalmente p50/p10/mean, floor 98, baseline/matriz/contagens e a divergência do artefato). Não é necessário outro PLAN-FIX arquitetural; a rodada resta `complete with documented exceptions` se o usuário aceitar o escopo N=5/p50/p10 reduzido e a verificação visual manual pendente.
