# Biblioteca de artefatos do agente — Evidence

> **Escopo revisado (turn 2):** a biblioteca é do **usuário (todas as
> conversas)**, não da conversa atual. A entrega do turno 1 (escopo por
> conversa) foi substituída; os números e testes abaixo são da árvore final.

## Acceptance Evidence

**Testes de aceite (loop real do harness, provedor falso):**
`cargo test --lib read_artifact_` → **3 passed** (os três casos abaixo).

1. `harness::agent_loop_tests::read_artifact_feeds_the_model_with_the_previous_turn_file`
   — arquivo textual real de **29.925 caracteres** (`grande.txt`, marcador
   `MARCADOR-FIM-DA-PAGINA-Q3`), lido com `maxChars = 20.000`: no 2º request ao
   modelo o histórico Tool contém o **marcador do fim da página**, o rodapé
   “continue com offset=20000”, tem **< 24.000 caracteres**
   (`MAX_MODEL_TOOL_RESULT_CHARS`) e o `ToolCallRecord` tem `status = done` e
   `summary` com “caracteres”.
2. `harness::agent_loop_tests::read_artifact_extracts_a_real_docx_into_the_model_history`
   — DOCX real (`documents/testdata/relatorio-trimestral.docx`) gravado como
   artefato; o texto **extraído** por `documents::extract` chega ao histórico do
   2º request (“Relatório Trimestral — Aurora Analytics”, “Receita total: R$
   4,82 milhões (+18% QoQ)”, linha de tabela “Plataforma | 2.910.000 | +22%”),
   com `Tipo: docx`, summary e < 24k.
3. `harness::agent_loop_tests::read_artifact_reads_from_another_conversation_during_a_turn`
   — **prova do escopo de usuário**: o artefato é criado na conversa **B**
   (“Projeto Aurora”) e o turno roda na conversa **A**; o provedor falso pede
   `read_artifact` pelo id do artefato de B e o histórico do 2º request contém o
   texto do arquivo **de outra conversa**, o cabeçalho
   `Conversa: Projeto Aurora (outra conversa)`, `status = done` e < 24k.
   Nenhum guard de `conversation_id` intercepta a leitura.

**Busca e leitura reais (biblioteca global):**
`cargo test --lib artifact_library` → **34 passed** (31 do módulo + 1 dispatch +
2 testes de prompt cujo nome contém o filtro). Cobre: biblioteca vazia sem erro;
list global com 2 conversas (títulos, `currentConversation`, **mais recentes
primeiro**); read por id e por nome único de **outra conversa** com cabeçalho de
proveniência; ambiguidade entre conversas listando `nome (id, conversa:
"Título")`; busca por conteúdo de outra conversa e por **título da conversa**
(rank 45); ranking determinístico (exato por nome sem extensão > prefixo >
termos > título > conteúdo; `name_rank_is_deterministic_by_extensionless_equality`);
snippets com linha; filtro `kind`; isolamento de JSON (50 nomes longos < 24k);
caps (1 MB/arquivo, 16 MB/chamada, 16 MB/read, 12k/20k chars); fixtures reais
DOCX/XLSX/PPTX/PDF extraídos; metadados de imagem/ZIP/binário/áudio/vídeo;
plural pt-BR; arquivo ausente; nenhuma validação de conversa no read.

## Verification

| Comando | Resultado |
| --- | --- |
| `cd src-tauri && cargo check --lib --tests` | **exit 0**; 13 warnings de dead-code em `oauth`/`config` (arquivos não tocados) |
| `cd src-tauri && cargo test --lib` | **476 passed; 0 failed; 10 ignored** — 3 execuções consecutivas verdes (baseline do turno 1: 468; +8 nesta revisão: 3 em `db`, 4 em `tools::artifact_library`, 1 de loop cross-conversation no harness) |
| `cd src-tauri && cargo test --lib artifact_library` | **34 passed** |
| `cd src-tauri && cargo test --lib read_artifact_` | **3 passed** (3 casos de aceite) |
| `cd src-tauri && cargo test --lib harness::prompt::tests::` | **35 passed** (mantém `run_code_section_is_hidden_when_the_setting_turns_it_off` verde) |
| `cd src-tauri && cargo test --lib db` | **17 passed** (14 antigos + 3 de `list_all_artifacts`) |
| `pnpm typecheck` | **OK** |
| `pnpm test` | **68 arquivos / 1363 testes passed** (frontend inalterado nesta revisão) |
| `pnpm build` | **OK** (só o aviso de tamanho de chunk já existente: `index-*.js` ~1,9 MB) |

**Nota de estabilidade:** durante a verificação do turno 1 apareceu 1 falha
intermitente, rastreada até `search_by_name_ranks_exact_then_prefix_then_terms`:
`name_rank` deixava “relatorio.md” e “relatorio-q3-final.md” empatados no tier de
prefixo (desempate por UUID). Corrigido (tier exato também por nome sem
extensão) com teste unitário novo; após o fix, 3 execuções consecutivas da suíte
completa ficaram verdes e o teste específico passou 5/5.

## Review Notes

**PRE review** (plan-reviewer, turno 1): veredito **aligned — sem blockers**;
7 findings minors incorporados (orçamento duro do JSON, evidência de “sem corte
em 24k”, `run_code` condicionado à flag, caminho via `get_artifact`, semântica de
`total`, evidência nomeada, teto por `metadata` antes do read).

**POST review do turno 1** (plan-reviewer): **aligned — sem blockers**, evidência
aceita; minors corrigidos (contagem 29.925, labels reais da timeline, redação do
cap, plural pt-BR, 2º caso de aceite com DOCX).

**POST review do delta de escopo (turno 2)** (plan-reviewer): código/contrato
**aligned — aceito, sem blockers**; achados corrigidos: EVIDENCE reescrito para o
escopo de usuário (este arquivo), matriz de testes e números do `FILES.md`,
`GOAL.md`, comentário do dispatch em `tools/mod.rs`, redação de privacidade no
prompt (artefatos **+ metadados de proveniência**), limite de paginação SQL
documentado. Confirmado: sem guard residual de conversa; list DESC com
`conversationId`/`conversationTitle`/`currentConversation`; busca por
nome/título/conteúdo; caps inalterados; teste de loop cross-conversation; sem
edições fora das áreas (só `db.rs` com o método novo + testes, `harness/mod.rs`
com um hunk `#[cfg(test)]`).

**Privacidade (decisão registrada):** a biblioteca expõe ao agente artefatos e
metadados de proveniência (título/id da conversa de origem) de todas as
conversas do usuário; mensagens/contexto de outras conversas continuam privados
e o prompt proíbe revelá-los.

**Limites conhecidos** (ver `docs/FILES.md` v1.7): excluir uma conversa remove os
artefatos dela (comportamento existente do app — retenção permanente seria outra
decisão de produto); `list_all_artifacts` + `list_conversations` carregam a
biblioteca/títulos por chamada (o `limit` e o orçamento de JSON são aplicados em
memória, sem `LIMIT` no SQL — tabela pequena no uso real).

**QA manual (nota, sem automação de UI — regra do AGENTS.md):** abrir o app em
`pnpm app:dev`, gerar um artefato na conversa X, abrir a conversa Y e pedir para
resumir “o arquivo da outra conversa”; conferir a resposta citando a proveniência
e a timeline com “Encontrou N artefatos”/“Leu o artefato …”. Inspeção visual
pendente (o app não foi aberto nesta sessão).
