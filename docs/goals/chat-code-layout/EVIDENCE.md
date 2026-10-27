# EVIDENCE — Layouts Chat e Code (fase 1: layout)

> Verificação independente da `task-3` (verifier). Somente leitura no código do app; este é o
> único arquivo escrito. Workdir: `H:\ChatTauri`. Data: **2026-10-27** (~11:04–11:08, America/Sao_Paulo).

## 0. Snapshot verificado

| Item | Valor |
| --- | --- |
| `HEAD` | `2b260d23f8b434d2fe05bc7ab13b32e5e8cd5d3e` — "Add Chat and Code layout modes" |
| Conteúdo do `HEAD` | somente docs de planejamento (`docs/goals/chat-code-layout/{GOAL,PLAN}.md` + `docs/goals/new-layout/refs/**`); **nenhum código do goal commitado** |
| Commit do `HEAD` | 2026-10-27 10:36:22 −03:00, anterior ao início da implementação (implementação 100% não commitada) |
| Diff não commitado (tracked) | hash do `git diff`: `c9f3bfdbdf2b9bff6a498f05a19b6c0154b23e19` |
| Novos arquivos (untracked) | hash agregado: `631a19a07e83418fb50f1de8bd28402a44334b3d` (13 arquivos, 2.070 linhas) |
| Estabilidade | ambos os hashes idênticos nos snapshots de 11:04:46 e 11:08:00 → nada mudou durante a verificação |

`git status --short`: **22 arquivos rastreados modificados + 13 novos não rastreados**; nenhuma
mudança em `src-tauri/**`, `package.json`, `data/**` ou scripts. Sem commits de implementação, como
esperado.

## 1. Comandos e resultados

| # | Comando | Resultado |
| --- | --- | --- |
| 1 | `git status --short` / `git diff --stat` | 22 modified, 13 untracked; `+608 / −136` nos rastreados; sem commits novos de código |
| 2 | `pnpm typecheck` (`tsc --noEmit`) | **verde**, exit code `0`, sem saída de erro |
| 3 | `pnpm test` (`vitest run`) | **verde**, exit `0`: `Test Files 76 passed (76)` / `Tests 1499 passed (1499)`, 102,91 s |
| 4 | suíte dos 6 arquivos de teste novos | **verde**, exit `0`: `6 passed (6)` / `50 passed (50)`, 5,00 s |
| 5 | 13 arquivos novos/alterados com `--sequence.shuffle` (ordem aleatória) | **verde**, exit `0`: `13 passed (13)` / `187 passed (187)`, 16,96 s — sem dependência de ordem nesse subconjunto |
| 6 | `pnpm build` (`tsc --noEmit && vite build`) | **verde**, exit `0`, `✓ built in 9.26s`; aviso de chunk > 1500 kB (`index-*.js` ≈ 1.959 MB) que o PLAN/Lead classifica como pré-existente |
| 7 | grep `#[0-9a-fA-F]{3,8}`, `rgb(`, `hsl(` em todos os `.ts/.tsx` novos/alterados | **nenhuma ocorrência** (fora de testes de cor) |
| 8 | grep `TODO|FIXME|mock|fake|Math.random|console.` nos componentes novos | nada em código de produto (só mocks de teste, esperados) |

Contagens: a suíte passou de 70 arquivos rastreados para **76** (6 novos) e `1499` testes, dos
quais **50** são os testes novos (`CodeSidebar` 13, `CodeSessionHeader` 12, `CodePanel` 12,
`CodeWelcomeScreen` 3, `LayoutModeSwitch` 3, `WorkspaceCenter` 7). O número registrado pelo Lead no
PLAN §11 (76/1499) **foi reconfirmado**.

Diff stat completo:

