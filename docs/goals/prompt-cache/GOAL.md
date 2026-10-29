# Goal: Cache de prompt 98–99% em todos os provedores (com indicador em tempo real)

Use Krypton Execution para executar `docs/goals/prompt-cache/PLAN.md`.

Regras centrais:

- Trate `PLAN.md` como o plano-fonte. Preserve intenção, dono da verdade, contrato,
  cutover, evidências e critérios de kill.
- A unidade é o **request de wire** (`turn_id + step`). O número aceito é o `usage`
  reportado: `hit = cache_read / (cache_read + cache_write + uncached)`; o teto
  `P/(P+Δ)` é contexto, não substituto. Nunca invente número quando o provedor não
  reportar — mostre `—`/`não reportado`.
- O prefixo persistente é **append-only**: um request novo só acrescenta bytes ao fim
  do surface persistente. Caudas transitórias (wrap-up) não contam. Qualquer reescrita
  do passado (trim de cabeça, data no system prompt, imagem que vira texto, git status
  no prompt) é quebra de epoch e precisa de causa registrada.
- Não adicione um caminho dominante novo sem remover/redirecionar o caminho deslocado
  (trim deslizante, prompt volátil, `usage` só no fim) na mesma janela — ver §11.
- Capture evidência real do provedor (`usage` bruto + mediana de N=5) e da UI (chip ao
  vivo) e registre em `EVIDENCE.md`. Provedor sem credencial fica “implementado, não
  provado” e não bloqueia os demais. Se não for possível capturar, diga isso — o
  Evidence Gate proíbe maquiar.
- O indicador de cache **% em tempo real** é requisito de aceite: Code = anel de
  contexto + selo de cache; Chat = chip cache-first no composer; atualiza ao fim de
  cada request, com estado (aquecendo/estável/caiu/política do provedor/não
  reportado), teto e diagnóstico copiável.
- Ordem obrigatória: F0a mede baseline sem tocar no prompt → F0b contratos → F2
  estabilidade Chat → F3 estabilidade Code + compactação → F4 mecanismos explícitos
  (probe F4.0 **antes**) → F5 UI final → F6 matriz final e remoção do caminho antigo.
