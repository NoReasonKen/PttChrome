// @unit-env browser
// PTT's user query screen (#199 phase 2) read into fields (and, at the end, the
// query's entrances): talk.c#my_query's
// rows as PttChrome's own TermBuf/AnsiParser read them, then
// user_list.parseUserQueryScreen. Every ID, nickname, place and plan line is
// invented; the layout follows talk.c#my_query (the ID/nickname row padded to
// 25 cells before 經濟狀況, 有效文章 at col 40, 目前動態 padded to 28 cells,
// the 上次上站 row left out for some users, the plan from row 7 or the
// 「目前沒有名片」 line) and the 請按任意鍵繼續 bar on PTT's last row.
import { TermBuf } from "../../src/js/term_buf";
import { AnsiParser } from "../../src/js/ansi_parser";
import { u2b } from "../../src/js/string_util";
import { parseUserQueryScreen, userQueryAlert } from "../../src/js/user_list";
import { loadBig5Tables } from "./helpers/load_big5_tables";
import { UserQuery, queryUser, promptUserQuery } from "../../src/js/user_query";
import { i18n, setupI18n } from "../../src/js/i18n";
import { serializedOpHint } from "../../src/js/serialized_op_gate";
import { mobileToolbarContext } from "../../src/js/mobile_toolbar";
import { UNSUPPORTED_KEY_HINT, unsupportedPasteHint, unsupportedTextHint } from "../../src/js/unsupported_hint";

const COLS = 80;
const width = (s) => {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return w;
};
const pad = (s, n) => s + " ".repeat(Math.max(0, n - width(s)));
const at = (row, col = 0) => "\x1b[" + (row + 1) + ";" + (col + 1) + "H";

const TITLE =
  "\x1b[1;37;44m" + pad("【休閒聊天】", 33) + "\x1b[33m批踢踢實業坊\x1b[37m" + pad("", 34) + "\x1b[m";
const BAR =
  "\x1b[1;34;44m" + "▄".repeat(15) + " \x1b[37m請按任意鍵繼續\x1b[34m " + "▄".repeat(15) + "\x1b[m";

// One query screen. `lastLogin: false` leaves the 上次上站 row out; `plan`
// is the plan's lines (drawn from row 7), or null for a user without one.
function queryScreen(rows, { id = "tester9", nick = "測試暱稱", lastLogin = true, plan = null, bar = true } = {}) {
  const idNick = "《ＩＤ暱稱》" + id + " (" + nick + ")";
  const lines = [
    pad(idNick, 12 + 25 + 3) + "《經濟狀況》小康 ($1234)",
    pad("《登入次數》345 次 (同天內只計一次)", 40) + "《有效文章》67 篇 (退:1)",
    "\x1b[1;33m" + pad("《目前動態》看板列表", 12 + 28) + "\x1b[m《私人信箱》有新進信件還沒看",
  ];
  if (lastLogin) lines.push(pad("《上次上站》03/04/2026 05:06:07 Wed", 12 + 28) + "《上次故鄉》某個地方");
  lines.push("《 五子棋 》    1 勝     2 敗     3 和  《象棋戰績》    4 勝     5 敗     0 和");
  let s = "\x1b[H" + TITLE + at(1) + "\x1b[J";
  lines.forEach((t, i) => {
    s += at(1 + i) + t;
  });
  if (plan) plan.forEach((t, i) => (s += at(7 + i) + t));
  else s += at(1 + lines.length) + "《個人名片》" + id + " 目前沒有名片";
  if (bar) s += at(rows - 1) + BAR;
  return s + at(rows - 1, 79);
}

function alertScreen(rows, status) {
  return (
    "\x1b[H\x1b[2J\x1b[1;37;44m 使用限制 \x1b[33m " + status + " \x1b[m" +
    at(2) + "  \x1b[1;31m操作過於頻繁，請稍後再試\x1b[m" +
    at(rows - 1) + BAR + at(rows - 1, 79)
  );
}

