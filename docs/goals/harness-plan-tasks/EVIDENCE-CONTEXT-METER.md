# EVIDENCE — contexto em tempo real (ContextMeter + breakdown)

- **Data:** 28/10/2026, ~14:25–14:35 (America/Sao_Paulo)
- **Repo:** `H:\ChatTauri`, branch `feat/code-harness`, **HEAD `317e299`** (a feature está **não commitada**, somada à rodada anterior na mesma working tree; `git diff --stat` atual: **45 arquivos, +4697/−753**).
- **Escopo:** verificação independente da feature "contexto em tempo real" (task-8 backend + task-9 frontend). Somente leitura de código/comandos; único arquivo escrito é este.
- **Arquivos da feature (verificados):** `src-tauri/src/domain.rs` (`ContextBreakdown`, `ContextStats.breakdown/compacted/messages`), `harness/code/session.rs` (`estimate_context`, `calibrate_context`, `compacted_messages`, `KIND_CONTEXT_COMPACTED`), `harness/code/compaction.rs` (`record_compaction`, sem gravar `context/stats` parcial), `harness/mod.rs` (4 pontos de emissão), `commands/code.rs` (projeção), `src/lib/types.ts`, `src/lib/store/codeStore.ts`, `src/components/agent/ContextMeter.{tsx,test.tsx}`, `src/components/code/{CodeAgentWidgets,CodeSessionHeader}.tsx`, `src/styles/globals.css`, docs `HARNESS.md §10.1`, `WORKBENCH.md §4`, `DESIGN.md`.

## 1. Comandos no estado final

| Comando | Status | Tempo | Números / observação |
| --- | --- | --- | --- |
| `cargo check` | **OK** (exit 0) | 0,79 s incremental (cache quente do agente) | **0 erros**; **75 warnings** (mesma contagem da rodada anterior — nenhum warning novo). |
| `cargo test --lib` | **OK** (exit 0) | 15,17 s de testes (compile 1,19 s) | **765 testes: 755 passed, 0 failed, 10 ignored** (+5 vs 760). |
| `pnpm typecheck` | **OK** (exit 0) | 4,51 s | `tsc --noEmit` sem erros. |
| `pnpm test` | **FALHA** (exit 1) — flake de carga | 118,70 s | **109 arquivos / 2029 testes: 2028 passed, 1 failed** — única falha em `ModelPickerDialog.edge.test.tsx > catálogo Zen completo: 82 modelos e busca de 1 letra com contagem/ids coerentes`. `ContextMeter.test.tsx` **15/15**; `ChatView` 14/14; `CodeSessionHeader` 38/38. |
| Re-run isolado dos flaky (`ModelPickerDialog.{edge,auth}` + `LibraryView`) | **OK** (exit 0) | 14,06 s (testes 13,02 s) | **65/65 passed** ⇒ falha da suíte é **flake de carga** já conhecido, não regressão da feature. |
| `pnpm build` | **OK** (exit 0) | 20,16 s (vite 11,07 s) | `tsc --noEmit && vite build`; 0 erros; só avisos pré-existentes de chunk. |

**Rust `#[ignore]` (10, inalterados):** 8 smoke de provider (credenciais/rede), `fetch_url`/`web_search` live.

**Delta de testes:** Rust 760 → **765** (`estimate_context_...`, `calibrate_context_...`, `compacted_messages_fold_and_old_stats_still_deserialize`, `compaction_event_feeds_the_meter_projection_without_poisoning_stats`, E2E `context_meter_calibrates_in_real_time_with_provider_usage`). TS 2021 → **2029** (`ContextMeter.test` 7 → 15; nenhum teste removido sem substituto — os 6 antigos foram absorvidos: percentual/tokens/faixa/clamp/nota de compactação seguem cobertos na suíte nova).

## 2. Matriz critério → evidência

