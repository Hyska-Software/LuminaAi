# Página Biblioteca — Implementation Plan

> Referência visual: `REFERENCE.png` (nesta pasta). Conceito de layout: header
> da página com título, busca central e ações à direita; faixa de filtros em
> pills; grade de cards de arquivo com ícone/tipo colorido, nome e miniatura.
> O app usa **tokens do design system** (não copiar cores/medidas da imagem).

**Intent:** fechar o ciclo do arquivo no Lumina. Hoje o usuário só vê artefatos
do turno em que foram criados (painel da conversa) e não tem uma visão geral dos
seus arquivos, nem consegue trazer um arquivo próprio para o agente usar como
contexto. A página **Biblioteca** dá um lar para todos os artefatos do usuário
(criados pelo agente em qualquer conversa **e** enviados por ele), com busca,
filtros, prévia e gestão; os arquivos enviados ficam disponíveis ao agente pelas
tools `list_artifacts`/`read_artifact` que já existem.

**Current Behavior:**

- Artefatos nascem em `tools::artifacts::write_artifact` (`create_file` /
  `run_code`), sempre presos a `conversation_id` (coluna `NOT NULL`) e só são
  listados por conversa na UI (`list_artifacts(conversationId)`).
- O agente já tem `list_artifacts`/`read_artifact` com escopo de usuário
  (`db::list_all_artifacts`), mas a biblioteca só contém artefatos gerados.
- Não existe upload do usuário para a biblioteca, favorito, rename, filtros
  globais nem página de navegação (só a `SkillsView`, que substitui o chat).
- `activeView` do `uiStore` só tem `'chat' | 'skills'`.

**Expected Outcome:**

1. **Página Biblioteca** (`LibraryView`) renderizada no lugar da coluna do chat
   (mesmo padrão da `SkillsView`), acessível pelo item **Biblioteca** na sidebar
   **acima de Skills**, com “Voltar ao chat”.
2. **Lista global** de todos os artefatos (de todas as conversas + enviados),
   com **busca** (nome, conversa de origem, tipo), **filtros** em pills
   (`Tudo`, `Favoritos`, `Imagens`, `Documentos`, `Código`, `Mídia`, `Outros`),
   **ordenação** (Recentes, Mais antigos, Nome, Tamanho) e alternância
   **grade/lista**.
3. **Envio de arquivos** pela página (“Enviar arquivos…”, seletor nativo
   múltiplo; também drag & drop com a Biblioteca aberta) e por comando Tauri
   para os paths soltos. Arquivos enviados são persistidos no mesmo
   `artifacts/<id>/` + SQLite (`conversation_id = NULL`), com nome preservado
   (sanitizado), MIME/tipo inferidos e limite de tamanho/quantidade.
4. **Gestão na página**: prévia por tipo (reaproveitando `ArtifactPreview`),
   favoritar/desfavoritar, renomear (arquivo + registro), “Salvar como…”,
   “Abrir”, excluir com confirmação e navegação entre cards.
5. **Agente usa os arquivos enviados**: `list_artifacts` lista os arquivos sem
   conversa (origem “Biblioteca”), `read_artifact` lê por id/nome e o prompt
   documenta a origem. Nenhuma nova tool é necessária.
6. Migração **aditiva e idempotente** do banco: `artifacts.conversation_id`
   passa a aceitar `NULL` e ganha `favorite INTEGER NOT NULL DEFAULT 0`;
   bancos antigos preservam todos os dados e os testes existentes continuam
   passando.

**Target-Perspective Output:** o usuário abre **Biblioteca** na sidebar e vê
todos os arquivos (gerados e enviados) em cards com ícone por tipo, miniatura
para imagens, nome e origem. Ele pesquisa “relatório”, filtra **Documentos**,
favorita o PDF, abre a prévia, renomeia e exclui um arquivo antigo. Em seguida
usa **Enviar arquivos…** e adiciona `contrato.pdf`; o card aparece na hora. No
chat, pergunta “resuma o contrato.pdf da biblioteca” e o agente chama
`list_artifacts` (encontra o arquivo com origem “Biblioteca”), `read_artifact`
(extrai o texto do PDF) e responde usando o conteúdo real.

**Truth Owners:**

- Persistência/migração: `src-tauri/src/db.rs` (storage-dev).
- Comandos IPC: `src-tauri/src/commands/artifacts.rs` (storage-dev), registro em
  `src-tauri/src/lib.rs` (Lead).
