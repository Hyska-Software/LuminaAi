# Evidência — Provedor Anthropic direto (API key)

> Coletada em **2026-10-26** (America/Sao_Paulo), Windows, repo `H:\ChatTauri`.
> Ambiente **sem `ANTHROPIC_API_KEY`** e sem credenciais do Claude Code: a
> verificação é offline/automatizada; o gate live está documentado na §5.

## 1. O que foi entregue

| Camada | Arquivo(s) | Mudança |
| --- | --- | --- |
| Catálogo | `data/catalog.json` | 4º provedor `anthropic`: base `https://api.anthropic.com/v1`, endpoints `{anthropic:"/messages", models:"/models"}`, `headers:{"anthropic-version":"2026-10-21"}`, `authEnv:"ANTHROPIC_API_KEY"`, 14 modelos Claude (IDs dateless), default `claude-sonnet-5-5` |
| Gerador | `scripts/build-catalog.mjs` | `buildAnthropicProvider()` a partir do models.dev (linha Claude, sem snapshots datados) + `--provider anthropic` cirúrgico |
| Contrato Rust | `src-tauri/src/catalog.rs` | `ProviderInfo.headers` + `static_headers()` (minúsculo/ordenado); `ReasoningOption: PartialEq`; testes do catálogo |
| Contrato TS | `src/lib/types.ts` | `ProviderInfo.headers?: Record<string,string>` |
| Transporte | `src-tauri/src/harness/mod.rs` | `provider_config` propaga `provider.static_headers()` via `extra_headers`; testes de header/Claude sem temperature |
| Provedores | `src-tauri/src/providers/{mod,anthropic}.rs` | smoke live `#[ignore]` (`providers::smoke::anthropic_direct_lists_models_and_streams`) + testes do body Messages do provedor direto |
| Modelos | `src-tauri/src/commands/models.rs` | headers estáticos no `GET /v1/models`; paginação `has_more`/`last_id` → `after_id`; capacidades da conta (`max_input_tokens`, `max_tokens`, `capabilities.effort/thinking/image_input/pdf_input`) nos modelos `estimated`; copy de credencial provider-aware |
| Validação | `src-tauri/src/commands/settings.rs`, `src-tauri/src/config.rs` | `probe_models` envia headers do catálogo (guard contra `authorization`/`user-agent`/`host`/`content-length` vindos do JSON); copy `sk-ant-…`/console Anthropic; 402 provider-aware; `default_auth_env("anthropic")` |
| UI | `src/components/settings/{ProvidersTab,AboutTab}.tsx` + testes; `src/components/models/*` testes | card Anthropic só API key (placeholder `sk-ant-…`, console `platform.claude.com/settings/keys`, sem CTA ChatGPT); fixtures passam a 4 abas / 161 opções na busca global / rótulo `Go + Zen + ChatGPT + Anthropic` |
| Docs | `docs/MODELS.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `README.md` | provedor, autenticação, headers, catálogo, decisão #14 |
| Auto-refresh | `src/lib/store/appStore.ts` | salvar uma API key de provedor com endpoint `models` dispara `refresh_provider_models` (lista/metadados da conta) sem ação manual; falha é não-fatal (catálogo embutido continua); remover chave não dispara |

## 2. Verificação automatizada

| Comando | Resultado |
| --- | --- |
| `pnpm typecheck` | exit 0 (sem erros) |
| `pnpm test` | **67 arquivos / 1345 testes** passando (0 falhas; inclui os 4 testes do auto-refresh no `appStore`) |
| `pnpm build` | build Vite concluído (só avisos pré-existentes de chunk size) |
| `cd src-tauri && cargo check --lib` | `Finished` (13 warnings pré-existentes, nenhum novo da entrega) |
| `cd src-tauri && cargo test --lib` | **428 passed; 0 failed; 10 ignored** |
| `cd src-tauri && cargo test --lib catalog::` | 8 passed (inclui 4 testes novos do provedor Anthropic) |
| `cd src-tauri && cargo test --lib commands::models::` | 9 passed (paginação/capacidades/estimados/copy) |
| `cd src-tauri && cargo test --lib commands::settings` | 13 passed (endpoint/headers/copy `sk-ant`) |
| `cd src-tauri && cargo test --lib providers::` | 30 passed, 8 ignored (2 testes novos do adaptador) |
| `cd src-tauri && cargo test --lib harness::` | 64 passed (headers estáticos, Claude sem `temperature`) |
| `cd src-tauri && cargo test --lib config::` | 26 passed (`ANTHROPIC_API_KEY`) |
| `node scripts/build-catalog.mjs --provider anthropic` | gera 14 modelos, preserva Go/Zen/OpenAI; providers finais `opencode-go, opencode-zen, openai, anthropic` |
| `cargo test --lib` em loop (10×, paralelismo default) | **10/10 verdes** (428 passed; 0 failed; 10 ignored em cada run) |
| `cargo fmt --check` | o repo **já não era rustfmt-clean** (HEAD falha nos mesmos pontos); sem reformatação em massa |

> Durante a verificação final apareceu um teste **flaky pré-existente** da suíte:
> `config::tests::corrupt_file_is_preserved_and_backed_up` podia falhar quando
> testes paralelos chamavam `reset_credentials_at` (que limpa o slot global de
> `secrets_error`) sem o `error_slot_guard`. Corrigido na tarefa T13 (somente
> `#[cfg(test)]` em `config.rs`): o guard agora limpa o slot ao ser adquirido e
> todos os testes que tocam o slot o usam; a suíte ficou determinística (10/10
> execuções verdes).

