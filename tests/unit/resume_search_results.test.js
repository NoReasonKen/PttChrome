// @unit-env browser
// Queue-boundary recovery tests; real reload/reconnect coverage lives in
// tests/e2e/offline/mobile_article_search_recovery.offline.spec.js.
import { resumeSearchResults } from '../../src/js/resume_search_results';
import { searchGateFacts } from '../../src/js/article_search';
import { readSearchResultsContext } from '../../src/js/search_results_context';
import { recordFor } from '../../src/js/reading_record';
import { loadBig5Tables } from './helpers/load_big5_tables';

const search = filters => ({ board: 'Test', filters });
const title = { kind: 'title', value: 'topic' };
const thread = { kind: 'thread', aid: '1gIeu-3B', title: 'Re: topic' };

test('search recovery verifies and restores the saved viewport before releasing its owner', () => {
  const a = app();
  const anchor = { num: 7, author: 'alice', date: '9/01', title: '□ topic', scrollFrac: 0.4 };
  a.core.listSession.requestViewportRestore = vi.fn();
  resumeSearchResults(a.core, search([title]), a.done, anchor);
  a.accept(a.next(), '系列文章', '搜尋標題: ');
  a.accept(a.next(), '系列文章');
  expect(a.done).not.toHaveBeenCalled();
  expect(a.core.listSession.endExternalNavigation).not.toHaveBeenCalled();
  const probe = a.next();
  expect(probe.keys).toBe('7\r\f');
  const originalRead = a.core.buf.getRowText;
  a.core.buf.getRowText = row => row === 3
    ? '      7     9/01 alice        □ topic' : originalRead(row);
  a.core.buf.cur_y = 3;
  const facts = probe.expect(null, searchGateFacts(a.core));
  expect(facts).toBeTruthy();
  probe.onDone(facts);
  expect(a.done).toHaveBeenCalledExactlyOnceWith({ ok: true });
  const restore = a.core.listSession.requestViewportRestore;
  expect(restore).toHaveBeenCalledWith(expect.objectContaining({ topNum: 7, cursorNum: 7, scrollFrac: 0.4, mode: 'select' }));
  expect(restore.mock.invocationCallOrder[0]).toBeLessThan(a.core.listSession.endExternalNavigation.mock.invocationCallOrder[0]);
});

beforeAll(() => loadBig5Tables());
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function app(board = 'Test') {
  const pending = [];
  const sent = [];
  let rows = {};
  let input = false;
  const core = {
    buf: {
      rows: 24, cols: 80, pageState: 2, cur_x: 0, cur_y: 5,
      getRowText: row => rows[row] || '',
      isCursorOnInputField: () => input
    },
    conn: { isConnected: true },
    view: { flashListHint: vi.fn() },
    commandQueue: { enqueue: vi.fn(step => pending.push(step)) },
    aidNavigation: { selectArticle: vi.fn(() => true) },
    listSession: {
      readingPosition: () => null,
      beginExternalNavigation: vi.fn(), endExternalNavigation: vi.fn()
    },
    boardListSession: {
      readingPosition: () => null,
      beginExternalNavigation: vi.fn(), endExternalNavigation: vi.fn()
    },
    articleShortcutSearch: { trail: { board, origins: [{ aid: '1gIeu-3A' }], phase: 'results' } }
  };
  const screen = (caption = '文章列表', bottom = null) => {
    rows = { 0: `【板主:test】看板《${board}》`, 23: bottom || ` ${caption} [←]離開 [→]閱讀` };
    core.buf.cur_y = bottom ? 23 : 5;
    input = !!bottom && /搜尋|增加條件/.test(bottom);
  };
  screen();
  const rr = recordFor(core);
  const end = vi.spyOn(rr, 'end');
  const done = vi.fn();
  const next = () => {
    expect(pending.length).toBeGreaterThan(0);
    const step = pending.shift();
    sent.push(step.keys);
    return step;
  };
  const accept = (step, caption, bottom) => {
    screen(caption, bottom);
    const result = step.expect(null, searchGateFacts(core));
    expect(result).toBeTruthy();
    step.onDone(result);
  };
  return { core, pending, sent, screen, next, accept, done, end };
}

test('ordinary filters reconstruct in order and become current only after final verified results', () => {
  const a = app();
  const filters = [title, { kind: 'author', value: 'alice' }, { kind: 'push', value: '-2' }];
  const trailBefore = JSON.stringify(a.core.articleShortcutSearch.trail);
  resumeSearchResults(a.core, search(filters), a.done);
  for (const [i, [key, prompt, value]] of [
    ['/', '搜尋標題: ', 'topic'],
    ['a', '增加條件 作者: ', 'alice'],
    ['Z', '增加條件 推文數: ', '-2']
  ].entries()) {
    expect(readSearchResultsContext(a.core, 'Test')).toBeNull();
    const open = a.next();
    expect(open.keys).toBe(key);
    a.accept(open, '系列文章', prompt);
    const submit = a.next();
    expect(submit.keys).toBe(value + '\r');
    a.accept(submit, '系列文章');
    if (i < 2) expect(a.done).not.toHaveBeenCalled();
  }
  expect(a.done).toHaveBeenCalledExactlyOnceWith({ ok: true });
  expect(readSearchResultsContext(a.core, 'test')).toEqual(search(filters));
  expect(a.core.searchInFlight).toBe(false);
  expect(a.core.listSession.endExternalNavigation).toHaveBeenCalledTimes(1);
  expect(a.core.boardListSession.endExternalNavigation).toHaveBeenCalledTimes(1);
  expect(a.end).toHaveBeenCalledTimes(1);
  expect(a.end.mock.calls[0][1]).toBe('done');
  expect(JSON.stringify(a.core.articleShortcutSearch.trail)).toBe(trailBefore);
});

