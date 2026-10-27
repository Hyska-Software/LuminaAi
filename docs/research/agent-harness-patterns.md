# Benchmark de harnesses de agentes de código

> **Status**: pesquisa concluída em 2026-10-27. Insumo para o plano do harness de código do Lumina (app desktop Tauri + React + Rust, local-first, Windows).
> **Escopo**: OpenAI Codex (CLI/app), Claude Code, opencode, Aider, Cursor Agent, Zed Agent, Cline/Roo, OpenHands, protocolos MCP, ACP, AGENTS.md e Agent Skills.
> **Fora de escopo**: DeepSeek Harness (DSH) tem task própria; t3code, Conductor, Terragon, Jules e Devin **não foram verificados** nesta rodada (ver §9).
> **Arquivo único desta task** — nenhum código foi alterado.

---

## §0. Sumário executivo (o que o benchmark sustenta)

1. **Catálogo pequeno e estável vence catálogo grande.** Codex tem poucas primitivas (shell + apply_patch + leitura), Claude Code ~40 tools, opencode 10, Aider edita por *formatos*. A convergência real é **ler, buscar, editar por patch/string, shell, planejar, perguntar** — o resto varia. Começar com ~15 tools de contrato forte.
2. **Aprovação e sandbox são controles separados.** Codex documenta: sandbox é o limite técnico; *approval policy* decide quando pausar; trocar quem revisa (usuário × revisor automático) **não** amplia o sandbox [2][4]. Modele os dois eixos no backend.
3. **Modos ensinam o usuário; regras `Tool(specifier)` operam o dia a dia.** CC, opencode e Zed usam ambos: modo como baseline + allow/ask/deny por cima [14][15][22][33]. Mínimo do Lumina: **Manual, Aceitar edições, Plano, Acesso total (dev)**.
4. **Plan mode é modo de permissão, não tela.** Em CC é valor de `permissionMode` com `EnterPlanMode`/`ExitPlanMode` e gate de aprovação [13][14]; Cline separa Plan × Act [35]; Aider tem *architect mode* (2 modelos) [24]. O plano deve ser **artefato estruturado persistido**.
5. **Diff é o contrato de UX da edição.** ACP define *tool call kinds* (`read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch`, `switch_mode`) e diff por tool call [30]; todos os harnesses revisam antes de aplicar. Revisão por *hunk* (“visto”, aceitar/rejeitar, reverter) é o padrão.
6. **Checkpoint de sessão complementa o Git, não substitui.** CC: snapshot por turno, rewind código/conversa/ambos, com limites (Bash não rastreado, subagente não restaurado) [16]; Aider faz o oposto (auto-commit por edição) [39]. Recomendo **snapshot de turno + git opcional**.
7. **Worktree isola paralelismo real.** Codex (worktrees + Handoff) [9], CC (`EnterWorktree`, `isolation: worktree`) [13][18], Cursor (Cloud Agents) [34]. No Windows com `cargo` de target compartilhado (AGENTS.md), **escrita concorrente no mesmo workspace é perigosa**: serializar primeiro.
8. **Extensibilidade em 3 camadas, nesta ordem de custo/valor:** (a) `AGENTS.md` [26] + skills `SKILL.md` [11][19][40]; (b) MCP stdio/HTTP [8][27]; (c) hooks de ciclo de vida [7][17]. ACP [28] só se o Lumina for *hospedar* agentes de terceiros.

Consequência para o plano: **contratos de tools + pipeline de aprovação/diff + plan mode como estado da sessão**. Subagentes, worktrees e ACP ficam para a fase 2.

---

## §1. Legenda de confiabilidade

| Marca | Significado |
| --- | --- |
| **[D]** | Documentado em fonte oficial (doc do produto, spec do protocolo). URL em §10. |
| **[I]** | **Inferido** por mim a partir de documentação ou do comportamento descrito; não é afirmação literal da fonte. |
| **[NC]** | **Não confirmado** nesta pesquisa — não trate como fato ao decidir. |
| **[H]** | Fato de design do próprio Lumina (código/docs locais), não do benchmark. |

Toda célula de matriz traz o número da referência. Quando a célula não tem marca explícita, é **[D]**.

---

## §2. Matriz comparativa (padrões × harnesses)

### 2.1 Tools e primitivas de edição

