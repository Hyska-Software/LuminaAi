# PLAN — Troca de modelo/provedor no meio da conversa (layout Code)

> Status: **implementado** (2026-10-30); verificação independente e evidência em
> `docs/goals/code-model-switch/EVIDENCE.md`. Pedido/decisões em `GOAL.md`.

## 1. Estado anterior

- `selectModelLocked(state)` (`src/lib/store/chatStore.ts`) travava o seletor
  quando a conversa tinha mensagens (`messageCount > 0`/mensagens em cache) ou
  havia streaming. O bloqueio valia para **os dois layouts**.
- Superfícies que dependiam do bloqueio: `ModelPill` (cadeado + toast),
  `ModelPickerDialog` (dialog compacto "Modelo bloqueado nesta conversa"),
  paleta de comandos ("Trocar modelo" vira aviso), `ModelTab` (Configurações ›
  Modelo padrão não altera a seleção ativa).
- O backend já suportava troca de rota no meio da conversa:
  `run_turn` resolve o modelo do payload, atualiza
  `conversations.provider_id/model_id` no início do turno
  (`harness/mod.rs`), e `render::frozen_replay_mode` reconstrói mensagens de
  outra rota pelo fallback neutro. O epoch de cache (`harness/cache/epoch.rs`)
  já marca `ModelSwitch` quando provedor/modelo mudam.
- Cada mensagem assistant persiste `providerId`/`modelId`; `MessageItem` mostra
  o nome do modelo no rodapé (só no hover).

## 2. Contrato de dados / IPC

Nenhuma coluna nova: a sessão já guarda o par em `conversations`.
`set_conversation_model` atualiza essas colunas (e `updated_at`) e devolve a
`Conversation` atualizada.

| Camada | Contrato |
| --- | --- |
| Rust | `commands::conversations::set_conversation_model(state, conversation_id, provider_id, model_id) -> Result<Conversation, String>`; helper puro `validate_model_change(...)` com testes |
| TS API | `api.setConversationModel(conversationId, providerId, modelId): Promise<Conversation>` |
| Store | `modelLockReason(state, layout): 'started' \| 'streaming' \| null`; `modelLockCopy(reason)`; `selectActiveConversationStarted(state)`; `useChatStore.chooseModel(selection): Promise<boolean>` |
| UI | Pill/dialog/paleta consomem `modelLockReason`/`modelLockCopy`; divisor usa `providerId/modelId` das mensagens |

Regras do backend (defesa em profundidade): ids com trim; conversa existe;
somente sessão do Code (`mode === 'code'` ou `code_linked`), senão
`MODEL_LOCKED: ...` (o renderer remove o prefixo e mostra a descrição); recusa
com turno ativo; provedor existe e modelo resolve na visão mesclada
(catálogo + lista da conta). O Chat nativo é recusado mesmo que o renderer
tente.

## 3. Regras do renderer

- `modelLockReason(state, layout)`:
  - layout `chat` (ou sessão que não é do Code): conversa iniciada → `'started'`;
  - layout `code` + sessão do Code: `null` entre turnos, `'streaming'` durante
    um turno;
  - streaming sempre bloqueia (`'streaming'` quando não há bloqueio
    permanente).
- `chooseModel(selection)`:
  - bloqueado → toast com `modelLockCopy` e `false` (defesa em profundidade);
  - sessão do Code já iniciada → `setActiveSelection` otimista, persiste via
    `api.setConversationModel`, atualiza a conversa na lista, toast "Modelo da
    sessão alterado"; falha → reverte a seleção (só se o usuário continua na
    mesma sessão) e mostra o erro sem o prefixo `MODEL_LOCKED:`;
  - mesmo par (só mudou o modo de pensamento) → atualiza a seleção, sem IPC;
  - conversa nova/vazia (qualquer layout) → comportamento anterior
    (`setSelection` atualiza a seleção e o padrão das próximas conversas).
- `send`/`regenerate` usam `lockedSelectionFor` (apenas Chat iniciado). No Code
  a seleção do composer é a fonte da verdade; a persistência da sessão garante
  reabertura e rodadas de objetivo (`runGoalRound` lê o par da conversa).
