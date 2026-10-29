MODE: PRE
Verdict: partially aligned

# Revisão PRE — Cache de prompt 98–99% (Lumina)

- **Plano:** `docs/goals/prompt-cache/PLAN.md` — 1013 linhas, SHA-256
  `278DD4D4132F40418558113897127C217FC55D1D025F122FAC46B5A90104E566`
  (última leitura em 29/10/2026 10:49; o arquivo foi reescrito às 10:48 durante esta
  revisão — mudanças posteriores a esse hash exigem re-checagem de linhas, mas os
  achados estruturais foram revalidados nesta revisão).
- **Pedido original:** elevar o cache hit de prompt a 98–99% em todos os provedores,
  com pesquisa (OpenCode/DSH), plano completo e indicador de cache% em tempo real no
  medidor de contexto.
- **Outcome contract:** presente no cabeçalho (`PLAN.md:3-155`) e em §2/§4; é
  detalhado e, na maior parte, coerente.
- **Architecture slice:** presente (`PLAN.md:125-151`), mas com lacunas de persistência
  e de dono da verdade (B2/B4 abaixo).
- **Evidência de aceite exigida:** `PLAN.md:97-105` (teste + número real do provedor +
  UI coerente + EVIDENCE). Conceitualmente forte; operacionalmente incompleta (B6).
- **Não-objetivos:** `PLAN.md:267-276`.
- **Caminhos inseguros declarados:** “áreas de outro dono sem mensagem ao Lead”,
  `src/lib/genui/**`, `data/genui-*`, `src-tauri/target` (`PLAN.md:140-141`).
- **Método:** template `plan-reviewer-prompt.md` (MODE: PRE), leitura documental
  (PLAN, GOAL, EVIDENCE, três docs de pesquisa, AGENTS.md) e validação pontual no
  código (`db.rs`, `providers/mod.rs`, `harness/mod.rs`). Sem builds/testes, sem
  automação de UI, sem edição fora deste arquivo.

## Síntese do veredito

O plano é forte onde a maioria falha: diagnóstico com `arquivo:linha`, definição de
hit% por protocolo (que confere com a pesquisa), separação “medir → estabilizar →
ligar mecanismo → medir”, gates de evidência com número real, cutover e kill criteria
explícitos, e uma matriz por provedor que reconhece Gemini 4/OAuth/gateway como
exceções. Não está off-track. **Também não está pronto para GO:** a meta de 98–99%
não é mensurável como escrita, o prefixo append-only não fecha para conteúdo injetado
no meio do turno, dois contratos de persistência prometidos não existem, o dono/entrada
do digest é ambíguo, a ordem F3 antes de F4 contradiz a própria ordem obrigatória e a
evidência de campo não tem protocolo/credenciais definidos. São 6 blockers — nenhum
exige reescrever a direção, todos exigem fechar contrato antes de dispatch.

---

## Findings — ordenados por risco

### B1 — [blocker] A meta 98–99% não é mensurável/honesta como escrita

**Evidência.** A definição por request está correta e é a única (confere com
`docs/research/prompt-caching.md:75-79,169-172,639-645`), mas a agregação e o regime
não permitem provar a meta:
- Unidade ambígua: “sempre por request” (`PLAN.md:201-204`), “req. 3+” na tabela
  (`PLAN.md:254-256`), benchmark de “10 turnos” (`PLAN.md:790,917-920`), amostra por
  **passo** (`PLAN.md:546-567`) e EVIDENCE em “req. 3–10” (`EVIDENCE.md:11,19`). Um
  turno Code tem vários requests de wire; não se sabe o que entra na média.
- Teto aritmético omitido: com prefixo `P` e cauda nova `Δ`, `hit = P/(P+Δ)`. Para
  ≥98% é preciso `Δ ≤ P/49`; no piso de prefixo de 20k adotado para sessão
  (`PLAN.md:256`) isso é **≤ ~408 tokens por request**, incompatível com um turno
  normal (resposta do assistant + mensagem do user; em Code, tool results de até 24k
  chars — `docs/research/cache-audit-backend.md:457`). A meta de sessão (`PLAN.md:239-240`)
  exige `ΣΔ ≤ 0,0204·ΣP`; em 6 requests isso é ~2k tokens de cauda **no total**.
- Cold start vs. gate de custo vs. regime: request 1 de cada epoch fica fora da meta
  (`PLAN.md:241`), mas o gate de custo só liga write explícito quando a sessão já tem
  ≥2 requests (`PLAN.md:513-515`). Nesse desenho o request 3 é write com read=0, e o
  “steady-state a partir do request 3” (`PLAN.md:237`) é falso para Anthropic. Numa
  sessão de 6 requests, a exclusão do cold start e/ou do write é exatamente o que faz
  o número parecer 98% ou cair para ~60–80%; hoje o plano não fixa qual dos dois.
- Gemini 4: a condição “turnos ≥2.050 tokens” (`PLAN.md:244-248,261`) não é a condição
  correta do SLO; `hit ≈ P/(P+δ)` com `δ≥2.050`. Com o piso de 20k, o teto é ~90,7%;
  ≥95% exige `P ≳ 39k` (com δ=2.050). O plano não declara `P` na linha do Gemini.
- Elegibilidade: “prefixo cacheável ≥ mínimo” (`PLAN.md:227-233`) depende de mínimos
  por modelo que o catálogo ainda não tem; F0.3 fala em “defaults por
  protocolo/família” (`PLAN.md:773`) sem fonte para cada modelo e sem semântica
  “desconhecido”. Se a classificação vier da heurística char/4 (`PLAN.md:269`), erros
  de fronteira viram exclusões de denominador — maquiagem de métrica.
- Excluir todos os “epochs legítimos” (`PLAN.md:241-243`) pode esvaziar a amostra; o
  teste de 0 quebras prova bytes, não cache do provedor.

**Risco.** O aceite final (`PLAN.md:858`) e o EVIDENCE podem “bater 98%” sem medir o
que o usuário pediu, ou exigir algo que nenhuma sessão real atinge; o benchmark vira
circular (escolhe-se o cenário que passa).

**Correção mínima.** Fixar: (a) unidade = **request de wire** (cada passo), com
`turn_id+step`; (b) cenário do benchmark com `P_min`, `Δ_max`, modelo/rota e número de
turnos explícitos, e a fórmula `hit = 1 − Δ/P` publicada no §2; (c) separar três
números no aceite: prefix-reuse (bytes, determinístico), steady-state por request
(conjunto de requests incluído definido e justificado) e **ciclo de vida da sessão
incluindo cold/write** (não pode excluir o custo); (d) só classificar elegível com
mínimo provider/catálogo e `unknown`, e registrar quantos requests ficaram fora; (e)
expressar Gemini 4 em `P/δ` (ex.: ≥95% com P≥40k e δ≥2.050) e a meta de sessão de
acordo com o piso de P; (f) meta de custo fica em M1. Sem isso, remover as linhas
98/99% da tabela de aceite.

---

### B2 — [blocker] Contratos de persistência prometidos não existem no schema nem nas tarefas

**Evidência.**
- `PromptSnapshot` “**persistido**” com texto + hashes + `PROMPT_VERSION`
  (`PLAN.md:322,345-349`) e F2.1 “snapshot persistido por sessão” dependendo de F0.4
  (`PLAN.md:799`). Mas o contrato SQLite lista só `usage_log`, `cache_state`,
  `cache_samples`, `context_snapshots` (`PLAN.md:75-76`), o write path idem
  (`PLAN.md:147`), e F0.4 cria só essas quatro (`PLAN.md:774`). Não há
  `prompt_snapshots` (ou coluna/JSON) em lugar nenhum — F2.1 não é executável como
  escrita, e “reusar o snapshot no turno seguinte”/após restart não tem caminho.
- O snapshot do catálogo de tools (`PLAN.md:324,347`) tem o mesmo problema.
- `render_decision` “congelada por mensagem” (`PLAN.md:381-384`) sem coluna/tabela e
  sem task de storage; F2.4 depende de F0.4 (`PLAN.md:802`), que não a cria.
