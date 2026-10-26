# Plano — Provedor Anthropic direto (API oficial, API key)

> **Objetivo**: adicionar o provedor **Anthropic** ao Lumina usando a **API oficial**
> (`https://api.anthropic.com`) autenticada com **API key** (`ANTHROPIC_API_KEY` ou
> chave colada em Configurações → Provedores), sem OAuth de assinatura e sem gateway
> intermediário.
>
> **Status**: plano executado e verificado (automático/offline). Evidência em
> `EVIDENCE.md`; gate live com chave real documentado na §5 de `EVIDENCE.md`.

## 1. Contexto

Hoje o Lumina fala quatro protocolos de wire (`openai-chat`, `openai-responses`,
`anthropic`, `google`) e tem três provedores no catálogo:

| Provedor | Base URL | Autenticação |
| --- | --- | --- |
| OpenCode Go | `https://opencode.ai/inference/go` | API key OpenCode |
| OpenCode Zen | `https://opencode.ai/inference` | API key OpenCode |
| OpenAI | `https://api.openai.com/v1` | OAuth "Sign in with ChatGPT" **ou** API key |

O adaptador `providers/anthropic.rs` **já existe** e é usado pelos modelos Claude/Kimi/
MiniMax servidos pelo gateway OpenCode. Falta apenas um provedor que aponte para a API
oficial da Anthropic — ou seja, a maior parte do risco técnico (streaming SSE,
`tool_use`, `thinking`, imagens, replay de `provider_state`) já está resolvida e testada.

O usuário pediu explicitamente o caminho suportado: **API key**. O OAuth de assinatura
do Claude (Claude Code) foi avaliado e **descartado**: a Anthropic proíbe apps de
terceiros de oferecerem login claude.ai/limites do plano sem aprovação prévia. Ver a
discussão em `docs/goals/anthropic-api-provider/PLAN.md#2` e o comparativo em
`docs/MODELS.md`.

## 2. Decisões de arquitetura (e por quê)

### D1 — Bearer com a API key, não `x-api-key`

A documentação oficial atual (`platform.claude.com/docs/en/api/overview`) define
`Authorization: Bearer <token>` como o header **primário** (token = API key ou access
token do Workload Identity Federation) e trata `x-api-key` como *legacy fallback*:

> `Authorization` — `Bearer <token>` ... **Yes, unless `x-api-key` is set**
> `x-api-key` — your API key from Console. Legacy fallback for `Authorization`, still
> supported.

O exemplo oficial do endpoint de modelos também usa `Authorization: Bearer
$ANTHROPIC_API_KEY`:

```bash
curl https://api.anthropic.com/v1/models \
    -H 'anthropic-version: 2026-10-21' \
    -H "Authorization: Bearer $ANTHROPIC_API_KEY"
```

**Consequência**: o transporte já manda `Authorization: Bearer <key>` para qualquer
provedor, então **não é preciso** um novo tipo de header de credencial no
`ProviderConfig`/`harness`. O que falta é apenas o header **`anthropic-version`**
(obrigatório), modelado como header estático do provedor (D2).

### D2 — Headers estáticos por provedor no catálogo

`anthropic-version` é obrigatório em toda requisição. Ele não é credencial (não pode ir
para `authorization`), é fixo por provedor e precisa aparecer em **três** caminhos:
inferência (`providers/*`), listagem de modelos (`commands/models.rs`) e validação de
conexão (`commands/settings.rs`).

Em vez de hardcodar o valor em três lugares, o catálogo ganha:

```json
"headers": { "anthropic-version": "2026-10-21" }
```

e `ProviderInfo::static_headers()` entrega os pares de forma deterministica (ordenados
por nome). O `ProviderConfig` reusa o campo `extra_headers` que já existe (hoje só os
testes o preenchem) — o harness passa `provider.static_headers()`.

