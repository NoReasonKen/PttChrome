// @unit-env browser
// The article list's other search filters (#298, src/js/article_search.js):
// A price, G marked (m/s), ! exclude title, S same title (PTT's own S), Backspace thread
// starters, Tab digest. Prompts and refusals are read from pttbbs
// mbbsd/read.c (ask_filter_predicate, select_read) and bbs.c (board_digest).
import { loadBig5Tables } from "./helpers/load_big5_tables";
import {
  availableSearchKinds,
  searchSheetKinds,
  withBoardJump,
  digestKindOf,
  buildSearchSteps,
  filterKindOfKey,
  isSearchPromptFrame,
  normalizeSearchText,
  searchKeyOpensSheet,
  shouldInterceptSearchKey,
  searchModeOf,
  startFilter,
  subjectOf,
  cursorSubject,
  submitSearch,
  tryOpenSearchModal,
} from "../../src/js/article_search";
import { CommandQueue } from "../../src/js/command_queue";
import { writeValues, readValuesWithDefault } from "../../src/js/pref_storage";
import {
  recordSearchResults,
  readSearchResultsContext,
  validateSearchResultsContext,
} from "../../src/js/search_results_context";

beforeAll(() => {
  loadBig5Tables();
});
beforeEach(() => {
  localStorage.clear();
  writeValues({ ...readValuesWithDefault(), enableEasyReading: true });
});

const ROWS = 24;
const blank = () => Array.from({ length: ROWS }, () => "");
const FULL = " 文章列表  [←]離開 [→]閱讀";
const RESULTS = " 系列文章  [←]離開 [→]閱讀";
const DIGEST = " 文摘列表  [←]離開 [→]閱讀";

function list(footer, over) {
  const rowTexts = blank();
  rowTexts[0] = " 【板主:none】看板《Test》";
  rowTexts[23] = footer;
  return { rowTexts, rows: ROWS, curX: 0, curY: 5, inputField: false, listOwner: "article-list", ...over };
}
function prompt(text, footer = FULL) {
  const f = list(footer, { curY: 23 });
  f.rowTexts[23] = text;
  return f;
}

