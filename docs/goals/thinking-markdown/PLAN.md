# PLAN — Markdown no Thinking (raciocínio do modelo) no Chat e no Code

> Status: **concluído e verificado** (2026-10-28 — implementação + verificação
> independente APROVADA, 0 falhas contratuais). Evidências, comandos e números
> finais em **`EVIDENCE.md`**; relatório adversarial completo em
> `.research/thinking-markdown-verify/REPORT.md`.
> Equipe: `ui-core-renderer`/`ui-core-timeline` (renderer, timeline, header),
> `ui-code` (integração do layout Code), `verifier` (verificação independente),
> Lead (contrato, docs, verificação final).
> Base: `docs/MARKDOWN.md` (contrato §4/§10), `docs/DESIGN.md` §6.3,
> `docs/goals/code-harness/WORKBENCH.md` §5.2.1, `docs/ARCHITECTURE.md` §8.1.

## 1. Objetivo

O raciocínio visível do modelo (campo `reasoning` da mensagem + `trace[].reasoning`
por passo do loop de agentes) é **conteúdo Markdown**: modelos emitem negrito,
listas, títulos, tabelas, cercas de código, math e links no thinking. Hoje a
timeline "Thinking" (`AgentSteps`) renderiza esse conteúdo como **texto puro**
pré-formatado, então a sintaxe aparece literal e — pior — o modelo da timeline
**destrói** o Markdown (divide por linha em branco e remove marcadores de lista).

Entrega: o Thinking passa a renderizar **Markdown completo** (o mesmo contrato de
`docs/MARKDOWN.md` §4, com a mesma sanitização da resposta), de forma compacta e
discreta, **nos dois layouts** — Chat e Code — preservando as diferenças já
existentes entre eles.

## 2. Auditoria do estado atual

| # | Ponto | Hoje | Problema |
| --- | --- | --- | --- |
| 1 | `AgentSteps` linha de raciocínio | `<p class="whitespace-pre-wrap">{entry.text}</p>` | Markdown vira texto literal; fences/tabelas/math/links não renderizam |
| 2 | `buildAgentTrace` / `splitReasoning` | divide por `\n{2,}` e remove `-`/`*`/`1.` de cada linha | corrompe listas, cercas de código (com linha em branco interna), tabelas, blockquotes e math; o bullet do item duplicava o marcador |
| 3 | Renderer `Markdown` | só tem a variante da resposta (15px, `foreground`) | não há variante compacta/muted para um bloco secundário como o Thinking |
| 4 | Layouts | Chat e Code compartilham o **mesmo** `ChatView`/`MessageList`/`AgentSteps` | a mudança deve ser única e não pode achatar as diferenças de layout (§3.3) |
| 5 | Testes | timeline testa texto puro; Markdown testa só a variante da resposta | sem rede de proteção para Markdown no Thinking nem para XSS via raciocínio |
| 6 | Docs | DESIGN §6.3 e WORKBENCH §5.2.1 descrevem o "Pensou · texto" sem contrato de Markdown | contrato implícito |

## 3. Decisões de design

1. **Uma única variante do renderer, mesmo dialeto.** `Markdown` ganha
   `variant?: 'default' | 'thinking'`; as duas variantes usam o **mesmo**
   pipeline (`remark-gfm`, `remark-math`, `rehype-raw`, `rehypeSafeHtml`,
   `rehype-katex`) e os mesmos overrides de componentes. Não existe "Markdown
   reduzido" no Thinking: tudo o que renderiza na resposta renderiza no Thinking.
2. **Variante `thinking` = prosa compacta e discreta.** Modificador
   `.lumina-prose--thinking` (somente tokens): 13px, `foreground-muted`, ritmo
   vertical mais apertado, títulos escalados, tabelas/listas/notas de rodapé
   menores. O bloco continua visualmente secundário em relação à resposta.
