# Provider / auth / catalog architecture map — change surface for an OpenAI (ChatGPT/Codex OAuth) provider

> Research deliverable for the implementation plan. **Read-only mapping**: no source file was modified; the only
> file written is this one. Every `file:line` reference below was read/grepped in the current workspace
> (`H:\ChatTauri`); paths are relative to the repo root.
>
> Companion research: `docs/research/openai-oauth.md` (task-1) covers the external contract (PKCE, endpoints,
> headers, plan types). This document covers **where the app must change** to host a provider whose auth is a
> token set + account metadata instead of one API-key string. Task-1's conclusion is assumed in §I/§J: ship the
> **documented "Sign in with ChatGPT" OSS flow** (path A) against `https://api.openai.com/v1/responses`; the
> Codex CLI `client_id` + `chatgpt.com/backend-api/codex` path (B) is internal/unsupported and only acceptable
> behind an experiment flag.

---

## 0. TL;DR for the Lead

Current invariant chain (all keyed by plain strings):

```
data/catalog.json ──include_str!──► catalog.rs ProviderInfo/ModelInfo
        │                                 │
        └──static import──► catalog.ts ───┴──► appStore.providers / keys
                                                  │
turn payload {providerId, modelId} ─► harness::run_turn ─► config::api_key(app, provider_id) -> Option<String>
                                                  │
                                                  └─► providers::CompletionRequest { ProviderConfig { base_url, api_key: String, … } }
                                                              │
                                                              └─► send_stream: `Authorization: Bearer <api_key>` + `x-opencode-session` + fixed path constants
```

The six seams a second auth mode must cross:

1. **Catalog contract** — `ProviderInfo` has `base_url`, `endpoints`, `auth_env` but **no auth-mode/type field**
   (`src-tauri/src/catalog.rs:23-43`, `src/lib/types.ts:65-77`). The UI/catalog is where an OAuth provider would be
   declared.
2. **Credential storage** — `SecretsFile.providers: BTreeMap<String, String>` = one API key per provider
   (`src-tauri/src/config.rs:135-141`). No access token / refresh token / expiry / account id / plan.
3. **Key resolution API** — `config::api_key() -> Option<String>` and `resolve_key() -> (Option<String>, source)`
   (`config.rs:254-275`); precedence secrets.json → `OPENCODE_API_KEY` → OpenCode CLI `auth.json`.
4. **IPC contract** — `SettingsView { settings, keys: Vec<ProviderKeyStatus> }`; `ProviderKeyStatus` has only
   `provider_id`, `has_key`, `masked`, `source` (`src-tauri/src/domain.rs:645-661`). Commands are
   `get_settings/save_settings/set_provider_key/validate_provider` (`commands/settings.rs`).
5. **Wire layer** — `ProviderConfig.api_key: String` (`providers/mod.rs:163-173`), `send_stream` hardcodes the
   Bearer header + `x-opencode-session` + `User-Agent` (`providers/mod.rs:320-359`), and the request path is a
   **global constant per protocol** (`providers/mod.rs:289-297`), not read from the catalog `endpoints`.
6. **UI** — ProvidersTab renders an API-key password form per provider (`src/components/settings/ProvidersTab.tsx:109-220`);
   key presence only drives dots/warnings (`providerHasKey` in `src/lib/modelMenu.ts:680-682`), not sending.

There is **no auth abstraction anywhere**: no trait/enum for "credential provider", no refresh, no login flow, no
OAuth command, no token metadata. Adding one touches catalog/config/commands/providers/harness/UI, i.e. nearly every
owner area in `AGENTS.md` (Lead, storage-dev, provider-dev, ui-systems, ui-core).

---

## A. Catalog / data model

### A.1 Rust: `src-tauri/src/catalog.rs`

| Item | Lines | Notes |
| --- | --- | --- |
| Embedded JSON | 11 | `pub const CATALOG_JSON: &str = include_str!("../../data/catalog.json");` — compile-time embed of `data/catalog.json` |
| `CatalogFile` | 13-21 | `version`, `generated_at`, `sources`, `providers: Vec<ProviderInfo>` |
| `ProviderInfo` | 23-43 | `id`, `name`, `short_name`, `description`, `base_url`, `console_url`, `endpoints: HashMap<String,String>`, `auth_env: String`, `default_model_id`, `models`, `notes` |
| `ModelInfo` | 45-81 | `id`, `name`, `family`, `protocols: Vec<String>`, `reasoning`, `reasoning_options`, `attachment`, `modalities`, `context_window`, `max_output`, `cost`, `release_date`, `knowledge`, `open_weights`, `description`, `tags`, `status` (`stable|beta|free|unavailable`) |
| `Modalities` | 93-100 | `input`, `output` string lists |
| `ReasoningOption` | 102-122 | internally tagged `type`: `toggle`, `effort{values}`, `budget_tokens{min,max}` |
| `CatalogFile::load` | 124-129 | parses embedded JSON; no validation beyond serde |
| `provider` / `model` | 131-140 | linear lookups by string id |
| `find_provider_for_model` | 142-147 | first provider whose models contain the id — **ambiguous across providers** (model ids repeat: `gpt-6-luna` is in both Go and Zen) |

Key excerpt (`catalog.rs:23-43`, abbreviated):

```rust
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub short_name: String,
    pub base_url: String,
    pub console_url: String,
    pub endpoints: HashMap<String, String>, // protocol key -> path suffix
    pub auth_env: String,                   // single env var, UI-only
    pub default_model_id: String,
    pub models: Vec<ModelInfo>,
    pub notes: Vec<String>,
}
```

There is **no** field for: auth mode (`api_key` vs `oauth`), model-list endpoint, extra headers, request-body
defaults, account/plan, or per-provider protocol allow-list. `auth_env` is only displayed (`ProvidersTab.tsx:129-131`);
key resolution ignores it (`config.rs:242-251`).

### A.2 TypeScript mirror: `src/lib/types.ts` + `src/lib/catalog.ts`

- `WireProtocol = 'openai-chat' | 'openai-responses' | 'anthropic' | 'google'` — `types.ts:12`;
  `ModelStatus` — 13; `ModelInfo` — 45-63; `ProviderInfo` — 65-77; `CatalogFile` — 79-84.
- `ProviderKeyStatus` — `types.ts:416-421`:
  ```ts
  export interface ProviderKeyStatus {
    providerId: string;
    hasKey: boolean;
    masked?: string | null;
    source: 'settings' | 'env' | 'opencode-cli' | 'none';
  }
  ```
  The `source` union is exhaustive; an OAuth source (e.g. `'oauth'`) must be added here **and** in every switch/label
  that consumes it (see G/H).
- `catalog.ts` imports the JSON statically: `import catalogJson from '@data/catalog.json'` (`:5`),
  `export const catalog = catalogJson as unknown as CatalogFile` (`:16`).
- Accessors: `providers()` 18-20, `getProvider` 22-24, `getModel` 26-28, `findModel` 30-36,
  `providerLabel` 38-40 (returns `shortName`), `defaultSelection` 42-64, `defaultReasoningFor` 67-92,
  `reasoningUi` 104-123, `formatContextWindow` 171-180, `formatPrice` 182-187, `modelBadges` 189-198,
  `supportsAttachments` 200-203, `groupByFamily` 206-220.
- Hardcoded default provider: `const providerId = settings?.defaultProvider ?? 'opencode-go';` — `catalog.ts:43`.

### A.3 `data/catalog.json` provider object schema

Top-level: `version`, `generatedAt`, `sources`, `providers` (`data/catalog.json:1-12`). Currently exactly **two**
provider objects: `opencode-go` starts at `:13` (id `:14`, baseUrl `:18`, consoleUrl `:19`, endpoints `:20`,
authEnv `:26`, defaultModelId `:27`, models `:28`, notes `:1814`), `opencode-zen` starts `:1820` (id `:1821`,
baseUrl `:1824`, authEnv `:1832`, defaultModelId `:1833`, models `:1834`, notes `:5910`). The file is 5,916 lines.

Provider object shape (camelCase, mirrors `ProviderInfo`):

```json
{
  "id": "opencode-go",
  "name": "OpenCode Go",
  "shortName": "Go",
  "description": "…",
  "baseUrl": "https://opencode.ai/inference/go",
  "consoleUrl": "https://opencode.ai/console",
  "endpoints": {
    "openai-chat": "/openai/v1/chat/completions",
    "openai-responses": "/openai/v1/responses",
    "anthropic": "/anthropic/v1/messages",
    "google": "/google/v1beta/models/{model}"
  },
  "authEnv": "OPENCODE_API_KEY",
  "defaultModelId": "deepseek-v4.1-flash",
  "models": [ /* ModelInfo */ ],
  "notes": [ "…" ]
}
```

Model object example fields: `id`, `name`, `family`, `protocols`, `reasoning`, `reasoningOptions`, `attachment`,
`modalities`, `contextWindow`, `maxOutput`, `cost`, `releaseDate`, `knowledge`, `openWeights`, `description`,
`tags`, `status` (see any entry, e.g. `:28-…`).

### A.4 Generator: `scripts/build-catalog.mjs` — can a new provider be hand-added?

**Yes at runtime, but not durably.** Both consumers read the committed file (compile-time `include_str!` +
Vite JSON import), so a hand-added provider object is immediately visible to backend and UI without code changes
*as data*. Caveats, in order of importance:

1. **The generator overwrites the whole file** and hardcodes exactly the two OpenCode providers:
   `const catalog = { … providers: [ buildProvider({id:'opencode-go'…}), buildProvider({id:'opencode-zen'…}) ] }`
   — `scripts/build-catalog.mjs:293-330`. Re-running `node scripts/build-catalog.mjs` **drops** any hand-added
   provider (it writes `data/catalog.json` unconditionally at `:332-335`).
2. `buildProvider` hardcodes `consoleUrl: 'https://opencode.ai/console'`, `endpoints: PROTOCOL_ENDPOINTS`,
   `authEnv: 'OPENCODE_API_KEY'` for every provider — `build-catalog.mjs:260-291` (`consoleUrl` 284,
   `endpoints` 285, `authEnv` 286). A new provider with other URLs/headers cannot be emitted by the current script.
3. Model assembly is OpenCode-specific: inputs `docs-go.json`, `docs-zen.json`, `go-protocols.json` from
   `.research/` (`:18-22`), family heuristics `FAMILY_DEFAULTS` (`:38-126`), protocol inference
   `PROTOCOL_ENDPOINTS` (`:176-181`), `PROTOCOL_OVERRIDES` (`:186-193`), `protocolsFor` (`:195-207`),
   `buildModel` (`:213-258`). New providers would need a new input pipeline or a hand-maintained overlay.
4. No schema constraint catches a new provider: Rust serde has defaults for most fields; TS types force
   `baseUrl`, `consoleUrl`, `endpoints`, `authEnv`, `defaultModelId` to exist at compile time.
5. **Wire paths are not read from `endpoints`** by the adapters (see D.1), so a provider with a different URL layout
   (e.g. `https://chatgpt.com/backend-api/codex/responses`) will catalog-load fine but fail at request time.
6. `default_model_id` is not validated against `models`; if it is wrong (or empty), a turn with empty `model_id`
   fails later (`harness/mod.rs:138-152`).

Recommendation for the plan: introduce a provider "auth/wire descriptor" into `ProviderInfo` and extend the build
script (or add `data/providers.extra.json` merged at build/compile time) so hand edits survive regeneration.

`scripts/collect-research.mjs` is also OpenCode-only (doc URLs `:38-53`, live model lists `:51-54`);
`scripts/probe-models.mjs:26-30` reads `~/.local/share/opencode/auth.json` and `auth['opencode-go']`.

---

## B. Auth today — `src-tauri/src/config.rs`

### B.1 File locations

| Path | Lines | Contents |
| --- | --- | --- |
| `<app-data>/settings.json` | `config.rs:31-35` (`settings_path`), resolved from `data_dir` `:22-29` | preferences, no secrets |
| `<app-data>/secrets.json` | `config.rs:37-41` (`secrets_path`) | API keys |
| `~/.local/share/opencode/auth.json` | `config.rs:192-210` (`opencode_auth_path`) | OpenCode CLI login (detected, read-only) |

`<app-data>` = Tauri `app_data_dir()` → `%APPDATA%/app.lumina.chat` on Windows (identifier in
`src-tauri/tauri.conf.json`, `app.lumina.chat`; DB path also documented at `docs/ARCHITECTURE.md:68,85-94`).

### B.2 Secrets file format (`config.rs:135-154`)

```rust
/// `<app-data>/secrets.json` shape:
/// `{"providers":{"opencode-go":"sk-...","opencode-zen":"sk-..."}}`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SecretsFile {
    #[serde(default)]
    providers: BTreeMap<String, String>,
}
```

