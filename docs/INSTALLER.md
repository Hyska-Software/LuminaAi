# Lumina — instalador e distribuição

> Fonte única do desenho de empacotamento. Mudou o instalador? Atualize este
> documento, `README.md` (seção Desenvolvimento) e `docs/ARCHITECTURE.md` §14.

## 1. Decisões

| Plataforma | Instalador | Formato |
| --- | --- | --- |
| Windows | **Sim**, wizard próprio em React dentro do binário | `Lumina-Setup-<versão>-x64.exe` |
| macOS | **Não é necessário wizard** | `.dmg` com o `.app` + atalho de Aplicativos |
| Linux | **Não é necessário wizard** | `.deb`, `.rpm` e `.AppImage` |

O Windows usa o **próprio executável do Lumina** em modo setup. Isso mantém a
identidade visual (tokens, Inter, botões, cards, ícones e movimento do app) sem
um segundo frontend e sem manter um template NSIS. O setup copia o binário para
o destino; o app instalado é o mesmo arquivo.

macOS e Linux seguem as convenções de cada sistema: DMG (arrastar para
Aplicativos) e pacotes gerenciados pelo sistema/AppImage. Criar um wizard
próprio nessas plataformas duplicaria o gerenciador de pacotes, exigiria root
para instalar no sistema e adicionaria uma dependência de WebKitGTK ao
instalador.

## 2. Windows — modo setup

### 2.1 Detecção de modo

> O setup usa o mesmo binário do app, mas **não** inicializa o chat. O perfil
> WebView2 do instalador fica em `%TEMP%\LuminaSetup`, separado dos dados do
> app, para que a desinstalação com purga não tente apagar um diretório em uso.

O binário entra em modo setup/uninstall quando:

- recebe `--setup` ou `--uninstall`; ou
- o nome do arquivo contém `setup`/`uninstall` (o build gera
  `Lumina-Setup-<versão>-x64.exe`); ou
- `LUMINA_SETUP=1` no ambiente (somente desenvolvimento).

Sem essas condições, o binário abre o app normal. O modo setup **não inicializa**
`AppState`, SQLite, harness, OAuth ou terminais.

### 2.2 Fluxo

1. **Boas-vindas** — versão, resumo do app e estado de atualização.
2. **Escopo** — “Apenas para mim” (padrão, sem UAC) ou “Para todos os usuários”
   (UAC; `Program Files`, atalhos públicos e `HKLM`).
3. **Destino** — pasta, espaço livre e validação de caminho local.
4. **Opções** — atalho na área de trabalho, Menu Iniciar e abrir ao concluir.
5. **Progresso** — etapas, log expansível, cancelamento e rollback.
6. **Concluído** — abrir o app/pasta ou fechar.

Atualizações mantêm conversas, arquivos, configurações e chaves de API. O escopo
é travado após a instalação; para trocar de escopo é preciso desinstalar antes.

### 2.3 Escopos

| | Por usuário | Todos os usuários |
| --- | --- | --- |
| Pasta padrão | `%LOCALAPPDATA%\Programs\Lumina` | `%ProgramFiles%\Lumina` |
| UAC | Não | Sim, no início da instalação |
| Registro | `HKCU\...\Uninstall\Lumina` | `HKLM\...\Uninstall\Lumina` (visão 64-bit) |
| Atalhos | Desktop/Menu do usuário | Desktop público/Menu comum |
| Desinstalação | Sem elevação | Relança elevada |
| Dados | `%APPDATA%\app.lumina.chat` + `%LOCALAPPDATA%\app.lumina.chat` | idem, por usuário |

Em instalação por máquina, o desinstalador remove apenas os dados do usuário que
está executando a remoção; os demais perfis mantêm os próprios dados. A remoção
de dados é sempre opt-in e pede confirmação.

### 2.4 Engine

- Cópia atômica: `Lumina.exe.new` → `ReplaceFileW`/rename; remove o
  `Zone.Identifier` para o app instalado não herdar Mark-of-the-Web.
- Fecha o app em execução (`taskkill` sem `/F`, com timeout), nunca o setup.
- Atalhos via `IShellLinkW`; `Desinstalar Lumina.lnk` usa `--uninstall`.
- Registro de Apps & Features com `DisplayName`, `DisplayVersion`, `Publisher`,
  `InstallLocation`, `DisplayIcon`, `UninstallString`, `QuietUninstallString`,
  `EstimatedSize`, `NoModify` e `NoRepair`.
- Desinstalação roda a partir de uma cópia em `%TEMP%` para poder apagar a pasta
  original; a cópia temporária se remove ao sair.