- `cache_samples` só tem índice (`PLAN.md:693-694`); as colunas (ou serialização) não
  são definidas, embora `CacheSample` tenha 15 campos (`PLAN.md:548-567`). F0.4/C RUD
  não é acionável sem isso. `usage_log` ganha colunas por request (`PLAN.md:687-688`),
  mas hoje `record_usage` é 1 linha/turno (`docs/research/cache-audit-backend.md:332-338,334-336`);
  o plano não diz se muda a granularidade ou se o benchmark usa `cache_samples`.

**Risco.** storage-dev implementa um schema; harness-dev assume outro; o snapshot
some no restart e a meta “prefixo igual ao turno anterior” falha em produção. É o
tipo de contrato que, se descoberto na F2, invalida F2.1/F2.4/F4.1.

**Correção mínima.** Antes do GO, fechar no §4/§5.3 e no F0.4/F0.7:
`prompt_snapshots(conversation_id, snapshot_key, provider_id, model_id, profile,
workspace, prompt_version, system_text, tools_json, hashes, created_at,
invalidated_at)` (ou JSON equivalente); `message_render_decisions(message_id, kind,
digest, payload)`; colunas exatas de `cache_samples`; declarar a granularidade de
`usage_log` (per request **ou** continua por turno e benchmark lê samples). Adicionar
teste de restart/reabertura e de “turno N+1 usa o snapshot persistido” em F2.1.

---

### B3 — [blocker] O surface append-only não posiciona conteúdo injetado na cauda no replay do turno seguinte

**Evidência.** O plano define surface = mensagens persistidas + `context_snapshots` +
resumo (`PLAN.md:370-372`) e move para a cauda: notas de modo (`PLAN.md:593-594`),
wrap-up do final forçado como mensagem de user (`PLAN.md:377-380`) e snapshots de
contexto criados em eventos reais (`PLAN.md:803-804`). O schema ancora cada snapshot
em `after_message_id` (`PLAN.md:414-427`). Mas o replay do turno seguinte reconstrói
**um `HistoryMessage` por passo** a partir do `provider_state` v2 da mensagem assistant
(`docs/research/cache-audit-backend.md:131-137`; `harness/mod.rs:2114`), e passos não
têm id de mensagem. Um snapshot/nota criado após o tool result do passo k não tem
posição representável: ao reabrir/turno seguinte ele renderiza antes/depois do grupo
inteiro do assistant, não após o passo k. O mesmo vale para a instrução de wrap-up:
só o passo final entra no replay (`docs/research/cache-audit-backend.md:211-217`), a
mensagem de user que a instruiu não é persistida como item de surface. Logo o
invariante “request N+1 começa com os mesmos bytes do N” (`PLAN.md:36-37,597-598`)
falha exatamente nos fluxos D4/D5 que o plano se propõe consertar — e o teste “3 turnos
com 0 quebras” (`PLAN.md:805`) não cobre mudança de modo/final forçado.

**Risco.** O miss aparece em Code (onde troca de modo/plano é comum) e o benchmark
“10 turnos sem mudança de config” passa mesmo assim; a UI pode mostrar “estável” com
cache quebrado.

**Correção mínima.** Escolher e especificar uma destas (ou declarar epoch e remover a
promessa): (a) tabela `surface_items(conversation_id, seq, kind, text, digest, ...)`
com ordem monotônica e renderização por `seq` antes do replay steps — substitui
`after_message_id`; (b) estender o `provider_state` (v3) para persistir itens
injetados com posição de passo; (c) kill criterion explícito “mode_notes/wrap-up =
epoch novo” e target sem prometer continuidade nesses casos. Em qualquer opção,
adicionar teste cross-turn N/N+1 byte-a-byte com (i) troca de modo no meio do turno,
(ii) final forçado.

---

### B4 — [blocker] Dono e entrada do digest/prefix_hash ambíguos; ordem contraditória

**Evidência.**
- Dono: `providers::cache` é dono “da identidade do wire prefix” e normalização
  (`PLAN.md:61-62`); `harness::cache` é dono do `RequestSurface` e do epoch/causa
  (`PLAN.md:62-63`). Mas há dois digests: `providers::cache::digest` (`PLAN.md:468`) e
  `SegmentDigest`/`PrefixDigest` em harness (`PLAN.md:392-406`), e o `CacheTracker`
  compara `PrefixDigest` (`PLAN.md:569-573`), enquanto F1.1 diz “digest no body final”
  (`PLAN.md:786`) e F2.7 repete (`PLAN.md:805`). Não está definido quem calcula e
  persiste `prefix_hash`/`prefix_segments` (`PLAN.md:689-692`) nem como o restart lê
  isso.
- Ordem: o read path é `build_body → cache::digest → cache::apply` (`PLAN.md:144-145`),
  mas a regra 3 exige digest “sobre o body **final** (depois de `apply`)”
  (`PLAN.md:510-511`). Se o digest incluir `cache_control`/`ttl`/`prompt_cache_key`
  (que mudam de posição/valor entre requests), todo request parece “quebrado”; se for
  antes do `apply`, não mede o que foi enviado.

**Risco.** O diagnóstico de quebra (causa, primeiro segmento divergente) e o gate “0
quebras” passam a testar uma representação que não é o fio; a UI pode acusar quebra
falsa ou esconder a real.

**Correção mínima.** Declarar **um** digest canônico, dono único e input exato: por
exemplo, `providers::cache::digest` sobre segmentos canônicos (system/tools/mensagens)
do body **pós-apply mas com metadados de cache removidos do hash** (ou pré-apply, com
a regra explícita “apply não altera conteúdo do prompt”), e `harness::cache` consome o
resultado; definir persistência (`prefix_hash`, `prefix_segments`) e teste: N/N+1 com
`cache_control`/TTL mudando não gera quebra; restart lê o mesmo hash.

---

### B5 — [blocker] Ordem das fases e gates contradizem a ordem obrigatória

**Evidência.**
- §1 declara ordem obrigatória: medir (F1) → estabilizar prefixo (F2/F4) → ligar
  campos explícitos (F3) → medir (F6); e explica que ligar `cache_control` antes de
  estabilizar o prefixo gera write pago sem read (`PLAN.md:193-195`). A execução faz
  **F3 antes de F4** (`PLAN.md:811-835`; F3.1 depende só de F1.2/F2.7 —
  `PLAN.md:815`; DAG `PLAN.md:864-870`). Enquanto F4 não roda, D1/D2/D4/D5 continuam
  quebrando o prefixo do Code a cada turno — exatamente o custo que o §1 quer evitar.
- Gate F2 exige “hit% steady-state ≥95%” antes de F3 (`PLAN.md:808-809`). Para o
  protocolo `anthropic` no Chat não há cache explícito antes de F3.1 (o Lumina não
  envia `cache_control` — `PLAN.md:23-27,293-296`), então o gate é impossível/ambíguo
  se lido “por provedor/protocolo”; precisa dizer “só onde o cache automático já
  existe”.
- Gate F3 exige ≥98% “por provedor/protocolo” (`PLAN.md:821-822`) sem restringir o
  perfil; um benchmark só de Chat passa enquanto Code (F4) ainda quebra. Não há
  `profile` no escopo do gate.
- A linha “Anthropic (todos os modelos `anthropic`) ≥99%” (`PLAN.md:260`) contradiz a
  matriz “≥98% quando reportado” para modelos servidos por gateway
  (`PLAN.md:706-711`) e o catálogo inclui Kimi/MiniMax/Qwen no protocolo `anthropic`
  (`docs/research/cache-audit-backend.md:20`). Prime-party e gateway não estão
  separados.
- O probe de capacidades F3.5 (`PLAN.md:819`) **depende** de F3.1–F3.4, mas deveria
  precedê-las (ele alimenta `catalog.cache` e decide se o campo é aceito); a ordem
  está invertida.

**Risco.** A F3 “passa” com número de Chat, o Code continua quebrado até F4, e o custo
de write no Code cresce sem read; a evidência de fase não prova o que promete.

