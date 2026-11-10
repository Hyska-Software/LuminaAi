# Ícones de marca dos modelos — integração LobeHub Icons

> Status: **implementado e verificado** (2026-10-24). Fonte visual:
> [icons.lobehub.com](https://icons.lobehub.com) (projeto
> [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons), licença MIT).
> Este documento registra a análise da biblioteca, a decisão de integração, o
> mapeamento família → marca e como mantê-lo.

## 1. Objetivo

Substituir as iniciais genéricas dos avatares de modelo ("DS", "GL", "DE") por
**o ícone oficial de cada marca** no pill do composer, no popover do
seletor, no dialog de modelos, na bolha de detalhes e no dialog de modelo
bloqueado — mantendo a linguagem visual calma do Zylara (tokens, superfícies
neutras) e a legibilidade nos temas claro e escuro.

## 2. Análise da biblioteca

A LobeHub publica a coleção em dois pacotes npm distintos:

| Pacote | Versão analisada | Conteúdo | Tamanho | Dependências |
| --- | --- | --- | --- | --- |
| `@lobehub/icons` | 6.9.0 | 353 marcas como componentes React (354 pastas em `es/`; uma é a infraestrutura `hooks`); cada pasta `es/<Marca>/` expõe `Mono`, `Color`, `Avatar`, `Combine`, `Text`, `Brand`, `BrandColor`, `BrandMono`, `modelConfig`, `providerConfig`… | ~9,8 MB (unpacked) | runtime: `es-toolkit`, `lucide-react`, `polished`; **peer: `@lobehub/ui` ^6** (kit de UI inteiro), `react` ^19 |
| `@lobehub/icons-static-svg` | 1.98.0 | 978 arquivos SVG planos em `icons/` (`<marca>.svg` mono com `fill="currentColor"`, `<marca>-color.svg`, `<marca>-text.svg`, variantes `brand`) | ~800 KB (packed) / ~2,4 MB (unpacked) | nenhuma |

Detalhes que pesaram na decisão:

1. **O pacote React só importa `@lobehub/ui` nas variantes `Avatar`, `Combine`,
   `Brand`, `Text` e nos helpers `ModelIcon`/`ProviderIcon`** (via
   `features/IconAvatar` e `features/IconCombine`). Os componentes `Mono` e
   `Color` de cada marca são SVG puro. Ainda assim, o peer `@lobehub/ui` é
   declarado no `package.json`, e o pnpm 10 o auto-instalaria (kit completo,
   antd-like) só para compilar — custo desnecessário para renderizar glifos.
2. A biblioteca tem **uma tabela oficial de resolução modelo → marca** em
   `src/features/modelConfig.ts` (`modelMappings`), com regex por linha de
   modelo (`modelMappings` é a fonte de verdade usada pelo `ModelIcon` do
   LobeChat). É essa tabela que fundamenta o nosso mapeamento por família (§4).
3. As variantes **mono** são as recomendadas para UI temática: `fill="currentColor"`,
   então o glifo herda `text-*` do tema (claro/escuro) e convive com os tiles
   de token que o app já usa. As variantes `color` têm cores fixas — várias
   ficariam ilegíveis no tema escuro (OpenAI/Grok são `#000`, Qwen é `#082dff`).
4. Para um app Tauri offline, importar 16 SVGs via Vite `?raw` é melhor que
   carregar 978 arquivos, um catálogo de componentes de 9,8 MB ou CDN.

### Decisão

- Dependência: **`@lobehub/icons-static-svg@1.98.0`** (pin exato — os nomes de
  arquivo são o contrato; atualizações exigem revisão do mapa e dos testes).
- Renderização: SVGs **mono** inline (`?raw` + `dangerouslySetInnerHTML` de
  constante interna, nunca de input do usuário), tingidos por `currentColor`.
- Sem CDN, sem React components da LobeHub, sem `@lobehub/ui`.

## 3. Arquitetura

```
data/catalog.json  (family por modelo)
        │
        ▼
src/lib/modelIcons.ts ── modelIconForFamily(family) ──► ModelIconKey | null
        │                                              (aliases: openai, anthropic, zhipu…)
        ▼
src/lib/modelIconAssets.ts ── MODEL_ICON_SVG[key]  (16 SVGs LobeHub via `?raw`)
        │
        ▼
src/components/models/FamilyAvatar.tsx ── tile circular com tokens + glifo
        │
        ├─ ModelRow (lista/popover)      ── 20/24 px
        ├─ ModelDetailPanel (bolha)      ── 26/32 px
        ├─ ModelPill (composer)          ── 18/20 px
        └─ ModelPickerDialog (bloqueado) ── 32 px
```

