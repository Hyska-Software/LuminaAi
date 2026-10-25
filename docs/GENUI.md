# Lumina — UI generativa (interfaces que o agente cria no chat)

> Documento normativo do sistema de **UI generativa/interativa** do Lumina.
> Fonte única de verdade em código: **`data/genui-contract.json`** (componentes,
> props, limites, ícones, regras de design e semântica das ações). Este doc
> explica o contrato em linguagem de produto; se os dois divergirem, o contrato
> vence e o doc precisa ser corrigido (`pnpm test` valida os exemplos daqui).
>
> Consumidores do contrato: **system prompt** (`src-tauri/src/harness/prompt.rs`),
> **validador/ferramenta do agente** (`src-tauri/src/tools/genui`), **renderer**
> (`src/lib/genui`, `src/components/genui`) e **fixtures de paridade**
> (`data/genui-fixtures.json`).

## 1. O que é

Durante um turno, o agente pode emitir blocos cercados com a linguagem `ui`
contendo **um objeto JSON declarativo**. A interface valida/normaliza o JSON e
desenha somente componentes da whitelist — **nunca** `eval`, HTML ou JS
arbitrário. É a forma de o agente entregar dados estruturados (métricas,
comparações, tabelas, etapas) e **próximos passos clicáveis** (`actions`), em vez
de despejar tudo em Markdown.

````markdown
```ui
{
  "version": 2,
  "components": [
    { "type": "card", "props": { "title": "Receita do trimestre" }, "children": [
      { "type": "stat", "props": { "label": "Receita", "value": "R$ 12,4 mi", "trend": "up" } },
      { "type": "actions", "props": { "items": [
        { "label": "Comparar com o trimestre anterior", "prompt": "Compare a receita deste trimestre com a anterior.", "tone": "primary" }
      ]}}
    ]}
  ]
}
```
````

O bloco é renderizado inline no fluxo da mensagem, com espaço próprio
(`my-3`), sem “card dentro de card” visual e com a mesma tipografia do chat.

## 2. Princípios de design

1. **Conteúdo primeiro**: a interface serve ao dado; sem moldura supérflua.
   Um `card` raiz com `title`; nada de UI decorativa.
2. **Uma ideia por bloco**: 1 bloco `ui` por resposta é o padrão; 2 é o máximo.
   Texto corrido continua em Markdown — UI generativa é para o que é
   estruturado, comparável ou acionável.
3. **Sem duplicação**: não repita no Markdown o que já está no bloco (e
   vice-versa).
4. **Tokens do design system**: o agente **não escolhe cores, fontes, raios ou
   sombras**. O renderer usa `bg-surface-raised`, `text-foreground-muted`,
   `border-border`, `accent`, etc. Props de estilo não existem no contrato.
5. **Compacto e escaneável**: hierarquia clara (título → métricas → detalhe),
   densidade controlada, números tabulares, rótulos curtos.
6. **Interativo, mas seguro**: botões apenas **sugerem** (preenchem o composer)
   ou **copiam**. Nenhuma ação envia mensagem sozinha, executa comando ou muda
   estado do app.
7. **Acessível por construção**: `image.alt`, rótulos de `tabs`/`actions`/`link`
   são obrigatórios e verificados pelo validador; foco visível e teclado são do
   design system.
8. **Degradação graciosa**: JSON inválido ou componente fora da whitelist →
   o bloco vira código com o diagnóstico exato; o resto da resposta continua
   legível.
9. **pt-BR**: títulos, rótulos e microcopy em português do Brasil, sentence
   case, sem exclamações, sem emojis decorativos.
10. **Determinismo**: o mesmo JSON produz a mesma árvore normalizada nos dois
    lados (Rust e TypeScript) — garantido pelos fixtures de paridade.
11. **Sem caixas de nota coloridas**: `callout` está **descontinuado** para
    novas respostas (regra `ui.callout-style`). Notas, ressalvas e lembretes
    são texto normal ou citação em Markdown; `callout` só aparece em mensagens
    antigas (compatibilidade de renderização).

## 3. Quando usar (e quando não usar)