Valor escolhido: **`2026-10-21`** (versão mais recente no histórico oficial — ver
`platform.claude.com/docs/en/api/versioning`). Pinning é seguro: a API preserva os
parâmetros de entrada/saída de cada versão. Se uma versão nova for necessária, muda só o
JSON (sem recompilar código). A versão `2023-06-01` continua existindo, mas a doc
recomenda a mais recente e é a que documenta `output_config.effort`/`thinking.adaptive`.

### D3 — Sem mudanças no protocolo nem no perfil de request

O provedor usa o perfil `standard` (`RequestProfile::Standard`), o protocolo
`anthropic` e o adaptador existente. Não há request profile novo porque:

- `temperature`/`top_p`/`top_k` **foram removidos** da API em `2026-10-21` (requisição
  com eles retorna 400 — ver version history). O harness **já omite** `temperature`
  para a família `claude` (`harness::temperature_request`), então nada a fazer.
- O adaptador não envia `top_p`/`top_k`.
- `max_tokens` é obrigatório e já é enviado; com `thinking.enabled` o adaptador garante
  `max_tokens > budget_tokens` (a API exige orçamento ≥ 1024 e **menor** que
  `max_tokens`).
- Raciocínio: `thinking: {type: adaptive} + output_config: {effort}` e
  `thinking: {type: enabled, budget_tokens}` são exatamente o contrato documentado
  (Create a Message → `output_config.effort` low/medium/high/xhigh/max e
  `thinking.type` enabled/disabled/adaptive/between_tools). O código atual já segue
  isso.
- Tools do Lumina viram `tools[]` client-side (`name`, `description`, `input_schema`),
  como a API espera.
- Não enviamos `anthropic-beta`: nenhuma feature usada (messages, tools, thinking,
  imagens base64, system) exige beta header na versão pinada.

### D4 — Só a API key; OAuth de assinatura fica de fora (kill criterion)

A Anthropic **não** tem um programa público equivalente ao "Sign in with ChatGPT"
(SIWC). A doc do Agent SDK proíbe explicitamente que apps terceiros ofereçam login
claude.ai ou limites do plano sem aprovação prévia. Portanto:

- ❌ nada de `claude setup-token`, `CLAUDE_CODE_OAUTH_TOKEN`, `.credentials.json` do
  Claude Code, endpoints internos ou client ids do Claude Code;
- ❌ nada de `authorization_code`/PKCE para a Anthropic neste provedor;
- ✅ somente `Authorization: Bearer <ANTHROPIC_API_KEY>`.

Critérios de verificação (grep no fim da implementação) garantem que nada disso entrou.

## 3. Contrato da API oficial (evidências)

Fonte: docs oficiais atuais (`platform.claude.com`, outubro/2026) + `models.dev`.

### 3.1 Autenticação / transporte

| Item | Valor |
| --- | --- |
| Base URL | `https://api.anthropic.com` |
| Messages | `POST /v1/messages` |
| Modelos | `GET /v1/models` |
| Credencial | `Authorization: Bearer <API key>` (`x-api-key` é fallback legado) |
| Versão | `anthropic-version: 2026-10-21` (**obrigatório**) |
| Content-Type | `application/json` |
| Streaming | `stream: true`, SSE nomeado: `message_start`, `content_block_start/delta/stop`, `message_delta`, `message_stop` (formato estável desde `2023-06-01`) |
| Erros | `{"type":"error","error":{"type":"...","message":"..."}}`; HTTP 401/429/400/413/etc. |
| Rate limit headers | `retry-after` + headers de limite (não usados nesta entrega) |

### 3.2 List Models (`GET /v1/models`)

Query: `after_id`, `before_id`, `lifecycle`, `limit` (1–1000, default 20).

Resposta:

```json
{
  "data": [
    {
      "id": "claude-opus-5-5",
      "display_name": "Claude Opus 5.5",
      "created_at": "2026-09-21T00:00:00Z",
      "lifecycle": "active",
      "line": "opus",
      "max_input_tokens": 1000000,
      "max_tokens": 128000,
      "capabilities": {
        "effort": { "supported": true, "low": {"supported": true}, "...": {} },
        "thinking": { "supported": true, "types": { "adaptive": {"supported": true}, "enabled": {"supported": true}, "disabled": {"supported": true} } },
        "image_input": { "supported": true },
        "pdf_input": { "supported": true },
        "structured_outputs": { "supported": true }
      },
      "type": "model"
    }
  ],
  "first_id": "claude-...",
  "has_more": false,
  "last_id": "claude-..."
}
```

