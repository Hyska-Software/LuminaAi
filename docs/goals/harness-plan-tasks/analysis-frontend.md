# Auditoria de frontend — modo Plano e sistema de tarefas (harness de código)

- **Data:** 28/10/2026 (America/Sao_Paulo)
- **Repo:** `H:\ChatTauri` — branch `feat/code-harness`, HEAD `317e299` ("Add Code file preview tabs"), working tree limpo
- **Escopo:** renderer React/TS — PlanCard, gate de aprovação em `CodeSessionCards`, apresentação de plano na timeline (`ToolPresentationCard`/`AgentSteps`), chip/toggle Plano do composer, `/plan` e `/plan off`, popover prometido, store (`codeStore`), tipos (`types.ts`/`api.ts`), `TodoCard`/apresentação `todos`/duplicidade/estados/a11y/tokens.
- **Método:** leitura de código (read/grep), contrato Rust apenas para confirmar payloads/eventos (somente leitura), sem editar código nem rodar build/typecheck (dono: qa-verifier). Executei apenas testes pontuais: `pnpm vitest run PlanCard TodoCard ToolPresentationCard CodeSessionControls` → **22/22 verdes**, confirmando que a suíte atual não cobre os achados abaixo.
- **Docs de comparação:** `docs/goals/code-harness/{WORKBENCH,HARNESS,TOOLS,PLAN}.md`, `docs/DESIGN.md`; baseline de testes em `analysis-baseline.md` (qa-verifier).

## Sumário executivo

1. **P0 — crash de render na apresentação de plano.** O backend grava `presentation` de `submit_plan` como `{kind:"plan", state:"approved"}` / `{kind:"plan", state:"reviewing", feedback}`, mas o tipo TS `ToolPresentation` espera `{kind:"plan", plan: PlanView}`. `ToolPresentationCard` passa `presentation.plan` (que é `undefined`) ao `PlanCard`, que acessa `plan.markdown` → `TypeError` → o `ErrorBoundary` global da App substitui a janela inteira. Consequência: **qualquer** mensagem que contenha um `submit_plan` (aprovado ou negado, ao vivo ou recarregada do histórico) derruba a UI do app. Isso torna o "gate de aprovação do plano" inutilizável na prática e invalida o achado da baseline "botões mortos no PlanCard da timeline": o card não chega a renderizar.
2. **P1 — `/plan` não ativa o modo Plano.** O comando é `action:'fill'` (só insere texto); não existe nenhuma chamada `setPlanMode(true)` fora do chip. O `submit_plan` só funciona com `plan_mode` ativo e o prompt só instrui o modelo nesse modo; logo o fluxo de aceite do F5 ("`/plan` → plano revisável → aprovação → execução") não acontece pela UI.
3. **P1 — `/plan off` dessincroniza o chip do backend.** O handler chama `api.setPlanMode(...)` direto, ignora o snapshot devolvido e o comando Rust não emite evento — o chip "Plano" continua aceso após o toast "Modo Plano desativado" até o próximo refresh/turno.
4. **P1 — o chip Plano se desliga sozinho a cada turno.** O backend emite `profile_changed` com `plan_mode:false` fixo no início do turno Code e o reducer sobrescreve `planMode`; durante todo o turno de planejamento a UI mostra o modo desligado (o backend segue negando mutações).
5. **P1 — o gate de plano é inacessível na prática.** Ele é montado no fim do transcript (não rola até ele — o auto-scroll só observa `messages`), só existe no layout Code, só quando há mensagens e não há badge/notificação de "aguardando aprovação"; o timeout da tool `submit_plan` é 60 s. Sem ver o card, o plano expira e o turno falha.
6. **P1 — "Aprovar e revisar cada edição" é uma promessa sem efeito.** `approve_review` e `approve_run` mapeiam para a mesma decisão `approved`, o contrato de resposta não carrega modo e não existe "Editar com aprovação por escrita" (`PermissionMode` = Leitura/Editar/Autônomo, onde Editar escreve direto) — o usuário acha que comprou uma salvaguarda que não existe.
7. **P1 — gate do plano não é um diálogo acessível** (sem `role=alertdialog`, foco inicial, `Esc`, `aria-live`, `aria-busy`/botões desabilitados): teclado e leitor de tela não operam o gate; clique duplo dispara duas decisões. O `ApprovalCard` ao lado faz tudo isso — a inconsistência é do `PlanCard` como gate.
8. **P2 — tarefas duplicadas e sem poda.** Cada `todo_write` gera um `TodoCard`-snapshot na timeline (N por turno, sempre expandido) **e** há um card fixo no fim do `ChatView` com `session.todos` (que inclui concluídas para sempre e reaparece ao reabrir a sessão). Não há limite de altura, filtro "mostrar concluídas", popover, nem estado vazio explícito.
9. **P2 — estados mortos/inalcançáveis:** `session.plan` nunca é lido por nenhum componente; o estado `planning` do `PlanCard` nunca é montado; o popover de plano (§5.4) e o popover de tarefas (TOOLS §2.5) não existem; `resolutions`/`questionAnswers` do store nunca são lidos (não há linha "Permitido/Negado" — §5.3); `ToolPresentations` está exportado e sem uso.
10. **P2 — a timeline mostra nomes de tool em inglês** ("Executou submit plan", "Executou todo write") e ícone genérico: `agentTrace.ts`/`TOOL_ICONS` não foram estendidos para as tools de código, contrariando WORKBENCH §5.2/§10 (pt-BR).
11. **P2/P3 — a11y e microcopy:** metadados em `text-foreground-subtle` (11–12 px) ficam em 3,1–3,8:1 (< 4,5:1 de DESIGN §12); chip Plano ativo em `text-accent`/`bg-accent-soft` = 4,40:1 no tema claro; `aria-live="polite"` envolvendo cards interativos (anúncio verboso); textos "O usuário preferiu…", "N arquivo(s) alterado(s)", "Subagente explore".
12. **P2 — ação morta silenciosa no plano persistido (latente atrás de F-01).** `ToolPresentationCard` monta o `PlanCard` com `onAction={() => undefined}`; quando o shape do plano estiver corrigido, qualquer plano negado no histórico renderiza "Aprovar e executar"/"Aprovar e revisar cada edição"/"Continuar planejando" habilitados e **sem efeito**. A hipótese da tarefa está confirmada — hoje o crash de F-01 acontece antes de o botão existir; depois do fix do contrato é o próximo defeito visível.

## Visão geral dos achados

| ID | Sev. | Título | Evidência principal |
| --- | --- | --- | --- |
| F-01 | **P0** | Payload `plan` não casa com `ToolPresentation` → `PlanCard` com `plan=undefined` derruba a App | `src-tauri/src/tools/code/exec.rs:2329,2342`; `src/lib/types.ts:372`; `src/components/agent/ToolPresentationCard.tsx:27-28`; `src/components/agent/PlanCard.tsx:29-32`; `src/App.tsx:229` |
| F-02 | P1 | `approve_review` ≡ `approve_run`: "Aprovar e revisar cada edição" não tem efeito | `src/components/code/CodeAgentWidgets.tsx:81-89`; `src/lib/api.ts:182-192`; `src/lib/types.ts:154`; `src-tauri/src/tools/code/exec.rs:2318-2331` |
| F-03 | P1 | `/plan` não ativa o modo Plano (só preenche texto) | `src/components/composer/commands.ts:36-44`; `src/components/composer/Composer.tsx:365-369`; `src-tauri/src/tools/code/exec.rs:2268-2274` |
| F-04 | P1 | `/plan off` chama a API direto e dessincroniza o `codeStore`/chip | `src/components/composer/Composer.tsx:334-350`; `src/lib/store/codeStore.ts:368-382`; `src/components/composer/CodeSessionControls.tsx:72` |
| F-05 | P1 | `profile_changed` (plan_mode:false fixo) desliga o chip em todo turno Code | `src-tauri/src/harness/mod.rs:742-751`; `src/lib/store/codeStore.ts:162-167` |
| F-06 | P1 | Gate de plano não é descoberto: fim do transcript, sem auto-scroll, sem badge, só no layout Code | `src/components/chat/ChatView.tsx:102-104,136-141`; `src/components/code/CodeAgentWidgets.tsx:60-124`; `src-tauri/src/harness/code/tools.rs:39` |
| F-07 | P1 | Gate do plano sem foco/Esc/`alertdialog`/`aria-live`/`aria-busy` e com duplo submit | `src/components/agent/PlanCard.tsx:86-152`; contraste com `src/components/agent/ApprovalCard.tsx:152-156,185-196,203-218` |
| F-08 | P2 | `TodoCard` duplicado: N snapshots na timeline + card fixo da sessão, sem poda | `src/components/chat/AgentSteps.tsx:231-237`; `src/components/agent/ToolPresentationCard.tsx:26`; `src/components/code/CodeAgentWidgets.tsx:123` |
| F-09 | P2 | Plano/tarefas sempre expandidos e sem limite de altura (contraria §5.2) | `src/components/agent/PlanCard.tsx:101-103`; `src/components/agent/TodoCard.tsx:45`; `src-tauri/src/tools/code/exec.rs:2279` |
| F-10 | P2 | Plano aprovado/planejando sem superfície própria: `session.plan` morto, popovers ausentes | `src/lib/store/codeStore.ts:35,138,203`; `src/lib/types.ts:384`; `src/components/agent/ToolPresentationCard.tsx:28` |
| F-11 | P2 | Decisão de aprovação nunca vira linha resolvida; falha/expiração não refresca | `src/lib/store/codeStore.ts:44-46,310-321`; `src/components/code/CodeAgentWidgets.tsx:61-70` |
| F-12 | P2 | Tools de código sem labels/ícones pt-BR na timeline | `src/lib/agentTrace.ts:145-176,445-451`; `src/components/chat/AgentSteps.tsx:47-57` |
| F-13 | P2 | Contraste AA violado em metadados dos cards/chip ativo | `src/styles/globals.css:21,51`; `src/components/agent/TodoCard.tsx:66`; `src/components/agent/PlanCard.tsx:63,98`; `src/components/composer/CodeSessionControls.tsx:145` |
| F-14 | P3 | `aria-live` no contêiner de cards interativos (ruído/duplicação) | `src/components/code/CodeAgentWidgets.tsx:60`; `src/components/agent/ApprovalCard.tsx:216-218` |
| F-15 | P3 | Microcopy fora do padrão pt-BR/design | `src/components/agent/ToolPresentationCard.tsx:35,66,83-85`; `src/components/composer/commands.ts:40` |
| F-16 | P3 | `TodoItem` sem `id` (contrato PLAN §5.1) → chave `index+content`, sem identidade estável | `docs/goals/code-harness/PLAN.md:252`; `src/lib/types.ts:289-292`; `src/components/agent/TodoCard.tsx:51` |
| F-17 | P3 | Toggle Plano sem atualização otimista/spinner (vizinho de permissão tem) | `src/lib/store/codeStore.ts:345-382`; `src/components/composer/CodeSessionControls.tsx:86-94` |
| F-18 | P3 | Código/contrato mortos: `ToolPresentations` sem uso; kinds `output`/`terminal`/`approval` descartadas | `src/components/agent/ToolPresentationCard.tsx:88-89,140-149`; `docs/goals/code-harness/TOOLS.md:47-49` |
| F-19 | P3 | Atalhos do doc ausentes (`Shift+Tab` Plano, `Ctrl+.` seletor de modo) | `docs/goals/code-harness/WORKBENCH.md:173-174`; `src/components/composer/Composer.tsx:166-178,409-455` |
| F-20 | P3 | `title` + `Tooltip` duplicados no chip Plano; `relativeTime` congelado/`updatedAt` de planning instável | `src/components/composer/CodeSessionControls.tsx:134-152`; `src-tauri/src/commands/code.rs:171`; `src/lib/utils.ts:76` |
| F-21 | P3 | Placeholder sem workspace divergente do doc (e teste encoda a cópia antiga) | `docs/goals/code-harness/WORKBENCH.md:171-172`; `src/components/composer/Composer.tsx:483-487`; `src/components/composer/Composer.code.test.tsx:154-160` |
| F-22 | P2 | Plano persistido na timeline renderiza ações "vivas" que não fazem nada (`onAction` noop) — latente atrás de F-01 | `src/components/agent/ToolPresentationCard.tsx:28`; `src/components/agent/PlanCard.tsx:105-150` |

