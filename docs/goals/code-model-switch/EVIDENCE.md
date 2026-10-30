# EVIDENCE — Troca de modelo/provedor no meio da conversa (layout Code)

> Verificação independente da `task-4` (verifier). Somente leitura no código do app; este é o
> único arquivo escrito. Workdir: `H:\ChatTauri`. Data: **2026-10-30** (revisão estática
> ~11:19–11:40 e verificação de execução ~11:41–11:58, America/Sao_Paulo), no working tree final
> sinalizado pelo Lead como "suite green". **Re-verificação delta (fix R1, `task-6`) em
> ~12:02–12:14** — snapshot novo e resultados na **§7**; as §1–§6 permanecem como a auditoria do
> snapshot original (hash `ea6f6a35…`).

## 0. Snapshot verificado

| Item | Valor |
| --- | --- |
| `HEAD` | `6f93d1e169192ed922354ef62a799b3836e560bd` — "Add persistent goals to Code sessions" (nenhum commit do goal; inalterado no delta) |
| `git diff` — snapshot da auditoria original (task-4) | hash `ea6f6a35f7dccee3c1c30474396c22e733171939` (`cmd /c "git diff \| git hash-object --stdin"`; confere com o hash informado pelo Lead) |
| `git diff` — **snapshot atual (delta R1, §7)** | hash **`185bf7a58726ad97446425f71909547f151452b6`** (confere com o hash informado pelo Lead); estável antes/depois de todos os comandos do delta |
| `git diff --stat` (original → atual) | 45 arquivos rastreados; `+2196 / −266` → **`+2249 / −270`**; em `src-tauri/**`: 5 arquivos (`+487 / −17`) **iguais** na auditoria e no delta (nenhum `.rs` mudou, §7) |
| Não rastreados | **6 arquivos na auditoria original** (hash agregado SHA-256 `9c45c0d7…`; `docs/goals/code-model-switch/{GOAL,PLAN}.md`, `ModelSwitchDivider.tsx` + `.test.tsx`, `PlanModeChip.tsx` + `.test.tsx`) e **7 no snapshot atual** (inclui este `EVIDENCE.md`) |
| Estabilidade | hash do diff recomputado **antes e depois** de todos os comandos: `ea6f6a35…` na auditoria e `185bf7a5…` no delta, estável nas duas medições; `git status` manteve 45 rastreados + não rastreados; nenhum arquivo do app foi escrito durante as verificações (o único arquivo novo/alterado ao final é este EVIDENCE) |
| Commits | **nenhum commit novo** desde o `HEAD`; working tree também contém a feature anterior não commitada (Plano/permissão padrão Autônomo), ver §0.1 |

### 0.1 Escopo do diff (separação das duas features no working tree)

Arquivos **desta feature** (auditados item a item): `src-tauri/src/commands/conversations.rs`
(comando/helper/testes do modelo; o mesmo arquivo também recebeu mudanças da outra feature),
`src-tauri/src/lib.rs` (registro do comando), `src/lib/api.ts`, `src/lib/store/chatStore.ts`,
`src/lib/store/index.ts`, `src/components/models/ModelPill.tsx`,
`src/components/models/ModelPickerDialog.tsx`, `src/components/settings/ModelTab.tsx`,
`src/components/palette/usePaletteActions.ts`, `src/components/chat/MessageList.tsx`,
`src/components/chat/ModelSwitchDivider.tsx` (novo) e os testes `chatStore.test.ts`,
`ModelPill.test.tsx`, `ModelPickerDialog.test.tsx`, `ModelTab.test.tsx`,
`CommandPalette.test.tsx`, `MessageList.test.tsx`, `ModelSwitchDivider.test.tsx` (novo),
`ModelPill.edge.test.tsx` (hardening de flaky da task-5, só teste). Docs: DESIGN §7/§8/§14,
ARCHITECTURE §4/§5/§12 (+ lista de comandos IPC), MODELS (nova seção), MODEL_SELECTOR_REDESIGN
§12.1, COMMAND_PALETTE §4.5, `docs/goals/code-model-switch/{GOAL,PLAN}.md`.

Arquivos da **outra feature não commitada** (fora do escopo desta auditoria; exercitados pela
suíte, não revisados aqui): `src-tauri/src/{config,db,domain}.rs` (migração de settings v2 e modo de
permissão padrão), `src/lib/store/{appStore,codeStore}.ts`, `src/lib/types.ts`,
`src/components/composer/{Composer,CodeSessionControls,GoalControls}.tsx`,
`src/components/settings/ToolsTab.tsx`, `src/components/code/{useWorkspaces.ts,WorkspaceTrustDialog.tsx}`,
`src/components/composer/PlanModeChip.tsx` + `.test.tsx`, docs `FILES.md`,
`docs/goals/code-goals/PLAN.md`, `docs/goals/code-harness/{HARNESS,WORKBENCH}.md`.

## 1. Comandos e resultados

