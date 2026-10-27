# PLAN — Sessões separadas Chat/Code (fase 1.1)

> Status: **implementado e verificado** (2026-10-27) — evidência independente em
> `docs/goals/chat-code-sessions/EVIDENCE.md` (veredito “aprovado com ressalvas”; correções
> pós-verificação no §7 dela). Depende do layout entregue em
> `docs/goals/chat-code-layout/` (fase 1).

## 1. Modelo de dados

| Campo | Onde | Semântica |
| --- | --- | --- |
| `mode: 'chat' \| 'code'` | conversas (SQLite + IPC) | Layout onde a sessão nasceu. Default `chat` para bancos existentes. Imutável após criação. |
| `codeLinked: boolean` | conversas (SQLite + IPC) | Sessão do Chat adicionada ao Code (compartilhada). Só válido para `mode === 'chat'`. |

SQLite: `conversations.mode TEXT NOT NULL DEFAULT 'chat'` e
`conversations.code_linked INTEGER NOT NULL DEFAULT 0`, migração aditiva via `ensure_column`
(bancos antigos preservados). IPC camelCase (`mode`, `codeLinked`).

Comandos novos/alterados:

- `create_conversation` ganhou `mode?: 'chat' | 'code'` (ausente/inválido → `chat`).
- `set_conversation_code_linked({ id, linked }) -> Conversation` — apenas sessões do Chat; erro
  claro para id inexistente ou tentativa de compartilhar sessão do Code.

Listagem continua devolvendo tudo (`list_conversations`/`search_conversations`); o recorte por
layout é do renderer.

## 2. Regras de visibilidade (fonte única: `src/lib/conversations.ts`)

```
Chat list  = mode === 'chat'                                (inclui compartilhadas)
Code list  = mode === 'code' || codeLinked === true         (inclui compartilhadas do Chat)
Disponíveis para adicionar ao Code = mode === 'chat' && !codeLinked
```

Aplicado em: sidebar do Chat, sidebar/abas do Code, busca e recentes da paleta, escolha de fallback
após excluir. Nada de listas duplicadas em componentes.

## 3. Sessão ativa por layout

- `chatStore.activeIdByLayout = { chat, code }`; toda abertura/criação registra a sessão do layout
  corrente (`uiStore.layoutMode`).
- `App.tsx` chama `chatStore.enterLayout(layoutMode)` em `useLayoutEffect` ao montar/alternar:
  restaura a sessão lembrada; se ela não existe mais ou não é visível no layout, abre a primeira
  sessão visível; se o layout não tem sessões, `activeId = null` e a tela de boas-vindas daquele
  layout aparece. O centro é a **mesma** `ChatView`, então rascunho/scroll do composer continuam
  preservados.
- `init()` abre a primeira sessão visível no layout persistido (Code em bancos existentes abre
  vazio, por design).
- Excluir a sessão ativa cai para a primeira sessão visível **do layout atual**.

## 4. UI

- **CodeSidebar**: lista somente sessões do Code (código do próprio layout + compartilhadas);
  ação “Adicionar sessão do Chat” abre `AddChatSessionDialog` (lista as sessões do Chat ainda não
  compartilhadas, com busca; adicionar vincula, fecha e abre a sessão no Code); sessões
  compartilhadas têm indicador discreto; “Novo agente” cria `mode: 'code'`.
- **CodeSessionHeader**: abas apenas de sessões visíveis no Code; fechar a última aba usa
  `clearActiveConversation()` (welcome do Code, sem afetar o Chat).
- **Sidebar do Chat**: lista apenas sessões do Chat (compartilhadas continuam lá); menu da conversa
  ganha “Usar no Code” / “Remover do Code” (toast de confirmação).
- **Paleta**: busca/recentes escopados ao layout atual; “Novo chat” cria sessão do Chat (e mostra o
  layout Chat) e, no Code, o comando vira “Novo agente” (cria `mode: 'code'`).
- **Biblioteca**: continua só no Chat; **Skills** nos dois modos.

## 5. Testes

- Rust: migração (legado → chat, sem perder linhas), criação com modo, default chat, link/unlink,
  validações, serialização camelCase. `cargo test --lib`.