**Correção mínima.** Separar F3 em F3-chat (pós-F2) e F3-code (pós-F4), ou mover o
`cache_control`/`prompt_cache_key` para depois de F4; declarar gate por
`profile × provider × protocol`; F2 gate = 0 quebras + hit só nos provedores com cache
automático; F3.0/F0.8 = probe primeiro, F3.x depois; escopar “Anthropic ≥99%” a
Anthropic direto com API key e tratar gateway-anthropic como condicional/probe.

---

### B6 — [blocker] Evidência de campo insuficiente e parcialmente circular; “unproven” contradiz o evidence gate

**Evidência.**
- O protocolo do benchmark não existe: F1.5 = “10 turnos por provedor/protocolo”
  (`PLAN.md:790`) e §9.1 = “prompt longo crescente, assert de hit%” (`PLAN.md:917-920`),
  sem `P`, `Δ`, modelo/rota, espera de TTL, número de repetições, critério de
  aprovação nem formato do JSON. Um cenário “longo e crescente” pode ser escolhido
  para passar (circularidade).
- Caches reais são best-effort/não determinísticos: DeepSeek “best-effort”, construção
  em segundos (`docs/research/prompt-caching.md:242`), OpenAI por máquina
  (`:124`), Anthropic exige concorrência/ordem (`:65`), valores mudam (`:692`). Um
  `assert` de hit% por run em teste `#[ignore]` (`PLAN.md:917-920`) é flaky por
  desenho; o aceite precisa ser número observado + artefato bruto, com mediana/
  percentil, não assert duro.
- Credenciais: os testes live existentes só cobrem gateway via
  `~/.local/share/opencode/auth.json` (`src-tauri/src/providers/mod.rs:856-898,1093`)
  e Anthropic via `ANTHROPIC_API_KEY` (`:1655-1659`); não há caminho de credencial
  OpenAI direto nos testes. O plano diz “Claude/OpenAI quando houver chave”
  (`PLAN.md:920`) e o risco 11 diz “implementado, mas não provado”
  (`PLAN.md:960`), mas o Evidence Gate diz que a fase **só fecha** com número real
  (`PLAN.md:97-100`). Uma das duas regras precisa ceder, com matriz
  provedor × credencial × disponibilidade e o que significa GO sem a chave.
- O check “UI vs usage do provedor ≤1 p.p.” (`PLAN.md:58-59,259`) é quase tautológico:
  a UI projeta o número normalizado pelo backend; não há superfície que exponha o
  `usage` bruto (o painel de diagnóstico F5.4 não promete isso — `PLAN.md:844` — e
  `CacheSample` não carrega o payload bruto — `PLAN.md:548-567`). Manualmente não há
  como comparar com o provedor.
- Não há passo de **prova de integração** exigido nos gates (o PRE pede): há testes
  por módulo e benchmark final, mas nenhum gate executa `run_turn` com provider fake
  capturando bodies finais pós-`apply` por N turnos, gerando `CacheSample` →
  `TurnEvent` → `cacheStore` → chip. F0–F5 podem fechar com testes isolados e a
  integração aparecer quebrada na F6.

**Risco.** Não é possível fechar F1/F2/F3/F4/F6 com o rigor que o próprio plano exige;
o EVIDENCE final fica com números não reproduzíveis ou com um “unproven” que o gate
proíbe.

**Correção mínima.** (a) escrever o protocolo do benchmark (fixture `P_min`, `Δ`,
turnos, rota/modelo, TTL/wait, N repetições, custo máximo, JSON bruto em
`docs/goals/prompt-cache/evidence/…`); (b) aceite por mediana/percentil + artefato
bruto, com assert duro apenas no provider fake; (c) matriz de credenciais e decisão
explícita de GO por provedor (documentado como “não provado” sem bloquear os demais);
(d) adicionar task de integração obrigatória nos gates F1/F2/F3/F4; (e) incluir o
`usage` bruto no diagnóstico (copiar JSON) para tornar o check ≤1 p.p. verificável;
(f) resolver a contradição evidence gate × risco 11.

---

### M1 — [major] Meta de custo ≥10× não decorre de 98% com read 0,1×; TTL/write pioram

**Evidência.** `PLAN.md:92-95` afirma “98% de hit ⇒ custo cai ~10×”; a tabela exige
“≥10× menor” (`PLAN.md:257`); a matriz diz read 0,1× para Anthropic/OpenAI
(`PLAN.md:708-709`; `docs/research/prompt-caching.md:27-28`). A conta com read
`r=0,1`: fator = `1/(1-0,9h)` = **8,5×** com h=98%, 9,2× com 99% e 10× só com 100%.
Write de 1,25×–2,5× (`PLAN.md:513-517,955`), TTL 1h 2× (`PLAN.md:475`) e cold starts
reduzem mais. Modelos Anthropic com read 0,05× (research `:27`) chegam a ~14×, mas
isso é por modelo, não universal. “TTFT despenca” (`PLAN.md:94`) também não tem
métrica.

**Correção mínima.** Recalcular a meta por provedor/modelo usando
`cost.cache_read`/`cost.cache_write` do catálogo (ex.: ≥8× para 0,1× em 98%, ≥9× em
99%, ≥12× para 0,05×) e medir custo por turno vs. baseline F1 **incluindo writes/cold**;
publicar a fórmula em §2.4 e no EVIDENCE; remover a afirmação universal de ~10×.

---

### M2 — [major] Restauração/agregação de sessão tem três fontes sem precedência; divergência com a spec de UI (“sem migração”)

**Evidência.** O plano adiciona `cache_state`/`cache_samples` (`PLAN.md:685-696`),
`get_cache_stats` (`PLAN.md:578-579`) e `cacheStore` que “restaura de
`get_cache_stats`/`ChatMessage.usage`” (`PLAN.md:678-681`). O `ChatMessage.usage` já
persiste — e a auditoria de UI diz explicitamente que `CacheUsage` novo “persiste sem
migração” por esse caminho (`docs/research/cache-audit-ui.md:722-737`). Três
persistências do mesmo agregado (samples, cache_state, message usage) sem dizer qual é
autoritativa, como reconciliar em `done/cancelled/error` e como evitar double-count no
`openConversation`; `usage_log` continua por turno (`PLAN.md:687-688`) enquanto o
benchmark quer por passo. Além disso, o plano cita a auditoria de UI como “especificação
completa” (`PLAN.md:728-729`), mas troca o contrato dela (nested `UsageInfo.cache` com
`reported` → campos flat em `UsageInfo` + `CacheStats`; “fatos no backend, estado na UI”
→ backend também manda `state`/`hit_percent`; sem setting → setting) sem declarar a
divergência. `usage_summary` “ganha uso de produção ou é substituído”
(`PLAN.md:584-585`) não tem task/dono.

**Correção mínima.** Escolher **uma** fonte canônica do agregado de sessão
(recomendo `cache_samples`+`cache_state`, com `get_cache_stats` agregando), definir
precedência “samples > message.usage legado”; `cacheStore` faz seed substitutivo
idempotente e não soma amostras antigas; documentar a divergência com
`docs/research/cache-audit-ui.md` na F5.5 (ou atualizar a auditoria); dar dono/task ao
`usage_summary` (substituir por `get_cache_stats` e deletar o `#[cfg(test)]`).

---

### M3 — [major] Compactação cache-safe vs. afinidade de sessão do batch/subagente

**Evidência.** O plano quer que a chamada de resumo “reuse o último request”
byte-a-byte (`PLAN.md:523-531`), mas hoje ela sai por `batch::complete_text` com
`x-opencode-session: "batch"` (`docs/research/cache-audit-backend.md:397-400`;
`src-tauri/src/harness/batch.rs:51-61`). O header existe justamente para “otimizar
roteamento e prompt caching” (`docs/research/prompt-caching.md:258`) e o cache da
OpenAI é por máquina (`:124`); prefixo byte-idêntico em sessão diferente pode rotear
para outra máquina e não ler o cache. D20 está classificado minor e jogado para F3/F6
(`PLAN.md:305`), enquanto F4.3 (`PLAN.md:830`) depende desse reuso; F4.5 menciona id
estável (`PLAN.md:832`) mas fora da compactação.