describe("the user query screen (#199 phase 2)", () => {
  beforeAll(() => loadBig5Tables());
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function textsOf(screen, rows = 24) {
    const buf = new TermBuf(COLS, rows);
    buf.setView({ update() {}, updateCursorPos() {}, refreshCursorVisibility() {}, charset: "big5", blinkOn: false });
    buf.useMouseBrowsing = false;
    new AnsiParser(buf).feed(u2b(screen));
    vi.advanceTimersByTime(300);
    const texts = [];
    for (let r = 0; r < rows; ++r) texts.push(buf.getRowText(r, 0, buf.cols));
    return texts;
  }

  test("every field of a user without a plan", () => {
    expect(parseUserQueryScreen(textsOf(queryScreen(24)))).toEqual({
      id: "tester9",
      nick: "測試暱稱",
      money: "小康 ($1234)",
      logins: "345 次 (同天內只計一次)",
      posts: "67 篇 (退:1)",
      activity: "看板列表",
      mail: "有新進信件還沒看",
      lastLogin: "03/04/2026 05:06:07 Wed",
      lastHost: "某個地方",
      five: "1 勝 2 敗 3 和",
      chess: "4 勝 5 敗 0 和",
      plan: [],
    });
  });

  test("a plan is read as its lines, inner blank lines kept, the bar left out", () => {
    const plan = ["  歡迎來到我的名片", "", "  這裡是第三行 ~~~"];
    const parsed = parseUserQueryScreen(textsOf(queryScreen(24, { plan })));
    expect(parsed.plan).toEqual(plan);
    expect(parsed.chess).toBe("4 勝 5 敗 0 和");
  });

  test("a user whose 上次上站 row PTT leaves out has those fields empty", () => {
    const parsed = parseUserQueryScreen(textsOf(queryScreen(24, { lastLogin: false })));
    expect(parsed).toMatchObject({ lastLogin: "", lastHost: "", activity: "看板列表", five: "1 勝 2 敗 3 和", plan: [] });
    const withPlan = parseUserQueryScreen(textsOf(queryScreen(24, { lastLogin: false, plan: ["名片一行"] })));
    expect(withPlan).toMatchObject({ lastLogin: "", plan: ["名片一行"] });
  });

  test("a frame drawn before the bar and a taller screen read the same", () => {
    expect(parseUserQueryScreen(textsOf(queryScreen(24, { bar: false })))).toMatchObject({ id: "tester9", plan: [] });
    expect(parseUserQueryScreen(textsOf(queryScreen(40, { plan: ["名片"] })))).toMatchObject({ id: "tester9", plan: ["名片"] });
  });

  test("a nickname with spaces and parentheses, and an empty one", () => {
    expect(parseUserQueryScreen(textsOf(queryScreen(24, { nick: "a (b) c" }))).nick).toBe("a (b) c");
    expect(parseUserQueryScreen(textsOf(queryScreen(24, { nick: "" }))).nick).toBe("");
  });

  test("other screens are not a query screen", () => {
    expect(parseUserQueryScreen(textsOf(alertScreen(24, "查詢")))).toBe(null);
    expect(parseUserQueryScreen(textsOf("\x1b[H" + TITLE + at(1) + "請輸入使用者代號: "))).toBe(null);
    expect(parseUserQueryScreen([])).toBe(null);
  });

  test("the usage-limit alert: a denial or a slowdown, with its reason", () => {
    expect(userQueryAlert(textsOf(alertScreen(24, "查詢")))).toEqual({
      status: "denied",
      reason: "操作過於頻繁，請稍後再試",
    });
    expect(userQueryAlert(textsOf(alertScreen(24, "限速中")))).toMatchObject({ status: "slowed" });
    expect(userQueryAlert(textsOf(queryScreen(24)))).toBe(null);
  });
});