- Module-private (`struct SecretsFile`, not `pub`) — only `config.rs` knows the on-disk shape.
- `load_secrets` 143-148: unreadable/invalid file silently becomes default (no error, no migration hook beyond
  `#[serde(default)]`).
- `save_secrets` 150-154 serializes pretty JSON.
- `write_private` 159-186: atomic temp-file + rename; `0600` on Unix only; comment says Windows `%APPDATA%` ACL is
  considered enough (`:156-158`). **Plaintext JSON** — no encryption/keychain.

### B.3 Resolution precedence (`resolve_key`, `config.rs:254-270`)

```rust
/// Resolves a key and its origin: settings | env | opencode-cli | none.
fn resolve_key(app: &AppHandle, provider_id: &str) -> (Option<String>, &'static str) {
    // 1. secrets.json -> "settings"
    // 2. key_from_env   -> "env"
    // 3. key_from_opencode_cli -> "opencode-cli"
    // 4. (None, "none")
}
```

1. **secrets.json**: `load_secrets(app).providers.get(provider_id)`, trimmed + non-empty — `:255-262`.
2. **env**: `key_from_env(_provider_id)` — provider id **ignored**; reads only `OPENCODE_API_KEY` — `:242-251`.
3. **OpenCode CLI**: `key_from_opencode_cli(provider_id)` — reads `~/.local/share/opencode/auth.json`; maps
   Lumina provider id → CLI entry ids via `cli_entry_ids` (`:212-219`):
   `"opencode-go" => ["opencode-go"]`, `"opencode-zen" => ["opencode", "opencode-zen"]`, everything else `[]`.
   Entry accepts `{"key":"sk-…"}` or a bare string — `:221-240`.

Public surface:

- `api_key(app, provider_id) -> Option<String>` — `:272-275`.
- `set_api_key(app, provider_id, key: Option<&str>)` — `:277-290`; trims, inserts/removes in the map, saves.
- `mask_key` — `:292-301`: `<16` chars → `"••••••"`, else `first6…last4`.
- `key_status(app, provider_id) -> ProviderKeyStatus` — `:303-319`; `all_key_status(app, &[ids])` — `:321-323`.

### B.4 DTO `ProviderKeyStatus` (`domain.rs:645-654`)

```rust
pub struct ProviderKeyStatus {
    pub provider_id: String,
    pub has_key: bool,
    #[serde(default)]
    pub masked: Option<String>,
    /// settings | env | opencode-cli | none
    pub source: String,
}
```

No fields for auth mode, account/email, plan type, expiry, "needs reauth", or scope. `masked` is meaningless for a
JWT access token (and would leak a prefix/suffix to the renderer if reused).

### B.5 Settings

`Settings` struct — `domain.rs:582-614`; `Default` — `:616-643`. Relevant fields:

| Field | Line (domain.rs) | Default |
| --- | --- | --- |
| `default_provider: String` | 587 | `"opencode-go"` (621) |
| `default_model: String` | 588 | `"deepseek-v4.1-flash"` (622) |
| `reasoning_default: String` | 589 | `"max"` (623) |
| `system_prompt`, `web_search_enabled`, `file_creation_enabled`, `max_steps`, `send_key`, `show_token_usage`, `reduce_motion`, `font_scale`, `temperature`, `include_attachments`, `auto_title`, code-exec + skills fields | 590-613 | see 617-641 |

Normalization/validation — `config.rs:69-112` (`normalize_settings`):

- clamps/repairs numeric and enum-ish strings (`max_steps` 72, `font_scale` 74-77, `theme` 79-81, `locale` 82-84,
  `send_key` 85-87, `reasoning_default` 88-93, temperature 100-104, code timeout 105-107, paths 108-109,
  disabled skills 110);
- `default_provider` / `default_model`: **only non-empty check**, no catalog validation — `:94-99` (falls back to
  `Settings::default()` values, i.e. the two hardcoded OpenCode values).
- `load_settings` 114-122 (invalid JSON → defaults), `save_settings` 124-129 (normalizes then writes).

Tests in-module: `config.rs:329-488` — `masks_keys_without_revealing_them` (333), `defaults_to_64_steps` (343),
`normalizes_out_of_range_settings` (349; asserts `default_provider == "opencode-go"` and
`default_model == "deepseek-v4.1-flash"` at 381-382), legacy settings tests (417, 458), code timeout boundaries (469).
Any change to defaults or to `ProviderKeyStatus` shape affects these.

---

## C. IPC + commands

### C.1 Registration — `src-tauri/src/lib.rs`

- Modules 13-24; Tauri builder/plugins 28-39; `app.manage(state)` 37; `invoke_handler(tauri::generate_handler![…])`
  **40-76**.
- Auth/catalog-related handlers: `get_catalog` 43, `refresh_catalog` 44, `list_remote_models` 45, `get_settings` 55,
  `save_settings` 56, `set_provider_key` 57, `validate_provider` 61; turn: `run_turn` 41, `cancel_turn` 42.
- A new OAuth/login command must be added to this list (it is the only IPC registration point).

### C.2 State + HTTP — `state.rs`, `http.rs`

- `AppState` (`state.rs:14-22`): `started_at`, `db: Arc<Db>`, `catalog: CatalogFile`, `http: reqwest::Client`,
  `search_http`, `data_dir: PathBuf`, private `turns: Mutex<HashMap<String, CancellationToken>>`.
- `AppState::init` (`:25-39`): data dir → open DB → `CatalogFile::load()` → HTTP clients.
- Turn cancellation registry: `register_turn` 41-45, `finish_turn` 47-49, `cancel_turn` 52-60, `cancel_all` 62-66.
- `http::client()` (`http.rs:5-14`): UA `Lumina/<version>`, connect timeout 20 s, pool idle 60 s, TCP keepalive 30 s,
  redirects ≤8 — **no total timeout** (streaming SSE) and no proxy config; OAuth token exchange would need a
  per-request `.timeout(...)` like `validate_provider` does (`commands/settings.rs:220`).
- `http::search_client()` 17-27: browser UA, 15 s connect / 25 s total (web tools only).

### C.3 `src-tauri/src/commands/settings.rs`

| Command / fn | Lines | Behavior |
| --- | --- | --- |
| `settings_view(app, state)` | 20-31 | provider ids from **catalog** (`state.catalog.providers`), then `config::all_key_status` → `SettingsView { settings, keys }` |
| `get_settings` | 37-40 | sync command, returns `SettingsView` |
| `save_settings` | 42-50 | persists `Settings`, returns fresh `SettingsView` |
| `set_provider_key` | 52-79 | rejects unknown provider by catalog lookup (`:59-61`); trims; validates **length ≥ 20 chars** (`:65-72`) and **no whitespace** (`:73-75`); error copy explicitly says "API key completa do OpenCode Console" (`:69-70`); calls `config::set_api_key` (`:77`) |
| `app_info` | 85-96 | name/version/tauri/platform/startedAt/dataDir |
| `open_data_dir` | 98-104 | opens app-data in OS file manager |
| `get_code_environment` | 114-123 | async wrapper for interpreter/skills detection |
| `open_skills_dir` | 127-139 | opens `<app-data>/skills` |
| `reset_app_data` | 163-179 | cancels turns, `db.reset()`, clears `attachments/`+`artifacts/` (**does not delete secrets.json/settings.json**) |
| `validate_provider` | 185-297 | see below |

`validate_provider` is the closest thing to a provider health check, and it is entirely API-key/gateway-shaped:

- resolves provider from catalog, `base_url` trimmed (`:191-197`);
- **no key → early failure** with copy "Nenhuma API key configurada … Configurações → Provedores" (`:199-211`);
- URL is hardcoded `format!("{base_url}/v1/models")` (`:213`), header `Authorization: Bearer {key}` (`:218`),
  UA (`:219`), request timeout 15 s (`:220`);
- status mapping (`:248-279`): 401 → "API key inválida ou expirada (401). Gere uma nova chave no OpenCode Console."
  (`:251-254`), 402 → OpenCode credits/subscription copy (`:255-257`), 403 (`:258-260`), 404 (`:261-263`),
  429 (`:264-266`), 5xx (`:267-269`);
- network errors (`:280-295`) include connect/timeout copy.

### C.4 `src-tauri/src/commands/models.rs`

| Command | Lines | Behavior |
| --- | --- | --- |
| `catalog_view` | 9-21 | `CatalogView { catalog, keys, remote_refreshed_at: None }` |
| `get_catalog` | 23-26 | sync, returns embedded catalog + key statuses |
| `refresh_catalog` | 31-61 | for each catalog provider: **skip if `config::api_key` is None** (`:39-41`); GET `{base_url}/v1/models` with Bearer + UA, 20 s timeout (`:42-50`); sets `remote_refreshed_at` only if any response was successful (`:57-59`). Informational only — bundled catalog stays source of truth |
| `list_remote_models` | 63-98 | provider from catalog (`:69-72`); requires `config::api_key` (`:73-74`); GET `{base}/v1/models` Bearer (`:75-83`); non-2xx → `Err("gateway respondeu …")` (`:84-86`); parses `data[].id` (`:87-98`) |

Implication: any provider discovered via `api_key` gets this gateway-shaped `/v1/models` probe. A ChatGPT-OAuth
provider would be silently skipped by `refresh_catalog` (no API key string) and `list_remote_models` would error out.

### C.5 `commands/turn.rs`

`run_turn` (`commands/turn.rs:11-49`): builds `HarnessDeps` with `app: Some`, `db/http/search_http/catalog` from
state, `data_dir: None`, `skills_roots: None`, `streamer: None`, `api_key_override: None` (`:24-38`), registers the
turn token (`:18-22`), loads settings (`:23`), calls `harness::run_turn` and returns `Result<TurnResult, String>`.
`cancel_turn` `:51-54`.

---

## D. Wire layer — `src-tauri/src/providers/*`

### D.1 `providers/mod.rs` — request/response plumbing

| Item | Lines | Notes |
| --- | --- | --- |
| Module list | 1-14 | adapters + `reasoning` + `sse` |
| `WireProtocol` | 27-55 | kebab-case enum; `as_str` 37-44; `parse` 46-54 (unknown protocols silently `None`) |
| Neutral history | 61-157 | `HistoryRole`, `ImagePart`, `HistoryToolCall`, `HistoryMessage` (incl. `provider_state: Option<Value>` 94, `reasoning_signature` 89) |
| **`ProviderConfig`** | 163-173 | `provider_id`, `provider_name`, `base_url`, **`api_key: String`**, `model: ModelInfo`, `session_id: String`, `user_agent: String` |
| `ToolDefinition` | 175-180 | name/description/parameters |
| `ReasoningRequest` | 182-195 | `Auto|Off|Effort(String)|Budget(u32)` |
| `CompletionRequest` | 197-209 | `config`, `protocols: Vec<WireProtocol>`, `history`, `system_prompt`, `tools`, `reasoning`, `max_output_tokens`, `temperature`, `cancel: CancellationToken` |
| `ProviderEvent` | 215-237 | deltas, tool-call events, `Usage`, `ProviderState(Value)`, `Done` |
| `ProviderError` | 245-259 | `UnsupportedProtocol`, `Unauthorized`, `RateLimited`, `BadRequest`, `Network`, `Other` |
| `ProviderError::from_http` | 263-278 | body lowercase contains `modelprotocolunsupported` / "does not support this protocol" → `UnsupportedProtocol` (`:267-269`); `401|403→Unauthorized`, `429→RateLimited`, `400|404|422→BadRequest`, `402→BadRequest("saldo/créditos insuficientes: …")`, 5xx → `Other` |
| Protocol paths | 289-293 | **global constants**: `CHAT_PATH="/openai/v1/chat/completions"`, `RESPONSES_PATH="/openai/v1/responses"`, `ANTHROPIC_PATH="/anthropic/v1/messages"`, `GOOGLE_MODELS_PATH="/google/v1beta/models"` |
| `endpoint()` | 295-297 | `format!("{}{}", base_url.trim_end_matches('/'), path)` |
| `emit` / `to_provider_error` | 301-316 | channel-closed and downcast helpers |
| **`send_stream`** | 320-359 | POST JSON + `Accept: text/event-stream`; **Bearer only when `api_key` non-empty** (`:335-337`); `x-opencode-session: <session_id>` when non-empty (`:338-340`); `User-Agent` when non-empty (`:341-343`); cancel-aware send (`:344-349`); non-2xx → read body and `ProviderError::from_http` (`:350-357`) |
| `system_text` | 362-377 | joins `request.system_prompt` + any system history messages |
| image helpers | 379-404 | `image_base64`, `image_data_url` |
| misc | 406-471 | `max_output_tokens`, `as_u32`, `pointer_u32`, `normalize_arguments`, `valid_json_arguments`, `parse_arguments`, `make_usage` |
| **`stream_completion`** | 477-541 | resolves protocols from `request.protocols` or `config.model.protocols` (`:491-506`); loop over protocols; **only `UnsupportedProtocol` tries next** (`:510-528`); otherwise returns error; final bail lists attempted protocols (`:530-540`) |
| `stream_one` | 543-556 | dispatch to adapter |
| smoke tests | 559-1308 | `#[ignore]` real-gateway tests; `auth_key()` reads `%USERPROFILE%\.local\share\opencode\auth.json` entry `opencode-go` (`:597-613`); `provider_config()` builds `ProviderConfig` with `api_key: String` (`:615-629`); tests at 786, 837, 908, 996, 1041, 1072, 1180 |