| Padrão | Codex [1–3,37] | Claude Code [13] | opencode [23] | Aider [24] | Cursor [34] | Zed [33] | Cline/Roo [35] | OpenHands [38] |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Catálogo** | pequeno: shell, patch, leitura, busca, web, MCP [37] | ~40 tools nomeadas (`Agent`, `Bash`, `PowerShell`, `LSP`, `Monitor`, `Task*`…) [13] | 10: `bash`, `edit`, `write`, `read`, `grep`, `glob`, `apply_patch`, `skill`, `todowrite`, `webfetch` [23] | sem “tools”: *edit formats* + shell | coordinator + rules + subagentes [34] | `grep`, `read_file`, `edit_file`, `write`, `create_directory`, `terminal`, subagente [33] | Plan só lê; Act lê/busca/executa [35] | CodeAct (código como ação) + Agent Canvas [38] |
| **Primitiva de edição** | **patch** (apply_patch/udiff) [37] | `Edit` (string replace) + `Write` (arquivo inteiro) [13] | `edit` **e** `apply_patch` **e** `write` [23] | whole / diff (SEARCH/REPLACE) / diff-fenced / udiff [24] | edição por arquivo com review [34] | `edit_file` + `write` [33] | edita só no Act [35] | via código (CodeAct) [38] |
| **Leitura/busca** | shell + `--search`; leitura incremental [37] | `Read` com limites; `Grep`/`Glob` [13] | `read`, `grep`, `glob` [23] | files no chat + repo map (tree-sitter/ranking) [25] | busca do IDE [34] | `read_file`, `grep` [33] | leitura no Plan [35] | shell/grep via código [38] |
| **Shell / terminal** | sandbox + approvals; PTY no TUI [1][37] | `Bash` + `PowerShell` nativo, background, timeouts [13] | `bash` [23] | shell externo do usuário | terminal integrado [34] | `terminal` com permissões próprias [33] | terminal no Act [35] | runtime Docker/remoto [38] |
| **Diagnósticos/LSP** | não documentado como tool [NC] | `LSP` (definição, referências, erros) [13] | LSP servers integrados [21] | não | diagnóstico do IDE [NC] | não documentado [NC] | não | [NC] |
| **Web** | `--search` [37] | `WebFetch`, `WebSearch` [13] | `webfetch` [23] | `/web` [NC] | busca [NC] | web tools [33] | [NC] | browser/terminal [38] |

### 2.2 Permissões, sandbox e aprovação

