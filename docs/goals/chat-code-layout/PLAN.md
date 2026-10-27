# PLAN — Layouts Chat e Code (Fase 1: layout)

> Status: **aguardando validação** do usuário. Escopo desta fase: só o layout; o harness de código
> (workspace em disco, leitura de arquivos, git, agentes) vem na etapa seguinte.
> Imagens de referência: `docs/goals/chat-code-layout/refs/`.

## 1. Resultado esperado

Uma aplicação com **dois modos** alternáveis por uma pílula segmentada **centralizada na title
bar** (`Chat | Code`):

- **Chat**: exatamente a experiência atual (sidebar de conversas, Biblioteca, Skills, chat,
  composer, painéis de artefatos/fontes, paleta de comandos). Nenhuma regressão.
- **Code**: workbench inspirado no Paseo — sidebar de workspaces/sessões, cabeçalho e **abas de
  sessão**, a mesma conversa/streaming no centro (com welcome screen própria), composer adaptado,
  e painel direito **Arquivos / Alterações** com barra de workspace/branch/commit. O que depende do
  harness aparece como estado vazio honesto.

```
┌──────────────────────────── TitleBar 56px ───────────────────────────────┐
│ [☰] Lumina            [ Chat | Code ]        [plano] [busca] [– □ ×]      │
├ CodeSidebar 272px ─┬──────────── centro ─────────────────┬ CodePanel 480 ─┤
│ + Novo agente       │ Plan STD module tests in Spectra   │ Arquivos Alter.│
│ Buscar              │ [Spectra] Sem workspace      ▣     │ ◇ Sem workspace│
│ Skills              │ Novo Agente │ anALISA… │ +        │ Sem commit  Commit
│ Workspaces          │                                     │ (vazio)        │
│  (vazio)            │  conversa (MessageList)             │                │
│ Sessões             │                                     │                │
│  • Plan STD…        │  ┌ composer ─────────────────────┐  │                │
│  • Analyze project… │  │ + Busca web Criar arquivos …  │  │                │
│ Configurações  v    │  └───────────────────────────────┘  │                │
└─────────────────────┴─────────────────────────────────────┴────────────────┘
```

## 2. Decisões de design (validadas)

| Tema | Decisão |
| --- | --- |
| Seletor | Pílula segmentada no centro da title bar, estilo da referência (trilho `surface-hover`, segmento ativo `surface-raised` + `shadow-sm`, texto 13px médio, `rounded-full`). |
| Rótulo | `Chat` / `Code`. |
| Dados | Reaproveitar dados reais existentes: conversas = sessões, mensagens/streaming = chat atual. Nada de workspace/git/arquivos/agentes falsos. |
| Skills | Continua acessível no modo Code (item na sidebar do Code; a página existente abre no lugar da sessão, com “Voltar à sessão”). |
| Biblioteca | Só existe no modo Chat. Sem item na sidebar do Code; comandos da paleta de Biblioteca só aparecem/agem no modo Chat. |
| Cores | Somente tokens atuais (`bg-surface`, `bg-background`, `border-border`, `text-foreground-*`, `accent`…). Nenhum hex novo, nenhum tema paralelo. |
| Tipografia/motion | Inter 12–13,5px no chrome, 15px no corpo; transições 150–220ms `ease-out-soft`, respeitando `reduceMotion`. |

## 3. Layout Code — anatomia

### 3.1 TitleBar (compartilhada)

- Mantém: toggle da sidebar, marca Lumina, `PlanUsageChip`, busca (⌘K) e controles de janela.
- **Novo**: `LayoutModeSwitch` centralizado (`absolute left-1/2 -translate-x-1/2`, `no-drag`,
  `role="group"` + `aria-label="Modo do aplicativo"`, botões com `aria-pressed`), com tooltip/atalho
  da paleta para alternar. Persistido em `uiStore.layoutMode`.

### 3.2 CodeSidebar (272px, redimensionável junto com a sidebar do Chat)

- **Ações** (linhas compactas estilo Paseo): `+ Novo agente` (cria conversa/`startNewConversation`),
  `Buscar` (abre a paleta de comandos), `Skills` (abre a página de Skills no centro do Code).
- **Workspaces**: seção visível, com estado vazio (`Nenhum workspace aberto` + texto curto
  explicando que os workspaces chegam com o harness). Sem botão morto.
- **Sessões**: lista agrupada de conversas reais (mesmos grupos Hoje/Ontem/…, reusando
  `groupConversations`), item ativo destacado; clicar abre a conversa. É a única lista no modo Code
  (sem Biblioteca).
- **Rodapé**: `Configurações` + versão, igual à sidebar do Chat.
- Em janela compacta (<1024px) vira o mesmo drawer acessível do Chat (o `AppShell` já resolve),
  com `aria-label` “Sessões”.

### 3.3 Centro do Code

- **Cabeçalho da sessão** (h≈44px, `border-b border-border`):
  - título da conversa ativa (ou “Nova sessão”), truncado;
  - chip discreto do workspace (`Folder` + “Sem workspace”, não interativo nesta fase);
  - ação para mostrar/ocultar o painel direito (`PanelRight`, `aria-pressed`).
