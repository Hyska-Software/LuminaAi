# EVIDENCE — Sessões separadas Chat/Code + compartilhamento (fase 1.1)

> Verificação independente da `task-7` (verifier). Somente leitura no código do app; este é o único
> arquivo escrito. Workdir: `H:\ChatTauri`. Data: **2026-10-27** (execução ~12:00–12:14,
> America/Sao_Paulo).

## 0. Snapshot verificado

| Item | Valor |
| --- | --- |
| `HEAD` | `2b260d23f8b434d2fe05bc7ab13b32e5e8cd5d3e` — "Add Chat and Code layout modes" (docs de planejamento; nenhum código do goal commitado) |
| `git diff` (tracked, não commitado) | hash `e26643f966b02eb4e26f8240d22a8ea83718f33a` |
| Arquivos não rastreados | hash agregado `a7a2c3f699a30253ff204fa770c5e1916ea1fc58` (32 arquivos) |
| Estabilidade | `git diff` com o mesmo hash nas medições de 12:08:06 e 12:12:59 (`e26643f9…`); nenhum arquivo de `src/**`, `src-tauri/src/**` ou `docs/**` (fora deste EVIDENCE) foi escrito depois de 11:55:01 → nada mudou durante a verificação |
| `git status` | **46 entradas rastreadas alteradas** (34 modificadas + 12 deleções de PNGs de refs movidos) e **32 não rastreadas** (17 arquivos-fonte em `src/**`, 2 docs do goal, 12 PNGs de refs movidos, 1 `EVIDENCE.md` da fase 1) |
| `git diff --stat` | 46 arquivos, `+1556 / −176`; em `src-tauri/**`: 4 arquivos, `+390 / −9` |
| Commits | **nenhum commit novo** desde o `HEAD` (docs). O working tree também contém os entregáveis da fase 1 ainda não commitados (`src/components/code/**`, `LayoutModeSwitch`, `WorkspaceCenter`), além das mudanças desta fase |

## 1. Comandos e resultados

| # | Comando | Resultado |
| --- | --- | --- |
| 1 | `git status --short --untracked-files=all` / `git diff --stat` | 46 tracked + 32 untracked; sem commits do goal; `src-tauri` com 4 arquivos alterados |
| 2 | `pnpm typecheck` (`tsc --noEmit`) | **verde**, exit `0` |
| 3 | `pnpm test` (`vitest run`) | **verde**, exit `0`: `Test Files 78 passed (78)` / `Tests 1537 passed (1537)`, 112,27 s |
| 4 | `pnpm exec vitest run src/components/code src/lib/__tests__/conversations.test.ts` | **verde**, exit `0`: `6 passed (6)` / `61 passed (61)` (5 arquivos de teste de `code/**` + `conversations`) |
| 5 | 16 arquivos novos/alterados com `--sequence.shuffle` | **verde**, exit `0`: `16 passed (16)` / `254 passed (254)`, 26,38 s — sem dependência de ordem nesse subconjunto |
| 6 | `pnpm build` (`tsc --noEmit && vite build`) | **verde**, exit `0`, `✓ built in 10.31s`; aviso de chunk > 1500 kB (`index-*.js` ≈ 1.968 MB) pré-existente/tolerado |
| 7 | `cd src-tauri; cargo test --lib` | **verde**, exit `0`: `test result: ok. 523 passed; 0 failed; 10 ignored; 0 measured; 0 filtered out; finished in 6.29s` |
| 8 | `cargo test --lib -- conversation` | **verde**: `28 passed; 0 failed` (505 filtrados) incluindo os **8 testes novos** (6 em `db::tests`, 2 em `domain::tests`) |
| 9 | grep de `#[0-9a-fA-F]{3,8}`, `rgb()/hsl()` em todo `.ts/.tsx` novo/alterado | **0 ocorrências** |
| 10 | grep de `.skip/.only/.todo` recém-adicionados, `console.log`, `TODO/FIXME` e dados fake em código de produto | **nenhuma ocorrência** |

Contagens: suíte passou de **76 arquivos / 1503 testes** (registro da fase 1) para **78 arquivos /
1537 testes** (+2 arquivos, +34 testes); Rust `523 passed / 0 failed / 10 ignored` — os 8 testes
novos reportados pelo storage-dev foram reconfirmados em execução (`cargo test --lib -- conversation`
lista os 8 nomes).

## 2. Regras de produto (checklist item a item)