- WebView2: checagem por registro; se ausente, baixa o bootstrapper oficial da
  Microsoft e executa `/silent /install` antes de abrir a janela. A primeira
  execução em uma máquina sem WebView2 mostra uma mensagem nativa.
- Log em `%TEMP%\Lumina-Setup-<data>.log`, sem chaves de API.

### 2.5 Flags

Instalação:

```text
--setup
--silent
--scope user|machine
--dir <caminho>
--desktop | --no-desktop
--start-menu | --no-start-menu
--launch | --no-launch
```

Desinstalação:

```text
--uninstall
--silent
--purge              # remove também os dados do usuário atual
--elevated           # uso interno do relançamento UAC
--from-temp          # uso interno da cópia temporária
```

`--silent` não abre o app, mesmo com `--launch`, para manter testes e CI
determinísticos.

## 3. Build

```bash
pnpm installer                    # host atual, versão atual
pnpm installer --platform windows --allow-dirty
pnpm installer --platform macos
pnpm installer --platform linux
pnpm installer --dry-run
pnpm installer --ci --skip-tests
pnpm installer --platform windows --require-clean
```

O script:

1. Exige Node 20+, pnpm e cargo.
2. Valida que `package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/tauri.conf.json`, `src/lib/appVersion.ts` e
   `src-tauri/Cargo.lock` têm a mesma versão.
3. Registra commit/branch e marca `dirty` no manifesto. `--require-clean` falha
   se houver alterações não commitadas (use no CI de release); `--allow-dirty`
   apenas silencia o aviso em builds locais.
4. Roda `pnpm typecheck`, `pnpm test` e `cargo test --lib` por padrão.
5. Compila a build mais recente com `tauri build` e coleta os artefatos.
6. Gera `SHA256SUMS.txt` e `release.json` por plataforma.

Saída:

```text
release/<versão>/
  windows-x64/Lumina-Setup-<versão>-windows-x64.exe
  macos-arm64/Lumina-<versão>-macos-arm64.dmg
  linux-x64/Lumina-<versão>-linux-x64.deb
  linux-x64/Lumina-<versão>-linux-x64.rpm
  linux-x64/Lumina-<versão>-linux-x64.AppImage
  linux-x64/release.json
  SHA256SUMS.txt
```

O script **não** apaga `src-tauri/target`; limpa apenas a pasta da plataforma em
`release/<versão>/`.

### 3.1 Versão

Bump local interativo (Windows/PowerShell), **sem build**:

```powershell
.\scripts\bump-version.ps1                 # menu: patch/minor/major/personalizada
.\scripts\bump-version.ps1 -Minor          # atalho
.\scripts\bump-version.ps1 0.2.0           # versão explícita
.\scripts\bump-version.ps1 0.2.0 -WhatIf   # prévia, não escreve
```

O script mostra as cinco fontes, permite escolher/rebaixar a versão (com
confirmação), aplica em todos os arquivos e verifica o resultado. Ele **não**
compila, não roda testes e não gera instalador.

O equivalente cross-platform é:

```bash
pnpm version:set 0.2.0
pnpm version:set --bump minor
```

Arquivos mantidos em sincronia:

| Arquivo | Uso |
| --- | --- |
| `package.json` | workflow de release e nomes dos artefatos |
| `src-tauri/Cargo.toml` | `CARGO_PKG_VERSION` (`app_info`, updater, wizard e `DisplayVersion`) |
| `src-tauri/tauri.conf.json` | metadados do bundle |
| `src/lib/appVersion.ts` | fallback da versão na interface |
| `src-tauri/Cargo.lock` | registro do pacote `lumina` |

Todas as plataformas usam a mesma versão; não há versão por app. A sidebar, o
Sobre e o wizard do instalador leem a versão compilada, então um build futuro já
usa a nova versão. O teste `scripts/installer/__tests__/shared.test.mjs` cobre a
divergência entre as cinco fontes.

O script não faz commit. Revise com `git diff`, faça o commit e envie para a
`main`; o workflow cria a tag `v<versão>` e publica a release automaticamente
quando a versão é nova. Se a versão for a mesma da última release, nada é
compilado. O build de release exige árvore limpa (`--require-clean`).

### 3.2 Assinatura

Sem certificados, o build é **unsigned** e o manifesto registra
`signed: false`:

- **Windows:** SmartScreen pode avisar. O `Lumina-Setup.exe` é o mesmo binário do
  app; assinar o executável cobre setup, app instalado e desinstalador.
  Configure `LUMINA_WINDOWS_CERT_THUMBPRINT` (e opcionalmente
  `LUMINA_TIMESTAMP_URL`) ou use `tauri.conf`/`signCommand`.
