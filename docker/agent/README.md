# Imagem de execução do agente

Imagem de referência para `executionEnvironment=docker` e para o terminal/
`run_code` em Docker. Inclui:

- Node.js 22 + corepack (pnpm/yarn via corepack);
- Python 3 + pip/venv;
- git, git-lfs, ripgrep, jq, curl;
- toolchain C (`build-essential`, `pkg-config`) para módulos nativos.

O workspace é montado pelo app em `/workspace`; a imagem não contém segredos,
socket do Docker nem home persistente. O runner usa `--user 1000:1000`, que
corresponde ao usuário `node` da imagem.

```bash
docker build -t zylara/agent:latest docker/agent
```

Em produção, faça pull/pin por digest (`zylara/agent@sha256:...`) e valide com
`docker_validate_image` na aba de ferramentas.
