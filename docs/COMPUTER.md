# Computer use — contrato

> Estado: backend local Windows + Docker gráfico. Aprovação por ação com
> screenshot, auditoria durável, rate limit, banner de controle e screenshot
> enviado a modelos com visão. Sem automação de mouse/teclado sem consentimento.

## Capabilities

`AgentCapabilities`:

- `computerUse` — screenshot + clique/teclado;
- `screenCapture` — somente leitura (screenshot/window list/UI tree);
- `browserUse` — reservado para o browser CDP (ainda não implementado);
- `dockerExecution` — necessária para override de imagem Docker por agente.

Todas começam `false` e só removem acesso. As tools só entram no catálogo do
turno quando a capability correspondente está ligada.

## Tools (perfil Code)

| Tool | Aprovação | Efeito |
| --- | --- | --- |
| `computer_screenshot` | não (leitura) | PNG em `<app-data>/computer/<conversa>/`, dimensões e imagem para modelos com visão |
| `computer_windows` | não (leitura) | lista id/título/app das janelas |
| `computer_ui_tree` | não (leitura) | árvore de acessibilidade (nome/tipo/bounds/id) |
| `computer_click` | **sempre** | move + clique esquerdo/direito/meio |
| `computer_type` | **sempre** | digita no foco; aprovação mostra só o tamanho |
| `computer_key` | **sempre** | combinação de teclas |
| `computer_focus` | **sempre** | foca uma janela por id |
| `browser_open` | **sempre** | abre http(s) no navegador padrão (local) ou Chromium (Docker); a página é operada pelas tools acima |

`RiskClass::Computer` sempre gera `Ask`, inclusive no modo Autônomo. O card usa
`ApprovalDetail::ComputerAction` com ação, alvo, coordenadas/URL, tamanho do
texto (nunca o texto) e screenshot do alvo via
`computer_screenshot_preview`. As opções são **Permitir uma vez** e **Negar**;
não há grant persistente. Sem canal de aprovação a tool falha fechada
(`APPROVAL_UNAVAILABLE`).

## Auditoria e limites

- `computer_sessions` e `computer_actions` registram backend, conversa, agente,
  turno, tool, alvo (coordenadas/URL/tamanho), decisão, resultado e erro.
- Nunca gravam texto digitado, bytes de screenshot ou segredo; a prévia lê o
  arquivo em `<app-data>/computer` e o renderer só recebe um data URL validado.
- `computer_max_actions_per_turn` (default 20) e
  `computer_max_actions_per_hour` (default 120) falham antes da aprovação com
  `COMPUTER_RATE_LIMIT`.
- A primeira ação abre a sessão; o fim do turno (`done`/erro/cancelamento)
  encerra a sessão. Comandos: `list_computer_actions`,
  `list_computer_sessions`, `list_active_computer_sessions`,
  `stop_computer_session`, `stop_all_computer_sessions`.
- Enquanto há sessão ativa, `ComputerControlBanner` mostra agente/thread/backend
  e oferece **Parar** (encerra a sessão e os turnos).

## Backends

### Local (Windows)

- Screenshot via `System.Drawing`/`System.Windows.Forms` (virtual screen).
- Input via `user32` `SetCursorPos`/`mouse_event` e `SendKeys`.
- Janelas via `Get-Process`; foco via `WScript.Shell.AppActivate`.
- UI tree via UI Automation (`UIAutomationClient`).
- Requer workspace confiável (a política de aprovação exige `ToolCtx.workspace`).

### Docker

- Imagem em `docker/computer/` (Xvfb + openbox + Chromium + xdotool + scrot +
  noVNC).
- Container `computerDockerContainer` (default `lumina-computer`) iniciado no
  primeiro screenshot, com `--cap-drop ALL`, `no-new-privileges`, limites e
  `--network none`.
- noVNC em `http://127.0.0.1:6080/vnc.html` é **somente visualização humana** e
  só é publicado quando `dockerNetwork` está ligado (o padrão `none` mantém o
  agente sem rede e a observação é feita pelos screenshots).
- O agente executa `scrot`/`xdotool`/`wmctrl` via `docker exec`.

## Imagens para o modelo

- `computer_screenshot` devolve até 2 imagens por turno em `ToolOutcome.images`.
- O harness redimensiona para 1280 px e grava JPEG em
  `<app-data>/tool-images/<uuid>.jpg`; o DB guarda **somente caminho/metadados**.
- Modelos com visão recebem a imagem no resultado da tool (Anthropic:
  `tool_result` com blocos `image`; Responses: `function_call_output` com
  `input_image`; Google: `inlineData`; Chat Completions: mensagem `user`
  rotulada após o resultado). Modelos sem visão recebem só o texto/UI tree.
- A imagem entra no orçamento de contexto e não é congelada no prompt.

## Limites de segurança

- 4.000 caracteres por `computer_type`; 80 por combinação de tecla.
- Aprovação por ação; não há grant automático persistente nesta versão.
- Denylist conservadora de títulos (gerenciadores de senha, bancos, UAC,
  “senha”, “credential”): input/foco falha fechado
  (`COMPUTER_SENSITIVE_WINDOW`). A lista é heurística e não substitui a revisão
  humana da aprovação.
- `browser_open` abre o navegador real e usa as tools de desktop; um cliente CDP
  dedicado (DOM/refs, downloads e abas) ainda não está implementado.
- macOS/Linux local ainda não implementados.

## Testes

- `computer::tests` (backend por settings, escape de SendKeys).
- `policy::tests::computer_control_always_asks_even_in_autonomous_mode`.
- `db::tests::computer_audit_records_actions_without_text_and_counts_limits`.
- `harness::tests::tool_screenshots_are_persisted_as_paths_and_replayed_only_for_vision_models`.
- `providers::*::tests` (blocos de imagem por protocolo).
- Integração real (ignorada por padrão):
  `cargo test --lib docker_graphical_backend_screenshot_and_click -- --ignored`
  após `docker build -t lumina/computer:test docker/computer`. O teste sobe o
  container, captura 1440×900, clica e remove o container.
