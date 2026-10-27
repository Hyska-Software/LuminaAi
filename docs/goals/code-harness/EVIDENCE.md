# EVIDENCE — planejamento do harness de código (fase de planejamento)

> **Data:** 2026-10-27 · **Natureza:** planejamento + pesquisa. **Nenhuma linha de código de
> produção foi alterada** (só `docs/`). Portanto não se aplicam `cargo test`, `pnpm test`,
> `pnpm typecheck` ou build — a verificação desta fase é de **conteúdo, rastreabilidade e
> consistência**, descrita abaixo.

## 1. Entregáveis

### Plano (novo diretório `docs/goals/code-harness/`)

| Arquivo | Conteúdo |
| --- | --- |
| `GOAL.md` | pedido, ponto de partida, decisões de produto, escopo, critérios de pronto |
| `PLAN.md` | resumo, auditoria, decisões D1–D14, arquitetura, contratos, fases F0–F8, paralelização/ownership, deps, verificação, riscos, docs, decisões a confirmar, não-objetivos |
| `HARNESS.md` | loop/perfis, checkpoints, pipeline de tools, política de permissões, workspace/FS seguro, execução/jobs/terminal, git, contexto/compactação, persistência SQL, eventos/IPC, segurança |
| `TOOLS.md` | convenções, catálogo v1.0 (18 tools: schema, semântica, limites, política, UI, testes), `ToolSpec`, orçamentos, matriz de testes, códigos de erro |
| `WORKBENCH.md` | anatomia do layout, sidebar/header/abas/transcript/painel/composer, fluxos, estados, a11y, motion, microcopy pt-BR, matriz de testes de UI, não-objetivos |

### Pesquisa (`docs/research/`, 5 documentos, ~190 KB)

| Arquivo | Origem | Método |
| --- | --- | --- |
| `dsh-harness-map.md` | DeepSeek Harness empacotado (`app.asar`, 307 pacotes `@deepseek-ai/*`) | extração própria do ASAR (`.research/tools/extract-asar.mjs`) → 5.054 arquivos; leitura dos READMEs oficiais de 26 pacotes de tools + loop/sessão/sandbox/compactação/workspace/UI; 736 linhas com evidências por caminho |
| `paseo-workbench.md` | Paseo 0.13/0.14 (site, docs, README, changelog) + capturas locais | `web_fetch` em fontes primárias (o `web_search` estava indisponível), `read_image` nos recortes; tabela de ~32 features com veredito e URLs |
| `agent-harness-patterns.md` | Codex, Claude Code, opencode, Aider, Cursor, Zed, Cline, OpenHands + MCP/ACP/AGENTS.md/Agent Skills | 40 referências com URL; matriz em 6 tabelas com marcação [D]/[I]/[NC]; catálogo de 22 tools; 8 convergências e 8 divergências |
| `workspace-runtime-options.md` | Viabilidade Rust/Windows | decisões de crate/API com versões verificadas (git CLI, notify 8, portable-pty 0.9, ripgrep crates, rusqlite 0.40, rmcp 3.8), armadilhas do Windows, 12 spikes com critério de aceite, lista de dependências e MSRV |
| `lumina-harness-integration-map.md` | Código atual do Lumina | leitura somente-leitura com `arquivo:linha` (loop, tools, eventos, DB, UI do Code), tabela capacidade × status, pontos de extensão, contratos intocáveis, riscos R1–R20, 25 decisões com recomendação |

## 2. Como o plano foi construído (rastreabilidade)

1. **Código atual** (mapa `lumina-harness-integration-map.md`): confirma que o loop/streaming/
   replay/DB/UI do Code são reaproveitáveis e que faltam workspace, FS, shell, git, aprovações,
   plano, contexto e `@`/`/`.
2. **Referências**: DSH (event log, pipeline de tools, observation policy, sandbox modes, inbox,
   compaction/spill, projeções, UI de workbench) e Paseo (workspace como contêiner, árvore→diff→
   commit, turno com tempo/tokens, composer-console) + benchmark (modos de permissão, plan gate,
   checkpoints, AGENTS.md/MCP/hooks).
3. **Viabilidade**: cada promessa técnica do plano foi cruzada com `workspace-runtime-options.md`;
   o que é incerto virou **spike** (S1–S6 no PLAN §11.2) e o que o Windows não entrega (sandbox de
   SO) foi **explicitamente não prometido**.
4. **Decisões**: cada bifurcação virou D1–D14 com alternativa descartada e consequência
   (`PLAN.md` §3); o que depende do usuário está em §14.

## 3. Verificações executadas nesta fase

| Verificação | Resultado |
| --- | --- |
| Extração do ASAR do DSH (307 pacotes) | OK — 5.054 arquivos; falha de entradas `link` corrigida no extrator e re-extração completa |
| Coerência de nomes entre docs (tools, tabelas, eventos, comandos, fases) | OK após revisão: 18 tools na v1.0, 5 tabelas + 3 colunas, 11 eventos, ~37 comandos na v1.0, fases F0–F8 |
| Links internos (`docs/research/*` citados em GOAL/PLAN/HARNESS/TOOLS/WORKBENCH) | OK — os 5 arquivos existem e estão completos |
| Referências ao que já existe (arquivos/linhas citados) | OK — citações vêm do mapa de integração (leitura direta do código) |
| Números do plano (deps, MSRV, crates) | Cruzados com `workspace-runtime-options.md` (§0/§14) e `src-tauri/Cargo.toml` (rust-version 1.77 → 1.89) |
| Código de produção alterado | **Nenhum** (`git status` só mostra `docs/`) |
| Build/testes | Não aplicáveis (nenhuma compilação envolvida) |

## 4. Limitações e riscos desta fase

- **Não houve implementação nem spike executado**: os spikes S1–S6 (ConPTY, Job Objects, git CLI,
  watcher, escrita atômica, busca em repo grande) são pré-requisitos de promessa das fases
  correspondentes e estão registrados com critério de aceite.
- **Estimativas** são ordens de grandeza para 1 dev sênior; com time paralelo, o caminho crítico é a
  Fase 0 (contratos) e os spikes.
- **Paseo**: a pesquisa externa usou `web_fetch` (o `web_search` estava sem API key na sessão do
  analista); lacunas estão marcadas no §9 do documento.
- **DSH**: o mapa é baseado nos READMEs oficiais dos pacotes extraídos do app instalado; não houve
  execução do DSH para observar comportamento em runtime (o que não era necessário: o contrato
  documentado é detalhado).
- **Decisões pendentes do usuário** (`PLAN.md` §14): seguem as recomendações registradas até que
  sejam confirmadas; nenhuma delas bloqueia o início da Fase 0 (que é agnóstica a todas).

## 5. Próximo passo

Confirmar `PLAN.md` §14 → iniciar **Fase 0** (`PLAN.md` §7) com o primeiro PR em 8 passos
(`PLAN.md` §9.3), criando as tasks compartilhadas por área e mantendo Chat/Code verdes a cada PR.
