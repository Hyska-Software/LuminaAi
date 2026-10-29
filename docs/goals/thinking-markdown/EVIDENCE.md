# EVIDENCE — Markdown no Thinking (Chat e Code)

> Status: **concluído e verificado** (2026-10-28). Plano: `PLAN.md`.
> Requisito do usuário: *"Adicione suporte completo a Markdown para os campos de
> Thinking do modelo no chat, deve ser aplicado no layout de chat Chat e de Code,
> com as suas diferenças mantidas"* + refinamento com screenshot: *"para o design
> do Code substitua o `Pensou por ...` por `Trabalhou por ...`, deixe `Pensou por
> ...` apenas no modo de Chat"*.
> Veredito da verificação independente (`verifier`, task-5): **APROVADO — 0
> falhas contratuais**. Relatório completo: `.research/thinking-markdown-verify/REPORT.md`.

## 1. Entregas

| Área | Entrega | Arquivos |
| --- | --- | --- |
| Renderer (`ui-core-renderer`, task-1) | `Markdown` ganha `variant?: 'default' \| 'thinking'` (mesmo pipeline remark/rehype, mesma sanitização) e o modificador `.lumina-prose--thinking` (13px, muted, ritmo compacto, somente tokens) | `src/components/chat/Markdown.tsx`, `src/styles/globals.css`, `Markdown.test.tsx`, `Markdown.security.test.tsx` |
| Timeline (`ui-core-timeline`, task-2) | `buildAgentTrace` emite **1 entrada de raciocínio por passo** com o Markdown **bruto** (sem dividir por linha em branco/remover marcadores); `AgentSteps` renderiza o raciocínio com `<Markdown variant="thinking">`, caret só no último bloco em `reasoning`, demais comportamentos intactos | `src/lib/agentTrace.ts`, `src/lib/__tests__/agentTrace.test.ts`, `src/components/chat/AgentSteps.tsx`, `AgentSteps.test.tsx` |
| Header por layout (`ui-core-timeline`, task-6) | Header agregado: **Chat "Pensou por Xs"**, **Code "Trabalhou por Xs"** (o tempo do turno inclui ferramentas); títulos ao vivo ("Pensando…"/"Executando ferramentas…"), "Raciocínio" e "N passos" inalterados | `src/components/chat/AgentSteps.tsx`, `AgentSteps.test.tsx` |
| Layout Code (`ui-code`, task-4/7) | Auditoria (nada renderiza Thinking fora do `AgentSteps`; nada a mudar em `src/components/code/**`) + teste de integração do transcript real do Code (Markdown + linhas por chamada + chrome + troca de layout com troca de copy) | `src/components/code/CodeTranscriptThinking.test.tsx` |
| Docs (Lead) | Contrato no `MARKDOWN.md` §10, `DESIGN.md` §6.3, `WORKBENCH.md` §5.2.1, `ARCHITECTURE.md` §8.1, este plano/evidência | `docs/**` |
| Verificação independente (`verifier`, task-3/5) | Harness adversarial próprio em `.research/thinking-markdown-verify/` (7 audits, fixtures/vetores próprios) + `REPORT.md` | `.research/thinking-markdown-verify/**` |

## 2. Comportamento entregue

- **Markdown completo no Thinking** nos dois layouts: títulos, ênfase, listas
  (incluindo aninhadas/task lists), tabelas com alinhamento, citações/alertas
  GitHub pt-BR, código cercado com header + copiar, código inline, math
  (KaTeX, inclusive `\$`), links (externos/mailto/âncoras), imagens com fallback,
  notas de rodapé, HTML cru do subconjunto seguro e fences delegadas
  (`ui`/`mermaid`/`chart`/`html`/`svg`) — mesmo dialeto e **mesma sanitização** da
  resposta (nenhum "Markdown reduzido").
- **Diferenças de layout mantidas**: Chat → resumos agrupados de tools
  (domínios/páginas/chips) e "Pensou por Xs"; Code → uma linha por chamada do
  harness (`ToolCallRow`: verbo + alvo + status/exit/duração + diff/saída) e
  "Trabalhou por Xs". Chrome do Code (session header/tabs, composer variant,
  welcome) intocado; troca de layout preserva o transcript e alterna a copy.
- **Streaming**: auto-open + caret no último bloco de raciocínio em
  `phase === 'reasoning'`; fence aberta renderiza card parcial; com a resposta
  pronta o bloco recolhe (ou fica recolhido com a opção **Raciocínio recolhido por
  padrão**).
- **Backend intocado** (raciocínio já era persistido como texto bruto; nenhum
  ajuste em Rust).

