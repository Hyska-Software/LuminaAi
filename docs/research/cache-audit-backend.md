# Auditoria de backend — cache de prefixo de prompt (Lumina)

> **Escopo:** backend Rust em `src-tauri/src` (harness, providers, persistência, comandos que afetam o request). Trabalho **100% read-only**: nenhum código, teste, goal ou build foi executado/alterado; toda a evidência é leitura estática de fonte.
> **Data:** 2026-10-29. **Commit/estado:** árvore de trabalho local em `H:\ChatTauri` (sem verificação de `git status`, por restrição da auditoria).
> **Contexto:** plano do Lead para elevar o cache hit de prompt a 98–99% em todos os provedores. Esta auditoria responde "o que no backend hoje ajuda ou atrapalha o cache de prefixo".
> **Legenda de confiança:**
> - ✅ **provado no código** (fato verificável em `arquivo:linha`);
> - ⚠️ **inferido** de código/documentação secundária, sem prova em runtime (não rodei requests reais);
> - ❓ **não verificável** nesta auditoria (depende de semântica do provedor — delegado à task-1 / `docs/research/prompt-caching.md`).
>
> Quando a conclusão depende de regra do provedor (ex.: caching da Anthropic é opt-in via `cache_control`; ordem do prefixo na OpenAI), isso está marcado com ⚠️/❓ e **não** deve ser tratado como fato desta auditoria.

---

## 0. Sumário executivo — o que muda o plano

1. **O system prompt do perfil Code é reconstruído a cada turno com relógio de minuto** (`%Y-%m-%d %H:%M`) **na seção `# Environment`, quase no topo** — `src-tauri/src/harness/mod.rs:1005` + `src-tauri/src/harness/code/prompt.rs:276-280`. ✅ Todo turno iniciado em outro minuto tem um prefixo diferente do turno anterior: **o cache hit cross-turn do prompt inteiro + histórico vira loteria de fronteira de minuto** (só acerta se dois turnos caírem no mesmo minuto e nada mais mudar). É o defeito nº 1.
2. **Mesmo removendo o relógio, o prompt Code continua volátil por estado da sessão/workspace**: `# Permission policy` (modo de permissão/plano) no início (`code/prompt.rs:81-124`), `# Workspace` com git/tree/projeto no meio (`code/prompt.rs:126-175`) e `# Plan and tasks` com todos/plano no fim (`code/prompt.rs:189-229`), todos reconstruídos por turno a partir do DB/disco (`harness/code/context.rs:103-132`). Qualquer `todo_write`, edição que altere a árvore/git, ou feedback de plano muda o prompt → **invalida system prompt + todas as mensagens** (as mensagens vêm depois do system na serialização dos 4 protocolos). ✅
3. **O corte de histórico por orçamento (`build_history`) não tem histerese**: em regime de corte, o início do array de mensagens muda a cada turno — `harness/mod.rs:2022-2046` + budget `harness/mod.rs:2185-2188`. ✅ Em conversa longa (ou turno Code com muitos resultados de tool de até 24k chars) o cache de mensagens vai a ~0. É o defeito nº 2 em impacto.
4. **A Anthropic não recebe nenhum `cache_control`** — system é string pura, tools é array puro, mensagens não têm marcadores — `src-tauri/src/providers/anthropic.rs:50-117`; e `cache_creation_input_tokens` não é lido (`anthropic.rs:425-439`). ✅ Para todos os modelos servidos pelo protocolo `anthropic` (catálogo: `claude-*`, `kimi-k3*`, `minimax-*`, vários `qwen*`) o cache explícito é 0 hoje (⚠️ a regra "opt-in" precisa ser confirmada por task-1).
5. **Não existe telemetria de cache write nem hit%**: `UsageInfo` não tem `cache_write_tokens` (`domain.rs:175-193`), `usage_log` não tem coluna de cache write (`db.rs:131-144`), `usage_summary` só existe em teste (`db.rs:2193-2194`), `TurnEvent::Usage` é emitido **uma única vez no fim do turno** (`harness/mod.rs:1663-1668`), e `ContextStats` (só perfil Code) não tem nenhum campo de cache (`domain.rs:1322-1336`). ✅ Sem isso o plano não consegue medir a meta nem a UI da task-3 tem dado para exibir.
6. **O "final forçado" (quando o loop estoura `max_steps`) muda o system prompt e zera a lista de tools** — `harness/mod.rs:1483-1500`. ✅ O último request do turno (o mais caro, com todo o histórico) é um cache miss quase total.
7. **As notas de mudança de modo (`mode_notes`) são anexadas ao system prompt no meio do turno** — `harness/mod.rs:631-636, 1178-1209`. ✅ Cada aprovação de plano / troca de chip de permissão invalida o prefixo de todos os passos seguintes daquele turno.
8. **A compactação reescreve o começo do histórico e a reconstrução do turno seguinte não reproduz o request anterior**; além disso, o `to_seq` gravado é `messages.len()` (total de mensagens do DB) enquanto o corte real é índice do histórico neutro — `harness/mod.rs:1146-1170, 889-918` + `compaction.rs:214, 218-223, 261-274`. ⚠️ Alta confiança de que há perda de contexto + quebra de prefixo; pedir teste de regressão ao PLAN.
9. **Serialização do request é determinística** (serde_json sem `preserve_order` ⇒ mapas ordenados; headers estáticos ordenados; skills/tree ordenados; tool specs em arrays `static`) — `src-tauri/Cargo.toml:26`, `catalog.rs:74-85`, `tools/skills.rs:309-311`, `harness/code/context.rs:214`, `tools/registry.rs:200,307`. ✅ O problema não é byte-instabilidade do body; é **conteúdo volátil** e **prefixo mutável**. Exceção: ordem de protocolos vem de iteração de `HashMap` quando o modelo não declara protocolos (`harness/mod.rs:2452-2476`).

---

## 1. Mapa do request — o que entra, em que ordem, e quando é recalculado

Fluxo de um turno (`harness::run_turn`, `src-tauri/src/harness/mod.rs:771-1779`):

| Etapa | O que acontece | Evidência |
| --- | --- | --- |
| 1. Resolver provedor/modelo/credencial | catálogo → `AppState` → modelo; credencial OAuth-first | `harness/mod.rs:790-833`, `213-253` (`provider_config`), `260-314` |
| 2. Opções efetivas do turno | gates globais (`web_search`, `create_files`, `run_code`), `max_steps` por perfil | `harness/mod.rs:839-858` |
| 3. Persistir user + placeholder do assistant | `prepare_new_turn` / `prepare_regenerate` | `harness/mod.rs:865-878, 1785-1830` |
| 4. Ler mensagens e aplicar resumo de compactação persistido | `list_messages` + `apply_stored_summary` | `harness/mod.rs:885-918` |
| 5. **Montar histórico neutro** (1× por turno) | `build_history` (anexos/imagens/replay/corte) | `harness/mod.rs:895-918, 1975-2051` |
| 6. Skills catalog (1× por turno) | scan de repositórios → prompt | `harness/mod.rs:932-949` |
| 7. Contexto do workspace (1× por turno, só Code) | git/projeto/AGENTS.md/tree/todos/plano | `harness/mod.rs:950-955` → `harness/code/context.rs:103-132` |
| 8. MCP tools (1× por turno, refresh só se cache vazio) | prompt + definições | `harness/mod.rs:979-1044` |
| 9. **Montar system prompt (1× por turno)** | Code: `code::prompt::build_system_prompt`; Chat: `prompt::build_system_prompt` | `harness/mod.rs:996-1031` |
| 10. **Montar tool definitions (1× por turno)** | registry estático filtrado por settings/workspace + MCP | `harness/mod.rs:1032-1047` |
| 11. Loop de passos | a cada passo: notas de modo + request com histórico **clone** + system prompt **recomposto** | `harness/mod.rs:1141-1248` |
| 12. Finalização | usage merge, persistência, eventos, revisão de contexto | `harness/mod.rs:1619-1776` |

**Consequência estrutural ✅:** o system prompt e as definições de tools são imutáveis *dentro* do turno (exceto `mode_notes`); o histórico só **cresce** (append de assistant + tool results). É uma boa base para prefix caching **dentro** do turno. O problemas estão (a) na transição entre turnos, (b) no corte/reescrita do histórico e (c) na falta de marcadores/medição por protocolo.

---

## 2. Prompt de sistema

### 2.1 Perfil Chat — `src-tauri/src/harness/prompt.rs`

Construído em `build_system_prompt` (`harness/prompt.rs:25-122`). Ordem das seções e volatilidade:

| # | Seção | Linhas | Conteúdo | Volatilidade |
| --- | --- | --- | --- | --- |
| 1 | `# Identity` + nome do modelo + **`Today is {date}.`** + `# Language` + `# Response style` | `prompt.rs:36-56` | `model.name` e data de hoje (dia, não hora) | **data muda 1×/dia** (virada de meia-noite local; `today_en()` em `prompt.rs:623-651`); `model.name` muda se o usuário trocar de modelo |
| 2 | `# Tools` | `prompt.rs:57, 124-198` | depende de `options.web_search`, `create_files`, `run_code` | muda se o usuário alternar toggles do turno |
| 3 | `# Skills` + catálogo instalado | `prompt.rs:58, 269-328` | lista dinâmica de skills (bundled + externas) | muda quando instala/remove/desabilita skill (`harness/mod.rs:941-949`; catálogo ordenado em `tools/skills.rs:309-311`) |
| 4 | `# Code execution` | `prompt.rs:59-61, 350-367` | inclui `settings.code_timeout_secs` no texto | muda se o usuário alterar timeout de execução (`prompt.rs:354`) |
| 5 | `# Citations and sources` | `prompt.rs:62-69` | estático | estável |
| 6 | `# Markdown formatting` | `prompt.rs:70, 375-417` | estático | estável |
| 7 | `# Generative UI` | `prompt.rs:71, 420-591` | gerado de `data/genui-contract.json` + exemplos | estável entre builds; muda só com atualização do app/contrato |
| 8 | `# Files and artifacts` | `prompt.rs:72-95` | inclui 2 bullets condicionais a `run_code` | muda com o gate de `run_code` |
| 9 | `# Artifact library` | `prompt.rs:96, 208-261` | quase estático, 1 bullet condicional a `run_code` | muda com o gate de `run_code` |
| 10 | `# User attachments` + `# Safety` | `prompt.rs:97-114` | estático | estável |
| 11 | `# Additional user instructions` | `prompt.rs:116-120, 606-621` | `settings.system_prompt` + `TurnOptions::system_prompt_override` | muda quando o usuário edita instruções do sistema; override é por turno (usado por subagente) |

