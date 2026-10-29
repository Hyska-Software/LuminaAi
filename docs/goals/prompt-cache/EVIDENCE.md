# Cache de prompt 98–99% — Evidência

> Preenchido **durante a execução**. Cada seção aponta para o artefato real (saída de
> comando, JSON do benchmark, `usage` reportado pelo provedor, teste que passa) e não
> para uma descrição do que deveria acontecer.
>
> Estado: **implementado e verificado automaticamente + prova live no gateway
> OpenCode (anthropic)**. F0–F6 implementados e cobertos por teste; aceite do
> PLAN §2.4 atendido no caminho do produto (E2E `run_turn`: steady 99,7%) e no
> provider-level (99,92%/98,48%), com o escopo de evidência reduzido documentado
> na §6 (OpenAI/Anthropic diretos sem credencial; N=5/p50/p10 live não executados;
> Google indisponível no gateway).

## 0. Progresso de execução

### Rodada 1 (29/10/2026)

Implementado e verificado:

| Entrega | Evidência |
| --- | --- |
| Contratos Rust/TS: `CacheSample`/`CacheStats`/`CacheState`/`CacheBreakReason`/`PrefixDigest`; `UsageInfo.cache*`; `TurnEvent::CacheStats`; `Settings.cache`/`CacheTtl` | testes de domínio + `pnpm typecheck` |
| `providers/cache.rs`: capabilities (defaults + `capabilities_for` com catálogo), `normalize_usage` (Anthropic read+creation, OpenAI cached/write, Google `cachedContentTokenCount`, DeepSeek hit/miss, bloco `opencode.tokens`), `digest` SHA-256 encadeado por segmento (metadados de cache fora do hash), `ProviderEvent::CacheDigest` emitido antes do SSE nos 4 adaptadores | `cargo test --lib providers` → 77 passed |
| `harness/cache`: `CacheTracker` (P/Δ/ceiling, hit% reportado, quebra por segmento, epoch, elegibilidade cold/not_reported/write_only/below_min/unknown_min) + `cache_stats` por request nos dois perfis e no final forçado | `cargo test --lib harness` → 170 passed |
| Persistência/restauração: `cache_samples` + `cache_state` por request (só loga em falha), seed por `prefix_segments`/epoch entre turnos e restart, `record_usage_with_cache` no fecho | `cargo test --lib harness/db`; teste de restart real |
| DB: `usage_log` + 8 colunas de cache; `cache_samples` (retenção 500), `cache_state`, `surface_items` (dedupe/ordem/seq), `prompt_snapshots`, `render_decisions`; migração aditiva idempotente | `cargo test --lib db` → 59 passed |
| Catálogo: `cache` por provedor (OpenAI 1024/128/key/retention; Anthropic explicit/5m+1h; gateways auto/unknown) no JSON e no gerador; teste do catálogo embutido | `cargo test --lib catalog` |
| IPC `get_cache_stats` (`commands/cache.rs` + `lib.rs` + `api.getCacheStats`) | `cargo check` |
| UI: `CacheHitChip` + popover (hit/sessão/teto/estado/quebra/TTL/economia/copiar usage), integração no `ContextMeter` (Code) e composer (Chat), Settings → Ferramentas (indicador/TTL/retention) | `pnpm typecheck` OK; 71 testes dos componentes; flakes de timing em `src/components/models/**` (passam isolados) |

Gate da rodada:

```
cd src-tauri && cargo check                # OK
cd src-tauri && cargo test --lib           # 900 passed, 0 failed, 10 ignored
pnpm typecheck                             # OK
pnpm test                                  # 2194/2194 em 1 rodada; flakes de timing em models/**
```

