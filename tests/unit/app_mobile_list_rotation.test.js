// @unit-env browser
import { App } from '../../src/js/pttchrome';
import { ListResize } from '../../src/js/list_resize';
import { NavigationStack } from '../../src/js/navigation_stack';
import { TermBuf } from '../../src/js/term_buf';
import { ListSession } from '../../src/js/list_session';
import { CommandQueue } from '../../src/js/command_queue';
import { ReadingRecord } from '../../src/js/reading_record';
import { AnsiParser } from '../../src/js/ansi_parser';
import { u2b } from '../../src/js/string_util';
import { internRow } from '../../src/js/term_char_intern';
import { mobileRowsHeight, mobileTermGeometry } from '../../src/js/mobile_layout';
import { loadBig5Tables } from './helpers/load_big5_tables';

const PORTRAIT = { width: 412, height: 896 };
const LANDSCAPE = { width: 896, height: 412 };

function geometry(bounds) {
  return mobileTermGeometry({
    ...bounds, height: mobileRowsHeight(bounds.height),
    dpr: 1, surface: 'list', fontPx: 16,
  });
}

function listScreen(rows, mode) {
  const texts = Array(rows).fill('');
  texts[0] = '【板主：test】看板《Test》';
  texts[1] = '[←]離開 [→]閱讀 [^P]發表文章';
  texts[2] = '   編號    日 期 作  者       文  章  標  題';
  for (let row = 3; row < rows - 1; row++) {
    const num = 100 + row - 3;
    texts[row] = `${String(num).padStart(7)}     9/01 reader       □ [Test] Article ${num}`;
  }
  texts[rows - 1] = ` ${mode === 'select' ? '系列文章' : '文章列表'} (y)回應(X)推文(^X)轉錄`;
  return texts;
}

function repaint(parser, texts, rows, cursorRow = 3) {
  let bytes = '\x1b[2J\x1b[H';
  for (let row = 0; row < Math.min(rows, texts.length); row++) {
    if (!texts[row]) continue;
    bytes += `\x1b[${row + 1};1H`;
    if (row === 0 || row === 2) bytes += '\x1b[30;47m' + ' '.repeat(80) + '\r';
    bytes += texts[row] + '\x1b[m';
  }
  parser.feed(u2b(bytes + `\x1b[${cursorRow + 1};1H`));
  vi.advanceTimersByTime(100);
}

function makeReader(bounds, mode) {
  const app = Object.create(App.prototype);
  app.mobile = true;
  app.mobileFontPx = 16;
  app._readSafeInsets = () => ({});
  app.conn = { isConnected: true, sendNaws: vi.fn(), send: vi.fn() };
  const buf = app.buf = new TermBuf(80, geometry(bounds).rows);
  buf.useMouseBrowsing = false;
  const view = app.view = {
    buf, innerBounds: bounds, mobileSurface: 'list', _wantSurface: 'list',
    charset: 'big5', blinkOn: false, chh: 16, listCards: true,
    blacklist: new Set(), titleBlacklist: [],
    mainDisplay: { scrollTop: 0 },
    update() {}, updateCursorPos() {}, refreshCursorVisibility() {},
    fixedResize: vi.fn(), showCursor: vi.fn(), hideCursor: vi.fn(),
    flashListHint: vi.fn(), setListLoading: vi.fn(), resetListAccumulation: vi.fn(),
    setMobileSurface(surface) { this.mobileSurface = surface; },
  };
  buf.setView(view);
  const parser = new AnsiParser(buf);
  const screen = listScreen(buf.rows, mode);
  repaint(parser, screen, buf.rows);

  app.easyReading = { _enabled: false, _functionMode: false };
  app.readingRecord = new ReadingRecord(app);
  app.commandQueue = new CommandQueue({ send: keys => app.conn.send(keys) });
  const list = app.listSession = new ListSession(app, view, buf, app.commandQueue);
  app.listResize = new ListResize(app);
  // Begin with an already accumulated article list. Rendering and background
  // fill are outside this reproduction; screen recognition and transitions run
  // through the real parser, buffer, session and geometry application.
  buf.listLines = buf.lines.slice(3, -1).map(internRow);
  buf.listLineNums = buf.listLines.map((_line, index) => 100 + index);
  list.state = 'active';
  list._renderMode = 'buffer';
  list._boardName = 'Test';
  list._selectMode = mode === 'select';
  list._selectedNum = 106;
  list._serverNum = 100;
  list._topNum = 104;
  list._scrollFrac = 4.5;
  expect(list._collectFacts(null).kind).toBe('clean-list');
  expect(buf.listRenderMode).toBe('buffer');
  return { app, buf, view, parser, list, screen };
}

