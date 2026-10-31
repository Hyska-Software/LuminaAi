/**
 * View model for the chat "thinking timeline" (agent steps).
 *
 * The harness persists a compact trace (`ChatMessage.trace`): one entry per
 * agent-loop step with the reasoning it produced and how many tool calls it
 * requested. Tool calls themselves live in `ChatMessage.toolCalls`, in
 * chronological order, so the timeline can be rebuilt exactly after a reload.
 *
 * Messages created before the trace existed fall back to a single block with
 * the whole persisted reasoning, followed by adjacent tool calls grouped by
 * tool.
 *
 * Reasoning is kept as the **raw Markdown** emitted by the model: one entry per
 * step, trimmed only at the edges. It is rendered by `Markdown` with
 * `variant="thinking"` (docs/MARKDOWN.md §4), so splitting paragraphs or
 * stripping list markers here would corrupt lists, fences, tables and math.
 */
import type { ChatMessage, ToolCallRecord } from './types';
import { hostnameOf, safeJsonParse, truncate } from './utils';

export interface PageLink {
  title: string;
  url: string;
}

export type ToolGroupStatus = 'running' | 'done' | 'error';

/** One visual row of tool activity inside the timeline. */
export interface ToolGroup {
  name: string;
  tools: ToolCallRecord[];
  status: ToolGroupStatus;
  /** Human readable row label, e.g. "Encontrou 8 páginas web". */
  label: string;
  /** Result count behind the label (search results, pages, files, …). */
  total: number;
  /** Domains found by `web_search` (rendered as source avatars). */
  domains: string[];
  /** Pages opened by `fetch_url` (rendered as link chips). */
  pages: PageLink[];
  /** Artifact names created by `create_file`. */
  files: string[];
  /** Readable error messages of the calls that failed. */
  errors: string[];
}

export type AgentTraceEntry =
  | { kind: 'reasoning'; text: string }
  | { kind: 'tools'; group: ToolGroup };

const MAX_ERROR_CHARS = 220;

/**
 * Builds the ordered timeline of reasoning blocks and tool groups for one
 * assistant message.
 *
 * Each trace step produces **one** `reasoning` entry with its raw Markdown
 * (trimmed only at the edges), followed by the tool groups of the calls that
 * step requested. The reasoning text must stay byte-identical between renders:
 * `Markdown` is memoized on `content`.
 */
export function buildAgentTrace(
  message: Pick<ChatMessage, 'reasoning' | 'toolCalls' | 'trace'>,
): AgentTraceEntry[] {
  const tools = message.toolCalls ?? [];
  const steps = message.trace ?? [];
  const entries: AgentTraceEntry[] = [];
  let cursor = 0;

  if (steps.length > 0) {
    for (const step of steps) {
      const reasoning = step.reasoning?.trim() ?? '';
      if (reasoning) entries.push({ kind: 'reasoning', text: reasoning });
      const count = Math.max(0, Math.floor(step.toolCalls ?? 0));
      const stepTools = tools.slice(cursor, cursor + count);
      cursor += count;
      pushToolGroups(entries, stepTools);
    }
  } else {
    // Legacy messages (persisted before the trace contract) have no step
    // boundaries: the whole reasoning is a single Markdown block.
    const reasoning = message.reasoning?.trim() ?? '';
    if (reasoning) entries.push({ kind: 'reasoning', text: reasoning });
    pushToolGroups(entries, tools);
    cursor = tools.length;
  }

  // Defensive: calls the trace did not account for must never disappear.
  if (cursor < tools.length) pushToolGroups(entries, tools.slice(cursor));

  return entries;
}

/** Total number of tool calls rendered by the timeline. */
export function countTraceTools(entries: AgentTraceEntry[]): number {
  return entries.reduce(
    (total, entry) => (entry.kind === 'tools' ? total + entry.group.tools.length : total),
    0,
  );
}

/** True when the timeline has at least one reasoning block. */
export function hasTraceReasoning(entries: AgentTraceEntry[]): boolean {
  return entries.some((entry) => entry.kind === 'reasoning');
}