**Correção mínima.** Mover a correção do D20 para F4.3/F3.3: a chamada de sumarização
usa o `conversation_id` (e o mesmo request profile/rota) da conversa; subagente
documenta epoch próprio/sem reuso; teste live/gateway mostrando `cache_read > 0` na
chamada de resumo; registrar em EVIDENCE F4.

---

### M4 — [major] O primeiro PR melhorou, mas o baseline continua bloqueado; F0 ainda é grande demais para “medir primeiro”

**Evidência.** A revisão atual trouxe §8.2 “Primeiro PR (F0 em 4 passos pequenos)”
(`PLAN.md:873-882`), reduzindo o primeiro PR para F0.1/F0.2/F0.3/F0.5 — direção
correta. Ainda assim: (a) o baseline não é destravado, porque F1.3 depende de F0.4
(DB) e F1.4 depende de F0.6/F0.7 (`PLAN.md:786-793`); o “primeiro PR” é contratos
puros e não produz nenhum número; (b) ele inclui catálogo (`F0.3`) e DTOs TS
(`F0.2`) que não são necessários para medir — o mínimo é `UsageInfo`+normalização+
amostra por passo+benchmark com provider fake; (c) o Gate F0 continua “bloqueia
F1–F5” (`PLAN.md:779-780`) e F0.4/F0.6/F0.7 ficam “no PR seguinte” sem ordem nem
gate de evidência. A ordem obrigatória continua “medir primeiro”
(`PLAN.md:193-195`) e o Krypton exige o menor slice de alto valor.

**Correção mínima.** Fazer do **F0a (medição)** o primeiro PR de fato:
`UsageInfo`/`CacheUsage` mínimo + `normalize_usage` + `CacheSample`/`TurnEvent` +
emissão por passo no harness com provider fake + `cache_bench` direto (sem UI, sem
DB, sem catálogo completo) já com o baseline F1 medido no benchmark roteirizado.
Depois **F0b** = catálogo, migrações, `get_cache_stats`, UI, settings. Atualizar o
Gate F0 e o DAG para refletir F0a → F1 baseline → F0b.

---

### M5 — [major] O Chat perde sua única redução de histórico sem que exista task de compactação do Chat

**Evidência.** F2.3 remove o trim deslizante no Chat (`PLAN.md:801`) e §4.6 diz que
“no Chat, essa [compactação] passa a ser a única redução de histórico”
(`PLAN.md:539-540`). Mas a compactação descrita e as tasks F4.3/F4.4 estão sob “Perfil
Code” (`PLAN.md:824-835`), e o código atual de compactação é Code-only
(`docs/research/cache-audit-backend.md:360-369`: `settings.auto_compact`, perfil Code).
Não há task/política para compactar Chat, nem teste de janela excedida. Conversas de
Chat longas passam a estourar a janela depois de F2.3.

**Correção mínima.** Adicionar uma task F2.x de compactação do Chat (threshold,
fronteira de turno, resumo com replay de prefixo, epoch, testes de janela) ou manter
no Chat v1 um trim com watermark/histerese e declarar explicitamente que ele não
atinge 98% no regime de overflow; atualizar §4.6, F2 gate e EVIDENCE.

---

### M6 — [major] Flag de rollback, Settings e decisões abertas duplicadas/incompletas

**Evidência.**
- `settings.cache.enabled` é citada no cutover (`PLAN.md:83-84`), na tabela §11
  (`PLAN.md:973`) e na remoção F6.2 (`PLAN.md:855`), mas **não** existe no contrato
  §5, não é criada por F0.2/F5.3 e não há task que a leia/escreva; “rollback de
  release” fica sem dono.
- F5.3 cria a seção Settings com “indicador on/off, TTL, retention, diagnóstico”
  (`PLAN.md:843`), mas o campo `Settings` mora em `domain.rs` (Lead) e
  configuração em `config.rs` (storage) — `AGENTS.md:26,31`; ui-systems não pode
  persistir sem task de contrato Lead. A auditoria de UI recomenda **não** criar
  setting no v1 (`docs/research/cache-audit-ui.md:614-617`) e o plano lista a mesma
  decisão duas vezes (`PLAN.md:979-980` e `:995-996`).
- O TTL Anthropic está “aberto” no §12.1 (`PLAN.md:977-978`), mas já é aceite fixo
  em §2.4 (`PLAN.md:260`), §4.5 (`PLAN.md:475`) e F3.1 (`PLAN.md:815`), e a linha de
  Settings inclui TTL (`PLAN.md:843`).

**Correção mínima.** Decidir: (a) sem flag de produto (usar config de dev/build) e
remover as menções do cutover/F6.2, **ou** adicionar `settings.cache` ao contrato em
F0.2 com task Lead + teste default/legado + F5.3; (b) remover o item duplicado §12.9;
(c) reconciliar “sempre visível + opt-out” com a auditoria (ou atualizar a auditoria
na F5.5); (d) fechar o TTL antes de F0.3/F3.1 e refletir em catálogo/Settings/EVIDENCE.

---

### M7 — [major] Target/displaced/cadência contradizem a auditoria de UI e o próprio §12.8

**Evidência.** O Target-Perspective diz que “em uma sessão longa (**Chat ou Code**) o
usuário vê **ao lado do anel de contexto** … atualizando **durante o streaming**”
(`PLAN.md:53-55`), e §7 repete “durante o streaming” (`PLAN.md:740-741`). A auditoria
de UI mostra: o Chat **não tem medidor de contexto** (`docs/research/cache-audit-ui.md:72-91`),
o chip do Chat é cache-first **sem anel** (`:441-445`), e a amostra só existe **depois**
da resposta do passo; durante o passo deve-se mostrar a última amostra
(`:275-280`). O próprio plano defere contexto% no Chat para P2
(`PLAN.md:991-994`). A lista de displaced path inclui “(d) `context_stats`/`usage`
só no Code e só no fim do turno” (`PLAN.md:88-89`), mas o contrato mantém `usage`
final com totais (`PLAN.md:70-72`) e o §11 mantém “usage só no fim” como deslocado
(`PLAN.md:969`), sem dizer o que é realmente removido.

**Correção mínima.** Reescrever o target para Chat v1 = chip cache-first (sem anel de
contexto) **ou** incluir `context_stats` no Chat no escopo; definir “tempo real” =
atualiza ao fim de cada passo, mantendo a última amostra durante o streaming; corrigir
a lista de displaced path/§11 para só listar o que sai (`usage` por turno continua;
contexto% no Chat fica P2/fora) e atualizar o checklist de UI em `EVIDENCE.md:26-32`.

---

### M8 — [major] Ownership/escopo por tarefa não é dispatchável segundo o AGENTS.md

**Evidência.**
- As tabelas F1–F6 não têm coluna de **Arquivos/write scope** (só F0 tem —
  `PLAN.md:769-777` vs `:784-790,797-806,813-822,826-835,839-848,852-859`), embora a
  convenção exija “escopo de escrita disjunto” (`PLAN.md:763-765`). Sem escopo por
  tarefa, o paralelismo e a não-colisão não são verificáveis.
- Várias tarefas têm múltiplos donos: F0.6 ui-agent+ui-core (`:776`), F1.4
  Lead+ui-agent+ui-code+ui-core (`:789`), F5.1 ui-agent+ui-code (`:841`), F5.4
  ui-agent+ui-systems (`:844`), F2.4 harness-dev+storage-dev (`:802`), F4.5
  harness-dev+provider-dev (`:832`), F6.2 Lead+harness-dev (`:855`). O AGENTS.md tem
  um dono por área e proíbe editar arquivo de outra área (`AGENTS.md:24-37`).
