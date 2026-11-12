/**
 * Pure helpers behind the branch picker of the Changes tab.
 *
 * Search, grouping and ordering live here so the component only renders: the
 * rules stay testable without a DOM and cannot drift from the backend contract
 * (`WorkspaceGitBranch`).
 *
 * Contract: `workbench` §7.2 (branch bar of the Changes tab).
 */
import { t } from './i18n';
import { compareText, localeLowerCase } from './i18n/format';
import type { WorkspaceGitBranch } from './types';

/** One section of the branch list (`Local`, one per remote, …). */
export interface BranchGroup {
  /** Stable key of the section (`local`, `remote:origin`). */
  key: string;
  label: string;
  branches: WorkspaceGitBranch[];
}

const DIACRITICS = /[\u0300-\u036f]/g;

/** Lowercase, accent-free and trimmed — same comparison rule as the model list. */
export function normalizeBranchQuery(value: string): string {
  return localeLowerCase(value.normalize('NFD').replace(DIACRITICS, '')).trim();
}

/** `origin/feat/login` → `feat/login` (the name shown for a remote branch). */
export function remoteBranchShortName(branch: WorkspaceGitBranch): string {
  if (branch.local) return branch.name;
  const separator = branch.name.indexOf('/');
  return separator < 0 ? branch.name : branch.name.slice(separator + 1);
}

/**
 * Fields matched by the search field: the full name, the name without the
 * remote prefix, the configured upstream and the tip commit subject.
 */
function haystack(branch: WorkspaceGitBranch): string {
  return normalizeBranchQuery(
    [branch.name, remoteBranchShortName(branch), branch.upstream ?? '', branch.subject ?? ''].join(
      ' ',
    ),
  );
}

/** Keeps the branches the query matches (all of them for an empty query). */
export function filterBranches(
  branches: readonly WorkspaceGitBranch[],
  query: string,
): WorkspaceGitBranch[] {
  const needle = normalizeBranchQuery(query);
  if (!needle) return [...branches];
  return branches.filter((branch) => haystack(branch).includes(needle));
}

/** `true` when a local branch already covers this remote-tracking ref. */
function hasLocalCounterpart(
  branch: WorkspaceGitBranch,
  locals: ReadonlySet<string>,
): boolean {
  if (branch.local) return false;
  const short = remoteBranchShortName(branch);
  return short !== branch.name && locals.has(short);
}

/**
 * Sections of the picker: local branches first (the ones the user switches
 * between most of the time), then one section per remote.
 *
 * A remote branch that already has a local counterpart is still listed — it is
 * the only way to see how far the remote moved — but the local row comes first
 * so the picker never offers a duplicate checkout path up front.
 */
export function groupBranches(
  branches: readonly WorkspaceGitBranch[],
  query = '',
): BranchGroup[] {
  const visible = filterBranches(branches, query);
  if (visible.length === 0) return [];

  const locals = new Set(
    visible.filter((branch) => branch.local).map((branch) => branch.name),
  );

  const localRows = visible
    .filter((branch) => branch.local)
    .sort((left, right) => {
      if (left.current !== right.current) return left.current ? -1 : 1;
      return compareText(left.name, right.name);
    });

  const remotes = new Map<string, WorkspaceGitBranch[]>();
  for (const branch of visible) {
    if (branch.local) continue;
    const remote = branch.remote ?? t('code:branches.remoteBadge');
    const bucket = remotes.get(remote);
    if (bucket) bucket.push(branch);
    else remotes.set(remote, [branch]);
  }

  const groups: BranchGroup[] = [];
  if (localRows.length) {
    groups.push({ key: 'local', label: t('code:branches.groups.local'), branches: localRows });
  }
  for (const remote of [...remotes.keys()].sort(compareText)) {
    const rows = remotes.get(remote) ?? [];
    rows.sort((left, right) => {
      // Rows whose remote ref has no local equivalent float up: they are the
      // ones that actually create a branch when picked.
      const leftDuplicate = hasLocalCounterpart(left, locals);
      const rightDuplicate = hasLocalCounterpart(right, locals);
      if (leftDuplicate !== rightDuplicate) return leftDuplicate ? 1 : -1;
      return compareText(left.name, right.name);
    });
    groups.push({
      key: `remote:${remote}`,
      label: t('code:branches.groups.remote', { remote }),
      branches: rows,
    });
  }
  return groups;
}

/** Flat order of the picker, used for keyboard navigation. */
export function flattenBranchGroups(groups: readonly BranchGroup[]): WorkspaceGitBranch[] {
  return groups.flatMap((group) => group.branches);
}