Legenda: ✅ ok · ⚠️ ok com ressalva (ver §5) · ❌ falha.

### 2.1 Isolamento das superfícies (nenhum vazamento entre layouts)
- ✅ **Fonte única**: `src/lib/conversations.ts` é usada pelos 6 módulos de produção
  (`Sidebar.tsx:21,253`, `CodeSidebar.tsx:4,121-125`, `CodeSessionHeader.tsx:4,47-50`,
  `CommandPalette.tsx:26,145-147,171`, `useConversationSearch.ts:3,63-79`,
  `chatStore.ts:19,288-290,600,612-616,739`). Não há filtro de visibilidade duplicado em
  componentes; só checagens de apresentação (`codeLinked` para selo/menu: `CodeSidebar.tsx:261`,
  `Sidebar.tsx:217-220,308`).
- ✅ **Sidebar do Chat**: lista `mode !== 'code'` (compartilhadas continuam) — teste
  `Sidebar.test.tsx:303-357` ("lists Chat sessions only…", "adds a Chat session…",
  "offers removing the link…").
- ✅ **Sidebar do Code**: lista `mode === 'code' || codeLinked` e marca as compartilhadas com o selo
  "Do Chat" — `CodeSidebar.tsx:121-125,300-328` + testes.
- ✅ **Abas do Code**: só sessões visíveis no Code; a sessão ativa exclusiva do Chat não vira
  título/aba ("Nova sessão") — `CodeSessionHeader.tsx:47-50,71-94` + testes de separação
  (`CodeSessionHeader.test.tsx:388-433`).
- ✅ **Paleta (busca e recentes)**: recentes filtrados por layout (`CommandPalette.tsx:142-172`);
  busca local filtra a lista do store e a resposta do backend (`useConversationSearch.ts:60-99`,
  incl. `isConversationVisibleIn` nos resultados remotos). Testes em `CommandPalette.test.tsx`
  ("sessões separadas Chat/Code": Code invisível no Chat na lista e na busca; busca do Code só acha
  Code; resultado remoto de outro layout é descartado).
- ✅ **Backend** devolve todas as sessões com `mode`/`codeLinked`; o recorte é do renderer (como no
  PLAN §1) — `db.rs` list/search com `CONVERSATION_COLUMNS` + testes.
- ⚠️ **Centro**: não há guarda no `WorkspaceCenter`; a integridade depende exclusivamente de
  `enterLayout` (ver R3). Não achei caminho de UI que abra a sessão do outro layout no centro
  (todas as chamadas de `openConversation` vêm de listas filtradas/paleta escopada/diálogo de
  vínculo), mas não existe teste de integração do centro — R3.

### 2.2 Sessão compartilhada (mesma conversa, sem duplicar; remover não afeta o Chat)
- ✅ **Adicionar pelo diálogo do Code**: `AddChatSessionDialog` lista somente
  `chatConversationsAvailableToLink` (Chat e ainda não compartilhadas), vincula via
  `setConversationCodeLinked`, fecha e abre a mesma conversa — testes de lista, busca, estados
  vazios, sucesso (conversa continua 1 na lista, `codeLinked: true`) e falha com toast/role=alert
  (`AddChatSessionDialog.test.tsx:89-233`).
- ✅ **Adicionar pelo menu do Chat**: itens "Usar no Code"/"Remover do Code" no menu da conversa
  (`Sidebar.tsx:213-222,307-321`) com toasts de confirmação; testes cobrem as duas ações.
- ✅ **Mesma conversa, sem duplicação**: backend faz `UPDATE conversations SET code_linked` (sem
  nova linha) e devolve a conversa (`db.rs:774-803`); o renderer substitui o item na lista in-place
  (`chatStore.ts:639-652`) e o teste do diálogo confirma `conversations` com 1 item após vincular.
- ✅ **Remover só tira do Code**: o vínculo é apenas o booleano; `mode` continua `chat` e a lista do
  Chat independe de `codeLinked` (`conversations.ts:20-22`) — backend testado
  (`links_and_unlinks_a_chat_conversation_to_code`) e coberto na UI (menu "Remover do Code").
- ✅ **Validação**: sessão do Code não pode ser compartilhada nem desvinculada (erro pt-BR
  "somente sessões do Chat") e id inexistente devolve erro claro — testes Rust.