```
 AGENTS.md                                      |   1 +
 docs/ARCHITECTURE.md                           |   9 +-
 docs/DESIGN.md                                 |   9 ++
 docs/goals/chat-code-layout/PLAN.md            |  55 +++++++++-
 src/App.tsx                                    |  52 +++++-----
 src/components/chat/ChatView.tsx               |  10 +-
 src/components/composer/Composer.test.tsx      |  34 +++++-
 src/components/composer/Composer.tsx           |   9 +-
 src/components/layout/AppShell.test.tsx        |  22 ++++
 src/components/layout/AppShell.tsx             |  24 ++++-
 src/components/layout/TitleBar.test.tsx        |  30 +++++-
 src/components/layout/TitleBar.tsx             | 104 +++++++++++--------
 src/components/palette/CommandPalette.test.tsx |  65 ++++++++++++
 src/components/palette/usePaletteActions.ts    | 137 ++++++++++++++++---------
 src/components/skills/SkillsView.test.tsx      |  11 ++
 src/components/skills/SkillsView.tsx           |  18 +++-
 src/lib/__tests__/hotkeys.test.ts              |   3 +
 src/lib/__tests__/uiStore.test.ts              |  79 ++++++++++++++
 src/lib/hotkeys.ts                             |   6 +-
 src/lib/store/chatStore.ts                     |   7 +-
 src/lib/store/index.ts                         |   9 +-
 src/lib/store/uiStore.ts                       |  50 +++++++++
 22 files changed, 608 insertions(+), 136 deletions(-)
```

Novos (untracked, 2.070 linhas): componentes `src/components/code/{CodeSidebar,CodeSessionHeader,
CodePanel,CodeWelcomeScreen}.tsx` + `index.ts`, os 4 testes correspondentes, e
`src/components/layout/{LayoutModeSwitch,WorkspaceCenter}.tsx` + 2 testes = 13 arquivos / 6 testes.

## 2. Checklist contra GOAL/PLAN/DESIGN

Legenda: ✅ ok · ⚠️ ok com ressalva (ver §3) · ❌ falha.

### 2.1 Seletor Chat | Code
- ✅ Centralizado: `TitleBar` virou grade `grid-cols-[1fr_auto_1fr]` com a coluna do meio
  `justify-self-center` (`src/components/layout/TitleBar.tsx:109,139-141`); colunas laterais iguais
  + `min-w-0` → centro geométrico.
- ✅ Persistente e validado: `uiStore.layoutMode` (`src/lib/store/uiStore.ts:175,198-199`) entra no
  `partialize` (`:287-295`) e o `merge` normaliza valor inválido (`:301-313`); teste de reidratação
  cobre `layoutMode 'work' → 'chat'` (`src/lib/__tests__/uiStore.test.ts`).
- ✅ Acessível: `role="group"` + `aria-label="Modo do aplicativo"`, botões com `aria-pressed`,
  foco visível, alvo `h-8` = 32 px (`LayoutModeSwitch.tsx:29-64`); alternável por teclado
  (Tab/Enter) e pela paleta ("Ir para o modo Chat/Code").
- ✅ Sem quebrar marca/busca/`PlanUsageChip`/controles: mesmos elementos e labels preservados
  (`TitleBar.tsx:113-187`); testes de TitleBar estendidos e verdes.

### 2.2 Modo Chat sem regressão
- ✅ Funcional: suíte inteira verde (incluindo ChatView, Sidebar, Biblioteca, painéis, paleta,
  atalhos); nenhum teste existente enfraquecido/removido nos diffs (apenas adições + `layoutMode`
  nos `beforeEach`).
- ✅ Estrutura: `App.tsx` agora compõe `WorkspaceCenter`, mas Chat continua com a **mesma** `ChatView`
  montada e as mesmas views/painéis; `AppShell` sem sidebar/right panel custom mantém defaults.
- ⚠️ Visual na title bar: reestruturação em grade e **`PlanUsageChip` oculto abaixo de 1024 px**
  (`TitleBar.tsx:144-146`) — única diferença visível no Chat, documentada no PLAN §11 e DESIGN §13
  (ver R1).

### 2.3 Modo Code — workbench
- ✅ Sidebar de sessões: `CodeSidebar` com `+ Novo agente`, `Buscar`, `Skills`, seção Workspaces,
  Sessões reais agrupadas (`groupConversations`), `aria-current` na ativa, rodapé
  Configurações+versão, `aria-label="Sessões"`, drawer compacto com fechar
  (`src/components/code/CodeSidebar.tsx`; 13 testes).
- ✅ **Sem Biblioteca**: não há item de biblioteca na `CodeSidebar`; `WorkspaceCenter` só renderiza
  `LibraryView` quando `!isCode` (`WorkspaceCenter.tsx:29,62`); paleta esconde comandos de
  biblioteca/artefatos/fontes no Code (`usePaletteActions.ts:383-427`); testes dedicados
  (`WorkspaceCenter.test.tsx:105-111`, `CodeSidebar.test.tsx:246-251`, `CommandPalette.test.tsx`).
