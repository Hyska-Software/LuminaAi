# Paseo — anatomia do workbench e padrões para o harness de código do Lumina

> **Status**: pesquisa concluída em **2026-10-27** (America/Sao_Paulo); insumo para o PLAN do harness
> de código nativo — **não** é plano de implementação. **Objeto**: Paseo, app de referência do layout
> Code (`docs/goals/chat-code-layout/PLAN.md` §3). Versão no site: **0.13.2**; o changelog já lista
> **0.14.0-beta.1** (27/10/2026). As capturas locais mostram o app **em pt-BR**; a doc pública é em
> inglês (site também em zh-CN).
>
> **Método**: `web_search` indisponível (sem API key) → evidência externa via `web_fetch` em fontes
> primárias (site, `public-docs/*.md`, README, changelog, config) e `read_image` nos PNGs.
> **Convenção**: ✅ fonte primária; 📷 observado no PNG (medida visual sujeita a erro); ⚠️ não
> verificado; 🧪 hipótese. Nas tabelas, "Evidência" usa ✅/📷 + versão; as URLs estão no §9.
>
> **Regra de ouro**: o Paseo é um *control plane* de agentes de terceiros; o Lumina quer um *runtime
> próprio*. Copiar a tela sem o modelo de execução promete o que o backend não faz; copiar a
> arquitetura inteira é caro. Este documento separa **dados/UX** (copiar) de **execução/plataforma**
> (não copiar).

---

## 0. TL;DR

- Paseo é um **ambiente de desenvolvimento agêntico** open source (Apache-2.0, ~22,2k estrelas, feito
  por uma pessoa e patrocinado pela comunidade): um **daemon** roda agentes de código de terceiros e
  clientes desktop/mobile/web/CLI se conectam a ele.
- **Não implementa um agente**: *"Paseo manages other agents, it doesn't ship one"*. Inteligência,
  ferramentas e permissões vêm do CLI que o usuário instalou.
- Workbench organizado **por workspaces, não por chats**: projeto → workspace (diretório, `local` ou
  `worktree`) → sessões em abas → turnos.
- O eixo de valor é **revisar e fechar trabalho**: diff por arquivo, barra de commit com seletor +
  `+N/−N`, mensagem de commit gerada por modelo, push/PR, *Changes* com "All changes" desde a base.
- UI **compacta e orientada a estado**: status dots, "Working / Ready to review / Done", "Trabalhou
  por 4m 29s", medidores de contexto e cota (5h/semana/mês).
- 📷 Captura: **~72 px de chrome no centro** (2 linhas de ~36 px), sidebar **~272 px**, painel
  **~600 px**, janela **1919×1031**. O Lumina fase 1 gasta 56+44+40 px (title bar/header/abas) no
  mesmo eixo — há espaço vertical a recuperar.
- **Copiar**: `workspace → sessão → turno → alterações → commit`, com estados explícitos e a barra de
  commit como fecho. **Não copiar**: daemon + CLIs externos e a amplitude de produto (40+ providers,
  plugins, mobile, web, voz). Detalhe no §8.

---

## 1. O que é o Paseo e como executa

