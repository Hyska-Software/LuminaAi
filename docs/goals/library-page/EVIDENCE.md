# Página Biblioteca — Evidência

> Plano: `docs/goals/library-page/PLAN.md` · referência visual:
> `docs/goals/library-page/REFERENCE.png` · decisão:
> `docs/ARCHITECTURE.md` §16 #16 · contrato: `docs/FILES.md` §14 (v1.8).

**Status: implementado e verificado por testes automatizados.** A única etapa
não automatizada (proibida pelo repositório) é a inspeção visual manual no app
— nota de QA no fim.

## 1. O que foi entregue

| Área | Arquivos |
| --- | --- |
| Página Biblioteca | `src/components/library/{index,LibraryView,LibraryToolbar,LibraryFilters,LibraryCard,LibraryThumbnail,LibraryPreviewDialog,filters}.ts(x)` + `LibraryView.test.tsx`, `filters.test.ts` |
| Sidebar | `src/components/layout/Sidebar.tsx` (item Biblioteca acima de Skills) + `Sidebar.test.tsx` |
| Paleta / hotkeys | `src/components/palette/usePaletteActions.ts` + `CommandPalette.test.tsx`; `src/lib/hotkeys.ts` + `hotkeys.test.ts` |
| Integração | `src/App.tsx` (view + drag & drop + snapshot de hotkey), `src/lib/store/uiStore.ts` (`'library'`), `src-tauri/src/lib.rs` (registro dos 5 comandos) |
| Contratos | `src-tauri/src/domain.rs`, `src/lib/types.ts`, `src/lib/api.ts` (`Artifact` com `conversationId: Option` + `favorite`, `LibraryArtifact`, `ArtifactThumbnail`, 5 métodos novos na API) |
| Banco/comandos | `src-tauri/src/db.rs` (schema + migração + queries), `src-tauri/src/commands/artifacts.rs` (comandos + miniatura) |
| Agente | `src-tauri/src/tools/artifacts.rs` (writer `Option<conversation_id>` + `write_artifact_file` + `classify_file`), `tools/create_file.rs`, `tools/code_exec.rs`, `tools/artifact_library.rs` (origem “Biblioteca”), `harness/prompt.rs` |
| Dependências | `src-tauri/Cargo.toml` (decodificadores de imagem para a miniatura) |
| Docs | este arquivo, `docs/ARCHITECTURE.md` §§5/11/12/15/16, `docs/FILES.md` §14 (v1.8) e §15, `docs/DESIGN.md` §§5/12/14, `README.md` |

## 2. Contrato entregue

```text
Artifact { conversationId: string|null, favorite: bool, ... }
LibraryArtifact = Artifact + conversationTitle: string|null   (JSON achatado via serde(flatten))
ArtifactThumbnail { mime, dataBase64, width, height }

list_library_artifacts() -> LibraryArtifact[]      // desc por created_at, id
import_library_files(paths) -> Artifact[]          // conversation_id = NULL
rename_artifact(id, name) -> Artifact
set_artifact_favorite(id, favorite) -> Artifact
get_artifact_thumbnail(id) -> ArtifactThumbnail|null
```

Decisões de implementação (pequenos desvios do plano, semântica equivalente):

- `rename_artifact` usa `db::update_artifact_rename` (metadados **e** path no
  mesmo UPDATE); `db::update_artifact_metadata` existe e é coberto por testes
  do banco, mas não é o caminho de produção (evita linha divergente).
- `import_library_files` é best-effort por arquivo e só devolve `Err` quando
  **nenhum** arquivo importou; acima de 100 paths o excedente é ignorado (não
  é erro).
- A miniatura decodifica com `image::Limits` (16.384 px / 256 MiB), reduz para
  ≤512 px no maior lado sem upscale e devolve `null` em qualquer falha — a UI
  cai no ícone do tipo.
