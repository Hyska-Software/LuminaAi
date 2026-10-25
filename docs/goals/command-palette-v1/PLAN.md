# Paleta de comandos 2.0 — auditoria, correções e experiência completa

**Intent:** transformar a paleta ⌘K de um menu estático de 10 ações em uma
central de comando e busca confiável: busca de conversas real (título +
conteúdo), comandos capability-aware, busca tolerante a acentos/typos, recentes,
teclado completo e acessibilidade de combobox — sem novas dependências e sem
mudanças de backend.

**Current Behavior:** `src/components/palette/CommandPalette.tsx` abre um
`Dialog` Radix de 640 px com 10 ações fixas, filtra por substring
case-insensitive (sem normalizar acentos) e navega com ↑/↓/Enter. A ação
“Buscar conversas” liga `uiStore.searchOpen`, que nenhum componente consome — é
código morto. `api.searchConversations` e o comando Rust
`search_conversations` (título + conteúdo das mensagens) existem e não são
usados por nenhuma superfície. Ações não conhecem contexto, não há recentes,
destaque de match, carga/erro, salto para abas de Configurações nem tratamento
de IME. Auditoria completa: `docs/COMMAND_PALETTE.md` §3.

**Expected Outcome:** paleta v2 com:
(1) busca inline de conversas (debounce 160 ms, mínimo 2 chars, token de
corrida, merge local) que abre a conversa com Enter e fixa/desafixa com
⌘/Ctrl+Enter;
(2) catálogo único capability-aware de **31 comandos**, incluindo abas de
Configurações, toggles de ferramentas, skills, fontes, parar/regenerar;
(3) busca de comandos normalizada (NFD), multi-token, fuzzy, com ranges de
destaque e ranking por campo + recência;
(4) recentes persistidos em `lumina.palette.recents` e seção “Sugestões”;
(5) teclado completo (wrap, Home/End, PageUp/PageDown, Ctrl+N/P, IME, Esc
limpa antes de fechar) e atalhos globais resolvidos por módulo puro testável;
(6) estados de carregamento/fallback/vazio, foco preservado ao abrir outras
superfícies e acessibilidade de combobox/listbox completa.

**Target-Perspective Output:** o usuário abre ⌘K, digita “configuracoes” (sem
acento) e vê “Abrir configurações” e “Configurações › …”; digita “projeto” e vê
as conversas cujo título/prévia casam, com trecho destacado, abre com Enter
(resultados que casaram só no conteúdo mostram o selo “Conteúdo”, sem trecho
prometido); Esc limpa a busca antes de fechar; as ações refletem o contexto; as
abas de Configurações abrem direto na aba escolhida; abrir Settings/Model
Picker pela paleta não perde o foco.

**Truth Owner:** `src/lib/store/uiStore.ts` (abertura/aba) +
`src/lib/palette/*` (busca/ranking/recentes) +
`src/components/palette/usePaletteActions.ts` (catálogo de comandos e
disponibilidade). Nenhuma outra lista de comandos/grupos pode existir.

**Contract Boundary:** IPC existente `search_conversations` (sem alteração no
Rust; o renderer faz o merge local normalizado); `SettingsTabId` compartilhado
entre `uiStore`, `SettingsDialog` e paleta; `api.exportConversation(format)` já
aceita `json`.

**Cutover:** remove `searchOpen`/`setSearchOpen`, `attachmentsOpen`/
`setAttachmentsOpen` e `fontScale`/`reduceMotion` do `uiStore` e `CommandItem`/
`AttachmentDraft` de `types.ts` (zero consumidores, verificado por grep);
`SettingsDialog` passa a ler a aba do store. A lista estática de ações é
substituída pelo catálogo único.

**Displaced Path:** flag `uiStore.searchOpen` (nunca renderizada); filtro
substring inline; `GROUP_ORDER` hardcoded que engolia grupos novos; aba local
do SettingsDialog.

**Value Density:** alta — a paleta é o atalho primário do app (⌘K no TitleBar e
Sidebar); hoje 1/10 ações está quebrada e a busca de histórico (feature de
backend pronta) está inacessível.

