# GOAL — Layouts Chat e Code (Fase 1: layout)

## Pedido do usuário

Criar um **novo layout** para a aplicação, ativado por um **botão na top bar** (referência:
pílula segmentada `Chat | Work`), com base nas imagens de referência do **Paseo**. O app passa a
ter dois modos:

1. **Chat** — todas as funções atuais, sem regressão.
2. **Code** — espaço de trabalho de codificação com harness de agente (DeepSeek Harness, t3code,
   Codex etc.). Nesta etapa **apenas o layout**: a integração do harness vem na etapa seguinte.

Regras:

- Reaproveitar o design atual e as páginas existentes (Skills, etc.).
- O novo layout **não** tem a página **Biblioteca**.
- Manter as cores/temas atuais; usar o **Paseo** como inspiração de design e disposição.
- Nesta fase pode deixar **estados vazios** para o que depende do harness.

## Decisões validadas com o usuário (2026-10-27)

| Tema | Decisão |
| --- | --- |
| Preenchimento da fase 1 | Reaproveitar o design de chat atual (com melhorias) e deixar o que depende do harness em estado vazio. |
| Rótulo do seletor | `Chat` / `Code`. |
| Posição do seletor | Centralizado na title bar. |
| Skills no modo Code | Sim — a página de Skills existente continua acessível também no modo Code. |

## Referências

- `refs/toggle-chat-work.png` — pílula segmentada da top bar (Chat/Work).
- `refs/paseo-reference.png` — janela completa do Paseo (sidebar de workspaces/sessões, abas de
  agente, painel direito Arquivos/Alterações com barra de commit).
- `refs/crops/` — recortes legíveis da referência.

## Fora do escopo desta fase

- Harness de código em si (execução de agentes, workspace em disco, leitura de arquivos, git).
- Escolha/parametrização de harnesses (DeepSeek Harness, t3code, Codex…).
- Alterações no backend Rust.

## Critérios de pronto

- Toggle `Chat | Code` centralizado na title bar, persistido e acessível por teclado.
- Modo Chat idêntico ao atual (todas as funções e testes verdes).
- Modo Code com shell completo: sidebar de workspaces/sessões, cabeçalho + abas de sessão,
  conversa reaproveitada, composer, painel Arquivos/Alterações com barra de workspace/commit.
- Nenhuma página Biblioteca no modo Code.
- Skills acessível nos dois modos.
- Sem dados falsos “de produto”: o que depende do harness tem estado vazio honesto.
- `pnpm typecheck`, `pnpm test` e `pnpm build` verdes.