- A lista da página é carregada inteira (SQLite + `LEFT JOIN` de títulos) e
  busca/filtros/ordenação são aplicados no renderer; não há índice paralelo.
- `favorite` é opcional no tipo TS (payloads/fixtures antigos) e sempre
  serializado pelo backend.

## 3. Verificação (árvore final)

| Comando | Resultado |
| --- | --- |
| `cd src-tauri && cargo check` | exit 0 (13 warnings pré-existentes em config/oauth/providers/state/models; nenhum nos arquivos novos) |
| `cd src-tauri && cargo test --lib` | **515 passed; 0 failed; 10 ignored** (baseline da sessão: 476/0/10; +39 nesta feature) |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | **70 arquivos / 1431 testes passed** (baseline: 68 arquivos / 1363 testes, destes 1 flake pré-existente; +68 nesta feature: `filters.test.ts` 19, `LibraryView.test.tsx` 41, `Sidebar.test.tsx` +5, `CommandPalette.test.tsx` +3) |
| `pnpm build` | OK (`tsc --noEmit` + Vite; chunk principal e lazy chunks inalterados) |

### Testes que provam os aceites

**Rust — banco/migração (`db`):**

- `migrates_legacy_artifacts_table_preserving_rows_and_allowing_uploads` —
  banco antigo (arquivo temporário real) com `conversation_id NOT NULL` migra
  preservando linha/path/nome/kind e passa a aceitar upload sem conversa.
- `migration_is_idempotent_when_favorite_already_exists` — reabrir o banco não
  reconstrói de novo nem perde dados (estado intermediário da migração).
- `list_library_artifacts_orders_desc_and_joins_conversation_titles` — ordem
  `created_at DESC, id DESC` e título da conversa de origem (upload → `None`).

**Rust — comandos (`commands::artifacts`):**

- `import_library_files_copies_real_files_without_a_conversation` — PNG/PDF/TXT
  reais copiados byte a byte para `artifacts/<id>/`, kind/MIME/tamanho corretos,
  `conversation_id: None`; `list_library_artifacts` devolve `conversationTitle`
  nulo para uploads.
- `import_library_files_is_best_effort_and_reports_the_first_error` — caminho
  válido + ausente importa o válido; diretório/inexistente sem nenhum válido →
  `Err` com o primeiro erro; lista vazia é no-op.
- `import_library_files_respects_the_file_count_and_size_caps` e
  `import_library_files_keeps_the_sanitized_upload_name`.
- `rename_artifact...` — extensão preservada, MIME/kind/language recalculados,
  colisão/id inválido/arquivo ausente → `Err`, arquivo físico renomeado.
- `set_artifact_favorite_returns_the_updated_artifact_or_errors` e
  `delete_artifact_removes_an_upload_and_its_files`.
- `get_artifact_thumbnail...` — PNG 960×540 → 512×288 sem upscale, TIFF
  convertido para PNG; não-imagem/arquivo ausente → `Ok(None)`.

**Rust — agente (`tools`/`harness`):**

- `write_without_conversation_registers_a_library_upload` (writer `None`);
  `write_artifact_file` copia arquivos reais, classifica nome/MIME/kind e não
  carrega o arquivo inteiro em memória (teste com 12 MB); INSERT falho remove a
  cópia.
- `lists_user_uploads_without_a_conversation`,
  `reads_user_uploads_by_id_and_name_with_library_origin`,
  `ambiguous_names_show_the_library_origin_for_uploads`,
  `search_finds_user_uploads_by_name_and_content`,
  `search_notes_mention_user_uploads` — upload aparece em `list_artifacts` com
  `conversationId`/`conversationTitle` nulos, abre por id/nome e o
  `read_artifact` mostra `Origem: Biblioteca (enviado pelo usuário)`.
- `prompt_documents_the_artifact_library_tools` e
  `prompt_documents_user_uploads_in_the_artifact_library` — prompt explica a
  origem “Biblioteca” e mantém a regra de dado não confiável.