**Evidence Gate:** `pnpm typecheck`, `pnpm test` (novos testes de lib, hotkeys e
componente), `pnpm build`; inspeção de que não restam `searchOpen`/
`attachmentsOpen`/`fontScale`/`reduceMotion` no `uiStore` nem `CommandItem`/
`AttachmentDraft` em `types.ts`; docs atualizados.

**Acceptance Evidence:** registrados em `EVIDENCE.md` com comandos, contagens de
testes e links para os testes que cobrem cada critério de aceite.

**Evidence Lane:** testes automatizados (Vitest jsdom) + typecheck/build. Sem
automação de UI/navegador (proibida pelo AGENTS.md); QA visual manual fica
documentado como “implementado, não automatizado” se aplicável.

**Kill Criteria:** (a) nenhuma segunda lista de ações/grupos/abas; (b) nenhuma
flag de overlay/estado órfão; (c) busca de conversas sem duplicar o backend (usa
`api.searchConversations` com merge local); (d) sem `todo!()`/TODO novos;
(e) remover a v1 (não deixar comportamento antigo escondido atrás de flag).

**Architecture Slice:**
- Criar: `src/lib/palette/{types,search,recents}.ts`; `src/lib/settingsTabs.ts`;
  `src/lib/hotkeys.ts`; `src/components/palette/{usePaletteActions.ts,
  useConversationSearch.ts,PaletteRow.tsx,ConversationRow.tsx,
  HighlightedText.tsx}`; `src/components/settings/tabIcons.ts`;
  testes `src/lib/palette/__tests__/*`, `src/lib/__tests__/hotkeys.test.ts`,
  `src/components/palette/CommandPalette.test.tsx`;
  `docs/goals/command-palette-v1/*`.
- Modificar: `CommandPalette.tsx`, `src/lib/store/uiStore.ts`,
  `src/lib/types.ts`, `src/components/settings/SettingsDialog.tsx`,
  `src/components/models/ModelPickerDialog.tsx` (só o “Configurar” → aba
  Provedores), `src/App.tsx`, `src/lib/__tests__/uiStore.test.ts`,
  `docs/DESIGN.md` §10, `docs/FILES.md`.
- Evitar: `src-tauri/**` (nenhuma mudança necessária), `src/lib/genui/**`,
  componentes de chat/artefatos além de imports read-only.

**Plan Review Gate:** PRE review executado por revisor independente
(subagent, read-only). Verdict inicial **BLOCK** com 5 blockers; todos
resolvidos neste documento e em `COMMAND_PALETTE.md` §4/§6 (ownership
declarado, APIs reconciliadas, foco/execução agendados, dono único do Esc,
critérios de aceite testáveis). Findings em `EVIDENCE.md` §Review Notes.

**Ownership desta execução:** não há writers concorrentes. O Lead é o único
escritor do ciclo: executa primeiro os arquivos de contrato que lhe pertencem
(`uiStore`, `types`, `App`, `settingsTabs`, `hotkeys`, docs) e, na sequência, os
arquivos da área ui-systems (`components/palette/**`, `components/settings/**`,
`lib/palette/**`), sem edição paralela de outra área. Um revisor independente
confere o diff final. Em futura paralelização, ui-systems assume T4–T7 e o Lead
mantém T1/T2/T9/T10.

## 1. Ordem de execução e tarefas

Dependências: T1/T2 são base; T3 pode rodar em paralelo com T4; T5–T6 dependem
de T1–T4; T7–T8 fecham; T9–T10 são documentação e verificação.

### T1 — Motor puro de busca e recência (`src/lib/palette/*`) — **concluída**
- `types.ts`: grupos/ordem (`PALETTE_GROUPS`, `PALETTE_GROUP_ORDER`), escopos,
  `PaletteAction`, `PaletteCommandResult`, `PaletteConversationResult`,
  `PaletteItem`, `PaletteSection`, rótulos de seção.
