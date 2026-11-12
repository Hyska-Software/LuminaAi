import { describe, expect, it } from 'vitest';
import {
  filterBranches,
  flattenBranchGroups,
  groupBranches,
  normalizeBranchQuery,
  remoteBranchShortName,
} from './branchMenu';
import type { WorkspaceGitBranch } from './types';

function branch(overrides: Partial<WorkspaceGitBranch> = {}): WorkspaceGitBranch {
  return {
    name: 'main',
    local: true,
    remote: null,
    current: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    gone: false,
    subject: '',
    author: '',
    committedAt: 0,
    ...overrides,
  };
}

const localMain = branch({ name: 'main', current: true, upstream: 'origin/main' });
const localFeature = branch({ name: 'feat/login', current: false, subject: 'feat: login' });
const remoteMain = branch({ name: 'origin/main', local: false, remote: 'origin' });
const remoteFeature = branch({
  name: 'origin/feat/login',
  local: false,
  remote: 'origin',
  subject: 'feat: login',
});
const remoteOnly = branch({ name: 'origin/release/2.0', local: false, remote: 'origin' });
const upstreamOnly = branch({
  name: 'upstream/hotfix',
  local: false,
  remote: 'upstream',
});

describe('normalizeBranchQuery', () => {
  it('strips accents, lowercases and trims', () => {
    expect(normalizeBranchQuery('  FEAT/Árvore  ')).toBe('feat/arvore');
    expect(normalizeBranchQuery('')).toBe('');
  });
});

describe('remoteBranchShortName', () => {
  it('drops only the remote prefix', () => {
    expect(remoteBranchShortName(remoteFeature)).toBe('feat/login');
    expect(remoteBranchShortName(remoteOnly)).toBe('release/2.0');
    expect(remoteBranchShortName(localFeature)).toBe('feat/login');
  });
});

describe('filterBranches', () => {
  const all = [localMain, localFeature, remoteMain, remoteFeature, remoteOnly];

  it('returns every branch for an empty query', () => {
    expect(filterBranches(all, '')).toHaveLength(all.length);
    expect(filterBranches(all, '   ')).toHaveLength(all.length);
  });

  it('matches the local and the remote name of the same branch', () => {
    const names = filterBranches(all, 'feat/login').map((entry) => entry.name);
    expect(names).toEqual(['feat/login', 'origin/feat/login']);
  });

  it('ignores case and accents', () => {
    const accented = [branch({ name: 'feat/Árvore' })];
    expect(filterBranches(accented, 'arvore')).toHaveLength(1);
    expect(filterBranches(accented, 'ÁRVORE')).toHaveLength(1);
  });

  it('matches the tip commit subject', () => {
    const names = filterBranches(all, 'login').map((entry) => entry.name);
    expect(names).toContain('feat/login');
  });

  it('returns nothing when the query matches no branch', () => {
    expect(filterBranches(all, 'zzz')).toEqual([]);
  });
});

describe('groupBranches', () => {
  it('puts local branches first, with the current one on top', () => {
    const groups = groupBranches([localFeature, remoteMain, localMain]);
    expect(groups[0].key).toBe('local');
    expect(groups[0].label).toBe('Locais');
    expect(groups[0].branches.map((entry) => entry.name)).toEqual(['main', 'feat/login']);
  });

  it('creates one section per remote, sorted by remote name', () => {
    const groups = groupBranches([remoteMain, upstreamOnly, localMain]);
    expect(groups.map((group) => group.key)).toEqual(['local', 'remote:origin', 'remote:upstream']);
    expect(groups[1].label).toBe('Remotas · origin');
    expect(groups[2].label).toBe('Remotas · upstream');
  });

  it('floats remote branches without a local counterpart to the top', () => {
    const groups = groupBranches([remoteMain, remoteOnly, localMain]);
    const remote = groups.find((group) => group.key === 'remote:origin');
    expect(remote?.branches.map((entry) => entry.name)).toEqual([
      'origin/release/2.0',
      'origin/main',
    ]);
  });

  it('hides every section when the query matches nothing', () => {
    expect(groupBranches([localMain], 'zzz')).toEqual([]);
  });

  it('filters before grouping', () => {
    const groups = groupBranches([localMain, localFeature, remoteFeature], 'login');
    expect(groups).toHaveLength(2);
    expect(flattenBranchGroups(groups).map((entry) => entry.name)).toEqual([
      'feat/login',
      'origin/feat/login',
    ]);
  });

  it('keeps a remote-only repository usable (no local section)', () => {
    const groups = groupBranches([remoteMain, remoteOnly]);
    expect(groups.map((group) => group.key)).toEqual(['remote:origin']);
  });
});

describe('flattenBranchGroups', () => {
  it('preserves the visual order for keyboard navigation', () => {
    const groups = groupBranches([localFeature, localMain, remoteMain, upstreamOnly]);
    expect(flattenBranchGroups(groups).map((entry) => entry.name)).toEqual([
      'main',
      'feat/login',
      'origin/main',
      'upstream/hotfix',
    ]);
  });
});
