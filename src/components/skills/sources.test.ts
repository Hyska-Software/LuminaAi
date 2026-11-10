import { describe, expect, it } from 'vitest';
import type { SkillSummary } from '@/lib/types';
import {
  countSkillsByOrigin,
  groupSkillsBySource,
  isExternalSkillSource,
  SKILL_SOURCES,
  skillSourceMeta,
} from './sources';

function skill(name: string, source: string, overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name,
    description: `Skill ${name}`,
    source,
    enabled: true,
    deletable: false,
    ...overrides,
  };
}

describe('skillSourceMeta', () => {
  it('mapeia todas as origens conhecidas com rótulos em pt-BR', () => {
    expect(SKILL_SOURCES.map((entry) => entry.key)).toEqual([
      'user',
      'agents',
      'codex',
      'claude',
      'opencode',
      'bundled',
    ]);

    expect(SKILL_SOURCES.map((entry) => entry.groupLabel)).toEqual([
      'Zylara',
      'Agentes',
      'Codex',
      'Claude',
      'OpenCode',
      'Embutidas',
    ]);

    expect(skillSourceMeta('user')).toMatchObject({ label: 'Do Zylara', external: false });
    expect(skillSourceMeta('agents')).toMatchObject({ label: 'Agentes', external: true });
    expect(skillSourceMeta('codex')).toMatchObject({ label: 'Codex', external: true });
    expect(skillSourceMeta('claude')).toMatchObject({ label: 'Claude', external: true });
    expect(skillSourceMeta('opencode')).toMatchObject({ label: 'OpenCode', external: true });
    expect(skillSourceMeta('bundled')).toMatchObject({ label: 'Embutida', external: false });
  });

  it('marca somente as origens externas como somente leitura', () => {
    expect(isExternalSkillSource('agents')).toBe(true);
    expect(isExternalSkillSource('codex')).toBe(true);
    expect(isExternalSkillSource('claude')).toBe(true);
    expect(isExternalSkillSource('opencode')).toBe(true);
    expect(isExternalSkillSource('user')).toBe(false);
    expect(isExternalSkillSource('bundled')).toBe(false);
  });

  it('usa o valor bruto como fallback para origem desconhecida', () => {
    const meta = skillSourceMeta('custom');
    expect(meta.key).toBe('custom');
    expect(meta.groupLabel).toBe('custom');
    expect(meta.label).toBe('custom');
    expect(meta.tone).toBe('muted');
    expect(isExternalSkillSource('custom')).toBe(false);
  });
});

describe('groupSkillsBySource', () => {
  it('ordena as seções pela precedência canônica e omite as vazias', () => {
    const groups = groupSkillsBySource([
      skill('builtin', 'bundled'),
      skill('mine', 'user'),
      skill('codex-one', 'codex'),
      skill('shared', 'agents'),
      skill('claude-one', 'claude'),
      skill('oc-one', 'opencode'),
    ]);

    expect(groups.map((group) => group.source)).toEqual([
      'user',
      'agents',
      'codex',
      'claude',
      'opencode',
      'bundled',
    ]);
    expect(groups.every((group) => group.skills.length > 0)).toBe(true);
    expect(groups[0]?.meta.groupLabel).toBe('Zylara');
    expect(groups[5]?.meta.groupLabel).toBe('Embutidas');
  });

  it('agrupa múltiplas skills da mesma origem preservando a ordem recebida', () => {
    const groups = groupSkillsBySource([
      skill('a', 'codex'),
      skill('b', 'codex'),
      skill('c', 'user'),
    ]);

    expect(groups.map((group) => group.source)).toEqual(['user', 'codex']);
    expect(groups[1]?.skills.map((entry) => entry.name)).toEqual(['a', 'b']);
  });

  it('anexa origens desconhecidas ao final', () => {
    const groups = groupSkillsBySource([skill('x', 'future'), skill('y', 'user')]);
    expect(groups.map((group) => group.source)).toEqual(['user', 'future']);
  });
});

describe('countSkillsByOrigin', () => {
  it('conta Zylara, externas, embutidas e outras origens', () => {
    const counts = countSkillsByOrigin([
      skill('a', 'user'),
      skill('b', 'user'),
      skill('c', 'agents', { enabled: false }),
      skill('d', 'codex'),
      skill('e', 'bundled'),
      skill('f', 'custom'),
    ]);

    expect(counts).toEqual({ total: 6, zylara: 2, external: 2, bundled: 1, other: 1 });
  });
});