| # | Critério da task | Evidência | Status |
| --- | --- | --- | --- |
| a | Breakdown (`systemPrompt`/`toolDefinitions`/`messages`) soma ≈ `used` e `percent` acompanha | `session.rs::estimate_context_sums_the_breakdown_and_clamps_percent` (valores exatos 1000/500/2064, soma = `used` 3564, percent 3,564 e saturação em 100/0); `session.rs::calibrate_context_uses_the_real_input_and_keeps_the_sum` (usado real 50 000 e 500; soma exata; residual em mensagens); E2E `context_meter_calibrates_in_real_time_with_provider_usage` (soma do breakdown == 9 000); `ContextMeter.test.tsx` (“barra segmentada … proporção da janela”, legenda 3 valores). | **PASSA** |
| b | Payload antigo sem breakdown desserializa e o card degrada | Backend: `ContextBreakdown`/`ContextStats` com `#[serde(default)]` (`domain.rs:1305-1336`); teste `compacted_messages_fold_and_old_stats_still_deserialize` faz parse de JSON legado sem `breakdown` e assere `ContextBreakdown::default()`. UI: `types.ts` `breakdown?`; `ContextMeter` cai em barra única accent + linha “Mensagens” quando ausente (teste `degrada para barra única + linha Mensagens quando falta breakdown`). | **PASSA** |
| c | `context_stats` em ≥2 pontos do turno, calibrado por `usage.input_tokens`, último persistido == último emitido | Pontos de emissão no código: início (`harness/mod.rs:1095-1110`), antes de cada request (`:1211-1231`), após cada passo com usage real (`:1305-1327`, `calibrate_context`), fecho (`:1717-1734`); `emit_context_stats` persiste (`save_context_stats`) **antes** de emitir (`:748-764`). E2E `context_meter_calibrates_in_real_time_with_provider_usage`: exige ≥2 eventos, último antes de `done`, evento com `used == 9 000` (input real) e breakdown somando 9 000, e compara **último emitido == último persistido** (JSON a JSON) + invariante da soma. | **PASSA** |
| d | `context/compacted` não envenena a projeção e `compacted` aparece no stats | `compaction.rs` registra em `context/compacted` (`record_compaction`, `{messages, tokensFreed}`) e **não grava mais** `context/stats` parcial (busca no arquivo: nenhum `CONTEXT_STATS`); `session::compacted_messages` lê só `context/compacted`; testes `compaction_event_feeds_the_meter_projection_without_poisoning_stats` (`context_stats` continua `None`) e `compacted_messages_fold_and_old_stats_still_deserialize` (fold 12, stats `None`). `compacted` chega ao UI via `ContextStats.compacted` (projeção `context/compacted` → `estimate_context(compacted)`) e a nota “Contexto compactado · N mensagens resumidas” (testes de `ContextMeter` com `stats.compacted` e prop `compacted`). | **PASSA** (com achado 1) |
| e | UI: chip anel+percentual; popover `X% do contexto usado` + `~usado / janela`; barra segmentada 3 cores/tokens; legenda 3 linhas; limite de saída; compacted; fallback; a11y (`aria-label`/`progressbar`/`role=dialog`/foco); rerender em tempo real | `ContextMeter.test.tsx` 15 testes: chip (anel 2 `circle`, `aria-label="Contexto usado: 44%"`, `h-8`/`tabular-nums`), popover (`role=dialog` + `aria-label`, `aria-expanded`), header/valores, barra (`role=progressbar` com `aria-valuenow/min/max/valuetext/title`, 3 filhos com `bg-context-system/tools/messages` e larguras 10%/4,1%/30%), legenda ordenada, clamp >100/<0, faixas 70/90 com `text-warning`/`text-danger`, nota `role=status`, fallback, **rerender com novos stats mantendo o popover aberto**, foco no trigger + lista textual (não só cor) + anel decorativo. Cores só por tokens: `globals.css` define `--context-system/tools/messages` em light/dark e mapeia em `@theme` (`--color-context-*`); nenhum hex novo em componentes (varredura do diff: 0). | **PASSA** |
| f | Cadência não gera loop de render no codeStore nem inunda além de ~2 eventos/passo | Cadência: 2 eventos por passo (pré-request + calibrado) + 1 no início + 1 no fecho; para turno de 1 passo = 4 eventos (~2/passo + bordas). `codeStore` `context_stats` apenas substitui `context` (`codeStore.ts:144-145`); não há efeito/estado derivado de `context` que faça write-back — consumidores selecionam slices primitivos (`ChatView`: `pendingGateCount`/`planUpdatedAt`) ou o objeto `context` só no `CodeContextMeterChip`; efeito de auto-scroll do `ChatView` não depende de `context`. Suíte completa e isolada passam sem “Maximum update depth”/loop; `ContextMeter` é puro (sem `useState`) e o teste de rerender confirma atualização in-place. | **PASSA** (com achado 2) |