| # | Comando | Resultado |
| --- | --- | --- |
| 1 | `git status --porcelain` / `git diff --stat` / hash do diff | 45 rastreados + 6 não rastreados; `+2196/−266`; hash `ea6f6a35…` (estável) |
| 2 | `pnpm typecheck` (`tsc --noEmit`) | **verde**, exit `0`, sem saída de erro |
| 3 | `pnpm test` (`vitest run`) | **verde**, exit `0`: `Test Files 129 passed (129)` / `Tests 2412 passed (2412)`, 187,42 s (execução isolada, sem concorrência) |
| 4 | `pnpm build` (`tsc --noEmit && vite build`) | **verde**, exit `0`, `✓ built in 8.13s`; aviso de chunk > 1500 kB (`index-*.js` ≈ 2,66 MB) pré-existente/tolerado |
| 5 | `cd src-tauri && cargo check` | **verde**, exit `0`, `Finished dev profile … in 1.05s`; **84 warnings** (estilo/dead-code, não comparados com baseline — ver §5) |
| 6 | `cd src-tauri && cargo test --lib` | **verde**, exit `0`: `test result: ok. 1006 passed; 0 failed; 13 ignored; 0 measured; 0 filtered out; finished in 22.02s` |
| 7 | `cargo test --lib -- model_change` | **verde**: `11 passed; 0 failed; 1008 filtered out` — os **7 testes novos** de `commands::conversations::tests` (`model_change_*`) + 4 testes pré-existentes de cache/replay que casam o filtro (`harness::cache::epoch`, `harness::render`, `harness::agent_loop_tests`) |
| 8 | `pnpm exec vitest run <10 arquivos afetados> --sequence.shuffle` (1ª ordem) | **verde**, exit `0`: `10 passed (10)` / `221 passed (221)`, 41,43 s |
| 9 | idem, 2ª execução (outra ordem aleatória) | **verde**, exit `0`: `10 passed (10)` / `221 passed (221)`, 46,19 s |
| 10 | teste do flaky endurecido (`-t "respeita a janela de tolerância"`) **3×** | **verde 3/3**, exit `0` em todas: `1 passed \| 15 skipped` (3,63 s / 3,21 s / 3,40 s) |
| 11 | grep de linhas **adicionadas** em `src/**`/`src-tauri/**` por `.only`, `.skip`, `console.log`, `debugger`, `TODO`, `FIXME` | **0 ocorrências** |
| 12 | grep de hex/`rgb()`/`hsl()` nos arquivos de produção da feature e de `any`/`@ts-ignore`/`@ts-expect-error` | **0 ocorrências** |
| 13 | hash do diff após todos os comandos | `ea6f6a35…` **inalterado** (as execuções não tocaram o tree rastreado) |

Contagens de testes: a suíte final tem **129 arquivos / 2412 testes** (o Lead reportou 2409 na 1ª
execução, antes do hardening da task-5 e com 1 flaky; o teste de hardening substitui o teste
antigo no mesmo arquivo — sem mudar a contagem — e a task-5 acrescentou 1 teste de troca de
provedor em `ModelPickerDialog`; demais diferenças são ajustes de fixtures/contagens de arquivos).
Contra o `HEAD`, esta feature adiciona **37 testes de renderer** (14 no novo
`ModelSwitchDivider.test.tsx`; +23 em arquivos existentes: +10 em `chatStore.test.ts`,
+4 em `ModelPickerDialog.test.tsx`, +4 em `MessageList.test.tsx`, +2 em `ModelPill.test.tsx`,
+2 em `CommandPalette.test.tsx`, +1 em `ModelTab.test.tsx` — contagens líquidas, algumas
substituições de testes antigos) e **7 testes Rust** de `validate_model_change`.

## 2. Regras de produto (checklist item a item)

Legenda: ✅ ok · ⚠️ ok com ressalva (ver §4) · ❌ falha.

