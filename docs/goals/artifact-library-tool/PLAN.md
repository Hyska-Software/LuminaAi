# Biblioteca de artefatos do agente (listar/pesquisar/ler como contexto) — Implementation Plan

> **Revisão de escopo (turn 2):** a biblioteca passou a ser do **usuário** —
> todas as conversas —, não da conversa atual. O contrato revisado está em
> **§Revisão de escopo (turn 2)**; onde o contrato original abaixo falar em
> “conversa atual”/validação de conversa, prevalece a revisão.

**Intent:** fechar a lacuna entre o painel de artefatos e o agente: hoje o
modelo só sabe que um artefato existe pelo id devolvido em `create_file`/`run_code`
naquele mesmo turno; em turnos seguintes (ou para artefatos gerados por
`run_code`, que não voltam conteúdo no histórico) o agente não consegue consultar
o arquivo para responder usando o conteúdo como contexto. A entrega são duas
ferramentas locais — `list_artifacts` (listar/pesquisar a **biblioteca de
artefatos do usuário**) e `read_artifact` (trazer o conteúdo ao contexto) —
sempre disponíveis, sem IPC novo e sem migração de banco.

**Current Behavior:** `tools::definitions` expõe `web_search`, `fetch_url`,
`create_file`, `run_code`, `list_skills`, `read_skill`, `validate_ui`.
`create_file` devolve `Artifact id` + confirmação (sem conteúdo); `run_code`
devolve só nomes/ids. `harness::build_history` injeta apenas anexos do usuário.
`db::list_artifacts(conversation_id)` e `db::get_artifact(id)` já existem, assim
como `documents::extract` (PDF/DOCX/XLSX/PPTX/texto) e
`documents::preview::{image_preview, archive_preview, binary_preview}`. Nada
disso é acessível ao modelo: em uma pergunta de acompanhamento sobre um
relatório/planilha antigo ele não tem como ler o arquivo — nem quando o arquivo
foi criado em **outra conversa**.

**Expected Outcome:**
1. Tool `list_artifacts(query?, kind?, limit?)` — pesquisa na **biblioteca de
   artefatos do usuário (todas as conversas)** por nome, título da conversa de
   origem e conteúdo textual (sem acentos/maiúsculas), com filtro de tipo,
   limite (1–50, padrão 10) e trechos com número de linha; sem `query`, lista os
   artefatos **mais recentes primeiro**. Cada resultado traz `conversationId`,
   `conversationTitle` e `currentConversation`.
2. Tool `read_artifact(id?, name?, offset?, maxChars?)` — devolve o conteúdo de
   **qualquer artefato do usuário, de qualquer conversa**, para o contexto:
   texto raw dos textuais; texto extraído de PDF, DOCX, XLSX e PPTX;
   metadados/estrutura de imagem, áudio, vídeo, ZIP e binários; paginação por
   caracteres (padrão 12.000, máx. 20.000) com cabeçalho (incluindo a conversa
   de origem) e próximo `offset`.
3. Escopo de usuário aplicado **no backend** (sem validação por conversa),
   mantendo a regra de privacidade: a biblioteca expõe **artefatos** e
   metadados; mensagens de outras conversas não são reveladas. Conteúdo tratado
   como dado não confiável no prompt.
4. System prompt com seção própria e regras (quando usar — inclusive arquivo de
   outra conversa —, como paginar, como citar a proveniência e resumir sem colar
   o arquivo), mantendo o orçamento de 6 chamadas de dados.
5. Timeline do chat mostra as novas atividades em pt-BR (“Pesquisando nos
   artefatos…”, “Encontrou N artefatos”, “Leu o artefato `relatorio.pdf`”) com
   ícones e testes.

**Target-Perspective Output:** o usuário pergunta “resuma o relatório que você
gerou na conversa de planejamento”; estando em outra conversa, o agente chama
`list_artifacts` (encontra `relatorio-trimestral.docx` com o título da conversa
de origem), chama `read_artifact` pelo id e responde usando os trechos reais,
citando de onde o arquivo veio. Na timeline aparecem “Encontrou 1 artefato” e
“Leu o artefato relatorio-trimestral.docx” com o chip do nome. Artefatos de
qualquer conversa são legíveis; o resultado de `read_artifact` chega ao modelo
**sem** ser cortado em 24.000 chars.