Paginação: `has_more: true` → repetir com `?after_id=<last_id>` até `has_more: false`.
Modelos `retired` não aparecem por padrão; `deprecated` aparecem.

### 3.3 Modelos atuais e preços (models.dev + models overview)

Lineup atual: **Claude Fable 5.1** ($10/$50 MTok), **Opus 5.5** ($4/$20),
**Sonnet 5.5** ($2/$10), **Haiku 5.5** (a partir de $0.10/$0.50). A partir da geração
4.6 os IDs são *dateless* (`claude-sonnet-5-5`, `claude-opus-5-5`); modelos anteriores
usam snapshot com data e alguns têm alias de conveniência (`claude-haiku-4-5`).

Seed do catálogo (14 IDs dateless, sem os snapshots com data — a lista da conta via
`/v1/models` continua sendo a fonte para qualquer modelo extra):

`claude-fable-5`, `claude-fable-5-1`, `claude-haiku-4-5`, `claude-haiku-5-5`,
`claude-opus-4-5`, `claude-opus-4-6`, `claude-opus-4-7`, `claude-opus-4-8`,
`claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-4-5`, `claude-sonnet-4-6`,
`claude-sonnet-5`, `claude-sonnet-5-5`.

Default do provedor: `claude-sonnet-5-5` (melhor relação velocidade/inteligência,
1M de contexto).

## 4. Mapa de mudanças no repositório

### 4.1 Catálogo / contrato (Lead)

- `data/catalog.json`: novo provedor `anthropic` (id/name/shortName/baseUrl/consoleUrl/
  endpoints/authEnv/defaultModelId/headers/models/notes); `version: 1` se mantém
  (campos novos são opcionais e retrocompatíveis).
- `scripts/build-catalog.mjs`:
  - `buildAnthropicProvider()` a partir de `models.dev` (`anthropic`), excluindo
    snapshots com data e normalizando `family: "claude"`, `protocols: ["anthropic"]`,
    nome sem sufixo `(latest)`;
  - `ANTHROPIC_ENDPOINTS`, `ANTHROPIC_HEADERS`, `ANTHROPIC_DOCS`, `ANTHROPIC_SEED`;
  - `providers: [go, zen, openai, anthropic]` + suporte a `--provider anthropic`
    (merge cirúrgico, sem tocar Go/Zen/OpenAI).
- `src-tauri/src/catalog.rs`:
  ```rust
  /// Headers estáticos declarados pelo provedor (ex.: anthropic-version).
  #[serde(default)]
  pub headers: HashMap<String, String>,

  impl ProviderInfo {
      /// Headers estáticos em ordem determinística (nome minúsculo, ordenado).
      pub fn static_headers(&self) -> Vec<(String, String)>;
  }
  ```
  Testes: catálogo legado sem `headers` (default vazio), entrada `anthropic` completa
  (Bearer não muda; endpoints certos), determinismo/ordenação.
- `src/lib/types.ts`: `ProviderInfo.headers?: Record<string, string>` (espelho do
  contrato IPC/catálogo).

### 4.2 Camada de provedores (provider-dev)

- `src-tauri/src/providers/**`:
  - **Nenhuma mudança comportamental necessária** (Bearer + `extra_headers` já é o
    transporte usado). O campo `extra_headers` do `ProviderConfig` passa a receber os
    headers estáticos preenchidos pelo harness.
  - Novo teste `#[ignore]` de fumaça real (chave do usuário):
    `providers::smoke::anthropic_direct_lists_models_and_streams` lê
    `ANTHROPIC_API_KEY` do ambiente, faz `GET /v1/models` (espera ids `claude-*`) e um
    `POST /v1/messages` mínimo com streaming (`"diga olá"`), imprimindo texto/usage.
    Sem chave → retorna `Ok` sem tocar a rede (ignorado por padrão em qualquer caso).
  - Testes do adaptador: garantir que o body para um modelo Claude do catálogo direto
    (fixture do provedor `anthropic`) não inclui `temperature`/`top_p`, inclui
    `max_tokens`, `stream: true` e mapeia esforço/orçamento como documentado.

