# Prompt caching por provedor — base de pesquisa para o plano de 98–99% de cache hit

> **Task**: `task-1` (board do time) · **autor**: `cache-provider-researcher` · **data da pesquisa**: 2026-10-29
> **Escopo**: OpenCode Go/Zen (gateway), OpenAI (`openai-chat` + `openai-responses`), Anthropic Messages (`anthropic`), Google Gemini (`google`), DeepSeek (context caching) e as implementações de referência do [OpenCode](https://github.com/anomalyco/opencode) e do **DeepSeek Harness (DSH)**.
> **Regras de leitura deste doc**: cada fato relevante vem marcado com **✅** (lido na fonte primária / código, com link) ou **⚠️** (inferência ou informação não confirmada numa fonte primária; explicitada). Valores de preço/mínimo podem mudar; confira a doc no momento da implementação. Nada aqui foi testado contra API real — é pesquisa documental/código.

---

## 0. TL;DR — o que muda o plano

1. **O maior ganho não é "ligar cache", é parar de quebrar o prefixo.** Nos quatro protocolos o cache é de **prefixo**: qualquer byte alterado antes do último ponto cacheado invalida dali para frente. No Lumina, o prefixo é quebrado por (a) data/hora no system prompt, (b) notas de mudança de modo anexadas ao system prompt no meio do turno, e (c) conteúdo `HistoryMessage::System` que é **hoisted** para o cabeçalho a cada request (ver §9.1). ✅
2. **Anthropic** é o único provedor dos quatro com controle explícito (`cache_control`): até **4 breakpoints**, mínimo de tokens cacheáveis **por modelo** (512–4.096), TTL **5 min** (padrão, write 1,25×) ou **1 h** (write 2×), leitura a **0,1×** (0,05×/0,025× em modelos novos), *lookback* de **20 blocos**, hierarquia **`tools` → `system` → `messages`**. Hoje o Lumina **não envia `cache_control` nenhum** e só lê `cache_read_input_tokens` (§9.3). ✅
3. **OpenAI** faz cache **automático** do contexto renderizado (instruções + tools + histórico); mínimo **1.024 tokens visíveis** no GPT‑5.6+ (modelo-dependente antes disso); `prompt_cache_key` ajuda no roteamento até GPT‑5.5 e serve para accounting depois; `prompt_cache_retention` (`in_memory`/`24h`) ou `prompt_cache_options.ttl` (`30m`/`12h`); leitura a **0,1×** (0,05× em GPT‑6.1 Sol/Terra); write **1,25×** (`30m`) / **2,5×** (`12h`) no GPT‑5.6+. ✅
4. **Google Gemini** só tem cache **implícito** no caminho `generateContent` do Lumina: mínimos de **2.048** (2.5 Flash/Pro) ou **4.096** (Gemini 4 Argon / 3.x); em **Gemini 4** o cache só vale se o request novo acrescentar **≥ 2.050 tokens** — incrementos menores reprocessam os últimos 2.050 tokens à tarifa cheia. Isso **limita o teto de hit%** em passos muito pequenos. Explicit `cachedContents` existe (TTL padrão 1 h, campo `cachedContent`) mas **não** no Gemini 4 Argon+ nem no Interactions API. ✅
5. **DeepSeek** tem cache de prefixo em disco automático com **unidades de prefixo** persistidas em limites de request / prefixo comum / intervalos fixos; mede-se por `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`; hit custa ~**50× menos** que miss (deepseek-flash off-peak: US$ 0,003 vs 0,15/1M). A granularidade "64 tokens" de docs antigas **não aparece** na doc atual. ✅/⚠️
6. **OpenCode Go/Zen** exige um `x-opencode-session` **estável por conversa** "to optimize routing and prompt caching" e trata o DSH como cliente problemático (header ausente em alguns caminhos). O Lumina **já envia** esse header com o `conversation_id` — é o único item do plano de cache já implementado no backend (§9.1). ✅
7. **OpenCode (fonte)** é a melhor referência de engenharia: a V2 tem uma `cache-policy` `auto` que coloca breakpoints em *last tool + first/last system + tail da conversa* com **cap de 4**, e exclui OpenAI/Gemini do lowering de hints; para OpenAI manda `prompt_cache_retention`/`prompt_cache_options` conforme a rota e clampa `prompt_cache_key` em **64 caracteres**. A V1 aplicava markers nos **2 primeiros system + 2 últimas mensagens**. ✅
8. **DSH** resolve o problema que mais interessa ao Lumina: system prompt renderizado **dentro do histórico** (surface node 0), atualização de prompt **`in-history`** (anexa depois do prefixo cacheado em vez de reescrever o head), compactação que **replaya o prefixo byte-a-byte** para reaproveitar o cache do provedor, e projeções de usage com `cacheReadTokens`/`cacheWriteTokens`/`uncachedInputTokens`. Porém **não** implanta cache breakpoints explícitos (`cache` hints não têm produtor) e **não** envia `x-opencode-session`. ✅
9. **Meta de 98–99% é viável só no steady state e por provedor.** Para Anthropic/OpenAI/DeepSeek a expectativa razoável é ~95–99% do *input* após o primeiro turno que escreve o cache; Gemini 4 em loop de agente tende a ficar abaixo por causa da regra dos 2.050 tokens; prompts abaixo do mínimo cacheável ficam em 0% por definição. O plano deve fixar SLO por provedor e medir `cache_read/(read+write+uncached)` **por request**, não por turno.

---

## 1. Matriz por protocolo/provedor

| Protocolo de wire (Lumina) | Provedor | Mecanismo real | Controle no request | Mínimo cacheável | TTL / retenção | Campos de usage | Preço relativo (read / write) |
|---|---|---|---|---|---|---|---|
| `anthropic` | Anthropic API | `cache_control` explícito + automatic (top-level) | `cache_control: {type:"ephemeral", ttl?}` em blocos de `tools`, `system`, `messages`; ou top-level | 512 / 1.024 / 2.048 / 4.096 tokens, **por modelo** ✅ | 5 min padrão (renova a cada hit); `ttl:"1h"` opcional | `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`, `usage.input_tokens` (só o que está após o último breakpoint) | read 0,1× (0,05×/0,025× em modelos novos); write 1,25× (5 min) ou 2× (1 h) ✅ |
| `openai-chat` | OpenAI API | Automático, prefixo renderizado | `prompt_cache_key?`, `prompt_cache_retention?`/`prompt_cache_options.ttl?` (modelo > GPT‑5.6); breakpoints explícitos só no Responses (GPT‑5.6+) | **1.024 tokens visíveis** (GPT‑5.6+); modelo-dependente antes; GPT‑5.5 usa intervalos de 2.048 ✅ | `in_memory` (~5–10 min) ou `24h` (modelos antigos); GPT‑5.6+: mínimo 30 min ou 12 h | `usage.prompt_tokens_details.cached_tokens`, `.cache_write_tokens`; GPT‑5.6+ `cache_write_tokens_details.ttl_30m/12h` ✅ | read 0,1× (0,05× GPT‑6.1 Sol/Terra); write 1,25× (`30m`)/2,5× (`12h`) no GPT‑5.6+ ✅ |
| `openai-responses` | OpenAI API / plan OAuth | idem + `prompt_cache_options` (ttl/mode/prewarm) no GPT‑5.6+ | `prompt_cache_key?`, `prompt_cache_retention` (modelos antigos), `prompt_cache_options` (`ttl`, `mode:"explicit"`, `prewarm`, `prompt_cache_breakpoint` em blocos) | idem | idem | `usage.input_tokens_details.cached_tokens`, `cache_write_tokens`, `cache_write_tokens_details` ✅ | idem |
| `google` | Gemini API (`generateContent`) | **Implícito** (2.5+) | nenhum no `generateContent` implícito; explícito exige criar `cachedContents` e mandar `cachedContent` | **2.048** (2.5 Flash/Pro) ou **4.096** (Gemini 4 Argon, 3.8 Flash, 3.6 Flash, 3.1 Pro Preview) ✅ | implícito: não documentado (dica: "similar prefix in a short amount of time"); explícito: TTL padrão 1 h, sem mínimo/máximo de TTL ✅ | `usageMetadata.cachedContentTokenCount` (generateContent); `usage.total_cached_tokens` (Interactions) ✅ | cached input com desconto; cobrada a **armazenagem** no explícito ✅ |
| `openai-chat` usado com DeepSeek | DeepSeek API | Cache de prefixo em **disco**, automático | nenhum campo; depende só do prefixo | unidades de prefixo (ver §5) — não há "mínimo de tokens" documentado ✅ | melhor esforço; limpo "de horas a dias" | `usage.prompt_cache_hit_tokens`, `usage.prompt_cache_miss_tokens` ✅ | hit ~50× mais barato que miss (deepseek-flash) ✅ |
| `openai-chat`/`anthropic`/`google` via gateway | OpenCode Go / Console (ex-"Zen") | Gateway traduz protocolos; cache do provedor de origem + billing de cache do gateway | `x-opencode-session` (header, obrigatório/recomendado) + os controles nativos que o gateway repassa | herdado do provedor | herdado do provedor | usage nativo + bloco `usage.opencode.tokens.cache_read`, `cache_write_5m`, `cache_write_1h` ✅ | tabelas de preço têm colunas **Cached Read/Cached Write** ✅ |

---

## 2. Anthropic Messages (wire `anthropic`)

### 2.1 Duas formas de ligar

- **Automática**: um único campo **no topo do body** `"cache_control": {"type": "ephemeral"}`. O sistema aplica o breakpoint **no último bloco cacheável** e o move para frente conforme a conversa cresce; usa **1 dos 4 slots** de breakpoint. ✅ ([doc](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), seção *Automatic caching*)
- **Explícita**: `cache_control` em blocos individuais (`tools[]`, `system[]`, `messages[].content[]`). ✅ (mesma página, *Explicit cache breakpoints*)
- **Mistura**: permitida; se o topo for automático e o último bloco já tiver `cache_control` com TTL igual, o automático é no-op; TTL diferente → **400**; 4 breakpoints explícitos já existentes → **400** (sem slot para o automático). ✅
- `ephemeral` é o **único** tipo suportado hoje; o padrão é 5 min. ✅

### 2.2 O que entra no prefixo e onde o breakpoint pode ficar

> "Prompt caching references the entire prompt: `tools`, `system`, and `messages` (in that order), up to and including the block designated with `cache_control`." ✅

- Cacheáveis: definições de tool (`tools`), blocos de `system`, blocos de texto em `messages.content` (user e assistant), imagens/documentos em turnos de usuário, tool use e tool results. ✅
- **Não** cacheáveis diretamente: blocos de *thinking* (mas são cacheados "de carona" quando aparecem em turnos anteriores), sub-blocos (ex.: citações), blocos de texto vazios. ✅
- Hierarquia de invalidação: mudança em `tools` invalida tools+system+messages; mudança em `system` invalida system+messages; `tool_choice`/imagens invalidam só messages. ✅ (tabela *What invalidates the cache*)
- **Cache writes só acontecem no breakpoint**; cache reads olham para **trás** até 20 blocos procurando entradas **já escritas** em requests anteriores. Não é "encontrar conteúdo estável atrás do breakpoint" — é encontrar escritas anteriores. ✅
- Regra prática da doc: coloque o breakpoint **no último bloco cujo prefixo é idêntico** entre os requests que devem compartilhar cache. ✅

### 2.3 Limites que definem a estratégia

| Limite | Valor | Fonte |
|---|---|---|
| Breakpoints por request | **4** (automático consome 1) | ✅ doc *When to use multiple breakpoints* |
| *Lookback* de cache read | **20 blocos** (blocos `tool_use`/`tool_result` consecutivos contam como 1 posição) | ✅ doc |
| Mínimo cacheável (modelos atuais) | 512 tokens: Fable 5.1, Mythos 5.1, Opus 5.5, Opus 5, Sonnet 5.5, Fable 5, Mythos 5, Haiku 5.5 · 1.024: Opus 4.8, Sonnet 5, Sonnet 4.6/4.5, Opus 4.1, Opus 4, Sonnet 4 · 2.048: Mythos Preview, Opus 4.7, Haiku 3.5 · 4.096: Opus 4.6, Opus 4.5, Haiku 4.5 | ✅ doc *Cache limitations* |
| Prompt abaixo do mínimo | processado **sem cache**, sem erro; `cache_creation` e `cache_read` ficam 0 | ✅ |
| TTL padrão | 5 min a partir do **início** do request que escreve/lê; renovado sem custo a cada hit | ✅ |
| TTL 1 h | `{"type":"ephemeral","ttl":"1h"}`; write 2× o preço base; entra **antes** dos de 5 min se misturar TTLs | ✅ |
| Concorrência | a entrada só fica disponível **depois que a primeira resposta começa**; para hits em paralelo, espere a primeira resposta | ✅ |

### 2.4 Preço (multiplicadores)

- Cache **write** 5 min = **1,25×** o preço de input base; 1 h = **2×**; cache **read** = **0,1×** (exceções por modelo: 0,05× em Opus 5.5/Sonnet 5.5; 0,025× em Fable 5.1/Mythos 5.1). ✅
- Breakpoints em si **não custam**; você paga write/read/input normal. ✅

### 2.5 Usage (como medir)

```
total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens
```

`input_tokens` no Anthropic é **apenas** o que vem **depois do último breakpoint** (não é o total do request). ✅
`cache_creation_input_tokens` = tokens antes do breakpoint sendo **escritos** agora; `cache_read_input_tokens` = lidos do cache. ✅

### 2.6 Extras úteis para o plano

- **Prewarm**: `max_tokens: 0` faz o request ler o prompt, escrever o cache no breakpoint e retornar sem gerar output (rejeitado com `stream:true`, thinking, structured outputs e `tool_choice` forçado; proibido em Batch). Coloque o breakpoint no último bloco compartilhado com o request real (system/tools), não na mensagem "warmup". ✅
- **System message no meio da conversa**: em modelos novos (Fable 5.1/Mythos 5.1/Fable 5/Mythos 5/Opus 5.5/Opus 4.8/Opus 5/Sonnet 5.5/Haiku 5.5 — **não** Sonnet 5), dá para **anexar** `{"role":"system"}` em `messages` em vez de editar o `system` do topo: o prefixo cacheado continua válido. É exatamente o padrão "in-history" do DSH (§8). ✅
- **Mudanças que invalidam mensagens mesmo sem tocar no texto**: parâmetros de *thinking* (modo/`budget_tokens`) e `output_config.effort` são renderizados no prompt; mudar invalida message blocks (e, em alguns modelos, tools/system também). `speed:"fast"` invalida system+messages. ✅
- **Ferramentas no meio da conversa** (`inline-tools-2026-09-15` beta): adicionar tool via `tool_addition` em system message mantém o prefixo; editar `tools` invalida tudo. ✅

### 2.7 Trecho de request canônico (do que o Lumina precisa emitir)

```json
{
  "model": "claude-...",
  "max_tokens": 4096,
  "system": [
    {"type": "text", "text": "<system prompt estável>"},
    {"type": "text", "text": "<contexto estável adicional>",
     "cache_control": {"type": "ephemeral"}}
  ],
  "tools": [
    {"name": "tool_a", "...": "..."},
    {"name": "tool_b", "...": "...", "cache_control": {"type": "ephemeral"}}
  ],
  "messages": [
    {"role": "user", "content": [{"type": "text", "text": "<msg>"}]},
    {"role": "assistant", "content": "..."},
    {"role": "user", "content": [
      {"type": "text", "text": "<mensagem atual>", "cache_control": {"type": "ephemeral"}}
    ]}
  ]
}
```

> ⚠️ Observação: o exemplo acima usa 3 breakpoints (system, última tool, cauda). Um 4º pode ir no "primeiro system + primeiro user estável" se o *lookback* de 20 blocos for apertado em turnos com muitos tool calls. ✅ a doc recomenda breakpoints extras justamente para turnos que andam >20 blocos desde o último write.

---

## 3. OpenAI (wire `openai-chat` e `openai-responses`)

### 3.1 Mecânica: automático sobre o prefixo **renderizado**

- "OpenAI caches the model's full rendered context including OpenAI-provided instructions, developer messages, tool definitions, and conversation history" — **texto, imagens, documentos e áudio suportado**. ✅ ([doc](https://developers.openai.com/api/docs/guides/prompt-caching.md))
- A reutilização exige que o **prefixo renderizado inteiro** seja igual. Mudou conteúdo **ou setting relevante** antes de um breakpoint, o cache dali para frente não casa. ✅
- Settings que afetam o prefixo: `model`, `tools` (nomes/descrições/schemas/ordem), `parallel_tool_calls`, `text.format` (structured outputs), `reasoning.effort`, `text.verbosity`, `context_management`/compactação. ✅ (tabela *Which settings affect the cached prefix?*)
- Cache é **por máquina** (KV tensors em GPU-local, não compartilhado entre organizações/regiões); acima de ~15 req/min pode haver overflow de roteamento. ✅
- O cache **não afeta geração** (mesmo prompt ≠ mesmo output) e **não** pode ser limpo manualmente; tokens cacheados **contam** nos rate limits. ✅

### 3.2 Breakpoints e mínimos

**GPT‑5.6 e posteriores** ✅:
- Mínimo: **1.024 tokens visíveis** (tokens do system content oculto da OpenAI não contam).
- **Modo implícito** (padrão): OpenAI coloca breakpoint no fim da **última mensagem elegível** — `user`, último `tool response` de um grupo consecutivo, ou último `developer` do bloco inicial de developers. Até **20 finais de mensagens anteriores** e o fim do bloco inicial de developers também são candidatos de lookup. O breakpoint implícito usa **1 dos 4 slots** de cache write.
- **Modo explícito**: `prompt_cache_options.mode = "explicit"` + `prompt_cache_breakpoint: {"mode":"explicit"}` em blocos suportados (`input_text` de developer/user/tool output). Sem breakpoint explícito, **não** há cache write. Até **4** writes por request. `instructions` de topo **não** aceita breakpoint (mova para `developer` + `input_text`). `additional_tools` não aceita breakpoint.
- **Escrita explícita evita cobrar write do que muda**: conteúdo após o último breakpoint é processado à tarifa de input sem cache write.
- **Lookup**: modo explícito olha "primeiros 2 + últimos 50 breakpoints explícitos"; implícito olha esses + breakpoint implícito + até 20 finais elegíveis + fim do bloco inicial de developers.
- `cached_tokens` reportado = boundary elegível exato (excluindo tokens ocultos).

**Modelos anteriores (ex.: GPT‑5.5)** ✅:
- Só implícito; breakpoints em intervalos regulares (GPT‑5.5: **2.048 tokens**; outros: intervalos modelo-dependentes), contados do início do system oculto.
- `cached_tokens` exclui tokens ocultos e é arredondado **para baixo em múltiplos de 128**; mínimo depende de settings do request.

### 3.3 `prompt_cache_key` (roteamento e accounting)

- **Antes do GPT‑5.6**: use uma chave **estável** para requests que compartilham prefixo, para ajudar o roteamento à mesma máquina; alvo de ~**15 req/min** por chave; se passar, particione em várias chaves com mapeamento determinístico. A chave **influencia** roteamento, não garante hit. ✅
- **GPT‑5.6+**: roteamento é automático; a chave serve para **separar accounting** (por cliente/usuário/workspace) e evitar *cache-hit probing* entre usuários. ✅
- Limite prático: **64 caracteres** — `OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64`, clamp *unicode-aware* e gated por `supportsPromptCacheKey` no fonte do OpenCode ([`shared.ts`](https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/protocols/shared.ts)). ✅ (a doc oficial não cita o limite; ⚠️ esse número vem do código do OpenCode)
- Para o Lumina: chave natural = **`conversation_id`** (estável por conversa, ≤64 chars), **nunca** o `message_id`/request id.

### 3.4 Retenção / TTL

- **GPT‑5.6+** (Responses API): `prompt_cache_options.ttl` = `"30m"` (padrão; write 1,25×) ou `"12h"` (write 2,5×; leitura igual). `prewarm: true` prepara o cache sem gerar output. `ttl` do request vale para o breakpoint implícito e explícitos sem TTL próprio; `prompt_cache_breakpoint.ttl` sobrescreve por breakpoint. Misturar TTLs é permitido (12 h cobre o prefixo anterior); upgrade 30 min→12 h cobra write novo. ✅
- **Modelos anteriores**: `prompt_cache_retention` = `"in_memory"` (~5–10 min ocioso, até 1 h) ou `"24h"` (~30 min típico, até 24 h). Default depende da política de retenção da organização: sem ZDR → `24h`; com ZDR → `in_memory`. ✅
- ⚠️ **Atenção**: no fonte do OpenCode, `prompt_cache_retention` só aceita TTL `"24h"` ou `"in_memory"`; qualquer outro valor vai para `prompt_cache_options.ttl` ([`protocols/utils/cache.ts`](https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/protocols/utils/cache.ts)). Isso é código, não doc oficial.

### 3.5 Usage (como medir)

```json
{
  "usage": {
    "input_tokens": 12000,
    "input_tokens_details": {
      "cached_tokens": 4000,
      "cache_write_tokens": 7000,
      "cache_write_tokens_details": { "ttl_30m_tokens": 3000, "ttl_12h_tokens": 4000 }
    }
  }
}
```

- `cached_tokens` = **reads cobrados** (exclui tokens cobrados como write e upgrades 30 min→12 h). ✅
- Ordinary input = `input_tokens − cached_tokens − cache_write_tokens`. ✅
- Hit rate = `total cached tokens / total input tokens`, agregando por usuário/workspace/dia. ✅
- ⚠️ No GPT‑5.6+ `input_tokens` é inclusivo (cached é subconjunto), como no Chat Completions. Não confundir com Anthropic, cujo `input_tokens` é só a cauda (§2.5).

### 3.6 `store: false` e o perfil ChatGPT‑plan/OAuth

- A doc **oficial** do fluxo "Sign in with ChatGPT / token sharing" manda literalmente: **"Set `store` to `false` and `stream` to `true` on each HTTP inference request."** e usar `POST https://api.openai.com/v1/responses` (não os endpoints `backend-api` do ChatGPT). ✅ ([models-and-inference.md](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference.md))
- Prompt caching é **compatível com Zero Data Retention**: o cache guarda KV tensors cifrados, não o texto; retenção máxima de 24 h; caches não cruzam organizações nem fronteiras regionais. ✅ (doc de caching, *Data retention*)
- ⚠️ **Não verificado em fonte primária**: a doc do caminho OAuth/ChatGPT‑plan **não menciona** caching nem `prompt_cache_key`. A pesquisa interna do time ([`openai-oauth.md`](./openai-oauth.md)) registra `prompt_cache_key` como "não citado (não listado como proibido)" e `store:false` como obrigatório (§4.1 do doc interno). Trate `prompt_cache_key` nesse perfil como **probe**, não como fato.
- O Lumina já tem o perfil `ChatgptPlan` correto no essencial: `store:false`, `stream:true`, `include:["reasoning.encrypted_content"]`, whitelist de campos que **exclui** `prompt_cache_retention` e `max_output_tokens`/`temperature`/`metadata` etc. (§9.5).

### 3.7 Armadilhas documentadas (valem para o Lumina)

1. **Prefixo compartilhado ≠ prefixo cacheado**: se você escreve o cache implicitamente "atravessando" conteúdo dinâmico, mudar o dinâmico impede até o prefixo menor de casar; a correção é breakpoint **explícito** após o conteúdo estático (ou modo explícito). ✅
2. **Estender uma mensagem existente** (`Content A` → `Content A + Content B`) impede reutilizar o prefixo salvo no fim de `Content A` (o endpoint antigo deixa de ser fim de mensagem). Prefira **anexar nova mensagem**. ✅
3. **Developer messages depois do bloco inicial** não são boundaries automáticos no modo implícito; marque explicitamente. ✅
4. **Trocar para `mode:"explicit"`** pode perder o write implícito do request anterior (lookup só olha breakpoints explícitos do request atual). ✅
5. **Compactação** muda o prefixo: primeiro request pós-compactação pode reaproveitar muito menos; compare custo total (menos tokens pode compensar hit menor). ✅
6. **Mínimo varia por modelo**: um prefixo cacheável em um modelo pode não ser em outro; recheck ao trocar modelo. ✅

---

## 4. Google Gemini (wire `google`)

### 4.1 Implícito (o que o Lumina usa hoje)

- Ligado por padrão em **Gemini 2.5+**; sem configuração. ✅ ([doc caching](https://ai.google.dev/gemini-api/docs/caching))
- Mínimos por modelo ✅:

| Modelo | Mínimo de tokens |
|---|---|
| Gemini 4 Argon | 4.096 |
| Gemini 3.8 Flash | 4.096 |
| Gemini 3.6 Flash | 4.096 |
| Gemini 3.1 Pro Preview | 4.096 |
| Gemini 2.5 Flash | 2.048 |
| Gemini 2.5 Pro | 2.048 |

- Dicas oficiais para aumentar hit: **conteúdo grande e comum no começo** do prompt e **requests com prefixo similar em pouco tempo** (o TTL implícito não é documentado). ✅
- **Regra crítica do Gemini 4 (Argon+) para agentes**: "Gemini caches the full previous request only if the new request adds at least **2.050 tokens**. Model output, thought, and function results all count toward this total. For smaller additions, Gemini re-processes the last 2.050 tokens of the previous request at the standard input rate." ✅
  - Consequência para a meta de 98–99%: em turnos pequenos (ex.: um tool result curto) o cache **não** avança; o hit% medido cai. Não é bug do integrador; é o desenho.
- Usage ✅: `usage_metadata.cachedContentTokenCount` no `generateContent` (o doc da API legacy diz "usage_metadata field"; a doc nova fala `usage.total_cached_tokens` para a **Interactions API**). No wire do Lumina, o campo é `cachedContentTokenCount`.

### 4.2 Explícito (`cachedContents`)

- Beta, `v1beta`; **não suportado** no Interactions API nem no **Gemini 4 Argon e posteriores** — nesses, só implícito. ✅ ([doc legacy](https://ai.google.dev/gemini-api/docs/generate-content/caching))
- Fluxo: `POST /v1beta/cachedContents` com `model`, `contents[]`, `systemInstruction`, `tools[]`, `ttl`/`expireTime` (padrão **1 hora**); depois `POST /models/{model}:generateContent` com `"cachedContent": "<nome>"`. ✅
- Availability: `cachedContent` agora é só o **ponteiro**; o conteúdo cacheado é imutável (dá para atualizar só `ttl`/`expireTime`). ✅
- Cobrança: tokens cacheados (com desconto) **+ armazenagem pelo TTL**; sem limites mínimo/máximo de TTL; o mínimo de **input tokens cacheáveis varia por modelo** (a doc não enumera a tabela do explícito; ⚠️ fontes secundárias citam 2.048 para 2.0/2.5 e 4.096 para Gemini 3/3.1 — não verificado na fonte primária). ✅/⚠️
- "The model doesn't make any distinction between cached tokens and regular input tokens. Cached content is a prefix to the prompt." ✅

### 4.3 O que a fonte do OpenCode diz (visão de quem já implementou)

- No `cache-policy.ts` do OpenCode, Gemini **não** respeita hints inline; e o comentário é direto: "Gemini uses only the last breakpoint, so a conversation-tail breakpoint writes a new cache every step and costs more than none." ✅ ([cache-policy.ts](https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/cache-policy.ts))
- O protocolo Gemini do OpenCode aceita `cachedContent` como opção de provider e mapeia `cachedContentTokenCount` → `cacheReadInputTokens`; **não** emite `cache_control`/breakpoint. ✅ ([gemini.ts](https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/protocols/gemini.ts))
- ⚠️ Interpretação: para o Lumina, a estratégia no `google` deve ser "prefixo estável + medir"; explicit caching só compensa para um bloco grande e realmente reutilizado (ex.: documentos colados/anexos grandes), não para o system prompt pequeno de cada sessão.

---

## 5. DeepSeek context caching (usado pelo Lumina/DSH via protocolo OpenAI)

Fonte: [api-docs.deepseek.com/guides/kv_cache](https://api-docs.deepseek.com/guides/kv_cache) ✅

- **Automático e em disco** para todos os usuários, sem mudar código. Cada request dispara construção de cache; requests seguintes com **prefixo sobreposto** pagam só o hit. ✅
- Com o *Sliding Window Attention*, cada prefixo cacheado é uma **unidade independente e completa**: o hit exige casar **integralmente** uma "cache prefix unit". ✅
- Onde as unidades são persistidas ✅:
  1. **Fronteiras de request**: no fim do input do usuário e no fim da saída do modelo;
  2. **Detecção de prefixo comum** entre múltiplos requests (persistido como unidade própria);
  3. **Intervalos fixos de tokens** em inputs/saídas longos, para não deixar prefixos longos sem unidade.
- Exemplo 2 da doc (o mais importante para o Lumina): requests `A+B` e `A+C` não dão hit direto, mas o sistema detecta `A` comum e o persiste; o **terceiro** request `A+D` dá hit em `A`. Ou seja: o **primeiro** turno de uma variação paga miss; a estabilização vem depois. ✅
- Usage ✅: `usage.prompt_cache_hit_tokens` e `usage.prompt_cache_miss_tokens`.
- Preço ✅ ([pricing](https://api-docs.deepseek.com/quick_start/pricing/)): deepseek-flash, off-peak: cache hit **US$ 0,003**/1M vs miss **US$ 0,15**/1M (~50×); peak: 0,006 vs 0,30. deepseek-v4-pro: 0,022 vs 0,66 (off-peak).
- Limites: **best-effort**, sem garantia de 100%; construção leva segundos; cache é limpo quando ocioso ("horas a dias"). ✅
- ⚠️ **Correção de folclore**: a doc **atual** não fala mais em "granularidade de 64 tokens" (isso era das docs antigas da era V2). A unidade hoje é o **prefixo completo persistido**; o "64" aparece em fontes antigas/terceiros. Não use 64 como premissa de design sem revalidar.
- Implicação: para DeepSeek, **não há campo a mandar**. O trabalho é 100% prefixo estável + não reescrever history + medir `hit/miss` (o adaptador DSH `dsh-llm-deepseek` faz exatamente esse mapeamento — §8.5).

---

## 6. OpenCode Go/Zen (gateway)

### 6.1 O que é

- **OpenCode Go**: assinatura (Go US$ 10/mês, Go Plus US$ 40/mês, Go Teams US$ 20/membro/mês) com limites mensais por modelo; endpoints `https://opencode.ai/inference/go/{openai|anthropic|google}/...`. ✅ ([Go](https://opencode.ai/v2/docs/console/go/))
- **OpenCode Console** (pay-as-you-go): o antigo nome **"Zen"** hoje redireciona para a doc do Console (`https://opencode.ai/docs/zen/` → `https://opencode.ai/v2/docs/console/models/` — redirecionamento observado). ✅ ([Models](https://opencode.ai/v2/docs/console/models/))
- O gateway **traduz protocolos**: cada modelo tem uma API "nativa" (OpenAI, Anthropic ou Gemini), mas "every text model also works through the other APIs, which Console translates". ✅

### 6.2 `x-opencode-session` — papel documentado

> "Your client should: 1. Send typical coding agent traffic 2. Identify itself with its own user agent … 3. **Send a stable session ID in `x-opencode-session` for each conversation so we can optimize routing and prompt caching.**" ✅ ([Go, seção "Where can I use it?"](https://opencode.ai/v2/docs/console/go/))

- Clientes validados que mandam o header: Hermes (≥ v0.21.6), Claude Code/Codex (header nativo), ZCode, Pi, jcode, Kilo Code CLI. ✅
- **Clientes problemáticos conhecidos** incluem **DeepSeek Harness**: "Session information arrives on some model paths, but is missing on others. We recognize its native header; the remaining work is to send it across all adapters." ✅ — é a confirmação de que o DSH **não** manda `x-opencode-session` hoje (§8.6).
- ⚠️ Secundário: post oficial do OpenCode no X (via resultado de busca) diz que ferramentas sem o header "prevents optimization of prompt caching" e que "Starting 09/06 requests missing this header may error". Não consegui abrir o X; trate como aviso, não como contrato.

### 6.3 Cache do gateway (o que dá para medir)

- O gateway devolve, além do usage nativo (`usage` p/ OpenAI/Anthropic, `usageMetadata` p/ Gemini), um bloco de custo ✅ ([Inference API](https://opencode.ai/v2/docs/console/api/inference/)):

```json
"usage": {
  "prompt_tokens": 1200, "completion_tokens": 300, "cost": 0.00412,
  "opencode": {
    "billing_source": "balance",
    "list_cost": 0.00412,
    "tokens": { "input": 1200, "output": 300, "reasoning": 120, "cache_read": 8000, "cache_write_5m": 0, "cache_write_1h": 0 }
  }
}
```

- `opencode.tokens.input` **exclui** cache reads/writes; `output` inclui reasoning; `billing_source` ∈ `free|balance|go|go-plus|byok`; `opencode.allowance` (Go) = quanto o request contou do limite mensal. ✅
- As tabelas de preço do gateway têm colunas **Cached Read** e **Cached Write** por modelo (ex.: Claude Haiku 5.5 read 0,01 / write 0,125; GPT 6.1 Sol read 0,10 / write 2,50; Gemini 4 Argon read 0,10; DeepSeek V4.1 Flash read 0,006). ✅ ([Models](https://opencode.ai/v2/docs/console/models/), [Go](https://opencode.ai/v2/docs/console/go/))
- **Warming**: feature oficial para preservar cache do provedor — a cada **4 min** ocioso, até **30 min** desde o último request não-warming; prompt "no work, reply OK", descartado; **desligado por padrão**; requests reais pagam tokens. ✅ ([Warming](https://opencode.ai/v2/docs/warming/))
- ⚠️ **Não verificado**: se o gateway reescreve/adiciona `cache_control`/`prompt_cache_key` por conta própria quando traduz protocolo, e se ele preserva os breakpoints do cliente no caminho Anthropic→outro. A doc não afirma isso; a leitura do fonte do gateway (fechado/infra) não foi feita.

---

## 7. Como o OpenCode implementa prompt caching (fonte)

Repositório: `github.com/sst/opencode` hoje redireciona para **`github.com/anomalyco/opencode`** (API do GitHub confirmou o redirect); os caminhos abaixo são do branch **`dev`** (V2) e do branch **`v1`** (V1 legado). ⚠️ O repo mudou de estrutura: a V2 vive em `packages/ai`, a V1 em `packages/opencode`.

### 7.1 V2 — `packages/ai/src/cache-policy.ts` (a política `auto`)

Trecho real ✅ ([raw](https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/cache-policy.ts)):

```ts
const AUTO: CachePolicyObject = {
  tools: true,
  system: true,
  messages: { tail: 1 },
}
const BREAKPOINT_CAP = 4
// The default "auto" shape places breakpoints at the last tool definition,
// the first and last distinct system parts, and the conversation tail. This
// exposes reusable tool, base-agent, project, and session prefixes while
// advancing the tail after each tool result keeps recent conversation prefixes
// reusable during long agent runs.
```

- **4 é o teto**, e hints manuais contam no orçamento; `auto` só preenche slots restantes. ✅
- Protocolos que **ignoram** hints inline (`RESPECTS_INLINE_HINTS`): `alibaba-chat`, `alibaba-messages`, `bedrock-converse`, `openrouter`, `digitalocean`, etc. **OpenAI e Gemini não estão na lista** — logo são tratados como cache implícito e o lowering de hints é pulado. ✅
- `selectPolicy` decide por `compatibility.cacheFormat` (`anthropic` → usa `resolve`; `alibaba` → QWEN) e por rota; para OpenRouter/Vercel, `gatewayPolicy` usa AUTO só para IDs `anthropic/*`, QWEN para qwen, NONE para o resto. ✅

### 7.2 V2 — `packages/ai/src/protocols/utils/cache.ts` (lowering)

Trecho real ✅ ([raw](https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/protocols/utils/cache.ts)):

```ts
export const cacheControl = () => {
  const breakpoints = newBreakpoints(4)
  return (cache: CacheHint | undefined) => {
    if (cache === undefined || breakpoints.remaining === 0) return undefined
    breakpoints.remaining -= 1
    return { type: "ephemeral" as const, ttl: cache.ttl }
  }
}
// OpenAI's request-level lifetime. `prompt_cache_retention` takes only "24h" (or "in_memory") and is the only
// control before GPT-5.6; every other lifetime goes to `prompt_cache_options.ttl`, which GPT-5.6+, Kimi and
// DeepInfra read.
export const openAIRequestTTL = (ttl: CacheTTL | undefined) => {
  if (ttl === undefined) return {}
  if (ttl === "24h") return { prompt_cache_retention: ttl }
  return { prompt_cache_options: { ttl } }
}
```

### 7.3 V2 — `packages/ai/src/protocols/openai-chat.ts`

- O schema do body **inclui** `store`, `prompt_cache_key`, `prompt_cache_retention`, `prompt_cache_options` ✅ (raw acima).
- `lowerOptions` (trecho real ✅):

```ts
const cacheKey =
  (request.model.compatibility?.supportsPromptCacheKey ?? false) ? ProviderShared.promptCacheKey(request) : undefined
return {
  ...(supportsStore ? { store: options.store ?? false } : {}),
  ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
  // Inline markers carry the lifetime when the policy places them.
  ...(placesMarkers(request) ? {} : Cache.openAIRequestTTL(requestTTL(request))),
  ...
}
```

  - `store` só é enviado se a compatibilidade permitir (default **false** quando envia); `prompt_cache_key` é **opt-in** por modelo; o TTL de request só vai quando **não** há markers inline. ✅
- `mapUsage` normaliza cache hit de vários provedores no mesmo campo (trecho real ✅):

```ts
// Providers differ on cache-hit location: OpenAI uses
// `prompt_tokens_details.cached_tokens`, DeepSeek uses
// `prompt_cache_hit_tokens`, Zai uses top-level `cached_tokens`, and
// DigitalOcean uses top-level `cache_read_input_tokens` / `cache_created_input_tokens`.
const cached =
  usage.prompt_tokens_details?.cached_tokens ??
  usage.prompt_cache_hit_tokens ??
  usage.cached_tokens ??
  usage.cache_read_input_tokens ?? undefined
const cacheWrite = usage.prompt_tokens_details?.cache_write_tokens ?? usage.cache_created_input_tokens ?? undefined
```

### 7.4 V2 — `packages/ai/src/protocols/openai-responses.ts`

- Body carrega `prompt_cache_retention` e `prompt_cache_options` ✅; `...Cache.openAIRequestTTL(requestTTL(request))` é aplicado no `fromRequest` ✅.
- Defaults da rota (trecho real ✅): `defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } }` — ou seja, **Responses do OpenCode já nasce stateless**.
- Transporte WebSocket (opcional) mantém uma conexão por sessão e "Consecutive steps reuse the unchanged request prefix and only send content added since the previous response" ✅ ([Providers doc](https://opencode.ai/v2/docs/providers/)) — outra forma de reduzir upload/prefixo, mas não é cache de KV.

### 7.5 V2 — `packages/ai/src/protocols/shared.ts` (limite de 64 chars)

```ts
export const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64
// OpenAI limits `prompt_cache_key` to 64 chars; DeepSeek and Zai inherit the same
// limit via their OpenAI-compatible APIs. Clamp with unicode-aware slicing.
export const promptCacheKey = (request: LLMRequest): string | undefined => { ... }
```

✅ ([raw](https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/protocols/shared.ts))

### 7.6 V2 — `packages/ai/src/protocols/gemini.ts`

- `GeminiBodyFields` inclui `cachedContent: Schema.optional(Schema.String)`; usage `GeminiUsage` inclui `cachedContentTokenCount`; `mapUsage` mapeia para `cacheReadInputTokens`; comentário: "Gemini reports `promptTokenCount` (inclusive total) with a `cachedContentTokenCount` subset". ✅ (raw acima)
- Não há lowering de markers de cache para Gemini (coerente com a política). ✅

### 7.7 V1 — headers de sessão por provider (o que interessa ao gateway)

`packages/opencode/src/session/llm/request.ts` (branch `v1`), trecho real ✅ ([raw](https://raw.githubusercontent.com/sst/opencode/v1/packages/opencode/src/session/llm/request.ts)):

```ts
headers: {
  "x-opencode-session-id": input.sessionID,
  ...(input.parentSessionID ? { "x-opencode-parent-session-id": input.parentSessionID } : {}),
  ...(input.model.providerID.startsWith("opencode")
    ? {
        ...(opencodeProjectID ? { "x-opencode-project": opencodeProjectID } : {}),
        "x-opencode-session": input.sessionID,
        "x-opencode-request": input.user.id,
        "x-opencode-client": input.flags.client,
        "User-Agent": USER_AGENT,
      }
    : {
        "x-session-affinity": input.sessionID,
        "X-Session-Id": input.sessionID,
        "User-Agent": USER_AGENT,
      }),
  ...
}
```

- `x-opencode-session` só para providers `opencode*`; os demais recebem headers de afinidade (`x-session-affinity`, `X-Session-Id`). ✅
- `packages/opencode/src/provider/transform.ts` (branch `v1`) aplica markers de cache **nos 2 primeiros system + nas 2 últimas mensagens** de cada request, com `cacheControl` por SDK (anthropic/openrouter/bedrock/openaiCompatible/copilot/alibaba) ✅ — é a estratégia V1; a V2 generalizou para a `cache-policy` com tail.

### 7.8 V1 — `promptCacheKey` derivado da sessão

Trecho real ✅ (mesmo `transform.ts`):

```ts
if (input.providerOptions?.setCacheKey !== false) {
  if (input.model.api.npm === "@ai-sdk/deepinfra" || input.model.api.npm === "@ai-sdk/cerebras") {
    result["prompt_cache_key"] = input.sessionID
  } else if (input.model.api.npm === "@ai-sdk/openai" || ... || input.providerOptions?.setCacheKey === true) {
    result["promptCacheKey"] = input.sessionID
  }
}
...
if (input.model.providerID.startsWith("opencode") && input.providerOptions?.setCacheKey !== false) {
  result["promptCacheKey"] = input.sessionID
  result["include"] = INCLUDE_ENCRYPTED_REASONING
  result["reasoningSummary"] = "auto"
}
```

- Ou seja: `prompt_cache_key` = **session id**; e para providers OpenCode o AI SDK recebe `promptCacheKey` + `include` de reasoning. ✅
- ⚠️ Na V2 o caminho mudou (o gateway em si usa o header; o body `prompt_cache_key` passou a ser explícito via compat), mas a **ideia** de chave estável por conversa é a mesma.

---

## 8. Como o DeepSeek Harness (DSH) gerencia o cache

Fonte local (pacotes extraídos do asar em `H:\ChatTauri\.research\asar-out\dsh\node_modules\@deepseek-ai\`). Abaixo, pacote + trecho real.

### 8.1 `dsh-agent-loop` — o request e o efeito no KV cache

Trecho real ✅ ([README.md](../../.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-agent-loop/README.md), L157/L165):

> "The request header always records active tools. … The request is `header.config`, `deriveMessages()`, and `header.tools`; it carries no `system` field." (L121/L157)
>
> "Prefix reuse requires earlier messages and declarations to stay **byte-identical** under the same provider and model route. An unchanged rendered prompt keeps the cached prefix unless an incapable route or a new request series must consolidate retained in-history system nodes. A prompt change that replaces a system node in place makes the request differ from that node's first token — in full when the node is node 0 — so the provider prefix cache misses from there; when the prepared call declares `systemPromptUpdate: 'in-history'`, a non-empty prompt change inside a continuing request series is **appended after the cached history**, so the prefix through that history stays reusable. Changing a retained tool definition or rebuilding declarations invalidates reuse from the first altered request token." (L165)
>
> "Ordinary history growth is **append-only** and preserves reusable entries. A surface replacement or compaction invalidates reuse from the first shadowed history token." (L179)

- Regras de reconciliação (L123): em rota incapaz ou nova série, o prompt não-vazio é **consolidado** no primeiro system node (reescreve o head); em série `in-history`, prompt inalterado não emite evento e mudança não-vazia **anexa**; schema de tools mudou força consolidação **só** se a rota não tem `toolUpdate`; rotas que suportam ambos (tool update + system update) **anexam** e ativam tools novas sem reescrever mensagens anteriores. ✅
- Para o Lumina: essa é a arquitetura ideal — **nunca** mutar o head; toda instrução dinâmica entra como mensagem nova no fim.

### 8.2 `dsh-system-prompt` — renderização estável e in-history

Trecho real ✅ ([README.md](../../.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-system-prompt/README.md), L141/L153-155):

> "The rendered prompt reaches the model as a system-role message of **derived history** — surface node 0, or the latest system node after an in-history update — neither the loop request nor `request/header` carries a separate `system` field." (L141)
>
> "**Prefix-stable while identity, persona, variables, section text, and order render identically**: an unchanged rendering leaves the system nodes untouched … Without `systemPromptUpdate`, non-empty prompt text is consolidated at the first system node … a head rewrite loses prefix reuse from its first changed token; when the prepared call declares `systemPromptUpdate: 'in-history'`, the agent loop appends a non-empty changed prompt after the cached history … With the same model, persona prefix, tools, and preceding instructions, different source paths, local Web URLs, or persona suffix values leave the reusable first-party prefix unchanged." (L153-155)

- Tools: "Schema tokens repeat on every request. Restricting a tool removes its entire schema cost … reordering changes cache shape but not semantic content." / "Prefix-stable while the visible schema set, rendering, and order are unchanged. Registration, restriction, or reordering may invalidate reuse from the first changed schema token." ✅ (L165-169)

### 8.3 `dsh-compaction-basic` — replay byte-a-byte para reaproveitar o cache

Trechos reais ✅ ([README.md](../../.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-compaction-basic/README.md), L109/L232-234/L181):

> "**Summarization reuses the provider's warm prefix.** Replaying the system prompt held by the `system/message` at surface node 0, the last routed request's tools, and the shadowed-region messages **byte-for-byte** makes the auxiliary call a genuine prefix of the conversation, so only the trailing instruction and the summary output are uncached." (L109)
>
> "The replayed system prompt, tools, and shadowed-region messages match the conversation's last routed request byte-for-byte, so the provider's warm prefix cache is reused up to the trailing instruction; only that instruction, and the summary output, is uncached. Routing the summarizer to a different provider/model, or compacting a non-head range, **forgoes this reuse**." (L232-234)
>
> "Replacing rather than append-only. Each checkpoint invalidates reuse from the first replaced history token; the unchanged request prefix before that range remains reusable." (L181)

- Implicação direta: **compactação não é desculpa para perder todo o prefixo**. O DSH compacta mantendo system+tools e o "prefixo sombreado" idênticos no request de sumarização — o cache do provedor é reutilizado até a instrução final. No Lumina, a compactação (se houver) precisa da mesma disciplina, ou aceitar miss integral.

### 8.4 `dsh-token-meter` — as projeções de usage

Trechos reais ✅ ([README.md](../../.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-token-meter/README.md), L50/L56; [lib/index.js](../../.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-token-meter/lib/index.js), L321-338):

> "`tokenUsage` carries the complete durable log's `uncachedInputTokens`, `outputTokens`, `cacheReadTokens`, and `cacheWriteTokens`. A final assistant-message sample replaces streaming usage from the same attempt; `llm/retry-started` ends that replacement scope, so a retry in the same step contributes another billed attempt. `contextPressure` carries … the newest provider-reported prompt size … `contextBreakdown` carries heuristic `systemTokens`, `toolsTokens`, and `messageTokens` — the context's composition, not its provider-billed size." (L50)

```js
const zeroBuckets = () => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
const bucketsFrom = (usage) => ({
  uncachedInputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0
})
```

- `deriveTurnTokenUsage(events)` dobra um turno em usage exato por attempt/turno, e só publica agregados quando **todos** os attempts reportam o valor opcional (cache/reasoning/route) — útil como referência de "não inventar número". ✅ (L56)
- O contrato `TokenUsage` do `dsh-llm` (typert): `inputTokens`, `outputTokens`, `totalTokens?`, `cacheReadTokens?`, `cacheWriteTokens?`, `reasoningTokens?`. ✅ ([typert.host.js](../../.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-llm/lib/typert.host.js), L609)
- **O Lumina está atrás aqui**: `UsageInfo` só tem `cached_tokens` (um número), sem write/uncached; não dá para calcular hit% correto em Anthropic (ver §9.9).

### 8.5 `dsh-llm-deepseek` — parsing de usage/cache do DeepSeek

Trechos reais ✅ ([README.md](../../.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/README.md), L144/L178/L182; [lib/index.js](../../.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js), L1830-1845):

> "Reasoning history is serialized back when required, and **cache accounting maps DeepSeek's cache-hit metrics into harness usage**." (L144)
> "An unchanged assembled prefix is eligible for DeepSeek cache reuse, which this adapter **reports in usage**. Deterministic request-image bytes do not make the full prefix immutable: a changed execution-world path rewrites historical descriptor text, a refreshed upload can replace a `file_id`, and Files-to-base64 fallback changes the image representation. Any of these, or a model-route, prompt, schema, history, or image-budget change, may prevent reuse from the first affected token; **reasoning passback appends on every reasoned turn**." (L182)

```js
function updateUsage(usage, raw) {
  const fields = object(raw)
  for (const [wire, local] of Object.entries({
    input_tokens: "inputTokens",
    output_tokens: "outputTokens",
    cache_read_input_tokens: "cacheReadTokens",
    cache_creation_input_tokens: "cacheWriteTokens"
  })) { ... }
}
```

- Nota: o adapter DeepSeek do DSH fala **Messages API** (Anthropic-compatible) e mapeia `cache_read_input_tokens`/`cache_creation_input_tokens`. Para o Chat Completions nativo (`prompt_cache_hit_tokens`), o mapeamento equivalente está no protocolo `openai-chat` do OpenCode (L7.3) — o DSH usa o caminho Messages.
- `dsh-llm` README: "**No retry execution, caching, or rate limiting ships in this service**"; e "Variants normally require a producer — `prefill`, per-tool `strict`, block `cache` hints … have no producer". ✅ ([README.md](../../.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-llm/README.md), L179) → **o DSH não emite `cache_control`**; ele ganha cache por prefixo estável + automatic caching do provedor. Isso confirma que o caminho do Lumina para Anthropic **precisa** adicionar `cache_control` (o DSH não serve de referência para isso).

### 8.6 DSH e o gateway OpenCode

- Varredura nos pacotes extraídos (`README.md` + `lib/*.js` de todos os `@deepseek-ai/dsh-*`): **nenhuma ocorrência** de `x-opencode-session`, `x-opencode`, `opencode-go` ou `opencode-session`. ✅ (grep local; resultado: zero matches)
- Isso casa com a doc do OpenCode Go, que lista o **DeepSeek Harness** como cliente problemático por faltar o header em alguns caminhos (§6.2). ✅
- O DSH manda atribuição/session id "outside model input": "Every model and Files call carries shared attribution. Model requests also carry the stable anonymous user id outside model input, plus a **session id when present**." ✅ ([dsh-llm-deepseek README](../../.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/README.md), L144) — mas **não** no header do gateway OpenCode.

---

## 9. Implicações para o Lumina

### 9.1 Estado atual do código (verificado, 2026-10-29)

| Item | Estado hoje | Evidência |
|---|---|---|
| `x-opencode-session` no gateway | **Já implementado**: header com o id estável, só para providers `opencode*` | [`providers/mod.rs`](../../src-tauri/src/providers/mod.rs), L174-176/L220-232 |
| `conversation_id` como session id | ✅ estável por conversa (passado a `provider_config`) | [`harness/mod.rs`](../../src-tauri/src/harness/mod.rs), L232-253/L1238/L1495 |
| Anthropic `cache_control` | **Não envia**; `system` é string; sem breakpoints | [`providers/anthropic.rs`](../../src-tauri/src/providers/anthropic.rs), L50-94 |
| Anthropic usage | Lê `input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read_input_tokens`; **não lê** `cache_creation_input_tokens` | [`providers/anthropic.rs`](../../src-tauri/src/providers/anthropic.rs), L425-437 |
| OpenAI Chat | Envia `messages` (system primeira), `stream_options.include_usage:true`, `tools`; **sem** `prompt_cache_key`/`prompt_cache_retention`; lê `cached_tokens` | [`providers/openai_chat.rs`](../../src-tauri/src/providers/openai_chat.rs), L50-102/L360-368 |
| OpenAI Responses | Perfil padrão não envia `store`; perfil `ChatgptPlan` envia `store:false`, `include:["reasoning.encrypted_content"]`, `instructions`, `tools`, `reasoning` e **whitelist** que descarta o resto (inclui `prompt_cache_retention`); lê `input_tokens_details.cached_tokens` | [`providers/openai_responses.rs`](../../src-tauri/src/providers/openai_responses.rs), L60-156/L564-571 |
| Google | Implícito apenas; **sem** `cachedContent` explícito; lê `cachedContentTokenCount` ✅ | [`providers/google.rs`](../../src-tauri/src/providers/google.rs), L47-88/L313-319 |
| Persistência de usage | `UsageInfo` só tem `cached_tokens`; DB persiste `cached_tokens` (sem read/write/uncached separados) | [`domain.rs`](../../src-tauri/src/domain.rs), L175-193; [`db.rs`](../../src-tauri/src/db.rs), L140/L2172-2214 |
| System prompt dinâmico | **Chat**: "Today is {data}" no prompt; **Code**: data+hora `%Y-%m-%d %H:%M` no prompt | [`harness/prompt.rs`](../../src-tauri/src/harness/prompt.rs), L31/L41/L623-651; [`harness/mod.rs`](../../src-tauri/src/harness/mod.rs), L996-1031 |
| Notas de modo no meio do turno | `compose_system_prompt` **anexa** as notas ao system prompt do passo (novo head) | [`harness/mod.rs`](../../src-tauri/src/harness/mod.rs), L631-635/L1139/L1199-1209/L1727 |
| System messages no histórico | São **hoisted** para o cabeçalho a cada request (`system_text` concatena `system_prompt + todos os HistoryRole::System`) | [`providers/mod.rs`](../../src-tauri/src/providers/mod.rs), L656-670 |
| Tools | Ordem estática em `tools::definitions`; MCP é anexado depois; flags do turno (`web_search`, etc.) mudam o conjunto | [`tools/mod.rs`](../../src-tauri/src/tools/mod.rs), L74-101; [`harness/mod.rs`](../../src-tauri/src/harness/mod.rs), L1007-1043 |

**Diagnóstico**: o pipeline já coleta `cached_tokens`, mas (a) o prefixo é instável por design em dois pontos (data/hora; notas de modo), (b) o head é reconstruído quando há system message no histórico, (c) Anthropic e OpenAI não recebem os campos de cache que permitiriam 98–99%, e (d) não há métrica de write/uncached para provar hit% por provedor.

### 9.2 Regras transversais de prefixo estável (aplicar antes de qualquer campo novo)

1. **Nada volátil no system prompt.** Data/hora, "Today is…", notas de modo, status de workflow, contadores de contexto e listas dinâmicas devem ir **no fim** do input como mensagem nova (user/developer) ou, no Anthropic, como `{"role":"system"}` em `messages` (in-history). ✅ base: §2.6, §3.7, §8.1/8.2.
2. **O system prompt é imutável durante a conversa.** Se mudar, que seja **anexando** (in-history) e apenas em modelos/rotas que suportam; caso contrário, aceite o miss e registre o motivo.
3. **Histórico é append-only.** Nunca reescrever mensagens antigas, nunca "estender" uma mensagem existente (§3.7); compactação/checkpoint só com replay byte-a-byte do prefixo (§8.3).
4. **Tools são parte do prefixo.** Ordem determinística (sort estável por nome), schemas sem `HashMap` iterando, MCP com ordem estável por servidor; **não** alternar flags de tools no meio do turno sem aceitar invalidação. ✅ base: §2.2, §3.1, §8.2.
5. **Modelo/protocolo fixos por conversa.** Trocar de modelo muda a "cache domain" (§8.5); o fallback de protocolo do `stream_completion` (tenta o próximo protocolo quando `UnsupportedProtocol`) tem que ser raro e logado como motivo de miss.
6. **Settings que entram no prompt** (`reasoning.effort`, thinking budget, `text.verbosity`, structured output schema) precisam ser estáveis durante o turno — mudá-las invalida mensagens/system (§2.6, §3.1).
7. **Conteúdo binário/attachment** deve ser byte-idêntico entre turnos (mesmo caminho, mesma codificação); re-encode/reupload troca o prefixo (§8.5).

### 9.3 Anthropic — campos concretos a adicionar

Arquivo-alvo: [`providers/anthropic.rs`](../../src-tauri/src/providers/anthropic.rs).

1. **`system` vira array de blocos** (hoje é string, L77-80). O último bloco estável recebe `cache_control`:

```json
"system": [
  {"type": "text", "text": "<base estável>"},
  {"type": "text", "text": "<contexto estável>", "cache_control": {"type": "ephemeral"}}
]
```

2. **Última tool** recebe `cache_control` (cacheia todas as tools até ela). ✅ §2.2.
3. **Um breakpoint na cauda** de `messages` — no último bloco de texto/`tool_result` que **não** vai mudar no próximo request. Em turnos com muitos tool calls, considerar um 4º breakpoint intermediário por causa do *lookback* de 20 blocos. ✅
4. **Alternativa/atalho**: `cache_control` no **topo do body** (automático) para conversas longas; usa 1 slot e move o breakpoint sozinho. Para prefixo system+tools fixo, mantê-lo explícito e usar o automático para o histórico. ✅
5. **TTL**: padrão 5 min; para o system+tools "do dia" use `"ttl":"1h"` (write 2×) e **coloque os 1h antes dos 5m** se misturar. Se o produto tem pausas >5 min entre turnos, 1h evita reescrever o prefixo — o custo de 2× no write só compensa se houver poucos writes e muitos reads. ✅ §2.3/2.4.
6. **Mínimos**: o prefixo system+tools do Lumina pode ficar abaixo de 512/1.024 tokens em modelos novos. Meça com `count_tokens` (ou estimativa) e, se estiver perto do mínimo, **estenda o conteúdo estável** (instruções úteis) até passar — a doc recomenda isso explicitamente (§2.3). ✅
7. **Usage**: adicionar ao parser `cache_creation_input_tokens` e calcular `total_input = read + creation + input_tokens` (§2.5), além de manter `cache_read_input_tokens`.
8. **Validação**: a API não erra por estar abaixo do mínimo; `cache_creation`/`cache_read` ficam 0 — cheque os dois no probe.
9. **Não** colocar `cache_control` em bloco que muda (data/hora no system!) — o write cairia sempre no mesmo hash? Não: hash muda, então vira write novo a cada mudança e read 0. ✅ §2.2 ("common mistake").

### 9.4 OpenAI Chat — campos concretos a adicionar

Arquivo-alvo: [`providers/openai_chat.rs`](../../src-tauri/src/providers/openai_chat.rs).

1. **`prompt_cache_key`** = `conversation_id` estável, ≤64 chars (truncar de forma segura, como o OpenCode faz). Enviar para OpenAI direto e para modelos OpenAI-compatible que aceitam o campo; tornar **opt-in por modelo** (`supportsPromptCacheKey`) para não quebrar provedores estritos (o OpenCode faz exatamente isso, §7.3). ⚠️ No GPT‑5.6+ a chave não é necessária para roteamento, mas não machuca (accounting).
2. **`prompt_cache_retention`** para modelos antigos (ex.: `"24h"` quando a org não tem ZDR e o provider aceita) e/ou **`prompt_cache_options.ttl`** para GPT‑5.6+ no Responses. No **Chat Completions** a doc só documenta `prompt_cache_retention` (modelos antigos) — ⚠️ validar se `prompt_cache_options` é aceito nesse endpoint antes de mandar.
3. **`store`**: hoje o Lumina não manda. A doc deixa o default `true` (persiste a response no projeto). Cache não depende disso; para postura stateless, mandar `store:false` (o OpenCode usa default false no Responses e `store` só quando compatível no Chat, §7.3). ⚠️ Em provedores OpenAI-compatible, `store` pode ser rejeitado — manter gated por compatibilidade.
4. **Prefix shaping**: a mensagem `system` (L54-56) tem que ser byte-idêntica; remover data/hora do prompt (§9.2). `tools` com ordem estável.
5. **Usage**: manter `prompt_tokens_details.cached_tokens`; adicionar `cache_write_tokens` (GPT‑5.6+) e guardar `uncached = prompt_tokens − cached − write`.
6. **Não** colocar `cache_control` por bloco no Chat da OpenAI: não é campo documentado; o OpenCode só o emite quando o modelo declara `cacheFormat` (Anthropic/Alibaba via OpenAI-compatible), não para OpenAI. ⚠️ Para gateways que falam OpenAI-compatible mas cachem por marker (ex.: Alibaba/OpenRouter/…), aí sim é opcional e gated.

### 9.5 OpenAI Responses — campos concretos a adicionar

Arquivo-alvo: [`providers/openai_responses.rs`](../../src-tauri/src/providers/openai_responses.rs).

1. **Perfil padrão (API key)**: adicionar `prompt_cache_key` (mesma chave `conversation_id`) — é aceito pela API pública; e opcionalmente `store:false` para stateless. O bloco `instructions` (L95-98) tem que ser **estável** (hoje inclui data/hora se vier do prompt).
2. **Perfil ChatGPT‑plan/OAuth**: **não** adicionar `prompt_cache_retention` (a whitelist do Lumina já remove, L63-72/L141-156; coerente com o fluxo SIWC que exige só `store:false`+`stream:true`). ⚠️ `prompt_cache_key` **não** está na whitelist atual: antes de liberar, rodar um probe (a doc SIWC não menciona; a pesquisa interna diz "não listado como proibido"). Se passar, incluir no whitelist e medir `cached_tokens`; se der 400, manter fora.
3. **Stateless replay**: continuar repassando reasoning criptografado (`include:["reasoning.encrypted_content"]`, já) — sem ele não há continuidade de raciocínio em `store:false` (comentário no código L52-58).
4. **Modo explícito (GPT‑5.6+, só caminho API)**: se a meta exigir 98–99% em prefixos que misturam estático+dinâmico, usar `prompt_cache_options: {mode:"explicit", ttl:"30m"}` + `prompt_cache_breakpoint` no(s) bloco(s) `developer`/`input_text` estáveis. ⚠️ Para isso o system prompt teria que estar em um `developer` message (instructions de topo não aceita breakpoint — §3.2).
5. **Usage**: já lê `input_tokens_details.cached_tokens`; acrescentar `cache_write_tokens` e `cache_write_tokens_details` quando presentes.

### 9.6 Google — o que fazer (e o que não fazer)

Arquivo-alvo: [`providers/google.rs`](../../src-tauri/src/providers/google.rs).

1. **Não há campo a adicionar no implícito.** O trabalho é prefixo: `systemInstruction` estável, `contents` append-only, `tools` estável. O Lumina já lê `cachedContentTokenCount` ✅ (não é gap de parsing).
2. **Remover data/hora do systemInstruction** (o prompt do Lumina entra no `systemInstruction`, L65-68). Conteúdo volátil → mensagem no fim de `contents`.
3. **Opcional: explicit caching** para um bloco grande e realmente reutilizado (documento/anexo/base de código):
   - criar `POST /v1beta/cachedContents` com `model`, `contents`, `systemInstruction`, `tools`, `ttl` (default 1 h) — fora do request de chat;
   - mandar `"cachedContent": "<name>"` no body do `generateContent`;
   - **só** quando o modelo suporta (não Gemini 4 Argon+) e o prefixo passa do mínimo (⚠️ mínimo do explícito não enumerado na doc primária; validar com probe);
   - aceitar que atualização é só de TTL (conteúdo imutável).
4. **Medir a regra dos 2.050 tokens**: para cada turno, guardar `cachedContentTokenCount` e o delta de input; se o delta < 2.050 em Gemini 4, o hit% baixo é **esperado**. O plano deve prometer 98–99% "quando o turno agrega ≥2.050 tokens", não em toda mensagem.
5. Cuidado com `parameters` (L79): o protocolo Gemini usa schema OpenAPI-like; mudanças de schema entre turnos invalidam o prefixo. (A doc do OpenCode usa `parametersJsonSchema` por robustez; o Lumina usa `parameters` — ⚠️ verificar aceitação; não é tema de cache, mas é tema de prefixo.)

### 9.7 OpenCode Go/Zen — o que falta

1. **Header já está correto** (§9.1). Dois cuidados: (a) nunca enviar header vazio (já gated por `!session_id.is_empty()`, L230); (b) **retries/continuações** devem reutilizar o mesmo `conversation_id` (hoje `provider_config` recebe o id estável; ok).
2. **Medir o bloco do gateway**: se a resposta trouxer `usage.opencode.tokens.cache_read`/`cache_write_5m`/`cache_write_1h`, parsear e persistir como fonte prioritária de cache do gateway (hoje o Lumina lê só os campos nativos genéricos). ⚠️ Não verifiquei se o gateway devolve esse bloco em todos os caminhos/protocolos; validar no probe.
3. **Manter os controles nativos**: para modelos Anthropic servidos via gateway, mandar `cache_control` (§9.3) — a tradução do gateway deve preservar; ⚠️ não documentado, validar com `usage.cache_read_input_tokens` > 0 no probe.
4. **Warming** (opcional, desligado): se a UX tiver pausas de 5–30 min entre turnos, um warming a cada ~4 min preserva o cache 5m — mas cada warming é request real (custo/tokens/rate limit) e a doc alerta para habilitar só quando o benefício compensa. ✅ §6.3.
5. **Go/Zen** não têm cache próprio no sentido de KV: o ganho vem de (i) roteamento por sessão estável, (ii) cache do provedor de origem e (iii) billing de cache repassado. Não existe "cache de gateway" documentado além disso. ⚠️ (leitura da doc; não verifiquei internals do gateway).

### 9.8 DeepSeek — o que fazer

1. **Nenhum campo novo no body** (§5). Só prefixo estável + medir `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` (o OpenCode mapeia esses campos em §7.3; o Lumina, se usar DeepSeek direto, ainda não os lê no `openai_chat.rs` — hoje lê `prompt_tokens_details.cached_tokens` e `cache_read_input_tokens`, L365-366; adicionar os campos do DeepSeek).
2. **Aproveitar a regra de fronteira de request**: cada request persistido vira unidade no fim do input; o multi-turn do Lumina já cai nesse caso naturalmente — **desde que** o prefixo não mude.
3. **Compactação/checkpoint** = perda de cache de prefixo; se for inevitável, replays byte-a-byte como o DSH (§8.3).
4. **Não** confiar em "64 tokens" (folclore, §5); trate como melhor esforço e meça.

### 9.9 O que medir (requisito do plano)

**Campos a adicionar** (contrato compartilhado, dono = Lead): `UsageInfo` + DB + projeções UI.

| Protocolo | Campo de cache read | Campo de cache write | Input "cheio" | Cálculo de hit% |
|---|---|---|---|---|
| Anthropic | `cache_read_input_tokens` | `cache_creation_input_tokens` | `read+write+input_tokens` | `read / (read+write+input)` |
| OpenAI Chat/Responses | `prompt_tokens_details.cached_tokens` / `input_tokens_details.cached_tokens` | `cache_write_tokens` (GPT‑5.6+) | `prompt_tokens`/`input_tokens` (inclusivo) | `cached / input` |
| Google | `cachedContentTokenCount` | — ⚠️ (implícito não documenta cobrança de write separada) | `promptTokenCount` (inclusivo) | `cached / prompt` |
| DeepSeek | `prompt_cache_hit_tokens` | — | `hit+miss` | `hit / (hit+miss)` |
| Gateway OpenCode | `opencode.tokens.cache_read` (+ nativo) | `opencode.tokens.cache_write_5m` + `_1h` | `input + cache_read + cache_write` | `read / (input+read+write)` |

**O que persistir por request/step** (para diagnosticar "motivo de quebra"):
- `provider_id`, `wire_protocol`, `model`, `conversation_id`, `turn_id`, `step_index`;
- `cache_read`, `cache_write`, `uncached_input`, `output`, `hit_pct`, `cost` (se gateway reportar);
- **fingerprint do prefixo**: `sha256(system_prompt)` + `sha256(tools_json ordenado)` + `sha256(primeiras N mensagens)` + `model` + `protocol`;
- flags do request que entram no prompt: `reasoning.effort`, `thinking budget`, `text.verbosity`, schema de structured output;
- **motivo de invalidação**: comparar fingerprint com o step anterior e classificar (`system_changed`, `tools_changed`, `model_changed`, `history_rewritten`, `compaction`, `first_turn`), além de `ttl_expired` (tempo desde o último request > TTL) e `min_tokens` (prompt abaixo do mínimo do modelo).
- SLO sugerido por provedor: hit% steady-state ≥ 95% em Anthropic/OpenAI/DeepSeek; Gemini 4 medido de forma condicional (§9.6); abaixo do mínimo cacheável = 0% esperado (§2.3/§4.1).

### 9.10 Armadilhas específicas do Lumina (checklist)

- [ ] **Data/hora no system prompt**: Chat tem `Today is {date}` ([prompt.rs](../../src-tauri/src/harness/prompt.rs), L31/L41/L623-651); Code tem `%Y-%m-%d %H:%M` ([harness/mod.rs](../../src-tauri/src/harness/mod.rs), L1005). → mover para o fim do input (mensagem nova), ou no mínimo arredondar (dia) e no Code remover a hora.
- [ ] **Notas de modo no meio do turno**: `compose_system_prompt` (L631-635) muda o head entre steps (L1209/1483/1727). → virar mensagem nova `user`/`developer` (`{"role":"system"}` no Anthropic) em vez de reescrever o system.
- [ ] **`HistoryRole::System` é hoisted para o head** (`system_text`, L656-670): qualquer system message no histórico muda o prefixo e é reordenada. → não criar novas system messages no meio; se existirem (persistidas), são head estável e não podem mudar.
- [ ] **Tools por flags do turno/MCP**: `web_search`, `create_files`, `run_code`, delegação e MCP entram/saem do array entre turnos → invalida tools (§2.2/§3.1). → fixar o conjunto por conversa (ou aceitar/registrar o miss); sort estável.
- [ ] **Fallback de protocolo** (`stream_completion`, L770-789): se o primeiro protocolo falha com `UnsupportedProtocol`, o segundo request é outro cache domain → registrar como motivo de miss, não como bug de cache.
- [ ] **Modelo trocado** no meio da conversa → cache domain novo (§8.5). Reset documentado.
- [ ] **Thinking/effort**: mudar `reasoning`/`budget_tokens`/`effort` no meio da conversa invalida mensagens (Anthropic) e/ou o prefixo renderizado (OpenAI) — manter estável por conversa (§2.6, §3.1).
- [ ] **Cache write no 1º turno**: o primeiro request de uma conversa é 100% miss/write por definição; não contar no hit% de steady-state.
- [ ] **Prompt abaixo do mínimo**: system+tools pequenos (<512–4.096 tokens) não cacheiam; expandir conteúdo estável ou não esperar hit (§2.3/§4.1).
- [ ] **Gemini 4 + passos pequenos**: <2.050 tokens novos por turno → cache não avança (§4.1).
- [ ] **ChatGPT-plan whitelist**: não vazar campos novos para o perfil OAuth (a whitelist atual protege; qualquer campo adicionado ao body padrão precisa ser conscientemente adicionado à whitelist) ([openai_responses.rs](../../src-tauri/src/providers/openai_responses.rs), L60-72).
- [ ] **Gateway sem session id**: header vazio/sumido piora roteamento e prompt caching (§6.2); hoje gated, mas monitorar.
- [ ] **Retries**: retry do mesmo turno reusa o mesmo request → deve dar read no segundo attempt; se não der, o payload mudou (comum: timestamp no prompt).

### 9.11 Probes sugeridos (antes/depois)

1. **Anthropic**: request com system+tools grandes (≥ mínimo do modelo), mesmo body 2×; esperar `cache_creation > 0` no 1º e `cache_read > 0` no 2º; repetir com data/hora no system para provar o miss.
2. **OpenAI**: Responses com `store:false` + `input` append-only; comparar `cached_tokens` do 1º vs 2º; testar `prompt_cache_key` e `prompt_cache_retention:"24h"` vs default; testar `prompt_cache_options.ttl` no Responses (GPT‑5.6+).
3. **ChatGPT-plan**: probe de aceitação de `prompt_cache_key` (body whitelistado com/sem o campo) e leitura de `cached_tokens` no `response.completed`.
4. **Google**: 2 requests iguais com ≥4.096 tokens de prefixo; ler `cachedContentTokenCount` no 2º; testar turno com delta <2.050 no Gemini 4.
5. **DeepSeek**: 2 requests com prefixo comum; ler `prompt_cache_hit_tokens`/`miss`.
6. **Gateway**: `x-opencode-session` presente/ausente; comparar `usage.opencode.tokens.cache_read`; testar `cache_control` em modelo Claude via gateway.
7. **Lumina end-to-end**: fingerprint por step (§9.9) + tabela de hit% por provedor; rodar um turno multi-tool e verificar que `system_changed` = 0 após a correção de data/hora.

---

## 10. O que NÃO consegui verificar (lacunas explícitas)

1. **Cache no caminho ChatGPT-plan/OAuth**: a doc SIWC exige `store:false`/`stream:true` e não menciona caching; não achei fonte primária dizendo (a) que o caching funciona igual nesse perfil, (b) se `prompt_cache_key` é aceito. O doc interno do time diz que `prompt_cache_key` "não está listado como proibido". → probe obrigatório (§9.5).
2. **`prompt_cache_options` no Chat Completions**: a doc de caching descreve o controle de TTL do GPT‑5.6+ no **Responses API**; não confirmei aceitação no endpoint `chat/completions`.
3. **Mínimo do explicit caching do Gemini**: a página oficial diz "varia por modelo" mas não enumera; fontes secundárias (fórum/Firebase) citam 2.048/4.096 — não usei como fato.
4. **TTL do cache implícito do Gemini**: não documentado (só a dica de "short amount of time").
5. **Granularidade "64 tokens" do DeepSeek**: não existe na doc atual; origem em docs antigas/terceiros. Não validado empiricamente.
6. **OpenCode gateway**: não verifiquei (a) se ele reescreve/adiciona `cache_control`, (b) se preserva headers/breakpoints na tradução entre protocolos, (c) se o bloco `opencode.tokens.cache_*` aparece em todos os caminhos. Só a doc pública foi lida; o fonte do gateway não é público/extraído.
7. **Versões do OpenCode**: os caminhos V2 (`packages/ai`) e V1 (`packages/opencode`, branch `v1`) foram lidos em branches diferentes; a V2 pode não ser exatamente a versão que o usuário roda. O repo `sst/opencode` redireciona para `anomalyco/opencode` — citação usa os caminhos do branch lido.
8. **Datas/valores**: preços, limites e modelos podem mudar; a doc do Anthropic/OpenAI/Gemini foi lida em 2026-10-29 e tem "last updated" 2026-10-23 (Gemini). Rechecar antes de fechar o PLAN.
9. **DSH**: li os READMEs extraídos do asar local e o `lib/index.js` dos pacotes citados; não executei o DSH nem testei headers/wire. O grep de `x-opencode-session` nos pacotes pode não cobrir plugins externos não empacotados.
10. **Lumina**: as afirmações de §9.1 vêm de leitura de código (grep/read), sem rodar a suíte. Em especial, não confirmei em request de rede real o que cada adapter manda — apenas o que o builder monta (e os testes unitários existentes).

---

## 11. Fontes

**Anthropic**
- ✅ Prompt caching (doc oficial): <https://platform.claude.com/docs/en/build-with-claude/prompt-caching> · versão markdown usada: <https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md>

**OpenAI**
- ✅ Prompt caching: <https://developers.openai.com/api/docs/guides/prompt-caching.md>
- ✅ Sign in with ChatGPT / models-and-inference (`store:false`, `stream:true`): <https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference.md>
- ✅ `prompt_cache_key` na referência (citado na doc de caching e no body do OpenCode): <https://developers.openai.com/api/docs/guides/prompt-caching.md#prompt-cache-keys>

**Google Gemini**
- ✅ Context caching (implicit): <https://ai.google.dev/gemini-api/docs/caching>
- ✅ Context caching (generateContent, implicit+explicit, TTL 1h, `cachedContent`): <https://ai.google.dev/gemini-api/docs/generate-content/caching>
- ✅ API reference `cachedContents` (TTL/expireTime/systemInstruction/tools): <https://ai.google.dev/api/caching>

**DeepSeek**
- ✅ Context Caching (disk cache, prefix units, hit/miss tokens): <https://api-docs.deepseek.com/guides/kv_cache>
- ✅ Models & Pricing (hit vs miss): <https://api-docs.deepseek.com/quick_start/pricing/>

**OpenCode (docs)**
- ✅ Go (`x-opencode-session`, clientes validados/problemáticos, preços cached read/write): <https://opencode.ai/v2/docs/console/go/>
- ✅ Console/Models (pay-as-you-go, tabela Cached Read/Write, endpoints): <https://opencode.ai/v2/docs/console/models/>
- ✅ Inference API (bloco `usage.opencode.tokens.cache_read/cache_write_*`): <https://opencode.ai/v2/docs/console/api/inference/>
- ✅ Warming: <https://opencode.ai/v2/docs/warming/>
- ✅ Providers (WebSockets, ChatGPT plan, context caps): <https://opencode.ai/v2/docs/providers/>
- ✅ Redirect "Zen" → Console: <https://opencode.ai/docs/zen/> → <https://opencode.ai/v2/docs/console/models/>

**OpenCode (código)**
- ✅ `packages/ai/src/cache-policy.ts` (V2): <https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/cache-policy.ts>
- ✅ `packages/ai/src/protocols/utils/cache.ts` (V2): <https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/protocols/utils/cache.ts>
- ✅ `packages/ai/src/protocols/openai-chat.ts` (V2): <https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/protocols/openai-chat.ts>
- ✅ `packages/ai/src/protocols/openai-responses.ts` (V2): <https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/protocols/openai-responses.ts>
- ✅ `packages/ai/src/protocols/shared.ts` (V2; `prompt_cache_key` 64 chars): <https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/protocols/shared.ts>
- ✅ `packages/ai/src/protocols/gemini.ts` (V2; `cachedContent` + `cachedContentTokenCount`): <https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/protocols/gemini.ts>
- ✅ `packages/ai/src/schema/options.ts` (V2; `CachePolicy`, `CacheHint`, `CacheTTL`, `supportsPromptCacheKey`): <https://raw.githubusercontent.com/sst/opencode/dev/packages/ai/src/schema/options.ts>
- ✅ `packages/opencode/src/session/llm/request.ts` (V1; `x-opencode-session`): <https://raw.githubusercontent.com/sst/opencode/v1/packages/opencode/src/session/llm/request.ts>
- ✅ `packages/opencode/src/session/llm.ts` (V1; `prepared.headers` no `streamText`): <https://raw.githubusercontent.com/sst/opencode/v1/packages/opencode/src/session/llm.ts>
- ✅ `packages/opencode/src/provider/transform.ts` (V1; `applyCaching`, `promptCacheKey = sessionID`): <https://raw.githubusercontent.com/sst/opencode/v1/packages/opencode/src/provider/transform.ts>
- ✅ Repositório (redirect `sst/opencode` → `anomalyco/opencode`): <https://github.com/sst/opencode> · <https://github.com/anomalyco/opencode>

**DeepSeek Harness (DSH) — pacotes locais extraídos**
- ✅ `dsh-agent-loop/README.md` (request/header, KV cache effect, reconciliação): `.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-agent-loop/README.md`
- ✅ `dsh-system-prompt/README.md` (render estável, in-history): `.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-system-prompt/README.md`
- ✅ `dsh-compaction-basic/README.md` (replay byte-a-byte, KV effect): `.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-compaction-basic/README.md`
- ✅ `dsh-token-meter/README.md` + `lib/index.js` (projeções `cacheReadTokens`/`cacheWriteTokens`/`uncachedInputTokens`): `.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-token-meter/`
- ✅ `dsh-llm/README.md` + `lib/typert.host.js` (contrato `TokenUsage`; sem produtor de cache hints): `.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-llm/`
- ✅ `dsh-llm-deepseek/README.md` + `lib/index.js` (cache accounting, `updateUsage`): `.research/asar-out/dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/`

**Lumina (código local, leitura estática)**
- ✅ `src-tauri/src/providers/mod.rs` (`x-opencode-session`, `system_text`, `make_usage`)
- ✅ `src-tauri/src/providers/anthropic.rs`, `openai_chat.rs`, `openai_responses.rs`, `google.rs`
- ✅ `src-tauri/src/harness/mod.rs`, `src-tauri/src/harness/prompt.rs`
- ✅ `src-tauri/src/domain.rs` (`UsageInfo`), `src-tauri/src/db.rs` (persistência de usage)
- ✅ `src-tauri/src/tools/mod.rs` (definições de tools), `data/catalog.json` (providers `opencode-go`/`opencode-zen`)
- ✅ Pesquisa interna do time: [`docs/research/openai-oauth.md`](./openai-oauth.md) (store:false / whitelist do perfil ChatGPT-plan)