- Cruzamentos sem task/dono explícito: `components/code/{CodeAgentWidgets,CodeSessionHeader}.tsx`
  estão na lista de modificar (`PLAN.md:136-137`) mas ui-code só aparece como co-dono
  em F1.4/F5.1; F0.6 diz “integração … no composer do Chat (ui-core)” mas a coluna de
  arquivos é `src/components/agent/*` e F5.2 é a task do composer (`:842`) — definição
  duplicada; F5.3 precisa de contrato de `Settings` (Lead/storage) e F5.4 mexe na
  paleta (ui-systems) sem arquivos listados; F1.5/F6.1 têm benchmark dono Lead, mas
  tests live vivem em módulos de `providers/**`/`harness/**` (`AGENTS.md:27-28`) ou
  precisam de nova área/nome de arquivo.
- A atualização de ownership no AGENTS.md está na F5.5 (`PLAN.md:845`), **depois** de
  F0–F4 criarem `providers/cache.rs`, `harness/cache/**`, `commands/cache.rs`,
  `src/lib/cache.ts`, `cacheStore.ts` — durante essas fases o repositório ainda não
  autoriza os donos novos.

**Correção mínima.** Adicionar `Arquivos`/write scope a cada task de F1–F6; quebrar
tarefas multi-dono em subtarefas de um dono (ex.: F1.4a stores/chip UI-agent, F1.4b
CodeAgentWidgets ui-code, F1.4c composer ui-core); dar dono explícito a
CodeAgentWidgets/CodeSessionHeader (ui-code), composer (ui-core), paleta
(ui-systems), Settings (contrato Lead em F0 + F5.3 ui-systems); nomear arquivo e dono
do benchmark (ex.: `providers/cache/bench` provider-dev com matriz definida pelo Lead);
mover a atualização de ownership do `AGENTS.md` para F0.0 (Lead), listando também
`commands/cache.rs`, `harness/cache/**`, `src/lib/cache.ts`, `cacheStore` e o arquivo
do benchmark.

---

### m1 — [minor] Afirmação factual errada sobre `usage_log`

`PLAN.md:32-33` diz “`usage_log` não tem colunas de cache”. O schema tem
`cached_tokens` (`src-tauri/src/db.rs:140`; confirma em
`docs/research/cache-audit-backend.md:334`). **Correção:** “tem `cached_tokens`
agregado; faltam `read/write/uncached` normalizados e hit%”.

### m2 — [minor] `prompt_cache_options` no Chat Completions não confirmado

O plano aplica `prompt_cache_options` a `openai_chat.rs`/`openai_responses.rs`
(`PLAN.md:480-485`), mas a pesquisa marca aceitação no endpoint Chat como não
confirmada (`docs/research/prompt-caching.md:686`) e o modo explícito do Responses
exige mover `instructions` para `developer`/`input_text` (`:132,603`); F3.2 só cobre
Responses (`PLAN.md:816`). **Correção:** gate por endpoint/probe; documentar a
realocação de `instructions` antes do modo explícito.

### m3 — [minor] Anthropic automático × 4 explícitos: regra de slot/400 ausente

O plano admite “até 4” explícitos e fallback `cache_control` top-level
(`PLAN.md:471-478`), mas a doc diz que o automático consome 1 slot e que 4 explícitos
+ automático, ou TTL diferente, retorna 400 (`docs/research/prompt-caching.md:40-43`).
**Correção:** definir “3 explícitos + automático” **ou** desligar o automático com 4
explícitos; mapear 400 → fallback e testar; corrigir a redação do 4º breakpoint
(“primeiro system + primeiro user” são posições distintas).

### m4 — [minor] “Snapshot por turno” contradiz a imutabilidade de tools

F4.5 diz “Mudanças de tools … snapshot por turno” (`PLAN.md:832`), enquanto §4.2/§4.8
dizem prompt/tools imutáveis por sessão, com epoch em mudança explícita
(`PLAN.md:345-358,592-594`). **Correção:** package de tools por sessão; mudança de
conjunto = epoch `config_change`, nunca reconstrução silenciosa por turno. Teste com
toggle de `run_code`/MCP.

### m5 — [minor] Retenção/crescimento do DB e dedupe não definidos

`cache_samples` por passo (`PLAN.md:693-694`) e `context_snapshots`
(`PLAN.md:414-425`) não têm política de retenção/poda; o índice de snapshots não é
unique por digest (dedupe só em app). **Correção:** definir retenção (ex.: manter N
amostras/turno ou compactar antigas), `UNIQUE(conversation_id, digest)` onde couber, e
teste de dedupe/idempotência no F0.4.

### m6 — [minor] Defeitos da auditoria sem task/dono

O bug do `/compact` (evento `context/stats` com payload incompatível → `context` do
Code vira `null` — `docs/research/cache-audit-backend.md:383-386`) e o D24
`usage_summary` (`PLAN.md:309,584-585`) não aparecem na lista D nem em tarefa. Como o
`ContextMeter` é o host do indicador, o bug afeta a F5.1. **Correção:** incluir o fix
do `/compact` em F4.3/F5.1 (com teste) e dar dono ao D24 (substituir por
`get_cache_stats` e remover o código de teste) ou declarar fora de escopo.

### m7 — [minor] Assinaturas de `providers::cache` não carregam o contexto que a regra precisa

`plan(protocol, request)` (`PLAN.md:465`) não recebe `capabilities`, e
`normalize_usage(protocol, raw)` (`:467`) não distingue OpenAI vs. DeepSeek vs. bloco
`opencode.tokens` (a própria §2.1 depende de provider/gateway, `:214-219`).
**Correção:** passar `capabilities`/`provider`/`gateway` nas assinaturas e cobrir no
teste de fixtures.

---

## O que está forte (não precisa mudar de direção)

- Diagnóstico D1–D24 ancorado em `arquivo:linha` e coerente com as três auditorias;
  a ordem “prefixo estável antes de cache explícito” está correta no §1.
- Definição de hit% **por protocolo** em `PLAN.md:199-223` está correta (Anthropic
  `input+read+creation`; OpenAI `input` inclusivo; Gemini `promptTokenCount`;
  OpenCode `tokens.input` exclui cache).
- Evidence gate conceitual (`PLAN.md:97-105`), kill criteria (`:111-123`), riscos
  (`:946-960`) e cutover (§11) existem e são incomuns em qualidade.
- Matriz por provedor reconhece Gemini 4, OAuth e gateway como condicionais
  (`:704-711`); não promete o impossível — o problema é operacionalizar a medição e
  a persistência.

## Recommended next gate

**PLAN-FIX → re-submeter a PRE (rodada 2). Não autorizar GO/F0 ainda.** Antes do GO:

1. Corrigir/fechar B1–B6 (ou obter aceite explícito do usuário para cada blocker, como
   o próprio plano exige em `PLAN.md:153-155`): métrica/cenário do benchmark; schema de
   `prompt_snapshots`/`render_decision`/`cache_samples`; posição de itens injetados no
   surface (ou epoch explícito); dono/entrada do digest; ordem F3/F4 e gates por
   perfil; protocolo/credenciais/mediana do benchmark e prova de integração.
2. Decisões que precisam existir antes do primeiro PR: TTL Anthropic; flag de
   rollback vs. Settings (ou nenhum); contexto% no Chat (P2/v1); dono/arquivo do
   benchmark; split F0a (medição) / F0b (catálogo+DB+UI); atualização do `AGENTS.md`
   com os donos novos **antes** das tasks que criam os arquivos.
3. Probes de campo por provedor: definir a matriz (provider × rota × campo × usage
   reportado) e executá-la **antes** de F3.1–F3.4 (F3.5 deve virar F3.0/F0.8), porque
   ela decide o que entra em `catalog.cache` e se `x-opencode-session`/pass-through
   valem promessa. Pelo menos gateway (auth.json), Anthropic (`ANTHROPIC_API_KEY`) e
   o caminho OpenAI direto precisam de dono e credencial definidos.
4. Só então GO com F0a pequeno (medição), F1 baseline, e F2/F4 antes de F3.

Critério de saída do PLAN-FIX: este documento com os blockers marcados como
“resolvido” (com trecho do PLAN alterado) ou “aceito pelo usuário”, e um novo PRE com
verdict `aligned`.

