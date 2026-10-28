# Lumina — Design & UI/UX

## 1. Direção

Lumina é um chat de IA **calmo, preciso e premium**, inspirado na hierarquia do ChatGPT e na contenção visual do Claude, com identidade própria: a marca Lumina — símbolo violeta `#6446FB` com spark vazado sobre tile grafite-claro `#EBEBEB` — usada apenas em momentos de marca (logo, avatar do assistente, splash, Sobre).

Princípios:
- **Conteúdo primeiro**: a conversa ocupa o centro, sem molduras pesadas. Superfícies neutras, bordas de 1px, sombras suaves.
- **Movimento discreto**: transições de 150–260ms, ease-out; nada de bounce exagerado. Respeitar `prefers-reduced-motion`.
- **Densidade confortável**: linha de texto 1.7, blocos de 12–20px de respiro; máximo de largura de leitura 768px.
- **Feedback imediato**: toda ação tem estado (hover, active, loading, streaming, erro).
- **Acessibilidade**: foco visível, navegação por teclado completa, ARIA em diálogos/menus, contraste AA.

## 2. Identidade

| Token | Valor |
| --- | --- |
| Nome | Lumina |
| Símbolo | dois balões estilizados formando um "L" com um spark de 4 pontas vazado, em `#6446FB` |
| Ícone | o mesmo símbolo sobre tile grafite-claro `#EBEBEB` (cantos arredondados, bordas transparentes) |
| Arquivos | `assets/Logo Lumina.png`, `assets/LogoLuminaSemFundo.png`, `assets/LogoLuminaSVG.svg` (originais); vetores usados pelo app em `public/brand/lumina-tile.svg` e `public/brand/lumina-mark.svg` |
| Uso | tile → ícones do app (instalador, taskbar, janela) e favicon; marca sem fundo → titlebar, avatar do assistente, boas-vindas, splash e Sobre |
| Voz | português brasileiro, direta, sem excesso de exclamações; termos técnicos em inglês quando consagrados |

## 3. Paleta (tokens em `src/styles/globals.css`)

| Token | Light | Dark |
| --- | --- | --- |
| background | `#ffffff` | `#17171a` |
| surface (sidebar) | `#f7f7f8` | `#101012` |
| surface-raised | `#ffffff` | `#1e1e22` |
| surface-hover | `#f0f0f2` | `#242429` |
| foreground | `#0e0e11` | `#ececf1` |
| foreground-muted | `#5f6066` | `#a1a1ab` |
| foreground-subtle | `#8b8c93` | `#6f6f7a` |
| border | `#e8e8ec` | `#28282e` |
| border-strong | `#d9d9e0` | `#3a3a43` |
| accent | `#6b4eff` | `#8b7bff` |
| accent-soft | `#f1edff` | `#221d3a` |
| success | `#16a34a` | `#4ade80` |
| warning | `#b45309` | `#fbbf24` |
| danger | `#dc2626` | `#f87171` |
| user-bubble | `#f2f2f4` | `#242429` |

Regras: nunca usar hex solto em componentes — sempre `bg-background`, `text-foreground-muted`, `border-border`, etc. A marca é servida como asset vetorial (`public/brand/`, ver §2) e não recebe recolorização por tema; o botão de enviar ativo e o estado "pensando" usam apenas `accent`/`accent-soft`.

## 4. Tipografia

- Família: **Inter Variable** (`--font-sans`), fallback Segoe UI; monoespaçada **JetBrains Mono Variable**.
- Escala: 12 (meta) / 13 (labels) / 14.5 (UI) / 15 (corpo do chat) / 17 (título de diálogo) / 20–24 (títulos de tela) / 32 (hero).
- Títulos com `tracking-tight` (-0.011em); corpo 1.7; tabelas 13px.
- Números tabulares em métricas (`tabular-nums`).

## 5. Layout

```
┌──────────────────────────────── janela (1320×860) ────────────────────────────────┐
│ TitleBar 56px: chrome · drag region · marca · [Plano ChatGPT · Gerenciar uso]* ·    │
│               [busca ⌘K] · controles de janela                                      │
│               ╭──────────────────────── painel do chat ────────────────────────────│
│ Sidebar 272px │  Chat (max-w-3xl centrado)                    │ Artifact panel    │
│  novo chat    │  mensagens…                                   │ 360–900px, dock   │
│  busca        │                                               │                   │
│  grupos       │  ┌─ Composer (sticky, 2xl, sombra) ─────────┐ │                   │
│  config/perfil│  │ anexos · textarea · tools · modelo · send │ │                   │
└───────────────┴──┴──────────────────────────────────────────┴─┴───────────────────┘
```

