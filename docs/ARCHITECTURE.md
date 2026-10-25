# Lumina — Arquitetura

Lumina é um aplicativo desktop de conversação com LLMs, construído em **Tauri 2 + React 19 + Tailwind CSS 4**. O objetivo é reproduzir a experiência dos chats de IA modernos (ChatGPT/Claude) — streaming com raciocínio visível, ferramentas, anexos, artefatos e UI generativa — usando **OpenCode Go** e **OpenCode Zen** como únicos provedores.

## 1. Princípios

1. **Local-first**: conversas, anexos e artefatos ficam no disco do usuário (SQLite + arquivos no app-data). Nenhum servidor próprio.
2. **Um único ponto de verdade para modelos**: o catálogo embutido (`data/catalog.json`) descreve protocolo de wire, capacidades de raciocínio, visão, limites e preço de cada modelo. É gerado a partir da documentação oficial + models.dev + sondagens reais contra o gateway.
3. **Protocolo neutro**: o harness não conhece OpenAI/Anthropic/Google; ele fala com uma camada de provedores que traduz um modelo neutro de conversa para 4 protocolos de wire.
4. **Segurança por construção**: a UI generativa é declarativa (JSON com whitelist de componentes), nunca `eval`. HTML/SVG do agente roda em `<iframe sandbox>`.
5. **Degradação graciosa**: se um protocolo não é suportado pelo modelo, tenta o próximo; se um parâmetro de raciocínio falha, reenvia sem ele; se a rede cai, a mensagem parcial é preservada.

## 2. Stack

| Camada | Tecnologia |
| --- | --- |
| Shell desktop | Tauri 2 (Rust), janela frameless com titlebar própria |
| UI | React 19, TypeScript 7, Vite 8, Tailwind CSS 4, Radix UI, lucide-react, motion, sonner |
| Markdown | react-markdown + remark-gfm (tabelas, task lists, notas de rodapé, autolinks, riscado) + remark-math/rehype-katex, `rehype-raw` com sanitizador allowlist próprio (HTML cru seguro), Prism para código, Mermaid (lazy) — contrato em `docs/MARKDOWN.md` |
| Estado | Zustand (app, chat, ui) |
| Backend | Rust: tokio + reqwest (rustls) + rusqlite (SQLite embutido) + scraper/zip/quick-xml/calamine/pdf-extract |
| Streaming | SSE lido no Rust, reemitido ao renderer via `tauri::ipc::Channel` |
| Persistência | SQLite (`lumina.db`) + arquivos em `attachments/` e `artifacts/` |

## 3. Visão de processos

```
┌──────────────────────── WebView (React) ────────────────────────┐
│ AppShell → Sidebar │ ChatView │ Composer │ Dialogs │ ArtifactUI  │
│        Zustand stores: appStore · chatStore · uiStore            │
│                 src/lib/api.ts  (invoke + Channel)                │
└───────────────▲──────────────────────────────┬──────────────────┘
                │ eventos (Channel<TurnEvent>)  │ comandos (invoke)
┌───────────────┴──────────────────────────────▼──────────────────┐
│                        Rust core (Tauri)                         │
│ commands/  →  harness/  →  providers/ (4 protocolos)             │
│      │            │              └── SSE → ProviderEvent         │
│      │            ├── tools/ (web_search, fetch_url, create_file)│
│      │            └── documents/ (pdf, docx, xlsx, pptx, texto)  │
│      └── db.rs (SQLite) · config.rs (settings/segredos)          │
└──────────────────────────────────────────────────────────────────┘
```

## 4. Fluxo de um turno

```
UI: send()
  ├─ cria conversa (se necessário) e mensagens otimistas
  ├─ api.runTurn(payload, onEvent)  ──invoke──▶  commands::turn::run_turn
  │                                                ├─ registra CancellationToken
  │                                                ├─ harness::run_turn
  │                                                │   1. persiste user message
  │                                                │   2. monta histórico + anexos
  │                                                │   3. loop:
  │                                                │      provider.stream_completion
  │                                                │        └─ reasoning/text/tool_* events
  │                                                │      executa tools → anexa resultados
  │                                                │      repete até resposta final
  │                                                │   4. persiste assistant message + usage
  │                                                └─ retorna TurnResult
  └─ eventos chegam por Channel e atualizam o estado incrementalmente
```

