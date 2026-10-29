import { ListResize } from '../../src/js/list_resize';
import { ListSession } from '../../src/js/list_session';
import { CommandQueue } from '../../src/js/command_queue';
import { BOARD_PROMPT } from '../../src/js/article_search';

const OPEN_PROMPT = 's\f';
const CANCEL_PROMPT = '\x03\f';
const allRows = rows => new Set(Array.from({ length: rows }, (_, row) => row));

// The real command queue pairs each response. The session supplies its public
// resize lifecycle and reading-record interfaces without terminal DOM.
function makeReader(mode = 'plain') {
  const sent = [];
  const events = [];
  const position = {
    kind: 'list', board: 'Test', mode, topNum: 107,
    topPinnedKey: null, scrollFrac: 3.25, cursorNum: 110,
  };
  const buf = {
    cols: 80, rows: 24, cur_x: 0, cur_y: 3, pageState: 2,
    listLines: [[{ ch: 'A', isLeadByte: false }]], listLineNums: [107],
  };
  const record = {
    begin: vi.fn((feature, own) => {
      events.push('begin');
      return { feature, list: { ...own.list } };
    }),
    end: vi.fn((_bookmark, outcome) => events.push(`end:${outcome}`)),
  };
  const view = { redraw: vi.fn(), flashListHint: vi.fn() };
  const core = {
    mobile: true, buf, view, readingRecord: record,
    conn: { isConnected: true },
    _setTermSizeNow: vi.fn((cols, rows) => {
      events.push('resize');
      buf.cols = cols;
      buf.rows = rows;
    }),
    _applyMobileGeometry: vi.fn(),
  };
  const queue = core.commandQueue = new CommandQueue({
    send: keys => { sent.push(keys); events.push('send'); },
  });
  const list = core.listSession = Object.assign(Object.create(ListSession.prototype), {
    _core: core, _view: view, _termBuf: buf, _queue: queue,
    state: 'active', _renderMode: 'buffer', _boardName: 'Test',
    _selectMode: mode === 'select', _topNum: 107, _scrollFrac: 3.25,
    _selectedNum: 110, _serverNum: 110,
    readingPosition: vi.fn(() => ({ ...position })),
    _engageEligible: vi.fn(() => true),
    _freezeForTransaction: vi.fn(() => {
      events.push('freeze');
      list._renderMode = 'frozen';
      queue.flushPending();
    }),
    _resumeAfterResize: vi.fn(() => {
      events.push('resume');
      list.state = 'active';
      list._renderMode = 'buffer';
    }),
    _enterFunctionMode: vi.fn((_facts, options) => {
      list.state = 'functionMode';
      list._renderMode = 'native';
      if (!options?.preserveQueue) queue.flush();
    }),
    _degradeToNative: vi.fn((_message, options) => list._enterFunctionMode(null, options)),
    _armFrozenWatchdog: vi.fn(), _maybeFill: vi.fn(), _presented: vi.fn(),
    _frozenStepBudgetMs: 0,
  });
  const resize = core.listResize = new ListResize(core);
  function paint({
    kind = 'clean-list', boardName = 'Test', rowTexts,
    curX = 0, curY = 3, changedRows = allRows(buf.rows),
    rows = buf.rows, cursorRowNum = 110,
  } = {}) {
    const texts = rowTexts || Array(rows).fill('');
    if (!rowTexts) texts[rows - 1] = ` ${mode === 'select' ? '系列文章' : '文章列表'} (y)回應(X)推文`;
    buf.cur_x = curX;
    buf.cur_y = curY;
    return queue.onSettle(
      { changedRows, curX, curY, pageState: buf.pageState },
      { kind, boardName, rowTexts: texts, rows, curX, curY, cursorRowNum, changedRows },
    );
  }
  function prompt(options = {}) {
    const texts = Array(buf.rows).fill('');
    texts[1] = BOARD_PROMPT + ': ';
    return paint({ kind: 'prompt', rowTexts: texts, curY: 1, ...options });
  }
  function complete() { prompt(); return paint(); }
  return { core, buf, view, list, record, queue, resize, sent, events, position, paint, prompt, complete };
}