function pushToolGroups(entries: AgentTraceEntry[], tools: ToolCallRecord[]): void {
  for (const group of groupTools(tools)) entries.push({ kind: 'tools', group });
}

/** Groups adjacent calls of the same tool, keeping the original order. */
function groupTools(tools: ToolCallRecord[]): ToolGroup[] {
  const groups: ToolCallRecord[][] = [];
  for (const tool of tools) {
    const current = groups[groups.length - 1];
    if (current && current[0].name === tool.name) current.push(tool);
    else groups.push([tool]);
  }
  return groups.map(buildToolGroup);
}

function buildToolGroup(tools: ToolCallRecord[]): ToolGroup {
  const name = tools[0]?.name ?? '';
  const status = groupStatus(tools);
  const errors = tools
    .filter((tool) => tool.status === 'error')
    .map(toolError)
    .filter((message) => message.length > 0);

  switch (name) {
    case 'web_search':
      return searchGroup(tools, status, errors);
    case 'fetch_url':
      return fetchGroup(tools, status, errors);
    case 'create_file':
      return fileGroup(tools, status, errors);
    case 'validate_ui':
      return validationGroup(tools, status, errors);
    case 'run_code':
      return codeGroup(tools, status, errors);
    case 'list_skills':
      return skillsListGroup(tools, status, errors);
    case 'read_skill':
      return readSkillGroup(tools, status, errors);
    case 'list_artifacts':
      return artifactsListGroup(tools, status, errors);
    case 'read_artifact':
      return readArtifactGroup(tools, status, errors);
    /* ---- harness de código (docs/goals/code-harness/WORKBENCH.md §5.2) ---- */
    case 'read_file':
    case 'list_dir':
    case 'search_files':
    case 'search_text':
      return readCodeGroup(tools, status, errors);
    case 'write_file':
    case 'edit_file':
      return writeCodeGroup(tools, status, errors);
    case 'run_command':
      return commandCodeGroup(tools, status, errors);
    case 'run_checks':
      return checksCodeGroup(tools, status, errors);
    case 'todo_write':
      return todoCodeGroup(tools, status, errors);
    case 'submit_plan':
      return planCodeGroup(tools, status, errors);
    case 'goal':
      return goalCodeGroup(tools, status, errors);
    case 'ask_user':
      return askCodeGroup(tools, status, errors);
    case 'task':
      return subagentCodeGroup(tools, status, errors);
    case 'job_list':
    case 'job_output':
    case 'job_kill':
      return jobCodeGroup(tools, status, errors);
    case 'git_status':
    case 'git_diff':
    case 'git_log':
      return gitCodeGroup(tools, status, errors);
    case 'read_tool_output':
      return readOutputCodeGroup(tools, status, errors);
    default:
      return {
        name,
        tools,
        status,
        label: defaultLabel(name, tools.length, status),
        total: tools.length,
        domains: [],
        pages: [],
        files: [],
        errors,
      };
  }
}

function groupStatus(tools: ToolCallRecord[]): ToolGroupStatus {
  if (tools.some((tool) => tool.status === 'running')) return 'running';
  if (tools.some((tool) => tool.status === 'error')) return 'error';
  return 'done';
}

function searchGroup(tools: ToolCallRecord[], status: ToolGroupStatus, errors: string[]): ToolGroup {
  const pages = uniquePages(tools.flatMap(searchResults));
  const summaryTotal = tools.reduce((sum, tool) => sum + (summaryResultCount(tool.summary) ?? 0), 0);
  const total = pages.length || summaryTotal;
  const domains = uniqueDomains(pages);
  const base = { name: 'web_search', tools, status, total, domains, pages: [], files: [], errors };
  if (status === 'running') {
    return { ...base, label: 'Buscando na web…' };
  }
  if (total > 0) {
    return { ...base, label: `Encontrou ${total} ${plural(total, 'página', 'páginas')} web` };
  }
  return { ...base, label: errors.length ? 'A busca web falhou' : 'Nenhum resultado encontrado' };
}