### 2.3 Sessão ativa por layout / estado vazio / nada de stale
- ✅ `chatStore.activeIdByLayout` + `enterLayout` + `rememberActive`; `App.tsx:127-130` chama
  `enterLayout(layoutMode)` em `useLayoutEffect` quando `ready`; `init()` abre a primeira sessão
  visível no layout persistido (`chatStore.ts:591-606,610-629`).
- ✅ Testes de store: restaura cada layout sem vazar, sessão compartilhada, criação por modo,
  `clearActiveConversation` preservando a memória do outro layout, fallback de exclusão só com
  sessões do layout atual (`chatStore.test.ts:808-955`).
- ✅ Layout sem sessões → `activeId = null` → welcome do layout (Chat/Code); nenhuma seleção é
  tomada do outro layout.
- ⚠️ A restauração passa por `openConversation`, que **reseta o estado de página** dos dois layouts
  (Biblioteca/Skills) — R1.
- ⚠️ O `enterLayout` pode não registrar a sessão lembrada no early-return — R2.
- ⚠️ O estado "Nova sessão" (welcome após fechar a última aba) não é lembrado ao alternar layouts —
  O1.

### 2.4 Criação/envio no layout corrente
- ✅ Envio no welcome: `ensureConversation` cria com `mode = currentLayout()` e registra a memória
  (`chatStore.ts:559-577`); teste de `send` no Code cria com `'code'`.
- ✅ `startNewConversation(mode?)` cria no modo pedido (`chatStore.ts:691-725`): "Novo agente" do
  Code sidebar/header → `'code'` (testes); "Novo chat" do Chat → `'chat'`; hotkey Ctrl+N usa o
  layout atual; paleta "Novo chat"/"Novo agente" coerente e cobrada em teste.
- ✅ "Novo agente" no Code cria `mode: 'code'` e não vaza para o Chat (lista do Chat filtra).

### 2.5 Biblioteca / Skills
- ✅ Biblioteca continua somente no Chat (`WorkspaceCenter.tsx:29,62`; paleta esconde comandos no
  Code; drag&drop só no Chat) — testes da fase 1 seguem verdes.
- ✅ Skills nos dois modos (`codeView` no Code/`activeView` no Chat; `onBack`/`backLabel`; paleta
  escopada) — testes da fase 1 + paleta verdes.

### 2.6 Migração e contrato Rust ↔ TS
- ✅ SQLite: `mode TEXT NOT NULL DEFAULT 'chat'` e `code_linked INTEGER NOT NULL DEFAULT 0` no
  schema novo; migração aditiva/idempotente via `ensure_column` em `init_connection`
  (`db.rs:61-71,305-323,699`); bancos legados viram `chat`/`0` sem perder linhas — teste
  `migrates_legacy_conversations_to_chat_mode_preserving_rows` (schema legado criado à mão,
  reabertura idempotente, linha preservada e `listed.len() == 1`).
- ✅ `create_conversation` ganhou `mode` opcional; ausente/inválido/espaços → `chat` (normalização
  no domínio e no `Db`), sem criar sessão compartilhada (`code_linked = 0`) — testes Rust.
- ✅ `set_conversation_code_linked` registrado em `lib.rs` e documentado; validações testadas.
- ✅ Serialização camelCase: `mode` e `codeLinked` no IPC, sem `code_linked`; payload antigo sem os
  campos desserializa como `chat`/`false` — teste de domínio.
- ✅ Contrato TS: `ConversationMode`, `mode?`, `codeLinked?` em `types.ts`; `api.createConversation`
  ganhou `mode` e existe `api.setConversationCodeLinked`; `lib/conversations` normaliza `mode`
  ausente como `chat` (compatibilidade de fixtures/payloads antigos).
- ✅ List/search continuam devolvendo todas as sessões (com os novos campos) — testes Rust e uso no
  renderer.

## 3. Qualidade

- ✅ **Fonte única de filtro** (`lib/conversations`, §2.1); nenhuma segunda implementação da regra
  de visibilidade em componentes/store.
- ✅ **Tokens do tema**: nenhum hex/rgb/hsl novo; o diálogo usa `border-border`, `bg-surface*`,
  `text-foreground*`, `danger`/`danger-soft`, `accent` — tokens existentes.
