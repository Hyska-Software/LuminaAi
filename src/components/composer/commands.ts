/**
 * Composer-console do modo Code (docs/goals/code-harness/WORKBENCH.md §6/§12).
 *
 * `@` menciona arquivos do workspace (`api.searchWorkspaceFiles`); `/` abre o
 * catálogo de comandos abaixo. Ações `invoke` só chamam contratos já
 * existentes — quando a fase do backend ainda não existe, o Composer degrada
 * com um toast honesto em vez de fingir que executou.
 */

export type SlashCommandGroup = 'Sessão' | 'Plano' | 'Git' | 'Contexto' | 'Projeto';

/** Ações diretas suportadas nesta fase (sem backend novo). */
export type SlashInvoke =
  | 'compact'
  | 'commit'
  | 'permissoes'
  | 'novo'
  | 'limpar'
  | 'plan-on'
  | 'plan-off';

export interface SlashCommand {
  id: string;
  /** Texto exibido no menu, incluindo a barra (ex.: `/compact`). */
  command: string;
  title: string;
  description: string;
  group: SlashCommandGroup;
  action: 'fill' | 'invoke';
  /** Texto inserido no composer quando `action === 'fill'`. */
  fill?: string;
  /** Ação executada quando `action === 'invoke'`. */
  invoke?: SlashInvoke;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'plan',
    command: '/plan',
    title: 'Planejar antes de editar',
    description: 'Ativa o modo Plano e insere um pedido de plano para o agente.',
    group: 'Plano',
    action: 'fill',
    fill: 'Planeje a solução para esta tarefa antes de alterar arquivos:\n',
    // `fill` + `invoke`: ativa o modo (o texto continua sendo a instrução).
    invoke: 'plan-on',
  },
  {
    id: 'plan-off',
    command: '/plan off',
    title: 'Sair do modo Plano',
    description: 'Desativa o modo Plano da sessão ativa.',
    group: 'Plano',
    action: 'invoke',
    invoke: 'plan-off',
  },
  {
    id: 'permissoes',
    command: '/permissoes',
    title: 'Modo de permissão',
    description: 'Mostra onde trocar entre Leitura, Revisar, Editar e Autônomo.',
    group: 'Sessão',
    action: 'invoke',
    invoke: 'permissoes',
  },
  {
    id: 'novo',
    command: '/novo',
    title: 'Nova sessão',
    description: 'Cria uma nova sessão de código no workspace atual.',
    group: 'Sessão',
    action: 'invoke',
    invoke: 'novo',
  },
  {
    id: 'limpar',
    command: '/limpar',
    title: 'Limpar composer',
    description: 'Limpa o texto e as menções a arquivos.',
    group: 'Sessão',
    action: 'invoke',
    invoke: 'limpar',
  },
  {
    id: 'compact',
    command: '/compact',
    title: 'Compactar contexto',
    description: 'Pede ao backend para resumir o histórico desta sessão.',
    group: 'Contexto',
    action: 'invoke',
    invoke: 'compact',
  },
  {
    id: 'commit',
    command: '/commit',
    title: 'Abrir Alterações',
    description: 'Abre o painel Alterações para revisar e commitar.',
    group: 'Git',
    action: 'invoke',
    invoke: 'commit',
  },
  {
    id: 'test',
    command: '/test',
    title: 'Rodar verificação',
    description: 'Insere um pedido para rodar testes/lint e corrigir falhas.',
    group: 'Projeto',
    action: 'fill',
    fill: 'Rode as verificações do projeto com `run_checks` (test primeiro) e corrija o que falhar. Mostre o exit code e o que mudou:\n',
  },
  {
    id: 'review',
    command: '/review',
    title: 'Revisar alterações',
    description: 'Insere um pedido de revisão do diff atual.',
    group: 'Projeto',
    action: 'fill',
    fill: 'Revise as alterações atuais (git diff/status): aponte bugs, riscos e testes faltantes. Se fizer sentido, delegue uma revisão com `task` (subagent_type: "review") e consolide o resultado:\n',
  },
  {
    id: 'init',
    command: '/init',
    title: 'Gerar AGENTS.md',
    description: 'Insere um pedido para documentar o projeto para agentes.',
    group: 'Projeto',
    action: 'fill',
    fill: 'Analise este projeto e gere/atualize o AGENTS.md com instruções para agentes: comandos de build/test/lint, convenções, armadilhas e mapa de diretórios. Antes de gravar, me mostre o conteúdo proposto:\n',
  },
];

/** Filtro tolerante (sem caixa) por comando, título ou descrição. */
export function filterSlashCommands(query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...SLASH_COMMANDS];
  return SLASH_COMMANDS.filter((entry) => {
    const haystack = `${entry.command} ${entry.title} ${entry.description}`.toLowerCase();
    return haystack.includes(needle);
  });
}