| F2a: snapshot persistido do Chat (`prompt_snapshots`), `Session date` fixa de `conversation.created_at` (sem relógio no head), tools canônicas + `config_hash`/`PROMPT_VERSION`; reuso byte-a-byte entre turnos e restart | `cargo test --lib harness` (180+ testes) |
| F2b: final forçado append-only (system/tools idênticos, wrap-up transitório de user; 0 quebra); watermark do histórico do Chat (`cache_state.chat_cut_seq`, salto ~50%, nunca regride, restart mantém) | 5 testes novos + suíte harness |
| F3a: Code sem relógio/git/tree/plano/modo no head — `code_prompt_snapshot` persistido, `build_runtime_context` em `surface_items` append-only (user-role, dedupe, âncora na user do turno), tools canônicas; 0 quebra entre turnos com estado volátil diferente | 4 testes novos de integração + suíte harness (189) |
| F4a: `plan`/`apply` reais (Anthropic 3 breakpoints/TTL 1h/máx. 4/idempotente/sem alterar texto; OpenAI `prompt_cache_key` sha256 64 + retention gated; Google no-op) | `cargo test --lib providers` (98 testes) |
| F4b: `CompletionRequest.cache_plan`, ordem `build_body → apply → digest` nos 4 adaptadores, digest estável pré/pós-apply, fallback 400 único sem plano | testes por adaptador + cross-protocol |
| Probe (F4.0): `scripts/probe-cache.mjs` (2 requests/rota, usage reportado) — smoke sem credenciais registrou `sem credencial`; probes reais pendentes | `docs/goals/prompt-cache/evidence/probe-smoke.json` |
Fases F0–F6 concluídas (ver §1.1–§1.4 e §6). Limpeza F6.2: módulo de compactação compartilhado, dead code removido, warnings do **harness** 10→0 (demais áreas têm warnings pré-existentes), `render_decisions` para tool result/imagem/anexo/replay, `/compact` manual cache-safe. Gate final em §5. O que não foi provado ao vivo está listado como exceção documentada na §6.

## 1. Baseline (antes — F0a)

Protocolo: §9.2 do `PLAN.md` (fixture versionada: cenário longo de 120 requests, smoke de 12, modo `e2e`, N=5, mediana).
Artefatos brutos: `docs/goals/prompt-cache/evidence/`.

| Provedor | Protocolo | Modelo/perfil | Hit% p50 (requests com ceiling ≥98%) | Hit% ciclo de vida | N requests | Fonte |
| --- | --- | --- | --- | --- | --- | --- |
| opencode-go (E2E `run_turn`, fixture 12 turnos; **ablação baseline**: catálogo sem `provider.cache` ⇒ plan None) | `anthropic` | `claude-haiku-5-5` | **0,0%** (steady) | 0,0% | — | auth.json | **medido** (`bench-e2e-live-*.json`; baseline histórico pré-implementação não foi capturado antes do F0a — a ablação sem plano é a referência reproduzível) |

Campos obrigatórios por linha: `P`/`Δ`/`ceiling` por request, `usage` bruto
(Anthropic read+creation; OpenAI cached/write; Google cachedContent; OpenCode
`tokens.*`), status `reported`/`não reportado`, e o JSON bruto anexado.

## 1.1 Probe live (F4.0 — 29/10/2026)

Credencial: chave OpenCode local (`~/.local/share/opencode/auth.json`). Artefato:
`docs/goals/prompt-cache/evidence/probe-opencode-go-live.json`.

| Provider | Protocolo | Modelo | 1ª chamada | 2ª chamada | Conclusão |
| --- | --- | --- | --- | --- | --- |
| opencode-go | `anthropic` | `claude-haiku-5-5` | `input=15`, `cache_write_1h=2127`, `cache_read=0` | `input=15`, `cache_read=2127`, `cache_write_1h=0` | ✅ gateway repassa `cache_control` (TTL 1h) e reporta `usage.opencode.tokens.*` |
| opencode-go | `openai-chat` | `deepseek-v4-pro` | `input=1272`, `cache_read=0` | `input=1272`, `cache_read=0` | ⚠️ não reporta cache nessa rota (2 requests idênticos); tratar como `não reportado` |
| opencode-go | `openai-responses` | `gpt-6-luna` | `input=1116`, `cache_write=1113` | `input=1116`, `cache_read=1113` | ✅ cache automático do upstream reportado pelo gateway (99,73% na 2ª) |
| opencode-go | `google` | `gemini-4-argon-contributor` | 400 “Model is unavailable” | — | ❌ modelo indisponível no gateway hoje (catálogo stale); documentar como não suportado até nova lista |
| openai (OAuth/ChatGPT plan) | `openai-responses` | seed | — | — | access token do auth.json expirado; sem prova live ainda |