describe('Article-list resize coordination', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] }));
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  test('uses only the session resize interface while preserving release order', () => {
    const h = makeReader();
    const session = h.list;
    h.core.listSession = {
      resizeContext: () => session.resizeContext(),
      waitingToResize: () => session.waitingToResize(),
      readingPosition: () => session.readingPosition(),
      beginResize: timeout => session.beginResize(timeout),
      endResize: (outcome, facts, lifecycle) => session.endResize(outcome, facts, lifecycle),
    };
    expect(h.resize.request(80, 40)).toBe(true);
    expect(h.list._renderMode).toBe('frozen');
    h.complete();
    expect(h.list._renderMode).toBe('buffer');
    expect(h.list._presented).toHaveBeenCalledTimes(1);
    expect(h.list._maybeFill).toHaveBeenCalledTimes(1);
    expect(h.events.indexOf('resume')).toBeLessThan(h.events.indexOf('end:done'));
    expect(h.record.end).toHaveBeenCalledTimes(1);
    expect(h.queue.idle).toBe(true);
  });

  test('waits for a stacked Back handoff before changing terminal rows', () => {
    const h = makeReader();
    const stack = { handingOff: true };
    h.core.articleGestures = { stack };
    expect(h.resize.request(80, 40)).toBe(true);
    expect(h.resize.pending).toEqual({ cols: 80, rows: 40 });
    expect(h.resize.active).toBe(false);
    expect(h.sent).toEqual([]);
    stack.handingOff = false;
    h.resize.pump();
    expect(h.sent).toEqual([OPEN_PROMPT]);
    h.complete();
    expect(h.resize.active).toBe(false);
  });

  test('retains a size change while Back has not yet restored the suspended list', () => {
    const h = makeReader();
    h.list.state = 'suspended';
    h.list._renderMode = 'native';
    h.core.articleGestures = { stack: { handingOff: true } };
    expect(h.resize.request(80, 40)).toBe(true);
    expect(h.resize.pending).toEqual({ cols: 80, rows: 40 });
    expect(h.core._setTermSizeNow).not.toHaveBeenCalled();
    expect(h.sent).toEqual([]);
  });

  test.each([
    ['desktop', h => { h.core.mobile = false; }],
    ['disconnected', h => { h.core.conn.isConnected = false; }],
    ['no article-list session', h => { h.core.listSession = null; }],
    ['native article list', h => { h.list.state = 'functionMode'; h.list._renderMode = 'native'; }],
    ['idle list', h => { h.list.state = 'idle'; h.list._renderMode = 'native'; }],
    ['unknown board', h => { h.list._boardName = null; }],
    ['list preference disabled', h => { h.list._engageEligible.mockReturnValue(false); }],
    ['no command queue', h => { h.core.commandQueue = null; }],
  ])('declines ownership on %s', (_name, arrange) => {
    const h = makeReader();
    arrange(h);
    expect(h.resize.request(80, 40)).toBe(false);
    expect(h.sent).toEqual([]);
    expect(h.record.begin).not.toHaveBeenCalled();
    expect(h.core._setTermSizeNow).not.toHaveBeenCalled();
  });

  test.each(['plain', 'select'])('redraws the same %s list without changing the reader selection', mode => {
    const h = makeReader(mode);
    const content = h.buf.listLines;
    expect(h.resize.request(80, 40)).toBe(true);
    expect(h.resize.active).toBe(true);
    expect(h.list._renderMode).toBe('frozen');
    expect(h.core._setTermSizeNow).toHaveBeenCalledExactlyOnceWith(80, 40);
    expect(h.sent).toEqual([OPEN_PROMPT]);
    expect(h.record.begin).toHaveBeenCalledWith('list-resize', { list: h.position, listOwner: h.list });
    expect(h.resize.listRecord).toEqual(h.position);
    expect(h.prompt()).toBe('done');
    expect(h.sent).toEqual([OPEN_PROMPT, CANCEL_PROMPT]);
    expect(h.record.end).not.toHaveBeenCalled();
    expect(h.paint({ cursorRowNum: 999 })).toBe('done');
    expect(h.list._resumeAfterResize).toHaveBeenCalledTimes(1);
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'done');
    expect(h.list.readingPosition()).toEqual(h.position);
    expect(h.list._selectedNum).toBe(110);
    expect(h.list._topNum).toBe(107);
    expect(h.list._scrollFrac).toBe(3.25);
    expect(h.buf.listLines).toBe(content);
    expect(h.resize.active).toBe(false);
    expect(h.resize.listRecord).toBeNull();
    expect(h.list._renderMode).toBe('buffer');
    expect(h.queue.idle).toBe(true);
    expect(h.list._degradeToNative).not.toHaveBeenCalled();
  });

  test('finishes an in-flight prefetch and its queued page before freezing or applying NAWS', () => {
    const h = makeReader();
    const completed = [];
    h.queue.enqueue({ kind: 'prefetch-anchor-up', keys: 'A', expect: () => true, onDone: () => completed.push('A') });
    h.queue.enqueue({ kind: 'prefetch-up', keys: 'B', expect: () => true, onDone: () => completed.push('B') });
    expect(h.resize.request(80, 40)).toBe(true);
    expect(h.resize.active).toBe(false);
    expect(h.list._freezeForTransaction).not.toHaveBeenCalled();
    expect(h.record.begin).not.toHaveBeenCalled();
    expect(h.buf.rows).toBe(24);
    h.paint();
    h.resize.pump();
    expect(h.sent).toEqual(['A', 'B']);
    expect(h.core._setTermSizeNow).not.toHaveBeenCalled();
    h.paint();
    h.resize.pump();
    expect(completed).toEqual(['A', 'B']);
    expect(h.sent).toEqual(['A', 'B', OPEN_PROMPT]);
    expect(h.buf.rows).toBe(40);
    h.complete();
    expect(h.record.end).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['another frozen transaction', h => { h.list._renderMode = 'frozen'; }, h => { h.list._renderMode = 'buffer'; }],
    ['article opening', h => { h.list.state = 'opening'; h.list._renderMode = 'frozen'; }, h => { h.list.state = 'active'; h.list._renderMode = 'buffer'; }],
    ['AID navigation', h => { h.core.aidNavigation = { active: true }; }, h => { h.core.aidNavigation.active = false; }],
    ['search submission', h => { h.core.searchInFlight = true; }, h => { h.core.searchInFlight = false; }],
  ])('defers the resize during %s', (_name, acquire, release) => {
    const h = makeReader();
    acquire(h);
    expect(h.resize.request(80, 40)).toBe(true);
    expect(h.sent).toEqual([]);
    expect(h.record.begin).not.toHaveBeenCalled();
    expect(h.core._setTermSizeNow).not.toHaveBeenCalled();
    release(h);
    h.resize.pump();
    expect(h.sent).toEqual([OPEN_PROMPT]);
    h.complete();
  });

  test('keeps only the latest pending size before the wire becomes idle', () => {
    const h = makeReader();
    h.queue.enqueue({ kind: 'prefetch-up', keys: 'P', expect: () => true });
    h.resize.request(80, 40);
    h.resize.request(80, 32);
    h.paint();
    h.resize.pump();
    expect(h.core._setTermSizeNow).toHaveBeenCalledExactlyOnceWith(80, 32);
    h.complete();
  });

  test('returning to the current size cancels a pending request without machine keys', () => {
    const h = makeReader();
    h.core.searchInFlight = true;
    h.resize.request(80, 40);
    h.resize.request(80, 24);
    h.core.searchInFlight = false;
    h.resize.pump();
    expect(h.sent).toEqual([]);
    expect(h.record.begin).not.toHaveBeenCalled();
    expect(h.core._setTermSizeNow).not.toHaveBeenCalled();
  });

  test('coalesces another rotation until the active prompt and redraw are complete', () => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.resize.request(80, 32);
    h.resize.request(80, 28);
    expect(h.sent).toEqual([OPEN_PROMPT]);
    h.complete();
    expect(h.core._setTermSizeNow.mock.calls).toEqual([[80, 40], [80, 28]]);
    expect(h.sent).toEqual([OPEN_PROMPT, CANCEL_PROMPT, OPEN_PROMPT]);
    expect(h.record.end).toHaveBeenCalledTimes(1);
    h.complete();
    expect(h.resize.active).toBe(false);
    expect(h.record.end).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['an ordinary list', h => h.paint()],
    ['a title-search prompt', h => {
      const texts = Array(h.buf.rows).fill('');
      texts[h.buf.rows - 1] = '搜尋標題: ';
      return h.paint({ kind: 'prompt', rowTexts: texts, curY: h.buf.rows - 1 });
    }],
    ['a board prompt with the cursor on another row', h => h.prompt({ curY: 2 })],
    ['an incomplete board prompt frame', h => h.prompt({ changedRows: new Set([1]) })],
  ])('never sends Ctrl-C in response to %s', (_name, respond) => {
    const h = makeReader();
    h.resize.request(80, 40);
    respond(h);
    expect(h.sent).toEqual([OPEN_PROMPT]);
    expect(h.record.end).not.toHaveBeenCalled();
    vi.advanceTimersByTime(6000);
    expect(h.sent).toEqual([OPEN_PROMPT]);
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'fail');
  });

  test('accumulates split row coverage separately for prompt and final redraw', () => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.prompt({ changedRows: new Set(Array.from({ length: 20 }, (_, row) => row)) });
    expect(h.sent).toEqual([OPEN_PROMPT]);
    h.prompt({ changedRows: new Set(Array.from({ length: 20 }, (_, row) => row + 20)) });
    expect(h.sent).toEqual([OPEN_PROMPT, CANCEL_PROMPT]);
    h.paint({ changedRows: new Set([39]) });
    expect(h.record.end).not.toHaveBeenCalled();
    h.paint({ changedRows: new Set(Array.from({ length: 39 }, (_, row) => row)) });
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'done');
  });

  test.each([
    ['another board', h => h.paint({ boardName: 'OtherBoard' })],
    ['another number space', h => {
      const texts = Array(h.buf.rows).fill('');
      texts[h.buf.rows - 1] = ' 系列文章 (y)回應(X)推文';
      return h.paint({ rowTexts: texts });
    }],
    ['an unrecognized screen', h => h.paint({ kind: 'transient' })],
    ['a response at the old row count', h => h.paint({ rows: 24, changedRows: allRows(24) })],
  ])('does not restore an origin onto %s', (_name, respond) => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.prompt();
    respond(h);
    expect(h.list._resumeAfterResize).not.toHaveBeenCalled();
    expect(h.record.end.mock.calls.some(([, outcome]) => outcome === 'done')).toBe(false);
    vi.advanceTimersByTime(6000);
    expect(h.list._degradeToNative).toHaveBeenCalledTimes(1);
    expect(h.resize.active).toBe(false);
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'fail');
  });

  test('shares one six-second deadline across prompt and partial redraw replies', () => {
    const h = makeReader();
    h.resize.request(80, 40);
    vi.advanceTimersByTime(2000);
    h.prompt();
    vi.advanceTimersByTime(2000);
    h.paint({ changedRows: new Set([39]) });
    vi.advanceTimersByTime(1999);
    expect(h.resize.active).toBe(true);
    vi.advanceTimersByTime(1);
    expect(h.resize.active).toBe(false);
    expect(h.queue.idle).toBe(true);
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'fail');
    expect(h.list._degradeToNative).toHaveBeenCalledTimes(1);
  });

  test.each(['prompt', 'redraw'])('cancel during %s releases its bookmark without a failure hint', phase => {
    const h = makeReader();
    h.resize.request(80, 40);
    if (phase === 'redraw') h.prompt();
    const before = [...h.sent];
    h.resize.cancel();
    expect(h.resize.active).toBe(false);
    expect(h.resize.listRecord).toBeNull();
    expect(h.list._renderMode).not.toBe('frozen');
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'cancel');
    expect(h.list._degradeToNative).not.toHaveBeenCalled();
    expect(h.sent).toEqual(before);
    h.resize.cancel();
    vi.advanceTimersByTime(7000);
    expect(h.record.end).toHaveBeenCalledTimes(1);
  });

  test('canceling an unsent request preserves another owner and its pending command', () => {
    const h = makeReader();
    h.queue.enqueue({ kind: 'aid-open', keys: 'A', expect: () => true });
    h.queue.enqueue({ kind: 'article-refresh', keys: 'B', expect: () => true });
    h.resize.request(80, 40);
    h.resize.cancel();
    expect(h.queue.inFlightKind).toBe('aid-open');
    h.paint();
    expect(h.sent).toEqual(['A', 'B']);
    expect(h.record.begin).not.toHaveBeenCalled();
    expect(h.list._enterFunctionMode).not.toHaveBeenCalled();
  });

  test.each(['cancel', 'timeout'])('%s releases native state before sending another queued owner', outcome => {
    const h = makeReader();
    h.resize.request(80, 40);
    const onForeignSend = vi.fn(() => {
      expect(h.list.state).toBe('functionMode');
      expect(h.list._renderMode).toBe('native');
      expect(h.resize.active).toBe(false);
    });
    h.queue.enqueue({ kind: 'aid-open', keys: 'B', expect: () => true, onSend: onForeignSend });
    if (outcome === 'cancel') h.resize.cancel();
    else vi.advanceTimersByTime(6000);
    expect(onForeignSend).toHaveBeenCalledTimes(1);
    expect(h.queue.inFlightKind).toBe('aid-open');
    expect(h.sent).toEqual([OPEN_PROMPT, 'B']);
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(
      h.record.begin.mock.results[0].value, outcome === 'cancel' ? 'cancel' : 'fail',
    );
  });

  test('an external flush of its command closes the bookmark only once', () => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.queue.flushKind('list-resize');
    expect(h.resize.active).toBe(false);
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'cancel');
    expect(h.list._renderMode).not.toBe('frozen');
    h.resize.cancel();
    vi.advanceTimersByTime(7000);
    expect(h.record.end).toHaveBeenCalledTimes(1);
  });

  test.each(['disconnect', 'preference disabled'])('%s cancels an owned resize exactly once', condition => {
    const h = makeReader();
    h.resize.request(80, 40);
    if (condition === 'disconnect') h.core.conn.isConnected = false;
    else h.list._engageEligible.mockReturnValue(false);
    h.resize.cancel();
    vi.advanceTimersByTime(7000);
    expect(h.resize.active).toBe(false);
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'cancel');
    expect(h.list._resumeAfterResize).not.toHaveBeenCalled();
    expect(h.list._degradeToNative).not.toHaveBeenCalled();
  });

  test('recursive lifecycle cancellation during failure does not finish the bookmark twice', () => {
    const h = makeReader();
    h.list._degradeToNative.mockImplementation(() => {
      h.resize.cancel();
      h.list._renderMode = 'native';
    });
    h.resize.request(80, 40);
    vi.advanceTimersByTime(6000);
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'fail');
    expect(h.list._degradeToNative).toHaveBeenCalledTimes(1);
    expect(h.resize.active).toBe(false);
    expect(h.queue.idle).toBe(true);
  });
});