test('wrong-board recovery rejects before sending or claiming external navigation', () => {
  const a = app('Other');
  resumeSearchResults(a.core, search([title]), a.done);
  expect(a.done).toHaveBeenCalledExactlyOnceWith({ ok: false });
  expect(a.core.commandQueue.enqueue).not.toHaveBeenCalled();
  expect(a.core.listSession.beginExternalNavigation).not.toHaveBeenCalled();
  expect(readSearchResultsContext(a.core, 'Other')).toBeNull();
});

test('no-results pauses are dismissed once and cannot record a successful query', () => {
  const a = app();
  resumeSearchResults(a.core, search([title]), a.done);
  a.accept(a.next(), '文章列表', '搜尋標題: ');
  a.accept(a.next(), '文章列表', '找不到符合條件的文章。');
  expect(a.done).not.toHaveBeenCalled();
  const dismiss = a.next();
  expect(dismiss.keys).toBe(' ');
  a.accept(dismiss, '文章列表');
  expect(a.done).toHaveBeenCalledExactlyOnceWith({ ok: false });
  expect(a.pending).toEqual([]);
  expect(readSearchResultsContext(a.core, 'Test')).toBeNull();
  expect(a.core.view.flashListHint).toHaveBeenCalledTimes(1);
  expect(a.core.searchInFlight).toBe(false);
});

test.each(['onFail', 'onFlushed'])('prompt %s releases ownership exactly once without sending the keyword', failure => {
  const a = app();
  resumeSearchResults(a.core, search([title]), a.done);
  const open = a.next();
  open[failure]('timeout');
  open[failure]('timeout');
  expect(a.sent).toEqual(['/']);
  expect(a.pending).toEqual([]);
  expect(a.done).toHaveBeenCalledExactlyOnceWith({ ok: false });
  expect(a.end).toHaveBeenCalledTimes(1);
  expect(a.end.mock.calls[0][1]).toBe('fail');
  expect(a.core.listSession.endExternalNavigation).toHaveBeenCalledTimes(1);
  expect(a.core.searchInFlight).toBe(false);
});

test('disconnect during submission clears in-flight state without showing a connected failure hint', () => {
  const a = app();
  resumeSearchResults(a.core, search([title]), a.done);
  a.accept(a.next(), '文章列表', '搜尋標題: ');
  const submit = a.next();
  a.core.conn.isConnected = false;
  submit.onFlushed();
  expect(a.done).toHaveBeenCalledExactlyOnceWith({ ok: false });
  expect(a.core.view.flashListHint).not.toHaveBeenCalled();
  expect(a.core.searchInFlight).toBe(false);
  expect(readSearchResultsContext(a.core, 'Test')).toBeNull();
});

test('thread recovery selects its stable source before issuing native same-thread search', () => {
  const a = app();
  resumeSearchResults(a.core, search([thread]), a.done);
  expect(a.core.aidNavigation.selectArticle).toHaveBeenCalledWith('Test', thread.aid, expect.any(Function));
  expect(a.core.commandQueue.enqueue).not.toHaveBeenCalled();
  const selected = a.core.aidNavigation.selectArticle.mock.calls[0][2];
  selected({ ok: true });
  const submit = a.next();
  expect(submit.keys).toBe('S');
  a.accept(submit, '系列文章');
  expect(a.done).toHaveBeenCalledExactlyOnceWith({ ok: true });
  expect(readSearchResultsContext(a.core, 'Test')).toEqual(search([thread]));
});

test('a deleted thread source dismisses its known pause without issuing S or retrying', () => {
  const a = app();
  resumeSearchResults(a.core, search([thread]), a.done);
  const selected = a.core.aidNavigation.selectArticle.mock.calls[0][2];
  a.screen('文章列表');
  const originalRead = a.core.buf.getRowText;
  a.core.buf.getRowText = row => row === 22 ? '找不到這個文章代碼' : originalRead(row);
  selected({ ok: false });
  const dismiss = a.next();
  expect(dismiss.keys).toBe(' ');
  a.core.buf.getRowText = originalRead;
  a.accept(dismiss, '文章列表');
  expect(a.sent).toEqual([' ']);
  expect(a.done).toHaveBeenCalledExactlyOnceWith({ ok: false });
  expect(a.core.aidNavigation.selectArticle).toHaveBeenCalledTimes(1);
  expect(readSearchResultsContext(a.core, 'Test')).toBeNull();
});

test('a digest frame cannot complete a pending search restoration', () => {
  const a = app();
  resumeSearchResults(a.core, search([title]), a.done);
  a.accept(a.next(), '文章列表', '搜尋標題: ');
  const submit = a.next();
  a.screen('文摘列表');
  expect(submit.expect(null, searchGateFacts(a.core))).toBe(false);
  expect(a.done).not.toHaveBeenCalled();
  submit.onFail('unexpected-screen');
  expect(a.done).toHaveBeenCalledExactlyOnceWith({ ok: false });
});
