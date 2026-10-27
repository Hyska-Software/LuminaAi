# Goal: página Biblioteca (arquivos do usuário)

Implementar a página **Biblioteca** do Lumina conforme
`docs/goals/library-page/PLAN.md` (contrato completo, escopos e evidências).

Pedido original (resumo):

1. Nova página principal (como a de Skills) que mostra **todos os artefatos do
   usuário** de forma organizada, com **filtros** e **busca**.
2. Item **Biblioteca** na sidebar, **acima** do botão **Skills**.
3. Seguir o **conceito de layout da imagem** de referência
   (`REFERENCE.png`): header com título + busca + ações, faixa de filtros em
   pills e grade de cards de arquivo; nada de tabela burocrática.
4. O usuário pode **enviar arquivos** para a biblioteca; esses arquivos ficam
   acessíveis ao agente pela tool de busca de artefatos (`list_artifacts`) e de
   leitura (`read_artifact`).
5. **Visualizar e gerenciar** os artefatos direto na interface da Biblioteca
   (prévia, favoritar, renomear, salvar como, abrir, excluir).

Regras:

- A funcionalidade é **aditiva**: chat, painel de artefatos, `create_file` e
  `run_code` continuam funcionando igual.
- A biblioteca continua sendo **do usuário (todas as conversas)**; mensagens de
  outras conversas nunca são expostas.
- Sem automação de UI/navegador como evidência; a verificação é por
  `cargo test --lib`, `pnpm test`, `pnpm typecheck` e `pnpm build`.
- Respeitar `AGENTS.md`: propriedade de arquivos, tokens do design system,
  texto em pt-BR, acessibilidade e TDD.
