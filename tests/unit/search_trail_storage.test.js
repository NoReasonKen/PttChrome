// @unit-env browser
// Search trail kept on this device across reloads
// (search_trail_storage.js through article_shortcut_search.js;
// docs/article-swipe-drawer-spec.md). The real-browser lifecycle is covered by
// tests/e2e/offline/mobile_article_search_recovery.offline.spec.js; these
// cases pin local-only storage and startup expiry deterministically.
import { ArticleShortcutSearch } from "../../src/js/article_shortcut_search";
import { SEARCH_TRAIL_KEY } from "../../src/js/search_trail_storage";
import { searchedFrom, SEARCH_TRAIL_MAX_AGE_MS } from "../../src/js/search_trail";
import { readValuesWithDefault } from "../../src/js/pref_storage";
import { sanitizeForCloud } from "../../src/js/pref_sync_logic";
import { i18n } from "../../src/js/i18n";
import { recordSearchResults, readSearchResultsContext } from "../../src/js/search_results_context";

const ORIGIN = {
  board: "Test",
  aid: "1gIeu-3A",
  author: "alice",
  title: "[Talk] Alpha topic",
  query: { kind: "author", value: "alice" },
  position: { lineIndex: 9 }
};
const LIST_PLAN = { kind: "list", board: "Test", num: null };
const FULL_LIST = { 0: "【板主：test】看板《Test》", 23: " 文章列表  [←]離開 [→]閱讀" };

function app(rows = FULL_LIST) {
  const core = {
    buf: {
      rows: 24,
      cols: 80,
      pageState: 2,
      getRowText: (row) => rows[row] || "",
      addEventListener() {}
    },
    view: { flashListHint: vi.fn() },
    conn: { isConnected: true },
    // A claimed Back starts rebuilding the results by selecting the source.
    aidNavigation: { selectArticle: vi.fn(() => true) },
    commandQueue: { enqueue: vi.fn() }
  };
  core.articleShortcutSearch = new ArticleShortcutSearch(core);
  const hints = () => core.view.flashListHint.mock.calls.map((call) => call[0]);
  // Whether the reader's Back on this full board list belongs to the trail.
  const trailOwnsBack = () => core.articleShortcutSearch.handleBack(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
  return { core, search: core.articleShortcutSearch, hints, trailOwnsBack };
}

// The previous page was on A's results when the reader closed it.
function closePageOnResults() {
  const { search } = app();
  search.trail = searchedFrom(null, ORIGIN);
  search.persistForRecovery(LIST_PLAN);
}

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.removeItem(SEARCH_TRAIL_KEY);
});

test("background list filling cannot invalidate a query through a transient input cursor", () => {
  const { core, search } = app({ ...FULL_LIST, 23: ' 系列文章 [←]離開 [→]閱讀' });
  const context = { board: 'Test', filters: [{ kind: 'title', value: 'topic' }] };
  recordSearchResults(core, context);
  core.listSession = { state: 'active', readingPosition: () => ({ board: 'Test', mode: 'select' }) };
  core.buf.isCursorOnInputField = () => true;
  search.noteSettle();
  expect(readSearchResultsContext(core)).toEqual(context);
  // A genuine unowned native input invalidates the query instead.
  core.listSession.state = 'functionMode';
  search.noteSettle();
  expect(readSearchResultsContext(core)).toBeNull();
});

test("digest navigation discards old search metadata even though both use select numbering", () => {
  const { core, search } = app({ ...FULL_LIST, 23: ' 文摘列表 [←]離開 [→]閱讀' });
  recordSearchResults(core, { board: 'Test', filters: [{ kind: 'author', value: 'alice' }] });
  core.listSession = { state: 'active', readingPosition: () => ({ board: 'Test', mode: 'select' }) };
  search.noteSettle();
  expect(readSearchResultsContext(core)).toBeNull();
});

test('leaving ordinary results clears the query even when legacy captions look unchanged', () => {
  const { core, search } = app();
  recordSearchResults(core, { board: 'Test', filters: [{ kind: 'author', value: 'alice' }] });
  search.noteSearchKey({ key: 'ArrowLeft' });
  expect(readSearchResultsContext(core)).toBeNull();
});