- **`src/lib/modelIcons.ts`** (puro, sem JSX/assets): chaves, rótulos,
  normalização (`trim`, minúsculas, `_`/espaço → `-`), aliases de fornecedor e
  fallback de iniciais. Testável sem DOM.
- **`src/lib/modelIconAssets.ts`**: importa os 16 SVGs mono com `?raw`. Só as
  marcas usadas entram no bundle (tree-shaking por import explícito).
- **`FamilyAvatar`**: mantém a API pública anterior (`FamilyAvatarProps`,
  `FamilyAvatar`, `familyAvatarVisual`) e o tile circular com os tokens de cor
  por família; quando há marca, o interior do tile passa a ser o glifo (~58% do
  tamanho, herdando `currentColor`); quando não há, continuam as iniciais.
- Nenhuma mudança de contrato IPC, backend ou `data/catalog.json`: o ícone é
  derivado no renderer a partir de `ModelInfo.family`.

### Cores

O tile reutiliza os tokens que já existiam para cada família (sem hex solto):

| Marca | Tile |
| --- | --- |
| Claude | `bg-warning-soft text-warning` |
| DeepSeek | `bg-surface-active text-accent` |
| Gemini | `bg-accent-soft text-accent` |
| Z.ai (GLM) | `bg-accent-soft text-accent` |
| OpenAI (GPT) | `bg-success-soft text-success` |
| Grok | `bg-surface-active text-foreground` |
| Hunyuan | `bg-accent-soft text-accent` |
| Kimi | `bg-accent-soft text-accent` |
| LongCat | `bg-success-soft text-success` |
| Xiaomi MiMo | `bg-danger-soft text-danger` |
| MiniMax | `bg-danger-soft text-danger` |
| Mistral | `bg-warning-soft text-warning` |
| Meta (Muse) | `bg-warning-soft text-warning` |
| NVIDIA (Nemotron) | `bg-success-soft text-success` |
| Qwen | `bg-accent-soft text-accent` |
| StepFun | `bg-success-soft text-success` |
| fallback | `bg-surface-hover text-foreground-muted` |

## 4. Mapeamento família → marca

Espelha o `modelMappings` oficial da LobeHub v6.9.0, normalizado para as
famílias do nosso catálogo (`.research/catalog-raw.json` → `data/catalog.json`):

| Família no catálogo | Ícone LobeHub | Arquivo | Evidência no `modelConfig.ts` da LobeHub |
| --- | --- | --- | --- |
| `claude` | Claude | `claude.svg` | `claude` |
| `deepseek` | DeepSeek | `deepseek.svg` | `deepseek` |
| `gemini` | Gemini | `gemini.svg` | `gemini` |
| `glm` | **Z.ai (ZAI)** | `zai.svg` | `^glm-5`, `/glm-5`, `-glm-5` — casam **antes** do ChatGLM |
| `gpt` | OpenAI | `openai.svg` | `^gpt-`, `/gpt-`, `openai` |
| `grok` | Grok | `grok.svg` | `^grok-`, `/grok-` |
| `hy` | Hunyuan | `hunyuan.svg` | `hunyuan`, `hy3`, `hy4` |
| `kimi` | Kimi | `kimi.svg` | `kimi`, `moonshot` |
| `longcat` | LongCat | `longcat.svg` | `longcat` |
| `mimo` | Xiaomi MiMo | `xiaomimimo.svg` | `^mimo-`, `/mimo-` |
| `minimax` | Minimax | `minimax.svg` | `minimax`, `abab` |
| `mistral` | Mistral | `mistral.svg` | `mistral`, `codestral`, `devstral`, … |
| `muse` | **Meta** | `meta.svg` | `(^|/)muse-(spark|wonder)($|-)` (modelos Muse são da Meta) |
| `nemotron` | NVIDIA | `nvidia.svg` | `nemotron`, `nemoretriever`, `neva-`, `nv-` |
| `qwen` | Qwen | `qwen.svg` | `qwen`, `qwq`, `qvq`, `wanx`, `tongyi` |
| `step` | StepFun | `stepfun.svg` | `step` |
| `default` | **sem marca** | — | Beam/Omen/Big Pickle/Flint não existem na coleção → fallback |