**Truth Owner:** `src-tauri/src/tools/artifact_library.rs` (implementação única
list+read) + `src-tauri/src/tools/mod.rs` (registro) + `src-tauri/src/harness/prompt.rs`
(contrato de uso no prompt). A biblioteca persistida continua sendo o SQLite +
`artifacts/<id>/`; a leitura global vem de `db::list_all_artifacts` (novo, uma
query) + `db::list_conversations` (títulos) e `db::get_artifact` (path
autoritativo); nenhuma cópia/índice paralelo é criado.

**Contract Boundary:** o modelo vê `ToolDefinition` + `ToolOutcome.content`
(texto para `read_artifact`; JSON para `list_artifacts`). Nenhum comando Tauri
novo, nenhum campo novo em `domain.rs`/`types.ts`/`api.ts`, nenhuma migração de
banco (o método novo do `db` é interno). O contrato de UI é apenas o par
`ToolCallRecord.name/summary/arguments` já persistido e os labels em
`agentTrace.ts`.

**Cutover:** a funcionalidade é **aditiva**; não substitui nem redireciona
caminho existente (o painel de artefatos, `create_file` e `run_code` seguem
iguais). O único caminho deslocado é o “agente não vê artefatos antigos” — e não
sobra caminho por conversa.

**Displaced Path:** nenhum caminho duplicado nasce: leitura de artefato passa a
ser exclusivamente `tools::artifact_library::run_read`; a UI continua lendo os
artefatos por `get_artifact_content`/`get_artifact_preview` (contratos
diferentes: IPC para a UI, tool para o modelo).

**Value Density:** alto — resolve perguntas de acompanhamento sobre entregas
anteriores (inclusive de outras conversas) sem re-gerar arquivo, sem novo IPC,
reaproveitando `db` + `documents` já testados; custo de código concentrado em um
módulo novo + um método de leitura no `db`.

**Evidence Gate:** `cargo test --lib` verde incluindo (a) testes unitários de
busca/leitura com fixtures reais (`documents/testdata`), (b) testes de biblioteca
global entre duas conversas e (c) teste do loop do harness com provedor falso
provando que o texto de um artefato **de outra conversa** entra no histórico
enviado ao modelo; `pnpm test`/`pnpm typecheck`/`pnpm build` verdes.

**Acceptance Evidence:** EVIDENCE.md com os comandos e saídas (contagens
`cargo test --lib`, testes novos nomeados, `pnpm test`, build) e o teste de loop
acima como prova de “arquivo de qualquer conversa vira contexto”.

**Evidence Lane:** automatizado (Rust + Vitest). Sem automação de UI/navegador
(regra do repositório); inspeção manual da timeline fica como nota de QA.

**Kill Criteria:** (1) se `read_artifact` não conseguir caber em
`MAX_MODEL_TOOL_RESULT_CHARS = 24_000` sem cortar o conteúdo, o cap por chamada
deve ser ≤ 20.000 chars com paginação — nunca aumentar o truncamento global;
(2) se a implementação criar segunda fonte de verdade para listar artefatos
(índice/cache), parar e usar o `db`; (3) se precisar de dependência nova ou
comando Tauri novo, reavaliar o escopo (não previsto); (4) qualquer vazamento de
**mensagens/conteúdo que não seja artefato** entre conversas é blocker; (5)
voltar a escopar a biblioteca por conversa seria regressão do pedido do usuário.

**Architecture Slice:**

- **Arquivos a criar:** `src-tauri/src/tools/artifact_library.rs` (tools
  `list_artifacts`/`read_artifact`, busca normalizada, extração de texto,
  paginação, testes).
- **Arquivos a modificar:** `src-tauri/src/db.rs` (storage-dev: leitura global
  `list_all_artifacts`, uma query, sem migração); `src-tauri/src/tools/mod.rs`
  (módulo, definições, dispatch, teste de nomes); `src-tauri/src/harness/prompt.rs`
  (seção “Biblioteca de artefatos”, menção no catálogo de ferramentas e em
  Segurança); `src-tauri/src/harness/mod.rs` (**somente** bloco `#[cfg(test)]`:
  testes de loop com a tool); `src/lib/agentTrace.ts` + teste;
  `src/components/chat/AgentSteps.tsx` + teste; `docs/*` e `README.md` (Lead).
- **Arquivos a evitar:** `commands/**`, `domain.rs`, `types.ts`, `api.ts`,
  `state.rs`, `documents/**` (reaproveitar APIs existentes sem alterá-las),
  `Cargo.toml`, `data/genui-*`.
- **Fonte de verdade:** `db::list_all_artifacts`/`db::get_artifact` + arquivo em
  `<app-data>/artifacts/<id>/<nome>`; títulos via `db::list_conversations`;
  extração via `crate::documents`.