- Writer de arquivos: `src-tauri/src/tools/artifacts.rs` (harness-dev).
- Tools/prompt: `src-tauri/src/tools/artifact_library.rs` +
  `src-tauri/src/harness/prompt.rs` (harness-dev).
- Contrato compartilhado: `src-tauri/src/domain.rs`, `src/lib/types.ts`,
  `src/lib/api.ts` (Lead).
- UI: `src/components/library/**` + paleta (ui-systems); sidebar (ui-core);
  integração em `src/App.tsx`, `uiStore`, hotkeys (Lead).
- Docs: Lead.

**Contract Boundary:** o renderer consome apenas os comandos abaixo (camelCase
no IPC). O agente consome apenas `list_artifacts`/`read_artifact` (contrato já
existente; muda a origem dos itens sem conversa). A UI continua lendo conteúdo
e prévias pelos comandos já existentes `get_artifact_content`/
`get_artifact_preview`.

**Cutover:** a funcionalidade é aditiva. O único caminho alterado é
`artifacts.conversation_id` (String → Option) e o writer compartilhado
(`write_artifact` ganha `Option<&str>`); todos os chamadores são atualizados no
mesmo turno de integração. `list_artifacts(conversationId)` (UI do painel)
continua existindo e filtrado por conversa; a Biblioteca usa o novo
`list_library_artifacts`. Não nasce segunda fonte de verdade: SQLite +
`artifacts/<id>/` continuam sendo a única persistência.

---

## 1. Escopo

**Entra:** página Biblioteca completa (grid/lista, busca, filtros, sort,
upload, miniatura, prévia, favoritar, renomear, salvar como, abrir, excluir),
comandos Tauri novos, migração do SQLite, tools/prompt do agente, sidebar,
paleta de comandos, hotkeys (Esc volta ao chat), testes e documentação.

**Não entra (v2+):** pastas/coleções e drag-and-drop entre pastas (a imagem de
referência tem “Pastas”, mas o pedido não pede e a estrutura exigiria novo
modelo), edição de conteúdo, OCR, sincronização externa, upload em lote por
diretório/recursivo, tags livres, mover artefato de conversa, compartilhamento.
“Sugestões” da imagem é substituído por ordenação por recentes + filtros.

## 2. Contrato de dados (Lead)

### 2.1 `domain.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    /// `None` = arquivo enviado pelo usuário direto à Biblioteca (sem conversa).
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub message_id: Option<String>,
    pub name: String,
    pub mime_type: String,
    pub kind: ArtifactKind,
    #[serde(default)]
    pub language: Option<String>,
    pub size: i64,
    pub created_at: i64,
    /// Marcado pelo usuário na Biblioteca (não influencia o agente).
    #[serde(default)]
    pub favorite: bool,
}

/// Artefato + título da conversa de origem, usado pela página Biblioteca.
/// `conversation_title == None` para arquivos enviados direto à biblioteca.
/// `#[serde(flatten)]`: o JSON tem os campos de `Artifact` no topo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryArtifact {
    #[serde(flatten)]
    pub artifact: Artifact,
    #[serde(default)]
    pub conversation_title: Option<String>,
}

