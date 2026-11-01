# TOOLS — Catálogo de ferramentas do harness de código

> Parte do plano `docs/goals/code-harness/`. Este documento é o **contrato das ferramentas**:
> nomes, schemas, semântica, limites, classe de política, apresentação na UI e testes.
> Arquitetura do loop/política: `HARNESS.md`. UI: `WORKBENCH.md`. Fases: `PLAN.md` §11.
>
> Fonte de verdade na implementação: `src-tauri/src/tools/` (definições + execução) e
> `src-tauri/src/harness/prompt.rs`/`harness/code/prompt.rs` (orientações geradas por tool).
> Se este documento divergir do código, o código está errado — o prompt é gerado da mesma
> estrutura (`ToolSpec::guidance`), do mesmo jeito que `data/genui-contract.json` gera o prompt de UI.

## 1. Convenções (valem para TODAS as tools)

| Convenção | Regra |
| --- | --- |
| Nome | `snake_case`, verbo no início (`read_file`, `search_text`, `run_command`). Nunca genérico demais (`exec`, `do`). |
| Argumentos | Objeto JSON; `path` sempre **relativo ao workspace** quando possível (aceita absoluto dentro dele). Caminhos são normalizados no resultado como relativos, com `/`. |
| Saída para o modelo | Texto puro em Markdown leve, **nunca JSON cru** quando der para formatar legível. Sempre termina com uma linha de metadados quando útil (`(fim do arquivo · 428 linhas)`). |
| Erros | `Error: <mensagem acionável>` + código estável no envelope estruturado (`FS_NOT_FOUND`, `POLICY_DENIED`, …). Erro de ferramenta **não** encerra o turno. |
| Limites | Todo resultado é limitado (chars/linhas) com rodapé explícito e caminho de continuação (offset/paginação/spill). Nunca truncar silenciosamente. |
| Segurança | Saída de ferramenta é **dado não confiável**: o prompt proíbe segui-la como instrução. Nunca incluir segredo do app (API keys) em saída. |
| Paralelismo | Cada tool declara `Safe` (pode rodar em paralelo), `PathLocked` (paralelo, mas serializa por arquivo) ou `Exclusive` (barreira de ordem). |
| Política | Cada tool declara `mutating`, `risk` (`read`/`write`/`shell`/`outside`/`secret`/`destructive`) e `approval` padrão (`never`/`ask`). A política da sessão decide (HARNESS §6). |
| UI | Cada tool fornece `summary` curto no infinitivo ("Ler src/app.ts") e, quando útil, `presentation` estruturada (diff, lista, plano, job) persistida com a mensagem. |
| Telemetria | Tool calls contam para `usage` do turno (duração, bytes); a timeline mostra nome/duração/status. |
| Testes | Toda tool tem teste unitário (sucesso, erro acionável, limites, política) e o loop tem um teste que a executa via provider falso. |

### 1.1 Envelope de saída (`ToolOutcome` estendido)

```rust
pub struct ToolOutcome {
    pub content: String,              // texto para o modelo (capped; spill se estourar)
    pub summary: Option<String>,      // card: "Ler src/app.ts:1-80"
    pub citations: Vec<Citation>,     // web
    pub artifacts: Vec<Artifact>,     // chat/artefatos (create_file)
    pub is_error: bool,
    pub presentation: Option<ToolPresentation>, // UI + replay (persistido em ToolCallRecord)
}

#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ToolPresentation {
    FileChange { path, change: FileChangeKind, added: u32, removed: u32, diff: String },
    Changes { turn_id, files: Vec<FileChangeSummary>, added: u32, removed: u32 },
    Todos { items: Vec<TodoItem> },
    Plan { state: PlanState, markdown: Option<String>, feedback: Option<String>, updated_at: i64 },
    Job { id: String, command: String, status: JobStatus },
    Approval { request: ApprovalRequest },       // quando a tool pausou pedindo aprovação
    Output { spilled: Option<SpillRef>, lines: u64 }, // saída longa paginada
    Terminal { session_id: String, title: String },
}
```

### 1.2 Classes de política

| Classe | Significado | Exemplos |
| --- | --- | --- |
| `ReadWorkspace` | leitura dentro do workspace, sempre permitida | `read_file`, `list_dir`, `search_*`, `git_status`, `git_diff`, `git_log` |
| `ReadOutside` | leitura fora do workspace — **exige aprovação** por padrão | arquivos de config globais, `~/.agents` |
| `MutateWorkspace` | escrita/edição dentro do workspace | `write_file`, `edit_file` (auto-aprovada no modo Editar) |
| `ExecuteCommand` | comando de shell dentro do workspace | `run_command` (aprovação no modo Editar; allowlist de leitura opcional) |
| `MutateGit` | staging/commit/branch/discard | UI de git (não é tool do modelo na v1) |
| `Network` | tráfego externo | `web_search`, `fetch_url` |
| `Ask` | pausa explícita para o usuário | `ask_user`, `submit_plan` |
| `Destroy` | destrutivo, exige aprovação **sempre** (mesmo Autônomo) | `rm -rf`, `git reset --hard`, `git clean`, force-push, `format`, `DROP TABLE` |

