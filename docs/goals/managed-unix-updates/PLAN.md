# Instalação gerenciada e atualização própria no Linux/macOS

> Status: **planejamento revisado**. Este documento fixa o desenho da instalação
> por usuário e da atualização aplicada pelo próprio app. Não altera DMG, DEB,
> RPM, AppImage manual nem o fluxo Windows.
>
> Documentos relacionados: `docs/INSTALLER.md`, `docs/ARCHITECTURE.md`,
> `docs/DESIGN.md` e `docs/I18N.md`.

## 1. Objetivo

Oferecer uma instalação gerenciada, por usuário, no Linux x64 e no macOS arm64.
O usuário roda um script oficial da release; o app passa a reconhecer o local
instalado e pode substituir o próprio payload depois de um download verificado.
A instalação continua sendo uma ação explícita: o botão **Instalar e reiniciar**
só aparece no estado `ready` e é o único caminho que inicia o helper. Fechar o
app, reiniciar o computador, verificar atualizações ou terminar um download não
aplica a versão nova.

Instalações existentes por DMG, DEB, RPM ou AppImage manual não são migradas
automaticamente. Rodar o script é a migração explícita; o app não tenta adivinhar
uma instalação manual. O Windows continua usando o setup próprio já existente.

## 2. Destinos e artefatos

| Plataforma | Payload gerenciado | Integração |
| --- | --- | --- |
| Linux x64 | `~/.local/opt/zylara/Zylara.AppImage` | `~/.local/share/applications/zylara-managed.desktop` (ou `$XDG_DATA_HOME/applications/...`) |
| macOS arm64 | `~/Applications/Zylara.app` | Abertura do bundle instalado |

As releases oficiais oferecem somente Linux x64 e macOS arm64 para esse fluxo.
O script e a detecção recusam outras combinações. Os formatos atuais continuam
publicados para os fluxos manuais.

Cada release publica um script gerado a partir do artefato da própria release:

- `Zylara-install-<versão>-linux-x64.sh`
- `Zylara-install-<versão>-macos-arm64.sh`

O script embute a versão, o nome, o tamanho e o SHA-256 exatos do payload. Ele
não consulta `latest` nem `release.json`, evitando que script e payload venham de
releases diferentes. O combinador de release aceita `.sh`, inclui os scripts no
`release.json` agregado e no `SHA256SUMS.txt`, e mantém a rejeição de nomes
duplicados. O workflow atual já publica todos os arquivos de `dist/`.

## 3. Script de instalação

O script é POSIX (`#!/bin/sh`), usa `set -eu`, `umask 077` e um trap de limpeza.
Ele nunca usa `sudo`, `pkexec` ou gerenciador de pacotes.

Sequência:

1. Escolhe o idioma (`pt`, `es` ou `en`) por `ZYLARA_LANG`/`LC_ALL`/`LANG`.
2. Exige `HOME` absoluto; no Linux usa `XDG_DATA_HOME` absoluto ou
   `~/.local/share`; no macOS usa `~/Library/Application Support`.
3. Valida `uname -s`/`uname -m` contra a plataforma e a arquitetura embutidas.
4. Exige as ferramentas de download, hash e, no macOS, `hdiutil`, `ditto`,
   `plutil` e `open`.
5. Cria o diretório do destino e recusa symlink ou tipo incompatível.
6. Verifica espaço livre com `df -Pk` (quando disponível).
7. Baixa a URL fixa para um diretório temporário com `curl` (HTTPS com
   `--proto '=https' --tlsv1.2`) ou `wget`.
8. Confere tamanho e SHA-256 antes de tocar no destino.
9. Linux: copia para `.Zylara.AppImage.new.<pid>` no mesmo diretório, define
   `0755` e promove com `mv -f` (rename atômico). Em falha, o staging é removido
   e o arquivo antigo permanece.
10. macOS: monta o DMG com `hdiutil`, localiza exatamente um `*.app`, valida
    `CFBundleIdentifier == app.zylara.chat` e o executável de
    `Contents/MacOS`, copia com `ditto` para um staging no mesmo volume, valida
    `codesign --verify --deep --strict` quando houver assinatura, renomeia o
    destino para backup, promove o staging e restaura o backup em falha.