- ✅ Workspaces honesto: "Nenhum workspace aberto" + explicação, sem botão morto
  (`CodeSidebar.tsx:176-190`; copy idêntica ao PLAN §5).
- ✅ Cabeçalho/abas: título truncado, chip "Sem workspace" não interativo, toggle do painel com
  `aria-pressed`; `role="tablist"`/`role="tab"`, `aria-selected`, `aria-controls="code-session-panel"`,
  setas/Home/End, `+` nova sessão, fechar com `aria-label` (`CodeSessionHeader.tsx`; 12 testes).
- ✅ Painel Arquivos/Alterações: abas com `role="tablist"`, `tabpanel` com `aria-labelledby`, barra
  "Sem workspace", "Sem commit +0 −0", **Commit desabilitado** com tooltip "Disponível com o
  harness de código", estados vazios do PLAN §5, recolher, divisor acessível reutilizado
  (`CodePanel.tsx`; 12 testes). Largura compartilha `sidePanelWidth` e o `resolveSidePanelLayout`
  (≥480 px de conversa no caso padrão).
- ✅ Welcome do Code: "Comece uma sessão do agente" + 3 sugestões que apenas preenchem o composer
  (evento `lumina:suggest`), foco no composer, `reduceMotion` respeitado
  (`CodeWelcomeScreen.tsx`; 3 testes).
- ✅ Composer: mesma instância/comportamento; só muda placeholder/aria-label por `layoutMode`
  (`Composer.tsx:46-48,192-196`), com teste de rascunho preservado ao alternar modo.

### 2.4 ChatView única / Skills / estado
- ✅ Uma única instância de `ChatView` no app (`WorkspaceCenter.tsx:52` é o único `<ChatView`;
  `WorkspaceCenter` mantém a região montada e só alterna `hidden`/`flex`), logo rascunho/anexos/
  scroll sobrevivem Chat↔Code; teste de identidade do elemento ao trocar modo
  (`WorkspaceCenter.test.tsx:113-122`) e teste de draft no Composer.
- ✅ Skills nos dois modos: Chat pela sidebar existente; Code pela `CodeSidebar`/paleta com
  `onBack`/`backLabel` ("Voltar à sessão"); `Esc` no Skills do Code volta à sessão
  (`SkillsView.tsx:163-184`, `App.tsx:65-75` com `codeSkillsView` em `hotkeys.ts:100-102`).
- ✅ Estado por layout: `activeView` (Chat) e `codeView` (Code) independentes; `openConversation`/
  `startNewConversation` normalizam as duas superfícies (`chatStore.ts:569-607`).

### 2.5 Design/tokens
- ✅ Só tokens do tema nos novos componentes (`bg-surface*`, `border-border*`, `text-foreground*`,
  `accent`, `success`, `danger` existem em `src/styles/globals.css:76-93`); grep de hex/rgb/hsl
  = 0 ocorrências nos `.ts/.tsx` novos/alterados (fora de testes).
- ✅ Bordas consistentes com o design existente (divisórias uniformes `border-b`/`border-t`/
  `border-l`; painel direito usa `border-l border-border bg-surface-raised`, igual ao
  `ArtifactPanel` docked).
- ✅ Copy pt-BR exatamente conforme PLAN §5/DESIGN §14.

### 2.6 Acessibilidade
- ✅ `aria-label` em todos os ícones-botão novos (`IconButton` exige `label`), foco visível
  (`ring-accent/40` / `group-focus-visible:bg-accent` no divisor), `role`s de tablist/tab/tabpanel,
  `reduceMotion` no seletor/welcome/shell/drawer.
- ⚠️ Alvo do botão fechar aba = 24 px (< 32 px do DESIGN §12) e botão interativo aninhado dentro de
  `role="tab"`; foco não é restaurado ao fechar aba — ver R2/R3.

### 2.7 Responsivo
- ✅ Code drawer abaixo de 1024 px = mesmo drawer do Chat, `aria-label` "Sessões"
  (`AppShell.tsx:154-183`, `App.tsx:224`).
- ✅ Painel direito do Code só é renderizado ≥ 1120 px (`CodePanel.tsx:84` + `lib/sidePanel.ts:75`);
  abaixo disso o botão do cabeçalho fica desabilitado com dica "Aumente a janela para ver o painel
  de arquivos" (`CodeSessionHeader.tsx:134-176`); testes cobrem 1440 e 1000.