✅ **Estável no Chat:** a maior parte do prompt (seções 5–10) e, principalmente, não há nada que mude por *turno* exceto data/modelo/toggles. Para o Chat, o cache cross-turn é viável (⚠️ dependendo do provedor), com quebra na virada do dia.

### 2.2 Perfil Code — `src-tauri/src/harness/code/prompt.rs` + `harness/code/context.rs`

O contexto é montado **uma vez por turno** (`code/context.rs:4` documenta isso; chamado em `harness/mod.rs:952-955`) e congelado no prompt. Ordem de `build_system_prompt` (`code/prompt.rs:264-300`):

| # | Seção | Linhas | Conteúdo | Volatilidade real |
| --- | --- | --- | --- | --- |
| 1 | Identidade fixa | `code/prompt.rs:272-275` | texto estático | estável |
| 2 | `# Environment` | `code/prompt.rs:276-280` | `model.id`, `platform` (OS), **`Date: {today}` com minutos**, shell default | **relógio com minuto** (`harness/mod.rs:1005`); `model.id` muda ao trocar modelo |
| 3 | `# Permission policy` | `code/prompt.rs:281, 81-124` | texto do modo (`read-only/edit/review/autonomous`) + bloco extra se `plan_mode` | **muda no meio do turno** (aprovação de plano/chip de permissão) e entre turnos |
| 4 | `# Available tools` | `code/prompt.rs:283, 59-79` | `ToolSpec.guidance` das tools habilitadas no turno | muda com `settings.shell_enabled`, presença de workspace, `delegation_depth`, MCP (`harness/mod.rs:2372-2419`) |
| 5 | `# How to edit and verify` | `code/prompt.rs:284, 231-250` | estático | estável |
| 6 | `# Workspace` | `code/prompt.rs:286, 126-175` | nome/path, **git branch/ahead/behind/dirty**, projeto detectado + checks, **árvore resumida** | **git muda** (commit/pull/edições), **árvore muda** quando arquivo/dir de 1º nível é criado (contagem por diretório, `context.rs:192-261`), projeto muda se manifestos mudarem |
| 7 | `# Project instructions (AGENTS.md)` | `code/prompt.rs:288-292, 177-187` | `AGENTS.md` + `.lumina/instructions.md` truncados (32 KiB) | muda se arquivos forem editados (inclusive pelo agente) |
| 8 | `# Plan and tasks` | `code/prompt.rs:296, 189-229` | estado do plano, **feedback do usuário**, markdown do plano, **lista de todos com status** | **muda a cada `todo_write`/`submit_plan`/feedback**, e sempre entre turnos |
| 9 | `# Response format` | `code/prompt.rs:298, 252-260` | estático | estável |
| + | `# MCP server tools` | `harness/mod.rs:1008-1021` | wires + descrição das tools MCP | muda quando o cache MCP é atualizado (refresh só quando vazio: `harness/mod.rs:981-987`); ordem vem do servidor (`mcp/mod.rs:416-430`) |
| + | Instruções do subagente | `harness/mod.rs:1023-1027` | `TurnOptions::system_prompt_override` concatenado no fim | por turno do subagente |

✅ **O prompt Code é volátil por design em 3 lugares distintos** (início, meio e fim), o que é pior que "volátil no fim": como nos 4 protocolos o system prompt vem **antes** das mensagens, qualquer mudança nele invalida system + tools + **toda a lista de mensagens** do lado do provedor.

### 2.3 Contradição com o desenho documentado

`docs/goals/code-harness/HARNESS.md:531-532` prescreve: *"Prefixo estável primeiro (identidade/ambiente/política/tools) e volátil no fim (árvore/estado), para maximizar cache do provider."* ✅ A implementação **não cumpre** isso:

- `Date` com **minutos** dentro de `# Environment` (que o desenho considera estável) — `code/prompt.rs:277` + `harness/mod.rs:1005`;
- git/tree/projeto em `# Workspace` **antes** de `AGENTS.md`/plano, mas ainda dentro do system prompt;
- `# Permission policy` e `# Plan and tasks` mudam por estado → prompt inteiro muda;
- e, mesmo que o volátil fosse só no fim do system prompt, isso **não** preserva o prefixo das mensagens (elas vêm depois do system). Para reuso cross-turn o volátil precisa sair do system prompt e ir para a **última mensagem** do request (ou para um bloco separado que não preceda o histórico cacheável). ⚠️ A ordem exata do prefixo cacheado por protocolo deve ser confirmada pela task-1.

### 2.4 O que é estável (aproveitável)

- `# Identity`, `# How to edit and verify`, `# Response format` (Code) e as seções 5–7 e 10 do Chat são **byte-estáveis** ✅ (as seções 8–9 do Chat mudam apenas com o gate de `run_code`/atualização do contrato).
- O catálogo de skills é ordenado alfabeticamente e mergeado por precedência determinística (`tools/skills.rs:309-311`; teste `catalog_is_sorted_and_skips_invalid_skills` em `tools/skills.rs:1135`). ✅
- A árvore é ordenada (dirs primeiro, depois alfabético) e limitada (`context.rs:214, 254-260`). ✅
- `AGENTS.md` é lido da raiz (não "root→cwd" como o comentário de `code/prompt.rs:33` sugere) — `context.rs:159-189`. Pequena divergência de doc; sem efeito de cache além de mudança de conteúdo.

---

## 3. Montagem do histórico — `src-tauri/src/harness/mod.rs`

### 3.1 `build_history`

`harness/mod.rs:1975-2051`. Para cada `ChatMessage` do DB (exceto o assistant placeholder do turno atual, `:1987-1990`):

| Papel | O que vira HistoryMessage | Linhas |
| --- | --- | --- |
| User | `HistoryMessage::user(content)` + anexos inlinados (texto/base64) + placeholders quando vazio | `:1992-2008` |
| Assistant | grupo via `assistant_history_group` — pode expandir em **N mensagens** (replay por passo) | `:2009-2015` |
| System | 1 `HistoryMessage::system` | `:2016-2018` |
| (skip) | assistant `Streaming` com `content` vazio | `:2010-2013` |

Placeholders determinísticos: `"(mensagem sem texto)"` / `"Analise o(s) anexo(s) a seguir."` (`:2002-2006`).

Depois: orçamento e corte (`:2022-2046`), `debug_assert_tool_results_are_paired` (`:2049`, implementação `:2158-2183`).

### 3.2 `assistant_history_group`, replay v2 e fallback neutro

- `assistant_history_group` (`:2062-2098`):
  - **replay só quando modelo E provedor coincidem** com o turno atual: `message.provider_id == provider_id && message.model_id == model_id` (`:2067-2069`);
  - se houver envelope v2 válido → `replay_steps_history` (`:2070-2077`);
  - senão fallback neutro: 1 assistant com texto + `tool_calls` persistidas + os tool results logo depois (`:2080-2097`); `provider_state` legado só é reaproveitado se **não** há tool calls (`:2088-2090`).
- Envelope v2: `{"version":2,"steps":[{state,text,toolCallIds}]}` — `:1847-1947` (`PROVIDER_STATE_VERSION` `:1848`; `wrap_provider_state` `:1882-1895`; parse `:1907-1947`). Escrito no fim do turno em `assistant_message.provider_state` (`:1647`).
- `replay_steps_history` (`:2103-2153`): 1 `HistoryMessage::assistant` por passo + tool results do passo; chamadas persistidas fora do envelope entram num passo extra final (`:2133-2151`) para nunca deixar tool result órfão; resultado ausente vira `MISSING_TOOL_RESULT` (`:1851, 1959-1969`).
- O replay é **intencionalmente igual ao que o loop em memória envia no passo seguinte** (`:1853-1855, 2100-2102`) e há teste comparando a reconstrução do turno 2 com o request do turno 1 (`harness/mod.rs:3869-4018`, em especial `:3988-4017`). ✅ Esse é o principal ativo do backend para cache cross-turn.

### 3.3 Anexos e imagens — o que é reescrito em mensagens antigas

- `attach_user_attachments` (`:2242-2281`) é chamado **em todo turno** para **toda** mensagem do usuário com anexo (`:1994-2001`):
  - imagem: lê os bytes do disco/`<app-data>` de novo e re-codifica base64 (`:2259-2272`, `read_attachment_bytes` `:2312-2330`);
  - texto extraído: re-injeta o texto salvo, com budget de 60k chars/arquivo e 150k/mensagem (`:2242-2310`; constantes `:40-41`);
  - formato do bloco: `\n\n<anexo nome="…" tipo="…">\n{trecho}\n</anexo>` (`:2302-2309`).
- **Seleção de imagens** `image_enabled_messages` (`:2209-2235`): percorre as mensagens **do fim para o começo** com budget total de 16.000.000 chars de base64 (`:43`) e decide quais mensagens entram como imagem; as demais caem para texto extraído. Quando uma conversa ganha imagens novas, mensagens antigas podem **deixar de ser imagem** e virar texto → o conteúdo do histórico no meio muda. ⚠️ Raro em conversas normais (16M chars ≈ 12 MB), mas inevitável em sessões com muitas capturas.
- `settings.include_attachments` (`domain.rs:703`) desliga toda a inlinagem (`:1994`) → reescreve **todas** as mensagens antigas com anexo.

### 3.4 Orçamento e corte

