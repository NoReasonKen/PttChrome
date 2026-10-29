import { ArticleResize } from '../../src/js/article_resize';
import { CommandQueue } from '../../src/js/command_queue';
import { EasyReading, PAGE_DOWN_GRACE_MS, PAGE_DOWN_MAX_RETRIES } from '../../src/js/easy_reading';
import { parseStatusRow, statusSignature } from '../../src/js/string_util';

const PAGE_DOWN = '\x1b[6~';
const LEAVE = '\x1b[D\f';
const HEADER = ['Author: reader', 'Title: Retained article', 'Date: Thu Jan 1 00:00:00 2026'];
const allRows = rows => new Set(Array.from({ length: rows }, (_, row) => row));
const cells = text => Array.from(text, ch => ({ ch, isLeadByte: false }));
const footer = (start = 1, end = 23, percent = 45) =>
  `  瀏覽 第 1/3 頁 (${percent}%)  目前顯示: 第 ${start}~${end} 行  (h)說明`;

// The real queue and easy-reading paging gate run without terminal DOM.
// Row changes represent TermBuf.settleSnapshot, not network packet boundaries.
function makeReader() {
  const events = [];
  const sent = [];
  const rowTexts = new Map(HEADER.map((text, row) => [row, text]));
  rowTexts.set(23, footer());
  const article = Array.from({ length: 23 }, (_, row) => cells(HEADER[row] || `Article line ${row + 1}`));
  const buf = {
    cols: 80, rows: 24, cur_x: 79, cur_y: 23,
    pageState: 3, prevPageState: 3, pageLines: article,
    easyReadingResizeInFlight: false, getRowText: row => rowTexts.get(row) || '',
  };
  const view = {
    _articleBoard: 'TestBoard', _accEndRow: 23, _lastAccumulatedSig: '1~23',
    mainDisplay: { scrollTop: 480 },
    redraw: vi.fn(() => events.push('redraw')), flashListHint: vi.fn(),
  };
  const record = {
    begin: vi.fn(feature => {
      events.push('begin');
      return { feature, article: { easy: true, lineIndex: 12.25 } };
    }),
    end: vi.fn(() => events.push('end')),
  };
  const core = {
    buf, view, readingRecord: record, mobile: true,
    conn: { isConnected: true }, aidNavigation: { active: false }, longPush: { busy: false },
    _setTermSizeNow: vi.fn((cols, rows) => {
      events.push('resize');
      buf.cols = cols;
      buf.rows = rows;
    }),
    _applyMobileGeometry: vi.fn(() => events.push('geometry')),
  };
  const reader = core.easyReading = Object.assign(Object.create(EasyReading.prototype), {
    _core: core, _termBuf: buf, _view: view,
    _enabled: true, _functionMode: false, _reverse: null,
    _inFlightSig: null, _inFlightKeys: null, _inFlightSentAt: null,
    _pageDownRetries: 0, sendCommandAfterUpdate: '',
    _clearWatchdog: vi.fn(), _armWatchdog: vi.fn(), _send: vi.fn(() => true), onWireIdle: vi.fn(),
    _advanceScrollRestore: vi.fn(() => events.push('restore')),
    exitEasyReading: vi.fn(() => { reader._enabled = false; events.push('native'); }),
    _forceRepaint: vi.fn(() => {
      events.push('repaint');
      const status = parseStatusRow(buf.getRowText(buf.rows - 1));
      if (status) {
        view._lastAccumulatedSig = statusSignature(status);
        view._accEndRow = status.rowIndexEnd || view._accEndRow;
      }
    }),
  });
  const queue = core.commandQueue = new CommandQueue({
    send: keys => { events.push('send'); sent.push(keys); },
  });
  const resize = core.articleResize = new ArticleResize(core);
  function paint({
    text = footer(), row = buf.rows - 1, headers,
    curX = buf.cols - 1, curY = buf.rows - 1,
    changedRows = allRows(buf.rows), facts = {},
  } = {}) {
    if (headers) headers.forEach((value, index) => rowTexts.set(index, value));
    rowTexts.set(row, text);
    buf.cur_x = curX;
    buf.cur_y = curY;
    return queue.onSettle({ changedRows, curX, curY, pageState: buf.pageState }, facts);
  }
  const leave = (options = {}) => paint({
    text: 'Article list footer', headers: ['Article list', 'Articles', 'Selected article'], curX: 0, curY: 4,
    facts: { kind: 'clean-list', boardName: 'TestBoard', curY: 4 }, ...options,
  });
  const open = (options = {}) => paint({ headers: HEADER, ...options });
  function toSeek() { leave(); open(); }
  function complete() { toSeek(); return paint(); }
  return { core, buf, view, reader, record, queue, resize, paint, leave, open, toSeek, complete, rowTexts, events, sent, article };
}