> O modelo **não** recebe tools de git que mutam (stage/commit/push) na v1: commit é ação do
> usuário no painel (WORKBENCH §5). O agente pode sugerir mensagem e rodar `git` via shell quando
> aprovado — mas o caminho estruturado é sempre o painel.

## 2. Catálogo v1.0

### 2.1 Leitura de arquivos

#### `read_file`

Leitura paginada com números de linha. **Nunca** lê binário como texto.

```json
{
  "path": "src/app.ts",          // obrigatório, relativo ao workspace (ou absoluto dentro dele)
  "offset": 120,                 // opcional, linha inicial 1-based (default 1)
  "limit": 400                   // opcional, linhas (default 800, máx 2000)
}
```

- **Resultado**: cabeçalho `src/app.ts · linhas 120-519 de 4283 · 4.1 KB` + corpo numerado
  (`  120│ ...`), rodapé com próximo offset e dica (`(fim do arquivo)` / `próximo: offset=520`).
- **Limites**: máx 2000 linhas, 2000 chars/linha (linha longa truncada com `…`), 512 KB por chamada;
  arquivos ≥ 10 MB leem em streaming; binário → `Error: cannot read "<path>": binary file (…); use
  list_dir ou read_image`; encoding detectado (UTF-8, UTF-16, CP1252) e convertido.
- **Política**: `ReadWorkspace`; arquivos que casam com padrões de segredo (`.env*`, `*.pem`,
  `*.key`, `id_rsa*`, `.npmrc`, `.aws/credentials`, `secrets.*`) → `Ask` com aviso de segredo.
- **UI**: card compacto com caminho + faixa de linhas + botão "abrir no painel".
- **Testes**: faixa, offset inválido, arquivo vazio, binário, encoding, linha gigante, arquivo >
  limite, path fora do workspace, arquivo de segredo (política).

#### `read_image`

```json
{ "path": "docs/diagrama.png" }
```

- Entrega a imagem ao modelo (PNG/JPEG/WebP/GIF, se o modelo declara visão) e cria preview na UI.
  Detecta pelo assinatura do arquivo (não pela extensão). Limite 10 MB; redimensiona > 2048 px.
- **Política**: `ReadWorkspace` (mesma regra de segredo). Sem visão no modelo → erro acionável
  sugerindo trocar de modelo.

#### `list_dir`

```json
{ "path": ".", "depth": 2, "include_hidden": false, "limit": 400 }
```

- Árvore respeitando `.gitignore` (crate `ignore`), sem `node_modules/.git/target/dist/.venv` por
  padrão; marca diretórios com `/`; trunca com aviso (`… 1.284 entradas, mostre um subdiretório`).
- **Política**: `ReadWorkspace`. **UI**: árvore no card.

#### `search_files`

```json
{ "pattern": "**/*.test.ts", "path": "src", "max_results": 200 }
```

- Busca por glob (`globset`), respeita ignore, ordena por caminho; retorna caminhos relativos.
- **Política**: `ReadWorkspace`. **Testes**: glob inválido, 0 resultados (dica), cap.

#### `search_text`

```json
{
  "query": "createServer", "path": "src", "glob": "*.ts",
  "is_regex": false, "case_sensitive": false, "context_lines": 1, "max_results": 200
}
```

- Busca de conteúdo (crates do ripgrep: `ignore` + `grep-searcher` + `grep-regex`), agrupada por
  arquivo: `src/a.ts:42: ...` com contexto opcional; cap de 200 matches / 4 000 linhas exibidas;
  aviso quando truncado. Regex inválida → erro com a posição.
- **Política**: `ReadWorkspace`. **Testes**: literal, regex, case, contexto, cap, ignore, binário.

#### `read_tool_output`

```json
{ "id": "spill-8f2c", "offset": 0, "limit": 4000 }
```

- Lê a saída completa de uma tool que estourou o limite (spill em `<app-data>/spill/…`).
  Ids vêm do rodapé de resultados truncados; paginação por chars (máx 20 000/chamada).
- **Política**: `ReadWorkspace` (é conteúdo já produzido na sessão). **Testes**: id inválido,
  paginação, spill inexistente após GC.

### 2.2 Edição de arquivos