- `startNewConversation` volta ao modelo padrão quando a conversa ativa já foi
  iniciada, nos dois layouts (mesma regra anterior, agora sem depender do lock).
- Configurações › Modelo padrão usa `selectActiveConversationStarted` (não o
  lock): nunca altera a seleção de uma conversa iniciada, nem no Code.

## 4. UI / copy

- Pill travado: `started` mantém `aria-label`/copy atuais; `streaming` usa
  "Aguarde a resposta atual terminar". ✦ continua funcional.
- Dialog: `started` → compacto atual; `streaming` → compacto com a copy de
  streaming; livre → seletor completo (commit via `chooseModel`, fecha só em
  sucesso).
- Paleta: "Trocar modelo" abre o dialog quando liberado e explica quando não.
- Transcript: `ModelSwitchDivider` ("Modelo alterado para {nome}") entre
  respostas de rotas diferentes, com provedor no `title`.
- Microcopy nova: "Modelo da sessão alterado", "As próximas respostas usarão
  {nome}.", "Aguarde a resposta atual terminar", "A troca de modelo fica
  disponível quando a resposta atual terminar", "Troca de modelo indisponível
  durante a resposta", "A conversa atual já foi iniciada. As alterações abaixo
  valem apenas para as próximas conversas.", "Modelo alterado para {nome}".

## 5. Testes

- Rust (`conversations.rs`): helper de validação (Chat recusada com
  `MODEL_LOCKED`, Code aceita, `code_linked` aceita, trim, vazios,
  provedor/modelo desconhecidos); `cargo check`/`cargo test --lib`.
- Vitest:
  - `chatStore.test.ts`: matriz do lock por layout, `chooseModel` (persistência
    do par sem padrões, mesmo par, conversa vazia, bloqueio no Chat, falha com
    rollback), `send` no Code usando a seleção do composer,
    `startNewConversation`;
  - `ModelPill.test.tsx`/`ModelPickerDialog.test.tsx`: Code iniciado liberado,
    Chat iniciado bloqueado, streaming bloqueado com copy própria;
  - `ModelTab.test.tsx`: padrões não tocam sessão iniciada (Chat e Code);
  - paleta: ação explica/abre conforme o lock;
  - `MessageList`/`ModelSwitchDivider`: divisor só quando a rota muda.
- Verificação final: `pnpm typecheck`, `pnpm test`, `pnpm build`,
  `cargo test --lib`.

## 6. Divisão de trabalho (escopos disjuntos)

| Dono | Arquivos |
| --- | --- |
| Lead | `src/lib/store/chatStore.ts`, `src/lib/store/index.ts`, `src/lib/api.ts`, `src/lib/__tests__/chatStore.test.ts`, `src-tauri/src/lib.rs`, docs |
| storage-dev | `src-tauri/src/commands/conversations.rs` |
| ui-systems | `src/components/models/**`, `src/components/settings/ModelTab.tsx` (+teste), `src/components/palette/**` |
| ui-core | `src/components/chat/ModelSwitchDivider.tsx`, `src/components/chat/MessageList.tsx` (+testes) |
| verifier | revisão independente (somente leitura no código); `docs/goals/code-model-switch/EVIDENCE.md` |

## 7. Riscos e mitigações

- **Cache/prefixo**: trocar de rota quebra o prefixo cacheável do turno
  (todas as mensagens assistant antigas viram histórico neutro). Mitigação: é
  o custo documentado; o medidor já mostra "Modelo ou provedor mudou" e a
  escolha é explícita do usuário. Não há perda de mensagens.
- **Rodadas do objetivo**: usar o par da conversa (persistido na escolha) evita
  rodada com modelo antigo.
- **Turno ativo**: bloqueio no renderer + recusa no backend (`MODEL_LOCKED`)
  evitam corrida entre `chooseModel` e `run_turn`.
- **Chat nativo**: backend recusa; renderer mantém o lock (defesa em
  profundidade).
- **Configurações**: `ModelTab` não pode vazar a edição de padrão para a sessão
  ativa; coberto por teste.