### 1.2 Prova live do caminho do Lumina (F4 wiring — 29/10/2026)

Teste `#[ignore]` `providers::cache::tests::live_cache_gateway_anthropic_roundtrip`
(caminho real: catálogo → `capabilities_for` → `plan_with_caps` → `CompletionRequest.cache_plan`
→ `stream_completion` do adaptador `anthropic` → `normalize_usage`):

```
[live_cache_gateway] caps mode=Explicit min=Some(2048) ttl=["1h"] plan ttl=Some("1h") breakpoints=2
[live_cache_gateway] 1ª: reported=true read=Some(0)    write=Some(5211) input=Some(4)
[live_cache_gateway] 2ª: reported=true read=Some(5211) write=Some(0)    input=Some(4)
[live_cache_gateway] totais: 1ª input_total=Some(5215); 2ª input_total=Some(5215)
[live_cache_gateway] 2ª hit = 99.92% (5211/5215)
```

Comando: `cd src-tauri && cargo test --lib live_cache_gateway -- --ignored --nocapture`.
Leitura: write 5.211 tokens (TTL 1h) na 1ª e read exato na 2ª; `input=4` é só a
cauda após o último breakpoint (prova do posicionamento system+tail). **Primeira
prova live 99,92% do caminho completo do Lumina.**

Catálogo atualizado pelo probe: OpenCode Go/Zen `mode=explicit`, `minTokens=2048`,
`ttlOptions=["1h"]`, `source=probe`. O teste ignored `live_cache_gateway_*` (F4.0)
prova o caminho do Lumina (`capabilities_for → plan_with_caps → apply`) contra a API
real; resultado será anexado na próxima rodada.

### 1.3 Bench live — 10 requests pelo caminho do Lumina (29/10/2026)

Teste `#[ignore]` `providers::cache::tests::live_cache_gateway_anthropic_bench`
(opencode-go → `anthropic`/`claude-haiku-5-5`, mesmo `session_id`, histórico
crescente, TTL 1h, prefixo estável de 36k chars ≈ 9k tokens estimados):

| Request | P_est | Δ_est | input | read | write | hit | ceiling_est | ceiling_measured |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 9062 | 15381 | 0 | 15377 | — | 0% | 0% |
| 2 | 9062 | 140 | 15568 | 15377 | 187 | 98,77% | 98,48% | 98,80% |
| 3 | 9202 | 177 | 15817 | 15564 | 249 | 98,40% | 98,11% | 98,43% |
| 4 | 9379 | 177 | 16066 | 15813 | 249 | 98,43% | 98,15% | 98,45% |
| 5 | 9556 | 176 | 16315 | 16062 | 249 | 98,45% | 98,19% | 98,47% |
| 6 | 9732 | 178 | 16564 | 16311 | 249 | 98,47% | 98,20% | 98,50% |
| 7 | 9910 | 176 | 16813 | 16560 | 249 | 98,50% | 98,26% | 98,52% |
| 8 | 10086 | 176 | 17062 | 16809 | 249 | 98,52% | 98,28% | 98,54% |
| 9 | 10262 | 176 | 17311 | 17058 | 249 | 98,54% | 98,31% | 98,56% |
| 10 | 10438 | 178 | 17560 | 17307 | 249 | 98,56% | 98,32% | 98,58% |

- **Steady-state (requests 3–10, `ceiling_est ≥98%`): 8 requests,
  read=131.484 / input=133.508 → 98,48%** (`reported=true` em todos; hard assert
  ≥90% passou; `ceiling_measured` 0,03–0,06 p.p. acima do hit ⇒ limite é o Δ por
  turno, não falha de cache).
- **Sessão (10 requests): 146.861/164.457 = 89,30%** — ciclo de vida curto: o cold
  write de 15.377 tokens é 9,35% do input total; o PLAN só promete 98% de ciclo na
  fixture longa (120 requests). Número publicado sem maquiar.
