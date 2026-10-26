# Pesquisa: OAuth da OpenAI (Codex / ChatGPT) + contrato da Responses API

> **Status**: pesquisa concluída em **2026-10-26** (horário local). Todas as URLs abaixo foram
> abertas nessa data. O repositório `openai/codex` é um alvo em movimento: caminhos, constantes e
> `client_id` mudam com frequência — o plano de implementação **não pode** tratá-los como
> contrato estável.
>
> **Método**: `web_search` estava indisponível nesta sessão (sem API key de search), então toda a
> evidência veio de `web_fetch` diretamente em fontes primárias: código-fonte do `openai/codex`
> (branch `main`), documentação oficial em `developers.openai.com` / `learn.chatgpt.com`,
> `auth.openai.com/.well-known/openid-configuration` e políticas da OpenAI.
>
> **Convenção de confiança usada neste documento**:
> - ✅ **CONFIRMADO NO CÓDIGO** — string/enum literal extraído do código-fonte do `openai/codex`.
> - 📄 **DOCUMENTADO** — afirmação presente em documentação oficial da OpenAI.
> - ⚠️ **NÃO VERIFICADO** — plausível, mas não encontrado numa fonte primária nesta pesquisa.
> - 🧪 **ASSUNÇÃO** — inferência explícita, precisa ser validada em runtime antes de virar código.

---

## 0. Resumo executivo (o que o plano precisa saber primeiro)

Existem **três caminhos distintos**, e misturá-los é o maior risco técnico/legal do projeto:

