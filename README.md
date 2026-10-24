# Lumina

Chat desktop de IA construído com **Tauri 2 + React 19 + Tailwind CSS 4**, usando **OpenCode Go** e **OpenCode Zen** como provedores.

![status](https://img.shields.io/badge/status-em%20desenvolvimento-7c5cff)

## Funcionalidades

- **Conversas com streaming** em tempo real, com raciocínio (thinking) visível e colapsável.
- **Escolha de modelo e modo de pensamento** por modelo (esforço, orçamento de tokens ou desligado), com catálogo de 120+ modelos dos dois provedores.
- **Análise de documentos**: PDF, DOCX, XLSX/CSV, PPTX, texto/código e imagens (visão).
- **Busca na web** com citações de fontes e leitura de páginas.
- **Criação de arquivos** (artefatos) com preview e "Salvar como…" nativo.
- **UI generativa no chat**: o modelo escreve componentes (cards, tabelas, gráficos, timelines, tabs…) renderizados com segurança.
- **Artefatos em painel lateral** estilo canvas, com preview por tipo.
- **Histórico local** (SQLite), busca, fixar, renomear, exportar.
- **UI/UX** inspirada no ChatGPT: sidebar, composer flutuante, paleta de comandos, temas claro/escuro, atalhos.

## Requisitos

- Node.js 20+ e pnpm
- Rust (toolchain MSVC no Windows)
- WebView2 (Windows 10/11)
- Uma API key do [OpenCode Console](https://opencode.ai/console) (Go ou Zen). A chave existente do OpenCode CLI é detectada automaticamente.

## Desenvolvimento

```bash
pnpm install
pnpm app:dev        # Tauri + Vite com HMR
```

Build de produção:

```bash
pnpm app:build      # instalador NSIS em src-tauri/target/release/bundle
```

## Estrutura

```
data/catalog.json        catálogo de modelos (gerado)
scripts/                 geração do catálogo e sondagens dos provedores
src/                     renderer React (componentes, stores, genui)
src-tauri/src/           core Rust (providers, harness, tools, documents, db)
docs/                    arquitetura, design e modelos
```

Documentação: [Arquitetura](docs/ARCHITECTURE.md) · [Design](docs/DESIGN.md) · [Modelos & Provedores](docs/MODELS.md).

## Privacidade

Conversas, anexos e artefatos ficam apenas na sua máquina. As API keys são armazenadas localmente (`secrets.json` no app-data) e nunca são expostas ao renderer. Requisições vão direto para o gateway do OpenCode.

## Licença

MIT.