- `search.ts`: `normalizeWithMap`, `normalizeText`, `tokenize`,
  `parsePaletteQuery`, `matchText`, `matchCommand`, `rankCommands`,
  `matchConversation`, `rankConversations`, `mergeConversationResults`,
  `mergeRanges`, `splitHighlight`.
- `recents.ts`: `PALETTE_RECENTS_KEY`, `MAX_RECENT_COMMANDS`,
  `readRecentCommandIds`, `recordRecentCommandId`, `clearRecentCommandIds`,
  `orderByRecents`; storage injetável.
- Evidência: `pnpm vitest run src/lib/palette` → **2 arquivos / 40 testes
  verdes** (acentos, caixa, multi-token, fuzzy, ranking, ranges/clamp,
  escopos, recents corrompido/quota).

### T2 — Contratos do store, abas e atalhos (Lead)
- `src/lib/settingsTabs.ts`: `SettingsTabId`, `SETTINGS_TABS`,
  `DEFAULT_SETTINGS_TAB`, `isSettingsTabId`.
- `uiStore.ts`: adiciona `settingsTab`, `setSettingsTab`, `openSettings(tab?)`;
  remove `searchOpen`/`setSearchOpen`, `attachmentsOpen`/
  `setAttachmentsOpen`, `fontScale`/`reduceMotion`; `closeAllOverlays` não cita
  flags removidas.
- `types.ts`: remove `CommandItem` e `AttachmentDraft`.
- `src/lib/hotkeys.ts`: resolução pura `resolveHotkey(event, snapshot)` +
  `isEditableTarget`, com snapshot de overlays/view/streaming; ⌘K é o único
  atalho com a paleta aberta.
- `App.tsx`: consome `resolveHotkey` (switch de comandos).
- `SettingsDialog.tsx`: aba controlada pelo store; `tabIcons.ts` compartilhado.
- `ModelPickerDialog.tsx`: “Configurar” abre `openSettings('providers')`.
- Verificação: `pnpm typecheck` + testes do `uiStore` e de `hotkeys`.

### T3 — Catálogo capability-aware (`usePaletteActions.ts`)
- Implementa exatamente a tabela §5 de `docs/COMMAND_PALETTE.md` (31 comandos;
  fonte única), com disponibilidade por contexto, rótulos dinâmicos, `checked`
  e atalhos (`modKey`); handlers reutilizam stores/api existentes.
- Sem `copiar-conversa` (evita duplicar o formato do export) e sem comandos de
  tamanho de fonte (o slider de Configurações já cobre).
- Verificação: coberto pelo teste de componente (T7) + typecheck.

### T4 — Busca de conversas (`useConversationSearch.ts`)
- Debounce 160 ms, mínimo 2 caracteres, token monotônico de corrida, cap 5,
  loading, merge sempre com matches locais normalizados, fallback local
  (`requireMatch`) quando `api` falha; query vazia nunca chama o backend.
- Verificação: teste de componente com `api.searchConversations` mockado
  (resolução controlada, corrida, erro) + caso de unmount.

### T5 — UI da paleta (`CommandPalette.tsx` + rows)
- Input combobox com placeholder por escopo, spinner e `Kbd Esc`; dicas no
  rodapé; contagem `aria-live`.
- Seções §4.2 (recentes → sugestões → grupos; busca → conversas → grupos);
  headers `role="group"`/`aria-labelledby`; destaque `<mark>`.
- Linhas comando/conversa; selo “Conteúdo” para match só no conteúdo; fixada.
- Teclado §4.4, mouse (`onPointerMove`), scroll da linha ativa, reset/limpeza,
  IME, `aria-activedescendant` sem dangling.
- Execução: fecha → registra recente → agenda efeito no próximo tick
  (`setTimeout 0`); conversa → `openConversation`; ⌘↵ → `togglePinned` + toast
  (mantém aberta); `focar-composer` volta ao chat se necessário.
- `onEscapeKeyDown`: dono único do Esc (`preventDefault` sempre; limpa ou
  fecha).
