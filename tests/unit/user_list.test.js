// @unit-env browser
// PTT's online user list (#199) as real PTT paints it, fed through the app's
// own TermBuf/AnsiParser. Every ID, nickname and place is invented; the
// layout follows a real frame: the blue title bar 【休閒聊天】/【好友列表】
// (bright white, the BBS name bright yellow, cell 79 default), the counts on
// row 1, the black-on-white column header on row 2 (編號 P 代號 暱稱 故鄉 動態
// 發呆), user rows with the number right-aligned in cells 1-6, the ID from
// cell 10 (a friend's ID cells bright cyan), and the footer whose caption
// 「 休閒聊天 」 is blue on cyan and whose hints are black on white with red
// key labels. The footer is on PTT's last row, which lags a resize by one
// redraw.
import { TermBuf } from "../../src/js/term_buf";
import { AnsiParser } from "../../src/js/ansi_parser";
import { u2b } from "../../src/js/string_util";
import {
  FRIEND_LIST_KEY,
  USER_LIST_KEY,
  isUserListKey,
  listHeaderReversed,
  userListKeyOfRow,
  userListViewOfRow,
} from "../../src/js/screen_titles";
import { footerCaption, isUserListFooter, userListFooterRow } from "../../src/js/screen_captions";
import { ListSession, transitionListSession } from "../../src/js/list_session";
import {
  isUserQueryPrompt,
  isUserQueryScreen,
  parseUserListRow,
  selectedUserId,
  userListView,
} from "../../src/js/user_list";
import { buildListCard, buildListEmptyRow } from "../../src/render/list_card";
import { i18n, setupI18n } from "../../src/js/i18n";
import { loadBig5Tables } from "./helpers/load_big5_tables";

setupI18n();

const COLS = 80;

const width = (s) => {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return w;
};
const pad = (s, n) => s + " ".repeat(Math.max(0, n - width(s)));
const padLeft = (s, n) => " ".repeat(Math.max(0, n - width(s))) + s;
const at = (row, col = 0) => "\x1b[" + (row + 1) + ";" + (col + 1) + "H";

const PLACES = ["某地", "*", "東區網路", "西岸"];
const ACTS = ["閱讀文章", "看板列表", "主選單", "使用者名單"];
const IDLES = ["3h06", "0'03", "13h37", "", "35'16"];

// Invented users: { num, id, nick, friend, gone, pager }.
function users(from, count, opts = {}) {
  const out = [];
  for (let i = 0; i < count; ++i) {
    const num = from + i;
    out.push({
      num,
      id: "user" + String(num).padStart(3, "0"),
      nick: num % 5 === 0 ? "" : "暱稱" + num,
      friend: !!(opts.friendNum && opts.friendNum === num),
      gone: !!(opts.goneNum && opts.goneNum === num),
      pager: num % 3 === 0 ? "-" : " ",
    });
  }
  return out;
}

function userRow(u, cursor) {
  const lead = (cursor ? ">" : " ") + padLeft(String(u.num), 6) + " " + u.pager + " ";
  if (u.gone) return lead + "< 離站中..>";
  const id = u.friend ? "\x1b[1;36m" + pad(u.id, 13) + "\x1b[m" : pad(u.id, 13);
  return (
    lead +
    id +
    pad(u.nick, 18) +
    pad(PLACES[u.num % PLACES.length], 17) +
    pad(ACTS[u.num % ACTS.length], 17) +
    padLeft(IDLES[u.num % IDLES.length], 5)
  );
}

const FOOTER_HINTS = [
  ["w", "丟水球 "],
  ["q", "查詢 "],
  ["→", "聊天 "],
  ["m", "寄信 "],
  ["Tab", "排序       "],
  ["←", "離開 "],
  ["h", "說明  "],
];
const EMPTY_FOOTER_HINTS = [
  ["Tab", "排序 "],
  ["f", "好友 "],
  ["s", "搜尋 "],
  ["b", "廣播 "],
  ["S", "顯示切換      "],
  ["←", "離開 "],
  ["h", "說明  "],
];
function footer(hints) {
  let s = "\x1b[34;46m 休閒聊天 \x1b[30;47m ";
  for (const [k, label] of hints) s += "\x1b[31m(" + k + ")\x1b[30m" + label;
  return s + "\x1b[m";
}

