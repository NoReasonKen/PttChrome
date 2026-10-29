// @unit-env browser
import { App } from '../../src/js/pttchrome';
import { TermBuf } from '../../src/js/term_buf';
import { TermView } from '../../src/js/term_view';
import { EasyReading } from '../../src/js/easy_reading';
import { ArticleResize } from '../../src/js/article_resize';
import { CommandQueue } from '../../src/js/command_queue';
import { AnsiParser } from '../../src/js/ansi_parser';
import { u2b, parseStatusRow, statusSignature } from '../../src/js/string_util';
import { internRow } from '../../src/js/term_char_intern';
import { rowToText } from '../../src/js/comment_parse';
import { mobileRowsHeight, mobileTermGeometry } from '../../src/js/mobile_layout';
import { loadBig5Tables } from './helpers/load_big5_tables';

const PORTRAIT = { width: 412, height: 896 };
const LANDSCAPE = { width: 896, height: 412 };

function geometry(bounds) {
  return mobileTermGeometry({
    ...bounds, height: mobileRowsHeight(bounds.height),
    dpr: 1, surface: 'article', fontPx: 16,
  });
}

function articleScreen(rows, start = 1, end = rows - 1) {
  const text = new Map([
    [0, 'Article content before rotation'],
    [4, 'The reader must keep this accumulated article.'],
    [rows - 1, `  瀏覽 第 1/1 頁 (100%)  目前顯示: 第 ${start}~${end} 行  (h)說明`],
  ]);
  return text;
}

function repaint(parser, screen, rows, cursorRow = rows - 1) {
  let bytes = '\x1b[2J\x1b[H';
  for (const [row, text] of screen) {
    if (row < rows) bytes += `\x1b[${row + 1};1H${text}`;
  }
  parser.feed(u2b(`${bytes}\x1b[${cursorRow + 1};${cursorRow === rows - 1 ? 80 : 1}H`));
  vi.advanceTimersByTime(100);
}

function makeReader(bounds) {
  const app = Object.create(App.prototype);
  app.mobile = true;
  app.mobileFontPx = 16;
  app._readSafeInsets = () => ({});
  app.conn = { isConnected: true, sendNaws: vi.fn() };
  const buf = app.buf = new TermBuf(80, geometry(bounds).rows);
  buf.useMouseBrowsing = false;
  const view = app.view = {
    buf, innerBounds: bounds, mobileSurface: 'article', _wantSurface: 'article',
    charset: 'big5', blinkOn: false,
    _articleBoard: 'Test',
    chh: 16,
    mainContainer: { style: { paddingBottom: '1em' } },
    mainDisplay: { scrollTop: 640, scrollHeight: 2000, clientHeight: 300 },
    currentLineIndex: () => 12.25,
    lastRowDiv: { style: { display: 'none' } },
    update() {}, updateCursorPos() {}, refreshCursorVisibility() {},
    fixedResize: vi.fn(),
    redraw: vi.fn(), flashListHint: vi.fn(),
    setMobileSurface(surface) { this.mobileSurface = surface; },
    hideEasyReadingOverlays: TermView.prototype.hideEasyReadingOverlays,
  };
  buf.setView(view);
  const parser = new AnsiParser(buf);
  const screen = articleScreen(buf.rows);
  repaint(parser, screen, buf.rows);
  expect(buf.pageState).toBe(3);
  buf.pageLines = buf.lines.slice(0, -1).map(internRow);
  buf.startedEasyReading = true;
  const status = parseStatusRow(buf.getRowText(buf.rows - 1, 0, buf.cols));
  view._lastAccumulatedSig = statusSignature(status);
  view._accEndRow = status.rowIndexEnd;
  const reader = Object.assign(Object.create(EasyReading.prototype), {
    _core: app, _termBuf: buf, _view: view,
    _enabled: true, _functionMode: false,
    _isJumpParkedListNow: () => false,
    _notePmorePrefScreen: () => false,
    _forceRepaint: vi.fn(),
    requestScrollRestore: vi.fn(),
    _advanceScrollRestore: vi.fn(),
  });
  app.easyReading = reader;
  app.commandQueue = new CommandQueue({ send: vi.fn() });
  app.articleResize = new ArticleResize(app);
  buf.addEventListener('screenSettled', () => {
    reader._onScreenSettled();
    app.commandQueue.onSettle(buf.settleSnapshot, {
      kind: buf.pageState === 2 ? 'clean-list' : 'article', boardName: 'Test', curY: buf.cur_y,
    });
  });
  return { app, buf, view, parser, screen };
}

describe('Mobile article rotation', () => {
  beforeAll(loadBig5Tables);
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test.each([
    ['portrait to landscape', PORTRAIT, LANDSCAPE],
    ['landscape to portrait', LANDSCAPE, PORTRAIT],
  ])('%s keeps the accumulated article during the terminal resize repaint', (_name, from, to) => {
    const { app, buf, view, parser, screen } = makeReader(from);
    const article = buf.pageLines;
    const firstLine = rowToText(article[0]);
    expect(geometry(from).rows).not.toBe(geometry(to).rows);

    view.innerBounds = to;
    app._applyMobileGeometry('article');
    // PTT term_resize redraws its stored screen. That does not move the old
    // article footer to the new bottom row or rerender the article application.
    repaint(parser, screen, buf.rows);

    expect(buf.pageLines.length).toBe(article.length);
    expect(rowToText(buf.pageLines[0])).toBe(firstLine);
    expect(view.mainDisplay.scrollTop).toBe(640);
    expect(app.articleResize.active).toBe(true);

    const reversed = value => '\x1b[30;47m' + ' '.repeat(80) + '\r' + value + '\x1b[m';
    repaint(parser, new Map([
      [0, reversed('【板主：test】看板《Test》')],
      [1, '[←]離開 [→]閱讀'], [2, reversed('編號 日 期 作 者 文 章 標 題')],
      [3, '  101 9/01 reader article'], [buf.rows - 1, ' 文章選讀 (y)回應(X)推文'],
    ]), buf.rows, 3);
    expect(app.articleResize.command.phase).toBe('open');
    repaint(parser, articleScreen(buf.rows), buf.rows);
    expect(app.articleResize.command.phase).toBe('seek');
    repaint(parser, articleScreen(buf.rows, 1, article.length), buf.rows);
    expect(app.articleResize.active).toBe(false);
    expect(buf.easyReadingResizeInFlight).toBe(false);
    expect(app.commandQueue.idle).toBe(true);
    expect(app.easyReading.requestScrollRestore).toHaveBeenCalledWith(12.25);
  });

  test('a real settled exit still clears article content and its scroll position', () => {
    const { buf, view, parser } = makeReader(PORTRAIT);
    repaint(parser, new Map([[0, 'An ordinary non-article screen']]), buf.rows);
    expect(buf.pageLines.length).toBe(0);
    expect(view.mainDisplay.scrollTop).toBe(0);
  });
});