- `history_budget(model)` = `context_window * 3` chars, clamp `[40_000, 600_000]` — `:2185-2188`.
- Corte: percorre grupos do fim para o início somando `history_message_size` e acha o primeiro `keep_from` que cabe; depois garante que comece em `User`/`System` (não separa assistant↔tool result) — `:2022-2046`.
- `history_message_size` conta texto + reasoning + args de tool call + base64 de imagens + **serialização do `provider_state`** (`:2190-2207`).
- Não há histerese, watermark de corte, nem atualização incremental: **cada turno recalcula do zero** com `messages` atual. Em regime de corte, adicionar uma mensagem/tool result normalmente desloca `keep_from` (o grupo mais antigo sai), e a **primeira** mensagem do request muda → todo o cache de mensagens é invalidado. ✅
- O budget é em **chars** com heurística ~1 token/3 chars; não desconta system prompt/tools nem usa o tokenizer real. Também não há tratamento de `CONTEXT_WINDOW_EXCEEDED` com retry+compactação (mencionado em `HARNESS.md:512-513`) — só compactação preventiva (`harness/mod.rs:1146-1170`). ✅

### 3.5 Tabela — o que reescreve mensagens antigas e quando

| Gatilho | Efeito no histórico montado | Quando | Evidência |
| --- | --- | --- | --- |
| Anexos (texto/imagem) | re-inlina o conteúdo extraído/base64 em mensagens antigas | **todo turno** | `harness/mod.rs:1994-2001, 2242-2330` |
| Budget de imagens estourado | mensagem antiga deixa de virar imagem e passa a texto | quando a soma de imagens passa de 16M chars base64 | `harness/mod.rs:2209-2235` |
| `include_attachments=false` | todas as mensagens com anexo perdem o conteúdo inlinado | toggle de settings | `harness/mod.rs:1994`; `domain.rs:703` |
| Truncamento de tool result | conteúdo persistido é truncado de novo, sempre ≤24k chars + `…` (determinístico entre request vivo e replay) | todo turno em que a mensagem é replayada | `harness/mod.rs:1442, 1965-1968`, const `:50`, `truncate_chars` `:2621-2628` |
| Corte por orçamento | primeiros grupos são **descartados** | quando histórico > budget do modelo | `harness/mod.rs:2022-2046, 2185-2188` |
| Compactação | prefixo trocado por mensagem de resumo | a cada `TRIGGER_RATIO=0.75` de janela (automática, por passo) ou `/compact` | `harness/mod.rs:889-918, 1146-1170`; `compaction.rs:137-143, 214, 261-274` |
| Troca de modelo/provedor | todos os assistants antigos caem no fallback neutro (sem payload bruto) | quando `provider_id`/`model_id` da mensagem ≠ do turno | `harness/mod.rs:2067-2097` |
| Envelope v2 ausente/legado | history reconstruído por texto + tool_calls (sem estado bruto) | dados antigos/corrompidos | `harness/mod.rs:2085-2090` |

### 3.6 O que garante a igualdade entre request do passo e reconstrução do turno seguinte

✅ Garantido (pelo desenho e por teste):
- cada passo é persistido no envelope v2 e reconstruído na mesma ordem (`:1424-1455` vs `:2103-2153`);
- tool results usam o mesmo truncamento nos dois caminhos (`:1442` e `:1965`);
- argumentos de tool call são normalizados a JSON válido nos dois caminhos (`:172-191` do `openai_chat.rs` / `validation` central em `providers/mod.rs:721-742`);
- ordenação de mensagens do DB é estável (`db.rs:1878-1882` — `ORDER BY created_at, id`).

⚠️ Não garantido (risco de prefixo):
- quando o corte por orçamento atua, a reconstrução começa em outro ponto (ver 3.4);
- quando o resumo de compactação atua, `messages[cut..]` **não** é o mesmo tail que ficou no request anterior (ver §7);
- no caso de edição/regeneração/truncamento o tail é apagado e recriado (esperado, mas quebra cache do ponto em diante);
- `created_at` com precisão de ms + desempate por UUID (`db.rs:1881-1882`, `domain.rs:247, 259, 267, 279`) pode ordenar assistant antes do user em caso de empate de milissegundo (⚠️ não reproduzi; entrar na lista de verificação);
- `reasoning` não é persistido no envelope v2 como campo próprio (`ReplayStep` só guarda `state`/`text`/`call_ids`, `:1856-1864`), então no fallback neutro (troca de modelo) o "thinking" com assinatura se perde — `anthropic.rs:148-156` exige assinatura; determinístico, mas conteúdo difere do turno anterior.

---

## 4. Loop multi-step — o que muda entre passos do mesmo turno

### 4.1 `compose_system_prompt` + `mode_notes`

- `compose_system_prompt(base, notes)` = `base` + `"\n\n" + notes.join("\n\n")` (`harness/mod.rs:631-636`).
- `mode_notes` são acumuladas quando o modo de plano/permissão muda **no meio do turno**: revalidação por passo em `:1178-1207`, nota criada por `mode_update_note` (`:651-680`) e aplicada no `step_system_prompt` (`:1209`).
- O system prompt base **não** é reconstruído por passo (todos/plano/git/tree ficam congelados no estado do começo do turno) ✅ — bom para cache dentro do turno; mas: (a) o modelo vê estado desatualizado de todos/plano durante o turno, e (b) qualquer nota anexada muda o prefixo do system prompt e invalida todo o histórico dos passos seguintes. ✅

### 4.2 `tool_definitions` (ordem e serialização)

- Code: `code_enabled_specs` filtra o array **estático** `CODE_SPECS` (`tools/registry.rs:307`) por `has_workspace`, `settings.shell_enabled`, subagente (`harness/mod.rs:2372-2388`), preservando a ordem estática; `code_tool_definitions` mapeia `ToolDefinition { name, description, parameters }` (`:2391-2404`).
- Chat: `tools::definitions(&options)` (`tools/mod.rs:75`) a partir de `CHAT_SPECS` (`registry.rs:200`).
- MCP: definições **acrescentadas ao fim**, sem sort (`harness/mod.rs:1036-1044`), na ordem de `mcp.cached_tools()` (`mcp/mod.rs:395-397`), preenchido por `refresh_tools` na ordem dos servidores habilitados + ordem do `tools/list` de cada servidor (`mcp/mod.rs:416-430`). ⚠️ Ordem depende do servidor MCP; estável dentro do processo (refresh só quando cache vazio: `harness/mod.rs:981-987`).
- Serialização: `serde_json` sem `preserve_order` (`Cargo.toml:26`) ⇒ objetos serializados com chaves ordenadas (BTreeMap). ✅ Determinístico.
- Os JSON Schemas vêm de funções estáticas `(spec.schema)()` (`harness/mod.rs:2401`); MCP usa `input_schema` devolvido pelo servidor (também re-serializado ordenado). ✅

### 4.3 Resultados de tools no histórico

- Execução em lote preservando a ordem original (`harness/mod.rs:1378-1422`; Code: `harness/code/tools.rs:92-137`).
- Append: 1 assistant com texto/estado/tool_calls + 1 mensagem por resultado, na ordem das calls (`:1424-1444`); resultado truncado para `MAX_MODEL_TOOL_RESULT_CHARS = 24_000` (`:1442, 50`).
- O resultado persistido é o conteúdo **completo** (`:1389`), truncado na leitura do histórico (`:1965`) — mesmo resultado do request vivo. ✅
- Tool results **não** contêm timestamps/ids do harness no histórico (`history_tool_call` só id/name/arguments `:1949-1955`; `HistoryMessage` não tem `started_at`/`finished_at`, `providers/mod.rs:84-97`). ✅

### 4.4 Resposta final forçada

- Se o loop terminar sem texto final e sem falha/cancelamento (`:1476`) → novo request com:
  - system prompt **recomposto + bloco `# Wrap-up`** (`:1483-1490`);
  - `tools: Vec::new()` (`:1499`);
  - mesmo histórico (`:1497`).
- ✅ Isso muda **todo** o prefixo: tools vazias e system prompt diferente. O request mais caro do turno (histórico completo) não aproveita nada do cache dos passos anteriores.
- O passo forçado também entra no replay persistido (`:1572-1577`). ✅
- Trigger: só quando `step_number >= options.max_steps` (`:1457-1461`) ou o modelo nunca devolve resposta final; não acontece em turno normal.

### 4.5 Retries

- **Auth (401):** refresca credencial e repete o **mesmo passo** com o mesmo body — muda só o header `authorization` (`:1233-1272`; mesmo padrão no final forçado `:1491-1519`). ✅ Prefixo preservado (⚠️ assumindo que credenciais não entram na chave de cache do provedor).
- **Protocolo não suportado:** `stream_completion` tenta os protocolos em ordem e só continua em `UnsupportedProtocol` (`providers/mod.rs:776-834`). A ordem vem de `model.protocols` (do catálogo); se o modelo não declarar, a ordem vem da **iteração de `HashMap` de endpoints** (`harness/mod.rs:2452-2476`) — ⚠️ não determinística entre execuções. Um fallback de protocolo muda o corpo inteiro (cache miss naquele passo) e não é memorizado para os passos seguintes.
- **Erros de parâmetro/capacidade:** não há retry — viram falha do turno (`ProviderError::is_unsupported_protocol` é o único gatilho de novo protocolo, `providers/mod.rs:586-593, 810-819`).

### 4.6 O que muda entre passos do mesmo turno (tabela)

| Item | Muda entre passos? | Evidência |
| --- | --- | --- |
| system prompt base | **não** (1×/turno) | `harness/mod.rs:996-1031` |
| system prompt efetivo | **sim, se modo muda** (notas anexadas) | `:1199-1209` |
| tool definitions | **não** | `:1032-1047` |
| histórico | **cresce** (append assistant + tool results) — prefixo preservado | `:1424-1444` |
| reasoning config / temperature / max_tokens | **não** | `:1048-1050, 1244-1245` |
| request profile/headers | **não** | `:1238` |
| usage/context estimado | muda; `ContextStats` emitido por passo (só Code) | `:1214-1231` |
| notas de modo | acumulam, nunca são removidas | `:1139, 1199-1204` |

---

## 5. Bodies de request por protocolo

