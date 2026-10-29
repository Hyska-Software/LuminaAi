# Modelos & Provedores

Provedores suportados: **OpenCode Go** (assinatura), **OpenCode Zen** (pay-as-you-go
do OpenCode Console), **OpenAI** (plano ChatGPT via "Sign in with ChatGPT" ou API
key da plataforma) e **Anthropic** (API oficial, API key). Go/Zen expõem o mesmo
gateway com bases diferentes:

| Provedor | Base URL | Autenticação |
| --- | --- | --- |
| OpenCode Go | `https://opencode.ai/inference/go` | API key do Console com assinatura Go/Go Plus |
| OpenCode Zen | `https://opencode.ai/inference` | API key do Console com créditos |
| OpenAI | `https://api.openai.com/v1` | OAuth "Sign in with ChatGPT" (plano) **ou** API key `sk-…` |
| Anthropic | `https://api.anthropic.com/v1` | API key `sk-ant-…` do Claude Console (pay-as-you-go) |

Headers obrigatórios/recomendados (Go/Zen):

```
Authorization: Bearer <OPENCODE_API_KEY>
Content-Type: application/json
User-Agent: Lumina/<versão>
x-opencode-session: <id estável da conversa>
```

`x-opencode-session` é enviado **somente** para provedores OpenCode; o provedor
OpenAI não recebe headers internos do ChatGPT/Codex. Headers estáticos de um
provedor (sem credencial) ficam em `ProviderInfo.headers` no catálogo e são
enviados em toda requisição (inferência, listagem de modelos e validação).

## OpenAI — "ChatGPT plan usage" (Sign in with ChatGPT)

Caminho oficial para apps open-source/locais
(`https://developers.openai.com/siwc/token-sharing-open-source/`). O app é um
public client: registro dinâmico (`client_id=dynamic_agent_client`) + host id
estável (`ext_agent_host_id`), PKCE S256, `state` e `nonce`.

| Item | Valor |
| --- | --- |
| Authorize | `https://auth.openai.com/api/accounts/authorize` |
| Token/refresh/revoke | `https://auth.openai.com/api/accounts/oauth/{token,revoke}` (form) |
| Discovery/JWKS | `https://auth.openai.com/.well-known/openid-configuration`, `…/jwks.json` |
| Escopos | `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` |
| `resource` | `https://api.openai.com/v1` |
| Callback | `http://127.0.0.1:<porta>/auth/callback` (só a porta varia) |
| Inferência | `POST https://api.openai.com/v1/responses` |
| Modelos | `GET https://api.openai.com/v1/models` (lista por conta, `visibility:"list"`) |

Ciclo de vida: access token de 1 h; refresh token de 30 dias **rotativo** (refresh
single-flight, persistido de forma atômica). O ID token é verificado por JWKS
(iss/aud/exp/nonce) e o `sub` é a identidade; em reautorização o `sub` e o
`client_id` precisam bater com o registro salvo. Sign-out revoga o refresh token
(mantendo o mapping conta/`client_id` para o próximo login). Nada de token cruza
o IPC; o renderer recebe apenas e-mail, ids mascarados, escopos e expiração.

Perfil de request do plano (`RequestProfile::ChatgptPlan`): `store:false`,
`stream:true`, system prompt via `instructions`, sem `max_output_tokens`,
`temperature`, `top_p`, `metadata`, `previous_response_id`, etc.; tools do Lumina
são function tools do cliente; `include:["reasoning.encrypted_content"]` permite
replay de raciocínio. O perfil `Standard` (API key) mantém o body completo.

Erros de plano vêm em `error.code` (`subscription_sharing_usage_limit_exceeded`,
`…_user_not_eligible`, `…_unsupported_capability`, …) e são mapeados para
`TurnEvent::Error.code`/`hint`, com CTA "Gerenciar uso"
(`https://chatgpt.com/settings/usage`). Limite de 5 h é compartilhado entre apps
(Plus); Pro não tem essa janela; limites específicos do app também podem valer —
por isso a UI nunca inventa percentual/reset.

> Não usar o OAuth/backend interno do Codex CLI (`chatgpt.com/backend-api`): não é
> documentado para terceiros e contraria a doc oficial/ToS. Ver
> `docs/research/openai-oauth.md`.

## Anthropic — API oficial direta (API key)

Caminho suportado para apps de terceiros. **Não** há OAuth de assinatura: o
login do Claude Code é interno da Anthropic e a doc do Agent SDK proíbe oferecer
login claude.ai/limites do plano em apps de terceiros sem aprovação prévia. O
Lumina usa a API oficial cobrada por token na conta do usuário:

