# OpenAI ChatGPT plan usage — evidência de aceitação

> Dados sensíveis (tokens, e-mail, ids de conta) devem ser redigidos antes de
> colar aqui. Nunca colar access/refresh/id token.

## Acceptance Evidence

### Primeiro teste real (2026-10-26) — achado e correção

O usuário executou o app e tentou "Continuar com ChatGPT". O fluxo **chegou até
o token endpoint**: autorização no navegador + callback loopback + troca de code
funcionaram, e a OpenAI respondeu HTTP 200. O login falhou no **parse da
resposta**: `resposta inválida do token endpoint: invalid type: integer
1793045353, expected a string` — a OpenAI devolve `earliest_refresh_at` como
timestamp Unix (número), e o `TokenResponse` exigia string.

Correção aplicada em `oauth/siwc.rs`: decodificação tolerante para
`earliest_refresh_at` (string **ou** número), `expires_in` (número **ou** string
numérica) e `scope` (string **ou** array), com 3 testes de regressão
(`token_response_accepts_integer_earliest_refresh_at`,
`..._tolerates_string_expires_in_and_scope_array`,
`..._rejects_bad_expires_in_instead_of_panicking`). O restante do fluxo (JWKS,
ID token, persistência) ainda precisa ser confirmado no retry.

### Fase 0 — Spike SIWC (gate) — **implementado, não executado nesta sessão**

O script do gate está pronto: `scripts/openai-plan-probe.mjs` (loopback local,
PKCE/state/nonce, troca de code, e as sondagens G1–G5b). Ele exige um login
interativo com uma conta ChatGPT real, que não é executável neste ambiente
automatizado. **Nenhuma evidência de runtime real foi capturada ainda**; a
feature foi implementada contra a documentação oficial e validada por testes
automatizados com servidores fake (OAuth, JWKS, token endpoint, HTTP).

Para fechar o gate (manual, ~5 min):

```
node scripts/openai-plan-probe.mjs --model gpt-6.1-sol
```

- [ ] G1: registro dinâmico emite `client_id` (`oaiapp_…`) para este app
- [ ] G2: shape de `GET /v1/models` (colar JSON redigido com
      `models[].slug/display_name/visibility`)
- [ ] G3: `POST /v1/responses` (`store:false`/`stream:true`) conclui com
      `response.completed`
- [ ] G4: function tool do cliente aceita (flat / namespace / `additional_tools`)
- [ ] G4b: `include:["reasoning.encrypted_content"]` aceito? (se não, virar
      `CHATGPT_PLAN_INCLUDE_REASONING = false` em
      `providers/openai_responses.rs`; fallback documentado)
- [ ] G5a: scope `chatgpt.tokens.use.direct` concedido
- [ ] G5b (informativo): shape de 429 `subscription_sharing_usage_limit_exceeded`
- Decisão do gate: pendente da execução manual acima.

### Implementação (nesta sessão) — código e testes

- [x] Catálogo: provedor `openai` (auth oauth, endpoints `/responses`+`/models`,
      `requestProfiles {oauth:"chatgpt-plan", apiKey:"standard"}`, 27 modelos
      seed, família `gpt`); `scripts/build-catalog.mjs --provider openai` faz
      diff cirúrgico (Go/Zen byte-idênticos).
- [x] OAuth oficial SIWC: PKCE S256 + state/nonce (CSPRNG), discovery com
      fallback, authorize URL com todos os params, loopback `127.0.0.1:<porta>`/
      `/auth/callback`, troca de code, refresh rotativo single-flight, revoke com
      backoff, ID token verificado por JWKS (iss/aud/exp/nonce), `sub` como
      identidade e match em reautorização.
- [x] Store v2 (`secrets.json`): único writer (`config.rs`), RMW serializado,
      tmp único, 0600, corrupção preservada + `.bak` + `secretsError`; mapping
      conta/`client_id` retido no sign-out; reset com `reset_credentials_with`
      (cancel sob o lock) + epoch guard no refresh.
