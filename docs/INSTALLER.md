# Zylara — instalador e distribuição

> Fonte única do desenho de empacotamento. Mudou o instalador? Atualize este
> documento, `README.md` (seção Desenvolvimento) e `docs/ARCHITECTURE.md` §14.

## 1. Decisões

| Plataforma | Instalador | Formato |
| --- | --- | --- |
| Windows | **Sim**, wizard próprio em React dentro do binário | `Zylara-Setup-<versão>-x64.exe` |
| macOS | **Não é necessário wizard** | `.dmg` com o `.app` + atalho de Aplicativos |
| Linux | **Não é necessário wizard** | `.deb`, `.rpm` e `.AppImage` |

O Windows usa o **próprio executável do Zylara** em modo setup. Isso mantém a
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
> WebView2 do instalador fica em `%TEMP%\ZylaraSetup`, separado dos dados do
> app, para que a desinstalação com purga não tente apagar um diretório em uso.

O binário entra em modo setup/uninstall quando:

- recebe `--setup` ou `--uninstall`; ou
- o nome do arquivo contém `setup`/`uninstall` — é assim que o artefato
  `Zylara-Setup-<versão>-x64.exe` e o desinstalador instalado
  `Uninstall Zylara.exe` se identificam, sem precisar de flag; ou
- `ZYLARA_SETUP=1` no ambiente (somente desenvolvimento).

A detecção por nome fica em `mode_from_name()` (`src-tauri/src/installer/mod.rs`)
e `uninstall` tem precedência sobre `setup`. Sem essas condições, o binário abre o
app normal. O modo setup **não inicializa** `AppState`, SQLite, harness, OAuth ou
terminais.

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

### 2.2.1 Desinstalador

O mesmo binário é copiado duas vezes para a pasta de instalação:

| Arquivo | Papel |
| --- | --- |
| `Zylara.exe` | aplicativo |
| `Uninstall Zylara.exe` | desinstalador (mesmo payload, sem flag) |
| `.zylara-install` | marcador de instalação (`app.zylara.chat` + versão) |

O desinstalador abre a **mesma UI** do instalador (`src/installer/**`), em
inglês por padrão, com o seletor de idioma no cabeçalho. Fluxo:

1. **Boas-vindas** — versão instalada, escopo, pasta, tamanho em disco e os
   caminhos de dados; o que é **mantido por padrão** (conversas, anexos,
   artefatos, configurações, chaves de API) e o que é **sempre removido**
   (arquivos do app, atalhos e entrada em Aplicativos e recursos).
2. **Remover** — confirmação com “Remover também meus dados” (opt-in, em dois
   passos quando marcado), a lista de pastas de dados com o rótulo
   mantidas/apagadas e o aviso de que o app aberto será fechado.
3. **Progresso** — etapas na ordem real da engine: validar, fechar o app,
   remover dados (se pedido), remover arquivos, remover registro/atalhos, finalizar.
4. **Concluído** — fecha a janela.

Como o desinstalador fica dentro da pasta que ele apaga, ele se copia para
`%TEMP%` e roda de lá (`relaunch_from_temp_uninstall`), apagando a cópia ao sair
(`schedule_self_delete`). O registro aponta para ele:

```text
UninstallString      = "<pasta>\Uninstall Zylara.exe"
QuietUninstallString = "<pasta>\Uninstall Zylara.exe" --silent
```

`Zylara.exe --uninstall` continua funcionando: instalações antigas que apontavam
para ele são migradas na próxima atualização, quando o Registro e o atalho
`Uninstall Zylara.lnk` (no Menu Iniciar) são reescritos e o atalho legado
`Desinstalar Zylara.lnk` é removido.

### 2.3 Escopos