- **Chrome contínuo**: topbar e sidebar formam uma única superfície (`bg-surface`), sem linhas divisórias entre si. O chat é um painel `bg-background` com **apenas o canto superior esquerdo arredondado** (`rounded-tl-lg`), encostado nas duas áreas — a divisão é feita só pelo contraste de superfície, sem `border` de 1px. O canto acompanha a borda da sidebar ao abrir/fechar/redimensionar e os painéis laterais à direita não mudam.
- **TitleBar**: 56px, `decorations: false`, `bg-surface` sem borda inferior; arrastável (`data-tauri-drag-region`); controles nativos custom (minimizar/maximizar/fechar) com hover `surface-hover` e fechar em vermelho. Quando a conta conectada está usando o plano ChatGPT, o chrome mostra o indicador **Plano ChatGPT · Gerenciar uso** à direita (antes da busca) — é account-level, por isso vive na topbar e não no composer; sem plano ativo ele não aparece.
- **Sidebar**: 272px (padrão), `bg-surface` (sem borda divisória à direita), colapsável (⌘/Ctrl+B) e **redimensionável** arrastando a borda direita (220–480px, largura persistida; duplo clique restaura 272px; foco no divisor + ←/→ movem 16px, Home/End vão aos limites). Contém: botão "Novo chat" (pill com borda), item **"Biblioteca"** (abre a página de arquivos no lugar do chat; sempre visível), item **"Skills"** logo **abaixo** de Biblioteca (abre a view de gestão no lugar do chat; oculto quando o painel é desativado nas configurações), busca, lista agrupada (Fixadas, Hoje, Ontem, 7 dias, 30 dias, Mais antigas), rodapé com atalho de configurações e versão.
- **Chat**: painel `bg-background` (`rounded-tl-lg`) que recebe a coluna central `max-w-3xl` (768px), padding 24px, espaçamento entre mensagens 28px.
- **Composer**: sticky no rodapé com gradiente de fade; container `rounded-3xl`, borda 1px, fundo `surface-raised`, sombra sutil; cresce até 10 linhas.
- **Artifact panel**: side panel à direita, **redimensionável** arrastando a borda esquerda (360–900px, padrão 480px; largura persistida; duplo clique restaura 480px; divisor focável + ←/→/Home/End) e com **dois modos** alternáveis pelo botão do header (preferência persistida): **sobreposto** (padrão — flutua sobre o chat, slide-in 240ms, largura limitada a `92vw`) e **fixo/docked** (divide a linha com o chat, que reflui e mantém no mínimo 480px; disponível em janelas ≥1120px — abaixo disso cai automaticamente no sobreposto; sem sombra/slide). Em ambos os modos a largura é re-clampada ao espaço disponível quando a janela muda de tamanho. Com dois modos de conteúdo controlados pelo `uiStore`: **lista** — header "Artefatos" com contador, cards compactos por artefato (tipo, nome e tamanho) e estado vazio discreto — e **prévia** — header com nome, tipo, ações (Ver lista, anterior/próximo, Salvar como…, Abrir, Excluir, Fechar) e conteúdo scrollável. O botão "+" do chat abre o painel na lista; clicar em um card ("Abrir") abre a prévia; "Ver lista" volta para a lista. A prévia é específica por tipo (v1.5): **imagem/SVG** com barra de formato + dimensões, zoom (−/+, ajustar à janela, tamanho real), fundo xadrez para transparência e pan por arrasto; **PDF** com navegação de páginas e zoom; **áudio/vídeo** com player nativo e metadados discretos; **ZIP** com resumo e lista de entradas (ícone, nome, tamanho); **binário** com formato detectado e hexdump colapsável (offset + ASCII); **Markdown** com alternância Documento/Código; **JSON** com alternância Árvore/Código (árvore colapsável); **CSV/TSV** em grade com cabeçalho fixo; **código/texto** com syntax highlight, números de linha, contagem de linhas e alternância de quebra de linha. Header do painel mostra tipo (badge), tamanho e linguagem. Estados de carregamento/erro têm spinner e "Tentar novamente"; formatos não suportados caem no cartão com "Salvar como…"/"Abrir" e o motivo.
- **Sources panel**: mesmo painel lateral (mesma largura redimensionável e mesmos modos sobreposto/fixo, alternados pelo mesmo botão do header), aberto pelo botão **+ N fontes** dos chips de citação; header "Fontes" com contador, lista de todas as fontes usadas na conversa (letra/inicial do domínio, domínio e título truncado) que abrem no navegador padrão, estado vazio e rodapé com contagem. É mutuamente exclusivo com o painel de artefatos (abrir um fecha o outro).
- **Página Biblioteca** (`activeView: 'library'`, no lugar da coluna do chat, aberta pelo item "Biblioteca" da sidebar): header com "Voltar ao chat", título **Biblioteca** e descrição curta; à direita, **busca** (pill com ícone e botão limpar), **ordenação** (Recentes/Mais antigos/Nome/Tamanho), alternância **grade/lista** e botão primário **Enviar arquivos** (seletor nativo múltiplo; drag & drop com a página aberta). Abaixo, a faixa de **filtros em pills**: Tudo · Favoritos · Imagens · Documentos · Código · Mídia · Outros, com contagem. O conteúdo é uma **grade** de cards (`auto-fill`, mínimo 180px) ou **lista** de linhas: card com tile do tipo nas cores do design system, nome truncado (até 2 linhas), estrela de favorito, menu de ações (Renomear, Favoritar, Salvar como…, Abrir, Excluir), **miniatura** para imagens (PNG ≤512 px gerada no backend) ou ícone grande do tipo, e rodapé com `tipo · tamanho`, data e origem ("Biblioteca" ou título da conversa). Clicar abre a **prévia em dialog** (mesmos renderizadores do painel de artefatos) com navegação anterior/próximo, favoritar, renomear inline, salvar/abrir/excluir e rodapé "X de N". Estados: carregando (skeleton), erro com "Tentar novamente", biblioteca vazia (CTA Enviar arquivos) e filtro sem resultados ("Limpar filtros"). Sem molduras pesadas, sem tabela burocrática; mesmo sistema visual e tokens do resto do app.
- **Modos da aplicação (Chat | Code)**: a title bar tem uma **pílula segmentada centralizada** (`Chat | Code`, trilho `surface-hover`, segmento ativo `surface-raised` — no tema escuro `surface-active`, para ficar acima do trilho — com `shadow-sm`, texto 13px médio, `rounded-full`, `aria-pressed`), persistida em `uiStore.layoutMode` e também acessível pela paleta ("Ir para o modo Chat/Code"). **As sessões são separadas por layout**: uma conversa nasce no Chat (`mode: 'chat'`, default para dados antigos) ou no Code (`mode: 'code'`) e só aparece no layout de origem; cada layout lembra sua **própria sessão ativa** ao alternar. Uma sessão do Chat pode ser **adicionada ao Code** (`codeLinked: true`) e passa a ser compartilhada (mesma conversa, aparece nos dois layouts, pode ser removida do Code). O **modo Chat** é o layout de conversa descrito acima. O **modo Code** é o workbench de codificação inspirado no Paseo (o harness de agentes entra na etapa seguinte; por ora o que depende dele é estado vazio honesto), com o mesmo chrome contínuo (`bg-surface`) e o painel central `bg-background rounded-tl-lg`:
  - **Sidebar do Code** (mesma largura/redimensionamento/drawer compacto da sidebar do Chat, `aria-label` "Sessões"): ações compactas **+ Abrir pasta** (seletor nativo; cria/abre workspace), **+ Novo agente** (cria sessão `mode: 'code'` no workspace ativo), **Adicionar sessão do Chat**, **Buscar** (paleta) e **Skills**; seção **Workspaces** real (nome, ícone repo/pasta, `branch` + sujo, contagem de sessões, expandir/recolher, ativo destacado; menu **Nova sessão / Renomear / Abrir no Explorer / Copiar caminho / Remover do Lumina** — remover não apaga a pasta) e diálogo **“Confiar nesta pasta?”** (Confiar / Abrir em Leitura / Cancelar); seção **Sessões** agrupada por workspace (sem workspace → “Sem workspace”; compartilhadas do Chat com selo **Do Chat**; cada sessão tem o botão **…** com **Fixar/Desafixar, Renomear, Exportar, Remover do Code** (compartilhadas) e **Excluir** com confirmação, como no layout Chat); estados vazios honestos e rodapé Configurações + versão. **Sem Biblioteca** — a página só existe no modo Chat.
  - **Centro**: cabeçalho da sessão (h≈44px) com título, **chip do workspace** (nome/branch/dirty; menu Atualizar/Trocar workspace/Abrir no Explorer/Copiar caminho/Confiar; “Sem workspace” com CTA), **chip de modo de permissão** (`Leitura`/`Editar`/`Autônomo`, otimista com rollback), **chip Plano** e **medidor de contexto** (`role="progressbar"`), além do botão do painel direito (`PanelRight`, `aria-pressed`); abaixo, **abas de sessão** (`role="tablist"`, h≈40px, abas persistidas por workspace) com abrir/fechar/ativar, `+` e teclado. A conversa é a **mesma `ChatView`** do Chat (rascunho/anexos/scroll preservados); a tela vazia usa o **welcome do Code** (sem workspace: “Comece com uma pasta” + Abrir pasta + recentes; com workspace: caminho/branch + sugestões). O composer é o **console da tarefa**: `@` busca arquivos do workspace (chips + `[arquivo: path]`), `/` abre o catálogo de comandos (`/plan`, `/plan off`, `/permissoes`, `/compact`, `/commit`, `/test`, `/review`, `/init`, `/novo`, `/limpar`), placeholder “Descreva a tarefa… @ para arquivos, / para comandos”, `Ctrl/Cmd+L` foca.
  - **Painel direito do Code** (Arquivos | Alterações; 360–900px, largura persistida compartilhada, divisor acessível, fecha abaixo de 1120px para manter ≥480px de conversa): barra workspace · branch (somente na aba **Alterações**; as abas Arquivos/Terminal não repetem o contexto) e atualizar; **Arquivos** = árvore real (`role="tree"`, badges git `M/A/D/U/?`, filtro, teclado) com **ícones coloridos reais por tipo de arquivo** (Material Icon Theme, MIT — mapa e licença em `docs/FILE_ICONS.md`; pastas continuam no par lucide `Folder`/`FolderOpen` tingido por `accent`) + prévia read-only do arquivo (Prism, binário/truncado/encoding, “Abrir no Explorer”; o header mostra o ícone do tipo); **Alterações** = agrupamentos Preparados/Não preparados/Novos/Da sessão, `+N −M`, cada linha com o ícone do tipo do arquivo, diff por arquivo (unificado, hunks, copiar patch), stage/unstage e reverter arquivo/turno com confirmação, rodapé de **commit** (alvo, mensagem, sugestão de IA, histórico). **Histórico de commits** (estilo Zed): a aba Alterações ganha **Histórico**, que abre uma aba central com a lista de commits do workspace; clicar num commit mostra autor/e-mail/data, SHA copiável, arquivos com status/`+N −M` e o **diff completo por arquivo** expansível (todos de uma vez com “Expandir diffs”). **Diff com syntax highlight**: as linhas do diff usam o Prism/tema compartilhado (`SYNTAX_THEME`, tokens em variáveis CSS) — as cores acompanham o tema claro/escuro e as linhas mantêm o fundo de adição/remoção; acima de 4.000 linhas o diff cai em texto puro para não travar. **Abrir diff** de um arquivo abre por padrão uma **aba central** ao lado das abas de sessão (ícone `FileDiff`, fechável; `Settings.diffOpenMode` alterna entre “Em uma aba do chat” (padrão) e “No painel lateral”, configurável em Configurações → Ferramentas → Workbench de código). Sem workspace: estados vazios honestos (“Nenhum workspace aberto”); sem git: aviso claro e Alterações da sessão continuam pelo journal.
  - **Sidebar do Chat**: lista apenas as sessões do Chat (as compartilhadas continuam nela); o menu da conversa ganha **“Usar no Code”** / **“Remover do Code”**.
  - **Skills** continua acessível no modo Code (item da sidebar; a página abre no centro com "Voltar à sessão"). **Biblioteca** não é renderizada no Code nem oferecida pela paleta; os comandos de artefatos/fontes do Chat também ficam ausentes nesse modo (a paleta nunca oferece beco sem saída). A **busca da paleta** (e os recentes) lista apenas sessões do layout atual.


