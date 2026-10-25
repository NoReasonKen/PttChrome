// @unit-env browser
// Search return history kept on this device across reloads
// (article_shortcut_search.js; docs/article-search.md). The real-browser
// lifecycle is covered by
// tests/e2e/offline/mobile_article_search_recovery.offline.spec.js; these
// cases pin local-only storage and startup expiry deterministically.
import { ArticleShortcutSearch, SEARCH_RETURN_KEY } from "../../src/js/article_shortcut_search";
import { searchedFrom, SEARCH_RETURN_MAX_AGE_MS } from "../../src/js/search_return_history";
import { readValuesWithDefault } from "../../src/js/pref_storage";
import { sanitizeForCloud } from "../../src/js/pref_sync_logic";
import { i18n } from "../../src/js/i18n";

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
    conn: { isConnected: true }
  };
  core.articleShortcutSearch = new ArticleShortcutSearch(core);
  const hints = () => core.view.flashListHint.mock.calls.map((call) => call[0]);
  return { core, search: core.articleShortcutSearch, hints };
}

// The previous page was on A's results when the reader closed it.
function closePageOnResults() {
  const { search } = app();
  search.route = searchedFrom(null, ORIGIN);
  search.persistForRecovery(LIST_PLAN);
}

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.removeItem(SEARCH_RETURN_KEY);
});

test("the stored route stays out of the preferences that sync to the cloud or export", () => {
  const before = JSON.stringify(sanitizeForCloud(readValuesWithDefault()));
  closePageOnResults();
  expect(window.localStorage.getItem(SEARCH_RETURN_KEY)).toContain(ORIGIN.aid);
  const synced = JSON.stringify(sanitizeForCloud(readValuesWithDefault()));
  expect(synced).toBe(before);
  expect(synced).not.toContain(ORIGIN.aid);
});

test("a route stored within twelve hours waits for its resume plan and is restored on that plan's screen", () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 25, 8) });
  closePageOnResults();
  vi.setSystemTime(Date.now() + SEARCH_RETURN_MAX_AGE_MS);
  const { search, hints } = app();
  // Read once: a second startup finds nothing.
  expect(window.localStorage.getItem(SEARCH_RETURN_KEY)).toBeNull();
  search.restoreForRecovery(LIST_PLAN);
  search.recoveryEnded(LIST_PLAN, { ok: true });
  expect(hints()).toEqual([i18n("articleShortcutSearch_recovered")]);
});

test("an expired route is discarded silently at startup", () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 25, 8) });
  closePageOnResults();
  vi.setSystemTime(Date.now() + SEARCH_RETURN_MAX_AGE_MS + 1);
  const { search, hints } = app();
  search.restoreForRecovery(LIST_PLAN);
  search.recoveryEnded(LIST_PLAN, { ok: true });
  expect(hints()).toEqual([]);
  expect(search.route).toBeNull();
});

test("a stored route without its resume plan stays inactive with an explanation", () => {
  closePageOnResults();
  const { search, hints } = app();
  search.restoreForRecovery(null);
  search.recoveryEnded(LIST_PLAN, { ok: true });
  expect(hints()).toEqual([i18n("articleShortcutSearch_recoveryInactive")]);
  expect(search.route).toBeNull();
});

test("a resume that lands somewhere else leaves the route inactive with an explanation", () => {
  closePageOnResults();
  const { search, hints } = app({ 0: "【主功能表】", 23: "" });
  search.restoreForRecovery(LIST_PLAN);
  search.recoveryEnded(LIST_PLAN, { ok: true });
  expect(hints()).toEqual([i18n("articleShortcutSearch_recoveryInactive")]);
  expect(search.route).toBeNull();
});

test("a user board switch before closing the page removes the stored route", () => {
  const rows = { ...FULL_LIST };
  const { search } = app(rows);
  search.route = searchedFrom(null, ORIGIN);
  search.persistForRecovery(LIST_PLAN);
  expect(window.localStorage.getItem(SEARCH_RETURN_KEY)).not.toBeNull();
  rows[0] = "【板主：test】看板《Other》";
  search.noteSettle();
  search.persistForRecovery({ kind: "list", board: "Other", num: null });
  expect(window.localStorage.getItem(SEARCH_RETURN_KEY)).toBeNull();
});