| | Por usuário | Todos os usuários |
| --- | --- | --- |
| Pasta padrão | `%LOCALAPPDATA%\Programs\Zylara` | `%ProgramFiles%\Zylara` |
| UAC | Não | Sim, no início da instalação |
| Registro | `HKCU\...\Uninstall\Zylara` | `HKLM\...\Uninstall\Zylara` (visão 64-bit) |
| Atalhos | Desktop/Menu do usuário | Desktop público/Menu comum |
| Desinstalação | `Uninstall Zylara.exe` na pasta, sem elevação | Relança elevada |
| Dados | `%APPDATA%\app.zylara.chat` + `%LOCALAPPDATA%\app.zylara.chat` | idem, por usuário |

Em instalação por máquina, o desinstalador remove apenas os dados do usuário que
está executando a remoção; os demais perfis mantêm os próprios dados. A remoção
de dados é sempre opt-in e pede confirmação.

### 2.4 Engine

- Payload: `Zylara.exe` **e** `Uninstall Zylara.exe` (o desinstalador é o mesmo
  binário; o nome do arquivo seleciona o modo). Cópia atômica por arquivo:
  `<nome>.new` → `ReplaceFileW`/rename; remove o `Zone.Identifier` para o app
  instalado não herdar Mark-of-the-Web.
- Fecha o app em execução (`taskkill` sem `/F`, com timeout), nunca o setup.
- Atalhos via `IShellLinkW`: `Zylara.lnk` aponta para o app e
  `Uninstall Zylara.lnk` aponta para o desinstalador (sem argumentos).
- Registro de Apps & Features com `DisplayName`, `DisplayVersion`, `Publisher`,
  `InstallLocation`, `DisplayIcon`, `UninstallString`, `QuietUninstallString`,
  `EstimatedSize` (duas cópias do binário), `NoModify` e `NoRepair`.
- Desinstalação roda a partir de uma cópia em `%TEMP%` para poder apagar a pasta
  original; a cópia temporária se remove ao sair.
- WebView2: checagem por registro; se ausente, baixa o bootstrapper oficial da
  Microsoft e executa `/silent /install` antes de abrir a janela. A primeira
  execução em uma máquina sem WebView2 mostra uma mensagem nativa.
- Log em `%TEMP%\Zylara-Setup-<data>.log`, sem chaves de API.

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

O desinstalador instalado dispensa `--uninstall` (o nome do arquivo já seleciona
o modo); as flags continuam aceitas para scripts e para `Zylara.exe --uninstall`.

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
  windows-x64/Zylara-Setup-<versão>-windows-x64.exe
  macos-arm64/Zylara-<versão>-macos-arm64.dmg
  linux-x64/Zylara-<versão>-linux-x64.deb
  linux-x64/Zylara-<versão>-linux-x64.rpm
  linux-x64/Zylara-<versão>-linux-x64.AppImage
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
| `src-tauri/Cargo.lock` | registro do pacote `zylara` |

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

- **Windows:** SmartScreen pode avisar. O `Zylara-Setup.exe` é o mesmo binário do
  app; assinar o executável cobre setup, app instalado e desinstalador.
  Configure `ZYLARA_WINDOWS_CERT_THUMBPRINT` (e opcionalmente
  `ZYLARA_TIMESTAMP_URL`) ou use `tauri.conf`/`signCommand`.
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
- O usuário arrasta o Zylara para Aplicativos. Não há wizard; a remoção é
  arrastar para o Lixeira.
- Dados: `~/Library/Application Support/app.zylara.chat`,
  `~/Library/Caches/app.zylara.chat` e dados do WebKit. O app tem “limpar
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
- Dados: `~/.local/share/app.zylara.chat`; o pacote não apaga dados do usuário.

## 6. Testes e validação

```bash
pnpm typecheck
pnpm test
pnpm test:installer
cd src-tauri && cargo test --lib
```

Cobertura específica:

- `src/installer/state.test.ts`: fluxo do wizard (incluindo o fluxo do
  desinstalador `welcome → confirmUninstall → progress → finish`), ordem das
  etapas de desinstalação, escopos, validação de caminho, eventos de
  progresso/erro/sucesso e opções.