| Situação | Use |
| --- | --- |
| Comparar métricas/indicadores | `card` + `grid` de `stat` (+ `chart`) |
| Série numérica (mês a mês, categorias) | `chart` `bar`/`line`/`pie` |
| Dados tabulares curtos | `table` (até 8 colunas) |
| Cronograma/etapas | `timeline` ou `steps` |
| Especificações curtas | `keyvalue` |
| Feed de notícias/cards com imagem, status e fonte | `section` + `stack` row + `image` (`size: thumb`) + `source` |
| Nota/ressalva/lembrete no meio de um resultado | **Markdown normal** (texto ou `>` citação) — nunca `callout` |
| Configuração/formulário de escolhas | `choices` (rádio/checkbox/segmentado + envio) |
| Próximos passos concretos | `actions` (1–4 botões) |
| Detalhe que pode ficar recolhido | `reveal` |
| Alternar visões do mesmo assunto | `tabs` (2–4 abas) |
| Texto corrido, explicação, lista simples, código | **Markdown normal** |
| Entrega longa (documento, CSV, HTML) | ferramenta `create_file` (artefato) |
| Pergunta simples do usuário | só texto (sem UI) |

## 4. Estrutura e gramática de layout

- Raiz: `{ "version"?: 2, "components": [...] }`. Um array cru de componentes
  também é aceito e normalizado. `version` ausente é válido.
- Cada componente: `{ "type": string, "props"?: objeto, "children"?: array }`.
- `children` **só** em containers: `card`, `stack`, `grid`, `tabs`, `reveal`,
  `section` (e no legado descontinuado `callout`).
- Profundidade máxima: **8** níveis (recomendado ≤ 6); máximo de **120**
  componentes por bloco (recomendado ≤ 60).
- Hierarquia recomendada: **1 `card` raiz** (título curto) → `grid` de
  `stat`/`chart`/`table` → `actions` no fim. Notas/ressalvas vão em Markdown,
  fora do bloco (nunca em caixa colorida).
- `grid`: escolha `columns` e preencha as linhas (2/4 filhos para 2 colunas;
  3 filhos para 3 colunas). Máximo 4 colunas.
- `tabs`: cada painel é um componente (normalmente `stack`) com `props.label`
  curto (≤ 40 recomendado; limite rígido 80). 2–4 abas com objetivos distintos.
- Sem containers vazios; sem `divider` em excesso (máx. 2); sem cards
  aninhados.

## 5. Catálogo de componentes

Os limites por componente combinam um **teto rígido** (excedeu → truncamento
com aviso `ui.text-truncated`) e, quando existe regra correspondente em §6, um
**limite recomendado** que gera aviso de design. Props desconhecidas são
descartadas com aviso — use exatamente estes nomes.

### 5.1 Layout (containers)

| Tipo | Props | Notas |
| --- | --- | --- |
| `card` | `title?` (≤ 80), `subtitle?` (≤ 160), `footer?` (≤ 120), `variant?` (`default\|accent\|muted`), `icon?` | Agrupa uma unidade. Todo card de topo precisa de `title`. Nunca aninhe card em card. |
| `stack` | `direction?` (`column\|row`), `gap?` (`none\|sm\|md\|lg`), `align?` (`start\|center\|end\|stretch`), `justify?` (`start\|center\|between\|end`), `wrap?` | Empilha/alinhа filhos. Use `direction: row` para miniatura + conteúdo. |
| `grid` | `columns?` (1–4, padrão 2), `gap?` | Métricas/cartões lado a lado. Preencha as colunas. |
| `tabs` | — (children = painéis) | Cada painel precisa de `props.label` curto. 2–4 abas (máx. 6). |
| `reveal` | `title` (obrigatório), `open?` | Seção recolhível para metodologia/detalhe. |
| `section` | `title?` (≤ 100), `eyebrow?` (≤ 40), `description?` (≤ 200), `icon?`, `divider?` | Cabeçalho de seção + conteúdo, **sem** moldura de card. Use para feeds, listas temáticas e blocos numerados. |
| `divider` | `label?` (≤ 40) | Máx. 2 por bloco. |

### 5.2 Dados