- **Abas de sessão** (h≈40px): abas das conversas abertas no Code (a conversa ativa vira aba
  automaticamente; clique abre; `X` fecha — a última aba ativa cai na vizinha ou em “Nova sessão”;
  scroll horizontal; `+` cria nova sessão). Estado local do `CodeSessionHeader` sincronizado com
  `chatStore.activeId`/`conversations` (sem backend novo).
- **Conversa**: o **mesmo** `ChatView` já montado no app (transcript, streaming, composer, erros).
  O `ChatView` permanece montado ao alternar Chat↔Code, então rascunho do composer e scroll são
  preservados. No modo Code a tela vazia usa um **welcome próprio** (“Comece uma sessão do agente”
  + sugestões de tarefas de código que preenchem o composer).
- **Composer**: mesmo componente/comportamento; no Code muda o placeholder
  (“Descreva a tarefa para o agente…”). Sem novos botões falsos de harness nesta fase.

### 3.4 CodePanel (direito, 360–900px, compartilha a largura persistida dos painéis direitos)

- **Abas**: `Arquivos` (folder) e `Alterações` (diff), mais botão para recolher o painel.
- **Barra de contexto**: `GitBranch` + “Sem workspace” (estado vazio; sem repo falso).
- **Alterações**: linha “Sem commit” + contadores `+0 −0` + botão **Commit** desabilitado com
  tooltip “Disponível com o harness de código”; conteúdo vazio (“Nenhuma alteração pendente”).
- **Arquivos**: conteúdo vazio (“Nenhum arquivo para mostrar”; árvore do workspace chega com o
  harness).
- Visível por padrão em janelas ≥1120px; abaixo disso o painel é fechado automaticamente e o botão
  do cabeçalho explica que a janela precisa ser maior (mesmo racional de `lib/sidePanel.ts`).
- Largura usa `resolveSidePanelLayout({ mode:'docked' })` + `PanelResizer` (reuso), garantindo
  ≥480px de conversa.

### 3.5 Modo Chat

- Sem mudanças visuais além do seletor na title bar. Sidebar, views (Biblioteca, Skills), painéis e
  atalhos atuais continuam idênticos.

## 4. Arquitetura

```
src/App.tsx
└── AppShell (chrome + sidebar + main + painel direito)     [layout/]
    ├── LayoutModeSwitch (TitleBar)                          [layout/]
    ├── Sidebar (Chat) | CodeSidebar (Code)                  [layout/ | code/]
    ├── WorkspaceCenter                                      [layout/]
    │   ├── CodeSessionHeader (Code, sessão)                 [code/]
    │   ├── ChatView  ← única instância, sempre montada       [chat/]
    │   │   ├── CodeWelcomeScreen (vazio no Code)            [code/]
    │   │   └── Composer (placeholder por layoutMode)        [composer/]
    │   ├── SkillsView (Chat e Code; `onBack`/`backLabel`)   [skills/]
    │   └── LibraryView (somente Chat)                       [library/]
    └── ArtifactPanel/SourcesPanel (Chat) | CodePanel (Code) [artifacts/ | code/]
```

Mudanças de contrato (Lead):

- `uiStore`: `layoutMode: 'chat' | 'code'`, `codeView: 'session' | 'skills'`,
  `codePanelOpen: boolean`, `codePanelTab: 'files' | 'changes'` + actions; persistir
  `layoutMode` e `codePanelOpen` (merge valida valores); exportar os tipos.
- `AppShell`: novo prop `sidebar?: (ctx: { onClose?: () => void }) => ReactNode` (default =
  `<Sidebar/>`) e `sidebarLabel?: string` (default “Conversas”); `rightPanel` continua igual.
- `SkillsView`: props opcionais `onBack?: () => void`, `backLabel?: string` (default mantém
  “Voltar ao chat”).
- `ChatView`: prop opcional `welcome?: ReactNode` (default `WelcomeScreen`) para a tela vazia do
  Code.
- Paleta: comandos `Ir para o modo Chat` / `Ir para o modo Code`; comandos de Biblioteca só no modo
  Chat; Skills abre no modo atual (Code: `codeView='skills'`).
- `App.tsx`: monta sidebar/painel direito por modo e o `WorkspaceCenter`; drag&drop de arquivos na
  Biblioteca só quando `layoutMode==='chat'`; atalhos globais atuais não mudam.

## 5. Estados vazios (copy pt-BR)

| Onde | Título | Descrição |
| --- | --- | --- |
| Workspaces (sidebar) | Nenhum workspace aberto | Os workspaces do harness de código aparecem aqui na próxima etapa. |
| Arquivos | Nenhum arquivo para mostrar | A árvore do workspace aparece aqui quando o harness estiver ativo. |
| Alterações | Nenhuma alteração pendente | As mudanças do agente aparecerão aqui para revisão e commit. |
| Commit | (botão desabilitado) | Disponível com o harness de código. |
| Welcome Code | Comece uma sessão do agente | Descreva uma tarefa… + 3 sugestões de código. |