/// Miniatura PNG gerada no backend para os cards de imagem da Biblioteca.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactThumbnail {
    pub mime: String,        // "image/png"
    pub data_base64: String,
    pub width: u32,
    pub height: u32,
}
```

### 2.2 `db.rs`

- Schema novo (novos bancos):
  `conversation_id TEXT` (nullable) e `favorite INTEGER NOT NULL DEFAULT 0`.
- Migração de bancos antigos (idempotente, dentro de `init_connection`):
  1. `PRAGMA table_info(artifacts)` → se `favorite` ausente, adiciona com
     `ALTER TABLE artifacts ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0`;
  2. se `conversation_id.notnull == 1`, reconstrói a tabela (create
     `artifacts_new` com o schema novo → `INSERT ... SELECT` copiando
     `favorite` quando existir → `DROP TABLE artifacts` → `RENAME`), em
     transação. Nenhum dado é perdido; linhas antigas ficam `favorite = 0`.
- `insert_artifact` aceita `conversation_id: Option<&str>`.
- Novos métodos (todos com teste):
  - `list_library_artifacts() -> Vec<LibraryArtifact>` — uma query
    (`LEFT JOIN conversations`) com títulos; ordem `created_at DESC, id DESC`.
  - `set_artifact_favorite(id, favorite) -> Option<Artifact>`.
  - `update_artifact_metadata(id, name, mime_type, kind, language) -> Option<Artifact>`
    (rename; path é atualizado no comando; o DB guarda os metadados).
  - `get_artifact`/`list_all_artifacts`/`delete_artifact` seguem, agora com
    `conversation_id` opcional e `favorite`.
- `delete_conversation` continua apagando só artefatos da conversa; uploads
  (`conversation_id = NULL`) sobrevivem. `reset_app_data` limpa tudo.

### 2.3 Comandos Tauri (`commands/artifacts.rs`, storage-dev)

| Comando | Assinatura | Comportamento |
| --- | --- | --- |
| `list_library_artifacts` | `() -> Vec<LibraryArtifact>` | todos os artefatos, mais recentes primeiro, com `conversationTitle` |
| `import_library_files` | `(paths: Vec<String>) -> Vec<Artifact>` | valida até 100 paths de arquivos regulares; importa cada um com `conversation_id = None`; retorna os importados (best-effort: se nenhum importou e houve erro, `Err` com o primeiro erro) |
| `rename_artifact` | `(id, name) -> Artifact` | sanitiza o nome (mantém a extensão original quando o novo nome não tem); renomeia o arquivo em `artifacts/<id>/`; recalcula MIME/kind/language pelo novo nome + bytes; atualiza o DB; erro quando id/nome inválido ou colisão no diretório |
| `set_artifact_favorite` | `(id, favorite) -> Artifact` | persiste o favorito e devolve o artefato atualizado |
| `get_artifact_thumbnail` | `(id) -> Option<ArtifactThumbnail>` | só para `ArtifactKind::Image`; decodifica (PNG/JPEG/GIF/WebP/BMP/ICO/TIFF — features do crate `image`), reduz para no máximo 512 px no maior lado, reencoda PNG; `None` para não-imagem/indecodificável |

Constantes: `MAX_LIBRARY_IMPORT_FILES = 100`,
`MAX_LIBRARY_IMPORT_BYTES = 256 MiB` por arquivo, miniatura
`THUMBNAIL_MAX_PX = 512`.

`delete_artifact`, `save_artifact`, `open_artifact`, `get_artifact_content`,
`get_artifact_preview` e `list_artifacts(conversationId)` **não mudam de nome**;
funcionam para arquivos da biblioteca (sem conversa).

### 2.4 Writer compartilhado (`tools/artifacts.rs`, harness-dev)

- `write_artifact(db, data_dir, conversation_id: Option<&str>, message_id:
  Option<&str>, name, bytes, mime_hint)` — só muda a assinatura; chamadores
  (`create_file`, `run_code`) passam `Some(&conversation_id)`.
- Novo `pub fn write_artifact_file(db, data_dir, conversation_id: Option<&str>,
  source: &Path) -> anyhow::Result<Artifact>`:
  - nome = `file_name` do source sanitizado (`sanitize_filename`), extensão
    inferida/adicionada só quando ausente (igual ao writer atual);
  - MIME por extensão → magic bytes (lê só os primeiros 16 KB), kind e
    language pelas mesmas funções do writer;
  - copia os bytes para `artifacts/<uuid>/<nome>` (`fs::copy`, sem carregar o
    arquivo inteiro na memória), tamanho vindo de `metadata`;
  - grava `StoredArtifact` com `conversation_id`, `message_id = None`,
    `favorite = false`; remove o arquivo se o INSERT falhar.
- `commands::artifacts::import_library_files` usa esse helper (uma única
  implementação de classificação/persistência).

### 2.5 `types.ts` / `api.ts` (Lead)

```ts
export interface Artifact {
  id: string;
  /** `null` = arquivo enviado direto à Biblioteca. */
  conversationId: string | null;
  messageId?: string | null;
  name: string;
  mimeType: string;
  kind: ArtifactKind;
  language?: string | null;
  size: number;
  createdAt: number;
  favorite?: boolean;
}

export interface LibraryArtifact extends Artifact {
  /** Título da conversa de origem; `null` para arquivos enviados. */
  conversationTitle?: string | null;
}

export interface ArtifactThumbnail {
  mime: string;
  dataBase64: string;
  width: number;
  height: number;
}
```

```ts
listLibraryArtifacts: () => invoke<LibraryArtifact[]>('list_library_artifacts'),
importLibraryFiles: (paths: string[]) =>
  invoke<Artifact[]>('import_library_files', { paths }),
renameArtifact: (id: string, name: string) =>
  invoke<Artifact>('rename_artifact', { id, name }),