| Tipo | Props | Notas |
| --- | --- | --- |
| `table` | `columns` (2–10), `rows` (1–200), `caption?` | Cada linha com o mesmo nº de colunas. Até 8 colunas recomendadas. Para muitas linhas, entregue um CSV via `create_file`. |
| `chart` | `type` (`bar\|line\|pie`), `data` (2–60 `{label, value}`), `title?`, `suffix?` | Título recomendado (métrica + unidade). Pizza ≤ 7 fatias. Valor único vai em `stat`. |
| `stat` | `label` (≤ 32), `value` (≤ 20), `trend?` (`up\|down\|flat`), `hint?` (≤ 100) | Números tabulares; `hint` para a variação. |
| `progress` | `value` (0–`max`), `max?` (padrão 100), `label?`, `suffix?` | Fração concluída. |
| `timeline` | `items` (2–20 `{title, time?, description?, status?}`) | Status `done\|active\|pending\|error`; máx. 12 itens. |
| `steps` | `items` (2–16 `{title, description?}`), `current?` | `current` é 1-based (0 = nenhum). Máx. 10 passos. |
| `checklist` | `items` (1–20 `{label, description?, status?, icon?}`) | Status `done\|active\|pending\|disabled\|error` com ícone + texto acessível. Ideal para simulações e capacidades. |
| `keyvalue` | `items` (1–20 `{label, value}`) | Pares curtos; > 12 use `table`. |
| `list` | `items` (1–40 strings ou `{text, description?, href?, icon?, status?}`), `ordered?` | Com `href` vira link externo; máx. 20 itens. |

### 5.3 Conteúdo

| Tipo | Props | Notas |
| --- | --- | --- |
| `callout` | `variant?` (`info\|warning\|success\|danger`), `title?`, `text?` | **Descontinuado — não emitir.** Caixa colorida de nota; só renderiza mensagens antigas (regra `ui.callout-style`). |
| `code` | `code`, `language?`, `title?` | Trecho curto; arquivos longos viram artefato. |
| `quote` | `text` (≤ 600), `cite?` | Citação curta com atribuição. |
| `text` | `text` (obrigatório, ≤ 1200), `variant?` (`body\|muted\|lead\|strong\|small`) | Parágrafo de texto puro (Markdown não é renderizado dentro de props). |
| `badge` | `label` (≤ 24), `tone?`, `icon?` | Status/etiqueta curta. |
| `image` | `src`, `alt` (obrigatório), `caption?`, `size?` (`full\|thumb\|avatar`), `aspect?` (`auto\|video\|square\|wide`) | `http(s)` ou `data:image/...`; em `stack` row use `size: thumb`. |
| `source` | `label` (≤ 80), `href` (http(s)), `title?` (≤ 120) | Chip de fonte/link externo (nome do site); abre no navegador padrão. |
| `link` | `href`, `label` | Abre no navegador padrão. |

### 5.4 Interação

| Tipo | Props | Notas |
| --- | --- | --- |
| `actions` | `items` (1–4 `{label, prompt? **ou** copy?, tone? (`primary\|secondary\|ghost`), icon?}`), `align?` (`start\|end`) | Cada ação tem **exatamente um** de `prompt` ou `copy`. No máximo uma `primary`. Rótulo = verbo + objeto curto, sem ponto final. |
| `choices` | `options` (2–12 `{label, description?, icon?}`), `mode?` (`single\|multiple`), `layout?` (`list\|segmented`), `label?` (≤ 80), `default?` (labels), `countLabel?` (≤ 60), `submitLabel?` (≤ 40), `submitPrefix?` (≤ 300) | Formulário de seleção com estado local (rádio, checkbox ou segmentado). Com `countLabel` mostra contador + barra de progresso sincronizados. O botão `submitLabel` preenche o composer com `submitPrefix + seleção` — nunca envia sozinho. |

Semântica:

- `prompt`: **preenche o composer** com o texto (evento `lumina:suggest`) para
  o usuário revisar e enviar. Nunca envia sozinho; substitui o rascunho atual do
  composer, como as sugestões da tela inicial.
- `copy`: copia o texto para a área de transferência (toast discreto).
- `choices`: a seleção é **local**; o envio monta
  `submitPrefix + labels.join(', ')` e também preenche o composer (o usuário
  revisa e envia). Toda `choices` precisa de `submitLabel` (regra
  `ui.choices-submit`). Não há inputs de texto livres dentro da interface — o
  composer continua sendo o único campo de texto.
- `actions` deve encerrar a resposta com próximos passos reais (ex.: “Comparar
  cenários”, “Gerar plano de margem”); não use quando não há próximo passo.
- `icon?` (em `actions`, `choices`, `checklist`, `section`, `badge`, `card` e
  `list`) aceita somente a whitelist do contrato (25 nomes): `arrow-right`,
  `atom`, `book-open`, `calendar`, `check`, `chevron-right`, `clock`, `copy`,
  `database`, `download`, `external-link`, `file-text`, `flame`, `globe`,
  `layers`, `lightbulb`, `list-checks`, `plus`, `refresh-cw`, `search`,
  `settings`, `shield-check`, `sparkles`, `target`, `wrench`. Ícone fora da
  lista é omitido com aviso `ui.icon-unknown`.