| Item | Valor |
| --- | --- |
| Base URL | `https://api.anthropic.com/v1` |
| Messages | `POST /v1/messages` (SSE com `stream: true`) |
| Modelos | `GET /v1/models` (lista da conta; paginação `after_id`/`has_more`/`last_id`) |
| Auth | `Authorization: Bearer <ANTHROPIC_API_KEY>` (`x-api-key` é fallback legado da Anthropic, não usado) |
| Versão | `anthropic-version: 2026-10-21` (obrigatório; header estático do catálogo) |
| Chave | `ANTHROPIC_API_KEY` (env) ou colada em Configurações → Provedores (`sk-ant-…`) |
| Console | `https://platform.claude.com/settings/keys` |

Configuração no catálogo (`data/catalog.json`, provider `anthropic`):
`endpoints: { "anthropic": "/messages", "models": "/models" }`, `auth` implícito
`api-key` (perfil `standard`) e `headers: { "anthropic-version": "2026-10-21" }`.
O mesmo header vale para inferência, listagem e "Testar conexão"; trocar de
versão é só editar o JSON (sem recompilar). **Ao salvar a API key, o app busca a
lista da conta automaticamente** (`refresh_provider_models` → `GET /v1/models`),
então os modelos e metadados da conta aparecem no seletor sem ação manual; o
catálogo embutido continua disponível como fallback offline. "Testar conexão"
apenas valida a credencial; a ação "Atualizar catálogo" (paleta de comandos)
repete a busca para todos os provedores configurados.

Seed de modelos (IDs dateless da geração 4.6+, linha Claude): Fable 5/5.1,
Opus 4.5–5.5, Sonnet 4.5–5.5, Haiku 4.5/5.5. Preços e limites vêm do models.dev
(ex.: Sonnet 5.5 a $2/$10 por MTok, contexto 1M). Snapshots com data
(`claude-…-20251001`) não entram no seed: quando a conta os lista, aparecem como
`estimated` com capacidades lidas de `/v1/models` (`max_input_tokens`,
`max_tokens`, `capabilities.effort/thinking/image_input/pdf_input`). Modelos
`retired` são filtrados; `deprecated` continuam listados.

Comportamento de request: o perfil é `standard`, sem headers beta. `temperature`
não é enviado para a família Claude (o harness já a omite; a API 2026-10-21
removeu o parâmetro). Raciocínio segue a tabela do protocolo `anthropic` abaixo
(`adaptive` + `output_config.effort` para modelos com esforço; `enabled` +
`budget_tokens` ≥1024 para os que só têm orçamento).

## Cache de prompt

O cache é medido por request de wire e exibido em tempo real no medidor de
contexto (Code: anel de contexto + selo `cache NN%`; Chat: chip cache-first no
composer). A definição é `cache_read / (cache_read + cache_write + uncached)` a
partir do `usage` reportado pelo provedor; sem reporte, mostra `—`. O plano
completo (fases, SLO 98–99%, diagnóstico e evidência) está em
**`docs/goals/prompt-cache/PLAN.md`**; a pesquisa por provedor (mínimos, TTL,
breakpoints, OpenCode e DeepSeek Harness) em
**`docs/research/prompt-caching.md`**.

| Protocolo | Mecanismo | Implementação no Lumina |
| --- | --- | --- |
| `anthropic` | explícito (`cache_control` em tools/system/messages, até 4 breakpoints, TTL 5m/1h) | `system` em blocos + 3 breakpoints e TTL 1h (`Settings.cache.anthropicTtl`); leitura de `cache_creation_input_tokens` |
| `openai-responses` / `openai-chat` | automático por prefixo + `prompt_cache_key` (≤64), retenção/TTL | chave hash estável por conversa/rota/modelo/versão do prompt; retenção quando a rota suporta (perfil ChatGPT-plan só após probe) |
| gateways OpenCode | roteamento/cache por `x-opencode-session` + bloco `usage.opencode.tokens` | session id estável por conversa; leitura de `cache_read`/`cache_write_5m`/`cache_write_1h` |
| `google` | implícito (e explicit só se suportado) | prefixo estável, leitura de `cachedContentTokenCount`, classe “política do provedor” para a regra dos 2.050 tokens do Gemini 4 |
| híbridos via openai-chat | automático; DeepSeek em disco | leitura de `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` |

## Protocolos por modelo (Go — verificado em 2026-10-23)

| Modelo | Protocolo primário | Alternativos |
| --- | --- | --- |
| deepseek-v4.1-flash, deepseek-v4-pro | openai-chat | — |
| glm-5.1 / 5.2 / 5.3 / 5.3-flash | openai-chat | — |
| kimi-k2.6, kimi-k2.7-code | openai-chat | — |
| kimi-k3, kimi-k3.1-pro | anthropic | openai-chat |
| minimax-m2.5 / m2.7 / m3 / m3.1-flash | anthropic | openai-chat |
| qwen3.6-plus, qwen3.7-max, qwen3.7-plus, qwen3.8-max, qwen3.8-flash | openai-chat | — (qwen3.8-max também aceita anthropic) |
| mimo-v2.5, mimo-v2.6-flash, mimo-v2.6-pro | openai-chat | — |
| longcat-2.0, step-5-preview, hy3, hy4-preview, omen-alpha, beam-free | openai-chat | — |
| gpt-5.6-luna, gpt-6-luna | openai-responses | — |
| grok-4.6, grok-4.7, muse-spark-1.2/1.3-contributor | openai-responses | — |
| claude-haiku-5-5 | anthropic | — |
| gemini-4-argon-contributor | google | — |
| mimo-v2.5-pro | — | indisponível no gateway ("Unsupported model") |