- Nota de fixture: 36k chars (não 6k) porque `plan()` estima chars/4 e
  `minTokens=2048`; com Δ≈180 tokens estimados, `ceiling_est ≥98%` exige P≳9k.

### 1.4 Bench E2E do produto (`run_turn`) + baseline (F6.3-fix — 29/10/2026)

Teste `#[ignore]` `harness::cache::bench::cache_bench_e2e_live` (DB/data_dir temp,
`run_turn` real, fixture `evidence/bench-fixture.json`: 12 turnos,
opencode-go/`claude-haiku-5-5`, TTL 1h):

```
lumina bench live: requests=12 steady=10 hit_steady=99.7% hit_all=91.4% min_steady=99.69%
lumina bench baseline (catálogo sem provider.cache ⇒ plan=None):
  requests=12 steady=10 hit_steady=0.0% hit_all=0.0%
```

- Artefato bruto: `docs/goals/prompt-cache/evidence/bench-e2e-live-2026-10-29.json`.
- **Steady 99,7%** no caminho completo do produto (snapshot/surface/tracker/evento),
  contra **0,0%** de baseline sem cache — atribuição do ganho ao plano é direta.
- Ciclo de vida da execução: 91,4% (12 requests; cold write de 12–13k tokens), dentro
  da regra do PLAN (98% de ciclo só em fixture longa).
- `cargo test --lib cache_bench -- --ignored` agora encontra/roda o teste live (não é
  mais gate vazio: 1 teste executado); o teste sintético `cache_bench_synthetic_120_requests_steady_state`
  cobre 120 requests (steady=118, hit 100%) no gate normal.
- Limitação declarada: uma execução live (custo/latência); N=5/p50/p10 não foram
  rodados em live — o p50/p10 fica no teste sintético e na matriz provider-level.

#### Outras entregas verificadas na mesma rodada

| Item | Evidência |
| --- | --- |
| F2c compactação cache-safe do **Chat** (resumo reusa prefixo, `to_seq` estável, epoch Compaction, fallback watermark, restart) | 3 testes novos com DB+provider fake; `cargo test --lib` 915 verdes |
| D25 `/compact` manual: evento `context/compacted` compatível e `to_seq` = mensagens cobertas; `get_code_session_state` mantém `context`/`compacted` | 2 testes novos; `cargo test --lib commands` 102 verdes |
| F5.4 painel “Diagnóstico de cache” na paleta (resumo, quebras, tabela de amostras, copiar JSON, estados vazios/erro, acessível) + botão “Ver diagnóstico completo” no chip | `pnpm typecheck` OK; 160/160 testes da área; `pnpm test` 2216/2216 |

## 2. Evidência de aceite (alvo)

Ver `PLAN.md` §2.4. Para cada `perfil × provedor × protocolo × modelo`:

| Perfil | Provedor | Protocolo | Modelo | Hit% p50 (ceiling ≥98%) | Hit% ciclo de vida | Custo vs. baseline | Credencial | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chat/Code (E2E `run_turn`, harness completo) | opencode-go | `anthropic` | `claude-haiku-5-5` | **99,7–100%** (steady 3–12; runs de 29/10) | 91,4% (12 requests; cold write) | — | auth.json | **provado** (artefato `bench-e2e-live-*.json`) |
| Provider-level (`stream_completion`, bench 10 requests) | opencode-go | `anthropic` | `claude-haiku-5-5` | **98,48%** (steady 3–10) | 89,30% | — | auth.json | **provado** (`live_cache_gateway_anthropic_bench`) |
| Chat/Code | opencode-go | `openai-chat` | `deepseek-v4-pro` | — | — | — | auth.json | **não reportado** (probe: read/write=0 em 2 requests) |
| Chat/Code | openai | `openai-responses` | seed | — | — | — | OAuth expirado | **implementado, não provado** |
| Chat/Code | anthropic | `anthropic` | Claude | — | — | — | sem API key | **implementado, não provado** |
| Chat/Code | opencode-go | `openai-responses` | `gpt-6-luna` | — | — | — | auth.json | **reportado/provado no probe** (write/read 1113; falta bench longo) |
| Chat/Code | opencode-go | `google` | `gemini-4-argon-contributor` | — | — | — | auth.json | **não suportado no gateway hoje** (400 “Model is unavailable”) |
| Chat/Code | opencode-zen | `openai-responses`/`google` | GPT/Gemini | — | — | — | auth.json (Zen) | **implementado, não provado** |