// One user-list screen: `rows` terminal rows, PTT's layout `layoutRows`
// (footer on its last row), `list` users on the page, the cursor on `cursor`
// (an index into list).
function userListFrame({
  rows,
  layoutRows = rows,
  view = "all",
  list = [],
  cursor = 0,
  sort = "朋友",
}) {
  const title = view === "friends" ? "【好友列表】" : "【休閒聊天】";
  let s = "\x1b[?2026h\x1b[H\x1b[2J";
  s +=
    "\x1b[1;37;44m" +
    pad(title, 33) +
    "\x1b[33m批踢踢實業坊\x1b[37m" +
    pad("", 4) +
    pad("看板《SomeBoard》", 30) +
    "\x1b[m";
  s +=
    at(1) +
    " 排序:[" + sort + "] 站上:" + (list.length + 40) + " " +
    "\x1b[1;32m朋友:1 \x1b[33m與我為友:1 \x1b[36m板友:0 \x1b[31m壞人:0\x1b[m";
  s +=
    at(2) +
    "\x1b[30;47m" +
    pad("   編號 P 代號         暱稱              故鄉             動態              發呆", COLS) +
    "\x1b[m";
  list.forEach((u, i) => {
    s += at(3 + i) + userRow(u, list.length && i === cursor);
  });
  s += at(layoutRows - 1) + footer(list.length ? FOOTER_HINTS : EMPTY_FOOTER_HINTS);
  s += at(list.length ? 3 + cursor : 3) + "\x1b[?2026l";
  return s;
}

// The help screen over the list: the title keeps 【休閒聊天】, the footer has
// its own caption.
function helpFrame(rows) {
  return (
    "\x1b[H\x1b[2J\x1b[1;37;44m" +
    pad("【休閒聊天】", 32) +
    "\x1b[33m操作說明 (Help)\x1b[37m" +
    pad("", 32) +
    "\x1b[m" +
    at(1) +
    "\x1b[30;47m" +
    pad("  按鍵 / 標籤                   功能說明", 79) +
    "\x1b[m" +
    at(2) +
    "> (h/?) 說明                    顯示操作說明" +
    at(3) +
    "  (f/F) 好友                    切換顯示全部/好友名單" +
    at(rows - 1) +
    "\x1b[34;46m 操作說明 \x1b[30;47m \x1b[31m(↑)\x1b[30m上移 \x1b[31m(↓)\x1b[30m下移\x1b[m" +
    at(2)
  );
}

// The query screen of one user: drawn from row 1 over the list, row 0 kept,
// the 請按任意鍵繼續 bar on PTT's last row (left out after a resize redraw).
function queryFrame(rows, { bar = true, title = "【休閒聊天】" } = {}) {
  let s =
    "\x1b[H\x1b[2J\x1b[1;37;44m" +
    pad(title, 33) +
    "\x1b[33m批踢踢實業坊\x1b[37m" +
    pad("", 34) +
    "\x1b[m";
  const lines = [
    pad("《ＩＤ暱稱》someone (某人)", 40) + "《經濟狀況》清寒",
    pad("《登入次數》12 次 (同天內只計一次)", 40) + "《有效文章》3 篇 (退:0)",
    pad("《目前動態》閱讀文章", 40) + "《私人信箱》最近無新信件",
    pad("《上次上站》01/02/2026 03:04:05 Fri", 40) + "《上次故鄉》某地",
    pad("《 五子棋 》    0 勝     0 敗     0 和", 40) + "《象棋戰績》    0 勝     0 敗     0 和",
    "",
    "《個人名片》someone 目前沒有名片",
  ];
  lines.forEach((t, i) => {
    s += at(1 + i) + t + "\x1b[K";
  });
  if (bar)
    s +=
      at(rows - 1) +
      "\x1b[1;34;44m" +
      "▄".repeat(15) +
      " \x1b[37m請按任意鍵繼續\x1b[34m " +
      "▄".repeat(15) +
      "\x1b[m";
  return s + at(rows - 1, 79);
}

// The `Q` prompt: 【查詢網友】 over the list's title, the prompt and its field
// on row 1, every other row blank.
function queryPromptFrame(rows) {
  let s = at(0, 2) + "\x1b[1;37;44m查詢網友" + at(0, 12) + "\x1b[m\x1b[K";
  s += at(1) + "請輸入使用者代號: \x1b[30;47m" + " ".repeat(13) + "\x1b[m\x1b[K";
  for (let r = 2; r < rows; ++r) s += at(r) + "\x1b[K";
  return s + at(1, 18);
}