O catálogo (`data/catalog.json`) é gerado com esses dados; modelos novos entram por heurística de família até nova sondagem.

## Modo de pensamento

A UI exibe controles apenas se `reasoningOptions` do modelo contiver `toggle`, `effort` ou `budget_tokens`.

### openai-chat
| Ação | Parâmetro | Observações |
| --- | --- | --- |
| esforço | `reasoning_effort: "low" \| "high" \| "max"` | GLM, DeepSeek, Qwen, Kimi aceitam |
| desligar | `thinking: {"type":"disabled"}` | GLM 5.x é thinking-only → 400; adaptador reenvia sem parâmetro |
| ligar (toggle) | `thinking: {"type":"enabled"}` | Kimi aceita, mas reasoning não é exposto no stream |

### openai-responses
| Ação | Parâmetro |
| --- | --- |
| esforço | `reasoning: { "effort": "low"…"max", "summary": "detailed" }` |
| desligar | `reasoning: { "effort": "none" }` (somente modelos que listam `none`) |

`summary: "detailed"` é necessário para GPT/Grok/Muse exporem texto de raciocínio; com `auto` o GPT costuma devolver summary vazio (apenas `encrypted_content`).

### anthropic
| Ação | Parâmetro | Observações |
| --- | --- | --- |
| esforço | `thinking: {"type":"adaptive"}` + `output_config: {"effort":"high"}` | Claude 5.x **recusa** `thinking.type=enabled` |
| desligar | `thinking: {"type":"disabled"}` | |
| orçamento | `thinking: {"type":"enabled","budget_tokens": N}` | Claude 5.x rejeita; usar só em modelos que listam budget |

Kimi/MiniMax/Qwen no protocolo Anthropic retornam blocos `thinking` (capturados via `provider_state` e stream `signature_delta`).

### google
| Ação | Parâmetro |
| --- | --- |
| esforço | `generationConfig.thinkingConfig` com `thinkingLevel` |
| desligar | `thinkingBudget: 0` |

O gateway não expõe thought parts separados para o Gemini 4 Argon; o raciocínio aparece no próprio texto. A UI não mostra bloco de raciocínio para esse modelo.

## Streaming (formatos observados)

- `openai-chat`: `data: {choices:[{delta:{content, reasoning_content, tool_calls}}]}` + chunk final com `usage` + `data: [DONE]`.
- `openai-responses`: eventos SSE nomeados; `response.output_text.delta`, `response.reasoning_summary_text.delta`, `response.function_call_arguments.delta`, `response.completed` (contém `response.output` completo → usado como `provider_state`).
- `anthropic`: `message_start`, `content_block_start/delta/stop` (`text_delta`, `thinking_delta`, `signature_delta`, `input_json_delta`), `message_delta` (usage + stop_reason), `message_stop`.
- `google`: `:streamGenerateContent?alt=sse`; chunks com `candidates[0].content.parts` (`text`, `functionCall` com `args` já em objeto, `thoughtSignature`).

## Usage

- chat: `usage.completion_tokens_details.reasoning_tokens`.
- anthropic: `usage.output_tokens_details.thinking_tokens`.
- responses: usage em `response.completed.response.usage` (inclui `output_tokens_details.reasoning_tokens`).
- google: `usageMetadata.candidatesTokenCount` / `thoughtsTokenCount`.

## Limites & privacidade

- Go: limites mensais por modelo; free models (`longcat-2.5-preview-free`, `beam-free`, …) com restrições regionais.
- Modelos "contributor" (Gemini 4 Argon, Muse Spark Contributor) podem treinar com os dados.
- Chaves são armazenadas localmente no app (`secrets.json`); também é possível detectar a chave já existente do OpenCode CLI (`~/.local/share/opencode/auth.json`) e de `OPENCODE_API_KEY`.

## Regenerar o catálogo

```bash
node scripts/collect-research.mjs   # baixa docs + models.dev (opcional)
node scripts/probe-models.mjs       # sonda protocolos com a chave local (opcional)
node scripts/build-catalog.mjs      # gera data/catalog.json
node scripts/build-catalog.mjs --provider anthropic   # atualiza só o provedor Anthropic
```

Sempre que o gateway/provedor adicionar modelos, o app continua funcionando: a UI
mostra os modelos do catálogo embutido e `refresh_catalog`/`refresh_provider_models`
consultam a lista viva (`/v1/models`) para sinalizar novidades e mesclar a lista
da conta.
