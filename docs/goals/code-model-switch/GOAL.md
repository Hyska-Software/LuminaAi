# GOAL — Troca de modelo/provedor durante a conversa no layout Code

## Pedido do usuário (2026-10-30)

> Para o modo layout de Code permita que o usuário mude de modelo e provedor durante a conversa.

## Decisões

- **Somente o layout Code** libera a troca entre turnos. O Chat mantém o
  comportamento atual (modelo travado após o primeiro envio): ali a conversa é
  uma thread curta e a identidade do modelo faz parte da expectativa do usuário;
  no Code as sessões são longas (trabalho em workspace, objetivo/rodadas,
  compactação) e escalar para um modelo/provedor mais forte no meio da tarefa é
  um fluxo real.
- **Durante o streaming o seletor continua bloqueado**: o modelo é resolvido no
  início do turno e não pode mudar embaixo dele (o backend também recusa por
  turno ativo). A copy do bloqueio distingue "conversa iniciada" (Chat) de
  "aguarde a resposta" (streaming).
- **O par provedor/modelo é uma propriedade da sessão do Code**: a escolha é
  persistida imediatamente (`set_conversation_model`), sem tocar nos padrões
  configurados. Assim o próximo turno, as rodadas automáticas do objetivo e a
  reabertura da sessão usam o modelo novo. Em conversa nova/vazia nada muda: a
  escolha continua atualizando a seleção e o padrão de novas conversas.
- **As respostas antigas mantêm o modelo que as produziu**: cada mensagem já
  guarda `providerId`/`modelId`; o harness reconstrói mensagens de outra rota
  pelo fallback neutro (texto + tool calls + tool results), sem replay bruto do
  `provider_state` de outro protocolo. O custo é a quebra do prefixo de cache
  naquele turno — o medidor de contexto já reporta `modelo/provedor mudou`.
- **A troca fica visível no transcript**: um divisor "Modelo alterado para X"
  marca o ponto entre as respostas (as duas layouts compartilham o
  `MessageList`; uma sessão do Code compartilhada com o Chat também mostra o
  divisor).
- Configurações › Modelo padrão continua editando apenas os padrões: uma sessão
  já iniciada nunca é alterada por aquela tela (em nenhum layout).

## Escopo

- Backend Rust: comando IPC `set_conversation_model` (valida sessão do Code,
  turno ativo, provedor e modelo na visão mesclada do catálogo/conta; atualiza a
  conversa e devolve o registro atualizado) + testes.
- Renderer: `modelLockReason`/`modelLockCopy`/`selectActiveConversationStarted`
  no `chatStore`, ação `chooseModel` (persiste a sessão do Code sem tocar nos
  padrões), `api.setConversationModel`, desbloqueio do `ModelPill` e do
  `ModelPickerDialog`, copy do streaming, paleta e Configurações › Modelo
  padrão, divisor de modelo no transcript, testes.
- Docs: DESIGN, ARCHITECTURE, MODELS, MODEL_SELECTOR_REDESIGN,
  COMMAND_PALETTE e este goal.

## Fora do escopo

- Liberar a troca no layout Chat.
- Trocar modelo/provedor durante um turno em andamento.
- Reproduzir `provider_state` de outro modelo (replay cross-model); o fallback
  neutro existente é o comportamento documentado.
- Migrar conversas existentes ou renomear/apagar mensagens antigas.

## Critérios de pronto

- No Code, com sessão iniciada, o pill abre a lista e confirma outro
  modelo/provedor; o turno seguinte usa o par novo (payload + persistência) e as
  rodadas do objetivo também.
- Durante o streaming, o seletor permanece bloqueado com copy específica; no
  Chat a sessão iniciada continua bloqueada com a copy atual.
- O par escolhido sobrevive a reabrir a sessão e a alternar Chat ↔ Code; os
  padrões (`Settings.defaultProvider/defaultModel`) não mudam por causa de uma
  troca no meio de uma sessão do Code.
- `pnpm typecheck`, `pnpm test`, `pnpm build` verdes; `cargo test --lib` verde.
- Sem regressão de acessibilidade (aria-labels/teclado) nem de tokens.