| # | Caminho | Quem usa | Base URL | Status para um app terceiro |
|---|---|---|---|---|
| **A** | **Sign in with ChatGPT — ChatGPT plan usage para OSS/locais** (dynamic client registration) | Apps open-source/locais aprovados (OpenCode, Pi, T3, OpenClaw…) | `https://auth.openai.com/api/accounts/*` + `https://api.openai.com/v1` | ✅ **Documentado e suportado pela OpenAI** para apps OSS/locais ([overview](https://developers.openai.com/siwc/token-sharing-open-source.md)) |
| **B** | **Login do Codex CLI** (OAuth "Hydra" interno + backend proprietário) | Codex CLI / ChatGPT desktop / IDE extension | `https://auth.openai.com/oauth/*` + `https://chatgpt.com/backend-api/codex` | ❌ **Não documentado para terceiros**; client_id e endpoints são internos do Codex. Reutilizar esse client_id não é sancionado ([código](https://github.com/openai/codex/tree/main/codex-rs/login/src)) |
| **C** | **API key oficial** | Qualquer app | `https://api.openai.com/v1` | ✅ **Documentado** ([quickstart](https://developers.openai.com/api/docs/quickstart.md)) |

**Recomendação para o plano**: projetar a feature para o caminho **A** como "ChatGPT plan usage"
suportado e o caminho **C** como API key; o caminho **B** pode existir como *import/experimental*
(ou nem existir), porque a própria doc do caminho A proíbe explicitamente usar `backend-api` para
esse fluxo:

> "**Supported endpoint:** Use the public Responses API endpoint above for this ChatGPT plan usage
> flow; **do not point it at ChatGPT's `backend-api` endpoints**."
> — [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference.md)

Ponto crítico de arquitetura: **os dois fluxos OAuth usam endpoints diferentes no mesmo issuer**:

| Constante | Caminho A (documentado) | Caminho B (Codex CLI) |
|---|---|---|
| Authorize | `https://auth.openai.com/api/accounts/authorize` | `https://auth.openai.com/oauth/authorize` |
| Token | `https://auth.openai.com/api/accounts/oauth/token` | `https://auth.openai.com/oauth/token` |
| Revoke | `https://auth.openai.com/api/accounts/oauth/revoke` | `https://auth.openai.com/oauth/revoke` |
| API de inferência | `https://api.openai.com/v1/responses` | `https://chatgpt.com/backend-api/codex/responses` |

Fontes: discovery document ([CONFIRMADO](https://auth.openai.com/.well-known/openid-configuration)),
caminho A ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md)),
caminho B ([CONFIRMADO](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs)
e [aqui](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs)).

---

## 1. Caminho A — OAuth 2.0 PKCE "Sign in with ChatGPT" para ChatGPT plan usage (oficial)

### 1.1 O que é

É uma capacidade opcional do Sign in with ChatGPT: além dos escopos de identidade, o app
open-source/local pede permissão para usar o plano ChatGPT do usuário em requisições elegíveis da
Responses API. Não dá acesso a conversas nem a contexto da conta
([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source.md)).

> "These docs explain ChatGPT plan usage for **open-source and locally hosted apps**. If you're
> interested in offering it in a paid or remotely hosted app, complete the interest form."
> — [Overview](https://developers.openai.com/siwc/token-sharing-open-source.md)

Também existe um fluxo separado "On your website" para parceiros comerciais, que **não** é esse:
a página de website diz que o SIWC está "available to selected commercial partners through a limited
trial" e manda pedir client ID ([website.md](https://developers.openai.com/siwc/website.md),
[request-client-id.md](https://developers.openai.com/siwc/request-client-id.md)). Já a lista de
integrações open-source inclui **OpenCode**, Pi, T3 e OpenClaw
([DOCUMENTADO](https://learn.chatgpt.com/docs/sign-in-with-chatgpt.md)).

### 1.2 Registration, `client_id` dinâmico e host id

- Primeiro login: `client_id=dynamic_agent_client` (é **entrypoint de registro**, não um client_id
  para salvar), `agent_name_hint=<nome do app>` e `ext_agent_host_id=<id estável do host>`.
  O callback devolve o **`client_id` emitido** (formato `oaiapp_...`), que deve ser salvo e
  reutilizado nos logins seguintes daquela conta/workspace
  ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md)).
- O `client_id` emitido fica **bound ao usuário autenticado e ao workspace** escolhido no registro;
  cada host precisa de um `ext_agent_host_id` distinto (recomendado
  `urn:ietf:params:oauth:jwk-thumbprint:…`; `urn:uuid:…` também é aceito)
  ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source.md)).
- Não há client secret; é public client (`token_endpoint_auth_methods_supported` inclui `none`)
  ([CONFIRMADO](https://auth.openai.com/.well-known/openid-configuration)).
- `agent_name_hint` só vai no registro inicial; omitir na reautorização
  ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md)).

### 1.3 Authorize endpoint + parâmetros exatos

Endpoint: `https://auth.openai.com/api/accounts/authorize`
([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md) e
[discovery](https://auth.openai.com/.well-known/openid-configuration)).

| Parâmetro | Valor / obrigatoriedade | Notas |
|---|---|---|
| `client_id` | `dynamic_agent_client` no 1º registro; `client_id` emitido depois | reuse por conta |
| `agent_name_hint` | nome real do app, só no registro inicial | metadata de exibição |
| `ext_agent_host_id` | **obrigatório** | distinto por host |
| `id_token_hint` | opcional, em reautorização | ID token antigo; pode estar expirado (identifica conta) |
| `login_hint` | opcional | email salvo do ID token validado |
| `response_type` | `code` | |
| `redirect_uri` | `http://127.0.0.1:<porta>/auth/callback` | loopback em `127.0.0.1`; **só a porta pode variar**; não usar `localhost`; path exato |
| `scope` | `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` | |
| `resource` | `https://api.openai.com/v1` | |
| `state` | aleatório, novo a cada tentativa | validar no callback |
| `nonce` | aleatório, novo a cada tentativa | validação do ID token |
| `code_challenge_method` | `S256` | |
| `code_challenge` | base64url(SHA-256(verifier)) sem padding | |

Fonte: [sign-in.md](https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md)
(tabela de parâmetros). O discovery document confirma apenas `response_type=code`,
`code_challenge_methods_supported=[S256]`, `response_mode=query`, grants
`authorization_code`/`refresh_token`
([CONFIRMADO](https://auth.openai.com/.well-known/openid-configuration)).

**Callback esperado** (novo registro):

```
http://127.0.0.1:<porta>/auth/callback
  ?code=<AUTHORIZATION_CODE>
  &scope=chatgpt.tokens.use.direct+email+offline_access+openid+profile+resource.invoke
  &state=<ORIGINAL_STATE>
  &client_id=<ISSUED_CLIENT_ID>
```

O `client_id` emitido **pode faltar** na reautorização (aí mantém o client_id salvo); se vier um
client_id diferente, rejeitar. `error=access_denied` → validar `state`, parar, não trocar code
([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md)).

### 1.4 Token exchange, resposta e ciclo de vida

- `POST https://auth.openai.com/api/accounts/oauth/token`, `application/x-www-form-urlencoded`,
  public client (sem secret): `grant_type=authorization_code`, `client_id`, `code`,
  `code_verifier`, mesmo `redirect_uri`, mesmo `resource`
  ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md)).
- Resposta do token: `access_token`, `refresh_token`, `id_token`, `token_type`, `expires_in`,
  `scope`, **`earliest_refresh_at`**; HTTP 200 no sucesso
  ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/token-reference.md)).
- **Access token: 1 hora (`expires_in: 3600`)**. **Refresh token: 30 dias**, rotativo — cada refresh
  devolve um refresh token novo com mais 30 dias, sem limite fixo de renovações
  ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/token-reference.md)).
- Refresh: `POST` no mesmo token endpoint, form-urlencoded, com `grant_type=refresh_token`,
  `client_id` **emitido** (nunca `dynamic_agent_client`), `refresh_token`,
  `resource=https://api.openai.com/v1`; omitir `scope` para manter o grant. Serializar refreshes por
  sessão para não correr com o token rotativo
  ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions.md#refreshing-tokens)).
- Revogação: `POST` form-urlencoded no `revocation_endpoint` do discovery
  (`https://auth.openai.com/api/accounts/oauth/revoke`) com `token=<refresh_token>`,
  `token_type_hint=refresh_token` e `client_id` emitido; HTTP 200 vazio = sucesso
  ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions.md#end-the-renewable-session)).
- Claims do access token: `sub`, `aud` = `https://api.openai.com/v1`, `client_id`, `scope`,
  `https://api.openai.com/auth` (`per_user_salt`, `encrypted_auth_metadata`), `iss` =
  `https://auth.openai.com`, `iat`, `exp`, `jti`, `nbf`. **Tratar o metadata como opaco**
  ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/token-reference.md)).
- Validação do ID token: assinatura via JWKS (`https://auth.openai.com/.well-known/jwks.json`),
  issuer, audience = client_id emitido, `exp`, `nonce`; `sub` é a identidade estável
  ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md#4-validate-the-id-token-and-chatgpt-plan-permission)).

⚠️ **NÃO VERIFICADO**: o caminho A **não publica** o formato exato do ID token além de
`sub`/`email`/`nonce`; o doc diz que `email` e `sub` não são identificadores de workspace, e que o
client_id emitido é o que separa registros. Claims como `chatgpt_plan_type` e
`chatgpt_account_id` são usados pelo Codex CLI (caminho B, ver §2.5), mas **não** são documentados
para o caminho A. Não assumir que existem no ID token do SIWC.

### 1.5 Limitações do caminho A (importantíssimo para o request builder)

Respostas HTTP devem usar `store: false` e `stream: true`; `input` deve ser um array com o contexto
de cada request; usar `instructions` **ou** developer messages — itens explícitos
`{type:"message", role:"system"}` são rejeitados.

Campos que devem ser **omitidos**: `background`, `conversation`, `max_output_tokens`,
`max_tool_calls`, `metadata`, `moderation`, `multi_agent`, `prompt`, `prompt_cache_retention`,
`safety_identifier`, `temperature`, `top_logprobs`, `top_p`, `truncation`, `user`.
Estado de conversa: **omitir `previous_response_id`** via HTTP e mandar o histórico em `input`.
WebSocket continuation só referencia respostas da mesma conexão autenticada.
Fonte: [preview-limitations.md](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations.md).

Tools suportadas: function/custom tools agrupadas em namespaces ou via `additional_tools`; web
search conforme política da conta. **Não suportadas**: image generation, file search, code
interpreter, computer use nativo, MCP hospedado/connectors, `tool_search` (nem via execução no
cliente), `programmatic_tool_calling` no `tools` de topo. Inputs: texto/imagem/arquivo quando o
modelo aceita; áudio/vídeo, Files upload API e transcription API **não** são suportados
([mesma fonte](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations.md)).

---

## 2. Caminho B — OAuth do Codex CLI (interno, verificado no código-fonte)

> Fonte primária: `openai/codex`, branch `main`, arquivos em `codex-rs/login/src/`.
> Todas as strings abaixo são **CONFIRMADO NO CÓDIGO** (data da coleta: 2026-10-26).
> Isso descreve o que o Codex CLI faz; **não** é API pública.

### 2.1 Constantes exatas

| Constante | Valor | Fonte |
|---|---|---|
| `DEFAULT_ISSUER` | `https://auth.openai.com` | [server.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs) |
| `DEFAULT_PORT` | `1455` | [server.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs) |
| `FALLBACK_PORT` | `1457` ("registered fallback port" / "Hydra redirect URI allow-list") | [server.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs) |
| callback path | `/auth/callback` | [server.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs) |
| `redirect_uri` | `http://127.0.0.1:{actual_port}/auth/callback` | [server.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs) |
| `CLIENT_ID` | `app_EMoamEEZ73f0CkXaXp7hrann` | [manager.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs) |
| override de client id | env `CODEX_APP_SERVER_LOGIN_CLIENT_ID` | [manager.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs) |
| `REFRESH_TOKEN_URL` | `https://auth.openai.com/oauth/token` | [manager.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs) |
| `REVOKE_TOKEN_URL` | `https://auth.openai.com/oauth/revoke` | [manager.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs) |
| override de refresh/revoke | env `CODEX_REFRESH_TOKEN_URL_OVERRIDE`, `CODEX_REVOKE_TOKEN_URL_OVERRIDE` | [manager.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs) |
| default originator | `codex_cli_rs` | [default_client.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/default_client.rs) |

⚠️ O `client_id` acima é interno do Codex e **pode mudar a qualquer release**. Foi confirmado no
código nesta data; não há nenhum documento público da OpenAI autorizando seu uso por terceiros
(ver §7.1).

### 2.2 Authorize URL (query params exatos)

`GET https://auth.openai.com/oauth/authorize` com, nesta ordem
([server.rs `build_authorize_url`](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs)
+ [authorization.rs `build_authorization_url`](https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/authorization.rs)):

```
response_type=code
client_id=app_EMoamEEZ73f0CkXaXp7hrann
redirect_uri=http://127.0.0.1:1455/auth/callback
code_challenge=<base64url(SHA256(verifier)) sem padding>
code_challenge_method=S256
state=<32 bytes aleatórios base64url sem padding>
scope=openid profile email offline_access api.connectors.read api.connectors.invoke
id_token_add_organizations=true
codex_cli_simplified_flow=true
originator=codex_cli_rs
[allowed_workspace_id=<ids separados por vírgula>]   # só se forced_chatgpt_workspace_id
```

Notas CONFIRMADAS:
- O scope do Codex **inclui** `api.connectors.read api.connectors.invoke` (diferente do caminho A);
- `id_token_add_organizations=true`, `codex_cli_simplified_flow=true` e `originator` são parâmetros
  **extras** do Codex, não padrão OIDC;
- `codex_streamlined_login` aparece no server como opção (`ServerOptions.codex_streamlined_login`);
  o fluxo de device code também usa `codex_streamlined_login`/página de sucesso
  ([server.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs)).

PKCE ([pkce.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/pkce.rs)):
verifier = 64 bytes aleatórios em base64url sem padding (86 chars); challenge =
base64url(SHA-256(verifier)) sem padding. `state` = 32 bytes aleatórios base64url sem padding
([authorization.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/authorization.rs)).

### 2.3 Servidor de callback loopback: portas, validação e timeout

- Escuta em `127.0.0.1:1455`; se ocupado, tenta cancelar uma instância anterior via
  `GET /cancel` e faz retry (10 tentativas, 200 ms); se continuar ocupado, cai para `1457`
  ([bind_server](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs)).
- Paths atendidos: `/auth/callback`, `/success`, `/cancel`; qualquer outro → 404
  ([process_request](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs)).
- Validação: compara `state` exato com o gerado; se mismatch → HTTP 400 "State mismatch";
  se `error` presente → pagina de erro; se code ausente → erro "missing_authorization_code".
  O `state` é validado **antes** de aceitar code ou erro do provider
  ([authorization.rs `CallbackParameters::validate`](https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/authorization.rs),
  [server.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs)).
- **Timeout**: não existe timeout de parede no servidor de callback; ele fica em loop até receber
  requisição, shutdown (`/cancel` ou handle interno) ou erro. Sem callback, o login termina com
  `io::ErrorKind::Other("Login was not completed")`
  ([server.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs)).
  ⚠️ **NÃO VERIFICADO**: se a UI do Codex aplica timeout adicional por cima; não foi encontrado no
  arquivo do servidor.
- O browser é aberto com `webbrowser::open(&auth_url)`; se abrir falhar, o erro é ignorado
  (`let _ =`) ([server.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs)).

### 2.4 Token endpoint (código) e refresh (JSON)

**Troca do code** — `POST https://auth.openai.com/oauth/token`,
`application/x-www-form-urlencoded`, campos
([oauth/client.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/client.rs)):

```
grant_type=authorization_code
client_id=app_EMoamEEZ73f0CkXaXp7hrann
code=<authorization code>
redirect_uri=http://127.0.0.1:<porta>/auth/callback
code_verifier=<verifier>
```

Resposta desserializada em `ExchangedTokens { id_token, access_token, refresh_token }` — **sem**
`expires_in` (a expiração é lida do claim `exp` do JWT via `parse_jwt_expiration`)
([server.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs),
[token_data.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/token_data.rs)).

**Refresh** — `POST https://auth.openai.com/oauth/token` com
`Content-Type: application/json` (**JSON, não form**) e campos
([oauth/client.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/client.rs)):

```json
{
  "grant_type": "refresh_token",
  "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
  "refresh_token": "<refresh token>",
  "refresh_reason": "proactive_expiry" // | "scheduled" | "unauthorized_recovery" | "forced"
}
```

`RefreshResponse { id_token?, access_token?, refresh_token? }` — todos opcionais; só substitui o que
veio. `refresh_reason` é diagnóstico e **não** evidência de validade
([oauth/client.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/client.rs),
[manager.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs)).

Erros de refresh classificados por `error.code`
([manager.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs)):

| `code` | Significado | Ação |
|---|---|---|
| `refresh_token_expired` | expirado | login de novo |
| `refresh_token_reused` | já usado (rotativo) | login de novo |
| `refresh_token_invalidated` | revogado | login de novo |
| `invalid_grant` (HTTP 400) | token inválido | login de novo |
| `invalid_client` | client config errado | corrigir client id |
| 401 / outros | permanente vs transitório | 401 ou códigos acima = permanente; resto = transitório |

Mensagens literais: "Your access token could not be refreshed because your refresh token has
expired / was already used / was revoked. Please log out and sign in again."
([manager.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs)).
O caminho A documenta exatamente os mesmos códigos de refresh
([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery.md#refresh-errors)).

### 2.5 JWT claims e seleção do account id

Parser do ID token
([token_data.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/token_data.rs)):

- `email`: claim de topo `email`, com fallback para `https://api.openai.com/profile.email`;
- `https://api.openai.com/auth` (`AuthClaims`):
  - `chatgpt_plan_type` (enum `PlanType`: `free`, `plus`, `pro`, `business`, `enterprise`, `edu`, e
    valores extras do backend — ver §5.1);
  - `chatgpt_user_id` (fallback `user_id`);
  - `chatgpt_account_id` — **é este o account id usado**;
  - `chatgpt_account_is_fedramp` (bool) → header `X-OpenAI-Fedramp: true`;
- `raw_jwt` (ID token cru é preservado);
- `exp` do JWT padrão é lido por `parse_jwt_expiration`.

**Como o account id é escolhido (CONFIRMADO)**:
1. No login, `persist_tokens_async` lê `jwt_auth_claims(id_token)["chatgpt_account_id"]` e grava em
   `TokenData.account_id` ([server.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs));
2. `AuthDotJson.tokens.account_id` é persistido em `auth.json`
   ([storage.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs));
3. O header `ChatGPT-Account-ID` é montado a partir de `auth.get_account_id()`
   ([bearer_auth_provider.rs](https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/bearer_auth_provider.rs));
4. **`organizations` não é lido** no `main` atual. O param `id_token_add_organizations=true` continua
   sendo enviado, mas o parser não tem campo `organizations` — a seleção é por
   `chatgpt_account_id` ([token_data.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/token_data.rs)).
   🧪 **ASSUNÇÃO**: em versões antigas do Codex o `organizations` era usado para escolher workspace;
   não reimplementar isso sem confirmar.
5. `forced_chatgpt_workspace_id` (config/admin) restringe o login a workspace(s) comparando
   `chatgpt_account_id` com a lista `allowed_workspace_id` enviada no authorize
   ([server.rs `ensure_workspace_allowed`](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs)).

### 2.6 Persistência (`auth.json`) e armazenamento

- `AuthDotJson`: `auth_mode`, `OPENAI_API_KEY` (serializado com esse nome), `tokens`, `last_refresh`,
  `agent_identity`, `personal_access_token`, `bedrock_api_key`, `bedrock_access_keys`
  ([storage.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs)).
- `TokenData`: `id_token`, `access_token`, `refresh_token`, `oauth_provenance {issuer, client_id}`,
  `login_owner_id`, `account_id`
  ([token_data.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/token_data.rs)).
- Modos de storage (config `cli_auth_credentials_store`): `file` (`~/.codex/auth.json`), `keyring`
  (OS credential store, falha se indisponível), `auto` (keyring com fallback para arquivo),
  `ephemeral` (memória). No Unix o arquivo é aberto com `0o600`; no keyring a chave é
  `cli|<sha256(path)[..16]>` no serviço `"Codex Auth"`
  ([storage.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs)).
  A doc oficial confirma os mesmos 4 modos e avisa: "treat `~/.codex/auth.json` like a password"
  ([DOCUMENTADO](https://learn.chatgpt.com/docs/auth#credential-storage)).
- Persistência de refresh: relê o arquivo, confere que o login/owner não mudou ("Account
  credentials changed during refresh."), atualiza tokens e `last_refresh = Utc::now()`
  ([manager.rs `persist_tokens`](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs)).
- Concorrência: `refresh_lock: Arc<Semaphore>` com **1 permit** (serializa refresh) e um
  `AUTH_STORAGE_COMMIT: Mutex` protegendo read-modify-write
  ([manager.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs),
  [storage.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs)).
- Constantes de agendamento: `TOKEN_REFRESH_INTERVAL: i64 = 8` e
  `CHATGPT_ACCESS_TOKEN_REFRESH_WINDOW_MINUTES: i64 = 5`
  ([manager.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs)).
  ⚠️ **NÃO VERIFICADO**: a unidade de `TOKEN_REFRESH_INTERVAL` (o nome sugere minutos; a função que
  o consome ficou fora do trecho capturado). O doc do caminho A diz 1 h de access token, então
  refresh proativo na janela de ~5 min antes do `exp` é o comportamento esperado.

### 2.7 Device code (headless) — endpoints internos

CONFIRMADO em [device_code_auth.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs):

| Step | Request | Body/Response |
|---|---|---|
| pedir código | `POST https://auth.openai.com/api/accounts/deviceauth/usercode` | JSON `{"client_id": "..."}` → `{device_auth_id, user_code, interval}` |
| usuário abre | `https://auth.openai.com/codex/device` | mostra `user_code` (expira em 15 min) |
| polling | `POST https://auth.openai.com/api/accounts/deviceauth/token` | JSON `{device_auth_id, user_code}` → `{authorization_code, code_challenge, code_verifier}` |
| troca | `POST https://auth.openai.com/oauth/token` | redirect_uri = `https://auth.openai.com/deviceauth/callback`, PKCE vindo da resposta |

Timeout: 15 minutos; 403/404 durante polling = "ainda não aprovado", continua; após 15 min,
"device auth timed out after 15 minutes". 404 no `usercode` = device login desabilitado no server
([device_code_auth.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs)).
A doc de auth confirma device code como método suportado do Codex CLI (beta), com
`codex login --device-auth` e a porta `localhost:1455` para o fluxo por browser
([DOCUMENTADO](https://learn.chatgpt.com/docs/auth#login-on-headless-devices)).

### 2.8 Identidade de cliente nas requisições (originator / user-agent)

- Header `originator` default `codex_cli_rs`; pode ser sobrescrito por env
  `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`; `is_first_party_originator` aceita `codex_cli_rs`,
  `codex-tui`, `codex_vscode`, prefixo `Codex ` ([default_client.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/default_client.rs)).
- User-Agent: `{originator}/{CARGO_PKG_VERSION} ({os_type} {os_version}; {arch}) {terminal_ua}`
  e um sufixo opcional entre parênteses; sanitizado se inválido
  ([default_client.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/default_client.rs)).
- Header `version` = versão do Codex, configurado em `http_headers` do provider OpenAI
  ([model-provider-info/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs)).
- Headers `session-id` e `thread-id` via `build_session_headers`
  ([requests/headers.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/requests/headers.rs)).
  ⚠️ **NÃO VERIFICADO**: em quais chamadas exatamente `session-id` é anexado (o helper é claro; os
  call sites ficam fora dos arquivos capturados).

---

## 3. Caminho B — backend ChatGPT usado pelo Codex com token OAuth

> Fonte: código do `openai/codex` main. **Não é API pública documentada.** O caminho A proíbe
> explicitamente usar `backend-api`.

### 3.1 Base URL e endpoints

| Item | Valor | Fonte |
|---|---|---|
| Base URL (auth ChatGPT) | `https://chatgpt.com/backend-api/codex` (`CHATGPT_CODEX_BASE_URL`) | [model-provider-info/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs) |
| Base URL (API key) | `https://api.openai.com/v1` | [model-provider-info/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs) |
| Responses | `POST {base}/responses` | [core/client.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs) (span `api.path = "/responses"`) |
| Models | `GET {base}/models?client_version=<versão>` | [model-provider/models_endpoint.rs](https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/models_endpoint.rs) (teste literal: `https://chatgpt.com/backend-api/codex/models?client_version=…`) |
| Usage / rate limits | `GET https://chatgpt.com/backend-api/wham/usage` (estilo ChatGPT) ou `{base}/api/codex/usage` (estilo Codex API) | [backend-client/client/rate_limit_resets.rs](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs) |
| Reset credits | `GET /wham/rate-limit-reset-credits`, `POST /wham/rate-limit-reset-credits/consume` | [rate_limit_resets.rs](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs) |
| Accounts check | `GET /wham/accounts/check` | [backend-client/client.rs](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs) |
| Profile/usage | `GET /wham/profiles/me` | [backend-client/client.rs](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs) |
| Tasks (cloud) | `/wham/tasks*` | [backend-client/client.rs](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs) |
| Settings | `GET /wham/settings/user` | [backend-client/client.rs](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs) |
| Config bundle | `GET /wham/config/bundle` | [backend-client/client.rs](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs) |

Regra do `PathStyle`: se a base contém `/backend-api` → estilo ChatGPT (`/wham/...`); senão estilo
Codex API (`/api/codex/...`) ([backend-client/client.rs](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs)).
**Variante `/backend-api/codex/usage` não foi encontrada** em nenhuma fonte desta pesquisa: para a
base `https://chatgpt.com/backend-api`, o usage é `https://chatgpt.com/backend-api/wham/usage`; a
variante `/api/codex/usage` só existe para base "Codex API" (sem `/backend-api`).
⚠️ **NÃO VERIFICADO** se algum produto usa literalmente `/backend-api/codex/usage`.
⚠️ **NÃO VERIFICADO**: o path exato `/responses` é inferido do span `api.path` + base URL; a
concatenação acontece na crate `codex-client` (não capturada). O teste de models confirma o padrão
`{base}/models` para a mesma base, o que sustenta a inferência.

### 3.2 Headers

| Header | Valor | Obrigatório? | Fonte |
|---|---|---|---|
| `Authorization` | `Bearer <access_token>` | sim | [bearer_auth_provider.rs](https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/bearer_auth_provider.rs) |
| `ChatGPT-Account-ID` | `<account_id>` do JWT | sim (auth ChatGPT) | [bearer_auth_provider.rs](https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/bearer_auth_provider.rs) |
| `X-OpenAI-Fedramp` | `true` (se claim fedramp) | só contas FedRAMP | idem |
| `originator` | `codex_cli_rs` (ou override) | sim (default client) | [default_client.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/default_client.rs) |
| `User-Agent` | `codex_cli_rs/<ver> (<os>; <arch>) …` | sim | idem |
| `version` | versão do Codex (ex. `0.x.y`) | sim no provider OpenAI | [model-provider-info/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs) |
| `session-id`, `thread-id` | ids internos | usados pelo cliente | [requests/headers.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/requests/headers.rs) |
| `OAI-Product-Sku` | `codex` | sim nos endpoints ChatGPT backend (usage/profile/tasks) | [chatgpt_client.rs](https://github.com/openai/codex/blob/main/codex-rs/chatgpt/src/chatgpt_client.rs) |
| `OpenAI-Beta` | nome definido como const; valor de WS `responses_websockets=2026-02-06` | WS | [core/client.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs) |
| `Accept` | não encontrado nos headers default | ⚠️ não verificado | — |
| `Content-Type` | `application/json` nos POSTs | sim | [chatgpt_client.rs](https://github.com/openai/codex/blob/main/codex-rs/chatgpt/src/chatgpt_client.rs) |

Headers extras de SSE/roteamento vistos no código (não são pré-requisito de contrato público):
`x-codex-turn-state` (sticky routing por turno), `x-codex-turn-metadata`, `x-codex-installation-id`,
`x-codex-routing-hint`, `x-codex-parent-thread-id`, `x-codex-window-id`,
`x-openai-subagent`, `x-openai-internal-codex-residency` (managed residency = `us`)
([core/client.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs),
[model-provider-info/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs)).
⚠️ **NÃO VERIFICADO**: quais desses o backend exige; sticky routing é "contract between client and
server" segundo o comentário, mas não é documentado publicamente.

### 3.3 Corpo da requisição `/responses` (valores reais do Codex)

Estrutura `ResponsesApiRequest`
([codex-api/src/common.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/common.rs));
preenchimento em `build_responses_request`
([core/client.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs)):

| Campo | Valor no Codex | Observação |
|---|---|---|
| `model` | `model_info.slug` | |
| `stream` | **`true`** | sempre streaming |
| `input` | `Vec<ResponseItem>` | inclui um item sintético de **base instructions** no início (ver abaixo) |
| `tools` | array (ou `null` em "responses lite") | function tools/custom tools etc. |
| `tool_choice` | **`"auto"`** | literal |
| `parallel_tool_calls` | `prompt.parallel_tool_calls && !use_responses_lite` | |
| `reasoning` | **sempre presente** (`effort`, `summary`, opcional `context`) | `{reasoning: {effort, summary}}` |
| `store` | **`false`** | literal |
| `include` | `["reasoning.encrypted_content"]` (+ `"output.encrypted_content"` se flag) | |
| `service_tier` | opcional | |
| `stream_options` | opcional (`reasoning_summary_delivery: sequential_cutoff`) | só com summaries concorrentes |
| `prompt_cache_key` | opcional | derivado de metadata |
| `text` | opcional (`{verbosity, format?}`) | `format` = JSON schema quando structured output |
| `client_metadata` | `Some(map)` | metadata interna do Codex |
| `access_programs` | opcional (`cyber`) | só em contas/programas especiais |

CONFIRMADO, e importante para o plano:
- **NÃO existe campo `instructions`** na struct do Codex. As instruções base são injetadas como um
  `ResponseItem` sintético no começo de `input` (`BaseInstructionsFragment`, com id `msg_...`
  derivado de UUID v5) ([core/client.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs)).
- **NÃO existem** `temperature`, `top_p`, `max_output_tokens` no request do Codex (a struct não os
  tem) ([common.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/common.rs)).
- `store: false` + `include: ["reasoning.encrypted_content"]` é o padrão stateless.

### 3.4 SSE — eventos emitidos e como chegam

Parser em [codex-api/src/sse/responses.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/sse/responses.rs)
(campo `type` do evento). Eventos **tratados**:

| `type` | Como o Codex consome |
|---|---|
| `response.created` | id da response (`response.id`) |
| `response.output_item.added` / `.done` | item completo (`item`), incl. function calls |
| `response.output_text.delta` | `delta` de texto |
| `response.custom_tool_call_input.delta` | delta de input de custom tool (`item_id`/`call_id`) |
| `response.function_call_arguments.delta` / `.done` | **ignorado** (o Codex usa o item completo em `output_item.done`) |
| `response.reasoning_summary_text.delta` | `delta` + `summary_index` |
| `response.reasoning_summary_text.done` | `text` + `item_id` + `summary_index` |
| `response.reasoning_text.delta` | `delta` + `content_index` |
| `response.reasoning_summary_part.added` | `summary_index` |
| `response.completed` | `id`, `usage`, `usage_metadata`, `end_turn` |
| `response.incomplete` | se `incomplete_details.reason == "content_filter"` → erro; se `!= "interrupted"` → erro estruturado; senão `Completed` com `end_turn=false` |
| `response.failed` | erro parseado (`response.error`) |
| `error` | erro terminal (`error.message`/code) |
| `response.metadata` | model, verifications, moderation, safety buffering, turn-state |
| `codex.response.metadata` | ignorado (trace) |
| `codex.rate_limits` | rate limits do stream (ver §5.3) |
| outros `*.delta` / desconhecidos | log/ignorado |

Tool calls: chegam como itens completos em `response.output_item.done` (o Codex não acumula
argumentos de function call pelos deltas) — em contrapartida, **custom tool calls** têm delta via
`response.custom_tool_call_input.delta`
([sse/responses.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/sse/responses.rs)).
Reasoning summaries chegam como deltas (`response.reasoning_summary_text.delta`) e um `done` com o
texto final; `response.reasoning_text.delta` é o reasoning cru quando disponível.

Uso (tokens) vem no evento `response.completed`:

```
response.usage = {
  input_tokens, input_tokens_details: {cached_tokens, cache_write_tokens},
  output_tokens, output_tokens_details: {reasoning_tokens},
  total_tokens, codex_rollout_budget_units?
}
response.usage_metadata = {...}
```

([sse/responses.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/sse/responses.rs)).
Rate limits também chegam por **headers da response do stream** antes do primeiro evento (ver §5.3).

---

## 4. Caminho C — API key oficial (`api.openai.com/v1`)

- Base URL: `https://api.openai.com/v1`; Responses: `POST https://api.openai.com/v1/responses`;
  Models: `GET https://api.openai.com/v1/models`
  ([quickstart](https://developers.openai.com/api/docs/quickstart.md),
  [models list reference](https://developers.openai.com/api/reference/resources/models/methods/list.md),
  [rate limits](https://developers.openai.com/api/docs/guides/rate-limits.md)).
- Auth: `Authorization: Bearer $OPENAI_API_KEY`; headers opcionais `OpenAI-Organization` e
  `OpenAI-Project` (mapeados de env no provider OpenAI do Codex)
  ([model-provider-info/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs)).
- `/v1/models` (API key) retorna `{"object":"list","data":[{"id","object":"model","created","owned_by","shutdown_date"}]}`
  ([reference](https://developers.openai.com/api/reference/resources/models/methods/list.md)).
  ⚠️ **Diferença crítica**: com token OAuth de ChatGPT plan, `/v1/models` retorna um catálogo no
  formato `{models:[{slug, display_name, visibility}]}` (não `data[]`)
  ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference.md)).
  O parser precisa ser escolhido pelo tipo de credencial.
- Corpo: `input`, `instructions`, `tools`, `tool_choice`, `parallel_tool_calls`, `reasoning`,
  `text.verbosity`, `store`, `stream`, `include`, `prompt_cache_key`, `metadata`, `max_output_tokens`,
  `temperature`, `top_p`, `truncation`, `service_tier`, etc.
  ([responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create.md);
  guias de [texto](https://developers.openai.com/api/docs/guides/text.md) e
  [reasoning](https://developers.openai.com/api/docs/guides/reasoning.md)).
  A página de referência é enorme e o fetch truncou parte dos campos após `input`; a lista completa de
  parâmetros deve ser re-checada na doc no momento da implementação.
- Streaming SSE: mesmos nomes de evento (`response.created`, `response.output_text.delta`,
  `response.completed`, `error`, etc.) ([DOCUMENTADO](https://developers.openai.com/api/docs/guides/streaming-responses.md)).
- `store: false` é permitido; `store: true` (default) persiste a response no projeto.
- Erros: 429 com `Retry-After` e headers `x-ratelimit-*`; `error.code` distingue
  `credit_balance_exhausted`, `slow_down`, `organization_spend_limit_exceeded`,
  `project_spend_limit_exceeded`, `organization_usage_limit_exceeded`; 503
  `server_is_overloaded` ([rate limits](https://developers.openai.com/api/docs/guides/rate-limits.md),
  [error codes](https://developers.openai.com/api/docs/guides/error-codes.md)).

### 4.1 Matriz de compatibilidade

| Feature / campo | API key (`/v1`, caminho C) | ChatGPT plan OAuth (`/v1`, caminho A) | Codex backend (`backend-api/codex`, caminho B) |
|---|---|---|---|
| `POST /responses` | ✅ | ✅ | ✅ (não documentado) |
| `GET /models` (formato) | `data[]` | `models[]` (slug/display_name/visibility) | `models[]` Codex catalog + `?client_version` |
| `store` | `true`/`false` | **obrigatório `false`** | **`false`** |
| `stream` | opcional | **obrigatório `true`** | **`true`** |
| `instructions` | ✅ | ✅ (ou developer messages) | ❌ não existe; BaseInstructions vai no `input` |
| `temperature` / `top_p` | ✅ | ❌ rejeitados | ❌ não usados |
| `max_output_tokens` | ✅ | ❌ rejeitado | ❌ não usado |
| `metadata` | ✅ | ❌ rejeitado | ✅ (client_metadata interno) |
| `previous_response_id` | ✅ | ❌ omitir via HTTP | ✅ via WS continuation; HTTP stateless |
| `prompt_cache_key` | ✅ | não citado (não listado como proibido) | ✅ |
| `include: reasoning.encrypted_content` | ✅ | ✅ (é o padrão stateless) | ✅ |
| `tools`: function/custom | ✅ | ✅ (namespaces ou `additional_tools`) | ✅ (formato Codex, tools nomeadas) |
| `tools`: web_search | ✅ | ✅ sujeito a política | ✅ |
| `tools`: file_search / code_interpreter / image_generation / computer_use / MCP / tool_search | ✅ | ❌ | parcial/no primeiro-party |
| reasoning effort/summary | ✅ | ✅ (campos não proibidos) | ✅ |
| `text.verbosity` | ✅ | ✅ (não proibido) | ✅ |
| `stream_options.reasoning_summary_delivery` | ✅/interno | não citado | ✅ (interno) |
| Billing | API org | plano ChatGPT (compartilha limite 5h/7d) | plano ChatGPT |

Legenda: ✅ suportado; ❌ não suportado/rejeitado; "não citado" = não foi achado nesta pesquisa.

---

## 5. Rate limits e planos

### 5.1 Plan types (o que aparece nos tokens do Codex)

- Enum de claim `chatgpt_plan_type` (comentário): `"free" | "plus" | "pro" | "business" |
  "enterprise" | "edu"` (valores podem variar)
  ([token_data.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/token_data.rs)).
- Mapeamento completo do backend (`/wham/usage`) inclui: `free`, `go`, `plus`, `pro`, `pro_lite`,
  `pro_max`, `team`, `self_serve_business_prolite`, `self_serve_business_usage_based`, `business`,
  `ent26`, `enterprise_cbp_automation`, `enterprise_cbp_usage_based`, `enterprise`, `edu`/`education`,
  `edu_plus`, `edu_pro`, `sci`, `sci_plus`, `guest`, `free_workspace`, `quorum`, `k12`, `unknown`
  ([backend-client/client.rs `map_plan_type`](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs)).
  Ou seja: **não hardcodar** a lista de planos; usar enum aberto + string crua.

### 5.2 Limites por plano (2026)

- **ChatGPT Work e Codex compartilham uso**: "ChatGPT Work and Codex share usage… same pricing,
  credits, and usage limits as Codex"
  ([DOCUMENTADO — pricing](https://learn.chatgpt.com/docs/pricing.md)).
- Planos e preços (2026-10): **Free** ($0), **Go** ($8/mês), **Plus** ($20/mês), **Pro**
  ($100/$200/$500 por mês), **Business** ($20/usuário/mês, 2+ usuários, anual), **Enterprise & Edu**
  (contato de vendas); API key é cobrado por usage
  ([DOCUMENTADO — pricing](https://learn.chatgpt.com/docs/pricing.md)).
- Limites: Plus/Standard Business têm estimativas de mensagens locais por **período de 5 horas**
  (tabela por modelo: GPT-6 Astra 5–45, GPT-6.1 Sol 15–160, GPT-6 Sol 15–150, GPT-6 Luna
  350–3.000). **Pro atual não tem limite de 5 horas**; limites **semanais** podem se aplicar.
  Enterprise/Edu com flexible pricing **não têm rate limit fixo** (escala por créditos); sem flexible
  pricing, mesmos limites por assento do Plus
  ([DOCUMENTADO — pricing](https://learn.chatgpt.com/docs/pricing.md)).
- Para apps OSS via SIWC: para Plus, o limite de 5 horas é **compartilhado entre todos os apps** que
  usam o plano (incl. clientes privados/OSS); nenhum app recebe cota separada. **O limite de 5 horas
  não se aplica ao Pro** ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions.md)).
- Onde ver: dashboard `https://chatgpt.com/codex/settings/usage` (CLI: `/status`) —
  [DOCUMENTADO](https://learn.chatgpt.com/docs/pricing.md); para apps SIWC, `ChatGPT Settings → Usage`
  com "App limits" por app (10%–100% do limite semanal) —
  [DOCUMENTADO](https://learn.chatgpt.com/docs/sign-in-with-chatgpt.md).
- "ChatGPT Work" vs "Codex": os limites de workspace (créditos, spend controls) aplicam-se a
  "eligible activity under your workspace plan, which can include some Codex activity" e **não**
  cobrem todo o uso de Codex nem billing da API Platform
  ([DOCUMENTADO](https://learn.chatgpt.com/docs/enterprise/usage-limits.md)).
  🧪 **ASSUNÇÃO**: "Codex" e "Work" são superfícies do mesmo pool de uso; o backend expõe
  `additional_rate_limits` com `metered_feature` próprio — a distinção exata de qual limite vale por
  superfície é runtime/produto, não documentada por modelo.

### 5.3 Rate limits no backend do Codex (headers + evento SSE)

Headers (família "codex"; parseados por
[codex-api/src/rate_limits.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/rate_limits.rs)):

```
x-codex-primary-used-percent, x-codex-primary-window-minutes, x-codex-primary-reset-at
x-codex-secondary-used-percent, x-codex-secondary-window-minutes, x-codex-secondary-reset-at
x-codex-credits-has-credits, x-codex-credits-unlimited, x-codex-credits-balance
x-codex-promo-message
x-codex-rate-limit-reached-type
x-<limit-id>-*        # outras famílias por metered limit id (ex.: x-codex-secondary-...)
x-<limit-id>-limit-name
```

- `parse_all_rate_limits` descobre dinamicamente as famílias `x-<id>-primary-used-percent` e devolve
  um snapshot por limit id; o default legado é `codex`
  ([rate_limits.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/rate_limits.rs)).
- Evento SSE `codex.rate_limits` com payload
  `{type:"codex.rate_limits", plan_type?, rate_limits:{primary:{used_percent,window_minutes,reset_at}, secondary:{...}}, credits:{has_credits,unlimited,balance?}, metered_limit_name?, limit_name?}`
  ([rate_limits.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/rate_limits.rs)).
- `RateLimitReachedType` inclui `rate_limit_reached`, `workspace_owner_credits_depleted`,
  `workspace_member_credits_depleted`, `workspace_owner_usage_limit_reached`,
  `workspace_member_usage_limit_reached`
  ([backend-client/client.rs](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs)).

### 5.4 Endpoint de usage/limites (backend do Codex)

`GET https://chatgpt.com/backend-api/wham/usage` (PathStyle ChatGPT) ou `/api/codex/usage`
(PathStyle Codex API), com os headers de auth
([rate_limit_resets.rs](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)).
Payload parseado em `RateLimitStatusWithResetCredits`:

- `rate_limits.rate_limit.primary_window|secondary_window {used_percent, limit_window_seconds,
  reset_at, reset_after_seconds, allowed}`
- `plan_type`
- `additional_rate_limits[] {limit_name, metered_feature, rate_limit{...}}`
- `credits {has_credits, unlimited, balance}`
- `spend_control {reached, individual_limit{limit, used, remaining_percent, reset_at}}`
- `rate_limit_reset_credits`, `account_id`, `user_id`, `rate_limit_upsell`
  ([backend-client/types.rs](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/types.rs),
  [client.rs](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs)).
- **Exposição de limites restantes**: o endpoint devolve os snapshots usados pelo Codex; é a forma
  como o CLI mostra `/status`. ⚠️ **NÃO VERIFICADO**: não há contrato público/estável para esse
  endpoint; o caminho A **não documenta** endpoint de usage — para apps SIWC, a doc manda linkar para
  o dashboard e não promete API.

### 5.5 429 e erros do caminho A (ChatGPT plan via OAuth)

Antes do stream abrir, a admissão direta pode devolver **sem objeto `error`** (ex.
`{"detail":"..."}`): 401 (identidade/permissão), 403 (política/região), 503 (rota indisponível).
Depois, códigos estruturados ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery.md)):

| `error.code` | HTTP | Ação |
|---|---|---|
| `subscription_sharing_user_not_eligible` | 403 | plano indisponível; não repetir/loopar OAuth |
| `subscription_sharing_usage_limit_exceeded` | 429 | pausar requests e linkar Settings → Usage; **não inferir reset** |
| `subscription_sharing_usage_unavailable` | 503 | backoff |
| `subscription_sharing_unsupported_capability` | 400 | remover input/tool/model/service tier não suportado |
| `subscription_sharing_route_not_supported` | 403 | método/endpoint errado (usar `POST /v1/responses`) |
| `subscription_sharing_invalid_user` | 401 | credential failure; pedir login após revogação |
| `chatpass_v2_scope_not_authorized` / `chatpass_v2_invalid_authorization_context` | 403 | grant/client config errado |
| `subscription_sharing_user_unavailable` | 503 | backoff |

Revogação/desconexão: a OpenAI **não notifica** o app quando o usuário desconecta em ChatGPT
settings; ao detectar (401/refresh), parar de usar e pedir login — não apagar credenciais por falha
transitória ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery.md)).

---

## 6. Segurança e conformidade

### 6.1 O uso do client OAuth do Codex por um app terceiro é oficialmente suportado?

**Não.** O que existe oficialmente é outra coisa:

1. **SIWC token sharing / "ChatGPT plan usage" para apps OSS e locais** é o caminho sancionado:
   dynamic client registration, `client_id` emitido (`oaiapp_…`), endpoints `/api/accounts/*`,
   inferência em `api.openai.com/v1` — ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source.md)).
   A lista de "Open-source integrations" inclui **OpenCode**, Pi, T3 e OpenClaw
   ([DOCUMENTADO](https://learn.chatgpt.com/docs/sign-in-with-chatgpt.md)).
2. **O fluxo do website (partner)** é separado e limitado a parceiros comerciais selecionados
   ("currently offered to a select group of commercial partners"; pedir client ID via formulário)
   ([DOCUMENTADO](https://developers.openai.com/siwc/website.md),
   [request-client-id.md](https://developers.openai.com/siwc/request-client-id.md)).
3. **O `client_id` do Codex CLI** (`app_EMoamEEZ73f0CkXaXp7hrann`) e o backend
   `chatgpt.com/backend-api/codex` são implementação interna do Codex. Não há documento que
   autorize terceiros a reutilizá-los; pelo contrário, a doc do caminho A diz explicitamente para
   **não** apontar o fluxo de ChatGPT plan usage para `backend-api`
   ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference.md)).
   🧪 **ASSUNÇÃO/risco jurídico**: usar esse client_id num app terceiro se enquadra em
   "circumvent any rate limits or restrictions or bypass any protective measures"
   (Terms of Use) e não é um contrato suportado — ver §6.2.

Observação: a doc de auth do Codex declara que o login do CLI é "browser flow" e que o cache de
login é compartilhado entre CLI e extensão; **não** afirma que o client OAuth é público para outros
apps ([DOCUMENTADO](https://learn.chatgpt.com/docs/auth.md)).

### 6.2 Termos aplicáveis (citações)

- "You may not **share your account credentials** or make your account available to anyone else"
  ([Terms of Use](https://openai.com/policies/terms-of-use/)) — um login OAuth legítimo do próprio
  usuário no app não é "share credentials"; reutilizar credenciais de outro client de forma oculta é
  outra coisa. O plano deve deixar claro ao usuário qual client está sendo autorizado.
- "**Interfere with or disrupt our Services, including circumvent any rate limits or restrictions or
  bypass any protective measures or safety mitigations** we put on our Services"
  ([Terms of Use](https://openai.com/policies/terms-of-use/)) — cobre contornar limites de plano.
- "**Modify, copy, lease, sell or distribute any of our Services**"
  ([Terms of Use](https://openai.com/policies/terms-of-use/)) — cautela ao copiar o fluxo interno do
  Codex como se fosse API própria.
- Para uso Enterprise/API aplicam-se Business Terms
  (mencionado em [Terms of Use](https://openai.com/policies/terms-of-use/)).

### 6.3 Recomendações de storage e ciclo de vida (o que a OpenAI documenta)

Do caminho A ([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md#5-store-credentials-in-a-local-file),
[profiles-and-sessions.md](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions.md)):

- Guardar **um registro por `client_id` emitido** + identidade verificada (`email`, `issuer`,
  `subject`, `client_id`, `ext_agent_host_id`, `id_token`, `access_token`, `refresh_token`,
  `token_type`, `expires_in`, `scopes`, `saved_at`).
- Arquivo local protegido, `0600` em Unix, escrita **atômica**, nunca commit/log. "Keep tokens out of
  browser storage, source control, logs, analytics, and support transcripts."
- **Nunca** tokens em URL; `id_token_hint` só para o endpoint de autorização e redigido de logs.
- Refresh: usar o **replacement refresh token** e serializar refreshes por sessão (rotativo).
- Revogação no sign-out via `revocation_endpoint`; se falhar, limpar localmente e avisar que a
  revogação remota não foi confirmada.
- Account switching: manter registros separados; nunca combinar client_id de um registro com tokens
  de outro; email pode repetir.
- Comprometimento: instruir o usuário a desconectar em ChatGPT Settings (não existe botão de
  revogação remota pelo app).

Do Codex CLI ([DOCUMENTADO](https://learn.chatgpt.com/docs/auth.md) + código):
- `cli_auth_credentials_store = file | keyring | auto | ephemeral`;
  no Tauri no Windows, o equivalente natural é **OS keychain (Windows Credential Manager)** com
  fallback opcional para arquivo protegido, nunca JSON puro no repositório do app.
- Sessões ChatGPT do Codex "refresh tokens automatically during use before they expire"
  ([DOCUMENTADO](https://learn.chatgpt.com/docs/auth.md)).

### 6.4 Como clientes open-source implementam (verificado vs não verificado)

| Cliente | Status | Evidência |
|---|---|---|
| **Codex CLI** | ✅ verificado no código: OAuth PKCE loopback (1455/1457), `auth.json`/keyring, refresh serializado, device code | §2 acima; [login/src](https://github.com/openai/codex/tree/main/codex-rs/login/src) |
| **OpenCode** | 📄 listado oficialmente pela OpenAI como integração open-source com ChatGPT plan usage | [sign-in-with-chatgpt.md](https://learn.chatgpt.com/docs/sign-in-with-chatgpt.md); implementação em código **não verificada** nesta pesquisa (não localizada no repo `anomalyco/opencode` dentro do tempo) |
| **Pi / T3 / OpenClaw** | 📄 listados como integrações open-source | [sign-in-with-chatgpt.md](https://learn.chatgpt.com/docs/sign-in-with-chatgpt.md) |
| **Cline / Roo Code / Zed** | ⚠️ **NÃO VERIFICADO** | não foi encontrada fonte primária nesta pesquisa; não afirmar suporte OAuth ChatGPT sem checar o código de cada um |
| **Codex app-server (embutido)** | 📄 caminho oficial alternativo: seu app usa o app-server do Codex com `ACCESS_TOKEN` e provider `openai_chatgpt_plan` apontando para `https://api.openai.com/v1` | [codex-app-server.md](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server.md) |

Nota de arquitetura: o caminho app-server é uma opção "pronta" para um app desktop — o processo filho
do Codex faz o request, e você só injeta o `ACCESS_TOKEN`, `model_provider=openai_chatgpt_plan`,
`base_url=https://api.openai.com/v1`, `env_key=ACCESS_TOKEN`, `requires_openai_auth=false`,
`supports_websockets=false`, e reinicia o app-server a cada refresh
([DOCUMENTADO](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server.md)).
Para um app Tauri + React com harness próprio, isso pode ser mais simples do que reimplementar o
request builder do Codex.

---

## 7. Desconhecidos e riscos (o que o plano deve tratar como runtime-probed)

1. **Aprovação/rollout do SIWC**: o fluxo OSS é documentado, mas o cadastro de parceiro website é
   restrito; a página `request-client-id` diz "offered to a select group of commercial partners" e a
   de website diz "limited trial". O app pode não conseguir `client_id` emitido em produção sem
   aprovação. **Provar em runtime com uma conta real antes de prometer a feature.**
2. **`dynamic_agent_client` e `/api/accounts/*`**: constantes documentadas, mas não há OpenAPI
   público; comportamento (rate limit do endpoint de authorize, formato exato de erros, expiração do
   código) pode variar.
3. **Claims do ID token do SIWC**: `chatgpt_plan_type`/`chatgpt_account_id` são usados pelo Codex
   (caminho B), mas **não** estão documentados para o caminho A; não planejar UI de plano/workspace
   baseada neles sem validar o JWT real.
4. **Formato de `/v1/models` com token OAuth**: `models[]` com `slug`/`display_name`/`visibility`
   (doc SIWC) vs `data[]` (API key). O parser deve tolerar ambos e ser testado com token real.
5. **Proibições do request body no caminho A**: a lista de campos proibidos e tools não suportadas
   é de "preview" e pode mudar; `subscription_sharing_unsupported_capability` (400) deve ser tratado
   como sinal para remover campos, não como bug.
6. **Rate limits**: não há API pública de limites para SIWC; `x-codex-*`/`/wham/usage`/SSE
   `codex.rate_limits` são internos do Codex e podem mudar. O app deve degradar bem se os headers não
   vierem (mostrar "desconhecido" em vez de quebrar).
7. **`reset_at`/`window_minutes`**: unidades/epoch variam por fonte (segundos epoch no header
   `reset-at`; `limit_window_seconds` no `/wham/usage`; `reset_at` epoch no evento). Validar com
   resposta real.
8. **`ChatGPT-Account-Id`**: o Codex CLI manda em todas as requests de backend; no caminho A
   documentado **não** é exigido (token é bound ao account). Não reutilizar o header no caminho B
   sem testar — e nunca no caminho A.
9. **Cloudflare**: o backend `chatgpt.com` usa cookies/Cloudflare (o Codex tem
   `with_chatgpt_cloudflare_cookie_store`); pode exigir desafio que um HTTP client puro não resolve
   ([default_client.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/default_client.rs)).
10. **Revogação/desconexão sem notificação** (documentado): o app precisa detectar 401/refresh
    inválido e guiar o usuário.
11. **Modelos disponíveis por conta**: o catálogo OAuth é específico da conta/workspace; o Codex usa
    catálogo bundle como fallback. Não hardcodar slugs de modelo como entitlement.
12. **Tauri/loopback**: bind em `127.0.0.1` com porta fixa pode conflitar com outro app (o Codex usa
    1455 → 1457). O plano deve ter porta dinâmica e validar o `redirect_uri` exato (o doc do caminho A
    diz que só a porta pode variar e o path é `/auth/callback`).
13. **PKCE + state + nonce**: obrigatórios; o caminho A exige `nonce` para ID token e validação de
    `state`, e rejeita callback sem esses checks. Não simplificar.
14. **`expires_in` ausente no fluxo Codex**: o CLI calcula expiração pelo `exp` do JWT; o caminho A
    devolve `expires_in` + `earliest_refresh_at`. O refresh scheduler deve aceitar ambos.

---

## 8. Recomendação de implementação (resumo para o plano)

1. **Feature = "Sign in with ChatGPT (plano ChatGPT)" via SIWC OSS**, usando
   `dynamic_agent_client` + `ext_agent_host_id`, `api.openai.com/v1/responses` com `store:false` e
   `stream:true`. Esse é o único caminho documentado e com lista de apps OSS.
2. **Fallback = API key** (`api.openai.com/v1`), caminho C — já é o que o app suporta hoje em espírito
   (API key), então a mudança é de transporte/endpoint, não de auth.
3. **Não shippar o caminho B** (client_id do Codex + backend-api) como feature pública. Se for
   necessário para testes, deixar atrás de flag experimental, com aviso de que é interno/não
   suportado e que pode quebrar a qualquer release.
4. **Request builder**: um único `ResponsesRequest` com "capability profile" por modo:
   - `ApiKey`: permite `instructions`, `temperature`, `max_output_tokens`, `store`, `previous_response_id`;
   - `ChatGptPlan`: força `store=false`, `stream=true`, remove a lista proibida, usa
     `instructions`/developer messages, omite `previous_response_id`, limita tools.
5. **Model list**: parser dual (`data[]` vs `models[]`) + refresh por conta.
6. **Token store**: OS keychain (Windows Credential Manager) com registro por `client_id`/conta;
   refresh serializado, rotação atômica, revogação no sign-out.
7. **UI**: mostrar o plano/limite como "desconhecido" quando não vier de API; linkar dashboard
   `https://chatgpt.com/settings/usage`; aviso de que o uso conta no limite compartilhado do plano
   (Plus: 5h compartilhado entre apps; Pro: sem limite de 5h).

---

## 9. Índice de fontes (URLs abertas em 2026-10-26)

### Documentação oficial OpenAI
- SIWC OSS overview: <https://developers.openai.com/siwc/token-sharing-open-source.md>
- Registration/sign-in: <https://developers.openai.com/siwc/token-sharing-open-source/sign-in.md>
- Accounts/sessions/refresh/revoke: <https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions.md>
- Token reference: <https://developers.openai.com/siwc/token-sharing-open-source/token-reference.md>
- Models & inference: <https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference.md>
- Preview limitations: <https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations.md>
- Errors & recovery: <https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery.md>
- Codex app-server path: <https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server.md>
- SIWC website (partner): <https://developers.openai.com/siwc/website.md>
- Request client ID: <https://developers.openai.com/siwc/request-client-id.md>
- Codex auth (CLI/IDE): <https://learn.chatgpt.com/docs/auth.md>
- Codex pricing/limits: <https://learn.chatgpt.com/docs/pricing.md>
- Enterprise usage limits: <https://learn.chatgpt.com/docs/enterprise/usage-limits.md>
- Sign in with ChatGPT (user): <https://learn.chatgpt.com/docs/sign-in-with-chatgpt.md>
- API quickstart: <https://developers.openai.com/api/docs/quickstart.md>
- Responses create reference: <https://developers.openai.com/api/reference/resources/responses/methods/create.md>
- Models list reference: <https://developers.openai.com/api/reference/resources/models/methods/list.md>
- Streaming guide: <https://developers.openai.com/api/docs/guides/streaming-responses.md>
- Rate limits (API): <https://developers.openai.com/api/docs/guides/rate-limits.md>
- Error codes (API): <https://developers.openai.com/api/docs/guides/error-codes.md>
- OIDC discovery: <https://auth.openai.com/.well-known/openid-configuration>
- JWKS: <https://auth.openai.com/.well-known/jwks.json>
- Terms of Use: <https://openai.com/policies/terms-of-use/>

### Código-fonte `openai/codex` (branch `main`)
- Login server/callback: <https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs>
- OAuth client (grants): <https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/client.rs>
- Authorization URL/state: <https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/authorization.rs>
- PKCE: <https://github.com/openai/codex/blob/main/codex-rs/login/src/oauth/pkce.rs>
- Auth manager (CLIENT_ID, refresh, storage, locks): <https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs>
- Token data/JWT claims: <https://github.com/openai/codex/blob/main/codex-rs/login/src/token_data.rs>
- Auth storage/auth.json: <https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs>
- Device code: <https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs>
- Default client (originator/UA): <https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/default_client.rs>
- Provider registry / base URLs / version header: <https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs>
- Auth headers (Bearer/ChatGPT-Account-ID/FedRAMP): <https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/bearer_auth_provider.rs>
- Request body struct: <https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/common.rs>
- Request builder (store:false, includes, instructions injection): <https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs>
- SSE parser/event names/usage: <https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/sse/responses.rs>
- Rate limit headers/event: <https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/rate_limits.rs>
- Models endpoint: <https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/models_endpoint.rs>
- Backend client/usage endpoints: <https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client.rs>
- Usage/rate-limit-reset endpoints: <https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs>
- Backend types (plan types/usage payload): <https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/types.rs>
- ChatGPT backend helper (OAI-Product-Sku): <https://github.com/openai/codex/blob/main/codex-rs/chatgpt/src/chatgpt_client.rs>
- Session headers: <https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/requests/headers.rs>