- **macOS:** sem identidade, o script usa assinatura **ad-hoc** (`-`), necessária
  em Apple Silicon, mas o Gatekeeper ainda avisa. Para distribuição pública:
  Developer ID Application + notarização (`APPLE_SIGNING_IDENTITY`,
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_ISSUER`,
  `APPLE_API_KEY`, `APPLE_API_KEY_PATH`) e staple.
- **Linux:** checksums SHA-256; assinatura GPG pode ser adicionada depois.

## 4. macOS

- `src-tauri/tauri.macos.conf.json` define `app` + `dmg`, fundo dark
  (`installer/macos/dmg-background.png`), 660×400, app em (180,190) e
  Aplicativos em (480,190).
- Versão mínima: macOS 11. O build oficial é **arm64 (Apple Silicon)**, gerado
  na imagem `macos-26`; não há mais DMG Intel nem universal. `--universal`
  continua disponível para builds locais sob demanda (exige os alvos Rust
  `x86_64-apple-darwin` e `aarch64-apple-darwin`).
- O usuário arrasta o Lumina para Aplicativos. Não há wizard; a remoção é
  arrastar para o Lixeira.
- Dados: `~/Library/Application Support/app.lumina.chat`,
  `~/Library/Caches/app.lumina.chat` e dados do WebKit. O app tem “limpar
  dados” nas Configurações.

## 5. Linux

- `src-tauri/tauri.linux.conf.json` gera `.deb`, `.rpm` e `.AppImage`.
- `.AppImage` usa `bundleMediaFramework: true` para os previews de áudio/vídeo.
- `.deb`/`.rpm` instalam binário, `.desktop` e ícones; a remoção é feita pelo
  gerenciador de pacotes.
- Build em Ubuntu 22.04 (glibc 2.35) para compatibilidade; não construir em
  Windows/macOS. Dependências de build incluem `libwebkit2gtk-4.1-dev`,
  `libgtk-3-dev`, `librsvg2-dev`, `patchelf`, `rpm` e, por causa dos previews
  de mídia, as bibliotecas de runtime do GStreamer
  (`libgstreamer1.0-0`, `libgstreamer-plugins-base1.0-0` e plugins).
- Dados: `~/.local/share/app.lumina.chat`; o pacote não apaga dados do usuário.

## 6. Testes e validação

```bash
pnpm typecheck
pnpm test
pnpm test:installer
cd src-tauri && cargo test --lib
```

Cobertura específica:

- `src/installer/state.test.ts`: fluxo do wizard, escopos, validação de caminho,
  eventos de progresso/erro/sucesso e opções.
- `src-tauri/src/installer/windows.rs`: comparação de versões, quoting e
  tamanho humanizado. Instalação/desinstalação reais são verificadas por um
  smoke test silencioso em diretório/registro isolados, sem UI automation.
- `scripts/installer/__tests__/shared.test.mjs`: semver, nomes de artefatos,
  manifesto/checksums e sincronia das cinco fontes de versão.
- `scripts/installer/__tests__/version.test.mjs`: bump patch/minor/major,
  versão personalizada, dry-run, downgrade explícito, fontes divergentes e
  falha sem escrita parcial.

Smoke test manual no Windows:

```powershell
$dir = Join-Path (Get-Location) '.tmp-install'
.\src-tauri\target\debug\lumina.exe --setup --silent --scope user --dir $dir --no-desktop --no-start-menu --no-launch
Get-ChildItem $dir
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Lumina"
.\src-tauri\target\debug\lumina.exe --uninstall --silent
```

## 7. Release pelo GitHub Actions

O workflow de produção é `.github/workflows/installer.yml` (`Release`) e roda:

- **push na `main`** — se a versão do `package.json` for maior que a última
  release publicada, compila as três plataformas e cria a tag `v<versão>` e a
  release automaticamente. Se a versão for a mesma, o workflow termina sem
  compilar nada (push de documentação/código sem bump); se for menor, falha.
- **workflow_dispatch** — cria/atualiza a release da versão atual; o input
  `draft` permite gerar um rascunho. É o caminho para republicar a mesma versão
  (atualizar assets com `--clobber`).

A tag é criada pelo próprio workflow apontando para o commit que disparou o run
(`gh release create --target "$GITHUB_SHA"`); não é preciso criar/pushar tag
manualmente. Rascunhos e prereleases não entram no cálculo da “última release”
(`gh release list --exclude-drafts`).

Cada job roda a plataforma nativa (não há cross-build):

```yaml
strategy:
  matrix:
    include:
      - os: windows-latest
        platform: windows
      - os: macos-26
        platform: macos
        args: --arch arm64
      - os: ubuntu-22.04
        platform: linux
```

Use labels de imagens **suportadas** pelo GitHub: `macos-14` foi aposentada em
02/11/2026 e, durante os *brownouts* de depreciação, o job é encerrado com
"This job was cancelled" sem rodar nenhum passo. O release publica só **Apple
Silicon** (`macos-26`, arm64): o artefato é `Lumina-<v>-macos-arm64.dmg`, sem
DMG Intel e sem `--universal` (nada de cross-compile no CI).

O workflow **não roda testes** por decisão de release: ele instala dependências,
executa `pnpm installer --platform <...> --skip-tests --ci --require-clean`,
baixa os três artefatos e combina tudo com `scripts/combine-release.mjs`
(necessário porque `release.json`/`SHA256SUMS.txt` teriam o mesmo nome nas três
plataformas). A release recebe os cinco instaladores + `release.json` +
`SHA256SUMS.txt` agregados.

### Regra de versão

A fonte é `package.json` (sincronizado com `Cargo.toml`, `tauri.conf.json`,
`appVersion.ts` e `Cargo.lock` pelo bump local):

| Situação | Ação |
| --- | --- |
| versão do app **maior** que a última release | push na `main` compila e cria a release/tag automaticamente |
| versão do app **igual** à release existente | push na `main`: nenhum build (skip); `workflow_dispatch`: atualiza os assets |
| versão do app **menor** que a última release | falha antes do build |
| fontes de versão divergentes | falha no job `Version` antes do build |

`DRAFT=true` (somente `workflow_dispatch`) mantém/cria a release como rascunho;
push na `main` publica. O workflow precisa de `contents: write`
(`GITHUB_TOKEN`). Certificados continuam opcionais via secrets; sem eles o build
é unsigned/ad-hoc.

## 8. Troubleshooting

| Sintoma | Causa/ação |
| --- | --- |
| SmartScreen “app não reconhecido” | Build unsigned; assine com Authenticode. Não desative proteções. |
| Gatekeeper bloqueia o `.app` | Build unsigned/ad-hoc; use “Abrir mesmo assim” ou notarize. |
| Setup não abre | WebView2 ausente e download falhou; instale o WebView2 Runtime. |
| “O Lumina não fechou” | Feche o app manualmente; o setup não força a morte para não perder dados. |
| Pasta bloqueada na atualização | O app está aberto ou um antivírus está segurando o exe; feche e tente de novo. |
| `pnpm installer` avisa sobre árvore suja | Normal em desenvolvimento; use `--require-clean` no CI e faça commit antes do release. |
| Linux não abre em distro antiga | Build foi feito em glibc mais nova; use Ubuntu 22.04 como baseline. |
| AppImage não abre | Falta FUSE ou WebKitGTK; use `--appimage-extract-and-run` ou o `.deb`. |
| Job `macos` cancelado em 0s ("This job was cancelled") | Imagem do runner em depreciação/brownout; use `macos-26` (imagem arm64 atual). |
| Mac Intel não recebe atualização | A release publica apenas `macos-arm64`; apps x86_64 não são mais suportados. |
| Outros jobs cancelados junto | Alguém cancelou o run; `fail-fast: false` evita que uma falha derrube as demais plataformas. |

## 9. Atualização no app

O Lumina consulta as releases publicadas em `Hyska-Software/LuminaAi` e avisa o
usuário quando há uma versão estável mais nova. **Verificar é automático;
baixar e instalar são sempre decisões explícitas.**

### 9.1 Fonte

1. `https://github.com/Hyska-Software/LuminaAi/releases/latest/download/release.json`
   — apelido do GitHub para a release estável mais recente. É a fonte primária:
   não passa pelo limite de 60 req/h da API e já traz `version`, tamanho e
   SHA-256 de cada artefato.
2. `/repos/.../releases/latest` — fallback para releases antigas sem
   `release.json`; usa o `digest` do asset (ou descarta o artefato sem hash).
3. `/repos/.../releases/tags/v<versão>` — só para as **notas**, carregadas
   quando o popover abre. Falha de notas não impede o download.

Rascunhos e prereleases nunca são oferecidos. Se o repositório ainda não tem
release, o estado é “tudo atualizado” (sem toast de erro).

### 9.2 Cadência

- Ao abrir o app (a primeira checagem da sessão roda sempre) e depois uma vez
  por dia enquanto ele fica aberto; voltar o foco na janela aproveita a mesma
  janela de 24h.
- Manual em **Configurações → Sobre → Atualizações → Verificar agora**.
- O aviso aparece uma vez por versão (toast) e permanece como chip na title bar
  até instalar ou **Ignorar esta versão**. Uma versão mais nova supera o
  “ignorar”.
- Falha na checagem automática é silenciosa: o último resultado continua no chip
  marcado como “sem conexão” e a tela de Configurações mostra o erro com
  “Verificar agora”. Falha manual mostra toast + erro inline.

### 9.3 UI

- **Title bar** (`src/components/layout/UpdateChip.tsx`): pill de 28px logo
  depois da marca. Estados: disponível (accent), baixando (percentual + barra
  de 2px), verificando, pronto (success), erro (danger). Abaixo de `lg` mostra
  só o ícone. Some quando não há atualização ou a versão foi ignorada.
- **Popover** (`UpdatePanel.tsx`): notas, plataforma/tamanho/SHA-256, download
  com progresso em bytes e velocidade, verificação, “Instalar agora”,
  “Abrir pasta”, cancelar e “Agora não”/“Ignorar esta versão”.
- **Configurações → Sobre → Atualizações** (`UpdateSection.tsx`): versão atual,
  switch de checagem automática, status, verificação manual, ações e link para
  a release. As duas superfícies compartilham o mesmo estado
  (`src/lib/store/updateStore.ts`) e as mesmas ações.

### 9.4 Download e verificação

- Grava em `<app-data>/updates/<versão>/<nome>.partial`, com progresso
  incremental (~120ms) via `Channel<UpdateEvent>` e cancelamento.
- Confere `Content-Length` e o tamanho declarado, com teto de 1,5 GB.
- Calcula SHA-256 durante o stream; em divergência remove o parcial e nunca
  promove o arquivo.
- Só renomeia para o nome final (atômico) depois da verificação.
- Antes de executar, **recalcula o SHA-256**; um arquivo modificado no disco é
  recusado. Versões antigas baixadas são limpas; parciais de uma sessão
  encerrada também.

### 9.5 Instalação por plataforma

| Plataforma | Arquivo | Ação |
| --- | --- | --- |
| Windows | `Lumina-Setup-<v>-windows-x64.exe` | Abre o wizard existente; ele detecta a instalação, pula escopo/pasta, fecha o app e preserva os dados |
| macOS | `Lumina-<v>-macos-arm64.dmg` | Abre o DMG; arrastar para Aplicativos |
| Linux | `.AppImage` (preferido), `.deb`, `.rpm` | Abre o pacote no sistema ou revela o AppImage na pasta |

A instalação não é silenciosa na v1. Assinatura/Authenticode continuam sendo o
que remove o aviso do SmartScreen/Gatekeeper (§3.2).

### 9.6 Preferências e cache

`<app-data>/updates.json` (escrita atômica, schema versionado):

```json
{
  "schemaVersion": 1,
  "preferences": {
    "autoCheck": true,
    "lastCheckAt": 1767225600000,
    "skippedVersion": null,
    "notifiedVersion": "0.2.0"
  },
  "cached": { "latestVersion": "0.2.0", "asset": { "…": "…" } }
}
```

O `cached` permite o chip aparecer na hora ao abrir e continuar visível offline.
Notas não são persistidas. Arquivo ausente/corrompido volta aos defaults
(`autoCheck: true`) sem bloquear o app.

### 9.7 Teste local do feed

Em builds **debug** é possível apontar o feed para um servidor local:

```powershell
$env:LUMINA_UPDATE_BASE_URL = "http://127.0.0.1:8787"
```

O servidor deve responder `/releases/latest/download/release.json` e
`/releases/download/v<versão>/<artefato>`. A variável é ignorada em builds de
release. Os testes puros de seleção de artefato, versão, hashes e download
usam um servidor TCP efêmero, sem depender da rede.

### 9.8 Testes

```bash
cd src-tauri && cargo test --lib update
pnpm test
```

Cobertura: comparação SemVer (incluindo prerelease), parse/validação do
`release.json` e do fallback da API, seleção por plataforma/arquitetura,
allow-list de URLs, SHA-256 e parcial, detecção de download pronto, skip,
cache local e os estados do chip/popover/Configurações. O teste
`update::feed::tests::fetches_the_live_release_feed` é `#[ignore]` e consulta o
GitHub real sob demanda.

## 10. Fora de escopo (por enquanto)

- `tauri-plugin-updater` (o app usa o próprio manifesto e o instalador Lumina).
- Delta updates, instalação silenciosa em segundo plano e canal beta.
- Substituição automática do `.app` no macOS e do AppImage em execução.
- Instalador customizado em macOS/Linux.
- Assinatura de repositório Linux (APT/RPM) e instalação por linha de comando
  em macOS/Linux.