#### `write_file`

```json
{ "path": "src/new.ts", "content": "…", "justification": "criar módulo pedido" }
```

- Cria (com `create_dir_all`) ou **substitui** o arquivo inteiro; escrita atômica (temp + rename),
  preserva BOM/EOL detectado, normaliza para o EOL do arquivo existente.
- **Observação obrigatória** (read-before-write): se o arquivo existe e não foi lido nesta sessão
  (ou mudou desde a leitura) → `Error: cannot modify "<path>": file has not been read — read the
  file, then retry` (`FS_NOT_OBSERVED`) / `FS_STALE_VERSION` (re-ler e tentar de novo).
- **Limites**: conteúdo ≤ 2 MB; binário recusado; path fora do workspace → política.
- **Resultado**: `Created file src/new.ts (+42)` / `Updated file src/app.ts (+3 −1)` + diff unificado
  curto (para o card e para o modelo), com `presentation: FileChange`.
- **Política**: `MutateWorkspace` (`Ask` no modo Leitura/Plano; `Allow` no modo Editar dentro do
  workspace; `Ask` fora; segue regras de `approval_rules`).
- **Testes**: criar/substituir, observação, EOL/BOM, diff, path escape, segredo, arquivo grande.

#### `edit_file`

```json
{ "path": "src/app.ts", "old_string": "…", "new_string": "…", "replace_all": false }
```

- Substituição literal; **exige match único** (a não ser `replace_all: true`); erro com a contagem
  de ocorrências e dica de incluir mais contexto. Preserva tabs/espaços fora do trecho; aplica
  sobre o conteúdo lido (stale → re-ler). `new_string` vazio = remoção de trecho.
- **Resultado**: `Updated file src/app.ts (+2 −2)` + diff do trecho. `presentation: FileChange`.
- **Testes**: único, ambíguo, inexistente, replace_all, stale, EOL, edição que não altera nada.

> **Decisão**: a v1 usa `write_file` + `edit_file` (formato Claude Code/DSH). `apply_patch`
> multi-arquivo fica para a v1.2 (bom para refactors grandes, custa um parser e um modelo de
> aprovação por arquivo); o `edit_file` cobre 95% dos casos e erra de forma recuperável.
>
> **v1.2 (roadmap, fora do catálogo v1.0)**: `apply_patch` (unified diff por hunk, com rejeição por
> hunk), `delete_path` e `move_path` (mutantes, sempre com aprovação), `diagnostics`/`run_checks`
> (comandos de teste/lint do projeto estruturados), `task` (subagente), `mcp__<server>__<tool>`
> (tools externas do MCP). O benchmark recomenda `apply_patch` já na fase 1; adiamos conscientemente
> para manter a v1.0 em 18 tools e porque `edit_file`+`write_file` cobrem o fluxo do MVP — decisão
> revisável na F3 se os modelos reais mostrarem dificuldade em refactors grandes.

### 2.3 Execução

#### `run_command`

```json
{
  "command": "npm test -- --run",
  "workdir": ".",                        // opcional, relativo ao workspace
  "timeout_ms": 120000,                  // opcional: default 120s, máx 10min
  "run_in_background": false,            // opcional; exige jobs disponíveis
  "description": "Rodar a suíte de testes" // obrigatório, 5-10 palavras, voz ativa
}
```