- **Read path:** `tools::execute("list_artifacts"/"read_artifact")` →
  `db`/disco → `ToolOutcome.content` → histórico do modelo.
- **Write path:** nenhum (somente leitura).
- **Contract boundary:** `ToolDefinition`/`ToolOutcome` e labels de timeline.
- **Integration points:** `tools::definitions` (sempre disponível),
  `harness/prompt.rs`, `agentTrace.ts`/`AgentSteps.tsx`.
- **Migration/cutover:** nenhuma migração; feature flag não é necessária
  (leitura local, read-only, escopo de usuário).
- **Displaced path:** “agente não vê artefatos anteriores” deixa de existir;
  não existe mais caminho de leitura escopado por conversa.
- **Acceptance evidence gate:** commands em §Evidence Gate.
- **Plan Review Gate:** Requires PRE review before execution (PRE feito; a
  revisão de escopo foi revisada pelo Lead e segue o mesmo contrato de caps e
  privacidade).

## Contrato detalhado (fonte para implementação)

> O contrato abaixo reflete a **revisão de escopo (turn 2)**: biblioteca do
> usuário (todas as conversas). Ele substitui integralmente a versão anterior
> escopada por conversa.

### `list_artifacts`

Definição (JSON Schema, `additionalProperties: false`, sem `required`):

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Termos de busca no nome, no título da conversa de origem e no conteúdo textual (ignora acentos e maiúsculas; todos os termos precisam aparecer). Omita para listar a biblioteca."
    },
    "kind": {
      "type": "string",
      "description": "Filtra por tipo: markdown, code, text, html, csv, json, svg, image, pdf, docx, xlsx, pptx, audio, video, archive, binary."
    },
    "limit": {
      "type": "integer",
      "description": "Máximo de artefatos retornados (1–50, padrão 10)."
    }
  },
  "additionalProperties": false
}
```

- Fonte: `rt.db.list_all_artifacts()` (biblioteca do usuário, todas as
  conversas) + `rt.db.list_conversations()` para mapear `conversation_id →
  título` e marcar `currentConversation` (conversa do turno). Sem `query`:
  **mais recentes primeiro** (`created_at` desc, `id` desc como desempate). Com
  `query`: ranking determinístico (nome exato 100; prefixo 80; nome com todos os
  termos 60; **título da conversa com todos os termos 45**; conteúdo 40 +
  min(ocorrências, 20); empate por `created_at` desc, depois `id` asc).
- Normalização de busca: minúsculas + remoção de diacríticos Latino-1
  implementada localmente (sem crate novo), ex. `relatório` ≈ `relatorio`.
- Busca por conteúdo: somente `ArtifactKind::is_textual()`; por artefato lê no
  máximo **1 MB** e no total **16 MB** por chamada. PDF/DOCX/XLSX/PPTX e demais
  binários casam por nome/título da conversa (nota no JSON explica que
  `read_artifact` extrai o texto).
- Trechos: até 3 linhas por artefato (`line` 1-based, `text` ≤ 200 chars);
  orçamento total de ~4.000 chars de trechos por resposta (`snippetsTruncated`).
- `limit` clamp 1..=50, padrão 10.
- Saída JSON (cabe no limite de 24k do modelo, orçamento duro ~20k):
  `{ "query": "...", "total": N, "returned": M, "snippetsTruncated": bool,
  "artifacts": [ { "id", "name", "kind", "mimeType", "size", "createdAt",
  "messageId", "language", "conversationId", "conversationTitle",
  "currentConversation", "matches": [{ "line", "text" }] } ], "note": "..." }`.
  Biblioteca vazia → `{"total":0,"returned":0,"artifacts":[],
  "note":"Nenhum artefato na biblioteca do usuário ainda."}`.
- `summary` (para a timeline, não truncado): `"{returned} artefatos"`; quando
  `total > returned`: `"{returned} de {total} artefatos"`; vazio: `"nenhum
  artefato"`.
- Nunca é erro ter biblioteca vazia; erro só em falha de banco ou em argumento
  inválido (`kind` desconhecido).

### `read_artifact`

