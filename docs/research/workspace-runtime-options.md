# Runtime nativo do workspace — viabilidade e decisões técnicas

> **Task**: task-5 — viabilidade de runtime nativo do harness de código do Lumina.
> **Escopo**: decisões de crate/API, maturidade e armadilhas de plataforma para um app local-first Tauri 2 + Rust no **Windows 10 1809+ / Windows 11**. Não é documento de produto/UX.
> **Data da pesquisa**: 2026‑10‑27 (versões e downloads consultados nessa data; ferramenta local: `rustc 1.99.0`, `git 2.55.0.windows.5`).
> **Legenda**: ✅ decisão baseada em documentação/versões verificadas · 🧪 **precisa de spike** antes de virar promessa no plano · ❌ alternativa descartada.

---

## 0. TL;DR — tabela de decisões

| # | Componente | Escolha recomendada (v1) | Alternativa descartada | Por quê (resumo) | Risco principal | Spike? |
|---|---|---|---|---|---|---|
| 1 | **Git** | **CLI do usuário** (`git.exe`) via runner próprio, saída `-z`/`--porcelain=v2`; trait `GitBackend` para permitir backend nativo no futuro | `git2`/libgit2 como backend principal; `gix` como backend principal | Único jeito de ter hooks, filtros, LFS, `core.autocrlf`, credential manager, worktrees e patches exatamente como o usuário espera; zero deps nativas/C; é o que Codex/OpenCode/DSH fazem | `git` ausente/antigo no PATH; parsing de saída e `core.quotepath`; spawn por arquivo em repos grandes | Não para v1 (só testar parsing); 🧪 se futuro backend nativo de leitura |
| 2 | **Watch de arquivos** | `notify` 8 + `notify-debouncer-full` 0.7 por workspace; debounce 200–500 ms; filtro por `.gitignore`/ignore próprio **fora** do watcher; invalidação por evento | Polling; watcher cru sem debounce; watcher por painel | `notify` usa `ReadDirectoryChangesW` no Windows (nativo, barato); debouncer-full pareia renames e coalesce; `ignore` filtra custo | Overflow do buffer do RDCW (eventos descartados → rescan); saves atômicos de editores; OneDrive/antivírus; repos grandes | 🧪 overflow + repos > 50k arquivos |
| 3 | **Shell/terminal** | **`portable-pty` 0.9** (ConPTY) para o terminal interativo + runner de processo comum com captura separada para comandos não interativos; **Job Object** para matar árvore; UTF‑8 incremental no backend; **xterm.js 6** no renderer | winpty; PTY caseiro com `CreatePseudoConsole` direto; `cmd /c` via pipe para o terminal; renderizar ANSI em `<pre>` | ConPTY é a API oficial e é **UTF‑8 + VT sequences**; portable-pty encapsula bem em ~150 KB de código; xterm.js é o padrão de fato | `portable-pty` 0.9 é de fev/2025 (cadência baixa); ConPTY exige Win10 1809+; tree-kill e resize; encoding de programas legados | 🧪 ConPTY real em Win10 1809/1909 + resize + bytes partidos |
| 4 | **Sandbox/permissões** | **Guarda-corpo no harness** (perfis read-only / workspace-write / full-access + approvals + jobs de processo + env saneado + audit log); **nunca prometer “sandbox de SO”** | AppContainer como v1; Windows Sandbox; UAC/`runas`; token restrito sem ACL | Windows não tem sandbox de FS por processo barato como Seatbelt/Landlock; o próprio Codex exige setup elevado/dedicated users para o sandbox nativo | Falsa sensação de segurança; escape trivial via shell; ACL/tokens quebram toolchains | 🧪 **sim, v2**: token restrito + ACL (estilo “unelevated” do Codex) e/ou AppContainer |
| 5 | **File I/O do agente** | Semântica própria: leitura com offset/limit + detecção de encoding/binário (`encoding_rs`+`chardetng`+`infer`, já no repo); escrita **atômica** (`ReplaceFileW`/`MoveFileEx`) com CAS por hash/mtime; edit por **substituição de string única**; checkpoints/backups; diffs com `similar` e patch com `diffy` | Escrever direto (`fs::write`); patch unificado como operação primária; normalizar CRLF sempre | Preserva encoding/EOL/BOM e ACL; evita clobber de edição concorrente; melhor UX de aprovação (diff por arquivo) | Locks/AV/OneDrive quebrando replace; mudança externa entre read e write; perda de BOM/EOL | 🧪 replace com arquivo aberto + arquivos > 10 MB |
| 6 | **Busca** | **Crates do ripgrep** in-process: `ignore` 0.4 + `grep-searcher` 0.1 + `grep-regex` 0.1 + `globset` 0.4 | Invocar `rg.exe`; indexar tudo em FTS5 no v1 | Mesmo motor do rg, sem depender de binário externo, com streaming/cancelamento e respeito a `.gitignore` de graça | API 0.1.x (semver pré‑1.0) → pin exato; custo de varrer repo grande a cada busca | Não (só benchmark em repo grande) |
| 7 | **LSP/diagnósticos (v2)** | v2: **comandos configuráveis de lint/typecheck** (`cargo check --message-format=json`, `tsc --noEmit`, `eslint --format json`) reusando o runner; LSP só se definitions/hover forem requisito | LSP desde a v1; `tower-lsp` como client | LSP é 10× mais caro (spawn, lifecycle, sync, didOpen/didChange) para pouco ganho inicial; `tower-lsp` está parado desde 2023 | Servidores LSP ausentes/versões divergentes; custo de manutenção | 🧪 LSP cliente com `async-lsp` + `lsp-types` |
| 8 | **Progresso/cancelamento** | `tokio` + `tokio_util::sync::CancellationToken` (já usado em `AppState::turns`), Job Objects para processos, `tauri::ipc::Channel` para streams densos, coalescing de 33–50 ms | `emit` global para PTY/search; threads OS ad hoc | Channel é o caminho recomendado pela Tauri para alto throughput; cancelamento já existe no app | Backpressure no PTY (não perder bytes); event storm no renderer | Não |
| 9 | **SQLite** | Manter **rusqlite 0.40 bundled** (não subir para 0.41); migrações aditivas no padrão `ensure_column` do `db.rs`; WAL já ligado; tabelas `harness_*` + `file_checkpoints` + FTS5 (habilitado no bundled) | Bump para rusqlite 0.41 (MSRV 1.89, edition 2024); DB por workspace; ORM | Padrão existente testado; FTS5 disponível sem feature extra; WAL já configurado | Conexão única compartilhada (mutex) vira gargalo com watcher/search; migração sem backup | 🧪 FTS5 `trigram` + índice de histórico |
| 10 | **Interop ACP/MCP (v2)** | MCP client via **`rmcp` 3.8** (transporte child-process/stdio); ACP depois, se houver demanda | Implementar JSON-RPC/Acp à mão; ACP na v1 | `rmcp` é ativo (release semanal) e cobre client/stdio; ACP 3.x ainda muda de major com frequência | Servidores MCP herdam privilégios do app; framing/encoding em stdio; auth | 🧪 MCP stdio + job object + permissões |

**Regra de ouro para o plano**: tudo da coluna “Espike?” só pode aparecer como *“a validar”*, não como entregável fechado. O que é **certo**: CLI de git, ConPTY UTF‑8, Job Objects, RDCW, ReplaceFileW, crates ripgrep, xterm.js, WAL/FTS5 no bundled. O que **não é certo**: sandbox de SO decente no Windows, unicidade de eventos do watcher, estabilidade de API 0.x do gix, LSP barato.

---

## 1. Git (deep)

### 1.1 Necessidades reais do harness

Status por arquivo (staged/unstaged/untracked/ignored/renamed), staging/unstaging, diff unificado por arquivo (com rename), diff por linha/word para o painel, worktrees (`add`/`remove`), branches, commit (com hook), log, blame, apply de patch, leitura de HEAD/índice sem depender do working tree.

### 1.2 As três opções, em números