describe('Mobile article-list rotation', () => {
  beforeAll(loadBig5Tables);
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  test('a completed stacked Back starts the deferred list resize', () => {
    const { app, list } = makeReader(PORTRAIT, 'plain');
    const stack = new NavigationStack(app);
    app.articleGestures = { stack };
    stack.stack.pages = [
      { kind: 'articleList', board: 'Test' },
      { kind: 'article', board: 'Test', id: 'source' },
    ];
    stack.handoff = { listeners: [], finish: vi.fn(), layer: null };
    app.listResize.request(80, geometry(LANDSCAPE).rows);
    expect(app.listResize.active).toBe(false);
    expect(list._renderMode).toBe('buffer');
    stack._end('presented');
    expect(stack.handingOff).toBe(false);
    expect(stack.stack.pages).toEqual([{ kind: 'articleList', board: 'Test', layer: false }]);
    expect(app.listResize.active).toBe(true);
    expect(app.commandQueue.inFlightKind).toBe('list-resize');
  });

  test('temporary resize screens do not replace the stacked page identity', () => {
    const { app, buf, view } = makeReader(PORTRAIT, 'select');
    const stack = new NavigationStack(app);
    const pages = [{ kind: 'articleList', board: 'Test', results: true }];
    stack.stack.pages = pages;
    app.listResize.request(80, geometry(LANDSCAPE).rows);
    // An unexpected intermediate article is not the resize's verified result.
    buf.pageState = 3;
    view._articleBoard = 'Test';
    app.easyReading._articleKey = 'temporary';
    stack.update();
    expect(stack.stack.pages).toBe(pages);
  });

  for (const mode of ['plain', 'select']) {
    test.each([
      ['portrait to landscape', PORTRAIT, LANDSCAPE],
      ['landscape to portrait', LANDSCAPE, PORTRAIT],
    ])(`${mode} list %s retains easy reading and its reading position`, (_name, from, to) => {
      const { app, buf, view, parser, list, screen } = makeReader(from, mode);
      const position = list.readingPosition();
      const content = buf.listLines.slice();
      expect(geometry(from).rows).not.toBe(geometry(to).rows);

      view.innerBounds = to;
      app._applyMobileGeometry('list');
      // NAWS redraws the stored screen at the new terminal size. It does not
      // move the old list footer to the new bottom row or rebuild read.c's page.
      repaint(parser, screen, buf.rows);

      expect(buf.rows).toBe(geometry(to).rows);
      expect(app.conn.sendNaws).toHaveBeenCalledWith(80, geometry(to).rows);
      expect(buf.listRenderMode).not.toBe('native');
      expect(list.readingPosition()).toEqual(position);
      expect(buf.listLines).toEqual(content);
      expect(view.flashListHint).not.toHaveBeenCalled();
    });
  }

  test('the real frozen watchdog releases only the timed-out resize owner', () => {
    const { app, view, list } = makeReader(PORTRAIT, 'plain');
    view.innerBounds = LANDSCAPE;
    app._applyMobileGeometry('list');
    let nativeAtForeignSend = false;
    app.commandQueue.enqueue({
      kind: 'foreign-navigation', keys: 'B', expect: () => true,
      onSend: () => { nativeAtForeignSend = list._renderMode === 'native'; },
    });
    vi.advanceTimersByTime(6000);
    expect(app.listResize.active).toBe(false);
    expect(app.commandQueue.inFlightKind).toBe('foreign-navigation');
    expect(nativeAtForeignSend).toBe(true);
    expect(app.conn.send).toHaveBeenLastCalledWith('B');
  });

  test('disabling the list during resizing finishes in the idle state', () => {
    const { app, view, list } = makeReader(PORTRAIT, 'plain');
    view.innerBounds = LANDSCAPE;
    app._applyMobileGeometry('list');
    list._dispatch({ type: 'pref-off' }, null);
    expect(app.listResize.active).toBe(false);
    expect(list.state).toBe('idle');
    expect(list._renderMode).toBe('native');
  });

  test('a real departure still releases the article list', () => {
    const { buf, parser, list } = makeReader(PORTRAIT, 'plain');
    const menu = Array(buf.rows).fill('');
    menu[0] = '【主功能表】';
    repaint(parser, menu, buf.rows);
    expect(list.state).toBe('idle');
    expect(buf.listRenderMode).toBe('native');
  });
});
