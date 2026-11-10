import { describe, expect, it } from 'vitest';

import { buildInlineDiff, parseUnifiedDiff } from '../diff';

const HEADERS = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
].join('\n');

describe('parseUnifiedDiff', () => {
  it('keeps file headers, hunk metadata and line counters', () => {
    const parsed = parseUnifiedDiff(`${HEADERS}\n@@ -1,2 +10,2 @@\n keep\n-old\n+new`);

    expect(parsed.meta.map((line) => line.text)).toEqual([
      'diff --git a/src/app.ts b/src/app.ts',
      'index 1111111..2222222 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
    ]);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].newStart).toBe(10);
    expect(parsed.added).toBe(1);
    expect(parsed.removed).toBe(1);
  });

  it('treats ---/+++ inside a hunk as content, not file headers', () => {
    const parsed = parseUnifiedDiff('@@ -1 +1 @@\n--- old sql\n+++ new sql');

    expect(parsed.hunks[0].lines).toEqual([
      { kind: 'remove', text: '-- old sql', oldNumber: 1 },
      { kind: 'add', text: '++ new sql', newNumber: 1 },
    ]);
    expect(parsed.meta).toEqual([]);
  });

  it('ignores the empty string created by a trailing newline', () => {
    const parsed = parseUnifiedDiff('@@ -1 +1 @@\n-old\n+new\n');

    expect(parsed.hunks[0].lines).toHaveLength(2);
    expect(parsed.hunks[0].lines.map((line) => line.kind)).toEqual(['remove', 'add']);
  });

  it('marks binary patches', () => {
    const parsed = parseUnifiedDiff('Binary files a/img.png and b/img.png differ');
    expect(parsed.binary).toBe(true);
    expect(parsed.hunks).toHaveLength(0);
  });
});

describe('buildInlineDiff', () => {
  it('marks a one-line replacement as modified and places one deletion marker', () => {
    const model = buildInlineDiff('@@ -1,2 +1,2 @@\n keep\n-old\n+new', 2);

    expect(model.lineTones.get(1)).toBeUndefined();
    expect(model.lineTones.get(2)).toBe('modified');
    expect(model.lineTones.size).toBe(1);
    expect(model.deletions.get(2)).toBe(1);
    expect(model.added).toBe(1);
    expect(model.removed).toBe(1);
  });

  it('pairs additions with removals and leaves extra additions green', () => {
    const model = buildInlineDiff(
      '@@ -1,2 +1,3 @@\n keep\n-old\n+new1\n+new2',
      3,
    );

    expect(model.lineTones.get(2)).toBe('modified');
    expect(model.lineTones.get(3)).toBe('added');
    expect(model.deletions.get(2)).toBe(1);
  });

  it('collapses extra removals into one marker without rendering them', () => {
    const model = buildInlineDiff('@@ -1,3 +1,2 @@\n keep\n-old1\n-old2\n+new', 2);

    expect(model.lineTones.get(2)).toBe('modified');
    expect(model.lineTones.size).toBe(1);
    expect(model.deletions.get(2)).toBe(2);
    expect(model.added).toBe(1);
    expect(model.removed).toBe(2);
  });

  it('marks a pure addition as added without a deletion marker', () => {
    const model = buildInlineDiff('@@ -1,0 +2,1 @@\n+added', 2);

    expect(model.lineTones.get(2)).toBe('added');
    expect(model.deletions.size).toBe(0);
  });

  it('places a whole-file deletion before line 1', () => {
    const model = buildInlineDiff('@@ -1,2 +0,0 @@\n-gone1\n-gone2', 0);

    expect(model.lineTones.size).toBe(0);
    expect(model.deletions.get(1)).toBe(2);
    expect(model.removed).toBe(2);
  });

  it('uses newStart + 1 for a pure deletion after context', () => {
    const model = buildInlineDiff('@@ -5,1 +4,0 @@\n-gone', 4);

    expect(model.deletions.get(5)).toBe(1);
  });

  it('does not turn a trailing newline into a phantom deletion position', () => {
    // Deleting line 2 leaves line 1; the marker belongs after it (line 2), not
    // on a fake context line created by the trailing newline.
    const model = buildInlineDiff('@@ -2 +1,0 @@\n-gone\n', 2);

    expect(model.deletions.get(2)).toBe(1);
    expect(model.deletions.get(1)).toBeUndefined();
  });

  it('clamps tones and markers to the rendered line count', () => {
    const model = buildInlineDiff('@@ -1,0 +2,1 @@\n+added', 1);

    expect(model.lineTones.size).toBe(0);
    expect(model.added).toBe(1);
  });

  it('returns an empty model for an empty or binary patch', () => {
    const empty = buildInlineDiff('', 3);
    expect(empty.lineTones.size).toBe(0);
    expect(empty.deletions.size).toBe(0);
    expect(empty.added).toBe(0);
    expect(empty.removed).toBe(0);

    const binary = buildInlineDiff('Binary files a/x and b/x differ', 3);
    expect(binary.binary).toBe(true);
    expect(binary.lineTones.size).toBe(0);
    expect(binary.deletions.size).toBe(0);
  });
});
