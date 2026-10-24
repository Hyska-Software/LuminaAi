# Modelos & Provedores

Os únicos provedores suportados são **OpenCode Go** (assinatura) e **OpenCode Zen** (pay-as-you-go do OpenCode Console). Ambos expõem o mesmo gateway com bases diferentes:

| Provedor | Base URL | Chave |
| --- | --- | --- |
| OpenCode Go | `https://opencode.ai/inference/go` | API key do Console com assinatura Go/Go Plus |
| OpenCode Zen | `https://opencode.ai/inference` | API key do Console com créditos |

Headers obrigatórios/recomendados:

```
Authorization: Bearer <OPENCODE_API_KEY>
Content-Type: application/json
User-Agent: Lumina/<versão>
x-opencode-session: <id estável da conversa>
```

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
```

Sempre que o gateway adicionar modelos, o app continua funcionando: a UI mostra os modelos do catálogo embutido e `refresh_catalog` consulta a lista viva (`/v1/models`) para sinalizar novidades.
