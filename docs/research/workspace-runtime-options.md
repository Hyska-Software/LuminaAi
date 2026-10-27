# Runtime nativo do workspace — viabilidade e decisões (task-5)

> Pesquisa de viabilidade para o harness de código do Lumina (Tauri 2 · Rust · **Windows 10 1809+/11**). Decisões de crate/API, maturidade e armadilhas de plataforma — não produto.
> Data: 2026‑10‑27 · Toolchain local: `rustc 1.99.0`, `git 2.55.0.windows.5`.
> **✅** decidido com docs/versões verificadas · **🧪** exige spike antes de virar promessa no plano · **❌** descartado.

## 0. Tabela de decisões

| # | Componente | Escolha v1 | Alternativa descartada | Por quê | Risco | Spike? |
|---|---|---|---|---|---|---|
| 1 | **Git** | **CLI `git.exe`** (`-z`/`--porcelain=v2`) + trait `GitBackend` | `git2`/`gix` como backend principal | só o CLI roda hooks/filtros/LFS/autocrlf/worktrees/apply como o usuário espera; zero dep C | git ausente; parsing; spawn em repo grande | não (fixtures) |
| 2 | **Watch** | `notify` 8 + `notify-debouncer-full` 0.7; debounce 250–500 ms; filtro `.gitignore` fora do watcher | polling; watcher cru; watcher por painel | RDCW nativo/barato; debouncer-full pareia renames; `ignore` filtra custo | overflow perde eventos; save atômico; OneDrive | 🧪 overflow + >50k |
| 3 | **Shell/terminal** | **`portable-pty` 0.9 (ConPTY)** + pipes p/ não interativos + **Job Object**; **xterm.js 6** | winpty; FFI ConPTY caseira; ANSI em `<pre>` | ConPTY é oficial (UTF‑8+VT); portable-pty encapsula bem; xterm é padrão | crate de fev/2025; tree-kill; bytes partidos | 🧪 ConPTY 1809 + resize |
| 4 | **Sandbox** | **guarda-corpo no harness** (perfis + approvals + jobs + env + audit); **não prometer sandbox de SO** | AppContainer v1; Windows Sandbox; UAC; token sem ACL | Windows não tem Seatbelt/Landlock barato; Codex exige 3 implementações e setup elevado | falsa segurança; escape via shell; toolchain quebra | 🧪 v2: token+ACL/AppContainer |
| 5 | **File I/O** | leitura offset/limit + encoding/binário; escrita **atômica** com CAS por hash; edit por **string única**; checkpoints; `similar`/`diffy` | `fs::write`; patch como operação primária; normalizar CRLF sempre | preserva encoding/EOL/BOM/ACL; evita clobber; diff de approval por arquivo | locks/AV/OneDrive; mudança externa | 🧪 replace com arquivo aberto |
| 6 | **Busca** | crates ripgrep in-process: `ignore` + `grep-searcher` + `grep-regex` + `globset` | invocar `rg.exe`; indexar tudo em FTS5 na v1 | mesmo motor do rg, sem binário externo, streaming/cancelável, respeita `.gitignore` | API 0.1.x → pinar exato; repo grande | não (benchmark) |
| 7 | **LSP (v2)** | lint/typecheck configuráveis reusando o runner; LSP só se definitions/hover forem requisito | LSP na v1; `tower-lsp` como base | LSP custa 10× para pouco ganho; tower-lsp parado desde 2023 | servers ausentes/divergentes | 🧪 `async-lsp` |
| 8 | **Cancelamento** | `tokio` + `CancellationToken` (já em `AppState::turns`), jobs, `Channel` + coalescing 33–50 ms | `emit` global p/ PTY; threads ad hoc | Channel é o caminho da Tauri p/ alto throughput; token existe | backpressure do PTY; event storm | não |
| 9 | **SQLite** | manter **rusqlite 0.40 bundled**; migrações aditivas `ensure_column`; WAL; `ws_*`; FTS5 disponível | rusqlite 0.41 (MSRV 1.89); DB por workspace; ORM | padrão do repo testado; FTS5 vem no bundled; WAL ligado | conexão única vira gargalo; migração sem backup | 🧪 FTS5 trigram |
| 10 | **MCP/ACP (v2)** | MCP client via **`rmcp` 3.8** (stdio/child-process); ACP depois | JSON‑RPC à mão; ACP na v1 | rmcp ativo com client/stdio; ACP 3.x muda major | herdam privilégios; framing/encoding | 🧪 MCP + job + approval |

**Certo**: CLI git, ConPTY UTF‑8, Job Objects, RDCW, ReplaceFileW, crates ripgrep, xterm.js, WAL/FTS5 bundled. **Não certo**: sandbox de SO decente no Windows, unicidade de eventos do watcher, estabilidade 0.x do gix, LSP barato.

## 1. Git (deep)

