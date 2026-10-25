# Paleta de comandos 2.0 — Evidências

## Acceptance Evidence

| Critério (`docs/COMMAND_PALETTE.md` §8) | Evidência |
| --- | --- |
| 1. Ação morta removida; busca real inline | `src/components/palette/CommandPalette.test.tsx` › “does not offer the removed dead ‘Buscar conversas’ command”, “queries the backend for conversation matches”; grep sem `searchOpen`/`setSearchOpen` no renderer |
| 2. Busca sem acentos/caixa, multi-token, fuzzy e destaque; selo “Conteúdo” | `src/lib/palette/__tests__/search.test.ts` (32 testes: normalização, AND, subsequência, ranking, ranges, conversas) + componente “filters commands ignoring accents and highlights the match” |
| 3. Conversas: backend + merge local, Enter abre, ⌘↵ fixa, loading/fallback/vazio | `CommandPalette.test.tsx` › “queries the backend…”, “shows a loading state…”, “ignores stale conversation responses”, “falls back to the local title/preview index”, “opens a conversation with Enter”, “pins/unpins…” |
| 4. Recentes + “Sugestões” | `src/lib/palette/__tests__/recents.test.ts` (8) + componente “orders the suggestions by recent usage”, “keeps the palette usable when localStorage is corrupted” |
| 5. Teclado completo, Esc limpa/fecha, IME, atalhos globais bloqueados | `CommandPalette.test.tsx` teclado (6) + 3 regressões de seleção + `src/lib/__tests__/hotkeys.test.ts` (8: matriz snapshot, ⌘K, Esc hierárquico, ⌘J/editable) |
| 6. Ações contextuais, abas de Configurações, toggles, foco deferido | `CommandPalette.test.tsx` › “only offers…” (streaming/anexos), “explains the locked model”, “opens Settings on the requested tab”, “toggles a composer tool”, “focuses the composer after closing”, “returns to the chat before focusing…” + `SettingsDialog.test.tsx` (abre na aba pedida/grava a aba) |
| 7. Acessibilidade (combobox/listbox/grupos/live/activedescendant) | `CommandPalette.tsx` (roles + `aria-activedescendant` + `aria-live`) e teste “keeps the input and the active row in sync…”; `aria-label` explícito nas opções (bug de nome acessível com `<mark>` corrigido) |
| 8. Sem código morto | `src/lib/__tests__/uiStore.test.ts` › “cutover de estado órfão”; grep final sem `searchOpen`, `attachmentsOpen`, `fontScale`/`reduceMotion` (uiStore), `CommandItem`/`AttachmentDraft` (types) |
| 9. Suíte/build/docs | `pnpm typecheck`, `pnpm test`, `pnpm build` abaixo; `docs/DESIGN.md` §10, `docs/FILES.md` v1.6 |

## Verification

```
pnpm typecheck  → OK (tsc --noEmit, sem erros)
pnpm test       → 58 arquivos / 1267 testes passed (baseline: 53/1176; +91)
pnpm build      → OK (vite build; aviso de chunk >1500 kB pré-existente)
```

Focados:

```
pnpm vitest run src/lib/palette
  → search 32 + recents 8 = 40 passed

pnpm vitest run src/lib/__tests__/hotkeys.test.ts
  → 8 passed

pnpm vitest run src/lib/__tests__/uiStore.test.ts
  → 33 passed (26 baseline + 7 do deep-link/cutover)

pnpm vitest run src/components/palette
  → CommandPalette 33 passed (inclui 3 regressões: reabrir restaura a 1ª linha (query vazia e busca anterior);
    tecla que não muda os resultados preserva o destaque)

pnpm vitest run src/components/settings/SettingsDialog.test.tsx
  → 3 passed (abre na aba pedida, acompanha mudança externa, grava a aba)
```

Auditoria de código morto:

```
grep -rn "searchOpen\|attachmentsOpen\|CommandItem\|AttachmentDraft" src/
  → apenas as asserções de ausência em src/lib/__tests__/uiStore.test.ts
    (nada em produção); fontScale/reduceMotion também só sobrevivem em storage
    antigo de usuários, ignorados pelo merge do persist.
```

Sem mudanças no backend (`src-tauri/**` intocado); `cargo` não foi necessário.

## Review Notes

### PRE review do plano (subagent independente, read-only)

Veredito inicial: **BLOCK** (5 blockers). Todos resolvidos antes da execução:

1. **Ownership/handoff ausente** → PLAN §Ownership desta execução declara o
   Lead como único escritor do ciclo (sem writers concorrentes), com a ordem
   contrato → ui-systems e o revisor independente no final; cenário de
   paralelização futura documentado.
2. **Plano defasado vs árvore** (libs criadas antes do gate, APIs com nomes
   diferentes) → T1/T2/T3 reescritas com as APIs reais (`matchText`,
   `matchCommand`, `rankCommands`, `splitHighlight`, `rankConversations`,
   `mergeConversationResults`, `PaletteCommandResult`…), T1 marcada como
   concluída com 40 testes verdes, `EVIDENCE.md` preenchido.
3. **Regressão de foco** ao abrir Settings/ModelPicker após fechar a paleta →
   contrato §4.5: execução agendada no próximo tick (depois do restore do
   Radix); T5/T7 incluem testes com fake timers e foco do composer.