- Estados: loading, fallback, vazio, indisponível; rodapé contextual.

### T6 — Integrações e cleanup
- `App.tsx` via `hotkeys`; com paleta aberta só ⌘K; Esc da paleta não fecha
  painéis adjacentes.
- Remover referências mortas (`searchOpen`, etc.) em todo o renderer.
- Verificação: typecheck + testes de hotkeys.

### T7 — Testes de componente (`CommandPalette.test.tsx`, jsdom)
Cobrir: abrir/renderizar grupos; filtro sem acento; destaque `<mark>`; teclado
(↑↓ wrap, Home/End, PageUp/PageDown, Enter); IME não executa; Esc limpa→fecha;
escopo `>`/`#` e 1 caractere; busca de conversas (loading→resultado, fallback,
corrida, erro, unmount); abrir conversa; ⌘↵ fixar; recentes em “Sugestões”;
ações contextuais ausentes/presentes (streaming/anexos); modelo bloqueado;
toggles/checked; roles ARIA e `aria-activedescendant`; clique; estado vazio;
reset ao reabrir; ação que abre Settings é agendada e concluída (`waitFor`);
`focar-composer` com skills ativa.

### T8 — Testes de store/hotkeys/dialog
- `uiStore.test.ts`: `openSettings`/`setSettingsTab`/`closeAllOverlays` e
  ausência das flags removidas.
- `hotkeys.test.ts`: matriz de teclas/snapshot (paleta aberta bloqueia o resto,
  Esc hierárquico, ⌘J ignora campo editável).
- `SettingsDialog.test.tsx`: abre na aba do store, acompanha mudança externa
  (deep-link da paleta) e grava a aba selecionada.

### T9 — Documentação
- `docs/DESIGN.md` §10: comportamento v2 (seções, teclado, estados, a11y,
  microcopy) e catálogo resumido.
- `docs/FILES.md`: nova seção da versão com arquivos, contrato e evidências.
- `docs/COMMAND_PALETTE.md` atualizado se a implementação divergir.

### T10 — Verificação final e evidência
- `pnpm typecheck`; `pnpm test` (≥1176 + novos); `pnpm build`.
- `git diff --stat` revisado; grep final de código morto.
- Revisor independente confere contrato vs implementação e roda a suíte;
  findings corrigidos; `EVIDENCE.md` preenchido.

## 2. Critérios de aceite

1. Busca de conversas real, com Enter para abrir e ⌘↵ para fixar.
2. Busca normalizada (acentos/caixa), multi-token, fuzzy e com destaque;
   match só em conteúdo mostra selo “Conteúdo”.
3. Recentes persistidos; “Sugestões” sem duplicar grupos.
4. Catálogo capability-aware completo (§5) sem listas duplicadas.
5. Configurações abrem na aba pedida; toggles refletem estado.
6. Teclado conforme §4.4 (incluindo Esc limpar e IME); `resolveHotkey` testado
   garante que atalhos globais não agem no fundo.
7. ARIA de combobox/listbox/grupos/live region; foco preservado nas ações que
   abrem outras superfícies.
8. Nenhum código morto (`searchOpen`, `attachmentsOpen`, `fontScale`,
   `reduceMotion`, `CommandItem`, `AttachmentDraft`).
9. `pnpm typecheck`, `pnpm test`, `pnpm build` verdes e docs atualizados.

## 3. Verificação por comando

```bash
pnpm typecheck
pnpm test
pnpm build
```

Testes focados durante o desenvolvimento:

```bash
pnpm vitest run src/lib/palette src/lib/__tests__/hotkeys.test.ts \
  src/components/palette src/lib/__tests__/uiStore.test.ts
```

## 4. Referências (UX)

- Pesquisa do ciclo (Raycast, Linear, VS Code, Superhuman, Notion, GitHub,
  cmdk, WAI-ARIA APG): resultados e URLs em `EVIDENCE.md` §Referências.
- `docs/DESIGN.md` §8 e §10; `docs/FILES.md`.
