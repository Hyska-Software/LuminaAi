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

`provider_state` guarda o payload bruto da resposta do provedor (blocos `thinking` da Anthropic, itens do Responses, `parts` do Google) para replay fiel no próximo passo do loop — necessário para tool calls com raciocínio estendido.

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
4. Persiste mensagem final + `provider_state` + usage; gera título automático (primeiro turno) com o próprio modelo (requisição curta, não-streaming) ou heurística local.
5. Cancelamento: `CancellationToken` interrompe o stream; mensagem parcial é salva com status `cancelled`.

### Ferramentas

| Tool | Descrição | Saída para o modelo |
| --- | --- | --- |
| `web_search` | busca no DuckDuckGo (HTML/lite) + fallback Bing; retorna até 8 resultados com título, URL e snippet | JSON compacto + citações para a UI |
| `fetch_url` | GET + extração de conteúdo legível (scraper), limite de ~120k chars, respeita `text/html` | texto com metadados e URL final |
| `create_file` | cria artefato (md, html, csv, json, código, svg) no disco e registra no DB | confirmação + id do artefato |
| `validate_ui` | valida um bloco ` ```ui ` (JSON declarativo) contra o contrato: normaliza, valida e roda o lint de design | `{ ok, errors, warnings, normalized }` |

`validate_ui` está sempre disponível e não conta no orçamento de ferramentas de
dados — é o mecanismo de autovalidação do agente para a UI generativa (ver §9).

### 8.1 Markdown do chat

O contrato completo (sintaxe suportada, decisões e matriz de testes) está em
**`docs/MARKDOWN.md`**; o renderer fica em `src/components/chat/Markdown.tsx`.

- **Pipeline**: `remark-gfm` (tabelas com alinhamento, task lists, notas de
  rodapé, autolinks, riscado), `remark-math` + `rehype-katex` (`$…$` inline e
  `$$…$$` display), `rehype-raw` para HTML cru e, em seguida, o sanitizador
  próprio `rehypeSafeHtml` (allowlist de tags/attrs/URLs, roda **antes** do
  KaTeX para não descartar a saída dele).
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
2. **Validação estrutural** contra o contrato: whitelist de 21 componentes
   (`card`, `stack`, `grid`, `tabs`, `reveal`, `divider`, `table`, `chart`,
   `stat`, `progress`, `timeline`, `steps`, `keyvalue`, `list`, `code`,
   `quote`, `callout`, `badge`, `image`, `link`, `actions`), props
   obrigatórias/tipos/enums/URLs, `children` só em containers, profundidade 8
   e 120 nós. Erro → o bloco degrada para código com o diagnóstico exato.
3. **Lint de design**: 27 regras do contrato (hierarquia, densidade, copy
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
`lumina:suggest`) — nunca envia sozinho — e `copy` copia texto. `tabs` e
`reveal` usam Radix/`<details>` do design system. Não existem campos de
formulário dentro da interface (o composer é o input).

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

`create_file` grava o arquivo em `artifacts/<id>/<nome>`, persiste metadados e emite `artifact_created`. A UI mostra um card no chat e um painel lateral (Canvas-like) com preview por tipo (código com syntax highlight, markdown renderizado, HTML/SVG em iframe sandbox, CSV em tabela, imagem) e ações "Salvar como…" (dialog nativo) e "Abrir".

## 12. IPC

Comandos (todos camelCase no JS):

```
app_info, get_settings, save_settings, set_provider_key, validate_provider,
open_data_dir, reset_app_data, get_catalog, refresh_catalog, list_remote_models,
list_conversations, create_conversation, get_conversation, rename_conversation,
delete_conversation, set_conversation_pinned, search_conversations,
truncate_conversation, export_conversation, import_attachments, get_attachment,
delete_attachment, list_artifacts, get_artifact_content, save_artifact,
open_artifact, delete_artifact, run_turn, cancel_turn
```

## 13. Segurança

- API keys ficam só no backend; o renderer recebe apenas `hasKey`, `masked`, `source`.
- CSP restritiva em produção; sem `eval`, sem imports remotos em runtime.
- HTML/SVG de artefatos e blocos `html` rodam em iframe `sandbox="allow-scripts"` sem acesso ao IPC (sem `allow-same-origin`).
- Links externos abrem no navegador padrão via plugin-opener, nunca no webview.
- Markdown com HTML cru passa por sanitizador allowlist (`rehypeSafeHtml`): sem `script`/`style`/`iframe`/eventos/`style` inline, classes e `data-*` fora da allowlist, e URLs restritas a `http(s)`, `mailto:` e âncoras internas. React nunca injeta o markdown via `innerHTML`.
- Toda saída de ferramentas é tratada como dados; o system prompt instrui o modelo a ignorar instruções vindas de páginas web.

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

1. **Renderer**: `pnpm test` (Vitest + jsdom) cobre utilitários, catálogo/raciocínio, o **núcleo da UI generativa** (contrato, normalização, lint, fixtures de paridade Rust↔TS, ações interativas, exemplos da documentação), sanitização de SVG, parser CSV, o reducer de streaming do `chatStore` (eventos → mensagens → finalização, erro, regeneração, cancelamento, trace ao vivo), a timeline do espaço de pensamento (trace → passos, fallback de mensagens legadas, grupos de ferramentas e componente `AgentSteps`) e o **renderer de Markdown** (matriz CommonMark/GFM, math, notas de rodapé, alertas, HTML sanitizado e vetores de segurança).
2. **Backend**: `cd src-tauri && cargo test --lib` cobre parser SSE, mapeamento de raciocínio por protocolo, **o pipeline/validador/lint da UI generativa em paridade com os mesmos fixtures do renderer**, a ferramenta `validate_ui`, o system prompt gerado do contrato, parsers de busca, extração de texto de PDF/DOCX/XLSX/PPTX/imagem (fixtures reais em `src/documents/testdata`), SQLite (conversas/mensagens/anexos/artefatos/usage/`trace` + migração de bancos antigos), settings/segredos, exportação e o **loop do harness** com um provedor falso injetado (`ProviderStreamer`): descarte de narração intermediária, execução de ferramentas no último passo, resposta final forçada, erro do provedor, cancelamento e o trace por passo.
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