Paseo se define como *"the agentic development environment"*: rodar vários agentes ao mesmo tempo, em
qualquer máquina, do desktop e do celular ([home](https://paseo.sh)). O GitHub resume: *"One interface
for Claude Code, Codex, Copilot, OpenCode, Pi, Antigravity, and Muse Code agents"*, com editor,
terminais, diffs, PRs e browser na mesma janela, agentes em **worktrees** separadas, orquestração
embutida, CLI, SDK TypeScript e app mobile nativo ([README](https://github.com/getpaseo/paseo)).
Apache-2.0, sem telemetria nem login obrigatório.

| Peça | Papel | Evidência |
| --- | --- | --- |
| **Daemon** (`packages/server`, Node/TS) | Dono de agentes, workspaces, git, MCP e API WebSocket; roda na máquina do usuário (ou servidor/Docker). | ✅ README, docs |
| **Desktop** (`packages/desktop`, Electron) | Cliente; empacota e sobe o daemon local sozinho. | ✅ README |
| **Mobile/web/CLI/SDK** | Clientes do **mesmo** daemon; o daemon pode servir o web app. | ✅ Why Paseo?, Configuration |
| **Hosts + relay** | Daemon por TCP/Tailscale/SSH/relay; agentes delegam para outra máquina; relay E2E em Elixir. | ✅ Changelog 0.13 |
| **Estado** | `PASEO_HOME` (default `~/.paseo`), `config.json`, worktrees em `~/.paseo/worktrees`. | ✅ Configuration |

Ponto central: **o daemon orquestra processos; não é o agente**. Cada sessão é um subprocesso do CLI
externo, com o estado da conversa no próprio CLI; o daemon normaliza eventos, guarda transcript e
libera runtimes ociosos após 1 h, retomando na próxima mensagem.

Pré-requisitos: ao menos um CLI instalado/autenticado e `gh` autenticado para worktrees "PR-aware".
Claude Code roda via CLI oficial/Agent SDK com a assinatura do usuário, sem cobrança extra; Codex usa
o CLI oficial e o app-server. O app é internacionalizado (0.13 corrige traduções e carrega só o idioma
selecionado); as capturas estão em pt-BR com resíduos em inglês (§5.2).

---

## 2. Anatomia do workbench

### 2.1 Regiões observadas 📷

```
1919×1031, frameless (controles da janela na 1ª linha)
┌ sidebar ~272 ─────────────┬ centro ~1045 ─────────────────────────────┬ painel ~600 ────────┐
│ + Novo workspace           │ ▣ título do workspace  ⬡ projeto   … [Commit▾] [▯] │ Arquivos Alterações +│
│ ↻ Histórico ⌕ Buscar ⌗ Ag. │ ✎ Novo Agente │ ▣ agente ativo │ +                  │ main ▾               │
│ Workspaces            ⚙︎  │ transcript (headings, listas, chips inline)       │ Sem commit ▾ +461 −0 │
│ ◈ SpectraLang              │ ⧉ Trabalhou por 4m 29s                            │ ▾ docs/performance   │
│  • Plan STD… Oct 20 (ativo)│ (+52.1k −2.6k)                                    │   ⑂ arquivo.md +461 −0│
│  • Analyze… Oct 9          │ ┌ composer ──────────────────────────────────────┐│ › Commits            │
│ ▣ erp ◉ Hyscode ◧ RUST CRM │ │ Envie… @files /commands /skills                ││                      │
│ ◎ 0% 5h 0% wk •• 29% mo    │ │ + MiMo-V2.6-Flash ▾ 🛡 Build ▾ ⚙︎      🎤 〜 ◉ ││                      │
│ [folder+] [clock] [pane] ?⚙│ └────────────────────────────────────────────────┘│                      │
└────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────┘
```

Centro com **duas faixas de ~36 px** (workspace e abas) e transcript começando ~72 px abaixo do topo.
O `Commit` aparece **duas vezes** (faixa do workspace e painel direito), com o seletor de commit
desambiguando. A janela é frameless e os controles de janela ficam na linha das abas do painel — não
copiar essa dependência (§5.8).

### 2.2 Camadas, do macro ao micro

| Camada | O que é no Paseo | Onde aparece | Evidência |
| --- | --- | --- | --- |
| **Projeto** | Repositório git, projeto GitHub ou diretório na máquina do daemon. | Sidebar, agrupando workspaces. | ✅ Workspaces |
| **Workspace** | *"O lugar onde a tarefa acontece"*: diretório + branch opcional; contêiner estável de sessões; isolamento `local`/`worktree`. | Faixa de topo do centro (título + chip do projeto) e item da sidebar. | ✅ Workspaces |
| **Sessão/aba** | Agente, terminal, browser, arquivo ou diff — abas tipadas; mais de um agente por workspace. | Faixa de abas; `+` cria; abas restauradas. | ✅ Workspaces |
| **Turno** | Execução do CLI com prompt: texto, ferramentas, perguntas, subagentes, resumo "Worked for". | Timeline normalizada + "Trabalhou por…". | ✅ Orchestration |
| **Alterações** | Diff da working tree, de um commit, ou "All changes" desde a base. | Aba **Alterações**, por arquivo, `+N/−N`. | ✅ Parallel tasks |
| **Commit** | Alvo ("Sem commit" = nenhum), contadores, ação, mensagem gerada, push/PR. | Barra de commit + `Commit` na faixa + `Commits` colapsado. | ✅ Changelog 0.11 |

Fluxo: criar workspace → rodar agentes → revisar diff e testar → corrigir → commitar/PR → arquivar
(teardown/remoção do worktree).

### 2.3 Turno, composer, painel e sidebar

- **Turno** 📷: markdown com headings grandes, listas aninhadas e **chips de código inline**; abaixo,
  "**Trabalhou por 4m 29s**" e **badge de tokens** `+52.1k −2.6k` acima do composer. ✅ "Worked for"
  localizável, anel de contexto antes do 1º turno e colapso de turnos concluídos (0.11/0.14). A
  semântica do badge é 🧪.
- **Composer** 📷: caixa alta, borda sutil, placeholder "**Envie uma mensagem ao agente, marque @files
  ou use /commands e /skills**" + "**Ctrl+L para focar**"; barra inferior com `+`, modelo
  ("MiMo-V2.6-Flash ▾"), modo/permissão ("Build ▾"), ajustes; à direita voz/enviar. ✅ 0.14 confirma
  Enter vs ⌘Enter, recall com ↑/↓ e long-press em Enviar para **enfileirar**.
- **Painel direito (Explorer)** 📷: abas **Arquivos / Alterações** (`+`), branch, commit ("Sem commit
  ▾ +461 −0", refresh, `⋯`), árvore por pasta com contadores, **Commits** colapsado. ✅ Abas como abas
  de workspace (arrastar/fechar), "All changes" padrão desde 0.13, **Send feedback** no diff vira
  mensagem ao agente (0.12).
- **Sidebar** 📷: topo `+ Novo workspace`, `Histórico`, `Buscar`, `Agendamentos`; seção `Workspaces`
  (opções de exibição) por projeto; rodapé com `0% 5h · 0% wk · 29% mo` e régua de ícones. ✅ Usage
  dialog (0.11), resumo opt-in, "usado vs restante" (0.13), ordenação por criado/último prompt/manual.

---

## 3. Multiagentes e multi-harness: como o Paseo modela

### 3.1 O contrato de provedor

> "A provider is the contract between Paseo and one external agent CLI: how to launch it, how to
> stream its output, how to send input back, what modes it supports. The actual binary lives on your
> machine and runs as a normal subprocess." — [Providers](https://paseo.sh/docs/providers)

≈7 dimensões: launch, stream de eventos, input/steering, modos, catálogo de modelos, permissões e
histórico/retomada. Em cima vêm *provider options*, *agent profiles* e *hosts*.

### 3.2 Dois níveis de suporte

| Nível | Como funciona | Exemplos |
| --- | --- | --- |
| **Nativo** ✅ | Adaptador empacotado, auto-descoberto quando o CLI existe; metadados de modo/voz. | Claude Code (Agent SDK), Codex (app-server), OpenCode, Pi, Antigravity (`agy`), Muse Code. |
| **ACP (catálogo)** ✅ | Adaptador genérico para quem fala **Agent Client Protocol**; catálogo 1-clique + adição manual. | Cursor, Gemini CLI, Copilot, Qwen Code, Kimi, Grok, goose, Amp, Factory Droid… (30+). |

O usuário instala o CLI; o Paseo nunca embute o agente. Exceção: Antigravity dirige `agy` com
`--dangerously-skip-permissions`, sempre "Full access", com aviso a cada sessão.

### 3.3 Configuração, orquestração e isolamento

- **Agent profiles**: nome + provider + modelo + modo + thinking + features + **"When to use"**, notas
  que um agente orquestrador lê para escolher a configuração do worker ("UI work", "Planning",
  "Review").
- **Orquestração**: MCP tools opt-in deixam o agente listar providers, criar workspaces/worktrees,
  lançar agentes, mandar prompt por ID, acompanhar/coletar resultado e agendar. Workers aparecem na
  **Subagents track** perto do composer; o pai é notificado no fim. Skills
  `/paseo-handoff|advisor|committee` ensinam o fluxo.
- **Schedules/heartbeats**: cron cria agente novo ("archive on finish" por padrão); heartbeat reenvia
  prompt ao mesmo agente.
- **Isolamento**: `local` ou `worktree` (diretório+branch gerenciados, `setup`/`teardown`, scripts,
  serviços com porta própria e proxy reverso). Worktree **não é sandbox**: compartilha portas, rede,
  credenciais e caches da máquina.
- **Multi-host**: agente cria/prompta/monitora agentes em outra máquina (0.13).

### 3.4 Implicações para o Lumina

| Dimensão | Paseo | Lumina (hoje/proposto) | Consequência |
| --- | --- | --- | --- |
| Loop do agente | CLI externo por subprocesso | Harness Rust próprio (`run_turn`, tools, prompt) | **Não** copiar provider em nível de processo; o Lumina já é dono do loop. |
| Histórico | No CLI; daemon normaliza/importa | SQLite + `provider_state` com replay | Base melhor (timeline tipada/persistente). Vantagem. |
| Ferramentas/permissões | Do CLI (varia por provider) | Do harness (tools + gate de `run_code`) | Mais simples/auditável; falta UI de aprovação. |
| Streaming | Eventos heterogêneos normalizados | `ProviderEvent`/`TurnEvent` incrementais | A abstração necessária é de **timeline**, não de processo. |
| Multi-modelo | Catálogo por provider + profiles | Catálogo de 4 protocolos + menu | Profile é aproveitável; "provider" já existe em outro nível. |
| Multiagente | Subagentes cross-provider + worktrees + hosts | Não existe | Prever o *seam* (`AgentRunner`/subagent) cedo. |
| Plataforma | daemon + desktop + mobile + web + CLI + SDK + plugins + Hub | 1 app desktop Tauri | Manter 1 cliente é vantagem, não dívida. |

**Recomendação**: manter o harness nativo como único executor e desenhar um **seam interno** de runner
só se/quando houver motivo (rodar Claude Code/Codex como agentes externos, subagentes). O contrato pode
espelhar os 7 eixos do Paseo, mas com eventos tipados do Lumina — não parsers de stdout alheios.

---

## 4. Features × veredito para o Lumina

"Lumina hoje" = layout Code fase 1: sessões separadas por layout, abas de conversa, painel
Arquivos/Alterações com estados vazios honestos, barra "Sem commit +0 −0" com Commit desabilitado,
sidebar com placeholder de Workspaces (`docs/goals/chat-code-{layout,sessions}/PLAN.md`,
`src/components/code/**`).

### 4.1 Workspace, navegação e estado

| Feature (Paseo) | Evidência | Lumina hoje | Veredito | Justificativa |
| --- | --- | --- | --- | --- |
| Workspace como contêiner (diretório+branch+status) separado de agente | ✅ Workspaces | Placeholder | **Sim** | Conceito que falta; sessão precisa apontar para diretório real. |
| Sidebar projeto → workspaces | 📷 | Sessões por data | **Sim** (após 1) | Sem isso, N repositórios viram lista plana. |
| Agrupamento por estado (Working/Ready to review/Done, pin) + dots | 📷 site, 0.13 | Só ponto ativo/inativo | **Sim** (fase 2) | Estado é o dado mais escaneável; data é ruído com 10 agentes. |
| Command Center (workspaces, agentes, arquivos, atalhos) | ✅ 0.12/0.13 | Paleta existente | **Sim** (extensão) | Indexar workspaces/arquivos e ações de código. |
| Abas de sessão por workspace, restauradas entre reinícios | ✅ 0.13 | Abas locais, não persistem | **Sim** | Persistência barata; já é limitação documentada. |
| Abas heterogêneas (agente/terminal/browser/arquivo/diff) | ✅ docs | Só conversas | **Depois** | Exige modelo de pane/tab maior. |
| Isolamento local vs worktree (+setup/scripts/serviços) | ✅ Worktrees | — | **Depois** | Alto valor para paralelismo; depende de git, `.env` e portas. |
| Background workspaces e "Show background" | ✅ 0.12 | — | **Depois** | Só faz sentido com concorrência + notificações. |
| Histórico de workspaces arquivados | ✅ 0.12 | Histórico de conversas | **Depois** | Arquivar ≠ excluir; útil quando worktrees forem removidos. |
| Notificações de fim de turno / input / erro | ✅ changelog | — | **Sim** | Agente demora minutos; sem isso o usuário vira "babá" de aba. |

### 4.2 Conversa, turno e composer

| Feature (Paseo) | Evidência | Lumina hoje | Veredito | Justificativa |
| --- | --- | --- | --- | --- |
| Timeline normalizada (texto, tool rows, thoughts, perguntas, subagentes) | ✅ Orchestration | Mensagens + tool calls tipadas | **Sim** (paridade) | Base já melhor; padronizar "item de timeline". |
| "Trabalhou por Xm Ys" + turno colapsável | 📷 0.11/0.14 | Sem marcador de turno | **Sim** | Fecha o turno e resolve transcript longo. |
| Badge de tokens/contexto por turno | 📷 0.11 | `PlanUsageChip` global | **Sim** (parcial) | Contexto é o recurso escasso; mostrar por sessão e por turno. |
| Medidores de cota 5h/semana/mês + diálogo Usage | 📷 0.11/0.13 | Chip de plano | **Sim** | Chip vira diálogo com janelas por provedor/conta. |
| Composer com @files, /commands, /skills e atalho de foco | 📷 0.14 | Anexos; sem @arquivo | **Sim** | Falta autocomplete de arquivos do workspace. |
| Seletor de modelo **e** de modo/permissão no composer | 📷 | Menu de modelo | **Sim** (modo) | Modo (plan/build/auto) precisa existir antes do harness. |
| Fila de mensagens e steering mid-turn | ✅ 0.14 | Envio durante streaming? (validar) | **Sim** | Evita cancelar turno para corrigir rumo. |
| Recall de mensagens (↑/↓ no composer vazio) | ✅ 0.14 | — | **Depois** | Barato, mas não bloqueia o harness. |
| Collapse/expand de turnos concluídos | ✅ 0.14 | — | **Depois** | Melhora sessões longas; junto do marcador de turno. |
| Perguntas estruturadas e aprovações inline | ✅ 0.11/0.14 | — | **Sim** | O harness vai pedir permissão/opções; card tipado > texto solto. |

### 4.3 Git, revisão e entrega

| Feature (Paseo) | Evidência | Lumina hoje | Veredito | Justificativa |
| --- | --- | --- | --- | --- |
| Árvore de arquivos do workspace | 📷 0.13 | Estado vazio | **Sim** | Peça central; leitura de diretório é escopo do harness. |
| Diff por arquivo `+N/−N`, agrupado, "All changes" desde a base | 📷 0.13 | Estado vazio | **Sim** | É o "produto" da sessão; sem diff revisável o commit é fé. |
| Barra de commit: alvo, contadores, ação Commit | 📷 0.12 | Botão desabilitado | **Sim** | Já desenhada; funciona quando o git existir. |
| Mensagem de commit gerada por modelo (e branch/PR) | ✅ 0.11 | — | **Sim** | Alto valor, baixo custo; o Lumina já tem modelos. |
| Push / PR / status de checks | ✅ 0.11/0.13 | — | **Depois** | Depende de remoto e `gh`; começar por commit local. |
| Send feedback no diff (comentário vira prompt) | ✅ 0.12 | — | **Depois** | Exige diff interativo; fase 2 do git. |
| Terminal por workspace | 📷 docs | — | **Depois** | Diferencial para builds/testes, não pré-requisito do commit. |
| Browser embutido + automação | ✅ Browser | — | **Não** | Escopo enorme e independente do harness. |
| Setup/teardown/scripts/serviços/portas | ✅ Worktrees | — | **Não** | Específico de worktree/JS; ruído agora. |
| Import de sessão de CLI externo | ✅ 0.12/0.13 | — | **Não** | Feature de migração; o Lumina não usa CLIs externos. |

### 4.4 Plataforma e extras

| Feature (Paseo) | Evidência | Lumina hoje | Veredito | Justificativa |
| --- | --- | --- | --- | --- |
| Schedules (cron) e heartbeats | ✅ Schedules | — | **Depois** | Alto valor, exige harness estável + executor em background. |
| Subagentes/orquestração | ✅ Orchestration | — | **Depois** | Prever o seam no harness; UI depois. |
| Agent profiles | ✅ Agent profiles | Menu de modelo | **Depois** | Útil com muitos modelos/modos. |
| Plugins (telas, sidebar, comandos, painéis, providers) | ✅ Plugins | — | **Não** | Plataforma dentro da plataforma. |
| Mobile/web/CLI/SDK + hosts remotos | ✅ Why Paseo? | App desktop único | **Não** | A vantagem do Lumina é ser local. |
| Voz (ditado/TTS) | ✅ Voice | — | **Não** | Fora do escopo. |
| i18n completa | ✅ 0.13/0.14 | pt-BR por decisão | **Não** | Custo permanente; manter pt-BR + glossário (§5.2). |
| Multi-provider de **agentes** | ✅ Providers | Harness nativo | **Não** (base) | Ver §3.4; seam de runner sem virar catálogo. |
| Sem telemetria / login obrigatório | ✅ README | Já é o modelo | **Sim** (manter) | Paseo prova que é viável e valorizado. |

---

## 5. Lições de UX (referências aos PNGs)

### 5.1 Densidade e hierarquia

📷 Três colunas nítidas (272/~1045/~600 px), duas faixas de chrome de ~36 px e transcript a ~72 px do
topo. Hierarquia por **contraste e espaço**, não por caixas: quase sem cards; linhas de 28–32 px;
bordas de 1 px; micro-rótulos 11 px, itens 12–13 px; transcript 15–16 px com headings grandes. Para o
Lumina: fundir header+abas em ~36–40 px devolve ~40 px de transcript sem tocar em tokens.

### 5.2 Microcopy, estados e idioma

Strings 📷: "+ Novo workspace", "Histórico", "Buscar", "Agendamentos", "Workspaces", "Arquivos",
"Alterações", "Sem commit", "Commits", "Trabalhou por 4m 29s", "Envie uma mensagem… @files /commands
/skills", "Ctrl+L para focar".

- **Honestidade do estado**: "Sem commit" (não "0 commits") e "Commits" vazio colapsado não inventam
  dados. O Lumina fase 1 já acerta; o harness deve manter: "Sem alterações", "Sem commits ainda".
- **Mistura de idiomas é dívida visível**: a captura traduz verbos mas mantém "Workspaces",
  "Commits", "Build" ⚠️. O Lumina é pt-BR por decisão: fixar **glossário** (workspace? sessão? agente?
  commit/branch/diff/PR) e aplicá-lo em empty states, toasts e tooltips.
- **Orientação no texto**: "Aumente a janela…" (Lumina) e o aviso "Full access" (Paseo) mostram que o
  texto ensina o modelo mental.

### 5.3 Transcript e turno

📷 Resposta densa e escaneável: headings, listas, **chips inline**, negrito para módulos; fecho
"Trabalhou por 4m 29s" e badge de tokens. Padrões: (1) fecho de turno explícito dá tempo/custo; (2)
conteúdo técnico como conteúdo (chip inline > bloco mono para tudo); (3) resposta final demarcada —
pré-requisito para colapsar turnos sem confundir narração com resultado.

### 5.4 Composer

📷 Maior alvo da tela, borda sutil, sem sombra; placeholder com três dicas e atalho de foco; barra
inferior com poucos controles agrupados por função. No Lumina falta autocomplete de `@`arquivos,
seletor de modo ao lado do modelo, fila/steering e atalho de foco. `@files`/`/commands` são **sintaxe**:
não anunciar antes de o harness suportar.

### 5.5 Barra de commit e painel de revisão

📷 Abas Arquivos/Alterações, branch, **seletor de commit alvo** com `+461 −0`, refresh, `⋯`, árvore por
pasta com contadores, **Commits** colapsado; `Commit` também na faixa do workspace (duplicação
proposital, com o seletor desambiguando). O `CodePanel` do Lumina já espelha essa anatomia: trocar
estados vazios por dados reais, habilitar o seletor, adicionar refresh e histórico. ⚠️ Controles de
janela dentro do painel (frameless): não copiar.

### 5.6 Medidores de uso

📷 `0% 5h · 0% wk · 29% mo` no rodapé, com ícone de provedor. ✅ Usage dialog com janelas por conta,
resumo opt-in, descoberta de logins Claude/ChatGPT e "usado vs restante" (0.11–0.13). O Lumina já tem
`PlanUsageChip`; levar: mostrar o recurso escasso onde se decide, detalhar sob demanda, rotular
"usado/restante" e incluir **contexto da sessão** + custo do turno — o limite real é contexto/orçamento.

### 5.7 Status e agrupamento

O site ilustra **Pinned / Ready to review / Working / Done** + tempos relativos; o changelog confirma
status ring, status de workspace e ordenação configurável. A captura local agrupa por **projeto** com
data — duas organizações ⚠️. No modo Code, **estado > data**: Working/Ready to review/Done serão
estados produzidos pelo harness de qualquer forma.

### 5.8 O que não copiar na UX

1. Sidebar com três níveis + 4 ações + medidor + 5 ícones sem rótulo (mais superfície = mais ruído).
2. "Novo Agente" como aba de rascunho (o Lumina já usa `+` e welcome state).
3. Duplicação de commit sem hierarquia e mistura de idiomas (§5.2, §5.5).
4. Controles de janela dentro do header do painel (frameless).
5. Tipografia de 11 px em ações: 11 px só para seções; ações 12–13 px.

---

## 6. Estado do Lumina × Paseo

| Área | Lumina fase 1 | Gap principal |
| --- | --- | --- |
| Modos Chat/Code | Pílula, `layoutMode` persistido, atalhos | Nenhum; o Paseo não tem esse eixo. |
| Sessões | Duas listas, `codeLinked`, `activeIdByLayout`, abas locais | Falta **workspace**; persistir abas. |
| Sidebar Code | Ações, placeholder de Workspaces, sessões | Dados reais; status; uso opcional. |
| Centro | Header alto + abas + ChatView | Header mais baixo; abas ligadas a workspace. |
| Painel direito | Arquivos/Alterações, empty states, "Sem commit" | Anatomia pronta; faltam árvore/diff/commit reais. |
| Uso | `PlanUsageChip` | Janelas/contexto/tokens por turno. |

**Conclusão**: o layout Code é uma boa casca, mas sem **workspace** é um chat com abas e dois painéis
vazios. O incremento de maior alavancagem não é visual: (1) workspace + diretório real, (2) árvore de
arquivos, (3) diff + commit local, (4) marcador de turno. O resto da tela aguenta.

---

## 7. Riscos e limites do modelo do Paseo

1. **Dependência de CLIs de terceiros**: instalação, login, versão, flags, eventos e permissões são do
   CLI. O changelog é dominado por correções por provider e workarounds ("Claude Code sessions
   consuming subscription limits faster", tool calls >30 s virando subagentes). Motivo para o Lumina
   **não** adotar o modelo como base.
2. **Replay/estado**: histórico vive no CLI; Antigravity "start fresh" após restart porque `agy` não
   reproduz histórico; imports grandes travavam o daemon; abas no workspace errado (0.13). O Lumina tem
   base melhor (SQLite + `provider_state`/`:trace`), se tratar tool calls e checkpoints como dados de
   primeira classe.
3. **Isolamento de arquivo, não de processo**: worktree separa branch/arquivos, mas portas, rede,
   credenciais e caches são da máquina; `.env` e dependências exigem `setup`. Com paralelismo, o mínimo
   é workspace por diretório + processos gerenciados.
4. **Segurança/permissões**: agente roda com credenciais do usuário; providers vão de "pergunta" a
   "full access", e plugins têm acesso ao daemon/clientes. O harness precisa de aprovação explícita,
   escopo de diretório, timeout/cancelamento e auditoria.
5. **Amplitude = custo permanente**: 40+ providers, ACP, plugins/registry, mobile/web/CLI/SDK, Hub,
   voz, i18n, hosts, worktrees/scripts/portas. O Paseo investiu 14 versões; o Lumina deve escolher um
   subconjunto e **registrar o "não"** no PLAN.
6. **Atenção/concorrência**: vários agentes geram fila de decisões; sem status/notificações, "rodar 5
   agentes" vira 5 abas piscando.
7. **Não são riscos**: não ter daemon remoto/mobile/plugins/40 providers é escolha e reduz superfície.

---

## 8. Recomendações para o PLAN

### 8.1 Copiar (5 padrões)

1. **Workspace como contêiner de primeira classe** (diretório + branch + status + projeto), com
   sessões/abas dentro — não uma conversa com metadados.
2. **Fecho do fluxo em três superfícies**: árvore → diff por arquivo `+N/−N` → barra de commit
   (alvo/contadores/ação) + commits recentes. É o que transforma o modo Code em workbench.
3. **Marcador de turno** (tempo + tokens/contexto, colapsável) e **medidores de recurso** no chrome —
   resolve transcript longo e custo invisível.
4. **Composer como console de tarefa**: `@arquivos`, `/skills`, modelo **e** modo/permissão, atalho de
   foco, fila/steering.
5. **Estado explícito e honesto**: status Working/Ready to review/Done, empty states que dizem o que
   falta e por quê, notificações de fim/erro/input.

### 8.2 Não copiar (3 anti-padrões)

1. **Daemon + CLIs externos** (catálogo de providers, hosts, mobile/web, import): duplicaria estado e
   criaria dependência de terceiros.
2. **Plugins + 40 providers + browser/voz**: superfície e custo permanentes, desproporcionais.
3. **Densidade de chrome do Paseo** (3 níveis de sidebar, ícones sem rótulo, abas heterogêneas,
   controles de janela no painel, mistura de idiomas): copiar a informação sem a compressão.

### 8.3 Decisões que o PLAN precisa fechar

1. **Workspace**: campos (`path`, `gitRoot`, `branch`, `status`, `projectId`), ciclo de vida e relação
   com `mode`/`codeLinked`.
2. **Onde rodam git/diff**: comandos Rust (sem `gh` no início), leitura e formato do diff no IPC.
3. **Permissões do harness**: por ferramenta/workspace/global; question card na timeline + resposta.
4. **Turno**: início/fim, duração, tokens, resultado e o que persistir para colapsar/retomar.
5. **Persistência de abas e sessão ativa por layout** (limitação conhecida da fase 1.1).
6. **Escopo explícito de "não"**: terminal, browser, worktree, PR, voz, i18n, plugins.

---

## 9. Fontes e lacunas

**Primárias (abertas em 2026-10-27)**: [site](https://paseo.sh) ·
[README/repo](https://github.com/getpaseo/paseo) · [Getting started](https://paseo.sh/docs) ·
[Why Paseo?](https://paseo.sh/docs/why) · [Workspaces](https://paseo.sh/docs/workspaces) ·
[Git worktrees](https://paseo.sh/docs/worktrees) ·
[Run parallel tasks](https://paseo.sh/docs/parallel-development) ·
[Providers](https://paseo.sh/docs/providers) ·
[Supported providers](https://paseo.sh/docs/supported-providers) ·
[Claude Code](https://paseo.sh/docs/claude-code) · [Codex](https://paseo.sh/docs/codex) ·
[Schedules](https://paseo.sh/docs/schedules) · [Orchestration](https://paseo.sh/docs/orchestration) ·
[Agent profiles](https://paseo.sh/docs/agent-profiles) · [Plugins](https://paseo.sh/docs/plugins) ·
[Configuration](https://paseo.sh/docs/configuration) · [Voice](https://paseo.sh/docs/voice) ·
[Changelog 0.11–0.14.0-beta.1](https://paseo.sh/changelog).

**Locais**: `docs/goals/chat-code-layout/{GOAL,PLAN,EVIDENCE}.md`,
`docs/goals/chat-code-sessions/{GOAL,PLAN,EVIDENCE}.md`, `src/components/code/**`,
`refs/paseo-reference.png` e `refs/crops/01…10-*.png`.

**Lacunas ⚠️**: (a) versão exata do app nas capturas (provavelmente 0.11–0.13); (b) semântica do badge
`+52.1k −2.6k` e dos `••` entre janelas (🧪); (c) pt-BR não consta na doc pública (só EN/zh-CN); (d) não
confirmei se o agrupamento por estado do mock do site é da mesma versão da captura; (e) sem
`web_search`, não houve reviews de terceiros — alegações de adoção vêm do próprio projeto.