## 3. Revisão adversarial

- **Diff/artefatos:** `git diff --check` **limpo** (exit 0); `git status` apenas com as 45 modificações esperadas + untracked esperados (`docs/goals/harness-plan-tasks/`, `CodeSessionCards.test.tsx`, `codeStore.actions.test.ts` — nenhum log/patch/build dentro do repo; `dist/` gitignored). Nenhum commit.
- **Sem regressão no header/Code layout:** `CodeSessionHeader.tsx` monta `<CodeContextMeterChip />` (`hidden lg:block`, sem `min-w-32` agora); `CodeSessionHeader.test` 38/38 e `ChatView` 14/14 verdes; os cards do harness/plano/tarefas seguem passando.
- **Sem `hex` solto, `any`, `@ts-ignore`, `@ts-expect-error`, `.only`/`.skip`** novos em TS; tokens CSS novos somente em `globals.css` (camada de tema, permitida).
- **Rust:** nenhum `unwrap()/expect()` novo fora de `#[cfg(test)]` nos arquivos da feature (varredura do diff em `session.rs`/`harness/mod.rs`/`compaction.rs`/`domain.rs`); uso de `u32::try_from(...).unwrap_or(...)`/`saturating_*` nos caminhos de dados. `estimate_context`/`calibrate_context` sem panic.
- **Chat e subagentes:** todas as emissões/persistências de `context_stats` estão dentro de blocos `profile == TurnProfile::Code` (`harness/mod.rs:1100, 1215, 1314, 1718`) ⇒ turno Chat não emite medidor. Subagente real usa `DiscardEmitter` (`subagent.rs:126-130, 195`) e roda em conversa-filha efêmera deletada ao final (`:199`) ⇒ não vaza evento nem projeção para a sessão pai (verificado por inspeção; ver achado 4).
- **Turno sem workspace:** o E2E do medidor (`context_meter_calibrates_in_real_time_with_provider_usage`) roda um turno Code **sem workspace** e passa — o cálculo/emissão não depende de workspace; nenhum `unwrap` no caminho.
- **Testes não afrouxados:** `ContextMeter.test` 7→15 (superset: percentual/tokens/faixas/clamp/nota antigos continuam cobertos); `session::context_stats_roundtrip` foi **fortalecido** (agora assere `breakdown` igual ao salvo) e ganhou os 3 testes de breakdown/calibração/compacted; `compaction` +1 teste. Nenhum teste removido sem substituto.

### Achados (por gravidade)

1. **[Baixo — semântica transitória] `codeStore` ainda trata `compacted` como contador de compactações.** `codeStore.ts:146-156` faz `compacted: (state.context.compacted ?? 0) + 1` e ignora `event.messages` (o `TurnEvent::Compacted` carrega `messages`, `events.rs:116-120`; o teste `codeStore.test.ts:99-102` fixa `compacted === 1`). Como o novo `ContextStats.compacted` significa **mensagens resumidas** e a UI rotula “N mensagens resumidas”, entre o evento `compacted` e o próximo `context_stats` (que chega no pre-request do passo seguinte, logo depois) a nota pode exibir “1 mensagem resumida” em vez do total real. Correção barata: usar `event.messages` (ou não mexer em `compacted` no reducer, já que o stats seguinte traz o valor canônico).
2. **[Informativo — cadência] O início do turno emite dois `context_stats` quase idênticos em sequência** (início do turno em `harness/mod.rs:1102-1109` e pré-request do passo 1 em `:1216-1230`, sem `await` entre eles quando `auto_compact` está desligado). É o que a especificação pede (“início” e “antes de cada passo”), mas gera evento/persistência duplicados e contradiz levemente o texto “cadência natural … ≤ 1/s” do `HARNESS §10.1` (os dois primeiros são no mesmo tick). Sem impacto funcional (turno de 1 passo = 4 eventos).
3. **[Baixo — caminho de falha] Persistência do medidor é best-effort.** `emit_context_stats` (`harness/mod.rs:760-763`) loga `eprintln` e **emite mesmo se o `save_context_stats` falhar**; o critério “último persistido == último emitido” está garantido só no caminho de sucesso (é o que o E2E cobre). Em falha de DB, o medidor da UI continua vivo, mas reabrir a sessão mostra o snapshot anterior — trade-off intencional, documentar.
4. **[Cobertura] Faltas de teste pontuais:** (i) nenhum teste assere que um **turno Chat** produz **zero** `context_stats` (garantido por inspeção dos guards `profile == Code`); (ii) o runner real de **subagente** não é exercitado em E2E com medição (os testes usam `FakeRunner`); o isolamento está garantido por `DiscardEmitter` + conversa-filha deletada, por inspeção.
5. **[Informativo — estimativa] Breakdown é heurístico (`chars/4` + overhead 8/16)** e **imagens não entram** no cálculo (documentado em `HARNESS §10.1`); a calibração por `usage.input_tokens` só ocorre quando o provider reporta usage — sem uso real, a UI permanece na estimativa com “≈”, que é o contrato. Sem teste de modelo com imagem (não há breakdown para imagens por decisão documentada).