## 6. Regras de UI/UX (lint de design)

Todas geram **aviso** (`warning`) com `code`, `path` e `hint` — não bloqueiam a
renderização, mas o agente deve corrigi-las antes de emitir (a ferramenta
`validate_ui` as devolve). Fonte: `data/genui-contract.json → rules`.

### 6.1 Estrutura

| ID | Regra |
| --- | --- |
| `ui.root-count` | No máximo 4 componentes na raiz; agrupe em 1 `card`/`stack`. |
| `ui.card-title` | Todo `card` de topo precisa de `title`. |
| `ui.card-nested` | Nunca aninhe `card` dentro de `card` (use `stack`/`divider`). |
| `ui.cards-count` | No máximo 4 cards por bloco. |
| `ui.grid-orphans` | Filhos do `grid` devem completar as colunas. |
| `ui.grid-crowded` | No máximo 3 filhos por coluna. |
| `ui.divider-count` | No máximo 2 divisores. |
| `ui.empty-container` | Nada de containers vazios. |
| `ui.callout-style` | **Nunca emita `callout`** (caixa colorida de nota): ressalvas vão em Markdown; status em `badge`. |
| `ui.section-header` | Toda `section` precisa de `title` ou `eyebrow`. |

> Máximo de blocos: a orientação de 1 bloco (máx. 2) por resposta vem de
> `blocks.maxPerMessage` no contrato e é reforçada no system prompt — não é uma
> regra de lint por bloco (o renderer vê um bloco por vez). Em desenvolvimento, o
> harness loga quando o limite é excedido.

### 6.2 Dados

| ID | Regra |
| --- | --- |
| `ui.chart-title` | Todo gráfico precisa de `title` com métrica e unidade. |
| `ui.chart-points-min` | Mínimo de 2 pontos; valor único → `stat`. |
| `ui.chart-pie-slices` | Pizza: no máximo 7 fatias (agrupe o resto em “Outros”). |
| `ui.table-columns` | No máximo 8 colunas visíveis. |
| `ui.table-arity` | Toda linha com o mesmo número de células das colunas. |
| `ui.stat-long` | `label` ≤ 32, `value` ≤ 20, `hint` ≤ 100. |
| `ui.list-long` | No máximo 20 itens; acima disso, divida ou use `table`. |
| `ui.timeline-long` | No máximo 12 eventos. |
| `ui.steps-long` | No máximo 10 passos. |
| `ui.keyvalue-long` | No máximo 12 pares. |
| `ui.tabs-count` | No máximo 6 abas (ideal 2–4). |
| `ui.density` | No máximo ~60 componentes e 6 níveis por bloco. |

### 6.3 Copy (pt-BR)

| ID | Regra |
| --- | --- |
| `ui.markdown-in-props` | Props são texto puro: nada de `**negrito**`, `# título`, crases ou links Markdown dentro do bloco. |
| `ui.emoji` | Sem emojis decorativos em títulos/rótulos. |
| `ui.label-period` | Rótulos e botões sem ponto final. |
| `ui.shouting` | Sem CAIXA ALTA em rótulos. |

### 6.4 Interação

| ID | Regra |
| --- | --- |
| `ui.action-primary` | No máximo uma ação `primary`. |
| `ui.action-label-long` | Rótulo de ação ≤ 40 caracteres (verbo + objeto). |
| `ui.duplicate-action` | Ações com rótulos distintos. |
| `ui.choices-submit` | Toda `choices` precisa de `submitLabel` (seleção interativa tem que ter envio). |

## 7. Acessibilidade (regras obrigatórias)

- `image.src` + `image.alt` obrigatórios (texto alternativo descritivo).
- Cada painel de `tabs` precisa de `props.label`.
- `actions[*].label` e `link.label` obrigatórios.
- Contraste, foco visível, alvos ≥ 32px, teclado e `prefers-reduced-motion` são
  responsabilidade do renderer/design system — a interface não expõe props de
  estilo justamente para não quebrar isso.
- Nunca use cor como único indicador de significado; use `badge` com texto
  (ou o próprio texto em Markdown).
- O renderer marca grupos de ações com `role="group"` e rótulo acessível;
  `choices` usa `radiogroup`/`group` com `aria-checked` por opção e painel
  segmentado com foco visível; `checklist` anuncia o status por texto
  (`sr-only`) além do ícone; gráficos têm `<title>`/`aria-label`; imagens sem
  `alt` são recusadas pelo validador.
