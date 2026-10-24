# Lumina — Design & UI/UX

## 1. Direção

Lumina é um chat de IA **calmo, preciso e premium**, inspirado na hierarquia do ChatGPT e na contenção visual do Claude, com identidade própria: um orbe violeta-azul ("aurora") usado apenas em momentos de marca (logo, estados de raciocínio, foco).

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
| Símbolo | orbe com gradiente `#7c5cff → #b06bff → #3ad0ff` + "spark" branco de 4 pontas |
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

Regras: nunca usar hex solto em componentes — sempre `bg-background`, `text-foreground-muted`, `border-border`, etc. Gradiente da marca só no logo, no botão de enviar ativo e no estado "pensando".

## 4. Tipografia

- Família: **Inter Variable** (`--font-sans`), fallback Segoe UI; monoespaçada **JetBrains Mono Variable**.
- Escala: 12 (meta) / 13 (labels) / 14.5 (UI) / 15 (corpo do chat) / 17 (título de diálogo) / 20–24 (títulos de tela) / 32 (hero).
- Títulos com `tracking-tight` (-0.011em); corpo 1.7; tabelas 13px.
- Números tabulares em métricas (`tabular-nums`).

## 5. Layout

```
┌──────────────────────────────── janela (1320×860) ────────────────────────────────┐
│ TitleBar 56px: drag region · marca · [busca ⌘K] · [modelo] · controles de janela  │
├───────────────┬───────────────────────────────────────────────────────────────────┤
│ Sidebar 272px │  Chat (max-w-3xl centrado)                    │ Artifact panel    │
│  novo chat    │  mensagens…                                   │ 360–560px, slide  │
│  busca        │                                               │                   │
│  grupos       │  ┌─ Composer (sticky, 2xl, sombra) ─────────┐ │                   │
│  config/perfil│  │ anexos · textarea · tools · modelo · send │ │                   │
└───────────────┴──┴──────────────────────────────────────────┴─┴───────────────────┘
```

- **TitleBar**: 56px, `decorations: false`; arrastável (`data-tauri-drag-region`); controles nativos custom (minimizar/maximizar/fechar) com hover `surface-hover` e fechar em vermelho.
- **Sidebar**: 272px, `bg-surface`, colapsável (⌘/Ctrl+B). Contém: botão "Novo chat" (pill com borda), busca, lista agrupada (Fixadas, Hoje, Ontem, 7 dias, 30 dias, Mais antigas), rodapé com atalho de configurações e versão.
- **Chat**: coluna central `max-w-3xl` (768px), padding 24px, espaçamento entre mensagens 28px.
- **Composer**: sticky no rodapé com gradiente de fade; container `rounded-3xl`, borda 1px, fundo `surface-raised`, sombra sutil; cresce até 10 linhas.
- **Artifact panel**: side panel à direita (largura 42%, mín 380px), com header próprio (nome, tipo, ações), preview scrollável e botão "Salvar como…".

## 6. Estados da conversa

### 6.1 Boas-vindas (vazia)
- Orbe 64px com glow suave, título 32px "Como posso ajudar?" e subtítulo muted.
- Grid 2×2 de sugestões (cards com ícone, título e descrição curta) que preenchem o composer.
- Dica de atalhos abaixo (`⌘K` comandos, `⌘B` sidebar).

### 6.2 Mensagem do usuário
- Alinhada à direita, bolha `bg-user-bubble` `rounded-3xl` `px-4 py-2.5`, largura máx. 80%.
- Anexos como chips acima do texto (ícone por tipo, nome truncado, tamanho).
- Ações no hover: copiar, editar.

### 6.3 Mensagem do assistente
- Alinhada à esquerda, sem bolha (fundo transparente), avatar 24px (orbe) no topo esquerdo.
- Markdown completo (headings, listas, tabelas, código com header + botão copiar, KaTeX, mermaid, `ui` blocks).
- **Raciocínio**: bloco colapsável acima do texto com linha vertical sutil, shimmer enquanto streama, ícone `Brain`/`Sparkles`, título "Pensando…" (durante) ou "Raciocínio" (concluído), contador de tempo.
- **Ferramentas**: cards compactos com ícone (`Globe`, `FileText`, `FilePlus`), nome amigável, argumento resumido, spinner/check/erro, expandir para ver resultado.
- **Citações**: chips de fonte em linha (`favicon`/letra do domínio, título truncado), abrem no navegador.
- **Artefatos**: card com ícone por tipo, nome, tamanho, botões "Visualizar" e "Salvar".
- **UI generativa**: renderizada inline no fluxo do markdown.
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
- Seletor de modelo (padrão): pill segmentado em duas partes — ① avatar + nome do modelo: abre o **dropdown em duas etapas**: a lista de modelos (Favoritos + famílias, com painel de detalhes ao passar o mouse) e, ao escolher um modelo, a mesma lista troca para os **modos de pensamento** (Desligado / esforços / orçamento); ② rótulo do pensamento (ex.: "Alto"): atalho que abre direto a etapa de pensamento. O item **"Ver todos os modelos…"** no rodapé da lista abre o **seletor completo** (modal com busca, provedores e capacidades) — não há botão extra na interface do chat.
- Dica de rodapé: "Lumina pode cometer erros. Verifique informações importantes." (11–12px, muted).