// The query's entrances (user_query.queryUser / promptUserQuery) over a stub
// App: the one availability predicate, the busy refusal (a hint, nothing sent)
// and the keys the query starts with.
describe("the user query entrances (#199 phase 2)", () => {
  beforeAll(() => setupI18n());

  function stubCore({ userList = true, state = "active", ...rest } = {}) {
    const hints = [];
    const begun = [];
    const modals = [];
    const ls = {
      state,
      isUserList: () => userList,
      beginUserQuery: (steps) => begun.push(steps),
      resumeAfterHelp: () => {},
    };
    const core = {
      listSession: ls,
      activeListSession: () => ls,
      buf: { listRenderMode: "buffer" },
      view: { flashListHint: (text) => hints.push(text) },
      setModalOpen: (source, open) => modals.push([source, open]),
      openUserQuerySheet: vi.fn(() => true),
      ...rest,
    };
    core.userQuery = new UserQuery(core);
    return { core, hints, begun, modals };
  }

  test("on the user list a card's query sends `Q` first, the ID and Enter as the next step", () => {
    const { core, begun, modals } = stubCore();
    expect(queryUser(core, "user005")).toBe(true);
    expect(begun).toHaveLength(1);
    expect(begun[0].map((s) => s.keys)).toEqual(["Q", "user005\r"]);
    expect(modals).toEqual([["userQuery", true]]);
    expect(core.userQuery.busy).toBe(true);
    // A second query while the first runs is refused with a hint.
    const before = begun.length;
    expect(queryUser(core, "user006")).toBe(false);
    expect(begun).toHaveLength(before);
  });

  test("while another operation runs: a hint, nothing sent, no sheet", () => {
    const { core, hints, begun } = stubCore({ searchInFlight: true });
    expect(queryUser(core, "user005")).toBe(false);
    expect(promptUserQuery(core)).toBe(false);
    expect(begun).toEqual([]);
    expect(core.openUserQuerySheet).not.toHaveBeenCalled();
    expect(hints).toEqual(["搜尋中，請稍候…", "搜尋中，請稍候…"]);
  });

  test("away from the user list: unavailable, a hint, nothing sent", () => {
    const { core, hints, begun } = stubCore({ userList: false });
    expect(core.userQuery.available()).toBe(false);
    expect(queryUser(core, "user005")).toBe(false);
    expect(promptUserQuery(core)).toBe(false);
    expect(begun).toEqual([]);
    expect(hints).toEqual([i18n("userQuery_unavailable"), i18n("userQuery_unavailable")]);
  });

  test("the sheet opens on the user list; an ID PTT could not have is not sent", () => {
    const { core, begun } = stubCore();
    expect(promptUserQuery(core)).toBe(true);
    expect(core.openUserQuerySheet).toHaveBeenCalledTimes(1);
    expect(queryUser(core, "9abc")).toBe(false);
    expect(queryUser(core, "a".repeat(13))).toBe(false);
    expect(begun).toEqual([]);
  });
});