Eventos (`TurnEvent`): `turn_started`, `step_started`, `reasoning_delta`, `reasoning_done`, `text_delta`, `tool_call_started`, `tool_call_args`, `tool_call_finished`, `artifact_created`, `usage`, `message_updated`, `title_updated`, `done`, `cancelled`, `error`.

## 5. Modelo de dados

### SQLite (`%APPDATA%/app.lumina.chat/lumina.db`)

```sql
conversations(id PK, title, created_at, updated_at, pinned, provider_id, model_id, message_count, preview)
messages(id PK, conversation_id, role, content, reasoning, status, tool_calls JSON,
         citations JSON, attachments JSON, model_id, provider_id, usage JSON,
         provider_state JSON, created_at, seq, trace JSON)
attachments(id PK, name, mime_type, size, kind, text, page_count, width, height, file_path, created_at)
artifacts(id PK, conversation_id, message_id, name, mime_type, kind, language, size, created_at, path)
usage_log(id, conversation_id, message_id, provider_id, model_id, tokens..., cost, created_at)
meta(key PK, value)
```

`provider_state` guarda o replay do turno do agente no formato **v2** (JSON opaco, só no backend — não trafega no IPC): `{"version":2,"steps":[{"state":<payload bruto do passo ou null>,"text":"<texto do passo>","toolCallIds":["id1", …]}]}`. Há um passo por resposta do provedor — um por passo com ferramentas e um para a resposta final (a resposta final forçada é o último) — e `toolCallIds` referencia `tool_calls` em ordem cronológica. No turno seguinte o harness reconstrói o turno multi-step no histórico (um assistant por passo + os tool results daquele passo), exatamente como o loop em memória faz, para que o provedor aceite os outputs das ferramentas. Bancos antigos (payload bruto de um único passo) continuam funcionando: o estado só é replayado quando a mensagem não tem tool calls e o modelo/provedor conferem; caso contrário é descartado e o histórico cai no fallback neutro (texto + tool calls + tool results).

`trace` guarda o traço do loop de agentes usado pelo espaço de pensamento do chat: uma entrada por passo com o `reasoning` visível daquele passo e a quantidade de tool calls que ele pediu (as chamadas em si continuam em `tool_calls`, na ordem cronológica). Bancos antigos recebem a coluna automaticamente na abertura (migração aditiva).

### Arquivos

```
<app-data>/
  settings.json        # preferências (sem segredos)
  secrets.json         # API keys (nunca enviadas ao renderer)
  attachments/<id>.<ext>
  artifacts/<id>/<nome>
  lumina.db
```

## 6. Catálogo de modelos

`scripts/build-catalog.mjs` gera `data/catalog.json` combinando:

