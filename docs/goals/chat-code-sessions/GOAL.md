# GOAL — Sessões separadas Chat/Code + compartilhar sessão do Chat no Code

## Pedido do usuário (2026-10-27)

> As sessões do modo Chat não devem aparecer quando o usuário estiver no modo Code; são modos
> separados, então também devem ser sessões separadas. O usuário vai poder adicionar uma sessão do
> Chat ao Code; nesse caso sim os dois vão ser compartilhados.

## Decisões

- Cada conversa nasce com um **modo de origem** (`mode: 'chat' | 'code'`, default `chat` para bancos
  antigos). Sessões do Chat aparecem só no Chat; sessões do Code só no Code.
- O usuário pode marcar uma sessão do Chat como **compartilhada com o Code**
  (`codeLinked = true`): ela passa a aparecer nos dois layouts e é a mesma conversa (mensagens,
  título, streaming e artefatos compartilhados). O vínculo pode ser removido.
- Cada layout lembra sua **própria sessão ativa**; alternar Chat ↔ Code restaura a sessão daquele
  layout e nunca mostra a do outro (nem no centro, nem na lista, nem na paleta, nem nas abas).
- A página Biblioteca continua exclusiva do Chat; Skills continua nos dois.

## Escopo

- Backend Rust: colunas `mode`/`code_linked` + migração aditiva, criação com modo, comando
  `set_conversation_code_linked`, testes.
- Renderer: contrato TS (`ConversationMode`, `mode`, `codeLinked`), helper
  `lib/conversations`, store (sessões por layout, vínculo, enterLayout), Sidebar do Chat (filtro +
  menu “Usar no Code”/“Remover do Code”), paleta (busca escopada por layout e “Novo agente” no
  Code), sidebar/abas do Code + diálogo “Adicionar sessão do Chat”, docs.
- Fora do escopo: harness de código (workspace/git/agentes), renomear/duplicar sessão entre modos,
  mover uma sessão do Code para o Chat.

## Critérios de pronto

- Nenhuma sessão de um modo vaza para o outro sem `codeLinked` (listas, centro, abas, busca da
  paleta, recentes).
- Adicionar uma sessão do Chat ao Code (pela sidebar do Code **e** pelo menu do Chat) faz a mesma
  conversa aparecer nos dois modos; remover o vínculo a retira do Code sem afetar o Chat.
- Alternar Chat ↔ Code restaura a sessão ativa de cada layout (incluindo o estado vazio quando o
  layout não tem sessões).
- `pnpm typecheck`, `pnpm test`, `pnpm build` verdes; `cargo test --lib` verde; sem regressão nas
  funções do Chat.