- ✅ Title bar em ~900 px (minWidth da janela = 900, `src-tauri/tauri.conf.json`): sem o chip
  (oculto <1024) o lado direito mede ~275 px estimados contra ~371 px de coluna; o esquerdo ~136 px.
  **Análise estática** (sem automação de UI, proibida pelo AGENTS) não aponta sobreposição. Ressalva
  R1 para a faixa 1024–~1207 px com plano ChatGPT ativo (compressão dos controles de janela).

### 2.8 Testes frágeis / vazamento de estado
- ✅ Suíte inteira verde + subconjunto novo/alterado verde em ordem aleatória (13 arquivos/187
  testes) → sem dependência de ordem detectada.
- ✅ Nenhum `.skip/.todo/.only` novo, nenhum `console.log` adicionado, nenhum mock de produto
  (só mocks de `@/lib/api` em testes, padrão do repo).
- ⚠️ Os testes novos não chamam `vi.clearAllMocks()` no `beforeEach`; as asserções
  `toHaveBeenCalledTimes(1)` de `CodeSidebar.test.tsx:151` e `CodeSessionHeader.test.tsx:201` são
  sensíveis à ordem caso um teste futuro dispare a mesma API antes — R9. Também falta teste direto
  do `welcome` custom da `ChatView` (R5).

### 2.9 Estado vazio honesto
- ✅ Nada de workspace/git/arquivos simulados: `src/components/code/**` não importa `@/lib/api`,
  não há dados estáticos de repo/branch/arquivos; tudo que depende do harness é estado vazio com
  copy e tooltip explícitos (Commit `disabled`). Nenhum `setTimeout`/fake de loading.
- ⚠️ Não é falha: "workspace"/"alterações" só existem como texto de UI; o harness da fase 2
  consumirá `layoutMode`/`codePanel*`.

### 2.10 Docs e escopo
- ✅ `docs/DESIGN.md` §5 (bullet Modos da aplicação), §11 (motion do seletor), §13 (responsivo do
  Code) e §14 (microcopy) atualizados; `docs/ARCHITECTURE.md` §3 atualizado; `AGENTS.md` com a nova
  área `src/components/code/**`; PLAN §11 com registro de implementação e pendências.
- ⚠️ GOAL/PLAN apontam para `docs/goals/chat-code-layout/refs/`, que **não existe**; as imagens
  estão em `docs/goals/new-layout/refs/` (commit do `HEAD`) — R6.
- ✅ Escopo respeitado: sem mudanças em Rust/backend, sem novos endpoints, sem commits.

## 3. Achados (nenhum bloqueante)

