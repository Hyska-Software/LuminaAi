# Markdown no chat — auditoria, contrato e plano

> Status: **concluído e verificado** (checklist e registro em §7/§9).
> Donos: `ui-core` (renderer `src/components/chat/**` + CSS), `harness-dev`
> (prompt do agente em `src-tauri/src/harness/prompt.rs`), Lead (docs, deps,
> revisão final e verificação independente via `verifier`). Referências:
> `docs/ARCHITECTURE.md`, `docs/DESIGN.md` §6.3, `docs/GENUI.md`.

## 1. Objetivo

O chat do Lumina deve renderizar **tudo o que Markdown/GFM oferece** de forma
correta, segura, acessível e consistente com o design system — e o agente deve
ser **instruído a usar esses recursos corretamente**.

## 2. Auditoria do estado atual

Pipeline hoje (`src/components/chat/Markdown.tsx`):

- `react-markdown@10` + `remark-gfm@4` + `remark-math@6` + `rehype-katex@7`.
- Componentes custom: `<pre>` removido (deixa os cards fluírem), `<code>`
  (Prism/copy ou fences delegadas `ui`, `mermaid`, `chart`, `html`, `svg`),
  `<a>` (abre no navegador via plugin opener), `<table>` (wrapper com scroll),
  `<img>` (`loading="lazy"`).
- Estilos em `.lumina-prose` (`src/styles/globals.css`) + CSS do KaTeX.
- `MermaidBlock` lazy com `securityLevel: 'strict'` + sanitização de SVG.
- Testes: **nenhum** dedicado a Markdown/CodeBlock (418 testes existentes).

### Lacunas encontradas

| # | Recurso | Hoje | Problema |
| --- | --- | --- | --- |
| 1 | HTML cru (CommonMark) | aparece como texto literal (`<br>`, `<kbd>`, `<details>` viram `&lt;br&gt;`) | `rehype-raw` ausente; HTML vaza como texto feio |
| 2 | Títulos h5/h6 | renderizam sem estilo (CSS só cobre h1–h4) | hierarquia inconsistente |
| 3 | Task lists GFM | `<input type=checkbox disabled>` sem estilo; marcador de lista duplicado | quebra o ritmo visual |
| 4 | Notas de rodapé GFM | parse ok, render sem estilo; `<h2 class="sr-only">Footnotes</h2>` fica **visível** (a classe vem de string gerada, o Tailwind não a emite) | seção crua + rótulo a11y em inglês |
| 5 | Alertas GitHub (`> [!NOTE]`…) | viram citação com `[!NOTE]` literal | recurso comum em respostas de LLM |
| 6 | Tabelas | alinhamento via `style` inline funciona; wrapper com scroll existe | `caption`/tabelas largas e `nowrap` precisam de revisão + testes |
| 7 | Ênfase extra | `<del>`, `<mark>`, `<kbd>`, `<sup>/<sub>`, `<abbr>`, `<details>/<summary>` sem estilo | aparência crua |
| 8 | Imagens | `loading="lazy"`; sem fallback | imagem quebrada fica como ícone quebrado; `src` vazio/seguro sem tratamento |
| 9 | Links | externos http(s) abrem no navegador; `mailto:`/`tel:`/âncoras internas caem no `target=_blank` sem handler; URL insegura vira `href=""` | navegação quebrada/inconsistente |
| 10 | `<pre>` de HTML cru | o unwrap incondicional perde o bloco quando não há `<code>` filho | HTML legítimo perde formatação |
| 11 | KaTeX | CSS importado, render ok | erro de LaTeX sem estilo `.katex-error`; sem teste |
| 12 | Streaming | caret via pseudo-elemento no último filho | em tabela/código/genui o caret aparece solto após o bloco |
| 13 | Testes | nenhum | sem rede de proteção para regressões |
| 14 | Prompt do agente | ensina Markdown básico + mermaid + fences `ui`; não documenta GFM completo (tarefas, notas, alertas, alinhamento), math, fences `chart`/`html`/`svg` nem o subconjunto seguro de HTML | modelo subutiliza o renderer |
| 15 | Docs | `DESIGN.md`/`ARCHITECTURE.md` dizem "Markdown completo" sem detalhar | contrato implícito |

## 3. Decisões de design