- ✅ **A11y do diálogo**: `Dialog` Radix (focus trap/Esc), `DialogTitle`/`DialogDescription`,
  `aria-label` no input de busca, botões com nome acessível ("Adicionar {sessão} ao Code"),
  `role="list"/listitem`, região com `aria-label`, `role="alert"` para erro, `aria-busy`, foco
  inicial no campo de busca, alvos ≥32 px (linhas com ~40 px, fechar 32 px, "Cancelar" 32 px).
  Fechamento durante o vínculo é bloqueado de propósito (guard em `AddChatSessionDialog.tsx:94-101`).
- ✅ **Testes sem mocks de produto**: só `@/lib/api` e `sonner` são mockados, padrão do repo; nada de
  workspace/git/arquivos simulados em produto.
- ✅ **Sem vazamento de estado entre testes**: `vi.clearAllMocks()` nos testes novos/alterados de
  `code/**`, `CommandPalette` e `chatStore` (`CodeSidebar.test.tsx:97`,
  `CodeSessionHeader.test.tsx:100`, `AddChatSessionDialog.test.tsx:64`, `CommandPalette.test.tsx:160`,
  `chatStore.test.ts:129`); `Sidebar.test.tsx` não limpa mocks, mas reconfigura os mocks no
  `beforeEach` e só usa `toHaveBeenCalledWith` (sem asserção de contagem que dependa de ordem);
  subconjunto com `--sequence.shuffle` verde (16/254).
- ✅ **Regressões no Chat**: suíte inteira verde (Biblioteca, Skills, painéis, paleta, atalhos);
  nenhum teste existente removido/enfraquecido nas mudanças (apenas adições e ajustes de fixture).
- ✅ **Fase 1 preservada**: correções da rodada anterior conferidas no código/testes —
  `PlanUsageChip` ≥1280 px (`TitleBar.tsx:144`; DESIGN §13), abas sem controle aninhado
  (`role="presentation"` + dois botões irmãos, `CodeSessionHeader.tsx:240-281`), foco restaurado ao
  fechar aba (`CodeSessionHeader.tsx:61-66,102-122` + 2 testes), `Esc` do Code sem trocar layout
  por estado stale (`App.tsx:156-158`), testes de welcome custom da `ChatView`
  (`ChatView.test.tsx:157-184`), refs movidas para `docs/goals/chat-code-layout/refs/`, pílula
  13 px (`LayoutModeSwitch.tsx:47`) e `vi.clearAllMocks` nos testes novos.
- ⚠️ Cobertura a melhorar: integração do centro (R3), `Esc`/restauração de foco do diálogo (R4) e
  recentes do Code (não há teste dedicado; a lógica é o mesmo memo filtrado da paleta).

## 4. Achados (nenhum bloqueante)

