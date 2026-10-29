// @unit-env browser
import { App } from '../../src/js/pttchrome';
import { TermBuf } from '../../src/js/term_buf';
import { TermView } from '../../src/js/term_view';
import { EasyReading } from '../../src/js/easy_reading';
import { ArticleResize } from '../../src/js/article_resize';
import { CommandQueue } from '../../src/js/command_queue';
import { AnsiParser } from '../../src/js/ansi_parser';
import { Event as AppEvent } from '../../src/js/event';
import { u2b } from '../../src/js/string_util';
import { mobileRowsHeight, mobileTermGeometry } from '../../src/js/mobile_layout';
import { loadBig5Tables } from './helpers/load_big5_tables';

// Connection alerts are outside the terminal lifecycle under test.
vi.mock('../../src/js/react_root', () => ({ renderInto: vi.fn(), unmountFrom: vi.fn() }));

const PORTRAIT = { width: 412, height: 896 };
const LANDSCAPE = { width: 896, height: 412 };
const PAGE_DOWN = '\x1b[6~';
const geometry = bounds => mobileTermGeometry({
  ...bounds, height: mobileRowsHeight(bounds.height), dpr: 1, surface: 'article', fontPx: 16,
});

function connection() {
  return Object.assign(new AppEvent(), {
    isConnected: true, send: vi.fn(), sendNaws: vi.fn(), sendWillNaws: vi.fn(),
    setWireCharset(value) { this.wireCharset = value; },
  });
}

function makeReader() {
  const app = Object.assign(Object.create(App.prototype), {
    mobile: true, mobileLayoutMode: 'on', mobileFontPx: 16, appFocused: true,
    inputArea: document.createElement('input'),
    connectedUrl: { url: 'wsstelnet://example.test/bbs', opened: true, easyReadingSupported: true },
    _readSafeInsets: () => ({}), updateTabIcon: vi.fn(), cancelMbTimer: vi.fn(),
    autoLogin: { start: vi.fn() }, logout: { onConnectionClosed: () => false },
    reconnectResume: { capture: vi.fn() },
    listSession: { disable: vi.fn() }, boardListSession: { disable: vi.fn() },
    aidNavigation: { active: false, reset: vi.fn() },
    articleShortcutSearch: { reset: vi.fn() }, helpMenu: { reset: vi.fn() },
    boardNoteSkip: { noteRecv: vi.fn(), reset: vi.fn() },
    longPush: { busy: false, disarm: vi.fn() }, deepLinkController: { reset: vi.fn() },
    messageInbox: { noteData: vi.fn(), reset: vi.fn() },
  });
  let bounds = PORTRAIT;
  app.getWindowInnerBounds = () => bounds;
  const buf = app.buf = new TermBuf(80, geometry(bounds).rows);
  buf.useMouseBrowsing = false;
  const parser = app.parser = new AnsiParser(buf);
  const screenRoot = document.createElement('div');
  const display = document.createElement('div');
  display.appendChild(screenRoot);
  document.body.appendChild(display);
  const view = app.view = Object.assign(Object.create(TermView.prototype), {
    buf, bbscore: app, screenRoot, mainDisplay: display,
    mainContainer: document.createElement('div'), lastRowDiv: document.createElement('div'),
    bbsCursor: document.createElement('div'),
    innerBounds: bounds, mobileSurface: 'article', _wantSurface: 'article', reflow: true,
    charset: 'big5', chh: 16, chw: 8, _gridRender: false, _articleInstanceId: 0,
    fixedResize: vi.fn(function(chh) { this.chh = chh; this.chw = chh / 2; }),
    updateCursorPos: vi.fn(), applyCursorHighlight: vi.fn(), flashListHint: vi.fn(),
    _mirrorStatusRowToFooter: vi.fn(),
  });
  const articleBytes = (percent = 45) => {
    const end = buf.rows - 1;
    const footer = `  瀏覽 第 1/3 頁 (${percent}%)  目前顯示: 第 1~${end} 行  (h)說明`;
    return u2b('\x1b[2J\x1b[H作者 reader (Reader) 看板 Test\r\n' +
      '標題 Retained article\r\n時間 Thu Jan 1 00:00:00 2026' +
      `\x1b[${buf.rows};1H${footer}\x1b[${buf.rows};80H`);
  };
  // Seed the existing article before subscribing to incoming lifecycle events.
  buf.setView({
    charset: 'big5', update() {}, updateCursorPos() {}, refreshCursorVisibility() {},
  });
  parser.feed(articleBytes());
  buf.notify();
  buf.syncSettledPageState();
  buf.setView(view);
  const reader = app.easyReading = new EasyReading(app, view, buf);
  reader._enabled = true;
  reader.startedEasyReading = true;
  app.commandQueue = new CommandQueue({ send: keys => app.conn.send(keys) });
  app.articleResize = new ArticleResize(app);
  const conn = connection();
  app._attachConn(conn);
  app.applyTermSize();
  view.mainContainer = view.componentScreen.container;
  expect(reader._maybeSendPageDown(PAGE_DOWN)).toBe('send');
  expect(conn.send).toHaveBeenCalledExactlyOnceWith(PAGE_DOWN);
  expect(conn.sendNaws).not.toHaveBeenCalled();

  // real-input: tests/e2e/offline/mobile_article_rotation.offline.spec.js
  const rotate = () => {
    bounds = LANDSCAPE;
    app.onWindowResize({ immediate: true });
    expect(app.articleResize.pending).toEqual({ cols: 80, rows: geometry(bounds).rows });
    expect(app.articleResize.active).toBe(false);
    expect(buf.rows).toBe(geometry(PORTRAIT).rows);
    expect(conn.sendNaws).not.toHaveBeenCalled();
  };
  return {
    app, buf, view, reader, conn, rotate,
    articleBytes,
    dispose() {
      app.timerEverySec?.cancel();
      view.componentScreen?.destroy();
      display.remove();
      document.body.classList.remove('mobile-layout');
    },
  };
}