- [x] IPC: `openai_login_start/wait(async)/cancel`, `openai_sign_out`,
      `openai_auth_status`, `refresh_provider_models`; registro em `lib.rs`
      provado por teste (`include_str!("lib.rs")`); `LoginChallenge`,
      `ProviderAuthStatus`; nenhum token no IPC.
- [x] Wire layer: endpoints do catálogo (constantes de caminho removidas),
      `x-opencode-session` só OpenCode, perfis `Standard`/`ChatgptPlan`
      (whitelist, `store:false`, `stream:true`, `instructions`, sem
      `max_output_tokens`/`temperature`/`previous_response_id`), erros
      estruturados `subscription_sharing_*`.
- [x] Harness: credencial OAuth/API key resolvida antes de persistir a mensagem,
      401→refresh→retry 1×, `code`/`hint` no `TurnEvent::Error` (raw code
      quando existir), `ModelSource` (conta → catálogo), validação de
      `CredentialError` pré-turno no comando (`TurnEvent::Error` emitido).
- [x] Modelos dinâmicos: `GET /v1/models` (parser dual), merge no
      `CatalogView`/`AppState`, cache `models-cache.json` (restaurado no boot),
      `estimated` para slug só-da-conta.
- [x] UI: card de conta ChatGPT (estados), modal único de primeiro login,
      "Gerenciar uso", selo "Plano ChatGPT", banner de limite/credencial,
      gate de envio, model picker com provedor OpenAI, favoritos por par,
      copy atualizado.
- [x] Single-instance (`tauri-plugin-single-instance`) para não corromper refresh
      rotativo entre instâncias.

### Fluxo do usuário (runtime real) — pendente de conta

- [ ] Login "Continuar com ChatGPT" conclui; conta aparece em Provedores
- [ ] Modelos da conta aparecem no seletor; seleção persiste após reiniciar
- [ ] Turno com busca na web + citação + raciocínio + artefato conclui
- [ ] Sair revoga o refresh token e mantém o mapping (novo login reusa `client_id`)
- [ ] Login com outra conta no navegador é rejeitado (identidade divergente)
- [ ] API key alternativa funciona no mesmo provedor (perfil `standard`)
- [ ] Segunda instância foca a primeira

### Não-regressão

- [x] Go/Zen: chave por secrets/env/CLI, `x-opencode-session`, caminhos e bodies
      (suíte completa `cargo test --lib` verde)
- [x] Google: placeholder `{model}` + `:streamGenerateContent` coberto por teste
- [x] `reset_app_data` apaga credenciais/cache e mantém settings

## Verification

### Comandos (resultados desta sessão)

```
pnpm typecheck        # exit 0, 0 erros
pnpm test             # 67 arquivos / 1336 testes passed
pnpm build            # ✓ built in 8.85s (dist/)
cargo check --lib     # Finished (12 warnings de API pública preparada/dead_code)
cargo test --lib      # 406 passed, 0 failed, 9 ignored
node scripts/build-catalog.mjs --provider openai  # ok, diff cirúrgico (+1529/−2)
```

Contagens finais:
- Rust: `cargo test --lib` → **406 passed / 0 failed / 9 ignored** (inclui
  `oauth::*` 4+6+8+4, `config::*` 26, `commands::settings` 10,
  `providers` 31, `harness` 60, `catalog` 4, `commands::oauth` registro).
- Renderer: `pnpm test` → **1336 passed** em **67 arquivos**; o novo
  `appStore.test.ts` (7) e `ProvidersTab.test.tsx` (10),
  `ModelPickerDialog.auth.test.tsx` (10), `TurnErrorBanner` (8),
  `PlanUsageChip` (7), `Composer`/`ChatView` (14), `turnError` (11),
  `WelcomeScreen` (2) estão incluídos.
- Typecheck/build: `pnpm typecheck` e `pnpm build` passam.

### Testes que provam cada critério