| Id | Severidade | Descrição | Referência | Impacto |
| --- | --- | --- | --- | --- |
| R1 | baixa | `PlanUsageChip` oculto `<1024px` (lg) e reestruturação da title bar em grade. Na faixa 900–1023 px do modo Chat o indicador de plano some (antes aparecia). Em 1024–~1207 px, com plano ChatGPT ativo, o conteúdo da direita (~467 px) excede a coluna (~433 px em 1024) e os controles de janela encolhem via `flex-shrink` (estimativa estática) para ~29 px — sem colisão com a pílula, mas abaixo do alvo de 32 px. | `src/components/layout/TitleBar.tsx:109,143-146` | Cosmético/window width; documentado no PLAN §11 e DESIGN §13. Aceitável nesta fase; avaliar `hidden xl:block` ou chip compacto se o usuário 900–1023 for relevante. |
| R2 | baixa | Botão fechar de aba tem 24 px (`size-6`) e é um `<button>` dentro de `div role="tab"` (controle interativo aninhado em tab, padrão ARIA desencorajado; dois tab stops na aba ativa). | `src/components/code/CodeSessionHeader.tsx:203-244` (botão em `:226-241`, `size-6` em `:235`) | DESIGN §12 pede alvos ≥32 px; precisão de clique e semântica de tab. Não quebra teclado (setas/Home/End/Enter/Delete testados). |
| R3 | baixa | Ao fechar a aba ativa por teclado (`Delete`) o foco vai para o `body`; o tab seguinte não recebe foco. | `src/components/code/CodeSessionHeader.tsx:76-88` | Foco perdido para usuários de teclado/leitores de tela; recomenda-se focar a aba vizinha ou o `+`. |
| R4 | baixa | `Esc` no Code pode trocar para o layout Chat por causa de estado "stale" do Chat: o snapshot de atalhos calcula `skillsView`/`libraryView` a partir de `activeView` mesmo no Code (`App.tsx:146-148`); se o usuário estava em Skills/Biblioteca do Chat, trocou para Code e aperta `Esc` na sessão, `hotkeys.ts:100` retorna `return-to-chat` e `App.tsx:65-75` faz `setLayoutMode('chat')`. | `src/App.tsx:146-148`, `src/lib/hotkeys.ts:100-102`, `src/App.tsx:65-75` | Contraria o próprio comentário de intenção ("no Code, Esc só sai do Skills"); edge case, sem perda de dados. Correção: condicionar `skillsView`/`libraryView` a `layoutMode === 'chat'` e cobrir com teste de hotkeys. |
| R5 | baixa | Cobertura: o prop `welcome` da `ChatView` não tem teste direto; o teste de `WorkspaceCenter` mocka a `ChatView` inteira, então a renderização do `CodeWelcomeScreen` dentro da `ChatView` real não é exercitada por teste de componente (o teste do welcome isola o componente, e o de WorkspaceCenter isola a composição). | `src/components/chat/ChatView.tsx:114`; mock em `src/components/layout/WorkspaceCenter.test.tsx:5-9` | PLAN §7 pede "ChatView: welcome custom"; gap pequeno, comportamento validado por leitura. |
| R6 | documentação | `GOAL.md`/`PLAN.md` referenciam `docs/goals/chat-code-layout/refs/` (inexistente); as imagens estão em `docs/goals/new-layout/refs/` no commit do `HEAD`. | `docs/goals/chat-code-layout/PLAN.md:6`, `GOAL.md:31-34` | Caminho quebrado para quem for revisar a fase 2; corrigir o texto ou mover a pasta. |
| R7 | cosmético | Pílula usa `text-[12.5px]`; PLAN §2/DESIGN §5 dizem "13px". | `src/components/layout/LayoutModeSwitch.tsx:47`; `docs/DESIGN.md` §5 | Inconsistência mínima de doc/código. |
| R8 | cosmético | PLAN §6 pede botão de recolher com `aria-pressed`; o botão tem `aria-label` correto, mas não `aria-pressed` (não passa `active` ao `IconButton`). Semanticamente não é necessário (é ação, não toggle). | `src/components/code/CodePanel.tsx:176-180`; `docs/goals/chat-code-layout/PLAN.md:154` | Nenhum; ajustar doc ou componente. |
| R9 | testes | Mocks dos testes novos não são limpos entre casos (`vi.clearAllMocks()` ausente); há asserções de contagem de chamadas que hoje são determinísticas só pela ordem atual dos testes. | `src/components/code/CodeSidebar.test.tsx:93-151`, `CodeSessionHeader.test.tsx:97-201` | Fragilidade futura, não atual (suíte e shuffle verdes). |
| R10 | pré-existente | `resolveSidePanelLayout` não consegue honrar o mínimo de 480 px de conversa quando a sidebar está larga e a janela perto do limite: ex. viewport 1120 + sidebar 480 → `dockedMax = max(1120−480−480, 360) = 360`, painel 360 e **conversa 280 px**. O painel nunca fica < 360 px (o mínimo é aplicado no `dockedMax`), mas a conversa pode ficar < 480. Afeta o painel do Code (sempre docked) e, antes, o painel docked do Chat. | `src/lib/sidePanel.ts:83-92`; `src/components/code/CodePanel.tsx:70-84` | Edge case com sidebar ∈ (280, 480] e janela próxima de 1120; não introduzido por este goal (mesmo resolvedor do Chat). Registrar para a fase 2. |

## 4. Veredito

**Aprovado com ressalvas** — nenhuma falha bloqueante.

- `pnpm typecheck` limpo, `pnpm test` 76/76 arquivos e 1499/1499 testes, `pnpm build` OK.
- O GOAL fase 1 está atendido: seletor centralizado/persistente/acessível, modo Chat sem regressão
  funcional relevante, modo Code completo com estados vazios honestos, Skills nos dois modos,
  Biblioteca ausente no Code e `ChatView` única.
- As ressalvas R1–R10 são de severidade baixa (a11y fina, edge cases de teclado/estado, caminho de
  doc e fragilidade de teste); nenhuma exige correção para considerar a fase 1 entregue.