Config comum: `ProviderConfig` (`providers/mod.rs:165-241`), montado em `harness/mod.rs:232-253`; system prompt vem de `system_text()` (base + mensagens `System` do histórico) — `providers/mod.rs:656-671`; uso normalizado por `make_usage` (`:744-764`).

### 5.1 OpenAI Chat Completions — `src-tauri/src/providers/openai_chat.rs`

- Body em `build_body` (`:50-105`): `model`, `messages`, `stream:true`, `stream_options.include_usage:true`, `max_tokens`; `temperature` condicional; `tools` (formato `{type:"function", function:{...}}`) só se não vazio; parâmetros de raciocínio em `reasoning::apply` (`:98-103`).
- **System:** mensagem `{"role":"system","content": system}` **primeiro** da array `messages` (`:52-56`).
- **Campos de cache enviados:** **nenhum**. Não há `prompt_cache_key`, `prompt_cache_retention`, `store`, `user`/`safety_identifier`, nem `cache_control`. Cache depende do cache automático de prefixo do provedor/gateway. ⚠️❓
- **Afinação de rota:** só o header `x-opencode-session` (gateway) — ver 5.5.
- **Usage parse** (`:360-368`): `prompt_tokens`, `completion_tokens`, `completion_tokens_details.reasoning_tokens`/`reasoning_tokens`, `prompt_tokens_details.cached_tokens` ou `cache_read_input_tokens`, `total_tokens`. **Não lê** `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` (formato nativo DeepSeek) nem campos de cache write. ⚠️(task-1 confirma nomes do provedor)
- **ProviderState:** `{"tool_calls":[...]}` verbatim das calls (`:349-354`), usado no replay (`:145-191`). ✅ Determinístico.
- Sem nada não-determinístico no body (ids de tool call gerados `call_{index}` só quando o provedor não manda id, `:282-287`; determinístico por passo e persistido).

### 5.2 OpenAI Responses — `src-tauri/src/providers/openai_responses.rs`

- Body em `build_body` (`:74-137`): `model`, `input` (itens montados do histórico), `stream:true`; `max_output_tokens` só no perfil `standard` (`:83-85`); `store:false` + `include:["reasoning.encrypted_content"]` só no perfil `chatgpt-plan` (`:88-93`); `instructions` = system (`:95-98`); `tools` no formato Responses (`:99-113`); `temperature` só `standard` e sem steering de reasoning (`:117-126`).
- Whitelist do perfil ChatGPT-plan (`:63-72`, aplicada em `:133-135, 141-156`): aceita apenas `model, input, stream, store, instructions, tools, include, reasoning`. ✅ **Qualquer campo novo de cache (ex.: `prompt_cache_key`) será silenciosamente removido** enquanto não estiver nessa lista.
- **System:** campo `instructions`; itens `{role:"system"}` são removidos do `input` defensivamente (`:158-176`, `retain` em `:174`). ✅
- **Campos de cache:** nenhum (`prompt_cache_key`, `prompt_cache_retention`, `safety_identifier` ausentes) — cache automático por prefixo, e no plano `store:false` implica reenviar `input` inteiro a cada request. ⚠️❓
- **Usage parse** (`:564-571`): `input_tokens`, `output_tokens`, `output_tokens_details.reasoning_tokens`, `input_tokens_details.cached_tokens`, `total_tokens`. **Não lê** `cache_write_tokens` (existe no shape de usage documentado em `docs/research/openai-oauth.md:546`) nem `prompt_cache_key`-related metadata.
- Replay: `provider_state` é o array `output` completo; itens `reasoning` sem `encrypted_content` são descartados no replay (`:226-235`), o que é determinístico mas altera o histórico em relação ao request original se o provedor não devolver o conteúdo cifrado.

### 5.3 Anthropic Messages — `src-tauri/src/providers/anthropic.rs`

- Body em `build_body` (`:50-117`): `model`, `stream:true`, `max_tokens`, `messages` (blocos), `system`, `tools` (`{name, description, input_schema}`), raciocínio, ajuste de `max_tokens` para thinking (`:102-109`) e `temperature` só sem thinking (`:110-115`).
- **System:** campo `"system"` como **string pura** (`:77-80`) — não é array de blocos e não aceita `cache_control` no formato atual.
- **Tools:** array puro, sem `cache_control` (`:81-94`).
- **Messages:** blocos `text`/`image`/`tool_use`/`tool_result`/thinking, todos sem `cache_control` (`:119-207`).
- **Campos de cache:** **nenhum**. Não há `cache_control` em nenhum dos 3 lugares onde a API aceita breakpoints (tools, system, mensagens), nem header `anthropic-beta` para TTL estendido; o único header estático é `anthropic-version` (`data/catalog.json` provider anthropic; `catalog.rs:74-85`). Sem breakpoints, o cache explícito não é ativado (⚠️ regra a confirmar com task-1; `docs/MODELS.md:111-112` já registra "Prompt caching (`cache_control`) fica como melhoria futura"). É praticamente garantido que as rotas `anthropic` do catálogo (Claude, Kimi K3, MiniMax, Qwen via Anthropic) tenham cache read = 0 hoje.
- **Usage parse** (`:425-439`): lê `input_tokens`, `output_tokens`, `output_tokens_details.thinking_tokens`, `cache_read_input_tokens` — **não lê `cache_creation_input_tokens`** (cache write). O `total` é derivado de `input+output` (`make_usage(..., None)` em `:494-502` → `providers/mod.rs:751-754`), e `input_tokens` da Anthropic **não inclui** cache read (⚠️ semântica a confirmar) — logo o total e a calibração de contexto subestimam quando há cache.
- **ProviderState:** array de blocos montado em `finish()` (`:457-511`), incluindo `thinking` com `signature`, `tool_use` com `input` já parseado e `redacted_thinking` verbatim — necessário para replay de thinking; determinístico (BTreeMap por índice). ✅

### 5.4 Google Generative Language — `src-tauri/src/providers/google.rs`

