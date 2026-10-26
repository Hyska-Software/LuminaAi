# Disposição da PRE review — PLAN.md revisado

**Review original:** `docs/goals/openai-chatgpt-plan/REVIEW.md` (veredito
BLOCKED, 5 blockers, 18 should-fix, notes), sobre PLAN.md 849 linhas
SHA256 `44C1FD87…`.

**Primeira reescrita (endereçando os 5 blockers + 18 SF):** PLAN.md 1004 linhas
SHA256 `EFA8C195BF1492375074C60C45518685ACDF327BC89ABDB40964983E3BACC1D9`.

**Re-review (delta):** veredito BLOCKED (estreito) — B5 PASS; B1–B4 PARTIAL com
2 blockers de execução (RB1/RB2) + 8 should-fix (N1–N8), nenhum blocker de
arquitetura.

**Versão final após aplicar RB1/RB2/N1–N8:** PLAN.md 1079 linhas
SHA256 `AB0053D2D5E91B47A3D60808356ED3D20894A039B8D477C1A4163FC5E2840643`.
Todos os 5 blockers, os 18 should-fix e os RB/N estão endereçados. A trilha
completa está abaixo; a re-revisão incremental está no fim de `REVIEW.md`.

## Blockers

| ID | Achado | Disposição no plano revisado |
| --- | --- | --- |
| B1 | Dois writers em `secrets.json`; refresh rotativo sem serialização entre processos; tmp fixo; corrupção silenciosa; sem single-instance | §2.2: `config.rs` é o **único** writer; `oauth/**` não abre arquivo (tabela §2.4). RMW sob `Mutex` global, tmp único `secrets.<uuid>.tmp`, corrupção → erro + `.bak` (nunca default silencioso) + `SettingsView.secretsError` para a UI. T0.2 adiciona `tauri-plugin-single-instance` (ou lockfile); D11 registra a decisão. T2.4: `refresh_token_reused` → relê o store e tenta **1×** antes de pedir reauth. T5.1 prova single-writer por grep. |
| B2 | Modelos dinâmicos não chegavam ao renderer; `CatalogView` estático; `estimated` inexistente | Contract Boundary + §2.3: `CatalogView` passa a ser **visão mesclada** (catálogo + `AppState.dynamic_models`) e `refresh_provider_models -> CatalogView`; `ModelInfo.estimated` (`#[serde(default)]`). T3.4a (Lead) implementa merge/cache/`commands/turn.rs`; T4.1 (Lead) faz `appStore` resolver a seleção contra `providers` do view (não `@/lib/catalog` estático); T3.4b (harness-dev) `ModelSource`. Testes de slug remoto + restart. |
| B3 | Owners/escopos violando AGENTS.md; T3.4/T3.5 compartilhando arquivo; `modelMenu.ts` e `scripts/**` sem dono; AGENTS atualizado tarde | Fase 0 ganhou **T0.2** (Lead): atualiza `AGENTS.md` **antes** da Fase 1 (oauth/**, commands/oauth.rs, scripts/**, modelMenu.ts, Cargo.toml; explicitando store/types/api/catalog/lib/commands como Lead). T3.4 dividido em **T3.4a (Lead: state/commands models/turn)** e **T3.4b (harness-dev: harness)**. T3.5 (storage-dev) só toca `config.rs`/`commands/settings.rs` e é **sequencial** a T3.4a; refresh de catálogo/list_remote_models migra para T3.4a (arquivo do Lead). `AboutTab` movido para T4.2 (ui-systems). T4.1 é Lead; ui-systems/ui-core só componentes. Cada task lista arquivos e deps. |
| B4 | 6 comandos sem registro em `lib.rs`; `login_wait` não async; `LoginChallenge` sem DTO | Contract Boundary + §2.3: comandos listados; `openai_login_wait`/`openai_sign_out`/`refresh_provider_models` **`async`**; `LoginChallenge { attemptId, authUrl, expiresAt }` em `domain.rs`/`types.ts`; `openai_auth_status -> Vec<ProviderAuthStatus>`. Registro movido para **T2.6** (depois das implementações), com teste `include_str!("lib.rs")`. |
| B5 | Sign-out apagava o mapping; reauth sem match de identidade | §1.3 + §2.2 + T2.5: sign-out **retém** `{clientId, subject, email, issuer, hostId}` com `disconnected: true` (só tokens apagados) e o próximo login reusa o `client_id`; revoke com backoff 2–3×. T2.3: antes de ativar, compara `sub` (e `client_id`, se vier) com o registro selecionado; divergência → aborta sem sobrescrever. D12 registra. Testes: relogin reusa clientId; login em outra conta é rejeitado. |

## Should-fix

| ID | Achado | Disposição |
| --- | --- | --- |
| SF-1 | `ProviderInfo` novo sem defaults pode panizar o boot com catálogo v1 | §2.1: todos os campos novos com `#[serde(default)]`; teste com fixture v1 sem os campos; `CatalogFile::load` continua estrito nos obrigatórios. |
| SF-2 | D3 prometia perfil `standard` mas catálogo tinha um perfil só | §2.1 `requestProfiles { oauth, apiKey }`; §2.5 perfil derivado da credencial; T3.1/T3.3 testam os dois. |
| SF-3 | Replay de reasoning quebrado sem `include` | §1.4 + T0.1 (G4b) + §2.5/T3.1: perfil `chatgpt-plan` envia `include:["reasoning.encrypted_content"]`; fallback documentado (descartar reasoning no replay) se a rota rejeitar. |
| SF-4 | G5 não era pass/fail | T0.1: G5a (scope) é gate; G5b é informativo e o mapeamento do 429 é coberto por HTTP fake em T3.2. |
| SF-5 | Kill criteria não greppáveis | T5.1/Kill criteria: comandos concretos (constantes de caminho = 0, writer único = só config.rs, tokens no renderer = 0, teste de shape). |
| SF-6 | D9 sem task; premissa falsa sobre gating | D9 + T4.4a/T4.4b: gate implementado por Lead (`chatStore`) + ui-core (`Composer`), com testes; vale também para Go/Zen sem chave. |
| SF-7 | `usage.cost` era alegação sem base | Removido: §2.5/T3.3 dizem explicitamente que não se adiciona cálculo de custo; UI esconde preço por decisão de apresentação (`plan_usage`). |
| SF-8 | 429 tratado como "cota de 5 h" | §1.5 e T4.4a: copy "pode ser do plano ou deste app"; sem %/reset; CTA "Gerenciar uso". |
| SF-9 | `prompt=consent` contraditório | §1.2 corrigido: `prompt=consent` já suportado; só `force_reconsent` aguarda rollout. |
| SF-10 | `has_key` exigia access token válido | §2.3: `has_key` = credencial utilizável sem rede (API key ou registro com refresh token); expiração vive em `ProviderAuthStatus`. |
| SF-11 | Favoritos legados com id duplicado indefinidos | §2.1/D10 + T1.2/T4.1: leitura legada marca **todos** os provedores que expõem o id; toggle reescreve em par; teste com id duplicado. |
| SF-12 | "sem duplicata" contradizia D10 | T1.1: "sem duplicata **dentro do provedor**". |
| SF-13 | Remover constantes podia quebrar Google | §2.5 + T3.1: `{model}` do catálogo substituído e sufixo `:streamGenerateContent?alt=sse` mantido; teste de regressão nos 9 modelos google. |
| SF-14 | `reset_app_data` deixava decisão em aberto | D13 + T3.5: apaga `secrets.json` inteiro + `models-cache.json`, mantém `settings.json`, alinhado ao `DataTab.tsx:93`; teste. |
| SF-15 | `set_provider_key` com copy OpenCode | T3.5: validação/copy por auth mode; teste OpenAI + preservação do bloco OAuth. |
| SF-16 | Testes de desserialização irreais | §2.3/T1.2: DTOs serialize-only; testar shape serializado com/sem `hint`; sem `Deserialize` só para teste. |
| SF-17 | DTOs/retornos de auth incompletos | §2.3: `LoginChallenge` e `openai_auth_status -> Vec<ProviderAuthStatus>` definidos; T1.2 nos arquivos. |
| SF-18 | Revogação sem retry | T2.5: 2–3 tentativas com backoff antes de "unconfirmed"; teste. |

## Re-review (delta) — disposição de RB1/RB2 e N1–N8

| ID | Achado | Disposição |
| --- | --- | --- |
| RB1 | Registro dos 6 comandos em T1.2 (antes das implementações) quebra `cargo test --lib`; sem `commands/oauth.rs`/`commands/mod.rs`; `sign_out`/`refresh_provider_models` sem `async` | Registro **removido de T1.2** e movido para nova **T2.6 (Lead)**, `blocked_by T2.3/T2.5/T3.4a`; cria `src-tauri/src/commands/oauth.rs`, registra em `commands/mod.rs`+`lib.rs`, teste `include_str!("lib.rs")`; `login_wait`/`sign_out`/`refresh_provider_models` marcados `async` no Contract Boundary e §2.3. T0.2 inclui `commands/oauth.rs`/`Cargo.toml` na tabela de ownership. |
| RB2a | `AboutTab` com dois donos (T4.2 × T4.4) | Removido de T4.4a; permanece só em T4.2 (ui-systems). |
| RB2b | Migração de favoritos sem arquivo/task | Implementação movida para **T4.1 (Lead: `appStore.ts`+`modelMenu.ts`+testes)**; T1.2 só fixa o contrato; T4.3 consome. |
| RB2c | T3.3 (harness-dev) precisaria editar `commands/turn.rs` (Lead) sem dep; T3.3×T3.4b no mesmo arquivo | Ordem explícita: **T3.3 define `HarnessDeps` (harness-only) → T3.4a (Lead) liga `commands/turn.rs` → T3.4b (harness-dev) usa `ModelSource`**. `commands/turn.rs` listado no escopo de T3.4a. |
| RB2d | T4.4 com dois owners | Dividido em **T4.4a (ui-core, só `components/**`)** e **T4.4b (Lead, `chatStore`)**. |
| N1 | `requestProfiles` usava `"api-key"`, mas serde camelCase espera `apiKey` | Exemplo do catálogo e §2.1 corrigidos para `"apiKey": "standard"`; T1.1 testa `requestProfiles.apiKey`. |
| N2 | `validate_provider` montaria `/v1/v1/models` | T3.5 usa `endpoints["models"]` do catálogo; teste com base `…/v1`. |
| N3 | Grep de writer único colidia com o reset (D13) | Reset usa `config::reset_credentials()`/`reset_models_cache()` (implementados em `config.rs`), sem literal de caminho em `commands/settings.rs`; grep do T5.1 anotado. |
| N4 | Reset × login/refresh em voo podia regravar credenciais | T3.5: reset adquire o Mutex de RMW, chama `oauth::cancel_all` e só então apaga; teste "reset durante login/refresh não recria credenciais". Matriz/riscos atualizados. |
| N5 | Ordem de credencial tinha perdido a detecção do OpenCode CLI | §2.4 agora tem 5 passos: OAuth → secrets → env → **OpenCode CLI (só Go/Zen)** → Missing; matriz ganhou linha "Credencial"; teste de não-regressão. |
| N6 | Teste de `include` incondicional vs G4b condicional | T3.1: o snapshot só inclui `include` se o G4b aprovar; senão registra o fallback de descarte de reasoning. |
| N7 | "Cancelar turnos do provedor" não é representável (`AppState` = turn_id→token) | T2.5 usa `state.cancel_all()` explicitamente (sign-out é ação rara), com teste de turno em andamento. |
| N8 | Menores de single-instance/consistência | T0.2: plugin Rust **sem capability**, registrado antes dos demais, fallback lockfile com tratamento de lock obsoleto; "single-instance" saiu de `AppState` (architecture slice); kill criteria (b) agora diz "writer **do arquivo de segredos**"; T3.5 não tem mais "decidir" (D13 manda implementar); T0.1 diz que o probe **lê/confere claims** (assinatura/JWKS é T2.1). |
| Wording | T0.1 inflava a evidência do gate | Corrigido: probe confere claims; assinatura/JWKS fica em T2.1. |

### Nota sobre o `include:["reasoning.encrypted_content"]`

Confirmado como **hipótese não documentada** na rota SIWC: o plano o mantém
condicionado ao gate G4b, com fallback de descarte de reasoning no replay
documentado. Não é prometido como funcionando.

## Notes

- **`rand` → `getrandom`:** acatado (já na árvore; evita dep nova).
- **`jsonwebtoken`:** mantido (reusa `ring`); `cargo check` no Windows/MSVC em T2.1.
- **D6 (arquivo 0600, ACL no Windows):** risco registrado e aceito; hardening
  futuro.
- **`id_token_hint` na URL:** por design da doc; redação de logs obrigatória
  (kill criteria (c)).
- **D8 (conta única na v1):** desvio consciente; formato suporta múltiplas
  registrations.