O smoke live sem chave é um skip limpo (sem rede):

```text
$ cargo test --lib providers::smoke::anthropic_direct -- --ignored --nocapture
SKIP anthropic_direct_lists_models_and_streams: ANTHROPIC_API_KEY ausente
test result: ok. 1 passed; 0 failed
```

## 3. Contrato verificado por teste (offline)

- **Transporte**: `Authorization: Bearer <api-key>` + `anthropic-version: 2026-10-21`
  chegam ao `RequestBuilder` da inferência (harness) e do `GET /v1/models`
  (validação). Headers declarados no catálogo nunca sobrescrevem
  `authorization`/`user-agent` (teste com catálogo hostil).
- **Body Messages**: `stream:true`, `max_tokens` presente, `system`, tools
  `{name,description,input_schema}`, `temperature` ausente para Claude (mesmo com
  temperature pedida no turno/settings), esforço → `thinking:{type:"adaptive"}` +
  `output_config:{effort}`, orçamento → `thinking:{type:"enabled",budget_tokens}`
  com `max_tokens > budget`.
- **Listagem**: parser aceita `{data:[…]}` (Anthropic/OpenAI plataforma) e
  `{models:[…]}` (plano OpenAI), filtra `lifecycle:"retired"`, lê `max_input_tokens`
  / `max_tokens` / `capabilities.*`, e monta `?after_id=` quando `has_more=true`.
- **Merge**: modelo do catálogo mantém metadados; modelo só da conta vira
  `estimated` com família `claude`, protocolo `anthropic` e limites/capacidades da
  conta (fallback para o representante do seed quando a conta não informa).
- **UI**: card Anthropic genérico de API key, sem qualquer CTA de ChatGPT; 4 abas
  no seletor; busca global inclui os dois provedores Claude.

## 4. Greps de kill criteria

```text
$ rg -n 'claude\.ai|setup-token|CLAUDE_CODE_OAUTH_TOKEN|\.credentials\.json|api\.anthropic\.com/api|app_EMoam|anthropic.{0,20}oauth' src src-tauri/src
src-tauri/src/catalog.rs: assert!(!anthropic.supports_oauth());   # asserção NEGATIVA do teste
```

Nenhum caminho de OAuth/assinatura da Anthropic foi introduzido: o provedor é
`auth: api-key` (default do catálogo), perfil `standard`, e a única credencial é a
API key em `Authorization: Bearer`.

## 5. Gate live (manual, requer chave do usuário)

Não executado neste ambiente (sem `ANTHROPIC_API_KEY`). Para validar o contrato
real da API oficial:

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
cd src-tauri
cargo test --lib providers::smoke::anthropic_direct -- --ignored --nocapture
```

O teste faz `GET /v1/models` (espera ids `claude-*`) e um `POST /v1/messages`
streaming curto, imprimindo texto/reasoning/usage. No app, o mesmo caminho pode
ser exercitado salvando a chave em Configurações → Provedores, clicando em
"Testar conexão" e enviando uma mensagem com um modelo Claude.

## 6. Riscos/pendências conhecidos

1. **Sem chave no ambiente**: nenhuma chamada real à API foi feita; o gate live da
   §5 fica para o usuário/QA. O body e os headers são cobertos por teste.
2. **`anthropic-version` pinado** em `2026-10-21` (versão mais recente do
   histórico oficial na data). É dado do catálogo: trocar não exige código.
3. **Sem headers beta** (ex.: `context-1m-2025-08-07`) e sem prompt caching
   (`cache_control`): features opcionais, fora do escopo desta entrega.
4. **`temperature`**: o harness já omite para a família Claude; a API 2026-10-21
   removeu o parâmetro (400 se enviado), o que é compatível com o comportamento
   atual.
5. **Validação de conexão**: o caminho de rede de `validate_provider` segue sem
   harness de `AppHandle` (limitação pré-existente); a montagem do request é
   testada via `RequestBuilder::build()`.
