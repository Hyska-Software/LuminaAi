# Goal: Biblioteca de artefatos do agente (escopo do USUÁRIO)

Use Krypton Execution to execute `docs/goals/artifact-library-tool/PLAN.md`.

Core rules:
- Treat `PLAN.md` as the source plan (contrato das tools, caps, escopos e
  critérios de aceite estão lá; a seção **“Revisão de escopo (turn 2)”**
  prevalece sobre o contrato original).
- Preserve intent, ownership, contract, cutover, evidence, and kill criteria.
- A funcionalidade é aditiva: não substituir `create_file`/`run_code` nem o
  painel de artefatos.
- **A biblioteca é do usuário, não da conversa:** `list_artifacts` lista todas as
  conversas (mais recentes primeiro, com título de origem) e `read_artifact` lê
  qualquer artefato pelo id — sem validação de `conversation_id`. A exposição é
  limitada a artefatos + metadados de proveniência; mensagens/contexto de outras
  conversas continuam privados.
- Não adicionar comando Tauri, campo em `domain.rs`/`types.ts`/`api.ts`,
  migração de banco ou dependência nova (o único método novo é
  `db::list_all_artifacts`, interno).
- Capture acceptance evidence from the target perspective and record it in
  `EVIDENCE.md` (loop do harness provando que um artefato **de outra conversa**
  entra no histórico do modelo + suítes completas).
- Say "implemented but unproven" if that evidence cannot be captured.