1. **HTML cru sanitizado (allowlist).** `rehype-raw` parseia o HTML; um plugin
   rehype próprio (`rehypeSafeHtml`) roda **antes** do KaTeX e:
   - allowlist de tags inofensivas (`a`, `abbr`, `b`, `br`, `code`, `del`,
     `details`, `div`, `em`, `h1–h6`, `hr`, `i`, `img`, `ins`, `kbd`, `li`,
     `mark`, `ol`, `p`, `pre`, `s`, `section`, `small`, `span`, `strong`,
     `sub`, `summary`, `sup`, `table/tbody/td/tfoot/th/thead/tr/caption`,
     `u`, `ul`, `var`, `wbr`…);
   - **remove a subárvore** de tags perigosas (`script`, `style`, `iframe`,
     `object`, `embed`, `link`, `meta`, `base`, `form`, `button`, `input`
     fora de checkbox de task list, `svg`, `math` cru, `video`, `audio`,
     `template`, `canvas`, `dialog`, `marquee`…);
   - descarta `on*`, `style` (exceto `text-align` em `th/td`), `class` fora de
     allowlist, `data-*` arbitrário, `target`, `srcset`; URLs só `http(s)`,
     `mailto:` e `#âncora` (imagens: só `http(s)`);
   - tags desconhecidas são **desembrulhadas** (mantêm o texto, perdem attrs).
   - Segurança por construção: React nunca usa `innerHTML` aqui; URL transform
     padrão do react-markdown continua ativo como defesa em profundidade.
2. **Notas de rodapé** usam o suporte nativo do `remark-gfm`; CSS próprio,
   refs/backrefs navegam por âncora e o rótulo oculto vira "Notas" (pt-BR).
3. **Alertas GitHub** (`NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`) viram
   um bloco com ícone Lucide + rótulo pt-BR (`Nota`, `Dica`, `Importante`,
   `Atenção`, `Cuidado`), usando tokens (`--accent`, `--success`, `--warning`,
   `--danger`).
4. **Quebra de linha simples continua softbreak** (CommonMark). Nada de
   transformar toda quebra em `<br>` — listas/parágrafos do modelo quebrariam.
5. **Mensagem do usuário** continua texto puro (bolha com edição/cópia) —
   fora de escopo.
6. **Preview de artefato Markdown** (`ArtifactPreview`) continua modo
   texto/código — fora de escopo do chat.
7. **Sem sintaxes não-Markdown**: emoji shortcode, MDX, frontmatter,
   definition lists, wiki links.
8. **Fences especiais inalteradas** (`ui`, `mermaid`, `chart`, `html`, `svg`)
   e sem duplicar catálogo/limites da UI generativa (fonte única:
   `data/genui-contract.json`).

## 4. Contrato de sintaxe suportada (fonte para prompt, docs e testes)

**Blocos:** parágrafos; títulos ATX e setext (`#`…`######`); citações aninhadas;
alertas GitHub (5 tipos); listas não ordenadas/ordenadas (com `start`) e
aninhadas (tight/loose); task lists (`- [ ]` / `- [x]`); código cercado e
indentado; tabelas GFM com alinhamento (`:---`, `:---:`, `---:`); régua
horizontal; notas de rodapé; HTML cru **do subconjunto seguro**.