Definição (sem `required`; validar em runtime):

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string", "description": "Id do artefato (preferido)." },
    "name": { "type": "string", "description": "Nome do arquivo quando o id é desconhecido; precisa ser único na biblioteca do usuário." },
    "offset": { "type": "integer", "description": "Deslocamento em caracteres no texto extraído (padrão 0)." },
    "maxChars": { "type": "integer", "description": "Máximo de caracteres nesta chamada (1.000–20.000, padrão 12.000)." }
  },
  "additionalProperties": false
}
```

- Resolução: `id` primeiro (`db.get_artifact`) — **qualquer conversa é
  legível**, sem validação de `conversation_id`. Sem `id`, resolve por `name` em
  toda a biblioteca: exato normalizado; sem extensão (`relatorio` →
  `relatorio.md`); substring única. Nome ausente/ambíguo → erro listando até 10
  candidatos com proveniência (`nome (id, conversa: "Título")`), nunca escolhe
  em silêncio. Nem `id` nem `name` → erro pedindo um dos dois.
- Arquivo lido por `std::fs::read(stored.path)`; arquivo ausente → erro claro.
  Teto de leitura **16 MB** (checado por `metadata` antes do read; acima: erro
  orientando o painel).
- Extração:
  - textuais (`Markdown|Code|Text|Html|Csv|Json|Svg`): decode via
    `crate::documents::decode_text(bytes, None)` (raw, sem reformatar).
  - `Pdf|Docx|Xlsx|Pptx`: `crate::documents::extract(&bytes, &name, &mime)` →
    `text` (limite de 400k chars do próprio extrator, sinalizado);
    `metadata.error`/texto vazio → mensagem informativa (não erro de ferramenta,
    exceto falha de leitura/extração fatal).
  - `Image`: `documents::preview::image_preview` → mime/dimensões (nota de que o
    binário não entra no contexto).
  - `Archive`: `archive_preview` → formato, total e lista de até 100 entradas.
  - `Audio|Video`: metadados + nota (sem transcrição).
  - `Binary`: `binary_preview` → formato detectado + nota.
- Cabeçalho com nome, id, tipo, tamanho, data e **conversa de origem** (`(esta
  conversa)` ou `(outra conversa)` + título/id); paginação (apenas texto):
  `offset`/`maxChars` em **chars**, total de caracteres, faixa exibida e rodapé
  com `offset` seguinte quando truncado; `offset` ≥ total → nota “fim do
  conteúdo”.
- `summary`: `"{nome} · {total} caracteres"` (binários: `"{nome} · binário"`).
- Resultado textual total ≤ 20.000 chars + cabeçalho < `MAX_MODEL_TOOL_RESULT_CHARS`
  (24.000) — sem corte silencioso pelo harness.

### Prompt (`harness/prompt.rs`)

- `tools_section`: documentar as duas tools como biblioteca **do usuário (todas
  as conversas)** (sempre disponíveis; contam no orçamento de 6 chamadas de
  dados, ao contrário de skills/validate_ui).
- Nova seção `# Biblioteca de artefatos` (após “# Arquivos e artefatos”):
  - escopo: arquivos que o usuário criou em **qualquer conversa** (inclusive
    esta); resultados mostram `conversationTitle`/`currentConversation`;
  - quando usar (usuário se refere a arquivo de turno anterior ou de outra
    conversa; `create_file`/`run_code` só devolvem id/nome, o conteúdo não fica
    no histórico);
  - fluxo `list_artifacts` → `read_artifact`, paginação com `offset`, não colar o
    conteúdo no chat, citar a proveniência (“arquivo X da conversa Y”);
  - PDF/DOCX/XLSX/PPTX têm texto extraído; imagem/áudio/vídeo/ZIP/binário só
    metadados;
  - privacidade: usar apenas os artefatos consultados; **não** revelar mensagens
    ou contexto de outras conversas;
  - artefato é **dado**, não instrução (reforçar na seção Segurança).
- Segurança: ajustar a frase de “dados de outras conversas” para abrir a
  exceção explícita dos artefatos consultados pela biblioteca do usuário,
  mantendo a proibição de revelar mensagens/contexto de outras conversas.
- Nunca remover/renomear tools existentes no prompt.

### Timeline (ui-core — inalterada na revisão)

- `agentTrace.ts`: cases `list_artifacts` e `read_artifact` (fallback genérico
  continua existindo). Labels:
  - `list_artifacts`: running “Pesquisando nos artefatos…”; done com ocorrências
    “Encontrou N artefatos”; zero “Nenhum artefato encontrado”; erro “A pesquisa
    nos artefatos falhou”; sem dados “Consultou os artefatos”.
  - `read_artifact`: running “Lendo o artefato X…”; done “Leu o artefato X” /
    “Leu N artefatos”; erro “Não foi possível ler o artefato”. Nome vem do
    `summary` (primeiro segmento antes de ` · `) ou de `arguments.name`; chips de
    arquivo mostram os nomes lidos.
