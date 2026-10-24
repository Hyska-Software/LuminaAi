# Lumina

Chat desktop de IA construído com **Tauri 2 + React 19 + Tailwind CSS 4**, usando **OpenCode Go** e **OpenCode Zen** como provedores.

![status](https://img.shields.io/badge/status-conclu%C3%ADdo-7c5cff)

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

## Screenshots

| Boas-vindas | Seletor de modelo |
| --- | --- |
| ![Boas-vindas](docs/screenshots/01-welcome.png) | ![Seletor de modelo](docs/screenshots/02-model-picker.png) |

| Busca na web com citações | Raciocínio + markdown |
| --- | --- |
| ![Busca na web](docs/screenshots/03-web-search.png) | ![Raciocínio](docs/screenshots/04-reasoning.png) |

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
pnpm app:build      # instalador NSIS em src-tauri/target/release/bundle/nsis
```

Somente o executável (sem instalador):

```bash
pnpm tauri build --no-bundle   # src-tauri/target/release/lumina.exe
```

## Testes

O projeto é verificado por testes automatizados (TDD), sem automação de UI:

```bash
pnpm test                                     # Vitest: utils, catálogo, UI generativa, store do chat
cd src-tauri && cargo test --lib              # Rust: providers, harness, tools, documents, db, comandos
```

Testes de integração que chamam o gateway real ficam marcados como `#[ignore]` e usam
`deepseek-v4.1-flash` (OpenCode Go) com esforço máximo:

```bash
cd src-tauri
cargo test --lib providers::smoke -- --ignored --nocapture --test-threads=1
cargo test --lib tools::web_search::tests::live -- --ignored --nocapture
cargo test --lib tools::fetch_url::tests::live -- --ignored --nocapture
```

## Estrutura

```
data/catalog.json        catálogo de modelos (gerado)
scripts/                 geração do catálogo e sondagens dos provedores
src/                     renderer React (componentes, stores, genui)
src-tauri/src/           core Rust (providers, harness, tools, documents, db)
docs/                    arquitetura, design, modelos e screenshots
```

Documentação: [Arquitetura](docs/ARCHITECTURE.md) · [Design](docs/DESIGN.md) · [Modelos & Provedores](docs/MODELS.md).

## Privacidade

Conversas, anexos e artefatos ficam apenas na sua máquina. As API keys são armazenadas localmente (`secrets.json` no app-data) e nunca são expostas ao renderer. Requisições vão direto para o gateway do OpenCode.

## Licença

MIT.
