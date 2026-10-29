import {
  RESIZE_TIMEOUT_MS, resizeDeadline, coalesceResize, resizePhase,
} from '../../src/js/resize_transaction';

function makePhase(overrides = {}) {
  const core = { buf: { cols: 80, rows: 4 } };
  const command = { cols: 80, rows: 4, deadline: resizeDeadline() };
  const isCurrent = vi.fn(() => true);
  const accept = vi.fn(() => true);
  const options = { core, command, isCurrent, accept, ...overrides };
  return { ...options, phase: resizePhase(options.core, options.command, options.isCurrent, options.accept) };
}

const snapshot = (...rows) => ({ changedRows: new Set(rows) });

describe('Resize transaction helpers', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] }));
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  test('starts a six-second deadline from the current monotonic time', () => {
    vi.advanceTimersByTime(1250);
    expect(RESIZE_TIMEOUT_MS).toBe(6000);
    expect(resizeDeadline()).toBe(performance.now() + 6000);
  });

  test('uses the remaining shared deadline for both phase timeouts', () => {
    const h = makePhase();
    expect(h.phase).toMatchObject({
      fullRepaint: true, probe: false, timeoutMs: 6000, hardTimeoutMs: 6000,
    });
    vi.advanceTimersByTime(2100);
    const next = resizePhase(h.core, h.command, h.isCurrent, h.accept);
    expect(next.timeoutMs).toBe(3900);
    expect(next.hardTimeoutMs).toBe(3900);
    expect(h.phase.timeoutMs).toBe(6000);
  });

  test.each([6000, 7000])('keeps a minimum one-millisecond budget after %i milliseconds', elapsed => {
    const h = makePhase();
    vi.advanceTimersByTime(elapsed);
    const next = resizePhase(h.core, h.command, h.isCurrent, h.accept);
    expect(next.timeoutMs).toBe(1);
    expect(next.hardTimeoutMs).toBe(1);
  });

  test('waits for all distinct rows across split settles before checking the screen', () => {
    const h = makePhase();
    expect(h.phase.expect(snapshot(0, 2), {})).toBe(false);
    expect(h.phase.expect(snapshot(2, 3), {})).toBe(false);
    expect(h.accept).not.toHaveBeenCalled();
    const finalSnapshot = snapshot(1);
    const facts = { kind: 'clean-list' };
    expect(h.phase.expect(finalSnapshot, facts)).toBe(true);
    expect(h.accept).toHaveBeenCalledExactlyOnceWith(finalSnapshot, facts);
  });

  test('duplicates and out-of-range rows cannot substitute for a missing row', () => {
    const h = makePhase();
    expect(h.phase.expect({ changedRows: [-1, 0, 0, 1, 1, 2, 4, 5] }, {})).toBe(false);
    expect(h.phase.expect(snapshot(0, 1, 2), {})).toBe(false);
    expect(h.accept).not.toHaveBeenCalled();
    expect(h.phase.expect(snapshot(3), {})).toBe(true);
  });

  test.each([undefined, null, {}, { changedRows: null }])('tolerates missing changed rows in %j', value => {
    const h = makePhase();
    expect(h.phase.expect(value, {})).toBe(false);
    expect(h.accept).not.toHaveBeenCalled();
  });

  test.each([
    ['columns', { cols: 79, rows: 4 }],
    ['rows', { cols: 80, rows: 3 }],
  ])('waits for the target buffer %s without discarding collected coverage', (_name, size) => {
    const h = makePhase();
    Object.assign(h.core.buf, size);
    expect(h.phase.expect(snapshot(0, 1, 2, 3), {})).toBe(false);
    expect(h.accept).not.toHaveBeenCalled();
    Object.assign(h.core.buf, { cols: 80, rows: 4 });
    expect(h.phase.expect(undefined, {})).toBe(true);
  });

  test('rejects a stale owner even after the full repaint has arrived', () => {
    const h = makePhase();
    h.isCurrent.mockReturnValue(false);
    expect(h.phase.expect(snapshot(0, 1, 2, 3), {})).toBe(false);
    expect(h.accept).not.toHaveBeenCalled();
    h.isCurrent.mockReturnValue(true);
    expect(h.phase.expect(undefined, {})).toBe(true);
  });

  test('starts independent row coverage for every phase', () => {
    const h = makePhase();
    expect(h.phase.expect(snapshot(0, 1, 2, 3), {})).toBe(true);
    h.accept.mockClear();
    const next = resizePhase(h.core, h.command, h.isCurrent, h.accept);
    expect(next.expect(snapshot(3), {})).toBe(false);
    expect(h.accept).not.toHaveBeenCalled();
    expect(next.expect(snapshot(0, 1, 2), {})).toBe(true);
  });

  test.each([true, false, undefined, null, 0, '', 'same', 'different', { kind: 'clean-list' }])(
    'passes the screen acceptance result through unchanged: %j', result => {
      const h = makePhase({ accept: vi.fn(() => result) });
      expect(h.phase.expect(snapshot(0, 1, 2, 3), {})).toBe(result);
    },
  );

  test('checks later screen content again after complete row coverage', () => {
    const h = makePhase();
    h.accept.mockReturnValueOnce(false).mockReturnValueOnce('same');
    expect(h.phase.expect(snapshot(0, 1, 2, 3), {})).toBe(false);
    expect(h.phase.expect(snapshot(), {})).toBe('same');
    expect(h.accept).toHaveBeenCalledTimes(2);
  });

  test('drops a pending size when it matches the active size', () => {
    expect(coalesceResize(80, 40, { cols: 80, rows: 40 })).toBeNull();
  });

  test.each([[81, 40], [80, 24], [81, 24]])('retains a changed size of %i columns and %i rows', (cols, rows) => {
    const activeSize = { cols: 80, rows: 40 };
    expect(coalesceResize(cols, rows, activeSize)).toEqual({ cols, rows });
    expect(activeSize).toEqual({ cols: 80, rows: 40 });
  });
});