1. **Tabelas oficiais** de [OpenCode Go](https://opencode.ai/v2/docs/console/go) e [Zen](https://opencode.ai/v2/docs/console/models/) — ids, nomes e protocolo de wire por modelo;
2. **models.dev** — `reasoning_options`, visão/anexos, limites de contexto, preço, família;
3. **Sondagens reais** (`scripts/probe-models.mjs`) — quais protocolos o gateway aceita para cada modelo (há modelos multi-protocolo);
4. **Heurísticas por família** para modelos novos que ainda não estão no models.dev.

Formato (resumo):

```json
{ "id": "glm-5.3-flash", "protocols": ["openai-chat"],
  "reasoningOptions": [{ "type": "effort", "values": ["low","high","max"] }],
  "attachment": true, "contextWindow": 1000000, "maxOutput": 131072,
  "modalities": { "input": ["text","image"], "output": ["text"] }, "status": "stable" }
```

O frontend importa o catálogo estaticamente (render instantâneo) e o backend o embute com `include_str!`; ambos leem o mesmo arquivo.

## 7. Provedores (4 protocolos)

| Protocolo | Endpoint (base `https://opencode.ai/inference[/go]`) | Modelos típicos |
| --- | --- | --- |
| `openai-chat` | `/openai/v1/chat/completions` | GLM, DeepSeek, Kimi (chat), Qwen, MiMo, LongCat, Step |
| `openai-responses` | `/openai/v1/responses` | GPT, Grok, Muse |
| `anthropic` | `/anthropic/v1/messages` | Claude, MiniMax, Kimi K3/K3.1, Qwen (alguns) |
| `google` | `/google/v1beta/models/{model}:streamGenerateContent` | Gemini |

Cabeçalhos: `Authorization: Bearer <key>`, `x-opencode-session: <session>`, `User-Agent: Lumina/<versão>`.

### Mapeamento de "modo de pensamento"

O usuário escolhe `off | esforço | orçamento` conforme as capacidades do modelo. O adaptador traduz:

| Protocolo | Desligar | Esforço | Orçamento |
| --- | --- | --- | --- |
| openai-chat | `thinking: {type:"disabled"}` | `reasoning_effort` | — |
| openai-responses | `reasoning.effort = "none"` | `reasoning: {effort, summary:"detailed"}` | — |
| anthropic | `thinking: {type:"disabled"}` | `thinking:{type:"adaptive"} + output_config:{effort}` | `thinking:{type:"enabled",budget_tokens}` |
| google | `thinkingConfig:{thinkingBudget:0}` | `thinkingConfig:{thinkingLevel}` | `thinkingConfig:{thinkingBudget}` |

Fatos descobertos por sondagem (ver `docs/MODELS.md`):
* Claude 5.x recusa `thinking.enabled`; exige `adaptive` + `output_config.effort`.
* GLM 5.x é *thinking-only*: desligar retorna 400 → o adaptador reenvia sem o parâmetro e sinaliza na UI.
* Kimi expõe reasoning apenas via protocolo Anthropic; MiniMax idem.
* GPT/Grok/Muse só mostram raciocínio com `summary` explícito.

### Fallback de protocolo

`providers::stream_completion` percorre `model.protocols` em ordem. Se o gateway responder `ModelProtocolUnsupported`, tenta o próximo. Erros de parâmetro de raciocínio são reenviados uma vez sem o parâmetro (auto-healing).

## 8. Harness

`harness::run_turn` executa:

1. Carrega conversa e histórico, injeta anexos (texto extraído + imagens quando o modelo suporta).
2. Monta o system prompt (`harness/prompt.rs`): identidade, idioma (pt-BR), regras de ferramentas, **guia de formatação Markdown/GFM** (ver §8.1), formato de **UI generativa**, formato de artefatos e citações.
3. Loop de até `max_steps`:
   - chama `providers::stream_completion` e reemite eventos;
   - acumula texto, reasoning e tool calls;
   - se houver tool calls: executa `tools::execute` em paralelo (máx. 4), emite `tool_call_finished`, adiciona resultados ao histórico e repete;
   - se não houver: finaliza.
   Cada passo alimenta `ChatMessage.trace` (`reasoning` do passo + número de tool calls), o que permite reconstruir a timeline de pensamento do chat depois de reabrir a conversa (DESIGN §6.3).
4. Persiste mensagem final + `provider_state` (envelope **v2** com o replay de cada passo do loop — ver §5) + usage; gera título automático (primeiro turno) com o próprio modelo (requisição curta, não-streaming) ou heurística local.
5. Cancelamento: `CancellationToken` interrompe o stream; mensagem parcial é salva com status `cancelled`.

### Ferramentas

| Tool | Descrição | Saída para o modelo |
| --- | --- | --- |
| `web_search` | busca no DuckDuckGo (HTML/lite) + fallback Bing; retorna até 8 resultados com título, URL e snippet | JSON compacto + citações para a UI |
| `fetch_url` | GET + extração de conteúdo legível (scraper), limite de ~120k chars, respeita `text/html` | texto com metadados e URL final |
| `create_file` | cria artefato (md, html, csv, json, código, svg) no disco e registra no DB | confirmação + id do artefato |
| `run_code` | executa um script Python/Node num workspace isolado (`code-runs/`), com timeout, limites e cancelamento; os arquivos gerados viram artefatos | resumo + exit code + cauda de stdout/stderr + ids dos artefatos |
| `list_skills` / `read_skill` | lista as skills locais (embutidas + usuário) e carrega instruções/scripts de uma skill | JSON com descrição, `baseDir` e arquivos |
| `validate_ui` | valida um bloco ` ```ui ` (JSON declarativo) contra o contrato: normaliza, valida e roda o lint de design | `{ ok, errors, warnings, normalized }` |

`validate_ui`, `list_skills` e `read_skill` estão sempre disponíveis e não contam
no orçamento de ferramentas de dados. `run_code` é **opt-in**:
`Settings::code_execution_enabled` (default `false`) e o harness aplica o gate
em `TurnOptions::run_code`; sem ele a ferramenta não entra na definição enviada
ao modelo.

As ferramentas de pesquisa (web_search, etch_url) devolvem citações que a
UI mostra como chips na mensagem (até 8, deduplicadas por URL); o excedente abre o
**painel lateral de fontes** da conversa, no mesmo padrão do painel de artefatos
(DESIGN §5/§6.3, docs/FILES.md §14 v1.4).

### 8.2 Execução de código e skills

`run_code` executa o script em `<app-data>/code-runs/<uuid>/`, com `stdin`
fechado, `stdout/stderr` limitados a 64 KB cada, timeout (5 s–10 min) e morte da
árvore de processos no cancelamento/timeout. Variáveis de ambiente sensíveis
(`*API_KEY*`, `*TOKEN*`, `*SECRET*`) são removidas; as chaves do app nunca são
injetadas. Arquivos novos do workspace (até 20, 25 MB cada / 64 MB no total) são
gravados em `artifacts/<id>/` pelo mesmo writer do `create_file`
(`tools::artifacts`) e viram artefatos mesmo quando o script termina com erro.

Skills são diretórios com `SKILL.md` (frontmatter `name`/`description` +
instruções) opcionalmente com `scripts/`. O backend materializa as skills
embutidas (`src-tauri/skills/**`, via `include_dir!`) em
`<app-data>/skills-bundled/` e varre `<app-data>/skills/` (usuário vence por
nome). Além da pasta do Lumina, o catálogo lê **em modo somente leitura** os
repositórios padrão usados por outros agentes: `~/.agents/skills` (Agent
Skills), `~/.codex/skills`/`CODEX_HOME`, `~/.claude/skills`/`CLAUDE_CONFIG_DIR`
e `~/.config/opencode/skills`/XDG (precedência: Lumina > agents > codex >
claude > opencode > embutidas). O catálogo entra no system prompt e
`read_skill` devolve `instructions` + `baseDir` + lista de arquivos,
permitindo ao agente rodar o helper stdlib da skill por `run_code`. Skills
desativadas (`Settings.disabled_skills`) são filtradas do prompt, de
`list_skills` e de `read_skill`; a gestão (ativar/desativar; excluir apenas as
do Lumina) fica na sidebar e em Configurações → Ferramentas. Desenho completo,
limites e segurança: **`docs/FILES.md`**.

### 8.1 Markdown do chat

O contrato completo (sintaxe suportada, decisões e matriz de testes) está em
**`docs/MARKDOWN.md`**; o renderer fica em `src/components/chat/Markdown.tsx`.

- **Pipeline**: `remark-gfm` (tabelas com alinhamento, task lists, notas de
  rodapé, autolinks, riscado), `remark-math` + `rehype-katex` (`$…$` inline e
  `$$…$$` display), `rehype-raw` para HTML cru e, em seguida, o sanitizador
  próprio `rehypeSafeHtml` (allowlist de tags/attrs/URLs, roda **antes** do
  KaTeX para não descartar a saída dele). Antes do parse, `protectEscapedDollars`
  protege `\$` (o micromark de math não trata `\$` como escape e fecharia o span
  antes da hora); `remarkRestoreMathDollars` devolve `\$` ao conteúdo de math e
  `$` à prosa/código após o parse.
- **Componentes**: código cercado com header de linguagem + botão copiar
  (Prism); fences especiais `ui`, `mermaid`, `chart`, `html`, `svg`; links
  externos e `mailto:` via plugin-opener; âncoras internas (notas de rodapé);
  imagens com fallback; alertas GitHub (`> [!NOTE]` etc.); tabelas com wrapper
  rolável.
- **Segurança**: o Markdown nunca usa `innerHTML`; o HTML cru passa por
  allowlist (sem `script`/`style`/`iframe`/`on*`/`style` inline) e as URLs
  aceitas são apenas `http(s)`, `mailto:` e `#âncora`. O prompt (seção
  **Formatação Markdown** em `harness/prompt.rs`) orienta o modelo a preferir
  Markdown puro e nunca emitir HTML perigoso.
- **Testes**: `src/components/chat/Markdown.test.tsx` (matriz funcional) e
  `Markdown.security.test.tsx` (vetores XSS/atributos/URLs).

## 9. UI generativa

O agente emite blocos cercados com a linguagem `ui` contendo **um objeto JSON declarativo**. A interface normaliza o JSON e desenha somente componentes da whitelist — **nunca** `eval`, HTML ou JavaScript arbitrário.

````
```ui
{ "version": 2, "components": [
  { "type": "card", "props": { "title": "Resumo" }, "children": [
    { "type": "stat", "props": { "label": "Receita", "value": "R$ 12.400" } },
    { "type": "actions", "props": { "items": [
      { "label": "Comparar trimestres", "prompt": "Compare este trimestre com o anterior.", "tone": "primary" }
    ]}}
  ]}
]}
```
````

### Contrato único

A fonte de verdade é **`data/genui-contract.json`** (v2): tipos, props, limites
rígidos, ícones, semântica das ações e as **regras de design** que o agente deve
seguir. Ele é consumido pelos três lados, sem listas duplicadas:

| Consumidor | Uso |
| --- | --- |
| `src-tauri/src/tools/genui` | normalizador + validador + lint + ferramenta `validate_ui` |
| `src-tauri/src/harness/prompt.rs` | gera o system prompt (catálogo, regras, limites, exemplo) |
| `src/lib/genui` + `src/components/genui` | normalização/validação defensiva final e renderer |

### Pipeline

1. **Normalização** (determinística, igual nos dois lados): coerções seguras
   (`number`→`text`, string numérica→`number`, enum case-insensitive), formas
   legadas (`labels`+`values`→`data`, `keyvalue` objeto→`items`), truncamento
   de textos/arrays nos limites rígidos, clamp de `progress`/`grid.columns`.
2. **Validação estrutural** contra o contrato: whitelist de 26 componentes
   (`card`, `stack`, `grid`, `tabs`, `reveal`, `section`, `divider`, `table`,
   `chart`, `stat`, `progress`, `timeline`, `steps`, `checklist`, `keyvalue`,
   `list`, `code`, `quote`, `text`, `callout`, `badge`, `image`, `source`,
   `link`, `actions`, `choices`), props obrigatórias/tipos/enums/URLs,
   `children` só em containers, profundidade 8 e 120 nós. Erro → o bloco
   degrada para código com o diagnóstico exato.
   `callout` está **descontinuado** para novas respostas (regra
   `ui.callout-style`): notas/ressalvas vão em Markdown; o componente segue
   renderizando mensagens antigas.
3. **Lint de design**: 30 regras do contrato (hierarquia, densidade, copy
   pt-BR, acessibilidade, interação) viram avisos com `code`/`path`/`hint`.
   Avisos não bloqueiam: a árvore normalizada é renderizada. O máximo de blocos
   por mensagem é orientação do prompt (`blocks.maxPerMessage`), não regra de
   lint por bloco.

### Autovalidação durante a execução

A ferramenta **`validate_ui(block)`** (sempre disponível, não conta no orçamento
de ferramentas de dados) recebe o JSON candidato e devolve
`{ ok, summary, errors, warnings, normalized }`. O system prompt instrui o
agente a validar o bloco e emitir só depois de `ok: true` (orientação de até 2
validações por resposta; não há contador imposto pelo harness), corrigindo os
`errors` e os `warnings` de design. O campo `normalized` é o JSON canônico para
a emissão final.

### Interação

`actions` são declarativas e seguras: `prompt` **preenche o composer** (evento
`lumina:suggest`) — nunca envia sozinho — e `copy` copia texto. `choices` é um
formulário de seleção **com estado local** (rádio/checkbox/segmentado, contador
e progresso sincronizados); o botão de envio preenche o composer com
`submitPrefix + seleção`, mantendo a regra de ouro: a interface nunca dispara um
turno sozinha. `tabs` e `reveal` usam Radix/`<details>` do design system; não há
inputs de texto livres dentro da interface (o composer é o único campo de
texto).

### Garantias

`data/genui-fixtures.json` é o corpus de paridade executado por
`cargo test` **e** `pnpm test`: para todos os casos válidos a árvore normalizada
inteira e os códigos de erro/aviso são idênticos nos dois lados (casos com erro
comparam os códigos e a ausência de spec). O renderer valida de novo (defesa em
profundidade), os exemplos de `docs/GENUI.md` são validados por teste e o prompt é gerado a partir
do contrato — nenhuma documentação de UI pode divergir do validador.

Fenced blocks extras com rendering especial: `mermaid` (diagramas), `chart`
(JSON de dados → SVG), `html`/`svg` (preview em iframe sandbox), `ui`.

> Regras completas de UI/UX, catálogo de props e checklist do agente:
> **`docs/GENUI.md`**.

## 10. Anexos

`documents::extract` converte:

| Tipo | Estratégia |
| --- | --- |
| PDF | `pdf-extract` (texto por página) |
| DOCX | ZIP + `quick-xml` (`word/document.xml` → parágrafos, headings, tabelas) |
| PPTX | ZIP + XML (`ppt/slides/*.xml`, notas) |
| XLSX/ODS/CSV | `calamine` (células por planilha) / parser CSV |
| Texto/código/JSON/HTML | detecção de encoding (`chardetng` + `encoding_rs`) |
| Imagens | metadados + base64 (enviadas nativamente se o modelo tem visão) |

Limite de 400k caracteres por documento, truncamento sinalizado. Anexos são copiados para `attachments/` e referenciados por id no payload.

## 11. Artefatos

`create_file` grava o arquivo em `artifacts/<id>/<nome>`, persiste metadados e
emite `artifact_created`. A UI mostra cards compactos no chat (grid de até duas
colunas; acima de 4 artefatos por mensagem aparece o botão **+ Ver todos (N)**,
que abre o painel lateral na lista) e um painel lateral (Canvas-like) com dois
modos: **lista** de artefatos gerados (cards compactos, contador) e **prévia**
por tipo, com navegação e ações "Salvar como…" (dialog nativo) e "Abrir". O
writer é compartilhado com `run_code` (`tools::artifacts`), que aceita **bytes**
— permitindo artefatos binários (PDF/DOCX/XLSX/PPTX/imagens).

**Detecção/reconciliação**: o renderer aplica `artifact_created` em ordem
canônica (`created_at, id` — a mesma de `db::list_artifacts`) e só para a
conversa ativa (eventos de um turno em segundo plano não vazam para outra
conversa). Ao fim de cada turno (`done`/`cancelled`/`error`), ao abrir uma
conversa (mesmo com mensagens em cache), após editar/regenerar e ao excluir a
conversa, o `chatStore.syncArtifacts` refaz a leitura autoritativa
(`list_artifacts`) — um token monotônico descarta respostas fora de ordem e
respostas de uma conversa que o usuário já deixou. Assim, eventos perdidos não
deixam a lista do painel nem os cards do chat desatualizados, e o painel volta
para a lista quando o artefato ativo deixa de existir.

| Tipo | Criação | Preview (v1.5) |
| --- | --- | --- |
| md | `create_file` | Markdown renderizado (GFM/math) + alternância Documento/Código |
| txt/log | `create_file` | código/texto com números de linha e toggle de quebra |
| html | `create_file` | HTML sandbox |
| csv/tsv | `create_file` | tabela com delimitador detectado (`,`/`;`/tab/`\|`) |
| json/jsonl | `create_file` | árvore colapsável + modo código realçado |
| código (30+ linguagens) | `create_file` | syntax highlight Prism (grammars extras), linhas e wrap |
| SVG | `create_file` | SVG sanitizado com zoom/pan/ajuste |
| PDF | `run_code` + skill `pdf` | **pdf.js** (páginas em canvas, zoom e navegação) |
| DOCX | `run_code` + skill `office-docx` | OOXML → HTML (`documents::preview`) em iframe sandbox |
| XLSX | `run_code` + skill `office-xlsx` | grade com abas por planilha (`calamine`) |
| PPTX | `run_code` + skill `office-pptx` | cartões de slide (título + texto, prévia simplificada) |
| PNG/JPG/WebP/GIF/AVIF/BMP/ICO | `run_code` (Pillow quando instalado) | imagem nativa com zoom/pan/xadrez e dimensões |
| TIFF | `run_code` (Pillow) | convertido para PNG no backend (`image`, ≤2560 px) |
| áudio/vídeo | `run_code` | player nativo (mp4/webm/ogg/mp3/wav/…) até 24 MiB inline |
| ZIP | `run_code` | listagem de entradas (até 400) + resumo, sem extração |
| outros contêineres | `run_code` | cartão binário + Salvar/Abrir |
| binários | `run_code` | cartão com formato detectado + hexdump (4 KB) + ações |

As prévias estruturadas vêm do comando `get_artifact_preview` e nunca injetam
HTML do documento sem sanitização (DOCX vira HTML allowlist dentro de iframe
`sandbox`; o PDF é desenhado pelo pdf.js; SVG é sanitizado antes de renderizar).
`get_artifact_content` só transporta payload necessário (texto, PDF, imagem
web-safe, áudio/vídeo ≤24 MiB); Office/ZIP/binário são lidos pelo backend na
prévia. Formatos e limites: `docs/FILES.md` §9.

## 12. IPC

Comandos (todos camelCase no JS):

```
app_info, get_settings, save_settings, set_provider_key, validate_provider,
open_data_dir, reset_app_data, get_catalog, refresh_catalog, list_remote_models,
list_conversations, create_conversation, get_conversation, rename_conversation,
delete_conversation, set_conversation_pinned, search_conversations,
truncate_conversation, export_conversation, import_attachments, get_attachment,
delete_attachment, list_artifacts, get_artifact_content, get_artifact_preview,
save_artifact, open_artifact, delete_artifact, get_code_environment,
open_skills_dir, get_skills, set_skill_enabled, delete_skill, run_turn, cancel_turn
```

## 13. Segurança

- API keys ficam só no backend; o renderer recebe apenas `hasKey`, `masked`, `source`.
- CSP restritiva em produção; sem `eval`, sem imports remotos em runtime.
- HTML/SVG de artefatos e blocos `html` rodam em iframe `sandbox="allow-scripts"` sem acesso ao IPC (sem `allow-same-origin`).
- Links externos abrem no navegador padrão via plugin-opener, nunca no webview.
- Markdown com HTML cru passa por sanitizador allowlist (`rehypeSafeHtml`): sem `script`/`style`/`iframe`/eventos/`style` inline, classes e `data-*` fora da allowlist, e URLs restritas a `http(s)`, `mailto:` e âncoras internas. React nunca injeta o markdown via `innerHTML`.
- Toda saída de ferramentas é tratada como dados; o system prompt instrui o modelo a ignorar instruções vindas de páginas web.
- **Execução de código** (`run_code`) é opt-in (default desligado), roda com o
  interpretador e as permissões do usuário (não é sandbox de SO), em workspace
  dedicado, com timeout, cancelamento, teto de saída/arquivos e ambiente sem
  segredos. Riscos e mitigações: `docs/FILES.md` §8.
- Scripts de skills e código do agente nunca recebem as API keys do app.

## 14. Build

```bash
pnpm install
pnpm typecheck          # TypeScript
pnpm build              # Vite (renderer)
pnpm app:build          # Tauri: binário + instalador NSIS
pnpm app:dev            # dev com HMR
```

## 15. Verificação (TDD)

A verificação é feita por testes automatizados — unitários e de integração — e por build:

1. **Renderer**: `pnpm test` (Vitest + jsdom) cobre utilitários, catálogo/raciocínio, o **núcleo da UI generativa** (contrato, normalização, lint, fixtures de paridade Rust↔TS, ações interativas, exemplos da documentação), sanitização de SVG, parser CSV, o reducer de streaming do `chatStore` (eventos → mensagens → finalização, erro, regeneração, cancelamento, trace ao vivo), a timeline do espaço de pensamento (trace → passos, fallback de mensagens legadas, grupos de ferramentas e componente `AgentSteps`), o **renderer de Markdown** (matriz CommonMark/GFM, math, notas de rodapé, alertas, HTML sanitizado e vetores de segurança), as **prévias de artefatos** (PDF via pdf.js mockado, DOCX/XLSX/PPTX por JSON/HTML, imagem e fallback binário; e, na v1.5, imagem com zoom/transparência/TIFF-convertido, áudio/vídeo, ZIP, hexdump, Markdown renderizado, árvore JSON, CSV/TSV com delimitador detectado e código com syntax highlight via Prism estendido — `src/lib/highlight`), a **UI de artefatos** (cards compactos, lista e modos lista↔prévia do painel, botão "+" do chat) e a **detecção/reconciliação de artefatos no store** (eventos filtrados pela conversa ativa, sync autoritativo ao fim do turno/ao reabrir, ordem canônica e proteção contra respostas fora de ordem) e as **fontes/citações** (chips até 8, painel lateral de fontes da conversa, dedupe por URL e abertura no navegador).
2. **Backend**: `cd src-tauri && cargo test --lib` cobre parser SSE, mapeamento de raciocínio por protocolo, **o pipeline/validador/lint da UI generativa em paridade com os mesmos fixtures do renderer**, a ferramenta `validate_ui`, o system prompt gerado do contrato, parsers de busca, extração de texto de PDF/DOCX/XLSX/PPTX/imagem (fixtures reais em `src/documents/testdata`), **prévias DOCX→HTML/XLSX/PPTX**, **prévias v1.5 de imagem (TIFF→PNG real), ZIP (fixtures e truncamento) e binário (hexdump de 4096 bytes)**, SQLite (conversas/mensagens/anexos/artefatos/usage/`trace` + migração de bancos antigos, incluindo os kinds `audio`/`video`/`archive`), settings/segredos, exportação, **execução de código (interpretador, timeout, cancelamento, coleta de artefatos, sem interpretador)**, **skills embutidas/usuário (frontmatter, precedência, scripts→preview)** e o **loop do harness** com um provedor falso injetado (`ProviderStreamer`): descarte de narração intermediária, execução de ferramentas no último passo, resposta final forçada, erro do provedor, cancelamento e o trace por passo.
3. **Integração com o gateway real** (testes `#[ignore]`, executados sob demanda): streaming nos 4 protocolos, tool call + replay de `provider_state`, fallback de protocolo, mapeamento de 401, cancelamento e o caso canônico **DeepSeek V4.1 Flash com esforço máximo**.
4. **Build**: `pnpm typecheck`, `pnpm build` e `pnpm tauri build --no-bundle` (artefato em `src-tauri/target/release/lumina.exe`).
5. **Manual (release)**: abrir o app e validar visualmente os fluxos principais.

## 16. Decisões registradas

| # | Decisão | Alternativa descartada | Motivo |
| --- | --- | --- | --- |
| 1 | Harness em Rust | Loop no renderer | streaming robusto, cancelamento, persistência atômica, sem round-trips JS |
| 2 | SQLite | arquivos JSON por conversa | consultas, integridade, busca |
| 3 | Catálogo gerado offline | hardcode manual | 120+ modelos, dados voláteis |
| 4 | UI generativa declarativa | React dinâmico via eval | segurança e determinismo |
| 5 | Protocolo neutro + adaptadores | SDK único (ai-sdk) | controle de SSE, headers e reasoning por protocolo |
| 6 | Zustand | Redux/Context | leveza e atualizações granulares em streaming |
| 7 | Execução de código **opt-in** com workspace + timeout | execução livre por padrão / sandbox de SO | risco de prompt injection; sandbox completo não cabe no escopo local-first v1 |
| 8 | Skills em arquivos Markdown + scripts | tool nativa por formato Office | extensível pelo usuário, sem pip obrigatório e com instruções versionáveis |
| 9 | Preview de PDF com pdf.js | viewer nativo do WebView2 / conversão via LibreOffice | comportamento igual em Windows/macOS/Linux e testável; sem dependência externa |
| 10 | Prévia de imagem no backend (TIFF→PNG com `image`) e ZIP listado sem extração | conversão no renderer (WASM) / abrir no app externo | WebView não abre TIFF; listar entradas é seguro, barato e cobre `.jar/.epub` |
| 11 | Prism estendido com grammars extras carregadas sob demanda | trocar por Shiki/highlight.js | reaproveita o `prism-react-renderer` já usado no chat e mantém um tema único de tokens |
