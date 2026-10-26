# OpenAI como provedor com login ChatGPT (plano compartilhado Codex/Work) — plano de implementação

> **Status (2026-10-26): implementado e testado.** Código + testes automatizados
> verdes (Rust 406, renderer 1336, typecheck/build). O **gate da Fase 0**
> (login real + inferência real, `scripts/openai-plan-probe.mjs`) é manual e
> depende de uma conta ChatGPT interativa — registrado como "implementado, não
> provado em runtime real" em `EVIDENCE.md`. Disposição da PRE review em
> `REVIEW-RESPONSE.md`.

**Intent:** adicionar a OpenAI como terceiro provedor de modelos do Lumina com login
OAuth do ChatGPT ("Sign in with ChatGPT" — ChatGPT plan usage), de forma que
requisições elegíveis consumam o plano/limites da conta do usuário (a mesma cota
de 5 h compartilhada entre apps, Codex e ChatGPT Work) em vez de exigir uma API
key paga; a API key da plataforma continua como caminho alternativo (fallback) no
mesmo provedor.

**Current Behavior:** o app só conhece dois provedores (`opencode-go`,
`opencode-zen`), ambos autenticados por API key. O catálogo embutido
(`data/catalog.json`) declara `providers[]` com `baseUrl`, `endpoints` e
`authEnv`; `ProviderInfo` (`src-tauri/src/catalog.rs:25-43`) não tem noção de modo
de autenticação. `config.rs` guarda apenas `secrets.json =
{"providers":{"<id>":"sk-..."}}` (`src-tauri/src/config.rs:135-141`) e resolve a
chave por secrets → `OPENCODE_API_KEY` → `~/.local/share/opencode/auth.json`
(`config.rs:254-270`). O harness exige uma `String` de API key antes de qualquer
turno (`src-tauri/src/harness/mod.rs:153-163`), e `ProviderConfig.api_key`
(`providers/mod.rs:163-173`) vira `Authorization: Bearer` em `send_stream`
(`providers/mod.rs:320-359`). Os adaptadores ignoram o mapa `endpoints` do
catálogo e usam caminhos fixos (`providers/mod.rs:290-293`), e o adaptador
Responses sempre envia `max_output_tokens` e, conforme o caso, `temperature`
(`providers/openai_responses.rs:66-104`). A UI de provedores é um formulário de
"colar API key" (`src/components/settings/ProvidersTab.tsx:109-220`) e o estado
"tem chave?" é um booleano por provedor (`ProviderKeyStatus`,
`src-tauri/src/domain.rs:645-654`; `src/lib/types.ts:416-421`). Nada no app fala
OAuth, PKCE, loopback local, refresh token ou catálogo dinâmico de modelos.
Relatório completo da superfície atual: `docs/research/provider-architecture-map.md`.

**Expected Outcome:**
(1) novo provedor `openai` no catálogo, com `auth: "oauth"` + perfis de request
por credencial (`chatgpt-plan` para OAuth, `standard` para API key), endpoints
`/responses` e `/models`, modelos OpenAI com capacidades/raciocínio/visão, e
fallback de API key no mesmo provedor;
(2) fluxo **oficial** de Sign in with ChatGPT para apps open-source/locais:
`client_id=dynamic_agent_client` + `ext_agent_host_id` estável + PKCE S256 +
`state` + `nonce`, callback loopback em `http://127.0.0.1:<porta>/auth/callback`,
troca de code no `https://auth.openai.com/api/accounts/oauth/token`, validação do
ID token por JWKS (iss/aud/exp/nonce + match de identidade em reautorização),
registro de credencial por `client_id` emitido (`oaiapp_…`) e detecção do escopo
`chatgpt.tokens.use.direct`;
(3) credencial OAuth no backend (nunca no renderer), refresh rotativo
single-flight **e** serializado contra outras instâncias, revogação no sign-out
preservando o mapping conta/`client_id` para o próximo login, mensagens de
reautenticação;
(4) inferência em `POST https://api.openai.com/v1/responses` com `store:false`,
`stream:true` e o perfil de restrições do caminho oficial; tools do Lumina
continuam sendo **function tools do cliente**;
(5) modelos disponíveis vêm de `GET https://api.openai.com/v1/models` da conta,
mesclados ao catálogo **no backend e no `CatalogView`** (parser dual
`models[]`/`data[]`), com cache local, flag `estimated` e resolução dinâmica no
harness, de modo que o picker e a seleção persistida funcionem mesmo com slugs
que não estão no catálogo embutido;
(6) UI em pt-BR seguindo as diretrizes de UX da OpenAI: card "Continuar com
ChatGPT" (duas fases: iniciar/aguardar/cancelar), estado da conta, selo "Plano
ChatGPT" no compositor/model picker, primeiro-login modal, e estado de limite
atingido com CTA "Gerenciar uso" (`https://chatgpt.com/settings/usage`) — sem
inventar medidor de cota nem assumir que o limite é do plano (pode ser
específico do app).