**Inline:** ênfase `*`/`_`, forte `**`/`__`, riscado `~~`, código inline,
links inline/de referência/autolinks GFM (`www.`, `https://`, e-mail),
imagens, quebra dura (2 espaços ou `\` no fim da linha), entidades/escapes,
HTML inline seguro, referências de nota de rodapé, math inline `$…$`.

**Extensões do app:** math display `$$…$$` (KaTeX); fences `ui` (UI generativa,
contrato v2), `mermaid` (diagrama), `chart` (JSON → SVG), `html`/`svg` (preview
em iframe sandbox); código com header de linguagem + botão copiar (Prism);
links externos e `mailto:` abertos no navegador/app padrão; âncoras internas
(notas) com scroll; imagens externas com fallback.

## 5. Plano de implementação

| Fase | Entrega | Área |
| --- | --- | --- |
| F0 | `rehype-raw@7` + `@types/hast` instalados; contrato congelado neste doc | Lead |
| F1 | Renderer: títulos h5/h6, task lists, notas de rodapé, alertas, `del/mark/kbd/sup/sub/abbr/details`, tabelas (alinhamento/caption), imagens com fallback, links (`mailto:`, âncoras, URLs inseguras), `<pre>` de HTML cru, `.katex-error`, caret de streaming; CSS `.lumina-prose` completo | ui-core |
| F2 | Sanitizador `rehypeSafeHtml` + testes de segurança (XSS/atributos/URLs) | ui-core |
| F3 | Prompt do sistema: seção de formatação Markdown (contrato §4 + regras de uso) e testes Rust | harness-dev |
| F4 | Docs (`DESIGN.md` §6.3, `ARCHITECTURE.md` pipeline) + este status | Lead |
| F5 | Verificação independente (matriz abaixo), `pnpm typecheck`, `pnpm test`, `pnpm build`, `cargo test --lib` | verifier + Lead |

## 6. Matriz de testes e verificações

**`src/components/chat/Markdown.test.tsx`** (render + DOM):
títulos; ênfase/forte/riscado; inline code; listas (aninhadas, `start`);
task lists (tight e loose, item com múltiplos parágrafos; checkbox disabled +
checked + rótulos pt-BR); tabela (wrapper com
scroll, alinhamento inline, header); citação + alertas (5 tipos, rótulo
pt-BR, marcador removido, `[!FOO]` continua citação); links (externo abre via
mocked opener, `mailto:`, âncora não abre navegador); imagens (alt, lazy,
fallback em erro); código cercado (header + copiar, fences delegadas
`ui/mermaid/chart/html/svg` continuam renderizando); código indentado e sem
info string; quebra dura; autolinks GFM; math inline/display; notas de rodapé
(seção, ref, backref, rótulo oculto pt-BR); HTML seguro (`kbd`, `mark`, `sup`,
`br`, `details/summary`) renderizado; `<pre>` de HTML cru preservado.

**`src/components/chat/Markdown.security.test.tsx`** (vetores):
`<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<svg onload>`,
`<img onerror>`, `<a href="javascript:">`, `data:text/html`, `vbscript:`,
`<div style="position:fixed">`, `class`/`id` maliciosos, `<form>`,
`<input>` arbitrário, `<meta http-equiv>`, comentários HTML, entidades.

**Prompt (Rust):** `prompt_documents_markdown_formatting`,
`prompt_documents_special_fences`, `prompt_documents_safe_html_rules`,
`prompt_does_not_duplicate_genui_contract` (garantir que segue derivado do
contrato) + testes existentes.

**Comandos de verificação:**
`pnpm typecheck` · `pnpm test` · `pnpm build` · `cd src-tauri && cargo test --lib`
· revisão de diff pelo Lead.

## 7. Critérios de aceitação

- [x] Todos os itens do §4 renderizam corretamente e sem HTML inseguro.
- [x] `pnpm typecheck` limpo, `pnpm test` verde (sem regressões nos 418 atuais;
      suíte final com 496 testes).
- [x] `pnpm build` ok; `cargo test --lib` verde (154 testes).
- [x] Sem `any`/`@ts-ignore`, sem `dangerouslySetInnerHTML` novo, pt-BR na UI,
      cores/espaçamento só por tokens, acessibilidade mantida.
- [x] Prompt do agente documenta o contrato §4 e não duplica o contrato genui.
- [x] `docs/DESIGN.md` e `docs/ARCHITECTURE.md` atualizados.
- [x] Verificação independente executada (matriz + 3.696 vetores de segurança,
      0 falhas de segurança; 1 limitação conhecida documentada em §8.1).

## 8. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Sanitizador deixar passar XSS | allowlist + testes por vetor + revisão do Lead; React sem `innerHTML` |
| `rehype-raw` aumenta bundle (parse5) | aceitável em app desktop; `pnpm build` mede |
| KaTeX/Mermaid em jsdom | testes focam no DOM estático; mermaid já é lazy e testado fora do Markdown |
| Falso positivo em testes de escaping | asserções sobre `textContent`/`querySelector`, não snapshots |
| Duplicação de listas de linguagens/fences | reutilizar helpers existentes (`normalizeLanguage`, `DELEGATED_LANGUAGES`) |

### 8.1 Limitações conhecidas (aceitas, baixo impacto)

- `> \[!NOTE]` com o marcador **escapado** ainda é detectado como alerta: a
  detecção acontece no componente (texto já desescapado pelo parser). Caso raro
  e cosmético; um alerta de verdade usa o marcador sem escape.
- HTML `<noscript>` com blocos internos: o parser (`rehype-raw`/parse5) pode
  promover o conteúdo de fallback a parágrafos comuns; o conteúdo continua
  passando pelo sanitizador (sem `script`/`on*`/iframe/URL perigosa), então é
  cosmético, sem XSS.
- Ids das notas de rodapé (`user-content-fn-*`, `footnote-label`) se repetem
  entre mensagens da mesma conversa. A navegação por âncora é escopada à
  mensagem (`.lumina-prose`), mas o documento acumula ids duplicados —
  melhoria futura de acessibilidade, não bloqueia o chat.
- Links e imagens com URL relativa são descartados (só `http(s)`, `mailto:` e
  `#âncora`): decisão de segurança, não bug.
- O preview de **artefatos** Markdown (painel lateral) continua em modo
  texto/código — fora do escopo do chat.

## 9. Registro de execução

**Status final: concluído e verificado.**

### Entregas

- **Renderer** (`ui-core`): pipeline `[rehypeRaw, rehypeSafeHtml, rehypeKatex]`;
  sanitizador allowlist próprio (`src/components/chat/markdown/rehypeSafeHtml.ts`);
  alertas GitHub (`GitHubAlert.tsx`), links (`MarkdownLink.tsx`, http(s)/mailto
  via opener, âncoras com scroll escopado, URL insegura vira texto), imagens
  (`MarkdownImage.tsx`, lazy + fallback acessível), notas de rodapé localizadas,
  task lists tight **e loose**, tabelas com caption/wrapper, HTML cru seguro,
  `<pre>` preservado, caret de streaming por classe; CSS `.lumina-prose`
  completo (h5/h6, alertas, footnotes, task lists, `details`, `.katex-error`) e
  `external.ts` com `mailto:`.
- **Prompt** (`harness-dev`): seção `# Formatação Markdown` gerada à mão a partir
  do contrato §4 (blocos, inline, math, fences especiais, regras de uso),
  fronteira explícita tabela Markdown × bloco `ui`, HTML seguro permitido e
  proibições; testes Rust de contrato (`prompt_documents_markdown_formatting`,
  `prompt_documents_special_fences`, `prompt_documents_safe_html_rules`,
  `prompt_does_not_duplicate_genui_contract`).
- **Docs/deps** (Lead): `rehype-raw@7` + `@types/hast`, este contrato,
  `DESIGN.md` §6.3 e `ARCHITECTURE.md` §2/§8.1/§13/§15.
- **Correções pós-verificação**: task list loose passou a aceitar o checkbox em
  qualquer ancestral `li.task-list-item` (regressão coberta); classe morta
  `lumina-task-item` removida; texto do sandbox `html`/`svg` no prompt
  corrigido ("sandbox isolado do app, sem acesso ao IPC").

### Verificação final (Lead, após as correções)

| Comando | Resultado |
| --- | --- |
| `pnpm typecheck` | 0 erros |
| `pnpm test` | **19 arquivos / 496 testes verdes** (418 anteriores + 78 novos) |
| `pnpm build` | OK; CSS gerado contém `.lumina-alert*`, `.lumina-footnotes`, `.lumina-task-checkbox`, `.lumina-prose--streaming`, `.sr-only`, `.katex-error` e h5/h6 |
| `cd src-tauri && cargo test --lib` | **154 passed / 0 failed / 8 ignored** (20 de prompt) |
| Harness independente (`verifier`, re-executado após os fixes) | matriz **223 checks / 1 falha conhecida** (marcador escapado, §8.1); segurança **3.696 checks / 0 falhas** |

Achados da verificação independente: 1 médio (task list loose) e 4 baixos; o
médio e um baixo (texto do prompt) foram corrigidos, os demais são limitações
documentadas em §8.1. Nenhum bloqueador e nenhuma falha de segurança.

### Follow-ups sugeridos (não bloqueiam)

- Ids de notas de rodapé únicos por mensagem (a11y/HTML válido).
- Detecção de alertas GitHub no parser (mdast) para tratar `> \[!NOTE]` literal.
- Habilitar o renderer de Markdown no preview de artefatos Markdown (fora do
  escopo do chat).

