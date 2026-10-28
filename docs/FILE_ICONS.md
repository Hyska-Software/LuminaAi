# Ícones de tipo de arquivo — integração Material Icon Theme

> Status: **implementado e verificado** (2026-10-28). Fonte visual:
> [material-icon-theme](https://github.com/material-extensions/vscode-material-icon-theme)
> (`material-icon-theme@5.40.0`, licença MIT). Este documento registra a análise
> das bibliotecas, a decisão, o mapa de resolução, as cores e como manter.

## 1. Objetivo

Trocar os **ícones placeholder** dos arquivos do workbench de Code (lucide
`FileCode`/`FileText`/`FileImage`… repetidos para dezenas de extensões) por
**ícones reais, um por tipo de arquivo, com a cor da linguagem/tipo** — PDF em
vermelho, Rust em laranja, TypeScript em azul, Markdown em azul-claro, etc. —
como em editores de código (VS Code/Zed), mantendo a árvore legível no tema
claro e escuro.

Superfícies atendidas: **FileTree** (aba Arquivos), **header da prévia** e
**linha de arquivo da aba Alterações**. Pastas continuam com o par lucide
`Folder`/`FolderOpen` (tingido pelo token `accent`), sem ícones coloridos — a
distinção pasta × arquivo fica mais clara assim.

## 2. Análise das bibliotecas

A biblioteca de ícones dos modelos (`@lobehub/icons-static-svg`) **não serve**
para isto: ela é uma coleção de marcas de IA/provedores (977 marcas +
variantes), e uma varredura dos 978 SVGs não tem nenhum ícone de tipo de
arquivo (`pdf`, `rust`, `markdown`, `file`, `folder`…). Para PDF/Rust/etc. é
necessária outra fonte.

Alternativas avaliadas (todas consultadas no registro npm):

| Pacote | Versão | Licença | Conteúdo | Tamanho (unpacked) | Veredito |
| --- | --- | --- | --- | --- | --- |
| `material-icon-theme` | 5.40.0 | **MIT** | 1.256 SVGs **coloridos** + manifesto `dist/material-icons.json` (2.156 nomes de arquivo, 1.391 extensões) | 1,68 MB | **escolhido** |
| `@iconify-json/material-icon-theme` | 1.2.74 | MIT | o mesmo conjunto em Iconify JSON | 898 KB | equivaleria a um runtime/plugin Iconify e a dados não-tree-shakeáveis; rejeitado |
| `@iconify-json/vscode-icons` | 1.2.94 | MIT | ~1.250 SVGs coloridos em Iconify JSON (`file_type_*`) | 3,4 MB | viável, porém mais pesado e com nomes menos diretos; rejeitado |
| `devicon` | 2.18.0 | MIT | logos de linguagens/frameworks | 139 MB | sem ícones de documento (PDF/Word), pacote enorme; rejeitado |
| `simple-icons` | 16.36.0 | CC0-1.0 | marcas monocromáticas (cor vem de um hex da marca) | 16 MB | sem PDF/Word/Excel e sem formas de “arquivo”; rejeitado |
| `file-icons-js` | 1.1.0 | MIT | ícones do Atom via fonte/`font-family` | 537 KB | não é SVG componente e depende de fonte; rejeitado |
| `lucide-react` (já no app) | 1.61 | ISC | ícones de **linha**, genéricos | — | mantém pastas e UI; não representa tipo de arquivo |

Detalhes que pesaram na decisão:

1. **SVGs coloridos prontos** — o requisito do usuário é a cor da linguagem/tipo,
   não um glifo monocromático tingido por token. O Material Icon Theme já entrega
   `fill`/gradientes com as cores oficiais (Rust `#ff7043`, PDF `#ef5350`,
   TypeScript `#0288d1`, Markdown `#42a5f5`…).
2. **Manifesto do VS Code como base** para “extensão/nome → ícone”: o mapa
   segue `dist/material-icons.json` (`.mdx` → MDX, `.scss` → Sass, `tsconfig.*.json`
   → TSConfig…), com **substituições intencionais** onde o ícone upstream não
   está no bundle ou um glifo diferente representa melhor o tipo:
   `.ogg` → áudio (manifesto: vídeo), `.o`/`.so`/`.dylib` → `lib`
   (manifesto: 3D/`dll`), `.pl` → Perl (manifesto: Prolog), `security.md` →
   Markdown (manifesto: `lock`), `poetry.lock`/`Pipfile.lock`/`uv.lock` →
   `lock` (manifesto: `poetry`/`json`), `*.blend`/`*.unity`/`*.fbx` → 3D,
   `Cargo.toml`/`Cargo.lock` → Rust (o manifesto não tem entrada e cairia em
   `toml`/`lock`), `analysis_options.yaml` → Dart, `podfile.lock` → Ruby.
3. **Offline/Tauri**: importamos apenas os SVGs usados via Vite `?raw`, sem CDN,
   sem fonte de ícones e sem importar o JS do pacote (a dependência `chroma-js`
   do pacote não entra no bundle — só os arquivos `.svg`).
4. **Bundle sob controle**: 115 arquivos, 66,9 KB de SVG cru no total
   (≈36,8 KB no chunk principal gzipado, medido no build; ~2,7% do main). Os
   ícones entram no chunk inicial porque o workbench pode abrir a qualquer
   momento; lazy-load do `CodePanel` fica como otimização futura. O restante das
   1.256 marcas fica de fora.
5. **Licença**: MIT, compatível com o requisito de “MIT ou similar”; a atribuição
   permanece no pacote instalado (§9).

### Decisão

- Dependência **`material-icon-theme@5.40.0`** (pin exato — nomes de arquivo e
  cores são o contrato; atualização exige revisar mapa e testes).
- SVGs **coloridos inline** (`?raw` + `dangerouslySetInnerHTML` de constante
  interna, nunca de input do usuário); sem `img`, sem CDN, sem fonte.
- Resolução **pura** em `src/lib/fileIcons.ts` (testável sem DOM).
- Um componente de renderização `FileIcon` reutilizado nas três superfícies.

## 3. Arquitetura

```
src/lib/fileIcons.ts
   ├─ FILE_ICON_KEYS / FileIconKey / FILE_ICON_FALLBACK ('file')
   ├─ EXTENSION_ICONS (220 extensões)
   ├─ FILE_NAME_ICONS (121 nomes: package.json, Cargo.toml, Dockerfile…)
   ├─ NAME_PATTERNS (26: Dockerfile.*, compose*.yml, tsconfig.*.json, vite.config.*…)
   └─ fileIconKeyFor(pathOrName) ─────────────┐
                                              │  FileIconKey
src/lib/fileIconAssets.ts                     │
   └─ FILE_ICON_SVG[key] (115 SVGs, ?raw) ────┤
                                              ▼
src/components/code/FileIcon.tsx  ── <span data-file-icon="rust"> SVG inline
   ├─ FileTree (arquivos, 16px)
   ├─ FilePreview (header, 14px)
   └─ ChangesPanel (linha do arquivo, 14px)
```

Por que separar `fileIcons.ts` de `fileIconAssets.ts`: a resolução é lógica pura
(centenas de casos de teste sem DOM/assets) e os assets são só dados. O tipo
`Readonly<Record<FileIconKey, string>>` faz o compilador exigir que **toda** key
declarada tenha SVG e que **nenhum** SVG fique órfão; um teste de runtime repete
a checagem.

## 4. Ordem de resolução

`fileIconKeyFor(pathOrName)` nunca lança e sempre devolve uma key conhecida:

1. **Workflow do GitHub Actions** pelo caminho (`.github/workflows/*.yml|yaml`)
   → `github-actions-workflow` (única regra por caminho).
2. **Nome exato** (minúsculo): `package.json` → `nodejs`, `Cargo.toml` → `rust`,
   `Dockerfile` → `docker`, `.gitignore` → `git`, `README.md` → `readme`,
   `LICENSE` → `license`, `tauri.conf.json` → `tauri`, etc.
3. **Declarações TypeScript**: `*.d.ts`, `*.d.mts`, `*.d.cts` → `typescript-def`.
4. **Famílias por padrão** (extensão variável/sem extensão): `Dockerfile.dev`,
   `docker-compose.test.yml`, `Makefile.am`, `tsconfig.build.json`,
   `vite.config.mts`, `tailwind.config.cjs`, `svelte.config.js`,
   `requirements-dev.txt`, `.bashrc`/`.zshrc`/`.profile`, `LICENSE-MIT`…
5. **Extensão** (minúscula, sem ponto): `rs` → `rust`, `tsx` → `react_ts`,
   `pdf` → `pdf`, `md` → `markdown`, `png` → `image`, `zip` → `zip`…
6. **Fallback** `file` (glifo neutro cinza) para desconhecidos, `arquivo`,
   `sem-extensao.` e chaves de protótipo (`constructor`, `__proto__` — o mapa é
   consultado com `Object.hasOwn`).

Detalhes de robustez: normaliza `\` do Windows, barras finais, espaços em volta
e caixa; aceita caminho completo ou nome; entradas não-string/`null`/vazias caem
no fallback.

## 5. Cores

As cores vêm dos próprios SVGs (não há `text-*` tingindo o glifo). Amostra:

| Tipo | Ícone | Cor de marca |
| --- | --- | --- |
| Rust | `rust` | `#ff7043` |
| PDF | `pdf` | `#ef5350` |
| TypeScript | `typescript` | `#0288d1` |
| TSX/React | `react_ts` / `react` | `#0288d1` / `#00bcd4` |
| JavaScript | `javascript` | `#ffca28` |
| Markdown | `markdown` | `#42a5f5` |
| JSON | `json` | `#f9a825` |
| Python | `python` | `#0288d1` + `#fdd835` |
| Go | `go` | `#00acc1` |
| Java | `java` | `#f44336` |
| Docker | `docker` | `#0288d1` |
| Vue | `vue` | `#41b883` |
| Svelte | `svelte` | `#ff5722` |
| CSS / Sass | `css` / `sass` | `#7e57c2` / `#ec407a` |
| YAML | `yaml` | `#ff5252` |
| HTML | `html` | `#e65100` |
| Git | `git` | `#e64a19` |
| Lock | `lock` | `#ffd54f` |
| Fallback | `file` | `#90a4ae` |

**Exceção consciente à regra de tokens**: `docs/DESIGN.md` §3 proíbe hex solto em
componentes. Ícones de tipo de arquivo são **assets de marca** (como o logo em
`public/brand/`): a cor é o dado visual do tipo e não deve mudar com o tema. Nada
de `bg-*`/`text-*` é aplicado ao glifo; os tamanhos/`gap` continuam em classes
Tailwind e o restante da linha (nome, badges) segue 100% nos tokens.

## 6. Cobertura

- **115 marcas** em `FILE_ICON_SVG`.
- **220 extensões** em `EXTENSION_ICONS` (linguagens, markup, dados, docs,
  imagens, mídia, fontes, arquivos compactados, binários, 3D).
- **121 nomes** em `FILE_NAME_ICONS` (tooling/config de JS/TS, Rust, Python, Go,
  Ruby, Dart, Docker, docs e metadados de repositório).
- **26 padrões** de família.
- Fallback neutro para o resto (extensão desconhecida → `file`).

Ícones deliberadamente **não** incluídos (ficam no fallback/ícone genérico para
não inflar o bundle): linguagens de nicho (Ada, COBOL, Fortran…), ícones de CI
(AppVeyor, Drone, Travis), Adobe/Figma/Sketch, Unity/Blender etc.

Lacunas conhecidas de nomes comuns (caem no `file` neutro hoje; adicionar é uma
linha em `EXTENSION_ICONS`/`FILE_NAME_ICONS` + asset): `.tsbuildinfo`, `.har`,
`.jsonld`, `.webmanifest`, `.xhtml`, `.envrc`, `py.typed`, `.clang-format`,
`.justfile`.

## 7. Como adicionar/atualizar um tipo

1. Confira o nome do arquivo em `node_modules/material-icon-theme/icons/`
   (ex.: `elixir.svg`) e se ele é colorido.
2. `src/lib/fileIconAssets.ts`: adicione o `import … from 'material-icon-theme/icons/<nome>.svg?raw'`
   e a entrada em `FILE_ICON_SVG` (o TypeScript acusa key faltando/sobrando).
3. `src/lib/fileIcons.ts`: acrescente a key em `FILE_ICON_KEYS` e a regra em
   `EXTENSION_ICONS`/`FILE_NAME_ICONS`/`NAME_PATTERNS` (a ordem de resolução
   importa — nome exato vence extensão).
4. Atualize os testes (`src/lib/__tests__/fileIcons*.test.ts`) com ao menos um
   caso do novo tipo; se a cor for relevante, a tabela de cores do teste de
   integridade.
5. `pnpm typecheck && pnpm test`. Se o comportamento visual mudar, atualize
   `docs/DESIGN.md` §5 (modo Code).

Ao **subir a versão** do pacote: revise nomes de arquivo e cores; os testes de
integridade falham de propósito se um asset sumir, deixar de ser colorido
(`fill`/`stop-color` hex), virar `currentColor`, ganhar `<script>`/`on*=`/ref
externa, ou mudar as cores de marca verificadas.

## 8. Testes

| Arquivo | Cobertura |
| --- | --- |
| `src/lib/__tests__/fileIcons.test.ts` (134 testes) | spec por linguagem/dados/mídia, nomes especiais, resolução por caminho, workflows, `.d.ts`, cobertura/fallback |
| `src/lib/__tests__/fileIcons.edge.test.ts` (11 testes) | entradas hostis (caixa, `\`, barras finais, protótipos, `null`/não-string, nomes de 10 mil chars, fuzz de 500 entradas) + integridade dos 115 SVGs + cores de marca |
| `src/components/code/FileIcon.test.tsx` | renderização, `data-file-icon`, `aria-hidden`, tamanho/className |
| `src/components/code/FileTree.test.tsx` | ícone por tipo na árvore, pasta sem `data-file-icon`, fallback |
| `src/components/code/FilePreview.test.tsx` / `ChangesPanel.test.tsx` | ícone no header da prévia e na linha de alteração |

Verificação (2026-10-28): `pnpm typecheck` sem erros, `pnpm test` **104 arquivos
/ 1912 testes** verdes e `pnpm build` OK com os 115 SVGs no chunk principal —
conferido por auditoria independente (`task-3`, relatório em
`.research/file-icons-audit-2026-10-28/REPORT.md`, fora do Git).

## 9. Licença e atribuição

Os SVGs são do **Material Icon Theme** (`material-icon-theme`), licença **MIT**
— Copyright (c) 2025 Material Extensions. O uso é via dependência npm declarada
e **pinada** em `package.json`, sem cópia manual de arquivos; o aviso de
copyright original permanece em `node_modules/material-icon-theme/LICENSE`. Se
algum SVG for copiado para fora do pacote, inclua o aviso MIT do projeto.

> **Pendência de distribuição**: o instalador ainda não embarca um arquivo de
> *third-party notices* — a licença MIT exige que o aviso de copyright acompanhe
> cópias redistribuídas. Os SVGs entram no bundle do renderer (mesma situação
> dos ícones de modelo da LobeHub); antes de uma distribuição pública, incluir o
> aviso MIT no diálogo "Sobre"/instalador ou em `THIRD-PARTY-NOTICES`.

> Observação: o pacote declara `chroma-js` como dependência de implementação
> (CLI do tema); o app importa **apenas** arquivos `.svg` via `?raw`, então esse
> código não entra no bundle do renderer.
