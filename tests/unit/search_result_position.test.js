// @unit-env browser
import { restoreSearchResultPosition } from '../../src/js/search_result_position';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const anchor = { num: 42, author: 'reader', title: 'r: [talk] topic', date: '6/14', scrollFrac: 0.25 };
const row = (num, { author = 'Reader', title = 'R: [Talk] Topic', date = '6/14' } = {}) =>
  `${String(num).padStart(7)} + 1${date.padStart(5)} ${author.padEnd(13)}${title}`;

function facts(entries, selected, { board = 'Test', caption = '系列文章' } = {}) {
  const rowTexts = Array(24).fill('');
  rowTexts[0] = `【板主:test】看板《${board}》`;
  rowTexts[23] = ` ${caption} [←]離開 [→]閱讀`;
  for (const [index, [num, attributes]] of entries.entries()) rowTexts[index + 3] = row(num, attributes);
  const cursor = entries.findIndex(([num]) => num === selected);
  return { rowTexts, rows: 24, curX: 0, curY: cursor < 0 ? 3 : cursor + 3, inputField: false };
}

function harness(saved = anchor) {
  const pending = [];
  const sent = [];
  const core = { commandQueue: { enqueue: vi.fn(step => pending.push(step)) } };
  const done = vi.fn();
  restoreSearchResultPosition(core, { board: 'Test' }, saved, done);
  const next = () => {
    expect(pending.length).toBeGreaterThan(0);
    const step = pending.shift();
    sent.push(step.keys);
    return step;
  };
  const accept = (step, landing) => {
    const result = step.expect(null, landing);
    expect(result).toBe(landing);
    step.onDone(result);
  };
  return { core, pending, sent, done, next, accept };
}

test('restores the saved fraction only after the old number positively matches content', () => {
  const h = harness();
  const probe = h.next();
  expect(probe.keys).toBe('42\r\f');
  expect(h.done).not.toHaveBeenCalled();
  h.accept(probe, facts([[41, { title: 'Other' }], [42, {}], [43, { title: 'Next' }]], 42));
  expect(h.done).toHaveBeenCalledExactlyOnceWith({ record: {
    kind: 'list', board: 'Test', mode: 'select', topNum: 42, topPinnedKey: null,
    scrollFrac: 0.25, cursorNum: 42
  } });
  expect(h.sent).toHaveLength(1);
});

test('selects a moved content match on the first page instead of trusting the old number', () => {
  const h = harness();
  h.accept(h.next(), facts([[40, {}], [41, { title: 'Other' }], [42, { title: 'Replacement' }]], 42));
  expect(h.done).not.toHaveBeenCalled();
  const select = h.next();
  expect(select.keys).toBe('40\r\f');
  h.accept(select, facts([[40, {}], [41, { title: 'Other' }], [42, { title: 'Replacement' }]], 40));
  expect(h.done).toHaveBeenCalledExactlyOnceWith({ record: expect.objectContaining({ topNum: 40, cursorNum: 40 }) });
  expect(h.sent).toHaveLength(2);
});

test('renews the existing input guard for each positioning command on a slow connection', () => {
  const h = harness();
  const first = h.next();
  vi.advanceTimersByTime(14000);
  h.accept(first, facts([[40, {}], [42, { title: 'Other' }]], 42));
  vi.advanceTimersByTime(2000);
  expect(h.core.searchInFlight).toBe(true);
  const select = h.next();
  h.accept(select, facts([[40, {}], [42, { title: 'Other' }]], 40));
  expect(h.done).toHaveBeenCalledOnce();
});

test('returns the exact landing board key and legacy list mode', () => {
  const h = harness();
  h.accept(h.next(), facts([[42, {}]], 42, { board: 'tEsT', caption: '文章選讀' }));
  expect(h.done).toHaveBeenCalledExactlyOnceWith({ record: expect.objectContaining({
    board: 'tEsT', mode: 'plain', topNum: 42, cursorNum: 42
  }) });
});