Consequences for a second auth mode:

- `ProviderConfig` has **only a String credential**; there is nowhere to put access token + account id + beta flags +
  refresh state.
- `send_stream` hardcodes exactly one auth scheme (`Bearer`) and an OpenCode-specific header
  (`x-opencode-session`). Any provider requiring extra headers (e.g. ChatGPT account id/originator) cannot be
  expressed without changing this function or adding a headers field to `ProviderConfig`.
- `base_url` + **fixed protocol paths** means a provider whose paths differ (e.g. `/backend-api/codex/responses`)
  cannot be configured through the catalog; `ProviderInfo.endpoints` is *not* used to build URLs (only for protocol
  ordering in `harness/mod.rs:1425-1431`).
- Error mapping has no `AuthExpired`/`ReauthRequired` distinction: a stale OAuth token would surface as generic
  `Unauthorized(body)` (`:271`), and `402` is worded for OpenCode credits (`:274`).

### D.2 `providers/openai_responses.rs` (the likely basis for an OpenAI/Codex adapter)

| Item | Lines | Notes |
| --- | --- | --- |
| `stream()` | 23-44 | URL = `endpoint(base_url, RESPONSES_PATH)` (`:28`); `build_body`; `send_stream`; `sse::stream_sse` with cancel; `handler.finish()` |
| `build_body` | 50-105 | history mapping 52-64 (system skipped; user/assistant/tool → items); body `{model, input, stream:true, max_output_tokens}` 66-71; `instructions` from system text 72-75; `tools` as `{type:"function", name, description, parameters}` 76-90; temperature only when reasoning is `Auto|Off` 93-97; `reasoning::apply` 98-103 |
| `user_item` | 107-119 | text-only fast path; else `input_text` + `input_image` data URLs |
| `append_assistant` | 121-154 | replays `provider_state` (array or `{"output":[…]}`) filtered by `replayable_output_item`; fallback neutral assistant message + `function_call` items |
| `replayable_output_item` | 156-167 | `reasoning` items only if non-empty `encrypted_content` |
| `Handler` | 173-187 | accumulates text/usage/output/tools; `item_to_index` map |
| `on_event` | 201-253 | named SSE events: text/refusal deltas (211-218), reasoning summary/text deltas (219-225), `output_item.added` (226), function-call arg deltas/done (227-228), `output_item.done` (229), `response.completed|incomplete` (230), `response.failed` (231-240, error), `error` (241-249) |
| `on_item_added` | 255-297 | `function_call` → `ToolCallStart` |
| `on_arguments_delta/done` | 299-346 | delta buffering + `ToolCallDone` |
| `on_item_done` | 348-401 | recovers arguments/name; recovers message text when deltas were skipped (377-397) |
| `on_completed` | 403-421 | captures full `response.output` (provider_state) and `usage`; `response.error` → error |
| `finish` | 466-481 | finish tools, emit `Usage` then `ProviderState` then `Done`; fallback output built at 483-501 |
| `parse_usage` | 504-511 | `/input_tokens`, `/output_tokens`, `/output_tokens_details/reasoning_tokens`, `/input_tokens_details/cached_tokens`, `/total_tokens` |

Body gaps vs. what a ChatGPT/Codex backend typically needs (to be confirmed by task-1): no `store:false`,
no `include`, no `prompt_cache_key`, no `session_id`/`originator` values in body, no `instructions` vs. `input`
policy switch. Headers are the bigger gap (`send_stream`, D.1).

### D.3 `providers/reasoning.rs`

- Maps neutral `ReasoningRequest` → protocol params; catalog-driven via `ModelInfo.reasoning_options`
  (`reasoning.rs:1-23` docs, `apply` 109-124).
- `budget_for_effort` 27-37 (minimal/low/medium/high/xhigh/max → 512…16384, default 2048).
- Helpers `has_toggle` 39-44, `has_effort` 46-51, `effort_values` 53-58, `has_budget` 60-67,
  `has_any_control` 69-71, `offers_effort` 73-77, `is_claude` 79-82.
- `apply_openai_responses` 151-175: `Off` → `reasoning:{effort:"none"}` only if listed (`:154-158`);
  `Effort` → `reasoning:{effort, summary:"detailed"}` (`:159-170`); `Budget` ignored.
- Tests 243-458 use `CatalogFile::load().model("opencode-go"|"opencode-zen", id)` fixtures
  (`:258, 273, 294, 316, 339, 352, 375, 389, 402, 436`) — provider-id-specific.

### D.4 `providers/sse.rs`

- `SseDecoder` (`:19-146`): incremental byte parser, CRLF, multi-line data, `:` comments/keep-alives,
  `data: [DONE]` sentinel (`:139-143`).
- `stream_sse` (`:154-183`): reads `response.bytes_stream()` with `tokio::select!` against the cancellation token
  (`:164-168`); network errors → anyhow with context; used by all adapters.
- Unit tests 185-262 (no provider assumptions).

---

## E. Harness — `src-tauri/src/harness/mod.rs` (3,027 lines)

### E.1 Where provider/model/key come from the turn payload

`run_turn(deps, payload: TurnPayload, settings, on_event, cancel)` — `harness/mod.rs:112-118`.

| Step | Lines | Behavior |
| --- | --- | --- |
| Conversation | 129-132 | `db.get_conversation(payload.conversation_id)`, else error |
| Provider | 133-137 | `deps.catalog.provider(&payload.provider_id)` → error "provedor desconhecido: …" |
| Model id | 138-142 | empty `payload.model_id` → `provider.default_model_id` |
| Model | 143-152 | `catalog.model(provider.id, model_id)` → error "modelo `…` não está disponível no provedor `…`" (this is the **only** provider/model validation) |
| **API key** | 153-163 | `deps.api_key_override` (tests) else `crate::config::api_key(app, provider.id)`; **hard error** "nenhuma chave de API configurada para {provider.name}" |
| Protocols | 164 | `resolve_protocols(&provider, &model)?` (see E.2) |
| Conversation model fix-up | 166-169 | if conversation's provider/model differ, `update_conversation_model` (conversation affinity is persisted here) |
| Options gating | 175-181 | turn options AND-ed with global settings (`web_search`, `create_files`, `run_code`), `max_steps` clamp |
| Persist user msg/assistant placeholder | 188-192 | `prepare_regenerate` or `prepare_new_turn` (815-860) |
| History | 207-217 | `build_history(...)` with `supports_images(&model)` |
| System prompt | 251 | `prompt::build_system_prompt(&model, &options, &settings, &skills)` — prompt carries model name/identity |
| Reasoning/temperature/max output | 253-255 | `reasoning_request`, `temperature_request`, `Some(model.max_output.clamp(1_024, 32_768))` |
| Per-step request | 294-312 | `ProviderConfig { provider_id, provider_name, base_url, api_key: api_key.clone(), model, session_id: payload.conversation_id.clone(), user_agent: "Lumina/<ver>" }` |
| Forced final request | 556-582 | same config, empty tools, "Encerramento" prompt |

`resolve_protocols` (`:1416-1440`): model `protocols` filtered through `WireProtocol::parse`; if empty, fall back to
`provider.endpoints.keys()` parsed as protocols; `dedup`; error when empty. This is the **only** consumer of
`ProviderInfo.endpoints` (an OAuth provider with different paths cannot override adapter paths here).

`reasoning_request` `:1442-1467`; `temperature_request` `:1469-1486` (drops temperature for family/id containing
`claude`/`gpt`); `supports_images` `:1488-1498` (`attachment` flag + `modalities.input` contains `image` or empty).

### E.2 `provider_state` replay (v2) — keyed by provider/model

| Item | Lines | Notes |
| --- | --- | --- |
| `PROVIDER_STATE_VERSION = 2` | 873 | envelope version |
| `ReplayStep { text, state, call_ids }` | 881-889 | one per provider response in the agent loop |
| `wrap_provider_state` | 905-920 | `{"version":2,"steps":[{"state":…,"text":…,"toolCallIds":[…]}]}`, `None` if no step |
| `is_provider_state_v2` | 922-928 | checks `version == 2` |
| `parse_provider_state_v2` | 930-972 | tolerant parse; null `state` dropped; invalid steps skipped |
| `build_history` | 996-1072 | maps persisted messages → neutral `HistoryMessage`s; budget trimming keeps a user/system start; image gating at 1015-1022 |
| `assistant_history_group` | 1083-1119 | **`same_model = message.provider_id == Some(current provider_id) && message.model_id == Some(current model_id)`** (`:1088-1089`); v2 replay only when `same_model` (`:1091-1098`); legacy raw state only when `same_model && no tool calls && not v2` (`:1109-1111`); otherwise neutral fallback |
| `replay_steps_history` | 1124-1160 | one assistant per step + matching tool results; unreferenced persisted calls go into an extra final step |
| Loop capture | 504-538 | after tool execution, pushes assistant history + results and `ReplayStep { text, state: step_state, call_ids }` |
| Persist | 730-733 | `assistant_message.provider_state = wrap_provider_state(&replay_steps)`, `model_id`, `provider_id` |
| Usage | 736-744 | `db.record_usage(conversation, message, provider.id, model.id, &usage)` |
| Final events | 794-806 | `Cancelled` / `Error { code: None }` / `Done { result }` |

Implications:

- Replay safety is a **string pair** `(provider_id, model_id)`; a new provider id automatically isolates its replay
  from OpenCode's. But model ids collide across providers (`gpt-6-luna` exists in both Go and Zen today; an OpenAI
  provider will very likely reuse `gpt-*` ids), so provider ids must stay distinct and `message.provider_id` must
  always be persisted (it is: `prepare_new_turn` 822-829, finalize 732-733).
- Replay payload is provider-specific and opaque — a new adapter just needs to emit/consume its own shape; no harness
  change required **for replay itself**.

### E.3 Title generation

`harness/mod.rs:754-778`: only when `settings.auto_title && should_auto_title(&conversation.title)`; source = user
content or first attachment name; `derive_title` heuristic (`:1521-1588`) — markdown stripping, 48-char cap,
ellipsis; `db.rename_conversation` + `TurnEvent::TitleUpdated`. **There is no model-generated title** (no extra
provider request anywhere; grep for `title` in harness only matches these). Note `docs/ARCHITECTURE.md:160` claims
"gera título automático … com o próprio modelo … ou heurística local" — the model-based half is not implemented; don't
build the OAuth plan on it.

### E.4 Capability / attachment gating

- `supports_images` `:1488-1498`; per-message image allowance `image_enabled_messages` `:1225-1252`
  (newest-first base64 budget `MAX_HISTORY_IMAGE_BASE64_CHARS`, single image `MAX_INLINE_IMAGE_BYTES`);
  `attach_user_attachments` `:1258-1297` (text budget per file/message 36-38, binary/image load 1328-1346).
- Prompt/tools gating happens in `harness/prompt.rs` + `tools::definitions(&options)` (`mod.rs:251-252`);
  e.g. attachments told only "quando o modelo tem visão" (`prompt.rs:99`).
- Model `status == "unavailable"` is only filtered in the UI pickers; the backend accepts it if sent
  (no harness check of `status`).

### E.5 Harness tests (in-module) — `harness/mod.rs:1604-3027`

- `model()` fixture `1609-1633` (id/family/protocols/reasoning/attachment set); `provider()` fixture `1634-1651`
  hardcodes `id: "opencode-go"`, `short_name "Go"`, `base_url "https://opencode.ai/inference/go"`,
  `auth_env "OPENCODE_API_KEY"`, `default_model_id "glm-5.3-flash"`.
- Agent-loop tests create conversations with `("opencode-go", "deepseek-v4.1-flash")`: 2009, 2078, 2132, 2201, 2263,
  2367, 2443, 2472, 2545, 2782, 2839, 2889, 2940, 2978; provider-id fixtures at 1902, 1948, 2728, 2735, 2747, 2899+.