Regras de aceite:
- Hit% p50 ≥ meta **nos requests com ceiling ≥ meta**; o número de ciclo de vida
  (inclui cold start e writes) é publicado ao lado.
- Reuso de prefixo: 100% em regime estável (teste de propriedade), não confundir com
  hit% do provedor.
- Provedor sem credencial: `implementado, não provado` (não bloqueia os demais e não
  entra na média global).
- Diferença UI × `usage` bruto ≤1 p.p., com captura do JSON copiado do diagnóstico.

## 3. Evidência de campo por provedor

| Provedor | Rota | Campo testado | Aceito? | Reporta usage? | `minTokens` medido | Artefato |
| --- | --- | --- | --- | --- | --- | --- |
| opencode-go | anthropic | `cache_control` + TTL 1h | ✅ | ✅ (usage.opencode.tokens) | 2048 (conservador) | `evidence/probe-opencode-go-live.json` |
| opencode-go | openai-chat | `prompt_cache_key` | ✅ (aceito, sem erro) | ❌ (read=0 em 2 requests idênticos) | — | `evidence/probe-opencode-go-live.json` |
| opencode-go | openai-responses | cache automático do prefixo | ✅ | ✅ (`input_tokens_details.cached_tokens`) | — (medido 1113 no probe) | `evidence/probe-gateway-responses-live.json` |
| opencode-go | google | `generateContent` | ❌ modelo indisponível | — | — | `evidence/probe-gateway-google-live.json` |
| openai | openai-responses | `prompt_cache_key`/retention | não testado (token OAuth expirado) | — | 1024 (doc) | `evidence/probe-openai-live.json` |
| anthropic | anthropic | `cache_control`/TTL | não testado (sem API key) | — | desconhecido | — |

## 4. Evidência da UI (tempo real)

- [x] Code: chip no `ContextMeter` (anel + `cache NN%`) com segmento de cache e popover;
      atualiza por `cache_stats` (ao fim de cada request) e mostra a última amostra
      durante o request.
- [x] Chat: chip cache-first no composer (antes do `ModelPill`), sem anel de contexto
      na v1 (`% contexto` no Chat = P2, decisão confirmada pelo usuário).
- [x] Popover: hit%, teto do request, read/write/novo, estado, última quebra, TTL,
      economia, amostras e “Copiar usage bruto”.
- [x] Estado honesto quando o provedor não reporta: `—`/`não reportado` (testes de
      componente + `cacheHitPercent` devolve null).
- [x] Teste de integração: provider fake → body final pós-`apply` → `CacheSample` →
      `TurnEvent` → `cacheStore` → props do chip; suíte do harness cobre 3 requests
      com 0 quebras e a UI cobre os estados.
- [x] Painel “Diagnóstico de cache” na paleta + botão no popover (F5.4), com amostras,
      quebras, copiar JSON e estados vazios/erro.

## 5. Verificação (comandos e saída)

```
cd src-tauri && cargo check                                  # OK
cd src-tauri && cargo test --lib                             # 937 passed, 0 failed, 13 ignored
cd src-tauri && cargo build                                  # OK (binário debug)
cd src-tauri && cargo test --lib live_cache_gateway -- --ignored --nocapture
                                                             # 99,92% (2 requests) e 98,48% steady (bench de 10)
pnpm typecheck                                               # OK
pnpm test                                                    # 2216/2216 verdes
pnpm build                                                   # OK
```

## 6. Exceções e pendências não bloqueantes