---

## Rodada 2 — após PLAN-FIX

**Base revisada:** `docs/goals/prompt-cache/PLAN.md` — 1227 linhas, 82.423 bytes,
SHA-256 `F6C8FC940A0B54DFDBED5F92CBEDFEBFF89F8E31EB0DF829751352DB8A71EC61` (leitura em
29/10/2026 11:10). O Lead aplicou duas edições durante esta rodada: §4.5 regra 5
(“write a partir do request 2”) e Value Density (`r=0,05` → ~14×); o restante do
arquivo é o mesmo da revisão anterior (1227 linhas). A tabela de task IDs referenciados
foi conferida: **todos os `F*.x` citados existem**; `GOAL.md`/`EVIDENCE.md` foram
atualizados e estão coerentes com a nova numeração.

**Verdict final: partially aligned.**
**Gate recomendado: PLAN-FIX 2** (não autorizar GO/F0a ainda).

### O que a reescrita fechou

- §0.2 mapeia B1–B6 e as seções citadas existem; a numeração F0a/F0b/F1–F6 substituiu
  a antiga e não há referência a task inexistente.
- B2, B5, M2, M4, M5, M6 e M7 fecharam de forma substantiva (persistência com colunas
  exatas; ordem “medir → contratos → Chat → Code → mecanismos com probe”; benchmark
  com fixture/N=5/p50/p10/JSON bruto/credenciais; restauração canônica; primeiro PR
  F0a sem UI/DB/catálogo; compactação do Chat; Settings sem flag de produto; Chat
  cache-first e “tempo real” ao fim de cada request).
- A fórmula de economia (`1/(1−h·(1−r))`) e os números 8,5×/9,2×/~14× estão
  aritmeticamente corretos; Gemini 4 em `P/δ` com `P≥40k` também.

### Placar dos findings da rodada 1

| Finding | Status | Menor correção restante |
| --- | --- | --- |
| **B1** — meta 98–99% | **parcial** | (a) §4.5 regra 5 ainda diz “a partir do request 2 … e o epoch já tem ≥2 requests” (`PLAN.md:572-574`): no request 2 o epoch tem 1 request, então a leitura literal volta a escrever no request 3 — remover a exigência de contagem/deixá-la só como `request_index ≥2`; (b) ciclo de vida ≥98% é impossível na fixture: 12 requests com `P1=20k` e `ΣP=840k` ⇒ só o cold start já custa 2,4%; com write no request 2 o teto fica ~93–97% (`PLAN.md:285-289,306,321-328`); a condição `ΣP/ΣΔ≥49` não inclui cold/write — trocar por `(P_cold + P_write + ΣΔ)/ΣP ≤ 2%` e alongar a fixture (~100–200 requests ou Δ maior) **ou** publicar meta menor para 12 requests; (c) definir o conjunto steady excluindo write-only/cold após TTL/renovação (não só request 1; `PLAN.md:281-293`) e contá-los; (d) o reuso de prefixo 100% não prevê a cauda transitória de wrap-up (`PLAN.md:36-38,437-441` vs `:279-280`) — classificar `transient_tail` e excluir do reuso; |
| **B2** — persistência | **resolvido** | Nenhuma. Só definir operacionalmente “snapshot ativo” (último não `invalidated_at`) em F2.1. |
| **B3** — posição de conteúdo injetado | **parcial** | `after_step` resolve o problema central, mas §0.2 promete `seq` (`PLAN.md:198`) e a tabela não tem `seq` (`:466-479,792-799`); definir ordem canônica `(after_message_id, after_step, seq)` e gravar `seq`; definir que o item entra **depois do grupo assistant+tool results do passo k** (nunca entre `tool_use` e `tool_result`; `:482-485`); incluir `surface_items` no transcript da compactação antes de removê-los (`:492-494,587-591`); decidir limpeza quando o placeholder/assistant do turno é cancelado/regenerado. |
| **B4** — digest | **parcial** | Dono único/metadados fora do hash/teste restart-TTL fechados. Resta: (a) read path ainda mostra `digest → apply` (`PLAN.md:168-170`) vs regra “body final” (`:450-455`) — reordenar para `apply → digest` ou documentar a equivalência; (b) `PrefixDigest` aparece no bloco de `domain.rs` (`:713-721`) e em F0b.1 (`:949`), mas é produzido em `providers/cache.rs` por F0a.3 (`:936`) — definir um local e re-export; (c) `cacheStateFor` (`:752`) recalcula o estado que o backend já manda em `CacheStats.state` (`:688`) — decidir uma derivação (backend verdade; `cacheStateFor` só mapeia estado→tom). |
| **B5** — ordem/gates | **resolvido** | Ordem F2→F3→F4, probe F4.0 antes de F4.1–F4.5, gates por `profile × provider × protocol` e Anthropic ≥99% restrito a Anthropic direto. Só corrigir a DAG (N4). |
| **B6** — evidência de campo | **parcial** | Protocolo, N=5, p50/p10, JSON bruto, credenciais (inclusive `OPENCODE_API_KEY`/`OPENAI_API_KEY` existem em `config.rs`) e gate de integração fake fechados. Restam: (a) a fixture contradiz a si mesma: `P` 20k→120k em 12 requests exige ~9,1k tokens novos/request, mas §9.2 declara user ~80 + resposta ~400 (`PLAN.md:321-328,1107-1112`) ⇒ com Δ~480 o `P` final seria ~25k; (b) o live `cache_bench` vive em `providers/cache_bench.rs` (dono provider-dev) e o plano não diz que ele dirige `run_turn`/prompt builder; a prova live parece ser request sintético, então o baseline F0a não mede as quebras atuais D1–D6 e o 98% não é provado no produto (ver Blocker 2). |
| **M1** — custo ≥10× | **parcial** | A fórmula foi corrigida, mas “≥8× com `read=0,1×`; ≥13× com `read=0,05×`, medido incluindo writes/cold” (`PLAN.md:307`) não fecha com a fixture de 12 requests: com cold 2,4% + Δ, o fator é ~7,9× (0,1×) e ~12,7× (0,05×); com TTL 1h/write 2× cai mais. Recalcular a meta **com a fixture** (e após fixar N/Δ) ou separar “custo steady-state” de “custo de ciclo de vida”. |
| **M2** — restauração/agregação | **resolvido** | `cache_samples`+`cache_state` canônicos, `ChatMessage.usage` só fallback legado, seed substitutivo; divergência com `cache-audit-ui.md` documentada em §7 (`:916-921`). |
| **M3** — batch/subagente/compactação | **parcial** | Batch e compactação passam a usar `conversation_id` (`PLAN.md:561-564`). Falta definir o subagente: ele roda conversa efêmera (`harness/code/subagent.rs:160-199`; auditoria backend §7.5) — “usa o `conversation_id` da conversa” deve significar **o id da conversa pai** (ou um id estável derivado), não o id efêmero; teste de afinidade. F4.3 (`:1009`) precisa ser dividida entre provider-dev (adapters) e harness-dev (batch/subagent). |
| **M4** — primeiro PR | **resolvido** | F0a (F0a.1–F0a.5) mede sem UI/DB/catálogo nem mudança de prompt; baseline antes do fix. |
| **M5** — compactação do Chat | **resolvido** | F2.4 generaliza a compactação para o Chat antes de F2.3 remover o trim; teste de janela. |
| **M6** — flag/Settings/TTL | **resolvido** | `Settings.cache` (`show_indicator`, `anthropic_ttl=1h`, `openai_retention`), sem flag de produto; TTL fechado no §12; F0b.4/F5.3 com dono de contrato. |
| **M7** — target/displaced/cadência | **resolvido** | Code ring+cache; Chat cache-first sem anel; “tempo real” = ao fim de cada request (última amostra durante o streaming); displaced path separa o que continua. |
| **M8** — ownership/escopo | **parcial** | Há coluna de Escopo, F0b.0 atualiza `AGENTS.md` antes dos arquivos, benchmark com arquivo/dono. Restam donos errados por área e tarefas multi-dono (ver Blocker 3). |