- Body em `build_body` (`:47-88`): `contents` (role `user`/`model`), `generationConfig.maxOutputTokens`, `systemInstruction.parts[0].text` (`:65-68`), `tools:[{functionDeclarations}]` (`:72-85`), raciocínio (`:86`).
- **System:** `systemInstruction` como texto (`:65-68`).
- **Campos de cache:** nenhum `cachedContent` (cache explícito) e nenhum TTL; só o cache implícito do Gemini. `cachedContentTokenCount` é lido (`:313-319`) ✅, mas não há como forçar/reaproveitar conteúdo explicitamente.
- **Afinação de rota:** gateway `opencode-*` manda `x-opencode-session` (5.5).
- **Nota de replay:** `provider_state` é o array de `parts` com `thoughtSignature` (`:283-310`); `functionCall` é reconstruído com `args` e `thoughtSignature` (`:251-255`). Ids de tool call são **gerados** (`call_{index}`, `:232-234`) porque o protocolo não devolve id — o pareamento no replay usa `name` (`tool_parts`, `:130-144`); determinístico, mas não único se houver duas chamadas com o mesmo nome.
- **Usage parse** (`:313-319`): `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, `cachedContentTokenCount`, `totalTokenCount` ✅.

### 5.5 `providers/mod.rs` — configuração, headers e `x-opencode-session`

- `ProviderConfig.session_id` documentado como *"Stable id sent as `x-opencode-session` for routing / prompt caching. Only OpenCode gateway providers receive it."* (`providers/mod.rs:174-176`).
- Header é adicionado somente quando `provider_id` começa com `opencode` e o id não é vazio (`:193-195, 222-240`; envio em `send_stream` `:620-653`).
- O valor é o **`conversation_id`** do turno (`harness/mod.rs:1238` e `:1495` chamam `provider_config(..., &payload.conversation_id)`; construção em `:232-253`). ✅ Estável por conversa (regenerar/trocar modelo não muda); muda ao criar outra conversa; **não** é enviado a OpenAI/Anthropic diretos.
- O catálogo confirma o propósito: *"Envie o header x-opencode-session para melhor roteamento e prompt caching."* (`data/catalog.json:1822`). ⚠️ Os detalhes de como o gateway usa esse id para cache (por sessão? por prefixo?) não estão no repositório — ❓ task-1.
- `headers()` monta, nesta ordem: `authorization: Bearer <token>` (se não vazio), `x-opencode-session` (gateway), `user-agent: Lumina/<versão>`, e `extra_headers` (catalog `headers` estáticos, lowercase + **ordenados** por nome — `catalog.rs:74-85`). ✅ Determinístico (⚠️ `user-agent` muda entre versões do app; efeito em cache desconhecido).
- `endpoint_for` resolve o path pelo catálogo (Google substitui `{model}` e adiciona `:streamGenerateContent?alt=sse`) — `providers/mod.rs:197-216`. Sem cache de endpoint; determinístico.
- `system_text()` concatena system base + mensagens `System` do histórico com `\n\n` (`:656-671`): o resumo de compactação é inserido como **user**, não system, então hoje não entra aqui.

### 5.6 Tabela comparativa — campos de cache por protocolo (o que existe × o que falta)

| Protocolo | `cache_control` | `prompt_cache_key` | `store` | TTL / retenção | Cache write medido | Cache read medido | Observações |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openai-chat | ❌ (não existe no protocolo) | ❌ faltando | ❌ não envia | ❌ | ❌ | ✅ `cached_tokens`/`cache_read_input_tokens` | gateway recebe `x-opencode-session`; DeepSeek nativo tem campos próprios não lidos |
| openai-responses | ❌ | ❌ faltando (+ whitelist do plano rejeita) | ✅/❌ `false` só no plano; `standard` omite | ❌ | ❌ | ✅ `input_tokens_details.cached_tokens` | `store:false` no plano; replay por `input` completo |
| anthropic | ❌ **faltando** | n/a | n/a | ❌ | ❌ (`cache_creation_input_tokens` ignorado) | ✅ `cache_read_input_tokens` | sem breakpoints = sem cache explícito |
| google | n/a (usa `cachedContent`) | n/a | n/a | ❌ (sem cache explícito) | ❌ | ✅ `cachedContentTokenCount` | só cache implícito |

### 5.7 Determinismo de serialização

- ✅ `serde_json = "1"` sem a feature `preserve_order` (`src-tauri/Cargo.toml:26`) ⇒ `Value::Object` = BTreeMap (chaves ordenadas). Bodies são byte-determinísticos para o mesmo conteúdo (floats serializados por serde, sem arredondamento divergente).
- ✅ Nenhum timestamp/UUID entra no body: `HistoryMessage` não tem campos temporais (`providers/mod.rs:84-97`); ids de tool call vêm do provedor e são reutilizados via `provider_state`; timestamps de `ToolCallRecord` (`harness/mod.rs:2356-2368`) ficam só no DB/eventos.
- ⚠️ Exceção: ordem de protocolos quando `model.protocols` está vazio — iteração de `HashMap` (`harness/mod.rs:2462-2466`).
- ⚠️ Exceção: ordem das tool calls de um passo para o Google é construída pela ordem dos eventos do stream (sequencial); ok. Para OpenAI Chat, `BTreeMap` por index (`openai_chat.rs:215`) ⇒ determinístico.
- ⚠️ Exceção potencial: `handlers` de stream montam `provider_state` na ordem do stream; se o provedor variar a ordem dos blocos entre duas requests idênticas, o estado persistido varia — fora do controle do app.

---

## 6. Medição e uso

### 6.1 Parsing de `cached_tokens` por protocolo

| Protocolo | Campo lido | Linha | Falta |
| --- | --- | --- | --- |
| openai-chat | `prompt_tokens_details.cached_tokens` ou `cache_read_input_tokens` | `providers/openai_chat.rs:365-366` | `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` (DeepSeek nativo, ⚠️), `cache_write_tokens` |
| openai-responses | `input_tokens_details.cached_tokens` | `providers/openai_responses.rs:568` | `cache_write_tokens` (`docs/research/openai-oauth.md:546` documenta o campo) |
| anthropic | `cache_read_input_tokens` | `providers/anthropic.rs:436-438` | `cache_creation_input_tokens` (cache write) |
| google | `cachedContentTokenCount` | `providers/google.rs:317` | cache explícito/TTL (não há) |

- `make_usage` só preenche `cached_tokens`; `UsageInfo` não tem campo de cache write (`domain.rs:175-193`). ✅
- `merge_usage` soma `cached_tokens` entre passos (`harness/mod.rs:2531-2542`) — correto para "cache read tokens por turno". ✅
- Não existe cálculo de hit% em lugar nenhum do backend. ✅ (nenhuma ocorrência de razão `cached/input` no Rust)

### 6.2 `TurnEvent::Usage` e propagação

- `TurnEvent::Usage { usage }` (`events.rs:51-52`) é emitido **uma vez, no fim do turno** (`harness/mod.rs:1663-1668`); o usage por passo é acumulado em `total_usage` (`:1305-1310`) e **não** é emitido por passo.
- `TurnResult.usage` e `ChatMessage.usage` são persistidos (`:1646, 1653-1661, 1708-1716`); `MessageUpdated`/`Done` carregam usage no snapshot (`:1671-1674, 1770-1775`).
- O `ContextStats` por passo (só Code) é emitido antes de cada request e recalibrado após o uso real (`:1214-1327`), mas **não contém campos de cache** (§6.4).

### 6.3 `usage_log` no `db.rs` — colunas, agregações, IPC

- Schema: `usage_log(id, conversation_id, message_id, provider_id, model_id, input_tokens, output_tokens, reasoning_tokens, cached_tokens, total_tokens, cost, created_at)` — `db.rs:131-144`. **Sem `cache_write_tokens`, sem `cache_hit_percent`, sem `step`/`request_id`** (a linha é 1 por turno).
- Escrita: `record_usage` chamado uma vez por turno (`harness/mod.rs:1653-1661` → `db.rs:2161-2191`), com os totais somados.
- Leitura: **não existe leitor de produção**. `usage_summary` é `#[cfg(test)]` (`db.rs:2193-2194`) e nenhum comando do `invoke_handler` expõe agregação (`lib.rs:54-151`; nenhum `usage` na lista). ✅ Ou seja: a tabela é write-only do ponto de vista do app; o hit% histórico não tem caminho até a UI.
- Export markdown da conversa mostra `entrada/saída/raciocínio` mas omite `cachedTokens` (`commands/conversations.rs:307-321`). ✅
- Não há agregação por passo/provedor acessível ao renderer; contexto do Code vem de `get_code_session_state → ContextStats` (`commands/code.rs:96-113`; `domain.rs:1366-1379`).

### 6.4 `ContextStats` (só perfil Code) e calibração

- `ContextStats` (`domain.rs:1322-1336`) tem `used/window/output_cap/percent/compacted/messages/breakdown{systemPrompt,toolDefinitions,messages}` — **zero campos de cache**. ✅
- Só é calculado/emitido quando `profile == Code`: começo do turno (`harness/mod.rs:1099-1110`), antes de cada passo (`:1214-1231`), calibrado após o usage do passo (`:1314-1327`) e no fecho (`:1719-1735`). O perfil Chat não tem medidor no backend. ✅
- Estimativa: `estimate_context` = `chars/4` por bloco + 8 tokens/mensagem + 16/tool call (`harness/code/session.rs:444-476`); `history_request_chars` **ignora imagens** (`harness/mod.rs:686-704`).
- Calibração: `calibrate_context(stats, usage.input_tokens)` (`session.rs:481-511`) substitui `used` pelo `input_tokens` real e escala o breakdown. ⚠️ Para Anthropic, `input_tokens` **não inclui** cache read; para OpenAI inclui os cached dentro de `prompt_tokens`; para Google `promptTokenCount` inclui cached. O mesmo código de calibração produz semânticas diferentes por protocolo → percentual/tokens do medidor ficam inconsistentes. ❓ confirmar semântica exata com task-1.
- `compacted` vem do fold `context/compacted` (`session.rs:384-393`), que guarda `to_seq` — e o valor gravado pela compactação automática é `messages.len()` ao início do turno (`harness/mod.rs:1149, 1165-1169`), não a quantidade efetivamente resumida (ver §7.2).

### 6.5 O que falta para medir hit% (requisitos de dados)

1. Campo `cache_write_tokens`/`cache_creation_tokens` em `UsageInfo` + parsing nos 4 adaptadores (`domain.rs:175-193`; `openai_chat.rs:360-368`; `openai_responses.rs:564-571`; `anthropic.rs:425-439`; `google.rs:313-319`).
2. Normalização do denominador por protocolo (prompt total = uncached + cache read + cache write) — Hoje `input_tokens` significa coisas diferentes.
3. `usage_log` com por-request (não só por turno) e colunas de cache write/read; leitor + IPC para hit% (hoje `usage_summary` morre em `#[cfg(test)]`, `db.rs:2193-2194`).
4. `TurnEvent::Usage` por passo (hoje só no fim, `harness/mod.rs:1663-1668`) para o indicador "em tempo real".
5. `ContextStats` com bloco de cache (`domain.rs:1322-1336`) e emissão também no perfil Chat (hoje só Code).
6. Diagnóstico de quebra de prefixo (motivo: relógio, todos, git, corte, compactação, troca de modelo, mudança de modo) — não existe hoje; sem isso a UI da task-3 não consegue explicar "cache quebrado".
7. Para o gateway: confirmar se `x-opencode-session` sozinho dá afinidade de cache e como medir cache hit por sessão (❓ task-1).

---

## 7. Compactação e poda — `src-tauri/src/harness/code/compaction.rs`

### 7.1 Compactação automática

- Constantes: gatilho `TRIGGER_RATIO = 0.75`, mantém ~30% do fim (`KEEP_RATIO = 0.3`), mínimo 6 mensagens, cap 2.000 chars/mensagem no transcript — `compaction.rs:22-29`; limite de transcript 24k chars (`:110-113`).
- Roda **no início de cada passo** do perfil Code quando `settings.auto_compact` (`harness/mod.rs:1146-1170`; `settings.auto_compact` em `domain.rs:724`). `used = estimate_tokens(history_chars + system_prompt)` (`compaction.rs:173`), `usable = window - output_cap`, gatilho 75% (`:175-179`).
- Corte: `cut_index` mantém ~30% dos chars do fim e recua até uma mensagem de `User` (nunca separa assistant↔tool_result) — `:63-89`.
- Chamada de resumo: `batch::complete_text` com **system prompt próprio** (`summary_system_prompt`, `:119-128`), `history = [user(transcript)]`, `tools: []`, sem temperatura (`batch.rs:33-61`; `compaction.rs:185-193`).
  - ✅ **Não reusa o prefixo da conversa**: system prompt diferente, histórico diferente, sem tools, e `x-opencode-session` = `"batch"` (`batch.rs:52`), não o id da conversa. O request de resumo paga prompt cheio em toda compactação e não aproveita o cache da sessão.
- Depois do resumo: `history` é reescrito para `[summary_message] + history[cut..]` (`compaction.rs:137-143, 214`); `before/after` calculados para `tokens_freed`; resumo persistido em `session_summaries` (`:218-223`); evento `Compacted` + `context/compacted` (`:224-231, 241-255`).

### 7.2 Inconsistência `to_seq` × corte real (⚠️ alta confiança, pedir teste)

- No turno, `messages` = todas as mensagens do DB já incluindo a mensagem do usuário recém-persistida (`harness/mod.rs:885, 865-869`). `covered` passado à compactação é `messages.len()` (`:1149`) — **total de mensagens do DB**.
- Dentro de `maybe_compact`, o `to_seq` persistido é esse `covered` (`compaction.rs:218-223`), igual ao que `compacted_messages` reporta (`:227, 241-255`).
- Mas o texto resumido é só `history[..cut]` (`compaction.rs:181, 92-116`), onde `cut` é índice do **histórico neutro** — que expande cada assistant multi-step em várias `HistoryMessage` (`harness/mod.rs:2103-2153`), logo `cut_neutro` não corresponde a um índice de `messages`.
- No turno seguinte, `apply_stored_summary` usa `to_seq` como **índice de mensagens** (`compaction.rs:261-274`) e `build_history` começa em `messages[cut..]` (`harness/mod.rs:895-918`).
- Consequências prováveis ⚠️:
  1. a parte "recente" (~30%) que a compactação manteve no turno corrente **não foi resumida** e, no turno seguinte, é descartada pelo corte em `messages.len()` — perda de contexto real (inclusive a mensagem do usuário do turno em que a compactação rodou, que fica no tail não resumido);
  2. o histórico reconstruído **não é prefixo** de nenhum request anterior → cache perdido de qualquer forma (esperado ao compactar), mas a inconsistência torna o comportamento difícil de raciocinar/explicar ao usuário;
  3. o mesmo `to_seq` alimenta a UI (`compacted`) com um número maior que o efetivamente resumido.