| | CLI do usuário | git2 0.21 (libgit2) | gix 0.90 (gitoxide) |
|---|---|---|---|
| Release / downloads recentes | Git for Windows 2.55 | **2026‑05‑18**, 17,5 M ([crates.io](https://crates.io/crates/git2)) | **2026‑10‑22**, 13,0 M ([crates.io](https://crates.io/crates/gix)) |
| MSRV / build | n/a / zero | não declara; `libgit2-sys` compila C vendorizado (~1–3 min MSVC); **default features = []** → sem OpenSSL | **1.88 / edition 2024**; centenas de crates, default `max-performance`+`extras` |
| Cobertura | **tudo** (hooks, filtros, LFS, apply, worktrees) | status/diff/commit/index/apply/blame/stash/merge/reset/rebase/revwalk; **worktrees só leitura** (sem `worktree_add`) | status/diff/commit/blame/`add_worktree`/`remove_worktree`/dirwalk; **sem apply e sem staging de alto nível** |
| Hooks / worktree add / apply | ✅ / ✅ / ✅ | ❌ (não existe `hook.h` em [`include/git2`](https://github.com/libgit2/libgit2/tree/main/include/git2)) / ❌ / ✅ | ❌ / ✅ / ❌ |
| Estabilidade | porcelain estável | boa | 0.x, breaking frequente |

**Decisão v1: CLI-first.** (1) commit precisa rodar `pre-commit`/`commit-msg` e status/checkout precisam respeitar `core.autocrlf`, `.gitattributes`, filtros, LFS, sparse-checkout e submódulos — nenhuma lib Rust reproduz; (2) worktree add é requisito e só o CLI (e o gix recente) cobre; (3) zero C/libgit2 e zero divergência de versão; (4) é o que Codex/OpenCode/DSH fazem. Custo 20–60 ms/spawn; `status` em repo grande 100–500 ms → nunca por tecla: cache invalidado pelo watcher, status em background com debounce, `--no-optional-locks`.
**Híbrido (só v2)**: `git2 = { version = "0.21", default-features = false }` para leitura contínua (status/diff entre frames) se houver spawn storm. **Não** usar git2 p/ commit/checkout/apply. `gix` só se "git sem binário" virar requisito — faltaria apply/staging.

Plumbing: status `git -C <root> -c core.quotepath=false status --porcelain=v2 -z --branch --untracked-files=all` ([formato](https://git-scm.com/docs/git-status#_porcelain_format_version_2)), parseando tokens (nunca a saída legível); resumo `git diff --numstat -z [--cached]`, conteúdo sob demanda `git diff -U3 --no-color --no-ext-diff --no-textconv -- <path>`; stage/unstage `git add` / `git restore --staged`; commit `git commit -F <temp>` (evita quoting; hooks rodam com timeout); `git worktree add/remove/prune`; `git apply --index <arquivo>` (nunca em argv, limite ~32 KB). Env: remover `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0` em leitura. Git for Windows tem `core.autocrlf=true`: mostrar EOL e nunca "consertar" sozinho; repo sem HEAD (`status` ok, `diff HEAD` falha → tudo added/untracked); submódulos `--ignore-submodules=none` e não recursar na busca.

```rust
pub trait GitBackend: Send + Sync {
    fn discover(&self, start: &Path) -> anyhow::Result<Option<GitRepoInfo>>;
    fn status(&self, repo: &GitRepoInfo) -> anyhow::Result<Vec<GitStatusEntry>>;
    fn diff(&self, repo: &GitRepoInfo, req: &DiffReq) -> anyhow::Result<Vec<GitHunk>>;
    fn stage(&self, repo: &GitRepoInfo, paths: &[String]) -> anyhow::Result<()>;
    fn commit(&self, repo: &GitRepoInfo, msg: &str, paths: &[String]) -> anyhow::Result<String>;
    fn worktree_add(&self, repo: &GitRepoInfo, path: &str, branch: Option<&str>) -> anyhow::Result<()>;
    fn worktree_remove(&self, repo: &GitRepoInfo, path: &str, force: bool) -> anyhow::Result<()>;
    fn apply_patch(&self, repo: &GitRepoInfo, patch: &str, index: bool) -> anyhow::Result<()>;
}
// IPC: GitStatusEntry { path, orig_path, staged: GitFileState, worktree: GitFileState, binary }
//      GitHunk { old_start, old_lines, new_start, new_lines, header, lines }
```

Riscos: git ausente → modo degradado explícito (sem painel VCS, instrução de instalação como §8.1 do FILES.md); hook travado → timeout + kill tree + aviso; repo enorme → coalescer status. 🧪 Fixtures: renames `-z`, acentos/espaços, sem HEAD, worktree linked, submodule, hook lento; p95 status em 50k.

## 2. Watch de arquivos

`notify` **8.2.1** (2026‑10‑25, rust 1.85) usa `ReadDirectoryChangesW` no Windows; `notify-debouncer-full` **0.7.0** (2026‑05‑02) faz timeout/tick, `RecommendedCache` pareia renames e `Debouncer::{watch,unwatch,update_paths}`. Filtragem com `ignore` **0.4.33** (2026‑08‑04, rust 1.88): o watcher só entrega eventos; filtrar depois é barato (RDCW é recursivo por handle).

```rust
pub struct WatchConfig { pub debounce: Duration /*250ms*/, pub tick_rate: Duration /*100ms*/, pub max_batch: usize /*512*/ }
pub enum WorkspaceEvent { PathsChanged { paths: Vec<String>, kind: String }, Overflow, Error(String) }
pub trait WorkspaceWatcher: Send + Sync {
    fn start(&mut self, root: &Path, cfg: WatchConfig, tx: mpsc::Sender<WorkspaceEvent>) -> anyhow::Result<()>;
    fn stop(&mut self);
}
```

Armadilhas: o buffer do RDCW é por handle e no overflow a função **retorna sucesso, descarta tudo** (`lpBytesReturned=0` — [docs](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)) → detectar e reenumerar (`dirty_all`); pode não existir p/ FS remoto (SMB) → `PollWatcher`/desligar; save atômico = temp+rename → "sumiu e voltou" é modified; não observar `.git/objects`/`node_modules`/`target`/`.venv` (filtro pós-evento), de `.git` só `HEAD`/`index`/`refs/**`; coalescer 250–500 ms e emitir **1 evento** `workspace://fs` com lista (event system da Tauri não é p/ alto throughput — [docs](https://v2.tauri.app/develop/calling-frontend/)); `git status` com debounce 750 ms. 🧪 >16k mudanças (`npm ci`) validando `Overflow`+rescan; repo 50k; OneDrive; case-insensitive (dedupe case-fold, exibir caixa real).

## 3. Shell e terminal (deep)

**Terminal interativo**: `portable-pty` **0.9.0** (2025‑02‑11, 14,3 M downloads) sobre ConPTY — no Windows o backend é `win::conpty::ConPtySystem`, **sem fallback winpty**. **Comandos não interativos**: pipes stdout/stderr separados (como `code_exec.rs`), não PTY. **Frontend**: `@xterm/xterm` **6.0.0** (2025‑12‑22) + `addon-fit` 0.11 + `addon-webgl` 0.19 (fallback se WebGL falhar em VM/RDP). FFI direta (`CreatePseudoConsole`) é escape hatch (~400–600 linhas), não plano A.

```rust
pub fn native_pty_system() -> Box<dyn PtySystem + Send>;
pub trait MasterPty { fn resize(&self, size: PtySize) -> Result<(), Error>;
                      fn try_clone_reader(&self) -> Result<Box<dyn Read + Send>, Error>;
                      fn take_writer(&self) -> Result<Box<dyn Write + Send>, Error>; }
pub trait SlavePty { fn spawn_command(&self, cmd: CommandBuilder) -> Result<Box<dyn Child + Send + Sync>, Error>; }
pub trait Child { fn try_wait(&mut self) -> IoResult<Option<ExitStatus>>; fn wait(&mut self) -> IoResult<ExitStatus>;
                  fn process_id(&self) -> Option<u32>; }
pub trait ChildKiller { fn kill(&mut self) -> IoResult<()>; fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync>; }
// CommandBuilder::new(program).args(..).env(k,v).cwd(path).size(PtySize)
```

ConPTY — **certo**: existe desde **Win10 1809 (17763)** (desktop only) e os streams de in/out são **UTF‑8 + Virtual Terminal Sequences** ([CreatePseudoConsole](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole)); in/out precisam ser servidos em **threads separadas**, senão deadlock quando um buffer enche ([guia MS](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session)); resize via `ResizePseudoConsole`/`MasterPty::resize` (sem isso TUI/`git log` desenham torto); `ClosePseudoConsole` no fim (senão vaza handle).

**Morte de árvore (Job Objects)**: `CreateJobObjectW` + `SetInformationJobObject(JobObjectExtendedLimitInformation)` com `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` → fechar o último handle mata todos ([struct](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)); opcionais `JOB_MEMORY`/`ACTIVE_PROCESS` são best-effort (podem ser ignorados). Criar processo **suspenso** (`CREATE_SUSPENDED`), `AssignProcessToJobObject`, `ResumeThread` via `OpenThread` — evita corrida com netos antes do assign (alternativa `PROC_THREAD_ATTRIBUTE_JOB_LIST`); cancelar/timeout → `TerminateJobObject`; sem breakaway. Jobs aninhados existem desde Win8, mas assign pode falhar (`ERROR_ACCESS_DENIED`) → fallback `taskkill /T /F` (o que `code_exec.rs` já faz). `taskkill` é fallback, não primário: processo externo, AV, mensagens localizadas, não mata filho elevado.

**Encoding**: no terminal o UTF‑8 do ConPTY **pode partir caractere entre chunks** → decodificar com `encoding_rs::UTF_8.new_decoder_without_bom_handling()` mantendo estado (`last=false`); nunca `from_utf8_lossy` por chunk (espalha `�`). Em comandos não interativos o stdout pode vir CP850/CP1252/CP932 → forçar UTF‑8 (`PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`, já no repo), BOM, `chardetng`+`encoding_rs` com report, lossy só por último marcado `decodedLossy`. PowerShell 5.1 tem saída OEM/ANSI → `-EncodedCommand` (base64 UTF‑16LE) elimina quoting/code page; `.ps1` sem BOM é ANSI; `cmd.exe` tem quoting quebrado → comando por `.cmd` temporário/stdin (`cmd /d /s /c`).

Frontend: `addon-fit` no `ResizeObserver`; `scrollback: 10_000`; `term.onData` → `pty_write`; `attachCustomKeyEventHandler` p/ Ctrl+C/V não colidirem com atalhos globais; ANSI nunca em `<pre>` (o agente roda cargo/npm/git/TUIs).
🧪 1809/1909 + resize + Ctrl+C (0x03) + TUI; bytes partidos (`printf 'ção 🚀'`); WebGL no WebView2; `portable-pty` em manutenção → encapsular atrás de `PtySession`; daemons de cargo/npm → Job Object obrigatório.

## 4. Sandbox e permissões (deep)

**Não é honesto prometer "sandbox de SO" no v1 em Windows.** macOS tem Seatbelt; Linux tem Landlock/seccomp (+bubblewrap, exigido pelo Codex); Windows não tem contenção de FS por processo sem AppContainer/filter driver. O Codex no Windows tem **três** implementações ([docs](https://developers.openai.com/codex/windows/windows-sandbox)): **MXC** (isolamento nativo, sem setup admin, "em dispositivos compatíveis"), **elevated** (usuários dedicados + firewall, **setup com admin**) e **unelevated** (token restrito + ACLs; sem deny-read, rede fraca). Não cabe na v1 de um app local-first.

```rust
pub enum PermissionProfile { ReadOnly, WorkspaceWrite, FullAccess } // FullAccess = opt-in explícito
pub struct PermissionRequest { pub tool: String, pub paths: Vec<String>, pub command: Option<String>,
                               pub reason: String, pub risk: RiskLevel }
pub trait ApprovalBroker: Send + Sync {
    async fn request(&self, req: PermissionRequest) -> anyhow::Result<ApprovalDecision>; // Once|Session|Deny
}
```

Guarda-corpo v1: **path policy** (root canônico por workspace; `dunce::canonicalize` + prefixo de **componente**; rejeitar `..`, absoluto fora do root, UNC/dispositivo `\\.\`/`\\?\GLOBALROOT`, ADS `file:stream`, nomes reservados; symlink/junction só se o alvo ficar no root); **deny-list** (`<app-data>` com DB/tokens, `~/.ssh`, `~/.aws`, `%APPDATA%\Microsoft\Credentials`, `*.pem`/`*.key`); **env saneado** (remover `*API_KEY*`/`*TOKEN*`/`*SECRET*`/`*PASSWORD*`, `GIT_ASKPASS`; nunca chaves do app); **approval por comando** (allowlist do trivial + "permitir na sessão"; bloquear padrões destrutivos — `format`, `diskpart`, `reg delete`, `Set-ExecutionPolicy`, `rm -rf` fora do root, `git push --force`, `curl|iex` — **heurística de UX, não segurança**); **Job Object** em todo processo + timeout + tetos + `CREATE_NO_WINDOW` + prioridade abaixo do normal; **audit log** (`ws_approvals`: tool, paths, comando, decisão, timestamp, sem segredos); **UI honesta** ("proteção contra engano, não contenção de código malicioso"), coerente com `docs/FILES.md` §8.3. O DSH também declara um *file sandbox policy* + approvals no harness — não um sandbox de SO.

Opções nativas, por que não na v1: **Job Objects** — não isolam FS/rede. **Token restrito** (`CreateRestrictedToken`/`DISABLE_MAX_PRIVILEGE`) — não separa arquivos do usuário comum. **Token+ACL** (estilo unelevated) — sem admin, mas ACL por path/glob é lenta/frágil e quebra `%APPDATA%`, cache npm, registry (🧪 S1). **AppContainer** (`CreateAppContainerProfile` + `SECURITY_CAPABILITIES`) — mecanismo real (isolamento de credencial/dispositivo/arquivo/rede/processo, [docs](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)), mas não acessa `%USERPROFILE%`/registry, loopback bloqueado, toolchains quebram (🧪 S2; corte: <60% dos comandos comuns). **Windows Sandbox** ❌ (exige Pro/Enterprise/Education, VM descartável sem software do host) e **`runas`/UAC** ❌ (elevar é o oposto do objetivo).

## 5. File I/O do agente (deep)

**Leitura**: `offset` (linha 1-based) + `limit` (default 2000, máx 4000) e/ou bytes; devolver `totalLines`, `truncated`, `encoding`, `eol`, `sha256`, `mtime`, `size`. `BufReader` com parada antecipada; nunca `read_to_string` sem teto. Binário = NUL nos primeiros 8 KB ou `infer::get` → não editar (preview existente). Encoding: BOM → UTF‑8 estrito → `chardetng`+`encoding_rs` com report/lossy. EOL: CRLF/LF/mixed; **conteúdo lógico em `\n`** (offsets/hashes por linha lógica) e escrita reaplica o EOL original (evita diff CRLF inteiro). Paths: validar (§4), lookup case-fold, exibir caixa real; >10 MB → range/negar; lock (Excel/Word) → "em uso por outro programa".

**Escrita atômica** (nunca `fs::write` sobre existente): (1) policy + CAS (`sha256`/`mtime`/`size`; mudou → `Conflict` + 3‑way); (2) temp no **mesmo diretório** (`tempfile::Builder::tempfile_in`), escrever, `flush`, `sync_all` opcional; (3) destino existe → `ReplaceFileW(dest, temp, backup: None, REPLACEFILE_IGNORE_MERGE_ERRORS)`, que **preserva atributos e ACLs** ([docs](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)); não existe → `MoveFileExW(temp, dest, MOVEFILE_REPLACE_EXISTING)` ([docs](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)); (4) retry com backoff (5×, 20–200 ms) em `ERROR_SHARING_VIOLATION`/`ERROR_LOCK_VIOLATION`, persistiu → `Locked`; (5) sem symlink não resolvido; FAT/exFAT/SMB → fallback rename + `atomic:false`.

```rust
pub struct FileSnapshot { pub path: String, pub sha256: String, pub size: u64, pub mtime_ms: i64,
                          pub encoding: String, pub eol: String, pub bom: bool, pub total_lines: u64 }
pub enum WriteOutcome { Written { snapshot: FileSnapshot, checkpoint: String },
                        Conflict { current: FileSnapshot }, Locked { retries: u8 }, Denied { reason: String } }
pub struct CheckpointId(pub String); // <app-data>/workspace-checkpoints/<ws>/<seq>-<hash>
```

**Edit**: primário = **substituição de string** (`old_string`→`new_string`), `replace_all` + match **único**; erros claros (não encontrado, múltiplos, idêntico). Diff unificado só como input opcional: `diffy::apply` (fuzz 0), rejeitar hunk que não casar; nunca `patch.exe`. Vários edits/turno: aplicar em memória, gravar **uma** vez; se um falhar, nada grava; checkpoint do original antes; UI/approval sempre com diff (`similar`, linhas + intra-line). **3‑way** quando `Conflict`: base=lido, ours=disco, theirs=agente (`diffy::merge`); sem sobreposição aplica e reporta `merged`, com conflito devolve marcadores e não grava. Checkpoints em disco + `ws_checkpoints`, desfazer por arquivo/turno, poda 7 dias/200 MB — substitui "git stash" p/ quem não usa git.
🧪 arquivo aberto no Excel/VS Code; CRLF+BOM read→edit→write com diff mínimo; OneDrive; ReplaceFileW exige destino existente e mesmo volume (fallback testado); hash de arquivo grande (limitar a 256 KB ou xxh3 p/ CAS).

## 6. Busca (deep)

Crates do ripgrep in-process: `ignore` **0.4.33** (walker paralelo com `.gitignore`/`.ignore`/global/exclude, `filter_entry`, `build_parallel`), `grep-searcher` **0.1.17** (contexto, line numbers, multiline, binary detection, mmap, BOM), `grep-regex` **0.1.14** (case/word/fixed/line terminator), `globset` **0.4.20** (include/exclude e busca por nome). Por que não `rg.exe`: dependência externa, bundling/licença, parse de `--json` a mais, sem cancelamento por arquivo/streaming tipado — e é o mesmo motor. Risco: APIs `0.1.x` → pinar exato (`=0.1.17` etc.).

```rust
pub struct SearchRequest { pub workspace_id: String, pub pattern: String, pub mode: SearchMode,
                           pub case_sensitive: bool, pub include_globs: Vec<String>, pub exclude_globs: Vec<String>,
                           pub max_results: usize, pub context_lines: u8, pub multiline: bool }
pub enum SearchEvent { Batch { results: Vec<SearchMatch> }, Progress { files_scanned: u64 },
                       Done { truncated: bool, files_scanned: u64, duration_ms: u64 }, Cancelled, Error { message: String } }
pub struct SearchMatch { pub path: String, pub line: u64, pub column: u64, pub line_text: String,
                         pub context_before: Vec<String>, pub context_after: Vec<String>, pub is_binary: bool }
pub trait FileSearcher: Send + Sync {
    fn search(&self, root: &Path, req: SearchRequest, sink: mpsc::Sender<SearchEvent>,
              cancel: tokio_util::sync::CancellationToken) -> anyhow::Result<()>;
}
```

Regras: `WalkBuilder` com `hidden(false)` (dotfiles não ignorados aparecem), `git_ignore/global/exclude(true)`, `parents(true)`, `add_custom_ignore_filename(".luminaignore")`, `max_filesize(10 MiB)`, `threads(0)` no walker + pool próprio (cap 8); `SearcherBuilder` com line numbers/contexto, `binary_detection(quit(b'\0'))`, mmap só >1 MB; `Sink` envia por `mpsc` (nunca acumular), checa `cancel` a cada arquivo/linha; erro por arquivo é não-fatal. Ordem path+linha, sem ranking na v1; FTS5/índice semântico na v2. Esperado: repo médio (5–20k) <300 ms; 100k com `target/` ignorado dominado por IO — medir, não prometer. 🧪 benchmark no repo pós-build; cancelamento <150 ms; paths `\\?\`/case/não-UTF8; globs com `/`.

## 7. LSP e diagnósticos (v2)

`lsp-types` **0.97.0** (jun/2024, sem release há ~2 anos), `async-lsp` **0.2.4** (abr/2026; `client-monitor`/`stdio`), `tower-lsp` **0.20.0** (ago/2023 — evitar como base nova). **Não** colocar LSP na v1: usar comandos configuráveis de lint/typecheck reusando o runner — `cargo check --message-format=json` (parse `compiler-message`), `tsc --noEmit --pretty false`, `eslint --format json`, `ruff check --output-format json`, `pyright --outputjson` — cobre 80% do valor sem lifecycle de server. Se definitions/hover forem requisito: client `async-lsp` (não JSON‑RPC à mão), pipes (não PTY), framing `Content-Length`, `initialize/initialized/shutdown/exit`, `didOpen/didChange`, mesma política de permissões, servers detectados no PATH e configurados por workspace. Custo 2–4 semanas + manutenção. 🧪 spike com rust-analyzer.

## 8. Progresso, cancelamento e concorrência

Já existe: `AppState::turns: Mutex<HashMap<String, CancellationToken>>`; `tokio-util` com feature **`rt`** é exatamente o gate de `CancellationToken` (`#[cfg(feature = "rt")] pub mod sync;`). Todo processo recebe token do turno **e** timeout; `tokio::select!` entre `wait`/timeout/`cancelled()`; cancelar = `TerminateJobObject` → drenar readers → fallback `start_kill`. Streaming: `tauri::ipc::Channel<T>` por sessão (o event system global "não é desenhado para baixa latência/alto throughput" — [Tauri](https://v2.tauri.app/develop/calling-frontend/)); coalescing PTY ≤16 ms/8 KB, search 50–100/50 ms, progresso ≤10 Hz. **Backpressure PTY**: `mpsc::channel(256)` + `send().await` no reader (UI travada → pipe enche → filho bloqueia; perda zero); em busca a política é oposta (truncar + `truncated:true`). PTY trafega `String` UTF‑8 incremental (ou base64), nunca `Vec<u8>` cru. Estado por workspace em `HashMap<String, WorkspaceRuntime>`; não segurar mutex/`parking_lot` durante await (clonar `Arc`/token).

## 9. SQLite

Manter **rusqlite 0.40 bundled** (não subir p/ 0.41: MSRV 1.89/edition 2024, ganho nulo). O bundled compila SQLite com **`SQLITE_ENABLE_FTS5`** (verificado em `libsqlite3-sys 0.38.0` `build.rs`: FTS3/FTS5/JSON1/RTREE/STAT4) → FTS5 sem feature extra. Seguir o padrão do `db.rs`: `SCHEMA` idempotente (`IF NOT EXISTS`) + `ensure_column(..., "ALTER TABLE … ADD COLUMN … DEFAULT …")` no `init_connection`; nada destrutivo; migração idempotente (já testado).
Tabelas aditivas: `ws_workspaces(id, root, name, created_at, last_opened_at, permission_profile, settings)`; `ws_sessions(id, workspace_id, conversation_id, title, status, worktree_path, base_sha, timestamps)`; `ws_checkpoints(id, workspace_id, session_id, path, seq, sha256, size, storage_path, created_at)` + índice `(workspace_id, path, seq)`; `ws_approvals(session_id, tool, command, paths JSON, decision, reason, created_at)`; `ws_symbols_fts(...)` FTS5 `trigram` (SQLite ≥3.34) p/ "contém".
Concorrência: 1 conexão de escrita (`Mutex`) como hoje + 2–3 **read-only** p/ painel/histórico (WAL; `busy_timeout=5000` já configurado); nunca segurar o mutex durante IO/processo. Backup antes de migrar: `VACUUM INTO '<app-data>/backups/lumina-<ts>.db'` (3 últimas) + `schema_version` em `meta`, no boot antes de expor comandos. PTY log em JSONL (`<app-data>/sessions/<id>/pty.log` com rotação), não no SQLite.

## 10. Interop com agentes externos (v2)

**MCP client**: `rmcp` **3.8.0** (2026‑10‑26, rust 1.88, 23 M downloads recentes) com `client` + `transport-child-process`/`transport-io`; ativo e maduro. Server MCP é processo filho JSON‑RPC stdio → **mesmo `ProcessRunner`** (Job Object, timeout, env saneado) e tools entram no fluxo de approval; avisar que `npx`/`uvx` baixam código na 1ª execução; secrets em env. **ACP**: `agent-client-protocol` **3.5.0** (2026‑10‑22; schema 1.12.0; variante `-tokio` 0.11.1) — protocolo 3.x que muda major em meses, poucos exemplos Rust → 🧪 só com caso de produto. Não escrever JSON‑RPC à mão se for só MCP (framing, batch, notificações, cancelamento).

## 11. Armadilhas do Windows (checklist)

1. **MAX_PATH 260**: sem `longPathAware` no manifesto + `LongPathsEnabled=1`, falha >260; usar `\\?\` (exibir via `dunce`) e `-c core.longpaths=true` no git ([docs](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)); `\\?\` não aceita relativo, `/`, `.`/`..`.
2. **Case-insensitive/seps**: `src/App.tsx` ≡ `src/app.tsx` (dedupe case-fold, exibir caixa real); normalizar `\`→`/` no IPC/diff/globs.
3. **Nomes reservados/ADS**: `CON`,`PRN`,`AUX`,`NUL`,`COM1..9`,`LPT1..9`; trailing dot/espaço removidos pelo Win32; ADS `nome:stream` (`:Zone.Identifier`) → bloquear.
4. **Links**: junction não exige admin; resolver e checar cada componente contra o root.
5. **Locks/AV/FS**: rename/replace falha com `ERROR_SHARING_VIOLATION` (Excel/VS Code/AV) → backoff/mensagem; Defender escaneia cada write; read-only falha → confirmar; FAT/exFAT/SMB → `atomic:false`; OneDrive (placeholders/cascata) → detectar e ajustar.
6. **RDCW**: overflow descarta buffer (sucesso falso) → rescan; FS remoto pode não suportar; renames em pares.
9. **Device/UNC**: `\\.\`, `\\?\GLOBALROOT`, `\\server\share` → negar por padrão; nunca concatenar string — `Path::join`+canonicalize+prefixo de **componente** (`C:\work` ≠ `C:\workspace`).
10. **ConPTY**: ≥1809; UTF‑8+VT; in/out em threads separadas; resize; `ClosePseudoConsole` no fim.
11. **Jobs**: `KILL_ON_JOB_CLOSE`, sem breakaway; assign pós-spawn tem corrida → suspender-atribuir-resumir; `TerminateJobObject` é o kill confiável.
12. **Console**: `CREATE_NO_WINDOW` em não interativo (já em `code_exec.rs`) senão janelas pretas piscam.
13. **Encoding console**: CP850/CP1252/CP932 legados; PS 5.1 OEM; `.ps1` sem BOM = ANSI → `-EncodedCommand`/BOM.
14. **argv/quoting**: limite ~32 KB; `cmd.exe` quebrado → comandos/patch por arquivo, não argv.
15. **WebView2**: WebGL pode falhar em VM/RDP → fallback xterm; runtime pode faltar em Win10 antigo (bootstrapper Tauri).
16. **Timestamps**: resolução varia (FAT 2 s) → nunca só `mtime`; CAS com hash.
17. **Build/MSRV**: `Cargo.toml` declara `rust-version = "1.77"`, mas as crates recomendadas exigem **1.85–1.89** (`notify` 1.85, `ignore`/`gix`/`rmcp` 1.88, `rusqlite` 0.41 1.89); toolchain local 1.99. **Ação do Lead (dono do Cargo.toml): subir para `1.89`.**
18. **Instalador**: assinar (SmartScreen), `asInvoker`, nunca pedir admin; `target` compartilhado — não deletar (AGENTS.md).

## 12. Ordem de adoção por fase

**v1 mínimo** (sem promessa de sandbox): (1) fundação `workspace/` — path policy + `ProcessRunner` (Job Object/timeout/cancel/env/teto), snapshots e auditoria (reusar `code_exec.rs`); (2) **file I/O** (§5); (3) **busca** (§6); (4) **git CLI** (§1) com modo degradado; (5) **watch** (§2) alimentando árvore/diff/cache; (6) **PTY** (§3) + xterm; (7) **SQLite** `ws_*` + backup; (8) **perfis/approvals** (§4) + UI honesta. Fora da v1: LSP, MCP/ACP, FTS5 de código, sandbox nativo.
**v1.5**: overflow/rescan; retry de lock; 3‑way; benchmark busca/status; long paths e2e; OneDrive; encoding (CP850/UTF‑16/BOM/CRLF); telemetria por tool.
**v2**: diagnósticos configuráveis → LSP (`async-lsp`); MCP (`rmcp`); backend nativo de leitura git (`git2`) se spawn doer; sandbox "unelevated" experimental (token+ACL); AppContainer pós-spike; FTS5 histórico/símbolos; ACP com caso concreto.

## 13. Spikes (critério de aceite)

| # | Spike | Fase | Aceite |
|---|---|---|---|
| S1–S6 | v1: ConPTY/portable-pty (resize, Ctrl+C, TUI, UTF‑8 partido, sem vazar handle); Job Object (assign suspenso, kill de árvore cargo/npm/daemon, cancel <500 ms); Git CLI parsing (`-z`, renames, acentos, sem HEAD, worktree, submodule, hook, 50k arquivos, p95 <800 ms); Watcher (overflow >16k, save atômico, OneDrive, 50k, rescan e UI <1 s); escrita atômica (ReplaceFileW com arquivo aberto, CRLF+BOM, read-only, FAT/SMB); busca 100k (cancel <150 ms, RSS estável) | v1 | cada item com fixture reproduzível e teste automatizado; 0 órfãos em 20 runs de kill |
| S8/S9 | v2: token restrito + ACL (≥80% dos comandos git/node/python; `~/.ssh` negado) e AppContainer + capability + ACL + rede (≥60% senão descartar) | v2/v3 | relatório de compatibilidade por toolchain; decisão go/no-go registrada |
| S10/S11 | v2: LSP (`async-lsp`+rust-analyzer, diag <2 s, shutdown limpo) e MCP (`rmcp` stdio + job + approval, tool chamável e processo morto no cancel) | v2 | sessão completa sem processo órfão |

## 14. Dependências propostas (Lead decide o `Cargo.toml`)

```toml
notify = "8.2"; notify-debouncer-full = "0.7"; ignore = "0.4.33"
grep-searcher = "=0.1.17"; grep-regex = "=0.1.14"; globset = "0.4"
portable-pty = "0.9"; tempfile = "3"; similar = "3.2"; diffy = "0.5"; dunce = "1"; memmap2 = "0.9"
windows = { version = "0.62", features = ["Win32_Foundation", "Win32_System_JobObjects",
  "Win32_System_Threading", "Win32_System_Console", "Win32_Storage_FileSystem",
  "Win32_Security", "Win32_System_IO"] }
# v2: git2 = { version = "0.21", default-features = false, features = ["vendored-libgit2"] }
# v2: rmcp = { version = "3.8", default-features = false, features = ["client", "transport-child-process"] }
# v2: async-lsp = { version = "0.2", features = ["client-monitor", "stdio"] }; lsp-types = "0.97"
```
`gix` fora da v1 (build/tamanho/MSRV/0.x). Já existem e devem ser reusados: `encoding_rs`, `chardetng`, `infer`, `sha2`, `rusqlite`, `tokio`, `tokio-util(rt)`, `parking_lot`. **Pré-requisito**: `rust-version = "1.89"` antes de adicionar `notify`/`ignore`/`rmcp`.

## 15. Referências

Consolidação dos links citados inline: [git2](https://crates.io/crates/git2) · [gix](https://crates.io/crates/gix) · [libgit2 include/git2](https://github.com/libgit2/libgit2/tree/main/include/git2) · [porcelain v2](https://git-scm.com/docs/git-status#_porcelain_format_version_2) · [notify](https://crates.io/crates/notify) · [ReadDirectoryChangesW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw) · [ignore](https://crates.io/crates/ignore) · [CreatePseudoConsole](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole) · [guia de sessão](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session) · [portable-pty](https://crates.io/crates/portable-pty) · [xterm.js](https://www.npmjs.com/package/@xterm/xterm) · [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) · [AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation) · [Codex Windows sandbox](https://developers.openai.com/codex/windows/windows-sandbox) · [ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew) · [MAX_PATH](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation) · [grep-searcher](https://crates.io/crates/grep-searcher) · [similar](https://crates.io/crates/similar) · [diffy](https://crates.io/crates/diffy) · [lsp-types](https://crates.io/crates/lsp-types) · [async-lsp](https://crates.io/crates/async-lsp) · [rmcp](https://crates.io/crates/rmcp) · [Tauri Channels](https://v2.tauri.app/develop/calling-frontend/) · [rusqlite](https://crates.io/crates/rusqlite) · [libsqlite3-sys 0.38 build.rs](https://docs.rs/crate/libsqlite3-sys/0.38.0/source/build.rs) · [SQLite FTS5](https://www.sqlite.org/fts5.html) · [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html)
