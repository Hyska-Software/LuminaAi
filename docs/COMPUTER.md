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

- Imagem padrão publicada em `ghcr.io/hyska-software/lumina-computer:latest`
  (workflow `computer-image.yml`); também funciona uma imagem local de
  `docker/computer/` (Xvfb + openbox + Chromium + xdotool + scrot + noVNC).
  O app oferece **Baixar imagem** em Configurações → Ferramentas e no erro do
  painel Tela; não faz pull automático.
- Container `<computerDockerContainer>-<conversationId>` iniciado no primeiro
  screenshot, com `--cap-drop ALL`, `no-new-privileges`, limites e
  `--network none`.
- noVNC é **somente visualização humana**, publicado em uma porta loopback
  aleatória (`docker port`); só existe quando `dockerNetwork` está ligado.
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

### Navegador CDP

`browser_open` abre uma sessão **local** de Chromium/Edge (perfil isolado por
conversa, porta CDP aleatória em loopback). As tools de página são:

| Tool | Aprovação | Efeito |
| --- | --- | --- |
| `browser_open` / `browser_navigate` | **sempre** | navega no navegador controlado |
| `browser_snapshot` | não | URL/título, árvore de acessibilidade com refs `e1…` e screenshot |
| `browser_click` / `browser_type` / `browser_press` | **sempre** | interage por ref/tecla; o card de `type` mostra só o tamanho |
| `browser_extract` | não | texto visível da página (script fixo, limite de 30k chars) |
| `browser_tabs` | não | lista abas |
| `browser_wait` | não | espera 50–5000 ms |
| `browser_download` | **sempre** | clica no ref e espera o arquivo na pasta de downloads |

Segurança do navegador:

- apenas `http`/`https`; bloqueia `file://`, `chrome://`, `devtools://` e
  `javascript:`;
- perfil e downloads fora do perfil pessoal do usuário;
- sem `Runtime.evaluate` controlado pelo modelo (apenas scripts fixos);
- página nunca compartilha origem com o WebView do app;
- Docker gráfico continua sendo operado por screenshot/xdotool nesta fase.
- As tools de desktop/navegador são do **perfil Code**: o agente precisa ter um
  workspace vinculado para receber o catálogo e o canal de aprovação. O painel
  Tela/Navegador pode abrir a sessão para inspeção mesmo sem workspace, mas o
  agente não executa input até vincular um workspace.

## Painel do agente (sidebar direita)

O layout Agentes ganhou um painel dockable/overlay com abas **Tela**,
**Rotinas**, **Navegador** e **Dados** (`AgentPanel`). O painel de ferramentas do
workspace (`CodePanel`) continua separado: as duas superfícies alternam no mesmo
dock.

- **Tela** usa `computer_preview` (screenshot para a UI, sem modelo/DB), cards de
  ambiente e pausa/controle humano. A pausa é validada no backend:
  tools de input retornam `COMPUTER_PAUSED`.
- **Rotinas** lista/cria/executa e mostra `agent_routine_runs`.
- **Navegador** controla o CDP local; “Assumir o controle” foca a janela real.
- **Dados** mostra identidade/modelo/capabilities, uso, memória, tarefas, fila e
  auditoria.

Ambiente por agente (`agents.computer_environment`):

```text
auto | private_desktop | this_computer | browser | off
```

`auto` segue `executionEnvironment`; `private_desktop` força Docker;
`this_computer` força Windows local; `browser` remove as tools de desktop;
`off` remove computador e navegador. “Desktop na nuvem” aparece desabilitado como
**Em breve** (local-first).

## Auditoria antes da ação (gateway)

Toda tool de computador/navegador passa por `tools::code::computer::run`, que:

1. aplica capability, ambiente, pausa e rate limit;
2. grava uma linha `pending` em `computer_actions` **antes** de executar;
3. executa a ação;
4. fecha a linha com `result`, decisão, erro, duração e `ended_at`.

Se o processo morrer no meio, o boot marca `pending` como `interrupted`. A linha
também guarda `policy_rule` (`computer.risk`) e `initiator` (`human`/`goal_round`).
Nunca grava texto digitado, clipboard ou bytes de screenshot.

## Isolamento do desktop gráfico

O container Docker é **por conversa**:

```text
<computerDockerContainer>-<conversationId>
```

Dois agentes/threads nunca compartilham o mesmo Xvfb, clipboard ou Chromium. Cada
container tem label `lumina.owner=lumina`, portas noVNC loopback aleatórias e é
removido no Stop da sessão, no cleanup de boot e no `docker_cleanup`.

## Actions de desktop

Além de screenshot/click/type/key/focus/windows/UI tree:

- `computer_drag` — arrastar entre coordenadas;
- `computer_scroll` — roda do mouse em uma coordenada;
- `computer_move` — mover ponteiro sem clicar;
- `computer_wait` — espera 50–5000 ms;
- `computer_clipboard` — read/write com aprovação; write mostra só o tamanho.

`computer_clipboard` e `computer_drag`/`scroll`/`move` também passam pela denylist
de título e pela política de apps.

## Política de apps e hosts

Settings:

- `computerAllowedApps` / `computerBlockedApps` — allow/deny por processo ou
  título; denylist vence e é aplicada antes de qualquer input.
- `browserAllowedDomains` / `browserBlockedDomains` — hosts/sufixos; denylist
  vence. Allowlist vazia libera hosts públicos.
- `browserAllowPrivateHosts` — localhost/RFC1918; default ligado para dev local.
- metadata de nuvem (`169.254.169.254`, `metadata.google.internal`) é sempre
  bloqueada.
- `computerAllowUnattendedBrowser` — permite browser em rotinas/tarefas sem card
  de aprovação; desktop continua fail-closed.

## Takeover interativo no painel

O painel Navegador, quando “Assumir o controle” está ativo:

- clicar no preview envia `browser_click_at` com coordenadas convertidas do
  letterbox para o viewport;
- digitar no preview envia `browser_insert_text`/`browser_press_key`;
- o agente fica pausado no backend e só volta com “Devolver ao agente”;
- cliques usam `Input.dispatchMouseEvent` e digitação usa `Input.insertText`
  (eventos confiáveis), não `element.click()`/`value=`.

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
- `computer::browser::tests` (URL http/https, perfil sanitizado, refs CDP,
  allow/deny de hosts/private/metadata).
- `computer::tests::graphical_container_is_isolated_per_conversation` e
  `screenshot_retention_removes_old_files_and_empty_dirs`.
- `db::tests::computer_audit_pending_action_is_finished_or_interrupted`.
- Integração real CDP (ignorada por padrão):
  `cargo test --lib local_cdp_browser_navigates_snapshots_and_types -- --ignored`.
- Integração real (ignorada por padrão):
  `cargo test --lib docker_graphical_backend_screenshot_and_click -- --ignored`
  após `docker build -t lumina/computer:test docker/computer`. O teste sobe o
  container, captura 1440×900, clica e remove o container.