- `src/installer/InstallerApp.test.tsx`: navegação do desinstalador a partir da
  tela de boas-vindas, dados preservados por padrão e idioma inicial em inglês.
- `src-tauri/src/installer/mod.rs`: `mode_from_name` — `Uninstall Zylara.exe`,
  `Zylara-Setup-<versão>-windows-x64.exe` e `Zylara.exe`.
- `src-tauri/src/installer/windows.rs`: comparação de versões, quoting,
  tamanho humanizado, `UninstallString`/`QuietUninstallString` apontando para
  `Uninstall Zylara.exe` e tamanho instalado contando as duas cópias.
  Instalação/desinstalação reais são verificadas por um smoke test silencioso em
  diretório/registro isolados, sem UI automation.
- `scripts/installer/__tests__/shared.test.mjs`: semver, nomes de artefatos,
  manifesto/checksums e sincronia das cinco fontes de versão.
- `scripts/installer/__tests__/version.test.mjs`: bump patch/minor/major,
  versão personalizada, dry-run, downgrade explícito, fontes divergentes e
  falha sem escrita parcial.

Smoke test manual no Windows:

```powershell
$dir = Join-Path (Get-Location) '.tmp-install'
.\src-tauri\target\debug\zylara.exe --setup --silent --scope user --dir $dir --no-desktop --no-start-menu --no-launch
Get-ChildItem $dir            # Zylara.exe, Uninstall Zylara.exe, .zylara-install
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Zylara" /v UninstallString
& "$dir\Uninstall Zylara.exe" --silent
```

O desinstalador dispensa `--uninstall` e pode ser executado direto da pasta. Não
rode o smoke test em uma máquina com instalação real: ele reescreve o registro
`HKCU\...\Uninstall\Zylara`.

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
Silicon** (`macos-26`, arm64): o artefato é `Zylara-<v>-macos-arm64.dmg`, sem
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
| “O Zylara não fechou” | Feche o app manualmente; o setup não força a morte para não perder dados. |
| Pasta bloqueada na atualização | O app está aberto ou um antivírus está segurando o exe; feche e tente de novo. |
| `Uninstall Zylara.exe` ausente na pasta | Instalação feita por uma versão anterior a 0.7.1; rode o setup novo por cima ou use `Zylara.exe --uninstall`. |
| Desinstalador fecha sozinho ao abrir | Ele se reabre a partir de `%TEMP%` para poder apagar a própria pasta; a janela nova é a que importa. |
| `pnpm installer` avisa sobre árvore suja | Normal em desenvolvimento; use `--require-clean` no CI e faça commit antes do release. |
| Linux não abre em distro antiga | Build foi feito em glibc mais nova; use Ubuntu 22.04 como baseline. |
| AppImage não abre | Falta FUSE ou WebKitGTK; use `--appimage-extract-and-run` ou o `.deb`. |
| Job `macos` cancelado em 0s ("This job was cancelled") | Imagem do runner em depreciação/brownout; use `macos-26` (imagem arm64 atual). |
| Mac Intel não recebe atualização | A release publica apenas `macos-arm64`; apps x86_64 não são mais suportados. |
| Outros jobs cancelados junto | Alguém cancelou o run; `fail-fast: false` evita que uma falha derrube as demais plataformas. |

## 9. Atualização no app

O Zylara consulta as releases publicadas em `Hyska-Software/ZylaraAi` e avisa o
usuário quando há uma versão estável mais nova. **Verificar é automático;
baixar e instalar são sempre decisões explícitas.**

### 9.1 Fonte

1. `https://github.com/Hyska-Software/ZylaraAi/releases/latest/download/release.json`
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