### 2.1 Lock por layout (Chat x Code) e streaming
- ✅ **Chat continua travado após o primeiro envio**: `modelLockReason` devolve `'started'` quando o
  layout não é Code ou a conversa não é do Code e `selectActiveConversationStarted` é true
  (`chatStore.ts:179-189`; helper em `:164-171`). Matriz coberta em `chatStore.test.ts`
  ("locks Chat conversations once started and during a turn", "unlocks model switching for Code
  sessions…").
- ✅ **Code liberado entre turnos**: layout `'code'` + conversa `mode==='code' || codeLinked`
  (`isCodeSessionConversation`, `chatStore.ts:173-176`) ⇒ `null` quando não há streaming
  (`:185-188`). Coberto no teste de store e nas 4 superfícies (pill/dialog/paleta/ModelTab).
- ✅ **`codeLinked`**: sessão do Chat vinculada ao Code segue a regra do layout onde aparece —
  `'code'` ⇒ liberada, `'chat'` ⇒ `'started'` (`chatStore.test.ts`, caso "Shared (codeLinked)
  sessions follow the Code layout where they appear"). `ModelPickerDialog`/`ModelPill` em sessão
  `mode:'code'` iniciada abrem o seletor (`ModelPickerDialog.test.tsx` e `ModelPill.test.tsx`,
  "switches the model of a started Code session…").
- ✅ **Streaming bloqueia nos dois layouts**: `'started'` tem precedência (bloqueio permanente do
  Chat) e, sem ele, `'streaming'` (`chatStore.ts:186-187`), conforme PLAN §3. Copy específica
  "Aguarde a resposta atual terminar" (`MODEL_STREAMING_LOCKED_*`, `:195-203`) na pill (aria-label
  "Troca de modelo indisponível durante a resposta…"), no dialog compacto e na paleta — testes nos
  3 arquivos; no Chat iniciado a copy antiga permanece (teste "blocks the model segment after the
  conversation starts").
- ✅ **Layout trocado com sessão compartilhada**: a decisão é tomada com o `layoutMode` vivo do
  `uiStore` a cada render/commit (`ModelPill.tsx:218-221`, `ModelPickerDialog.tsx:671-672`,
  `usePaletteActions.ts:248`, `chatStore.ts:233`) e `openConversation` sincroniza a seleção com o
  par persistido da conversa (`syncSelectionToConversation`, `chatStore.ts:207-224`) — ressalva de
  modelos só-da-conta em §4/R1.
- ✅ **`send`/`regenerate`/`editAndResend` no Chat nunca usam seleção mutada**: `lockedSelectionFor`
  só devolve o par da conversa quando o motivo é `'started'` (`chatStore.ts:232-250`) e é usado em
  `send` (`:1078`) e `regenerate` (`:1200`); `editAndResend` delega ao `send` (`:1289`). Nenhum
  call site de produção passa `SendOptions.selection` (grep). Testes "send keeps the conversation
  model even if the global selection was mutated" e "regenerate keeps…".

### 2.2 `chooseModel` (persistência, padrões, rollback)
- ✅ **Persiste na sessão, não nos padrões**: sessão Code iniciada ⇒ `setActiveSelection` otimista +
  `api.setConversationModel` + conversa atualizada na lista + toast "Modelo da sessão alterado";
  `Settings.defaultProvider/defaultModel` intocados (`chatStore.ts:972-1038`).
  Testes de store e de pill/dialog afirmam `saveSettings` **não** chamado e o par persistido
  (`setConversationModel` chamado com o par novo).
- ✅ **Mesmo par (só pensamento)**: atualiza a seleção sem IPC (`:1001-1008`) — teste "chooseModel
  only updates the thinking mode when the session keeps the same route".
- ✅ **Conversa nova/vazia (qualquer layout)**: comportamento anterior via `setSelection` (seleção +
  padrão de novas conversas) (`:995-1000`) — teste "keeps the old behavior for a new/empty Code
  session (defaults)".
- ✅ **Bloqueado ⇒ recusa com a copy do lock** (defesa em profundidade): `:974-980` — teste
  "chooseModel refuses to bypass the Chat lock" (toast `modelLockCopy`, sem IPC, seleção intacta).
- ✅ **Falha do backend ⇒ rollback só se o usuário continua na mesma sessão** e prefixo
  `MODEL_LOCKED:` removido da mensagem (`:1027-1037`); testes de store e do dialog
  ("não fecha o dialog quando o commit é recusado pelo backend", toast
  `Não foi possível alterar o modelo` + descrição sem prefixo).
- ✅ **UI de commit**: dialog fecha **só** em sucesso (`ModelPickerDialog.tsx:310-322`); pill usa
  `chooseModel` em vez de `setSelection`/`setReasoning` (`ModelPill.tsx:561-575`), mantendo a etapa
  de pensamento local; `handleThinkingPick` continua `setReasoning` (pensamento sempre ajustável).

### 2.3 Backend (comando, helper e registro)
- ✅ **Comando registrado**: `commands::conversations::set_conversation_model` em
  `src-tauri/src/lib.rs:74`; assinatura IPC `(conversationId, providerId, modelId) -> Conversation`
  em `api.ts:128-129` (camelCase conferido contra o padrão do repo, ex. `get_cache_stats`).
- ✅ **Helper puro `validate_model_change`** (`conversations.rs:233-270`): trim dos ids; ids vazios
  com erro claro; **sessão nativa do Chat recusada antes de consultar o catálogo** com prefixo
  `MODEL_LOCKED: `; aceita `mode=='code'` e `codeLinked=true` (mesmo com `mode=='chat'`); provedor
  e modelo resolvidos na visão mesclada (`state.catalog.provider` + `state.model`, que inclui a
  lista dinâmica da conta — `state.rs:212-251`). 7 testes Rust confirmados em execução (§1 #7),
  incluindo o que falha de propósito se o catálogo for consultado antes da regra de layout.
- ✅ **Turno ativo recusado**: `state.has_active_turn_for(conversation_id)` (`conversations.rs:297`;
  `TurnRegistry::has_active_for` em `state.rs:78-83`; `run_turn` registra o turno antes do harness,
  `commands/turn.rs:32`) ⇒ `MODEL_LOCKED: aguarde a resposta atual terminar`.
- ✅ **Persistência e retorno**: `db.update_conversation_model` (pré-existente, `db.rs:1951-1965`,
  atualiza `updated_at`) e devolve `get_conversation` atualizado (`conversations.rs:300-305`); a
  conversa inexistente após o update vira erro claro. A rota do próximo turno também é reafirmada
  pelo harness no início do turno (`harness/mod.rs:1567-1570`, pré-existente).
- ⚠️ Ordem das validações (catálogo antes de turno ativo) e ausência de teste do comando em si —
  §4/R2, R3.

### 2.4 Persistência sobrevive a reabrir a sessão, alternar layouts e rodadas de objetivo
- ✅ **Rodadas do objetivo leem o par da sessão**: `runGoalRound` monta a `selection` a partir de
  `conversation.providerId/modelId` (`chatStore.ts:1320-1325`) e o payload usa esse par
  (`:1412-1423`); o reasoning é derivado do modelo quando a seleção diverge. Teste
  "runGoalRound inicia um turno goal_round…" afirma `providerId/modelId` do payload.
- ✅ **Reabrir a sessão**: `openConversation` → `syncSelectionToConversation` alinha o composer ao
  par persistido quando a conversa tem mensagens (`chatStore.ts:856-859, 207-224`); teste
  "syncs the active selection to the conversation model when opening a started conversation".
- ✅ **Alternar Chat ↔ Code**: cada layout restaura sua sessão (`enterLayout`/`activeIdByLayout`) e
  a abertura sincroniza a seleção com o par da conversa (mesma função acima); o par fica na linha
  `conversations`, não na seleção global. Sem teste de round-trip dedicado — cobertura indireta
  (ver §4/R1 para o edge de modelos só-da-conta).
- ✅ **Respostas antigas mantêm seu modelo**: cada mensagem assistant persiste `provider_id/model_id`
  do turno que a produziu (`harness/mod.rs:2751-2753`) e o replay cai no fallback neutro quando a
  rota muda (`harness/render.rs:234-289`, `frozen_replay_mode`); o epoch de cache marca
  `ModelSwitch` (`harness/cache/epoch.rs:106`, rótulo "Modelo ou provedor mudou" em `cache.ts:65`).
  Infraestrutura pré-existente, exercitada pelos testes Rust filtrados (§1 #7) e documentada em
  MODELS/GOAL; nada no renderer a reimplementa.
- ✅ **`startNewConversation` volta ao padrão** quando a conversa ativa já iniciou, nos dois layouts
  (`chatStore.ts:870-906`, reset em `:876-883`), sem depender mais do lock antigo.

### 2.5 Divisor "Modelo alterado para …" no transcript
- ✅ **Detecção**: `detectModelSwitch` só considera mensagens assistant com `modelId`, ignora
  legado sem `modelId` e só compara provedor quando os dois lados o conhecem
  (`ModelSwitchDivider.tsx:41-61`); `modelSwitchAt` varre a última assistant anterior com rota
  (`:68-81`); a primeira resposta nunca gera divisor. 14 testes no arquivo novo.
- ✅ **Render**: divisor como **sibling** imediatamente antes do `MessageItem`, dentro do mesmo
  `role="log"` (`MessageList.tsx:21-45`); 4 testes novos em `MessageList.test.tsx` (1 divisor na
  posição certa, nenhum quando a rota é única, legado sem `modelId` ignorado, live region mantida).
- ✅ **A11y**: `role="separator"` + `aria-label`/`title` com o provedor, texto visível em pt-BR
  ("não só cor"), ícone decorativo `aria-hidden` (`ModelSwitchDivider.tsx:100-117`); testes de
  nome acessível e de `title`. O container mantém `aria-live="polite"` só durante o streaming
  (`MessageList.tsx:24-27`). Observação cosmética sobre separadores estáticos em §4/R9.
- ✅ **Sessão compartilhada com o Chat**: como o divisor vive no `MessageList` comum aos dois
  layouts, uma sessão `codeLinked` mostra o divisor também no Chat (comportamento previsto no GOAL;
  não há teste específico no layout Chat, mas o componente é o mesmo e testado).

### 2.6 Superfícies (pill, dialog, paleta, Configurações)
- ✅ **ModelPill**: cadeado/`aria-disabled`, sem `aria-haspopup` quando travado, `aria-label`/`title`
  por motivo (started x streaming), clique explica com `modelLockCopy` e não abre; ✦ continua
  funcional; Code iniciado abre a lista e troca via `chooseModel` (`ModelPill.tsx:216-221,
  264-272, 482-497, 548-575, 700-740`; testes no arquivo e no edge).
- ✅ **ModelPickerDialog**: `lockReason` decide corpo; `started` mantém o compacto atual,
  `streaming` usa o compacto com a copy nova, livre mostra o seletor completo com commit via
  `chooseModel` e fecha só no sucesso (`ModelPickerDialog.tsx:310-322, 594-655, 668-686`; 4 testes
  novos na sessão do Code + copy de streaming).
- ✅ **Paleta**: ação "Trocar modelo" vira label/descrição/ícone de cadeado com a copy do motivo e
  toast ao executar; no Code liberado abre o dialog (`usePaletteActions.ts:217-224, 248, 256,
  507-515`); 2 testes novos em `CommandPalette.test.tsx` (Code liberado; streaming com copy).
- ✅ **Configurações › Modelo padrão**: usa `selectActiveConversationStarted` (não o lock) para
  nunca alterar a seleção de uma conversa iniciada, em nenhum layout; aviso novo "A conversa atual
  já foi iniciada…" (`ModelTab.tsx:11, 44, 98-103, 127-137, 190-194`); testes cobrem Chat iniciado
  e Code iniciado (conversa e seleção intactas) e o caso sem conversa iniciada.

### 2.7 Nenhum bypass do lock do Chat
- ✅ Superfícies: pill/dialog/paleta checam `modelLockReason`; `ModelTab` não altera sessão
  iniciada; `chooseModel` recusa; `send`/`regenerate` forçam o par da conversa no Chat; não há
  outro caminho de `setSelection`/`setActiveSelection` para o usuário trocar o modelo ativo
  (grep: só `ModelTab` no caso não iniciado, `syncSelectionToConversation`, `startNewConversation`
  e o próprio `chooseModel`).
- ✅ Backend recusa `set_conversation_model` em sessão nativa do Chat (mesmo com payload direto),
  com `MODEL_LOCKED`.
- ℹ️ O comando `run_turn` **não** revalida o lock do Chat no backend (aceita o par do payload) —
  comportamento pré-existente (o lock do Chat sempre foi do renderer; a defesa nova cobre a troca
  de sessão). Não é regressão desta feature; registrado como observação (§4/O2).

### 2.8 Qualidade / convenções
- ✅ Sem `any` implícito, `@ts-ignore`/`@ts-expect-error`, `TODO`/`FIXME` novos, `.only`/`.skip`,
  `console.log`/`debugger` nas linhas adicionadas de `src/**`/`src-tauri/**` (§1 #11-12).
- ✅ Sem hex/`rgb()`/`hsl()` soltos: divisor e demais superfícies usam tokens (`border-border`,
  `text-foreground-subtle`, `bg-accent-soft`, …); ícone lucide 14 px (`strokeWidth 1.75`).
- ✅ Texto de interface em pt-BR; microcopy do PLAN §4 presente no código (todas as 7 strings
  novas conferidas) e listada no DESIGN §14.
- ✅ Acessibilidade: `aria-label` em ícones-botão, foco (dialog Radix, "Fechar" com autoFocus),
  roles (`log`, `separator`, `dialog`, `listbox`), texto visível no divisor, sem regressão nos
  testes existentes de pill/dialog/paleta.
- ✅ Testes novos usam o padrão do repo (Vitest + jsdom, mock só de `@/lib/api`/`sonner`); nenhum
  mock de produto novo; o único arquivo de teste pré-existente alterado fora da feature é o
  hardening do flaky (`ModelPill.edge.test.tsx`, task-5), determinístico com fake timers e
  verificado 3× isolado (§1 #10).

### 2.9 Docs consistentes com o comportamento
- ✅ DESIGN §7 (bloqueio por layout, persistência na sessão, divisor, streaming, pensamento, novo
  chat/abrir conversa), §8 (dialog compacto por motivo), §14 (microcopy) — `DESIGN.md:135, 151, 239`.
- ✅ ARCHITECTURE §4 (par como propriedade da sessão + fallback neutro), §5 (par atualizado a cada
  turno), §12 item 12 (feature e ponteiro para o goal), lista de comandos IPC com
  `set_conversation_model` — `ARCHITECTURE.md:93, 163, 435-440, 721`.
- ✅ MODELS: nova seção "Troca de modelo/provedor no meio da conversa (layout Code)" com regras,
  persistência, fallback neutro, custo de cache, divisor e ModelTab — `MODELS.md:113-141`
  (inclui a distinção sessão iniciada x nova/vazia).
- ✅ MODEL_SELECTOR_REDESIGN §12.1 (atualização por layout, streaming, UI/chooseModel, ModelTab) e
  COMMAND_PALETTE §4.5 (paleta com o modelo travado/liberado) — coerentes com o código.
- ✅ GOAL/PLAN descrevem o comportamento implementado; PLAN está com status **implementado** e
  ponteiro para este EVIDENCE (`PLAN.md:3-4`).
- ⚠️ Nuances cosméticas de docs em §4/R7-R8.

## 3. Achados (nenhum bloqueante)

| Id | Severidade | Descrição | Referência | Impacto |
| --- | --- | --- | --- | --- |
| R1 | baixa (edge, pré-existente) — **RESOLVIDO no delta (§7)** | A sincronização da seleção com o par persistido usa `getModel` do **catálogo estático**, não a visão mesclada. Para um modelo **só-da-conta** (ex.: modelo do plano ChatGPT ausente do `catalog.json`) escolhido numa sessão do Code, reabrir a sessão depois de abrir outra conversa (ou após restart) **não** realinha o composer ao par da sessão; o próximo `send` no Code usa a seleção velha e o harness sobrescreve o par da conversa (`update_conversation_model` no início do turno). O par persistido em si e as rodadas do objetivo continuam corretos até esse send. A falha é do helper pré-existente, mas toca o critério do GOAL "o par sobrevive a reabrir a sessão" nesse edge. | `src/lib/store/chatStore.ts:209` (`syncSelectionToConversation`), `:238` (`lockedSelectionFor`), `:1022` (nome no toast); `harness/mod.rs:1567`; ver `appStore.ts:151-179` (visão mesclada é a fonte da UI) e `ModelPickerDialog.auth.test.tsx` ("modelos que só existem na conta") | Modelos do catálogo (todos os do Go/Zen/Anthropic e os do OpenAI presentes no catálogo) não são afetados. Correção sugerida: resolver o modelo pela lista mesclada (`useAppStore.getState().providers` + `findModelIn`, fallback catálogo) em `syncSelectionToConversation`/`lockedSelectionFor` + teste com modelo só-da-conta. **Aplicada e re-verificada em §7** (`modelForRoute`, teste em `chatStore.test.ts:1027-1061`). |
| R2 | baixa (UX backend) | `set_conversation_model` valida provedor/modelo **antes** de checar turno ativo; durante um turno em andamento com par desconhecido, o erro devolvido é "provedor/modelo desconhecido" em vez de `MODEL_LOCKED: aguarde…`. O renderer mostra a mensagem crua no toast. Sem risco de consistência (nada é persistido). | `src-tauri/src/commands/conversations.rs:290-299` | Só copy/ordem de validação; cenário raro (o renderer só oferece modelos disponíveis e trava durante o streaming). |
| R3 | baixa (cobertura) | O comando `set_conversation_model` em si (recusa por turno ativo, persistência e conversa devolvida) não tem teste de integração — só o helper puro `validate_model_change` é testado. Exigiria `AppState`/`Db`; o caminho feliz é coberto em testes de renderer com o IPC mockado. | `src-tauri/src/commands/conversations.rs:275-305`; testes em `:658-777` | Risco de regressão futura na fiação comando↔DB; não afeta o comportamento atual. |
| R4 | baixa (UX) | O lock de streaming usa `state.streaming` **global**: com um turno rodando em outra sessão, o pill de uma sessão Code sem turno mostra "Aguarde a resposta atual terminar" (e recusa a troca). O lock global é pré-existente (antes a copy era "Modelo bloqueado nesta conversa"); a copy nova torna o descompasso mais visível. | `src/lib/store/chatStore.ts:179-189` (checagem em `:187`) | Conservador, sem corrupção; o usuário precisa esperar um turno de outra sessão terminar para trocar o modelo desta. |
| R5 | baixa (UI) | No `ModelPill` o commit é *fire-and-forget*: se o backend recusar (corrida com turno ativo/erro), a seleção reverte e o toast aparece, mas o popover já avançou para a etapa de pensamento com o modelo rejeitado como alvo; a escolha de pensamento seguinte é aplicada à seleção revertida. O dialog não tem esse problema (aguarda o commit). | `src/components/models/ModelPill.tsx:548-575` (commit em `:563-567`, `setStage('thinking')` em `:571`) | Só apresentação/estado transitório; janela muito improvável (o renderer trava durante streaming e o modelo vem da lista mesclada). |
| R6 | baixa (corrida teórica) | `chooseModel` grava a seleção otimista e persiste por IPC; se um turno começar nesse intervalo, o backend recusa a persistência (`MODEL_LOCKED`), o renderer reverte a seleção, mas o turno já rodou com o par otimista e o harness persiste esse par. A UI pode ficar com pill/seleção antigos até reabrir a sessão (o próximo send no Code volta o par para a seleção). Não é alcançável pelos fluxos atuais sem intervenção humana no intervalo de milissegundos (dialog só fecha em sucesso; pill abre a etapa de pensamento). | `src/lib/store/chatStore.ts:1010-1037`; `src-tauri/src/commands/conversations.rs:297`; `harness/mod.rs:1567` | Inconsistência transitória em janela minúscula; sem perda de dados. O PLAN §7 já prevê a mitigação renderer+backend. |
| R7 | cosmético (docs) — **RESOLVIDO no delta (§7)** | DESIGN §8 dizia que "durante o streaming a copy é 'Aguarde a resposta atual terminar'" em qualquer layout; a implementação prioriza `'started'` quando o Chat já iniciou (a copy de streaming só aparece quando não há bloqueio permanente), como o PLAN §3 define. | `docs/DESIGN.md:151`; `src/lib/store/chatStore.ts:186-187`; `docs/goals/code-model-switch/PLAN.md:47-52` | Só documentação; a leitura do PLAN desfazia a ambiguidade. **Ajustado em §7** (DESIGN §8 agora explicita a precedência do bloqueio permanente). |
| R8 | cosmético (docs) | MODEL_SELECTOR_REDESIGN §12 (histórico) ainda cita `selectModelLocked(state)` no presente, função que não existe mais; §12.1 logo abaixo é a atualização que a substitui. | `docs/MODEL_SELECTOR_REDESIGN.md:392` vs `:413-428` | Só documentação/histórico; sem impacto no código. |
| R9 | cosmético (a11y/teste) | O divisor usa `role="separator"` estático com `aria-label`/`title` e texto visível; separadores não focáveis podem não ser anunciados por alguns leitores de tela, mas a informação está no texto visível (não só cor) e há teste de nome acessível. Sem regressão em relação ao transcript anterior (que não tinha divisor). | `src/components/chat/ModelSwitchDivider.tsx:100-117`; `MessageList.test.tsx` (live region) | Nenhum; apenas registro. |
| O1 | observação | Duplo-clique/Enter repetido no botão "Usar este modelo" do dialog pode disparar dois commits (dois IPCs/dois toasts de sucesso na sessão Code), já que o botão não fica pendente durante o `await`. Cosmético e improvável. | `src/components/models/ModelPickerDialog.tsx:310-338, 581-587` | Cosmético. |
| O2 | observação | O comando `run_turn` aceita o par do payload sem revalidar o lock do Chat no backend (o lock do Chat sempre foi do renderer; a defesa em profundidade nova é só do `set_conversation_model`). | `src-tauri/src/commands/turn.rs:11-90`; `harness/mod.rs:1567` | Pré-existente; nenhuma superfície de produção envia par divergente (grep). |

## 4. Veredito

**Aprovado** — nenhuma falha bloqueante; ressalvas de severidade baixa (R2–R6) e cosméticas
(R8–O2). **O veredito se mantém após o delta (§7): R1 e R7 foram corrigidos e re-verificados.**

- Backend: `cargo check` exit 0; `cargo test --lib` **1006 passed / 0 failed / 13 ignored**; os
  7 testes novos de `validate_model_change` confirmados em execução; comando registrado e
  contrato IPC camelCase coerente.
- Renderer: `pnpm typecheck` limpo; `pnpm test` **129/129 arquivos, 2412/2412 testes** em execução
  isolada; `pnpm build` OK; `--sequence.shuffle` verde 2× nos 10 arquivos afetados (221 testes);
  teste do flaky endurecido verde 3/3 isolado. No delta R1: **129/129 arquivos, 2413/2413 testes**
  (§7).
- Critérios do GOAL atendidos: no Code a sessão iniciada troca modelo/provedor entre turnos e a
  escolha é persistida na sessão (sem tocar padrões), usada pelo turno seguinte e pelas rodadas do
  objetivo; no Chat o modelo continua travado e o streaming bloqueia nos dois layouts com copy
  própria; as respostas antigas mantêm o modelo que as produziu (fallback neutro) e o transcript
  marca a troca com divisor acessível; Configurações › Modelo padrão nunca altera sessão iniciada;
  docs coerentes com o comportamento.
- Ressalvas remanescentes: R2 (ordem de validação no backend), R4 (lock global de streaming),
  R5 (commit fire-and-forget no pill), R6 (corrida teórica) e R3 (cobertura do comando Rust);
  cosméticas R8/R9/O1/O2. Nenhuma impede a entrega; **R1 (modelos só-da-conta) foi corrigido em
  §7** — o par persistido agora realinha a seleção ao reabrir a sessão, com teste dedicado.

## 5. Limitações desta verificação

- Sem automação de UI/navegador/screenshots (AGENTS.md): o comportamento foi verificado por leitura
  de código + testes de store/componente/DOM; não houve inspeção manual da janela Tauri.
- A corrida `chooseModel` × início de turno (R6) foi analisada estaticamente; não foi criado teste
  novo (o verifier só escreve este EVIDENCE) e os fluxos de UI tornam a janela inalcançável na
  prática. `--sequence.shuffle` cobre ordem de testes, não concorrência real de IPCs.
- `cargo check` gera 84 warnings; não comparei com um baseline do `HEAD` (não faço stash/checkout);
  são warnings de estilo/dead-code, não erros. O aviso de chunk > 1500 kB do `pnpm build` também
  não foi comparado com o `HEAD` (classificado como pré-existente pelo PLAN/Lead).
- O edge de modelos só-da-conta (R1) não era exercitado por teste automatizado na árvore da
  auditoria original (o fixture `gpt-account-only` existia em `appStore.test.ts`, mas não no fluxo
  de reabrir sessão do Code); a conclusão veio da leitura de `getModel` (catálogo estático) x visão
  mesclada. **No delta (§7) o fix foi aplicado e o edge ganhou teste dedicado**; a re-verificação
  delta não refez a auditoria item a item de toda a feature, apenas revisou os 3 caminhos alterados
  e confirmou que nenhum outro arquivo mudou (mtime + diffstat de `src-tauri` idêntico).
- A suíte completa foi executada uma vez nesta verificação da auditoria original (além da execução
  limpa do Lead) e **mais uma vez na re-verificação delta** (§7.3), ambas em estado sem concorrência;
  stderr do Vitest contém ruído esperado de testes pré-existentes (mocks parciais de `@/lib/api` em
  `CodeSidebar`/`AddChatSessionDialog`, warnings do GenUI/PDF) — nenhum erro de teste.
- O working tree contém a feature anterior não commitada (Plano/permissão padrão); ela foi
  exercitada pela suíte mas **não** auditada neste EVIDENCE.

## 6. Pendências / recomendações (Lead)

1. **R1 — RESOLVIDO no delta (§7)**: `modelForRoute` resolve o modelo na visão mesclada em
   `syncSelectionToConversation`/`lockedSelectionFor`/`runGoalRound`/toast de `chooseModel`, com
   fallback ao catálogo estático; teste dedicado de reabertura de sessão Code com modelo
   só-da-conta (`chatStore.test.ts:1027-1061`).
2. **R2**: mover a checagem de turno ativo para antes da validação de catálogo (copy
   `MODEL_LOCKED` durante streaming) — barato e melhora a mensagem.
3. **R3**: teste de integração do comando com `Db` em memória (recusa por turno ativo,
   persistência e retorno), se/quando o harness de testes de `AppState` permitir.
4. **R4**: decidir se o lock de streaming deve ser por conversa (o estado global é pré-existente,
   mas a copy nova "Aguarde a resposta atual terminar" fica enganosa para outra sessão).
5. **R5/O1**: tornar o commit da pill aguardado (ou desabilitar a etapa seguinte em caso de erro) e
   evitar duplo commit no botão "Usar este modelo"; cosmético.
6. **R7 — RESOLVIDO no delta (§7)**: DESIGN §8 agora explicita a precedência (bloqueio permanente
   > streaming). **R8** segue pendente (anotar que o contrato da §12 do MODEL_SELECTOR_REDESIGN foi
   substituído pela §12.1) — cosmético.
7. **Flaky pré-existente**: o do `ModelPill.edge` foi endurecido deterministicamente (verde 3/3
   isolado e nas duas ordens aleatórias); o do `ChangesPanel` (stage/unstage) não foi tocado e não é
   desta feature — se voltar a falhar sob carga, tratar em task própria.

## 7. Delta pós-verificação (R1 — 2026-10-30)

> Re-verificação independente da `task-6` após o fix do achado **R1** e do ajuste de docs **R7**.
> Somente leitura no código; a única escrita continua sendo este EVIDENCE.

### 7.1 Snapshot do delta

| Item | Valor |
| --- | --- |
| `HEAD` | `6f93d1e169192ed922354ef62a799b3836e560bd` (inalterado; nenhum commit) |
| `git diff` (tracked) | hash **`185bf7a58726ad97446425f71909547f151452b6`** (informado pelo Lead e reconferido aqui com `cmd /c "git diff \| git hash-object --stdin"`); estável antes e depois de todos os comandos do delta |
| `git diff --stat` | 45 arquivos rastreados, **`+2249 / −270`** (antes do delta: `+2196 / −266`) |
| `src-tauri/**` | **inalterado**: 5 arquivos, `+487 / −17`, os mesmos números por arquivo da auditoria original (`conversations.rs` 290, `config.rs` 134, `db.rs` 72, `domain.rs` 7, `lib.rs` 1) |
| Arquivos alterados após a auditoria | **exatamente 3 caminhos** — confirmado por `LastWriteTime` > 12:01: `src/lib/store/chatStore.ts` (12:02:33), `docs/DESIGN.md` (12:02:50), `src/lib/__tests__/chatStore.test.ts` (12:03:25); nenhum outro arquivo em `src/`, `docs/`, `src-tauri/src/`, `data/` ou `scripts/` mudou |
| Não rastreados | 7 arquivos (os 6 da auditoria + este `EVIDENCE.md`) |

### 7.2 Revisão do fix

- ✅ **`modelForRoute` resolve na visão mesclada** (`chatStore.ts:206-216`):
  `findModelIn(useAppStore.getState().providers, providerId, modelId) ?? getModel(providerId, modelId)`
  — a lista do store é a mesma visão mesclada catálogo+conta que o composer usa
  (`appStore.ts:151-179`); o fallback estático preserva o comportamento quando `providers` ainda
  está vazio (boot/testes). Import `findModelIn` em `chatStore.ts:20`.
- ✅ **Usado nos 4 pontos do R1**: `syncSelectionToConversation` (`:221`), `lockedSelectionFor`
  (`:250`), `runGoalRound` (reasoning, `:1357`) e nome no toast de `chooseModel` (`:1034`).
- ✅ **Sem dependência circular nova**: `chatStore` já importava `useAppStore`; `appStore` não
  importa `chatStore` (grep vazio). Nada mais no store mudou.
- ✅ **Teste cobre o edge** (`chatStore.test.ts:1027-1061`): injeta `providers` mesclados com
  `openai/gpt-account-only` (id **ausente** de `data/catalog.json`, confirmado por grep — o teste
  falharia com o `getModel` estático antigo, que devolveria `undefined` e sairia cedo sem sincronizar),
  mocka `getConversation` de uma sessão Code iniciada com esse par e afirma que a seleção passa para
  `openai/gpt-account-only`. `resetStores` agora zera `providers: []` (`chatStore.test.ts:132-139`)
  para isolar o estado entre testes.
- ✅ **R7 (docs)**: `docs/DESIGN.md:151` agora diz que a copy segue o motivo e que "o bloqueio
  permanente tem precedência quando os dois valem" — coerente com `modelLockReason` e com o
  PLAN §3.
- ✅ **Sem regressão de convenções**: nenhuma linha adicionada no delta com `any`/`@ts-ignore`/
  `@ts-expect-error`/`TODO`/`FIXME`/`console.log`/hex (grep); `providers: []` é só fixture de teste.

### 7.3 Comandos e resultados do delta (todos exit 0, sem concorrência)

| # | Comando | Resultado |
| --- | --- | --- |
| 1 | `pnpm typecheck` | **verde**, exit `0` |
| 2 | `pnpm test` (suíte completa) | **verde**, exit `0`: `Test Files 129 passed (129)` / `Tests 2413 passed (2413)`, 189,05 s |
| 3 | `pnpm build` | **verde**, exit `0`, `✓ built in 7.57s` (mesmo aviso de chunk > 1500 kB) |
| 4 | `cd src-tauri && cargo check` | **verde**, exit `0`, `Finished dev profile … in 1.30s`, 84 warnings |
| 5 | `cd src-tauri && cargo test --lib` (reafirmação) | **verde**: `1006 passed; 0 failed; 13 ignored`, 21,50 s |
| 6 | `pnpm exec vitest run <8 arquivos afetados> --sequence.shuffle` **2×** (seeds `1793373162499` e `1793373196355`) | **verde 2/2**: `8 passed (8)` / `198 passed (198)` em cada (32,58 s / 29,51 s) |
| 7 | `pnpm exec vitest run src/lib/__tests__/chatStore.test.ts -t "account-only"` | **verde**: `1 passed \| 46 skipped`, exit `0` (o teste novo executa e passa isolado) |
| 8 | hash do diff + `git diff --stat -- src-tauri` após tudo | `185bf7a5…` e `5 files changed, 487 insertions(+), 17 deletions(-)` — **inalterados** |

### 7.4 Checklist do delta

- ✅ **R1 resolvido**: modelo só-da-conta escolhido numa sessão Code realinha a seleção ao reabrir
  (fix + teste dedicado + revisão de código); sem regressão no caminho de catálogo (fallback
  estático e suíte inteira verdes).
- ✅ **R7 resolvido**: DESIGN §8 explicita a precedência do bloqueio permanente.
- ⏸️ **R2–R6, R8, R9, O1, O2** permanecem como registrados na §3 (não foram tocados pelo delta; a
  suíte inteira e os testes filtrados seguem verdes — nenhuma regressão).
- ✅ **Nenhum arquivo de produção além de `chatStore.ts` mudou** no delta (os outros dois são teste
  e doc), confirmado por mtime; `src-tauri/**` intocado.

### 7.5 Veredito do delta

**Aprovado** — o fix do R1 está correto, coberto por teste, sem dependência circular e sem
regressão (suíte **129/129 arquivos, 2413/2413 testes**; build/typecheck/cargo verdes; shuffle 2×
verde; hash do tree estável). **Veredito final mantido: aprovado sem bloqueadores**; restam apenas
R2–R6 (baixas) e R8–O2 (cosméticas/observações) documentadas na §3.