### 4.3 Harness (harness-dev)

- `src-tauri/src/harness/mod.rs`, `provider_config`:
  ```rust
  extra_headers: provider.static_headers(),
  ```
- Testes: config de um provider com `headers` carrega os pares em ordem; providers sem
  headers (Go/Zen/OpenAI) continuam com `extra_headers` vazio; `CompletionRequest`
  montado para Claude direto não leva `temperature`.

### 4.4 Persistência/validação (storage-dev)

- `src-tauri/src/config.rs`: `default_auth_env("anthropic") => "ANTHROPIC_API_KEY"`
  (o catálogo já declara `authEnv`; o fallback fica correto para resolução
  settings→env→CLI).
- `src-tauri/src/commands/settings.rs`:
  - `probe_models` passa a receber `&ProviderInfo` e monta os headers via
    `provider.static_headers()` + `Authorization: Bearer <key>` (hoje só Bearer) —
    necessário para `anthropic-version` na validação;
  - `api_key_validation_hint`: copy específica da Anthropic
    ("Copie a API key completa do Console da Anthropic (`sk-ant-…`).") mantendo as
    copies existentes para OAuth/OpenCode;
  - `models_endpoint` já é catalog-driven → produz
    `https://api.anthropic.com/v1/models` sem `/v1/v1/`.
- Testes: `models_endpoint` para fixture Anthropic; hint por tipo de provedor; env
  default; validação 401/403 genérica continua sem citar ChatGPT para provedor api-key.

### 4.5 Listagem/merge de modelos (Lead)

- `src-tauri/src/commands/models.rs`:
  - `fetch_remote_models`: headers via `Authorization` + `provider.static_headers()`;
    **paginação genérica** (`has_more` + `last_id` → `after_id`), mantendo o parser
    tolerante aos formatos `{"models":[…‥]}` (OpenAI plano) e `{"data":[…]}` (OpenAI
    plataforma / Anthropic);
  - `RemoteModel` ganha metadados opcionais usados só quando existirem:
    `context_window` (`max_input_tokens`), `max_output` (`max_tokens`),
    `input_modalities`/`attachment` (`capabilities.image_input`/`pdf_input`),
    `reasoning_options` (`capabilities.effort` → effort values; `thinking.supported`
    → toggle);
  - `estimated_model` usa esses metadados quando presentes (senão mantém os defaults
    conservadores) e a família/protocolos do primeiro modelo do provedor (Claude);
  - mensagem de "sem credencial" fica provider-aware **mantendo a substring
    "nenhuma credencial"** usada por `refresh_catalog` para não poluir o log.
- Testes: parser de página OpenAI/Anthropic (paginação e `has_more`), URL com
  `after_id`, merge preservando metadados do catálogo, modelo estimado Anthropic com
  capacidades lidas da conta, mensagem de credencial para api-key vs oauth.

### 4.6 UI (ui-systems)

- `src/components/settings/ProvidersTab.tsx`:
  - o card genérico de API key já renderiza o provedor sozinho; ajustar
    `placeholder` para ser provider-aware (Anthropic: `Colar API key da Anthropic
    (sk-ant-…)…`; OpenAI e OpenCode mantêm o texto atual);
  - parágrafo de privacidade: "chaves de API (OpenCode/Anthropic) e a sessão do
    ChatGPT…".
- `src/components/settings/ProvidersTab.test.tsx`: novo teste do card Anthropic
  (sem botão "Continuar com ChatGPT", placeholder/console corretos, salvar chama
  `setProviderKey('anthropic', …)`, "Testar conexão" chama `validateProvider`).