### Contradições novas/restantes introduzidas pela reescrita

- **N1 (bloqueia B1).** §4.5 regra 5 continua com “**e o epoch já tem ≥2 requests**”
  logo depois de dizer “a partir do request 2” (`PLAN.md:572-574`). No request 2 o
  epoch tem 1 request: a regra literalmente volta a adiar o write para o request 3 e
  quebra o “steady-state a partir do 3º”. **Correção:** remover a condição de
  contagem; usar só `request_index ≥ 2` (request 1 é frio) + `P ≥ max(2×minTokens,
  4.096)`.
- **N2 (bloqueia B6).** Fixture: `P 20k→120k` em 12 requests vs Δ declarado ~480
  tokens (`PLAN.md:321-328,1107-1112`). Ou o Δ é ~9,1k, ou a fixture pré-semeia
  histórico, ou o número de requests cresce; hoje o cenário não existe.
- **N3.** §0.2 promete `surface_items` com **`seq`** (`PLAN.md:198`), mas o schema
  (`:466-479,792-799`) não tem `seq`; `created_at` (INTEGER) pode empatar e a ordem de
  itens no mesmo ponto fica indefinida.
- **N4.** DAG (`PLAN.md:1044-1052`) repete `F0a.3` dos dois lados da junção
  (`F0a.3─┼─F0a.3`) e não mostra a dependência real `F0b.3 → F1.1` (tabela `:963`);
  também não mostra `F0b.3 → F2.1` (tabela `:974`). DAG é “resumido”, mas assim não
  serve como ordem de execução.
- **N5.** Gates F2/F3 falam “10 turnos” (`PLAN.md:984,998`) depois de §2.1 definir a
  unidade como **request de wire** (`:237`); com turnos multi-step os números não são
  a mesma coisa. Renomear para “requests” ou definir turno→request na fixture.
- **N6.** §5.3 comenta “`cache_samples` (F0a; §4.7)” (`PLAN.md:815`), mas a tabela é
  criada por F0b.3 (`:951`); F0a não tem DB. Corrigir o rótulo para F0b.3 (a amostra
  em si nasce na F0a.2 em memória).
- **N7.** `PrefixDigest` está no bloco de contrato de `domain.rs` (`PLAN.md:713-721`)
  e em F0b.1 (`:949`), mas F0a.3 o produz dentro de `providers/cache.rs` (`:936`).
  Definir o local único (recomendo `providers/cache.rs` e re-export em `domain`).
- **N8.** `cacheStateFor` em `src/lib/cache.ts` (`PLAN.md:752`) recalcula estado/
  thresholds que o backend já normaliza (`CacheStats.state`, `:688`; §7 `:892-896`,
  divergência consciente em `:916-921`). Escolher uma derivação (backend é a verdade;
  UI mapeia estado→texto/tom) para não voltar ao caminho duplicado.
- **N9.** F0a.4 (baseline) precede F0b.2 (catálogo) (`PLAN.md:937,950`), mas §2.2 exige
  `minTokens` do catálogo para elegibilidade (`:269-275`). Baseline deve fixar mínimos
  da fixture/pesquisa ou registrar `minTokens` desconhecido e classificar depois; não
  pode “medir elegível” com dado que ainda não existe.
- **N10.** §4.4 manda apagar `surface_items` antigos “só quando a compactação os
  cobrir” (`PLAN.md:492-494`), mas o transcript da compactação (`:587-591`) só fala de
  mensagens; se a compactação não incluir `surface_items`, o item some sem estar no
  resumo (perda de contexto) ou fica órfão.

### Blockers restantes (máximo 3)

1. **B1/M1 — aceite de ciclo de vida/custo e regra de custo ainda não fecham.**
   Evidência: regra 5 auto-contraditória (`PLAN.md:572-574`); meta de ciclo de vida
   ≥98% (`:306`) impossível com a fixture de 12 requests (cold `P1=20k`/`ΣP=840k` =
   2,4%; com write no request 2, teto ~93–97%, `:285-289,321-328,1107-1112`); meta de
   custo ≥8×/13× “incluindo writes/cold” (`:307`) também não fecha (≈7,9×/12,7× no
   caso declarado). **Menor correção:** (i) reescrever a regra 5 sem contagem;
   (ii) definir o conjunto steady e o de ciclo de vida explicitamente (write-only/cold
   contados fora do steady, incluídos no ciclo); (iii) expressar a condição de
   ciclo de vida como `(P_cold + P_write + ΣΔ)/ΣP ≤ 2%` e alongar a fixture (~100–200
   requests ou Δ maior) — ou declarar meta menor para a fixture curta; (iv) recalcular
   a meta de custo com a fixture e separar custo steady-state de custo de ciclo de
   vida; (v) classificar `transient_tail` e excluí-lo do reuso de prefixo.
2. **B6 — benchmark ainda não prova o produto.** Evidência: fixture inconsistente
   (`PLAN.md:321-328,1107-1112`); `cache_bench` em `providers/cache_bench.rs` e
   F0a.5 separado (`:937-938`) não dizem que o live dirige `run_turn`/prompt builder;
   o baseline da EVIDENCE vem de `cache_bench` (`EVIDENCE.md:11-20`), então não mostra
   as quebras atuais D1–D6 e o 98% no app não é provado (a verificação manual só
   compara chip × usage bruto, `PLAN.md:63-66`). **Menor correção:** corrigir a
   fixture (P/Δ/N coerentes) e acrescentar um modo **E2E** que executa o caminho do
   produto (`run_turn` com DB/config de teste + clock/fs fake + provedor real, ou o
   prompt builder do harness) para baseline F0a.4, F2.9, F3.5, F4.6 e F6.1,
   registrando bodies/digests e `usage` bruto; manter o bench sintético para
   capacidades/isolamento.
3. **M8 — ownership/escopo residual ainda não é dispatchável no AGENTS.md.**
   Evidência: F3.3 tem dono harness-dev mas escopo `commands/code.rs`
   (`PLAN.md:994`), que pelo AGENTS.md é code-runtime-dev; F4.3 tem dono provider-dev
   mas escopo `harness/{batch,code/subagent}.rs` (`:1009`), que é harness-dev; F1.2
   lista `src/lib/store/*` (`:964`) sem Lead, embora store/cacheStore sejam Lead
   (`:1075`, AGENTS.md:26); F2.5/F2.7 são harness-dev+storage-dev com `db.rs`
   (`:978,980`) e não há um dono accountable por task; §8.3 dá
   `prompt_snapshots`/`surface_items` a harness-dev e a storage-dev ao mesmo tempo
   (`:1072-1073`). **Menor correção:** quebrar F3.3 em F3.3a (harness/code) e F3.3b
   (`commands/code.rs`, code-runtime-dev); F4.3 em F4.3a (adapters/provider) e F4.3b
   (batch/subagent/compaction, harness-dev); dar Lead a parte de store em F1.2; um
   dono accountable por task (com donos de arquivo delegados) e remover a
   duplicação de dono em §8.3.

### Recomendação de gate: PLAN-FIX 2

- Corrigir os três blockers acima (edições pequenas no PLAN: regra 5, fixture/§9.2,
  E2E path, tabela de ownership/subtasks) — os demais achados (B3/B4/M3/N3–N10) são
  correções de contrato/redação que podem entrar no mesmo passe.
- Não é GO ainda: a meta declarada não é atingível/provável com a fixture e o
  benchmark atuais, e F3/F4 têm tarefas com dono errado.
- Após o fix, não é necessário refazer a rodada inteira: um check direcionado dos
  blockers 1–3 + revalidação dos números da fixture (cold/write/ceiling) basta para
  GO, desde que o restante permaneça como nesta revisão.

**O que já pode ser considerado pronto para GO condicionado ao fix:** B2/B5/M2/M4/
M5/M6/M7 estão fechados; a direção, o contrato de persistência, a separação de fases
e o protocolo de evidência estão corretos. O plano está a um passe de PLAN-FIX de
ficar `aligned`.