function fetchGroup(tools: ToolCallRecord[], status: ToolGroupStatus, errors: string[]): ToolGroup {
  const pages = uniquePages(tools.map(pageOf).filter((page): page is PageLink => page !== null));
  const total = pages.length || tools.length;
  const base = { name: 'fetch_url', tools, status, total, domains: [], pages, files: [], errors };
  if (status === 'running') {
    return { ...base, label: `Lendo ${total} ${plural(total, 'página', 'páginas')}…` };
  }
  if (pages.length > 0) {
    const noun = plural(pages.length, 'página', 'páginas');
    return { ...base, label: `Leu ${pages.length} ${noun}` };
  }
  return {
    ...base,
    label: `Não foi possível ler ${tools.length > 1 ? 'as páginas' : 'a página'}`,
  };
}

function fileGroup(tools: ToolCallRecord[], status: ToolGroupStatus, errors: string[]): ToolGroup {
  const files = uniqueStrings(tools.map(createdFileName).filter((name): name is string => !!name));
  const total = files.length || tools.length;
  const base = { name: 'create_file', tools, status, total, domains: [], pages: [], files, errors };
  if (status === 'running') {
    return { ...base, label: `Criando ${plural(total, 'arquivo', 'arquivos')}…` };
  }
  if (files.length > 0) {
    return { ...base, label: `Criou ${files.length} ${plural(files.length, 'arquivo', 'arquivos')}` };
  }
  return { ...base, label: 'Falha ao criar arquivo' };
}

function validationGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const base = {
    name: 'validate_ui',
    tools,
    status,
    total: tools.length,
    domains: [],
    pages: [],
    files: [],
    errors,
  };
  if (status === 'running') return { ...base, label: 'Validando a interface…' };
  if (status === 'error') return { ...base, label: 'A validação da interface falhou' };
  return {
    ...base,
    label:
      tools.length > 1 ? `Validou a interface ${tools.length} vezes` : 'Validou a interface',
  };
}

/**
 * `run_code` rows: the harness summary looks like "python · 2 arquivos · 1.2s".
 * The duration is dropped (the timeline header already shows the total time) and
 * the remaining detail is appended to the done label so the user knows what ran.
 */
function codeGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const base = {
    name: 'run_code',
    tools,
    status,
    total: tools.length,
    domains: [],
    pages: [],
    files: [],
    errors,
  };
  if (status === 'running') return { ...base, label: 'Executando código…' };
  if (status === 'error') return { ...base, label: 'A execução de código falhou' };
  const detail = codeSummaryDetail(tools[tools.length - 1]?.summary);
  return { ...base, label: detail ? `Executou código · ${detail}` : 'Executou código' };
}

function skillsListGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const base = {
    name: 'list_skills',
    tools,
    status,
    total: tools.length,
    domains: [],
    pages: [],
    files: [],
    errors,
  };
  if (status === 'running') return { ...base, label: 'Consultando skills…' };
  if (status === 'error') return { ...base, label: 'A consulta das skills falhou' };
  return { ...base, label: 'Consultou as skills disponíveis' };
}

function readSkillGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const names = uniqueStrings(
    tools.map(readSkillName).filter((name): name is string => name !== null),
  );
  const base = {
    name: 'read_skill',
    tools,
    status,
    total: tools.length,
    domains: [],
    pages: [],
    files: [],
    errors,
  };
  if (status === 'error') return { ...base, label: 'Não foi possível ler a skill' };
  if (status === 'running') {
    if (names.length === 1) return { ...base, label: `Lendo skill ${names[0]}…` };
    if (names.length > 1) return { ...base, label: `Lendo ${names.length} skills…` };
    return { ...base, label: 'Lendo skill…' };
  }
  if (names.length === 1) return { ...base, label: `Leu a skill ${names[0]}` };
  if (names.length > 1) return { ...base, label: `Leu ${names.length} skills` };
  return { ...base, label: 'Leu uma skill' };
}