describe('Mobile resize recovery after dropping a pending article resize', () => {
  let h;
  beforeAll(loadBig5Tables);
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    h?.dispose();
    h = null;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('cancel sends no NAWS and function-mode rendering recovers the current viewport', () => {
    h = makeReader();
    h.rotate();
    const cancel = h.app.articleResize.cancel.bind(h.app.articleResize);
    vi.spyOn(h.app.articleResize, 'cancel').mockImplementation(() => {
      const before = h.conn.sendNaws.mock.calls.length;
      cancel();
      expect(h.conn.sendNaws.mock.calls.length).toBe(before);
    });

    h.reader._enterFunctionMode();
    expect(h.app.articleResize.cancel).toHaveBeenCalledTimes(1);
    expect(h.app.articleResize.pending).toBeNull();
    expect(h.reader._functionMode).toBe(true);
    // Entry's native-grid repaint already reconciles the changed viewport.
    expect(h.view.mobileSurface).toBe('grid');
    expect(h.buf.rows).toBe(geometry(LANDSCAPE).rows);
    expect(h.conn.sendNaws).toHaveBeenCalledExactlyOnceWith(80, geometry(LANDSCAPE).rows);

    const reconcile = vi.spyOn(h.app, '_applyMobileGeometry');
    h.app.onData(h.articleBytes(100));
    vi.advanceTimersByTime(100);
    expect(h.reader._functionMode).toBe(false);
    expect(h.view.mobileSurface).toBe('article');
    expect(reconcile).toHaveBeenCalledWith('article');
    expect(h.buf.rows).toBe(geometry(LANDSCAPE).rows);
    expect(h.conn.sendNaws).toHaveBeenCalledTimes(1);
  });

  test('disconnect cancellation sends no NAWS and the first reconnect screen corrects negotiated rows', () => {
    h = makeReader();
    h.rotate();
    h.conn.dispatchEvent(new CustomEvent('close'));
    expect(h.app.articleResize.pending).toBeNull();
    expect(h.conn.sendNaws).not.toHaveBeenCalled();
    expect(h.buf.rows).toBe(geometry(PORTRAIT).rows);

    const next = connection();
    next.isConnected = false;
    h.app._attachConn(next);
    next.dispatchEvent(new CustomEvent('open'));
    expect(next.isConnected).toBe(true);
    expect(next.sendNaws).not.toHaveBeenCalled();
    next.dispatchEvent(new CustomEvent('doNaws'));
    expect(next.sendWillNaws).toHaveBeenCalledTimes(1);
    expect(next.sendNaws).toHaveBeenCalledExactlyOnceWith(80, geometry(PORTRAIT).rows);

    const reconcile = vi.spyOn(h.app, '_applyMobileGeometry');
    next.dispatchEvent(new CustomEvent('data', {
      detail: { data: '\x1b[2J\x1b[HLogin\x1b[3;1HPlease enter your ID: ' },
    }));
    vi.advanceTimersByTime(100);
    expect(reconcile).toHaveBeenCalledWith('grid');
    expect(h.view.mobileSurface).toBe('grid');
    expect(h.buf.rows).toBe(geometry(LANDSCAPE).rows);
    expect(next.sendNaws).toHaveBeenLastCalledWith(80, geometry(LANDSCAPE).rows);
    expect(next.sendNaws).toHaveBeenCalledTimes(2);
  });
});