---

## Rodada 3 — check direcionado

**Base revisada:** `docs/goals/prompt-cache/PLAN.md` — 1276 linhas, 87.033 bytes,
SHA-256 `165D45AE938318152E813C36DFF64F06FADFFF27B53B10067C4887CD9D62F037` (leitura em
29/10/2026 11:21; fixture longa já com 120 requests/Δ≈850, EVIDENCE sincronizada).
Check restrito a B1/M1, B6, M8 + contradições óbvias (IDs, DAG, `seq`, labels).

**Verdict final: aligned.**
**Gate: GO** — nenhum blocker arquitetural/contratual restante; há duas correções
editoriais de uma linha e uma dependência de DAG a completar (abaixo), que não mudam
a direção e podem entrar antes de F0b.3/F1.2b.

### Aritmética conferida (fixture longa, 120 requests, Δ≈850)

- `P_i = 20.000 + (i−1)·850`, `i=1..120` ⇒ `P_120 = 20.000 + 119·850 = 121.150`.
- `ΣP = 120·20.000 + 850·Σ_{j=0}^{119} j = 2.400.000 + 850·7.140 = 8.469.000`.
- `P_cold = P_1 = 20.000`; `P_write = P_2 = 20.850`; `ΣΔ = 119·850 = 101.150`
  (a 1ª request semeia o histórico; o número do Lead ≈101k confere).
- `(P_cold + P_write + ΣΔ)/ΣP = (20.000+20.850+101.150)/8.469.000 =
  142.000/8.469.000 = 1,68% ≤ 2%` — **passa** (o valor ~1,9% da rodada 2 era da
  fixture de 60; com 120/850 fica 1,68%; e o “P_121” do texto é imprecisão de
  redação: a conta de 8,47M é a de 120 termos, `P_120≈121,15k`).
- Teto real do ciclo (inclui ΣΔ): `1 − 142.000/8.570.150 = 98,34%`, logo a meta de
  98% é atingível em princípio.
- Ceiling do request: `P/(P+850)`. `≥98%` a partir de `P≥42,5k` ⇒ request 28
  (`P_28=42.950`; 93 requests na faixa). `≥99%` a partir de `P≥85k` ⇒ request 78
  (`P_78=85.450`; 43 requests). Amostra suficiente para steady-state.
- Custo steady (sem cold/write): `r=0,1/h=98%` ⇒ `1/(1−0,9·0,98)=8,47×`;
  `r=0,05/h=98%` ⇒ `14,49×`. Nota: a meta “≥8,5×” com `read=0,1×` exige
  `h≥98,04%`; se quiser exatidão, use `≥8,4×` ou declare que 8,5× é arredondamento
  (não bloqueia).
- Custo de ciclo de vida: com cold 20k + write 2× em P2 (Anthropic TTL 1h) e
  `r=0,1`, custo ≈ `20k + 41,7k + 0,1·8.428k + 101k = 1.005,7k` contra baseline
  `8.570k` ⇒ **8,5× ≥ 7×**; com `r=0,05` ⇒ **~14,7× ≥ 12×** (OpenAI sem write 2×
  dá ~8,7×/15,2×). **Passa.**

### Status dos 3 blockers

| Finding | Status | Observação / menor correção restante |
| --- | --- | --- |
| **B1/M1** — métrica/custo | **resolvido** | §2.3 exclui `transient_tail` do reuso, define steady como `request_index ≥3` + ceiling + não write-only (cold/write contados) e ciclo de vida com a condição de 2%; §4.5 regra 5 virou `request_index ≥2` sem contagem ambígua (request 2 = `write_only`); §2.4 separa custo steady/ciclo. A conta passa (1,68%; acima). Só a nota de arredondamento 8,5× × 8,47×. |
| **B6** — benchmark/E2E | **resolvido** | §2.5/§9.2 têm modos `synthetic` e **`e2e`** (run_turn + DB/config de teste + clock/fs fake + provedor real/fake com bodies/digests); F0a.4, F2.9, F3.5, F4.6 e F6.1 exigem `e2e`; F0a.4 registra `minTokens` unknown e F0b.2 reclassifica; EVIDENCE sincronizada (120 requests + e2e). Ressalva de redação: §8.2 ainda diz “Sem UI, sem DB” (`PLAN.md:1105`) enquanto F0a.4 e2e usa DB/config de teste — trocar por “sem DB de produção/migrações; DB de teste permitido”. |
| **M8** — ownership | **resolvido** | Splits presentes e com dono correto: F1.2a Lead store / F1.2b ui-agent+ui-code / F1.2c ui-core; F2.5a/b e F2.7a/b harness/storage; F3.3a harness + F3.3b **code-runtime-dev** para `commands/code.rs`; F4.3a provider-dev + F4.3b **harness-dev** para batch/subagente; §8.3 com accountable único (harness-dev accountable, storage no `db.rs`). Ressalvas menores: F0a.4 ainda lista “Lead (matriz) + provider-dev (arquivo)” no mesmo arquivo; F6.2 ficou com 3 donos e a tabela F6 não tem coluna de Escopo; F0b.6 não aparece no DAG nem tem dependente (F1.2b/c deveriam depender dele se vão integrar o componente puro). |

### Contradições óbvias remanescentes (não bloqueiam a direção)

1. **`seq` divergente entre §4.4 e §5.3.** §4.4 define
   `seq INTEGER NOT NULL` e ordem `(after_message_id, after_step, seq)`
   (`PLAN.md:486-509`), F2.5b também (`:1015`), mas o schema “colunas exatas” de
   §5.3 não tem `seq` (`PLAN.md:826-833`). **Correção de 1 linha:** adicionar
   `seq INTEGER NOT NULL` ao `CREATE TABLE surface_items` de §5.3 (e, se quiser,
   índice por `(conversation_id, after_message_id, after_step, seq)`).
2. **§8.2 × F0a.4:** “Sem UI, sem DB, sem catálogo” (`PLAN.md:1105`) vs F0a.4 e2e
   “DB/config de teste” (`:971`). **Correção:** ajustar a frase do primeiro PR.
3. **DAG × F0b.6:** F0b.6 existe (`PLAN.md:988`) mas não aparece no DAG
   (`:1086-1093`) e nenhuma task depende dele; F1.2b/c deveriam declarar `F0b.6` na
   dependência (ou remover a task se o componente for criado em F1.2b).
4. **F6.2:** três donos e tabela F6 sem Escopo (`PLAN.md:1074-1077`); quebrar em
   subtarefas (harness/db/Lead) ou indicar accountable + arquivos, como nas demais.
5. **EVIDENCE/§0.1:** `EVIDENCE.md:72` ainda diz que a nota da “PRE rodada 2” está
   “a preencher”, e `PLAN.md:188` descreve o REVIEW como “rodada 1; rodada 2 ao
   final”; agora há rodada 3. Ajuste editorial opcional.
6. **IDs/labels:** conferi por script: todos os `F*.x` citados existem (incluindo
   `F1.2a/b/c`, `F2.5a/b`, `F2.7a/b`, `F3.3a/b`, `F4.3a/b`), não há referência a
   task inexistente nem label sem sufixo. DAG é “resumido”, mas a única omissão
   relevante é F0b.6.

### Recomendação de gate: GO

- B1/M1, B6 e M8 estão **resolvidos**; a conta da fixture longa é 1,68% (≤2%) e o
  teto de ciclo é 98,34%; as metas de custo steady/lifecycle são coerentes dentro do
  arredondamento (8,5× ↔ 8,47×) e passam no cenário longo.
- Antes de F0b.3 (criação de `surface_items`) aplicar a correção de 1 linha do `seq`
  no §5.3; antes de F1.2b/c ligar F0b.6 nas dependências/DAG; e ajustar a frase
  “sem DB” do §8.2. Nenhuma dessas é blocker arquitetural.
- Com isso: **GO**. Não é preciso PLAN-FIX 3; se o Lead preferir zero edição, as
  correções acima podem ser feitas como parte do próprio F0a/F0b.3.