/**
 * `list_artifacts` rows: the harness summary is "{returned} artefatos" or
 * "{returned} de {total} artefatos" ("nenhum artefato" when the library is
 * empty). Only the returned count belongs in the label.
 */
function artifactsListGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const counts = tools.map((tool) => summaryArtifactCount(tool.summary));
  const parsed = counts.filter((count): count is number => count !== null);
  const total = parsed.length > 0 ? parsed.reduce((sum, count) => sum + count, 0) : tools.length;
  const base = {
    name: 'list_artifacts',
    tools,
    status,
    total,
    domains: [],
    pages: [],
    files: [],
    errors,
  };
  if (status === 'running') return { ...base, label: 'Pesquisando nos artefatos…' };
  if (status === 'error') return { ...base, label: 'A pesquisa nos artefatos falhou' };
  if (parsed.length === 0) return { ...base, label: 'Consultou os artefatos' };
  if (total === 0) return { ...base, label: 'Nenhum artefato encontrado' };
  return { ...base, label: `Encontrou ${total} ${plural(total, 'artefato', 'artefatos')}` };
}

/**
 * `read_artifact` rows: the summary is "{nome} · {total} caracteres" (or
 * "{nome} · binário"), so the file name is its first segment. Calls by id carry
 * no name in the summary path, so `arguments.name` is the fallback. File chips
 * list only the artifacts that were actually read.
 */
function readArtifactGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const names = uniqueStrings(
    tools
      .filter((tool) => tool.status !== 'error')
      .map(readArtifactName)
      .filter((name): name is string => name !== null),
  );
  const base = {
    name: 'read_artifact',
    tools,
    status,
    total: names.length || tools.length,
    domains: [],
    pages: [],
    files: names,
    errors,
  };
  if (status === 'error') return { ...base, label: 'Não foi possível ler o artefato' };
  if (status === 'running') {
    if (names.length === 1) return { ...base, label: `Lendo o artefato ${names[0]}…` };
    if (names.length > 1) return { ...base, label: `Lendo ${names.length} artefatos…` };
    return { ...base, label: 'Lendo um artefato…' };
  }
  if (names.length === 1) return { ...base, label: `Leu o artefato ${names[0]}` };
  if (names.length > 1) return { ...base, label: `Leu ${names.length} artefatos` };
  return { ...base, label: 'Leu um artefato' };
}

/**
 * Returned artifact count of a `list_artifacts` summary, e.g. "3 artefatos",
 * "3 de 10 artefatos" (the total after "de" is ignored) or "nenhum artefato".
 */
function summaryArtifactCount(summary?: string | null): number | null {
  const raw = summary?.trim();
  if (!raw) return null;
  if (/^nenhum\b/i.test(raw)) return 0;
  const match = raw.match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function readArtifactName(tool: ToolCallRecord): string | null {
  const raw = tool.summary?.trim();
  if (raw) {
    const [first, ...rest] = raw.split(' · ');
    const name = first?.trim() ?? '';
    if (rest.length > 0 && name.length > 0) return truncate(name, 80);
  }
  const args = safeJsonParse<{ name?: unknown } | null>(tool.arguments, null);
  if (!args || typeof args !== 'object' || typeof args.name !== 'string') return null;
  const name = args.name.trim();
  return name ? truncate(name, 80) : null;
}

/** Short detail of a `run_code` summary: drops the duration segment. */
function codeSummaryDetail(summary?: string | null): string | null {
  const raw = summary?.trim();
  if (!raw) return null;
  const parts = raw
    .split('·')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !isDurationPart(part));
  if (parts.length === 0) return null;
  return truncate(parts.slice(0, 2).join(' · '), 80);
}

function isDurationPart(part: string): boolean {
  return /^\d+(?:[.,]\d+)?\s*(?:ms|s|seg|segs|segundos?|min|mins|minutos?)$/i.test(part);
}

