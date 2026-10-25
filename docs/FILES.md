# Arquivos, código e skills — planejamento e contrato

> Status: **implementado na v1, com a v1.5 (visualização ampliada de artefatos —
> §14/v1.5)**. Este documento é a
> fonte única do desenho: contratos, fluxos, limites, segurança, catálogo de
> skills, matriz de testes e divisão de trabalho. Evidências da entrega no §14.
> Qualquer divergência entre código e este documento é bug — atualize o
> documento junto com a mudança.
>
> Áreas: `harness/tools/documents` (harness-dev), `documents/preview` + `skills/`
> embutidas (formats-dev), `commands/config/state` (storage-dev), `artifacts/`
> e `settings/` do renderer (ui-systems), `chat/` do renderer (ui-core),
> contratos/docs (Lead).

## 1. Objetivo

1. O agente deve **criar** os formatos populares de arquivo: PDF, DOCX, XLSX,
   PPTX, imagens (PNG/SVG) — além dos textuais que já existem (MD, HTML, CSV,
   JSON, código, TXT).
2. Esses arquivos devem ter **visualização real** no painel de artefatos
   (não o cartão genérico “prévia não disponível”).
3. O agente deve criar arquivos **executando código** (Python/Node), com
   workspace isolado, timeout e coleta automática dos arquivos gerados.
4. O agente deve usar **skills** (instruções locais em Markdown, embutidas e do
   usuário) para saber *como* escrever esses scripts — o mesmo modelo mental do
   catálogo de skills do DeepSeek Harness.
5. Tudo com testes automatizados (TDD), documentação e sem quebrar o
   comportamento atual (chat, streaming, anexos, artefatos textuais).

## 2. Estado atual (diagnóstico)

| Hoje | Onde |
| --- | --- |
| `create_file(name, content, mime?)` grava **só texto UTF-8** (limite 10 MB) | `src-tauri/src/tools/create_file.rs` |
| Tipos `pdf/docx/xlsx` existem no domínio, mas **nada os produz**; preview cai no cartão binário genérico | `domain.rs`, `ArtifactPreview.tsx` |
| Anexos são **lidos** (pdf/docx/xlsx/pptx/imagem) | `src-tauri/src/documents/` |
| Ferramentas do agente: `web_search`, `fetch_url`, `create_file`, `validate_ui` | `tools/mod.rs` |
| Nenhuma execução de processo no backend; plugins só dialog/opener/clipboard | `Cargo.toml`, `lib.rs` |
| Sem sistema de skills | — |

O que falta para o objetivo: canal de escrita **binária**, ferramenta de
**execução de código**, **skills** e **parsers de preview** para Office/PDF.

## 3. Escopo da v1

**Entra:**

- `run_code` (Python e JavaScript/Node) com workspace isolado, timeout,
  cancelamento, limite de saída e registro automático dos arquivos gerados.
- `list_skills` / `read_skill` + catálogo de skills embutidas e pasta do
  usuário; skills embutidas para DOCX, XLSX, PPTX, PDF e imagens/SVG, com
  scripts Python **somente stdlib** prontos para uso.
- Artefatos binários (`ArtifactKind::Pptx` novo; imagem/pdf/docx/xlsx já
  existentes) + `ArtifactKind::from_mime_and_name` completo.
- Preview real: PDF (pdf.js no renderer), DOCX (OOXML → HTML no backend),
  XLSX (calamine → grade), PPTX (OOXML → slides), imagens (base64 nativo).
- **v1.5 — visualização ampliada** (§16): Markdown renderizado (GFM/math),
  código com syntax highlight Prism em 30+ linguagens, JSON em árvore,
  CSV/TSV com delimitador detectado, imagens com zoom/pan/transparência e
  conversão TIFF→PNG, players de áudio/vídeo, listagem de ZIP e hexdump de
  binários desconhecidos.
- Settings: `codeExecutionEnabled`, `codeTimeoutSecs`, `codePythonPath`,
  `codeNodePath`; tela “Ambiente de código” com interpretadores, pacotes e
  skills detectados; ação “Abrir pasta de skills”.
- Prompt do harness: seção de skills + regra de quando usar `run_code` ×
  `create_file`.
- Documentação (este arquivo, ARCHITECTURE, README) e testes.

**Não entra (v2+):**

- Sandbox de sistema operacional (container/VM). `run_code` roda com o
  interpretador e as permissões do usuário; a mitigação é opt-in + workspace +
  timeout + limites (ver §8). Documentado como risco conhecido.
- Instalação automática de pacotes Python (`pip install`) pela interface.
  O agente pode orientar o usuário; a UI mostra o comando sugerido.
- Renderização visual fiel de PPTX (slides são lidos como texto/estrutura) e de
  XLSX (sem estilos/cores/células mescladas na grade).
- Edição de artefatos existentes, OCR de PDF escaneado, extração de ZIP,
  criação de áudio/vídeo por skills dedicadas (arquivos gerados por `run_code`
  já são visualizados) e reprodução de contêineres fora do que o WebView abre.
- Execução de código no renderer/Web Worker.

## 4. Matriz de formatos

