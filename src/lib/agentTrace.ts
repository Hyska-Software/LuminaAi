/**
 * View model for the chat "thinking timeline" (agent steps).
 *
 * The harness persists a compact trace (`ChatMessage.trace`): one entry per
 * agent-loop step with the reasoning it produced and how many tool calls it
 * requested. Tool calls themselves live in `ChatMessage.toolCalls`, in
 * chronological order, so the timeline can be rebuilt exactly after a reload.
 *
 * Messages created before the trace existed fall back to a heuristic:
 * reasoning paragraphs first, then adjacent tool calls grouped by tool.
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
      if (reasoning) {
        for (const paragraph of splitReasoning(reasoning)) {
          entries.push({ kind: 'reasoning', text: paragraph });
        }
      }
      const count = Math.max(0, Math.floor(step.toolCalls ?? 0));
      const stepTools = tools.slice(cursor, cursor + count);
      cursor += count;
      pushToolGroups(entries, stepTools);
    }
  } else {
    // Legacy heuristic for messages persisted before the trace contract.
    for (const paragraph of splitReasoning(message.reasoning ?? '')) {
      entries.push({ kind: 'reasoning', text: paragraph });
    }
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

/**
 * Splits streamed reasoning into readable blocks: blank lines separate blocks,
 * single line breaks are preserved. Markdown list markers are dropped because
 * the timeline already renders each block as a bullet.
 */
export function splitReasoning(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  return normalized
    .split(/\n{2,}/)
    .map(cleanReasoningBlock)
    .filter((block) => block.length > 0);
}

function cleanReasoningBlock(block: string): string {
  return block
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trimEnd())
    .join('\n')
    .trim();
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