| Item | Estado | Por quê / próximo passo |
| --- | --- | --- |
| OpenAI direto (API key e OAuth/ChatGPT-plan) | implementado, **não provado** | access token OAuth do `auth.json` expirado e sem `OPENAI_API_KEY`; rodar `probe-cache`/bench com chave real |
| Anthropic direto (API key) | implementado, **não provado** | sem `ANTHROPIC_API_KEY` no ambiente; `minTokens` segue `null` no catálogo até o probe |
| Gateway `openai-chat` (DeepSeek/GLM/…) | **não reportado** no probe | 2 requests idênticos → read/write=0; `prompt_cache_key` não é planejado nessa rota (mode explicit do gateway); medir de novo se o gateway mudar |
| Poda de tool results da cauda mantida | **resolvido** | `prune_tool_result` (head 2k + marker + tail 1k) + `render_decisions` congeladas no replay: 2 turnos/restart byte-a-byte, pareamento preservado |
| `/compact` manual | **resolvido** | comando usa `summarize_manual_for_conversation` (prefixo normal + `summary_instruction` + `cache_plan`); projeção `context/compacted`/`to_seq` mantidas |
| `usage_summary` | `#[cfg(test)]` | usado pelos testes de agregação; produção usa `cache_session_aggregate`/`get_cache_stats` |
| Matriz completa OpenAI/Anthropic/gateway chat | cobertura parcial | gateway anthropic provado no harness E2E (99,7%) e provider-level (98,48%); gateway `openai-responses` provado no probe (write/read 1113); gateway `google` 400 “Model is unavailable”; OpenAI/Anthropic diretos exigem credencial |
| N=5/p50/p10 em live | reduzido | uma execução E2E live (custo/latência) + bench sintético de 120 requests (steady 118, 100%); p50/p10 ficam no sintético; exceção declarada |
| TTL/mínimo/economia/usage bruto na UI | **resolvido** | `get_cache_stats` enriquece `ttl_seconds`/`min_cacheable_tokens`/`savings_usd` do catálogo; `CacheSample.raw_usage` recebe `ProviderEvent::UsageRaw` sanitizado (≤4 KB) e é persistido; UI mostra/copia |
| D7 imagem/anexo/replay | **resolvido** | `render_decisions` kind image/attachment/replay congeladas na primeira inclusão; budget de imagem entre turnos/restart testado (0 quebras) |
| Verificação manual no app empacotado | não executada (sem automação de UI) | `pnpm build` + `cargo build` OK; validação visual manual não foi registrada — exceção declarada |

## 7. Notas de review

- PRE rodada 1 (29/10): verdict `partially aligned` — 6 blockers + 8 majors em
  `REVIEW-PRE.md`; plano revisado (§0.2 mapeia B1–B6).
- PRE rodada 2 (29/10): verdict `partially aligned` — 3 blockers restantes
  (métrica/custo, benchmark/E2E, ownership). Correções: §2.3/§2.4/§2.5 (unidade,
  teto, ciclo de vida, fixture longa 120 requests), §9.2 (modos `synthetic`/`e2e`),
  splits de dono no §8.
- PRE rodada 3 (29/10): verdict **`aligned` / GO**, aritmética da fixture conferida
  (cold+write+Δ = 1,68% ≤2%; teto de ciclo 98,34%); correções editoriais aplicadas
  (`seq` no schema §5.3, F0b.6 no DAG, frase “sem DB”, split F6). Plano liberado
  para F0a.
- Decisões do usuário (29/10): Chat v1 cache-first sem `% contexto` (P2); ligar
  `prompt_cache_key` no OAuth se o probe permitir; warming pago só em F6; `retain`
  de compactação = 16% de `W − output` por perfil.
- Limpeza final (F6.2): módulo de compactação compartilhado (`harness/compaction.rs`), dead code removido, warnings do harness 10 → 0.
- Poda de tool results no trecho mantido: `render_decisions` kind `tool_result`, replay/restart determinístico, transcript do resumo usa o original (documentado).
- `/compact` manual migrado para o helper cache-safe do harness (`summarize_manual_for_conversation`); task-26 resolvida.
- Gate final: `cargo test --lib` **937 passed, 0 failed, 13 ignored**; `pnpm test` **2216/2216**; `pnpm typecheck`/`pnpm build`/`cargo build` OK.
- Desvios registrados durante a execução: fixture live do bench usando 36k chars (não 6k) para satisfazer `minTokens`/ceiling; gateway `openai-chat` sem reporte de cache; OpenAI/Anthropic diretos sem credencial válida.