- ❓ Confirmar com um teste de regressão (dois turnos, compactação no primeiro, comparar `messages` reconstruídas com o esperado). O PLAN deve tratar isso como correção necessária antes de prometer cache estável pós-compactação.

### 7.3 Compactação manual (`/compact`) — `commands/code.rs:838-929`

- Converte 1:1 `ChatMessage → HistoryMessage` (`:859-872`), então aqui `cut` **é** índice de mensagem; grava `insert_session_summary(1, covered=cut)` (`:912-916`) — coerente com `apply_stored_summary`, mas só inclui `content` (sem tool calls/tool results) no transcript (`:861-871, 876`).
- Emite evento com kind `context/stats` mas payload `{manual, coveredMessages, summaryChars}` (`:917-926`): `session::context_stats` decodifica `ContextStats` com campos obrigatórios (`used`, `window`, `output_cap`, `percent`) e **falha** → `get_code_session_state.context` volta a `None` até o próximo turno; e `compacted_messages` não é atualizado (fold lê `context/compacted`, `session.rs:384-393`). ✅ bug de projeção (afeta medidor/UI; a task-3 deve assumir `context` nulo depois de `/compact`).

### 7.4 Quais turnos perdem cache na compactação

| Momento | Prefixo | Cache |
| --- | --- | --- |
| Passo em que a compactação roda | `[summary] + tail` ≠ request anterior | **perde tudo** dos passos anteriores do turno (o resumo é novo) |
| Passos seguintes do mesmo turno | `[summary] + tail` + append | preservado (a partir do resumo) |
| Turno seguinte | `[summary] + build_history(messages[cut..])` — geralmente ≠ `[summary] + tail` do turno anterior | perde de novo até estabilizar |
| Chamada de resumo | prompt próprio | não reusa cache da conversa |

### 7.5 Chamadas batch e subagentes

- `batch::complete_text` usa `x-opencode-session: "batch"` fixo (`batch.rs:52` → `harness/mod.rs:232-253`). Todas as chamadas batch (resumo de compactação e sugestão de mensagem de commit, `commands/git.rs:351`) compartilham esse id; o system prompt do resumo é fixo (potencialmente cacheável), mas o `user_text` (transcript) varia.
- Subagente: cria conversa efêmera (`subagent.rs:160-169`), roda um turno Code completo com `system_prompt_override` e depois **apaga a conversa** (`:171-199`). O `x-opencode-session` do filho é o id efêmero → ⚠️ não compartilha cache/rota com a sessão pai (❓ semântica do gateway). O system prompt do filho difere do pai pelas instruções extras (`harness/mod.rs:1023-1027`) e pelo relógio de minuto (`harness/mod.rs:1005`) → também miss entre subagentes.

---

## 8. Fluxos que reescrevem histórico ou mudam o request

| Fluxo | O que o backend faz | Efeito no cache | Evidência |
| --- | --- | --- | --- |
| **Regenerar** | renderer trunca e chama `run_turn` com `regenerate:true`; backend acha a última mensagem de user, apaga tudo depois e cria novo assistant; **reusa a mesma user message** | prefixo até a user message preservado; a resposta anterior (e tool results) sai do histórico | `harness/mod.rs:1805-1830`; `ChatMessage.regenerate` `domain.rs:326-327`; renderer `src/lib/store/chatStore.ts:992-1078` ⚠️ fora do backend |
| **Editar mensagem** | não há comando de edição no backend; o renderer faz `truncate_conversation(from_message_id)` e reenvia | tudo a partir da mensagem editada é recriado (cache perdido do ponto em diante) | `commands/conversations.rs:162-172`; `db.rs:1924-1945`; renderer `chatStore.ts:1078` ⚠️ |
| **Truncar conversa** | `delete_messages_from(created_at, id)` (prefixo sobrevive) | prefixo anterior preservado; tail descartado (não reusado) | `commands/conversations.rs:162-172`; `db.rs:1940-1944` |
| **Trocar modelo/provedor** | `update_conversation_model` ao rodar o turno (`harness/mod.rs:830-833`); em `build_history`, assistants com `provider_id`/`model_id` diferentes caem no fallback neutro (`:2067-2097`) | **histórico inteiro muda de forma** (sem `provider_state`): miss total de mensagens; ao voltar ao modelo antigo, o replay volta (determinístico) mas o cache do provedor anterior já não serve se ele for outro | `harness/mod.rs:2067-2097, 830-833` |
| **Anexos** | re-inlinação por turno + budget de imagens + toggle `include_attachments` | reescrita de mensagens antigas (ver §3.5) | `harness/mod.rs:1994-2001, 2209-2310` |
| **Retomada/reabertura** | nada especial: `build_history` a partir do DB | igual ao último request se nada mudou (corte/compactação/anexos podem mudar) | `harness/mod.rs:884-918, 895-918` |
| **Compactar** | ver §7 | reescreve prefixo + possível perda de tail | `harness/mod.rs:1146-1170, 889-918` |
| **Mudar modo/plano no meio do turno** | notas anexadas ao system prompt | invalida system prompt + histórico dos passos seguintes | `harness/mod.rs:1178-1209` |
| **Estourar `max_steps`** | request final forçado sem tools e com `# Wrap-up` | invalida todo o prefixo no request mais caro | `harness/mod.rs:1476-1500` |
| **Trocar perfil de request** | `request_profile` deriva da credencial (`OAuth` ⇒ `chatgpt-plan`, senão `standard`) | corpo muda (store/instructions/campos) ⇒ miss total na transição | `catalog.rs:62-66`; `harness/mod.rs:247`; `openai_responses.rs:81-94` |

### 8.1 Não-determinismo no caminho do request

| Ponto | Risco | Evidência |
| --- | --- | --- |
| Ordem de protocolos quando `model.protocols` vazio | iteração de `HashMap<String,String>` dos endpoints | `harness/mod.rs:2452-2476` (`:2462`) |
| Desempate de ordenação de mensagens | `ORDER BY created_at, id` com `id` UUIDv4 aleatório; user e assistant inseridos em sequência podem empatar no ms | `db.rs:1878-1882`; `domain.rs:245-283, 1521-1523` |
| Ordem das tools MCP | ordem devolvida por cada servidor + ordem de servidores; sem sort | `mcp/mod.rs:395-397, 416-430` |
| `user-agent` | `Lumina/<CARGO_PKG_VERSION>` muda entre versões | `harness/mod.rs:245` |
| Skills catalog | estável (ordenado/merge determinístico) | `tools/skills.rs:309-311` |
| Árvore do workspace | estável na ordem (sort), conteúdo muda com o disco | `harness/code/context.rs:200-261` (`:214`) |
| Headers estáticos | ordenados + lowercase | `catalog.rs:74-85` |
| JSON body | mapas ordenados; floats determinísticos | `Cargo.toml:26` |
| Timestamps | não entram no body (só em `ToolCallRecord`/DB/eventos) | `providers/mod.rs:84-97`; `harness/mod.rs:2356-2368` |

---

## 9. Defeitos priorizados

Severidade: **blocker** = impede a meta de 98–99% (ou a verificação dela); **major** = custo/latência relevante ou quebra frequente em fluxos comuns; **minor** = degradação pontual.

### 9.1 BLOCKER

#### B1. Relógio com minuto no topo do system prompt do perfil Code
- **Sintoma de cache:** a 1ª requisição de cada turno Code iniciado em outro minuto tem prefixo diferente do turno anterior ⇒ cache miss total (system + tools + todo o histórico) nesse passo 1; só passos 2..N do mesmo turno aproveitam, e turnos consecutivos no mesmo minuto podem acertar por coincidência.
- **Esperado:** o request cross-turn deve ter o mesmo prefixo; data/hora não pode estar no meio do prefixo cacheável (quando aparece, no máximo granularidade de dia e no fim, nunca antes do system estável).
- **Atual:** `harness/mod.rs:1005` injeta `chrono::Local::now().format("%Y-%m-%d %H:%M")` em `Date:` dentro de `# Environment`, seção 2 do prompt (`code/prompt.rs:276-280`), imediatamente após a identidade.
- **Correção que o PLAN deve prescrever:** system prompt **estável por sessão** (sem relógio); se o modelo precisa da data, mandá-la na mensagem final do turno (bloco de contexto volátil) ou congelar a data no início da sessão; teste que compare `system_prompt` do turno N e N+1 no mesmo dia/sessão.

#### B2. System prompt Code é mutável por estado de sessão/workspace
- **Sintoma de cache:** qualquer `todo_write`, mudança de `git dirty`/`ahead`/`behind`, criação de arquivo de 1º nível (muda contagem da árvore), edição de `AGENTS.md`, mudança de plano/feedback ou do modo de permissão altera o system prompt do turno seguinte ⇒ **miss total** de system prompt + histórico, mesmo com B1 corrigido.
- **Esperado:** no máximo um "system prompt" imutável por sessão; o volátil (git/tree/todos/plano/modo/data) deve ir como **mensagem de contexto no fim** do array de mensagens (ou bloco/turno separado que não preceda o histórico cacheável).
- **Atual:** `# Permission policy` no início (`code/prompt.rs:81-124`), `# Workspace` no meio (`:126-175`) e `# Plan and tasks` no fim (`:189-229`); contexto montado por turno (`harness/code/context.rs:103-132`); prompt montado por turno (`harness/mod.rs:996-1031`).
- **Correção que o PLAN deve prescrever:** congelar prompt de sistema por sessão (snapshot no DB/in-memory por conversa) e mover tudo que muda por turno para uma mensagem `user`/`system` final dedicada (ex.: `# Contexto do turno`), com registro do hash do prefixo estável; invalidar o snapshot apenas em eventos explícitos (troca de workspace, troca de modelo, edição de AGENTS.md/instruções).
- **Nota de desenho:** o `HARNESS.md:531-532` ("volátil no fim do prompt") é insuficiente: o system prompt inteiro precede o histórico na serialização dos 4 protocolos; "fim do system" continua invalidando todas as mensagens.