## 6. Acessibilidade

- Seletor de modo: grupo com `aria-label`, `aria-pressed`, foco visível, alvos ≥32px.
- Abas de sessão: `role="tablist"`/`role="tab"` com `aria-selected`, `aria-controls`, fechamento com
  `aria-label`, navegação por teclado (setas/Home/End) e `+` como botão.
- Sidebar do Code: `aria-current` na sessão ativa; mesmas regras de foco da sidebar atual.
- Painel: abas com `role="tablist"`, botão de recolher com `aria-pressed`/`aria-label`.
- Nenhuma cor nova; contraste AA; `reduceMotion` respeitado.

## 7. Testes (TDD, antes/durante a implementação)

- `uiStore`: defaults, actions, persistência/merge do `layoutMode` e `codePanelOpen`.
- `LayoutModeSwitch`/`TitleBar`: seletor centrado, rótulos, `aria-pressed`, clique alterna e
  persiste; marca/busca/controles/Plano ChatGPT continuam (testes atuais estendidos).
- `AppShell`: continua igual por default; aceita sidebar/right panel por modo; drawer com rótulo.
- `WorkspaceCenter`: Chat mostra ChatView; Code mostra header + ChatView; Skills volta para a
  sessão; Biblioteca nunca aparece no Code.
- `CodeSidebar`: ações, estado vazio de Workspaces, sessões reais, abrir conversa, Skills, rodapé.
- `CodeSessionHeader`: título, abas (abrir/fechar/ativar/`+`), sincronização com `activeId`,
  toggle do painel, teclado.
- `CodePanel`: abas Arquivos/Alterações, estados vazios, Commit desabilitado, recolher.
- `ChatView`/`Composer`: welcome custom e placeholder por modo; comportamento de envio atual intacto.
- `SkillsView`: `onBack`/`backLabel` sem regressão no default.
- Paleta: comandos de modo e regra da Biblioteca; testes existentes atualizados.

## 8. Arquivos e propriedade

| Área | Arquivos | Dono |
| --- | --- | --- |
| Contrato/estado | `src/lib/store/uiStore.ts`, `src/lib/store/index.ts` | Lead |
| Chrome | `src/components/layout/{LayoutModeSwitch,TitleBar,AppShell,WorkspaceCenter}.tsx` + testes | Lead |
| Composição do app | `src/App.tsx`, `src/components/chat/ChatView.tsx`, `src/components/skills/SkillsView.tsx`, `src/components/palette/usePaletteActions.ts` | Lead |
| Novo layout Code | `src/components/code/**` (`CodeSidebar`, `CodeSessionHeader`, `CodePanel`, `CodeWelcomeScreen`, `index.ts`) + testes | code-workbench |
| Composer | `src/components/composer/Composer.tsx` + teste (variant por `layoutMode`) | code-workbench |
| Docs | `docs/DESIGN.md` (§5/§14), `AGENTS.md` (nova área), este diretório | Lead |
| Verificação | suíte, typecheck, build, revisão contra este plano | verifier |

## 9. Execução

1. **Lead — fundação** (antes do paralelismo): `uiStore` com os novos estados/actions + exports +
   testes; commit lógico local (sem `git commit`). Publica o contrato.
2. **code-workbench** (paralelo): implementa `src/components/code/**` e o variant do composer com
   TDD, usando o contrato da etapa 1.
3. **Lead — integração** (paralelo): `LayoutModeSwitch` + `TitleBar`, `AppShell` (sidebar por
   modo), `WorkspaceCenter`, `SkillsView`, `ChatView.welcome`, `App.tsx`, paleta e docs.
4. **Integração final**: Lead liga tudo, roda `pnpm test`/`pnpm typecheck`.
5. **verifier**: revisão independente contra o plano (incl. regra “sem Biblioteca no Code”, tokens
   do tema, a11y) e `pnpm typecheck`, `pnpm test`, `pnpm build`; registra `EVIDENCE.md`.
6. **Lead**: correções finais, `EVIDENCE.md` revisado e resumo ao usuário.

## 10. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Regressão no modo Chat (testes atuais de AppShell/TitleBar/Composer/Skills/paleta). | Defaults preservados; rodar a suíte inteira e ajustar só o necessário. |
| Duas instâncias de chat/composer (draft perdido ao trocar modo). | `ChatView` montado uma única vez no `WorkspaceCenter`; header/conteúdo só trocam ao redor. |
| Paleta abrir Biblioteca no Code. | Comandos de Biblioteca filtrados no Code; teste dedicado. |
| Sidebar do Code sem dados de workspace parecer “quebrada”. | Estado vazio com copy clara + futura integração; nada de botão morto. |
| Painel direito espremer a conversa. | Largura via `resolveSidePanelLayout` (≥480px de conversa); fecha abaixo de 1120px. |
| Token/hex solto ou borda assimétrica. | Revisão do verifier + checklist DESIGN §15. |
| Escopo crescer para o harness. | Fora de escopo explícito: sem backend Rust, sem leitura de arquivos/git. |