3. **Diferenças de layout preservadas** (requisito explícito do pedido):
   - **Chat**: tools de web/skills/artefatos continuam como **resumos agrupados**
     (`ToolActivity`: "Encontrou 8 páginas web" + avatares de domínio, "Leu 3
     páginas" + chips, "Criou 2 arquivos" + chips de nome, erros em `danger`).
   - **Code**: tools do harness continuam como **uma linha por chamada**
     (`ToolCallRow`: verbo + alvo em mono + status/exit/duração + diff/saída sob
     demanda), no estilo Think/Edit/Pwsh.
   - Header/shimmer/contador, auto-open/auto-collapse, opção **Raciocínio
     recolhido por padrão**, `max-h-80` com scroll depois do turno, composer
     variant, welcome e chrome do Code (session header/tabs/painel) **não mudam**.
4. **Markdown bruto por passo.** `buildAgentTrace` devolve **uma** entrada de
   raciocínio por passo do trace, com o texto bruto (só `trim` nas pontas):
   listas, cercas, tabelas, math e indentação ficam intactos. Mensagens legadas
   (sem `trace`) viram **um** bloco de raciocínio + os grupos de tools. O
   intercalamento raciocínio → tools por passo é o mesmo de hoje.
5. **Streaming.** O bloco abre durante o turno (comportamento atual) e o último
   bloco de raciocínio recebe o caret (`lumina-prose--streaming`) enquanto a
   fase é `reasoning`; fences ainda não fechadas renderizam como bloco de código
   parcial (sem quebrar o layout). Ao chegar o texto, o bloco recolhe como hoje.
6. **Segurança por construção.** O raciocínio passa pelo **mesmo** sanitizador
   (`rehypeSafeHtml`) e nunca por `innerHTML`; links perigosos não viram links,
   HTML perigoso é descartado, imagens usam fallback. O Thinking não abre
   nenhuma superfície nova de XSS.
7. **Acessibilidade.** O rótulo "Pensou" continua como texto semântico antes do
   conteúdo; o bloco segue dentro do `<li>` da timeline; task lists mantêm
   checkbox desabilitado com rótulo pt-BR; links mantêm nome acessível.
8. **Custo.** O conteúdo colapsado não é montado (Radix desmonta
   `Collapsible.Content`), então mensagens antigas não pagam parse de Markdown;
   durante o streaming só o bloco que cresce é re-parseado (renderer memoizado,
   strings estáveis por passo).
9. **Sem mudança de backend.** O raciocínio já chega e é persistido como texto
   bruto (eventos `reasoning_delta`, `trace` em JSON no SQLite); nenhum ajuste
   em Rust é necessário — só o renderer/timeline do renderer.
10. **Copy do header por layout (refinamento pedido com screenshot).** No layout
    **Code** o título agregado do bloco passa a ser **"Trabalhou por Xs"** — o
    tempo do turno inclui as ferramentas, não só o raciocínio; **"Pensou por Xs"
    fica apenas no layout Chat**. Ao vivo os títulos continuam por fase
    ("Pensando…", "Executando ferramentas…") e turnos sem raciocínio exposto
    seguem "N passos" nos dois.

## 4. Contrato técnico

### 4.1 Renderer (`src/components/chat/Markdown.tsx`)

```ts
export interface MarkdownProps {
  content: string;
  className?: string;
  /** Adds the blinking stream caret to the last text block. */
  streaming?: boolean;
  /** `thinking`: prosa compacta/discreta usada pela timeline de raciocínio. */
  variant?: 'default' | 'thinking';
}
```

Root: `cn('lumina-prose', variant === 'thinking' ? 'lumina-prose--thinking' : 'text-[15px]', streaming && 'lumina-prose--streaming', className)`.

### 4.2 CSS (`src/styles/globals.css`)

`.lumina-prose--thinking` em `@layer components`: 0.8125rem/1.6,
`color: var(--foreground-muted)`, `overflow-wrap: anywhere`; margens e escalas
menores para `p`, `h1–h6`, listas, `hr`, tabelas, `blockquote`, alertas, notas
de rodapé, `details` e código inline. Somente tokens; nenhuma cor/medida nova.

### 4.3 Timeline (`src/lib/agentTrace.ts` + `src/components/chat/AgentSteps.tsx`)

```ts
type AgentTraceEntry =
  | { kind: 'reasoning'; text: string } // Markdown bruto de UM passo
  | { kind: 'tools'; group: ToolGroup };
```

Linha de raciocínio:

```tsx
<li className="flex min-w-0 items-start gap-2.5 rounded-lg px-1.5 py-1">
  <Brain aria-hidden className="mt-0.5 size-3.5 shrink-0 text-foreground-subtle" />
  <div className="min-w-0 flex-1">
    <span className="mb-0.5 block text-[12px] font-semibold text-foreground">Pensou</span>
    <Markdown content={entry.text} variant="thinking" streaming={última && fase === 'reasoning'} />
  </div>
</li>
```

`splitReasoning`/`cleanReasoningBlock` (divisão destrutiva) são removidos.

## 5. Plano de implementação

| Task | Entrega | Dono |
| --- | --- | --- |
| task-1 | Renderer: `variant="thinking"` + `.lumina-prose--thinking` + testes (matriz + segurança) | `ui-core-renderer` |
| task-2 | Timeline: `buildAgentTrace` preserva Markdown por passo + `AgentSteps` rende Markdown + testes (inclui diferenças de layout) | `ui-core-timeline` |
| task-4 | Layout Code: auditoria + teste de integração do transcript no modo Code (bloqueada por 1/2) | `ui-code` |
| task-3 | Harness de verificação independente em `.research/thinking-markdown-verify/` | `verifier` |
| task-5 | Execução da verificação independente (matriz, segurança, a11y, resiliência, comandos) | `verifier` |
| task-6 | Header do Thinking por layout: "Trabalhou por Xs" no Code, "Pensou por Xs" só no Chat (+ testes) | `ui-core` |
| task-7 | Teste de integração do transcript Code atualizado para a nova copy do header | `ui-code` |
| — | Contrato, docs e verificação final | Lead |

## 6. Matriz de testes

**`src/components/chat/Markdown.test.tsx`** — variante `thinking`: classe do root;
default inalterado (sem classe, `text-[15px]`); matriz completa (títulos, ênfase,
listas, task list, tabela, citação/alerta, fences + copiar, código indentado,
inline code, math inline/display, notas de rodapé, HTML seguro, quebra dura,
autolinks, imagens, links externos/mailto); caret de streaming; merge de
`className`.

**`src/components/chat/Markdown.security.test.tsx`** — todos os vetores XSS/URLs
rodando também em `variant="thinking"` (prova de sanitização idêntica).

**`src/lib/__tests__/agentTrace.test.ts`** — uma entrada por passo; texto bruto
preservado (listas, fences com linha em branco, heading, tabela, math); legado com
um bloco; intercalamento e calls defensivas; trim; raciocínio vazio.

**`src/components/chat/AgentSteps.test.tsx`** — Markdown no Thinking (`strong`,
`ul`/`li`, `h3`, tabela, code card + copiar, KaTeX, alerta pt-BR, task list, link
externo); texto puro compatível; caret só no último bloco durante `reasoning`;
**Chat** com resumos agrupados × **Code** com linhas por chamada, os dois com
raciocínio Markdown; XSS inerte; **título do header por layout** ("Pensou por Xs"
no Chat, "Trabalhou por Xs" no Code, títulos ao vivo e "N passos" inalterados).

**`src/components/code/CodeTranscriptThinking.test.tsx`** — integração: `ChatView`
real no `layoutMode: 'code'` com sessão de código, raciocínio Markdown + tools por
chamada + chrome do Code, header "Trabalhou por 4s"; troca para `chat` mantém o
transcript e passa a mostrar "Pensou por 4s"; separação de sessões preservada.

**Verificação independente** — matriz adversária própria (58+ checks de sintaxe,
vetores de segurança, resiliência, a11y, copy do header por layout, contagens de
`pnpm typecheck`, `pnpm vitest run` dos arquivos acima, `pnpm test` completo e
`pnpm build`).

## 7. Critérios de aceitação

- [x] Markdown completo no Thinking nos **dois** layouts, com as diferenças de
      cada layout mantidas.
- [x] Header agregado do Thinking: **"Trabalhou por Xs"** no layout Code e
      **"Pensou por Xs"** apenas no layout Chat (títulos ao vivo e "N passos"
      inalterados).
- [x] `pnpm typecheck` 0 erros; `pnpm test` verde (112 arquivos / 2.130 testes);
      `pnpm build` OK; `cargo test --lib` verde (755 passed).
- [x] Sanitização da variante `thinking` idêntica à da resposta (4.368 checks de
      segurança independentes, 0 vetores XSS / 0 bypass).
- [x] Sem `any`/`@ts-ignore`; tokens apenas; aria/roles e microcopy pt-BR.
- [x] Docs atualizados (`MARKDOWN.md` §10, `DESIGN.md` §6.3,
      `WORKBENCH.md` §5.2.1, `ARCHITECTURE.md` §8.1) e registro de execução.
- [x] Verificação independente executada e sem bloqueadores (APROVADO).

## 8. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Markdown quebrado no meio do streaming (fence aberta) | renderer já lida com fences parciais; verificação cobre streaming/ fence aberta |
| Custo de parse em raciocínios longos | bloco colapsado não é montado; memo por conteúdo; verificação mede raciocínio grande |
| Heading no Thinking poluir o outline | mesmo tratamento da resposta (h1–h6) com escala reduzida; a11y avaliada na verificação |
| Regressão da prosa da resposta | variante default intocada (classes/estilos) + suíte do Markdown existente |
| Divergência entre Chat e Code | timeline única; teste de integração no Code + teste de diferenças por layout |
| XSS via raciocínio | mesmo sanitizador; testes dedicados em ambas as variantes |

## 9. Registro de execução

**Concluído e verificado em 2026-10-28.** Detalhes completos em `EVIDENCE.md`.

| Etapa | Dono | Resultado |
| --- | --- | --- |
| task-1 renderer `variant="thinking"` + CSS + testes | `ui-core-renderer` | 2 arquivos / 155 testes focados verdes; typecheck 0 |
| task-2 timeline Markdown bruto + `AgentSteps` + testes | `ui-core-timeline` | 2 arquivos / 50 testes focados verdes; typecheck 0 |
| task-4 integração/auditoria do layout Code | `ui-code` | 4 testes de integração verdes; nada a mudar em produção do Code |
| task-6 header por layout ("Trabalhou por" no Code) | `ui-core-timeline` | 30 testes em `AgentSteps.test.tsx` verdes; typecheck 0 |
| task-7 copy do header no teste do Code | `ui-code` | 4 testes verdes; typecheck 0 |
| task-3/5 verificação independente | `verifier` | **4.922 checks / 0 falhas / 2 observações**; relatório final APROVADO |
| Docs + validação final | Lead | typecheck 0; recorte 214 testes; suíte completa 2.130; build ok; cargo 755 |

Verificação independente (resumo): matriz §4 **251 checks**; segurança/XSS via
raciocínio **4.368 checks / 0 falhas** (79 vetores nas 2 variantes, paridade DOM
thinking × default); `agentTrace` 37; `AgentSteps` 137; transcript real nos 2
layouts 53; a11y 36; resiliência 40.

Limitações conhecidas: jsdom não pinta CSS/libs de fences nem KaTeX (aparência
verificada por classes/estrutura/regras/CSS de contraste); contraste AAA não é
exigido (AA ok: 6,27:1 claro / 6,99:1 escuro); agrupamento de tools é por tipo de
tool (comportamento anterior), não por `layoutMode`; 1 flake alheio à feature em
`ModelPickerDialog.auth.test.tsx` sob carga concorrente (passou isolado e no
rerun completo). O restante em `.research/thinking-markdown-verify/REPORT.md`
§13/§14.