- Executa via shell da plataforma: `pwsh -NoLogo -NoProfile -NonInteractive -Command <command>`
  no Windows (fallback `powershell.exe`/`cmd`), `bash -lc` no Unix; sem stdin; env **higienizado**
  (remove `*API_KEY*`, `*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `LUMINA_*` interno; adiciona
  `LUMINA_AGENT=1`, `CI=1`? — só `LUMINA=1`).
- **Resultado**: `[exit code: N]` + stdout + `[stderr]` + marcadores (`[truncated to tail …]`,
  `[timed out after …]`, `[stopped by user]`, `[sandbox: denied …]`). Saída capada em 24 000 chars
  para o modelo (spill + `read_tool_output` para o resto); UI recebe streaming incremental via
  `ToolProgress` e a saída completa no card (cap 1 MB no backend).
- **Background**: `run_in_background: true` devolve `job-<id>` na hora; `job_output`/`job_kill`
  coletam e matam; comando de foreground que passa do timeout **promove** para job (não mata) —
  comportamento DSH, evita perder `npm install`/suite longa.
- **Não é erro**: exit ≠ 0 é resultado normal (`[exit code: 1]`) — o modelo interpreta.
- **Política**: `ExecuteCommand`. Modo Editar → `Ask` (com opções "aprovar", "negar com feedback",
  "sempre permitir este comando/prefiro"). Modo Autônomo → `Allow` **exceto** `Destroy`
  (`rm -rf`, `Remove-Item -Recurse -Force`, `git reset --hard`, `git clean -fdx`, `git push --force`,
  `format`, `shutdown`, `npm publish`, `DROP TABLE`, `> /dev/sd*`, `curl … | sh`, `iwr … | iex`).
  Comandos de leitura conhecidos (`git status|diff|log|show|branch`, `ls|dir|Get-ChildItem`,
  `type|cat|Get-Content`, `rg`, `findstr`) podem ser auto-aprovados por regra explícita.
- **Testes**: exit 0/≠0, stderr, timeout, cancelamento (morte de árvore), cap/spill, env scrub,
  workdir inválido, background, promoção, classificação de risco/destrutivo.

#### `job_list` / `job_output` / `job_kill`

```json
{}                                            // job_list
{ "job_id": "job-1a2b", "wait": true, "timeout_ms": 30000 }   // job_output
{ "job_id": "job-1a2b", "reason": "testes já rodaram" }        // job_kill
```

- `job_list` devolve id, comando, status (`running|done|failed|killed`), iniciado, duração, saída
  pendente. `job_output` lê incremental (cursor por chamada) e opcionalmente espera. `job_kill`
  entrega sinal/terminate na árvore de processos.
- **Política**: leitura livre; `job_kill` é `ExecuteCommand` (aprovação no modo Editar).
- **UI**: painel de jobs acima do composer + card por job. **Testes**: registro, cursor, wait,
  kill, limite de jobs por sessão (ex.: 8), job órfão após cancelar turno continua vivo.

### 2.4 Git (somente leitura para o modelo na v1)

#### `git_status`

**Resultado** (compacto):
```
branch main (upstream origin/main, ahead 2)
M  src/app.ts           (staged)
 M src/util.ts
?? docs/novo.md
!  conflito: src/db.rs
```

- **Política**: `ReadWorkspace`. Repositório ausente → `not a git repository` (não é erro fatal).

#### `git_diff`

```json
{ "paths": ["src/app.ts"], "staged": false, "context": 3 }
```

- Diff unificado (`--no-color --no-ext-diff --unified=N`), cap 40 000 chars + aviso; binário →
  `Binary files … differ`; sem repo → erro acionável. **Política**: `ReadWorkspace`.
- **Testes**: working tree, staged, paths, rename, binário, cap, sem repo.

#### `git_log`

```json
{ "limit": 20, "path": "src/" }
```

- `git log --oneline --decorate` compacto (hash curto, data, assunto). **Política**: `ReadWorkspace`.

### 2.5 Planejamento e interação

#### `todo_write`

```json
{ "todos": [
  { "content": "Ler o módulo de pagamentos", "status": "completed" },
  { "content": "Corrigir o cálculo de juros", "status": "in_progress" },
  { "content": "Rodar os testes", "status": "pending" }
] }
```

- **Substitui a lista inteira** (sem edição parcial), status `pending|in_progress|completed`;
  no máximo 1 `in_progress` no turno principal; itens vazios ou duplicados → erro visível; `[]` é
  válido e **limpa** a lista (use ao concluir o trabalho); teto de 50 itens. Subagentes (somente
  leitura) **não** recebem `todo_write` e o prompt do filho não menciona a tool.
- **Resultado**: `Lista atualizada: N pendente(s), N em andamento, N concluída(s).`
- **UI**: card na timeline + popover no composer/header; persistido (projeção `todos` em
  `code_events`). `todos: []` faz o card sumir.
- **Política**: `Exclusive`, **não mutante de workspace** (`mutating=false`, `risk=Read`): é estado
  de sessão, permitido no modo Plano. **Testes**: validação, contadores, projeção, replay, limpeza.

#### `submit_plan`

```json
{ "plan": "### 1. Contexto\n…\n### 2. Arquivos\n…\n### 3. Verificação\n…" }
```

- Só válido em **modo Plano**; publica o plano para revisão na UI (persistido em
  `plan/submitted` **antes** da decisão) e bloqueia o turno até a decisão. Quatro saídas:
  **Aprovar e executar** (`approve_run` → modo Editar), **Aprovar e revisar cada edição**
  (`approve_review` → modo Revisar, cada escrita pede aprovação), **Continuar planejando**
  (nega + feedback persistido em `plan/feedback`, o agente revisa e reenvia) e
  **Executar como Objetivo** (`approve_goal` → aprova/persiste o plano, preserva o modo de
  permissão atual, cria um Goal e deixa a primeira rodada começar no `done`). O gate não edita
  mais o plano; `respond_approval.planMarkdown` continua aceito por compatibilidade e substitui o
  markdown aprovado. Sem canal de revisão (headless/teste) → falha fechada com dica `/plan off`.
- **Regras de prompt**: antes de submeter, investigue entradas, módulos, testes e docs; confirme o
  comportamento atual e nunca invente caminhos/símbolos. O plano deve ser **implementável** e usar o
  idioma da resposta com esta estrutura (mescle seções apenas em mudanças triviais):
  1. título curto + objetivo em uma frase;
  2. contexto atual com arquivos/símbolos exatos, restrições e premissas;
  3. escopo (dentro/fora);
  4. mudanças por arquivo em tabela (arquivo, símbolo/área, mudança, motivo);
  5. passos ordenados, cada um com arquivos/símbolos e critério de conclusão observável;
  6. testes e verificação (casos, comandos e resultado esperado; checagem manual quando couber);
  7. riscos, casos-limite, compatibilidade/migração e rollback;
  8. critérios de aceite em checklist.

  Seja conciso: ~2–6 mil caracteres no caso típico (máx. 20 mil), sem repetir o pedido, sem código
  completo/diff; código só para interfaces ambíguas (≤10 linhas). Plano com menos de **300
  caracteres** é recusado com `PLAN_TOO_BRIEF` antes de persistir ou pedir aprovação. No feedback,
  responda a todos os pontos, preserve decisões aceitas e reenvie.
- **Política**: `Ask` (revisão humana obrigatória, **sem** "sempre permitir"); o timeout da tool é
  o do broker de aprovação (10 min default), não o timeout curto do runtime. **Testes**: fora do
  modo → erro; aprovação → transição + mensagem + mutação liberada no mesmo turno; revisar cada
  edição → `ASK` na escrita seguinte; feedback → mensagem/persistência; executar como objetivo →
  plano aprovado + Goal criado sem trocar o modo; timeout/cancelamento.

#### `ask_user`

```json
{ "questions": [ {
  "id": "db", "header": "Banco",
  "question": "Qual banco devo usar na migração?",
  "options": [
    { "label": "SQLite (Recommended)", "description": "Mantém local-first e sem servidor." },
    { "label": "Postgres", "description": "Exige Docker e configuração de ambiente." }
  ],
  "multi_select": false
} ] }
```

- Bloqueia o turno até a resposta; `timeout` opcional em segundos (`-1` = infinito; teto 30 min).
  Timeout **nunca** vale como aprovação. Retorno: `{ answers: [{ id, selected: [...], custom? }] }`.
- **UI**: card com opções (rádio/checkbox), opção recomendada primeira, texto livre opcional.
- **Política**: `Ask`. **Testes**: single/multi, timeout, cancelamento, resposta custom.

### 2.6 Projeto, verificação e delegação (v1.2)

#### `run_checks`

```json
{ "check": "npm:test", "timeout_ms": 600000 }
```

- Roda a verificação **detectada** do projeto (`workspace::project`): `check` é opcional e usa o
  primeiro (teste) quando omitido; ids/labels aparecem no contexto do projeto do prompt.
- Reutiliza o pipeline do `run_command` (política, aprovação, streaming de `ToolProgress`, spill);
  o resultado é prefixado com `[check: <label>]` e contém exit code/saída.
- **Política**: `Shell` (aprovada no modo Editar; destrutivo continua pedindo). Sem manifesto
  detectado → `NO_CHECKS`; id inválido → `CHECK_NOT_FOUND`.
- **Testes**: sem checks, modo Plano (deny), execução real de `npm run test` (pulado sem shell).

#### `task` (subagente somente leitura)

```json
{ "description": "Explorar o módulo de pagamentos", "prompt": "Liste os arquivos…", "subagent_type": "explore", "model": "openai/gpt-6-luna", "effort": "high" }
```

- Cria uma conversa filha **retida para auditoria** com o workspace do pai e permissão
  `read_only`, roda o perfil Code com orçamento curto (24 passos) e catálogo reduzido a leitura
  (`read_file`, `list_dir`, `search_*`, `read_tool_output`, `git_status/diff/log`); devolve o
  resumo final. A conversa filha fica oculta da sidebar (`parent_conversation_id`), é consultável
  por `get_conversation` e é apagada em cascata quando o pai é excluído. `usage_log` do filho é
  removido (o consumo é agregado ao pai, sem dupla contagem).
- `subagent_type`: `explore` (mapear/responder), `review` (criticar o diff) ou `general`; valor
  desconhecido → `SUBAGENT_INVALID_TYPE`; omitido → `explore`.
- `model` (opcional): `provider/model` ou id de modelo do provedor pai; validado no runner
  (`SUBAGENT_MODEL_INVALID`). `effort` (opcional): valor declarado pelo modelo, ou `off`/`auto`;
  validado contra `reasoningOptions` (`SUBAGENT_REASONING_*`). Sem ambos, herda a rota do pai.
- Profundidade máxima **1**: o filho não recebe `task` e o runner recusa aninhamento
  (`DELEGATION_DEPTH`). O filho não pode editar, rodar shell, usar MCP, perguntar ao usuário ou
  delegar; a política `read_only` e o catálogo efetivo (`enabled_tools`) são defesa em
  profundidade.
- **Política**: `Read` no pai (a delegação em si não muta); `task` é `Safe`, então chamadas
  independentes no mesmo passo rodam em paralelo (semáforo de 4; teto de 4 delegações por turno).
  Eventos filtrados do filho são encaminhados como `subagent_started`/`subagent_event`/
  `subagent_finished` para o card ao vivo do “Thinking”. Timeout de 15 min; cancelamento do pai
  propaga o token ao filho e espera a limpeza (período de graça).
- **Prompt/cache**: o pedido do pai vai **uma vez** na mensagem de usuário; o
  `system_prompt_override` contém só as instruções constantes do tipo (prompt-base read-only, sem
  edição/`ask_user`). O filho usa o `conversation_id` do pai como `x-opencode-session` (F4.3b) e
  seus tokens/custo entram no `usage` do turno pai.
- **UI**: linha ao vivo no bloco “Thinking” (status, passos, modelo/effort, texto recente) e botão
  “Abrir chat”, que abre o subagente como uma aba de chat read-only no centro do Workbench
  (Markdown, Thinking, tools; sem Composer, edição/regeneração/feedback nem cards de
  aprovação/plano). Cada subagente tem sua própria aba, identificada por `Bot`; abrir a mesma
  conversa de novo não duplica a aba — apenas a ativa e mostra um aviso. O popover do composer
  tem uma seção “Subagentes” com todos os transcripts retidos do pai (inclusive
  erro/cancelamento), que também abrem a aba. A `presentation` `subagent` persiste
  `conversationId`/`providerId`/`modelId`/`effort`/`steps`/`durationMs`/`usage`.
- **Testes**: kinds/parse, catálogo reduzido sem MCP, guarda de profundidade, execução de um turno
  filho real com provider falso, prompt não duplicado, session id do pai, uso agregado, erro do
  provider não mascarado, retenção/cascata, eventos ao vivo, modelo/effort, paralelismo e tool fora
  do catálogo recusada.

#### Servidores MCP (`mcp__<servidor>__<tool>`)

- Configuração em `<app-data>/mcp.json` (fora do repo): `{ "servers": [{ "name", "command", "args",
  "env", "enabled", "cwd" }] }`. O app conecta sob demanda na primeira sessão Code, fala o
  transporte oficial **stdio** (JSON-RPC 2.0 por linha), faz `initialize` →
  `notifications/initialized` → `tools/list` e cacheia as tools descobertas.
- As tools entram no wire do perfil Code depois das 25 estáticas (`mcp__servidor__tool`, nomes
  sanitizados) com o `inputSchema` do servidor; o prompt lista nome/servidor/descrição.
- **Aprovação sempre explícita** (inclusive em Autônomo; regras "sempre permitir/negar" do usuário
  com matcher exact/prefix/glob vencem); o card mostra servidor/ferramenta/argumentos. Timeout de
  120 s; cancelamento do turno aborta; resultado extrai `content[].text` (ou JSON) e marca
  `MCP_ERROR` quando `isError`.
- Falhas por servidor não derrubam os demais (`MCP_SPAWN`/`MCP_INIT`/`MCP_TIMEOUT`/`MCP_PROTOCOL`,
  logadas no stderr do app); `mcp_status` devolve servidores + tools para inspeção.
- **Testes**: sanitização/config tolerante, manager vazio degradando honesto e handshake +
  `tools/list` + `tools/call` contra um servidor MCP fake em Node (pulado sem Node).

#### `/test`, `/review`, `/init` (composer)

Comandos do composer preenchem prompts que usam `run_checks` (verificação), `task` (revisão
delegada) e `write_file` (AGENTS.md), nesta ordem de preferência. O `/init` pede revisão do
conteúdo antes de gravar.

### 2.7 Reaproveitadas do Chat (perfil Code seleciona)

| Tool | Uso no perfil Code | Política |
| --- | --- | --- |
| `web_search` | documentação/erros — sempre disponível | `Network` |
| `fetch_url` | ler página/doc; saída é dado não confiável | `Network` |
| `list_skills` / `read_skill` | skills locais (Lumina/agents/codex/claude/opencode) | leitura |
| `create_file` | **fora** do perfil Code (arquivos vão para o workspace) | — |
| `run_code` | **fora** do perfil Code (substituído por `run_command`) | — |
| `list_artifacts` / `read_artifact` | opcional, para reaproveitar material da Biblioteca | leitura |
| `validate_ui` | validação do JSON de blocos `ui` (mesmo contrato do Chat) — sempre disponível, exceto no subagente read-only | leitura, sem aprovação |

#### `validate_ui`

- Recebe `{ "block": "<JSON completo do bloco ui>" }` e devolve
  `{ ok, summary, errors, warnings, normalized }` (o mesmo contrato do Chat).
- Usa o normalizador/validador/lint de `src-tauri/src/tools/genui` e o contrato
  único `data/genui-contract.json`; não muta o workspace, não pede aprovação e
  não conta no orçamento de dados.
- Resultado acima de 24 000 chars vai para spill (`read_tool_output`), como as
  demais tools do perfil.
- O prompt do Code traz as notas de uso: evidência estruturada (testes, métricas,
  comparação, achados), sem duplicar o fecho de arquivos/diff; decisões
  bloqueantes usam `ask_user`; nada de `ui` dentro do plano.

> Regra: o perfil Code expõe hoje **25 tools** por turno (20 de código + web/skills
> + `validate_ui`). Catálogo grande degrada a escolha do modelo e o cache do
> prompt; tools de fases futuras entram atrás de flag de sessão e são
> documentadas em `PLAN.md` §11.

## 3. `ToolSpec` — como uma tool é declarada no código

```rust
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,          // para o modelo (curta, imperativa)
    pub schema: fn() -> Value,              // JSON Schema dos argumentos
    pub parallel: ParallelClass,            // Safe | PathLocked | Exclusive
    pub risk: RiskClass,                    // Read | Write | Shell | Outside | Secret | Destroy | Ask
    pub default_approval: Approval,         // Never | Ask | Always
    pub requires_workspace: bool,
    pub profiles: ProfileSet,               // Chat | Code | Both
    /// Orientações que entram no system prompt do perfil (geradas daqui — nada duplicado em prompt.rs).
    pub guidance: &'static str,
    pub execute: fn(&ToolCtx, Value) -> BoxFuture<'static, ToolOutcome>,
}
```

- O registro (`harness/code/tools.rs`) monta a lista por perfil/sessão e **gera o prompt** das
  orientações — mesma ideia do `data/genui-contract.json` no Chat (fonte única).
- O loop do Chat continua usando `tools::definitions(&TurnOptions)`; a Fase 0 adiciona uma camada
  de adaptação (`ToolSpec` para as 9 tools atuais) sem mudar nomes/semântica (ver `PLAN.md` §7).
- `ToolCtx` (evolução do `ToolRuntime`): `db`, `http`, `conversation_id`, `message_id`, `turn_id`,
  `workspace: Option<WorkspaceCtx>` (root, git, journal, policy, objects), `settings`, `cancel`,
  `approval: Arc<ApprovalBroker>`, `jobs: Arc<JobRegistry>`, `emit: Arc<dyn EventEmitter>`.

## 4. Orçamento e limites por turno (perfil Code)

| Item | Padrão | Observação |
| --- | --- | --- |
| `max_steps` | **120** (máx 1000) | configurable por sessão; ao atingir, resposta final forçada com aviso |
| Tools por passo | até 8 chamadas, 4 em paralelo (máx) | `Exclusive` como barreira |
| Resultado para o modelo | 24 000 chars/tool | acima → spill + `read_tool_output` |
| Resultado para a UI | 8 000 chars no card | saída completa no painel/streaming |
| Saída de processo | 1 MB backend / 24k modelo | timeout default 120 s, máx 10 min |
| Arquivo lido | 512 KB/chamada, 2000 linhas | streaming ≥10 MB |
| Arquivo escrito | 2 MB | acima → erro orientando gerar via script |
| Leitura antes de escrita | obrigatória | stale → re-ler |
| Jobs concorrentes | 8 por sessão | + fila |
| Aprovações por turno | ilimitadas | timeout individual 10 min (config.); `submit_plan`/`ask_user` são limitados pelo broker, não pelo wrapper de timeout da tool |
| Validação de UI | — | `validate_ui` sempre disponível (exceto no subagente); não conta no orçamento; resultado >24k vai para spill |
| Tentativas de tool repetida | aviso após 3x iguais | injeção de lembrete no próximo passo |

## 5. Matriz de testes (resumo)

| Área | Testes obrigatórios |
| --- | --- |
| Registro/prompt | tools visíveis por perfil; orientações geradas do `ToolSpec`; nomes estáveis; ordem determinística |
| Leitura | faixa/offset/limite, encoding, binário, segredo, escape de path, ignore |
| Escrita | criar/substituir, observação, stale, EOL/BOM, diff, caps, path fora |
| Busca | literal/regex/glob, ignore, caps, 0 resultados |
| Shell | exit codes, stderr, timeout, cancelamento/árvore, spill, env scrub, risco/destrutivo, background/promoção |
| Git leitura | status/diff/log, sem repo, rename/binário, caps |
| Planejamento | todo write/projeção; plano aprovar/feedback/fora de modo; ask_user single/multi/timeout |
| Política | matriz modo × classe × path × segredo × comando; regras "sempre permitir"; negação com feedback |
| Loop | tool que pausa (aprovação) não vaza passo; cancelamento durante aprovação; spill/replay; apresentação persistida |
| UI (renderer) | cards por tipo, diff, aprovação (teclado/a11y), todo/plano, jobs, estados de erro, bloco `ui` no transcript do Code e linha `Validou a interface` |

## 6. Erros estáveis (códigos)

`FS_NOT_FOUND`, `FS_NOT_A_FILE`, `FS_BINARY`, `FS_TOO_LARGE`, `FS_OUTSIDE_WORKSPACE`,
`FS_NOT_OBSERVED`, `FS_STALE_VERSION`, `FS_NO_WORKSPACE`, `FS_SECRET_PATTERN`,
`POLICY_DENIED`, `APPROVAL_DENIED`, `APPROVAL_UNAVAILABLE`, `APPROVAL_TIMEOUT`, `PLAN_MODE_ACTIVE`,
`PLAN_TOO_BRIEF`,
`COMMAND_TIMEOUT`, `COMMAND_ABORTED`, `JOB_LIMIT`, `GIT_NOT_A_REPO`, `GIT_FAILED`, `SPILL_NOT_FOUND`,
`TOOL_INVALID_ARGS`, `WORKSPACE_UNREADABLE`.

Cada código tem mensagem acionável e um teste — o modelo recebe o código em `code` (envelope) e a
mensagem em `content`; a UI mostra o código no card de erro (para diagnóstico).

## 7. Tool `goal` — objetivo da sessão (v1.11)

Fonte de produto/UI: `docs/goals/code-goals/PLAN.md`. Resumo do contrato:

- `name:"goal"`, `parallel: Exclusive`, `risk: Read`, `mutating: false`,
  `requires_workspace: true`, profiles `[Code]` (24ª tool do catálogo, entre `ask_user` e `task`);
  ausente em subagentes (não está em `readonly_tools()`).
- Schema estrito: `{ action: "create"|"edit"|"progress"|"complete"|"blocked", objective?, title?,
  max_rounds? (1..=100), auto_continue?, note? }`, `required:["action"]`,
  `additionalProperties:false`.
- **Ativação (v1.12)**: o usuário usa `/goal` + mensagem; o comando apenas ativa um chip no
  composer (sem texto automático) e o turno humano leva `goalRequest=true`. O harness injeta uma
  seção volátil `## Goal request` no runtime context instruindo o agente a chamar `create` com
  `objective`, `title`, `max_rounds` e `auto_continue` (default do fluxo: **true**). O driver
  inicia a rodada ao fim do turno.
