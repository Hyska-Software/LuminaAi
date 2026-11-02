# Docker de execução — contrato

> Estado: execução local/Docker para `run_command`/`run_checks`/jobs, hardening de
> container, imagem gráfica separada, comandos de status/validação/cleanup.

## Settings

- `executionEnvironment`: `local` (default) ou `docker`;
- `dockerImage`: imagem dos comandos (default `node:22-bookworm`);
- `dockerNetwork`: rede do container (default `false`);
- `computerDockerImage` / `computerDockerContainer`: computer use gráfico;
- limites de concorrência/orçamento em `maxConcurrentTurns`,
  `maxConcurrentTurnsPerAgent`, `maxQueueLengthPerThread`,
  `agentDailyCostLimitUsd`.

## Comandos (`run_command`/`run_checks`/jobs)

Quando `executionEnvironment=docker`, `workspace::exec::docker_shell_for` monta:

```text
docker run --rm --init -i
  --cap-drop ALL
  --security-opt no-new-privileges
  --label lumina.owner=lumina
  --pids-limit 256
  --memory 2048m
  --cpus 2.0
  --user 1000:1000
  --tmpfs /tmp:rw,exec,nosuid,size=512m
  --read-only
  --mount type=bind,source=<workspace>,target=/workspace
  --workdir /workspace/<subdir>
  --network none
  <image> sh -lc <command>
```

Nunca monta home, `/`, socket do Docker ou credenciais. O output continua
passando por timeout/cancelamento/spill do runner.

## Imagens

- Comandos: `docker/agent` (a criar) ou qualquer imagem com `sh`; a imagem precisa
  existir no daemon.
- Computer use: `docker/computer/Dockerfile` (Xvfb + openbox + Chromium +
  xdotool + scrot + noVNC).
- Produção: pinar `image@sha256:...`; o validador mostra id/arquitetura e roda um
  smoke test `sh -lc true`.

## Comandos Tauri

- `docker_status` — daemon, versão, imagens;
- `docker_pull_image` — pull explícito com timeout;
- `docker_validate_image` — inspect + smoke run;
- `docker_cleanup` — remove containers com label `lumina.owner=lumina`.

## Testes

- `workspace::exec::tests::docker_shell_mounts_the_workspace_and_disables_network_by_default`
  cobre mount/workdir/rede/hardening/flags.
- Integração real com daemon é condicional ao ambiente (não roda na suíte padrão).

## Limitações atuais

- Perfil Docker por agente/workspace ainda não está exposto no editor; o setting
  é global e a capability `dockerExecution` é um gate reservado.
- `run_code` do Chat e o terminal interativo continuam locais.
- `--read-only` pode exigir imagem compatível (caches em `/tmp`/workspace).
- Windows usa Docker Desktop (containers Linux); não há suporte a containers
  Windows.
- Não há compose/devcontainer nem pull automático.