| | `git` CLI (usuário) | `git2` 0.21 (libgit2) | `gix` 0.90 (gitoxide) |
|---|---|---|---|
| Release/atividade | Git for Windows 2.55 (2026) | 0.21.0 em **2026‑05‑18**; 17,5 M downloads recentes ([crates.io](https://crates.io/crates/git2)) | 0.90.0 em **2026‑10‑22**; 13,0 M downloads recentes ([crates.io](https://crates.io/crates/gix)) |
| MSRV / edition | n/a | não declara; edition 2021 | **1.88 / edition 2024** |
| Custo de build | zero | `libgit2-sys` compila C vendorizado (~1–3 min; precisa de MSVC); **default features = []** → sem OpenSSL (só local) | centenas de crates; build pesado; default features incluem `max-performance`/`comfort`/`basic`/`extras` |
| Cobertura | **tudo**, inclusive hooks/filtros/LFS | status/diff/commit/index/apply/blame/stash/merge/reset/rebase/revwalk; **worktrees só leitura** (`worktrees`, `find_worktree`, `worktree`; não há `worktree_add` na API segura) | `status`, `index_worktree_status`, `diff_tree_to_tree`, `commit`/`commit_as`, `blame_file`, `add_worktree`/`prepare_add_worktree`/`remove_worktree`, `dirwalk`, `write_object`; **sem apply de patch** e **sem staging de alto nível** |
| Hooks | ✅ | ❌ (libgit2 não expõe API de hook — não existe `hook.h` em [`include/git2`](https://github.com/libgit2/libgit2/tree/main/include/git2)) | ❌ |
| Filtros/LFS/autocrlf | ✅ (executa o que está configurado) | ❌ na maioria; filtros parciais | parcial (gix-filter/gix-attributes), não é o mesmo caminho do git |
| Worktrees add/remove | ✅ | ❌ (só listar/abrir) | ✅ (`add_worktree`/`remove_worktree`) |
| Patch apply | ✅ | ✅ (`Repository::apply`) | ❌ |
| Credential manager / SSH do usuário | ✅ | ❌/parcial (precisa implementar) | parcial (`gix-credentials`), configuração diferente |
| Estabilidade de API | estável (porcelain estável) | estável o suficiente (0.21) | 0.x com breaking changes frequentes |

### 1.3 Decisão

**v1: CLI-first.** Um `GitService` que executa `git.exe` com cwd no root do workspace, timeouts, env saneado (`GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `GIT_PAGER=cat`, `LC_ALL=C` quando aplicável) e argumentos fixos. Motivos, em ordem de importância:

1. **Comportamento igual ao do usuário**: commit precisa rodar `pre-commit`/`commit-msg`; `checkout`/`status` precisam respeitar `core.autocrlf`, `.gitattributes`, filtros, LFS, `sparse-checkout`, submódulos e `core.fsmonitor`. Nenhuma lib Rust reproduz isso hoje.
2. **Worktrees completos**: `git worktree add` é requisito e o `gix` só passou a ter `add_worktree` recentemente; o `git2` não tem na API segura.
3. **Zero dependência nativa/C** e zero risco de divergência de versão de libgit2.
4. É o que os pares fazem: Codex, OpenCode e o próprio DSH delegam git ao binário do usuário (e o Codex documenta integração nativa com *git worktrees* como workflow de primeira classe).

**Custo**: 20–60 ms por spawn; em repo grande, `git status` pode levar 100–500 ms. Mitigação: nunca rodar `git status` a cada tecla; cache invalidado por watcher; comandos em background com debounce; `--no-optional-locks` para não bloquear o usuário.

**Alternativa híbrida (considerar só na v2)**: manter CLI para mutações e adicionar `git2 = { version = "0.21", default-features = false }` apenas para leitura contínua (status/diff entre frames do watcher), pois evita spawn storms. **Não** usar `git2` para commit/checkout/patch apply. `gix` só entraria se houvesse requisito de “git nativo sem binário” — e ainda faltaria apply/staging; 🧪 spike obrigatório.

### 1.4 Assinaturas propostas (contrato interno Rust)

```rust
// src-tauri/src/workspace/git.rs  (proposta; módulo novo, não editar código nesta task)
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub root: std::path::PathBuf,
    pub git_dir: std::path::PathBuf,
    pub head: Option<String>,        // branch ou "HEAD" detached
    pub head_sha: Option<String>,    // None em repo sem commits
    pub is_bare: bool,
    pub is_worktree: bool,
}
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitFileState { Unmodified, Modified, Added, Deleted, Renamed, Untracked, Ignored, Conflicted }
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub path: String,             // sempre relativo ao root, separador '/'
    pub orig_path: Option<String>,// rename/copy
    pub staged: GitFileState,
    pub worktree: GitFileState,
    pub binary: bool,
}
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHunk { pub old_start: u32, pub old_lines: u32, pub new_start: u32, pub new_lines: u32,
                      pub header: String, pub lines: Vec<GitDiffLine> }
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffLine { pub kind: String /* " " | "+" | "-" | "\\" */, pub text: String }

pub trait GitBackend: Send + Sync {
    fn discover(&self, start: &std::path::Path) -> anyhow::Result<Option<GitRepoInfo>>;
    fn status(&self, repo: &GitRepoInfo) -> anyhow::Result<Vec<GitStatusEntry>>;
    fn diff(&self, repo: &GitRepoInfo, req: &DiffReq) -> anyhow::Result<Vec<GitHunk>>;
    fn stage(&self, repo: &GitRepoInfo, paths: &[String]) -> anyhow::Result<()>;
    fn unstage(&self, repo: &GitRepoInfo, paths: &[String]) -> anyhow::Result<()>;
    fn commit(&self, repo: &GitRepoInfo, msg: &str, paths: &[String], signoff: bool) -> anyhow::Result<String>;
    fn worktree_add(&self, repo: &GitRepoInfo, path: &str, branch: Option<&str>) -> anyhow::Result<()>;
    fn worktree_remove(&self, repo: &GitRepoInfo, path: &str, force: bool) -> anyhow::Result<()>;
    fn apply_patch(&self, repo: &GitRepoInfo, patch: &str, stage: bool) -> anyhow::Result<()>;
}
```

Comandos Tauri (nomes/assinaturas de contrato): `git_status(workspaceId) -> Result<GitStatus, String>`, `git_diff(workspaceId, path, scope) -> Result<DiffPayload, String>`, `git_stage(workspaceId, paths)`, `git_commit(workspaceId, request) -> Result<GitCommitInfo, String>` etc. (regra do repo: comando Tauri retorna `Result<T, String>`; `#[serde(rename_all = "camelCase")]` no IPC).

### 1.5 Plumbing de CLI (o que realmente importa)

- Status: `git -C <root> -c core.quotepath=false status --porcelain=v2 -z --branch --untracked-files=all` (saída estável e NUL-delimitada; formato documentado em [git-status](https://git-scm.com/docs/git-status#_porcelain_format_version_2)). Parsear tokens, nunca regex de saída legível.
- Diff do painel (barato): `git diff --numstat -z [--cached]` para o resumo; conteúdo sob demanda: `git diff -U3 --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ -- <path>`.
- Staging: `git add -- <paths>` / `git restore --staged -- <paths>` (ou `git reset -q HEAD -- <paths>` em repo sem HEAD).
- Commit: `git commit -F <arquivo-temp>` (evita quoting/encoding de mensagem) — **hooks rodam**, com timeout generoso e captura de stdout/stderr; se não houver `user.name/email`, erro amigável específico.
- Worktrees: `git worktree add <path> [-b <branch>]`, `git worktree remove [--force] <path>`, `git worktree prune`.
- Patch: `git apply --index [--unidiff-zero]` a partir de arquivo temp; nunca passar patch como argv (limite de linha de comando do Windows ~32 KB).
- Env: remover `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` herdados para não vazar repo de outro processo; `GIT_TERMINAL_PROMPT=0` para falhar em vez de abrir prompt; `GIT_OPTIONAL_LOCKS=0` em leituras.
- Windows: Git for Windows vem com `core.autocrlf=true` por padrão; o painel deve mostrar EOL por arquivo e nunca “consertar” EOL por conta própria. Long paths: `-c core.longpaths=true` para repos com caminhos > 260 (ver §12).
- Repo sem commits (HEAD inválido): `status` funciona; `diff HEAD` falha → tratar como “todos os arquivos untracked/added”.
- Submódulos: `--ignore-submodules=none` no status do painel; não recursar dentro de submódulos na busca (o `ignore` já os trata como diretório separado, mas cuidado com `.git` como arquivo).

### 1.6 Riscos e spikes do git

- Risco: `git` ausente → modo degradado explícito (painel de código sem VCS, sem erro fatal) ou oferecer detecção e instrução de instalação (mesmo padrão de `docs/FILES.md` §8.1 para Python/Node).
- Risco: repositório enorme → não rodar status a cada evento do watcher; coalescer (ex.: 250 ms) e medir.
- Risco: hook travado/perguntando → timeout + kill tree + aviso de que o hook falhou (não fingir commit).
- 🧪 Spike: parsing `-z` com renames, paths com acento/espaço, repo sem HEAD, worktree linked, submodule; medir `status` em repo de 50k arquivos.

---

## 2. Watch de arquivos

### 2.1 Escolha e versionamento

- `notify` **8.2.1** (2026‑10‑25, rust 1.85) — no Windows usa `ReadDirectoryChangesW`; backend padrão estável.
- `notify-debouncer-full` **0.7.0** (2026‑05‑02, rust 1.85) — timeout + tick rate, `RecommendedCache` que **pareia eventos de rename** (sem isso, salvar com “save as” vira um delete+create aleatório).
- Filtragem: crate `ignore` **0.4.33** (2026‑08‑04, rust 1.88, edition 2024) com o mesmo `WalkBuilder` da busca, para decidir quais caminhos interessam. O watcher **não** aplica `.gitignore`; ele só entrega eventos — filtrar depois é mais barato do que tentar montar watchers por subárvore já que `ReadDirectoryChangesW` é por handle e recursivo.

```rust
pub struct WatchConfig {
    pub debounce: std::time::Duration,      // 250 ms default; 500 ms em OneDrive
    pub tick_rate: std::time::Duration,     // 100 ms
    pub recursive: notify::RecursiveMode,   // Recursive no root do workspace
    pub max_batch: usize,                   // 512 paths por evento para o renderer
}
pub enum WorkspaceEvent {
    PathsChanged { paths: Vec<String>, kind: String }, // created|modified|removed|renamed|any
    Overflow,                               // RDCW encheu o buffer → rescan completo
    Error(String),
}
pub trait WorkspaceWatcher: Send + Sync {
    fn start(&mut self, root: &std::path::Path, cfg: WatchConfig,
             tx: tokio::sync::mpsc::Sender<WorkspaceEvent>) -> anyhow::Result<()>;
    fn stop(&mut self);
}
```

### 2.2 Fatos do Windows que mudam o desenho

- O `ReadDirectoryChangesW` aloca **um buffer por handle**: se o buffer transborda, a função **retorna sucesso mas descarta todo o conteúdo** e `lpBytesReturned=0` ([docs](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)). Ou seja: overflow **não é erro**, é “perdeu tudo” → o handler precisa detectar isso e **reenumerar** o workspace (marcar `dirty_all=true`).
- A operação **pode não existir para o FS alvo** (network redirector/SMB); nesse caso o watcher falha → cair para `PollWatcher` (polling de mtime) ou desligar o watch naquele root ([docs](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)).
- Renames vêm como pares de eventos (old/new), e editores fazem save atômico = write temp + rename; o cache do debouncer-full resolve a maior parte, mas o painel deve tratar “arquivo sumiu e voltou” como modified, não delete+create.
- Não watcher recursivo dentro de `.git/objects`, `node_modules`, `target`, `.venv` etc. O watcher é recursivo por definição; o **filtro pós-evento** descarta esses prefixos. Para `.git`, observar apenas `HEAD`, `index`, `refs/**` (mudanças feitas pelo próprio git CLI precisam invalidar o status).
- Custo: watching é barato (um handle + buffer), mas **eventos** em repo grande podem ser milhares/segundo durante `cargo build`/`npm install` → debounce + cap por batch + filtro por prefixo ignorado.

### 2.3 Integração com o painel de arquivos/diff

Fluxo proposto: watcher → `mpsc` → “coalescer” (janela de 250–500 ms, dedupe por path) → emite 1 evento `workspace://fs` com lista de paths → renderer invalida árvore/diff; se `git` habilitado, agenda `git status` (debounce maior, 750 ms) e compara com o último snapshot. Nunca emitir um evento por arquivo: o event system da Tauri não é para alto throughput ([Tauri docs](https://v2.tauri.app/develop/calling-frontend/)).

### 2.4 Riscos e spikes

- 🧪 Overflow: gerar > 16k mudanças (ex.: `npm ci` em repo de teste) e validar que o `Overflow`/rescan não trava a UI.
- 🧪 Repo grande (> 50k arquivos) + `target/` ativo; medir latência do status após build.
- Risco: OneDrive/Drive sincronizando workspace (eventos em cascata, placeholders) → detectar root em pasta sincronizada e sugerir exclusão/ajustar debounce.
- Risco: path case-insensitive → dedupe com `dunce::simplified`/lowercase para comparação, mas mostrar o caminho canônico com a caixa real do disco.

---

## 3. Shell e terminal (deep)

### 3.1 Decisão

1. **Terminal interativo**: `portable-pty` **0.9.0** (2025‑02‑11; 14,3 M downloads recentes, [crates.io](https://crates.io/crates/portable-pty)) sobre **ConPTY**. No Windows o backend da crate é literalmente `win::conpty::ConPtySystem` — **não há fallback winpty**, então o requisito é Win10 1809+.
2. **Comandos não interativos do agente** (`run_command`): processo comum com pipes separados (como `code_exec.rs` já faz), **Job Object** para árvore, e decodificação tolerante; não usar PTY para comandos não interativos (PTY mistura stdout/stderr, adiciona renderização e resize desnecessários).
3. **Frontend**: `@xterm/xterm` **6.0.0** (2025‑12‑22) + `@xterm/addon-fit` 0.11 + `@xterm/addon-webgl` 0.19; fallback automático se o WebGL context falhar (WebView2 suporta WebGL, mas máquinas virtualizadas/remote desktop podem derrubar).

> Por que não implementar ConPTY direto com o crate `windows`: são ~400–600 linhas de FFI (`CreatePseudoConsole`, `UpdateProcThreadAttribute`, pipes, `STARTUPINFOEX`, resize, close, leitura de handles), mais manutenção de structs e `Send`/threads. O `portable-pty` já entrega tudo isso com API pequena; a alternativa é o escape hatch (§3.6), não o plano A.

### 3.2 API do `portable-pty` (0.9, verificada no código-fonte)

```rust
pub fn native_pty_system() -> Box<dyn PtySystem + Send>;
pub trait PtySystem { fn openpty(&self, size: PtySize) -> anyhow::Result<PtyPair>; }
pub struct PtyPair { pub master: Box<dyn MasterPty + Send>, pub slave: Box<dyn SlavePty + Send> }
pub trait MasterPty {
    fn resize(&self, size: PtySize) -> Result<(), Error>;
    fn try_clone_reader(&self) -> Result<Box<dyn std::io::Read + Send>, Error>;
    fn take_writer(&self) -> Result<Box<dyn std::io::Write + Send>, Error>;
    // no Windows: get_size / process_group_leader / tty_name retornam None
}
pub trait SlavePty { fn spawn_command(&self, cmd: CommandBuilder) -> Result<Box<dyn Child + Send + Sync>, Error>; }
pub trait Child { fn try_wait(&mut self) -> IoResult<Option<ExitStatus>>; fn wait(&mut self) -> IoResult<ExitStatus>;
                  fn process_id(&self) -> Option<u32>; fn as_raw_handle(&self) -> Option<RawHandle>; }
pub trait ChildKiller { fn kill(&mut self) -> IoResult<()>; fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync>; }
```

`CommandBuilder` tem `new(programa)`, `.args([...])`, `.env(k,v)`, `.cwd(path)`, `.size(PtySize)`. `ExitStatus` expõe `.exit_code()`/`.success()`.

### 3.3 ConPTY: o que é certo

- **ConPTY existe desde Windows 10 versão 1809** (build 17763) e é “desktop apps only” ([CreatePseudoConsole](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole)).
- O stream de entrada e saída do pseudo console é **texto simples intercalado com Virtual Terminal Sequences, codificado em UTF‑8** ([CreatePseudoConsole](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole)) — portanto o backend **não precisa** decodificar CP850 no PTY; UTF‑8 é o contrato. (Programas legados que escrevem em console COM `WriteConsole` têm o texto convertido pelo conhost para o stream UTF‑8.)
- O host deve **servir os dois canais (in/out) em threads separadas**, senão deadlock quando um buffer enche ([guia da MS](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session)); o mesmo vale no nosso runner: reader de saída nunca pode bloquear o writer de input.
- Resize: `ResizePseudoConsole`; no `portable-pty`, `MasterPty::resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })`. Sem resize, apps TUI quebram e `git log`/`vim` desenham torto.

### 3.4 Morte de árvore, timeout e cancelamento (Job Objects)

`taskkill /T /F` (o que `code_exec.rs` usa hoje) funciona como fallback, mas é um processo externo (AV pode bloquear, mensagens localizadas, não funciona em filho elevado, latência). O caminho correto:

1. `CreateJobObjectW`; `SetInformationJobObject(JobObjectExtendedLimitInformation)` com `LimitFlags |= JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` → fechar o último handle do job mata **todos** os processos associados ([JOBOBJECT_EXTENDED_LIMIT_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)). Opcional: `JOB_OBJECT_LIMIT_JOB_MEMORY`, `JOB_OBJECT_LIMIT_ACTIVE_PROCESS`, `JOB_OBJECT_LIMIT_PROCESS_MEMORY` (limites podem ser silenciosamente ignorados, não são cota rígida útil).
2. Criar processo **suspenso** (`CREATE_SUSPENDED`), `AssignProcessToJobObject`, depois `ResumeThread` (via `OpenThread(THREAD_SUSPEND_RESUME)`) — evita a corrida de o filho criar netos antes do assign. Alternativa: `PROC_THREAD_ATTRIBUTE_JOB_LIST` no `STARTUPINFOEX` (Win10+), ainda mais limpo, mas exige montar o `CreateProcess` na mão.
3. Cancelamento/timeout: `CancellationToken` (`AppState::turns`) → `TerminateJobObject` (ou fechar o handle com KILL_ON_JOB_CLOSE) → drenar readers → reportar `cancelled/timeout`.
4. Filhos que fogem do job: não usar `JOB_OBJECT_LIMIT_BREAKAWAY_OK`/`SILENT_BREAKAWAY_OK`; jobs aninhados existem desde Windows 8, mas se outro job do sistema já contiver o processo, o assign pode falhar (`ERROR_ACCESS_DENIED`) — tratar e cair no `taskkill /T` como fallback.

```rust
pub struct ProcessSpec {
    pub program: std::path::PathBuf,
    pub args: Vec<String>,
    pub cwd: std::path::PathBuf,
    pub env: std::collections::BTreeMap<String, String>, // allowlist + herança saneada
    pub timeout: std::time::Duration,
    pub capture: CaptureLimits,                         // stdout/stderr separados, teto + cauda
}
pub struct ManagedChild {
    pub pid: u32,
    pub job: winsafe_job::JobHandle,     // wrapper próprio sobre CreateJobObject
    pub cancel: tokio_util::sync::CancellationToken,
}
pub trait ProcessRunner: Send + Sync {
    async fn run(&self, spec: ProcessSpec) -> anyhow::Result<ProcessOutcome>;
    fn spawn_pty(&self, spec: PtySpec, sink: tokio::sync::mpsc::Sender<Vec<u8>>)
        -> anyhow::Result<PtySession>;   // bytes crus; decodificação incremental no adaptador
}
```

### 3.5 Encoding no Windows

- **Terminal (ConPTY)**: UTF‑8 garantido pelo ConPTY, mas **bytes podem ser partidos no meio de um caractere** entre leituras. Decodificar com `encoding_rs::UTF_8.new_decoder_without_bom_handling()` mantendo estado (`decode_to_string(..., last=false)`) e enviar `String` ao renderer; nunca `String::from_utf8_lossy` por chunk (gera `�` espalhado no meio de acentos e emojis).
- **Comandos não interativos**: `stdout`/`stderr` podem vir em CP850/CP1252/CP932 quando o programa escreve em console legado. Estratégia: (1) forçar UTF‑8 quando possível (`PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`, `NODE_NO_WARNINGS=1` — já no `code_exec.rs`); (2) BOM → encoding explícito; (3) `chardetng` + `encoding_rs` com report de encoding detectado; (4) `String::from_utf8_lossy` só como último recurso e marcando `decodedLossy: true` no resultado para o modelo/UI.
- **Shell**: PowerShell 5.1 (`powershell.exe`) tem `[Console]::OutputEncoding` OEM/ANSI por padrão; para não depender do usuário, definir no perfil injetado: `$OutputEncoding = [Text.Encoding]::UTF8; [Console]::OutputEncoding = [Text.UTF8Encoding]::new()` (pwsh 7 já tende a UTF‑8). Para comandos não interativos no PowerShell, usar `-EncodedCommand` (base64 UTF‑16LE) em vez de argumento `-Command` — elimina bugs de quoting e de code page do argv. No `cmd.exe`, quoting é um poço: preferir `cmd /d /s /c` com comando passado por arquivo `.cmd` temporário ou stdin.
- Arquivos `.ps1` sem BOM são lidos como ANSI pelo PowerShell 5.1 → ou gravar com BOM, ou usar `-EncodedCommand`, ou exigir pwsh 7.

### 3.6 Frontend do terminal

- `@xterm/xterm` 6 com `addon-fit` (resize no `ResizeObserver` do container), `addon-webgl` (fallback para DOM se `onContextLoss`), `scrollback: 10_000`, `convertEol: false`, `allowProposedApi: false`.
- Fluxo de bytes: backend Channel → `term.write(string)`; entrada: `term.onData` → comando Tauri `pty_write` (sem ruído de approval por tecla). Clipboard: `ctrl+c/v` do terminal precisa de `attachCustomKeyEventHandler` para não colidir com o atalho global de copiar do app.
- Não renderizar ANSI em `<pre>`: o agente executará `cargo`, `npm`, `git` e TUIs; sem interpretador de VT o log fica ilegível. Custo: xterm + addons ~ 300 KB no bundle (carregado sob demanda).
- Segurança: o terminal é execução arbitrária com permissões do app; deve estar atrás de approval explícito na v1 (ver §4).

### 3.7 Riscos e spikes

- 🧪 `portable-pty` 0.9 em Win10 1809/1909 (não só Win11): ConPTY ok? resize durante `vim`? `Ctrl+C` (`0x03`) chega ao filho?
- 🧪 bytes partidos: `printf 'ção 🚀'` em loop no PTY e validar que o decoder incremental não corrompe.
- Risco: `portable-pty` em modo manutenção (última release fev/2025) — encapsular atrás da interface `PtySession` para trocar por FFI própria sem tocar no harness.
- Risco: WebGL no WebView2 em máquina virtual/remote desktop → fallback precisa ser testado.
- Risco: árvore de processos com `cargo`/`npm` que sobem daemons → Job Object é obrigatório; sem ele o “parar” deixa lixo rodando.

---

## 4. Sandbox e permissões (deep)

### 4.1 O que é honesto prometer

**Não é honesto prometer “sandbox de SO” no v1 do Lumina em Windows.** Diferente de macOS (Seatbelt, `sandbox_init` + perfis) e Linux (Landlock + seccomp, usado também com bubblewrap — o Codex exige `bwrap` no Linux, [docs](https://developers.openai.com/codex/sandboxing)), o Windows não oferece contenção de filesystem por processo sem AppContainer ou filter driver. A própria OpenAI só entrega sandbox nativo no Windows com três implementações e setup específico ([Windows sandbox](https://developers.openai.com/codex/windows/windows-sandbox)):

- **MXC** (preferido em dispositivos compatíveis): isolamento de processo nativo, **sem setup aprovado por administrador**;
- **elevated** (fallback clássico): usuários de sandbox dedicados de baixo privilégio, regras de firewall, mudanças de política local — **setup com admin**;
- **unelevated** (fallback fraco): **token restrito do usuário atual + ACLs de filesystem**, sem deny-read e com isolamento de rede fraco.

Ou seja: o “estado da arte” no Windows é (a) isolamento proprietário/novo ou (b) token restrito + ACL, com custo alto e trade-offs. Um app local-first instalado por usuário comum não deve reproduzir isso na v1.

### 4.2 Decisão v1 — guarda-corpo no harness (não é sandbox)

Modelo de **perfis de permissão** + approvals, aplicado nas tools (não no SO):

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionProfile {
    ReadOnly,        // lê workspace; sem escrita, sem shell
    WorkspaceWrite,  // escreve só dentro do root canônico; shell com approval por comando
    FullAccess,      // tudo (equivalente ao app hoje) — opt-in explícito
}
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest { pub tool: String, pub paths: Vec<String>, pub command: Option<String>,
                               pub reason: String, pub risk: RiskLevel }
pub trait ApprovalBroker: Send + Sync {
    async fn request(&self, req: PermissionRequest) -> anyhow::Result<ApprovalDecision>; // Once|Session|Deny
}
```

Regras duras do v1 (implementáveis e testáveis):

1. **Path policy**: `root` canônico em `AppState` por workspace; todo path de tool é canonicalizado (`dunce::canonicalize`, que remove `\\?\`) e comparado por prefixo de componente — rejeitar `..`, paths absolutos fora do root, UNC/device (`\\?\GLOBALROOT`, `\\.\`), ADS (`file.txt:stream`) e nomes reservados (`CON`, `NUL`, `COM1`…). Symlink/junction: resolver antes (`fs::canonicalize`) e checar o alvo; não seguir link para fora do root (Windows: junctions são fáceis de criar sem admin).
2. **Deny-list de paths sensíveis** (mesmo em FullAccess, aviso): `<app-data>` (contém DB/tokens), `%USERPROFILE%\.ssh`, `%USERPROFILE%\.aws`, `%APPDATA%\Microsoft\Credentials`, `.git/config` com `url.insteadOf` (credential leak), `*.pem`/`*.key` fora do workspace.
3. **Env saneado** (padrão `code_exec.rs`): remover `*API_KEY*`, `*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `GIT_ASKPASS`, `SSH_AUTH_SOCK` (não existe no Windows), e nunca injetar chaves do app; `cmd.exe`/`powershell` herdam perfis do usuário (paths, aliases), o que é desejado.
4. **Aprovação por comando**: allowlist de comandos triviais (`git status`, `git diff`, `ls`, `dir`, `cargo check`, `npm test`… ainda assim sem auto-approve da primeira vez) + botão “permitir nesta sessão”; bloqueio de padrões claramente destrutivos (`format`, `diskpart`, `reg delete`, `Set-ExecutionPolicy`, `Remove-Item -Recurse` fora do root, `rm -rf /`, `git push --force`, `curl … | iex`, `certutil -urlcache`) — **heuristicamente, como UX, não como segurança**.
5. **Job Object em todo processo** (§3.4), timeout, teto de saída, teto de CPU/memória, `CREATE_NO_WINDOW` quando não interativo, prioridade `BELOW_NORMAL`.
6. **Audit log** persistido (tabela `approvals`/`audit_events` no SQLite) com tool, paths, comando, decisão e timestamp — sem segredos.
7. **UI honesta**: texto explícito de que é “proteção contra engano/acidente, não contenção de código malicioso”; `FullAccess` precisa de confirmação digitada/checkbox, nunca default.

Isso é consistente com o que o Lumina já declara para `run_code` (`docs/FILES.md` §8.3: “não é um sandbox de SO”), e com o DSH, cujas sessões rodam sob um *file sandbox policy* declarado (read-only / workspace-write / danger-full-access) + approvals — ou seja, controle no harness, com limitações assumidas.

### 4.3 Opções nativas: avaliação técnica

| Opção | Como funciona | Prós | Contras / por que não v1 |
|---|---|---|---|
| **Job Objects** | `CreateJobObject` + limites + `TerminateJobObject`; filhos herdam; jobs aninhados desde Win8 ([Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)) | barato, confiável, resolve tree-kill/limites | **não isola filesystem/rede**; é controle de processo, não sandbox |
| **Token restrito** (`CreateRestrictedToken`, `DISABLE_MAX_PRIVILEGE`/`LUA_TOKEN`) | remove privilégios de admin do token | trivial de implementar; impede escrita em áreas administrativas | usuário comum já não é admin; **não separa arquivos do usuário**; combina com ACL (ver abaixo) mas quebra ferramentas |
| **Token restrito + ACLs** (estilo “unelevated” do Codex) | token derivado + ACLs concedendo só o workspace; deny-read onde possível | sem admin; caminho conhecido | negar leitura exige ACL por path/glob (lento, frágil); muitos dev tools precisam de `%APPDATA%`, `%TEMP%`, registry, npm cache → quebra; rede fica sem isolamento real; **spike obrigatório** |
| **AppContainer** (`CreateAppContainerProfile`, `SECURITY_CAPABILITIES`, ACL por SID do container) | processo em container com capabilities explícitas; isolamento de credencial, dispositivo, arquivo, rede e processo ([AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)) | é o mecanismo “de verdade” do Windows; rede/FS/credenciais controláveis | processo precisa ser lançado com token/atributo de segurança; **não acessa `%USERPROFILE%`/registry do usuário** por padrão; loopback bloqueado por padrão; caches de toolchain quebram; conceder ACL recursiva no workspace é caro; COM/instaladores falham; documentação esparsa para apps desktop. **spike de 1–2 semanas, v2+/v3** |
| **Windows Sandbox** | VM descartável com Hyper‑V; requer **Pro/Enterprise/Education**, sem software do host, FS compartilhado via mapeamento ([docs](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-overview)) | isolamento forte | ❌ inviável como runtime do app: VM nova a cada sessão, sem toolchain do usuário, não interage com o workspace de forma transparente |
| **`runas`/UAC** | elevação | — | ❌ aumentar privilégio é o oposto do objetivo; quebra single-instance/drag&drop e assusta o usuário |
| **Windows Filtering Platform / firewall por processo** | bloqueio de rede por PID | complementa sandbox | requer admin para regras; ❌ v1 |

### 4.4 Comparação com o que existe

- **macOS**: Seatbelt é o padrão (Codex usa; Claude Code oferece sandbox opcional). Perfil declarativo, barato, filesystem+rede no mesmo mecanismo.
- **Linux**: Landlock (FS) + seccomp (syscalls); Codex exige `bubblewrap` instalado ([Codex sandboxing](https://developers.openai.com/codex/sandboxing)).
- **Windows**: sem equivalente nativo de Seatbelt/Landlock; Codex teve de construir três implementações e ainda recomenda MXC “em dispositivos compatíveis”, com fallback elevado que exige admin. Conclusão para o plano: **não copiar a promessa do Codex**; copiar o modelo de *permission profiles + approvals*, que é o que o usuário realmente percebe.

### 4.5 Spikes (§4)

- 🧪 **S1 (v2, barato)**: token restrito do usuário + Job Object rodando `git status`, `node -v`, `cargo check` num workspace com ACL concedida. Medir o que quebra (npm cache, `%APPDATA%`, registry) e documentar.
- 🧪 **S2 (v2/v3, caro)**: AppContainer: criar profile, lançar `cmd.exe` com `SECURITY_CAPABILITIES`, conceder ACL só no root, medir acesso a `%TEMP%`, git (precisa de `HOME`/config), node/npm, python, rede (localhost + internet com capability). Critério de corte: se < 60% dos comandos comuns funcionarem, abandonar.
- 🧪 **S3**: denylist de leak de credenciais (ler `~/.ssh` e `%APPDATA%`) — garantir erro claro, não crash.

---

## 5. File I/O do agente (deep)

### 5.1 Leitura

- Contrato: `offset` (linha 1-based) + `limit` (linhas, default 2000, máx 4000) e/ou bytes; sempre devolver `totalLines`, `truncated`, `encoding`, `eol`, `sha256`, `mtime`, `size`. Ler com `BufReader` e parar cedo; **nunca** `read_to_string` sem teto (arquivo/binário de 2 GB derruba o app).
- Detecção de binário: (a) byte `0x00` nos primeiros 8 KB → binário; (b) `infer::get` (já no repo) para magic; (c) heurística de proporção de bytes de controle. Binário → não editar; devolver tipo/mime/tamanho e oferecer preview (o app já tem `documents::preview`).
- Encoding: BOM UTF‑8/UTF‑16LE/BE primeiro; senão tentar UTF‑8 estrito; senão `chardetng::EncodingDetector` (até 64 KB) + `encoding_rs::Encoding::decode`. Reportar `encoding` e `lossy`. UTF‑16 sem BOM em arquivo de código é raro; tratar BOM UTF‑16 como preserve-on-write.
- EOL: detectar CRLF vs LF (contagem); devolver `eol: "crlf"|"lf"|"mixed"`. Conteúdo enviado ao modelo e usado em edits é **normalizado para `\n`** (hashes e offsets em “linhas lógicas”), e a escrita **reaplica o EOL original** por padrão. Isso evita que um “edit” simplesmente converta um arquivo CRLF inteiro (diff gigante).
- Paths: canonicalizar (`dunce`), validar policy (§4), tratar case-insensitivity: para lookup/dedupe usar comparação case-fold, mas preservar a caixa real; `read` de diretório → erro claro; arquivo > 10 MB → exigir `range`/`offset` (ou negar para o modelo com mensagem).
- Arquivos com lock exclusivo (Excel/Word abertos): `File::open` com `FILE_SHARE_READ` funciona na maioria; em falha de sharing, mensagem específica (“arquivo em uso por outro programa”), não erro genérico.

### 5.2 Escrita atômica (Windows)

Algoritmo obrigatório (nunca `fs::write` direto em arquivo existente):

1. Validar policy + CAS (`sha256`/`mtime`/`size` do snapshot lido; se mudou → `Conflict`, oferecer 3‑way).
2. Criar temp **no mesmo diretório** (`tempfile::Builder::new().prefix(".lumina-").tempfile_in(dir)`), escrever bytes, `flush`, `sync_all` (opcional em SSD; em HDD ajuda durabilidade; `sync_all` custa ~ms).
3. Fechar handles; se destino existe → `ReplaceFileW(dest, temp, backup: None, REPLACEFILE_IGNORE_MERGE_ERRORS, …)`, que **preserva atributos e ACLs** do original ([ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)); se não existe → `MoveFileExW(temp, dest, MOVEFILE_REPLACE_EXISTING)` ([MoveFileEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)).
4. Retry com backoff (5 tentativas, 20–200 ms) em `ERROR_SHARING_VIOLATION`/`ERROR_LOCK_VIOLATION` (antivírus/indexer/IDE relendo); se persistir → `Locked` amigável.
5. Nunca escrever através de symlink/junction sem resolução explícita; preservar `FILE_ATTRIBUTE_READONLY`? Se readonly → pedir confirmação para limpar.
6. FS sem suporte a replace atômico (FAT/exFAT, alguns shares SMB): `ReplaceFileW` pode falhar → fallback `fs::rename` (não atômico) e reportar `atomic: false`.

```rust
#[serde(rename_all = "camelCase")]
pub struct FileSnapshot { pub path: String, pub sha256: String, pub size: u64, pub mtime_ms: i64,
                          pub encoding: String, pub eol: String, pub bom: bool, pub total_lines: u64 }
#[serde(rename_all = "camelCase")]
pub struct ReadFileRequest { pub workspace_id: String, pub path: String,
                             pub offset: Option<u64>, pub limit: Option<u64>, pub max_bytes: Option<u64> }
#[serde(rename_all = "camelCase")]
pub enum WriteOutcome { Written { snapshot: FileSnapshot, checkpoint: String },
                        Conflict { current: FileSnapshot }, Locked { retries: u8 }, Denied { reason: String } }
pub struct CheckpointId(pub String); // arquivo em <app-data>/workspace-checkpoints/<workspace>/<seq>-<hash>
```

### 5.3 Edit: string-replace vs patch unificado

- **Primário: substituição de string** (`old_string` → `new_string`), com `replace_all: bool` e exigência de **match único** quando `replace_all=false`. É o que modelos fazem bem, é determinístico e não depende de contexto de diff desatualizado. Erros claros: não encontrado (mostrar busca aproximada), múltiplos matches (pedir mais contexto), idêntico (no-op).
- **Diff unificado** só como *input opcional*: aplicar com `diffy::apply` (fuzz 0) e rejeitar se qualquer hunk não casar; nunca usar `patch.exe` (dependência externa, EOL, paths).
- Múltiplos edits no mesmo turno: aplicar em sequência sobre o buffer em memória, validar cada um, gravar **uma** vez (atômico) ao final; se um falhar, nada é gravado. Guardar checkpoint do conteúdo original.
- Gerar diff para a UI/approval com `similar` (linhas + chars para intra-line): nunca pedir approval sem diff legível.
- 3‑way: se o arquivo mudou desde o snapshot (`Conflict`), usar `diffy::merge` (base = snapshot lido, ours = disco, theirs = edição do agente) e:
  - sem sobreposição → aplicar automaticamente e reportar `merged: true`;
  - com conflito → devolver marcadores ao modelo/UI e **não** gravar até resolução.
- Checkpoints: antes de cada escrita, salvar o conteúdo original em `<app-data>/workspace-checkpoints/...` + linha em `file_checkpoints`; permitir “desfazer” por arquivo e por turno; podar por idade/tamanho (ex.: 7 dias / 200 MB). Isso substitui “git stash” para usuários sem git.

### 5.4 Riscos e spikes

- 🧪 Arquivo aberto no Excel/VS Code: validar política de retry e mensagem.
- 🧪 Arquivo CRLF + BOM: read→edit→write e conferir que **só** a linha editada mudou no `git diff`.
- 🧪 OneDrive: pasta sincronizada pode reidratar/renomear; testar write atômico.
- Risco: `ReplaceFileW` requer que o destino exista e esteja no mesmo volume; fallback bem testado.
- Risco: hashing SHA‑256 de todo arquivo lido custa CPU em arquivos grandes; limitar a 256 KB por snapshot ou usar `xxh3` para CAS + SHA para checkpoint (avaliar; `sha2` já é dep).

---

## 6. Busca (deep)

### 6.1 Decisão: crates do ripgrep in-process

| Crate | Versão (data) | Papel |
|---|---|---|
| `ignore` | **0.4.33** (2026‑08‑04) | walker paralelo com `.gitignore`/`.ignore`/global/exclude; `filter_entry`; `WalkBuilder::build_parallel` |
| `grep-searcher` | **0.1.17** (2026‑07‑15) | motor de busca (contexto, line numbers, multiline, binary detection, mmap, encoding/BOM) |
| `grep-regex` | **0.1.14** (2025‑10‑16) | matcher regex (case, word, fixed strings, `line_terminator`) |
| `globset` | **0.4.20** (2026‑08‑04) | globs de include/exclude e busca de arquivos por nome |

Por que não `rg.exe`: (1) dependência externa (usuário raramente tem; bundlar aumenta o instalador e adiciona licença/unzip); (2) precisaríamos parsear `--json` (estável, mas mais uma camada); (3) perderíamos cancelamento por arquivo e streaming tipado; (4) as crates são o **mesmo motor**, mantidas pelo mesmo autor do ripgrep. Risco: versões `0.1.x` (semver pré‑1.0) → pinar versões exatas no `Cargo.toml` (`=0.1.17` etc.) e revisar em upgrades.

### 6.2 Desenho

```rust
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub workspace_id: String,
    pub pattern: String,
    pub mode: SearchMode,              // Regex | Literal | Word | FilesByName
    pub case_sensitive: bool,
    pub include_globs: Vec<String>,    // "*.rs", "src/**"
    pub exclude_globs: Vec<String>,    // além de .gitignore/.ignore/.luminaignore
    pub max_results: usize,            // 500 default, 5000 máx
    pub context_lines: u8,             // 0..=5
    pub multiline: bool,
}
#[serde(rename_all = "camelCase")]
pub enum SearchEvent {
    Batch { results: Vec<SearchMatch> }, // coalescer 50-100 resultados
    Progress { files_scanned: u64 },
    Done { truncated: bool, files_scanned: u64, duration_ms: u64 },
    Cancelled,
    Error { message: String },
}
#[serde(rename_all = "camelCase")]
pub struct SearchMatch { pub path: String, pub line: u64, pub column: u64,
                         pub line_text: String, pub context_before: Vec<String>,
                         pub context_after: Vec<String>, pub is_binary: bool }

pub trait FileSearcher: Send + Sync {
    fn search(&self, root: &std::path::Path, req: SearchRequest,
              sink: tokio::sync::mpsc::Sender<SearchEvent>,
              cancel: tokio_util::sync::CancellationToken) -> anyhow::Result<()>;
}
```

Regras: `WalkBuilder` com `hidden(false)` (mostrar dotfiles que não estão ignorados — comportamento do editor), `git_ignore/git_global/git_exclude(true)`, `parents(true)`, `add_custom_ignore_filename(".luminaignore")`, `max_filesize(Some(10 MiB))`, `threads(0)` no walker (auto) mas **busca** em pool próprio (`num_cpus - 1`, cap 8); `grep-searcher` com `line_number(true)`, `before_context/after_context`, `multi_line(false)` default, `binary_detection(BinaryDetection::quit(b'\x00'))`, `memory_map(true)` só para arquivos > 1 MB; `Sink` envia matches por `mpsc` (nunca acumular tudo), checa `cancel.is_cancelled()` a cada arquivo/linha; erro por arquivo (permissão, link quebrado) é não-fatal e agregado em `errors`.
- Ordenação: por path (natural) + linha; sem ranking semântico no v1 (modelo lê e decide).
- Files by name: `globset::GlobSetBuilder` sobre o walker com o mesmo filtro de ignore.
- Símbolos/histórico: v2 opcional com FTS5 (§9) alimentado por índice incremental; a busca por conteúdo continua on-demand (índice de código envelhece rápido e custa caro).
- Performance: repo médio (5–20k arquivos) tende a < 300 ms; repo grande (100k+) com `target/` ignorado fica dominado por IO. Medir, não prometer.

### 6.3 Spikes/riscos

- Benchmark em repo grande real (ex.: o próprio Lumina após `pnpm install` + `cargo build`): tempo, memória, comportamento com `target/` ignorado.
- Cancelamento: garantir < 100 ms entre clique em “parar” e `Cancelled`.
- Caminhos `\\?\` (dunce), case-insensitive, e arquivos com nomes não‑UTF8 (Windows permite UTF‑16 inválido em nomes? raro; tratar `Path` lossy na UI e erro claro).
- Glob include/exclude deve usar `/` no padrão e normalizar `\` do Windows na entrada.

---

## 7. LSP e diagnósticos (v2, opcional)

- `lsp-types` **0.97.0** (jun/2024 — estável mas **sem release há ~2 anos**); `async-lsp` **0.2.4** (abr/2026; features `client-monitor`, `stdio`, `omni-trait`); `tower-lsp` **0.20.0** (ago/2023 — praticamente parado, evitar como base nova).
- Recomendação: **não** colocar LSP na v1. Diagnósticos baratos primeiro:
  - `cargo check --message-format=json` (parse de `compiler-message` → severity/message/spans);
  - `tsc --noEmit --pretty false` (parse de linhas `file(line,col): error TSxxxx`);
  - `eslint --format json`, `ruff check --output-format json`, `pyright --outputjson` — cada um com parser dedicado e timeout.
  Isso cobre 80% do valor (erros no painel/diff) reusando o runner e sem ciclo de vida de servidor.
- Se definitions/hover/completion forem requisito: client LSP com `async-lsp` (não implementar JSON-RPC à mão), spawn do server via pipes (não PTY), `Content-Length` framing, lifecycle `initialize/initialized/shutdown/exit`, `didOpen`/`didChange` incremental (ou full sync para simplificar), e **mesma política de permissões** do shell (é um processo do usuário). Servers: `typescript-language-server`, `rust-analyzer`, `pyright-langserver` — detectar no PATH e configurar por workspace (mesmo padrão `settings.code_*`).
- Custo real: 2–4 semanas + manutenção contínua (versões de server, capacidades divergentes, crashes). 🧪 spike com `rust-analyzer` num workspace pequeno antes de prometer.

---

## 8. Progresso, cancelamento e concorrência

- **Já existe** no app: `AppState::turns: Mutex<HashMap<String, tokio_util::sync::CancellationToken>>`; `tokio-util` com feature **`rt`** é exatamente o que habilita `CancellationToken` (verificado no fonte: `#[cfg(feature = "rt")] pub mod sync;`). Não é preciso dep nova.
- Processos: todo `ProcessSpec`/`PtySession` recebe o token do turno **e** um timeout absoluto; `tokio::select!` entre `wait`, timeout e `cancel.cancelled()`; ao cancelar: `TerminateJobObject` → drenar readers → `start_kill` de fallback.
- Limites: CPU prioridade `BELOW_NORMAL` (`SetPriorityClass` no job), memória via job (`JOB_OBJECT_LIMIT_PROCESS_MEMORY`/`JOB_MEMORY` — nota: o SO pode ignorar silenciosamente se não puder aplicar, então tratar como best-effort), teto de saída (padrão existente: 64 KB com cauda) e teto de arquivos escritos pelo comando.
- Streaming para o renderer:
  - Use **`tauri::ipc::Channel<T>`** por sessão para PTY/search/diff incremental — o event system global é explicitamente “não desenhado para baixa latência/alto throughput” ([Tauri](https://v2.tauri.app/develop/calling-frontend/)).
  - **Coalescing**: PTY → flush no máximo a cada ~16 ms ou 8 KB; search → batches de 50–100 matches a cada ~50 ms; progresso → no máximo 10 Hz.
  - **Backpressure PTY**: canal `tokio::sync::mpsc::channel(256)` com `send().await` no reader ⇒ se a UI travar, o pipe do ConPTY enche e o filho bloqueia (perda zero de bytes). Nunca `try_send` + drop em terminal. Para search, política oposta: truncar e finalizar com `truncated: true`.
  - Limites de payload do IPC: PTY em `String` (UTF‑8 decodificado incrementalmente) ou bytes base64; evitar `Vec<u8>` cru (vira array JSON).
- Estado por workspace: `Mutex<HashMap<String, WorkspaceRuntime>>` em `AppState` (sem segurar o mutex durante await — clonar `Arc`/token e soltar). `parking_lot` para estado curto; `tokio::sync` quando cruzar await.

---

## 9. SQLite (banco)

- **Manter `rusqlite 0.40` bundled** (não subir para 0.41: MSRV 1.89/edition 2024 e ganho nulo para o que precisamos). O bundled compila SQLite com **`SQLITE_ENABLE_FTS5`** (`libsqlite3-sys 0.38.0`, `build.rs`: `-DSQLITE_ENABLE_FTS3`, `-DSQLITE_ENABLE_FTS5`, `SQLITE_ENABLE_JSON1`, `SQLITE_ENABLE_RTREE`, `STAT4` — verificado), ou seja, FTS5 está disponível **sem feature extra**.
- Padrão de migração existente a seguir: `const SCHEMA` idempotente (`CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS`) + `ensure_column(conn, tabela, coluna, "ALTER TABLE … ADD COLUMN … DEFAULT …")` no `Db::init_connection`; nunca `DROP`/rename destrutivo; toda migração deve ser idempotente (já há testes disso no `db.rs`).
- Tabelas propostas (aditivas, prefixo `ws_`/`harness_`):

```sql
CREATE TABLE IF NOT EXISTS ws_workspaces (
  id TEXT PRIMARY KEY, root TEXT NOT NULL, name TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_opened_at INTEGER NOT NULL,
  permission_profile TEXT NOT NULL DEFAULT 'workspace-write',
  settings TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS ws_sessions (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES ws_workspaces(id),
  conversation_id TEXT, title TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  status TEXT NOT NULL, worktree_path TEXT, base_sha TEXT
);
CREATE TABLE IF NOT EXISTS ws_checkpoints (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, session_id TEXT,
  path TEXT NOT NULL, seq INTEGER NOT NULL, sha256 TEXT NOT NULL,
  size INTEGER NOT NULL, created_at INTEGER NOT NULL, storage_path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ws_checkpoints_path ON ws_checkpoints(workspace_id, path, seq);
CREATE TABLE IF NOT EXISTS ws_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, tool TEXT NOT NULL,
  command TEXT, paths TEXT NOT NULL DEFAULT '[]', decision TEXT NOT NULL,
  reason TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ws_symbols_fts (
  path TEXT NOT NULL, line INTEGER NOT NULL, symbol TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL
);
-- external content / contentless FTS5, tokenizer trigram (SQLite >= 3.34) para substring
```

- Concorrência: manter 1 conexão de escrita (`Mutex`) como hoje, mas **abrir conexões de leitura** (2–3, `Db::open_readonly`) para o painel de arquivos/diff e busca de histórico — WAL permite leitores concorrentes; `busy_timeout=5000` já configurado. Regra: nunca segurar o mutex do DB durante IO de disco/processo (hoje já é rápido, mas harness muda o perfil de uso).
- FTS5 no v1 **não é necessário** para busca de código (use §6); é bom para: histórico de mensagens, nomes de arquivos/símbolos indexados e “busca no chat”. v2: índice incremental com triggers ou `INSERT` explícito no fim de cada turno; `trigram` para “contém” (evita tokenizer de código ruim) e `bm25` para ranking.
- Backup antes de migração: `VACUUM INTO '<app-data>/backups/lumina-<ts>.db'` (SQLite ≥ 3.27), guardar as 3 últimas; versão do schema em `meta` (`schema_version`) para diagnóstico. Evitar migração em background enquanto a UI escreve: fazer no boot, antes de expor comandos.
- Eventos de harness: mensagens/tool calls continuam nas tabelas existentes; eventos de alto volume (PTY log) vão para arquivo JSONL em `<app-data>/sessions/<id>/pty.log` com rotação — não inflar o SQLite com bytes de terminal.

---

## 10. Interop com agentes externos (v2)

- **MCP (Model Context Protocol) client**: `rmcp` **3.8.0** (2026‑10‑26, rust 1.88, edition 2024; 23 M downloads recentes) com features `client` + `transport-child-process` (`tokio`). É maduro e ativo; o server MCP é um processo filho que fala JSON‑RPC por stdio → **deve** rodar sob o mesmo `ProcessRunner` (Job Object, timeout, env saneado, permissões) e as tools expostas pelo server entram no mesmo fluxo de approval. Riscos: servidores que pedem `npx`/`uvx` baixam código na primeira execução (avisar e pedir aprovação), secrets em env, e servidores que travam sem matar filhos (job resolve).
- **ACP (Agent Client Protocol)**: crate `agent-client-protocol` **3.5.0** (2026‑10‑22; `agent-client-protocol-schema` 1.12.0; variante `-tokio` 0.11.1). Interessante para “Lumina como cliente de agentes externos” ou o inverso, mas: protocolo em 3.x com mudanças de major em meses, poucos exemplos em Rust, e o valor depende de parceria (Zed etc.). 🧪 spike só se houver requisito de produto.
- **Subprocess JSON‑RPC genérico**: se for só MCP, não escrever à mão (framing, batch, notificações, cancelamento `$/cancelRequest`, erros). Windows: stdio pipes + UTF‑8 explícito (MCP usa UTF‑8); não usar console/PTY; matar árvore com job.

---

## 11. Armadilhas do Windows (checklist consolidado)

1. **MAX_PATH 260**: sem `longPathAware` no manifesto + `LongPathsEnabled=1` no registry, APIs Win32 falham em > 260; use `\\?\` (via `dunce` para exibição) e `-c core.longpaths=true` no git ([docs](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)). O `\\?\` **não** aceita paths relativos, `/`, `.`/`..`.
2. **Case-insensitive**: `src/App.tsx` e `src/app.tsx` são o mesmo arquivo; dedupe de eventos e lookup devem case-foldar; mostrar a caixa real.
3. **Separadores**: normalizar `\`→`/` em paths de IPC/diff/globs; nunca assumir `/` no FS.
4. **Nomes reservados e sufixos**: `CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`; trailing dots/spaces são removidos pelo Win32 (arquivo “sumido”); ADS `nome:stream` (inclusive `:Zone.Identifier` em downloads) — bloquear em tools.
5. **Symlinks/junctions**: junctions não exigem admin; `canonicalize` resolve, mas revisar cada componente para não sair do root; `read_link` + `is_symlink` para diagnóstico.
6. **Locks/antivírus**: rename/replace falha com `ERROR_SHARING_VIOLATION` (Excel/VS Code/AV); retry com backoff e mensagem específica. Defender escaneia cada write → writes em lote são mais rápidos que N pequenos.
7. **OneDrive/Drive**: placeholders, eventos em cascata, reidratação lenta; detectar (path contém `OneDrive`/`Google Drive`/`Dropbox`) e ajustar debounce/mensagem.
8. **Arquivos somente leitura / atributos**: `ReplaceFileW` preserva ACLs e atributos; se destino for read-only, o replace falha → limpar atributo só com confirmação.
9. **FAT/exFAT/SMB**: sem rename atômico confiável; reportar `atomic:false` e nunca fingir sucesso.
10. **ReadDirectoryChangesW**: overflow descarta o buffer (sucesso falso) → rescan; FS remoto pode não suportar; eventos de rename vêm em pares.
11. **Caminhos de dispositivo/UNC**: `\\.\`, `\\?\GLOBALROOT`, `\\server\share` — bloquear nas tools por padrão (UNC só se o workspace for UNC explícito).
12. **Path injection**: nunca concatenar string; `Path::join` + canonicalize + prefixo de componente; rejeitar prefixos parciais (`C:\work` vs `C:\workspace`).
13. **ConPTY**: ≥ Win10 1809; UTF‑8 + VT; canais em threads separadas; resize explícito; `ClosePseudoConsole` no fim (senão vaza handle e o processo pode ficar pendurado).
14. **Job Objects**: criado por nós, `KILL_ON_JOB_CLOSE`, não marcar breakaway; assign depois do spawn tem corrida → suspender/atribuir/resumir; `TerminateJobObject` é o kill confiável (taskkill só fallback).
15. **Console de fundo**: `CREATE_NO_WINDOW` em processos não interativos (hoje em `code_exec.rs`); se não, janelas pretas piscam.
16. **Encoding console**: CP850/CP1252/CP932 em programas legados; PowerShell 5.1 é OEM; `.ps1` sem BOM lido como ANSI; usar `-EncodedCommand`/UTF‑8 BOM.
17. **argv/quoting**: limite ~32 KB; `cmd.exe` quoting quebrado; passar comandos longos/patch por arquivo, não argv.
18. **WebView2**: WebGL pode falhar (VM/RDP) → fallback do xterm; WebView2 Runtime pode não estar instalado em Win10 antigo (Tauri bootstrapper resolve, mas documentar).
19. **Timestamps**: resolução varia (FAT 2 s); não usar `mtime` como única identidade → SHA/versão.
20. **Fuso/horário**: usar epoch ms UTC (o app já usa `now_ms`); nunca string localizada em DB.
21. **Firewall/AV corporativo**: pode bloquear child processes/spawn de `git.exe`; tratar erros de spawn com diagnóstico claro.
22. **Build**: `libgit2-sys` (se adotado) exige MSVC C toolchain; `gix` aumenta drasticamente tempo de build e tamanho; `portable-pty` é pequeno. Lock do `target` compartilhado (AGENTS.md): não deletar `target`.
23. **MSRV**: o `Cargo.toml` declara `rust-version = "1.77"`, mas as crates recomendadas exigem **1.85–1.89** (`notify` 1.85, `ignore` 1.88, `gix` 1.88, `rmcp` 1.88, `rusqlite` 0.41 1.89). O toolchain local é 1.99. **Decisão necessária do Lead (dono do `Cargo.toml`)**: subir `rust-version` para `1.88` (ou 1.89) — sem isso, adicionar `notify`/`ignore`/`rmcp` viola a declaração do pacote. Recomendação: `1.89`.
24. **Instalador**: um app que executa código deve ser assinado (SmartScreen) e não pedir admin; `requestedExecutionLevel=asInvoker` (Tauri default).

---

## 12. Ordem de adoção por fase

### v1 mínimo (harness local confiável, sem promessa de sandbox)

1. **Fundação** (dependência de quase tudo): módulo `workspace/` com path policy + `dunce` + validação; `ProcessRunner` com Job Object, timeout, cancelamento, env saneado, captura com teto; `FileSnapshot`/hash; auditoria. Reaproveitar padrões de `code_exec.rs`.
2. **File I/O** (§5): read offset/limit + encoding/EOL + write atômico + edit por string + checkpoints + diff via `similar`. É o que destrava o agente editando arquivos.
3. **Busca** (§6): crates ripgrep + globset; tool `search` e `glob`; cancelamento/streaming via Channel.
4. **Git CLI** (§1): status/diff/stage/commit/worktree add-remove/patch apply; modo degradado sem git; painel de diff alimentado pelo watcher.
5. **Watch** (§2): notify + debouncer + `ignore`; eventos coalescidos para árvore/diff e invalidação de cache de status.
6. **PTY/terminal** (§3): portable-pty + xterm.js; shell interativo com approval; Job Object; decoder UTF‑8 incremental.
7. **SQLite** (§9): tabelas `ws_*` aditivas + índices + backup pré-migração; checkpoints/approvals persistidos.
8. **Permissões/approvals** (§4): perfis + broker + UI de aprovação + audit log; textos honestos.

**Pode ficar fora da v1 sem bloquear**: LSP, MCP/ACP, FTS5 de código, sandbox nativo.

### v1.5 (polimento e robustez)

- Overflow do watcher/rescan; retry de lock; 3‑way merge com `diffy`; benchmark de busca/status em repo grande; long paths end‑to‑end; detecção OneDrive; telemetria de tempo por tool; testes de encoding (CP850/UTF‑16/BOM/CRLF).

### v2 (diferenciação)

- **Diagnósticos por comandos configuráveis** (cargo/tsc/eslint) → depois LSP (async-lsp) se necessário.
- **MCP client** (`rmcp`) com servidores sob o mesmo runner/approval.
- **Backend nativo de leitura git** (`git2` default-features=false) se o spawn de status doer; ou `gix` se houver requisito “sem binário”.
- **Sandbox “unelevated”** (token restrito + ACL) como *modo experimental* claramente rotulado; AppContainer só após spike que prove compatibilidade com toolchains.
- **FTS5** para histórico/símbolos + índice incremental.
- **ACP** apenas se houver caso de produto concreto.

---

## 13. Spikes necessários (com critério de aceite)

| # | Spike | Fase | Critério de aceite |
|---|---|---|---|
| S1 | portable-pty/ConPTY em Win10 1809 + Win11: resize, Ctrl+C, TUI (`vim`/`top`), bytes UTF‑8 partidos, fechamento sem vazar handles | v1 | sessão interativa estável 10 min; sem `�`; `ClosePseudoConsole` sem handle pendurado |
| S2 | Job Object: assign atômico (suspenso/resume), kill de árvore com `cargo`/`npm`/daemon, cancelamento < 500 ms, fallback taskkill em job aninhado | v1 | nenhum processo órfão após stop/cancel em 20 execuções |
| S3 | Git CLI parsing: porcelain v2 `-z`, renames, acentos, repo sem HEAD, worktree linked, submodule, hook lento; status em 50k arquivos | v1 | 100% dos fixtures parseados; p95 status < 800 ms em repo grande |
| S4 | Watcher: overflow (> 16k mudanças), save atômico de VS Code, OneDrive, repo 50k; latência de invalidação | v1 | sem perda definitiva (rescan dispara); UI atualiza < 1 s |
| S5 | Escrita atômica: ReplaceFileW com arquivo aberto, CRLF+BOM, read-only, FAT/SMB | v1 | diff mínimo correto; nenhum arquivo truncado; conflito detectado |
| S6 | Busca: 100k arquivos com `target/`/`node_modules`, cancelamento, memória | v1 | < 1 s para "func", cancelamento < 150 ms, RSS estável |
| S7 | FTS5 trigram + migrations aditivas + backup `VACUUM INTO` | v1.5/v2 | migração idempotente (2 boots), rollback por backup |
| S8 | Token restrito + ACL rodando git/node/python (estilo “unelevated”) | v2 | ≥ 80% dos comandos comuns funcionam; leitura de `~/.ssh` negada |
| S9 | AppContainer: profile + SECURITY_CAPABILITIES + ACL no workspace + rede | v2/v3 | ≥ 60% dos comandos comuns; se não, descartar |
| S10 | LSP client (`async-lsp` + `rust-analyzer`) com didOpen/didChange e diagnóstico | v2 | diagnóstico aparece < 2 s após edição; shutdown limpo |
| S11 | MCP (`rmcp`) stdio com job object + approval + secrets | v2 | tool MCP aparece e é chamável; processo morto no cancelamento |
| S12 | Backend nativo git (`git2` default-features=false) para status/diff | v2 | status < 100 ms em repo grande; mesmos resultados do CLI nos fixtures |

---

## 14. Proposta de dependências (decisão do Lead — dono do `Cargo.toml`)

```toml
# v1 — sem C, sem OpenSSL; MSRV alvo 1.89
notify = "8.2"                                   # 1.85
notify-debouncer-full = "0.7"                    # 1.85
ignore = "0.4.33"                                # 1.88 + edition 2024
grep-searcher = "=0.1.17"
grep-regex = "=0.1.14"
globset = "0.4"
portable-pty = "0.9"                             # ConPTY; 0.9.0 fev/2025
windows = { version = "0.62", features = [
  "Win32_Foundation", "Win32_System_JobObjects", "Win32_System_Threading",
  "Win32_System_Console", "Win32_Storage_FileSystem", "Win32_Security",
  "Win32_System_IO", "Win32_System_LibraryLoader",
] }                                              # 1.82
tempfile = "3"
similar = { version = "3.2", features = ["text"] }
diffy = "0.5"                                    # apply/3-way
dunce = "1"
memmap2 = "0.9"                                  # opcional (busca)
# v2 (só quando o item entrar na fase)
# git2 = { version = "0.21", default-features = false, features = ["vendored-libgit2"] }
# rmcp = { version = "3.8", default-features = false, features = ["client", "transport-child-process"] }
# async-lsp = { version = "0.2", features = ["client-monitor", "stdio"] }
# lsp-types = "0.97"
```

Notas: `gix` **não** entra na v1 (build/tamanho/MSRV/0.x). `git2` só como backend de leitura opcional na v2. `encoding_rs`, `chardetng`, `infer`, `sha2`, `rusqlite`, `tokio`, `tokio-util(rt)` e `parking_lot` já existem — reusar. `rust-version` precisa subir para **1.89** antes de qualquer crate acima de 1.77/1.85 entrar.

---

## 15. Referências

**Git**
- crates.io git2 (0.21.0, 2026‑05‑18): https://crates.io/crates/git2
- crates.io gix (0.90.0, 2026‑10‑22; MSRV 1.88): https://crates.io/crates/gix
- Headers do libgit2 (sem `hook.h`; com `apply.h`/`worktree.h`): https://github.com/libgit2/libgit2/tree/main/include/git2
- `git status --porcelain=v2`: https://git-scm.com/docs/git-status#_porcelain_format_version_2
- `git worktree`: https://git-scm.com/docs/git-worktree
- `git diff`: https://git-scm.com/docs/git-diff

**Watch**
- notify 8.2.1: https://crates.io/crates/notify
- notify-debouncer-full 0.7.0: https://crates.io/crates/notify-debouncer-full (API: `new_debouncer`, `Debouncer::watch/unwatch/update_paths`)
- `ReadDirectoryChangesW` (buffer overflow/FS remoto): https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw
- `ignore` 0.4.33: https://crates.io/crates/ignore

**Terminal/PTY**
- `CreatePseudoConsole` (UTF‑8 + VT; mínimo Win10 1809): https://learn.microsoft.com/en-us/windows/console/createpseudoconsole
- Guia de sessão de pseudoconsole (threads separadas): https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session
- portable-pty 0.9.0: https://crates.io/crates/portable-pty e fonte (wezterm): https://github.com/wezterm/wezterm/tree/main/pty
- @xterm/xterm 6.0.0: https://www.npmjs.com/package/@xterm/xterm ; addons: https://www.npmjs.com/package/@xterm/addon-fit , https://www.npmjs.com/package/@xterm/addon-webgl

**Processos/sandbox Windows**
- Job Objects (herança/nested desde Win8): https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
- `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` (KILL_ON_JOB_CLOSE, limites): https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information
- AppContainer isolation: https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation
- `CreateAppContainerProfile`: https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-createappcontainerprofile
- `CreateRestrictedToken`: https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken
- Windows Sandbox (Pro/Enterprise/Education, VM descartável): https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-overview
- Codex — Windows sandbox (MXC/elevated/unelevated): https://developers.openai.com/codex/windows/windows-sandbox
- Codex — sandboxing (Seatbelt/Landlock/bwrap): https://developers.openai.com/codex/sandboxing

**File I/O**
- `ReplaceFileW` (preserva ACLs/atributos, backup): https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew
- `MoveFileExW` (MOVEFILE_REPLACE_EXISTING/WRITE_THROUGH): https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw
- MAX_PATH / longPathAware: https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation
- tempfile 3.27: https://crates.io/crates/tempfile
- similar 3.2.1: https://crates.io/crates/similar ; diffy 0.5.2 (apply/3-way): https://crates.io/crates/diffy
- `encoding_rs`/`chardetng` (já no repo): https://crates.io/crates/encoding_rs , https://crates.io/crates/chardetng

**Busca**
- grep-searcher 0.1.17: https://crates.io/crates/grep-searcher
- grep-regex 0.1.14: https://crates.io/crates/grep-regex
- globset 0.4.20: https://crates.io/crates/globset

**LSP / interop**
- lsp-types 0.97.0: https://crates.io/crates/lsp-types
- async-lsp 0.2.4: https://crates.io/crates/async-lsp ; tower-lsp 0.20.0: https://crates.io/crates/tower-lsp
- rmcp 3.8.0: https://crates.io/crates/rmcp
- agent-client-protocol 3.5.0: https://crates.io/crates/agent-client-protocol

**Tauri / DB**
- Tauri — Channels (streaming): https://v2.tauri.app/develop/calling-frontend/
- rusqlite 0.40 / libsqlite3-sys 0.38 (bundled com FTS5): https://crates.io/crates/rusqlite ; build.rs verificado em https://docs.rs/crate/libsqlite3-sys/0.38.0/source/build.rs
- SQLite FTS5: https://www.sqlite.org/fts5.html ; `VACUUM INTO`: https://www.sqlite.org/lang_vacuum.html

---

## 16. Resumo para o plano (o que o Lead pode prometer)

**Certo (entregável técnico viável, sem surpresas)**: workspace-only write com path policy; read/edit/write de arquivos com encoding/EOL/BOM e escrita atômica; busca in-process estilo ripgrep respeitando `.gitignore`; git status/diff/stage/commit/worktree/patch via CLI; watcher nativo com debounce; terminal ConPTY UTF‑8 com xterm; jobs com kill de árvore e cancelamento; SQLite aditivo com checkpoints/approvals.

**Provável, mas validar**: performance em repos grandes (> 50k arquivos); sem perda de eventos do watcher sob carga; terminal estável em Win10 1809; portabilidade do `portable-pty` (cadência baixa).

**Não prometer na v1**: sandbox de SO no Windows (AppContainer/token restrito), LSP completo, MCP/ACP, backend git puramente Rust, índice semântico de código.
