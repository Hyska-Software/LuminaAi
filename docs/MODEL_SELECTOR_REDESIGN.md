# Seletor de modelos — plano de redesign (UI/UX)

> Status: **implementado e verificado** (2026-10-24). Documento de trabalho; o
> resultado final está incorporado em `docs/DESIGN.md` §7 e §8.

## 1. Objetivo e escopo

Refazer por completo o **seletor de modelos** do Lumina — o pill compacto do
composer (o titlebar não monta mais o pill) e o dialog completo ("Ver todos os
modelos…") — elevando
qualidade de UI/UX, consistência, acessibilidade e desempenho, **sem mudar o
fluxo de uso atual**:

1. pill em duas partes: modelo e modo de pensamento;
2. dropdown em duas etapas: escolher modelo → escolher modo de pensamento;
3. "Ver todos os modelos…" no rodapé abre o dialog avançado;
4. dialog: buscar, alternar provedor, ver detalhes, escolher modo de pensamento
   e confirmar com "Usar este modelo".

Decisões confirmadas com o usuário:

- **Escopo:** pill + dialog completo. Configurações › Modelo padrão fica como está.
- **Provedores:** o dropdown do pill passa a alternar Go/Zen (passo opcional;
  o fluxo principal continua igual).
- **Detalhes no pill:** bolha flutuante ao lado do popover, como uma tooltip —
  aparece no hover/teclado, não empurra o layout e mantém o seletor compacto.

Fora de escopo: backend, catálogo gerado, aba de Configurações, novos atalhos
globais, virtualização (o catálogo tem ≤ 82 modelos por provedor; a lista é
leve e agrupar/filtrar em memória é suficiente).

## 2. Diagnóstico do estado atual

Problemas encontrados na auditoria do código atual (`ModelPill.tsx`,
`ModelPickerDialog.tsx`, `modelMenu.ts`):

### Pill / dropdown

| # | Problema | Impacto |
| --- | --- | --- |
| 1 | Sem busca na lista (38 modelos no Go, 82 no Zen) | rolagem longa; difícil achar modelo |
| 2 | Largura do dropdown alterna (`w-64` ↔ `w-[35rem]`) conforme hover | salto de layout, sensação de instabilidade |
| 3 | Detalhes só em hover/focus de item; teclado não explora o painel | conteúdo inacessível/instável |
| 4 | Radix `DropdownMenu` (role=menu) usado como lista com busca/estado | semântica errada; impossível digitar para filtrar |
| 5 | Sem troca de provedor no pill | obriga abrir o dialog para usar Zen |
| 6 | Sem favoritar no dropdown | ação só existe no dialog |
| 7 | Rótulo "Sem controle" para modelos sem raciocínio | jargão e ruído visual |
| 8 | Sem estado vazio/limpar busca; sem dicas de teclado | usuário perdido |
| 9 | Itens do menu sem descrição do modo de pensamento | esforço sem significado |

### Dialog

| # | Problema | Impacto |
| --- | --- | --- |
| 10 | Grupos exibem a família crua ("DEFAULT") e ordenam "Outros" no topo | bug visível, hierarquia errada |
| 11 | Busca só no provedor ativo | usuário não acha modelo do outro provedor |
| 12 | Painel de detalhes cortado no rodapé (ThinkingSelector clipado) | bug de layout |
| 13 | Estado sincronizado no render (`wasOpen`) | frágil; reset implícito |
| 14 | Sem filtros (favoritos, visão, raciocínio, grátis) | 82 modelos sem recorte |
| 15 | Sem favoritar acessível por teclado; estrela sempre visível em todas as linhas | ruído |
| 16 | Contagem, dot e badge "Chave OK" redundantes no header | poluição |
| 17 | Sem dicas de teclado, duplo-clique/Enter, sem atalho para configurar chave | fluxo lento |
| 18 | Detalhe sem "conhecimento até"/status; labels/formatação inconsistentes (1.0M × 1M) | informação incompleta |
| 19 | Abrir/fechar re-monta sem reset limpo; foco inicial ambíguo | acessibilidade |

### Camada de dados/helpers

- `modelMenu.ts` só é usado pelo pill; duplica labels de protocolo/modalidade e
  detalhes; `buildModelMenu` não suporta busca, filtros, provedor ou
  disponibilidade.
- `formatContextWindow` arredonda mal (1048576 → "1.0M"), `formatPrice` mostra
  "grátis / grátis".
- `groupByFamily` ordena "default" alfabeticamente antes das famílias reais.

## 3. Direção de design

Mantém a linguagem do Lumina (`docs/DESIGN.md`): superfícies neutras, borda 1px,
sombras suaves, accent só em seleção/foco, movimento 150–260ms, pt-BR, tokens
apenas. O seletor deve parecer **parte do produto** — não um componente de
terceiros.

Princípios específicos:

- **Escolha rápida, profundidade sob demanda.** O pill resolve o caso comum em
  dois cliques; o dialog resolve o caso avançado (busca global, filtros,
  comparação de capacidades, provedor).
- **Nada se move sem motivo.** Larguras e alturas estáveis; detalhes aparecem
  sempre no mesmo lugar; listas não "pulam" ao filtrar.
- **Uma única gramática de interação.** Ambos os modos usam o mesmo padrão de
  combobox/listbox: buscar → navegar com setas → Enter confirma; Esc sai.
- **Densidade calma.** Linhas de 40–46px, separadores por grupo (não por linha),
  hierarquia por peso e cor de texto, não por caixas.
- **Estado sempre visível.** Selecionado (check), destacado (hover/teclado),
  favorito (estrela), indisponível (motivo), sem chave (aviso + atalho).

## 4. Fluxos preservados (e melhorados)

### 4.1 Pill — etapa 1 (modelos)

```
[avatar Modelo ▾] | [✦ Alto ▾]
        │
        ▼
┌──────────────────────────────┐      ╭──────────────────────────╮
│ [🔍 Buscar modelo…          ]│      │ GLM-5.3-Flash         ★  │
│ [Go ●][Zen ●]    38 modelos  │      │ OpenCode Go · glm…       │
├──────────────────────────────┤      │ [Visão][Raciocínio]      │
│ Favoritos                    │      │ GLM nativo…              │
│  ★ GLM-5.3-Flash        ✓    │ ←──→ │ Contexto          1M     │
│ Claude                       │      │ Saída máx.      131K     │
│  C Claude Haiku 5.5          │      │ Custo   $0.15/$0.50      │
│ DeepSeek                     │      │ Protocolo  OpenAI…       │
│  …                           │      │ [★ Favoritar]            │
│ ──────────────────────────   │      ╰──────────────────────────╯
│ ⚙ Ver todos os modelos…      │       bolha flutuante (hover/teclado)
└──────────────────────────────┘
```

- O popover é compacto (~22rem); a lista ocupa a largura toda.
- Os detalhes do modelo são uma **bolha flutuante** ao lado do popover
  (tooltip-like), alinhada à linha ativa: aparece no hover ou na navegação por
  teclado, some ao sair/fechar e nunca empurra o layout.
- Abre com foco na busca e o modelo atual destacado (sem bolha até interagir).
- Digitar filtra **os dois provedores** (os chips de provedor dão lugar ao
  rótulo "Go + Zen" enquanto há busca).
- ↑/↓ navega, Enter escolhe, Esc fecha.
- Clicar/Enter em um modelo aplica a seleção e **troca para a etapa 2** quando o
  modelo tem controle de raciocínio; senão fecha.
- "Ver todos os modelos…" no rodapé abre o dialog completo (fluxo atual).

### 4.2 Pill — etapa 2 (modo de pensamento)

O menu de pensamento é **compacto e dimensionado pelo conteúdo**: não herda a
largura de duas colunas da etapa de modelos. Largura ~15–19rem (`w-auto` com
`min-w`/`max-w`), altura automática limitada pela viewport; a lista só rola se o
modelo tiver muitas opções (esforços + orçamento).

```
┌──────────────────────────────────┐
│ ←  Modo de pensamento       ✦    │
│    GLM-5.3-Flash · sempre pensa  │
├──────────────────────────────────┤
│  Baixo   Rápido, para tarefas…   │
│  Alto    Mais tempo em problemas…│
│  Máximo ✓ Maior esforço…         │
├──────────────────────────────────┤
│ ↑↓ navegar · ↵ aplicar · Esc     │
└──────────────────────────────────┘
```

- Lista com rótulo **e descrição** de cada modo (off/esforço/orçamento).
- "Desligado" só aparece quando o modelo permite desligar; modelos
  *thinking-only* mostram a nota "Este modelo sempre pensa".
- Aplicar fecha o dropdown. O botão "←" volta para a lista de modelos sem fechar.
- O segmento ✦ do pill abre direto esta etapa (fluxo atual).

### 4.3 Dialog completo

```
┌───────────────────────────────────────────────────────────────────┐
│ Selecionar modelo                                            [×]  │
│ Busque por nome, família, identificador ou capacidade.            │
│ [🔍 Buscar modelos…                                           ]   │
│ [Favoritos][Visão][Raciocínio][Grátis]            38 modelos       │
├──────────────────────────────────────────────┬────────────────────┤
│ [Go ●] [Zen ●]                               │ GLM-5.3-Flash   ★  │
│ ──────────────────────────────────────────── │ OpenCode Go · id   │
│ CLAUDE                                       │ [Visão][Racioc.]   │
│  C Claude Haiku 5.5 … 1M · $0.10/$0.50   ★  │ Descrição…         │
│ DEEPSEEK                                     │ Contexto      1M   │
│  DS DeepSeek V4.1 Flash …                ✓  │ Saída máx.  131K   │
│  …                                           │ Custo  $0.15/$0.50 │
│ OUTROS                                       │ Protocolo  OpenAI  │
│  …                                           │ ┌────────────────┐ │
│                                              │ │ Modo de pensam.│ │
│                                              │ │ [Baixo|Alto|Max]│ │
│                                              │ └────────────────┘ │
├──────────────────────────────────────────────┴────────────────────┤
│ ↑↓ navegar · ↵ usar · duplo-clique usar   [Em uso] [Usar modelo]  │
└───────────────────────────────────────────────────────────────────┘
```

- 760×580px, `max-w/ max-h` para janelas pequenas (mín. da janela: 900×620).
- Busca **global** (Go + Zen); com busca ativa, os resultados são agrupados por
  provedor + família e a linha mostra o provedor.
- Filtros rápidos: Favoritos, Visão, Raciocínio, Grátis (`aria-pressed`).
- Abas de provedor com dot de chave + tooltip; contagem única no header.
- Clique = prévia no painel; duplo-clique/Enter/"Usar este modelo" = confirma.
- Setas navegam e atualizam a prévia; detalhes estáveis, rodapé fixo, sem corte.
- Chave ausente: aviso no painel + "Configurar" abre Configurações › Provedores.
- Indisponíveis aparecem desabilitados com motivo (tooltip/aria).
- Reset de estado a cada abertura (conteúdo remontado pelo Radix Dialog).

## 5. Arquitetura

### 5.1 Camada pura — `src/lib/modelMenu.ts` (contrato)

Uma única fonte de verdade para busca, agrupamento, filtros, opções de
pensamento, rótulos e detalhes. Sem JSX; 100% testável.

```ts
modelKey(providerId, modelId): string            // "opencode-go:glm-5.3-flash"
parseModelKey(key): { providerId, modelId } | null

familyLabel(family): string                      // 'default'/'' → 'Outros'
modelFilterOptions(): { value, label, title }[]  // favorites|vision|reasoning|free
modelMatchesFilters(model, filters, favorites): boolean
normalizeSearch(value): string                   // minúsculas, sem acentos
modelMatchesQuery(model, provider, query): boolean

interface ModelListEntry { providerId; providerName; model; favorite }
interface ModelListGroup { key; label; providerId; items }
buildModelGroups(providers, {
  providerId?, query?, filters?, favorites?, includeUnavailable?
}): ModelListGroup[]
flattenGroups(groups): ModelListEntry[]
firstSelectable(groups, preferredKey?): ModelListEntry | null

interface ThinkingOption { id; kind: 'off'|'effort'|'budget'; label; description; effort?; budget?; current }
thinkingOptions(model, selection): ThinkingOption[]
thinkingSelectionFor(option): ReasoningSelection
effortSegmentLabel(model, selection): string     // rótulo curto do pill
thinkingHeadline(model, selection): string       // resumo na etapa 2
reasoningForModel(model, previous): ReasoningSelection | null

interface ModelDetail { id; name; providerName; description; badges; lines; statusNote }
modelDetails(model, providerName?): ModelDetail | null
keyStatusFor(keys, providerId): ProviderKeyStatus | undefined
keyStatusLabel(key?): string
```

Ajustes em `src/lib/catalog.ts` (contrato do Lead, uso compartilhado):
`formatContextWindow` (1048576 → "1M"), `formatPrice` (0/0 → "Grátis") e
`groupByFamily` passa a aceitar rótulo/ordem de "Outros" no fim — mantendo a
assinatura pública atual.

### 5.2 Primitivo de UI — `src/components/ui/popover.tsx`

Wrapper Radix Popover no mesmo padrão de `dropdown-menu.tsx`/`dialog.tsx`:
`Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverContent` (z-65, borda,
`bg-surface-raised`, `shadow-xl`, animação 150–180ms, `motion-reduce`), exportado
em `src/components/ui/index.ts`.

### 5.3 Componentes compartilhados — `src/components/models/`

| Arquivo | Responsabilidade |
| --- | --- |
| `ModelSearchField.tsx` | input de busca com ícone, limpar, `role=combobox`, ARIA de listbox |
| `ModelRow.tsx` | linha (avatar, nome, badges, meta, check, estrela) compact/dialog |
| `ModelList.tsx` | grupos, headers sticky, listbox, estado vazio, scroll |
| `ModelDetailPanel.tsx` | cabeçalho, badges, descrição, especificações, avisos, favoritar, slot de pensamento/rodapé |
| `ThinkingOptions.tsx` | listbox de modos de pensamento com descrições, teclado, voltar |
| `ModelPill.tsx` | trigger + Popover em duas etapas (reescrito) |
| `ModelPickerDialog.tsx` | dialog completo (reescrito) |
| `index.ts` | superfície pública (inalterada para consumidores externos) |

Contratos principais:

```ts
ModelRow:        { entry, id, active, selected, disabled?, variant?, showProvider?,
                   onActivate, onPick, onCommit?, onFavoriteToggle? }
ModelList:       { groups, listId, ariaLabel, activeKey, selectedKey, favorites,
                   onActivate, onPick, onCommit?, onFavoriteToggle, variant?,
                   showProvider?, emptyState?, className? }
ModelDetailPanel:{ entry, favorite, onFavoriteToggle, variant?,
                   reasoning?, onReasoningChange?, keyStatus?, onConfigureProvider?,
                   footer?, className? }
ThinkingOptions: { model, value, activeId, onActiveChange, onSelect, listId, onBack }
```

### 5.4 Consumidores inalterados

`Composer` continua usando `<ModelPill onClick={() => setModelPickerOpen(true)} />`
e `CommandPalette`/`App` seguem abrindo o dialog completo. O `TitleBar` deixou de
montar o pill (o seletor de modelo e pensamento vive só no composer). Nenhuma
mudança de store/IPC é necessária.

## 6. Acessibilidade

- Combobox + listbox com `aria-activedescendant`, `aria-expanded`,
  `aria-controls`, `aria-autocomplete="list"`; opções com `role="option"`,
  `aria-selected` (selecionado) e `aria-disabled` (indisponível).
- Grupos com `role="group"` + `aria-label`; cabeçalhos `aria-hidden`.
- Favoritar: `aria-pressed` + `aria-label` completo; estrela da linha fora da
  ordem de tabulação (`tabIndex=-1`), com alternativa por teclado no painel de
  detalhes.
- Popover: `role="dialog"` + `aria-label`; foco inicial na busca; Esc fecha e
  devolve o foco ao trigger; Tab não fica preso.
- Dialog: Radix Dialog (título/descrição, focus trap, restauração de foco),
  `autoFocus` na busca; Esc limpa a busca antes de fechar.
- Modos de pensamento: `role="listbox"`/`option` com descrição ligada via
  `aria-describedby`; setas/Home/End/Enter.
- Alvos ≥ 32px, foco visível (anel `accent`), contraste AA, texto em pt-BR.
- `prefers-reduced-motion`/`reduceMotion`: sem transformações; apenas fade.

## 7. Estados e microcopy

| Estado | Pill | Dialog |
| --- | --- | --- |
| Vazio (sem resultados) | "Nenhum modelo encontrado" + "Limpar busca" | idem + "Limpar filtros" |
| Sem raciocínio | segmento ✦ desabilitado "Padrão" (tooltip) | "Este modelo não expõe controle de raciocínio" |
| Thinking-only | nota "Este modelo sempre pensa" | idem |
| Sem chave | — | aviso warning + "Configurar" |
| Indisponível | oculto | linha desabilitada + motivo |
| Em uso | check na linha | badge "Em uso" + CTA desabilitado? não: CTA ativo (idempotente) |
| Preview | — | badge "Prévia" no painel? não: seleção visual na linha |

Microcopy nova: "Buscar modelos…", "Limpar busca", "Filtros", "Todos os
provedores", "Pensamento", "Usar este modelo", "Configurar", "Chave ausente",
"Este modelo sempre pensa", "Nenhum modelo encontrado".

## 8. Plano de testes (TDD)

- `src/lib/__tests__/modelMenu.test.ts` (reescrito): chaves, busca sem acentos
  multi-token, filtros, grupos (favoritos primeiro, "Outros" no fim), busca
  global por provedor, opções de pensamento (off/esforço/orçamento/thinking-only),
  `reasoningForModel`, detalhes e status.
- `src/lib/__tests__/catalog.test.ts`: formatação corrigida.
- `src/components/models/ModelPill.test.tsx` (reescrito): estado fechado, busca,
  provedor, detalhes estáveis, duas etapas, voltar, atalho do pensamento,
  favoritar, "Ver todos os modelos…", teclado, modelo sem raciocínio.
- `src/components/models/ModelPickerDialog.test.tsx` (novo): abertura/reset,
  busca global, filtros, abas de provedor, prévia, commit por botão/duplo-clique/
  Enter, indisponível, aviso de chave, Esc.
- `*.edge.test.tsx` (verificação independente): nomes longos, catálogo grande,
  buscas hostis, fluxo só-teclado, grupos vazios.

## 9. Divisão de trabalho (escopos disjuntos)

| Dono | Arquivos |
| --- | --- |
| Lead | `src/lib/modelMenu.ts`, `src/lib/catalog.ts`, testes de `src/lib`, `src/components/models/{ModelSearchField,ModelRow,ModelList,ModelDetailPanel,ThinkingOptions}.tsx`, `src/components/ui/popover.tsx`, `src/components/ui/index.ts`, `docs/**` |
| ui-pill | `src/components/models/ModelPill.tsx`, `ModelPill.test.tsx` |
| ui-dialog | `src/components/models/ModelPickerDialog.tsx`, `ModelPickerDialog.test.tsx` |
| verifier | novos `src/components/models/*.edge.test.tsx`; revisão sem editar produção |

Dependências: ui-pill/ui-dialog dependem dos helpers + componentes
compartilhados; verifier depende dos dois. Integração, docs e verificação final
são do Lead.

## 10. Critérios de aceite

- Fluxo atual preservado (pill em duas etapas, "Ver todos os modelos…", dialog
  com confirmação).
- `pnpm typecheck` e `pnpm test` verdes; `pnpm build` verde.
- Nenhum `any` implícito, nenhum hex solto, nenhum `@ts-ignore`.
- ARIA/teclado conforme §6; nenhuma regressão em Configurações (que reusa
  `CapabilityBadges`/`ThinkingSelector`).
- Detector mecânico do Impeccable rodado uma vez ao final, sem achados
  bloqueantes.
- `docs/DESIGN.md` §7/§8/§11/§12 atualizados com o novo seletor.

## 11. Resultado da implementação

- **Camada pura** (`src/lib/modelMenu.ts`): chaves provider:modelo, busca global
  normalizada multi-token, filtros, agrupamento (favoritos → famílias, "Outros"
  no fim), opções de pensamento com descrições, detalhes/status e chave de
  provedor.
- **Componentes compartilhados**: `ModelSearchField`, `ModelRow`, `ModelList`,
  `ModelDetailPanel`, `ThinkingOptions` + primitivo `ui/popover.tsx` (com escape
  de Tab corrigido: o FocusScope do Radix não prende mais o foco).
- **Pill**: popover compacto (22rem) em duas etapas, busca global, troca Go/Zen,
  favoritos e **bolha flutuante de detalhes** (hover/teclado, tolerância 120ms);
  etapa de pensamento compacta (15–19rem), dimensionada pelo conteúdo.
- **Dialog**: 760×580, busca global, filtros de capacidade, abas de provedor com
  tabpanel, prévia sincronizada com o destaque (Enter e CTA concordam), chave
  ausente com atalho para Configurações, dicas de teclado e reset por abertura.
- **Correções pós-revisão independente**: Tab preso (A1), destaque≠prévia no
  dialog (A2), orçamento só-budget exibido≠enviado (B1), tabs sem tabpanel (B2)
  e ajustes de acessibilidade/alvos (C1–C8).
- **Verificação final**: `pnpm typecheck`, `pnpm test` (204 testes, 9 arquivos),
  `pnpm build` e detector mecânico do Impeccable (`[]`, sem achados).
  Posicionamento da bolha é validado visualmente em `pnpm app:dev` (jsdom não
  tem layout).

## 12. Bloqueio de modelo (requisito posterior)

Depois do primeiro envio o modelo da conversa fica travado: trocar no meio
misturaria respostas de modelos diferentes e invalidaria o replay de
`provider_state`. O modo de pensamento continua ajustável (mesmo modelo).

Contrato:
- `selectModelLocked(state)` (`src/lib/store/chatStore.ts`): bloqueado com
  streaming ativo ou quando a conversa ativa tem mensagens / `messageCount > 0`.
- `useAppStore.setActiveSelection(selection)`: alinha a seleção à conversa sem
  alterar os padrões persistidos (usado ao abrir conversa e no "Novo chat").
- Ao abrir uma conversa iniciada, a seleção é sincronizada com o
  `conversation.providerId/modelId` (o backend já mantém esse par atualizado a
  cada turno).
- Defesa em profundidade: `send`/`regenerate` no `chatStore` usam o modelo da
  conversa quando ela está bloqueada, mesmo que alguma superfície altere a
  seleção global.
- "Novo chat" deixando uma conversa iniciada volta ao modelo padrão configurado.

Superfícies:
- `ModelPill`: segmento do modelo com cadeado (`aria-disabled`, não `disabled`),
  clique explica e não abre; ✦ segue funcional.
- `ModelPickerDialog`: estado compacto "Modelo bloqueado nesta conversa" com o
  modelo em uso, sem lista/CTA.
- Command palette: "Trocar modelo" vira ação explicativa quando bloqueado.
- Configurações › Modelo padrão: altera apenas os padrões (novas conversas),
  nunca a conversa em andamento.

