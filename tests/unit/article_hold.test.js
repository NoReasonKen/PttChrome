// A failed article operation holds the article (#193): the reader stays on it
// at the reading position with a message, the failure is a bug event, keys
// wait, and pull-to-refresh retries from what PTT shows.
// real-input: tests/e2e/offline/mobile_thread_jump.offline.spec.js
import { ArticleHold, LANDING_MS } from '../../src/js/article_hold';
import { HiddenArticleRoute } from '../../src/js/hidden_article_route';
import { HeaderlessReopen } from '../../src/js/headerless_reopen';
import { ScreenRefresh } from '../../src/js/screen_refresh';
import { serializedOpHint } from '../../src/js/serialized_op_gate';
import { mobileToolbarContext } from '../../src/js/mobile_toolbar';
import { BUG_TAG } from '../../src/js/bug_event';
import { HINT_ERROR } from '../../src/js/status_hint';
import { i18n, setupI18n } from '../../src/js/i18n';
import { zh_TW } from '../../src/js/zh_TW_messages';
import { en_US } from '../../src/js/en_US_messages';

const ROWS = 24;
const READ_ROW = '  瀏覽 第 2/4 頁 ( 45%)  目前顯示: 第 23~45 行  (y)回應(X%)推文(h)說明(←)離開 ';
const LIST = { 0: ' 【板主:none】看板《Test》', 23: ' 文章選讀  (y)回應(X)推文(^X)轉錄 ' };

function makeCore() {
  const screen = { rows: {}, pageState: 3 };
  const hints = [];
  const logs = [];
  const core = {
    mobile: true,
    conn: { isConnected: true },
    buf: {
      rows: ROWS, cols: 80, cur_x: 79, cur_y: 23,
      get pageState() { return screen.pageState; },
      getRowText: row => screen.rows[row] || '',
      addEventListener: vi.fn(),
      startedEasyReading: true,
      easyReadingFunctionMode: false,
    },
    view: {
      flashListHint: (text, ms, level) => hints.push({ text, level }), _articleBoard: 'Test',
      useEasyReadingMode: true, navigationEnded: vi.fn()
    },
    debugRecorder: { log: (tag, info) => logs.push({ tag, info }) },
    commandQueue: { idle: true, enqueue: vi.fn(), flush: vi.fn() },
    aidNavigation: { active: false, refresh: vi.fn(() => true) },
    easyReading: { _enterFunctionMode: vi.fn(), settleFunctionMode: vi.fn() },
    listSession: { beginExternalNavigation: vi.fn(), endExternalNavigation: vi.fn() },
    boardListSession: { beginExternalNavigation: vi.fn(), endExternalNavigation: vi.fn() },
    holdBusy: vi.fn(),
    _refreshScreenContext: vi.fn(),
    _screenContext: { appBar: { kind: 'article', title: 'Source' } },
  };
  core.articleHold = new ArticleHold(core);
  core.screenRefresh = new ScreenRefresh(core);
  const show = (rows, pageState) => Object.assign(screen, { rows, pageState });
  return { core, hints, logs, show };
}

const fakeCover = () => ({ destroy: vi.fn() });

beforeAll(() => setupI18n());