| Id | Severidade | Descrição | Referência | Impacto |
| --- | --- | --- | --- | --- |
| R1 | baixa (UX) | Ao alternar layouts, `enterLayout` abre a sessão lembrada via `openConversation`, que reseta `activeView` e `codeView` para `'chat'`/`'session'`. Assim, a página **Biblioteca/Skills** aberta em um layout é perdida na ida-e-volta (ex.: Chat › Biblioteca → Code → Chat volta na conversa; Code › Skills → Chat → Code volta na sessão). Isso contradiz o comentário de contrato do `WorkspaceCenter` ("each layout has its own page state") e o comportamento da fase 1. | `src/lib/store/chatStore.ts:610-629` (enterLayout chama `openConversation` em `:621`), `:654-658` (resets), `:695-696` (startNewConversation também reseta); contrato citado em `src/components/layout/WorkspaceCenter.tsx:14-15` | Perda de contexto de página ao trocar de modo; sem perda de dados. Correção sugerida: preservar páginas ao restaurar o layout (parâmetro `preservePages` no `openConversation` ou snapshot/restore em `App`), com teste de round-trip. |
| R2 | baixa (robustez) | O early-return do `enterLayout` (`target === state.activeId && cached`) não chama `rememberActive(target, mode)`. No caso em que a sessão já ativa é visível no layout de destino (ex.: sessão compartilhada ativa e primeira da lista do Code), `activeIdByLayout[mode]` pode continuar `null`; restaurações futuras caem no fallback "primeira visível" em vez da memória. | `src/lib/store/chatStore.ts:617-619` | Nenhum vazamento e nenhum caso de sessão errada observável; perde a "memória" no edge. Correção: `rememberActive(target, mode)` antes do `return` + teste do caso compartilhada-ativa. |
| R3 | baixa (cobertura/robustez) | A regra "o centro nunca mostra a sessão do outro layout" não tem guarda própria: o `WorkspaceCenter` renderiza a `ChatView` com o `activeId` global (`WorkspaceCenter.tsx:46-53`); a única proteção é o efeito `enterLayout` em `App.tsx:127-130`, que não tem teste de integração (App não é testado) e não tem defesa se outro caminho setar um `activeId` não visível. Os testes cobrem lista/abas/paleta e que o **cabeçalho** ignora sessão do Chat, mas não o centro. | `src/components/layout/WorkspaceCenter.tsx:46-53`, `src/App.tsx:127-130`, `src/components/code/CodeSessionHeader.test.tsx:388-412` | Risco de regressão futura (qualquer call site novo de `openConversation` sem filtro mostra a sessão no centro). Sugestão: derivar/validar visibilidade no `WorkspaceCenter` (ou guard no `openConversation`) + teste de integração do centro. |
| R4 | baixa (cobertura a11y) | O diálogo usa Radix (Esc/focus trap) e está bem rotulado, mas os testes novos não exercitam `Esc`, foco preso nem restauração de foco ao fechar; o único teste de fechamento é "Cancelar". | `src/components/code/AddChatSessionDialog.test.tsx` (233 linhas, sem teste de Esc/foco); componente em `AddChatSessionDialog.tsx:94-101` | Sem bug identificado; cobertura apenas. |
| R5 | cosmético (docs) | `docs/goals/chat-code-sessions/PLAN.md` ainda está como "Status: em implementação" e não tem registro de implementação/ponteiro para esta evidência; o DESIGN §14 lista "Sessão compartilhada do Chat" mas não a microcopy visível do selo ("Do Chat"); a ordem das ações no DESIGN §5 ("Novo agente, Buscar, Skills e Adicionar sessão do Chat") difere da implementada (Adicionar é a 2ª). | `docs/goals/chat-code-sessions/PLAN.md:3`; `docs/DESIGN.md` §5/§14 (linhas 78/243) | Só documentação; atualizar após a verificação. |
| R6 | cosmético (teste) | Em `CodeSidebar.test.tsx`, o mock de `getConversation` devolve `conversation({ id })` cujo default é `mode: 'code'`; no teste de "adicionar sessão do Chat", a conversa vinculada (`chat-1`, mode chat) é substituída na store por esse payload de mock (mode code), mas o teste só verifica `activeId`/fechamento. O caso "mesma conversa e mode preservado" está coberto em `AddChatSessionDialog.test.tsx`; ainda assim o fixture pode mascarar regressões de modo nesse teste. | `src/components/code/CodeSidebar.test.tsx:100-103,224-243` | Qualidade do teste; corrigir o mock para devolver a conversa real da store. |
| O1 | observação | "Nova sessão" não é lembrada: fechar a última aba chama `clearActiveConversation` (memória `null`); ao trocar de layout e voltar, `enterLayout` cai em `visible[0]` e reabre a primeira sessão do Code em vez de manter o welcome. É compatível com o algoritmo do PLAN §3 ("não existe/visível → primeira visível"), mas torna o welcome transitório. | `src/lib/store/chatStore.ts:612-616,632-637`; `src/components/code/CodeSessionHeader.tsx:111-122` | Decisão de produto; documentar se o welcome deve persistir. |
| O2 | observação | `isSharedChatConversation` (`lib/conversations.ts:29-32`) é export usada apenas nos testes; o selo/menu usam `codeLinked` direto. Sem impacto; remover ou consumir na UI. | `src/lib/conversations.ts:29-32` | Cosmético. |

## 5. Veredito

**Aprovado com ressalvas** — nenhuma falha bloqueante.

- Backend: `cargo test --lib` **523 passed / 0 failed / 10 ignored**; migração aditiva comprovada,
  criação por modo, validações de vínculo e camelCase testadas (8 testes novos confirmados).
- Renderer: `pnpm typecheck` limpo; `pnpm test` **78/78 arquivos, 1537/1537 testes**; `pnpm build`
  OK; shuffle verde em 16 arquivos/254 testes.
- GOAL 1.1 atendido: sessões separadas por layout em listas, abas, paleta (busca e recentes) e
  criação/envio; compartilhamento funcional pelo diálogo do Code **e** pelo menu do Chat, sem
  duplicar a conversa e sem afetar o Chat ao remover; migração preserva dados antigos.
