# Docker gráfico do Lumina

Imagem usada pelo backend de computer use quando o agente roda em Docker.

```bash
docker build -t lumina/computer:latest docker/computer
```

O app inicia o container automaticamente com:

- Xvfb + openbox + Chromium + xdotool/scrot/wmctrl;
- noVNC em `http://127.0.0.1:6080/vnc.html` (visualização humana);
- `--cap-drop ALL`, `no-new-privileges`, limites de CPU/memória/pids;
- rede `none` (o noVNC é publicado em loopback, não é rede do agente).

O agente conversa com o display via `docker exec` (`computer_screenshot`,
`computer_click`, `computer_type`, `computer_key`, `computer_windows`,
`computer_focus`). O VNC nunca é exposto ao modelo.

## Produção

- faça build com digest fixo e registre `image@sha256:...`;
- não monte o home do usuário nem o socket do Docker;
- o navegador dentro do container deve ser tratado como não confiável;
- para sessões com dados sensíveis, use uma imagem efêmera por tarefa.
