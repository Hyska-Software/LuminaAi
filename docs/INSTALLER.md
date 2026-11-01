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
pnpm installer --platform macos --universal
pnpm installer --platform linux
pnpm installer --dry-run
pnpm installer --ci --skip-tests
pnpm installer --platform windows --require-clean
```

O script:

1. Exige Node 20+, pnpm e cargo.
2. Valida que `package.json`, `src-tauri/Cargo.toml` e
   `src-tauri/tauri.conf.json` têm a mesma versão.
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
  macos-universal/Lumina-<versão>-macos-universal.dmg
  linux-x64/Lumina-<versão>-linux-x64.deb
  linux-x64/Lumina-<versão>-linux-x64.rpm
  linux-x64/Lumina-<versão>-linux-x64.AppImage
  linux-x64/release.json
  SHA256SUMS.txt
```

O script **não** apaga `src-tauri/target`; limpa apenas a pasta da plataforma em
`release/<versão>/`.

### 3.1 Versão

```bash
pnpm version:set 0.2.0
```

Atualiza os três arquivos. A versão do app no `app_info`, no `User-Agent` e no
prompt vem de `CARGO_PKG_VERSION`; por isso a sincronia é obrigatória. O teste
`scripts/installer/__tests__/shared.test.mjs` cobre a divergência.

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
- Versão mínima: macOS 11. `--universal` exige os alvos Rust
  `x86_64-apple-darwin` e `aarch64-apple-darwin`.
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
  manifesto/checksums e sincronia de versão.

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

- **tag `v*`** — publica a release; a tag precisa coincidir com a versão do app;
- **workflow_dispatch** — cria/atualiza a release da versão atual; o input
  `draft` permite testar sem publicar.

Cada job roda a plataforma nativa (não há cross-build):

```yaml
strategy:
  matrix:
    include:
      - os: windows-latest
        platform: windows
      - os: macos-14
        platform: macos
        args: --universal
      - os: ubuntu-22.04
        platform: linux
```

O workflow **não roda testes** por decisão de release: ele instala dependências,
executa `pnpm installer --platform <...> --skip-tests --ci --require-clean`,
baixa os três artefatos e combina tudo com `scripts/combine-release.mjs`
(necessário porque `release.json`/`SHA256SUMS.txt` teriam o mesmo nome nas três
plataformas). A release recebe os cinco instaladores + `release.json` +
`SHA256SUMS.txt` agregados.

### Regra de versão

A fonte é `package.json` (sincronizado com `Cargo.toml` e `tauri.conf.json`):

| Situação | Ação |
| --- | --- |
| versão do app **maior** que a última release | cria uma release nova |
| versão do app **igual** à release existente | atualiza os assets (`--clobber`) e publica/edita |
| versão do app **menor** que a última release | falha antes do build |
| tag `vX` diferente da versão do app | falha antes do build |

`DRAFT=true` mantém/cria a release como rascunho; `DRAFT=false` publica.
O workflow roda na `main` e precisa de `contents: write` (`GITHUB_TOKEN`).
Certificados continuam opcionais via secrets; sem eles o build é unsigned/ad-hoc.

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

## 9. Fora de escopo (por enquanto)

- Auto-update/`tauri-plugin-updater` (o manifesto já registra versão/SHA).
- Instalador customizado em macOS/Linux.
- Assinatura de repositório Linux (APT/RPM).
- Instalação por linha de comando em macOS/Linux (os pacotes nativos cobrem).
