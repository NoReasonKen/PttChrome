import { ArticleComparison, ArticleComparisonRows, nearbyPageRange } from '../../src/js/article_comparison';

const rows = (...lines) => lines.map(line => Array.from(line, ch => ({ ch })));
const frame = (start, end, lines, atEnd = false) => ({ start, end, rows: rows(...lines), atEnd });

describe('nearbyPageRange', () => {
  const pages = Array.from({ length: 7 }, (_, i) => ({ start: i * 10 + 1, end: i * 10 + 10, offset: i * 9 }));
  it('chooses the page at or before the anchor and up to two on each side', () => {
    expect(nearbyPageRange(pages, 28)).toEqual({ start: 11, end: 60, offset: 9 });
    expect(nearbyPageRange(pages, 0)).toEqual({ start: 1, end: 30, offset: 0 });
    expect(nearbyPageRange(pages, 100)).toEqual({ start: 41, end: 70, offset: 36 });
    expect(nearbyPageRange([], 0)).toBeNull();
    expect(nearbyPageRange(pages, -1)).toBeNull();
  });
});

describe('ArticleComparison', () => {
  const shown = rows('a', 'b', 'c', 'd', 'e', 'f');
  const range = { start: 3, end: 5, offset: 2 };

  it('allows the handoff after the near range, then checks the tail and the prefix', () => {
    const comparison = new ArticleComparison(shown, range, true);
    expect(comparison.next).toEqual({ seek: 3 });
    expect(comparison.nearReady).toBe(false);
    comparison.accept(frame(3, 4, ['c', 'd']));
    expect(comparison.next).toEqual({ forward: true });
    expect(comparison.nearReady).toBe(false);
    comparison.accept(frame(4, 5, ['d', 'e']));
    expect(comparison.nearReady).toBe(true);
    expect(comparison.outcome).toBeNull();
    comparison.accept(frame(5, 7, ['e', 'f', 'new comment'], true));
    expect(comparison.next).toEqual({ seek: 1 });
    comparison.accept(frame(1, 3, ['a', 'b', 'c']));
    expect(comparison.next).toBeNull();
    expect(comparison.outcome).toBe('match');
    expect(comparison.extra).toEqual(rows('new comment'));
  });

  it('cancels a pending extension if the prefix differs', () => {
    const comparison = new ArticleComparison(shown, range, true);
    comparison.accept(frame(3, 7, ['c', 'd', 'e', 'f', 'new comment'], true));
    comparison.accept(frame(1, 3, ['changed', 'b', 'c']));
    expect(comparison.next).toBeNull();
    expect(comparison.outcome).toBe('mismatch');
    expect(comparison.extra).toEqual([]);
  });

  it('stops before the handoff on a nearby difference or an unverified landing', () => {
    const changed = new ArticleComparison(shown, range, false);
    changed.accept(frame(3, 5, ['c', 'changed', 'e']));
    expect(changed.nearReady).toBe(true);
    expect(changed.outcome).toBe('mismatch');
    const clamped = new ArticleComparison(shown, range, false);
    clamped.accept(frame(2, 4, ['b', 'c', 'd'], true));
    expect(clamped.outcome).toBe('uncertain');
    expect(clamped.next).toBeNull();
  });
});

describe('ArticleComparisonRows', () => {
  it('compares a segment at its absolute displayed offset and stitches overlap', () => {
    const shown = rows('before', 'a', 'b', 'c', 'd');
    const comparison = new ArticleComparisonRows(shown, 1);
    expect(comparison.append(frame(5, 7, ['a', 'b', 'c']))).toBe('match');
    expect(comparison.append(frame(7, 8, ['c', 'd'], true))).toBe('match');
    expect(shown).toEqual(rows('before', 'a', 'b', 'c', 'd'));
  });

  it('collects additional content separately and detects changes or truncation', () => {
    expect(new ArticleComparisonRows(rows('a', 'b')).append(frame(1, 2, ['a', 'x'], true))).toBe('mismatch');
    const extended = new ArticleComparisonRows(rows('a'));
    expect(extended.append(frame(1, 2, ['a', 'b'], true))).toBe('match');
    expect(extended.extra).toEqual(rows('b'));
    expect(extended.shown).toEqual(rows('a'));
    expect(new ArticleComparisonRows(rows('a', 'b')).append(frame(1, 1, ['a'], true))).toBe('mismatch');
    expect(new ArticleComparisonRows(rows('a', 'b')).append(frame(1, 1, ['a']))).toBe('match');
  });

  it('ignores terminal end padding, but preserves interior spaces', () => {
    const whole = new ArticleComparisonRows(rows('a', '', ''), 0, { whole: true });
    expect(whole.append(frame(1, 1, ['a', '', ''], true))).toBe('match');
    expect(whole.extra).toEqual([]);
    expect(new ArticleComparisonRows(rows('a', '')).append(frame(1, 1, ['a'], true))).toBe('mismatch');
    expect(new ArticleComparisonRows(rows('a b')).append(frame(1, 1, ['a  b'], true))).toBe('mismatch');
  });

  it('uses verified file positions for repeated rows and stops on gaps or wrapped ambiguity', () => {
    const gap = new ArticleComparisonRows(rows('a', 'b', 'c'));
    gap.append(frame(1, 2, ['a', 'b']));
    expect(gap.append(frame(4, 4, ['c']))).toBe('uncertain');
    expect(gap.append(frame(2, 3, ['b', 'c']))).toBe('uncertain');
    const repeated = new ArticleComparisonRows(rows('a', 'a', 'a'));
    repeated.append(frame(1, 2, ['a', 'a']));
    expect(repeated.append(frame(2, 3, ['a', 'a']))).toBe('match');
    const wrapped = new ArticleComparisonRows(rows('a', 'a', 'a', 'a'));
    wrapped.append(frame(1, 2, ['a', 'a', 'a']));
    expect(wrapped.append(frame(2, 3, ['a', 'a']))).toBe('uncertain');
  });
});