| Critério | Teste |
| --- | --- |
| PKCE/state/nonce | `oauth::pkce::tests` (vetor RFC 7636) |
| Authorize URL/discovery | `oauth::siwc::tests::authorize_url_*`, `discovery_fallback_*` |
| Callback loopback | `oauth::loopback::tests` (TCP real, 404/favicon, cancel, XSS) |
| Validação de callback | `oauth::tests::validate_callback_*` |
| Troca de code/refresh/revoke | `oauth::siwc::tests::exchange_code_*`, `refresh_*`, `revoke_*` |
| ID token/JWKS | `oauth::jwt::tests` (fixture RSA, exp/aud/nonce/assinatura) |
| Status/masking/sem token | `oauth::tests::signed_in_*`, `domain::tests::auth_status_never_serializes_tokens` |
| Store v2 | `config::tests` (26) — migração, RMW, tmp, corrupção, host id, reset |
| Perfis de request | `providers::openai_responses::tests` (snapshot standard/plan) |
| Endpoints do catálogo | `providers::tests::endpoint_for_*`, Google 9 modelos |
| Erros estruturados | `providers::tests` matriz 400/401/403/429/503 |
| Harness credencial/retry | `harness::tests` (10 novos: 401→refresh→retry, raw code, sem credencial) |
| Modelos dinâmicos | `commands::models::tests` (parser dual, merge, estimated) + `state` cache |
| IPC registrado/async | `commands::oauth::tests::auth_commands_are_registered` |
| UI conta/limite/gate | `ProvidersTab.test.tsx`, `ModelPickerDialog*.test.tsx`, `TurnErrorBanner.test.tsx`, `Composer.test.tsx`, `PlanUsageChip.test.tsx`, `appStore.test.ts` |

### Kill criteria (grep — saídas desta sessão)

```
# produção (src-tauri/src): zero ocorrências
backend-api|app_EMoamEEZ73f0CkXaXp7hrann|api.connectors.
→ (nenhuma)
# (exceção documentada: teste NEGATIVO em providers/mod.rs:1803-1806 que ASSERTA
#  ausência de originator/chatgpt-account-id/openai-beta/x-codex-turn-metadata)

# constantes de caminho
CHAT_PATH|RESPONSES_PATH|ANTHROPIC_PATH|GOOGLE_MODELS_PATH em src-tauri/src/providers
→ (nenhuma)

# writer único do arquivo de segredos
write_private|secrets.json em src-tauri/src
→ config.rs (único writer)

# tokens no renderer (arquivos não-teste)
access_token|refresh_token|id_token em src/
→ (nenhuma; apenas teste negativo em ProvidersTab.test.tsx)

# nenhum todo!/unimplemented! na área nova
→ (nenhuma)
```

### Single-instance (`%APPDATA%\app.lumina.chat`)

- [x] `tauri-plugin-single-instance` registrado antes dos demais plugins; segunda
      instância foca a janela (teste manual pendente; comportamento do plugin).

## Review Notes

- PRE review: `REVIEW.md` (5 blockers, 18 should-fix) — disposição em
  `REVIEW-RESPONSE.md`; re-revisão incremental no fim de `REVIEW.md`. Bloqueadores
  de execução RB1/RB2 e N1–N8 aplicados antes da implementação.
- Reviewer / data: 2026-10-26.
- Achados que mudaram o resultado: store único (config), epoch guard no refresh,
  raw `error.code` no IPC, card de conta com mapping retido no sign-out.
- Pendências aceitas:
  1. **Fase 0 (login real + inferência real) não executada** — requer conta
     ChatGPT interativa; script pronto em `scripts/openai-plan-probe.mjs`.
     QA manual documentado como "implementado, não provado".
  2. `include:["reasoning.encrypted_content"]` é hipótese de contrato ga­teada por
     G4b; se a rota rejeitar, virar a constante em `openai_responses.rs`.
  3. Caminho OAuth real com `AppHandle` não é unit-testável sem runtime Tauri;
     coberto por overrides de teste + testes de `oauth::*` + wiring do comando.