## 5. Pendências / recomendações (Lead)

1. R4: gatear `skillsView`/`libraryView` por `layoutMode === 'chat'` no snapshot de hotkeys e testar
   `Esc` no Code com `activeView` stale (correção pequena, evita troca inesperada de layout).
2. R2/R3: alvo de fechar aba ≥32 px (ou área clicável maior), sem controle interativo dentro de
   `role="tab"`, e restaurar foco ao fechar por teclado.
3. R5: teste direto de `ChatView` com `welcome` custom (o PLAN §7 lista esse caso).
4. R6: corrigir as referências de `refs/` no GOAL/PLAN (ou mover `docs/goals/new-layout/refs` para o
   diretório do goal).
5. R1: confirmar com o usuário que ocultar o `PlanUsageChip` <1024 px é aceitável (documentado) ou
   compactá-lo; evita regressão visual na faixa 900–1023 px.
6. R7/R8/R9: ajustes cosméticos/robustez (texto 13px, `aria-pressed` conforme doc, `clearAllMocks`).
7. Fase 2 (fora do escopo): workspace/harness real, árvore de arquivos, diff/commit Git, escolha de
   harness e persistência das abas ao sair/voltar do modo Code.

## 6. Limitações desta verificação

- Sem automação de UI/navegador (AGENTS.md): a checagem de layout fino (title bar ~900 px, alvos,
  ausência de sobreposição) é **análise estática** de classes/medições estimadas + testes
  automatizados de estrutura/DOM; não houve inspeção visual da janela Tauri.
- `cargo check`/`cargo test` não foram executados: não há mudanças em `src-tauri/**` e o backend
  está fora do escopo da fase 1 (GOAL §"Fora do escopo").
- O aviso de chunk > 1500 kB no `pnpm build` foi observado; não comparei com um build do `HEAD`
  (a classificação "pré-existente" vem do PLAN/Lead, não foi medida aqui).

## 7. Correções pós-verificação (Lead, 2026-10-27)

O snapshot verificado acima permanece a evidência fiel da auditoria. Depois dela, o Lead aplicou
as recomendações de baixo risco do §5 (sem mudar escopo/arquitetura), e a suíte foi re-executada:

| Ressalva | Correção aplicada |
| --- | --- |
| R1 | `PlanUsageChip` agora só aparece em janelas ≥1280px (`TitleBar.tsx`), eliminando a faixa de compressão 1024–1207px; DESIGN §13 atualizado. |
| R2 | A aba virou `role="presentation"` com dois botões irmãos: o `<button role="tab">` (sem controles aninhados) e o fechar (`size-7`, 28px, `tabIndex={-1}` — fecha pela tecla Delete/Backspace, um stop de teclado por aba). |
| R3 | Foco restaurado ao fechar por teclado/ponteiro: aba vizinha quando há, botão “+ Nova sessão” quando a última fecha (`focusTab` em `CodeSessionHeader.tsx`), com testes novos. |
| R4 | `skillsView`/`libraryView` do snapshot de hotkeys agora exigem `layoutMode === 'chat'`; `Esc` no Code não troca mais de layout por estado stale (`App.tsx`). |
| R5 | Testes diretos de `ChatView` com `welcome` custom e com o welcome nativo (`ChatView.test.tsx`). |
| R6 | `docs/goals/new-layout/refs/**` movido para `docs/goals/chat-code-layout/refs/**`; GOAL/PLAN apontam para o caminho real. |
| R7 | Pílula do seletor em `text-[13px]` (igual ao DESIGN §5). |
| R8 | PLAN §6 corrigido: botão de recolher é ação com `aria-label`, não toggle com `aria-pressed` (o toggle com `aria-pressed` é o do cabeçalho). |
| R9 | `vi.clearAllMocks()` adicionado aos `beforeEach` dos testes novos de `code/**`. |

Verificação final após as correções (Lead):

- `pnpm typecheck` → limpo.
- `pnpm test` → **76 arquivos / 1503 testes passed** (1499 da verificação + 4 testes novos: welcome
  custom da ChatView, foco vizinho e foco no “+” ao fechar abas).
- `pnpm build` → `✓ built in 4.90s`, exit 0 (aviso de chunk > 1500 kB mantido, pré-existente).
- Nenhuma mudança em `src-tauri/**`, `package.json` ou `data/**`.
