# Instalador — evidências

Data: 2026-10-31. Escopo: Windows self-installer, DMG macOS e pacotes Linux +
script de build/CI.

## Entregue

| Área | Arquivos |
| --- | --- |
| UI do setup | `installer.html`, `src/installer/**` |
| Engine Windows | `src-tauri/src/installer/{mod,context,windows}.rs` |
| Permissões | `src-tauri/capabilities/installer.json` |
| Configs por plataforma | `src-tauri/tauri.{windows,macos,linux}.conf.json` |
| Marca do DMG | `installer/macos/dmg-background{,@2x}.png` |
| Build/versão | `scripts/build-installer.mjs`, `scripts/set-version.mjs`, `scripts/installer/**` |
| CI manual | `.github/workflows/installer.yml` |
| Docs | `docs/INSTALLER.md`, README, ARCHITECTURE §14 |

## Verificação executada

| Comando | Resultado |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 136 arquivos, 2477 testes, todos passando |
| `pnpm test -- src/installer` | 15 testes, todos passando |
| `pnpm test:installer` | 7 testes, todos passando |
| `cargo test --lib` | 1050 passando, 0 falhas, 13 ignored |
| `cargo check` | exit 0, sem erros no módulo installer |
| `node scripts/build-installer.mjs --dry-run` | exit 0; versão/commit/assets validados |
| `pnpm installer --platform windows --skip-tests` | artefato gerado |
| `pnpm tauri build --debug --no-bundle --config tauri.macos.conf.json` | config validada |
| `pnpm tauri build --debug --no-bundle --config tauri.linux.conf.json` | config validada |

## Smoke tests do instalador

- Release `Lumina-Setup-0.1.0-windows-x64.exe` aberto sem argumentos:
  - janela `Lumina Setup` criada;
  - `installer.html` embutido carregado (`http://tauri.localhost/installer.html`);
  - `installer_context` invocado pela UI (log do instalador).
- Instalação silenciosa por usuário em `.tmp-install`: `Lumina.exe` + marcador
  `.lumina-install`; registro HKCU criado.
- Atualização silenciosa sobre a instalação existente: binário substituído e
  registro mantido.
- Desinstalação silenciosa: pasta e entrada HKCU removidas.
- Purga silenciosa com `APPDATA`/`LOCALAPPDATA` temporários: ambos os diretórios
  de dados removidos.
- Instalação `--scope machine` sem admin: recusada com erro claro, sem criar
  `Program Files\Lumina`.
- Atalhos: área de trabalho e Menu Iniciar criados e removidos no uninstall.
- App normal continua abrindo com título `Lumina` após o refactor de janela.
- Checksum do artefato confere com `release.json`/`SHA256SUMS.txt`.
  Último artefato: `Lumina-Setup-0.1.0-windows-x64.exe`, 17.626.624 bytes,
  SHA-256 `bd021753a2a8f9b9df127eb0e63a93b804c273738c289647a9cacb3fe323f970`.

## Limitações do host

- O host é Windows. DMG e `.deb/.rpm/.AppImage` não podem ser produzidos aqui;
  as configs foram validadas pelo CLI do Tauri e têm testes estáticos. O
  workflow manual executa cada plataforma no runner nativo.
- Build unsigned por decisão: SmartScreen (Windows) e Gatekeeper (macOS) podem
  avisar até os certificados serem configurados.
- Teste visual manual em Windows 10/11 com WebView2 ausente e UAC real ainda
  precisa ser feito em VM; o caminho de instalação por máquina exige UAC.