describe("the user query page's input (#199)", () => {
  beforeAll(() => setupI18n());

  // A core whose query page shows: `modals` are the open modal sources.
  function shownCore(modals = ["userQuery"]) {
    const hints = [];
    const core = {
      _openModals: new Set(modals),
      view: { flashListHint: (text, ms, level) => hints.push([text, level]) },
      _refreshScreenContext: () => {},
      listSession: { continueUserQuery: vi.fn(() => true) },
      buf: { cols: 80, rows: 24 },
    };
    const q = new UserQuery(core);
    core.userQuery = q;
    q.phase = "shown";
    q._page = { firstChild: { scrollTop: 100, clientHeight: 300, scrollHeight: 900 } };
    q.dismiss = vi.fn();
    return { core, q, hints };
  }
  const key = (k, extra) => ({ key: k, ctrlKey: false, altKey: false, metaKey: false, ...extra });

  test("the page's keys act; every other key of the keypad is refused with the easy-reading hint", () => {
    const { q, hints } = shownCore();
    for (const k of ["q", "Escape", "ArrowLeft"]) expect(q.takeKey(key(k), true)).toBe(true);
    expect(q.dismiss).toHaveBeenCalledTimes(3);
    expect(q.takeKey(key("ArrowDown"), true)).toBe(true);
    expect(q._page.firstChild.scrollTop).toBeGreaterThan(100);
    expect(hints).toEqual([]);
    // Enter, →, Backspace, Tab, Del and a letter never reach the list held under the page.
    for (const k of ["Enter", "ArrowRight", "Backspace", "Tab", "Delete", "y"]) expect(q.takeKey(key(k), true)).toBe(true);
    expect(hints).toHaveLength(6);
    expect(hints[0]).toEqual([UNSUPPORTED_KEY_HINT, "error"]);
    expect(q.dismiss).toHaveBeenCalledTimes(3);
  });

  test("the keyboard passes a modified key and a browser key, and refuses a letter, Enter and Backspace", () => {
    const { q, hints } = shownCore();
    expect(q.takeKey(key("r", { ctrlKey: true }))).toBe(false);
    expect(q.takeKey(key("F5"))).toBe(false);
    expect(q.takeKey(key("Shift"))).toBe(false);
    expect(hints).toEqual([]);
    for (const k of ["a", "Enter", "Backspace"]) expect(q.takeKey(key(k))).toBe(true);
    expect(hints).toHaveLength(3);
  });

  test("a sheet over the page keeps its own keys and text", () => {
    const { q, hints } = shownCore(["userQuery", "more"]);
    expect(q.ownsInput()).toBe(false);
    expect(q.takeKey(key("q"), true)).toBe(false);
    expect(q.refuseText("你好", "text")).toBe(false);
    expect(q.dismiss).not.toHaveBeenCalled();
    expect(hints).toEqual([]);
  });

  test("text that is no single key is refused as text or as a paste", () => {
    const { q, hints } = shownCore();
    expect(q.refuseText("你好", "text")).toBe(true);
    expect(q.refuseText("abc", "paste")).toBe(true);
    expect(hints.map((h) => h[0])).toEqual([unsupportedTextHint("查詢頁"), unsupportedPasteHint("查詢頁")]);
  });

  test("the toolbar: Keys and More work over the page, the list's entries stay off; before it shows the bar is locked", () => {
    const { core, q } = shownCore();
    core._screenContext = { appBar: null };
    const on = mobileToolbarContext(core);
    expect(on).toMatchObject({ queryPage: true, locked: false, push: false, reply: false, end: false, refresh: false,
      post: false, userQuery: false, unreadJump: false, markAllRead: false, userListToggle: null, contentTools: false });
    expect(on.search).toEqual([]);
    q.phase = "typing";
    q._listAppBar = { kind: "other", title: "list", subtitle: "", time: "", byline: "", newMail: false };
    expect(mobileToolbarContext(core)).toMatchObject({ queryPage: false, locked: true });
  });
});