setArtifactFavorite: (id: string, favorite: boolean) =>
  invoke<Artifact>('set_artifact_favorite', { id, favorite }),
getArtifactThumbnail: (id: string) =>
  invoke<ArtifactThumbnail | null>('get_artifact_thumbnail', { id }),
```

`favorite` é **opcional** no TS para não churnar fixtures antigas; o backend
sempre serializa o booleano.

### 2.6 `uiStore` / hotkeys / App (Lead)

- `MainView = 'chat' | 'skills' | 'library'`.
- `HotkeySnapshot` ganha `libraryView?: boolean`; Esc em `library` também
  retorna ao chat (`return-to-chat`). `App.tsx` passa
  `libraryView: ui.activeView === 'library'`.
- `App.tsx`: chat continua montado (`hidden`) e `LibraryView` ocupa a coluna
  quando `activeView === 'library'`; drag & drop nativo, com a Biblioteca
  aberta, emite `CustomEvent('lumina:library-drop')` com `{ paths }` (e
  `lumina:library-drag`, `{ active }`, no enter/leave) em vez de adicionar
  anexos ao composer.

## 3. Integração com o agente (harness-dev)

- `tools::artifact_library`:
  - `LibraryEntry.current = artifact.conversation_id.as_deref() ==
    Some(rt.conversation_id)`.
  - Artefato sem conversa: `conversationId: null`, `conversationTitle: null`,
    `currentConversation: false`; a proveniência legível é
    `Biblioteca (enviado pelo usuário)` (constante
    `LIBRARY_ORIGIN_LABEL`) no `read_artifact` e nos candidatos de nome.
  - `list_note`/`description` das tools citam que a biblioteca inclui arquivos
    enviados pelo usuário (sem conversa).
- `harness/prompt.rs`: a seção “Biblioteca de artefatos” explica que
  `conversationTitle: null` significa arquivo enviado pelo usuário na
  Biblioteca (usar `read_artifact` normalmente) e mantém a regra de dados não
  confiáveis.
- `tools/create_file.rs` e `tools/code_exec.rs`: chamadas de `write_artifact`
  com `Some(&conversation_id)`.
- `AgentSteps`/`agentTrace` não mudam (nomes de tool iguais).

## 4. UI — especificação (ui-systems + ui-core)

### 4.1 Sidebar (ui-core)

Item **Biblioteca** imediatamente **acima** de **Skills** (ordem: Novo chat,
Biblioteca, Skills, Buscar conversas), com ícone `Library`, `aria-current`
quando `activeView === 'library'`, navegação por `setActiveView('library')` e
fechamento do drawer em tela compacta. Skills continua condicionado a
`skillsPanelEnabled`; Biblioteca é sempre visível.

### 4.2 Página (`src/components/library/**`)

Estrutura seguindo o conceito de `REFERENCE.png`:

```
┌ Biblioteca [título 19-20px] ───────────────────────────────────────────────┐
│ descrição curta muted       [busca pill]  [sort ▾] [grade|lista] [Enviar]  │
│ ( pills: Tudo · Favoritos · Imagens · Documentos · Código · Mídia · Outros )│
│ ┌ card ┐ ┌ card ┐ ┌ card ┐ ┌ card ┐ …                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

- Header sem borda dura (mesmo tom da `SkillsView`); botão secundário
  “Voltar ao chat” (→ `setActiveView('chat')`), foco inicial na view.
- **Busca** (`type="search"`, ícone `Search`, botão limpar): nome, tipo
  (label do kind) e título da conversa de origem; normaliza acentos/caixa como
  o backend.
- **Filtros** em pills (segmented/toggle): `Tudo`, `Favoritos`, `Imagens`
  (image, svg), `Documentos` (pdf, docx, xlsx, pptx, markdown, html, text, csv),
  `Código` (code, json), `Mídia` (audio, video), `Outros` (archive, binary);
  contador por filtro no `title`/aria-label; estado vazio de filtro com
  “Limpar filtros”.
- **Sort** (`DropdownMenu`): Recentes (padrão), Mais antigos, Nome (A–Z),
  Tamanho (maiores). Persistência apenas local à view.
- **Grade/lista** (`SegmentedControl` com ícones `LayoutGrid`/`List`,
  `aria-label`): grade `repeat(auto-fill, minmax(180px, 1fr))`; lista em linhas.
- **Card (grade)**: `rounded-xl border border-border bg-surface-raised`, com
  hover `border-border-strong`; topo: tile do tipo (tokens `meta.tone`),
  nome truncado em até 2 linhas, estrela de favorito (sempre visível quando
  favorito; aparece no hover/focus quando não) e menu `⋯` (Renomear,
  Favoritar/Desfavoritar, Salvar como…, Abrir, Excluir); corpo: miniatura para
  imagens (via `getArtifactThumbnail`, lazy, com fallback para o ícone grande
  do tipo) ou ícone grande do tipo centralizado; rodapé: `label · tamanho`,
  data curta e origem (`Biblioteca` ou título truncado da conversa).
- **Lista**: mesma informação em linha (ícone, nome, tipo, origem, tamanho,
  data, favorito, menu); alvo de clique acessível (`button`), foco visível.
- **Estado vazio** (biblioteca sem arquivos): ícone `Library`, “Sua biblioteca
  está vazia”, texto explicando que o agente cria arquivos e que o usuário pode
  enviar, CTA **Enviar arquivos**.
- **Upload**: botão primário **Enviar arquivos** com `Upload`; abre o seletor
  nativo (`@tauri-apps/plugin-dialog`, `open({ multiple: true })`, como no
  Composer), chama `api.importLibraryFiles(paths)`, atualiza a lista, mostra
  toast “N arquivo(s) enviado(s)” e estado `loading`. Drag & drop (evento do
  App) importa os paths e mostra overlay “Solte para enviar à biblioteca”.
- **Prévia (dialog)**: reusa `ArtifactPreview` dentro de `DialogContent`
  (`size="2xl"`); header com ícone, nome, badges tipo/tamanho/origem/data,
  ações (favoritar, renomear inline, Salvar como…, Abrir, Excluir com
  confirmação, fechar) e navegação anterior/próximo entre os itens filtrados;
  footer “X de N”; estados de carregamento/erro (como no painel).
- **Rename no dialog**: input com `Enter` salva, `Esc` cancela, `api.renameArtifact`
  e atualização da lista/artefato ativo.
- **Excluir**: barra de confirmação inline (mesmo padrão do `ArtifactPanel`),
  `api.deleteArtifact`, remove do estado, fecha o dialog se era o ativo.
- Acessibilidade: `aria-label` em todos os ícones-botão, foco visível, roles
  de lista/grade, cards são botões; toasts em pt-BR.

### 4.3 Paleta de comandos (ui-systems)

- “Abrir biblioteca” (grupo navegação, ícone `Library`) → `setActiveView('library')`.
- “Enviar arquivos para a biblioteca” (ação) — abre a view e aciona o picker
  via evento `lumina:library-import` ouvido pela view.
- “Voltar ao chat” também quando `activeView === 'library'`.

## 5. Testes (matriz TDD)

**Rust (`cargo test --lib`, storage-dev + harness-dev):**

- `db`: migração de banco antigo (tabela com `conversation_id NOT NULL`, sem
  `favorite`) preserva linhas, aceita upload sem conversa e `favorite`;
  `list_library_artifacts` (ordem desc, títulos por conversa, upload sem
  título); `set_artifact_favorite`; `update_artifact_metadata`; round-trip
  `conversation_id: None`.
- `commands::artifacts`: `import_library_files` importa N arquivos reais de
  temp dir (nome/MIME/kind/bytes/tamanho, `conversation_id: null`), rejeita
  diretório/arquivo inexistente/sem permissão, respeita caps, não quebra o
  banco quando um item falha; `rename_artifact` (sanitização, extensão,
  arquivo no disco, kind/language recalculados, id inexistente, colisão);
  `set_artifact_favorite`; `get_artifact_thumbnail` (PNG reduzido, TIFF
  convertido, não-imagem → `None`, arquivo ausente → `None`); `delete_artifact`
  de upload.
- `tools::artifacts`: `write_artifact` com `None` grava sem conversa;
  `write_artifact_file` copia bytes reais, infere nome/mime/kind, não carrega
  o arquivo em memória (teste com arquivo grande), remove em erro de insert.
- `tools::artifact_library`: biblioteca com artefato gerado + upload (sem
  conversa) lista ambos; JSON do upload com `conversationId: null`,
  `conversationTitle: null`, `currentConversation: false`; `read_artifact` por
  id/nome de upload com cabeçalho “Biblioteca (enviado pelo usuário)”; busca
  por nome/conteúdo continua.
- `harness::prompt`: seção cita arquivos enviados à biblioteca.

**Renderer (`pnpm test`, ui-systems + ui-core + Lead):**

- `LibraryView.test.tsx`: loading/erro/retry; vazio com CTA; lista mockada
  agrupada em cards; busca; cada filtro; sort; grade/lista; upload (mock do
  `plugin-dialog` + `api.importLibraryFiles`) atualiza a lista; favoritar
  chama a API e reflete estrela; abrir prévia; renomear; excluir com
  confirmação; drag & drop (custom event) importa; “Voltar ao chat”.
- `LibraryCard`/`LibraryPreview`/helpers de filtro: sem testes frágeis de
  pixels; testar comportamento/aria.
- `Sidebar.test.tsx`: item Biblioteca acima de Skills, `activeView` e
  `aria-current`, ordem no DOM, compact drawer fecha.
- `hotkeys.test.ts`: Esc em library → `return-to-chat`.
- Fixtures de `Artifact` existentes continuam compilando (`favorite` opcional,
  `conversationId` nullável).

## 6. Riscos / mitigação

| Risco | Mitigação |
| --- | --- |
| Migração SQLite corromper/apagar artefatos | transação + teste com banco antigo real (arquivo temporário); schema novo idempotente |
| Upload gigante estourar memória | `fs::copy` sem buffer completo; caps 256 MiB/arquivo e 100 arquivos; miniatura decodifica com limite de tamanho e cai no ícone |
| Miniatura de imagem enorme travar/estourar | só imagens; `image` decodifica e reduz; `None` em falha; UI usa fallback |
| Cache/segunda fonte de verdade | lista sempre vem do SQLite; nenhum índice paralelo; store local só para a resposta |
| Artefato sem conversa quebrar tools/UI existentes | `Option<String>` em todo o caminho + testes de chat/painel; comparações usam `as_deref` |
| Upload com nome perigoso | `sanitize_filename` (mesma do writer), diretório único por id, sem traversal |
| UI nova destoar do design system | tokens (sem hex), componentes `components/ui`, seguir `DESIGN.md` §3/§15 |
| Conflitos de arquivo entre agentes | escopos de escrita disjuntos por task; Lead revisa diff e roda a suíte |

**Kill criteria:** (1) perda de qualquer artefato existente na migração →
blocker; (2) upload ficar inacessível ao agente (fora do `list_all_artifacts`)
→ blocker; (3) duplicar writer/classificação de arquivo em outro módulo →
parar e usar `tools::artifacts`; (4) depender de serviço externo/nova rede →
fora de escopo; (5) UI usar hex/`style` inline para cores → corrigir antes de
fechar.

## 7. Divisão de trabalho (write scopes)

| Dono | Task | Escopo |
| --- | --- | --- |
| **Lead** | contract-and-integration | `src-tauri/src/domain.rs`, `src/lib/types.ts`, `src/lib/api.ts`, `src/lib/store/uiStore.ts`, `src/lib/hotkeys.ts`, `src/App.tsx`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `docs/**` |
| **storage-dev** | db-commands | `src-tauri/src/db.rs`, `src-tauri/src/commands/artifacts.rs` |
| **harness-dev** | tools-prompt | `src-tauri/src/tools/artifacts.rs`, `src-tauri/src/tools/create_file.rs`, `src-tauri/src/tools/code_exec.rs`, `src-tauri/src/tools/artifact_library.rs`, `src-tauri/src/harness/prompt.rs` |
| **ui-systems** | library-view | `src/components/library/**`, `src/components/palette/usePaletteActions.ts`, `src/components/palette/CommandPalette.test.tsx` |
| **ui-core** | sidebar | `src/components/layout/Sidebar.tsx`, `src/components/layout/Sidebar.test.tsx` |

Dependências: contrato (Lead) → storage/harness em paralelo (harness entrega
`write_artifact_file` cedo) → UI em paralelo (mock de API) → Lead integra
(App/lib.rs) → suíte completa.

## 8. Verificação / evidência

- `cd src-tauri && cargo check && cargo test --lib`
- `pnpm typecheck && pnpm test && pnpm build`
- `EVIDENCE.md` com contagens e testes nomeados; nota de QA manual (abrir
  Biblioteca, enviar arquivo, perguntar ao agente) sem automação de GUI.

Critérios de pronto: todos os comandos/telas acima funcionando de verdade (sem
mock na integração), testes verdes (exceto flake pré-existente documentado),
sem `todo!()`, docs atualizados (`ARCHITECTURE.md` §11/§12, `FILES.md`,
`DESIGN.md` §5, `README`).