function nativeCore(frame) {
  const sent = [];
  const queue = new CommandQueue({
    send: (d) => sent.push(d),
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  const flashListHint = vi.fn();
  const core = {
    commandQueue: queue,
    activeListSession: () => null,
    openSearchModal: vi.fn(() => true),
    view: { flashListHint },
    listSession: {
      state: "active",
      readingPosition: () => ({ board: "Test", mode: "plain" }),
      // The article under the list cursor, as its row shows it (core._title).
      selectedPostInfoTarget: () => (core._title ? { title: core._title } : null),
    },
    buf: {
      rows: ROWS,
      cols: 80,
      pageState: 2,
      listRenderMode: "buffer",
      listRenderOwner: "article-list",
      getRowText: (r) => core._frame.rowTexts[r],
      isCursorOnInputField: () => core._frame.inputField,
      get cur_y() {
        return core._frame.curY;
      },
      get cur_x() {
        return core._frame.curX;
      },
    },
    _frame: frame,
  };
  const settle = (f) => {
    core._frame = f;
    queue.onSettle(null, f);
  };
  return { core, queue, sent, settle, flashListHint };
}

describe("keys and availability", () => {
  test.each([
    ["A", "price"],
    ["G", "mark"],
    ["!", "exclude"],
    ["S", "sameTitle"],
    ["Backspace", "newPost"],
    ["Tab", "digest"],
  ])("%s stands for %s", (key, kind) => {
    expect(filterKindOfKey(key)).toBe(kind);
  });
  test("lower-case a g s are not these filters", () => {
    expect(filterKindOfKey("g")).toBeNull();
    expect(filterKindOfKey("a")).toBeNull();
  });
  test("Tab leaves the digest it is in", () => {
    expect(filterKindOfKey("Tab", list(DIGEST))).toBe("digestLeave");
    expect(filterKindOfKey("Tab", list(FULL))).toBe("digest");
  });
  test("the article list's sheet kinds are PTT's filters; the board jump is not one of them", () => {
    const kinds = ["title", "author", "push", "price", "mark", "sameTitle", "newPost"];
    expect(availableSearchKinds(list(FULL))).toEqual(kinds);
    // PTT's key table works inside the digest too (read_common_cmds under digest_comms).
    expect(availableSearchKinds(list(DIGEST))).toEqual(kinds);
  });
  test("the digest is a mode with its own entry: enter, or leave inside it", () => {
    expect(digestKindOf(list(FULL))).toBe("digest");
    expect(digestKindOf(list(RESULTS))).toBe("digest");
    expect(digestKindOf(list(DIGEST))).toBe("digestLeave");
    expect(digestKindOf({ rowTexts: blank(), rows: ROWS, listOwner: null })).toBeNull();
  });
  test("no filter on the mailbox, a board list, an open prompt or an article", () => {
    const mail = list(" 信件列表  (^P)寫信");
    mail.rowTexts[0] = "【郵件選單】 鴻雁往返";
    expect(availableSearchKinds(mail)).toEqual([]);
    expect(digestKindOf(mail)).toBeNull();
    const boards = list("  選擇看板    (m)加入/移出最愛 (y)只列最愛 ", { listOwner: "board-list" });
    boards.rowTexts[0] = "【看板列表】 批踢踢實業坊";
    expect(availableSearchKinds(boards)).toEqual(["board"]);
    expect(digestKindOf(boards)).toBeNull();
    expect(digestKindOf(list(FULL, { inputField: true }))).toBeNull();
  });
  test("keys are taken on the list only, without modifiers, with easy reading on", () => {
    const facts = list(FULL);
    const prefs = readValuesWithDefault();
    for (const key of ["A", "G", "!", "S", "Backspace", "Tab"])
      expect(shouldInterceptSearchKey({ key, facts, prefs })).toBe(true);
    expect(shouldInterceptSearchKey({ key: "A", facts, prefs, ctrlKey: true })).toBe(false);
    expect(shouldInterceptSearchKey({ key: "A", facts: list(FULL, { listOwner: "board-list" }), prefs })).toBe(false);
    expect(shouldInterceptSearchKey({ key: "A", facts, prefs: { ...prefs, enableEasyReading: false } })).toBe(false);
    // The digest keeps the search keys and adds Tab.
    expect(shouldInterceptSearchKey({ key: "S", facts: list(DIGEST), prefs })).toBe(true);
    expect(shouldInterceptSearchKey({ key: "Tab", facts: list(DIGEST), prefs })).toBe(true);
    expect(shouldInterceptSearchKey({ key: "Tab", facts: list(FULL, { listOwner: "board-list" }), prefs })).toBe(false);
  });
  test("the help menu asks whether the list takes a key", () => {
    expect(searchKeyOpensSheet("G", "article-list")).toBe(true);
    expect(searchKeyOpensSheet("Tab", "article-list")).toBe(true);
    expect(searchKeyOpensSheet("G", "board-list")).toBe(false);
  });
});

describe("the board jump", () => {
  test("it is no kind of the article list's sheet, but `s` and a board-only sheet still reach it", () => {
    const kinds = availableSearchKinds(list(FULL));
    expect(kinds).not.toContain("board");
    expect(withBoardJump(kinds)).toContain("board");
    expect(searchSheetKinds(kinds, "board")).toEqual(["board"]);
    expect(searchSheetKinds(kinds, "title")).toEqual(kinds);
    expect(searchSheetKinds(["board"], "board")).toEqual(["board"]);
    expect(searchSheetKinds([], "board")).toEqual([]);
    expect(searchSheetKinds(kinds, "nonsense")).toEqual([]);
  });
  test("the s key still opens the sheet over an article list", () => {
    const prefs = readValuesWithDefault();
    expect(shouldInterceptSearchKey({ key: "s", facts: list(FULL), prefs })).toBe(true);
    expect(searchKeyOpensSheet("s", "article-list")).toBe(true);
    const { core } = nativeCore(list(FULL));
    expect(tryOpenSearchModal(core, "s", null)).toBe(true);
    expect(core.openSearchModal).toHaveBeenCalledWith("board");
  });
});

describe("input and prompts", () => {
  test("price takes a positive integer of at most 6 digits (read.c: NUMECHO 7, atoi <= 0 cancels)", () => {
    expect(normalizeSearchText("price", " 100 ")).toBe("100");
    expect(normalizeSearchText("price", "007")).toBe("7");
    expect(normalizeSearchText("price", "0")).toBe("");
    expect(normalizeSearchText("price", "-5")).toBe("");
    expect(normalizeSearchText("price", "12a")).toBe("");
    expect(normalizeSearchText("price", "1234567")).toBe("");
  });
  test("exclude takes up to 59 bytes (TTLEN - 4)", () => {
    expect(normalizeSearchText("exclude", "a".repeat(59))).toBe("a".repeat(59));
    expect(normalizeSearchText("exclude", "a".repeat(60))).toBe("");
    expect(normalizeSearchText("exclude", "問".repeat(30))).toBe("");
  });
  test("m and s answer with their own letter; the others carry no text", () => {
    expect(normalizeSearchText("mark", "whatever")).toBe("m");
    expect(normalizeSearchText("solved", "")).toBe("s");
    expect(normalizeSearchText("newPost", "x")).toBe("");
  });
  test.each([
    ["price", "搜尋價格高於多少的文章: "],
    ["price", "增加條件 文章價格: "],
    ["mark", "搜尋標記(m/s)(未輸入則取消): "],
    ["solved", "增加條件 標記(m/s)(未輸入則取消): "],
    ["exclude", "增加條件 排除標題: "],
  ])("%s prompt fingerprint %s", (kind, text) => {
    expect(isSearchPromptFrame(kind, prompt(text))).toBe(true);
    expect(isSearchPromptFrame(kind, list(FULL))).toBe(false);
    // The prompt row must hold the cursor.
    expect(isSearchPromptFrame(kind, { ...prompt(text), curY: 5 })).toBe(false);
  });
  test("exclude has no fresh-search prompt: PTT only shows a vmsg there", () => {
    expect(isSearchPromptFrame("exclude", prompt("搜尋標題: "))).toBe(false);
  });
});

describe("steps", () => {
  test("price: A, the prompt, then the digits and Enter", () => {
    const steps = buildSearchSteps("price", "100");
    expect(steps.map((s) => s.keys)).toEqual(["A", "100\r"]);
    expect(steps[0].expect(null, prompt("搜尋價格高於多少的文章: "))).toBe(true);
  });
  test("G asks m or s on one line: the letter and Enter (vans reads a line)", () => {
    expect(buildSearchSteps("mark", "").map((s) => s.keys)).toEqual(["G", "m\r"]);
    expect(buildSearchSteps("solved", "").map((s) => s.keys)).toEqual(["G", "s\r"]);
  });
  test("exclude: ! then the keyword", () => {
    expect(buildSearchSteps("exclude", "foo").map((s) => s.keys)).toEqual(["!", "foo\r"]);
    expect(buildSearchSteps("exclude", "")).toBeNull();
  });
  test.each([
    ["sameTitle", "S"],
    ["newPost", "\x08"],
    ["digest", "\t"],
    ["digestLeave", "\t"],
  ])("%s is one step with no prompt", (kind, key) => {
    const steps = buildSearchSteps(kind, "");
    expect(steps).toHaveLength(1);
    expect(steps[0].keys).toBe(key);
  });
  test("one-step landing: results for S and Backspace, the digest for Tab", () => {
    const [same] = buildSearchSteps("sameTitle", "");
    expect(same.expect(null, list(RESULTS))).toBe(true);
    expect(same.expect(null, list(FULL))).toBe(false);
    const [enter] = buildSearchSteps("digest", "");
    expect(enter.expect(null, list(DIGEST))).toBe(true);
    expect(enter.expect(null, list(RESULTS))).toBe(false);
    const [leave] = buildSearchSteps("digestLeave", "");
    expect(leave.expect(null, list(FULL))).toBe(true);
    expect(leave.expect(null, list(DIGEST))).toBe(false);
  });
});

describe("search results context", () => {
  test("price, m, s, exclude and thread starters are replayable", () => {
    const filters = [
      { kind: "price", value: "100" },
      { kind: "mark", value: "m" },
      { kind: "solved", value: "s" },
      { kind: "exclude", value: "foo" },
      { kind: "newPost", value: "" },
    ];
    expect(validateSearchResultsContext({ board: "Test", filters })?.filters).toEqual(filters);
  });
  test("a letter other than the kind's own is refused", () => {
    expect(validateSearchResultsContext({ board: "Test", filters: [{ kind: "mark", value: "s" }] })).toBeNull();
    expect(validateSearchResultsContext({ board: "Test", filters: [{ kind: "price", value: "0" }] })).toBeNull();
  });
  test("same title counts in the live context but is never replayed", () => {
    const core = {};
    recordSearchResults(core, { board: "Test", filters: [{ kind: "sameTitle", value: "" }] });
    expect(readSearchResultsContext(core, "Test").filters).toEqual([{ kind: "sameTitle", value: "" }]);
    expect(
      validateSearchResultsContext({ board: "Test", filters: [{ kind: "sameTitle", value: "" }] }),
    ).toBeNull();
  });
});

describe("same title (S)", () => {
  test("subjectOf follows subject_ex: repeated Re:/Fw:, any case, one optional space each", () => {
    expect(subjectOf("Re: [Talk] x")).toBe("[Talk] x");
    expect(subjectOf("RE:Fw: re: [Talk] x")).toBe("[Talk] x");
    expect(subjectOf("Re:  [Talk] x")).toBe(" [Talk] x");
    expect(subjectOf("[Re: not a prefix] x")).toBe("[Re: not a prefix] x");
    expect(subjectOf("Reply: x")).toBe("Reply: x");
    expect(subjectOf(null)).toBe("");
  });
  test("cursorSubject drops the list's type mark, then the prefixes", () => {
    const at = (title) => cursorSubject({ listSession: { selectedPostInfoTarget: () => (title ? { title } : null) } });
    expect(at("□ [Talk] Beta topic")).toBe("[Talk] Beta topic");
    expect(at("■ Re: [Talk] Beta topic")).toBe("[Talk] Beta topic");
    expect(at("R: [Talk] Beta topic")).toBe("[Talk] Beta topic");
    expect(at("")).toBeNull();
    expect(cursorSubject({})).toBeNull();
  });
  test("the S key sends PTT's own S alone, no prompt, and lands on results", () => {
    const { core, sent, settle } = nativeCore(list(FULL));
    core._title = "□ Re: [Talk] Beta topic";
    expect(tryOpenSearchModal(core, "S", null)).toBe(true);
    expect(core.openSearchModal).not.toHaveBeenCalled();
    expect(sent).toEqual(["S\f"]);
    settle(list(RESULTS));
    expect(core.searchInFlight).toBe(false);
    expect(readSearchResultsContext(core, "Test").filters).toEqual([{ kind: "sameTitle", value: "" }]);
    // Not a title search: no title history entry.
    expect(localStorage.getItem("pttchrome.searchHistory.v2")).toBeNull();
  });
  test("it works on the cursor row, so nothing is held back when no title shows", () => {
    const { core, sent } = nativeCore(list(FULL));
    expect(tryOpenSearchModal(core, "S", null)).toBe(true);
    expect(sent).toEqual(["S\f"]);
  });
  test("a second S in the same results is refused locally (PTT would do nothing)", () => {
    const { core, sent, settle, flashListHint } = nativeCore(list(FULL));
    tryOpenSearchModal(core, "S", null);
    settle(list(RESULTS));
    const before = sent.length;
    expect(tryOpenSearchModal(core, "S", null)).toBe(true);
    expect(sent).toHaveLength(before);
    expect(flashListHint).toHaveBeenCalled();
  });
});

describe("running a filter", () => {
  test("A opens the sheet with price; nothing is sent", () => {
    const { core, sent } = nativeCore(list(FULL));
    expect(tryOpenSearchModal(core, "A", null)).toBe(true);
    expect(core.openSearchModal).toHaveBeenCalledWith("price");
    expect(sent).toEqual([]);
  });
  test("G opens the sheet where m and s are chosen", () => {
    const { core } = nativeCore(list(FULL));
    expect(tryOpenSearchModal(core, "G", null)).toBe(true);
    expect(core.openSearchModal).toHaveBeenCalledWith("mark");
  });
  test("a sheet that did not open leaves the key alone", () => {
    const { core } = nativeCore(list(FULL));
    core.openSearchModal = vi.fn(() => false);
    expect(tryOpenSearchModal(core, "A", null)).toBe(false);
  });
  test("! opens the title kind with its exclude box; nothing is sent", () => {
    const { core, sent } = nativeCore(list(RESULTS));
    expect(tryOpenSearchModal(core, "!", null)).toBe(true);
    expect(core.openSearchModal).toHaveBeenCalledWith("title", { exclude: true });
    expect(sent).toEqual([]);
  });
  test("exclude submitted outside results is refused before anything is sent (read.c: vmsg, no prompt)", () => {
    const { core, sent } = nativeCore(list(FULL));
    const onFail = vi.fn();
    expect(submitSearch(core, "exclude", "foo", { onFail })).toBe(true);
    expect(onFail).toHaveBeenCalledWith("search-needs-results");
    expect(sent).toEqual([]);
  });
  test("searchModeOf: results, the digest, and a search made inside the digest", () => {
    expect(searchModeOf(nativeCore(list(FULL)).core)).toMatchObject({ digest: false, select: false });
    expect(searchModeOf(nativeCore(list(RESULTS)).core)).toMatchObject({ digest: false, select: true });
    const { core } = nativeCore(list(DIGEST));
    expect(searchModeOf(core)).toMatchObject({ digest: true, select: false });
    recordSearchResults(core, { board: "Test", filters: [{ kind: "digest", value: "" }, { kind: "title", value: "a" }] });
    expect(searchModeOf(core)).toMatchObject({ digest: true, select: true });
  });
  test("a search inside the digest keeps the digest's 文摘列表 caption and leads its context with the digest", () => {
    const { core, sent, settle } = nativeCore(list(DIGEST));
    expect(submitSearch(core, "title", "foo")).toBe(true);
    settle(prompt("搜尋標題: ", DIGEST));
    settle(list(DIGEST));
    expect(core.searchInFlight).toBe(false);
    expect(sent[sent.length - 1]).toBe("foo\r");
    expect(readSearchResultsContext(core, "Test").filters).toEqual([
      { kind: "digest", value: "" },
      { kind: "title", value: "foo" },
    ]);
    // Replayable: the digest is entered first, then the condition.
    expect(validateSearchResultsContext(readSearchResultsContext(core, "Test"))?.filters).toHaveLength(2);
  });
  test("price submits A, waits for its prompt, then sends the digits", () => {
    const { core, sent, settle } = nativeCore(list(FULL));
    expect(submitSearch(core, "price", "100")).toBe(true);
    expect(sent).toEqual(["A\f"]);
    settle(list(FULL));
    expect(sent).toEqual(["A\f"]);
    settle(prompt("搜尋價格高於多少的文章: "));
    expect(sent).toEqual(["A\f", "100\r"]);
    settle(list(RESULTS));
    expect(readSearchResultsContext(core, "Test").filters).toEqual([{ kind: "price", value: "100" }]);
  });
  test("an added condition after a title search keeps both, in order", () => {
    const { core, settle } = nativeCore(list(FULL));
    submitSearch(core, "title", "foo");
    settle(prompt("搜尋標題: "));
    settle(list(RESULTS));
    submitSearch(core, "mark", "m");
    settle(prompt("增加條件 標記(m/s)(未輸入則取消): ", RESULTS));
    settle(list(RESULTS));
    expect(readSearchResultsContext(core, "Test").filters).toEqual([
      { kind: "title", value: "foo" },
      { kind: "mark", value: "m" },
    ]);
  });
  test("a once-only filter can be used again in a fresh search", () => {
    const { core, sent, settle } = nativeCore(list(FULL));
    tryOpenSearchModal(core, "Backspace", { ctrlKey: false });
    expect(sent).toEqual(["\x08\f"]);
    settle(list(RESULTS));
    // Back on the full list, no results are on screen.
    settle(list(FULL));
    sent.length = 0;
    tryOpenSearchModal(core, "Backspace", null);
    expect(sent).toEqual(["\x08\f"]);
  });
  test("Backspace results can be built on and replayed", () => {
    const { core, settle } = nativeCore(list(FULL));
    tryOpenSearchModal(core, "Backspace", null);
    settle(list(RESULTS));
    const search = readSearchResultsContext(core, "Test");
    expect(search.filters).toEqual([{ kind: "newPost", value: "" }]);
    expect(validateSearchResultsContext(search)?.filters).toEqual(search.filters);
  });
  test("a result list found empty is not recorded", () => {
    const { core, settle } = nativeCore(list(FULL));
    tryOpenSearchModal(core, "Backspace", null);
    const notice = list(FULL, { curY: 23 });
    notice.rowTexts[23] = " ◆ 找不到符合條件的文章。 [按任意鍵繼續]";
    settle(notice);
    expect(readSearchResultsContext(core, "Test")).toBeNull();
  });
  test("Tab enters the digest as PTT does: the search, the trail, the stacked pages go", () => {
    const { core, sent, settle } = nativeCore(list(RESULTS));
    recordSearchResults(core, { board: "Test", filters: [{ kind: "title", value: "foo" }] });
    core.articleShortcutSearch = { noteOtherSearch: vi.fn() };
    core.navigationStack = { leaveSearchPages: vi.fn() };
    expect(tryOpenSearchModal(core, "Tab", null)).toBe(true);
    expect(sent).toEqual(["\t\f"]);
    expect(core.navigationStack.leaveSearchPages).not.toHaveBeenCalled();
    settle(list(DIGEST));
    expect(core.searchInFlight).toBe(false);
    expect(readSearchResultsContext(core, "Test")).toBeNull();
    expect(core.navigationStack.leaveSearchPages).toHaveBeenCalledWith("Test");
    expect(core.articleShortcutSearch.noteOtherSearch).toHaveBeenCalled();
  });
  test("Tab inside the digest leaves it for the full list and drops the searches made there", () => {
    const { core, sent, settle } = nativeCore(list(DIGEST));
    recordSearchResults(core, { board: "Test", filters: [{ kind: "digest", value: "" }, { kind: "title", value: "a" }] });
    core.navigationStack = { leaveSearchPages: vi.fn() };
    expect(tryOpenSearchModal(core, "Tab", null)).toBe(true);
    expect(sent).toEqual(["\t\f"]);
    settle(list(DIGEST));
    expect(core.searchInFlight).toBe(true);
    settle(list(FULL));
    expect(core.searchInFlight).toBe(false);
    expect(readSearchResultsContext(core, "Test")).toBeNull();
    expect(core.navigationStack.leaveSearchPages).toHaveBeenCalledTimes(1);
  });
  test("a Tab that does not land leaves the stack alone", () => {
    const { core, queue } = nativeCore(list(FULL));
    core.navigationStack = { leaveSearchPages: vi.fn() };
    tryOpenSearchModal(core, "Tab", null);
    queue.flush();
    expect(core.navigationStack.leaveSearchPages).not.toHaveBeenCalled();
  });
  test("a busy operation swallows the key with its hint", () => {
    const { core, sent, flashListHint } = nativeCore(list(FULL));
    core.aidNavigation = { active: true, opHint: "busy" };
    core._title = "[Talk] x";
    expect(startFilter(core, "sameTitle")).toBe(true);
    expect(sent).toEqual([]);
    expect(flashListHint).toHaveBeenCalledWith("busy", 3000);
  });
  test("eight known conditions refuse a ninth filter before anything is sent", () => {
    const { core, sent } = nativeCore(list(RESULTS));
    recordSearchResults(core, {
      board: "Test",
      filters: Array.from({ length: 8 }, (_, i) => ({ kind: "title", value: "t" + i })),
    });
    const onFail = vi.fn();
    expect(submitSearch(core, "newPost", "", { onFail })).toBe(true);
    expect(onFail).toHaveBeenCalledWith("search-limit");
    expect(sent).toEqual([]);
  });
});