describe("the user query's lifecycle (#199 review)", () => {
  beforeAll(() => setupI18n());

  // A core on the user list; `begun` holds the steps of the query.
  function liveCore() {
    const hints = [];
    const begun = [];
    const modals = new Set();
    const dismissers = [];
    const ls = {
      state: "active",
      isUserList: () => true,
      beginUserQuery: (steps) => begun.push(steps),
      continueUserQuery: vi.fn(() => true),
      resumeAfterHelp: vi.fn(),
    };
    const core = {
      listSession: ls,
      activeListSession: () => ls,
      buf: { listRenderMode: "buffer" },
      _openModals: modals,
      view: { flashListHint: (t) => hints.push(t), navigationEnded: vi.fn() },
      setModalOpen: (s, open) => (open ? modals.add(s) : modals.delete(s)),
      registerSheetDismiss: (fn) => {
        dismissers.push(fn);
        return () => dismissers.splice(dismissers.indexOf(fn), 1);
      },
      _refreshScreenContext: () => {},
    };
    core.userQuery = new UserQuery(core);
    return { core, hints, begun, modals, dismissers, ls };
  }
  const settled = () => new Promise((r) => queueMicrotask(r));

  test("a disconnect in 'typing' releases everything the query holds", () => {
    const { core, modals, dismissers, ls } = liveCore();
    const q = core.userQuery;
    expect(q.query("user005")).toBe(true);
    q.phase = "typing";
    expect(q.busy).toBe(true);
    expect(dismissers).toHaveLength(1);
    q.reset();
    expect(q.phase).toBe("idle");
    expect(q.busy).toBe(false);
    expect(q.holding).toBe(false);
    expect(modals.size).toBe(0);
    expect(dismissers).toHaveLength(0);
    expect(core.view.navigationEnded).toHaveBeenCalled();
    expect(ls.resumeAfterHelp).not.toHaveBeenCalled();
    expect(serializedOpHint(core)).toBe(null);
  });

  test("a disconnect with the page shown removes the page and its listeners", () => {
    const { core, modals, dismissers } = liveCore();
    const q = core.userQuery;
    q.query("user005");
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const main = document.createElement("div");
    document.body.appendChild(main);
    core.view.mainDisplay = main;
    q._show({ id: "user005", nick: "", plan: [] });
    const keydowns = add.mock.calls.filter((c) => c[0] === "keydown").length;
    expect(keydowns).toBe(1);
    expect(document.querySelector("[data-user-query-page]")).not.toBeNull();
    q.reset();
    expect(document.querySelector("[data-user-query-page]")).toBeNull();
    expect(remove.mock.calls.filter((c) => c[0] === "keydown")).toHaveLength(1);
    expect(remove.mock.calls.filter((c) => c[0] === "resize")).toHaveLength(1);
    expect(q.busy).toBe(false);
    expect(modals.size).toBe(0);
    expect(dismissers).toHaveLength(0);
    main.remove();
    add.mockRestore();
    remove.mockRestore();
  });

  test("a modified key of the keyboard is the browser's (Ctrl+q, Alt+←); the keypad's is refused", () => {
    const { core, hints } = liveCore();
    const q = core.userQuery;
    q.phase = "shown";
    q._page = { firstChild: { scrollTop: 0, clientHeight: 300, scrollHeight: 900 } };
    q.dismiss = vi.fn();
    const k = (key, x) => ({ key, ctrlKey: false, altKey: false, metaKey: false, ...x });
    expect(q.takeKey(k("q", { ctrlKey: true }))).toBe(false);
    expect(q.takeKey(k("ArrowLeft", { altKey: true }))).toBe(false);
    expect(q.takeKey(k("Home", { ctrlKey: true }))).toBe(false);
    expect(q.dismiss).not.toHaveBeenCalled();
    expect(q.takeKey(k("q", { ctrlKey: true }), true)).toBe(true);
    expect(q.dismiss).not.toHaveBeenCalled();
    expect(hints).toHaveLength(1);
  });

  test("a query for a user who logged off says so", () => {
    const { core, hints, begun } = liveCore();
    expect(queryUser(core, null)).toBe(false);
    expect(begun).toEqual([]);
    expect(hints).toEqual([i18n("userQuery_gone")]);
  });

  test("the system Back during the run is the query's: a busy hint, never a way out", () => {
    const { core, hints, dismissers } = liveCore();
    const q = core.userQuery;
    q.query("user005");
    q.phase = "typing";
    expect(dismissers).toHaveLength(1);
    dismissers[0]();
    expect(hints).toEqual([i18n("userQuery_busy")]);
    q.phase = "leaving";
    dismissers[0]();
    expect(hints).toHaveLength(2);
    expect(q.phase).toBe("leaving");
    // Shown: the same Back leaves the page.
    q.phase = "shown";
    q._page = { firstChild: {} };
    q.dismiss = vi.fn();
    dismissers[0]();
    expect(q.dismiss).toHaveBeenCalledTimes(1);
  });

  test("an ID that PTT never answered: one more key makes PTT leave before the list takes its frame back", async () => {
    const { core, begun, ls, modals } = liveCore();
    const q = core.userQuery;
    q.query("user005");
    q.phase = "typing";
    begun[0][1].onFail();
    expect(ls.continueUserQuery).toHaveBeenCalledTimes(1);
    const step = ls.continueUserQuery.mock.calls[0][0];
    expect(step.keys).toBe("\r");
    expect(ls.resumeAfterHelp).not.toHaveBeenCalled();
    expect(q.holding).toBe(true);
    // PTT does not answer that either: the list takes the frame, with the hint.
    step.onFail();
    expect(q.phase).toBe("idle");
    expect(ls.resumeAfterHelp).toHaveBeenCalledTimes(1);
    expect(modals.size).toBe(0);
    await settled();
  });

  test("a leave that could not be sent falls back to the list at once", () => {
    const { core, ls } = liveCore();
    const q = core.userQuery;
    q.query("user005");
    q.phase = "shown";
    q._page = document.createElement("div");
    core.buf = { listRenderMode: "buffer", rows: 0 };
    ls.continueUserQuery.mockReturnValue(false);
    // The screen is not the query screen: dismiss falls to _fail.
    q.dismiss();
    expect(q.phase).toBe("idle");
    expect(ls.resumeAfterHelp).toHaveBeenCalledTimes(1);
  });
});