#### B3. Corte por orçamento sem histerese em `build_history`
- **Sintoma de cache:** conversa/turno longo ⇒ a cada turno o grupo mais antigo sai (ou a fronteira se move) ⇒ a **primeira** mensagem do histórico muda ⇒ cache de mensagens ~0; e, como o system prompt também está no request, o custo é o request inteiro.
- **Esperado:** corte estável (watermark que só avança quando o tamanho ultrapassa o limite por margem, com histerese) ou, preferencialmente, compactação explícita com fronteira estável; nunca deslizar a janela a cada turno.
- **Atual:** `harness/mod.rs:2022-2046` recalcula `keep_from` todo turno; budget `context_window*3` chars clamp 40k–600k (`:2185-2188`); em Code, tool results de até 24k chars (`:50`) fazem o budget estourar com ~25 resultados.
- **Correção que o PLAN deve prescrever:** watermark persistido por conversa (id/seq da primeira mensagem incluída), avançando em saltos (ex.: ≥ 20% do budget) e sempre em fronteira de turno; teste de dois turnos consecutivos garantindo que `history[0]` é o mesmo enquanto o budget não estourar; combinar com B2/§7 para o caso de compactação.

#### B4. Anthropic sem `cache_control` e sem medição de cache write
- **Sintoma de cache:** com protocolo `anthropic` (todos os Claude + Kimi K3 + MiniMax + parte dos Qwen do catálogo), o cache explícito de prefixo nunca é ativado; `cache_read_input_tokens` tende a 0.
- **Esperado:** breakpoints em (a) fim das tools, (b) fim do bloco system estável e (c) última mensagem/último tool result do turno (máx. 4 breakpoints, TTL 5m e/ou 1h — ⚠️ política a definir com task-1); medir `cache_creation_input_tokens` além de `cache_read_input_tokens`.
- **Atual:** `system` string (`anthropic.rs:77-80`), tools sem marcador (`:81-94`), mensagens sem marcador (`:119-207`); parsing só de `cache_read_input_tokens` (`:425-439`).
- **Correção que o PLAN deve prescrever:** configuração por protocolo de "onde marcar cache" com defaults por provedor; TTL selecionável; `UsageInfo` + parsing de cache write; teste unitário do body Anthropic com breakpoints nos 3 lugares e `cache_creation_input_tokens` no usage.

#### B5. Ausência de telemetria de cache/hit% (impede verificar a meta e a UI da task-3)
- **Sintoma de medição:** nenhum lugar do backend calcula cache read/write por request, hit%, nem por passo/turno/sessão; o renderer não recebe dado suficiente para o indicador em tempo real; `usage_log` é write-only.
- **Esperado:** `UsageInfo` com `cache_read_tokens`/`cache_write_tokens`; normalização de prompt total por protocolo; evento `Usage` por passo; hit% agregado (turno/sessão/provedor/modelo) com IPC; `ContextStats` com bloco de cache; `usage_log` por request.
- **Atual:** `domain.rs:175-193` (sem cache write); `events.rs:51-52` (Usage só no fim); `harness/mod.rs:1663-1668` (emissão única); `db.rs:131-144, 2193-2194` (sem cache write; `usage_summary` só teste); `lib.rs:54-151` (sem IPC de usage); `domain.rs:1322-1336` (ContextStats sem cache).
- **Correção que o PLAN deve prescrever:** mudanças de contrato (`UsageInfo`, `UsageLogRow`, `TurnEvent`, `ContextStats`) com migração aditiva do SQLite, parsing dos campos que faltam nos 4 adaptadores, emissão por passo + fim, e um comando IPC de agregação (contrato compartilhado com a task-3, dono Lead).

### 9.2 MAJOR

#### M1. `mode_notes` anexadas ao system prompt no meio do turno
- Sintoma: aprovação de plano/chip de permissão ⇒ todos os passos seguintes do turno perdem o prefixo (system + histórico).
- Atual: `harness/mod.rs:631-636, 1178-1209`; Veredito: mover a nota para a **última mensagem** (user) do próximo request; system prompt imutável no turno.
- Evidência: `:1199-1204` (acúmulo), `:1209` (aplicação), `:1483, 1727` (reuso no final forçado/fecho).

#### M2. Resposta final forçada muda system prompt e zera tools
- Sintoma: no request mais caro do turno (histórico completo), tools vazias e system alterado ⇒ miss quase total e possível mudança de comportamento.
- Atual: `harness/mod.rs:1476-1500` (`forced_prompt` `:1484-1490`; `tools: Vec::new()` `:1499`).
- Correção: manter system prompt e tools **idênticos** e instar o wrap-up via mensagem final de user; ou, melhor, reservar o último passo para o wrap-up desde o começo (sem mudar o prefixo).

#### M3. Compactação: prefixo reescrito, chamada de resumo sem reuso, `to_seq` inconsistente
- Sintoma: cada compactação zera o cache do turno; o turno seguinte pode nem reproduzir o `[resumo + tail]`; ⚠️ possível perda de contexto recente.
- Atual: `compaction.rs:137-143, 181, 214, 218-223, 261-274`; `harness/mod.rs:889-918, 1146-1170`; `batch.rs:51-61` (resumo com system/tools/sessão próprios).
- Correção (PLAN): persistir a fronteira como **id/last-message-seq estável**; garantir que o transcript do resumo cobre exatamente as mensagens removidas (inclusive a mensagem do usuário do turno, se for removida); reconstrução do turno seguinte = `[resumo] + mesmas mensagens da cauda`; teste de regressão de dois turnos; evento/telemetria de "cache quebrado por compactação"; decidir se o resumo deve reusar o prefixo estável da conversa (economia) ou manter prompt próprio (isolamento).

#### M4. Anexos/imagens reescritos a cada turno
- Sintoma: mensagens antigas do usuário mudam quando o budget de imagens estoura ou quando `include_attachments` muda; re-inline de base64 é caro e o conteúdo muda de forma (imagem ↔ texto) no meio do histórico.
- Atual: `harness/mod.rs:1994-2001, 2209-2235, 2242-2330`.
- Correção: congelar no momento do envio o "render" do anexo (texto extraído e/ou referência de imagem) e reusá-lo imutável; budget de imagens decidido uma vez por mensagem (ou por turno) e nunca revisto; teste que monte o histórico de dois turnos com imagens e compare byte a byte.

#### M5. Troca de modelo/provedor invalida o replay de todo o histórico
- Sintoma: trocar de modelo (mesmo provedor) ou de provedor ⇒ todos os assistants antigos perdem `provider_state` e viram texto + tool_calls ⇒ prefixo inteiro diferente; é a migração mais comum de usuário ("troquei de modelo no meio da conversa").
- Atual: `harness/mod.rs:2067-2097` (mesma `provider_id`+`model_id` exigidos).
- Correção: envelope v3 com replay **por modelo** (mapa `modelKey → steps`) ou manter o replay do último request mesmo com troca (o provedor pode validar); no mínimo, emitir evento de "cache invalidado por troca de modelo" para a UI (task-3) e documentar o custo. Alternativa de produto: ao trocar de modelo, começar conversa nova ou manter apenas o texto.

#### M6. OpenAI sem `prompt_cache_key`; whitelist do plano bloqueia campos futuros
- Sintoma: cache automático depende só do prefixo; sem chave de afinidade de rota, requests iguais podem cair em réplicas diferentes (⚠️ docs OpenAI dizem que `prompt_cache_key` melhora hit em prefixos compartilhados; ❓ confirmar com task-1). No perfil ChatGPT-plan, qualquer campo novo é removido pela whitelist.
- Atual: `openai_chat.rs:50-105` e `openai_responses.rs:74-137` (nenhum campo); whitelist `openai_responses.rs:63-72, 141-156`; `store:false` no plano `:88-93`.
- Correção (PLAN): enviar `prompt_cache_key` estável (derivado de `conversation_id`, mesmo conceito do `x-opencode-session`) nos dois adaptadores; incluir na whitelist do plano; avaliar `prompt_cache_retention`; manter `x-opencode-session` como está (catálogo confirma: `data/catalog.json:1822`).

#### M7. `ContextStats` só no perfil Code, sem cache, e calibração inconsistente entre protocolos
- Sintoma: o medidor/indicador não tem dados no Chat; o percentual de contexto é distorcido quando há cache (Anthropic `input_tokens` exclui cache read; OpenAI inclui).
- Atual: `domain.rs:1322-1336`; `events.rs:112-115`; `harness/mod.rs:1099-1110, 1214-1231, 1314-1327, 1719-1735`; `session.rs:444-511`.
- Correção: normalizar "prompt total" por protocolo antes de calibrar (usar `input+cache_read+cache_write`), mostrar breakdown de cache separado; emitir stats também no Chat (ou um evento próprio de cache por request).

### 9.3 MINOR