- Ressalvas R1–R6/O1–O2 são de severidade baixa (UX de página por layout, cobertura de
  integração/a11y, docs e fixture de teste); nenhuma impede a entrega da fase 1.1, mas R1 e R3
  merecem correção barata antes de a fase 2 crescer em cima do `enterLayout`.

## 6. Pendências / recomendações (Lead)

1. **R1**: preservar `activeView`/`codeView` ao restaurar o layout (ex.: `enterLayout` sem o reset de
   páginas do `openConversation`, ou snapshot/restore) + teste de round-trip
   Chat › Biblioteca → Code → Chat e Code › Skills → Chat → Code.
2. **R3**: guarda de visibilidade no centro/`openConversation` e teste de integração do
   `WorkspaceCenter`/`App` (nenhuma sessão do outro layout no centro, inclusive com `activeId`
   forçado).
3. **R2**: `rememberActive(target, mode)` no early-return do `enterLayout` + teste.
4. **R4**: testes de `Esc`/foco do diálogo (Radix) para travar a a11y.
5. **R5**: atualizar o status/registro do PLAN e completar a microcopy do DESIGN (selo "Do Chat" e
   ordem das ações da sidebar).
6. **R6**: corrigir o mock do `getConversation` no teste da `CodeSidebar` para refletir a conversa
   compartilhada (`mode: 'chat'`, `codeLinked: true`).
7. **O1**: decidir/documentar se o welcome "Nova sessão" deve persistir ao trocar de layout.

## 7. Limitações desta verificação

- Sem automação de UI/navegador (AGENTS.md): o comportamento visual/centro e o fluxo completo de
  layout foram verificados por leitura de código + testes de store/componente/DOM; não houve
  inspeção manual da janela Tauri.
- `cargo test --lib` compila e roda a lib inteira; não rodei `cargo build` do binário nem um app
  Tauri real. Os 9 warnings de compilação observados (`auth_status` não usada etc.) não foram
  comparados com um baseline do `HEAD`; são warnings, não erros.
- A migração foi exercitada com um schema legado sintético em memória (`db::tests`), não com uma
  cópia do banco real do usuário.
- O aviso de chunk > 1500 kB no `pnpm build` foi observado; não comparei com um build do `HEAD`
  (classificação "pré-existente" vem do PLAN/Lead, não medida aqui).

## 8. Correções pós-verificação (Lead, 2026-10-27)

O snapshot verificado acima permanece a evidência fiel da auditoria. Depois dela o Lead aplicou as
recomendações do §6 (só renderer/docs; nenhum arquivo Rust mudou):

| Ressalva | Correção |
| --- | --- |
| R1 | `openConversation(id, { preserveView })`: `enterLayout` restaura a sessão sem resetar `activeView`/`codeView`; a página Biblioteca/Skills do layout continua aberta ao alternar Chat ↔ Code. Testes de round-trip nos dois sentidos. |
| R2 | Early-return do `enterLayout` agora chama `rememberActive(target, mode)`; teste da sessão compartilhada já ativa. |
| R3 | Guarda de defesa em profundidade na `ChatView`: um `activeId` de sessão invisível no layout atual mostra o welcome (nativo no Chat, welcome do Code no Code) em vez do transcript alheio; 2 testes novos. |
| R4 | Teste de fechamento do “Adicionar sessão do Chat” com `Esc` (sem compartilhar). |
| R5 | `PLAN.md` atualizado (status “implementado e verificado” + §7 registro/limitações); DESIGN §5 com a ordem real das ações e §14 com a microcopy visível **Do Chat**. |
| R6 | Mock de `getConversation` em `CodeSidebar.test.tsx` agora devolve a conversa armazenada (preserva `mode`/`codeLinked`). |
| O1 | Comportamento do welcome “Nova sessão” documentado como esperado no PLAN §7 (ao voltar ao layout cai na primeira sessão visível). |

Verificação final após as correções (Lead):

- `pnpm typecheck` → limpo.
- `pnpm test` → **78 arquivos / 1543 testes passed** (1537 da verificação + 6 testes novos: 3 de
  `enterLayout`, 2 da guarda da `ChatView`, 1 de `Esc` do diálogo).
- `pnpm build` → `✓ built in 5.90s`, exit 0.
- `cargo test --lib` não foi re-executado porque nenhum arquivo `src-tauri/**` mudou depois da
  verificação (523 passed / 0 failed / 10 ignored no snapshot auditado).