11. Escreve/atualiza o `.desktop` Linux com `Exec="<caminho escapado>" %U`,
    `TryExec`, `X-Zylara-Managed=true` e os demais campos padrão.
12. Grava atomicamente o marcador de instalação gerenciada no app-data.
13. Oferece abrir o app (`open` no macOS; `nohup ... &` no Linux). Testes usam
    `ZYLARA_NO_LAUNCH=1`.
14. É idempotente: repetir substitui o payload e reescreve integração/marcador
    sem remover o app-data nem outras instalações.

Falha de `.desktop` ou do marcador depois da promoção não desfaz o payload; o
script informa o caminho instalado e falha com código 1.

## 4. Marcador e detecção

Marcador versionado em `<app-data>/managed-install.json`:

```json
{
  "schemaVersion": 1,
  "method": "managed-script",
  "platform": "linux|macos",
  "arch": "x64|arm64",
  "installPath": "/caminho/absoluto/do/payload",
  "version": "0.8.0"
}
```

O app só considera a instalação gerenciada quando:

- `schemaVersion == 1` e `method == "managed-script"`;
- plataforma/arquitetura são `linux/x64` ou `macos/arm64`;
- o caminho é absoluto, o destino existe e não é symlink;
- o caminho do marcador e o esperado são iguais após canonicalização;
- o caminho real em execução é o mesmo: no Linux `APPIMAGE`; no macOS o bundle
  `.app` derivado de `current_exe`, com o executável em `Contents/MacOS`.

O marcador é limitado a 64 KiB. Marcador ausente, inválido, de versão
desconhecida, caminho divergente ou `APPIMAGE` ausente resultam em modo manual
(`no-marker`, `invalid-marker`, `unsupported-platform`, `missing-running-path`
ou `path-mismatch`). O app não apaga o marcador nesses casos. O caminho fornecido
pelo renderer nunca é usado para decidir a instalação.

## 5. Helper de atualização

O diretório de trabalho é `<app-data>/managed-update/`, fora de
`<app-data>/updates/` porque a limpeza de downloads remove entradas
desconhecidas naquele diretório.

```text
<app-data>/managed-update/
  job.json          # apagado no boot e depois do uso
  ready             # handshake app ↔ helper
  result.json       # lido por update_status; apagado por acknowledge
  install.log       # append; rotaciona acima de 1 MiB
  helper/zylara-apply
```

O app grava `job.json` (`0600`) com versão, plataforma, arquitetura, home,
app-data, caminho/tamanho/SHA-256 do artefato, caminho de instalação, marcador,
resultado, log, ready e o PID do app. O helper valida todos os caminhos: job
dentro de `managed-update`, artefato dentro de `updates/<versão>`, destino
exatamente o esperado, SHA-256 com 64 hex e destino sem symlink.

No clique em **Instalar e reiniciar**, o backend revalida o hash, copia o
executável atual para `helper/zylara-apply`, grava o job, inicia o helper com
`--apply-managed-update <job>` e espera o arquivo `ready` por até 10 s. Se a
cópia não iniciar, tenta uma vez o executável atual diretamente; se ainda falhar,
retorna erro e o app continua aberto. Só depois do `ready` o app inicia o
encerramento gracioso.

O helper:

1. lê o job, grava `ready` e espera o PID do app desaparecer (até 120 s);
2. recalcula tamanho e SHA-256 do artefato;
3. Linux: copia para staging, `chmod 0755`, `rename` atômico;
4. macOS: monta o DMG, valida bundle/assinatura, `ditto` para staging, backup do
   destino, promoção e restauração do backup em falha;
5. grava o marcador com a nova versão;
6. grava `result.json` **antes** de relançar o app;
7. relança o destino (Linux: executa o AppImage; macOS: `open`).

O resultado tem `schemaVersion`, `version`, `status`
(`installed`, `rolledBack` ou `failed`), `message` opcional e `completedAt`.
Uma versão promovida que inicia e trava não é detectada automaticamente; o
resultado fica `installed`. O rollback cobre falhas de download, verificação,
staging, backup e promoção. O helper roda com o mesmo usuário do app; não é uma
fronteira de privilégio.