- Loop do harness (v1.7, mantido verde) prova que o conteúdo lido pela
  biblioteca chega ao histórico do modelo.

**Renderer (`pnpm test`):**

- `LibraryView.test.tsx` — render como view principal; foco; loading; erro +
  retry; vazio com CTA; cards com tipo/tamanho/data/origem; busca sem acentos e
  limpar; cada filtro; filtro sem resultados; “Recentes” padrão e os 4 sorts;
  grade/lista; upload pelo seletor nativo (toast, re-list, “Enviando…”); drag &
  drop pelo evento do App; `lumina:library-import` da paleta; favoritar/
  desfavoritar com rollback; miniatura com fallback; prévia com conteúdo,
  navegação anterior/próximo e footer “X de N”; favoritar pela prévia; salvar
  como/abrir; renomear com Enter/Salvar, cancelar com Esc, erro inline; excluir
  com confirmação/cancelamento; “Voltar ao chat”.
- `filters.test.ts` — normalização sem acentos, categorias (todos os 16 kinds),
  ordenação, contagens e datas.
- `Sidebar.test.tsx` — item Biblioteca **acima** de Skills na ordem do DOM,
  ícone/tamanho, clique muda `activeView`, `aria-current`, visível com
  `skillsPanelEnabled: false`, fecha drawer compacto, regressão “Novo chat”.
- `hotkeys.test.ts` — Esc em `libraryView` retorna ao chat (incl. streaming;
  asserções adicionadas ao teste de precedência existente).
- `CommandPalette.test.tsx` — “Abrir biblioteca” navega; “Enviar arquivos para
  a biblioteca” troca a view e dispara `lumina:library-import`; “Voltar ao
  chat” aparece na biblioteca.

## 4. Nota de QA manual (release)

Sem automação de UI (regra do repositório). Roteiro a conferir em
`pnpm app:dev`:

1. Sidebar: item **Biblioteca** acima de **Skills**; abrir/fechar pelos atalhos
   (Esc volta ao chat).
2. Enviar 2–3 arquivos (PNG, PDF, TXT) pelo botão e por drag & drop sobre a
   página: cards aparecem sem reload, com miniatura/origem “Biblioteca”.
3. Favoritar → pill **Favoritos**; renomear → nome no card e no disco; excluir
   → confirmação e desaparecimento; **Salvar como…** e **Abrir** funcionam.
4. Abrir a prévia de cada tipo (PDF/Markdown/imagem) e navegar anterior/próximo.
5. No chat, perguntar “resuma o contrato.pdf que eu enviei”: a timeline mostra
   `list_artifacts` → `read_artifact` e a resposta cita o conteúdo/arquivo.
6. Um banco antigo (de uma instalação anterior) abre com todos os artefatos
   antigos na Biblioteca (`favorite = 0`), sem exclusões.

## 5. Limitações conhecidas / riscos aceitos

- Pastas/coleções, edição de conteúdo, OCR e upload recursivo de diretórios
  ficam fora do escopo (v2) — a imagem de referência serviu como conceito de
  layout, não como lista fechada de features.
- A página carrega a biblioteca inteira e filtra no renderer (tabela pequena no
  uso real); não há paginação no SQL. As miniaturas são decodificadas por
  requisição, sem cache (limite de 512 px/16k px de decodificação evita abuso).
- Excluir uma conversa continua removendo os artefatos dela (comportamento
  anterior); uploads da Biblioteca (`conversation_id NULL`) sobrevivem.
- Renomear mudando apenas maiúsculas/minúsculas é recusado como colisão em
  filesystems case-insensitive (Windows/macOS) — conservador e documentado.
- `run_code`/`create_file` seguem gravando artefatos com conversa; nada no
  fluxo do agente mudou além da nova origem de upload.
- Flake pré-existente observado no baseline: `ModelPill.edge.test.tsx` (timing
  de 40 ms). Não é relacionado a esta feature; as execuções finais passaram.