| Padrão | Codex [1–4] | Claude Code [13–15] | opencode [22] | Aider | Cursor [34] | Zed [33] | Cline [35] | OpenHands [38] |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Eixo sandbox** | `sandbox_mode`: `read-only`, `workspace-write`, `danger-full-access` [1] | sandbox de Bash (macOS/Linux/WSL2) + paths protegidos [14] | sem sandbox de SO; diretório externo controlado [22] | sem sandbox (confia no git) [I] | approvals do IDE [NC] | terminal com restrições de SO + *project trust* [33] | auto-approve por ferramenta [35] | **container Docker por conversa** [38] |
| **Eixo aprovação** | `approval_policy`: `on-request`, `never`; **`untrusted` aposentado** [1] | `permissionMode`: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions` [14] | regras `allow`/`ask`/`deny` + auto mode [22] | prompts do usuário [I] | aprovações no IDE [34] | `allow`/`deny`/`confirm` por tool [33] | Auto Approve [35] | aprovações no runtime [38] |
| **Quem revisa / regras** | `approvals_reviewer`: `user` ou `auto_review`; *rules* + `requirements.toml` [1][3][4][7] | classificador em `auto`; `Tool(specifier)`: `Bash(npm run *)`, `Edit(/src/**)` [13][14][15] | wildcards por padrão + auto mode [22] | usuário | rules [34] | profiles + tool permissions [33] | por ferramenta [35] | [NC] |
| **Deny vence tudo** | sandbox ≠ approval; `never` ainda respeita sandbox [1] | `deny` bloqueia até em `bypassPermissions` [14] | `deny` vence auto mode [22] | n/a | [NC] | deny no profile [33] | [NC] | [NC] |
| **Windows** | sandbox nativo no PowerShell; impl. Linux no WSL2 [1] | `PowerShell` tool; sandbox de Bash não cobre Windows [13][14] | [NC] | roda como terminal | app Windows [I] | app Windows [I] | VS Code [I] | via container [38] |

### 2.3 Sessão, contexto, estado e extensibilidade

| Padrão | Codex [6,9,37] | Claude Code [13,16,18] | opencode [21,36] | Aider [25,39] | Cursor [34] | Zed [33] | Cline [35] |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Sessão** | chat + `codex resume`; threads de subagentes [6][37] | sessão com rewind, branch/fork [16] | server headless HTTP/OpenAPI + clientes [36] | chat de terminal | threads/agentes | threads no Agent Panel | tarefa com checkpoints [35] |
| **Compactação** | auto-compact + `/compact` [6] | `autoCompactWindow` por subagente [18] | [NC] | resumo + repo map [25] | [NC] | [NC] | [NC] |
| **Checkpoint** | *git checkpoints* recomendados [37]; worktree [9] | **snapshot por turno**, rewind código/conversa, summarize, 100 checkpoints, ~30 dias [16] | undo/redo [NC] | **auto-commit a cada edição** [39] | checkpoints [34][I] | não doc. | checkpoints [35] |
| **Instruções de projeto** | `AGENTS.md` global+aninhado, merge root→cwd, 32 KiB [5][26] | `CLAUDE.md` + skills + settings [17][19] | `AGENTS.md`/rules [26] | `--read AGENTS.md` [26] | rules [34] | rules [26][33] | `AGENTS.md` [26] |
| **Paralelismo/worktree** | subagentes paralelos + resumos [6]; worktree + Handoff [9] | `Agent` (contexto próprio), teams, `Task*`; `EnterWorktree`, `isolation: worktree` [13][18][20] | subagentes c/ modelo e permissões próprias [21] | architect + editor (2 modelos) [24] | subagentes + Cloud Agents [34] | subagente por thread [33] | sem paralelismo doc. [NC] |
| **Extensibilidade** | MCP stdio/HTTP [8]; 12 hooks c/ MCP tool hooks [7]; skills [11]; **app-server** p/ embedding [12] | MCP + tool search [13]; ~30 hooks [17]; Agent Skills [19]; Agent SDK [13] | MCP + **ACP support** [21][36]; skills [23] | convenções via `--read` | rules/subagentes [34] | MCP por Agent Profile [33] | MCP [NC] |

### 2.4 Protocolos e formatos abertos

| Protocolo | O que padroniza | Relevância para o Lumina | Fonte |
| --- | --- | --- | --- |
| **MCP** (2025-06-18) | JSON-RPC 2.0 + negociação; server: resources/prompts/tools; client: sampling/roots/elicitation | segurança é do host: consentimento antes de invocar tool, descrições de tool **não confiáveis**, consentimento em sampling; progresso/cancelamento/log | [27] |
| **ACP** (v1) | editor ↔ agente; JSON-RPC; local via stdio, remoto HTTP/WebSocket (WIP); reusa JSON do MCP | tool calls com `kind`/`status`/`locations`/diff; permission requests; file system e terminals como capacidades do cliente; agent plan; session modes/config; slash commands | [28][29][30][31][32] |
| **AGENTS.md** | Markdown aberto, sem campos obrigatórios; aninhado, o mais próximo vence; prompt do usuário vence | 60k+ projetos; Codex, Jules, Aider, goose, opencode, Zed, Warp, VS Code, Devin, Cursor, Roo, Gemini CLI; sob a Agentic AI Foundation | [26] |
| **Agent Skills** | pasta `SKILL.md`; `name`+`description` mínimos; scripts/referências/templates; *progressive disclosure* | padrão aberto com spec; adotado por Codex e Claude Code com extensões | [11][19][40] |

---

## §3. Padrões que convergem (o que quase todo harness faz)

1. **Tools nomeadas, com schema, e resultados estruturados.** Todos os harnesses com tool calling têm nomes estáveis em `snake_case`, entrada JSON e saída em texto + metadados. O modelo nunca recebe “string mágica”: recebe resultado com status. [13][23][33]
2. **Leitura antes da escrita.** Editores exigem ler o arquivo antes de editar (e muitos detectam stale/version conflict). Reduz alucinação de patch e permite diff ancorado. [13][24][I para o restante]
3. **Diff como cidadão de primeira classe.** Todo harness que edita arquivos mostra diff antes/depois e permite reverter. ACP formaliza isso com `kind: edit` + conteúdo de diff por tool call. [16][30][35]
4. **Aprovação em dois níveis: política (modo) + exceção (regra).** Modo define baseline; regras `Tool(specifier)`/wildcards refinam. Deny sempre vence. [14][15][22]
5. **Sandbox separado de aprovação.** Quando existe sandbox de SO (Seatbelt/bubblewrap/nativo Windows/Docker), ele é ortogonal ao approval. [1][14][38]
6. **Plan mode como estado explícito e com gate.** O agente pesquisa e propõe; a saída do modo exige aprovação do plano. Formato do plano: lista estruturada (tasks/steps), não prosa livre. [13][14][31][35]
7. **Instruções de projeto em arquivo versionado** (`AGENTS.md`/`CLAUDE.md`/rules), descobertas hierarquicamente. [5][19][26]
8. **Compactação de contexto automática + comando manual.** Nenhum harness sobrevive a sessões longas sem compactar; todos oferecem compactação automática e/ou manual. [6][16][18]
9. **Extensibilidade por três canais**: tools externas via MCP, automação por hooks, conhecimento por skills/instruções. [7][8][11][17][19][27]
10. **Revisão final antes de “entregar”**: review de alterações, não só execução. Codex tem code review nativo contra working tree/commit/base branch [10]; Claude Code tem `/code-review` e `ReportFindings` [13]; Cursor tem Agent Review [34].

---

## §4. Divergências e trade-offs

| # | Divergência | Polo A | Polo B | Trade-off | Evidência |
| --- | --- | --- | --- | --- | --- |
| D1 | **Primitiva de edição** | patch/unified diff (Codex `apply_patch`, Aider `udiff`) | string replace (Claude Code `Edit`) ou arquivo inteiro (`Write`, Aider `whole`) | Patch é token-efficient e dá diff natural, mas exige formato rígido e falha em arquivo grande/ambíguo; string replace é robusto mas precisa de unicidade e pode corromper com match errado | [13][24][37] |
| D2 | **Como modelar permissão** | modos simples (Codex) | motor de regras + modos (CC/opencode/Zed) | Modos são ensináveis e seguros por padrão; regras são necessárias para uso diário (senão fadiga de aprovação). Implementar modos primeiro e regras como camada | [1][14][22][33] |
| D3 | **Autoaprovação por modelo** | revisor automático (Codex `auto_review`, CC `auto` mode) | política determinística (allowlists, sandbox) | Reduz fadiga mas adiciona latência, custo e superfície de confiança; em app local-first o usuário pode não querer um segundo modelo decidindo | [4][14][22] |
| D4 | **Checkpoint** | snapshot do host (CC, Cline) | auto-commit git (Aider) | Snapshot cobre arquivos não versionados e é reversível sem poluir histórico; git-commit dá histórico real, mas polui e depende de repo. Ideal: snapshot + commit opcional | [16][35][39] |
| D5 | **Paralelismo** | worktree por tarefa (Codex, CC, Cursor Cloud) | workspace único serializado (Aider, Cline) | Worktree permite N agentes sem colisão, mas custa setup/deps e complica review; workspace único é previsível e barato. Windows + build compartilhado piora o polo worktree | [6][9][18][20] |
| D6 | **Formato do plano** | plano estruturado em tool (`update_plan`/Task*) | plano em Markdown + gate (`ExitPlanMode`) | Estruturado dá progresso e dependências (@@tasks), mas engessa; Markdown é livre e legível, mas difícil de acompanhar. ACP sugere “agent plan” como conteúdo de sessão | [13][18][31] |
| D7 | **Sandbox no Windows** | sandbox nativo/container (Codex, OpenHands) | só approvals + path jail | Windows não tem Seatbelt/Landlock; container quebra o “local-first”. Approvals + path jail + shell allowlist é o mínimo viável; AppContainer/Job Object é pesquisa própria | [1][14][38] |
| D8 | **Protocolo de embedding** | ACP (editor ↔ agente) | app-server proprietário (Codex) / HTTP+OpenAPI (opencode) | ACP permite trazer agentes de terceiros para a UI; proprietário é mais rápido de implementar. Só vale se “traga seu agente” for requisito | [12][28][36] |

---

## §5. Catálogo recomendado de tools (desktop Rust/Tauri, local-first, Windows)

### 5.1 Princípios do catálogo

- **Poucas primitivas, contratos fortes.** Toda tool: nome `snake_case` (compatível com o que já existe: `create_file`, `web_search`, `fetch_url`, `run_code`, `validate_ui`, `list_artifacts`, `read_artifact` **[H]**), entrada JSON Schema, saída estruturada, limites explícitos, erros tipados.
- **Path jail sempre.** Todo path resolve contra a raiz do workspace aberto; `..` e symlinks/hardlinks para fora são rejeitados (canonicalize + prefix check; no Windows, atenção a junction points e case-insensitivity) **[I]**. Paths fora da raiz exigem aprovação explícita e aparecem no prompt como “fora do projeto”.
- **Edição = patch, não reescrita.** Um write cego de arquivo inteiro é o caminho mais fácil para destruir trabalho. O modelo deve preferir `apply_patch`/`edit_file`; `write_file` é criação/reescrita com aprovação mais forte **[I, alinhado a [24][37]]**.
- **Resultado sempre com envelope**: `{ ok, data } | { ok: false, error: { code, message, retryable, detail? } }`. Códigos mínimos: `not_found`, `permission_denied`, `stale_file`, `invalid_patch`, `too_large`, `timeout`, `cancelled`, `outside_workspace`, `binary_file`, `encoding`.
- **Truncamento com spill**: saídas grandes voltam truncadas + referência a um artefato (`read_artifact`) em vez de estourar contexto. Limites explícitos por tool (ex.: 2.000 linhas / 256 KiB; 250 matches).
- **Paralelo-safe** = pode rodar concorrente com ela mesma e com outras tools de leitura, sem efeito colateral observável. Writes e shell mutável são **serial** por definição; o executor deve rodar em *waves* (leitura paralela → escrita serial). O Lumina já executa tools em paralelo com máximo 4 **[H]**; mantenha o teto e adicione a classificação por tool.
- **Aprovação declarada na tool, decidida pelo host.** A tool declara `approval: never | on_write | always`; o host cruza com o modo de permissão e as regras do projeto. A tool nunca decide sozinha **[I]**.

### 5.2 Catálogo (fase 1 do harness de código)

| # | Tool | Propósito | Entrada (campos) | Saída | Aprovação | Paralelo-safe |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `read_file` | ler arquivo com paginação | `path`, `offset?`, `limit?` | linhas numeradas, `truncated`, `size`, `encoding`, `mtime` | nunca | sim |
| 2 | `list_dir` | listar diretório | `path?`, `depth?` (≤2) | entradas `{name, kind, size?, ext?}`, ordenadas, ignorando `.git`, `node_modules`, `target` | nunca | sim |
| 3 | `glob` | achar arquivos por padrão | `pattern`, `path?`, `limit?`≤100 | paths ordenados por mtime desc | nunca | sim |
| 4 | `grep` | buscar conteúdo | `pattern` (regex), `include?`, `path?`, `caseSensitive?`, `maxMatches?`≤250 | `{file, line, col, text}` + total/truncado | nunca | sim |
| 5 | `apply_patch` | aplicar diff unificado/estruturado | `patch` (texto), `dryRun?` | por arquivo/hunk: `applied`, `rejected[{hunk, reason}]`, `created`, `deleted` | on_write | **não** |
| 6 | `edit_file` | substituição literal ancorada | `path`, `old`, `new`, `replaceAll?`, `expectedHash?` | `{edits, newHash}` ou `stale_file` | on_write | **não** |
| 7 | `write_file` | criar/sobrescrever arquivo | `path`, `content`, `encoding?` (utf-8), `expectedHash?` | `{bytes, created}` | on_write (mais forte) | **não** |
| 8 | `delete_path` | remover arquivo/dir vazio | `path`, `recursive?` | `{deleted}` | sempre | **não** |
| 9 | `move_path` | mover/renomear | `from`, `to` | `{moved}` | sempre | **não** |
| 10 | `run_command` | shell via PTY/processo | `command`, `args[]`, `cwd?`, `timeoutMs?`, `env?` (allowlist), `pty?` | `exitCode`, `stdout`, `stderr`, `durationMs`, `truncated`, `artifact?` | conforme modo/regra | sim se `readOnly`; senão não |
| 11 | `run_code` | executar Python/Node (já existe) **[H]** | `language`, `code`, `timeoutMs?` | stdout/stderr + artefatos | conforme settings | sim (workspace isolado) |
| 12 | `git_status` | estado do repo | — | `{branch, ahead, behind, staged[], unstaged[], untracked[]}` | nunca | sim |
| 13 | `git_diff` | diff de trabalho/staged/range | `path?`, `staged?`, `from?`, `to?`, `maxBytes?` | diff unificado + estatísticas | nunca | sim |
| 14 | `git_commit` | commit das alterações | `message`, `paths[]`, `amend?`=false | `{sha, files}` | sempre | **não** |
| 15 | `diagnostics` | erros/avisos do projeto (LSP ou compilador) | `path?`, `severity?`, `limit?` | `{diagnostics[{file,line,severity,message,source}]}` | nunca | sim |
| 16 | `update_plan` | plano estruturado da tarefa | `items[{id, title, status, detail?}]`, `explanation?` | plano normalizado + versão | nunca | **não** |
| 17 | `ask_user` | perguntar com opções | `question`, `options[{label, description?}]`, `allowFreeText?` | `{answer, selectedOption?, freeText?}` | nunca | **não** (bloqueia o turno) |
| 18 | `fetch_url` | buscar URL (já existe) **[H]** | `url`, `format?` (text/markdown) | conteúdo + título + status, limite de bytes | regra por domínio | sim |
| 19 | `web_search` | busca web (já existe) **[H]** | `query`, `maxResults?` | resultados `{title,url,snippet}` | regra | sim |
| 20 | `create_file` | artefato de texto (já existe) **[H]** | `name`, `content`, `mime?` | `{artifactId}` | on_write | sim (artifacts são append-only) |
| 21 | `validate_ui` | validar UI generativa (já existe) **[H]** | spec | `{ok, errors[]}` | nunca | sim |
| 22 | `delegate_task` *(fase 2)* | subagente com contexto próprio | `role`, `prompt`, `tools[]`, `isolation` (`shared`\|`worktree`), `model?` | `{summary, filesTouched[], diff?}` | sempre (1x no spawn) | sim (spawns rodam em paralelo) |

**Contratos que mais erram na prática:**

- `apply_patch`: **um** formato canônico (unified diff `---/+++`/`@@`) e rejeição **por hunk** (nunca falhar o patch inteiro em silêncio); `dryRun` barato para a UI pré-visualizar; criação/remoção via `new file mode`/`deleted file mode`; limites de 1 MiB e 50 arquivos/chamada **[I]**.
- `edit_file`: **unicidade** do `old` (>1 ocorrência sem `replaceAll` → `ambiguous_match` com lista); `expectedHash` detecta edição concorrente → `stale_file` (“recarregar e reaplicar”) **[I]**.
- `run_command`: no Windows, **nunca** string única de shell — `command` + `args[]` + `shell` explícito (`pwsh`/`cmd`/`bash`); timeout default 120 s; saída >1 MiB vira artifact; cancelar matando a árvore (`taskkill /T`); `pty` só quando declarado **[I]**.
- `diagnostics`: `cargo check --message-format=json` + `tsc --noEmit` (+ LSP opcional), cache por mtime — é a tool que mais corta o loop “editei e quebrei” **[I]**.
- `update_plan`: plano persistido no turno (não em memória) e emitido como evento; uma tool só (não `TodoWrite` + `TaskCreate`) **[I, contraponto a [13]]**.
- `ask_user`: retorno tipado (opção + texto livre), com “ignorar e continuar”; timeout nunca auto-responde ação destrutiva **[I]**.

**Fora da fase 1:** `NotebookEdit`, `Artifact` remoto, `PushNotification`, `Cron*`, `ToolSearch`/deferred tools (só com MCP > ~30 tools) e `Workflow` [13].

---

## §6. Recomendações de UX

### 6.1 Diff e revisão de alterações

1. **Diff é a unidade de revisão, hunk é a de decisão.** Cada hunk com `Aceitar`/`Rejeitar`/`Editar`; estado “visto” por arquivo (padrão Codex “Mark as viewed”) [10]; navegação `Alt+↓`/`Alt+↑`; contador de pendentes.
2. **Três abas no painel de código** (já previstas **[H]**): `Arquivos`, `Alterações` (diff do turno) e `Plano`. O diff do turno mostra *o que o agente tocou*, não o diff git inteiro — separe “alterações do agente” de “estado do repo”.
3. **Diff por tool call na timeline**: `tool_call_finished` de edição carrega `{files, +N/−M}` e link para o diff naquele ponto — é o padrão ACP (`content` com diff, `locations`) [30]; permite revisar no meio do turno.
4. **Path externo nunca é silencioso**: aprovação mostra caminho absoluto, motivo e diff; não é herdada por turnos seguintes sem regra explícita [I].
5. **Estados vazios reais** (“Nenhuma alteração pendente”, “Diff grande — abrir no editor”) e **cartão para binário** (tipo/tamanho/hash, “Abrir”), nunca diff textual de binário [I][H].

### 6.2 Aprovações

1. **Seletor de modo visível no composer** (Codex: abaixo do composer; CC: status bar) [1][14]. Rótulos pt-BR: `Manual`, `Aceitar edições`, `Plano`, `Acesso total (dev)`.
2. **Prompt com três informações**: *o que* (tool + args resumidos), *onde* (path/escopo, dentro ou fora do projeto), *consequência* (diff/comando/url). Ações: `Permitir uma vez`, `Permitir nesta sessão`, `Permitir sempre para este padrão` (vira regra), `Negar` (motivo volta ao modelo).
3. **Mesmo formato de regra em todo lugar**: `Tool(specifier)` — `Bash(npm run *)`, `Edit(src/**)`, `Read(~/.ssh/**)`, `WebFetch(domain:docs.rs)` [13][15]; painel “Permissões” mostra a política efetiva (modo + regras + sandbox).
4. **Deny vence tudo**; regras de projeto só valem depois de “confiar na pasta” — repo clonado é vetor de ataque [14][27].
5. **Recusa com feedback**: o modelo recebe `permission_denied` + motivo e pode propor alternativa; negar não cancela o turno (padrão CC) [14].

### 6.3 Plan mode

1. **Estado explícito com gate.** Entrada por seletor (`Plano`) ou pedido do modelo; em plan mode, escrita e shell mutável ficam bloqueados pelo host; `ExitPlanMode` **exige aprovação** [13][14].
2. **Plano = artefato estruturado + render Markdown**: itens `{id, title, status, detail}`, progresso na UI e edição antes de aprovar (“Ctrl+G editar plano” no CC) [14].
3. **Opções de saída**: `Aprovar e usar auto` / `Aprovar e revisar cada edição` / `Continuar planejando` [14]; sem classificador, a primeira vira `Aprovar e aceitar edições`.
4. **Persistir o plano no turno**; se arquivos mudaram desde a criação, marcar “plano desatualizado” e confirmar **[I]**.
5. **Restrição real, não prompt**: em plan mode as tools de escrita/mutação são negadas pelo host [I].

### 6.4 Checkpoints e histórico

1. **Snapshot no início de cada turno** + `Reverter este turno`; escopo = arquivos tocados pelo agente, binários grandes ignorados com aviso, retenção configurável [16].
2. **Rewind com três opções**: código e conversa, só conversa, só código — mais `Resumir daqui` para liberar contexto [16].
3. **Limitações explícitas na UI**: mudanças via `run_command` fora das tools de edição não são rastreadas; subagentes/worktrees não são restaurados; symlinks não revertem [16].
4. **Git opcional**: distinguir “checkpoint local” de “commit git”; nunca auto-commit por padrão (Aider auto-commita [39] — bom para CLI, invasivo em app).

---

## §7. Arquitetura de extensibilidade recomendada

### 7.1 Ordem de implementação (custo → valor)

| Fase | Camada | O que entra | Fundamento |
| --- | --- | --- | --- |
| 1 | **Instruções de projeto** | `AGENTS.md` (raiz + aninhados, merge root→cwd, override), injetado no system prompt ao lado do catálogo de skills existente | formato aberto e barato; Codex/CC já validaram a hierarquia [5][26] |
| 2 | **Skills** | pasta `SKILL.md` com frontmatter `name`/`description`/`allowed-tools`, *progressive disclosure* (só nome+descrição no prompt, corpo sob demanda) | o Lumina já tem skills embutidas **[H]**; alinhar ao padrão aberto [19][40] |
| 3 | **MCP (cliente)** | servidores **stdio** e **Streamable HTTP**; tools/resources; enable/disable por servidor; aprovação por tool mostrando origem; descrição de tool tratada como não confiável | [8][27] |
| 4 | **Hooks** | subset: `session_start`, `user_prompt_submit`, `pre_tool_use` (pode negar), `post_tool_use`, `pre_compact`, `stop`, `notification`; script local com timeout e saída JSON | eventos documentados nos dois harnesses [7][17] |
| 5 | **Subagentes** | `delegate_task` com tools allowlist, modelo opcional, isolamento `shared`/`worktree`, resumo de retorno, `maxTurns` | [6][18] |
| 6 | **ACP / agentes externos** | opcional: Lumina como *client* ACP para rodar agentes de terceiros (ex.: opencode) na UI | protocolo pronto, mas só se “traga seu agente” for requisito [28] |

### 7.2 Notas de implementação em Rust/Tauri

- **MCP**: implementar cliente JSON-RPC com `tokio` + `reqwest` (a infra já existe via `AppState::http` **[H]**); processo stdio via `tokio::process` com timeout e kill. Existe SDK oficial em Rust (`rmcp`) — **confirmar versão/licença antes** de adotar **[I/NC]**. Tools MCP entram no mesmo registry das nativas, com namespace `mcp:<server>:<tool>` para evitar colisão de nomes e para exibir origem na aprovação **[I]**.
- **Hooks**: executar como subprocessos locais (nunca eval), com `timeout` curto (ex.: 5 s), ambiente filtrado e contrato JSON de entrada/saída; modo *blocking* apenas em `pre_tool_use` e `permission_request` [7][17]. Em Tauri, rodar no backend (`harness`/`tools`), nunca no renderer.
- **Skills**: reaproveitar o carregador existente de skills embutidas **[H]**; ordenar precedência `projeto > usuário > embutida`; expor `allowed-tools` como restrição efetiva (não só prompt) **[I]**.
- **`AGENTS.md`**: parse simples (Markdown puro, sem campos obrigatórios — a spec não exige nada [26]); concatenar com limite de bytes (Codex usa 32 KiB por padrão [5]) e registrar no trace quais arquivos entraram.
- **Eventos de UI**: estender `TurnEvent` com `tool_call_update` (status + diff + locations) para permitir timeline viva; hoje o Lumina emite `tool_call_started/args/finished` **[H]**, e o padrão ACP pede updates intermediários [30].
- **Paralelismo**: manter o teto de 4 execuções **[H]**, mas particionar por classe (`parallel-safe` vs `serial`) e nunca intercalar escrita com leitura do mesmo arquivo (`expectedHash`/version guard no backend) **[I]**.

### 7.3 Segurança (não negociável)

- **MCP**: consentimento explícito antes da primeira invocação de cada tool; descrição/annotations de tool são **dados não confiáveis** [27]; mostrar servidor de origem em toda aprovação.
- **Hooks/skills do projeto**: não executar nada de repositório recém-clonado antes de “confiar na pasta” (modelo CC) [14]; scripts de skill só via `run_code` com workspace isolado **[H]**.
- **Path jail + `expectedHash`**: barreira determinística que não depende do modelo [I].
- **Shell**: allowlist de comandos read-only para autoaprovação (padrão CC de “read-only commands”) [13]; nunca autoaprovar `rm`, `git push`, `npm publish`, `curl` com corpo para fora etc. **[I]**.

---

## §8. O que o benchmark NÃO decide (decisões em aberto para o Lead)

1. **Primitiva de edição única ou duas?** `apply_patch` (Codex/Aider) × `edit_file` (CC) × ambos (opencode). Recomendação deste doc: **ambas**, com `apply_patch` como preferida no prompt e `edit_file` como fallback robusto.
2. **Motor de regras na v1 ou só modos?** Recomendação: modos + regras mínimas de projeto (`allow`/`deny`) já na v1, porque sem regras a fadiga de aprovação mata o uso diário (evidência convergente [14][22][33]).
3. **Autoaprovação por classificador?** Recomendação: **não** na v1 (local-first, custo/latência, superfície de confiança); deixar o gancho `approvals_reviewer` no contrato para plugar depois [1][4][14].
4. **Checkpoint: snapshot, git ou os dois?** Recomendação: snapshot de turno na v1 + ações git explícitas; auto-commit nunca por padrão [16][39].
5. **Worktree por tarefa?** Recomendação: **não** na v1 (Windows/build compartilhado); desenhar `isolation` no contrato de `delegate_task` e implementar depois [9][18].
6. **ACP agora?** Recomendação: não; primeiro MCP (tools) e depois ACP (agentes externos), se “traga seu agente” for prioridade de produto [28][36].
7. **Plano estruturado vs Markdown**: recomendação: estrutura de dados estruturada com render Markdown; gate de aprovação copiado do CC [14][31].

---

## §9. Limites desta pesquisa (transparência)

- **Não verificados**: t3code, Conductor, Terragon, Jules, Devin, Continue, SWE-agent e a maior parte de “worktree orchestrators” — citados no pedido, mas sem documentação oficial consultada nesta rodada. Tratados como **[NC]**. O padrão “workspace isolado por tarefa” aparece de forma documentada em Codex (worktrees) e Claude Code (worktrees/isolation) [9][18][20], o que cobre a decisão de arquitetura.
- **Cursor**: página oficial consultada cobre Agent, Agent Review, Planning, Rules, Subagents, Cloud Agents, Security Agents e PR Routing & Approval [34]; detalhes de permissões e hooks não foram confirmados **[NC]**.
- **OpenHands**: confirmados Agent Canvas, CodeAct (legacy), Docker por conversa, ACP agents e plugins [38]; detalhes de tools/permissões **[NC]**.
- **Detalhes internos**: “provavelmente X” aparece marcado como **[I]**; nada foi inventado como se fosse documentado. Nenhum nome de tool foi atribuído a um harness sem confirmação na doc.
- **Datas**: documentações mudam rápido (Codex aposentou `untrusted`; Claude Code migrou docs para `code.claude.com` e comandos para skills). Revalidar antes de implementar.

---

## §10. Referências

**OpenAI Codex**
1. Sandbox — `sandbox_mode`, `approval_policy`, `approvals_reviewer`, plataformas: https://learn.chatgpt.com/docs/sandboxing
2. Permission modes (Ask for approval / Approve for me / Full access): https://learn.chatgpt.com/docs/permission-modes
3. Agent approvals & security: https://learn.chatgpt.com/docs/agent-approvals-security
4. Auto-review (revisor automático de aprovações): https://learn.chatgpt.com/docs/sandboxing/auto-review
5. AGENTS.md (descoberta, merge, limite 32 KiB): https://learn.chatgpt.com/docs/agent-configuration/agents-md
6. Subagents (threads, paralelismo, resumos): https://learn.chatgpt.com/docs/agent-configuration/subagents
7. Hooks (12 eventos, MCP tool hooks, background): https://learn.chatgpt.com/docs/hooks
8. MCP (stdio / Streamable HTTP): https://learn.chatgpt.com/docs/extend/mcp
9. Worktrees + Handoff: https://learn.chatgpt.com/docs/environments/git-worktrees
10. Code review (working tree, commit, base branch): https://learn.chatgpt.com/docs/code-review
11. Build skills (`SKILL.md`, progressive disclosure): https://learn.chatgpt.com/docs/build-skills
12. Codex App Server (embedding): https://learn.chatgpt.com/docs/app-server
37. Codex CLI (visão geral, resume, subagents, `--search`): https://learn.chatgpt.com/docs/codex/cli

**Claude Code**
13. Tools reference (catálogo completo, regras `Tool(specifier)`, LSP, Monitor, PowerShell): https://code.claude.com/docs/en/tools-reference
14. Permission modes (`default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`, gate de plano): https://code.claude.com/docs/en/permission-modes
15. Permissions (allow/ask/deny, workspace trust): https://code.claude.com/docs/en/permissions
16. Checkpointing (snapshots, `/rewind`, limites): https://code.claude.com/docs/en/checkpointing
17. Hooks (eventos de ciclo de vida): https://code.claude.com/docs/en/hooks
18. Subagents (frontmatter, `isolation: worktree`, resume): https://code.claude.com/docs/en/sub-agents
19. Skills (`SKILL.md`, Agent Skills standard, `context: fork`): https://code.claude.com/docs/en/skills
20. Worktrees (isolamento): https://code.claude.com/docs/en/worktrees

**opencode**
21. Agents (primary/subagent, markdown, permissões por agente, LSP): https://opencode.ai/docs/agents/
22. Permissions (allow/ask/deny, wildcards, diretórios externos, auto mode): https://opencode.ai/docs/permissions/
23. Tools (`bash`, `edit`, `write`, `apply_patch`, `skill`, …): https://opencode.ai/docs/tools/
36. Server (headless HTTP/OpenAPI, SDK, ACP support): https://opencode.ai/docs/server/

**Aider**
24. Edit formats (whole, diff, diff-fenced, udiff, architect): https://aider.chat/docs/more/edit-formats.html
25. Repository map (tree-sitter + ranking): https://aider.chat/docs/repomap.html
39. Git integration (auto-commit descritivo, dirty files): https://aider.chat/docs/git.html

**Protocolos e formatos abertos**
26. AGENTS.md (formato aberto, hierarquia, adoção, Agentic AI Foundation): https://agents.md/
27. MCP — especificação 2025-06-18 (JSON-RPC, features, segurança): https://modelcontextprotocol.io/specification/2025-06-18
28. ACP — introdução (editor ↔ agente, stdio/HTTP, diffs): https://agentclientprotocol.com/overview/introduction
29. ACP — session modes: https://agentclientprotocol.com/protocol/v1/session-modes
30. ACP — tool calls (kinds, status, locations, conteúdo de diff): https://agentclientprotocol.com/protocol/v1/tool-calls
31. ACP — agent plan: https://agentclientprotocol.com/protocol/v1/agent-plan
32. ACP — file system (capacidades do cliente): https://agentclientprotocol.com/protocol/v1/file-system
40. Agent Skills (padrão aberto, `SKILL.md`): https://agentskills.io/

**Outros harnesses**
33. Zed — AI agent tools (permissões allow/deny/confirm, profiles, terminal): https://zed.dev/docs/ai/tools
34. Cursor — Agent (rules, subagents, Agent Review, Cloud Agents): https://cursor.com/docs/agent/overview
35. Cline — Plan & Act, checkpoints, auto approve: https://docs.cline.bot/features/plan-and-act
38. OpenHands — agentes (Canvas, CodeAct legacy, Docker, ACP agents): https://docs.all-hands.dev/usage/agents

**Contexto local do Lumina (não é benchmark)**
- `docs/ARCHITECTURE.md` — evento `TurnEvent`, `harness::run_turn`, execução de tools em paralelo (máx. 4) **[H]**.
- `docs/FILES.md` — catálogo atual de tools (`web_search`, `fetch_url`, `create_file`, `validate_ui`, `run_code`, `list_artifacts`, `read_artifact`) **[H]**.
- `docs/goals/chat-code-layout/PLAN.md` — abas `Arquivos`/`Alterações` e o harness de código como próxima fase **[H]**.
- `AGENTS.md` — `cargo` com target dir compartilhado: argumento forte contra escritas concorrentes no mesmo workspace **[H]**.