Aliases aceitos pelo resolver (para sobreviver a mudanças de catálogo):
`anthropic→claude`, `google→gemini`, `openai/codex→openai`, `xai→grok`,
`zhipu/chatglm/glmv/glm-v→zai`, `hunyuan→hunyuan`, `moonshot→kimi`, `meta/metaai→meta`,
`nvidia→nvidia`, `stepfun→stepfun`, `xiaomi-mimo→xiaomimimo`. São decisões de
produto: apontam para a marca principal da família no app (ex.: `anthropic` e
`claude` mostram o mesmo glifo), não replicam a distinção fornecedor × modelo
da tabela oficial quando ela não aparece no catálogo.

### Limitações conhecidas

- A resolução é **por família**, não por id de modelo. Hoje isso acerta todos
  os 120 modelos do catálogo. Se entrarem modelos de submarcas que a LobeHub
  distingue (ex.: GLM antigo → ChatGLM, `gemini-*-image` → Nano Banana,
  `gpt-*-codex` → variante Codex), será preciso evoluir para resolução por
  id/nome (como o `ModelIcon` da LobeHub faz com regex) antes de exibir o
  glifo — a família sozinha passaria a ser ambígua.
- `default` (Beam/Omen/Big Pickle/Flint) fica no fallback de iniciais; se a
  LobeHub publicar uma marca para eles, basta seguir §5.

### Fallback

Famílias sem marca oficial (`default` e futuras) mantêm o avatar neutro com
**iniciais do nome do modelo** (ex.: "Beam Free" → `BF`, "Big Pickle" → `BP`),
não da família — assim o tile continua identificando o modelo. É o equivalente
ao `DefaultAvatar` da LobeHub, adaptado à linguagem do app.

## 5. Como adicionar/atualizar uma marca

1. Confira o nome do arquivo em
   `node_modules/@lobehub/icons-static-svg/icons/` (ex.: `nova.svg`) e se ele é
   mono (`fill="currentColor"`).
2. `src/lib/modelIcons.ts`: adicione a chave em `ModelIconKey`,
   `MODEL_ICON_LABELS` e no mapa de aliases.
3. `src/lib/modelIconAssets.ts`: importe o SVG com `?raw` e registre em
   `MODEL_ICON_SVG`.
4. `src/components/models/FamilyAvatar.tsx`: adicione o tile de token da marca
   em `BRAND_VISUALS`.
5. Atualize `src/lib/__tests__/modelIcons.test.ts` (spec + títulos oficiais) e
   `docs/DESIGN.md` §7/§8 se o comportamento visual mudar.
6. `pnpm test && pnpm typecheck`.

Ao subir a versão do pacote, revise os nomes de arquivo e os títulos (os testes
de integridade quebram de propósito se um asset sumir ou deixar de ser mono).

## 6. Testes

- `src/lib/__tests__/modelIcons.test.ts` (28 testes): cobertura de todas as
  famílias do catálogo, aliases, normalização, fallback de iniciais, regressões
  de prototype (`constructor` etc.) e integridade dos 16 SVGs (24×24,
  `currentColor`, sem `fill` hex).
- `src/components/models/FamilyAvatar.test.tsx` (66 testes): cada família
  renderiza o `<title>` oficial da marca; fallback sem SVG; `aria-hidden`;
  tamanhos; `className`/`title`; tokens por marca.
- `src/lib/__tests__/modelIcons.edge.test.ts` (71 testes) e
  `src/components/models/FamilyAvatar.edge.test.tsx` (56 testes): verificação
  independente (spec hardcoded a partir da fonte oficial, inputs hostis,
  pior caso visual, smoke em `ModelRow`).

### Verificação final (2026-10-24)

| Comando | Resultado |
| --- | --- |
| `pnpm test` | **23 arquivos / 757 testes** verdes |
| `pnpm typecheck` | sem erros |
| `pnpm build` | build do renderer OK (SVGs entram no bundle principal; sem CDN, sem `@lobehub/ui`) |

## 7. Licença e atribuição

Os SVGs são distribuídos por **LobeHub** sob licença **MIT**
(`@lobehub/icons-static-svg`, projeto `lobehub/lobe-icons`). O uso neste app é
via dependência npm declarada em `package.json` (versão pinada), sem cópia
manual de arquivos; o aviso de copyright original permanece no pacote
instalado. Ao adicionar novos ícones manualmente fora do pacote, inclua o
aviso MIT do projeto.
