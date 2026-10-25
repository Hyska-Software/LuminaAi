# Goal: Paleta de comandos 2.0

Execute `docs/goals/command-palette-v1/PLAN.md` (contrato de comportamento em
`docs/COMMAND_PALETTE.md`).

Regras centrais:
- O plano é a fonte: intenção, ownership, cutover, evidência e kill criteria.
- A fonte única dos comandos é `src/components/palette/usePaletteActions.ts`;
  grupos/ordem em `src/lib/palette/types.ts`; abas em
  `src/lib/settingsTabs.ts`. Não duplicar listas.
- Não deixar o caminho antigo vivo: remover `uiStore.searchOpen`,
  `uiStore.attachmentsOpen` e `types.CommandItem`.
- Sem mudanças no backend (`search_conversations` já existe).
- Capturar evidência dos comandos no `EVIDENCE.md`; se algo não for
  automatizável, escrever “implementado, não comprovado”.
- Verificação: `pnpm typecheck`, `pnpm test`, `pnpm build`.