- Renderer: `lib/conversations` (visibilidade/candidatos), `chatStore` (init por layout,
  enterLayout, criação por modo, envio cria no layout atual, link/unlink, clearActiveConversation,
  fallback de exclusão), Sidebar (filtro + menu), paleta (busca/recentes escopados, Novo agente no
  Code), Code (sidebar sem sessões do Chat, indicador de compartilhada, diálogo de adicionar,
  abas filtradas). `pnpm test`/`pnpm typecheck`/`pnpm build`.

## 6. Riscos

| Risco | Mitigação |
| --- | --- |
| Vazamento entre layouts | Fonte única de filtro + testes em lista/centro/abas/paleta. |
| Perda da sessão ativa ao alternar | `activeIdByLayout` + `enterLayout` com fallback visível. |
| Regressão no Chat | Suíte inteira verde; Chat continua recebendo as mesmas ações. |
| Dados antigos | Migração aditiva; todos viram `chat`/não compartilhados (Code começa vazio). |
| Abas do Code perdidas ao ir para Skills | Header permanece montado oculto (fase 1). |

## 7. Registro de implementação (2026-10-27)

Arquivos:

- **Rust**: `src-tauri/src/{domain.rs, db.rs, commands/conversations.rs, lib.rs}` — campos
  `mode`/`code_linked`, migração aditiva, `create_conversation_with_mode`,
  `set_conversation_code_linked`, comando IPC e 8 testes novos (523 testes da lib verdes).
- **Contratos/estado**: `src/lib/types.ts` (`ConversationMode`, `mode?`, `codeLinked?`),
  `src/lib/api.ts` (`mode` no create + `setConversationCodeLinked`),
  `src/lib/conversations.ts` (fonte única de visibilidade), `src/lib/store/chatStore.ts`
  (`activeIdByLayout`, `enterLayout`, `clearActiveConversation`, `setConversationCodeLinked`,
  `startNewConversation(mode?)`, `init`/`ensureConversation`/`deleteConversation` por layout).
- **Integração**: `src/App.tsx` (`useLayoutEffect` → `enterLayout`), `Sidebar` do Chat (filtro +
  menu “Usar no Code”/“Remover do Code”), paleta (busca/recentes escopados + “Novo agente” no Code),
  `ChatView` (guarda de visibilidade do `activeId` como defesa em profundidade), `src/components/code/**`
  (Sessões filtradas, selo “Do Chat”, `AddChatSessionDialog`, abas filtradas, última aba via
  `clearActiveConversation`).
- **Docs**: DESIGN §5/§14, ARCHITECTURE §3/§5/§12/§16 (decisão #17), GOAL/PLAN deste goal.

Decisões finais:

1. `openConversation` ganhou `{ preserveView }`; `enterLayout` restaura a sessão **sem fechar** a
   página atual do layout (Biblioteca/Skills continuam abertas ao alternar Chat ↔ Code).
2. `ChatView` ignora (mostra welcome) um `activeId` de sessão que não pertence ao layout ativo —
   defesa extra mesmo se o efeito de `enterLayout` falhar.
3. O menu do Chat e o diálogo do Code compartilham o mesmo `setConversationCodeLinked` (UPDATE no
   backend; a conversa não é duplicada).
4. Sessões do Code **não** viram sessões do Chat e vice-versa; remover o vínculo só tira do Code.
5. Limitações conhecidas: o estado “Nova sessão” (aba sintética) não é lembrado entre alternâncias
   de layout (ao voltar o layout cai na primeira sessão visível — comportamento documentado);
   no drawer compacto o diálogo abre como portal sobre o drawer (dois níveis modais, Radix);
   abas abertas são estado local do header (reconstruído a partir da sessão ativa ao entrar no Code).

Verificação desta implementação (Lead, antes/depois das correções pós-verificação):
`pnpm typecheck` limpo, `pnpm test` 78 arquivos/1543 testes verdes, `pnpm build` OK,
`cargo test --lib` 523 passed. Evidência independente: `EVIDENCE.md` (com §7 de correções).
