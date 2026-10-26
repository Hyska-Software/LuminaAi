# Goal: OpenAI como provedor com login ChatGPT (plano compartilhado Codex/Work)

Use Krypton Execution para executar `docs/goals/openai-chatgpt-plan/PLAN.md`.

Core rules:
- Trate o PLAN.md como a fonte do plano (intent, ownership, contrato, cutover,
  evidência e kill criteria).
- **Fase 0 é gate**: antes de qualquer código de feature, rodar o spike SIWC
  (T0.1) e registrar G1–G5 em `docs/research/siwc-probe-results.md`. Se G1
  falhar, parar e levar a decisão ao usuário (API key only ou pedir acesso);
  nunca implementar `chatgpt.com/backend-api` nem o client_id do Codex CLI.
- Não adicione um caminho dominante novo sem remover/redirecionar o deslocado:
  endpoints de provedor vêm do catálogo (sem caminhos fixos novos), toda
  credencial passa por `oauth::ensure_bearer`/`config::api_key`, e o formato v1
  de `secrets.json` é migrado para v2.
- Um token store, um refresh, um resolvedor de credencial. Tokens nunca cruzam
  o IPC, nunca vão para log/URL/localStorage.
- Capture evidência de aceitação na perspectiva do usuário (login real, modelo da
  conta, turno com tool call, estado de cota) e registre em `EVIDENCE.md`.
- Diga "implementado, mas não provado" quando a evidência de runtime não puder
  ser capturada; QA visual manual não conta como teste automatizado.

Ordem: T0.1 + T0.2 → (gate) → T1.1/T1.2 → T2.* (T2.6 por último, depois de
T3.4a) → T3.* → T4.* → T5.1.

A PRE review está em `REVIEW.md`; a disposição de cada achado (5 blockers + 18
should-fix) está em `REVIEW-RESPONSE.md` e já foi incorporada ao PLAN. Não
reintroduza `oauth/store.rs` (o único writer de disco é `config.rs`), nem
`login` bloqueante (use start/wait async e registre os 6 comandos em `lib.rs`),
nem sign-out que apague o mapping do `client_id`.

Comandos de verificação:
```
pnpm typecheck && pnpm test && pnpm build
cd src-tauri && cargo check && cargo test --lib
node scripts/build-catalog.mjs
```