- Tests covering replay/legacy/trace behavior around 2700-3020 depend on provider/model equality semantics.
- `api_key_override` (`HarnessDeps`, `:84`) is the test seam that replaces Tauri-based key resolution — a new auth
  mode must keep an equivalent injectable seam.

---

## F. Persistence / export

### F.1 SQLite — `src-tauri/src/db.rs`

Schema constant `SCHEMA` at `:47`; DB `<app-data>/lumina.db` (`state.rs:27`, docs `ARCHITECTURE.md:68`).

| Table | Lines | Auth-relevant columns |
| --- | --- | --- |
| `conversations` | 48-58 | `provider_id TEXT NOT NULL` (`:54`), `model_id TEXT NOT NULL` (`:55`) |
| `messages` | 60-76 | `model_id TEXT` (`:70`), `provider_id TEXT` (`:71`), `usage TEXT`, `provider_state TEXT` (`:73`), `trace TEXT` (`:75`) |
| `attachments` | 78-90 | file/text metadata |
| `artifacts` | 92-103 | — |
| `usage_log` | 105-118 | `provider_id TEXT` (`:109`), `model_id TEXT` (`:110`), token columns, `cost REAL`, `created_at` |
| `meta` | 120-123 | key/value |

Column lists: `CONVERSATION_COLUMNS` `:25-26`; `MESSAGE_COLUMNS` `:28-29`. Row mapping: conversation `:336-337`,
message `:359-360`. Writes: `create_conversation` `:607-633`; `update_conversation_model` `:733-746`;
`update_message` `:783-…`; `record_usage` `:924-954`. Reset: `:1043-…`.

No migration is needed to store a new provider: both columns are free-form `TEXT`. There is **no credential table** —
secrets live only in `secrets.json` (B.2).

### F.2 DTOs — `src-tauri/src/domain.rs` (IPC contract; file header says keep in sync with `src/lib/types.ts`)

| DTO | Lines | Notes |
| --- | --- | --- |
| `Conversation` | 12-27 | `provider_id`, `model_id` strings |
| `ConversationDetail` | 29-34 | conversation + messages |
| `ChatMessage` | 162-197 | `model_id`/`provider_id` optional (`:180-182`), `usage` (`:184`), `provider_state` backend-only `#[serde(skip_serializing)]` (`:186-193`; test at 712-728), `trace` (`:194-196`) |
| `UsageInfo` | 130-148 | optional token counts, `cost`, `duration_ms` |
| `TurnPayload` | 299-315 | `provider_id`/`model_id` (`:306-307`), attachment ids, reasoning, options, turn id |
| `Settings` | 582-614 | see B.5 |
| `ProviderKeyStatus` | 645-654 | see B.4 |
| `SettingsView` | 656-661 | `{ settings, keys }` — **the payload every settings/key command returns** |
| `ProviderValidation` | 674-685 | `provider_id`, `ok`, `message`, `latency_ms`, `models` |
| `CatalogView` | 687-694 | `{ catalog, keys, remote_refreshed_at }` |

### F.3 Export — `src-tauri/src/commands/conversations.rs`

- `resolve_defaults` `:19-72`: if provider omitted, tries `find_provider_for_model` (`:32-39`), then first catalog
  provider (`:40-46`), then hardcoded `"opencode-go"` (`:51-54`); if model invalid for provider → provider
  `default_model_id` (`:55-70`), else hardcoded `"glm-5.3-flash"` (`:69`).
- `export_markdown` `:206-314`: header includes raw provider/model ids — `- **Provedor:** {conversation.provider_id}`
  (`:218`), `- **Modelo:** {conversation.model_id}` (`:219`).
- `export_conversation` `:338-…`: formats `markdown|md` (default) and `json` (pretty `ConversationDetail`); error for
  other formats (`:352-360`).
- Tests `:387+` use `provider_id: "opencode-go"`, `model_id: "glm-5.3-flash"` (`:430-431`).

Export needs no schema change (raw strings), but user-facing output would show an opaque provider id rather than a
provider name — a cosmetic change point.

---

## G. UI map

### G.1 IPC wrappers — `src/lib/api.ts`

`api` object `:24-101`. Relevant wrappers:

- settings/keys: `getSettings` 27, `saveSettings` 28, `setProviderKey(providerId, key)` **29-30**,
  `validateProvider(providerId)` 31-32, `openDataDir` 33, `resetAppData` 34;
- catalog: `getCatalog` 45, `refreshCatalog` 46, `listRemoteModels(providerId)` 47-48;
- conversations: `createConversation(title?, providerId?, modelId?)` 52-57;
- turn: `runTurn(payload, onEvent)` **96-100** (Channel-based streaming).

Any new OAuth command needs a typed wrapper here first (Lead-owned contract file).

### G.2 Store — `src/lib/store/appStore.ts`

- `DEFAULT_SETTINGS` `:22-45` — hardcodes `defaultProvider: 'opencode-go'` (`:25`), `defaultModel:
  'deepseek-v4.1-flash'` (`:26`).
- State fields `:47-81`: `ready`, `initializing`, `appInfo`, `settings`, `keys: ProviderKeyStatus[]` (`:52`),
  `providers: ProviderInfo[]` (`:53`), `selection: ModelSelection` (`:54`), `favorites` (`:55`),
  `error`, `catalogRefreshedAt`.
- `init` `:101-138`: parallel `api.getSettings()`, `api.getCatalog()`, `api.appInfo()`; merges persisted selection
  with catalog (`:111-124`): provider must exist (`getProvider`), model must exist in that provider, reasoning
  reconciled; stores providers from the catalog view (`:130`) and `keys` (`:129`).
- `saveSettings` `:140-149`; `reloadSettings` `:151-158`; **`setProviderKey` `:160-167`** — only `keys` are updated
  from the returned `SettingsView`, no auth/account state; `setSelection` `:169-175` (also persists
  `defaultProvider/defaultModel` when changed); `setReasoning` `:177`; `setActiveSelection` `:179`;
  favorites `:181-188`; `refreshCatalog` `:190-201`; `validateProvider` `:203`.
- Persistence: zustand `persist` name `lumina.app`, `partialize` selection + favorites only (`:207-210`).

There is **no auth state machine** (logged-in provider, pending login, token expiry, account/plan). `keys` is the
only credential-derived UI state and it is key-shaped.

### G.3 Settings — `ProvidersTab.tsx`, `ModelTab.tsx`, dialog/tab registries

`src/components/settings/ProvidersTab.tsx`:

- `KEY_SOURCE_LABEL: Record<ProviderKeyStatus['source'], string>` `:15-20` — exhaustive over
  `settings|env|opencode-cli|none`.
- provider list falls back to static catalog when store empty `:28`;
- `saveKey` `:35-51` (calls `setProviderKey`, checks `key?.hasKey`), `removeKey` `:53-68` (null → remove),
  `testConnection` `:70-96` (calls `validateProvider`);
- privacy notice `:100-107` — mentions `secrets.json`, `OPENCODE_API_KEY`, OpenCode CLI login;
- per-provider card `:109-220`: status badge `:121-123`, `masked` code `:124-128`, `env:
  {provider.authEnv}` `:129-131`, Console link `provider.consoleUrl` `:132-140`, **password input** `:143-163`
  (placeholder `'Colar API key do OpenCode Console…'` `:156-158`), Save `:164-171`, Remove `:172-180`,
  Test connection `:183-208`, notes `:210-216`;
- footer `:222-226`: "requisições vão direto para o gateway do OpenCode" and removal semantics.

`src/components/settings/ModelTab.tsx` (default model):

- provider `<NativeSelect>` `:131-144` with hardcoded description **"OpenCode Go (assinatura) ou OpenCode Zen
  (créditos)."** (`:131`);
- model select `:146-159`; capability badges `:161-169`; `ThinkingSelector` `:170-178`;
- commit persists `defaultProvider`, `defaultModel`, `reasoningDefault`, and updates active selection only when the
  model is not locked (`commit` `:78-96`); lock UI `:121-129`; `locked = selectModelLocked` `:43`.

`SettingsDialog.tsx`: tab values and content `:88-108`; providers tab content at `:91-93`.
`src/lib/settingsTabs.ts`: ids `:9-16` (includes `'providers'`), labels `:23-31`, `DEFAULT_SETTINGS_TAB` `:33`,
`isSettingsTabId` `:38-40`. Command palette uses these labels/descriptions — `usePaletteActions.ts:52-54`
("Chaves de API e status dos provedores") and `:465`.

**No OAuth UI exists**: no "Entrar com ChatGPT", no device/browser-flow status, no account/plan display, no logout,
no reauth banner.

### G.4 Model picker surfaces — `src/components/models/*`

- `ModelPickerDialog.tsx` (full dialog): preview state `:64-68`; `defaultModelFor` `:70-79`; `initialProviderId`
  `:81-87`; `initialPreview` `:90-110`; `commitSelection` `:306-311`; `commitPreview` `:313-316`;
  `commitEntry` `:318-327`; provider tabs `:447-506` (`TabsList aria-label="Provedores"` `:459-478`; key dot
  `providerHasKey(keys, provider.id) ? 'bg-success' : 'bg-border-strong'` `:471-474`; tooltip
  `keyStatusLabel(keyStatusFor(keys, provider.id))` `:465`); preview no-key warning wiring `:233`;
  detail panel `:508+`; footer trigger `:571-597`.
- `ModelPill.tsx` (composer popover): provider segmented options `:627-643` (dot based on `providerHasKey` `:629`,
  `:637`); `allProvidersLabel = shortNames.join(' + ')` `:645`; commit model selection `:523-545` (`setSelection`
  `:530`); provider change `:491-502`; details panel key status `:875`.
- `ModelRow.tsx`: row identity `providerId:modelId` id helper `:30-33`; `FamilyAvatar` `:90`; `CapabilityBadges`
  `:103`; context/price `:120-125`; unavailable guard `:60, 69-80`; favorite star `:137-169`.
- `FamilyAvatar.tsx`: `BRAND_VISUALS` per icon `:41-58` (`openai` green tile `:46`); `familyAvatarVisual`
  `:76-90`; render `:96-124` (uses `MODEL_ICON_SVG[icon]` `:117`).
- `CapabilityBadges.tsx`: `capabilitiesOf` `:12-45` (free/vision/reasoning/open/Preview/Indisponível);
  component `:55-73`.
- `ModelDetailPanel.tsx`: provider · id line `:90`; no-key warning **"Sem chave de API para {entry.providerName}.
  Configure em Configurações › Provedores."** `:164-177`.
- `MessageItem.tsx:57` resolves the model from `message.providerId`/`modelId` for the message footer.
- `ModelList.tsx` / `ModelSearchField.tsx` / `ThinkingOptions.tsx` / `ThinkingSelector.tsx` are presentation-only;
  no auth logic.

### G.5 Chat shell, composer, store affinity

- `WelcomeScreen.tsx`: hero copy `:79-82` — "…com os modelos OpenCode Go e Zen." (`:81`); suggestions dispatch
  `lumina:suggest` (`:46-48`).
- `ChatView.tsx`: layout only; empty conversation → `<WelcomeScreen/>` `:78-81`; composer pinned `:89-97`;
  **no key/auth gating**.
- `Composer.tsx`: `canSend` depends only on non-empty text/attachments and not streaming `:37-38`; `submit`
  `:81-88` calls `chatStore.send`; model pill at `:191`; no auth check.