- `source` e itens de `list` com `href` são botões com `aria-label`
  (“Abrir <site> em nova aba”) e nunca navegam dentro do webview.

## 8. Limites: rígidos × recomendados

| Item | Rígido (erro → bloco degrada) | Recomendado (aviso → lint) |
| --- | --- | --- |
| Fonte do bloco | 200.000 chars | — |
| Componentes | 120 | 60 (`ui.density`) |
| Profundidade | 8 | 6 (`ui.density`) |
| Texto por prop | `maxChars` da prop (ex.: `quote.text` 1.000) | limites de §6 |
| Arrays | `maxItems` da prop (ex.: `list.items` 40) | limites de §6 |
| `table.columns` | 2–10 | 8 (`ui.table-columns`) |
| `chart.data` | 1–60 pontos | 2+ (`ui.chart-points-min`), pizza ≤ 7 |
| `actions.items` | 1–4 | uma `primary`, rótulo ≤ 40 |
| `choices.options` | 2–12 | `submitLabel` obrigatório (`ui.choices-submit`) |
| `checklist.items` | 1–20 | status padronizados |
| `text.text` | 1.200 chars | evite parágrafos longos dentro da UI |
| `tabs` (rótulo do painel) | 80 chars | 40 (`props.label` curto) |
| Props desconhecidas | descartadas | aviso `ui.unknown-prop` |
| JSON inválido | erro `ui.invalid-json` | — |

Texto acima do limite rígido é **truncado** com aviso (`ui.text-truncated`);
valores numéricos fora do intervalo são **ajustados** (`ui.clamped`); formas
legadas são **normalizadas** (`ui.legacy-shape`). O bloco só degrada quando há
**erro** — avisos renderizam com a árvore normalizada.

## 9. Diagnósticos

### 9.1 Erros (bloco degrada para código)

| Código | Causa típica |
| --- | --- |
| `ui.invalid-json` | JSON malformado/vazio, vírgula sobrando, comentário. |
| `ui.source-too-large` | Bloco maior que 200.000 caracteres. |
| `ui.invalid-root` | Raiz sem `components` (array). |
| `ui.empty` | `components: []`. |
| `ui.invalid-component` | Item da lista não é objeto. |
| `ui.missing-type` | Componente sem `type` string. |
| `ui.unknown-type` | Tipo fora da whitelist (ex.: `iframe`). |
| `ui.invalid-props` | `props` não é objeto. |
| `ui.invalid-children` | `children` não é lista. |
| `ui.children-not-allowed` | `children` em componente folha. |
| `ui.missing-prop` | Prop obrigatória ausente/vazia. |
| `ui.prop-type` | Tipo/valor inválido (ex.: `enum` desconhecido sem default). |
| `ui.invalid-url` | URL fora de `http(s)`/`data:image/...`. |
| `ui.array-size` | Array abaixo do mínimo (ex.: `table.columns` com 1). |
| `ui.too-deep` / `ui.too-many-nodes` | Limites de §8. |
| `ui.action-invalid` | Ação sem exatamente um de `prompt`/`copy`. |
| `ui.tabs-empty` / `ui.tabs-label` | `tabs` sem painéis ou painel sem `label`. |

### 9.2 Avisos (renderiza normalizado)

`ui.version-mismatch`, `ui.unknown-prop`, `ui.coerced`,
`ui.enum-default`, `ui.text-truncated`, `ui.array-truncated`, `ui.clamped`,
`ui.icon-unknown`, `ui.legacy-shape` + todos os `ui.*` de §6.

## 10. Como a criação correta é garantida

1. **Contrato único** (`data/genui-contract.json`): prompt, validador Rust,
   renderer TS e fixtures leem o mesmo arquivo. Não existe lista de tipos ou
   regra duplicada à mão.
2. **Prompt gerado do contrato**: o system prompt monta o catálogo, as regras e
   os limites a partir do JSON — impossível o prompt documentar algo que o
   validador recusa (teste em `prompt.rs` verifica cada tipo e cada regra).
3. **Autovalidação durante a execução** — ferramenta `validate_ui(block)`: o
   agente envia o JSON candidato e recebe `{ ok, errors, warnings, normalized }`
   com `code`, `path`, mensagem e dica. O fluxo é rascunhar → validar → corrigir
   → emitir: o bloco só deve ser emitido depois de `ok: true`. A orientação do
   prompt é usar **idealmente até 2 validações** por resposta — não há contador
   imposto pelo harness. O campo `normalized` pode ser usado como JSON final.