- Ao abrir o app (a primeira checagem da sessão roda sempre) e depois a cada
  60 minutos enquanto ele fica aberto; voltar o foco na janela aproveita a
  mesma janela de 60 minutos.
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
| Windows | `Zylara-Setup-<v>-windows-x64.exe` | O app abre o wizard e encerra em seguida; o wizard detecta a instalação, pula escopo/pasta e preserva os dados |
| macOS | `Zylara-<v>-macos-arm64.dmg` | Abre o DMG; arrastar para Aplicativos |
| Linux | `.AppImage` (preferido), `.deb`, `.rpm` | Abre o pacote no sistema ou revela o AppImage na pasta |

#### 9.5.1 Instalação gerenciada (Linux x64/macOS arm64)

A release publica também `Zylara-install-<v>-linux-x64.sh` e
`Zylara-install-<v>-macos-arm64.sh`. O script embute versão, nome, tamanho e
SHA-256 do payload, baixa o artefato exato daquela release, verifica tamanho e
hash e instala por usuário:

- Linux: `~/.local/opt/zylara/Zylara.AppImage` e
  `${XDG_DATA_HOME:-~/.local/share}/applications/zylara-managed.desktop`.
- macOS: `~/Applications/Zylara.app` (o DMG é montado e o `.app` copiado com
  `ditto`).

O script grava `<app-data>/managed-install.json` com `schemaVersion`, `method:
"managed-script"`, plataforma, arquitetura, `installPath` e versão. O app só
considera a instalação gerenciada quando o marcador, o destino esperado e o
caminho real em execução (`APPIMAGE` no Linux; bundle derivado de `current_exe`
no macOS) coincidem. Marcador ausente/inválido, caminho divergente ou
plataforma não suportada falham fechado para o modo manual.

Com uma instalação gerenciada, o estado `ready` mostra **Instalar e reiniciar**.
O backend revalida o hash, grava o job em `<app-data>/managed-update/job.json`,
inicia um helper com o mesmo executável, espera o handshake `ready` e encerra o
app. O helper aguarda o processo terminar, substitui o payload (com staging e
backup no macOS), grava o marcador e `<app-data>/managed-update/result.json` e
reabre o app. Na próxima abertura o resultado é mostrado e confirmado. Falha de
staging/promoção mantém ou restaura a versão anterior. Nenhum passo acontece
sem o clique explícito.

Instalações manuais (DMG em `/Applications`, AppImage avulso, DEB/RPM) e o
Windows continuam usando as ações anteriores. O script não remove outras
instalações nem migra dados automaticamente.

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
$env:ZYLARA_UPDATE_BASE_URL = "http://127.0.0.1:8787"
```

O servidor deve responder `/releases/latest/download/release.json` e
`/releases/download/v<versão>/<artefato>`. A variável é ignorada em builds de
release. Os testes puros de seleção de artefato, versão, hashes e download
usam um servidor TCP efêmero, sem depender da rede.

### 9.8 Testes

```bash
pnpm test:installer
(cd src-tauri && cargo test --lib update)
pnpm test
```

Cobertura: comparação SemVer (incluindo prerelease), parse/validação do
`release.json` e do fallback da API, seleção por plataforma/arquitetura,
allow-list de URLs, SHA-256 e parcial, detecção de download pronto, skip,
cache local e os estados do chip/popover/Configurações. `pnpm test:installer`
cobre a geração/verificação dos scripts gerenciados e a instalação em `HOME`
temporário (Linux/macOS). O teste
`update::feed::tests::fetches_the_live_release_feed` é `#[ignore]` e consulta o
GitHub real sob demanda.

## 10. Fora de escopo (por enquanto)

- `tauri-plugin-updater` (o app usa o próprio manifesto e o instalador Zylara).
- Delta updates, instalação silenciosa em segundo plano e canal beta.
- Substituição automática fora do fluxo gerenciado (o script e **Instalar e
  reiniciar** são os únicos caminhos).
- Wizard customizado em macOS/Linux; o script gerenciado é um bootstrap POSIX,
  não um wizard.
- Assinatura de repositório Linux (APT/RPM) e instalação por linha de comando
  em macOS/Linux fora do script gerenciado.