- `src/lib/store/chatStore.ts` (provider affinity / model lock):
  - lock rule `selectModelLocked` `:85-93` (streaming, or conversation has messages/messageCount > 0);
    copy `MODEL_LOCKED_TITLE/DESCRIPTION` `:96-98`;
  - `syncSelectionToConversation` `:100-118` (aligns global selection to conversation's provider/model on open);
  - `lockedSelectionFor` `:126-144` — the turn always uses the conversation's `providerId`/`modelId` when locked;
  - `turnOptionsFromSettings` `:146-158`;
  - new-conversation flow `:593-605` (`api.createConversation` with `selection.providerId/modelId`; "Novo chat"
    resets to `defaultSelection(settings)`);
  - `send` `:697-790`: `selection` `:710`; `ensureConversation` `:514-521`; optimistic messages carry
    `providerId/modelId` `:733-734, 748-749`; `TurnPayload` `:772-781`;
  - `regenerate` `:792-860+` (locks selection to conversation).
- `src/lib/modelMenu.ts`: `modelKey`/`parseModelKey`/`selectionKey` `:36-52`; `FAMILY_LABELS` `:58-78`;
  `familyLabel` `:81-87`; search (`modelMatchesQuery` `:123-…`, `normalizeSearch` `:100-102`,
  `modelHaystack` `:104-117`); filters `modelFilterOptions` `:147`; grouping `buildModelGroups` `:255-…`;
  details `modelDetails` `:622-656` (protocol label, status note `modelStatusNote` `:659-667`);
  **provider-key helpers** `keyStatusFor` `:673-678`, `providerHasKey` `:680-682`, `keyStatusLabel` `:684-695`
  (exhaustive switch: `settings`, `env`, `opencode-cli`, default "Sem chave de API").
- `src/lib/modelIcons.ts`: `ModelIconKey` union `:39-55`; labels `:58-75`; `FAMILY_TO_ICON` `:86-121`
  (already contains `openai` ← `gpt`, `codex`, `openai` aliases at `:98-101`); `normalizeModelFamily` `:124-129`;
  `modelIconForFamily` `:135-141`; `fallbackInitials` `:155-165`. Asset bundle: `modelIconAssets.ts:14-29`
  (imports 16 SVGs incl. `openai.svg` `:25`) and `MODEL_ICON_SVG` `:32-49` — **OpenAI brand icon already bundled**.
- `src/lib/hotkeys.ts`: `HotkeySnapshot` `:19-27`, resolver `:75-104` — **no provider/auth assumptions; no change
  required**.
- `src/lib/settingsTabs.ts`: see G.3.
- `src/App.tsx`: boot init `:25-33` (`useAppStore.init()` before chat init), shell/dialogs `:206-207`.

### G.6 Settings components copy/labels that encode the two-provider/key model

- `AboutTab.tsx`: `OPENCODE_URL`/`CONSOLE_URL` `:9-10`; description "Chat desktop local-first com OpenCode Go e Zen."
  `:25`; catalog stats `:47`; "OpenCode" link row `:57-61`; "Console do OpenCode" `:67`; privacy footnote `:92`.
- `DataTab.tsx:93`: reset copy "…configurações e chaves de API serão apagadas…".
- `WelcomeScreen.tsx:81`; `ModelTab.tsx:131`; `ProvidersTab.tsx:100-107, 156-158, 222-226` (see G.3).
- `README.md:3,10,38,70,83,92,96`; `src-tauri/Cargo.toml` description "OpenCode Go / Zen";
  `src-tauri/tauri.conf.json` `bundle.longDescription` mentions Go/Zen.

---

## H. Exhaustive hardcoded-assumption inventory

Grouped so the plan can assign owners. Line numbers are real references in the current tree.

### H.1 Provider id literals `"opencode-go"` / `"opencode-zen"`

| Where | Lines | Kind |
| --- | --- | --- |
| `src-tauri/src/config.rs` | 215-216 (`cli_entry_ids`) | CLI mapping, `_ => &[]` for any future provider |
| `src-tauri/src/domain.rs` | 621-622 | `Settings::default()` provider/model |
| `src-tauri/src/commands/conversations.rs` | 53, 69 | fallback provider/model when catalog lookup fails |
| `src-tauri/src/harness/mod.rs` | 1636, 1902, 1948, 2009, 2078, 2132, 2201, 2263, 2367, 2443, 2472, 2545, 2728, 2735, 2747, 2782, 2839, 2889, 2899, 2905, 2910, 2940, 2978, 2985, 2991, 3003 | test fixtures (`provider()`, `create_conversation`) |
| `src-tauri/src/providers/mod.rs` | 604, 609, 790, 794, 808, 841, 845, 847, 912, 916, 925, 1000, 1004, 1006, 1045, 1049, 1051, 1076, 1080, 1082, 1159, 1163-1164, 1185, 1191-1192, 1208-1209 | smoke tests read OpenCode CLI key and assert gateway models |
| `src-tauri/src/providers/reasoning.rs` | 258, 273, 294, 316, 339, 352, 375, 389, 402, 436 | tests fixture provider ids |
| `src-tauri/src/db.rs` | 1130-1134, 1141-1142, 1153, 1169-1170, 1281-1284, 1313, 1345, 1399, 1474, 1518-1534, 1554, 1580-1583 | tests (`create_conversation`, `record_usage` with go/zen) |
| `src-tauri/src/commands/conversations.rs` | 430-431 | export test fixture |
| `data/catalog.json` | 14, 1821 | provider ids |
| `scripts/build-catalog.mjs` | 303, 318 | provider construction |
| `src/lib/catalog.ts` | 43 | fallback default provider |
| `src/lib/store/appStore.ts` | 25-26 | DEFAULT_SETTINGS provider/model |
| `src/lib/__tests__/catalog.test.ts` | 20-28, 33, 142, 160, 175 | tests |
| `src/lib/__tests__/modelMenu.test.ts` | 35-36, 76-78, 88-89, 113-130, 141-144, 265-288, 353-362, 377-378, 413-417, 494-497, 533-540, 546-552 | tests/fixtures |
| `src/lib/__tests__/chatStore.test.ts` | 55, 119, 207, 434, 640-700, 723-800 | tests/fixtures |
| `src/lib/__tests__/utils.test.ts` | 24 | fixture |
| `src/lib/palette/__tests__/search.test.ts` | 40 | fixture |
| `src/components/models/ModelPill.test.tsx` | 38-39, 128-129, 406, 414 | tests |
| `src/components/models/ModelPill.edge.test.tsx` | 32-33, 116-117, 275 | tests |
| `src/components/models/ModelPickerDialog.test.tsx` | 19, 41-42, 238, 306-316 | tests |
| `src/components/models/ModelPickerDialog.edge.test.tsx` | 23, 38-39, 70-93, 274, 302, 328 | tests |
| `src/components/settings/ModelTab.test.tsx` | 23, 29, 59, 95-98, 126, 130 | tests |
| `src/components/settings/ToolsTab.test.tsx` | 30 | fixture |
| `src/components/skills/SkillsView.test.tsx` | 34 | fixture |
| `src/components/layout/Sidebar.test.tsx` | 37, 68 | fixture |
| `src/components/palette/CommandPalette.test.tsx` | 34, 65, 84, 121 | fixture |
| `docs/MODEL_SELECTOR_REDESIGN.md` | 202 | example key literal |

### H.2 "Only two providers / OpenCode-only" copy & docs

- `docs/MODELS.md:3` ("Os únicos provedores suportados são…"); `:5-8` table; `:93`.
- `docs/ARCHITECTURE.md:3` ("únicos provedores"), `:100` (catalog sources), `:114` (frontend + `include_str!`),
  `:116-146` (§7 four protocols/OpenCode base), `:160` (title claim), `:405` (security: keys only).
- `docs/DESIGN.md:122` (two-provider search), `:133-134` (tabs Go/Zen), `:136` (detail panel), `:146` (Providers
  settings section), `:101` (key error CTA), `:229` (error copy "Chave de API ausente").
- `docs/MODEL_SELECTOR_REDESIGN.md:23, 29, 45, 56, 106, 124, 167, 185-190, 309, 316, 355-365, 388`.
- `docs/FILES.md:873` (settings/providers reference inside test list).
- `README.md:3, 10, 38, 70, 83, 92, 96`.
- `src/components/chat/WelcomeScreen.tsx:81`; `src/components/settings/ModelTab.tsx:131`;
  `src/components/settings/ProvidersTab.tsx:100-107, 156-158, 222-226`;
  `src/components/settings/AboutTab.tsx:9-10, 25, 57-67, 92`.
- `src/components/palette/usePaletteActions.ts:54` ("Chaves de API e status dos provedores").
- `src-tauri/Cargo.toml` description; `src-tauri/tauri.conf.json` `bundle.longDescription`.
- Tests asserting two-provider content: `src/lib/__tests__/catalog.test.ts:25-30` ("exposes both OpenCode
  providers"), `src/components/models/ModelPickerDialog.test.tsx:142` ("busca global encontra modelos dos dois
  provedores"), `src/components/models/ModelPickerDialog.edge.test.tsx:181` (`queryAllByRole('tab')` length 2),
  and the count assertions at `:149, 150, 156, 157, 178, 182` (38 Go / 82 Zen / 120 combined) which will drift if
  the catalog gains a provider or models.

### H.3 Key-only / one-key-per-provider assumptions

- Credential type is `String` everywhere: `SecretsFile.providers` (`config.rs:137-141`), `resolve_key`
  (`:254-270`), `api_key` (`:273-275`), `set_api_key` (`:277-290`), `mask_key` (`:292-301`).
- One env var for both providers and provider id ignored: `key_from_env(_provider_id)` (`:242-251`).
- CLI detection only for the two ids: `cli_entry_ids` (`:212-219`); comment/paths (`:192-210`).
- DTO carries no token metadata: `ProviderKeyStatus` (`domain.rs:645-654`); TS mirror (`types.ts:416-421`).
- Key validation assumes API-key shape: `commands/settings.rs:65-75` (min 20 chars, no whitespace);
  error copy references OpenCode Console (`:69-70`).
- Masking a bearer token would be wrong: `config.rs:292-301`.
- Plaintext storage / no keychain: `write_private` (`config.rs:156-186`).
- Public key API used by harness (`harness/mod.rs:153-163`) and catalog/validation commands
  (`commands/models.rs:39, 44, 73`; `commands/settings.rs:199, 218`).
- UI: `KEY_SOURCE_LABEL` (`ProvidersTab.tsx:15-20`), `keyStatusLabel` (`modelMenu.ts:684-695`),
  `ProviderKeyStatus['source']` union (`types.ts:420`), `appStore.setProviderKey` (`appStore.ts:160-167`),
  `api.setProviderKey` (`api.ts:29-30`), password form (`ProvidersTab.tsx:143-180`).

### H.4 `hasKey` gating (UI-only, never blocks a turn)

- `providerHasKey` / `keyStatusFor` (`modelMenu.ts:673-682`) consumed by:
  - `ModelPickerDialog.tsx:233, 465, 471-474` (tab dot/tooltip);
  - `ModelPill.tsx:629, 637, 875` (provider segmented dot + details);
  - `ModelDetailPanel.tsx:164-177` (warning + "Configurar" CTA);
  - `ProvidersTab.tsx:42, 58, 111, 121-122, 157, 172` (badge/labels/buttons).
- **No send-time gating**: `Composer.tsx:37-38` (`canSend` ignores keys), `ChatView.tsx` (no gate),
  `chatStore.send` (`chatStore.ts:697-790`) sends regardless; the backend then errors
  (`harness/mod.rs:153-163` → `TurnEvent::Error`). For OAuth this becomes a UX decision point (reauth CTA).

### H.5 Provider/model validation assumptions

- Only catalog membership: `harness/mod.rs:133-152`; `commands/settings.rs:59-61`; `commands/models.rs:69-72`;
  `resolve_defaults` (`commands/conversations.rs:48-70`).
- `Settings.default_provider/default_model` not validated against catalog (`config.rs:94-99`).
- `ProviderInfo.default_model_id` not validated against its `models` (`catalog.rs:39`).
- Model `status == "unavailable"` ignored by backend (filtered only in UI: `ModelTab.tsx:63, 102-104`;
  `ModelPickerDialog.tsx:70-79, 318-319`; `ModelRow.tsx:60,69-80`).
- Model ids not globally unique: first-match lookups `catalog.rs:142-147`, `catalog.ts:30-36`; conversations fall
  back to model→provider inference (`conversations.rs:32-39`). An OpenAI provider reusing `gpt-*` ids is safe only if
  the provider is explicit (picker/`create_conversation` always pass provider from selection, but legacy/import paths
  may not).

### H.6 URL/header/path assumptions

- Fixed path constants per protocol: `providers/mod.rs:289-297`; used by `openai_chat.rs:27`,
  `openai_responses.rs:28`, `anthropic.rs:27`, `google.rs:29`; `ProviderInfo.endpoints` values are **never used for
  URLs** (only keys for protocol order at `harness/mod.rs:1425-1431`).
- Auth header hardcoded: `providers/mod.rs:335-337`; OpenCode session header `:338-340`; UA `:341-343`.
- `/v1/models` hardcoded in three commands: `commands/settings.rs:213`, `commands/models.rs:43, 75`.
- `base_url` assumed to be a gateway root with those path suffixes (`docs/MODELS.md:5-8`, `ARCHITECTURE.md:116-125`).
- Redirect policy limited to 8 (`http.rs:11`); no proxy configuration.

### H.7 Protocol/error assumptions

- `WireProtocol::parse` only four names (`providers/mod.rs:46-54`); unknown catalog protocol strings are silently
  dropped (`harness/mod.rs:1420-1431`).
- Fallback only on `UnsupportedProtocol` (`providers/mod.rs:483-541`), detected by OpenCode-specific body text
  (`:267-269`).
- HTTP mapping has no auth-expired/subscription-specific variants (`:263-278`); 402 copy is OpenCode-specific;
  401 copy in `validate_provider` mentions OpenCode Console (`commands/settings.rs:251-254`).
- No retry/refresh path anywhere (grep for `refresh` only finds catalog refresh + token-free code).
- No usage/rate-limit window surfaced to the UI (only token counts; `UsageInfo` `domain.rs:130-148`).

### H.8 Test inventory that would need updating

Rust (`cargo test --lib`):

| File | Tests/lines | Why it breaks or needs a case |
| --- | --- | --- |
| `src-tauri/src/config.rs` | module 329-488; mask 333-341, defaults 343-347, normalization 349-390 (+ defaults assertions 381-382), low clamps 392-404, code defaults 406-415, legacy 417-430/458-467, skills 432-456, timeout 469-487 | new credential shape / ProviderKeyStatus fields / defaults; OAuth persistence tests |
| `src-tauri/src/domain.rs` | 704+ (provider_state IPC test 711-728) | any new DTO fields (e.g. ProviderAuthStatus) and serde shape |
| `src-tauri/src/db.rs` | 584+; conversations 1129-1180, messages 1140-1220, migrations 1242-1280, usage 1515-1560+ | provider ids are fixtures; new provider usage rows test |
| `src-tauri/src/commands/conversations.rs` | 387+; resolve_defaults export tests 430-471 | fallback provider/model hardcoded |
| `src-tauri/src/harness/mod.rs` | 1604+; fixtures 1609-1651; loop/replay tests 1846-3027 | `provider()` fixture, `api_key_override`, replay keyed by provider/model; new auth seam needs an injectable token provider |
| `src-tauri/src/providers/mod.rs` | smoke module 571-1308; `auth_key` 597-613; `provider_config` 615-629; ignored tests 786, 837, 908, 996, 1041, 1072, 1180 | OpenCode CLI auth; `ProviderConfig.api_key`; new OAuth smoke test would need a different helper |
| `src-tauri/src/providers/reasoning.rs` | 243-458 | provider-id fixtures; protocol mapping for new models |
| `src-tauri/src/providers/sse.rs` | 185-262 | unaffected |

Renderer (`pnpm test`, Vitest):

| File | Lines | Why |
| --- | --- | --- |
| `src/lib/__tests__/catalog.test.ts` | 20-43, 128-176 | two-provider assertion, `defaultSelection` defaults |
| `src/lib/__tests__/modelMenu.test.ts` | 35-36, 533-552 (key status), plus provider-scoped grouping 141-334 | `keyStatusFor`/`providerHasKey`/`keyStatusLabel` sources |
| `src/lib/__tests__/chatStore.test.ts` | 55, 119, 207, 434, 640-700, 723-800 | provider/model lock + payload selection |
| `src/lib/__tests__/modelIcons.test.ts`, `modelIcons.edge.test.ts` | icon key set (asserts exactly the bundled keys), `fallbackInitials` | only if a new family/icon is added; OpenAI mapping already exists |
| `src/components/models/ModelPickerDialog.test.tsx` | 19, 41-42, 142, 238, 306-316 | key mocks, two-provider search, no-key warning |
| `src/components/models/ModelPickerDialog.edge.test.tsx` | 23, 38-39, 149-160, 178-183, 190-220, 224-269 | exact model counts 38/82/120, tab count 2, provider injection |
| `src/components/models/ModelPill.test.tsx` | 38-39, 128-129, 406-414 | GO/ZEN constants, no-key details |
| `src/components/models/ModelPill.edge.test.tsx` | 32-33, 116-117, 190-260, 476 | provider switching / key dot |
| `src/components/settings/ModelTab.test.tsx` | 23-130 | GO constant and default-model commit |
| `src/components/settings/SettingsDialog.test.tsx` | 17-53 (tab names/ids; "Provedores" not asserted directly) | only if a new tab is added (not needed for OAuth inside Providers) |
| `src/components/palette/CommandPalette.test.tsx` | 34, 65, 84, 121 | fixtures with defaultProvider |
| `src/components/layout/Sidebar.test.tsx` | 37, 68 | fixture |
| `src/components/settings/ToolsTab.test.tsx` | 30 | fixture |
| `src/components/skills/SkillsView.test.tsx` | 34 | fixture |
| `src/lib/__tests__/utils.test.ts`, `src/lib/palette/__tests__/search.test.ts` | 24 / 40 | fixtures |
| New tests to add | — | OAuth store/auth state, ProviderKeyStatus→UI label mapping, provider auth command validation (backend), and a "token cannot be stored via set_provider_key" negative test |

Note: no Vitest file for `ProvidersTab.tsx` exists today (grep: none) — OAuth UI would be untested unless added.

### H.9 Docs that must be updated

- `AGENTS.md` — ownership table `:22-34` (who owns the new auth module: likely `config.rs`/secrets = storage-dev,
  OAuth flow module = new/shared, wire headers = provider-dev, UI = ui-systems; Lead owns `types.ts`, `api.ts`,
  `lib.rs`, `catalog.rs`, `data/catalog.json`). Also `docs/FILES.md` conventions if a new module is added.
- `docs/ARCHITECTURE.md` — `:3` intro, `:66-94` §5 data model/files (secrets.json shape, new auth files),
  `:96-114` §6 catalog (provider count/schema, generator), `:116-146` §7 providers (5th "provider kind",
  auth/header matrix, per-provider endpoints), `:148-161` §8 harness (key resolution/title), `:388-401` §12 IPC
  (new commands), `:403-415` §13 security (token storage, never to renderer), `:427-435` §15 verification (new tests).
- `docs/MODELS.md` — `:3-17` providers table + headers, `:19-35` protocol table (add OpenAI models), `:39-73`
  reasoning mapping (Responses is reused), `:89-93` limits & privacy + key detection, `:95-103` regenerate catalog.
- `docs/DESIGN.md` — `:101` key errors (reauth copy), `:122,133-134,136` selector provider tabs/search (3 providers
  instead of 2), `:146-147` Providers/Model settings sections (OAuth card), `:229` error strings.
- `docs/MODEL_SELECTOR_REDESIGN.md` — `:23,45,56,106,124,167,185-190,309,316,355-365,388` (contract for
  `keyStatusFor`/`providerHasKey`, provider tabs, missing-key CTA).
- `docs/MODEL_ICONS.md` — only if a new family icon is required (OpenAI/gpt already mapped; drop-in).
- `docs/FILES.md` — `:873` provider settings reference; add new auth module to file inventory if created.
- `README.md` — `:3,10,38,70,83,92,96`.
- `src-tauri/Cargo.toml` description; `src-tauri/tauri.conf.json` `bundle.longDescription`.
- Historical goals under `docs/goals/**` can be left as-is (marked v1).

---

## I. Change-point table for "OpenAI as new provider with OAuth (ChatGPT/Codex) auth"

Legend: **C** = contract (Lead), **S** = storage/auth-dev, **P** = providers-dev, **H** = harness-dev, **U** = ui-systems/ui-core.
"Token-fit" column calls out where a token set cannot live in the current `String` API-key model.

> Alignment with `docs/research/openai-oauth.md`: the recommended shippable path is **A** — the documented
> "Sign in with ChatGPT" OSS flow (dynamic client registration, loopback callback) calling the public
> `https://api.openai.com/v1/responses` with `store:false`/`stream:true` (task-1 §0, §1, §8). Path **B**
> (Codex CLI `client_id` + `chatgpt.com/backend-api/codex`) is internal/undocumented and must not be a public
> feature (task-1 §2, §8.3); if kept for experiments it stays behind a flag. The change points below are written
> for path A, with the extra path-B differences called out where they matter.

### I.1 Catalog & data model

| # | Change point | Current seam | Required change | Owner | Token-fit problem |
| --- | --- | --- | --- | --- | --- |
| 1 | Provider auth descriptor | `ProviderInfo` (`catalog.rs:23-43`, `types.ts:65-77`) has `auth_env` only; `data/catalog.json` provider object sketch at §A.3 | Add `auth` descriptor, e.g. `{ "mode": "apiKey" \| "oauth-chatgpt", "envVar"?: string, "loginLabel"?: string }` or a `capabilities` object; make `authEnv` optional. Update Rust + TS + JSON + generator. | C | not credential storage, but the UI needs to know which card to render |
| 2 | Provider wire descriptor | paths fixed in `providers/mod.rs:289-297`; `endpoints` unused for URLs | Either use `ProviderInfo.endpoints` in adapters (`endpoint(base_url, endpoints[protocol])`) or add a provider-level path/`baseUrl` strategy. For path A: base `https://api.openai.com`, response path `/v1/responses` (task-1 §1.3/§3.1); path B (if experimented) needs `https://chatgpt.com/backend-api/codex` + headers (§3.2). | C+P | headers/body differ from the gateway; `ProviderConfig` has no header map (§D.1) |
| 3 | New provider entry in `data/catalog.json` | `:13-28` (Go), `:1820-1834` (Zen) | Hand-add `openai` provider object (`baseUrl: https://api.openai.com` for path A, endpoints `{ "openai-responses": "/v1/responses" }`, default model/models); must extend `build-catalog.mjs` (`:260-291, 293-330`) or add an overlay so regeneration keeps it. | C | — |
| 4 | Model entries for OpenAI | `ModelInfo` (`catalog.rs:45-81`) has provider-agnostic fields; `protocols` must include `"openai-responses"` | Add models with gpt/codex families (`family: "gpt"` already maps to the OpenAI icon, `modelIcons.ts:98-101`), protocols `["openai-responses"]`, reasoning options. Watch id collisions with Go/Zen (`gpt-6-luna` exists in both today). | C | model ids may collide across providers; provider id must always accompany them |
| 5 | `find_provider_for_model` / `findModel` ambiguity | `catalog.rs:142-147`, `catalog.ts:30-36` | If OpenAI reuses ids present in Go/Zen, first-match inference is wrong; prefer explicit provider everywhere or namespace ids. Decide policy in plan. | C | — |

### I.2 Credentials, secrets file, token lifecycle

| # | Change point | Current seam | Required change | Owner | Token-fit problem |
| --- | --- | --- | --- | --- | --- |
| 6 | Secrets shape | `SecretsFile.providers: BTreeMap<String,String>` (`config.rs:135-141`); opaque private struct | Introduce a credential enum with serde untagged/backward-compat: `ApiKey(String)` (legacy `"sk-…"` values) vs `OAuth { access_token, refresh_token, expires_at, account_id, plan_type, email?, scopes? }`. Keep reading legacy string values so existing `secrets.json` keeps working; migrate on write. | S | **primary blocker**: one `String` per provider cannot hold access+refresh+expiry+account; `secrets.json` is the only store |
| 7 | Key resolution API | `resolve_key` `:254-270`, `api_key` `:273-275`, `set_api_key` `:277-290` | Add `credentials(app, provider_id) -> Option<Credentials>` and `set_credentials(...)`; keep `api_key()` as a compatibility shim for API-key providers or replace all call sites (`harness`, `commands/models`, `commands/settings`). Add refresh trigger (async, serialized per provider) before returning an access token. | S | returns `Option<String>` today; refresh/expiry not representable |
| 8 | Key status DTO | `ProviderKeyStatus` (`domain.rs:645-654`; TS `types.ts:416-421`; `source` union) | Extend with `auth_mode`, `account`/`email`, `plan`, `expires_at`, `needs_reauth` or a nested `auth` object; keep `has_key` semantics or rename to `authenticated` (breaking IPC for UI). Extend `source` union with `'oauth'` (and maybe `'oauth-cli'`). | C+S | no place for expiry/account/plan; `masked` must NOT be the access token |
| 9 | New auth module | none exists; `base64`/`sha2`/`url` already in `Cargo.toml`; tokio full; `tauri-plugin-opener` present; no keyring/deep-link crate | Add e.g. `src-tauri/src/auth/{mod,oauth_pkce,loopback}.rs` (or `config/oauth.rs`): PKCE verifier/challenge, state, `ext_agent_host_id`, dynamic client registration (`client_id=dynamic_agent_client` first login, persist issued `oaiapp_…`), authorize URL open via opener, loopback `TcpListener` on `127.0.0.1:<port>/auth/callback` (task-1 §1.2-1.3), token exchange/refresh/revoke (task-1 §1.4), expiry clock. Register as a module in `lib.rs` (13-24) and initialize state in `AppState` if a pending-flow map is needed (`state.rs:14-39`). | S (new owner per AGENTS) | refresh token is a long-lived secret; task-1 §8.6 recommends OS keychain per client_id/account — decision still needed vs `secrets.json` ACL |
| 10 | Env/CLI detection | `key_from_env` ignores provider (`config.rs:242-251`), CLI ids `:212-219` | For OpenAI OAuth: no env/CLI fallback (or add `OPENAI_API_KEY` support if the path-C API-key mode is also wanted, task-1 §4/§8.2). Guard `_ => &[]` behavior. | S | n/a |
| 11 | Plaintext-at-rest policy | `write_private` (`config.rs:156-186`) | Decide whether tokens go to the same `secrets.json` (document risk) or an OS keychain store (task-1 §8.6 recommends Windows Credential Manager, keyed per client_id/account); if new store, add migration/read-fallback and error handling for locked keychain. Also persist the issued `client_id` + `ext_agent_host_id` needed for reauth (task-1 §1.2). | Lead decision + S | tokens are credentials with refresh lifetime; API-key-level protection may be accepted but must be a recorded decision |
| 12 | Refresh concurrency | none | Serialize refreshes per provider (mutex/single-flight) to avoid invalidating a rotated refresh token; persist new tokens atomically; handle 401 mid-turn by refreshing once before surfacing error. | S | current API is synchronous `Option<String>` with no state |

### I.3 IPC commands

| # | Change point | Current seam | Required change | Owner | Token-fit problem |
| --- | --- | --- | --- | --- | --- |
| 13 | Login commands | `invoke_handler` `lib.rs:40-76`; no auth commands | Add e.g. `start_provider_login(provider_id) -> ProviderLoginChallenge` + `complete_provider_login(provider_id) -> SettingsView` (or a login flow command that resolves when the loopback callback arrives), `cancel_provider_login`, `sign_out_provider(provider_id)`, maybe `get_provider_auth_status`. Register in `lib.rs`, expose in `api.ts`. | C+S | n/a |
| 14 | Async/login IPC shape | `get_settings`/`get_catalog` are sync (`commands/settings.rs:38, 43`; `commands/models.rs:24`), reading secrets each call | Token refresh cannot block inside sync commands; either keep `ProviderKeyStatus` derived from stored metadata (no network) and refresh lazily on turn, or add async command/event (`TurnEvent`-like or Tauri event) for login progress. | C | `SettingsView` has no async/auth-state channel |
| 15 | `set_provider_key` contract | `commands/settings.rs:52-79` (min-20/no-space, OpenCode copy) | Reject key setting for OAuth providers (or repurpose as "paste token" for tests only); auth-mode-aware errors. | C+S | signature `(provider_id, key: Option<String>)` cannot express token objects |
| 16 | `validate_provider` | `commands/settings.rs:185-297`: `/v1/models` + Bearer (`:213,218`), OpenCode error copy (`:251-257`) | Branch by auth mode/provider: for OAuth call `GET https://api.openai.com/v1/models` with the access token **and parse the OAuth shape `{models:[{slug,display_name,visibility}]}`** (task-1 §4.1: plan tokens do not return `data[]`; the current count parser at `:227-237` would report 0). Return auth-specific messages (`reauth needed`, plan/limits). | C+S | `validate_provider` only takes `provider_id`; no place for token/account; model-count parsing is `data[]`-only |
| 17 | `refresh_catalog` / `list_remote_models` | `commands/models.rs:31-61` (skips providers without `config::api_key` `:39`), `:63-98` (errors without key `:73-74`, parses `data[]` `:88-98`) | Auth-aware: for OAuth providers list/refresh with the token and a **dual parser** (`data[]` for API key, `models[].slug` for ChatGPT plan tokens — task-1 §4.1/§8.5); don't silently skip (or skip with a typed reason); avoid `Bearer`-only assumptions. | C+S | both are key-string shaped (`api_key`) |
| 18 | Settings payload | `SettingsView` (`domain.rs:656-661`; TS `types.ts:423-426`) | Add auth/account info (either in richer `ProviderKeyStatus` or separate `auth: Vec<ProviderAuthStatus>`). Keep tokens out of IPC (ARCHITECTURE `:405`). | C | no auth fields; only hasKey/masked/source |
| 19 | Turn errors → UI reauth | `TurnEvent::Error { message, code: Option<String> }` (`events.rs:62-66`); `ProviderError::Unauthorized` (`providers/mod.rs:271`) | Use `code` (currently always `None`, harness `:798-802`) to signal `auth_required`/`rate_limited`/`plan_required` so the renderer can show a login CTA instead of a raw error. | H+U | no structured auth error contract today |

### I.4 Wire layer (providers/)

| # | Change point | Current seam | Required change | Owner | Token-fit problem |
| --- | --- | --- | --- | --- | --- |
| 20 | Credential in request | `ProviderConfig.api_key: String` (`providers/mod.rs:163-173`); built in harness `:295-303, 565-573` | Replace/augment with an auth context enum, e.g. `Auth::ApiKey(String)` vs `Auth::OAuth { access_token, account_id: Option<…>, plan: Option<…>, extra_headers: Vec<(String,String)> }`. Harness obtains it from the new credential API after refresh. For path A the wire needs only a Bearer access token (account/plan are UI metadata; task-1 §1.4); path B additionally needs `ChatGPT-Account-ID`/`originator`/`version` (§3.2). | C+P+H | **blocker**: OAuth needs a token + (path B) account-id header; `String` cannot encode both, and token may rotate between steps |
| 21 | Header construction | `send_stream` `:320-359`: Bearer only if non-empty (`:335-337`), `x-opencode-session` (`:338-340`), UA (`:341-343`) | Make headers provider/auth-driven: Bearer for API keys and path-A OAuth; only send `x-opencode-session` for OpenCode providers; gate path-B extras (`ChatGPT-Account-ID`, `originator`, `version`, `X-OpenAI-Fedramp`, `OAI-Product-Sku` — task-1 §3.2) behind the experimental path; never send OpenAI headers to the gateway. | P | no way to attach multiple dynamic headers or distinguish providers in `send_stream` today |
| 22 | Endpoint/path construction | constants `:289-297` + `endpoint()`; adapters call `endpoint(base_url, CONST)` (`openai_chat.rs:27`, `openai_responses.rs:28`, `anthropic.rs:27`, `google.rs:29`) | Read the path from `ProviderInfo.endpoints` (already in JSON, currently unused). Path A: provider `baseUrl: https://api.openai.com`, `endpoints: { "openai-responses": "/v1/responses" }` (task-1 §1.3). Path B (experimental only): `https://chatgpt.com/backend-api/codex` + `/responses` (§3.1). | P | URL layout is compiled in; catalog cannot express it |
| 23 | Request body for OAuth Responses | `openai_responses.rs:50-105` (model/input/stream/max_output_tokens/instructions/tools/reasoning) | Path A requires (task-1 §1.5): `store:false`, `stream:true`, history in `input`, `instructions` **or** developer messages (explicit `{type:"message",role:"system"}` items rejected), and **omit** `max_output_tokens`, `temperature`, `top_p`, `metadata`, `previous_response_id`, etc. Current builder always sends `max_output_tokens` (`:70`) and conditionally `temperature` (`:93-97`) → parameterize the body by auth mode/provider profile. Path B adds `include:["reasoning.encrypted_content"]`, `prompt_cache_key`, `tool_choice`, `parallel_tool_calls` (task-1 §3.3). | P | body builder has no provider/auth-mode context; one body for all providers is insufficient |
| 24 | `provider_state` replay | `openai_responses.rs:121-167, 403-421, 466-481`; harness v2 `:881-920, 1083-1160` | Path A: validate which output items can be replayed (`store:false` stateless flow; task-1 §1.5/§3.4). Path B replays items with `encrypted_content` (task-1 §3.3/§3.4). Opaque payload mechanism itself can be reused; `(provider_id, model_id)` pairing already isolates it. | P+H | replay state is opaque `Value`, no token coupling — OK |
| 25 | Error mapping | `ProviderError::from_http` `:263-278`; fallback only on `UnsupportedProtocol` `:483-541` | Add auth-expired / plan-required / rate-window variants (401 from a stale access token should trigger one refresh+retry before surfacing `reauth required`; task-1 §1.4/§5); keep `402` copy provider-neutral (it is OpenCode-specific today). | P | 401 has no reauth semantics; 429 has no window info |
| 26 | Protocol selection | `resolve_protocols` `harness/mod.rs:1416-1440`; `WireProtocol::parse` `:46-54` | OpenAI provider models declare only `openai-responses` (path A supports function/custom tools but not the gateway's chat protocol, task-1 §1.5). No new protocol enum needed. | C+H | — |
| 27 | Reasoning mapping | `reasoning.rs:151-175` (Responses: effort + summary detailed; off only if `none` listed) | Path A request builder must include `reasoning: {effort, summary}` per model; catalog `reasoningOptions` for OpenAI models must match what `api.openai.com/v1/responses` accepts (path B always sends `reasoning`; task-1 §3.3). | P | — |
| 28 | Smoke tests | `providers/mod.rs:571-1308` reads OpenCode CLI auth (`:597-613`), `ProviderConfig` with `api_key` (`:615-629`) | Add `#[ignore]` integration tests for the OAuth path with a separate credential helper (env-provided access token) and a header/body assertion path; keep OpenCode smoke tests working. | P | helper signature only returns a String key |

### I.5 Harness

| # | Change point | Current seam | Required change | Owner | Token-fit problem |
| --- | --- | --- | --- | --- | --- |
| 29 | Key acquisition per turn | `harness/mod.rs:153-163` requires `config::api_key`; `HarnessDeps.api_key_override` (`:84`) test seam | Replace with an async credential resolver (`deps.credentials` or a new `config` API) that can refresh an expiring OAuth token before building `ProviderConfig`; keep an injectable override for tests (extend `HarnessDeps`). | H+S | current seam returns `String`; refresh is async and may mutate stored tokens |
| 30 | Request config per step | `CompletionRequest` built at `:294-312` and forced-final `:564-582` with `api_key: api_key.clone()` | Build auth headers/context once per turn (capture access token+account) and pass into both requests; if token rotates between steps, either re-fetch before each step or accept turn-scoped token. | H+P | `api_key: String` clone semantics; no account id |
| 31 | Provider/model validation | `:133-152` catalog membership only; conversation model fix-up `:166-169` | Add auth-mode awareness (e.g. provider requires auth; if not authenticated → typed error before persisting the user message, or allow and surface CTA). Decide UX in plan. | H | error text only; no structured reason |
| 32 | Title generation | `:754-778` local heuristic only | No change for OpenAI; note docs/ARCHITECTURE claim is stale (see E.3). | H/docs | — |
| 33 | Attachment/capability gating | `supports_images` `:1488-1498`, images `:1225-1297` | Depends on OpenAI model `attachment`/`modalities` catalog entries; no code change if catalog correct. | C+H | — |
| 34 | Usage logging | `:736-744` `record_usage(provider.id, model.id)`; `db.rs:924-954` | Works as-is (provider_id is free TEXT). If plan/account-level usage is desired, schema add is optional (new column/table); no migration required for provider id. | H/S | — |

### I.6 Persistence & export

| # | Change point | Current seam | Required change | Owner |
| --- | --- | --- | --- | --- |
| 35 | Conversation affinity | `conversations.provider_id/model_id` NOT NULL (`db.rs:54-55`), updated on first turn (`harness:166-169`), read by store (`chatStore.ts:100-144`) | Works as-is with provider id `"openai"` (or chosen id); no schema change. Ensure provider id is stable and not renamed later (historical rows + `provider_state` replay validity depend on it). | C |
| 36 | `provider_state` replay key | `harness:1088-1111` equality on provider/model strings; DB column opaque (`db.rs:73`) | No change if new provider id distinct; if provider id ever renamed/migrated, old replay is silently discarded (safe fallback) — acceptable but document. | H |
| 37 | Usage log | `usage_log.provider_id/model_id` (`db.rs:105-118`), `record_usage` `:924-954` | Works as-is; consider a human-readable provider name only in export (below). | S |
| 38 | Markdown/JSON export | `commands/conversations.rs:206-314`; provider/model raw ids `:218-219` | Optional: print provider `name` (needs catalog lookup) or keep ids; JSON export includes conversation DTO unchanged. | S |

### I.7 UI & renderer

| # | Change point | Current seam | Required change | Owner | Token-fit problem |
| --- | --- | --- | --- | --- | --- |
| 39 | Provider settings card | `ProvidersTab.tsx:109-220` (single API-key form) | Split by `provider.auth.mode`: API-key card (Go/Zen, unchanged) vs OAuth card: "Entrar com ChatGPT" button, login-pending state, account/email/plan display, expiry/reauth banner, "Sair", Console link maybe replaced by account page. New component(s) under `src/components/settings/`. | U | form state/actions are `(providerId, string)`; OAuth needs login state machine |
| 40 | Key status labels | `KEY_SOURCE_LABEL` (`ProvidersTab.tsx:15-20`); `keyStatusLabel` (`modelMenu.ts:684-695`); `ProviderKeyStatus['source']` (`types.ts:420`) | Add OAuth labels ("Conectado como…", "Sessão expirada", "Sem conta") and keep exhaustive switches compiling; "Chave ausente" copy becomes auth-aware. | C+U | labels assume key sources |
| 41 | Provider/model pickers | `ModelPickerDialog.tsx:459-478` (tabs + key dot + tooltip), `ModelPill.tsx:627-643` (segmented providers + dot), `ModelDetailPanel.tsx:164-177` (no-key warning) | Third provider tab appears automatically from catalog; dot/tooltip semantics must reflect "authenticated" not "has API key"; detail warning/CTA for unauthenticated OAuth → open login (maybe deep-link into ProvidersTab, cf. `docs/DESIGN.md:101`). | U | `providerHasKey` returns boolean; no auth-state/account |
| 42 | Default-model settings | `ModelTab.tsx:131` hardcoded provider description; provider/model selects | Update copy; ensure default can be an OpenAI model even if not logged in (then first turn should prompt login) or fall back when unavailable. | U | — |
| 43 | Composer/Chat gating | `Composer.tsx:37-38`, `ChatView.tsx:69-117`, `chatStore.send:697-790` — no auth gate | Decide UX: block send with CTA when active provider unauthenticated, or send and map backend `auth_required` error to a toast/banner + login action (needs H.21 task-1 error contract). | U |
| 44 | Store/auth actions | `appStore.ts` keys (`:52`), `setProviderKey` (`:160-167`), init (`:101-138`), `api.ts` wrappers (`:29-32`) | Add auth status state + `signIn(providerId)`, `signOut(providerId)`, `refreshAuth()`, login-progress handling; init must tolerate selection pointing to an unauthenticated provider (fallback or CTA). Keep persisted selection valid if provider removed. | C+U | store only knows key status |
| 45 | Welcome/About copy | `WelcomeScreen.tsx:81`; `AboutTab.tsx:9-10,25,57-67,92`; `ProvidersTab.tsx:100-107,222-226`; `usePaletteActions.ts:54` | Copy updates: mention OpenAI/ChatGPT, privacy note for tokens ("ficam só no backend"), console links (OpenAI account vs OpenCode console), palette description. | U |
| 46 | Hotkeys / settings tabs | `hotkeys.ts:19-27,75-104`; `settingsTabs.ts:9-40` | **No change needed** — auth is inside the existing Providers tab; hotkeys are auth-agnostic. Mention only so the plan doesn't scope-creep. | U |

### I.8 Tests & docs (new/updated)

| # | Area | Required change |
| --- | --- | --- |
| 47 | Rust unit tests | New tests for credential serde/backward-compat (`config.rs`), resolution precedence with OAuth vs env vs CLI, refresh single-flight/expiry, auth-mode branches in `set_provider_key`/`validate_provider`/`list_remote_models`, harness turn with OAuth credential override (extend `HarnessDeps` seam), header construction unit test for `send_stream` if headers become data-driven. |
| 48 | Rust `#[ignore]` integration | OAuth-provider smoke test with env-provided access token/account id (never commit tokens); keep the OpenCode `smoke_*` set green (they read CLI auth). |
| 49 | Vitest | New tests for OAuth provider card (login/sign-out/reauth states), auth-aware labels in `keyStatusLabel`/`KEY_SOURCE_LABEL`, store actions, no-send gating if adopted; adjust all H.8 fixtures/counts for a third provider; add the missing `ProvidersTab` test file. |
| 50 | Docs | H.9 list (AGENTS ownership, ARCHITECTURE, MODELS, DESIGN, MODEL_SELECTOR_REDESIGN, FILES, README, Cargo/tauri descriptions) + this document as the map reference. |

### I.9 Where a token **cannot** fit the current `String` API-key model (consolidated)

| Seam | Reference | Why a token set cannot live here |
| --- | --- | --- |
| `SecretsFile.providers: BTreeMap<String, String>` | `config.rs:135-141` | one string per provider: no access+refresh pair, no expiry, no account id, no plan, no scope |
| `resolve_key -> (Option<String>, &'static str)` / `api_key -> Option<String>` | `config.rs:254-275` | return type only carries a bearer string; no refresh decision, no account/plan metadata |
| `set_api_key(provider_id, Option<&str>)` | `config.rs:277-290` | cannot write a token object; tokens would be stored as one opaque string and lost on next write |
| `ProviderKeyStatus` | `domain.rs:645-654`; `types.ts:416-421` | only `has_key/masked/source`; OAuth needs `authenticated`, `account`, `plan`, `expires_at`, `needs_reauth`; `masked` must not expose token fragments |
| `SettingsView` | `domain.rs:656-661`; `types.ts:423-426` | no auth array/account state for the UI |
| `set_provider_key` command + validation | `commands/settings.rs:52-79` | `(provider_id, key: Option<String>)` and min-20/no-space rules are API-key semantics; error copy is OpenCode-specific |
| `validate_provider` | `commands/settings.rs:185-297` | resolves only a String key and calls `/v1/models` Bearer; no account header/expiry-aware messaging |
| `refresh_catalog` / `list_remote_models` | `commands/models.rs:39, 44, 73` | keyed on `config::api_key` being present; OAuth cookie/token providers are skipped or error out |
| `ProviderConfig.api_key: String` | `providers/mod.rs:163-173`; built at `harness/mod.rs:295-303, 564-573` | only credential field in the wire layer; no account id/extra headers/token rotation |
| `send_stream` header block | `providers/mod.rs:320-359` | hardcodes Bearer + `x-opencode-session`; no provider/header strategy |
| `api.setProviderKey` / `appStore.setProviderKey` / `ProvidersTab` form | `api.ts:29-30`; `appStore.ts:160-167`; `ProvidersTab.tsx:143-180` | renderer API/action/UI all keyed on a single string; OAuth needs login/sign-out actions |
| `keyStatusLabel` / `KEY_SOURCE_LABEL` / `ProviderKeyStatus['source']` | `modelMenu.ts:684-695`; `ProvidersTab.tsx:15-20`; `types.ts:420` | source enum has no OAuth state; labels assume "chave" |
| Env fallback | `config.rs:242-251` | one `OPENCODE_API_KEY` shared; ignores provider id; no `OPENAI_*` support |

---

## J. Open decisions / risks the Lead must resolve before/while planning

1. **New provider vs. auth mode on an existing provider.** Zen already serves `gpt-6-luna`; the new OpenAI
   provider is a *different backend + auth*, not a new key for Zen. Task-1 recommends the documented path **A**
   ("Sign in with ChatGPT" OSS flow → `https://api.openai.com/v1/responses`), with official API keys (path C) as a
   separate auth mode for the same provider (task-1 §0, §8). Path **B** (Codex CLI client_id + `backend-api`) must
   not ship publicly (task-1 §8.3). Suggested `provider.id = "openai"` (stable, persisted in conversations).
2. **Token storage location.** Same `secrets.json` (simple, plaintext, ACL/0600) vs OS keychain vs a separate
   `auth.json` with stricter handling. Task-1 §8.6 recommends **Windows Credential Manager**, keyed per
   client_id/account, with serialized refresh + atomic rotation + revoke on sign-out; it also requires persisting the
   issued `client_id` and `ext_agent_host_id` (task-1 §1.2). Record the decision in `docs/ARCHITECTURE.md §13`
   (current security statement at `:403-415` says only "API keys").
3. **Login transport.** Task-1 pins the documented callback for path A: loopback
   `http://127.0.0.1:<port>/auth/callback` (only the port varies, never `localhost`; task-1 §1.3) opened via
   `tauri-plugin-opener` (already a dependency). Remaining design decision is the **IPC shape**: one command that
   resolves when the callback arrives vs. `start_provider_login` + event/`complete_provider_login` (the app has no
   long-running command precedent; `run_turn` uses a `Channel`). No deep-link plugin needed.
4. **Where the token is refreshed.** Lazily inside `run_turn` (harness) vs eagerly in a background task vs on demand
   from the UI. Task-1 requires serialized refresh (rotating 30-day refresh tokens, access token 1 h) and atomic
   persistence of the rotated token (task-1 §1.4).
5. **Model list source for the OAuth provider.** Task-1: with a ChatGPT plan token `GET /v1/models` returns
   `{models:[{slug,display_name,visibility}]}` (not `data[]`), and the list should refresh per account
   (task-1 §4.1, §8.5). Decide: bundled catalog as source of truth + optional live merge (recommended, consistent
   with today's catalog-first design), with the dual parser for the live path.
6. **No-auth UX.** Today sending without a key surfaces a backend error; for OAuth the plan should define a
   component-level CTA (disable send vs. toast with "Entrar" action). This needs a structured turn error `code`
   (I.3 #19).
7. **API-key OpenAI support.** Task-1 keeps path C (official `api.openai.com` key) as the fallback mode; design the
   provider auth descriptor so `apiKey` and OAuth coexist for the same provider, rather than hardcoding "OAuth
   provider" identity.
8. **Compliance/ToS** (task-1 §6): path A is the documented/supported flow; path B is not sanctioned. Keep the app's
   security invariant: tokens never reach the renderer/logs (`ARCHITECTURE.md:405`).
9. **Generator durability.** Decide how `data/catalog.json` survives `node scripts/build-catalog.mjs`
   (extend script vs overlay file). Otherwise the new provider disappears on the next catalog regeneration.

---

## Appendix — quick lookup index

Backend: `catalog.rs` (11, 23-43, 45-81, 124-147) · `config.rs` (22-41 paths, 69-112 normalize,
114-129 settings IO, 135-141 SecretsFile, 143-154 load/save, 159-186 write_private, 192-219 CLI,
242-251 env, 254-270 resolve, 273-290 api_key/set_api_key, 292-323 mask/status) · `domain.rs`
(12-27 Conversation, 130-148 UsageInfo, 162-197 ChatMessage, 299-315 TurnPayload, 582-643 Settings,
645-661 ProviderKeyStatus/SettingsView, 674-694 ProviderValidation/CatalogView) · `db.rs` (25-35 columns,
47-123 schema, 552-600 open/init, 607-633 create, 733-746 update model, 924-954 record usage) ·
`commands/settings.rs` (20-31 view, 37-79 settings/keys, 185-297 validate) · `commands/models.rs` (9-98) ·
`commands/conversations.rs` (19-72 defaults, 206-314 export) · `commands/turn.rs` (11-54) · `lib.rs` (13-24 modules,
28-79 builder/handlers) · `state.rs` (14-66) · `http.rs` (5-27) · `providers/mod.rs` (27-55 protocols,
61-157 history, 163-209 request, 215-283 events/errors, 289-359 plumbing/headers, 477-556 dispatch, 571-1308 smoke) ·
`providers/openai_responses.rs` (23-44, 50-167, 180-511) · `providers/reasoning.rs` (27-241, tests 243-458) ·
`providers/sse.rs` (19-183, tests 185-262) · `harness/mod.rs` (71-105 deps, 112-169 setup/validation,
207-267 context, 286-550 loop, 556-663 forced final, 724-806 finalize/title, 815-866 persistence,
872-1160 provider_state v2/history, 1416-1498 helpers, 1604+ tests) · `events.rs` (12-67).

Frontend: `types.ts` (12, 45-84 catalog, 162-197 message, 299-315 payload, 385-426 settings/keys/view,
437-449 validation/catalog view) · `catalog.ts` (5-16 import, 18-64 accessors/defaults, 104-123 reasoning UI,
171-220 formatting/grouping) · `api.ts` (24-101) · `store/appStore.ts` (22-45 defaults, 47-81 state,
101-138 init, 140-175 settings/key/selection, 207-210 persist) · `store/chatStore.ts` (85-144 lock/affinity,
146-158 options, 514-521 create, 593-605 new chat, 697-790 send) · `settings/ProvidersTab.tsx` (15-20 labels,
22-96 actions, 100-226 render) · `settings/ModelTab.tsx` (36-130 state/commit, 131-191 render) ·
`models/ModelPickerDialog.tsx` (64-110 preview, 306-327 commit, 447-506 tabs, 571-597 footer) ·
`models/ModelPill.tsx` (491-545 provider/model commit, 627-645 provider options) · `models/ModelRow.tsx` (42-172) ·
`models/ModelDetailPanel.tsx` (90, 164-177) · `models/FamilyAvatar.tsx` (41-58, 76-124) ·
`models/CapabilityBadges.tsx` (12-73) · `chat/WelcomeScreen.tsx` (79-82) · `chat/ChatView.tsx` (69-117) ·
`composer/Composer.tsx` (37-38, 81-88, 191) · `lib/modelMenu.ts` (36-52, 58-87, 252-340, 471-695) ·
`lib/modelIcons.ts` (39-141, 155-165) · `lib/modelIconAssets.ts` (14-49) · `lib/settingsTabs.ts` (9-40) ·
`lib/hotkeys.ts` (19-104) · `App.tsx` (25-33, 206-207).
