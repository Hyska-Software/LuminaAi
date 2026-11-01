# Instalador — evidências

Data: 2026-11-01. Escopo: Windows self-installer, DMG macOS, pacotes Linux,
script de build e release de produção pelo GitHub Actions.

## Entregue

| Área | Arquivos |
| --- | --- |
| UI do setup | `installer.html`, `src/installer/**` |
| Engine Windows | `src-tauri/src/installer/{mod,context,windows}.rs` |
| Permissões | `src-tauri/capabilities/installer.json` |
| Configs por plataforma | `src-tauri/tauri.{windows,macos,linux}.conf.json` |
| Marca do DMG | `installer/macos/dmg-background{,@2x}.png` |
| Build/versão | `scripts/build-installer.mjs`, `scripts/set-version.mjs`, `scripts/combine-release.mjs` |
| Release GitHub | `.github/workflows/installer.yml` |
| Docs | `docs/INSTALLER.md`, README, ARCHITECTURE §14 |

## Release publicada

- **https://github.com/Hyska-Software/LuminaAi/releases/tag/v0.1.0**
- Versão `0.1.0`, tag `v0.1.0`, release **publicada** (não draft), commit
  `4cb95494f0bfbd50cfd06fe8cc9a968b4f1b3785`.
- Assets: 5 instaladores + `release.json` agregado + `SHA256SUMS.txt`.
- CI: run **41266939107** — `Version`, `windows`, `macos`, `linux` e
  `GitHub Release` todos com conclusão `success`.
- O mesmo fluxo já foi exercitado antes: o run 41266004899 criou o draft
  `v0.1.0`; o run 41266939107 encontrou a release existente, atualizou os assets
  e publicou. Isso valida o caminho “versão igual → atualizar”.

### Instaladores publicados

| Arquivo | Bytes | SHA-256 |
| --- | ---: | --- |
| `Lumina-Setup-0.1.0-windows-x64.exe` | 17.625.600 | `ef05449974175ab6117856b881b19651dfba1af46d9113f6fd58985da15d8931` |
| `Lumina-0.1.0-macos-universal.dmg` | 20.271.140 | `29d07fdadab2495ce7c010c021d31a59bab40587703d069f03e3c14e6a1a8d9d` |
| `Lumina-0.1.0-linux-x64.deb` | 11.167.592 | `16e78dddaf71bc181a19af6166fb659ebd0522466d12ec59f33cbe07c3b59f3b` |
| `Lumina-0.1.0-linux-x64.rpm` | 11.172.556 | `120b1feabd0dca804cb4418ae8736b18c494f5545f877ceeae370d78f33b8f35` |
| `Lumina-0.1.0-linux-x64.AppImage` | 157.293.048 | `bc8c30ad051175b3c7d57c9ce4f56bb864fe9de9f0175b622eefaedcdc0d2f5f` |

Checksums verificados baixando os assets publicados com `gh release download
v0.1.0`; todos os cinco arquivos conferem com `SHA256SUMS.txt`.

## Verificação local

| Comando | Resultado |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 136 arquivos, 2477 testes, todos passando |
| `pnpm test -- src/installer` | 15 testes passando |
| `pnpm test:installer` | 9 testes passando (inclui `combine-release`) |
| `cargo test --lib` | 1050 passando, 0 falhas, 13 ignored |
| `cargo check` | exit 0, sem erros no módulo installer |
| `node scripts/build-installer.mjs --dry-run` | exit 0 |
| `pnpm installer --platform windows --skip-tests` | artefato gerado e testado |

## Smoke tests nativos (histórico)

Antes da simplificação do workflow, o run **41261261235** executou os três
sistemas com smoke tests e todos passaram:

- **Windows:** instalação por usuário, `Lumina.exe` + `.lumina-install`,
  desinstalação e remoção de pasta/registro.
- **macOS:** DMG montado, `codesign --verify --deep --strict`, cópia para
  `/Applications`, remoção e unmount.
- **Linux:** `.deb` instalado/removido, `.rpm` instalado/removido e
  `.AppImage --appimage-extract` validado.

O workflow de produção foi simplificado por decisão do produto: **sem testes e
sem smoke no CI**, apenas build nativo e release no GitHub.

## Limitações externas

- **UAC interativo**: os runners do GitHub não estão elevados; o caminho
  “todos os usuários” (Program Files/HKLM) exige um UAC real. O código recusa a
  instalação por máquina sem administrador e foi validado localmente nesse
  aspecto. Teste de aceite final precisa de uma VM Windows.
- **WebView2 ausente**: exige remover o runtime em uma VM descartável. O
  instalador tem a checagem e o bootstrapper oficial, mas o cenário “runtime
  realmente ausente” não é reproduzível no runner sem quebrar o ambiente.
- Builds permanecem **unsigned/ad-hoc** até configurarem os secrets de
  Authenticode e Apple Developer ID/notarização.
