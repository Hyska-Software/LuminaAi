# Docker gráfico do Lumina

Imagem usada pelo backend de computer use quando o agente roda em Docker.

## Imagem publicada (usuários do app)

O workflow `.github/workflows/computer-image.yml` publica a imagem em:

```text
ghcr.io/hyska-software/lumina-computer:latest
```

Ela é o default de `computerDockerImage`. No app, vá em **Configurações →
Ferramentas → Imagem do computer use** e use **Baixar imagem**. A imagem é
multi-arquitetura (`linux/amd64` e `linux/arm64`).

> O pacote do GHCR precisa estar **público** para o `docker pull` funcionar sem
> login. Depois do primeiro publish, ajuste a visibilidade do pacote nas
> configurações do GitHub. Para pacotes privados, o usuário deve rodar
> `docker login ghcr.io` antes do download.

## Build local (desenvolvimento)

```bash
docker build -t lumina/computer:latest docker/computer
```

No app, informe `lumina/computer:latest` em Configurações → Agentes → Desktop
privado → Imagem do computer use.

O app inicia o container automaticamente com:

- Xvfb + openbox + Chromium + xdotool/scrot/wmctrl;
- dois servidores RFB restritos ao loopback **dentro** do container: um somente
  de observação e outro para controle humano autorizado;
- `--cap-drop ALL`, `no-new-privileges`, limites de CPU/memória/pids;
- rede `none` por padrão. A interface usa uma ponte WebSocket local de uso único
  e `docker exec`/`socat`; nenhuma porta RFB é publicada no host e a visualização
  não exige habilitar a rede do agente.

O agente conversa com o display via `docker exec` (`computer_screenshot`,
`computer_click`, `computer_type`, `computer_key`, `computer_windows`,
`computer_focus`). O VNC nunca é exposto ao modelo.

As imagens anteriores não têm os dois servidores e `socat`: atualize a imagem
publicada ou faça o build local acima e encerre/reinicie a sessão. Não há pull
automático. O pacote `@novnc/novnc` (MPL-2.0) é o cliente integrado do renderer.

## Produção

- faça build com digest fixo e registre `image@sha256:...`;
- não monte o home do usuário nem o socket do Docker;
- o navegador dentro do container deve ser tratado como não confiável;
- para sessões com dados sensíveis, use uma imagem efêmera por tarefa.
