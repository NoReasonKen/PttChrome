// A failed article operation holds the article (#193): the reader stays on it
// at the reading position with a message, the failure is a bug event, keys
// wait, and pull-to-refresh retries from what PTT shows.
// real-input: tests/e2e/offline/mobile_thread_jump.offline.spec.js
import { ArticleHold } from '../../src/js/article_hold';
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
    },
    view: { flashListHint: (text, ms, level) => hints.push({ text, level }), _articleBoard: 'Test' },
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

describe('Failure messages', () => {
  test.each(['threadJump_failed', 'headerlessReopen_failed', 'articleResize_failed', 'articleHold_keys', 'articleHold_retryTimeout'])(
    '%s offers pull-to-refresh and never the native screen', key => {
      expect(zh_TW[key].message).not.toMatch(/原生/);
      expect(zh_TW[key].message).toMatch(/下拉重新整理以重試/);
      expect(en_US[key].message).not.toMatch(/native/i);
      expect(en_US[key].message).toMatch(/pull down to refresh/i);
    });
});