test('a background cursor excursion does not turn visible results into a full-board history exit', () => {
  const { core, search } = app({ ...FULL_LIST, 23: ' 系列文章 [←]離開 [→]閱讀' });
  search.trail = searchedFrom(null, ORIGIN);
  core.listSession = { state: 'active', readingPosition: () => ({ board: 'Test', mode: 'select' }) };
  core.buf.cur_y = 23;
  core.buf.cur_x = 40;
  search.noteSettle();
  expect(search.trail?.phase).toBe('results');
  expect(search.trail.origins).toHaveLength(1);
});

test("the stored trail stays out of the preferences that sync to the cloud or export", () => {
  const before = JSON.stringify(sanitizeForCloud(readValuesWithDefault()));
  closePageOnResults();
  expect(window.localStorage.getItem(SEARCH_TRAIL_KEY)).toContain(ORIGIN.aid);
  const synced = JSON.stringify(sanitizeForCloud(readValuesWithDefault()));
  expect(synced).toBe(before);
  expect(synced).not.toContain(ORIGIN.aid);
});

test("a trail stored within twelve hours waits for its resume plan and is restored on that plan's screen", () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 25, 8) });
  closePageOnResults();
  vi.setSystemTime(Date.now() + SEARCH_TRAIL_MAX_AGE_MS);
  const { search, hints, trailOwnsBack } = app();
  // Read once: a second startup finds nothing.
  expect(window.localStorage.getItem(SEARCH_TRAIL_KEY)).toBeNull();
  search.restoreForRecovery(LIST_PLAN);
  search.recoveryEnded(LIST_PLAN, { ok: true });
  expect(hints()).toEqual([i18n("articleShortcutSearch_recovered")]);
  // Back from the full board list rebuilds the stored origin's results.
  expect(trailOwnsBack()).toBe(true);
});

test("an expired trail is discarded silently at startup", () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 25, 8) });
  closePageOnResults();
  vi.setSystemTime(Date.now() + SEARCH_TRAIL_MAX_AGE_MS + 1);
  const { search, hints, trailOwnsBack } = app();
  search.restoreForRecovery(LIST_PLAN);
  search.recoveryEnded(LIST_PLAN, { ok: true });
  expect(hints()).toEqual([]);
  expect(trailOwnsBack()).toBe(false);
});

test("a stored trail without its resume plan stays inactive with an explanation", () => {
  closePageOnResults();
  const { search, hints, trailOwnsBack } = app();
  search.restoreForRecovery(null);
  search.recoveryEnded(LIST_PLAN, { ok: true });
  expect(hints()).toEqual([i18n("articleShortcutSearch_recoveryInactive")]);
  expect(trailOwnsBack()).toBe(false);
});

test("a resume that lands somewhere else leaves the trail inactive with an explanation", () => {
  closePageOnResults();
  const rows = { 0: "【主功能表】", 23: "" };
  const { search, hints, trailOwnsBack } = app(rows);
  search.restoreForRecovery(LIST_PLAN);
  search.recoveryEnded(LIST_PLAN, { ok: true });
  expect(hints()).toEqual([i18n("articleShortcutSearch_recoveryInactive")]);
  // Even once the reader reaches the board list, a matching name never reattaches it.
  Object.assign(rows, FULL_LIST);
  expect(trailOwnsBack()).toBe(false);
});

test("a user board switch before closing the page removes the stored trail", () => {
  const rows = { ...FULL_LIST };
  const { search } = app(rows);
  search.trail = searchedFrom(null, ORIGIN);
  search.persistForRecovery(LIST_PLAN);
  expect(window.localStorage.getItem(SEARCH_TRAIL_KEY)).not.toBeNull();
  rows[0] = "【板主：test】看板《Other》";
  search.noteSettle();
  search.persistForRecovery({ kind: "list", board: "Other", num: null });
  expect(window.localStorage.getItem(SEARCH_TRAIL_KEY)).toBeNull();
});

test("a suspended trail is stored for its plan whatever the board name's case", () => {
  const { search } = app();
  search.trail = searchedFrom(null, ORIGIN);
  search.suspendForRecovery(LIST_PLAN);
  search.persistForRecovery({ ...LIST_PLAN, board: "test" });
  expect(window.localStorage.getItem(SEARCH_TRAIL_KEY)).toContain(ORIGIN.aid);
});