4. **Normalização determinística antes da validação**: coerções seguras e
   formas legadas são resolvidas igualmente nos dois lados, então um bloco
   aceitável não degrada por detalhe cosmético.
5. **Validação dupla**: o **renderer revalida tudo** antes de desenhar — essa é
   a garantia do usuário: JSON inválido vira código + diagnóstico visível, nunca
   uma tela quebrada. Em builds de desenvolvimento o harness também loga os
   diagnósticos do texto final no stderr (em release esse log não existe e a
   mensagem não é bloqueada nem alterada).
6. **Paridade Rust↔TS por fixtures** (`data/genui-fixtures.json`): o mesmo
   corpus roda em `cargo test` e `pnpm test`. Para **todos os casos válidos** a
   árvore normalizada inteira é comparada (deep equal) além dos códigos de
   erro/aviso (multiconjunto, repetições contam); casos com erro comparam os
   códigos e garantem que nenhum spec é produzido. `path`/mensagens individuais
   não são comparados. Qualquer divergência falha o CI.
7. **Testes de interface**: renderer jsdom cobre render dos componentes, ações
   (`prompt`/`copy`), degradação e contratos de acessibilidade (grupo de ações,
   `aria-current` de `steps`, status textual de `timeline`); exemplos do
   prompt/`docs/GENUI.md` são validados por teste (se um exemplo do doc ficar
   inválido, o teste falha).
8. **Feedback no desenvolvimento**: o renderer **não** mostra avisos de design na
   interface — em DEV eles vão apenas para o **console do DevTools** (com
   `code`/`path`/mensagem), e o usuário vê a árvore normalizada. O harness loga
   blocos inválidos em `debug_assertions`. Em produção vale a validação do
   renderer descrita no item 5.
9. **Acessibilidade estrutural**: `alt`, `label` e `title` obrigatórios são
   erros do validador, não recomendações.

## 11. Checklist do agente antes de emitir

- [ ] A UI é realmente melhor que Markdown? (dados estruturados/acionáveis)
- [ ] 1 bloco (no máximo 2), sem repetir o texto do Markdown.
- [ ] Raiz com **um** `card`/`stack`; `card` de topo com `title`; sem card
      aninhado, sem container vazio.
- [ ] `grid` com colunas preenchidas; `table` com linhas alinhadas.
- [ ] `chart` com `title` e unidade (`suffix`), ≥ 2 pontos.
- [ ] `actions` no máximo 4, rótulos verbo + objeto, uma `primary`, terminando a
      resposta com próximos passos reais.
- [ ] Textos curtos e em pt-BR; sem Markdown/HTML dentro de props; sem emojis
      decorativos; sem ponto final em rótulos.
- [ ] Todos os textos cabem nos limites recomendados (§6).
- [ ] URLs `http(s)`; `image` com `alt`.
- [ ] JSON sem comentários/vírgula sobrando; validado com `validate_ui` e
      emitido só depois de `ok: true` (idealmente até 2 validações por resposta).

## 12. Exemplos

### 12.1 Bom — métricas + gráfico + próximos passos

```ui
{
  "version": 2,
  "components": [
    {
      "type": "card",
      "props": { "title": "Receita do trimestre", "subtitle": "Consolidado por mês" },
      "children": [
        {
          "type": "grid",
          "props": { "columns": 2 },
          "children": [
            { "type": "stat", "props": { "label": "Receita", "value": "R$ 12,4 mi", "trend": "up", "hint": "+12% vs. trimestre anterior" } },
            { "type": "stat", "props": { "label": "Churn", "value": "3,1%", "trend": "down", "hint": "Menor valor em 12 meses" } }
          ]
        },
        {
          "type": "chart",
          "props": {
            "type": "bar",
            "title": "Receita mensal (R$ milhões)",
            "suffix": " mi",
            "data": [
              { "label": "Jul", "value": 3.8 },
              { "label": "Ago", "value": 4.1 },
              { "label": "Set", "value": 4.5 }
            ]
          }
        },
        { "type": "quote", "props": { "text": "A margem bruta caiu 2 pontos por causa do desconto no marketplace.", "cite": "Relatório financeiro" } },
        {
          "type": "actions",
          "props": {
            "items": [
              { "label": "Comparar com o trimestre anterior", "prompt": "Compare a receita deste trimestre com a do trimestre anterior, canal por canal.", "tone": "primary", "icon": "arrow-right" },
              { "label": "Gerar plano de margem", "prompt": "Monte um plano de ações para recuperar 2 pontos de margem no próximo trimestre.", "icon": "lightbulb" }
            ]
          }
        }
      ]
    }
  ]
}
```