## 8. Model Picker (dialog completo)

> O caminho padrão é o pill com o dropdown em duas etapas (DESIGN §7). Este
> diálogo é o modo avançado, aberto por "Ver todos os modelos…" no rodapé da lista.

- Largura 720px, altura 560px, `rounded-2xl`.
- Header com busca e tabs de provedor: `OpenCode Go` / `OpenCode Zen` (badge de chave configurada).
- Lista virtualizada por família, cada linha: nome, badges (Grátis/Visão/Raciocínio/Preview), contexto, preço, check no selecionado, estrela de favorito.
- Coluna direita (detalhe do modelo selecionado): descrição, contexto, custo, protocolo, **seletor de modo de pensamento** (segmented: Desligado + esforços; slider para `budget_tokens`), botão "Usar este modelo".
- Modelos indisponíveis aparecem desabilitados com motivo.

## 9. Configurações (dialog)

Tabs à esquerda (180px), conteúdo à direita (520px):
1. **Geral**: tema (Claro/Escuro/Sistema), idioma, tamanho da fonte, enviar com Enter/Ctrl+Enter, reduzir movimento.
2. **Provedores**: OpenCode Go e Zen — campo de API key (mascarado), status (Configurada via settings/env/CLI OpenCode), botão testar conexão, link para o console, aviso de privacidade.
3. **Modelo padrão**: provider + modelo + modo de pensamento padrão.
4. **Instruções do sistema**: textarea com o prompt customizado (placeholder mostra o padrão), contador de caracteres.
5. **Ferramentas**: busca web (on/off), criação de arquivos (on/off), máximo de passos do agente (1–16).
6. **Dados**: abrir pasta de dados, exportar todas as conversas, limpar todos os dados (confirmação dupla).
7. **Sobre**: versão, Tauri, commits do catálogo, link do projeto.

## 10. Paleta de comandos (⌘K / Ctrl+K)

- Overlay 640px com input e lista de ações: novo chat, buscar conversas, abrir configurações, trocar modelo, alternar tema, alternar sidebar, exportar conversa, copiar última resposta.
- Navegação com ↑/↓ e Enter; agrupamento por categoria.

## 11. Motion

| Elemento | Animação |
| --- | --- |
| Mensagem nova | fade-in-up 260ms |
| Diálogos | fade + scale 0.97→1 (180ms) |
| Sidebar | width/translate 220ms ease-out-soft |
| Artifact panel | slide-in 240ms |
| Pensando | shimmer no texto + pulso do orbe |
| Tool card | altura animada + spinner |
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

## 13. Responsivo

- < 1024px: sidebar vira overlay (drawer) com backdrop.
- < 768px: composer mais compacto, pills de ferramentas viram ícones.
- Artifact panel vira full-screen sheet em telas pequenas.

## 14. Microcopy (pt-BR)

- Novo chat, Buscar conversas, Configurações, Modelo padrão, Modo de pensamento, Anexar arquivos, Busca web, Criar arquivos, Pensando…, Parar, Copiar, Regenerar, Salvar como…, Abrir, Excluir, Fixar, Renomear, Exportar, Limpar dados.
- Erros: "Não foi possível concluir", "Chave de API ausente", "Limite de uso atingido", "Tente novamente em instantes".

## 15. Anti-padrões proibidos

- Gradientes em botões/textos comuns, sombras coloridas, bordas neon.
- Emojis decorativos em excesso (apenas onde o conteúdo do modelo os trouxer).
- Cards dentro de cards sem hierarquia.
- Animações > 300ms em interações.
- Texto cinza claro sobre fundo claro, ou `opacity` como substituto de cor.