| # | Defeito | Evidência | Observação |
| --- | --- | --- | --- |
| m1 | Data do Chat muda 1×/dia e quebra o prefixo na virada do dia | `harness/prompt.rs:31, 41, 623-651` | Mover data para mensagem final ou congelar por sessão |
| m2 | DeepSeek nativo (`prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`) não é lido no openai-chat | `providers/openai_chat.rs:360-368` | ⚠️ nomes do provedor — task-1; sem isso `cached_tokens` fica `None` no gateway DeepSeek |
| m3 | Ordem de protocolos não determinística quando o modelo não declara protocolos | `harness/mod.rs:2452-2476` (`:2462`) | Ordenar por lista fixa/alfabética |
| m4 | `usage_log` write-only; sem IPC/agregação de produção; export sem cached | `db.rs:131-144, 2193-2194`; `lib.rs:54-151`; `commands/conversations.rs:307-321` | Fazer parte de B5 |
| m5 | Compactação manual grava evento `context/stats` com payload incompatível → `context` do estado da sessão volta a `None`; `compacted` não atualiza | `commands/code.rs:912-926`; `session.rs:377-404`; `domain.rs:1322-1336` | Corrigir kind/payload ou usar `context/compacted` |
| m6 | Batch usa `x-opencode-session: "batch"`; subagente usa id efêmero | `batch.rs:52`; `subagent.rs:160-199`; `harness/mod.rs:232-253` | ⚠️ Semântica do gateway; avaliar usar um id estável por sessão pai/tipo de operação |
| m7 | MCP appende tools no prompt/definições sem sort; ordem do servidor | `harness/mod.rs:1008-1021, 1036-1044`; `mcp/mod.rs:395-397, 416-430` | Sort estável por wire name |
| m8 | `user-agent` versionado muda por release; efeito em roteamento desconhecido | `harness/mod.rs:245` | ❓ avaliar com task-1 |
| m9 | Budget de chars não considera system prompt/tools nem imagens no medidor do histórico; `history_request_chars` ignora imagens | `harness/mod.rs:686-704, 2185-2188` | Só afeta estimativa, não o cache diretamente |
| m10 | `code_timeout_secs` no prompt (`# Code execution`) muda o system prompt quando o usuário altera settings | `harness/prompt.rs:350-367` (`:354`) | Congelar no snapshot de sessão (natural com B2/P2) |
| m11 | Troca de modelo no Chat muda `model.name` no `# Identity` (prefixo) | `harness/prompt.rs:32, 38-41` | Esperado; alinhar com M5 |
| m12 | `# Skills` muda quando skills externas mudam no disco (scan em todo turno) | `harness/mod.rs:941-949`; `tools/skills.rs:309-311, 389-402` | Congelar catálogo por sessão (B2) |
| m13 | `history_budget` mínimo de 40k chars pode exceder janelas pequenas (ex.: 8k tokens) | `harness/mod.rs:2185-2188` | Ajustar por modelo |
| m14 | Tempo do relógio local: virada de fuso/clock skew entre requests | `harness/mod.rs:1005` | Resolvido por B1 |
| m15 | `usage`/`context_stats` não são emitidos ao reabrir a sessão (replay do DB mostra o último, mas não recalcula) | `commands/code.rs:96-113`; `session.rs:377-404` | Depende de task-3 para especificar |

---

## 10. Tabela — ponto de quebra do prefixo → causa → arquivo

| Ponto de quebra (reset do prefixo cacheável) | Causa | Evidência |
| --- | --- | --- |
| **Todo o prompt + histórico** (Code, todo turno iniciado em outro minuto) | relógio `%Y-%m-%d %H:%M` em `# Environment` | `harness/mod.rs:1005`; `harness/code/prompt.rs:276-280` |
| system prompt a partir de `# Permission policy` | modo de permissão/plano no início do prompt | `code/prompt.rs:81-124`; `harness/mod.rs:1178-1207` |
| system prompt a partir de `# Workspace` | git branch/ahead/behind/dirty, projeto, árvore | `code/prompt.rs:141-174`; `context.rs:125-128, 192-261` |
| system prompt a partir de `# Project instructions` | `AGENTS.md`/`.lumina/instructions.md` editados | `code/prompt.rs:177-187`; `context.rs:159-189` |
| system prompt a partir de `# Plan and tasks` | todos/plano/feedback mudaram | `code/prompt.rs:189-229`; `context.rs:107-109` |
| cauda do system prompt (notas de modo) | `compose_system_prompt` anexa notas | `harness/mod.rs:631-636, 1199-1209` |
| system prompt final + tools | final forçado: `# Wrap-up` e `tools: []` | `harness/mod.rs:1483-1500` |
| histórico a partir da 1ª mensagem sujeita a corte | budget/re-cálculo do corte a cada turno | `harness/mod.rs:2022-2046, 2185-2188` |
| histórico no meio (mensagem antiga reescrita) | re-inline de anexos / budget de imagens / toggle | `harness/mod.rs:1994-2001, 2209-2330` |
| histórico inteiro a partir do resumo | compactação automática/manual | `harness/mod.rs:1146-1170, 889-918`; `compaction.rs:214, 261-274` |
| todas as mensagens assistant | troca de modelo/provedor desativa replay | `harness/mod.rs:2067-2097` |
| prompt Chat `# Identity` | data diária (`Today is`) | `harness/prompt.rs:31, 41, 623-651` |
| tools/prompt `# Tools`/`# Available tools` | settings (`shell_enabled`, toggles), workspace, MCP | `harness/mod.rs:2372-2419, 1032-1044`; `prompt.rs:124-198` |
| prompt `# Skills` | catálogo de skills mudou | `harness/mod.rs:941-949`; `prompt.rs:269-328` |
| corpo inteiro | fallback de protocolo ou troca de perfil de request (OAuth↔API key) | `providers/mod.rs:776-834`; `harness/mod.rs:247`; `catalog.rs:62-66` |
| body Anthropic | breakpoints ausentes (não há cache a quebrar hoje) | `anthropic.rs:50-117` |
| body OpenAI-responses (plano) | whitelist remove campos de cache | `openai_responses.rs:63-72, 141-156` |

---

## 11. Incertezas e o que o PLAN precisa confirmar

1. **Semântica do cache por provedor** (Anthropic opt-in? OpenAI prefix order inclui tools? DeepSeek field names? TTLs? `prompt_cache_key` behavior?) — delegado à task-1 (`docs/research/prompt-caching.md`); esta auditoria lista **o que o backend envia/não envia**, não substitui a pesquisa.
2. **`x-opencode-session`**: o catálogo diz que serve para roteamento **e** prompt caching (`data/catalog.json:1822`) e o campo é documentado como "stable id" (`providers/mod.rs:174-176`), mas não há código do gateway no repositório para provar granularidade (por sessão? por prefixo? TTL?). ❓
3. **Bug do `to_seq` na compactação automática** (§7.2): alta confiança por leitura, mas não rodei um teste; pedir ao PLAN um teste de regressão antes de fechar a correção.
4. **Ordem `created_at, id`**: não reproduzi o empate de milissegundo; se ocorrer, a ordem do histórico pode divergir da ordem de inserção (e `delete_messages_from` usa a mesma ordenação, então é consistente internamente — o risco é o modelo receber assistant antes do user).
5. **Calibração por `input_tokens`** (§6.4): a semântica de `input_tokens` com cache difere por provedor; confirmar com task-1 antes de definir a fórmula de hit% (`cache_read / (input + cache_read + cache_write)` por protocolo).
6. **Efeito de `user-agent`/auth headers** na chave de cache do provedor/gateway: não verificado. ❓
7. **Custo real do `store:false` no plano ChatGPT** (reenvio integral do `input` a cada request) e se o cache de prefixo continua valendo nessa rota: ❓ task-1 (`docs/research/openai-oauth.md:497, 546, 604` já tem pistas).
8. **Árvore do workspace**: `tree_summary` lista até 2 níveis? O código caminha com `max_depth = 1` a partir da raiz (`context.rs:256`), mas documenta "2 níveis" (`:191`); irrelevante para cache além do conteúdo ser menor.

---

## 12. Apêndice — pontos de extensão que o PLAN deve tocar (somente leitura nesta auditoria)

| Objetivo | Arquivos-chave |
| --- | --- |
| Prompt estável por sessão / contexto volátil no fim | `src-tauri/src/harness/mod.rs:996-1031`, `src-tauri/src/harness/code/prompt.rs:264-300`, `src-tauri/src/harness/code/context.rs:103-132`, `src-tauri/src/harness/prompt.rs:25-122` |
| Cache breakpoints por protocolo | `src-tauri/src/providers/anthropic.rs:50-117`, `src-tauri/src/providers/openai_chat.rs:50-105`, `src-tauri/src/providers/openai_responses.rs:74-156`, `src-tauri/src/providers/google.rs:47-88` |
| Session affinity / chaves de cache | `src-tauri/src/providers/mod.rs:165-241`, `src-tauri/src/harness/mod.rs:232-253` |
| Telemetria de cache (read/write/hit%) | `src-tauri/src/domain.rs:175-193, 1322-1336`, `src-tauri/src/events.rs:51-52, 112-115`, `src-tauri/src/providers/{openai_chat,openai_responses,anthropic,google}.rs` (`parse_usage`), `src-tauri/src/harness/mod.rs:1305-1327, 1653-1668`, `src-tauri/src/db.rs:131-144, 2159-2279`, `src-tauri/src/lib.rs:54-151` |
| Corte estável de histórico | `src-tauri/src/harness/mod.rs:1975-2051, 2185-2207` |
| Compactação determinística | `src-tauri/src/harness/code/compaction.rs:63-143, 156-274`, `src-tauri/src/commands/code.rs:838-929`, `src-tauri/src/harness/batch.rs:33-95` |
| Fluxos que reescrevem histórico | `src-tauri/src/harness/mod.rs:1785-1830, 2062-2097`, `src-tauri/src/commands/conversations.rs:162-172`, `src-tauri/src/db.rs:1924-1945` |
| Não-determinismo pontual | `src-tauri/src/harness/mod.rs:2452-2476`, `src-tauri/src/db.rs:1878-1882`, `src-tauri/src/mcp/mod.rs:395-430` |

> **Resumo de uma frase:** o backend já tem uma base boa (histórico neutro determinístico + replay por passo + `x-opencode-session` estável por conversa dentro do turno), mas hoje **quebra o prefixo entre turnos por relógio/prompt mutável, degrada com o corte de histórico, não envia marcadores de cache para Anthropic nem chave de cache para OpenAI, e não mede cache write/hit%** — os quatro eixos que o PLAN precisa atacar para chegar a 98–99%.