- Regras: `create`/`edit` só em turno humano (`GOAL_REQUIRES_USER_TURN`); `create` exige objetivo,
  não aceita objetivo ativo/pausado/bloqueado, usa `origin=agent` e honra `auto_continue` explícito
  (sem o parâmetro, proposta nasce desarmada); `progress` exige objetivo ativo/pausado, nota ≤2 000 e
  zera estol; `complete` grava resumo/evidência; `blocked` exige motivo e aplica a regra de 3 motivos
  normalizados iguais (antes disso responde "registrado N/3").
- Saída model-facing curta (1–3 linhas); `presentation` flat `{kind:"goal", ...GoalView camelCase}`
  para o card da timeline; emite `GoalUpdated`.
- Códigos adicionais: `GOAL_NOT_FOUND`, `GOAL_NOT_ACTIVE`, `GOAL_ALREADY_EXISTS`,
  `GOAL_STALE_REVISION`, `GOAL_MAX_ROUNDS`, `GOAL_PLAN_MODE`, `GOAL_INVALID_ARGS`,
  `GOAL_REQUIRES_USER_TURN`, `GOAL_NOT_ARMED`, `GOAL_BUSY`, `GOAL_NO_WORKSPACE`,
  `GOAL_PERSIST_FAILED`, `GOAL_TURN_REQUIRES_CODE`, `GOAL_REQUIRES_TOP_LEVEL`.