## 6. Estados da conversa

### 6.1 Boas-vindas (vazia)
- Marca 64px com glow suave, título 32px "Como posso ajudar?" e subtítulo muted.
- Grid 2×2 de sugestões (cards com ícone, título e descrição curta) que preenchem o composer.
- Dica de atalhos abaixo (`⌘K` comandos, `⌘B` sidebar).

### 6.2 Mensagem do usuário
- Alinhada à direita, bolha `bg-user-bubble` `rounded-3xl` `px-4 py-2.5`, largura máx. 80%.
- Anexos como chips acima do texto (ícone por tipo, nome truncado, tamanho).
- Ações no hover: copiar, editar.

### 6.3 Mensagem do assistente
- Alinhada à esquerda, sem bolha (fundo transparente), avatar 24px (marca Lumina) no topo esquerdo.
- **Markdown completo** (contrato em `docs/MARKDOWN.md`): CommonMark (títulos h1–h6 ATX/setext, parágrafos, citações aninhadas, listas ordenadas/não ordenadas/aninhadas, código cercado e indentado, réguas, links, imagens, quebras duras, escapes) + GFM (tabelas com alinhamento e wrapper rolável, task lists somente-leitura, riscado, autolinks, notas de rodapé) + extensões do app (KaTeX inline/display, Mermaid, fences `chart`/`html`/`svg`, blocos `ui`, código com header de linguagem e botão copiar). Alertas GitHub (`> [!NOTE]` etc.) usam os tokens de cor do tema com ícone Lucide e rótulo pt-BR. HTML cru é permitido apenas no subconjunto seguro (ex.: `br`, `kbd`, `mark`, `sup`, `sub`, `details`/`summary`, `abbr`), sempre sanitizado — sem scripts, estilos inline, iframes ou handlers.
- **Segurança e resiliência do Markdown**: links externos e `mailto:` abrem no navegador/app padrão (nunca no webview); âncoras internas das notas de rodapé rolam na mensagem; imagens usam `alt` e têm fallback "Imagem indisponível" quando falham ou não têm fonte segura; URL insegura não vira link clicável.
- **Passos do agente (espaço de pensamento)**: um único bloco colapsável acima do texto, no lugar dos antigos cards de ferramenta. Header com ícone `Brain`, shimmer enquanto o agente trabalha ("Pensando…", "Executando ferramentas…"), contador de tempo ao vivo e, ao concluir, o total ("Pensou por 10s"; sem raciocínio exposto, "N passos"). Expandido, uma timeline com trilho vertical sutil intercala os parágrafos de raciocínio (bullets) com uma linha por atividade, na ordem em que aconteceram: "Encontrou 8 páginas web" (+ avatares de domínio das fontes), "Leu 3 páginas" (+ chips de páginas com sublinhado tracejado que abrem no navegador), "Criou 2 arquivos" (+ chips dos nomes), "Encontrou 3 artefatos" (busca na biblioteca), "Leu o artefato `relatorio.pdf`" (+ chips dos arquivos lidos), "Validou a interface". Cada linha mostra spinner enquanto executa, ícone da ferramenta ao concluir e mensagem em `danger` em caso de erro. O painel abre sozinho durante o streaming e recolhe quando a resposta começa a chegar; com a opção **Raciocínio recolhido por padrão** (Configurações → Geral) ligada, ele começa fechado e não abre sozinho, ficando a expansão por conta do usuário.
- **Citações**: chips de fonte em linha (`favicon`/letra do domínio, título truncado), abrem no navegador. Até 8 chips ficam visíveis; acima disso o excedente vira o botão **+ N fontes**, que abre o painel lateral de fontes com a lista completa da conversa (sem expansão inline).
- **Artefatos**: cards compactos (tile do tipo — incluindo áudio, vídeo e arquivo compactado na v1.5 —, nome truncado, "tipo · tamanho" e os botões existentes **Abrir** e **Salvar como…**), em grid de até duas colunas. Quando o turno gera mais de 4 arquivos, o chat mostra os 4 primeiros e um botão **+ Ver todos (N)** que abre o painel lateral na lista completa de artefatos gerados; clicar em um card abre a prévia no painel. A lista é atualizada ao vivo pelos eventos `artifact_created` e reconciliada com o backend ao fim do turno/ao reabrir a conversa (ordem canônica de criação), sem cards órfãos ou duplicados.
- **UI generativa**: renderizada inline no fluxo do markdown usando o design system (tokens, tipografia e raios do chat). Blocos interativos (`actions`, `tabs`, `reveal`) seguem regras próprias de UI/UX — ver `docs/GENUI.md` e §16.
- Rodapé da mensagem (hover): copiar, regenerar, feedback (like/dislike visual), modelo usado e tokens (se `showTokenUsage`).
- Streaming: caret `accent` piscando após o último caractere.