## 6. Contratos e UI

`UpdateStatus` expõe `managed` e `lastInstall` ao renderer:

```ts
type ManagedInstallMode = 'managed' | 'manual';
interface ManagedUpdateStatus {
  mode: ManagedInstallMode;
  installPath?: string | null;
  installedVersion?: string | null;
  supported: boolean;
  reason?: string | null;
}
type ManagedInstallStatus = 'installed' | 'rolledBack' | 'failed';
interface ManagedInstallResult {
  version: string;
  status: ManagedInstallStatus;
  message?: string | null;
  completedAt: number;
}
```

- `UpdatePanel` mostra **Instalar e reiniciar** no estado `ready` somente quando
  `managed.supported` e o artefato é `appimage` (Linux) ou `dmg` (macOS).
  Download, verificação e estados automáticos nunca iniciam o helper.
- O clique inicia a instalação; o app se fecha e reabre. O painel/`UpdateChip`
  usam o texto “Fechando para atualizar…”. A seção de Configurações mostra o
  selo “Instalação gerenciada”.
- Na próxima abertura, `lastInstall` gera um toast de sucesso ou de falha e é
  confirmado por `acknowledge_update_result`.
- Modo manual (sem marcador, caminho divergente, DEB/RPM ou Windows) mantém as
  ações atuais: abrir DMG, revelar AppImage, abrir instalador do sistema ou setup
  Windows.
- Não existem `autoDownload` nem `autoInstall`; `updates.json` não muda.

## 7. Testes e verificação

- Node: renderização dos dois scripts, `sh -n`, rejeição de alvos/metadados
  inválidos, tradução, combinação de `.sh` no manifesto/checksums e instalação
  real em `HOME` temporário no Linux (payload, `.desktop`, marcador,
  idempotência e hash inválido). No macOS, teste com DMG falso gerado por
  `hdiutil`.
- Rust: alvos/caminhos, marcador válido/inválido, symlink, `APPIMAGE` ausente,
  job válido/adulterado, resultado/ack, argumentos do helper, espera por
  `ready`/PID, aplicação Linux e aplicação macOS com DMG fake.
- Renderer: hidratação de `managed`/`lastInstall`, toast e acknowledge, ausência
  de instalação automática, rótulo **Instalar e reiniciar** e estado de
  fechamento.
- Comandos:

```bash
pnpm test:installer
pnpm typecheck
pnpm test
pnpm i18n:check
cd src-tauri && cargo test --lib update::managed && cargo test --lib update && cargo check
```

Os testes Unix se auto-pulam no Windows. A montagem real de DMG e o rollback de
bundle exigem host macOS (ou CI macOS).

## 8. Critérios de aceite

- O script instala Linux x64/AppImage e macOS arm64/bundle nos destinos por
  usuário, sem privilégios administrativos, com hash/tamanho verificados.
- O marcador reconhece a instalação somente quando marcador, destino e caminho
  em execução coincidem; qualquer divergência falha fechado para o modo manual.
- Download e instalação continuam explícitos; fechar, reiniciar, verificar ou
  terminar um download não instala nada.
- **Instalar e reiniciar** só aparece após o download verificado e é o único
  caminho para o helper.
- Falha de staging/promoção mantém ou restaura o payload anterior e não apaga
  dados do usuário.
- O resultado da instalação é exibido na próxima abertura e pode ser confirmado.
- DMG, DEB, RPM, AppImage manual e Windows continuam funcionando.
- Textos de UI, erros do backend e mensagens do script existem em inglês,
  pt-BR e espanhol.

## 9. Limites

O script não remove outras instalações, não migra dados e não substitui
gerenciador de pacotes. Assinatura e notarização continuam sendo
responsabilidade da release; o script não contorna Gatekeeper/SmartScreen. O
helper não tenta detectar uma versão promovida que trava na inicialização.
Atualizações silenciosas, auto-download, auto-instalação, canais beta, delta
updates e repositórios APT/RPM permanecem fora deste desenho.