- Selector/pill: nenhuma lógica nova (tabs vêm do catálogo). Atualizar testes que
  fixam contagens/rótulos globais:
  - `ModelPickerDialog.auth.test.tsx`: 3 → 4 abas + aba Anthropic;
  - `ModelPickerDialog.edge.test.tsx`: contagem de busca global (`'o'` casa por nome do
    provedor "Anthropic": 147 → 164) e nº de abas 3 → 4;
  - `ModelPill.test.tsx` / `ModelPill.edge.test.tsx`: rótulo
    `'Go + Zen + ChatGPT'` → `'Go + Zen + ChatGPT + Anthropic'` (só onde o rótulo é
    construído com todos os provedores).
- `src/lib/__tests__/modelMenu.test.ts` (Lead): busca global "opus" agora encontra Zen
  **e** Anthropic; adicionar testes do provedor Anthropic (tab/título, família,
  protocolo, preço exibido).

### 4.7 Documentação (Lead)

- `docs/MODELS.md`: linha na tabela de provedores + seção "Anthropic (API direta)"
  (headers, endpoints, modelos/preços, validação, sem OAuth/assinatura, limites).
- `docs/ARCHITECTURE.md`: tabelas §3 (provedores/autenticação/endpoints) e §7.
- `README.md`: lista de provedores.
- `docs/goals/anthropic-api-provider/EVIDENCE.md`: evidência de verificação.

## 5. Tarefas, donos e escopos de escrita

| # | Tarefa | Dono | Escopos (write) | Depende de |
| --- | --- | --- | --- | --- |
| T1 | Contrato de catálogo + entrada `anthropic` + build script + types | Lead | `src-tauri/src/catalog.rs`, `src/lib/types.ts`, `scripts/build-catalog.mjs`, `data/catalog.json` | — |
| T2 | Smoke test live ignorado + testes do adaptador Anthropic | provider-dev | `src-tauri/src/providers/**` | T1 |
| T3 | Harness propaga headers estáticos + testes | harness-dev | `src-tauri/src/harness/**` | T1 |
| T4 | `default_auth_env` + validação headers/copy + testes | storage-dev | `src-tauri/src/config.rs`, `src-tauri/src/commands/settings.rs` | T1 |
| T5 | Fetch/paginação/metadados de modelos + testes | Lead | `src-tauri/src/commands/models.rs` | T1 |
| T6 | Card Anthropic + testes de picker/pill | ui-systems | `src/components/**` | T1 |
| T7 | `modelMenu.test.ts` (busca global + provedor) | Lead | `src/lib/__tests__/modelMenu.test.ts` | T1 |
| T8 | Docs + verificação final | Lead | `docs/**`, `README.md` | T2–T7 |

Ordem de execução: **T1 primeiro** (contrato compila), depois T2/T3/T4/T5/T6 em
paralelo; T7/T8 no fim. O Lead revisa o diff completo e roda a verificação.

## 6. Plano de testes

### Rust (`cargo test --lib`)

- `catalog`: catálogo legado sem headers; provedor `anthropic` presente com
  `baseUrl`/endpoints/`headers`/`authEnv`/models (família `claude`, protocolo
  `anthropic`, custo, sem `estimated`); `static_headers()` ordenado.
- `providers`: body anthropic sem `temperature`; smoke live `#[ignore]` (chave real,
  não roda no CI); regressão de `extra_headers`.
- `harness`: `provider_config` propaga headers estáticos; Claude direto sem
  `temperature`; providers sem headers inalterados.
- `commands::models`: páginas OpenAI/Anthropic, cursor `after_id`, merge/metadados
  estimados, mensagens de credencial.
- `config`: `default_auth_env("anthropic")`.
- `commands::settings`: `models_endpoint` Anthropic, hint/copy, 401 sem mencionar
  ChatGPT para api-key.

### Renderer (`pnpm test`)