---

## Achados — detalhe

### F-01 — P0 — `presentation.kind === 'plan'` não casa com o tipo TS e derruba a UI

**Evidência**

- Backend grava o payload em dois formatos *flat*: `Some(json!({ "kind": "plan", "state": "approved" }))` — [`src-tauri/src/tools/code/exec.rs:2329`](src-tauri/src/tools/code/exec.rs#L2329) — e `Some(json!({ "kind": "plan", "state": "reviewing", "feedback": feedback }))` — [`src-tauri/src/tools/code/exec.rs:2342`](src-tauri/src/tools/code/exec.rs#L2342). Nenhum dos dois inclui `markdown` nem a chave `plan`.
- O tipo TS espera outro formato (aninhado): `| { kind: 'plan'; plan: PlanView }` — [`src/lib/types.ts:372`](src/lib/types.ts#L372) — com `PlanView = { state; markdown?; updatedAt }` em [`src/lib/types.ts:296-300`](src/lib/types.ts#L296).
- `ToolPresentationCard` passa `presentation.plan` direto: [`src/components/agent/ToolPresentationCard.tsx:27-28`](src/components/agent/ToolPresentationCard.tsx#L27). Em runtime `presentation.plan` é `undefined`.
- `PlanCard` desreferencia logo no topo: `plan.markdown?.trim()` e `plan.state` — [`src/components/agent/PlanCard.tsx:29-32`](src/components/agent/PlanCard.tsx#L29) — `TypeError: Cannot read properties of undefined (reading 'markdown')`.
- O caminho de render existe em toda mensagem com tool calls: `AgentSteps` coleta `tool.presentation` e renderiza `ToolPresentationCard` fora do bloco recolhível — [`src/components/chat/AgentSteps.tsx:103-111,231-237`](src/components/chat/AgentSteps.tsx#L103); `MessageItem` monta `AgentSteps` quando `toolCalls.length > 0` — [`src/components/chat/MessageItem.tsx:206-213`](src/components/chat/MessageItem.tsx#L206).
- O payload é persistido e recarregado sem validação: `ToolCallRecord.presentation` no Rust é `Option<Value>` — [`src-tauri/src/domain.rs:100-121`](src-tauri/src/domain.rs#L100) — codificado no campo `tool_calls` da mensagem ([`src-tauri/src/db.rs:836-846`](src-tauri/src/db.rs#L836)); no renderer entra por `message_updated`/`tool_call_finished` sem normalização — [`src/lib/store/chatStore.ts:475-489`](src/lib/store/chatStore.ts#L475); a tipagem é uma asserção, não validação ([`src/lib/types.ts:145`](src/lib/types.ts#L145)).
- Não há boundary local: o único `ErrorBoundary` envolve o `AppShell` inteiro — [`src/App.tsx:229`](src/App.tsx#L229); o fallback substitui a janela por "Algo quebrou por aqui" — [`src/components/ErrorBoundary.tsx:24-39`](src/components/ErrorBoundary.tsx#L24).
- O contrato documentado tem uma **terceira** forma: `Plan { markdown: String, state: PlanReviewState }` — [`docs/goals/code-harness/TOOLS.md:41-50`](docs/goals/code-harness/TOOLS.md#L41). Ou seja: doc (flat com markdown) ≠ backend (flat sem markdown) ≠ TS (aninhado PlanView).
- A baseline do qa-verifier (item P1#5) descreve "ações mortas" no card da timeline; na prática o crash acontece antes de qualquer botão existir. É um achado novo desta auditoria.
- **Confiança:** alta (shape determinístico verificado nas duas pontas). Não executei a reprodução porque a tarefa proíbe criar/editar arquivos de teste; a validação executável está na seção "Teste necessário".

**Impacto (UX/a11y)**

- Aprovar um plano ao vivo derruba o app inteiro (perde scroll, composer, estado visual) — o usuário não consegue continuar o turno.
- Reabrir qualquer sessão que já teve `submit_plan` reproduz o crash ao montar a mensagem (histórico persistido): a sessão fica "envenenada".
- Bloqueia a verificação manual de todo o fluxo F5 e mascara F-07/F-09/F-10.

**Correção proposta mínima**

1. **Contrato (Lead):** escolher o formato canônico e alinhar doc+TS+Rust. Recomendo o formato *flat* de TOOLS §1.1 (`{ kind:"plan", markdown, state }`, opcional `feedback`), que já é quase o que o backend emite — só falta o `markdown` (que existe em `submit_plan`; no `Denied` também pode ser incluído) — e atualizar `ToolPresentation` para `{ kind:'plan'; markdown: string; state: PlanState; feedback?: string | null }` (ou manter `PlanView` aninhado e mudar o Rust; qualquer escolha exige atualizar `ToolPresentationCard`).
2. **Hotfix defensivo no renderer (ui-agent):** type guard `isPlanPresentation()` em `ToolPresentationCard`; se o shape não bater, renderizar uma linha compacta ("Plano — apresentação indisponível nesta versão") em vez de montar o `PlanCard`; e um `ErrorBoundary` por apresentação (não global) para que payloads futuros não derrubem a janela.
3. Atualizar `PlanCard` para aceitar `plan?: PlanView | null` e degradar sem ações.

**Teste necessário**

- `ToolPresentationCard.test.tsx`: payloads **reais** do Rust para `plan` aprovado (`{kind:'plan',state:'approved'}`) e negado (`{kind:'plan',state:'reviewing',feedback}`) → não lançar; com o contrato corrigido, renderizar o card.
- `AgentSteps.test.tsx`: mensagem com `toolCalls[].presentation` de plano renderiza o card (hoje zero cobertura de presentations).
- Teste de integração curto: `render(<ToolPresentationCard presentation={payloadDoBackend} />)` sem `throw` (o crash é a regressão).
- Opcional: teste de contrato doc↔TS (`ToolPresentation` × TOOLS §1.1) no estilo do teste de paridade GenUI.

---

### F-02 — P1 — "Aprovar e revisar cada edição" não tem efeito (mesma decisão de "Aprovar e executar")

**Evidência**

- O gate traduz as três ações em duas: `keep_planning → denied`; **tudo o resto → `approved`** — [`src/components/code/CodeAgentWidgets.tsx:81-89`](src/components/code/CodeAgentWidgets.tsx#L81).
- `api.respondApproval` só carrega `decision`, `scope` e `feedback` — não há canal para "revisar cada edição" — [`src/lib/api.ts:182-192`](src/lib/api.ts#L182); `ApprovalDecision` é `approved|denied|cancelled|expired` ([`src/lib/types.ts:168`](src/lib/types.ts#L168)) e `PermissionMode` não tem modo "editar com aprovação por escrita" ([`src/lib/types.ts:154`](src/lib/types.ts#L154)).
- Backend: no `Approved` o `submit_plan` apenas grava `plan/submitted` + `plan/approved` e segue — nenhuma mudança de `permission_mode`/flag de revisão — [`src-tauri/src/tools/code/exec.rs:2318-2331`](src-tauri/src/tools/code/exec.rs#L2318).
- Doc promete: "**Aprovar e revisar cada edição** (sai para modo Editar com aprovação por escrita)" — [`docs/goals/code-harness/WORKBENCH.md:145-147`](docs/goals/code-harness/WORKBENCH.md#L145); já `HARNESS.md:228` define Editar como "escrita no workspace ✅ auto" (não existe "aprovação por escrita"), e `HARNESS.md:235-236` diz que Plano é overlay e a UI nunca muda o modo automaticamente.
- A baseline já anota o `approve_review` sem efeito (`analysis-baseline.md`, P1#4); falta a decisão de contrato.

**Impacto (UX/a11y)**

- Promessa de segurança quebrada: o usuário escolhe a opção mais cautelosa e o agente passa a editar arquivos sem confirmação (modo Editar). É o tipo de divergência que destrói confiança no gate.
- Duas opções com rótulos distintos e efeito idêntico é um anti-padrão de UI (decisão ilusória).

**Correção proposta mínima**

- **Decisão de contrato (Lead/backend):** (a) implementar de verdade — `respond_approval` ganha `reviewEdits: bool` (ou novo `PermissionMode::EditConfirm`) e o backend passa a pedir aprovação por escrita; ou (b) retirar/desabilitar o botão com rótulo honesto ("em breve") e atualizar `WORKBENCH §5.4`/`DESIGN §14`. Não deixar como está.
- No renderer, enquanto o contrato não muda: passar a ação como `feedback`/`scope` seria um hack; preferível esconder a segunda opção e registra a dívida.
- Se (a): `CodeSessionCards` deve aplicar a decisão de modo no store/snapshot (não só `approved`).

**Teste necessário**

- `CodeSessionCards.test.tsx` (não existe): clicar em cada uma das 3 ações → `respondApproval` com `decision`/`feedback` esperados; com (a), `reviewEdits:true` para `approve_review`.
- Backend: teste de aprovação com revisão por escrita (fora do meu escopo; cross-ref `analysis-backend.md`).

---

### F-03 — P1 — `/plan` não ativa o modo Plano (fluxo principal do modo quebrado)

**Evidência**

- `/plan` é `action:'fill'` com texto pronto — **não** invoca nada — [`src/components/composer/commands.ts:36-44`](src/components/composer/commands.ts#L36). O próprio `description` admite ("o modo Plano fica no campo de mensagem"), contrariando o catálogo do doc: "`/plan [instrução]` | **entra no modo Plano**" — [`docs/goals/code-harness/WORKBENCH.md:347`](docs/goals/code-harness/WORKBENCH.md#L347).
- O caminho de `fill` só escreve no textarea — [`src/components/composer/Composer.tsx:365-369`](src/components/composer/Composer.tsx#L365); `runInvoke` não tem caso `plan` ([`Composer.tsx:288-356`](src/components/composer/Composer.tsx#L288)).
- O único caminho que liga o plano é o chip: `setPlanMode(conversationId, !planMode)` — [`src/components/composer/CodeSessionControls.tsx:86-94`](src/components/composer/CodeSessionControls.tsx#L86). Nenhum outro consumidor de `setPlanMode(..., true)` no renderer.
- Sem `plan_mode` ativo: `submit_plan` falha com `PLAN_MODE_INACTIVE` — [`src-tauri/src/tools/code/exec.rs:2268-2274`](src-tauri/src/tools/code/exec.rs#L2268); o prompt só inclui as regras de plano quando `ctx.plan_mode` — [`src-tauri/src/harness/code/prompt.rs:110-115`](src-tauri/src/harness/code/prompt.rs#L110). Resultado: o modelo não submete plano e pode editar direto (política normal de Editar).
- Aceite do doc impossível de cumprir pela UI: "`/plan` num pedido grande → plano revisável → aprovação → execução" — [`docs/goals/code-harness/PLAN.md:391`](docs/goals/code-harness/PLAN.md#L391); idem WORKBENCH §8.3: "`/plan …` → modo Plano ativa" ([`WORKBENCH.md:268`](docs/goals/code-harness/WORKBENCH.md#L268)) e HARNESS §6.1: "ativado por `/plan` ou chip" ([`HARNESS.md:235`](docs/goals/code-harness/HARNESS.md#L235)).
- Não há teste de `/plan` (o `Composer.code.test.tsx` só testa `/review` como `fill`) — ver mapa de testes.

**Impacto (UX/a11y)**

- O usuário digita exatamente o comando que o doc manda, vê o texto inserido e acredita estar em modo Plano; o agente implementa sem gate e sem card. É o fluxo mais importante da fase F5.
- Descrição do comando ambígua ("o modo Plano fica no campo de mensagem") — microcopy que precisa mudar junto.

**Correção proposta mínima**

- Extrair a ativação para o `codeStore` (`setPlanMode(id, true)`) e chamar no `runInvoke` de `/plan` (com toast/erro), mantendo o preenchimento do prompt como cortesia. Considerar sufixo de instrução (`/plan <instrução>` → ativar + inserir instrução) para cumprir o catálogo.
- Se o produto decidir que `/plan` não ativa, atualizar WORKBENCH §6/§8.3/§12, HARNESS §6.1, PLAN F5 e o teste — hoje há três docs afirmando o contrário.

**Teste necessário**

- `Composer.code.test.tsx`: `/plan` → `api.setPlanMode('c-1', true)` (ou `codeStore.planMode === true`) **e** chip `aria-pressed=true`; texto de instrução opcional.
- Integração: `/plan` + envio → turno com `plan_mode` refletido no chip (sem `profile_changed` apagando — F-05).

---

### F-04 — P1 — `/plan off` chama a API direto e deixa o chip dessincronizado

**Evidência**

- Handler exclusivo do composer chama `api.setPlanMode(conversationId, false)` direto no `.then/.catch`, sem tocar o `codeStore` — [`src/components/composer/Composer.tsx:334-350`](src/components/composer/Composer.tsx#L334).
- O store tem `setPlanMode` que aplica o snapshot retornado ([`src/lib/store/codeStore.ts:368-382`](src/lib/store/codeStore.ts#L368)), mas o slash command não o usa.
- O comando Rust `set_plan_mode` grava `plan/mode` e devolve o snapshot, **sem emitir evento** — [`src-tauri/src/commands/code.rs:310-323`](src-tauri/src/commands/code.rs#L310) — então nenhum outro caminho corrige a UI.
- O chip lê `session?.planMode ?? false` — [`src/components/composer/CodeSessionControls.tsx:72`](src/components/composer/CodeSessionControls.tsx#L72) — e continua aceso até o próximo `refresh()`/`load()` (fim de turno, troca de conversa).
- O teste atual valida só a chamada da API, não a sincronização — [`src/components/composer/Composer.code.test.tsx:380-392`](src/components/composer/Composer.code.test.tsx#L380).

**Impacto (UX/a11y)**

- Toast "Modo Plano desativado" + chip "Plano" pressionado ao mesmo tempo = feedback contraditório. O usuário não sabe se o agente ainda está em modo Plano (crítico: mutações continuam negadas se o backend não desligou; ou ficam liberadas quando ele acha que ainda está planejando).
- Sem `aria-live`, leitores de tela não recebem a mudança correta.

**Correção proposta mínima**

- Rotear `/plan off` por `useCodeStore.getState().setPlanMode(conversationId, false)` (ou reutilizar a função do `CodeSessionControls`) e deixar o toast no store; nunca chamar `api` direto de um único comando de UI.
- `setPlanMode` no store: atualizar otimista + rollback (ver F-17) e/ou `refresh` em caso de retorno inesperado.

**Teste necessário**

- `Composer.code.test.tsx`: `/plan off` → `codeStore.byConversation['c-1'].planMode === false` **e** chip `aria-pressed=false` imediatamente (sem refresh).
- `codeStore.test.ts`: `setPlanMode` aplica snapshot / erro mantém valor anterior.

---

### F-05 — P1 — `profile_changed` desliga o chip Plano no início de todo turno Code

**Evidência**

- Backend emite, fixo, `plan_mode: false` no começo do turno Code — [`src-tauri/src/harness/mod.rs:742-751`](src-tauri/src/harness/mod.rs#L742) — mesmo quando `plan_mode_active(db)` é verdadeiro (o prompt/loop usam o valor real via `code::context::build`).
- O reducer sobrescreve `planMode` com o evento, sem validação — [`src/lib/store/codeStore.ts:162-167`](src/lib/store/codeStore.ts#L162).
- O chip depende desse campo ([`CodeSessionControls.tsx:72`](src/components/composer/CodeSessionControls.tsx#L72)); `applyCodeEvent` aplica o evento antes de qualquer outro tratamento no `chatStore` ([`src/lib/store/chatStore.ts:390-393`](src/lib/store/chatStore.ts#L390)).
- Baseline registra o mesmo bug no backend (`analysis-baseline.md`, P0#3).

**Impacto (UX/a11y)**

- Durante todo o turno em modo Plano o chip mostra "desligado"; o plano é submetido/negado e o usuário não entende por que as escritas falham com `PLAN_MODE_ACTIVE`. Ao fim do turno, o `refresh` devolve `planMode:true` e o chip religa sozinho (flicker) — a UI parece inconsistente.
- Combina com F-03/F-04: nenhuma superfície comunica de forma confiável "estou em modo Plano agora".

**Correção proposta mínima**

- **Backend (preferível):** emitir `plan_mode` real (`code_context.plan_mode`/`plan_mode_active`) e/ou não emitir o campo quando desconhecido.
- **Mitigação UI (até o fix):** no reducer, ignorar `event.planMode` e manter o valor atual (ou derivar só de `plan_updated`/snapshot), documentando o motivo; opcional: expor `planMode` só no store, vindo de `setPlanMode`/snapshot.

**Teste necessário**

- `codeStore.test.ts`: `profile_changed` com `permissionMode:'edit'` e `planMode:false` **não** derruba `planMode` quando ele era `true` (ou teste explicita a decisão de espelhar).
- Integração de turno: chip aceso continua aceso após `profile_changed` (ou `analysis-backend` cobre do lado Rust).

---

### F-06 — P1 — O gate de aprovação do plano não é percebido (posição, scroll, layout, badge, timeout)

**Evidência**

- `CodeSessionCards` é montado **depois** de `MessageList`, dentro do contêiner rolável — [`src/components/chat/ChatView.tsx:136-141`](src/components/chat/ChatView.tsx#L136) — e só no layout Code (`layoutMode === 'code'`) e só quando `messages.length > 0` ([`ChatView.tsx:129-142`](src/components/chat/ChatView.tsx#L129)).
- O auto-scroll só reage a mudanças em `messages` — `useLayoutEffect(..., [messages, scrollToBottom])` — [`ChatView.tsx:102-104`](src/components/chat/ChatView.tsx#L102). Aprovações/tarefas vivem no `codeStore`, não em `messages`: quando o gate é inserido abaixo do último turno, ninguém rola até ele (o usuário estava "no fim" e deixa de estar sem perceber).
- Não há badge de "aguardando aprovação" no header/abas (grep por `approval|approv|Aprova` em `CodeSessionHeader.tsx` não retorna nada) nem notificação, contrariando a matriz: "Aguardando aprovação → badge âmbar na aba/header + card inline; notificação se app em background" — [`docs/goals/code-harness/WORKBENCH.md:307-308`](docs/goals/code-harness/WORKBENCH.md#L307).
- A tool `submit_plan` tem timeout de **60 s** (`todo_write` idem) — [`src-tauri/src/harness/code/tools.rs:34-43`](src-tauri/src/harness/code/tools.rs#L34) — enquanto o timeout de revisão configurável é bem maior (default citado na baseline). Revisar um plano leva minutos: o gate expira antes.
- Se o usuário trocar para o layout Chat (ou fechar a aba central) enquanto o plano aguarda, `CodeSessionCards` desmonta e o card some; o turno fica bloqueado até o timeout.
- Nenhum teste cobre `CodeSessionCards` (ver mapa de testes).

**Impacto (UX/a11y)**

- O fluxo "plano → aprovação → execução" falha por *não ser visto*: o turno termina com `TOOL_TIMEOUT`/plano expirado e o usuário acha que o agente travou. É o mesmo efeito de F-01 (fluxo inutilizável) por outro caminho.
- Se o app está em background, não há aviso algum (perda de trabalho do turno).

**Correção proposta mínima**

1. Efeito dedicado: quando `session.approvals.length` (ou `session.plan`/`todos`) crescer, rolar até o card (`scrollToBottom`) e/ou mover o gate para uma posição fixa (acima do composer, junto de `CodeJobsBar`) com `aria-live`.
2. Badge "Aguardando aprovação" no header/aba (`CodeSessionHeader`/tabs) lendo `codeStore.approvals.length`.
3. Renderizar o gate mesmo sem mensagens (não exigir `messages.length > 0`) e manter o gate montado independentemente do layout (ou impedir a troca de layout com aprovação pendente).
4. Alinhar o timeout de `submit_plan` ao `approval_timeout` (backend) — cross-ref `analysis-backend.md`.

**Teste necessário**

- `CodeSessionCards.test.tsx` (novo): gate aparece com `approvals[0].tool === 'submit_plan'`; `ChatView.test.tsx`: card com gate é rolado para a viewport ao montar (jsdom: `scrollTop`/`scrollIntoView` mockado); header mostra badge.
- Teste de fumaça do fluxo: gate renderiza com layout `chat`? (decisão) — se não, teste garante que troca de layout não esconde aprovação pendente.

---

### F-07 — P1 — Gate do plano não é um diálogo acessível e permite duplo submit

**Evidência**

- O `PlanCard` usado como gate (reviewing) não tem: `role="alertdialog"`/`aria-labelledby`, foco inicial no primeiro botão, `Esc` = negar/continuar, região `aria-live`, `aria-busy`, nem desabilitação dos botões durante o envio — [`src/components/agent/PlanCard.tsx:86-152`](src/components/agent/PlanCard.tsx#L86). Os `Button` não recebem `loading`/`disabled`.
- `CodeSessionCards` mantém `responding` local, mas o repassa **apenas** ao `ApprovalCard` — [`src/components/code/CodeAgentWidgets.tsx:62-70,78-90`](src/components/code/CodeAgentWidgets.tsx#L62) — o `PlanCard` não aceita essa prop.
- O card vizinho faz tudo certo e serve de referência: foco no mount ([`ApprovalCard.tsx:152-156`](src/components/agent/ApprovalCard.tsx#L152)), `Esc` = negar ([`185-196`](src/components/agent/ApprovalCard.tsx#L185)), `role="alertdialog"` + `aria-live="assertive"` ([`203-218`](src/components/agent/ApprovalCard.tsx#L203)), botões `disabled`/`loading` ([`277-287`](src/components/agent/ApprovalCard.tsx#L277)).
- Exigência do doc: "Aprovação: `role="alertdialog"` no card, foco no primeiro botão, `Esc` = negar, retorno de foco ao composer ao resolver; anúncio `aria-live="assertive"`" — [`docs/goals/code-harness/WORKBENCH.md:325-326`](docs/goals/code-harness/WORKBENCH.md#L325).
- Sem `disabled`, dois cliques rápidos em "Aprovar e executar" chamam `decide` duas vezes → duas chamadas `respondApproval` (a segunda retorna `APPROVAL_NOT_FOUND`/toast).

**Impacto (UX/a11y)**

- Teclado não alcança o gate (foco fica no composer); leitor de tela não anuncia o pedido; `Esc` não funciona; usuário não tem retorno de "enviando".
- Duplo submit gera erro espúrio/toast e decisão ambígua (o backend resolve o primeiro e rejeita o segundo).
- Contraste com o `ApprovalCard` (mesmo contexto, mesmo tipo de decisão) evidencia o gap.

**Correção proposta mínima**

- Adicionar ao `PlanCard` (ou a um wrapper `PlanApprovalGate`): props `responding?: boolean` (desabilita ações + `aria-busy`), foco inicial no botão primário, `onKeyDown` `Esc` → `keep_planning` (ou fechar feedback), `role="alertdialog"` + `aria-labelledby` do título + `aria-live="assertive"` para o anúncio "Plano aguardando aprovação".
- No `CodeSessionCards`, passar `responding={responding === approval.id}` ao `PlanCard` e guardar contra reentrada em `decide`.

**Teste necessário**

- `PlanCard.test.tsx`: foco inicial no gate; `Esc` dispara ação; `responding` desabilita os 3 botões e marca `aria-busy`; `aria-live` presente.
- `CodeSessionCards.test.tsx`: duplo clique chama `respondApproval` uma vez.

---

### F-08 — P2 — `TodoCard` duplicado (N snapshots na timeline + card fixo da sessão)

**Evidência**

- Cada `todo_write` persiste `presentation {kind:"todos", items}` — [`src-tauri/src/tools/code/exec.rs:2245-2265`](src-tauri/src/tools/code/exec.rs#L2245) (e emite `todos_updated`).
- `AgentSteps` renderiza **um `TodoCard` por presentation**, fora do bloco recolhível — [`src/components/chat/AgentSteps.tsx:231-237`](src/components/chat/AgentSteps.tsx#L231) + [`ToolPresentationCard.tsx:25-26`](src/components/agent/ToolPresentationCard.tsx#L25). Um turno com 4 `todo_write` deixa 4 listas completas na mesma mensagem.
- O `CodeSessionCards` renderiza **outro** `TodoCard` com o estado atual `session.todos` — [`src/components/code/CodeAgentWidgets.tsx:123`](src/components/code/CodeAgentWidgets.tsx#L123) — posicionado depois da última mensagem ([`ChatView.tsx:136-141`](src/components/chat/ChatView.tsx#L136)).
- Ao reabrir a sessão, o card fixo reaparece com a última lista (inclusive 100% concluída) para sempre: `session.todos` vem do snapshot — [`src/lib/store/codeStore.ts:195-215`](src/lib/store/codeStore.ts#L195) e [`src-tauri/src/commands/code.rs:103-109`](src-tauri/src/commands/code.rs#L103).
- Não há card/popover no header para tarefas (TOOLS: "card na timeline **+ popover no header**" — [`TOOLS.md:294`](docs/goals/code-harness/TOOLS.md#L294); PLAN F5: "card e popover de tarefas" — [`PLAN.md:386`](docs/goals/code-harness/PLAN.md#L386)).

**Impacto (UX/a11y)**

- Transcript poluído e contraditório: listas antigas (stale) logo acima da lista atual, sem indicar qual é a vigente.
- O card fixo nunca "fecha": após o turno, tarefas concluídas continuam ocupando o rodapé de todas as mensagens futuras; em sessões longas é ruído permanente.
- Sem popover/limpeza, não há como consultar as tarefas sem rolar até o fim.

**Correção proposta mínima**

- **Uma fonte de verdade:** no turno, manter só o card fixo (session) atualizado ou só a **última** apresentação `todos` por mensagem (dedupe por kind dentro de `AgentSteps`) — não as duas.
- Adicionar colapso com resumo ("Tarefas · 2/5") + "mostrar concluídas" e ocultar o card da sessão quando a lista estiver 100% concluída e o turno encerrado (ou após N turnos).
- Implementar (ou remover do doc) o popover de tarefas no header/composer.

**Teste necessário**

- `AgentSteps.test.tsx`: 3 presentations `todos` na mesma mensagem → no máximo 1 card (ou 1 resumo).
- `CodeSessionCards.test.tsx`: card não aparece quando `todos` está vazio; aparece 1× quando há lista; não duplica com a timeline (teste de composição `ChatView`).

---

### F-09 — P2 — Plano/tarefas sempre expandidos e sem limite de altura (contraria §5.2)

**Evidência**

- `PlanCard` renderiza o Markdown inteiro sem colapso/limite — [`src/components/agent/PlanCard.tsx:101-103`](src/components/agent/PlanCard.tsx#L101). O plano aceita até 20 000 caracteres — [`src-tauri/src/tools/code/exec.rs:2279`](src-tauri/src/tools/code/exec.rs#L2279).
- `TodoCard` renderiza a lista inteira sem `max-height`/scroll — [`src/components/agent/TodoCard.tsx:45-76`](src/components/agent/TodoCard.tsx#L45); o backend aceita até **50** itens — [`src-tauri/src/harness/code/session.rs:162-164`](src-tauri/src/harness/code/session.rs#L162).
- Ambos ficam **fora** do `Collapsible` de `AgentSteps` — [`AgentSteps.tsx:231-237`](src/components/chat/AgentSteps.tsx#L231) — sempre visíveis.
- Doc: "Todos os cards: `summary` sempre visível; conteúdo sob demanda; nada de auto-expandir saída longa" — [`WORKBENCH.md:118`](docs/goals/code-harness/WORKBENCH.md#L118); acessibilidade pede região com `tabindex=0` para conteúdo longo — [`WORKBENCH.md:327`](docs/goals/code-harness/WORKBENCH.md#L327).

**Impacto (UX/a11y)**

- Uma mensagem com plano de 20k + 4 listas de 50 itens empurra o texto final para fora da viewport; o usuário perde a resposta do agente.
- Leitor de tela anuncia o conteúdo inteiro a cada mudança de lista (combinado com F-14).

**Correção proposta mínima**

- Plano: card com `summary` (título/primeiras linhas) + expansão ("Ver plano completo") e `max-h` com scroll interno; no estado aprovado já existe o padrão compacto, reutilizar.
- Tarefas: colapsar por padrão quando não houver `in_progress` corrente ou quando `length > N` (ex.: 8), com `max-h` + resumo.
- `tabIndex={0}` na região rolável e `aria-expanded` no toggle.

**Teste necessário**

- `PlanCard`/`TodoCard`: conteúdo longo não excede `max-height` e o toggle expande/recolhe (aria-expanded).
- `AgentSteps`: plano de 20k não empurra o restante do fluxo (assert de classe/limite).

---

### F-10 — P2 — Plano aprovado/em planejamento sem superfície própria; `session.plan` morto; popovers ausentes

**Evidência**

- `CodeSessionState.plan` existe no contrato ([`src/lib/types.ts:384`](src/lib/types.ts#L384)) e é mapeado para o store ([`src/lib/store/codeStore.ts:203`](src/lib/store/codeStore.ts#L203); eventos em `135-140`), mas **nenhum componente lê `session.plan`** (grep por `.plan` no renderer só encontra `presentation.plan` em `ToolPresentationCard`, o gate montado a partir do approval e testes).
- O estado `planning` do `PlanCard` ([`PlanCard.tsx:94-96`](src/components/agent/PlanCard.tsx#L94)) nunca é montado por nenhum caller (gate usa `reviewing` sintético — [`CodeAgentWidgets.tsx:71-76`](src/components/code/CodeAgentWidgets.tsx#L71); timeline usa a presentation).
- O plano aprovado só é visível na mensagem onde `submit_plan` aconteceu (e hoje nem isso, F-01); não há popover no chip "Plano" — o chip só tem tooltip ([`CodeSessionControls.tsx:134-152`](src/components/composer/CodeSessionControls.tsx#L134)) — contrariando "Depois de aprovado, o plano permanece acessível no popover do chip 'Plano' (com status por passo vindo dos todos)" — [`WORKBENCH.md:148-149`](docs/goals/code-harness/WORKBENCH.md#L148).
- `ToolPresentations` (lista pronta de presentations) está exportado e **sem uso** — [`ToolPresentationCard.tsx:139-149`](src/components/agent/ToolPresentationCard.tsx#L139).
- `PlanView.updatedAt` do estado `planning` é `now_ms()` a cada snapshot (não muda de fonte) — [`src-tauri/src/commands/code.rs:166-172`](src-tauri/src/commands/code.rs#L166) e [`src-tauri/src/harness/code/session.rs:83-93`](src-tauri/src/harness/code/session.rs#L83) — ou seja, "tempo do plano" muda a cada refresh; `relativeTime` ainda é congelado (só recalcula no render).

**Impacto (UX/a11y)**

- Durante a fase de planejamento o usuário só vê o chip aceso (e, por F-05, apagado no turno): nenhuma indicação de "o agente está planejando" ou do plano em rascunho.
- Após aprovar, não há como reler o plano (compacto/atalho), nem acompanhar progresso por passo; o usuário depende de achar a tool call no histórico.
- Estado/contrato mortos aumentam a chance de regressão silenciosa (ninguém nota se `plan`/`updatedAt` quebrar).

**Correção proposta mínima**

- Ligar o chip "Plano" a um `Popover` que renderiza `session.plan` (quando `planning`/`approved`) + progresso via `session.todos`, usando `PlanCard` compacto; ou um `PlanCard` fixo acima do composer enquanto `planMode`/`plan.state !== 'inactive'`.
- Mostrar `planning` com `Spinner`/rótulo no chip ("Planejando…") quando `plan.state === 'planning'` e o turno estiver ativo.
- Corrigir `updatedAt` de `planning` para usar o timestamp do evento `plan/mode` (backend) — assim o "há X min" é estável.

**Teste necessário**

- `CodeSessionControls.test.tsx`: chip com popover renderizando o plano do snapshot (planning/aprovado) e o status por passo.
- `codeStore.test.ts`: `plan` do snapshot/evento exposto e consumido (teste de componente, não só reducer).
- `PlanCard.test.tsx` já cobre `planning`; falta caller real.

---

### F-11 — P2 — Decisão de aprovação não vira linha resolvida; falha/expiração não refresca

**Evidência**

- O store mantém `resolutions` (e `questionAnswers`) — [`src/lib/store/codeStore.ts:41-46,107-134`](src/lib/store/codeStore.ts#L41) — mas **nenhum componente lê** esses mapas (grep sem consumidores); o `ApprovalCard` suporta `resolution` ([`ApprovalCard.tsx:48-65,144-149,220-221`](src/components/agent/ApprovalCard.tsx#L48)) mas o container nunca passa ([`CodeAgentWidgets.tsx:61-70`](src/components/code/CodeAgentWidgets.tsx#L61)).
- Ao resolver, o item é removido da lista (`approval_resolved` → filter, `codeStore.ts:107-120`) e o card **desaparece**, sem linha "Permitido · sempre neste workspace" / "Negado: '…'" prometida em [`WORKBENCH.md:140`](docs/goals/code-harness/WORKBENCH.md#L140). O mesmo vale para a negação do plano (sem `plan_updated`, ver baseline P1#6).
- `respondApproval` do store não faz refresh nem trata falha local — [`codeStore.ts:310-321`](src/lib/store/codeStore.ts#L310); `CodeSessionCards.decide` ignora o booleano — [`CodeAgentWidgets.tsx:43-57`](src/components/code/CodeAgentWidgets.tsx#L43). Se a aprovação expirou (60 s) ou já foi resolvida, o card permanece “vivo” e clicável; a resposta `false` só gera toast genérico.
- Não há refresh do snapshot após aprovar/negar plano (o evento `plan_updated` só existe no caminho aprovado; na negação nada é emitido).

**Impacto (UX/a11y)**

- Sem rastro da decisão na UI, o usuário não consegue auditar o que aprovou/negou (a promessa de auditoria fica só no backend). Para o plano, após negar não há linha "Plano revisado: <feedback>".
- Card fantasma após timeout induz o usuário a clicar em uma decisão que já não existe.

**Correção proposta mínima**

- Passar `resolution={session.resolutions[approval.id]}` ao `ApprovalCard` e renderizar o card resolvido por alguns segundos/até o próximo turno (o `ApprovalCard` já implementa a linha compacta).
- Em `decide`, se `respondApproval` retornar `false`/lançar, remover o item localmente (ou `refresh`) e mostrar o motivo; no sucesso, `refresh` preguiçoso para atualizar plano/todos.

**Teste necessário**

- `CodeSessionCards.test.tsx`: após `approval_resolved`, aparece a linha resolvida com decisão/escopo.
- `codeStore.test.ts`: `respondApproval` com `false` dispara refresh/erro (mock de `api`).

---

### F-12 — P2 — Tools de código sem labels/ícones pt-BR na timeline

**Evidência**

- `buildToolGroup` só trata as tools do Chat (`web_search`, `fetch_url`, `create_file`, `validate_ui`, `run_code`, skills/artefatos); `read_file`, `write_file`, `edit_file`, `run_command`, `todo_write`, `submit_plan`, `ask_user`, `job_*`, `git_*` caem no `default` — [`src/lib/agentTrace.ts:145-176`](src/lib/agentTrace.ts#L145) — com `defaultLabel`: `` Executou ${name.replace(/_/g,' ')} `` → "Executou submit plan", "Executou todo write", "Executou read file" — [`agentTrace.ts:445-451`](src/lib/agentTrace.ts#L445).
- `TOOL_ICONS` também não tem as tools de código → `Wrench` genérico — [`src/components/chat/AgentSteps.tsx:47-57,249-250`](src/components/chat/AgentSteps.tsx#L47).
- Doc exige o contrário: "Ícones/labels no mapa de `src/lib/agentTrace.ts` (adicionar as tools novas + fallback genérico)" — [`WORKBENCH.md:119`](docs/goals/code-harness/WORKBENCH.md#L119); UI em pt-BR ([`AGENTS.md`](AGENTS.md) e `DESIGN §14`).
- Nenhum teste de `agentTrace` cobre tools de código.

**Impacto (UX/a11y)**

- Nomes de ferramenta em inglês/snake_case vazam na interface em um produto pt-BR; o usuário não entende "Executou submit plan".
- Perde-se a affordance de status/rótulo por tool (as linhas ficam todas iguais, com o mesmo ícone de chave inglesa).

**Correção proposta mínima**

- Adicionar ao `buildToolGroup` casos pt-BR para as tools do harness (mínimo: `read_file`, `write_file`, `edit_file`, `run_command`, `todo_write`, `submit_plan`, `ask_user`, `git_*`, `job_*`) e ao `TOOL_ICONS` os ícones correspondentes (lucide, 16/18 px, stroke 1.75–2).
- Enquanto a fase de cards completos do §5.2 não vem, um mapa rotulado já resolve o vazamento de inglês.

**Teste necessário**

- `agentTrace.test.ts`/`AgentSteps.test.tsx`: `submit_plan`/`todo_write`/`run_command` geram label pt-BR e ícone esperado (não `Wrench`).

---

### F-13 — P2 — Contraste AA violado em metadados dos cards e no chip Plano ativo

**Evidência**

- Tokens: `--foreground-subtle` = `#8b8c93` (light) / `#6f6f7a` (dark) — [`src/styles/globals.css:21,51`](src/styles/globals.css#L21).
- Usos nos cards: item concluído (`text-foreground-subtle`, 12 px) — [`TodoCard.tsx:62-68`](src/components/agent/TodoCard.tsx#L62); `relativeTime` do plano (11 px) — [`PlanCard.tsx:63,98`](src/components/agent/PlanCard.tsx#L63); ícone/texto de tarefas.
- Ratios calculados (WCAG 2.x): **light 3,13:1** (`#8b8c93` sobre `--surface #f7f7f8`) e 3,35:1 sobre `--background/#fff`; **dark 3,35–3,83:1** (`#6f6f7a` sobre `#1e1e22`/`#101012`). Abaixo de 4,5:1 para texto normal.
- Chip Plano ativo: `text-accent` sobre `bg-accent-soft` = **4,40:1** no tema claro ([`CodeSessionControls.tsx:145`](src/components/composer/CodeSessionControls.tsx#L145); tokens em `globals.css:24,27`) — no limite.
- Doc: "Contraste mínimo 4.5:1 para texto normal" — [`docs/DESIGN.md:220`](docs/DESIGN.md#L220); "Contraste AA em todos os tokens; nenhuma informação só por cor" — [`WORKBENCH.md:330`](docs/goals/code-harness/WORKBENCH.md#L330).
- Nesta auditoria não há automação de UI/browser (AGENTS.md) — evidência por cálculo dos tokens.

**Impacto (UX/a11y)**

- Texto de status/metadado (11–12 px) ilegível para baixa visão; especialmente o item concluído tem `line-through` + cor clara (dupla redução de legibilidade).
- O chip "Plano" ativo quase não passa AA no tema claro (4,40 vs 4,5).

**Correção proposta mínima**

- Nos cards: usar `text-foreground-muted` (5,85:1 light / 7,42:1 dark) para metadados 11–12 px e para o item concluído; manter `line-through` como reforço.
- Chip ativo: `text-accent` → variante com contraste garantido (ex.: `text-foreground` sobre `bg-accent-soft` ou token `accent-strong`); decisão de token é do Lead (`globals.css`).
- Se o token for ajustado, revisar o uso global de `foreground-subtle` (fora deste escopo).

**Teste necessário**

- Sem harness de browser no repo: registrar como checklist manual de contraste (ou um teste unitário de tokens calculando ratios, se o projeto adotar). O teste deve falhar se um token usado em texto < 4,5:1.

---

### F-14 — P3 — `aria-live="polite"` no contêiner de cards interativos

**Evidência**

- `CodeSessionCards` envolve planos/aprovações/perguntas/tarefas em `<div aria-live="polite">` — [`src/components/code/CodeAgentWidgets.tsx:60`](src/components/code/CodeAgentWidgets.tsx#L60) — enquanto o `ApprovalCard` já tem região assertiva própria ([`ApprovalCard.tsx:216-218`](src/components/agent/ApprovalCard.tsx#L216)).
- A cada `todos_updated` (várias vezes por turno) e a cada mudança de aprovação o contêiner inteiro muda: o leitor de tela pode reanunciar lista + cards.

**Impacto (UX/a11y)**

- Ruído/duplicação de anúncios; o usuário de leitor de tela perde o fio. Regiões `aria-live` devem conter texto de status curto, não controles.

**Correção proposta mínima**

- Remover `aria-live` do contêiner e anunciar por card (texto curto dentro do `PlanCard`/`TodoCard`/`ApprovalCard`, como o `ApprovalCard` já faz).
- Se necessário um resumo, usar um `<p className="sr-only" aria-live="polite">` com "Plano aguardando aprovação" / "Tarefas: 2 de 5 concluídas".

**Teste necessário**

- `CodeSessionCards.test.tsx`: apenas uma região `aria-live` (ou nenhuma no contêiner) e o anúncio curto esperado por estado.

---

### F-15 — P3 — Microcopy fora do padrão pt-BR/design

**Evidência**

- "O usuário preferiu não responder agora." — terceira pessoa para o próprio usuário — [`ToolPresentationCard.tsx:35`](src/components/agent/ToolPresentationCard.tsx#L35).
- "{n} arquivo(s) alterado(s)" — plural mecânico (o repo tem helper `plural()` em `src/lib/utils.ts` usado em `agentTrace`) — [`ToolPresentationCard.tsx:66`](src/components/agent/ToolPresentationCard.tsx#L66).
- "Subagente explore" / "Subagente review" — tipo de subagente em inglês — [`ToolPresentationCard.tsx:82-85`](src/components/agent/ToolPresentationCard.tsx#L82).
- Descrição do `/plan`: "Insere um pedido de plano; o modo Plano fica no campo de mensagem." — confusa — [`commands.ts:40`](src/components/composer/commands.ts#L40).
- Padrão pt-BR e microcopy em [`docs/DESIGN.md:236-247`](docs/DESIGN.md#L236) e glossário em [`WORKBENCH.md:362-385`](docs/goals/code-harness/WORKBENCH.md#L362).

**Impacto (UX/a11y)**

- Tom inconsistente com o resto do app; "arquivo(s)" é ruído visual; tipo de subagente em inglês expõe detalhe interno.

**Correção proposta mínima**

- "Você preferiu não responder."; `` `${n} ${plural(n,'arquivo','arquivos')} alterado${n===1?'':'s'}` `` (ou `Criou/Alterou N arquivos`); mapear `explore|review` → "Explorar/Revisar" (ou "Subagente de exploração/revisão"); reescrever a descrição do `/plan` junto com F-03.

**Teste necessário**

- Asserts de copy nos testes dos cards (barato; evita regressão de texto).

---

### F-16 — P3 — `TodoItem` sem `id` (divergência do contrato) → chave React instável

**Evidência**

- O contrato do plano define `TodoItem { id: String, content, status }` — [`docs/goals/code-harness/PLAN.md:252`](docs/goals/code-harness/PLAN.md#L252); o código não tem `id`: [`src/lib/types.ts:289-292`](src/lib/types.ts#L289) e [`src-tauri/src/domain.rs`](src-tauri/src/domain.rs) (`TodoItem { content, status }`).
- A UI compensa com `key={`${index}-${todo.content}`}` — [`TodoCard.tsx:51`](src/components/agent/TodoCard.tsx#L51). Como o backend rejeita duplicados ([`session.rs:165-174`](src-tauri/src/harness/code/session.rs#L165)), não há colisão prática — mas a identidade muda quando o conteúdo é reescrito/deslocado (remontagem; qualquer estado local futuro no item é perdido).
- O ADR/contrato pede status por passo no popover de plano (WORKBENCH §5.4:149) — sem `id`, casar plano↔todos por texto é frágil.

**Impacto (UX/a11y)**

- Hoje: baixo (lista sem estado interno). Amanhã (progresso por passo, âncoras, dedupe, animações): chave instável causa remontagem/“pulos”.

**Correção proposta mínima**

- Decidir contrato (Lead): adicionar `id` ao `TodoItem` (Rust + TS) e migrar a chave; ou, se não houver id, documentar a decisão e usar `content` como chave (sem índice), já que duplicados são inválidos.

**Teste necessário**

- `TodoCard.test.tsx`: reordenar/renomear itens não remonta desnecessariamente (com id) ou teste documentando a chave por conteúdo.

---

### F-17 — P3 — Toggle Plano sem atualização otimista/spinner (vizinho de permissão tem)

**Evidência**

- `setPermissionMode` é otimista com rollback e toast — [`codeStore.ts:345-366`](src/lib/store/codeStore.ts#L345). `setPlanMode` só faz a chamada e espera o snapshot — [`codeStore.ts:368-382`](src/lib/store/codeStore.ts#L368).
- O chip usa `disabled={planBusy}` sem indicador de progresso — [`CodeSessionControls.tsx:86-94,135-151`](src/components/composer/CodeSessionControls.tsx#L86). Em IPC lento, o clique parece morto (o chip não muda até o snapshot).
- O comentário do componente promete apenas otimismo para permissão ([`CodeSessionControls.tsx:52-58`](src/components/composer/CodeSessionControls.tsx#L52)) — ou seja, é inconsistência de UX, não promessa quebrada.

**Impacto (UX/a11y)**

- Feedback inconsistente entre os dois pills vizinhos do composer; usuário clica duas vezes (segunda é bloqueada por `planBusy`, sem retorno visual).

**Correção proposta mínima**

- Replicar o padrão otimista+rollback em `setPlanMode` (guardando o estado anterior e restaurando no erro) e exibir `loading`/spinner no chip durante a chamada.

**Teste necessário**

- `CodeSessionControls.test.tsx`: otimismo antes da promise resolver; rollback em rejeição (hoje o teste “rollback” passa vacuamente — ver mapa de testes); `codeStore.test.ts` cobre rollback.

---

### F-18 — P3 — Contrato/kind mortos: `ToolPresentations` sem uso; `output`/`terminal`/`approval` descartadas

**Evidência**

- `ToolPresentations` exportado e nenhum import no renderer — [`ToolPresentationCard.tsx:139-149`](src/components/agent/ToolPresentationCard.tsx#L139).
- `default: return null` descarta apresentações sem UI — [`ToolPresentationCard.tsx:88-89`](src/components/agent/ToolPresentationCard.tsx#L88) — incluindo `output` (spill) e `terminal`; `approval` está documentado como variante, mas não existe no TS nem no card — [`TOOLS.md:47-49`](docs/goals/code-harness/TOOLS.md#L47) × [`types.ts:368-377`](src/lib/types.ts#L368).
- `terminal` é emitido? O backend tem presentation `terminal`? (não encontrado no grep; risco de contrato documental apenas).

**Impacto (UX/a11y)**

- Apresentações podem desaparecer silenciosamente (ex.: saída longa com spill, terminal), sem erro e sem log — o usuário não vê que algo foi omitido.

**Correção proposta mínima**

- Alinhar doc↔TS (remover `approval`/`terminal` do doc ou implementar); para `output`/`terminal`, ou renderizar um card mínimo, ou logar/telemetrizar (dev) para detectar kinds não tratadas; remover `ToolPresentations` se não for usado (ou usar no lugar do mapa inline de `AgentSteps`).

**Teste necessário**

- `ToolPresentationCard.test.tsx`: cada kind do contrato tem teste de render ou de descarte explícito (matriz `kind × comportamento`), evitando divergência silenciosa.

---

### F-19 — P3 — Atalhos do doc ausentes (`Shift+Tab` Plano, `Ctrl+.` modo)

**Evidência**

- Doc: "`Ctrl+.` abre o seletor de modo, `Shift+Tab` alterna Plano quando o foco está no composer" — [`WORKBENCH.md:173-174`](docs/goals/code-harness/WORKBENCH.md#L173).
- `Composer.tsx` só implementa `Ctrl/Cmd+L` ([`166-178`](src/components/composer/Composer.tsx#L166)) e `Enter/Ctrl+Enter` ([`449-455`](src/components/composer/Composer.tsx#L449)); não há `Shift+Tab`/`Ctrl+.` (grep).
- O `CodeSessionControls` é apenas clicável (menu/toggle).

**Impacto (UX/a11y)**

- Usuários de teclado não têm a via rápida prometida; inconsistência com o doc e com a paleta de comandos (§10:332).

**Correção proposta mínima**

- Implementar `Shift+Tab` no textarea → `setPlanMode(!planMode)` (com guarda: só Code e sem menu aberto) e `Ctrl+.` → abrir o `DropdownMenu` do modo de permissão (controlar `open` do Radix); ou remover dos docs.

**Teste necessário**

- `Composer.code.test.tsx`: `keydown` `Shift+Tab` alterna Plano (mock do store/API); `Ctrl+.` abre o menu.

---

### F-20 — P3 — `title` + `Tooltip` duplicados no chip Plano; `relativeTime`/`updatedAt` instável

**Evidência**

- O chip declara `title={planTitle}` **e** está dentro de `<Tooltip content={planTitle}>` — [`CodeSessionControls.tsx:134-152`](src/components/composer/CodeSessionControls.tsx#L134) — gerando tooltip nativa + custom (posicionamento/atraso diferentes; a nativa não é estilizada).
- `relativeTime` calcula no render e não atualiza sozinho — [`src/lib/utils.ts:76`](src/lib/utils.ts#L76) — "agora"/"2 min" congelam até o próximo render.
- `PlanView.updated_at` do estado `Planning` é gerado com `now_ms()` a cada snapshot ([`commands/code.rs:166-172`](src-tauri/src/commands/code.rs#L166), [`harness/code/session.rs:83-93`](src-tauri/src/harness/code/session.rs#L83)) — o "tempo do plano em preparação" nunca envelhece e muda a cada refresh (latente hoje, ativo quando F-10 montar o popover).

**Impacto (UX/a11y)**

- Duas tooltips confundem; `title` nativo não é acessível por teclado em todos os navegadores/webview.
- Quando o plano em preparação for exibido, mostrará "agora" eternamente.

**Correção proposta mínima**

- Remover `title` (manter `Tooltip`) ou vice-versa; adicionar `aria-label` com o estado.
- Backend: usar o timestamp do evento `plan/mode` como `updated_at` de `Planning`; ou no renderer não exibir tempo para `planning`.

**Teste necessário**

- `CodeSessionControls.test.tsx`: um único tooltip/`title` no chip; `PlanCard.test.tsx`: `planning` sem tempo instável (snapshot fixo com `updatedAt` do evento).

---

### F-21 — P3 — Placeholder sem workspace divergente do doc (teste encoda a cópia antiga)

**Evidência**

- Doc: sem workspace → placeholder "Abra uma pasta para trabalhar com código" — [`WORKBENCH.md:171-172`](docs/goals/code-harness/WORKBENCH.md#L171).
- Código: `'Descreva a tarefa para o agente…'` — [`Composer.tsx:483-487`](src/components/composer/Composer.tsx#L483) — e o teste encoda essa cópia como correta — [`Composer.code.test.tsx:154-160`](src/components/composer/Composer.code.test.tsx#L154).
- Com workspace o placeholder segue o doc ("Descreva a tarefa… @ para arquivos, / para comandos").

**Impacto (UX/a11y)**

- O placeholder é o principal affordance do estado vazio do Code; sem ele, o usuário não é levado a abrir pasta. O teste “protege” a divergência.

**Correção proposta mínima**

- Ajustar o placeholder sem workspace para a cópia do doc (ou atualizar o doc); atualizar o teste junto.

**Teste necessário**

- `Composer.code.test.tsx`: copy alinhada ao doc (teste vira contrato).

---

### F-22 — P2 — Plano persistido na timeline renderiza ações "vivas" que não fazem nada (`onAction` noop)

**Evidência**

- `ToolPresentationCard` monta o card de plano com um callback vazio: `<PlanCard plan={presentation.plan} onAction={() => undefined} />` — [`src/components/agent/ToolPresentationCard.tsx:27-28`](src/components/agent/ToolPresentationCard.tsx#L27).
- `PlanCard` em estado `reviewing` **sempre** renderiza os três botões habilitados (Aprovar e executar / Aprovar e revisar cada edição / Continuar planejando + textarea de feedback) — [`src/components/agent/PlanCard.tsx:105-150`](src/components/agent/PlanCard.tsx#L105). Não existe variante "somente leitura" nem prop `readOnly`/`disabled`.
- O backend persiste exatamente o estado `reviewing` no caminho de negação — `Some(json!({ "kind": "plan", "state": "reviewing", "feedback": feedback }))` — [`src-tauri/src/tools/code/exec.rs:2342`](src-tauri/src/tools/code/exec.rs#L2342). Logo, **se F-01 for corrigido** (shape alinhado), esse card aparece no histórico com botões que parecem operáveis e não executam nada (o clique não tem efeito, sem toast, sem erro, sem foco).
- No estado `approved` o card vira linha compacta ("Plano aprovado" + "Ver plano") e não tem ação — o problema é específico do `reviewing`.
- Nenhum teste cobre `kind:'plan'` ([`ToolPresentationCard.test.tsx`](src/components/agent/ToolPresentationCard.test.tsx)), então o noop nunca foi exercitado.
- Hipótese da tarefa **confirmada** (com a ordem corrigida: hoje o crash de F-01 ocorre antes; o noop passa a ser o defeito visível depois do fix do contrato).

**Impacto (UX/a11y)**

- "Ação morta silenciosa" é pior que ausência de ação: o usuário de um plano negado tenta aprovar a partir do histórico e nada acontece; parece bug/travamento, sem feedback. Também cria dois lugares com o mesmo card onde só um funciona (gate ao vivo no `CodeSessionCards` vs. timeline).

**Correção proposta mínima**

- Tornar o card da timeline explicitamente somente-leitura: em `ToolPresentationCard`, renderizar `PlanCard` com uma prop nova `readOnly` (ou um `PlanCard` compacto) que, em `reviewing`, mostra o estado ("Plano não aprovado — revise e reenvie"), o feedback persistido e **nenhum** botão de ação; ou desabilitar as ações com `aria-disabled` + texto "Disponível apenas quando o plano está aguardando revisão".
- Alternativa: remover a apresentação `plan` da timeline e manter o plano apenas no popover do chip (F-10) — decisão de UX/contrato.

**Teste necessário**

- `ToolPresentationCard.test.tsx`: `kind:'plan'` + `state:'reviewing'` → **não** existem botões "Aprovar…"/"Continuar planejando" (ou existem `disabled`/`aria-disabled`); feedback aparece como texto.
- `PlanCard.test.tsx`: prop `readOnly`/`:disabled` não dispara `onAction` e mantém o restante do card.

---

## Mismatches doc ↔ UI (consolidado)

| Doc promete | Realidade no renderer | Achado |
| --- | --- | --- |
| `/plan [instrução]` entra no modo Plano (WORKBENCH §12:347, §8.3:268; HARNESS §6.1:235; PLAN F5:391) | `/plan` só insere texto; modo só pelo chip | F-03 |
| `/plan off` sai do modo (WORKBENCH §12:348) | sai no backend, mas o chip continua aceso (API direta sem store/evento) | F-04 |
| Plano é overlay "ativado por `/plan` ou chip"; UI nunca muda o modo sozinha (HARNESS §6.1:235-237) | `profile_changed` **desliga** o chip automaticamente no início do turno | F-05 |
| Card do plano com 3 saídas, incluindo "Aprovar e revisar cada edição (sai para modo Editar com aprovação por escrita)" (WORKBENCH §5.4:145-147) | 3 botões, mas `approve_review` ≡ `approve_run`; não existe "aprovação por escrita" no contrato | F-02/F-07 |
| Ações do card de plano (§5.4) funcionam no card persistido | Card da timeline monta `PlanCard` com `onAction` vazio → botões habilitados sem efeito quando o payload for alinhado | F-22 |
| Plano "editável antes de valer" (PLAN §1:53-54) | Não existe textarea auxiliar para editar o plano antes de aprovar | F-02 (nota; feature gap) |
| Depois de aprovado, plano acessível no popover do chip "Plano", com status por passo (WORKBENCH §5.4:148-149) | Sem popover; `session.plan` nunca lido; aprovado só na timeline (e quebrado — F-01) | F-10 |
| Gate de aprovação: `role="alertdialog"`, foco no 1º botão, `Esc` = negar, `aria-live="assertive"`, retorno de foco (WORKBENCH §10:325-326) | `PlanCard` gate não tem nada disso; `ApprovalCard` tem | F-07 |
| Estado resolvido vira uma linha "Permitido/Negado: …" (WORKBENCH §5.3:140) | Card é removido; `resolutions` do store nunca lido | F-11 |
| `todo_write`: "card na timeline + popover no header" (TOOLS §2.5:294); "card e popover de tarefas" (PLAN F5:386) | Card na timeline (N×) + card fixo no fim; sem popover | F-08/F-10 |
| Cards: "nada de auto-expandir saída longa"; conteúdo sob demanda + região com `tabindex=0` (WORKBENCH §5.2:118, §10:327) | Plano/tarefas sempre abertos, sem `max-h`/toggle | F-09 |
| Ícones/labels das tools de código no mapa de `agentTrace.ts` (WORKBENCH §5.2:119) | English snake_case via `defaultLabel` + `Wrench` | F-12 |
| Aguardando aprovação: badge âmbar na aba/header + notificação (WORKBENCH §9:307-308) | Sem badge/notificação; card pode estar fora da viewport | F-06 |
| Aprovação: aria-live assertive no card; UI em pt-BR (WORKBENCH §10, DESIGN §12/§14) | Live region ampla no contêiner; microcopy em terceira pessoa/inglês | F-14/F-15 |
| Atalhos `Ctrl+.` (modo) e `Shift+Tab` (Plano) no composer (WORKBENCH §6.5:173-174) | Só `Ctrl/Cmd+L` e `Enter/Ctrl+Enter` | F-19 |
| Placeholder sem workspace "Abra uma pasta…" (WORKBENCH §6.4:171-172) | "Descreva a tarefa para o agente…" (teste encoda) | F-21 |
| `TodoItem { id, content, status }` (PLAN §5.1:252) | Sem `id`; key `index+content` | F-16 |
| `ToolPresentation` do plano: `{kind:"plan", markdown, state}` (TOOLS §1.1:45) | Backend emite `{kind:"plan", state}` sem markdown; TS espera `{kind:"plan", plan: PlanView}` | **F-01** |
| Mutações negadas em modo Plano e liberadas ao aprovar (HARNESS §6.2:242; WORKBENCH §5.4) | Aprovar não libera `ctx.plan_mode` no mesmo turno (baseline P0#1) — impacto visível: após "Aprovar e executar" as edições seguem falhando | F-02 (cross-ref backend) |
| Timeout de revisão humana (WORKBENCH §5.3/§5.4) | `submit_plan` expira em 60 s (baseline P0#2) — inviável revisar | F-06 (cross-ref backend) |

## Riscos e questões em aberto

1. **Formato canônico da presentation de plano:** flat (TOOLS) × aninhado (TS) × atual (flat sem markdown). Quem decide e em que direção? Recomendo flat + `markdown` + `feedback` (mínima mudança no Rust), com atualização de `types.ts` e `ToolPresentationCard`. Precisa de migração/versionamento? Mensagens antigas no DB já têm o formato errado — se o frontend não for tolerante, **histórico existente continua derrubando o app** mesmo depois do fix de emissão. O hotfix defensivo (F-01.2) é obrigatório mesmo com o contrato corrigido.
2. **"Aprovar e revisar cada edição":** vira modo novo (`EditConfirm`/flag por escrita) ou o botão sai da UI e do doc? Envolve `respond_approval`, `PermissionMode`, prompt e testes — decisão de produto/contrato do Lead.
3. **`/plan` deve ativar o modo?** Três docs dizem que sim; o comando hoje é `fill`. Se for `fill` por decisão, doc e copy precisam mudar em 4 lugares (WORKBENCH §6/§8.3/§12, HARNESS §6.1, PLAN F5, DESIGN §14) e o aceite do F5 deve ser redefinido.
4. **Timeout de `submit_plan` (60 s) × revisão humana:** deve usar `approval_timeout` (default 600 s) e/ou continuar o turno em background? (backend; hoje a UI também não expõe o estado "expirado" — F-11).
5. **Onde o gate deve viver:** fim da timeline (hoje), junto da tool call, ou fixo acima do composer? A escolha muda F-06, o `aria-live` (F-14) e o layout responsivo.
6. **Popover de plano/tarefas entra nesta rodada ou fica débito?** WORKBENCH §5.4 + TOOLS:294 + PLAN F5:386 prometem; a UI não tem estado no `uiStore` para isso (nem `plan`/`todos` séries).
7. **Mitigação de `profile_changed` no renderer** (ignorar `planMode` até o backend corrigir) é aceitável como contrato temporário? Se sim, documentar em `types.ts`/store.
8. **`TodoItem.id`:** adicionar (migração leve de contrato) ou documentar ausência e trocar a chave para `content`?
9. **Plano negado não persiste** (baseline P1#6): a UI deve mostrar o último plano mesmo negado? Isso exige `plan/submitted` no caminho `Denied` + `PlanUpdated` (backend).
10. **`presentation` sem validação de runtime:** vale introduzir um validador/`version` no envelope (como GenUI faz) para que futuros kinds não derrubem a App? Sugiro sim; é a causa raiz de F-01 ter passado.
11. **Smoke manual do fluxo F5:** o crash de F-01 impede validar `/plan → gate → aprovar → executar` até o fix; o EVIDENCE da fase afirma F5 verificado (provavelmente por testes de backend, sem UI). Reexecutar o roteiro manual depois do fix.

## Mapa de testes existentes × lacunas

| Arquivo | Nº | Cobre | Lacunas relevantes |
| --- | --- | --- | --- |
| [`src/components/agent/PlanCard.test.tsx`](src/components/agent/PlanCard.test.tsx) | 7 | Markdown, 3 ações (`approve_run`/`approve_review`/`keep_planning`), feedback livre, `approved` compacto com "Ver plano", `planning`, `inactive`→null | Sem a11y (foco/Esc/`aria-busy`/disabled), sem `responding`, sem validação de payload inválido/ausente, sem integração com o gate |
| [`src/components/agent/TodoCard.test.tsx`](src/components/agent/TodoCard.test.tsx) | 4 | Contadores ("1 de 3"), rótulos sr-only por status, `progressbar` 33%, vazio→null, singular | Sem lista longa/limite, sem fallback de status desconhecido, sem "concluídos para sempre"/limpeza, sem duplicidade/timeline |
| [`src/components/agent/ToolPresentationCard.test.tsx`](src/components/agent/ToolPresentationCard.test.tsx) | 3 | `file_change` (expansão), `answers`/`skipped`, `output` desconhecido→null | **Sem `plan` (crash F-01)**, sem `todos`, `job`, `changes`, `subagent`; sem payload incompleto (shape real do backend) |
| `src/components/code/CodeAgentWidgets.tsx` (`CodeSessionCards`) | **0** | — | Container crítico do gate: wiring `submit_plan`→`PlanCard`→`respondApproval`, `approve_review`, `keep_planning`, erro/timeout, duplicidade de `TodoCard`, a11y (`aria-live`), badge/scroll |
| [`src/components/chat/AgentSteps.test.tsx`](src/components/chat/AgentSteps.test.tsx) | 11 | Timeline/raciocínio/tools do Chat, duração, auto-expand | **Zero cobertura de `presentation`** (`plan`/`todos`/`file_change`) — o caminho que quebra em F-01 |
| [`src/components/chat/ChatView.test.tsx`](src/components/chat/ChatView.test.tsx) | 11 | Turn error/banner, welcome, layout | Sem gate/aprovação, sem scroll até aprovação, sem `CodeSessionCards` |
| [`src/components/composer/CodeSessionControls.test.tsx`](src/components/composer/CodeSessionControls.test.tsx) | 8 | Fallback/snapshot de permissão, menu otimista+rollback, toggle Plano chama API e aplica snapshot, erro→toast | Teste "rollback do Plano" ([`:172-187`](src/components/composer/CodeSessionControls.test.tsx#L172)) **passa vacuamente** (não há otimismo a desfazer); sem `profile_changed`; sem popover/`session.plan` |
| [`src/components/composer/Composer.code.test.tsx`](src/components/composer/Composer.code.test.tsx) | 19 | `@`, `/limpar`, `/review` (fill), `/commit`, `/plan off` (só `api.setPlanMode`) | **Sem `/plan`** (ativação); `/plan off` valida o bug (API direta) e não o store/chip; sem `Shift+Tab`/`Ctrl+.`; placeholder encoda cópia divergente |
| [`src/lib/store/__tests__/codeStore.test.ts`](src/lib/store/__tests__/codeStore.test.ts) | 7 | Reducers de approvals/resolutions, `todos_updated`, `plan_updated` (reviewing→true/approved→false), changes, context/jobs, `profile_changed` espelha, questions, `fromSnapshot` | Nenhuma ação (`respondApproval`, `setPlanMode`); `profile_changed` testado como espelho aceitando `planMode:true` que o backend **nunca** emite (contrato irreal) — [`:109-122`](src/lib/store/__tests__/codeStore.test.ts#L109); sem integração de eventos reais |
| [`src/lib/__tests__/chatStore.test.ts`](src/lib/__tests__/chatStore.test.ts) | 32 | Turnos, openConversation, layouts | Matrix §15 promete "replay de `presentation`" e "aplicação de eventos novos (aprov/plan/todo…)"; **não há** teste de `presentation` nem de repasse ao `codeStore` |
| Backend `submit_plan_requires_plan_mode_and_waits_for_review` ([`exec.rs:2887`](src-tauri/src/tools/code/exec.rs#L2887)) | 1 | Fora do modo→erro; aprovado→"Plano aprovado"+`PlanView.Approved`+evento; negado→feedback | Não valida o **shape da presentation** (por isso F-01 passou); sem timeout/cancelamento; sem persistência de plano negado |
| Backend `todo_write_validates_saves_and_emits` ([`exec.rs:2844`](src-tauri/src/tools/code/exec.rs#L2844)) | 1 | Salva, presentation `kind:"todos"`, emite `todos_updated`, valida vazio/duplicado | Não valida contrato TS nem duplicidade de card na UI |

### Testes que passam mas validam contrato errado (correção sugerida)

1. `CodeSessionControls.test.tsx:172-187` — "mantém o Plano desligado (rollback)": não existe otimismo em `setPlanMode`; o teste passaria mesmo sem qualquer rollback. Renomear para refletir o comportamento atual ou implementar o otimismo (F-17) e então testá-lo.
2. `codeStore.test.ts:109-122` — espelha `planMode:true` de `profile_changed`; o backend emite sempre `false` ([`harness/mod.rs:748`](src-tauri/src/harness/mod.rs#L748)). O teste certifica um contrato que não existe (F-05).
3. `Composer.code.test.tsx:380-392` — `/plan off` assere a chamada direta de `api.setPlanMode`, isto é, **valida o atalho que causa F-04**. Deve passar a assertar o store/chip.
4. `PlanCard.test.tsx:19-29` — exige os três botões, mas nenhum teste verifica que eles chegam a um container com efeito; combinado com `ToolPresentationCard.tsx:28` (`onAction={() => undefined}`), o teste "protege" botões mortos na timeline.
5. `ToolPresentationCard.test.tsx` — só kinds fértis; nenhum teste com o payload real do backend, então o mismatch de contrato (F-01) não é detectado.
6. `codeStore.test.ts:55-73` — testa `plan_updated` `reviewing→planMode:true`; o backend só emite `plan_updated` no caminho aprovado ([`exec.rs:2323`](src-tauri/src/tools/code/exec.rs#L2323)), nunca `reviewing`. É contrato hipotético.
7. `Composer.code.test.tsx:154-160` — placeholder sem workspace assere a cópia que diverge do doc (F-21).

### Lacunas de teste prioritárias (ordem sugerida)

1. **P0:** `ToolPresentationCard` com payloads reais de `plan` (shape atual e corrigido) — pega F-01 e a regressão do hotfix defensivo (F-01, correção 2).
2. **P1:** `CodeSessionCards` (arquivo novo) — gate: 3 ações, `approve_review`, duplo clique, `responding`, erro/timeout, linha resolvida, `aria-live`, badge/scroll.
3. **P1:** `Composer` `/plan` ativa o modo e `/plan off` sincroniza o store/chip.
4. **P1:** `codeStore` — `profile_changed` com `plan_mode:false` não apaga Plano (ou teste explícito do contrato decidido).
5. **P2:** `AgentSteps` com `presentation` (plan/todos) e dedupe de tarefas; `PlanCard` a11y/foco/Esc/`disabled`; `ToolPresentationCard` plano `readOnly` sem botões (F-22).
6. **P2:** `agentTrace`/`AgentSteps` labels pt-BR das tools de código.
7. **P3:** `TodoCard` lista longa/limite/status desconhecido.

## Anexo — evidência de execução (somente leitura)

```
pnpm vitest run src/components/agent/PlanCard.test.tsx src/components/agent/TodoCard.test.tsx \
  src/components/agent/ToolPresentationCard.test.tsx src/components/composer/CodeSessionControls.test.tsx

 ✓ TodoCard.test.tsx (4)  ✓ CodeSessionControls.test.tsx (8)
 ✓ PlanCard.test.tsx (7)  ✓ ToolPresentationCard.test.tsx (3)
 Test Files 4 passed (4) · Tests 22 passed (22)
```

Nenhum arquivo de código foi alterado; o único arquivo escrito por esta auditoria é este relatório. Baseline de build/testes e flakes pré-existentes: ver [`analysis-baseline.md`](analysis-baseline.md).