describe('ArticleHold', () => {
  test('a failure keeps the article shown, logs a bug, names the cause and asks for a pull', () => {
    const { core, hints, logs } = makeCore();
    const cover = fakeCover();
    core.articleHold.hold({ source: 'threadJump', reason: 'timeout', message: 'threadJump_failed', cover });
    expect(core.articleHold.held).toBe(true);
    expect(cover.destroy).not.toHaveBeenCalled();
    expect(logs).toEqual([{ tag: BUG_TAG, info: expect.objectContaining({ source: 'threadJump', reason: 'timeout' }) }]);
    expect(i18n('threadJump_failed')).toEqual(expect.any(String));
    expect(hints).toEqual([{ text: i18n('threadJump_failed'), level: HINT_ERROR }]);
    // Nothing PTT shows meanwhile takes the page over.
    expect(core.easyReading._enterFunctionMode).toHaveBeenCalled();
    expect(core.listSession.beginExternalNavigation).toHaveBeenCalled();
    expect(core.boardListSession.beginExternalNavigation).toHaveBeenCalled();
  });

  test('keys wait with the message while the toolbar offers refresh under the article App Bar', () => {
    const { core } = makeCore();
    core.articleHold.hold({ source: 'articleResize', reason: 'fail', message: 'articleResize_failed', cover: fakeCover() });
    expect(serializedOpHint(core)).toBe(i18n('articleHold_keys'));
    const context = mobileToolbarContext(core);
    expect(context.refresh).toBe(true);
    expect(context.locked).toBe(true);
    expect(context.appBar).toEqual({ kind: 'article', title: 'Source' });
  });

  test('pull-to-refresh retries even though keys wait', () => {
    const { core } = makeCore();
    core.articleHold.hold({ source: 'threadJump', reason: 'timeout', message: 'threadJump_failed', cover: fakeCover() });
    expect(core.screenRefresh.target()).toEqual({ kind: 'article-retry' });
    const retry = vi.spyOn(core.articleHold, 'retry');
    expect(core.screenRefresh.refresh('pull')).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test('a retry over an article reopens it through the article refresh, which restores the position', () => {
    const { core, show } = makeCore();
    const cover = fakeCover();
    core.articleHold.hold({ source: 'articleResize', reason: 'fail', message: 'articleResize_failed', cover });
    show({ 23: READ_ROW }, 3);
    expect(core.articleHold.retry()).toBe(true);
    expect(core.articleHold.held).toBe(false);
    expect(cover.destroy).toHaveBeenCalledTimes(1);
    expect(core.aidNavigation.refresh).toHaveBeenCalledTimes(1);
    expect(serializedOpHint(core)).toBeNull();
  });

  test('a retry over a list presents that list in easy reading', () => {
    const { core, show } = makeCore();
    core.articleHold.hold({ source: 'headerlessReopen', reason: 'timeout', message: 'headerlessReopen_failed', cover: fakeCover() });
    show(LIST, 2);
    expect(core.articleHold.retry()).toBe(true);
    expect(core.articleHold.held).toBe(false);
    expect(core.easyReading.settleFunctionMode).toHaveBeenCalled();
    expect(core.listSession.endExternalNavigation).toHaveBeenCalledWith(undefined, true);
    expect(core.aidNavigation.refresh).not.toHaveBeenCalled();
  });

  // A resize holds an article whose list session never took part: once easy
  // reading leaves the article for the list PTT shows, the session presents it.
  test('a retry over a list no session took part in engages the list session on it', () => {
    const { core, show } = makeCore();
    core.articleHold.hold({ source: 'articleResize', reason: 'fail', message: 'articleResize_failed', cover: fakeCover() });
    core.listSession.state = 'idle';
    const order = [];
    core.easyReading.settleFunctionMode.mockImplementation(() => order.push('settle'));
    core.listSession.beginExternalNavigation.mockImplementation(() => order.push('engage'));
    core.listSession.endExternalNavigation.mockImplementation((notice, landed) => order.push(landed ? 'present' : 'wait'));
    show(LIST, 2);
    expect(core.articleHold.retry()).toBe(true);
    expect(order).toEqual(['settle', 'engage', 'present']);
  });

  // An article without a header names no board: the refresh cannot reopen it,
  // but easy reading presents it as shown, which reads its identity again.
  test('a retry over an article the refresh cannot name presents it as PTT shows it', () => {
    const { core, show } = makeCore();
    core.articleHold.hold({ source: 'headerlessReopen', reason: 'timeout', message: 'headerlessReopen_failed', cover: fakeCover() });
    core.view._articleBoard = null;
    show({ 0: 'Body of article 610 by dan.', 23: READ_ROW }, 3);
    expect(core.articleHold.retry()).toBe(true);
    expect(core.articleHold.held).toBe(false);
    expect(core.aidNavigation.refresh).not.toHaveBeenCalled();
    expect(core.easyReading.settleFunctionMode).toHaveBeenCalled();
    // A repaint settles the screen, which the identity is read on.
    expect(core.commandQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ keys: '\f', kind: 'article-retry' }));
  });

  test('a repaint PTT never answers holds the article again', () => {
    const { core, show, hints } = makeCore();
    core.articleHold.hold({ source: 'headerlessReopen', reason: 'timeout', message: 'headerlessReopen_failed', cover: fakeCover() });
    core.view._articleBoard = null;
    show({ 0: 'Body of article 610 by dan.', 23: READ_ROW }, 3);
    core.articleHold.retry();
    core.commandQueue.enqueue.mock.calls[0][0].onFail('timeout');
    expect(core.articleHold.held).toBe(true);
    expect(hints.at(-1)).toEqual({ text: i18n('articleHold_retryTimeout'), level: HINT_ERROR });
  });

  test('a retry over a screen it cannot recognise keeps the hold and sends nothing', () => {
    const { core, show, hints, logs } = makeCore();
    const cover = fakeCover();
    core.articleHold.hold({ source: 'threadJump', reason: 'timeout', message: 'threadJump_failed', cover });
    show({ 10: 'something else' }, 0);
    expect(core.articleHold.retry()).toBe(false);
    expect(core.articleHold.held).toBe(true);
    expect(cover.destroy).not.toHaveBeenCalled();
    expect(core.commandQueue.enqueue).not.toHaveBeenCalled();
    expect(core.aidNavigation.refresh).not.toHaveBeenCalled();
    expect(hints.at(-1)).toEqual({ text: i18n('articleHold_unknownScreen'), level: HINT_ERROR });
    expect(logs.at(-1).info).toEqual(expect.objectContaining({ source: 'articleHold', reason: 'unknownScreen' }));
  });

  test('disconnection drops the hold', () => {
    const { core } = makeCore();
    const cover = fakeCover();
    core.articleHold.hold({ source: 'threadJump', reason: 'timeout', message: 'threadJump_failed', cover });
    core.articleHold.reset();
    expect(core.articleHold.held).toBe(false);
    expect(cover.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('Hidden article route failure', () => {
  test('hands its cover to the hold instead of leaving the reader on PTT', () => {
    const { core, hints } = makeCore();
    const route = new HiddenArticleRoute(core, { name: 'threadJump', kind: 'thread-jump', failed: 'threadJump_failed' });
    const cover = fakeCover();
    route.cover = cover;
    route.active = true;
    route.held = true;
    route.appBar = { kind: 'article', title: 'Source' };
    route._fail('thread-jump-search: timeout');
    expect(route.active).toBe(false);
    expect(cover.destroy).not.toHaveBeenCalled();
    expect(core.articleHold.held).toBe(true);
    expect(core.articleHold.cover).toBe(cover);
    // Already parked by the route: not parked a second time.
    expect(core.listSession.beginExternalNavigation).not.toHaveBeenCalled();
    expect(core.listSession.endExternalNavigation).not.toHaveBeenCalled();
    expect(hints).toEqual([{ text: i18n('threadJump_failed'), level: HINT_ERROR }]);
  });
});

describe('Headerless reopen failure', () => {
  // Pull-to-refresh presents the article again: its settle reads it again.
  test('lets the article be tried again once it is presented', () => {
    const { core } = makeCore();
    const route = new HeaderlessReopen(core);
    route.state = { board: 'Test', tried: 'Body of article 610 by dan.' };
    route.cover = fakeCover();
    route.active = true;
    route.held = true;
    route._fail('headerless-reopen-info: miss');
    expect(core.articleHold.held).toBe(true);
    expect(route.state).toEqual({ board: 'Test', tried: null });
  });
});

// PttChrome's own operations over an article (a long comment, a jump by
// article code, logging out) keep the article on screen while they drive PTT
// through native screens (#209).
describe('Operation over the article', () => {
  afterEach(() => vi.useRealTimers());

  test('holds the grid frames under the article App Bar while it runs', () => {
    const { core } = makeCore();
    expect(core.articleHold.run('longPush')).toBe(true);
    expect(core.articleHold.holding).toBe(true);
    expect(core.articleHold.held).toBe(false);
    core.buf.easyReadingFunctionMode = true;
    const context = mobileToolbarContext(core);
    expect(context.appBar).toEqual({ kind: 'article', title: 'Source' });
    expect(context.locked).toBe(true);
    expect(context.refresh).toBe(false);
  });

  test('holds nothing unless easy reading presents an article', () => {
    for (const change of [
      core => { core.view.useEasyReadingMode = false; },
      core => { core.buf.startedEasyReading = false; },
      core => { core.buf.easyReadingFunctionMode = true; },
      (core, show) => show(LIST, 2),
    ]) {
      const { core, show } = makeCore();
      change(core, show);
      expect(core.articleHold.run('longPush')).toBe(false);
      expect(core.articleHold.holding).toBe(false);
      expect(mobileToolbarContext(core)?.locked).not.toBe(true);
    }
  });

  test('ends when easy reading presents its page again', () => {
    const { core } = makeCore();
    core.articleHold.run('longPush');
    core.buf.easyReadingFunctionMode = true;
    core.easyReading.settleFunctionMode = vi.fn(() => { core.buf.easyReadingFunctionMode = false; });
    core.articleHold.done('longPush');
    expect(core.easyReading.settleFunctionMode).toHaveBeenCalled();
    expect(core.articleHold.holding).toBe(false);
    expect(core.articleHold.held).toBe(false);
    expect(core.view.navigationEnded).toHaveBeenCalled();
    expect(core.articleHold.toolbarContext()).toBe(null);
  });

  test('keeps holding until the native mirror settles away, then lets the page draw', () => {
    vi.useFakeTimers();
    const { core } = makeCore();
    core.articleHold.run('logout');
    core.buf.easyReadingFunctionMode = true;
    core.articleHold.done('logout');
    expect(core.articleHold.holding).toBe(true);
    core.buf.easyReadingFunctionMode = false;
    expect(core.articleHold.holding).toBe(false);
    vi.advanceTimersByTime(LANDING_MS);
    expect(core.articleHold.held).toBe(false);
  });

  test('a native screen easy reading never leaves holds the article', () => {
    vi.useFakeTimers();
    const { core, hints, logs } = makeCore();
    core.articleHold.run('longPush');
    core.buf.easyReadingFunctionMode = true;
    core.articleHold.done('longPush');
    vi.advanceTimersByTime(LANDING_MS);
    expect(core.articleHold.held).toBe(true);
    expect(logs.at(-1).info).toEqual(expect.objectContaining({ source: 'longPush', reason: 'unpresented' }));
    expect(hints.at(-1)).toEqual({ text: i18n('articleHold_unpresented'), level: HINT_ERROR });
  });

  test('a failure holds the article with the operation\'s message, without parking twice', () => {
    const { core, hints, logs } = makeCore();
    core.articleHold.run('longPush');
    core.buf.easyReadingFunctionMode = true;
    expect(core.articleHold.fail('longPush', { reason: 'timeout', text: 'Failed: timeout.', parked: true })).toBe(true);
    expect(core.articleHold.running).toBe(null);
    expect(core.articleHold.held).toBe(true);
    expect(hints).toEqual([{ text: 'Failed: timeout.', level: HINT_ERROR }]);
    expect(logs).toEqual([{ tag: BUG_TAG, info: expect.objectContaining({ source: 'longPush', reason: 'timeout' }) }]);
    expect(core.easyReading._enterFunctionMode).not.toHaveBeenCalled();
    expect(core.listSession.beginExternalNavigation).not.toHaveBeenCalled();
    expect(mobileToolbarContext(core)).toEqual(expect.objectContaining({ refresh: true, locked: true }));
    expect(core.view.navigationEnded).toHaveBeenCalled();
  });

  test('a held article keeps holding the grid frames under its cover until released', () => {
    const { core } = makeCore();
    core.articleHold.run('longPush');
    core.articleHold.fail('longPush', { reason: 'timeout', message: 'longPush_held' });
    expect(core.articleHold.holding).toBe(true);
    core.view.navigationEnded.mockClear();
    core.articleHold.reset();
    expect(core.articleHold.holding).toBe(false);
    expect(core.view.navigationEnded).toHaveBeenCalled();
  });

  test('a failure after the operation handed its sessions back parks them again', () => {
    const { core } = makeCore();
    core.articleHold.run('longPush');
    core.articleHold.fail('longPush', { reason: 'timeout', message: 'longPush_held' });
    expect(core.listSession.beginExternalNavigation).toHaveBeenCalledWith({ fromIdle: true });
    expect(core.boardListSession.beginExternalNavigation).toHaveBeenCalled();
  });

  test('another operation\'s end or failure leaves it running', () => {
    const { core } = makeCore();
    core.articleHold.run('longPush');
    core.articleHold.done('logout');
    expect(core.articleHold.fail('logout', { reason: 'x', text: 'x' })).toBe(false);
    expect(core.articleHold.running).toBe('longPush');
  });

  test('disconnection lets the operation go on without the hold', () => {
    const { core } = makeCore();
    core.articleHold.run('logout');
    core.articleHold.reset();
    expect(core.articleHold.holding).toBe(false);
    expect(core.articleHold.held).toBe(false);
    expect(core.view.navigationEnded).toHaveBeenCalled();
  });
});

describe('Failure messages', () => {
  test.each(['threadJump_failed', 'headerlessReopen_failed', 'articleResize_failed', 'articleHold_keys', 'articleHold_retryTimeout',
    'articleHold_unpresented'])(
    '%s offers pull-to-refresh and never the native screen', key => {
      expect(zh_TW[key].message).not.toMatch(/原生/);
      expect(zh_TW[key].message).toMatch(/下拉重新整理以重試/);
      expect(en_US[key].message).not.toMatch(/native/i);
      expect(en_US[key].message).toMatch(/pull down to refresh/i);
    });
});