function readSkillName(tool: ToolCallRecord): string | null {
  const args = safeJsonParse<{ name?: unknown } | null>(tool.arguments, null);
  if (!args || typeof args !== 'object' || typeof args.name !== 'string') return null;
  const name = args.name.trim();
  return name ? truncate(name, 64) : null;
}

function defaultLabel(name: string, count: number, status: ToolGroupStatus): string {
  const readable = name.replace(/_/g, ' ');
  if (status === 'running') return `Executando ${readable}…`;
  if (status === 'error') return `Falha em ${readable}`;
  return count > 1 ? `Executou ${readable} ${count} vezes` : `Executou ${readable}`;
}

/* ------------------------------------------------------------------ */
/* Tools do harness de código (rótulos pt-BR)                          */
/* ------------------------------------------------------------------ */

function codeArgs(tool: ToolCallRecord): Record<string, unknown> {
  const parsed = safeJsonParse<unknown>(tool.arguments ?? '', null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function codeArg(tool: ToolCallRecord, key: string): string | null {
  const value = codeArgs(tool)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function codePaths(tools: ToolCallRecord[]): string[] {
  return uniqueStrings(
    tools
      .map((tool) => codeArg(tool, 'path') ?? codeArg(tool, 'file'))
      .filter((path): path is string => Boolean(path)),
  );
}

function harnessGroup(
  name: string,
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
  label: string,
  files: string[] = [],
): ToolGroup {
  return { name, tools, status, label, total: tools.length, domains: [], pages: [], files, errors };
}

function firstPattern(tools: ToolCallRecord[]): string | null {
  const pattern = tools.map((tool) => codeArg(tool, 'pattern')).find(Boolean) ?? null;
  return pattern ? truncate(pattern, 48) : null;
}

function readCodeGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const name = tools[0]?.name ?? 'read_file';
  const paths = codePaths(tools);
  const first = paths[0] ?? null;
  const pattern = firstPattern(tools);
  const noun = plural(paths.length, 'arquivo', 'arquivos');
  let label: string;
  if (name === 'list_dir') {
    label =
      status === 'running'
        ? `Listando ${first ?? 'a pasta'}…`
        : status === 'error'
          ? `Não foi possível listar ${first ?? 'a pasta'}`
          : first
            ? `Listou ${first}`
            : 'Listou a pasta';
  } else if (name === 'search_files' || name === 'search_text') {
    label =
      status === 'running'
        ? pattern
          ? `Buscando “${pattern}”…`
          : 'Buscando no workspace…'
        : status === 'error'
          ? 'A busca no workspace falhou'
          : pattern
            ? `Buscou “${pattern}”`
            : 'Buscou no workspace';
  } else {
    label =
      status === 'running'
        ? `Lendo ${first ?? 'arquivos'}…`
        : status === 'error'
          ? first
            ? `Não foi possível ler ${first}`
            : 'Não foi possível ler os arquivos'
          : paths.length > 1
            ? `Leu ${paths.length} ${noun}`
            : first
              ? `Leu ${first}`
              : 'Leu o arquivo';
  }
  return harnessGroup(name, tools, status, errors, label);
}

function writeCodeGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const paths = codePaths(tools);
  const first = paths[0] ?? null;
  const noun = plural(paths.length, 'arquivo', 'arquivos');
  const label =
    status === 'running'
      ? `Gravando ${first ?? 'arquivos'}…`
      : status === 'error'
        ? first
          ? `Falha ao gravar ${first}`
          : 'Falha ao gravar os arquivos'
        : paths.length > 1
          ? `Alterou ${paths.length} ${noun}`
          : first
            ? `Alterou ${first}`
            : 'Alterou o arquivo';
  return harnessGroup(tools[0]?.name ?? 'write_file', tools, status, errors, label, paths);
}

function commandCodeGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const command = tools.map((tool) => codeArg(tool, 'command')).find(Boolean) ?? null;
  const short = command ? truncate(command, 64) : null;
  const label =
    status === 'running'
      ? `Executando ${short ?? 'comando'}…`
      : status === 'error'
        ? short
          ? `Comando falhou: ${short}`
          : 'O comando falhou'
        : short
          ? `Executou ${short}`
          : 'Executou o comando';
  return harnessGroup('run_command', tools, status, errors, label);
}

function checksCodeGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const label =
    status === 'running'
      ? 'Rodando as verificações…'
      : status === 'error'
        ? 'As verificações falharam'
        : 'Rodou as verificações';
  return harnessGroup('run_checks', tools, status, errors, label);
}

function todoCodeGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const label =
    status === 'running'
      ? 'Atualizando as tarefas…'
      : status === 'error'
        ? 'Falha ao atualizar as tarefas'
        : 'Atualizou as tarefas';
  return harnessGroup('todo_write', tools, status, errors, label);
}

function planPresentationState(tool: ToolCallRecord): string | null {
  const presentation = tool.presentation;
  if (!presentation || presentation.kind !== 'plan') return null;
  return presentation.state ?? null;
}

function planCodeGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const state = [...tools].reverse().map(planPresentationState).find(Boolean) ?? null;
  const feedback = [...tools]
    .reverse()
    .map((tool) => (tool.presentation?.kind === 'plan' ? tool.presentation.feedback : null))
    .find(Boolean);
  let label: string;
  if (status === 'running') label = 'Enviando o plano para revisão…';
  else if (status === 'error') label = feedback ? 'Plano não aprovado' : 'Falha ao enviar o plano';
  else if (state === 'approved') label = 'Plano aprovado';
  else if (state === 'reviewing') label = feedback ? 'Plano revisado' : 'Plano enviado para revisão';
  else label = 'Plano proposto';
  return harnessGroup('submit_plan', tools, status, errors, label);
}

/** Rótulo do grupo `goal` a partir da apresentação flat persistida. */
function goalCodeGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const goal = [...tools]
    .reverse()
    .map((tool) => (tool.presentation?.kind === 'goal' ? tool.presentation : null))
    .find(Boolean);
  let label: string;
  if (status === 'running') label = 'Atualizando o objetivo…';
  else if (status === 'error') label = 'Falha ao atualizar o objetivo';
  else if (goal?.status === 'completed') label = 'Objetivo concluído';
  else if (goal?.status === 'blocked') label = 'Objetivo bloqueado';
  else if (goal?.status === 'paused') label = 'Objetivo pausado';
  else label = 'Progrediu no objetivo';
  return harnessGroup('goal', tools, status, errors, label);
}


function askCodeGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const label =
    status === 'running'
      ? 'Aguardando resposta do usuário…'
      : status === 'error'
        ? 'A pergunta não foi concluída'
        : 'Perguntou ao usuário';
  return harnessGroup('ask_user', tools, status, errors, label);
}

/** pt-BR label for the subagent kind; `task` without a type uses `explore`. */
function subagentKindLabel(type: string | null | undefined): string {
  switch (type) {
    case 'review':
      return 'revisão';
    case 'general':
      return 'geral';
    case 'explore':
    default:
      return 'exploração';
  }
}

function subagentCodeGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const type =
    tools
      .map((tool) => codeArg(tool, 'subagent_type'))
      .find(Boolean) ?? null;
  const kind = subagentKindLabel(type);
  const label =
    status === 'running'
      ? 'Delegando a um subagente…'
      : status === 'error'
        ? 'O subagente falhou'
        : `Delegou ${kind} a um subagente`;
  return harnessGroup('task', tools, status, errors, label);
}

function jobCodeGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const name = tools[0]?.name ?? 'job_list';
  const label =
    status === 'running'
      ? 'Consultando jobs…'
      : status === 'error'
        ? 'Falha ao consultar o job'
        : name === 'job_kill'
          ? 'Parou um job'
          : name === 'job_output'
            ? 'Leu a saída de um job'
            : 'Listou os jobs';
  return harnessGroup(name, tools, status, errors, label);
}

function gitCodeGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const name = tools[0]?.name ?? 'git_status';
  const label =
    status === 'running'
      ? 'Consultando o git…'
      : status === 'error'
        ? 'O comando do git falhou'
        : name === 'git_diff'
          ? 'Viu o diff do git'
          : name === 'git_log'
            ? 'Consultou o histórico do git'
            : 'Consultou o status do git';
  return harnessGroup(name, tools, status, errors, label);
}

function readOutputCodeGroup(
  tools: ToolCallRecord[],
  status: ToolGroupStatus,
  errors: string[],
): ToolGroup {
  const label =
    status === 'running'
      ? 'Lendo a saída completa…'
      : status === 'error'
        ? 'Não foi possível ler a saída'
        : 'Leu a saída completa de uma ferramenta';
  return harnessGroup('read_tool_output', tools, status, errors, label);
}

/**
 * Rótulo por **chamada** de tool do harness de código. A timeline de execução
 * do "Thinking" renderiza uma linha por chamada (verbo + alvo + status) em vez
 * do card agregado; `label` mantém o texto completo para leitores de tela/testes.
 */
export interface CodeToolLabel {
  verb: string;
  detail: string | null;
  label: string;
}

export function describeCodeTool(tool: ToolCallRecord): CodeToolLabel {
  const make = (verb: string, detail: string | null = null): CodeToolLabel => ({
    verb,
    detail,
    label: detail ? `${verb} ${detail}` : verb,
  });
  const path = codeArg(tool, 'path') ?? codeArg(tool, 'file');
  const command = codeArg(tool, 'command');
  const pattern = codeArg(tool, 'pattern');
  const query = codeArg(tool, 'query');
  const presentation = tool.presentation;
  const fileChange = presentation?.kind === 'file_change' ? presentation : null;
  const failed = tool.status === 'error';

  switch (tool.name) {
    case 'read_file':
      return make('Leu', path);
    case 'list_dir':
      return make('Listou', path);
    case 'search_files':
    case 'search_text': {
      const term = pattern ?? query;
      return make('Buscou', term ? `“${truncate(term, 64)}”` : null);
    }
    case 'write_file':
    case 'edit_file': {
      const verb =
        fileChange?.change === 'created'
          ? 'Criou'
          : fileChange?.change === 'deleted'
            ? 'Removeu'
            : fileChange?.change === 'renamed'
              ? 'Renomeou'
              : 'Alterou';
      return make(verb, path ?? fileChange?.path ?? null);
    }
    case 'run_command':
      return make('Executou', command ? truncate(command, 96) : null);
    case 'run_checks':
      return make(failed ? 'As verificações falharam' : 'Rodou as verificações');
    case 'todo_write':
      return make(failed ? 'Falha ao atualizar as tarefas' : 'Atualizou as tarefas');
    case 'goal': {
      const goal = presentation?.kind === 'goal' ? presentation : null;
      if (failed) return make('Falha ao atualizar o objetivo');
      if (goal?.status === 'completed') return make('Objetivo concluído');
      if (goal?.status === 'blocked') return make('Objetivo bloqueado');
      if (goal?.status === 'paused') return make('Objetivo pausado');
      return make('Progrediu no objetivo');
    }
    case 'submit_plan': {
      const plan = presentation?.kind === 'plan' ? presentation : null;
      if (failed) return make(plan?.feedback ? 'Plano não aprovado' : 'Falha ao enviar o plano');
      if (plan?.state === 'approved') return make('Plano aprovado');
      if (plan?.state === 'reviewing') {
        return make(plan.feedback ? 'Plano revisado' : 'Plano enviado para revisão');
      }
      return make('Plano proposto');
    }
    case 'ask_user':
      return make(
        failed
          ? 'A pergunta não foi concluída'
          : tool.status === 'running'
            ? 'Aguardando resposta do usuário'
            : 'Perguntou ao usuário',
      );
    case 'task': {
      const kind = subagentKindLabel(codeArg(tool, 'subagent_type'));
      return make(
        failed ? 'O subagente falhou' : `Delegou ${kind} a um subagente`,
      );
    }
    case 'job_list':
      return make(failed ? 'Falha ao consultar os jobs' : 'Listou os jobs');
    case 'job_output':
      return make(failed ? 'Falha ao ler a saída do job' : 'Leu a saída de um job');
    case 'job_kill':
      return make(failed ? 'Falha ao parar o job' : 'Parou um job');
    case 'git_status':
      return make(failed ? 'O status do git falhou' : 'Consultou o status do git');
    case 'git_diff':
      return make(failed ? 'O diff do git falhou' : 'Viu o diff do git');
    case 'git_log':
      return make(failed ? 'O histórico do git falhou' : 'Consultou o histórico do git');
    case 'read_tool_output':
      return make(failed ? 'Não foi possível ler a saída completa' : 'Leu a saída completa de uma ferramenta');
    default:
      return make(
        failed
          ? `Falha em ${tool.name.replace(/_/g, ' ')}`
          : `Executou ${tool.name.replace(/_/g, ' ')}`,
      );
  }
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/* ------------------------------------------------------------------ */
/* Tool payload parsing                                                */
/* ------------------------------------------------------------------ */

interface SearchPayload {
  results?: Array<{ title?: unknown; url?: unknown }>;
}

function searchResults(tool: ToolCallRecord): PageLink[] {
  const parsed = safeJsonParse<SearchPayload | null>(tool.result ?? '', null);
  if (!parsed || !Array.isArray(parsed.results)) return [];
  return parsed.results
    .filter((result) => typeof result?.url === 'string' && /^https?:\/\//i.test(result.url))
    .map((result) => {
      const url = String(result.url);
      const title = typeof result.title === 'string' ? result.title.trim() : '';
      return { title: title || hostnameOf(url), url };
    });
}

function summaryResultCount(summary?: string | null): number | null {
  const match = summary?.match(/(\d+)\s+resultados?/i);
  return match ? Number(match[1]) : null;
}

interface FetchPayload {
  url?: unknown;
  title?: unknown;
}

function pageOf(tool: ToolCallRecord): PageLink | null {
  // A failed fetch never counts as a page that was read.
  if (tool.status === 'error') return null;
  const parsed = safeJsonParse<FetchPayload | null>(tool.result ?? '', null);
  if (parsed && typeof parsed.url === 'string' && /^https?:\/\//i.test(parsed.url)) {
    const url = parsed.url;
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    return { title: title || summaryTitle(tool.summary) || hostnameOf(url), url };
  }
  const args = safeJsonParse<{ url?: unknown }>(tool.arguments, {});
  if (typeof args.url === 'string' && /^https?:\/\//i.test(args.url)) {
    return {
      title: summaryTitle(tool.summary) || hostnameOf(args.url),
      url: args.url,
    };
  }
  return null;
}

function summaryTitle(summary?: string | null): string | null {
  const title = summary?.split(' · ')[0]?.trim();
  return title ? title : null;
}

function createdFileName(tool: ToolCallRecord): string | null {
  if (tool.status === 'error') return null;
  const fromSummary = summaryTitle(tool.summary);
  if (fromSummary) return fromSummary;
  const args = safeJsonParse<{ name?: unknown }>(tool.arguments, {});
  return typeof args.name === 'string' && args.name.trim() ? args.name.trim() : null;
}

function toolError(tool: ToolCallRecord): string {
  const raw = (tool.result ?? tool.summary ?? '').trim();
  if (!raw) return '';
  const message = raw.replace(/^error:\s*/i, '').split('\n')[0]?.trim() ?? '';
  return truncate(message, MAX_ERROR_CHARS);
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function uniquePages(pages: PageLink[]): PageLink[] {
  const seen = new Set<string>();
  const unique: PageLink[] = [];
  for (const page of pages) {
    if (seen.has(page.url)) continue;
    seen.add(page.url);
    unique.push(page);
  }
  return unique;
}

function uniqueDomains(pages: PageLink[]): string[] {
  return uniqueStrings(pages.map((page) => hostnameOf(page.url)).filter(Boolean));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