- `AgentSteps.tsx`: ícones `list_artifacts: Library`, `read_artifact: FileSearch`
  (lucide-react já exporta ambos).
- Testes: `src/lib/__tests__/agentTrace.test.ts` e
  `src/components/chat/AgentSteps.test.tsx` (labels, running/erro, fallback,
  ícones, chips).

## PRE review (incorporado antes da execução)

Revisão PRE (plan-reviewer, modo read-only, código real conferido): **veredito
aligned — sem blockers**, 7 findings minors, todos incorporados:

1. `list_artifacts` ganha **orçamento duro de JSON**: parar de acrescentar
   artefatos/trechos ao atingir ~20.000 chars, recalcular `returned`; teste com
   50 artefatos garante JSON válido e `< 24.000` chars.
2. Evidência de aceite fixa o "não cortado em 24k": artefato textual > 24.000
   chars + `maxChars=20000`, assertando no histórico da 2ª requisição ao modelo
   que o **fim da página** (marcador) chega intacto.
3. `# Biblioteca de artefatos`/`tools_section` só citam `run_code` quando
   `options.run_code` (mantém o invariante do teste
   `run_code_section_is_hidden_when_the_setting_turns_it_off`).
4. Busca por conteúdo resolve o caminho com `db.get_artifact(&id)` (a lista do
   `db` não traz `path`), nunca montando caminho à mão.
5. `total` = biblioteca filtrada sem `query` / matches com `query`;
   `returned = min(total, limit)`. Labels da timeline vêm do `summary` /
   `arguments` (o `result` ao vivo é truncado em 8.000 chars).
6. EVIDENCE.md cita o teste de loop pelo nome e o trecho literal do fixture
   observado na 2ª requisição; inspeção manual da timeline fica como nota de QA.
7. Teto de leitura checado por `std::fs::metadata` **antes** do `fs::read`.

## Revisão de escopo (turn 2) — biblioteca do USUÁRIO

Pedido do usuário no turno seguinte à entrega: “ele deve conseguir ler qualquer
artefato, mesmo que não seja da conversa atual, o escopo é o usuário e não a
conversa.” Deltas sobre o contrato original:

1. **Fonte de dados:** `db::list_all_artifacts()` (novo, uma query
   `SELECT … FROM artifacts ORDER BY created_at, id`, storage-dev) substitui
   `db::list_artifacts(conversation_id)` na listagem/busca; títulos das conversas
   vêm de `db::list_conversations()` (mapa `id → title`).
2. **`list_artifacts`:** sem `query` → **mais recentes primeiro** (biblioteca do
   usuário é grande; os 10 mais antigos seriam inúteis). Busca também no
   **título da conversa de origem** (rank 45). Cada item ganha
   `conversationId`, `conversationTitle`, `currentConversation`. Nota e
   descrição da tool citam “biblioteca do usuário (todas as conversas)”.
3. **`read_artifact`:** **sem validação de conversa** — qualquer `id` é legível;
   resolução por `name` percorre toda a biblioteca e a ambiguidade lista
   `nome (id, conversa: "Título")`; cabeçalho do resultado mostra a conversa de
   origem e se é `(esta conversa)`/`(outra conversa)`.
4. **Prompt:** seção e descrições falam em biblioteca do usuário (todas as
   conversas), uso quando o usuário cita arquivo de outra conversa, citação da
   proveniência, e privacidade ajustada: só os **artefatos consultados**; nunca
   mensagens/contexto de outras conversas. `run_code` continua condicionado à
   flag.
5. **Privacidade (decisão registrada):** o escopo de usuário é intencional e
   autorizado pelo usuário; o limite permanece “artefatos e metadados”, não
   mensagens de outras conversas.
6. **Testes:** os antigos testes de isolamento por conversa (que proibiam
   cross-conversation) são substituídos por: listagem global com 2 conversas
   (títulos/flags/ordem), leitura por id/nome de outra conversa, ambiguidade com
   títulos, busca por título/conteúdo de outra conversa e **teste de loop do
   harness provando que um artefato de outra conversa entra no histórico do
   modelo**. Caps (12k/20k, 16 MB, 1 MB/16 MB de scan, JSON ~20k) inalterados.