describe("the online user list (#199)", () => {
  beforeAll(() => loadBig5Tables());
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function paint(screen, rows, prior) {
    const buf = new TermBuf(COLS, rows);
    buf.setView({
      update() {},
      updateCursorPos() {},
      refreshCursorVisibility() {},
      charset: "big5",
      blinkOn: false,
    });
    buf.useMouseBrowsing = false;
    const parser = new AnsiParser(buf);
    if (prior) parser.feed(u2b(prior));
    parser.feed(u2b(screen));
    vi.advanceTimersByTime(300);
    return buf;
  }

  const factsOf = (buf) =>
    ListSession.prototype._collectFacts.call(
      { _termBuf: buf, _messageRows: () => ({}), _footerText: null },
      null,
    );

  describe("recognition", () => {
    // A full page holds rows-4 users.
    test.each([24, 45, 29])("a full page at 80x%i is the clean user list, never a board", (rows) => {
      const list = users(1, rows - 4, { friendNum: 1 });
      const buf = paint(userListFrame({ rows, list, cursor: 2 }), rows);
      expect(listHeaderReversed(buf)).toBe(true);
      expect(buf.pageState).toBe(2);
      const facts = factsOf(buf);
      expect(facts.kind).toBe("clean-list");
      expect(facts.boardName).toBe(USER_LIST_KEY);
      expect(facts.emptyList).toBe(false);
      expect(facts.cursorRowNum).toBe(3);
      expect(userListView(buf)).toBe("all");
    });

    test.each([24, 45, 29])("the friends view at 80x%i is a list of its own", (rows) => {
      const buf = paint(userListFrame({ rows, view: "friends", list: users(1, 2, { friendNum: 1 }) }), rows);
      const facts = factsOf(buf);
      expect(facts.kind).toBe("clean-list");
      expect(facts.boardName).toBe(FRIEND_LIST_KEY);
      expect(facts.emptyList).toBe(false);
      expect(userListView(buf)).toBe("friends");
    });

    test.each([24, 45, 29])("an empty friends view at 80x%i is still the list, empty", (rows) => {
      const buf = paint(userListFrame({ rows, view: "friends", list: [] }), rows);
      const facts = factsOf(buf);
      expect(facts.kind).toBe("clean-list");
      expect(facts.boardName).toBe(FRIEND_LIST_KEY);
      expect(facts.emptyList).toBe(true);
      expect(userListView(buf)).toBe("friends");
    });

    test("the last page is short: its blank rows sit above the footer", () => {
      const buf = paint(userListFrame({ rows: 28, list: users(97, 4), cursor: 3 }), 28);
      const facts = factsOf(buf);
      expect(facts.kind).toBe("clean-list");
      expect(facts.cursorRowNum).toBe(100);
    });

    // PTT answers a resize at the size it had: a 28-row layout on 29 rows
    // leaves the last row blank under the footer.
    test("the footer is found by its caption when PTT lags a resize", () => {
      const rows = 29;
      const buf = paint(userListFrame({ rows, layoutRows: 28, list: users(1, 24), cursor: 0 }), rows);
      expect(userListFooterRow(buf.lines.map((l, r) => buf.getRowText(r, 0, COLS)))).toBe(27);
      const facts = factsOf(buf);
      expect(facts.kind).toBe("clean-list");
      expect(facts.boardName).toBe(USER_LIST_KEY);
      expect(userListView(buf)).toBe("all");
    });

    test("the cursor must rest on a user row at col 0", () => {
      const rows = 24;
      const frame = userListFrame({ rows, list: users(1, 20), cursor: 0 }).replace(/\x1b\[4;1H\x1b\[\?2026l$/, at(10, 30) + "\x1b[?2026l");
      const facts = factsOf(paint(frame, rows));
      expect(facts.kind).not.toBe("clean-list");
      expect(facts.boardName).toBe(USER_LIST_KEY);
    });

    test("the help screen keeps the title but is not the list", () => {
      const buf = paint(helpFrame(24), 24);
      const facts = factsOf(buf);
      expect(facts.kind).not.toBe("clean-list");
      expect(facts.boardName).toBe(USER_LIST_KEY);
      expect(userListView(buf)).toBe(null);
    });

    test.each([true, false])("the query screen (bar %s) is not the list", (bar) => {
      const rows = 24;
      const buf = paint(queryFrame(rows, { bar }), rows, userListFrame({ rows, list: users(1, 20) }));
      expect(factsOf(buf).kind).not.toBe("clean-list");
      expect(userListView(buf)).toBe(null);
      expect(isUserQueryScreen(buf)).toBe(true);
      expect(isUserQueryPrompt(buf)).toBe(false);
    });

    test("the query screen reached through `Q` keeps 【查詢網友】 on row 0", () => {
      const buf = paint(queryFrame(24, { title: "【查詢網友】" }), 24);
      expect(isUserQueryScreen(buf)).toBe(true);
    });

    test("the `Q` prompt over the list", () => {
      const rows = 24;
      const buf = paint(queryPromptFrame(rows), rows, userListFrame({ rows, list: users(1, 20) }));
      expect(isUserQueryPrompt(buf)).toBe(true);
      expect(isUserQueryScreen(buf)).toBe(false);
      expect(userListView(buf)).toBe(null);
      expect(factsOf(buf).kind).not.toBe("clean-list");
    });

    test("the list itself is neither query screen nor prompt", () => {
      const buf = paint(userListFrame({ rows: 24, list: users(1, 20) }), 24);
      expect(isUserQueryScreen(buf)).toBe(false);
      expect(isUserQueryPrompt(buf)).toBe(false);
    });
  });

  describe("titles and captions", () => {
    test("each view has its own key, and neither is a board", () => {
      expect(userListViewOfRow("【休閒聊天】   批踢踢實業坊   看板《X》")).toBe("all");
      expect(userListViewOfRow("【好友列表】   批踢踢實業坊   看板《X》")).toBe("friends");
      expect(userListViewOfRow("【主功能表】")).toBe(null);
      expect(userListKeyOfRow("【休閒聊天】")).toBe(USER_LIST_KEY);
      expect(userListKeyOfRow("【好友列表】")).toBe(FRIEND_LIST_KEY);
      expect(USER_LIST_KEY).not.toBe(FRIEND_LIST_KEY);
      expect(isUserListKey(USER_LIST_KEY) && isUserListKey(FRIEND_LIST_KEY)).toBe(true);
      expect(isUserListKey("C_Chat")).toBe(false);
    });

    test("both footers carry the 休閒聊天 caption", () => {
      expect(footerCaption(" 休閒聊天  (w)丟水球 (q)查詢")).toBe("休閒聊天");
      expect(isUserListFooter(" 休閒聊天  (Tab)排序 (f)好友")).toBe(true);
      expect(isUserListFooter(" 操作說明  (↑)上移")).toBe(false);
    });

    test("the footer row is the last row that is not blank", () => {
      const rows = ["t", "1", "2", "row", " 休閒聊天  (w)丟水球", "", ""];
      expect(userListFooterRow(rows)).toBe(4);
      expect(userListFooterRow(["t", "1", "2", "row", " 操作說明 ", ""])).toBe(-1);
    });
  });

  describe("rows", () => {
    const rowsOf = (list, opts = {}) => {
      const buf = paint(userListFrame({ rows: 24, list, ...opts }), 24);
      return buf.lines;
    };

    test("a row's identity is its user ID; a friend's bright cyan ID marks it", () => {
      const lines = rowsOf(users(1, 3, { friendNum: 2 }));
      expect(parseUserListRow(lines[3])).toEqual({ id: "user001", friend: false, gone: false });
      expect(parseUserListRow(lines[4])).toEqual({ id: "user002", friend: true, gone: false });
    });

    test("a user who logged off has no ID", () => {
      const lines = rowsOf(users(1, 3, { goneNum: 3 }));
      expect(parseUserListRow(lines[5])).toEqual({ id: null, friend: false, gone: true });
    });

    test("the header, a blank row and the footer are not user rows", () => {
      const lines = rowsOf(users(1, 3));
      expect(parseUserListRow(lines[2])).toBe(null);
      expect(parseUserListRow(lines[10])).toBe(null);
      expect(parseUserListRow(lines[23])).toBe(null);
    });

    test("selectedUserId reads the selected row of the user list held", () => {
      const lines = rowsOf(users(1, 3, { goneNum: 3 }));
      const core = (row, userList = true) => ({
        listSession: { isUserList: () => userList, selectedListRow: () => row },
      });
      expect(selectedUserId(core(lines[4]))).toBe("user002");
      expect(selectedUserId(core(lines[5]))).toBe(null);
      expect(selectedUserId(core(null))).toBe(null);
      expect(selectedUserId(core(lines[4], false))).toBe(null);
      expect(selectedUserId(null)).toBe(null);
    });
  });

  describe("cards", () => {
    const cardOf = (list, index, opts = {}) => {
      const buf = paint(userListFrame({ rows: 24, list, cursor: index, ...opts }), 24);
      return buildListCard({ chars: buf.lines[3 + index], row: 3 + index, kind: "user", forceWidth: 16 }).node;
    };
    const text = (node) => (node ? node.textContent.trim() : "");

    test("line 1: ID and nickname; line 2: number, activity, idle time on the right", () => {
      const card = cardOf(users(1, 3), 1);
      expect(card.getAttribute("data-user-id")).toBe("user002");
      expect(text(card.querySelector(".listCardTitle .listCardUserId"))).toBe("user002");
      expect(text(card.querySelector(".listCardTitle .listCardUserNick"))).toBe("暱稱2");
      expect(text(card.querySelector(".listCardMeta .listCardNum"))).toBe("2");
      expect(text(card.querySelector(".listCardMeta .listCardUserActivity"))).toBe("主選單");
      expect(text(card.querySelector(".listCardMeta .listCardEnd .listCardUserIdle"))).toBe("13h37");
    });

    test("the pager character and the home column are left out", () => {
      const card = cardOf(users(1, 3), 2);
      // User 3's pager is `-`, its home 「東區網路」.
      expect(card.textContent).not.toContain("東區網路");
      expect(card.textContent).not.toContain("-");
    });

    test("a friend is marked", () => {
      const card = cardOf(users(1, 3, { friendNum: 1 }), 0);
      expect(card.hasAttribute("data-user-friend")).toBe(true);
      expect(cardOf(users(1, 3, { friendNum: 1 }), 1).hasAttribute("data-user-friend")).toBe(false);
    });

    test("a user who logged off is greyed with no ID", () => {
      const card = cardOf(users(1, 3, { goneNum: 2 }), 1);
      expect(card.hasAttribute("data-user-gone")).toBe(true);
      expect(card.hasAttribute("data-user-id")).toBe(false);
    });

    test("an empty list's row says so, per view", () => {
      const friends = buildListEmptyRow({ row: 3, view: "friends", cards: true });
      expect(friends.getAttribute("data-list-empty")).toBe("friends");
      expect(friends.classList.contains("listCard")).toBe(true);
      expect(friends.textContent).toBeTruthy();
      expect(friends.textContent).toBe(i18n("list_emptyFriends"));
      const all = buildListEmptyRow({ row: 3, view: "all", cards: false });
      expect(all.classList.contains("listCard")).toBe(false);
      expect(all.textContent).toBe(i18n("list_emptyUsers"));
      expect(all.textContent).not.toBe(friends.textContent);
      expect(all.querySelector('[data-type="bbsline"]').getAttribute("data-row")).toBe("3");
    });
  });

  describe("the session's reducer on an empty user list (invariant 17a)", () => {
    const settle = (over) => ({
      type: "settle",
      kind: "clean-list",
      boardNameMatch: true,
      inFlightKind: null,
      hasNumberedRow: false,
      emptyList: false,
      engageEligible: true,
      holdReason: null,
      ...over,
    });

    test("idle seeds on an empty user list, but not on another frame without numbers", () => {
      expect(transitionListSession("idle", settle({ emptyList: true })).actions).toEqual(["seed", "start-fill"]);
      expect(transitionListSession("idle", settle({})).next).toBe("idle");
    });

    test("active rebuilds when the list empties", () => {
      expect(transitionListSession("active", settle({ emptyList: true }))).toEqual({
        next: "active",
        actions: ["rebuild"],
      });
    });

    test("a native excursion resumes onto an empty user list", () => {
      const probe = settle({ type: "resume-probe", emptyList: true, holdReason: "passthrough", boardNameMatch: false });
      expect(transitionListSession("functionMode", probe)).toEqual({
        next: "active",
        actions: ["resume-buffer", "rebuild"],
      });
      expect(transitionListSession("functionMode", settle({ emptyList: true, boardNameMatch: false })).next).toBe("active");
    });
  });
});