- `ProvidersTab`: card Anthropic (placeholder, console, salvar/testar, sem OAuth).
- `ModelPickerDialog`/`ModelPill`: 4 abas, contagens de busca global, rótulo dos
  provedores.
- `modelMenu`/`catalog`: provedor Anthropic, busca global por "opus", preço exibido.

### Verificação final

```bash
node scripts/build-catalog.mjs --provider anthropic
cd src-tauri && cargo check --lib
cd src-tauri && cargo test --lib
pnpm typecheck
pnpm test
pnpm build
```

Greps de kill criteria (devem voltar vazios em `src/` e `src-tauri/src/`):

```
claude\.ai|setup-token|CLAUDE_CODE_OAUTH_TOKEN|\.credentials\.json|
api\.anthropic\.com/api|app_EMoam|anthropic.*oauth
```

## 7. Critérios de aceite

1. `data/catalog.json` tem 4 provedores; `anthropic` correto (base/endpoints/headers/
   `authEnv`/default/modelos).
2. Com uma API key salva (ou `ANTHROPIC_API_KEY`), o app:
   - mostra o card Anthropic em Configurações → Provedores e salva/remove a chave;
   - "Testar conexão" retorna ok com a contagem de modelos do `/v1/models`;
   - a aba Anthropic aparece no seletor com os 14 modelos seed (família Claude,
     raciocínio, contexto/saída, preço);
   - um turno real faz `POST https://api.anthropic.com/v1/messages` com
     `Authorization: Bearer`, `anthropic-version`, `stream: true`, `max_tokens`,
     `system`, `tools` e streaming SSE funcionando (texto, raciocínio, tools, usage);
   - `Atualizar modelos` / `refresh_catalog` trazem a lista da conta (paginação
     `after_id`) e mesclam com o catálogo.
3. `cargo test --lib`, `pnpm test`, `pnpm typecheck`, `pnpm build` verdes.
4. Nenhum caminho de OAuth/assinatura da Anthropic introduzido (kill criteria).
5. Go/Zen/OpenAI: comportamento e testes inalterados (headers default = nenhum).

## 8. Riscos e mitigações

| Risco | Mitigação |
| --- | --- |
| Valor de `anthropic-version` rejeitado (400) | valor pinado da doc atual; é só JSON (`headers`) para trocar sem código; validação "Testar conexão" mostra o erro |
| `output_config.effort`/`thinking.adaptive` exigir beta header em alguma conta/modelo | campos já são o contrato estável documentado; se necessário, adicionar `anthropic-beta` no JSON do catálogo (sem código) — registrado como follow-up |
| Modelos novos só na conta | seed + `GET /v1/models` (paginação) mesclado com metadados dinâmicos; `estimated` marca o que não está no catálogo |
| Snapshots com data duplicando aliases | seed usa só IDs dateless; snapshots que a conta listar aparecem como `estimated` |
| Sem API key no ambiente de desenvolvimento | testes 100% offline; smoke real `#[ignore]` documentado para execução manual com chave |
| Mudanças em Go/Zen/OpenAI | defaults do contrato (`headers` vazio, Bearer) cobertos por teste de catálogo legado e testes existentes |
| Testes de UI que fixam contagens (abas/busca) | atualização explícita listada em T6/T7, com contagem recalculada |

## 9. Fora de escopo (follow-ups)

- Prompt caching (`cache_control`) e beta headers de 1M/contexto — economia, não
  funcionalidade.
- OAuth/assinatura Claude (proibido para terceiros sem aprovação).
- Bedrock/Vertex/Foundry (`x-api-key`/SigV4/IAM) — caminhos de nuvem distintos.
- `thinking.display` explícito, contagem de tokens, batches.
- Presets/temperature para Anthropic (parâmetro removido na API 2026-10-21).

## 10. Rollback

Reverter os commits da entrega remove o provedor do catálogo (nada persistido em DB
depende dele; conversas guardam `providerId` como texto). Chaves salvas em
`secrets.json` ficam órfãs e inofensivas; `reset_app_data` as apaga.