## 3. Verificação final (Lead, árvore final)

| Comando | Resultado |
| --- | --- |
| `pnpm typecheck` | **0 erros** (exit 0) |
| `pnpm vitest run` (recorte: Markdown, Markdown.security, AgentSteps, agentTrace, CodeTranscriptThinking) | **5 arquivos / 214 testes verdes** |
| `pnpm test` (suíte completa) | **112 arquivos / 2.130 testes verdes**, 0 falhas (exit 0) |
| `pnpm build` | **exit 0** (4,80 s); CSS de produção contém `.lumina-prose--thinking` (39 ocorrências) e `font-size:.8125rem`; só warning pré-existente de chunk grande |
| `cd src-tauri && cargo test --lib` | **755 passed / 0 failed / 10 ignored** (backend intocado) |
| Verificação independente (`verifier`, código real) | **4.922 checks / 0 falhas / 2 observações** em 7 arquivos/57 testes |

## 4. Verificação independente (resumo)

| Dimensão | Evidência |
| --- | --- |
| Matriz de sintaxe §4 na variante thinking | 251 checks, 0 falhas; paridade estrutural com a variante default |
| Segurança (XSS via raciocínio) | **4.368 checks / 0 falhas**; 79 vetores nas duas variantes; paridade DOM thinking × default (sanitização não afrouxou) |
| Modelo da timeline (`buildAgentTrace`) | 37 checks: Markdown bruto por passo (listas/fences/tabelas/math), fallback legado, fatias de tools, defensivas, sem mutação |
| `AgentSteps` (Chat × Code, header, caret, setting, XSS) | 137 checks, 0 falhas |
| Transcript real nos dois layouts (+ troca Code→Chat) | 53 checks, 0 falhas |
| A11y básica (títulos/listas/tabela/roles/checkbox pt-BR/links) | 36 checks, 0 falhas |
| Resiliência (>50k chars, fence aberta, sem-espaço, emoji/RTL, vazio, legado) | 40 checks, 0 falhas |
| Header final por layout | Chat "Pensou por Xs" / Code "Trabalhou por Xs", nunca cruzados; ao vivo inalterados; sessão compartilhada alterna a copy ao trocar layout |

Observações não bloqueantes: contraste AAA do `foreground-muted` (AA ok —
6,27:1 claro / 6,99:1 escuro); agrupamento de tools é por **tipo** de tool, não
por `layoutMode` (comportamento anterior preservado).

## 5. Falhas e limitações

- **Nenhuma falha contratual / nenhum bug bloqueador ou de segurança.**
- Limitações da verificação (jsdom não pinta CSS; libs de fences delegadas
  mockadas; KaTeX sem pintura; contraste calculado por token; sem screenshot por
  regra do repositório): detalhadas em
  `.research/thinking-markdown-verify/REPORT.md` §14.
- Flake único e alheio à feature: 1 timeout em `ModelPickerDialog.auth.test.tsx`
  sob carga concorrente (cargo test + agentes); passou isolado e no rerun da
  suíte completa — não é regressão desta feature.
- Limitação de produto conhecida (contrato fixado): cada passo de raciocínio
  repete a legenda "Pensou" (como no Code do WORKBENCH §5.2.1); só o header
  agregado muda por layout.

## 6. Registro de execução

| Etapa | Dono | Resultado |
| --- | --- | --- |
| task-1 renderer thinking + CSS | `ui-core-renderer` | 155 testes focados verdes; typecheck 0 |
| task-2 timeline Markdown bruto + AgentSteps | `ui-core-timeline` | 50 testes focados verdes; typecheck 0 |
| task-4 integração/auditoria do Code | `ui-code` | 4 testes de integração verdes; nada a mudar em produção do Code |
| task-6 header por layout | `ui-core-timeline` | 30 testes em `AgentSteps.test.tsx` verdes; typecheck 0 |
| task-7 copy do header no teste do Code | `ui-code` | 4 testes verdes; typecheck 0 |
| task-3/5 verificação independente | `verifier` | 4.922 checks / 0 falhas; relatório final APROVADO |
| Docs + validação final | Lead | typecheck 0; 214 focados; 2.130 completos; build ok; cargo 755 |

> Nota de histórico: durante a sessão, um workflow externo do usuário criou o
> commit `6d00c76` ("Implement Code harness review workflow"), que absorveu parte
> do trabalho desta feature que estava na árvore (task-1/2/4). As alterações
> restantes (task-6/7 + doc refinements) permanecem no working tree, sem commit
> feito por esta equipe.