**Target-Perspective Output:** o usuário abre Configurações → Provedores, clica
em **Continuar com ChatGPT**, autentica no navegador (ou usa o link mostrado se o
navegador não abrir), volta ao app e vê a conta conectada ("usando seu plano
ChatGPT"). No seletor de modelos aparece o provedor OpenAI com os modelos que a
**conta dele** expõe; ele escolhe `gpt-6.1-sol`, envia uma mensagem com busca na
web ativa e recebe streaming com raciocínio e citação; a conversa grava
`provider_id="openai"`. Ao atingir o limite, o app mostra "Limite de uso
atingido — pode ser do seu plano ou deste app" com o botão primário **Gerenciar
uso** abrindo o ChatGPT; o app não sugere que a cota acabou para sempre nem tenta
novo login em loop. Em "Sair", o refresh token é revogado, a conta fica
"desconectada" (mapping retido) e um novo login reusa o `client_id` emitido; sem
login, o mesmo provedor continua utilizável colando uma API key `sk-…` da
plataforma.

**Truth Owner:**
- `src-tauri/src/catalog.rs` + `data/catalog.json` + `src/lib/catalog.ts` — fonte
  única de provedores, endpoints, perfis de request e modelos;
- `src-tauri/src/oauth/**` (novo) — **sem I/O de disco**: host id, registros,
  refresh, revogação, validação de ID token (estado em memória + `AppState`);
- `src-tauri/src/config.rs` — **única** fonte de leitura/escrita do arquivo de
  segredos (v2) e do host id;
- `src-tauri/src/state.rs` — cache de modelos dinâmicos por provedor;
- `src/lib/store/appStore.ts` + `src/lib/catalog.ts` — espelho do status de auth
  e da lista de provedores/modelos mesclada (somente leitura, nunca tokens).

**Contract Boundary:** IPC novo em duas fases (evita `invoke` bloqueado por
10 min e permite mostrar "reabrir link"), **todos registrados em
`src-tauri/src/lib.rs:40-76`**: `openai_login_start(provider_id,
force_consent) -> LoginChallenge { attempt_id, auth_url, expires_at }`;
`openai_login_wait(attempt_id) -> ProviderAuthStatus` (**`async`**, aguarda até
10 min); `openai_login_cancel(attempt_id)`; `openai_sign_out(provider_id)`
(**`async`**: revogação HTTP + backoff); `openai_auth_status() ->
Vec<ProviderAuthStatus>`; `refresh_provider_models(provider_id) -> CatalogView`
(**`async`**: GET `/v1/models`). Os 6 wrappers vivem em
`src-tauri/src/commands/oauth.rs` (novo) e são registrados em
`commands/mod.rs` + `lib.rs`.
`CatalogView` passa a ser a **visão mesclada** (catálogo embutido +
modelos dinâmicos de `AppState`), e `SettingsView`/`CatalogView` ganham
`auth: Vec<ProviderAuthStatus>`; `ModelInfo` ganha `estimated: bool`
(`#[serde(default)]`) e `ProviderInfo` ganha `auth`, `request_profiles`,
`oauth` — todos `#[serde(default)]` para catálogos antigos continuarem subindo.
`ProviderKeyStatus` ganha `mode` e a fonte `"chatgpt"`; `has_key=true` quando
existe **credencial utilizável sem rede** (API key ou registro OAuth com refresh
token), não "access token válido agora". `TurnEvent::Error` já tem `code`
(`events.rs:62-66`) e passa a preenchê-lo, mais `hint: Option<String>`.
`ProviderConfig` ganha `endpoints`, `request_profile` e `auth_mode`.
O contrato externo da OpenAI está na §1 (docs oficiais + discovery document).

**Cutover:** o caminho "só API key" deixa de ser o único; a resolução de
credencial do harness passa a ser `Credential` (API key **ou** bearer OAuth) e o
perfil de request deriva da credencial. Os caminhos fixos por protocolo
(`CHAT_PATH`/`RESPONSES_PATH`/`ANTHROPIC_PATH`/`GOOGLE_MODELS_PATH`) são
**removidos**; todo adaptador usa `endpoints` do catálogo (Go/Zen já os
declaram). O formulário de chave em Provedores vira um bloco "conta ChatGPT" +
"API key alternativa" no mesmo card. A lista estática de modelos OpenAI (seed) é
mesclada com a lista viva da conta no backend, e o renderer consome a visão
mesclada.

**Displaced Path:** `ProviderInfo` sem auth; `SecretsFile.providers` como único
formato; `config::api_key()` síncrono como única credencial; constantes de
caminho em `providers/mod.rs`; `keys.find(hasKey)` como única noção de "provedor
pronto"; texto do WelcomeScreen que cita só "OpenCode Go e Zen"; favoritos
indexados só por `model.id`.

**Value Density:** alta. É o pedido central do usuário: usar a assinatura que ele
já paga (ChatGPT Plus/Pro/Business) em vez de pagar API por token, com os modelos
OpenAI (incl. famílias Codex/Work do plano) no mesmo harness de ferramentas,
artefatos e UI generativa. Habilita também atualização contínua de modelos por
conta, sem release.

**Evidence Gate:** `pnpm typecheck`, `pnpm test`, `pnpm build`; `cargo check`,
`cargo test --lib`; prova de runtime do fluxo real (login + `/v1/models` +
`/v1/responses` com tool call) registrada em `EVIDENCE.md` com shapes capturados
e dados sensíveis redigidos; greps de kill criteria (§8) com as saídas coladas.

**Acceptance Evidence:** `EVIDENCE.md` com: (a) saída dos comandos acima; (b)
nomes dos testes que cobrem PKCE/state/nonce, refresh rotativo (inclusive
corrida entre threads/instâncias), request body do plano, resolução de
credencial, erros `subscription_sharing_*`, cache/merge de modelos, estados da
UI; (c) captura redigida do fluxo real (URL de authorize sem code, shape de
`/v1/models`, primeiro evento SSE e evento final `response.completed`, erro 429
real se obtido); (d) greps de kill criteria; (e) checklist manual de QA.

**Evidence Lane:** testes automatizados (Rust `cargo test --lib`; Vitest/jsdom) +
typecheck/build + um spike de runtime semiautomatizado
(`scripts/openai-plan-probe.mjs`, dev-only, token só em memória) para o contrato
externo. Sem automação de UI/navegador (proibida pelo AGENTS.md); QA visual
manual fica documentado como "implementado, não automatizado".

**Kill Criteria (todos verificáveis por comando/grep na §8):**
(a) nenhum uso de `chatgpt.com/backend-api*`, do `client_id` do Codex CLI
(`app_EMoamEEZ73f0CkXaXp7hrann`), do scope `api.connectors.*` ou de headers
`ChatGPT-Account-Id`/`originator`/`x-codex-*` — grep no diff deve dar zero;
(b) **um único módulo de auth (`oauth/**`) e uma única rotina de refresh**;
**um único writer do arquivo de segredos (`config.rs`)**; nenhuma cópia de token
em outro lugar — provado por grep + teste de serialização;
(c) nenhum token/refresh/id_token trafega no IPC, em log, em URL (exceto
`id_token_hint` no endpoint de authorize, com redação) ou no localStorage —
grep no renderer = 0 + teste de shape;
(d) **nenhuma constante de caminho sobra em `providers/`**; todos os endpoints
vêm do catálogo (grep = 0);
(e) nenhuma UI inventa percentual/reset de cota que a API não devolve — só CTA
para o dashboard quando não há dado;
(f) o caminho de API key (Go/Zen e OpenAI) continua funcionando e os testes
existentes passam;
(g) sem `todo!()`/`unimplemented!()`/mock no caminho de produção.

**Non-goals:**
- reproduzir o app/agent do ChatGPT Work (conectores hospedados, apps, tarefas
  agendadas, MCP hospedado, computer use, Code Interpreter, file search);
- reutilizar o login interno do Codex CLI ou o backend `chatgpt.com/backend-api`
  (não documentado para terceiros; contraria a doc oficial e os Termos de Uso);
- embutir o Codex app-server como motor (inverte a arquitetura do harness);
- billing/créditos próprios, múltiplas contas simultâneas na v1 (formato
  suporta; UI de troca fica para depois), keychain do SO na v1 (ver D6);
- cálculo de custo por token (hoje nenhum provedor calcula; ver SF-7).

**Risk if wrong:** se o caminho oficial (SIWC OSS) não emitir `client_id` para
este app sem aprovação comercial, a feature de "plano ChatGPT" não funciona e
sobra a API key. Por isso a **Fase 0 é um gate**: provar em runtime com uma conta
real antes de escrever a feature. Se falhar, o plano reduz o escopo para
"OpenAI via API key" e registra o resultado — sem código morto nem flag
escondida. Risco secundário: o perfil de request do plano é "preview" e pode
mudar; por isso as restrições ficam centralizadas nos perfis de request e o erro
`subscription_sharing_unsupported_capability` é tratado como mudança de
contrato, não como bug.

**Architecture Slice:**
```
UI (ProvidersTab/ModelPicker/Composer)          ← ui-systems / ui-core (só componentes)
  └─ appStore (Lead) ── api.ts (Lead) ── IPC commands (Lead registra em lib.rs)
                                   ├─ openai_login_start / wait(async) / cancel / sign_out / status
                                   ├─ refresh_provider_models -> CatalogView mesclado
                                   └─ get_settings / get_catalog / validate_provider
Backend
  ├─ oauth/  (loopback + PKCE + state/nonce + token exchange + JWKS + refresh + revoke;
  │           SEM I/O de disco — usa config)
  ├─ config.rs (ÚNICO writer do arquivo de segredos: secrets v2 providers + oauth
  │             registrations + host id; RMW serializado, tmp único, corrupção
  │             não é sobrescrita)
  ├─ state.rs (AppState.oauth, AppState.dynamic_models; single-instance é
  │             plugin/lockfile na inicialização, não estado)
  ├─ commands/oauth.rs (wrappers #[tauri::command] dos 6 comandos; Lead)
  ├─ catalog.rs/data/catalog.json (provider "openai": auth, requestProfiles)
  ├─ providers/ (endpoints do catálogo, perfil por credencial, erros com code)
  └─ harness/ (Credential API key|OAuth, refresh+retry 1x em 401, ModelSource)
```

**Plan Review Gate:** revisão PRE **executada** (`docs/goals/openai-chatgpt-plan/REVIEW.md`):
veredito BLOCKED com 5 blockers + 18 should-fix. Este plano foi revisado para
endereçar **todos** os blockers e os should-fix; a disposição item a item está em
`docs/goals/openai-chatgpt-plan/REVIEW-RESPONSE.md`. Execução começa apenas pela
Fase 0; as Fases 1–5 só entram depois do gate passar (ou de o usuário aceitar
explicitamente o fallback "API key only"). Se algo do PLAN mudar de forma
material, re-revisar as linhas citadas no REVIEW (o arquivo foi comparado por
hash).

---

## 1. Contrato externo (o que a OpenAI documenta — fonte da verdade)

Fonte primária: documentação oficial "Sign in with ChatGPT → ChatGPT plan usage
(open-source/locally hosted apps)" (`https://developers.openai.com/siwc/`) +
discovery `https://auth.openai.com/.well-known/openid-configuration` +
verificação no código do `openai/codex` apenas para o que **não** é público
(registrado em `docs/research/openai-oauth.md`, com marcação de confiança).
Regra do plano: **só o caminho oficial é implementável**; nada de `backend-api`.

### 1.1 Endpoints

| Uso | Método/URL |
| --- | --- |
| Authorize | `GET https://auth.openai.com/api/accounts/authorize` |
| Token (code e refresh) | `POST https://auth.openai.com/api/accounts/oauth/token` (form-urlencoded) |
| Revoke (sign-out) | `POST <revocation_endpoint do discovery>` — hoje `https://auth.openai.com/api/accounts/oauth/revoke`, form (`token`, `token_type_hint=refresh_token`, `client_id`) |
| Discovery/JWKS | `GET https://auth.openai.com/.well-known/openid-configuration`, `…/jwks.json` |
| Listar modelos | `GET https://api.openai.com/v1/models` (`Authorization: Bearer <access_token>`) |
| Inferência | `POST https://api.openai.com/v1/responses` (Bearer, SSE) |

### 1.2 Autorização (primeiro login vs. reautorização)

Query params (todos URL-encoded):

| Param | Valor |
| --- | --- |
| `client_id` | `dynamic_agent_client` no **primeiro** registro; depois o `client_id` emitido (`oaiapp_…`) |
| `agent_name_hint` | `Lumina` — só no primeiro registro; omitir na reautorização |
| `ext_agent_host_id` | host id estável, opaco (`urn:uuid:<v4>` gerado uma vez por instalação) |
| `id_token_hint` | opcional na reautorização: ID token retido da conta (pode estar expirado) |
| `login_hint` | opcional: e-mail validado da conta |
| `response_type` | `code` |
| `redirect_uri` | `http://127.0.0.1:<porta>/auth/callback` — só a **porta** pode variar; host `127.0.0.1`, path exato, nunca `localhost` |
| `scope` | `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` |
| `resource` | `https://api.openai.com/v1` |
| `state` | aleatório novo por tentativa; validar no callback |
| `nonce` | aleatório novo por tentativa; validar no ID token |
| `code_challenge_method` | `S256` |
| `code_challenge` | base64url(SHA-256(verifier)) sem padding |

Callback esperado (novo registro):
`http://127.0.0.1:<porta>/auth/callback?code=…&scope=…&state=…&client_id=oaiapp_…`.
Regras: validar `state` **antes** de usar code/erro; `error=access_denied` →
parar sem trocar code; na reautorização o callback pode não trazer `client_id`
(manter o salvo) e um `client_id` diferente deve ser **rejeitado**; se o novo
registro não trouxer `client_id` emitido → registro incompleto.

**Reautorização/consentimento:** se o usuário negou o uso do plano ou o scope
`chatgpt.tokens.use.direct` não veio, manter o login de identidade e marcar
`plan_usage=false`; ao ativar depois, repetir OAuth com o `client_id` salvo e o
conjunto completo de escopos. O parâmetro OAuth `prompt=consent` **já é
suportado** hoje (usar nesse caso); `force_reconsent=true` só depois que a OpenAI
confirmar o rollout para a integração. Não forçar consent em login comum.

### 1.3 Token, validade e refresh

- Resposta 200: `access_token`, `refresh_token`, `id_token`, `token_type`,
  `expires_in` (3600), `scope`, `earliest_refresh_at`.
- Access token: 1 h. Refresh token: 30 dias, **rotativo** (cada refresh devolve
  um novo com +30 dias). Refresh: form com `grant_type=refresh_token`,
  `client_id` **emitido** (nunca `dynamic_agent_client`), `refresh_token`,
  `resource=https://api.openai.com/v1`; **omitir `scope`**.
- **Serializar refresh por sessão**, inclusive entre processos ("two processes
  do not race a rotating token"); usar o refresh token de substituição e persistir
  access+refresh+id+scopes+expiry juntos.
- ID token: validar assinatura via JWKS, `iss` = issuer do discovery,
  `aud` = `client_id` emitido, `exp`, `nonce`; identidade estável = `sub`.
  E-mail/`sub` **não** são workspace id; o par (identidade verificada +
  `client_id` emitido) separa registros. Em reautorização de uma conta salva,
  comparar `sub` (e `client_id`, se vier) com o registro selecionado antes de
  substituir credenciais; divergência → abortar sem ativar.
- Sign-out: revogar o refresh token (`revocation_endpoint`; 200 vazio = sucesso;
  retry com backoff 2–3× enquanto o token existir; se falhar, limpar local e
  avisar que a revogação remota não foi confirmada). **Reter o mapping**
  `{clientId, subject, email, issuer, hostId}` para o próximo login reusar o
  `client_id` emitido; só os tokens são apagados.
- Claims do access token: `sub`, `aud=https://api.openai.com/v1`, `client_id`,
  `scope`, `https://api.openai.com/auth` (metadados **opacos**), `iss`, `iat`,
  `exp`, `jti`, `nbf`. **Não** assumir `chatgpt_plan_type`/`chatgpt_account_id`
  neste fluxo (são do fluxo interno do Codex). Logo: a UI **não** mostra nome de
  plano ("Plus/Pro") — mostra "conta conectada" + "Plano ChatGPT" genérico.

### 1.4 Requisição de inferência (perfil `chatgpt-plan`)

**Obrigatório:** `Authorization: Bearer <access_token>`; `store: false`;
`stream: true`; `input` como array com todo o contexto (sem
`previous_response_id`); system prompt via `instructions` (itens
`{type:"message", role:"system"}` são **rejeitados**).

**Omitir sempre:** `background`, `conversation`, `max_output_tokens`,
`max_tool_calls`, `metadata`, `moderation`, `multi_agent`, `prompt`,
`prompt_cache_retention`, `safety_identifier`, `temperature`, `top_logprobs`,
`top_p`, `truncation`, `user`.

**Tools:** function/custom tools do cliente são suportadas (agrupadas em
namespaces ou via `additional_tools` — validar a forma exata no spike);
**não** suportadas: image generation, file search, Code Interpreter, computer
use, MCP/connectors hospedados, `tool_search`, `programmatic_tool_calling` no
topo. Inputs: texto/imagem/arquivo quando o modelo aceita; áudio/vídeo, Files
API e transcription fora.

**Raciocínio/replay:** como `store:false` e o histórico é reenviado, o replay de
itens `reasoning` só funciona se eles tiverem `encrypted_content`
(`providers/openai_responses.rs:156-167` filtra os demais). Por isso o perfil
`chatgpt-plan` envia `include: ["reasoning.encrypted_content"]` e o spike G4b
valida se a rota aceita; se a rota rejeitar, o fallback documentado é descartar
itens de reasoning no replay (loop multi-step continua funcionando, perde
continuidade de raciocínio entre passos).

**Streaming:** sucesso só em `response.completed`; tratar `response.failed`
(inclusive erro de cota **depois** do stream começar), `response.incomplete` e
stream interrompido como distintos.

### 1.5 Erros e limites

Admissão direta antes do stream pode vir sem objeto `error`
(`{"detail":"…"}`): 401 (identidade/permissão), 403 (política/região), 503
(rota indisponível).

Códigos estruturados relevantes:

| `error.code` | HTTP | Ação no app |
| --- | --- | --- |
| `subscription_sharing_user_not_eligible` | 403 | explicar restrição; **não** repetir request/login |
| `subscription_sharing_usage_limit_exceeded` | 429 | pausar requests do plano; CTA "Gerenciar uso"; não assumir que o limite é do plano nem inferir reset |
| `subscription_sharing_usage_unavailable` | 503 | backoff limitado |
| `subscription_sharing_unsupported_capability` | 400 | remover field/tool/modelo do request; erro acionável (mudança de preview) |
| `subscription_sharing_route_not_supported` | 403 | bug de rota/método (usar `POST /v1/responses`) |
| `subscription_sharing_invalid_user` | 401 | diagnosticar credencial; pedir login após revogação |
| `chatpass_v2_scope_not_authorized` / `chatpass_v2_invalid_authorization_context` | 403 | grant/config; não trocar billing |
| `subscription_sharing_user_unavailable` | 503 | backoff |

Refresh: `invalid_grant`, `invalid_refresh_token`, `token_expired`,
`refresh_token_expired`, `refresh_token_invalidated`, `refresh_token_reused` →
**relê o store e tenta 1×** (pode ser corrida entre instâncias); se persistir,
limpar tokens e repetir OAuth com o `client_id` retido; `invalid_client` → erro
de configuração.

**Limites do plano (comportamento do produto, para a UI):** Plus tem cota de 5 h
**compartilhada entre todos os apps** que usam o plano (incluindo Codex e ChatGPT
Work; nenhum app ganha cota separada); Pro não tem limite de 5 h (limites
semanais podem valer). **Um limite específico do app também pode existir**
(weekly 10–100% configurado pelo usuário em ChatGPT Settings), então a copy não
pode afirmar "sua cota do plano acabou": "Limite de uso atingido — pode ser do
seu plano ou deste app". "Gerenciar uso" = `https://chatgpt.com/settings/usage`.
Não existe API pública de "quanto resta" no SIWC: a UI mostra link, não medidor.

### 1.6 Por que não o OAuth/backend do Codex CLI

`client_id app_EMoamEEZ73f0CkXaXp7hrann`, `https://auth.openai.com/oauth/*`,
scope `api.connectors.*` e `https://chatgpt.com/backend-api/codex/*` são
implementação **interna** do Codex CLI. Não há autorização pública para
terceiros; a doc do próprio SIWC diz para **não** apontar o fluxo de plano para
`backend-api`; e os Termos de Uso vedam contornar limites/proteções. Portanto:
**não implementar** (nem atrás de flag) — o custo jurídico/técnico não compensa e
o caminho oficial já entrega o que o usuário quer (usar a assinatura).

---

## 2. Contrato interno (arquivos, tipos, IPC)

### 2.1 Catálogo (`data/catalog.json`, `catalog.rs`, `catalog.ts`, `types.ts`)

Novo provedor (valores exatos; `scripts/build-catalog.mjs` passa a gerá-lo a
partir de `.research/models-dev.json` → provider `openai`, com filtro de modelos
de chat, `--provider openai` para atualizar só esse provedor e overrides):

```json
{
  "id": "openai",
  "name": "OpenAI (ChatGPT)",
  "shortName": "ChatGPT",
  "description": "Modelos OpenAI usando o plano ChatGPT da sua conta (Sign in with ChatGPT) ou uma API key da plataforma.",
  "baseUrl": "https://api.openai.com/v1",
  "consoleUrl": "https://chatgpt.com/settings/usage",
  "endpoints": { "openai-responses": "/responses", "models": "/models" },
  "auth": "oauth",
  "requestProfiles": { "oauth": "chatgpt-plan", "apiKey": "standard" },
  "authEnv": "OPENAI_API_KEY",
  "defaultModelId": "gpt-6.1-sol",
  "oauth": {
    "issuer": "https://auth.openai.com",
    "discoveryUrl": "https://auth.openai.com/.well-known/openid-configuration",
    "registrationClientId": "dynamic_agent_client",
    "agentNameHint": "Lumina",
    "resource": "https://api.openai.com/v1",
    "scopes": ["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"],
    "planUsageScope": "chatgpt.tokens.use.direct",
    "callbackPath": "/auth/callback",
    "loopbackHost": "127.0.0.1"
  },
  "models": [ "… modelos de chat com protocols:[\"openai-responses\"], reasoningOptions, attachment, contextWindow, maxOutput, family: \"gpt\" …" ],
  "notes": ["O uso consome o limite do seu plano ChatGPT (o mesmo pool dos apps, Codex e ChatGPT Work)."]
}
```

Tipos Rust novos (catalog.rs, **todos com `#[serde(default)]`** para o catálogo
v1 atual continuar carregando):
```rust
#[derive(Default, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderAuth { #[default] ApiKey, Oauth }

#[derive(Default, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RequestProfile { #[default] Standard, ChatgptPlan }

#[derive(Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RequestProfiles { pub oauth: Option<RequestProfile>, pub api_key: Option<RequestProfile> }

pub struct OAuthProviderInfo { issuer, discovery_url, registration_client_id,
    agent_name_hint, resource, scopes: Vec<String>, plan_usage_scope,
    callback_path, loopback_host }

// ProviderInfo ganha:
#[serde(default)] pub auth: ProviderAuth,
#[serde(default)] pub request_profiles: RequestProfiles,
#[serde(default)] pub oauth: Option<OAuthProviderInfo>,
// ModelInfo ganha:
#[serde(default)] pub estimated: bool,   // metadados inferidos (slug fora do catálogo)
```
`endpoints` continua existindo e passa a ser **autoritativo** para todos os
protocolos (`models` é um endpoint extra, não protocolo).

**Famílias normalizadas para o conjunto já suportado**: `family: "gpt"` em todos
os modelos OpenAI (models.dev traz `gpt-sol`/`gpt-luna`/`gpt-astra`/`gpt-codex`;
o resolver de ícones só conhece `gpt`/`openai`/`codex`, e os testes de
`FamilyAvatar` comparam o conjunto **exato** de famílias do catálogo —
`src/lib/modelIcons.ts:86-121`,
`src/components/models/FamilyAvatar.test.tsx:109-116`).

**Política de id duplicado:** modelos `gpt-*` existem em Go/Zen **e** no provedor
OpenAI. O par `(providerId, modelId)` é sempre explícito no payload, na conversa,
no `provider_state` e nos favoritos. `catalog::find_provider_for_model` e
`findModel` viram **fallback de leitura** (documentado); nenhuma ação nova infere
provedor por id.

### 2.2 Segredos (`config.rs`) — v2 retrocompatível, **único writer**

```json
{
  "version": 2,
  "providers": { "opencode-go": "sk-…", "openai": "sk-…" },
  "oauth": {
    "openai": {
      "hostId": "urn:uuid:…",
      "activeClientId": "oaiapp_…",
      "registrations": {
        "oaiapp_…": {
          "email": "user@example.com", "issuer": "https://auth.openai.com",
          "subject": "<sub>", "clientId": "oaiapp_…", "extAgentHostId": "urn:uuid:…",
          "idToken": "<jwt>", "accessToken": "<jwt>", "refreshToken": "<opaque>",
          "tokenType": "Bearer", "expiresIn": 3600, "scopes": ["…"],
          "savedAt": "…", "earliestRefreshAt": "…", "planUsage": true,
          "disconnected": false
        }
      }
    }
  }
}
```
Regras (todas implementadas em `config.rs`; `oauth/**` **não** abre arquivo):
- leitura tolerante (v1 sem `version`/`oauth` = migração silenciosa); qualquer
  mutação de `providers` preserva o bloco `oauth` e vice-versa — o arquivo é
  relido inteiro **sob um `Mutex` global de RMW** antes de escrever;
- escrita atômica com **tmp único** (`secrets.<uuid>.tmp`) + `0600`; reutilizar
  `write_private` corrigido;
- **arquivo corrompido nunca é sobrescrito em silêncio**: `load` devolve erro,
  o conteúdo original é preservado e uma cópia `.bak` é criada antes de qualquer
  gravação futura. Como os comandos de leitura são síncronos e sem `Result`
  (`config::api_key`, `get_settings`, `get_catalog`), o erro é **lembrado em
  memória** (`config::secrets_error() -> Option<String>`), `api_key` devolve
  `None` e `SettingsView.secretsError` (campo novo, `#[serde(default)]`) leva a
  mensagem à UI; gravações são recusadas enquanto o arquivo estiver corrompido
  (só um reset explícito descarta);
- `key_from_env` passa a ser provider-aware: usa `ProviderInfo.authEnv`
  (`OPENAI_API_KEY` para `openai`, `OPENCODE_API_KEY` para Go/Zen), mantendo o
  comportamento atual como fallback; detecção de CLI continua só OpenCode;
- sign-out: limpa tokens, mantém `{clientId, subject, email, issuer, hostId}` e
  marca `disconnected: true` (mapping retido para reusar `client_id`).

### 2.3 Novos DTOs (domain.rs) e IPC

```rust
#[serde(rename_all = "camelCase")]
pub struct LoginChallenge { pub attempt_id: String, pub auth_url: String, pub expires_at: i64 }

#[serde(rename_all = "camelCase")]
pub struct ProviderAuthStatus {
  pub provider_id: String,
  pub mode: String,             // "oauth" | "api-key"
  pub state: String,            // "signed-in" | "signed-out" | "reauth-required" | "plan-disabled"
  pub account_label: Option<String>,   // email validado (nunca token)
  pub plan_usage: bool,         // scope chatgpt.tokens.use.direct concedido
  pub expires_at: Option<i64>,
  pub scopes: Vec<String>,
  pub client_id_masked: Option<String>,
  pub host_id_masked: Option<String>,
  pub hint: Option<String>,     // mensagem acionável (ex.: "Entre novamente…")
}
```
- `SettingsView`/`CatalogView` ganham `auth: Vec<ProviderAuthStatus>`;
  `SettingsView` ganha também `secretsError: Option<String>`
  (`#[serde(default)]`) para o estado de `secrets.json` corrompido.
- `CatalogView.catalog` passa a ser o **catálogo mesclado** (estático +
  `AppState.dynamic_models`); `refresh_provider_models` devolve `CatalogView`.
- `ProviderKeyStatus` ganha `mode: String` e a fonte `"chatgpt"`; `has_key=true`
  quando há **credencial utilizável sem rede** (API key ou registro OAuth com
  refresh token), não "access token válido agora". `masked` continua existindo
  apenas para API key — **nunca** derivado de access/refresh token; o card OAuth
  usa `account_label` e ids mascarados.
- `TurnEvent::Error` **já** tem `code: Option<String>` (`events.rs:62-66`, hoje
  sempre `None`): passa a ser preenchido (`auth_required`, `rate_limited`,
  `plan_not_eligible`, `unsupported_capability`, `reauth_required`) e ganha
  `hint: Option<String>` (`#[serde(default)]`). Nenhum campo existente muda de
  nome. Esses DTOs são serialize-only: não adicionar `Deserialize` só para teste
  (testar o shape serializado).
- Comandos novos (duas fases), **registrados em `lib.rs`**:
  `openai_login_start(providerId, forceConsent) -> LoginChallenge` (inicia
  listener, gera state/nonce/PKCE, abre o browser e devolve a URL para o caso de
  o browser não abrir), `openai_login_wait(attemptId) -> ProviderAuthStatus`
  (**`async`**, aguarda até 10 min), `openai_login_cancel(attemptId)`,
  `openai_sign_out(providerId)`, `openai_auth_status() ->
  Vec<ProviderAuthStatus>`, `refresh_provider_models(providerId) ->
  CatalogView`. Args camelCase no IPC.
- Teste de registro (implementado em **T2.6**, quando as funções existem):
  `#[cfg(test)]` lê `include_str!("lib.rs")` e falha se um dos 6 nomes não
  estiver no `generate_handler!`.

### 2.4 Módulo `oauth/` (novo, `src-tauri/src/oauth/`) — sem I/O de disco

| Arquivo | Responsabilidade |
| --- | --- |
| `mod.rs` | API pública: `ensure_bearer`, `login_start/login_wait/login_cancel`, `sign_out`, `status`; `AuthError`; single-flight de refresh |
| `siwc.rs` | URLs/params do SIWC, discovery, troca de code, refresh, revoke |
| `pkce.rs` | verifier/challenge (S256), `state`, `nonce` (CSPRNG) |
| `jwt.rs` | JWKS (cache por `kid`), verificação RS256 + iss/aud/exp/nonce |
| `loopback.rs` | listener `127.0.0.1:0`, `GET /auth/callback`, página de sucesso/erro, timeout 10 min, cancelamento |

- Persistência/estado: `config.rs` (arquivo, RMW serializado) + `AppState`
  (attempts de login em memória, single-flight de refresh).
- Dependências: `jsonwebtoken` (reusa `ring` já presente) + **`getrandom`**
  (CSPRNG; já na árvore) — **não** adicionar `rand`. `sha2`, `base64`, `url`,
  `uuid`, `reqwest`, `tokio` já existem.
- **Single-instance (B1):** adicionar `tauri-plugin-single-instance` em T0.2 (ou
  lockfile em `<app-data>` com erro amigável na segunda instância). Sem isso, o
  refresh rotativo entre processos pode invalidar a sessão. O fallback de
  `refresh_token_reused` (relê e tenta 1×) é obrigatório de qualquer forma.
- Sem plugin Tauri novo para o browser: `tauri-plugin-opener` já instalado; o
  loopback usa `tokio::net`.
- Nenhum token/URL de authorize é logado; `id_token_hint` só vai ao endpoint de
  authorize e a URL é redigida em logs/diagnósticos.

**Ordem de resolução de credencial (uma regra só, no backend):**
1. registro OAuth ativo do provedor **com** `planUsage=true` e refresh token
   (access token renovável) → `Bearer <access_token>`;
2. API key salva do provedor (`secrets.json`) → `ApiKey`;
3. variável de ambiente do provedor (`ProviderInfo.authEnv`, ex.
   `OPENAI_API_KEY`) → `ApiKey`;
4. **detecção do OpenCode CLI** (`~/.local/share/opencode/auth.json`, só para
   Go/Zen, comportamento atual preservado) → `ApiKey`;
5. nenhuma → `AuthError::Missing`, com mensagem acionável.
API key e OAuth podem coexistir; a UI mostra qual está em uso e "Sair" do OAuth
volta para a API key (sem apagar a chave). `planUsage=false` não é credencial
(cai para 2/3/4).

### 2.5 Provider/harness

- `ProviderConfig` ganha `endpoints: HashMap<String,String>`,
  `request_profile: RequestProfile`, `auth_mode: ProviderAuth` e
  `extra_headers: Vec<(String,String)>`. O harness constrói o request em **dois**
  lugares (loop normal em `harness/mod.rs:294-312` e resposta final forçada em
  `:564-582`); ambos usam o mesmo helper de credencial/headers.
- O **perfil deriva da credencial** (SF-2): `Credential::ApiKey → Standard`,
  `Credential::Bearer → request_profiles.oauth (chatgpt-plan)`.
- Adaptadores usam `endpoint_for(protocol)`; as constantes
  `CHAT_PATH`/`RESPONSES_PATH`/`ANTHROPIC_PATH`/`GOOGLE_MODELS_PATH` são
  **removidas**. Google: o endpoint do catálogo é
  `/google/v1beta/models/{model}` e o adaptador substitui `{model}` e mantém o
  sufixo `:streamGenerateContent?alt=sse` (regressão obrigatória: 9 modelos
  `google` em Go/Zen).
- Headers dirigidos pelo provedor: `x-opencode-session` **somente** nos
  provedores OpenCode (hoje `send_stream` manda para qualquer um,
  `providers/mod.rs:338-340`); `Authorization: Bearer` sempre; `User-Agent`
  Lumina; nenhum header interno do ChatGPT/Codex.
- `openai_responses.rs`: se o perfil for `ChatgptPlan`, aplica whitelist de
  campos, força `store:false`/`stream:true`, envia
  `include:["reasoning.encrypted_content"]` (condicionado ao probe G4b), nunca
  envia `{role:"system"}` nem `previous_response_id`; se for `Standard`,
  comportamento atual preservado.
- Harness: `Credential` (ApiKey/Bearer) resolvida **antes de persistir a
  mensagem do usuário**; em 401 com OAuth → `oauth::force_refresh` + **1 retry**;
  `RateLimited`/`PlanLimit` → `TurnEvent::Error` com `code`/`hint`.
- Modelos: `AppState.dynamic_models: RwLock<HashMap<String, DynamicModelSet>>`
  + `models-cache.json` (por provedor, `fetchedAt`); `state.model(provider,
  model)` resolve dinâmico → catálogo; `AppState.models(provider)` mescla;
  `CatalogView` serializa a visão mesclada; `HarnessDeps` ganha
  `model_source: Arc<dyn ModelSource>` (impl real: `AppState`; testes: catálogo
  estático). Slugs remotos desconhecidos recebem `ModelInfo` conservador com
  `estimated: true`.
- Nenhum cálculo de custo é adicionado (hoje `make_usage` sempre devolve
  `cost: None`, `providers/mod.rs:451-471`); a UI esconde preço quando
  `auth=oauth`/`plan_usage` por decisão de apresentação, não por `usage.cost`.

---

## 3. Tarefas

Legenda: **[paralelo]** = pode rodar junto; **depende de** = bloqueio real.
Owners seguem `AGENTS.md`, que é **atualizado antes da Fase 1** (T0.2) para criar
as linhas de `src-tauri/src/oauth/**`, `scripts/**`, `src/lib/modelMenu.ts` e
`src/lib/store/**` (Lead). Nenhuma task edita arquivo de outra área sem o Lead.

### Fase 0 — Gate de viabilidade e pré-requisitos (fazer primeiro)

**T0.1 Spike SIWC real** — owner: Lead (revisão: provider-mapper)
- Criar `scripts/openai-plan-probe.mjs` (dev-only, fora do bundle): sobe
  loopback em porta efêmera, imprime a URL de authorize, recebe o callback,
  troca o code, **lê/confere os claims** do ID token (`iss/aud/exp/nonce` e
  `sub`; validação de assinatura/JWKS é T2.1, não do probe), e então:
  `GET /v1/models`; `POST /v1/responses` texto; `POST` com function tool;
  `POST` com `temperature` (espera 400); `POST` com
  `include:["reasoning.encrypted_content"]`; leitura de headers/erros. Token só
  em memória/arquivo temporário fora do repo; nada de log de token.
- Registrar em `docs/research/siwc-probe-results.md`: shapes (redigidos),
  decisão e evidências.
- **Gate G1** registro dinâmico emite `client_id` sem aprovação comercial?
  **G2** `/v1/models` devolve `models[]` com `slug`/`display_name`/`visibility`?
  **G3** streaming em `/v1/responses` funciona com o token? **G4** function tool
  call é aceito (qual forma: flat, namespace, `additional_tools`)? **G4b**
  `include:["reasoning.encrypted_content"]` é aceito? **G5a** o scope
  `chatgpt.tokens.use.direct` é concedido? **G5b** (informativo) capturar o shape
  de um 429 `subscription_sharing_usage_limit_exceeded` **quando ocorrer** — não
  é obrigatório reproduzir; o mapeamento é coberto por HTTP fake em T3.2.
- Se G1 falhar: o usuário decide entre (a) pedir acesso/`client_id` de parceiro
  via formulário SIWC, ou (b) reduzir a feature a "OpenAI via API key" e
  registrar a decisão. Sem implementar `backend-api` em nenhum caso.
- Se G4 falhar na forma flat: adaptar o builder para namespace/`additional_tools`
  antes de seguir; se tools forem inviáveis na rota, reavaliar escopo (app com
  tools é requisito) e registrar bloqueio.

**T0.2 Ownership + single-instance + AGENTS** — owner: Lead
- Atualizar `AGENTS.md` (tabela de estrutura/ownership): `src-tauri/src/oauth/**`,
  `src-tauri/src/commands/oauth.rs`, `scripts/**`, `src/lib/modelMenu.ts`,
  `src-tauri/Cargo.toml` (Lead), e explicitar que `src/lib/store/**`, `types.ts`,
  `api.ts`, `catalog.ts`, `lib.rs`, `commands/{mod,turn,models}.rs` são Lead.
- Adicionar `tauri-plugin-single-instance` (é plugin Rust: **sem comando nem
  capability**; registrar **antes** dos demais plugins no builder; segunda
  instância foca a janela existente). Fallback aceitável: lockfile em
  `<app-data>` com erro amigável; se usar lockfile, tratar lock obsoleto de
  crash (PID/checagem por instância) para não travar o app depois de um kill.
- Testar o comportamento de segunda instância.
- Atualizar `docs/goals/openai-chatgpt-plan/PLAN.md` se qualquer linha do REVIEW
  deixar de valer (hash/section ids).

### Fase 1 — Contratos e catálogo

**T1.1 Tipos de provedor + catálogo OpenAI** — owner: Lead; [paralelo] com T1.2
- `src-tauri/src/catalog.rs` (ProviderAuth, RequestProfile, RequestProfiles,
  OAuthProviderInfo, `estimated`; campos novos em `ProviderInfo` **com
  `#[serde(default)]`**), `data/catalog.json` (provedor `openai` com seed de
  modelos de chat do models.dev), `src/lib/types.ts`, `src/lib/catalog.ts`
  (helpers `providerAuthMode`, `providerSupportsPlan`,
  `findProviderIn(list, id)`), `scripts/build-catalog.mjs` (emite `openai`;
  filtro de modelos chat; `--provider openai`; overrides).
- Famílias normalizadas para `"gpt"` (ver §2.1).
- Testes: `catalog.rs` parseia o JSON embutido (incluindo fixture v1 **sem** os
  campos novos — `#[serde(default)]` não pode panizar o boot); acha
  `openai`/`gpt-6.1-sol`; `catalog.test.ts` valida `auth`,
  `requestProfiles.oauth === "chatgpt-plan"`, `requestProfiles.apiKey ===
  "standard"`, endpoints, modelos sem duplicata **dentro do provedor**,
  `defaultModelId` presente e família dentro do conjunto suportado; script
  rodado 2× gera JSON estável com Go/Zen byte-idênticos.
- Verificação: `cd src-tauri && cargo test --lib catalog`; `pnpm test catalog`.

**T1.2 Contrato IPC** — owner: Lead; [paralelo] com T1.1
- `src-tauri/src/domain.rs` (ProviderAuthStatus, LoginChallenge; campos em
  SettingsView — incl. `secretsError` —, CatalogView, ProviderKeyStatus),
  `events.rs` (preencher `code` existente + `hint` novo), `src/lib/types.ts`,
  `src/lib/api.ts` (6 chamadas). **Registro em `lib.rs` não entra aqui**: só
  depois que as implementações existirem (T2.6).
- `src/lib/catalog.ts`: helpers que operam sobre uma lista de provedores
  (`findProviderIn(list, id)`, `findModelIn(list, providerId, modelId)`,
  `defaultSelectionFrom(settings, list)`) para o renderer deixar de resolver
  modelos por import estático; `@/lib/catalog` continua como fallback.
- Política de id duplicado/favoritos (ver §2.1 e SF-11): a chave de favorito
  passa a ser `modelKey(providerId, modelId)` (helper em
  `modelMenu.ts:36-51`); leitura legada por id marca o modelo em **todos** os
  provedores que o expõem (documentado) e o próximo toggle reescreve em par.
  Implementação em T4.1 (Lead); esta task só fixa o contrato.
- Testes: shape serializado camelCase de `ProviderAuthStatus`/`LoginChallenge`
  (serialize-only — sem `Deserialize` só para teste); `SettingsView` sem `auth`
  continua serializando; `TurnEvent::Error` com/sem `code`/`hint`; helpers de
  lista com provider desconhecido.
- Verificação: `cargo test --lib domain`; `pnpm typecheck`; `pnpm test catalog`.

### Fase 2 — Núcleo OAuth

**T2.1 `oauth/{pkce,siwc,jwt}.rs` + deps** — owner: Lead
- `Cargo.toml`: `jsonwebtoken`, `getrandom` (não `rand`).
- PKCE S256, state/nonce com CSPRNG; builders de URL/form exatamente como
  §1.2–1.4; endpoints via discovery cacheado, fallback catálogo; ID token com
  JWKS por `kid`, skew ≤ 60 s; timeouts 10–15 s.
- Testes: vetor RFC 7636; URL/form completos e percent-encoded; discovery fake;
  JWT com fixture RSA test-only (válido, assinatura inválida, iss/aud/nonce
  errados, expirado).
- Verificação: `cargo test --lib oauth::`; `cargo check` no Windows/MSVC.

**T2.2 Store de credenciais v2 (único writer)** — owner: storage-dev;
depende de T1.2
- `config.rs`: `SecretsFile { version, providers, oauth }`; accessors
  `oauth_host_id/ensure_host_id`, `registrations`, `active`,
  `save_registration`, `remove_tokens_keep_mapping`; `api_key/set_api_key`
  intactos; **Mutex global de RMW**; tmp único; corrupção não sobrescrita +
  `.bak`; migração v1→v2; mutação de `providers` preserva `oauth` e vice-versa;
  `key_from_env` provider-aware (`authEnv`); detecção CLI só OpenCode.
- `oauth/**` **não** faz I/O de arquivo (usa estes accessors).
- Testes: v1→v2; 2 threads em RMW sem lost update; arquivo corrompido não é
  apagado (erro + `.bak`); tmp não sobra; sign-out mantém mapping e limpa tokens;
  `set_api_key` não apaga OAuth; env por provedor.
- Verificação: `cargo test --lib config`; grep de writer único (T5.1).

**T2.3 Loopback + login orchestration** — owner: Lead; depende de T2.1/T2.2
- `loopback.rs`: bind `127.0.0.1:0`, só `GET /auth/callback`, resposta HTML
  pt-BR, timeout 10 min, cancel, uma tentativa por vez.
- `login_start` gera attempt (id/state/nonce/verifier/redirect efêmero), abre o
  browser e devolve `LoginChallenge`; `login_wait` (async) valida state, troca
  code com `client_id` do callback vs. salvo, valida JWT **e compara `sub`
  (e `client_id`) com o registro selecionado** antes de ativar; `login_cancel`
  derruba listener e limpa attempt; `status` deriva do store (sem rede).
- `force_consent` → `prompt=consent`; `force_reconsent` só após confirmação.
- Testes: callback feliz; state errado → 400 sem troca; `access_denied` →
  `plan-disabled`; `client_id` divergente → rejeita; identidade (`sub`)
  divergente → aborta sem sobrescrever; timeout/cancel; attempt desconhecido;
  segundo login concorrente.
- Verificação: `cargo test --lib oauth::loopback`.

**T2.4 Refresh single-flight + serialização** — owner: Lead; depende de T2.2
- `ensure_bearer`: checa exp/`expires_in`/`earliest_refresh_at`, refresh na
  janela (60 s antes), `Mutex` por sessão **+ RMW do config**; relê o registro
  antes de gravar (rotativo), persiste access+refresh+id+scopes+expiry juntos;
  `force_refresh` para 401; em `refresh_token_reused` relê e tenta 1×;
  classificação de erros (`invalid_grant`/`*_expired`/`*_reused`/
  `*_invalidated` → `ReauthRequired`; `invalid_client` → config).
- Testes: concorrentes em processo = **um** POST; rotação salva o novo refresh;
  antes de `earliest_refresh_at` não dispara; cada erro vira estado certo;
  reused → releitura + retry único; falha transitória preserva credencial.

**T2.5 Sign-out + revogação** — owner: Lead; depende de T2.3
- `sign_out`: antes de revogar, `state.cancel_all()` (o `AppState` só registra
  `turn_id -> CancellationToken`; não há provider associado — cancelar todos é a
  opção explícita e segura, e sign-out é ação rara). POST revoke (form) com
  backoff 2–3×; sucesso/5xx → limpa tokens e **mantém mapping**
  (`disconnected: true`); falha definitiva → limpa local e devolve
  `revocation: "unconfirmed"`.
- Testes: sucesso; falha transitória→retry→sucesso; falha definitiva→unconfirmed;
  mapping retido e próximo login reusa `clientId`; outro registro intacto;
  turno em andamento é cancelado antes de revogar.

**T2.6 Wire IPC dos comandos de auth** — owner: Lead; depende de T2.3/T2.5/T3.4a
- Criar `src-tauri/src/commands/oauth.rs` com os 6 wrappers
  `#[tauri::command]` (`login_start`, `login_wait` **async**, `login_cancel`,
  `sign_out` **async**, `auth_status`, `refresh_provider_models` **async**),
  args camelCase, retornos tipados; registrar em `commands/mod.rs` e `lib.rs`
  (depois que as funções existem — evita `cargo test --lib` quebrado na Fase 1).
- Teste `include_str!("lib.rs")` garantindo que os 6 nomes estão no
  `generate_handler!`; teste de assinatura/args via handlers compilados.
- Verificação: `cargo check`; `cargo test --lib commands::oauth`.

### Fase 3 — Provider, harness e modelos dinâmicos

**T3.1 Endpoints do catálogo + perfis de request** — owner: provider-dev;
depende de T1.1
- `providers/mod.rs`: ProviderConfig com endpoints/profile/auth/headers; helper
  `endpoint_for`; `send_stream` aceita headers extras e envia
  `x-opencode-session` **somente** OpenCode; remover as constantes de caminho.
- `providers/openai_responses.rs`: perfis `Standard` (comportamento atual) e
  `ChatgptPlan` (whitelist, store/stream, instructions, include condicional);
  `google.rs` usa `{model}` do catálogo + sufixo SSE.
- Testes: snapshot do body `chatgpt-plan` (sem campos proibidos;
  store/stream/instructions) e `Standard` (inalterado); **`include` só entra no
  snapshot se o G4b tiver aprovado** (senão registrar o fallback de descarte de
  reasoning); regressão Go/Zen de caminho/headers; regressão Google (9 modelos)
  com placeholder; verificação de que nenhuma referência às constantes antigas
  sobra.
- Verificação: `cargo test --lib providers`.

**T3.2 Erros de plano/roteamento** — owner: provider-dev; depende de T3.1
- `ProviderError` ganha variantes com `code` (`PlanLimit`, `PlanNotEligible`,
  `UnsupportedCapability`, `AuthRequired`, `RouteNotSupported`); parser tolera
  `{"detail":…}` e `{"error":{"code":…,"param":…}}`; mapeia §1.5.
- Testes com HTTP fake local: 429 cota, 403 inelegível, 400 capability (com
  `param`), 401 sem code, 503.

**T3.3 Credencial no harness + retry 401** — owner: harness-dev; depende de T2.4;
**vem antes de T3.4a** (é aqui que `HarnessDeps` ganha os campos/traits)
- Resolver credencial async, perfil derivado da credencial, dois pontos de
  construção; resolução **antes de persistir a mensagem do usuário**; retry
  único em 401 via `force_refresh`; `code`/`hint` no erro; `HarnessDeps` ganha
  `credentials`/`model_source` (`Option`, default `None` = API key + catálogo).
- Não adiciona cálculo de custo (ver §2.5); a UI decide a apresentação.
- Testes com `ProviderStreamer` falso: OAuth no request; 401→refresh→retry→ok;
  401 duplo→login; 429→code/hint; API key→perfil Standard; nada persistido
  quando falta credencial.

**T3.4a Modelos dinâmicos — backend/contrato** — owner: Lead;
depende de T1.1/T2.4/**T3.3**
- `state.rs`: `dynamic_models` + carga/gravação de `models-cache.json`;
  `commands/models.rs`: `refresh_provider_models` (bearer, parser dual,
  `visibility=="list"`, merge com catálogo, `estimated`), `catalog_view()`
  devolve a visão mesclada, `get_catalog/refresh_catalog/list_remote_models`
  auth-aware (sem tocar em `commands/settings.rs`); **`commands/turn.rs`**
  (Lead) conecta `credentials`/`model_source` reais ao `HarnessDeps` criado em
  T3.3; `commands/models.rs` é o único lugar que monta `CatalogView`.
- Testes: parser dual; merge preserva ordem; cache sobrevive a restart;
  `CatalogView` inclui slug remoto; boot com catálogo estático.

**T3.4b ModelSource no harness** — owner: harness-dev; depende de **T3.4a**
- `harness/mod.rs`: uso do `ModelSource` (provider/model + lista para validação)
  em `run_turn` e no replay; testes com fonte fake e catálogo estático.

**T3.5 Comandos settings auth-aware** — owner: storage-dev; depende de T2.4;
**sequencial a T3.4a** (arquivos disjuntos: só `commands/settings.rs`,
`config.rs`)
- `validate_provider`: credencial OAuth/API key; OpenAI → endpoint
  `endpoints["models"]` do catálogo (não `{base_url}/v1/models`: a base já é
  `…/v1`, então o hardcode atual de `commands/settings.rs:213` geraria
  `/v1/v1/models`); 401 → force refresh + 1 retry; mensagens por auth mode (sem
  copy de OpenCode); `set_provider_key`: validação/copy por auth mode (API key
  alternativa), preserva OAuth; `get_settings` monta `auth` **sem rede**.
- `reset_app_data` (D13, implementar): adquirir o Mutex de RMW do `config`,
  cancelar login/refresh pendentes (`oauth::cancel_all`) e só então chamar
  `config::reset_credentials()` + `config::reset_models_cache()` — **sem**
  literais de caminho em `commands/settings.rs` (mantém o grep de writer
  único); apaga `secrets.json` inteiro (API keys + OAuth) e
  `models-cache.json`, mantendo `settings.json`.
- Testes: validate oauth fake com base `…/v1`; set key OpenAI; reset durante
  login/refresh em voo não recria credenciais; status sem rede; OAuth
  sobrevive a `set_api_key`.

### Fase 4 — UI

**T4.1 Store/API de auth** — owner: **Lead** (dono de `store/**`/`api.ts`/
`modelMenu.ts`); depende de T1.2/T3.4a
- `appStore`: `auth`, `startChatGptLogin` (guarda `authUrl`), `awaitChatGptLogin`,
  `cancelChatGptLogin`, `signOut`, `refreshProviderModels`,
  `providerReady(providerId)`; `providers` vem do `CatalogView` mesclado e a
  seleção persistida é validada contra ele; `keys`/`hasKey` refletem OAuth;
  `secretsError` da SettingsView vira aviso no store.
- **Favoritos por par** (implementação do contrato de T1.2): `toggleFavorite`
  grava `modelKey(providerId, modelId)`; `isFavorite` aceita legado por id;
  migração/testes em `modelMenu.test.ts`.
- **Call sites estáticos** que hoje resolvem por `@/lib/catalog` e precisam usar
  o store/lista mesclada: `chatStore.ts:18,103,132,597`
  (`getModel`/`defaultSelection`) e `catalog.ts` helpers passam a aceitar lista.
  Componentes (`ModelTab.tsx:69,111`, `ModelPickerDialog.tsx:571-572`,
  `ModelPill.tsx:241,318`) são ajustados em T4.3 (ui-systems), consumindo os
  helpers novos.
- `api.ts`: 6 wrappers.
- Rótulos: `ProviderKeyStatus['source']` (`"chatgpt"`), `KEY_SOURCE_LABEL`,
  `keyStatusLabel` com "Conectado como…", "Sessão expirada", "Sem conta".
- Testes com `api` mockado: login ok/cancelado/reauth/plan-disabled/sign-out,
  refresh de modelos, seleção remota persistida após restart, favoritos
  por par + legado.

**T4.2 ProvidersTab (card OpenAI)** — owner: ui-systems; depende de T4.1
- Estados: sem login → **Continuar com ChatGPT** (primário) + "Usar API key" +
  texto sobre plano/limite + link de ajuda; aguardando → spinner + "Aguardando
  o navegador…" + **Cancelar** + **Abrir novamente** (reusa `authUrl`);
  conectado → e-mail, selo "Plano ChatGPT", "Gerenciar uso" (opener), **Sair**,
  detalhes (client id/host mascarados, escopos, expiração); `plan-disabled` →
  aviso + **Ativar uso do plano** (`prompt=consent`); erro → mensagem + retry;
  conta desconectada → "Conectar novamente" (reusa mapping).
- Primeiro login: modal de confirmação única ("Você está usando seu plano
  ChatGPT" / **Entendi**), persistido em settings (`openaiPlanNoticeShown`).
- Atualizar `AboutTab` (texto/console) — é ui-systems.
- Testes jsdom: todos os estados, a11y (`aria-label`, foco), chamadas corretas,
  mascaramento (sem token no DOM). **Criar `ProvidersTab.test.tsx`** (hoje não
  existe).

**T4.3 Model picker/pill/tab** — owner: ui-systems; depende de T3.4a/T4.1
- OpenAI no seletor; modelos da conta (mesclados) com busca/família; sem login →
  CTA "Conectar conta ChatGPT"; selo de plano no topo; `ModelTab` permite OpenAI
  como provedor padrão; badge `estimated` nos modelos inferidos; trocar os call
  sites estáticos (`ModelTab.tsx:69,111`, `ModelPickerDialog.tsx:571-572`,
  `ModelPill.tsx:241,318`) para os helpers do store (T4.1).
- **Favoritos**: só consumir a API do store (T4.1 implementa/migra); a UI não
  indexa por `model.id`.
- `ModelDetailPanel` mostra "conta não conectada" com ação de login e esconde
  preço por token quando `plan_usage` ("Incluído no seu plano ChatGPT" +
  "Gerenciar uso").
- Testes: provider tab, lista mesclada, CTA sem login, defaultProvider openai,
  favoritos por provedor + legado, badge `estimated`, regressão Go/Zen; atualizar
  fixtures que fixam contagens (`ModelPickerDialog.edge.test.tsx:149-183` espera
  38/82/120 e 2 abas).

**T4.4a Compositor/limite/copy** — owner: ui-core (só `components/**`)
- Selo "Plano ChatGPT" perto do seletor quando ativo (com "Gerenciar uso");
  banner/estado de limite com **Gerenciar uso** primário e copy
  "pode ser do plano ou deste app"; inelegível sem botão de retry;
  `WelcomeScreen` atualizado (a copy do `AboutTab` fica em T4.2, ui-systems).
- Testes: selo condicional, banner com
  `code=subscription_sharing_usage_limit_exceeded`, inelegível sem retry, gate
  desabilitado/habilitado (compositor consumindo `canSend` de T4.4b).

**T4.4b Gate de envio (store)** — owner: Lead (`chatStore`)
- `chatStore.canSend`/`providerReady`: desabilita envio quando o provedor ativo
  não tem credencial (OAuth ou API key), expõe motivo para o compositor; estado
  `auth_required` vindo do turno reabre o mesmo CTA; vale também para Go/Zen sem
  chave (D9).
- Depende de T4.1; o compositor (T4.4a) consome a flag.
- Testes do store: habilitado/desabilitado por tipo de credencial, reação a
  `auth_required`, Go/Zen sem chave.

**T4.5 Docs** — owner: Lead (ARCHITECTURE/MODELS/AGENTS/FILES/README) e
ui-systems (`docs/DESIGN.md`/`MODEL_SELECTOR_REDESIGN.md`); arquivos disjuntos
- `docs/ARCHITECTURE.md` (§3 diagrama, §6 catálogo, §7 provedores/auth, §12 IPC,
  §13 segurança, §15 testes, §16 decisão nova), `docs/MODELS.md` (seção OpenAI +
  fluxo de auth + restrições), `docs/DESIGN.md` (card/conta/limite),
  `docs/MODEL_SELECTOR_REDESIGN.md`, `docs/FILES.md:873`, `README.md`,
  `AGENTS.md` (já em T0.2, revisar), descrições em `Cargo.toml`/
  `tauri.conf.json`.
- Checar copy que assume "dois provedores" e "só API key"
  (`WelcomeScreen.tsx:81`, `AboutTab`, `ProvidersTab.tsx:100-107,222-226`,
  `ModelTab.tsx:131`, `usePaletteActions.ts:54`).

### Fase 5 — Verificação e evidência

**T5.1 Bateria completa** — owner: Lead
- `pnpm typecheck && pnpm test && pnpm build`; `cd src-tauri && cargo check &&
  cargo test --lib`; rodar `node scripts/build-catalog.mjs --provider openai` e
  confirmar diff esperado; revisão final de diff.
- **Greps de kill criteria (colar saídas em EVIDENCE.md):**
  - `rg -n 'backend-api|app_EMoamEEZ73f0CkXaXp7hrann|api\.connectors\.|x-codex-|ChatGPT-Account-Id|originator' src src-tauri` → vazio
  - `rg -n 'CHAT_PATH|RESPONSES_PATH|ANTHROPIC_PATH|GOOGLE_MODELS_PATH' src-tauri/src/providers` → vazio
  - `rg -l 'write_private|secrets\.json' src-tauri/src` → só `config.rs` (o
    reset chama `config::reset_credentials()`; nenhum literal de caminho em
    `commands/`)
  - `rg -n 'access_token|refresh_token|id_token' src/lib src/components` → vazio
  - teste Rust que serializa `ProviderAuthStatus`/`SettingsView`/`TurnEvent` e
    falha se aparecer qualquer token
- Gravar `EVIDENCE.md` (saídas, nomes de testes, capturas redigidas, checklist
  manual de QA: login, logout+relogin reusando client_id, troca de modelo, tool
  call, cota, reauth, API key).

---

## 4. Matriz de testes (mínimo aceitável)

| Área | Casos |
| --- | --- |
| PKCE/state/nonce | vetor RFC 7636; entropia/formatos; URL de authorize completa |
| Callback/loopback | sucesso; state errado; `access_denied`; code ausente; client_id divergente; `sub` divergente; timeout; cancelar; porta efêmera; só 127.0.0.1 |
| Token/refresh | form correto; 200→registro; rotação; single-flight; `earliest_refresh_at`; cada erro; reused→relê+retry; falha transitória não apaga |
| ID token | assinatura, iss, aud, exp, nonce; claims desconhecidas não quebram; `sub` como identidade |
| Store v2 | migração v1; permissões 0600; atomicidade com tmp único; RMW concorrente; corrupção preserva arquivo + `.bak` + `secretsError`; multi-registro; host id estável; sign-out retém mapping; reset durante login/refresh |
| Instância única | segunda instância foca a primeira (ou erro amigável); lockfile obsoleto após crash não trava |
| Request profile | perfil por credencial; sem campos proibidos; `store:false`; `stream:true`; `instructions`; `include`; tools; regressão Go/Zen/Google |
| Erros | 429 cota, 403 inelegível, 400 capability, 401, 503, `{"detail":…}` |
| Harness | OAuth no request; 401→refresh→retry; 401 duplo→login; code/hint no evento; nada persistido sem credencial |
| Modelos | parser dual; cache; merge no `CatalogView`; slug desconhecido (`estimated`); modelo removido; seleção remota após restart |
| IPC | 6 comandos em `commands/oauth.rs` registrados; `login_wait`/`sign_out`/`refresh_provider_models` async; args camelCase; DTOs sem token no shape |
| Credencial | ordem OAuth→secrets→env→OpenCode CLI→Missing; CLI preservada para Go/Zen |
| UI | todos os estados do card; modal único; CTA de limite; model picker; favoritos por par; gate de envio; sem vazamento de token |

## 5. Riscos e mitigações

| Risco | Prob. | Impacto | Mitigação |
| --- | --- | --- | --- |
| SIWC OSS exigir aprovação/comercial para este app | média | alto | Fase 0 gate; fallback API key documentado; formulário de interesse se necessário |
| Forma das tools no `/v1/responses` do plano diferir | média | alto | Spike G4; adaptar builder; se inviável, reavaliar escopo com o usuário |
| Lista de campos/tools proibidos mudar (preview) | alta | médio | Perfil centralizado; `unsupported_capability` vira erro acionável + teste |
| Rotação de refresh token corrompida por concorrência | média | alto | Single-flight + RMW serializado + reread + retry único em `reused` + testes |
| Duas instâncias do Lumina | baixa | alto | `tauri-plugin-single-instance`/lockfile (T0.2, com tratamento de lock obsoleto) + retry único em `reused` |
| Reset durante login/refresh em voo | baixa | alto | reset adquire Mutex de RMW + `oauth::cancel_all` antes de apagar (T3.5) |
| Regressão da detecção OpenCode CLI | baixa | médio | passo 4 da ordem de credencial + teste Go/Zen via CLI |
| `secrets.json` corrompido sobrescrito | baixa | alto | load com erro + `.bak`; nunca default silencioso; aviso em `SettingsView.secretsError`; teste |
| Cota de 5 h compartilhada esgota / limite do app | certa | baixo | UX honesta: CTA "Gerenciar uso"; copy "plano ou deste app"; sem retry loop |
| Tokens em arquivo simples | média | alto | 0600 atômico, sem IPC/log/URL; decisão D6 e hardening futuro |
| Porta loopback conflita | baixa | baixo | porta efêmera (só a porta pode variar); uma tentativa por vez |
| Cloudflare/rede no host de auth | baixa | médio | client reqwest normal; erros de rede claros; sem cookie store para backend-api |
| Modelos mudam por conta | alta | médio | catálogo dinâmico + cache + `estimated` |
| Regressão Google ao remover constantes | média | médio | teste explícito de `{model}` + sufixo SSE nos 9 modelos |

## 6. Decisões registradas

- **D1 — caminho oficial SIWC, não Codex CLI.** Ver §1.6. O usuário quer usar os
  limites da conta; o SIWC entrega isso e é o único suportado.
- **D2 — "Work" = pool de uso compartilhado, não API de Work.** O app consome o
  mesmo limite do plano via Responses; recursos hospedados do ChatGPT Work
  (conectores, apps, tarefas) estão fora de escopo por não terem API pública. A
  UI diz "Plano ChatGPT", não "Work".
- **D3 — API key no mesmo provedor, com perfil próprio.** `openai` aceita
  `sk-…` (perfil `standard`) como fallback e para usuários sem plano elegível;
  o perfil deriva da credencial, não do provedor (SF-2).
- **D4 — perfis de request explícitos no catálogo** (`requestProfiles`) +
  whitelist no adaptador; nada de `if provider == "openai"` espalhado.
- **D5 — endpoints do catálogo são autoritativos** para todos os provedores e as
  constantes de caminho são removidas (corrige dívida existente).
- **D6 — tokens em `secrets.json` 0600 (v1).** Mesmo modelo de ameaça das API
  keys atuais, sem dependência de keychain; hardening (Windows Credential
  Manager/macOS Keychain) fica como follow-up documentado. No Windows a
  proteção efetiva é o ACL de `%APPDATA%` (registrado).
- **D7 — sem app-server do Codex.** Inverteria o harness; rejeitado.
- **D8 — um registro ativo por provedor na v1**, formato com múltiplos registros
  (contas/workspaces) para evolução, sem UI de troca de conta na v1.
- **D9 — gate de envio com CTA.** Quando o provedor ativo não está autenticado,
  o compositor desabilita o envio com aviso e CTA para Conectar (ou colar API
  key), igual para Go/Zen sem chave; se expirar no meio do turno, o backend
  devolve `TurnEvent::Error{code:"auth_required"}` e a UI mostra o mesmo CTA.
  Implementação explícita em T4.4 (Lead `chatStore` + ui-core `Composer`).
- **D10 — modelos com mesmo id em provedores diferentes são permitidos.** O par
  `(providerId, modelId)` é a identidade; `find_provider_for_model`/`findModel`
  viram fallback; favoritos passam a ser por par, com leitura legada que marca
  todos os provedores que expõem o id (SF-11).
- **D11 — instância única do app (T0.2).** Refresh rotativo e o arquivo de
  segredos não são seguros entre processos; a segunda instância foca a primeira.
  Fallback de `refresh_token_reused` (relê + retry) cobre corridas residuais.
- **D12 — sign-out retém mapping, apaga tokens.** Próximo login reusa o
  `client_id` emitido e `id_token_hint`/`login_hint` quando existirem.
- **D13 — "Apagar dados" apaga segredos e cache.** `reset_app_data` passa a
  remover `secrets.json` (API keys + OAuth) e `models-cache.json`, mantendo
  `settings.json`; alinhado à copy do `DataTab.tsx:93` (SF-14).

## 7. Perguntas abertas (responder antes da execução)

1. O app será **open-source/local** (requisito do fluxo SIWC OSS) ou fechado?
   Se fechado, o caminho pode exigir aprovação — a Fase 0 decide.
2. "Codex e Work" = usar o **pool de uso** do plano para modelos OpenAI (escopo
   deste plano), ou você espera as **funcionalidades do ChatGPT Work**
   (conectores/apps/tarefas) dentro do Lumina? (não há API pública para o
   segundo).
3. Aceita a decisão D6 (`secrets.json` 0600) ou quer OS keychain na v1?
4. Confirmar Windows como alvo primário (o fluxo é multiplataforma; testes
   manuais em macOS/Linux ficam pendentes).
5. Aceita a instância única (D11)? Se não, será preciso lockfile de refresh entre
   processos na v1.

## 8. Checklist de PRE review (estado após revisão)

- [x] Fase 0 tem critérios G1–G5b objetivos e fallback escrito (SF-4).
- [x] Nenhum caminho `backend-api`/client_id do Codex em qualquer tarefa.
- [x] Um único store de token/refresh (`oauth/**`), um único writer de disco
      (`config.rs`), um único resolvedor de credencial (kill criteria (b)).
- [x] Contrato IPC cobre status/login/cancel/sign-out/refresh de modelos,
      `LoginChallenge`, `code`/`hint`, registro em `lib.rs`, `login_wait` async
      (B4) — e o renderer nunca recebe token.
- [x] Campos proibidos do request num lugar só (perfil) e testados; perfil por
      credencial (SF-2); `include` de reasoning (SF-3).
- [x] Migração de `secrets.json` v1→v2 testada; corrupção tratada; RMW
      serializado; instância única (B1).
- [x] Sign-out retém mapping / reauth compara identidade (B5).
- [x] Modelos dinâmicos chegam ao renderer via `CatalogView` mesclado (B2) e
      `estimated` no contrato.
- [x] Owners/escopos alinhados ao `AGENTS.md` com atualização prévia em T0.2
      (B3); tasks com arquivos disjuntos e dependências reais.
- [x] Kill criteria greppáveis com comandos concretos (SF-5).
- [x] Docs a atualizar listados; `AGENTS.md` atualizado antes da Fase 1.
- [x] Perguntas abertas §7 respondidas ou explicitamente aceitas.