describe('Article resize ownership', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] }));
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  test.each([
    ['desktop layout', h => { h.core.mobile = false; }],
    ['disconnected', h => { h.core.conn.isConnected = false; }],
    ['easy reading disabled', h => { h.reader._enabled = false; }],
    ['native input mode', h => { h.reader._functionMode = true; }],
    ['no accumulated article', h => { h.buf.pageLines = []; }],
    ['unknown article board', h => { h.view._articleBoard = null; }],
    ['stacked Back handoff', h => { h.core.articleGestures = { stack: { handingOff: true } }; }],
    ['no command queue', h => { h.core.commandQueue = null; }],
  ])('declines ownership when %s', (_name, arrange) => {
    const h = makeReader();
    arrange(h);
    expect(h.resize.request(80, 40)).toBe(false);
    expect(h.record.begin).not.toHaveBeenCalled();
    expect(h.core._setTermSizeNow).not.toHaveBeenCalled();
    expect(h.sent).toEqual([]);
  });

  test('coordinates through the reader resize interface while an eligible article waits', () => {
    const h = makeReader();
    const reader = h.core.easyReading = {
      resizeContext: h.reader.resizeContext.bind(h.reader),
      yieldForResize: vi.fn(() => h.reader.yieldForResize()),
      finishResize: vi.fn(outcome => h.reader.finishResize(outcome)),
      onWireIdle: h.reader.onWireIdle,
      _advanceScrollRestore: h.reader._advanceScrollRestore,
    };
    h.reader._reverse = {};
    expect(h.resize.request(80, 40)).toBe(true);
    expect(h.resize.pending).toEqual({ cols: 80, rows: 40 });
    expect(h.sent).toEqual([]);
    expect(reader.yieldForResize).not.toHaveBeenCalled();
    h.reader._reverse = null;
    h.resize.pump();
    expect(reader.yieldForResize).toHaveBeenCalledTimes(1);
    expect(h.sent).toEqual([LEAVE]);
    h.complete();
    expect(reader.finishResize).toHaveBeenCalledExactlyOnceWith('done');
    expect(h.reader._forceRepaint).toHaveBeenCalledTimes(1);
    expect(h.resize.active).toBe(false);
  });

  test('resizes before leaving, verifies the same article, then seeks the retained frontier', () => {
    const h = makeReader();
    expect(h.resize.request(80, 40)).toBe(true);
    expect(h.events).toEqual(['begin', 'resize', 'geometry', 'redraw', 'send']);
    expect(h.sent).toEqual([LEAVE]);
    expect(h.core._setTermSizeNow).toHaveBeenCalledWith(80, 40);
    expect(h.record.begin).toHaveBeenCalledWith('article-resize');
    expect(h.resize.articleRecord).toEqual({ easy: true, lineIndex: 12.25 });
    expect(h.leave()).toBe('done');
    expect(h.sent).toEqual([LEAVE, '\r\f']);
    expect(h.open()).toBe('done');
    expect(h.sent).toEqual([LEAVE, '\r\f', ':23\r\f']);
    expect(h.resize.active).toBe(true);
    expect(h.buf.easyReadingResizeInFlight).toBe(true);
    expect(h.buf.pageLines).toBe(h.article);
    expect(h.view.mainDisplay.scrollTop).toBe(480);
    expect(h.record.end).not.toHaveBeenCalled();
    expect(h.paint()).toBe('done');
    expect(h.events.slice(-3)).toEqual(['repaint', 'end', 'restore']);
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'done');
    expect(h.reader._advanceScrollRestore).toHaveBeenCalledTimes(1);
    expect(h.reader.exitEasyReading).not.toHaveBeenCalled();
    expect(h.resize.active).toBe(false);
    expect(h.buf.easyReadingResizeInFlight).toBe(false);
    expect(h.queue.idle).toBe(true);
    expect(h.reader.onWireIdle).toHaveBeenCalledWith({ force: true });
  });

  test('a differential terminal completes resizing without falling back to native', () => {
    const h = makeReader();
    h.resize.request(80, 40);
    // pfterm omits unchanged rows unless the command also asks redrawwin.
    // These otherwise valid responses retain common blank rows on screen.
    for (const [index, paint] of [h.leave, h.open, h.paint].entries()) {
      if (h.sent.length <= index) break;
      paint({ changedRows: h.sent[index].endsWith('\f') ? allRows(40) : new Set([0, 1, 2, 4, 39]) });
    }
    vi.advanceTimersByTime(6000);
    expect(h.reader.exitEasyReading).not.toHaveBeenCalled();
    expect(h.resize.active).toBe(false);
    expect(h.queue.idle).toBe(true);
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'done');
  });

  test('coalesces pending sizes without touching another queue owner or its successor', () => {
    const h = makeReader();
    h.queue.enqueue({ kind: 'article-refresh', keys: 'A', expect: () => true });
    h.queue.enqueue({ kind: 'aid-open', keys: 'B', expect: () => true });
    expect(h.resize.request(80, 40)).toBe(true);
    expect(h.resize.request(80, 32)).toBe(true);
    expect(h.resize.active).toBe(false);
    expect(h.buf.easyReadingResizeInFlight).toBe(false);
    expect(h.record.begin).not.toHaveBeenCalled();
    h.queue.onSettle({}, {});
    h.resize.pump();
    expect(h.sent).toEqual(['A', 'B']);
    h.queue.onSettle({}, {});
    h.resize.pump();
    expect(h.sent).toEqual(['A', 'B', LEAVE]);
    expect(h.core._setTermSizeNow).toHaveBeenCalledExactlyOnceWith(80, 32);
  });

  test('returning to the current size cancels only an unsent request', () => {
    const h = makeReader();
    h.core.aidNavigation.active = true;
    h.resize.request(80, 40);
    expect(h.resize.request(80, 24)).toBe(false);
    h.core.aidNavigation.active = false;
    h.resize.pump();
    expect(h.sent).toEqual([]);
    expect(h.record.begin).not.toHaveBeenCalled();
  });

  test('coalesces active requests and starts only the latest size after all current phases', () => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.resize.request(80, 32);
    h.resize.request(80, 28);
    expect(h.sent).toEqual([LEAVE]);
    h.complete();
    expect(h.resize.active).toBe(true);
    expect(h.sent).toEqual([LEAVE, '\r\f', ':23\r\f', LEAVE]);
    expect(h.core._setTermSizeNow.mock.calls).toEqual([[80, 40], [80, 28]]);
    expect(h.record.end).toHaveBeenCalledTimes(1);
    expect(h.reader.onWireIdle).not.toHaveBeenCalled();
    h.complete();
    expect(h.resize.active).toBe(false);
    expect(h.record.end).toHaveBeenCalledTimes(2);
    expect(h.reader.onWireIdle).toHaveBeenCalledWith({ force: true });
  });

  test('a request matching the active size removes a superseded follow-up', () => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.resize.request(80, 32);
    h.resize.request(80, 40);
    h.complete();
    expect(h.resize.active).toBe(false);
    expect(h.sent).toEqual([LEAVE, '\r\f', ':23\r\f']);
    expect(h.record.begin).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['AID navigation', h => { h.core.aidNavigation.active = true; }, h => { h.core.aidNavigation.active = false; }],
    ['long comment input', h => { h.core.longPush.busy = true; }, h => { h.core.longPush.busy = false; }],
    ['reverse reading', h => { h.reader._reverse = {}; }, h => { h.reader._reverse = null; }],
  ])('defers an unsent resize during %s', (_name, acquire, release) => {
    const h = makeReader();
    acquire(h);
    expect(h.resize.request(80, 40)).toBe(true);
    expect(h.sent).toEqual([]);
    expect(h.buf.rows).toBe(24);
    expect(h.record.begin).not.toHaveBeenCalled();
    release(h);
    h.resize.pump();
    expect(h.sent).toEqual([LEAVE]);
  });

  test('lets reverse reading finish while its resize request is pending', () => {
    const h = makeReader();
    h.reader._reverse = {};
    h.reader._maybeSendReverse = vi.fn(() => 'send');
    h.resize.request(80, 40);
    expect(h.reader._maybeSendPageDown(null, false)).toBe('send');
    expect(h.reader._maybeSendReverse).toHaveBeenCalledWith(false);
    expect(h.sent).toEqual([]);
  });

  test('waits for an existing automatic PageDown response and its accumulation frontier', () => {
    const h = makeReader();
    h.reader._inFlightSig = '1~23';
    h.reader._inFlightKeys = PAGE_DOWN;
    h.reader._inFlightSentAt = Date.now();
    h.reader.sendCommandAfterUpdate = PAGE_DOWN;
    h.resize.request(80, 40);
    expect(h.sent).toEqual([]);
    expect(h.reader._clearWatchdog).not.toHaveBeenCalled();
    h.rowTexts.set(23, footer(24, 46, 70));
    h.resize.pump();
    expect(h.sent).toEqual([]);
    h.view._lastAccumulatedSig = '24~46';
    h.view._accEndRow = 46;
    h.resize.pump();
    expect(h.sent).toEqual([LEAVE]);
    h.toSeek();
    expect(h.sent).toEqual([LEAVE, '\r\f', ':46\r\f']);
    expect(h.reader._clearWatchdog).toHaveBeenCalledTimes(1);
    expect(h.reader._inFlightSig).toBeNull();
    expect(h.reader._inFlightKeys).toBeNull();
    expect(h.reader.sendCommandAfterUpdate).toBe('');
  });

  test('a pending resize prevents a new PageDown before its response was accumulated', () => {
    const h = makeReader();
    h.reader._inFlightSig = '1~23';
    h.reader._inFlightKeys = PAGE_DOWN;
    h.reader._inFlightSentAt = Date.now();
    h.resize.request(80, 40);
    h.rowTexts.set(23, footer(24, 46, 70));
    expect(h.reader._maybeSendPageDown(PAGE_DOWN)).toBe('blocked');
    expect(h.reader._send).not.toHaveBeenCalled();
    expect(h.reader._inFlightSig).toBe('1~23');
    expect(h.sent).toEqual([]);
  });

  test('a pending resize permits recovery of an existing unanswered PageDown', () => {
    const h = makeReader();
    h.reader._inFlightSig = '1~23';
    h.reader._inFlightKeys = PAGE_DOWN;
    h.reader._inFlightSentAt = Date.now();
    h.resize.request(80, 40);
    vi.advanceTimersByTime(PAGE_DOWN_GRACE_MS + 1);
    expect(h.reader._maybeSendPageDown(PAGE_DOWN, true)).toBe('retry');
    expect(h.reader._send).toHaveBeenCalledExactlyOnceWith(PAGE_DOWN);
    expect(h.reader._pageDownRetries).toBe(1);
    expect(h.resize.active).toBe(false);
  });

  test('an exhausted PageDown recovery releases ownership so a pending resize can start', () => {
    const h = makeReader();
    h.reader._inFlightSig = '1~23';
    h.reader._inFlightKeys = PAGE_DOWN;
    h.reader._inFlightSentAt = Date.now();
    h.reader._pageDownRetries = PAGE_DOWN_MAX_RETRIES;
    h.resize.request(80, 40);
    vi.advanceTimersByTime(PAGE_DOWN_GRACE_MS + 1);
    expect(h.reader._maybeSendPageDown(PAGE_DOWN, true)).toBe('giveup');
    h.resize.pump();
    expect(h.sent).toEqual([LEAVE]);
    expect(h.reader._send).not.toHaveBeenCalled();
    expect(h.resize.active).toBe(true);
  });

  test('waits for an article footer and parked cursor before capturing a bookmark', () => {
    const h = makeReader();
    h.rowTexts.set(23, '跳至此行: ');
    h.resize.request(80, 40);
    expect(h.record.begin).not.toHaveBeenCalled();
    h.rowTexts.set(23, footer());
    h.buf.cur_x = 12;
    h.resize.pump();
    expect(h.sent).toEqual([]);
    h.buf.cur_x = 79;
    h.buf.cur_y = 22;
    h.resize.pump();
    expect(h.sent).toEqual([]);
    h.buf.cur_y = 23;
    h.resize.pump();
    expect(h.sent).toEqual([LEAVE]);
  });

  test('drops an unsent request if article easy reading ends before the wire is free', () => {
    const h = makeReader();
    h.core.longPush.busy = true;
    h.resize.request(80, 40);
    h.reader._enabled = false;
    h.core.longPush.busy = false;
    h.resize.pump();
    h.reader._enabled = true;
    h.resize.pump();
    expect(h.sent).toEqual([]);
    expect(h.record.begin).not.toHaveBeenCalled();
  });

  test('a stored NAWS article repaint at the old footer cannot acknowledge leaving', () => {
    const h = makeReader();
    h.resize.request(80, 40);
    expect(h.paint({ row: 23 })).toBeNull();
    expect(h.paint()).toBeNull();
    expect(h.sent).toEqual([LEAVE]);
    expect(h.record.end).not.toHaveBeenCalled();
    h.leave();
    expect(h.sent).toEqual([LEAVE, '\r\f']);
  });

  test.each([
    ['an unrecognized list', { kind: 'transient', boardName: 'TestBoard', curY: 4 }],
    ['another board', { kind: 'clean-list', boardName: 'OtherBoard', curY: 4 }],
    ['a missing board', { kind: 'clean-list', boardName: null, curY: 4 }],
    ['a cursor in the header', { kind: 'clean-list', boardName: 'TestBoard', curY: 2 }],
    ['a cursor in the footer', { kind: 'clean-list', boardName: 'TestBoard', curY: 39 }],
  ])('does not reopen on %s', (_name, facts) => {
    const h = makeReader();
    h.resize.request(80, 40);
    expect(h.leave({ facts })).toBeNull();
    expect(h.sent).toEqual([LEAVE]);
    expect(h.record.end).not.toHaveBeenCalled();
  });

  test.each([0, 1, 2])('fails before seeking when reopened header row %i belongs to another article', row => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.leave();
    const headers = [...HEADER];
    headers[row] += ' changed';
    h.open({ headers });
    expect(h.sent).toEqual([LEAVE, '\r\f']);
    expect(h.resize.active).toBe(false);
    expect(h.reader.exitEasyReading).toHaveBeenCalledTimes(1);
    expect(h.reader._forceRepaint).not.toHaveBeenCalled();
    expect(h.reader._advanceScrollRestore).not.toHaveBeenCalled();
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'fail');
  });

  test('does not accept an interior article page as the reopen response', () => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.leave();
    expect(h.open({ text: footer(24, 62, 70) })).toBeNull();
    expect(h.sent).toEqual([LEAVE, '\r\f']);
    expect(h.open({ headers: HEADER.map(text => text + '   ') })).toBe('done');
    expect(h.sent).toEqual([LEAVE, '\r\f', ':23\r\f']);
  });

  test('failure ends ownership once when returning to native PTT view recursively cancels resizing', () => {
    const h = makeReader();
    h.reader.exitEasyReading.mockImplementation(() => {
      h.reader._enabled = false;
      h.resize.cancel();
    });
    h.resize.request(80, 40);
    h.leave();
    h.open({ headers: [HEADER[0], 'Title: A different article', HEADER[2]] });
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'fail');
    expect(h.reader.exitEasyReading).toHaveBeenCalledTimes(1);
    expect(h.reader.onWireIdle).toHaveBeenCalledExactlyOnceWith({ force: true });
    expect(h.resize.active).toBe(false);
    expect(h.buf.easyReadingResizeInFlight).toBe(false);
    expect(h.queue.idle).toBe(true);
    expect(h.sent).toEqual([LEAVE, '\r\f']);
    vi.advanceTimersByTime(7000);
    expect(h.record.end).toHaveBeenCalledTimes(1);
    expect(h.reader.onWireIdle).toHaveBeenCalledTimes(1);
  });

  test('an unchanged short-article signature still needs a verified reopen and seek response', () => {
    const h = makeReader();
    h.rowTexts.set(23, footer(1, 23, 100));
    h.resize.request(80, 40);
    h.leave();
    h.open({ text: footer(1, 23, 100) });
    expect(h.resize.active).toBe(true);
    expect(h.paint({ text: footer(1, 23, 100) })).toBe('done');
    expect(h.buf.pageLines).toBe(h.article);
    expect(h.view.mainDisplay.scrollTop).toBe(480);
    expect(h.reader.exitEasyReading).not.toHaveBeenCalled();
  });

  test.each([
    ['a footer-only patch', h => ({ changedRows: new Set([h.buf.rows - 1]) })],
    ['a cursor-only update', () => ({ changedRows: new Set() })],
    ['a missing row-change snapshot', () => ({ changedRows: null })],
    ['an incomplete cursor column', h => ({ curX: h.buf.cols - 2 })],
    ['a cursor above the new footer', h => ({ curY: h.buf.rows - 2 })],
    ['a goto prompt', () => ({ text: '跳至此行: ' })],
    ['a range excluding the frontier', () => ({ text: footer(60, 98, 90) })],
  ])('does not finish seeking on %s', (_name, response) => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.toSeek();
    expect(h.paint(response(h))).toBeNull();
    expect(h.resize.active).toBe(true);
    expect(h.buf.easyReadingResizeInFlight).toBe(true);
    expect(h.record.end).not.toHaveBeenCalled();
    expect(h.reader.onWireIdle).not.toHaveBeenCalled();
  });

  test('accepts a seek repaint split across clear/body and final footer/cursor settles', () => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.toSeek();
    expect(h.paint({ text: '', curX: 0, curY: 0 })).toBeNull();
    expect(h.paint({ changedRows: new Set([39]) })).toBe('done');
    expect(h.resize.active).toBe(false);
  });

  test('requires every resized row rather than counting stale out-of-range rows', () => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.toSeek();
    const changedRows = allRows(40);
    changedRows.delete(10);
    changedRows.add(40);
    expect(h.paint({ changedRows })).toBeNull();
    expect(h.paint({ changedRows: new Set([10]) })).toBe('done');
  });

  test('full-row coverage never carries from leave to reopen or reopen to seek', () => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.leave();
    expect(h.open({ changedRows: new Set([39]) })).toBeNull();
    expect(h.sent).toEqual([LEAVE, '\r\f']);
    h.open();
    expect(h.paint({ changedRows: new Set([39]) })).toBeNull();
    expect(h.record.end).not.toHaveBeenCalled();
    expect(h.paint()).toBe('done');
  });

  test.each([
    ['old-style footer', '  瀏覽 P.1( 45%)  '],
    ['content-warning footer', '  瀏覽 第 1/3 頁 ( 45%)  ▲此頁內容含移位碼'],
  ])('accepts a complete seek with %s when its range is unavailable', (_name, text) => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.toSeek();
    expect(h.paint({ text })).toBe('done');
    expect(h.resize.active).toBe(false);
  });

  test('shares one six-second deadline across all phases despite partial replies', () => {
    const h = makeReader();
    h.resize.request(80, 40);
    h.resize.request(80, 32);
    vi.advanceTimersByTime(2000);
    h.leave();
    vi.advanceTimersByTime(2000);
    h.open();
    vi.advanceTimersByTime(1000);
    h.paint({ changedRows: new Set([39]) });
    vi.advanceTimersByTime(999);
    expect(h.resize.active).toBe(true);
    vi.advanceTimersByTime(1);
    expect(h.resize.active).toBe(false);
    expect(h.buf.easyReadingResizeInFlight).toBe(false);
    expect(h.queue.idle).toBe(true);
    expect(h.sent).toEqual([LEAVE, '\r\f', ':23\r\f']);
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'fail');
    expect(h.reader.exitEasyReading).toHaveBeenCalledTimes(1);
    expect(h.reader._forceRepaint).not.toHaveBeenCalled();
    expect(h.reader._advanceScrollRestore).not.toHaveBeenCalled();
    expect(h.view.flashListHint).toHaveBeenCalledTimes(1);
    h.resize.pump();
    expect(h.sent).toHaveLength(3);
  });

  test.each(['leave', 'open', 'seek'])('canceling during %s clears only its command and bookmark', phase => {
    const h = makeReader();
    h.resize.request(80, 40);
    if (phase !== 'leave') h.leave();
    if (phase === 'seek') h.open();
    h.resize.request(80, 32);
    const before = [...h.sent];
    const nextDone = vi.fn();
    h.queue.enqueue({ kind: 'aid-open', keys: 'B', expect: () => true, onDone: nextDone });
    h.resize.cancel();
    expect(h.resize.active).toBe(false);
    expect(h.buf.easyReadingResizeInFlight).toBe(false);
    expect(h.sent).toEqual([...before, 'B']);
    expect(h.queue.inFlightKind).toBe('aid-open');
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'cancel');
    expect(h.reader.exitEasyReading).not.toHaveBeenCalled();
    expect(h.reader._forceRepaint).not.toHaveBeenCalled();
    expect(h.reader.onWireIdle).not.toHaveBeenCalled();
    h.queue.onSettle({}, {});
    expect(nextDone).toHaveBeenCalledTimes(1);
    h.resize.cancel();
    vi.advanceTimersByTime(7000);
    expect(h.record.end).toHaveBeenCalledTimes(1);
    expect(h.view.flashListHint).not.toHaveBeenCalled();
  });

  test('canceling an unsent resize preserves another owner and its queued work', () => {
    const h = makeReader();
    h.queue.enqueue({ kind: 'article-refresh', keys: 'A', expect: () => true });
    h.queue.enqueue({ kind: 'aid-open', keys: 'B', expect: () => true });
    h.resize.request(80, 40);
    h.resize.cancel();
    expect(h.queue.inFlightKind).toBe('article-refresh');
    h.queue.onSettle({}, {});
    expect(h.sent).toEqual(['A', 'B']);
    expect(h.record.begin).not.toHaveBeenCalled();
  });

  test.each(['leave', 'open', 'seek'])('an external flush during %s ends ownership exactly once', phase => {
    const h = makeReader();
    h.resize.request(80, 40);
    if (phase !== 'leave') h.leave();
    if (phase === 'seek') h.open();
    h.resize.request(80, 32);
    const before = [...h.sent];
    h.queue.flush();
    expect(h.resize.active).toBe(false);
    expect(h.buf.easyReadingResizeInFlight).toBe(false);
    expect(h.resize.articleRecord).toBeNull();
    expect(h.record.end).toHaveBeenCalledExactlyOnceWith(h.record.begin.mock.results[0].value, 'cancel');
    expect(h.reader.exitEasyReading).toHaveBeenCalledTimes(1);
    expect(h.reader._forceRepaint).not.toHaveBeenCalled();
    expect(h.reader.onWireIdle).toHaveBeenCalledWith({ force: true });
    h.resize.cancel();
    h.queue.flush();
    vi.advanceTimersByTime(7000);
    expect(h.record.end).toHaveBeenCalledTimes(1);
    expect(h.sent).toEqual(before);
    expect(h.view.flashListHint).not.toHaveBeenCalled();
  });
});