test('checks bounded neighboring pages and verifies the final selected row', () => {
  const h = harness();
  h.accept(h.next(), facts([[41, { title: 'Other' }], [42, { title: 'Replacement' }]], 42));
  const lower = h.next();
  expect(lower.keys).toBe('22\r\f');
  h.accept(lower, facts([[22, { title: 'Lower' }], [23, {}]], 22));
  const upper = h.next();
  expect(upper.keys).toBe('62\r\f');
  h.accept(upper, facts([[61, { title: 'Upper' }], [62, { title: 'Upper next' }]], 62));
  const select = h.next();
  expect(select.keys).toBe('23\r\f');
  h.accept(select, facts([[22, { title: 'Lower' }], [23, {}]], 23));
  expect(h.done).toHaveBeenCalledExactlyOnceWith({ record: expect.objectContaining({ topNum: 23 }) });
  expect(h.sent.length).toBeLessThanOrEqual(5);
});

test('falls back to End when no candidate appears within the bounded search', () => {
  const h = harness();
  for (const num of [42, 22, 62]) h.accept(h.next(), facts([[num, { title: 'Other' }]], num));
  const fallback = h.next();
  expect(fallback.keys).toBe('\x1b[4~\f');
  h.accept(fallback, facts([[99, { title: 'Newest' }]], 99));
  expect(h.done).toHaveBeenCalledExactlyOnceWith({ missing: true });
  expect(h.pending).toEqual([]);
  expect(h.sent.length).toBeLessThanOrEqual(5);
});

test('refuses ambiguous content matches on one page', () => {
  const h = harness();
  h.accept(h.next(), facts([[40, {}], [41, {}], [42, { title: 'Other' }]], 42));
  const fallback = h.next();
  expect(fallback.keys).toBe('\x1b[4~\f');
  h.accept(fallback, facts([[99, { title: 'Newest' }]], 99));
  expect(h.done).toHaveBeenCalledExactlyOnceWith({ missing: true });
});

test('refuses distinct matching numbers found across neighboring pages', () => {
  const h = harness();
  h.accept(h.next(), facts([[42, { title: 'Other' }]], 42));
  h.accept(h.next(), facts([[22, {}]], 22));
  h.accept(h.next(), facts([[62, {}]], 62));
  const fallback = h.next();
  expect(fallback.keys).toBe('\x1b[4~\f');
  h.accept(fallback, facts([[99, { title: 'Newest' }]], 99));
  expect(h.done).toHaveBeenCalledExactlyOnceWith({ missing: true });
  expect(h.sent.length).toBeLessThanOrEqual(5);
});

test('rechecks identity after selection and falls back if the candidate changed', () => {
  const h = harness();
  h.accept(h.next(), facts([[40, {}], [42, { title: 'Other' }]], 42));
  h.accept(h.next(), facts([[40, { title: 'Replacement' }]], 40));
  const fallback = h.next();
  expect(fallback.keys).toBe('\x1b[4~\f');
  h.accept(fallback, facts([[99, { title: 'Newest' }]], 99));
  expect(h.done).toHaveBeenCalledExactlyOnceWith({ missing: true });
});

test.each(['onFail', 'onFlushed'])('finishes once when a position command is interrupted via %s', callback => {
  const h = harness();
  const probe = h.next();
  probe[callback]();
  probe[callback]();
  expect(h.done).toHaveBeenCalledExactlyOnceWith({ interrupted: true });
  expect(h.pending).toEqual([]);
});

test('accepts only verified result screens from the same board', () => {
  const h = harness();
  const probe = h.next();
  expect(probe.expect(null, facts([[42, {}]], 42, { board: 'Other' }))).toBe(false);
  expect(probe.expect(null, facts([[42, {}]], 42, { caption: '文摘列表' }))).toBe(false);
  expect(h.done).not.toHaveBeenCalled();
});

test.each([null, {}, { ...anchor, num: -1 }, { ...anchor, scrollFrac: Infinity }])(
  'does not send commands for a malformed saved anchor %#', saved => {
    const h = harness(saved);
    expect(h.done).toHaveBeenCalledExactlyOnceWith(saved === null ? { missing: true } : {});
    expect(h.core.commandQueue.enqueue).not.toHaveBeenCalled();
  }
);