7. **Tasks desta revisão:** T7 storage-dev (`db.list_all_artifacts` + testes);
   T8 harness-dev (tool/prompt/testes); T9 Lead (docs); T10 Lead (verificação +
   EVIDENCE + POST review).

## Tasks

| # | Dono | Escopo (write) | Entrega | Verificação |
| --- | --- | --- | --- | --- |
| T1 | harness-dev | `src-tauri/src/tools/artifact_library.rs`, `src-tauri/src/tools/mod.rs`, `src-tauri/src/harness/prompt.rs`, `src-tauri/src/harness/mod.rs` (só testes) | módulo + registro + prompt + testes (unitários, fixtures reais, loop do harness) | `cd src-tauri && cargo check --lib --tests`; `cargo test --lib artifact_library`; `cargo test --lib prompt`; `cargo test --lib tools::` |
| T2 | ui-core | `src/lib/agentTrace.ts`, `src/lib/__tests__/agentTrace.test.ts`, `src/components/chat/AgentSteps.tsx`, `src/components/chat/AgentSteps.test.tsx` | labels/ícones/chips das 2 tools + testes | `pnpm test -- src/lib/__tests__/agentTrace.test.ts src/components/chat/AgentSteps.test.tsx`; `pnpm typecheck` |
| T3 | Lead | `docs/goals/artifact-library-tool/**`, `docs/ARCHITECTURE.md`, `docs/FILES.md`, `docs/DESIGN.md`, `README.md` | plano/evidência + docs do recurso | revisão própria do diff |
| T4 | Lead | — (verificação) | suíte completa + EVIDENCE | `cd src-tauri && cargo check --lib --tests && cargo test --lib`; `pnpm typecheck && pnpm test && pnpm build` |
| T7 | storage-dev | `src-tauri/src/db.rs` | `list_all_artifacts()` (ordem canônica) + testes | `cargo test --lib db` |
| T8 | harness-dev | mesma área da T1 | escopo de usuário: loader global com títulos, list global/ordem DESC/busca por título, read sem validação de conversa/proveniência, prompt e testes | `cargo test --lib artifact_library`; `cargo test --lib prompt`; `cargo test --lib read_artifact_`; suíte completa |
| T9 | Lead | `docs/**`, `README.md` | docs da revisão de escopo | revisão própria |
| T10 | Lead | `docs/goals/artifact-library-tool/EVIDENCE.md` | verificação final + evidência (+ POST review) | suíte completa |

T1/T2 (v1) já executadas; T7/T8 rodam em paralelo (db.rs × tools/prompt) e T10
depende delas. Integração final (Lead) revisa diff e roda a suíte inteira.

## Riscos

| Risco | Mitigação |
| --- | --- |
| Resultado da tool cortado pelo harness (24k) | `read_artifact` limitado a 20k chars por página + paginação; `list_artifacts` com orçamento duro de ~20k do JSON (campos extras de conversa reservados no overhead) |
| Custo de varrer conteúdo (arquivos grandes) | caps 1 MB/arquivo e 16 MB/chamada; só textuais; nota para binários |
| Vazamento de mensagens de outras conversas | a biblioteca expõe **apenas artefatos/metadados** (decisão de produto: escopo de usuário); prompt proíbe revelar mensagens/contexto de outras conversas; teste de prompt |
| Biblioteca grande (N+1 ao listar) | `db.list_all_artifacts()` em uma query + `list_conversations` para títulos; sem varredura por conversa. Obs.: a listagem global **não pagina no SQL** — carrega biblioteca/títulos por chamada; `limit` e orçamento de JSON são aplicados em memória (tabela pequena no uso real) |
| Excluir conversa remove os artefatos dela da biblioteca | comportamento existente do app (delete em cascata), inalterado nesta revisão; documentado como limite conhecido — retenção permanente seria decisão de produto separada |
| Prompt inflado | seção objetiva (~35 linhas), sem duplicar regras de artefatos existentes |
| Arquivo apagado do disco / corrompido | erro orientativo (nunca panic; nunca fingir sucesso) |
| Modelo colar o arquivo no chat | prompt: resumir/citar trechos e proveniência, não repetir o conteúdo |
| Busca com acentos | normalização local testada (`relatorio`↔`relatório`) |

## Non-goals

- Vazar mensagens, anexos ou conteúdo de outra natureza de outras conversas: a
  biblioteca expõe **apenas artefatos** (escopo do usuário, decisão intencional).
- Busca semântica/embeddings, indexação, edição de artefatos, novos comandos
  Tauri/painéis/toggles, leitura de anexos (já entram no histórico), novas
  dependências.