## 4. Riscos residuais

1. **Flake de carga na suíte TS:** 1 falha em `ModelPickerDialog.edge` nesta execução (já conhecido auth/edge; `LibraryView` já flocou em rodada anterior); isolados 65/65 em 13 s. Reexecutar isolado antes de classificar regressão.
2. **Reducer `compacted`** (achado 1) pode mostrar contagem errada por um intervalo curto após compactar — cosmético, mas é a única inconsistência real encontrada.
3. **Custo de rerender por evento:** `CodeContextMeterChip` (objeto `context`) e `CodeSessionCards` (objeto de sessão) rerenderizam a cada `context_stats` (≤2/passo). Sem loop e barato, mas é o consumo esperado do “tempo real”.
4. **Contraste AA das 3 cores** é verificado só por tokens (`globals.css` light/dark); não há teste automatizado de contraste (limitação da infra de teste, não da feature).
5. **Persistência best-effort** (achado 3): snapshot salvo pode ficar atrás do emitido em falha de DB; sem teste de injeção de falha.

## 5. Itens não atendidos

Nenhum critério funcional da task ficou sem atendimento. Os itens abertos são **lacunas de teste/observações**: achado 1 (correção semântica barata recomendada), achado 2 (duplicidade no início, documentar ou coalescer), achado 3 (best-effort documentar), achado 4 (testes de Chat=0 eventos e de subagente real).

**Conclusão:** a feature cumpre o contrato verificado — breakdown somando `used`, calibração pelo `usage.input_tokens`, emissão em início/passo/fecho com projeção consistente, `context/compacted` separado, e UI com chip+popover segmentado, legenda, fallback, a11y e rerender em tempo real. `cargo check`/`cargo test --lib`/`typecheck`/`build` verdes; suíte TS limpa fora do flake de carga documentado. **Nada bloqueia commit**, mas o achado 1 merece correção de 1 linha antes do commit final.

## Adendo do Lead (correções pós-QA)

- **Achado 1 corrigido.** `src/lib/store/codeStore.ts` (`case 'compacted'`) agora grava
  `compacted: event.messages` (total de mensagens resumidas) em vez de `+1`; o próximo
  `context_stats` continua sendo a fonte canônica. Teste `codeStore.test.ts` atualizado (evento
  `messages: 20` ⇒ `compacted === 20`; depois stats `compacted: 25` ⇒ `25`).
- **Verificação final do Lead (após a correção):** `pnpm exec vitest run
  src/lib/store/__tests__/codeStore.test.ts src/components/agent/ContextMeter.test.tsx` ⇒ 22/22;
  `pnpm typecheck` OK; `pnpm test` ⇒ **109 arquivos / 2029 testes, todos verdes**; `pnpm build` OK;
  `git diff --check` limpo. Nenhum `cargo` novo foi necessário (backend inalterado desde a Fase 3).
- **Achado 2** (dois `context_stats` no início do turno) mantido como está: a duplicidade é
  inofensiva (um evento a mais num turno de 1 passo) e cobre explicitamente "início do turno" e
  "antes do request"; registrado como observação.
- **Achado 3** documentado em `HARNESS.md §10.1` (persistência do medidor é best-effort; o evento
  ainda chega à UI e o snapshot fica no último valor persistido com sucesso).
- **Achados 4 e 5** permanecem como lacunas informativas de cobertura/estimativa, sem impacto
  funcional.