### 6.4 Erros
- Card `danger-soft` com ícone `AlertTriangle`, título "Não foi possível concluir", mensagem técnica resumida, botão "Tentar novamente".
- Erros de chave: CTA para abrir Configurações › Provedores.
- Toasts (sonner) para falhas assíncronas, canto inferior direito.

### 6.5 Cancelamento
- Barra de progresso indeterminada fina no topo do composer durante streaming; botão enviar vira quadrado "parar".
- Mensagem parcial permanece com selo "Cancelado".

## 7. Composer (detalhe)

```
┌──────────────────────────────────────────────────────────────┐
│ [chip anexo ×] [chip anexo ×]                                │
│ Textarea “Pergunte alguma coisa…”                       (⏎)  │
│ ──────────────────────────────────────────────────────────── │
│ [+] anexar   [🌐 Busca] [📄 Arquivos]        [modelo ▾] [→]  │
└──────────────────────────────────────────────────────────────┘
```
- Enter envia / Shift+Enter quebra linha (configurável; Ctrl+Enter alternativo).
- Botão enviar: círculo 32px, `bg-foreground` (light) / `bg-foreground` (dark), ícone `ArrowUp`; desabilitado quando vazio; vira `Square` (parar) durante streaming.
- Anexar: seletor de arquivos nativo (`@tauri-apps/plugin-dialog`), também drag & drop na janela.
- Pills de ferramentas: `Busca web` e `Criar arquivos` com estado on/off (accent-soft quando ligado).
- Seletor de modelo (no composer do chat): pill segmentado em duas partes — ① glifo da marca do modelo (LobeHub, mono, tingido por tokens) + nome; ② rótulo do pensamento (ex.: "Alto"). O pill abre um **popover em duas etapas**: a lista de modelos (busca com foco automático, alternância Go/Zen, Favoritos + famílias) e, ao escolher um modelo, a mesma superfície troca para os **modos de pensamento** (Desligado / esforços / orçamento), com a descrição de cada modo e botão de voltar. Os **detalhes do modelo** (contexto, custo, protocolo, capacidades, favoritar) aparecem numa **bolha flutuante ao lado do popover**, como uma tooltip: surge no hover ou na navegação por teclado, nunca empurra o layout. O segmento ② abre direto a etapa de pensamento; modelos sem controle de raciocínio mostram o segmento desabilitado ("Padrão"). A busca do popover consulta os dois provedores. O item **"Ver todos os modelos…"** no rodapé abre o **seletor completo** (dialog) — não há botão extra na interface do chat.
- **Ícones de marca**: o avatar de cada modelo (pill, lista do popover, bolha de detalhes e dialog) usa os glifos oficiais da [LobeHub Icons](https://icons.lobehub.com) (`@lobehub/icons-static-svg`, MIT) na variante mono, tingidos pelo token de cor da família; famílias sem marca oficial caem nas iniciais do nome. Mapa, decisão e licença em `docs/MODEL_ICONS.md`.
- **Bloqueio de modelo**: depois do primeiro envio o modelo da conversa fica travado (cadeado no pill, com explicação ao clicar) — trocar de modelo no meio da conversa misturaria respostas de modelos diferentes e invalidaria o replay do raciocínio. O **modo de pensamento continua ajustável** pelo segmento ✦. "Novo chat" volta ao modelo padrão configurado; ao abrir uma conversa existente, o seletor reflete o modelo com que ela foi iniciada.
- Dica de rodapé: "Lumina pode cometer erros. Verifique informações importantes." (11–12px, muted).

## 8. Model Picker (dialog completo)

> O caminho padrão é o pill com o popover em duas etapas (DESIGN §7). Este
> diálogo é o modo avançado, aberto por "Ver todos os modelos…" no rodapé da lista.

- Largura 760px, altura 580px, `rounded-2xl`, com `max-w`/`max-h` para janelas pequenas (mín. da janela: 900×620).
- Header: título "Selecionar modelo", descrição curta, busca (global, em todos os provedores) e chips de filtro — Favoritos, Visão, Raciocínio, Grátis (`aria-pressed`) — com contagem de modelos.
- Abas de provedor `OpenCode Go` / `OpenCode Zen` / `OpenAI (ChatGPT)` / `Anthropic` com dot de status (chave ou conta conectada; tooltip com a origem/estado). Com busca ativa, as abas dão lugar a "Todos os provedores" e os grupos viram "Go · Claude", "Zen · Claude", "ChatGPT · GPT", "Anthropic · Claude", etc. Modelos `estimated` (só da conta) mostram selo próprio; com plano ChatGPT ativo o preço por token é substituído por "Incluído no seu plano ChatGPT" + "Gerenciar uso".
- Lista agrupada por família (favoritos primeiro, "Outros" por último); cada linha: glifo da marca do modelo (LobeHub, mono, tingido por tokens), nome, badges (Grátis/Visão/Raciocínio/Preview), contexto, preço, check no modelo em uso e estrela de favorito (visível no hover/foco).
- Coluna direita (300px): identidade do modelo (nome, provedor, id), badges, descrição, especificações (contexto, saída máxima, custo, protocolo, entrada, conhecimento, lançamento), aviso de status (indisponível/preview/grátis), aviso de chave ausente com "Configurar" e **seletor de modo de pensamento** (segmented: Desligado + esforços; slider para `budget_tokens`).
- Interação: clique = prévia; duplo-clique, Enter na busca ou "Usar este modelo" = confirma. Setas/Home/End navegam e atualizam a prévia. Esc limpa a busca antes de fechar.
- Rodapé fixo com dicas de teclado (↑↓, ↵, Esc), badge "Em uso" e botão "Usar este modelo".
- Modelos indisponíveis aparecem desabilitados com motivo; o estado é remontado a cada abertura.
- Se o modelo da conversa está bloqueado (conversa já iniciada), o dialog mostra um aviso compacto com o modelo em uso e a dica de ajustar o pensamento pelo ✦, em vez do seletor.

## 9. Configurações (dialog)

Tabs à esquerda (180px), conteúdo à direita (520px):
1. **Geral**: tema (Claro/Escuro/Sistema), idioma, tamanho da fonte, enviar com Enter/Ctrl+Enter, reduzir movimento, mostrar uso de tokens, raciocínio recolhido por padrão.
2. **Provedores**: OpenCode Go e Zen — campo de API key (mascarado), status (Configurada via settings/env/CLI OpenCode), botão testar conexão, link para o console, aviso de privacidade. OpenAI — card de conta com **Continuar com ChatGPT** (OAuth oficial, sem API key), estados (aguardando/cancelar/abrir novamente), conta conectada com e-mail + selo **Plano ChatGPT** + **Gerenciar uso** + **Sair** + detalhes (client/host mascarados, escopos, expiração de 1 h), "Ativar uso do plano" quando o escopo não foi concedido e API key `sk-…` como alternativa. Anthropic — card de API key (`sk-ant-…`, console `platform.claude.com/settings/keys`, aviso de cobrança por token/pay-as-you-go, sem OAuth). Erro de segredos corrompidos vira banner com "Abrir pasta de dados".
3. **Modelo padrão**: provider + modelo + modo de pensamento padrão (com uma conversa em andamento, alterações aqui valem apenas para novas conversas).
4. **Instruções do sistema**: textarea com o prompt customizado (placeholder mostra o padrão), contador de caracteres.
5. **Ferramentas**: busca web (on/off), criação de arquivos (on/off), máximo de passos do agente (1–1000, padrão 64).
6. **Dados**: abrir pasta de dados, exportar todas as conversas, limpar todos os dados (confirmação dupla).
7. **Sobre**: versão, Tauri, commits do catálogo, link do projeto.

## 10. Paleta de comandos (⌘K / Ctrl+K)

> Contrato completo (auditoria, catálogo e decisões): `docs/COMMAND_PALETTE.md`.

- Overlay 640px, topo ~9vh, lista com scroll (máx. 420px), fundo
  `surface-raised` e mesmos tokens do design system.
- **Duas fontes na mesma lista**: comandos locais (capability-aware: só aparece
  o que pode rodar no contexto) e conversas do histórico (busca no backend por
  título/conteúdo, 160ms de debounce, mínimo 2 caracteres, até 5 resultados,
  com fallback local normalizado). Query vazia: “Conversas recentes” → “Sugestões”
  (comandos recentes; fallback: novo chat, trocar modelo, configurações, tema,
  focar composer) → grupos de comandos. Query preenchida: “Conversas
  encontradas” → grupos de comandos.
- **Busca tolerante**: sem acentos/caixa, multi-token (AND) e fuzzy com
  subsequência; trecho casado em `<mark>` (`bg-accent-soft text-accent`).
  Resultado que casou só no conteúdo mostra o selo “Conteúdo”.
- **Escopos**: `>` só comandos, `#` só conversas (prefixo opcional).
- **Teclado**: ↑/↓ com wrap, Ctrl+N/P, Home/End, PageUp/PageDown, Enter executa,
  ⌘/Ctrl+Enter fixa/desafixa a conversa ativa (mantém aberta), Esc limpa a busca
  (primeiro) e fecha (segundo), ⌘K fecha. Com a paleta aberta nenhum outro
  atalho global age no fundo. IME nunca dispara Enter.
- **Ações** que abrem outra superfície fecham a paleta e agendam o efeito para o
  próximo tick (foco devolvido antes do dialog destino). Rodapé mostra dicas
  contextuais e a contagem (“N comandos · M conversas”).
- **Acessibilidade**: combobox com `aria-activedescendant`, listbox com grupos
  `role="group"`/`aria-labelledby`, opções com `aria-selected`/`aria-label`,
  região `aria-live` com a contagem, foco visível e foco inicial no input.
- **Atalhos exibidos**: novo chat (⌘N), configurações (⌘,), sidebar (⌘B), focar
  composer (⌘J). Ações contextuais: parar/regenerar (streaming), limpar anexos
  (pendentes), exportar/copiar/fixar (conversa ativa), skills (quando ligadas).

## 11. Motion

| Elemento | Animação |
| --- | --- |
| Mensagem nova | fade-in-up 260ms |
| Diálogos | fade + scale 0.97→1 (180ms) |
| Popover do seletor de modelo | fade + scale 0.97→1 (180ms) |
| Sidebar | width/translate 220ms ease-out-soft |
| Seletor Chat/Code | a pílula ativa desliza entre os segmentos em 180ms ease-out-soft; com reduceMotion só troca de cor |
| Redimensionamento da sidebar | sem transição enquanto arrasta (a largura acompanha o cursor); abertura/colapso mantêm 220ms |
| Artifact panel | slide-in 240ms (modo sobreposto); no modo fixo o chat reflui imediatamente |
| Sources panel | slide-in 240ms (modo sobreposto; mesmo movimento do painel de artefatos) |
| Redimensionamento dos painéis laterais | sem transição de largura enquanto arrasta; slide-in/out mantém 240ms no modo sobreposto |
| Pensando | shimmer no texto + pulso da marca |
| Passos do agente | shimmer no header durante o streaming; timeline expande/recolhe |
| Timeline de passos | linha de atividade entra com fade, spinner enquanto executa |
| Caret de streaming | blink 1.1s |
| Hover de botões | 120ms |

Com `reduceMotion` (config ou media query), remover transformações e shimmer; manter apenas fade.

## 12. Acessibilidade

- Todos os ícones-botão têm `aria-label`; tooltips em hover/focus.
- Diálogos Radix (focus trap, escape, `aria-labelledby`).
- Mensagens com `aria-live="polite"` durante streaming (role log).
- Contraste mínimo 4.5:1 para texto normal; placeholders ≥3:1.
- Alvos de toque ≥32px; foco visível com anel `accent`.
- Navegação completa por teclado: composer, lista, sidebar, dialogs.
- Sidebar redimensionável: divisor focável (`role="separator"`, `aria-orientation="vertical"`, `aria-valuenow/min/max`), ←/→ movem 16px, Home/End vão aos limites, duplo clique restaura 272px, cursor `col-resize` e feedback visual de hover/foco/arrasto.
- Painéis laterais direitos (artefatos/fontes) redimensionáveis: mesmo divisor acessível na borda esquerda (360–900px, ←/→ movem 16px, Home/End nos limites, duplo clique restaura 480px), compartilhando a largura persistida entre os dois painéis. O botão de modo (fixar/soltar painel) usa `aria-pressed` e fica desabilitado quando a janela não comporta o modo fixo.
- Seletor de modelos: combobox + listbox com `aria-activedescendant`; busca focada ao abrir; setas/Home/End/Enter/Esc; grupos com `aria-label`; favoritos com `aria-pressed`; modelos indisponíveis com `aria-disabled`; foco devolvido ao pill ao fechar.
- Página Biblioteca: cada card é um botão com nome acessível (nome + tipo + origem), ícones-botão com `aria-label` (favoritar, menu de ações, enviar arquivos, limpar busca, grid/lista), pills de filtro como grupo de rádio (`role`/`aria-checked`) e foco visível; o dialog de prévia é Radix (focus trap, Esc) e a exclusão pede confirmação inline; Esc na página volta ao chat.

## 13. Responsivo

- < 1024px: sidebar vira overlay (drawer) com backdrop.
- < 768px: composer mais compacto, pills de ferramentas viram ícones.
- Artifact panel: no modo sobreposto ocupa até `92vw` em telas pequenas (sheet); o modo fixo só entra em janelas ≥1120px.
- Painel lateral direito: largura máxima é re-clampada em tempo real (modo sobreposto ≤ `92vw`; modo fixo ≤ janela − sidebar − 480px de chat). Abaixo de 1120px de janela o modo fixo degrada automaticamente para sobreposto (a preferência fica salva e volta a valer quando a janela cresce); a alça de redimensionamento usa esse limite dinâmico e a janela pode ser redimensionada com o painel aberto sem overflow.
- Modo Code: sidebar vira o mesmo drawer abaixo de 1024px; o painel Arquivos/Alterações só é renderizado a partir de 1120px (o botão do cabeçalho fica desabilitado com dica "Aumente a janela…" e a conversa mantém ≥480px). O seletor Chat/Code fica sempre visível entre a marca e as ações globais. Como o seletor ocupa o centro da title bar, o indicador **Plano ChatGPT** só aparece em janelas ≥1280px (abaixo disso ele é omitido para não comprimir a busca/controles de janela; o mesmo estado continua em Configurações › Provedores).

## 14. Microcopy (pt-BR)

- Novo chat, Buscar conversas, Configurações, Modelo padrão, Modo de pensamento, Buscar modelos…, Limpar busca, Usar este modelo, Configurar, Modelo bloqueado nesta conversa, Anexar arquivos, Busca web, Criar arquivos, Pensando…, Executando ferramentas…, Pensou por 10s, Encontrou 8 páginas web, Leu 3 páginas, Criou 2 arquivos, Pesquisando nos artefatos…, Encontrou 3 artefatos, Nenhum artefato encontrado, Lendo o artefato relatorio.pdf…, Leu o artefato relatorio.pdf, Não foi possível ler o artefato, Validou a interface, Parar, Copiar, Regenerar, Artefatos, Ver lista de artefatos, Ver todos (N), Nenhum artefato nesta conversa, Fontes, Nenhuma fonte nesta conversa, Abre no navegador padrão, Salvar como…, Abrir, Excluir, Fixar, Renomear, Exportar, Limpar dados.
- Prévia de artefatos (v1.5): Controles da imagem, Ajustar à janela, Tamanho real, Aumentar/Diminuir zoom, Documento, Código, Árvore, Quebrar linhas, Rolagem horizontal, Primeiros N bytes, Mostrando X de Y entradas, Carregando prévia…, Tentar novamente, “Arquivo grande demais para reprodução inline; use Abrir/Salvar”, “Formato sem prévia no visualizador”.
- Prévia de skill (dialog da gestão de skills): Visualizar skill, Carregando conteúdo da skill…, Não foi possível carregar o conteúdo da skill, Tentar novamente, “Esta skill não tem instruções.”, Documento, Código.
- Painel lateral direito: Fixar painel ao lado do chat, Soltar painel sobre o chat, Aumente a janela para fixar o painel, Redimensionar painel de artefatos/fontes.
- Biblioteca: Biblioteca, Voltar ao chat, Pesquisar na biblioteca, Limpar busca, Enviar arquivos, Enviando arquivos…, N arquivo(s) enviado(s), Nenhum arquivo enviado, Solte para enviar à biblioteca, Tudo, Favoritos, Imagens, Documentos, Código, Mídia, Outros, Recentes, Mais antigos, Nome (A–Z), Tamanho, Grade, Lista, Sua biblioteca está vazia, Nenhum artefato encontrado, Limpar filtros, Favoritar, Desfavoritar, Renomear, Renomear arquivo, Salvar como…, Abrir, Excluir, Excluir arquivo, Esta ação não pode ser desfeita, arquivo(s), Carregando biblioteca…, Não foi possível carregar a biblioteca, Tentar novamente, Arquivo enviado, Biblioteca (enviado pelo usuário), Originado de “título da conversa”.
- Paleta de comandos: Buscar conversas ou comandos…, Conversas recentes, Sugestões, Conversas encontradas, Buscando conversas…, Nenhum resultado para “x”, Busca no histórico indisponível; mostrando título e prévia, Conteúdo, navegar, executar, fixar/desafixar, limpar busca, fechar.
- Modo Code (v1.9): Chat, Code, Abrir pasta, Novo agente, Nova sessão, Fechar <sessão>, Sessões, Workspaces, Nenhum workspace aberto, Abra uma pasta na barra lateral para o agente ler, editar e rodar comandos aqui., Pesquisar workspaces, Filtrar workspaces, Adicionar workspace, Pesquisar workspaces…, Todos, Com git, Sem git, Não confiáveis, Com sessões, Sem sessões, Nenhum workspace encontrado, Ajuste a pesquisa ou os filtros para ver outros workspaces., Limpar filtros, Limpar pesquisa, X de Y workspaces., Confiar nesta pasta?, Abrir em Leitura, Remover do Lumina, Do Chat, Buscar, Skills, Sem workspace, Arquivos, Alterações, Nenhuma alteração pendente, Preparados, Não preparados, Novos, Da sessão, Reverter arquivo, Reverter turno, Sugerir mensagem, Commit, Sem commits ainda, Descreva a tarefa… @ para arquivos, / para comandos, Modo Plano, Leitura, Editar, Autônomo, Plano, Contexto, Compactar agora, Trabalhou por …, Ver alterações, Permitir, Negar, Sempre permitir, Executar comando?, Gravar alteração?, Aprovar e executar, Aprovar e revisar cada edição, Continuar planejando, Voltar à sessão, Ir para o modo Code, Ir para o modo Chat, Recolher painel, Redimensionar painel de arquivos, Aumente a janela para ver o painel de arquivos.
- Cards do harness (v1.9): aprovação com risco (leitura/comando/destrutivo/segredo/fora do workspace), diff de escrita com `+N −M`, plano em Markdown com gate, lista de tarefas, pergunta com opções, medidor de contexto (ok/atenção/compactando) e barra de jobs em background (parar/ver). Negar não cancela o turno: o motivo volta ao agente.
- Sessões separadas (v1.10): Adicionar sessão do Chat, Buscar sessão do Chat…, Nenhuma sessão do Chat disponível, Adicionar ao Code, Do Chat, Sessão compartilhada do Chat, Usar no Code, Remover do Code, Sessão adicionada ao Code, Sessão removida do Code, “Agora ela aparece nos dois layouts.”, “Ela continua disponível no Chat.”, Nenhuma sessão ainda., Comece um novo agente ou adicione uma sessão do Chat.
- Erros: "Não foi possível concluir", "Chave de API ausente", "Limite de uso atingido", "Tente novamente em instantes".

## 15. Anti-padrões proibidos

- Gradientes em botões/textos comuns, sombras coloridas, bordas neon.
- Emojis decorativos em excesso (apenas onde o conteúdo do modelo os trouxer).
- Cards dentro de cards sem hierarquia.
- Animações > 300ms em interações.
- Texto cinza claro sobre fundo claro, ou `opacity` como substituto de cor.
- **Bordas assimétricas**: nunca um lado/peso diferente dos demais no mesmo
  elemento (ex.: `border-inline-start: 3px` com `1px` nos outros lados). Ou a
  borda é uniforme em todos os lados, ou não existe.
- **Caixas de alerta/tip no Markdown** (`> [!TIP]` etc.): alertas renderizam
  como bloco neutro (ícone + rótulo + texto, sem caixa/fundo/borda). Citações
  também são texto sem moldura.
- **UI generativa**: props de estilo (cores, fontes, raios, sombras) — o agente
  usa apenas os componentes e tokens do design system; card dentro de card;
  containers vazios; `grid` com linha incompleta; tabela/gráfico sem título;
  botões que enviam mensagem sem o usuário revisar; duas ações `primary`;
  **caixas de nota coloridas (`callout`, descontinuado)**; emojis e Markdown
  dentro de props. Detalhes e limites: `docs/GENUI.md`.

## 16. UI generativa no chat (interfaces do agente)

Regras de apresentação específicas das interfaces que o agente cria durante a
execução (contrato e regras completas em `docs/GENUI.md`):

- **Mesmo sistema visual do chat**: superfícies `surface-raised`, borda de 1px,
  raio `rounded-xl`/`rounded-2xl`, tipografia 12–13,5px, números `tabular-nums`.
  Componentes não aceitam props de cor/tamanho — não há “tema paralelo”.
- **Hierarquia**: um `card` raiz com `title` (ou `section` para feeds/listas);
  dentro dele `grid`/`chart`/`table`/`text`/`source`; `actions`/`choices` por
  último. Sem card aninhado, sem container vazio, sem divisor decorativo.
- **Densidade**: 1 bloco por resposta (máx. 2), ~60 componentes (máx. 120),
  até 6 níveis; linhas de leitura confortáveis; conteúdo longo vai para
  Markdown/artefato.
- **Interação**: `actions` são botões do design system (sm, 32px) em grupo
  acessível; `primary` única, `secondary`/`ghost` para o resto; clicar em
  `prompt` preenche o composer (o usuário revisa e envia) e `copy` copia com
  toast discreto. `choices` é um formulário de seleção local (rádio/checkbox/
  segmentado) com contador e progresso sincronizados; o botão de envio preenche
  o composer com `submitPrefix + seleção` — nunca envia sozinho. `reveal` usa
  `<details>` com chevron 150ms; `tabs` usa Radix.
- **Feed/conteúdo rico**: `section` + `stack` `direction: row` + `image`
  (`size: thumb`) + `badge` + `text` + `source` monta cartões de notícia como
  no feed; `source` e itens de `list` com `href` abrem no navegador padrão;
  `checklist` mostra etapas/capacidades com ícone e status.
- **Estados**: bloco inválido degrada para código + diagnóstico discreto
  (nunca tela quebrada); avisos de design vão apenas para o console do DevTools
  em DEV, nunca para a mensagem; carregamento de
  imagem tem fallback; tabela vazia/gráfico inválido têm mensagem muted.
- **Acessibilidade**: contraste AA, foco visível (`ring-accent`), alvos ≥32px,
  teclado completo, `aria-label` em ícones e grupos, `alt` obrigatório em
  imagens, `prefers-reduced-motion` respeitado.
- **Copy**: título e rótulos curtos em pt-BR, sentence case, sem ponto final em
  botões, sem emojis decorativos, sem repetir o que o Markdown já diz.