### 12.2 Bom — abas, detalhe recolhível e especificações

```ui
{
  "components": [
    {
      "type": "tabs",
      "children": [
        {
          "type": "stack",
          "props": { "label": "Resumo" },
          "children": [
            { "type": "keyvalue", "props": { "items": [
              { "label": "Receita", "value": "R$ 12,4 mi" },
              { "label": "Margem", "value": "38%" }
            ] } }
          ]
        },
        {
          "type": "stack",
          "props": { "label": "Metodologia" },
          "children": [
            { "type": "reveal", "props": { "title": "Como calculamos" }, "children": [
              { "type": "list", "props": { "items": [
                { "text": "Base: notas fiscais emitidas" },
                { "text": "Período: julho a setembro" }
              ] } }
            ] }
          ]
        }
      ]
    }
  ]
}
```

### 12.3 Bom — tabela com ação de copiar

```ui
{
  "components": [
    {
      "type": "card",
      "props": { "title": "Receita por canal" },
      "children": [
        { "type": "table", "props": {
          "columns": ["Canal", "Receita", "Crescimento"],
          "caption": "Crescimento compara com o trimestre anterior.",
          "rows": [
            ["Direto", "R$ 6,2 mi", "+9%"],
            ["Parceiros", "R$ 4,1 mi", "+15%"],
            ["Marketplace", "R$ 2,1 mi", "+6%"]
          ]
        } },
        { "type": "actions", "props": { "items": [
          { "label": "Copiar tabela", "copy": "Direto;R$ 6,2 mi;+9%\nParceiros;R$ 4,1 mi;+15%\nMarketplace;R$ 2,1 mi;+6%" }
        ] } }
      ]
    }
  ]
}
```

### 12.4 Bom — feed de notícias com miniaturas, status e fontes

```ui
{
  "components": [
    {
      "type": "section",
      "props": { "eyebrow": "VCT Américas", "icon": "flame", "title": "Principais notícias" },
      "children": [
        {
          "type": "stack",
          "props": { "direction": "row", "gap": "md", "align": "start" },
          "children": [
            { "type": "image", "props": { "src": "https://example.com/mibr.png", "alt": "Equipe da MIBR no palco", "size": "thumb" } },
            { "type": "stack", "props": { "gap": "sm" }, "children": [
              { "type": "stack", "props": { "direction": "row", "gap": "sm", "align": "center" }, "children": [
                { "type": "badge", "props": { "label": "Confirmado", "tone": "success", "icon": "check" } },
                { "type": "text", "props": { "text": "23 de outubro", "variant": "small" } }
              ] },
              { "type": "text", "props": { "text": "MIBR coloca todo o elenco no banco", "variant": "strong" } },
              { "type": "text", "props": { "text": "Aspeas, zekken, Verno, Mazino e tex estão disponíveis para negociações. Os contratos continuam válidos, portanto isso não significa que todos serão vendidos." } },
              { "type": "source", "props": { "label": "strafe.com", "href": "https://strafe.com" } }
            ] }
          ]
        },
        { "type": "divider" },
        {
          "type": "stack",
          "props": { "direction": "row", "gap": "md", "align": "start" },
          "children": [
            { "type": "image", "props": { "src": "https://example.com/loud.png", "alt": "Equipe da LOUD em campeonato", "size": "thumb" } },
            { "type": "stack", "props": { "gap": "sm" }, "children": [
              { "type": "stack", "props": { "direction": "row", "gap": "sm", "align": "center" }, "children": [
                { "type": "badge", "props": { "label": "Mercado em aberto", "tone": "warning", "icon": "clock" } },
                { "type": "text", "props": { "text": "19 de outubro", "variant": "small" } }
              ] },
              { "type": "text", "props": { "text": "FURIA perde a vaga de parceira no VCT", "variant": "strong" } },
              { "type": "text", "props": { "text": "A organização ainda pode competir pelos classificatórios abertos de 2027." } },
              { "type": "source", "props": { "label": "sheesports.com", "href": "https://sheesports.com" } }
            ] }
          ]
        }
      ]
    }
  ]
}
```