| Formato | Criar | Preview no painel | Como cria |
| --- | --- | --- | --- |
| Markdown | ✅ | ✅ renderizado (GFM/math/código) + alternância “Documento/Código” | `create_file` |
| TXT/log | ✅ | ✅ linhas numeradas, quebra de linha configurável | `create_file` |
| HTML | ✅ | ✅ iframe sandbox (já existe) | `create_file` |
| CSV/TSV | ✅ | ✅ tabela com detecção de delimitador (`,`, `;`, tab, `\|`) | `create_file` |
| JSON/JSONL | ✅ | ✅ árvore colapsável + código realçado (JSON inválido cai no código) | `create_file` |
| Código (30+ linguagens) | ✅ | ✅ syntax highlight Prism (bash, rust, go, java, c#, php, ruby, toml, docker…) | `create_file` |
| SVG | ✅ | ✅ (sanitizado) com zoom/ajuste | `create_file` |
| PDF | ✅ | ✅ pdf.js (páginas, zoom, navegação) | `run_code` + skill `pdf` (helper stdlib) |
| DOCX | ✅ | ✅ HTML renderizado em iframe sandbox | `run_code` + skill `office-docx` |
| XLSX | ✅ | ✅ grade com abas por planilha | `run_code` + skill `office-xlsx` |
| PPTX | ✅ | ✅ cartões de slide (título + texto) | `run_code` + skill `office-pptx` |
| PNG/JPG/WebP/GIF/AVIF/BMP/ICO | ✅ (com Pillow; senão SVG) | ✅ nativo com zoom, pan e fundo xadrez | `run_code` (skill `imagens`) |
| TIFF | ✅ | ✅ convertido para PNG no backend (≤2560 px) | `run_code` (Pillow) |
| Áudio (mp3/wav/ogg/m4a/flac/opus/aac) | ✅ via `run_code` (ex.: stdlib `wave`) | ✅ player nativo + metadados (≤24 MiB inline) | `run_code` |
| Vídeo (mp4/webm/ogv/mov…) | ✅ via `run_code` | ✅ player nativo + metadados (≤24 MiB inline) | `run_code` |
| ZIP | ✅ via `run_code` (stdlib `zipfile`) | ✅ listagem de entradas (até 400) + resumo | `run_code` |
| Outros contêineres (tar/gz/7z/rar) | ✅ via código | cartão binário + Salvar/Abrir | `run_code` |
| Outros binários | ✅ via código | cartão com formato detectado + hexdump (4 KB) + Salvar/Abrir | `run_code` |

## 5. Arquitetura

```
Modelo ──tool call──▶ tools::execute
                       ├─ create_file (texto)  ─┐
                       ├─ run_code ────────────┤
                       │    ├─ resolve interpretador (settings/PATH)
                       │    ├─ workspace <app-data>/code-runs/<id>/
                       │    ├─ spawn + timeout + cancel + caps
                       │    ├─ coleta arquivos novos
                       │    └─ artifacts::write_artifact (bytes) ──▶ SQLite + artifacts/<id>/
                       ├─ list_skills / read_skill ──▶ <app-data>/skills + skills-bundled
                       └─ validate_ui, web_search, fetch_url

Prompt: catálogo de skills (dinâmico) + regras de run_code/create_file

Renderer:
  ArtifactPanel ─▶ get_artifact_content (texto | base64)
               └▶ get_artifact_preview (docx html | xlsx sheets | pptx slides)
  PDF: base64 ─▶ pdf.js (canvas, lazy)
  DOCX: HTML ─▶ HtmlPreview (iframe sandbox, já existente)
  XLSX/PPTX: JSON ─▶ grade/cartões
```

Fluxo típico “relatório em PDF”:

1. Modelo chama `list_skills` (ou já conhece o catálogo do prompt).
2. `read_skill("pdf")` → instruções + `baseDir` + `scripts/make_pdf.py`.
3. `run_code(language="python", code="...spec.json + subprocess...")`.
4. Backend grava `documento.pdf`, registra artefato e devolve o id.
5. UI recebe `artifact_created`, mostra o card; painel renderiza com pdf.js.

## 6. Contratos compartilhados

### 6.1 `domain.rs` (Rust)

```rust
pub enum ArtifactKind {
    Markdown, Code, Text, Html, Csv, Json, Svg, Image, Pdf, Docx, Xlsx, Pptx,
    Audio, Video, Archive, Binary,
}
// from_mime_and_name (v1.5):
//  - imagem: png|jpg|jpeg|webp|gif|bmp|avif|tif|tiff|ico|jfif|apng e mime image/*
//  - áudio:  mp3|wav|ogg|oga|opus|m4a|aac|flac|weba|mid|midi|amr e mime audio/*
//  - vídeo:  mp4|m4v|webm|ogv|mov|mkv|avi|wmv|flv e mime video/*
//  - arquivo compactado: zip|zipx|tar|gz|tgz|bz2|xz|7z|rar|jar|epub|cbz e mimes zip/tar/gzip
//  - pdf/docx/xlsx/pptx/markdown/html/csv/json/svg continuam iguais

pub struct Settings {
    // … campos atuais …
    pub code_execution_enabled: bool, // default false (opt-in)
    pub code_timeout_secs: u32,       // default 120, clamp 10..=600
    pub code_python_path: String,     // default "" => auto-detecção
    pub code_node_path: String,       // default "" => auto-detecção
    pub skills_panel_enabled: bool,   // default true  => menu de skills na sidebar
    pub disabled_skills: Vec<String>, // default []    => nomes desativados (agente ignora)
}

pub struct TurnOptions {
    // … campos atuais …
    pub run_code: bool, // default true; harness faz AND com settings.code_execution_enabled
}

#[serde(rename_all = "camelCase", default)]
pub struct InterpreterInfo { pub path: String, pub version: String, pub source: String } // settings|path

#[serde(rename_all = "camelCase", default)]
pub struct CodePackageStatus { pub name: String, pub available: bool }

#[serde(rename_all = "camelCase", default)]
pub struct SkillSummary {
    pub name: String,
    pub description: String,
    pub source: String,   // bundled|user
    pub enabled: bool,    // false quando está em Settings.disabled_skills
    pub deletable: bool,  // apenas source == user
}

#[serde(rename_all = "camelCase", default)]
pub struct CodeEnvironmentStatus {
    pub enabled: bool,
    pub python: Option<InterpreterInfo>,
    pub node: Option<InterpreterInfo>,
    pub packages: Vec<CodePackageStatus>,
    pub install_hint: String,
    pub skills: Vec<SkillSummary>,
}

#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ArtifactPreview {
    Docx { html: String },
    Xlsx { sheets: Vec<SheetPreview> },
    Pptx { slides: Vec<SlidePreview> },
    /// Metadados da imagem; `data_base64` só quando o original foi convertido
    /// para PNG (formatos que o WebView não abre, como TIFF).
    Image {
        mime: String,
        width: Option<u32>,
        height: Option<u32>,
        data_base64: Option<String>,
    },
    /// Listagem de ZIP (outros contêineres → Unsupported).
    Archive { format: String, entries: Vec<ArchiveEntryPreview>, total_entries: u32, truncated: bool },
    /// Binário sem prévia: mime detectado + primeiros 4096 bytes em base64 (hexdump).
    Binary { format: String, preview_base64: String, preview_bytes: u32 },
    Unsupported { reason: String },
}

#[serde(rename_all = "camelCase", default)]
pub struct ArchiveEntryPreview { pub name: String, pub size: u64, pub compressed_size: u64, pub is_dir: bool }

#[serde(rename_all = "camelCase")]
pub struct SheetPreview { pub name: String, pub rows: Vec<Vec<String>>, pub truncated: bool }

#[serde(rename_all = "camelCase")]
pub struct SlidePreview { pub index: u32, pub texts: Vec<String>, pub notes: Option<String> }
```

`get_artifact_content` (v1.5) devolve `content` só para textuais, `dataBase64`
para PDF e para imagens que o WebView abre (`png/jpeg/gif/webp/avif/bmp/ico`) e
para áudio/vídeo até **24 MiB**; DOCX/XLSX/PPTX/Archive/Binary não trafegam
payload (as prévias leem o arquivo no backend) e TIFF/HEIC não trafegam o
original (a prévia de imagem entrega o PNG convertido).

### 6.2 Comandos Tauri novos

```
get_artifact_preview(id) -> Option<ArtifactPreview>   // storage-dev; chama documents::preview
get_code_environment()   -> CodeEnvironmentStatus     // storage-dev; chama tools::code_exec::environment_status
open_skills_dir()        -> ()                        // storage-dev; cria <data>/skills e abre no SO
get_skills()             -> Vec<SkillSummary>         // gestão de skills (todas, com enabled/deletable)
set_skill_enabled(name, enabled) -> Vec<SkillSummary> // persiste em Settings.disabled_skills
delete_skill(name)       -> Vec<SkillSummary>         // só skills do usuário (remove a pasta)
```

Registro em `lib.rs` é do Lead (feito na integração, para não quebrar o build
dos outros enquanto os comandos não existem).

### 6.3 Ferramentas novas

| Tool | Args | Sempre disponível? |
| --- | --- | --- |
| `run_code` | `language: "python"\|"javascript"`, `code: string`, `timeoutMs?: u32`, `inputFiles?: [{name, content}]` | só com `options.run_code` (gate: settings) |
| `list_skills` | — | sim (não conta no orçamento de 6) |
| `read_skill` | `name: string` | sim (não conta no orçamento de 6) |

`run_code` devolve texto + artefatos; `list_skills` devolve JSON
`[{name, description, source}]`; `read_skill` devolve
`{name, description, baseDir, files: string[], instructions}`.

### 6.4 Tipos do renderer (`types.ts`)

Espelham §6.1: `ArtifactKind` ganha `'pptx'` (v1) e, na v1.5,
`'audio' | 'video' | 'archive'`; `Settings` ganha `codeExecutionEnabled`,
`codeTimeoutSecs`, `codePythonPath`, `codeNodePath`; `TurnOptions` ganha
`runCode`; novos `CodeEnvironmentStatus`, `InterpreterInfo`,
`CodePackageStatus`, `SkillSummary`, `ArtifactPreview`, `SheetPreview`,
`SlidePreview`, `ArchiveEntryPreview`. Na v1.5, `ArtifactPreview` ganha as
variantes `image` (mime/width/height/dataBase64 opcional), `archive`
(format/entries/totalEntries/truncated) e `binary`
(format/previewBase64/previewBytes).

### 6.5 API do renderer (`api.ts`)

```ts
getArtifactPreview(id): Promise<ArtifactPreview | null>
getCodeEnvironment(): Promise<CodeEnvironmentStatus>
openSkillsDir(): Promise<void>
getSkills(): Promise<SkillSummary[]>
setSkillEnabled(name: string, enabled: boolean): Promise<SkillSummary[]>
deleteSkill(name: string): Promise<SkillSummary[]>
```

## 7. Skills

### 7.1 Formato

`SKILL.md` com frontmatter simples (sem dependência de YAML):

```
---
name: office-docx
description: Criar documentos Word (.docx) com script Python stdlib.
---
# Instruções...
```

Regras: `name` `[a-z0-9][a-z0-9-]{0,63}`, `description` ≤ 1024 chars (valores
**block scalar** YAML — `description: >`, `>-`, `|`, `|-` — também são aceitos e
normalizados para uma linha), corpo ≤ 512 KB. Um diretório de skill pode ter
`scripts/`, `references/` etc.; todos os arquivos (menos `SKILL.md`) são
listados em `read_skill.files` com caminho absoluto relativo a `baseDir`.
No **system prompt** a descrição do catálogo é truncada em ~200 chars (o
`read_skill` continua devolvendo o corpo completo); descrições maiores são
comuns nas skills publicadas no ecossistema (Codex/OpenCode/Agent Skills).

### 7.2 Diretórios e precedência

O catálogo lê automaticamente o **repositório padrão de skills** usado por
agentes como Codex e OpenCode (além da pasta do Lumina e das embutidas),
sempre em modo somente leitura:

| Origem | Caminho(s) padrão | `source` | Precedência |
| --- | --- | --- | --- |
| Lumina (usuário) | `<app-data>/skills/<nome>/SKILL.md` | `user` | 1 |
| Agent Skills (compartilhado) | `~/.agents/skills/<nome>/SKILL.md` | `agents` | 2 |
| Codex | `$CODEX_HOME/skills/<nome>/SKILL.md` ou `~/.codex/skills/<nome>/SKILL.md` | `codex` | 3 |
| Claude Code | `$CLAUDE_CONFIG_DIR/skills/<nome>/SKILL.md` ou `~/.claude/skills/<nome>/SKILL.md` | `claude` | 4 |
| OpenCode | `$XDG_CONFIG_HOME/opencode/skills/<nome>/SKILL.md`, `~/.config/opencode/skills/<nome>/SKILL.md` ou `%APPDATA%\opencode\skills\<nome>\SKILL.md` | `opencode` | 5 |
| Embutidas | `<app-data>/skills-bundled/<nome>/SKILL.md` (materializadas de `src-tauri/skills/` via `include_dir!`) | `bundled` | 6 |

Regras:

- O app **nunca escreve** nos repositórios externos — só lê (como Codex/OpenCode
  fazem). Skills externas podem ser **desativadas** (ficam fora do prompt e das
  tools), mas não excluídas; exclusão só existe para `source == user`.
- Dedupe por nome: a primeira origem vence (Lumina > `agents` > `codex` >
  `claude` > `opencode` > embutidas).
- Varredura rasa (1 nível), determinística; diretórios ocultos (`.algo`) são
  ignorados, assim como `SKILL.md` inválido (sem quebrar o catálogo).
- Variáveis de ambiente respeitadas: `CODEX_HOME`, `CLAUDE_CONFIG_DIR`,
  `XDG_CONFIG_HOME` (e `%APPDATA%` no Windows); home = `USERPROFILE`/`HOME`.
- Não há diretórios de projeto: o Lumina lê apenas os repositórios de usuário.

### 7.3 Catálogo embutido (v1)

| Skill | Script | Capacidade |
| --- | --- | --- |
| `office-docx` | `scripts/make_docx.py` | título, subtítulo, headings, parágrafos, bullets, tabelas, quebra de página |
| `office-xlsx` | `scripts/make_xlsx.py` | múltiplas abas, cabeçalho em negrito, números/fórmulas (`=SUM(...)`), larguras |
| `office-pptx` | `scripts/make_pptx.py` | capa, slides título+bullets, notas do apresentador |
| `pdf` | `scripts/make_pdf.py` | A4, título, headings, parágrafos com quebra de linha, bullets, rodapé/paginação |
| `imagens` | — | SVG via `create_file`; PNG/JPG com Pillow quando instalado |

CLI comum dos helpers (stdlib apenas, sem `pip install`):

```
python <baseDir>/scripts/make_docx.py --spec spec.json --out arquivo.docx
```

`spec.json`:

```json
// DOCX / PDF
{ "title": "...", "subtitle": "...", "footer": "opcional",
  "blocks": [
    {"type": "heading", "level": 1, "text": "..."},
    {"type": "paragraph", "text": "..."},
    {"type": "bullets", "items": ["...", "..."]},
    {"type": "table", "headers": ["..."], "rows": [["..."]]},
    {"type": "page_break"}
  ] }
// XLSX
{ "sheets": [ { "name": "Vendas",
  "rows": [["Mês","Receita"], ["Julho", 1410000], ["Total", "=SUM(B2:B3)"]],
  "formats": { "B2": "#,##0" } } ] }
// PPTX
{ "title": "...", "subtitle": "...",
  "slides": [ { "title": "...", "bullets": ["..."], "notes": "..." } ] }
```

Os helpers são testados com os parsers de preview do próprio app (DOCX/XLSX/
PPTX/PDF) — ver §11.

### 7.4 Gerenciamento de skills (v1.1)

Estado persistido (**Settings**, `settings.json`):

| Campo | Default | Efeito |
| --- | --- | --- |
| `skills_panel_enabled` | `true` | mostra/esconde o item **Skills** na sidebar (a view continua acessível por Configurações → Ferramentas) |
| `disabled_skills` | `[]` | nomes desativados; o agente **não** os vê no prompt, `list_skills` nem `read_skill`, e `environment_status` os devolve com `enabled: false` |

Regras:

- O catálogo continua deduplicado por nome (Lumina vence as externas, que vencem as embutidas); ativar/desativar é por nome.
- **Excluir** só vale para `source == user`: remove `<app-data>/skills/<nome>/` (validação de caminho: precisa ser filho direto de `skills/`, sem symlink) e limpa o nome de `disabled_skills`. Skills externas (Codex/OpenCode/Claude/Agentes) e embutidas não podem ser excluídas (podem ser desativadas); o erro explica isso e a UI não mostra o botão.
- Mudanças valem a partir do próximo turno (o harness lê o catálogo por turno); não é preciso reiniciar o app.
- Como os comandos gravam `disabled_skills` no backend, o renderer chama
  `useAppStore.reloadSettings()` depois de ativar/desativar/excluir — assim um
  `saveSettings` posterior não sobrescreve a lista com estado obsoleto.
- A view lista **todas** as skills (inclusive desativadas) agrupadas pela origem
  (Lumina, Agentes, Codex, Claude, OpenCode, Embutidas) com badge, switch por
  skill e ação de excluir somente para as do Lumina; as externas levam a nota
  “somente leitura” (desativar é permitido).
- UI: item “Skills” logo **abaixo de “Novo chat”** na sidebar (oculto quando `skillsPanelEnabled = false`) e o botão “Gerenciar skills” em Configurações → Ferramentas levam à **`SkillsView`**, uma view principal que **substitui a coluna do chat** (sem modal: o chat continua montado e volta intacto pelo botão “Voltar ao chat”, pelo “Novo chat” ou ao abrir uma conversa).

## 8. Execução de código (`run_code`)

### 8.1 Interpretadores

Ordem de resolução: `settings.code_python_path` / `code_node_path` (caminho
explícito) → detecção no `PATH` (`python`, `python3`, `py` / `node`). Se não
achar: erro amigável explicando como instalar/configurar. Nenhum download
automático.

### 8.2 Execução

- Workspace: `<app-data>/code-runs/<uuid>/` (criado e removido por execução;
  artefatos são copiados para `artifacts/<id>/`).
- Script: `script.py` (`python -u`) ou `script.mjs` (`node`).
- `inputFiles` (texto UTF-8) são gravados no workspace antes da execução;
  nomes saneados (sem caminhos/`..`).
- Env: herda o ambiente, com `PYTHONIOENCODING=utf-8`, `PYTHONUTF8=1`,
  `PYTHONDONTWRITEBYTECODE=1`, `NODE_NO_WARNINGS=1`; remove variáveis
  sensíveis (`*API_KEY*`, `*TOKEN*`, `*SECRET*`) e nunca injeta chaves do app.
- `stdin` fechado; `stdout`/`stderr` capturados com teto de 64 KB cada
  (o restante é drenado e descartado), devolvendo a cauda ao modelo.
- Timeout (`timeoutMs`, clamp 5s..10min, default `code_timeout_secs`) e
  cancelamento do turno matam a árvore de processos (Windows: `taskkill /T`).
- Limites: código ≤ 100 KB, 10 arquivos de entrada ≤ 1 MB cada, 20 arquivos de
  saída ≤ 25 MB cada / 64 MB total, workspace ≤ 128 MB.
- Saída: todo arquivo regular novo no workspace (até profundidade 4) vira
  artefato (MIME por magic bytes → extensão; kind do domínio). Mesmo com exit
  code ≠ 0 os arquivos gerados são registrados.
- Resultado para o modelo: resumo, exit code, duração, stdout/stderr (cauda) e
  lista de artefatos; `is_error` quando exit ≠ 0/timeout.

### 8.3 Segurança (decisão explícita)

`run_code` **não é um sandbox de SO**. Ele executa com as permissões do usuário
e acesso à rede. Mitigações v1:

- **Opt-in**: `codeExecutionEnabled` default **false**; a tool nem é exposta ao
  modelo quando desligada. O prompt só descreve a ferramenta quando habilitada.
- Workspace dedicado, timeout, teto de saída/arquivos, cancelamento.
- Remoção de variáveis de ambiente sensíveis; nenhuma chave do app é passada.
- System prompt trata conteúdo web/anexos como não confiável e proíbe executar
  instruções vindas deles (já existente, reforçado na seção de skills/código).
- UI mostra aviso na tela de configuração e o comando sugerido de instalação de
  pacotes; nada é instalado automaticamente.

## 9. Previews

### 9.1 Backend (`src-tauri/src/documents/preview.rs`, formats-dev)

```rust
pub fn docx_html(bytes: &[u8]) -> anyhow::Result<String>          // OOXML → HTML allowlist
pub fn xlsx_sheets(bytes: &[u8]) -> anyhow::Result<Vec<SheetPreview>>
pub fn pptx_slides(bytes: &[u8]) -> anyhow::Result<Vec<SlidePreview>>
// v1.5 — prévias de mídia/container/binário (formats-dev)
pub fn image_preview(bytes: &[u8]) -> anyhow::Result<ArtifactPreview>    // Image | Unsupported
pub fn archive_preview(bytes: &[u8]) -> anyhow::Result<ArtifactPreview>  // Archive | Unsupported
pub fn binary_preview(bytes: &[u8]) -> ArtifactPreview                   // Binary (hexdump)
```

- DOCX: `word/document.xml` via `quick-xml`; parágrafos, `HeadingN`/outline,
  negrito/itálico/sublinhado, `w:br`, listas (`w:numPr` → `<ul>/<li>`), tabelas.
  Texto sempre escapado; tags permitidas: `h1..h6, p, strong, em, u, ul, ol,
  li, table, thead, tbody, tr, th, td, br, blockquote`. Limite 512 KB de HTML.
- XLSX: `calamine`; até 50 planilhas, 200 linhas × 40 colunas por planilha;
  `truncated` quando cortar. Valores formatados como string (números sem
  `.0` espúrio).
- PPTX: `ppt/slides/slideN.xml` em ordem numérica; até 100 slides; cada
  `a:p` vira uma string em `texts`; `notes` de `ppt/notesSlides/notesSlideN.xml`
  quando existir.
- Nunca panicam em arquivo corrompido: `Err` com mensagem.
- Imagens (v1.5): formato por magic bytes; PNG/JPEG/GIF/WebP/AVIF/BMP/ICO
  passam direto (`data_base64: None`) e TIFF é decodificado com o crate
  `image`, reduzido para no máximo 2560 px no lado maior, reencodado em PNG
  (base64) e devolvido com as dimensões originais. HEIC/HEIF e formatos não
  reconhecidos → `Unsupported` com orientação de “Salvar como…/Abrir”.
- ZIP (v1.5): listagem com `zip` (até 400 entradas, nomes truncados em 240
  chars, `is_dir`, tamanho/comprimido, total e `truncated`); não-ZIP →
  `Unsupported` citando TAR/7z/RAR; ZIP corrompido → `Err`.
- Binário (v1.5): mime por `infer` + primeiros 4096 bytes em base64.

### 9.2 Renderer (ui-systems)

Roteamento em `ArtifactPreview.tsx` (v1.5): o componente escolhe a prévia pelo
`ArtifactKind` e mantém `BinaryPreview` como fallback de erro/`unsupported`.

- PDF: `pdfjs-dist` (carregada por `import()` dinâmico; worker via `?url`),
  páginas em `<canvas>`, controles de página e zoom, estados de
  carregamento/erro, `aria-label` e navegação por teclado.
- DOCX: `api.getArtifactPreview` → `HtmlPreview` (iframe `sandbox`, já seguro).
- XLSX: abas por planilha (botões com `aria-selected`), grade com cabeçalho
  fixo, números alinhados à direita, aviso de truncamento.
- PPTX: cartões 16:9 numerados, título = primeira linha, demais linhas como
  bullets; aviso “prévia simplificada”.
- Imagens (`ImagePreview`/`SvgPreview`): toolbar com formato e dimensões, zoom
  (−/+, “Ajustar à janela”, “Tamanho real”), fundo xadrez para transparência,
  pan por arrasto quando ampliado e atalhos +/−/0/1; SVG continua sanitizado;
  TIFF usa o PNG convertido pela prévia; erro/sem payload → `BinaryPreview`.
- Áudio/vídeo (`AudioPreview`/`VideoPreview`): player nativo com metadados
  (formato, tamanho, duração quando exposta pelo elemento) e fallback para
  `BinaryPreview` quando o payload não vem (arquivo > 24 MiB) ou o formato não
  abre no WebView.
- ZIP (`ArchivePreview`): resumo (arquivos/tamanho), lista rolável de entradas
  (ícone de pasta/arquivo, nome com `title`, tamanho) e aviso de truncamento.
- Binário (`BinaryPreview` + `HexDump`): formato detectado, hexdump colapsável
  dos primeiros `previewBytes` (offset + 16 bytes/linha + ASCII) e ações
  “Salvar como…”/“Abrir”.
- Markdown (`MarkdownPreview`): GFM/math/código renderizados pelo `Markdown` do
  chat + alternância “Documento/Código”.
- JSON (`JsonPreview`/`JsonTree`): árvore colapsável com contagem de
  itens/limite de nós e alternância “Árvore/Código”; JSON inválido cai no
  código com aviso discreto.
- CSV/TSV (`CsvPreview`): tabela com detecção de delimitador (`,`/`;`/tab/`|`),
  números à direita e truncamento em 501 linhas.
- Código/texto (`CodePreview` + `CodeBlock` v1.5): syntax highlight Prism com
  grammars extras (bash, docker, makefile, diff, java, ruby, php, c#, toml,
  ini, git, powershell, batch, nginx, http, cmake…), números de linha,
  alternância de quebra de linha e `meta` de linhas. O tema único vem de
  `src/lib/highlight` (tokens CSS) e é compartilhado com o chat.
- `kinds.ts`: metadados/ícone/label de `audio`, `video`, `archive` e inferência
  de linguagem por extensão quando o artefato antigo não tem `language`.
- Testes: mock de `@/lib/api` (conteúdo e prévia) e de `@/lib/pdf`, por
  componente (imagem, áudio, vídeo, ZIP, hexdump, markdown, JSON, código, CSV)
  e de roteamento, incluindo sucesso, erro, vazio/truncado e fallback.

## 10. UI/Settings

Tools tab (`ToolsTab.tsx`):

- Switch **“Execução de código”** (`codeExecutionEnabled`) com aviso de risco.
- Slider **“Tempo limite de execução”** (`codeTimeoutSecs`, 10–600 s).
- Bloco **“Ambiente de código”**: Python/Node (caminho + versão + origem),
  pacotes opcionais (`python-docx`, `openpyxl`, `python-pptx`, `reportlab`,
  `Pillow`), comando sugerido de instalação, botão “Verificar novamente”.
- Bloco **“Skills”**: contagem total e por origem (incluindo as externas
  detectadas), lista nome+descrição (com estado ativada/desativada), switch
  **“Painel de skills na barra lateral”**
  (`skillsPanelEnabled`), botão **“Gerenciar skills”** (navega para a view) e
  “Abrir pasta de skills”.

Gestão de skills (v1.1): item **Skills** na sidebar (abaixo de “Novo chat”,
oculto quando `skillsPanelEnabled = false`) e o botão **“Gerenciar skills”**
(Configurações → Ferramentas) abrem a view **SkillsView**, que ocupa o lugar do
chat (não é modal) — listar, ativar/desativar e excluir skills do usuário, com
“Voltar ao chat”. Ver §7.4.

Chat (ui-core): ícones e rótulos no timeline para `run_code`,
`list_skills`, `read_skill` (ex.: “Executando código…”, “Leu skill office-docx”).

## 11. Testes (matriz TDD)

### Rust (`cargo test --lib`)

| Módulo | Casos |
| --- | --- |
| `tools::artifacts` | grava bytes → artefato + DB + path; MIME por magic/extensão; kind `Pptx`/`Image`; nome saneado; extensão inferida; 10 MB+ |
| `tools::code_exec` | resolve interpretador (settings/PATH/erro); executa python e coleta arquivo; exit ≠ 0 mantém artefatos e `is_error`; timeout mata e reporta; cancelamento; inputFiles; nome de arquivo perigoso; sem interpretador; teto de saída; (testes condicionais: pulam se não houver Python/Node, como o teste `#[ignore]` de rede) |
| `tools::skills` | frontmatter válido/inválido; nome/description; **block scalar** (`>`/`|`) e descrição longa (~900 chars) lidos corretamente; corpo ~100 KB aceito; scan e precedência user > bundled; materialização das embutidas; `list_skills`/`read_skill`; catálogo no prompt com descrição truncada; skill com scripts lista arquivos; **filtro de desativadas** (`catalog_enabled`, `summaries` com `enabled`/`deletable`, `run_list`/`run_read`); **repositórios padrão externos** (roots com home/env, precedência, diretórios ocultos ignorados, `deletable=false`) |
| `commands::skills` | `get_skills`/`set_skill_enabled`/`delete_skill` com helpers puros + temp dirs; ativar/desativar persiste em `disabled_skills` (inclusive externas); excluir só `source == user` e valida caminho/symlink; bundled e externas → erro; nome some de `disabled_skills` ao excluir |
| `harness::prompt` | seção de skills, regra run_code×create_file, ausência quando desabilitado; skill desativada fora do prompt |
| `documents::preview` | fixtures reais `testdata/`: docx (heading/tabela/lista), xlsx (2 abas/valores/truncamento), pptx (títulos/textos/notas); corrompidos → Err; limites |
| `documents::preview` (v1.5) | imagem: PNG/JPEG pass-through com dimensões, TIFF→PNG (assinatura do payload, ≤2560 px), HEIC→Unsupported, corrompido→Err; ZIP: entradas/total/ordem/truncamento (400), não-ZIP→Unsupported, corrompido→Err; binário: formato detectado e preview de exatamente 4096 bytes; vazio não panica |
| `commands::artifacts` (v1.5) | `preview_for` dos novos kinds; payload de `get_artifact_content` por kind/mime/tamanho (texto, PDF, imagem web-safe vs TIFF, Office/ZIP/binário sem payload, áudio/vídeo ≤24 MiB) |
| `tools::artifacts` (v1.5) | kind de áudio/vídeo/zip/imagens variadas; `CODE_EXTENSIONS`/`language_for` por extensão e nome completo (Dockerfile/Makefile/CMakeLists/.gitignore); `extension_for_mime` de mídia/zip/tiff/ico |
| `db` (v1.5) | round-trip `Audio`/`Video`/`Archive` (string ↔ enum) e fallback desconhecido→`Binary` |
| `config` | normalização dos novos campos (clamp timeout, trim paths, defaults) |

Teste de integração (em `tools::code_exec`): gera `relatorio.docx` com o script
embutido da skill, depois `documents::preview::docx_html` lê o resultado —
prova o ciclo criação→preview sem UI.

### Renderer (`pnpm test`)

| Arquivo | Casos |
| --- | --- |
| `ArtifactPreview.test.tsx` | pdf (mock pdf.js: loading/páginas/erro), docx (html), xlsx (abas/grade/truncado), pptx (slides), image, fallback |
| `lib/pdf` | decode base64; carregamento real do fixture PDF (páginas=2) se estável em Node; senão teste unitário do wrapper com mock |
| `kinds` | meta/ícone/label de `pptx` |
| `ToolsTab.test.tsx` | toggle de código salva setting; timeout; ambiente (mock `api.getCodeEnvironment`); skills listadas; estado de erro |
| `agentTrace.test.ts` | grupos `run_code`/`list_skills`/`read_skill` (labels, erro, agrupamento) |
| `AgentSteps.test.tsx` | ícones/rótulos dos novos grupos |
| `Sidebar.test.tsx` | item “Skills” visível/abre o painel; oculto com `skillsPanelEnabled=false`; regressão “Novo chat” |
| `SkillsView.test.tsx` | lista agrupada por origem (incluindo Codex/OpenCode/Claude/Agentes); switch chama `setSkillEnabled`; exclusão confirmada chama `deleteSkill`; embutida/externa sem excluir e nota de somente leitura; vazio/erro/retry; “Voltar ao chat” muda `activeView` para `chat` |
| `ToolsTab.test.tsx` | switch do painel salva setting; “Gerenciar skills” navega para a view e fecha as configurações; contagem/labels de skills externas; skills desativadas marcadas |
| `ImagePreview.test.tsx` | web-safe usa base64 do conteúdo; TIFF usa payload convertido da prévia; zoom/ajuste/tamanho real; dimensões; `unsupported`/sem dados → cartão; SVG sanitizado |
| `AudioPreview/VideoPreview.test.tsx` | player com data URI e metadados; sem payload (>24 MiB) → cartão; `onError` do media → cartão |
| `ArchivePreview.test.tsx` | resumo, lista de entradas, diretórios, truncamento, `unsupported`, erro com retry |
| `HexDump/BinaryPreview.test.tsx` | hexdump com offset/ASCII, respeita `previewBytes`, formato detectado, ações preservadas |
| `JsonPreview.test.tsx` | árvore colapsável (expandir/recolher), alternância árvore/código, JSON inválido, limites de nós |
| `MarkdownPreview.test.tsx` | GFM renderizado (headings/listas/tabelas), alternância documento/código, vazio |
| `CodePreview.test.tsx` | linguagem por `language`/extensão, números de linha, toggle de quebra, `meta` de linhas |
| `csv.test.ts` | delimitadores `,`/`;`/tab/`\|`, aspas escapadas, CRLF, BOM, truncamento |
| `kinds.test.ts` (v1.5) | meta/ícone/label de audio/video/archive; `artifactLanguage` por extensão/nome sem `language` |
| `ArtifactPreview.test.tsx` (v1.5) | roteamento de markdown/json/code/csv/image/svg/audio/video/archive/binary e fallbacks |
| `lib/highlight` | grammars extras registradas (bash/java/ruby/toml/csharp…), `normalizeLanguage` e `languageLabel` |

### Comandos de verificação (critérios de pronto)

```bash
pnpm typecheck && pnpm test && pnpm build
cd src-tauri && cargo check && cargo test --lib
```

E2E manual (sem GUI): script de verificação roda os 4 helpers embutidos com o
Python do sistema, confere assinatura/tamanho e abre cada saída com os parsers
Rust (`cargo test` cobre; ver §11).

## 12. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Execução arbitrária (prompt injection) | opt-in default off, aviso na UI, prompt trata conteúdo externo como não confiável, env sem segredos, workspace/timeout/caps |
| Python ausente na máquina | detecção + erro orientativo + status na UI; helpers são stdlib (não exigem pip) |
| Scripts stdlib gerarem arquivo inválido | testes abrem cada saída com os parsers do app; validação de assinatura/magic |
| PDF.js aumentar bundle/worker quebrar no build | import dinâmico + worker `?url`; build/typecheck no CI local; fallback binário |
| Grammars extras do Prism (prismjs) aumentarem o bundle ou quebrarem no build | importados sob demanda em `src/lib/highlight` (só os usados), registrados na instância do `prism-react-renderer`; `pnpm build` valida; fallback = texto puro |
| Imagem/TIFF enorme travar a prévia ou estourar IPC | TIFF reduzido para ≤2560 px e reencodado em PNG; payload de mídia inline capped em 24 MiB; `get_artifact_content` não manda payload de ZIP/binário/Office |
| ZIP malicioso (zip bomb, nomes com caminho) | listagem sem extração; limite de 400 entradas/nome 240 chars; nunca escreve no disco |
| Parsers OOXML divergirem de arquivos reais | fixtures reais do repo + testes de corrompido |
| Novos campos de Settings quebrarem settings antigos | `#[serde(default)]` + normalização no load |
| Excluir skill apagar caminho indevido | exclusão só de `source == user`; caminho precisa ser filho direto de `<data>/skills`, sem symlink; bundled nunca é removida (só desativada) |
| `disabled_skills` sobrescrito por save do renderer | comandos persistem no backend e o renderer chama `reloadSettings()` após mutações |
| Timeout/processos órfãos no Windows | `taskkill /T /F` na árvore; teste de timeout |
| Conflito de arquivos entre áreas | write scopes no task board; Lead revisa diff e roda a suíte completa |

## 13. Divisão de trabalho (write scopes)

| Dono | Escopo |
| --- | --- |
| **Lead** | `docs/`, `src-tauri/src/domain.rs`, `src/lib/types.ts`, `src/lib/api.ts`, `src/lib/store/**`, `src-tauri/src/lib.rs` (registro final), `Cargo.toml`, `package.json` |
| **harness-dev** | `src-tauri/src/tools/**`, `src-tauri/src/harness/**` (run_code, artifacts writer, skills runtime/tools, prompt) |
| **formats-dev** | `src-tauri/src/documents/**` (preview parsers) e `src-tauri/skills/**` (SKILL.md + scripts stdlib) |
| **storage-dev** | `src-tauri/src/commands/**`, `src-tauri/src/config.rs`, `src-tauri/src/state.rs` (settings, comandos de preview/ambiente/skills) |
| **ui-systems** | `src/components/artifacts/**`, `src/components/settings/**`, `src/lib/pdf/**` |
| **ui-core** | `src/components/chat/AgentSteps.tsx`, `src/lib/agentTrace.ts` + testes desses |

Na **v1.5 (visualização ampliada de artefatos)** os escopos foram:
`domain.rs`/`types.ts`/`package.json`/`Cargo.toml` (Lead); `documents/**`
(formats-dev: prévias de imagem/ZIP/binário); `commands/artifacts.rs`+`db.rs`
(storage-dev: kinds e payloads); `tools/artifacts.rs` (harness-dev: kinds de
mídia/zip e linguagem); `src/lib/highlight/**` +
`src/components/{genui,chat}/CodeBlock.tsx` + `artifacts/JsonPreview.tsx`
(ui-core); `artifacts/{Image,Audio,Video,Archive,Hex,Bin}*` (ui-media);
`artifacts/{kinds,ArtifactPreview,Markdown,Code,Csv}*` (ui-text). A divisão
evitou arquivos compartilhados entre os dois agentes de artifacts.

Ordem de dependências: contratos (Lead) → harness/formats/storage em paralelo →
ui-systems/ui-core em paralelo → integração do Lead (lib.rs, prompt final,
`chatStore`, testes completos).

## 14. Status da implementação (evidências)

Entrega da v1 concluída. Arquivos principais:

| Área | Arquivos |
| --- | --- |
| Escrita de artefatos | `src-tauri/src/tools/artifacts.rs` (writer de bytes compartilhado; `create_file` refatorado) |
| Execução de código | `src-tauri/src/tools/code_exec.rs` (`run_code` + `environment_status`) |
| Skills runtime | `src-tauri/src/tools/skills.rs` (`catalog`/`read`/tools + materialização `include_dir!`) |
| Skills embutidas | `src-tauri/skills/{office-docx,office-xlsx,office-pptx,pdf,imagens}/SKILL.md` + `scripts/make_*.py` (stdlib) |
| Previews backend | `src-tauri/src/documents/preview.rs` (`docx_html`, `xlsx_sheets`, `pptx_slides`) |
| Comandos | `src-tauri/src/commands/artifacts.rs::get_artifact_preview`, `commands/settings.rs::{get_code_environment,open_skills_dir}`, `commands/skills.rs::{get_skills,set_skill_enabled,delete_skill}` (registrados em `lib.rs`) |
| Contratos | `src-tauri/src/domain.rs`, `src/lib/types.ts`, `src/lib/api.ts`, `src/lib/store/*` |
| Renderer | `src/lib/pdf/**`, `src/components/artifacts/{Pdf,Docx,Xlsx,Pptx}Preview.tsx`, `src/components/skills/SkillsView.tsx`, `src/components/layout/Sidebar.tsx` (item Skills), `src/components/settings/ToolsTab.tsx`, `src/lib/agentTrace.ts` |

Decisões de implementação (pequenos desvios do plano, semântica equivalente):

- `preview_for(kind, bytes)` devolve `Result<ArtifactPreview, String>` para que
  arquivo corrompido vire `Err` (nunca prévia vazia fingindo sucesso); o comando
  faz `map(Some)`.
- PDF não passa por `get_artifact_preview`: o renderer pede o conteúdo base64
  (`get_artifact_content`) e desenha com pdf.js; o comando devolve
  `Unsupported{reason}` para PDF/imagens/textuais.
- `read_skill` devolve `files` com **caminhos absolutos** (além de `baseDir`),
  para o `run_code` executar o helper sem adivinhar o diretório.
- `run_code` resume como `python · 2 arquivos · 1,23 s` (a timeline do chat usa
  só os segmentos antes da duração).
- `environment_status` inclui o catálogo de skills e um `installHint`
  (`pip install …`) para os pacotes opcionais — nada é instalado
  automaticamente.
- `run_code` é **opt-in** (`codeExecutionEnabled` default `false`); ligando na
  tela Configurações → Ferramentas, a tool e a seção do prompt passam a existir.
- Gestão de skills (§7.4): ativação é por **nome** em `Settings.disabled_skills`
  (sem reiniciar); exclusão só para `source == user`, com validação de caminho
  (filho direto de `<data>/skills`, sem symlink); os comandos persistem no
  backend e o renderer chama `useAppStore.reloadSettings()` após cada mutação
  para evitar que um `saveSettings` posterior sobrescreva a lista.

Evidências de verificação (árvore final):

- `cd src-tauri && cargo check` → OK (1 warning de campo não usado em
  `ToolRuntime`).
- `cd src-tauri && cargo test --lib` → **278 passed; 0 failed; 9 ignored**
  (baseline da v1: 243). Inclui: execução Python/Node real, timeout,
  cancelamento, `inputFiles`, exit≠0 preservando artefatos, limites de saída,
  writer de artefatos, frontmatter/precedência de skills, filtro de skills
  desativadas (prompt/tools/env status), comandos de gestão com temp dirs e
  validação de exclusão, gate do prompt, e os testes de integração **script
  stdlib → DOCX → `documents::preview::docx_html`** e **helper real da skill
  `office-docx`**.
- `pnpm typecheck` → OK.
- `pnpm test` → **29 arquivos / 846 testes** (baseline da v1: 816), incluindo
  `src/lib/pdf/__tests__/pdf.test.ts` com o fixture real de 2 páginas, as
  prévias DOCX/XLSX/PPTX/PDF, `Sidebar.test.tsx` (item Skills, `activeView`,
  `aria-current`, ocultação) e `SkillsView.test.tsx` (view no lugar do chat:
  listar/ativar/excluir/erro/“Voltar ao chat”).
- `pnpm build` → OK; chunk lazy `pdf-*.js` (~430 kB) e asset
  `pdf.worker.min-*.mjs` (~1,26 MB) fora do bundle inicial.
- Validação externa dos 4 helpers (Python 3.13 só stdlib, specs do §7.3):
  - `.docx` 5.274 B → python-docx lê 9 parágrafos e tabela;
  - `.xlsx` 4.874 B → openpyxl lê abas Vendas/Metas, fórmulas `=SUM(...)`;
  - `.pptx` 11.794 B → python-pptx lê 3 slides com títulos/bullets;
  - `.pdf` 1.363 B → pypdf lê 1 página com texto extraível.
- Nota de cobertura: a rasterização do PDF no canvas não é testada em CI (jsdom
  sem canvas 2D); o carregamento/render é validado com o fixture real e canvas
  fake, e o restante fica para a inspeção manual no app.

Limitações conhecidas da v1 (fora do §3): prévia de Office é estrutural (sem
imagens/cores/mesclagens), percentuais do XLSX aparecem como valor bruto, e
`run_code` não é sandbox de SO (opt-in + workspace/timeout/caps).

Nota de QA manual (v1.1): a `SkillsView` substitui a coluna do chat e o
`ChatView` permanece montado (rascunho e scroll preservados); ao voltar pelo
botão “Voltar ao chat”, por “Novo chat” ou abrindo uma conversa, o chat
reaparece no mesmo estado. Vale conferir visualmente em `pnpm app:dev`.

### v1.2 — repositórios padrão de skills (Codex/OpenCode/Claude/Agents)

O catálogo lê, além de `<app-data>/skills` e das embutidas, os repositórios
padrão de skills do usuário (§7.2): `~/.agents/skills`,
`$CODEX_HOME/skills`/`~/.codex/skills`,
`$CLAUDE_CONFIG_DIR/skills`/`~/.claude/skills` e
`$XDG_CONFIG_HOME/opencode/skills`/`~/.config/opencode/skills` (e
`%APPDATA%\opencode\skills` no Windows), em **modo somente leitura** e com
precedência Lumina > agents > codex > claude > opencode > embutidas.

- Frontmatter compatível com o ecossistema: **block scalars YAML** (`>`/`|`
  e variantes), `description` ≤ 1024 chars normalizada em uma linha e corpo
  ≤ 512 KB; a description no prompt é truncada em ~200 chars.
- UI (`SkillsView`, `sources.ts`): grupos por origem com badges, nota de
  “somente leitura” nas externas e switch para desativar (exclusão só das do
  Lumina).
- Teste real estrito: na máquina de desenvolvimento **21/21** skills de
  `~/.agents/skills` foram parseadas (nomes iguais aos diretórios, `source`
  correto, 0 rejeições); máquinas sem esses diretórios pulam o teste.
- Evidências: `cargo check` sem warnings; `cargo test --lib` **278 passed**;
  `pnpm typecheck` OK; `pnpm test` **29 arquivos / 846 testes**; `pnpm build` OK.

### v1.3 — artefatos: cards compactos, lista no painel e detecção de mudanças

- **Chat**: cards compactos em grid de até duas colunas; acima de 4 artefatos
  numa mensagem o chat mostra os 4 primeiros e um botão com ícone **+**
  (“Ver todos (N)”), que abre o painel lateral na lista completa. Os botões
  existentes (**Abrir** e **Salvar como…**) foram preservados.
- **Painel lateral**: dois modos controlados por `uiStore.artifactPanelView` —
  **lista** (cards compactos, contador no header, estado vazio) e **prévia**
  (UI anterior + botão “Ver lista de artefatos”). Clicar em “Abrir” na lista
  entra na prévia; a prévia cai para a lista quando o artefato ativo deixa de
  existir. A ação “Abrir artefatos” da paleta abre a lista.
- **Detecção/reconciliação**: `artifact_created` é aplicado só para a conversa
  ativa e em ordem canônica (`createdAt, id`, a mesma de `list_artifacts`);
  `chatStore.syncArtifacts` refaz a leitura autoritativa ao fim do turno
  (`done`/`cancelled`/`error`), ao abrir uma conversa (mesmo com mensagens em
  cache), após editar/regenerar e ao excluir a conversa. Um token monotônico
  descarta respostas fora de ordem e de conversas que o usuário já deixou.
- **Arquivos**: `src/components/chat/MessageArtifacts.tsx`,
  `src/components/artifacts/{ArtifactCard,ArtifactList,ArtifactPanel}.tsx`,
  `src/lib/store/{uiStore,chatStore}.ts`, `src/components/palette/CommandPalette.tsx`.
- **Evidências**: `pnpm typecheck` OK; `pnpm test` **34 arquivos / 884 testes**
  (38 novos); `pnpm build` OK. Sem mudanças de backend: o painel continua
  lendo `list_artifacts`/`get_artifact_content`/`get_artifact_preview`.

### v1.4 — fontes na sidebar (chips até 8 + painel lateral)

- **Chat**: `CitationChips` mostra no máximo **8 fontes** por mensagem (dedupe por
  URL, ordem de descoberta). Acima disso o excedente vira o botão **+ N fontes**,
  que abre o painel lateral de fontes; a expansão inline e o "Mostrar menos"
  foram removidos.
- **Painel de fontes** (`SourcesPanel`): mesmo padrão visual do painel de
  artefatos (slide-in à direita, `aria-hidden`/`inert`, foco ao abrir), lista
  todas as fontes da conversa (`conversationCitations`), com domínio + título e
  abertura no navegador padrão; header "Fontes" com contador, estado vazio e
  rodapé. Os dois painéis são mutuamente exclusivos (`uiStore`).
- **Arquivos**: `src/lib/citations.ts`, `src/lib/__tests__/citations.test.ts`,
  `src/components/chat/{CitationChips,SourcesPanel}.tsx` (+ testes),
  `src/lib/store/uiStore.ts`, `src/App.tsx` (montagem e Escape).
- **Evidências**: `pnpm typecheck` OK; `pnpm test` **37 arquivos / 903 testes**;
  `pnpm build` OK. Sem mudanças de backend (as citações já vinham nos eventos
  `tool_call_finished` e são persistidas em `messages.citations`).
### v1.5 — visualização ampliada de artefatos

Pedido: “mais visualização para diferentes tipos de arquivos no sistema de
artefatos, incluindo imagens de diferentes tipos, arquivos variados e arquivos
de código com syntax highlight”.

- **Backend**:
  - `ArtifactKind` ganha `Audio`, `Video`, `Archive` (serde `audio|video|archive`)
    e `from_mime_and_name` cobre as extensões/mimes correspondentes + imagens
    `ico/jfif/apng/tif/tiff`.
  - `ArtifactPreview` ganha `Image` (mime/dimensões + PNG convertido quando o
    formato não abre no WebView), `Archive` (listagem ZIP) e `Binary`
    (formato + primeiros 4096 bytes para hexdump). `documents::preview` ganha
    `image_preview` (TIFF→PNG ≤2560 px via crate `image`), `archive_preview`
    (ZIP: ≤400 entradas) e `binary_preview`; `documents/image.rs` expõe os
    parsers de header para reuso.
  - `get_artifact_content` só trafega payload necessário (texto, PDF, imagem
    web-safe, áudio/vídeo ≤24 MiB); Office/ZIP/binário não duplicam bytes e
    TIFF não manda o original.
  - `tools::artifacts` amplia `CODE_EXTENSIONS`/`language_for` (config/scripts/
    Dockerfile/Makefile/etc.) e `extension_for_mime` para mídia/ZIP.
- **Renderer**:
  - `src/lib/highlight` (Prism compartilhado): grammars extras via `prismjs`
    registradas na instância do `prism-react-renderer`, tema único de tokens e
    `normalizeLanguage`/`languageLabel`; `CodeBlock` ganha `wrap`/`meta` e o
    chat passa a usar o mesmo highlight.
  - Novos componentes: `ImagePreview`/`SvgPreview` (zoom, pan, xadrez,
    dimensões, formatos), `AudioPreview`, `VideoPreview`, `ArchivePreview`,
    `HexDump` + `BinaryPreview` enriquecido, `MarkdownPreview` (Documento/
    Código), `JsonPreview`/`JsonTree` (Árvore/Código), `CodePreview` e
    `CsvPreview` (delimitador automático).
  - `ArtifactPreview` roteia todos os kinds; `kinds.ts` cobre os novos tipos e
    infere linguagem por extensão para artefatos antigos.
- **Limites**: mídia inline ≤24 MiB; hexdump ≤4096 bytes; ZIP ≤400 entradas
  (nomes ≤240 chars); TIFF ≤2560 px no lado maior; nós de JSON ≤2000;
  CSV ≤501 linhas.
- **Arquivos novas**: `src/lib/highlight/**` (7 arquivos + 70 testes),
  `src/components/artifacts/{Image,Audio,Video,Archive,Binary,HexDump}`,
  `src/components/artifacts/{Markdown,Code,Csv,Json}Preview`, `JsonTree`,
  `src/components/artifacts/index.ts` (superfície pública), fixtures
  `documents/testdata/{pacote-projeto.zip,scan-tiff.tif}`; previews de backend
  em `documents/preview.rs`/`image.rs`; rotas/caps em `commands/artifacts.rs`;
  kinds/idioma em `tools/artifacts.rs`; contrato em `domain.rs`/`types.ts`.
- **Limites documentados**: mídia inline ≤24 MiB; hexdump ≤4096 bytes; ZIP
  ≤400 entradas (nomes ≤240 chars); TIFF→PNG ≤2560 px no lado maior (dimensões
  originais preservadas nos metadados); árvore JSON ≤2000 nós/profundidade 100;
  CSV ≤501 linhas; Prism com 35 grammars extras carregadas sobre a instância
  embutida do `prism-react-renderer` (o `lib/highlight` cobre 70 testes).
- **Evidências da verificação final** (árvore integrada):
  - `cd src-tauri && cargo check --lib --tests` → OK, 0 warnings;
  - `cd src-tauri && cargo test --lib` → **316 passed; 0 failed; 9 ignored**
    (baseline da v1.2: 278), incluindo `documents::preview` 32 (TIFF→PNG real,
    ZIP fixtures/truncamento, 4096 bytes, corrompidos), `commands::artifacts` 18
    (payloads e previews reais), `tools::artifacts` 16 (kinds/idioma/dotfiles) e
    `db` 14 (16 kinds, migração legada);
  - `pnpm typecheck` → OK;
  - `pnpm test` → **48 arquivos / 1077 testes** (baseline da v1.4: 37/903;
    +174 novos), incluindo ImagePreview (15), HexDump (8), Audio (7), Video (5),
    Archive (6), Binary (7), JsonPreview (8), MarkdownPreview (3), CodePreview
    (9), csv (20), kinds (8), `lib/highlight` (70) e ArtifactPreview (30);
  - `pnpm build` → OK (chunk principal ~1,79 MB com as grammars extras; apenas o
    aviso de tamanho do Vite; `pdf-*.js` e `pdf.worker.min-*.mjs` seguem lazy).

## 15. Critérios de aceite

1. `run_code` habilitado gera DOCX, XLSX, PPTX e PDF via scripts das skills, e
   os arquivos aparecem como artefatos com preview funcional.
2. Skills embutidas listadas e lidas pelo agente; pasta do usuário adiciona
   skills sem rebuild.
3. Painel de artefatos renderiza PDF (páginas), DOCX (HTML), XLSX (grade),
   PPTX (slides) e imagens — sem cartão genérico para esses tipos.
4. Desligar `codeExecutionEnabled` remove `run_code` do prompt e das tools.
5. `cargo test --lib`, `pnpm test`, `pnpm typecheck`, `pnpm build` verdes.
6. Documentação atualizada (este arquivo, ARCHITECTURE, README).
7. A gestão de skills abre **no lugar do chat** (view `SkillsView`, não modal):
   lista todas as skills, ativa/desativa (o agente deixa de vê-las no próximo
   turno) e exclui apenas as do usuário; “Voltar ao chat”/“Novo chat”/abrir
   conversa retornam ao chat; o item da sidebar some quando
   `skillsPanelEnabled = false` e o switch existe em Configurações → Ferramentas.
8. O catálogo inclui automaticamente as skills instaladas nos repositórios
   padrão (`~/.agents/skills`, `~/.codex/skills`, `~/.claude/skills`,
   `~/.config/opencode/skills`/XDG) sem copiar nem escrever neles; a UI mostra a
   origem e permite desativar, mas não excluir essas skills.
9. **v1.5 — imagens**: o painel abre PNG/JPEG/GIF/WebP/AVIF/BMP/ICO com zoom,
   pan e fundo xadrez; TIFF é convertido para PNG no backend e exibido; HEIC ou
   formato ilegível cai no cartão com “Abrir/Salvar como…” (sem tela quebrada).
10. **v1.5 — arquivos variados**: áudio e vídeo tocam em player nativo (ou
    cartão com motivo quando > 24 MiB/formato não suportado), ZIP mostra a
    listagem de entradas com resumo, Markdown é renderizado (Documento/Código) e
    JSON abre em árvore colapsável (com modo código); CSV/TSV tabulam com
    delimitador detectado; binários desconhecidos mostram formato + hexdump.
11. **v1.5 — código**: artefatos de código usam syntax highlight Prism para
    30+ linguagens (incluindo as que o renderer não cobria: bash, java, ruby,
    php, c#, toml, ini, dockerfile, makefile, diff, powershell…), com números de
    linha, contagem de linhas e alternância de quebra de linha; linguagem
    inferida pela extensão/nome quando o artefato antigo não tem `language`.
12. `pnpm test`/`pnpm build`/`cargo test --lib` verdes com os novos testes de
    prévia (imagem/áudio/vídeo/ZIP/hexdump/markdown/JSON/código/CSV) e sem
    payloads gigantes no IPC (caps documentados em §9.2).