4. **Cascata do Esc** → dono único em `DialogContent.onEscapeKeyDown`
   (`preventDefault` sempre) + `App` resolvido por `src/lib/hotkeys.ts`
   testável; contrato §4.4 define passo 1 (limpar) e passo 2 (fechar).
5. **Critério de aceite impossível (trecho de conteúdo) e bloqueio de atalhos
   não testável** → contrato §4.2/§8: destaque só em título/`preview` e selo
   “Conteúdo” para matches de conteúdo; `src/lib/hotkeys.ts` extraído para
   teste unitário da matriz de atalhos.

Correções de auditoria apontadas pelo revisor (aplicadas em
`docs/COMMAND_PALETTE.md` §3): “Abrir configurações” reabre na última aba (não
“sempre em Geral”); caixa já era dobrada na v1 (só acentos/fuzzy faltavam); o
catálogo v2 tem 31 comandos (não “≈27”); `uiStore.fontScale`/`reduceMotion` e
`types.AttachmentDraft` também eram código morto (removidos no cutover);
640×360 é largura fixa + altura máxima da lista; testes do `uiStore` para o
cutover foram adicionados em T8.

### Gaps de especificação tratados

- Merge sempre com matches locais normalizados (SQLite `LIKE` é ASCII, então
  “reuniao” não acha “Reunião” no backend); conteúdo puro segue limitação
  documentada.
- Query só com espaços nunca chega ao backend (trim + mínimo 2).
- `openSettings(tab?)` como caminho de deep-link; `setSettingsOpen` preserva a
  aba; “Configurar” do ModelPicker passa a abrir Provedores.
- Sem comandos de `fontScale` (fonte dupla removida) e sem `copiar-conversa`
  (evita duplicar o formato do export).
- Testes adicionais: IME, 1 caractere/`#`, unmount em voo, corrida de respostas,
  falha de API, reordenação por fixar, storage com quota, foco/agendamento.
- Bug real encontrado pelos testes: o destaque em `<mark>`/spans quebrava o
  **nome acessível** das opções (“Abrirconfigurações”); corrigido com
  `aria-label` explícito em `PaletteRow`/`ConversationRow`.

### Verificação independente final

Verificador read-only independente: veredito inicial **FAIL com 1 must-fix**,
todo o restante conforme o contrato (testes focados 5 arquivos/111, typecheck,
cutover, busca, teclado/ARIA, Esc dono único, foco e docs).

- **Must-fix encontrado:** reabrir a paleta com query vazia não restaurava a
  linha ativa (o efeito de ancoragem dependia só de `flatSignature`; a
  assinatura era idêntica após reabrir, então `aria-activedescendant` ficava
  nulo e Enter não fazia nada). Sintoma irmão: tecla que não mudava o resultado
  (espaço à direita) apagava o destaque.
- **Correção aplicada:** o efeito de reset marca `forceFirst` (ref) e o efeito
  de ancoragem depende de `flatSignature`, `rawQuery` e `open`; a seleção só cai
  para a primeira linha quando forçada, quando some do resultado ou ao abrir.
  Removido o `setActiveKey(null)` a cada tecla.
- **Testes de regressão (3):** “restores the first row as active when reopening
  with an empty query”, “starts from the first row when reopening after a
  search was left open” e “keeps the highlight when a keystroke does not change
  the result set” (`CommandPalette.test.tsx`, +3 → 33).
- Notas cosméticas endereçadas: ⌘↵ em comando documentado como no-op; contrato
  de loading/aria-disabled/altura de linha alinhado ao implementado; linhas
  ganharam anel de foco; formatação do `uiStore.test.ts` corrigida; refs de
  linha agora são removidas no unmount.
- **Re-verificação independente (read-only): PASS.** Confirmou a lógica do
  efeito (flag `forceFirst` consumida só com query limpa, deps primitivas, sem
  loop), que os testes de regressão falhariam na lógica antiga, e rodou
  `pnpm typecheck`, focados (paleta+uiStore **2 arquivos / 66 testes**) e a
  suíte completa (**58 arquivos / 1267 testes**) — todos verdes.
- Fechamento: suíte completa reexecutada isolada → **58 arquivos / 1267
  testes**; `pnpm build` → OK. (Uma execução concorrente com o próprio revisor
  falhou por contenção de recursos; a reexecução isolada é a evidência válida.)

## Referências (pesquisa UX do ciclo)

Pesquisa independente (Raycast, Linear, VS Code, Superhuman, Notion, GitHub,
cmdk, Radix, WAI-ARIA APG):

- https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- https://www.radix-ui.com/primitives/docs/components/dialog
- https://www.radix-ui.com/primitives/docs/components/alert-dialog
- https://github.com/pacocoursey/cmdk
- https://github.com/pacocoursey/cmdk/blob/main/ARCHITECTURE.md
- https://docs.github.com/en/get-started/accessibility/github-command-palette
- https://manual.raycast.com/search-bar
- https://manual.raycast.com/action-panel
- https://manual.raycast.com/keyboard-shortcuts
- https://new.superhuman.com/superhuman-command-29123
- https://linear.app/docs/search
- https://www.notion.com/help/keyboard-shortcuts
- https://github.com/microsoft/vscode/issues/173767
- https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize
- https://developer.mozilla.org/en-US/docs/Web/API/AbortController
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- https://sqlite.org/fts5.html#unicode61_tokenizer