### 12.5 Bom — laboratório interativo (choices + checklist)

```ui
{
  "components": [
    {
      "type": "section",
      "props": {
        "eyebrow": "Laboratório interativo",
        "icon": "sparkles",
        "title": "Configure seu agente",
        "description": "Ajuste a missão e as capacidades; a simulação mostra o que muda."
      },
      "children": [
        {
          "type": "choices",
          "props": {
            "label": "Missão",
            "mode": "single",
            "layout": "list",
            "default": ["Agente pesquisador"],
            "options": [
              { "label": "Agente de CRM e captação de leads", "description": "Qualifica leads e organiza o funil comercial." },
              { "label": "Agente programador", "description": "Implementa, revisa e testa código." },
              { "label": "Agente pesquisador", "description": "Busca, compara e consolida fontes." }
            ],
            "submitLabel": "Enviar missão",
            "submitPrefix": "Configurar agente com a missão: "
          }
        },
        {
          "type": "choices",
          "props": {
            "label": "Capacidades",
            "mode": "multiple",
            "layout": "list",
            "countLabel": "Capacidades habilitadas",
            "default": ["RAG e contexto", "Memória persistente"],
            "options": [
              { "label": "Planejamento", "description": "Divide objetivos complexos em tarefas menores." },
              { "label": "RAG e contexto", "description": "Recupera informações relevantes quando necessário." },
              { "label": "Ferramentas", "description": "Executa ações reais com APIs, código e serviços." },
              { "label": "Memória persistente", "description": "Guarda informações úteis entre sessões e tarefas." },
              { "label": "Verificação e autocorreção", "description": "Testa resultados e corrige erros detectados." }
            ],
            "submitLabel": "Enviar capacidades",
            "submitPrefix": "Configurar agente com as capacidades: "
          }
        },
        {
          "type": "checklist",
          "props": { "items": [
            { "label": "Receber objetivo", "description": "Encontrar e qualificar 20 clínicas para prospecção comercial.", "status": "done" },
            { "label": "Planejamento", "description": "Etapa desabilitada", "status": "disabled" },
            { "label": "Buscar contexto", "description": "Consultar dados e critérios comerciais atualizados", "status": "done" },
            { "label": "Verificar execução", "description": "Etapa desabilitada", "status": "disabled" }
          ] }
        }
      ]
    }
  ]
}
```

### 12.6 Ruim (não emitir)

```json
{
  "components": [
    { "type": "card", "props": { "title": "**Resumo**" } },
    { "type": "card", "props": {}, "children": [] },
    { "type": "grid", "props": { "columns": 4 }, "children": [{ "type": "stat", "props": { "label": "Receita", "value": "R$ 1" } }] },
    { "type": "actions", "props": { "items": [
      { "label": "Clique aqui.", "tone": "primary" },
      { "label": "Saiba mais", "tone": "primary", "copy": "x" }
    ] } }
  ]
}
```

Problemas: Markdown no título; card vazio e card sem título na raiz; grid de 4
colunas com 1 filho; dois botões inválidos (um sem `prompt`/`copy`, outro com
os dois) e com duas `primary`; rótulo com ponto final. Caixas de nota
(`callout`) também são proibidas (`ui.callout-style`). Como há um erro
estrutural (`ui.action-invalid`), o validador para aí e o lint de design não
roda. Corrigidos os erros, o lint apontaria `ui.markdown-in-props`,
`ui.empty-container`, `ui.card-title`, `ui.grid-orphans`, `ui.action-primary`
e `ui.label-period`.

## 13. Versionamento e manutenção

1. Alterações de componente/limite/regra acontecem **primeiro** em
   `data/genui-contract.json`.
2. Atualize `data/genui-fixtures.json` (novos casos + `normalized` esperado) e
   as duas implementações (`src/lib/genui` e `src-tauri/src/tools/genui`).
3. Rode `pnpm typecheck`, `pnpm test`, `cd src-tauri && cargo test --lib`.
   O teste de paridade falha de propósito se os lados divergirem.
4. Atualize este documento e rode os testes: os exemplos ```ui daqui são
   validados automaticamente.
5. Mudança incompatível (remover componente/prop, mudar semântica de ação):
   incrementar `version` no contrato, aceitar leitura da versão anterior por um
   ciclo (`ui.version-mismatch`) e registrar em `docs/ARCHITECTURE.md`.
