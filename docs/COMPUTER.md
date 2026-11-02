# Computer use — contrato

> Estado: backend local Windows + Docker gráfico. Aprovação por ação. Sem
> automação de mouse/teclado sem consentimento.

## Capabilities

`AgentCapabilities`:

- `computerUse` — screenshot + clique/teclado;
- `screenCapture` — somente leitura (screenshot/window list/UI tree);
- `browserUse` — reservado para o browser CDP (ainda não implementado);
- `dockerExecution` — reservado para override de perfil Docker por agente.

Todas começam `false` e só removem acesso. As tools só entram no catálogo do
turno quando a capability correspondente está ligada.

## Tools (perfil Code)

| Tool | Aprovação | Efeito |
| --- | --- | --- |
| `computer_screenshot` | não (leitura) | PNG em `<app-data>/computer/<conversa>/`, dimensões |
| `computer_windows` | não (leitura) | lista id/título/app das janelas |
| `computer_ui_tree` | não (leitura) | árvore de acessibilidade (nome/tipo/bounds/id) |
| `computer_click` | **sempre** | move + clique esquerdo/direito/meio |
| `computer_type` | **sempre** | digita no foco; aprovação mostra só o tamanho |
| `computer_key` | **sempre** | combinação de teclas |
| `computer_focus` | **sempre** | foca uma janela por id |
| `browser_open` | **sempre** | abre http(s) no navegador padrão (local) ou Chromium (Docker); a página é operada pelas tools acima |

`RiskClass::Computer` sempre gera `Ask`, inclusive no modo Autônomo. O card usa
`ApprovalDetail::Other` com a descrição da ação. O usuário pode negar; sem canal
de aprovação a tool falha fechada (`APPROVAL_UNAVAILABLE`).

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

## Limites de segurança

- 4.000 caracteres por `computer_type`; 80 por combinação de tecla.
- Aprovação por ação; não há grant automático persistente nesta versão.
- Screenshots ficam no app-data e não são enviados ao modelo como imagem; o
  modelo usa `computer_windows` + `computer_ui_tree` + coordenadas.
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
- Integração real (ignorada por padrão):
  `cargo test --lib docker_graphical_backend_screenshot_and_click -- --ignored`
  após `docker build -t lumina/computer:test docker/computer`. O teste sobe o
  container, captura 1440×900, clica e remove o container.
