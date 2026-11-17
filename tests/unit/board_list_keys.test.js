// @unit-env browser
// Board-list easy-reading input contract (#192), the board-list counterpart of
// list_keys / list_paste / list_text_input (#159): easy reading keeps only the
// keys of the features it presents. Every other key, Alt-remapped key, footer
// button byte, paste and typed text is refused with the error-level hint and
// nothing reaches PTT. Help (`h`) is presented: PTT's help screen is asked for
// through the serialized sequence, the help menu sheet shows it over the board
// list, and a closed sheet gives the list back as the reader left it.
// PttChrome's own sequences (_beginPassthroughBytes) are unchanged.
import { BoardListSession } from "../../src/js/board_list_session";
import { helpItemKey, splitHelpKeys } from "../../src/js/help_menu";
import { BRD_CMD_PREFIX } from "../../src/js/list_render_owner";
import { UNSUPPORTED_KEY_HINT, unsupportedPasteHint, unsupportedTextHint } from "../../src/js/unsupported_hint";

const pad7 = (n) => String(n).padStart(7, " ");
const brdRow = (num, name) =>
  pad7(num) + "  " + String(name).padEnd(13, " ") + "綜合  ｜閒聊｜ 測試看板";
const FOOT_FAV =
  "  選擇看板    (a)增加看板 (s)進入已知板名 (y)列出全部 (v/V)已讀/未讀";
// A class's boards (board.c's footer for IN_CLASS).
const FOOT_CLASS =
  "  選擇看板    (m)加入/移出最愛 (s)進入已知板名 (v/V)已讀/未讀 ";
const HEADER_NUM =
  "   編號   看  板       類別   中   文   敘   述               人氣 板   主";

function brdScreenRows({ startNum = 1, count = 20, foot = FOOT_FAV } = {}) {
  const rowTexts = ["【看板列表】 批踢踢實業坊", "[←][q]回上層 [↑↓]選擇", HEADER_NUM];
  for (let i = 0; i < 20; ++i)
    rowTexts.push(i < count ? brdRow(startNum + i, "B" + (startNum + i)) : "");
  rowTexts.push(foot);
  return rowTexts;
}

// A screen that is no board list (PTT's help screen, as far as the session
// can tell).
const HELP_ROWS = ["【看板列表】 操作說明 (Help)", "", "  按鍵 / 標籤   功能說明"].concat(
  new Array(21).fill("")
);

const charOf = (ch) => ({ ch, isLeadByte: false, resetAttr() {} });
const rowChars = (text) => Array.from({ length: 80 }, (_, i) => charOf(text[i] || " "));

function seedBuffer(termBuf, startNum, count) {
  termBuf.brdListLines = [];
  termBuf.brdListLineNums = [];
  for (let i = 0; i < count; ++i) {
    termBuf.brdListLines.push(rowChars(brdRow(startNum + i, "B" + (startNum + i))));
    termBuf.brdListLineNums.push(startNum + i);
  }
}

function makeSession() {
  window.localStorage.setItem(
    "pttchrome.pref.v1",
    JSON.stringify({ values: { enableEasyReading: true } })
  );
  const enqueued = [];
  const sent = [];
  const hints = [];
  const helpCalls = [];
  const core = {
    conn: { isConnected: true, send: (d) => sent.push(d) },
    helpMenu: { expect: (requester) => helpCalls.push(requester) },
  };
  const view = {
    chh: 0,
    hideCursor() {},
    showCursor() {},
    resetBoardListAccumulation() {},
    flashListHint: (...a) => hints.push(a),
    promptListInput: null,
    componentScreen: null,
  };
  let settleListener = null;
  const termBuf = {
    rows: 24,
    cols: 80,
    lines: [],
    brdListLines: [],
    brdListLineNums: [],
    listRenderMode: "native",
    listRenderOwner: null,
    lineChangeds: new Array(24).fill(false),
    changed: false,
    settleSnapshot: null,
    startedEasyReading: false,
    _rowTexts: new Array(24).fill(""),
    getRowText(r) {
      return this._rowTexts[r] || "";
    },
    addEventListener(name, fn) {
      if (name === "screenSettled") settleListener = fn;
    },
    notify() {},
    show(rowTexts, { curX = 0, curY = 3 } = {}) {
      this._rowTexts = rowTexts;
      this.cur_x = curX;
      this.cur_y = curY;
    },
    feed(rowTexts, opts = {}) {
      this.show(rowTexts, opts);
      this.settleSnapshot = {
        curX: this.cur_x,
        curY: this.cur_y,
        changedRows: new Set([3]),
        cursorMoved: true,
      };
      settleListener();
    },
  };
  const queue = {
    idle: true,
    inFlightKind: null,
    enqueue(cmd) {
      enqueued.push(cmd);
    },
    onSettle() {
      return null;
    },
    flush() {
      this.flushed = (this.flushed || 0) + 1;
    },
    flushPending() {},
    flushPendingKind() {},
    expedite() {},
    hasKind(prefix) {
      return enqueued.some((c) => (c.kind || "").indexOf(prefix) === 0);
    },
    flushKind() {},
  };
  const s = new BoardListSession(core, view, termBuf, queue);
  return { s, termBuf, queue, enqueued, sent, hints, helpCalls, core };
}

// Engaged over a buffer of 40 boards; the reader's selection (7) is ahead of
// PTT's real cursor (1), so a key that acted on the cursor would need a sync leg.
function engaged({ foot = FOOT_FAV } = {}) {
  const h = makeSession();
  h.termBuf.feed(brdScreenRows({ foot }));
  expect(h.s.state).toBe("active");
  seedBuffer(h.termBuf, 1, 40);
  h.enqueued.length = 0;
  h.hints.length = 0;
  h.s._selectedNum = 7;
  h.s._serverNum = 1;
  h.s._topNum = 5;
  h.s._scrollFrac = 3;
  return h;
}

const keyEvent = (key, mods = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
});

const KEY_HINT = UNSUPPORTED_KEY_HINT;
const PASTE_HINT = unsupportedPasteHint("列表");
const TEXT_HINT = unsupportedTextHint("列表");

function expectUntouched(h) {
  expect(h.sent).toEqual([]);
  expect(h.enqueued).toEqual([]);
  expect(h.s.state).toBe("active");
  expect(h.s._renderMode).toBe("buffer");
  expect(h.s._holdReason).toBe(null);
  expect(h.s._selectedNum).toBe(7);
  expect(h.s._variant).not.toBe(null); // the buffer is not dropped
  expect(h.termBuf.brdListLines.length).toBe(40);
}

function expectRefused(h, e, hint = KEY_HINT) {
  if (e) expect(e.defaultPrevented).toBe(true);
  expectUntouched(h);
  expect(h.hints).toEqual([[hint, 4000, "error"]]);
}

afterEach(() => localStorage.clear());

describe("BoardListSession refuses keys easy reading does not present (#192)", () => {
  // Every board.c / psb.c command the board list does not present
  // (boardlist_cmds, board_admin_cmds, myfav_cmds, board_fav_cmds,
  // bbs_global_cmds), plus keys PTT ignores.
  const UNSUPPORTED = [
    ["/", {}], // board_cmd_search_keyword
    ["w", {}], // board_cmd_save_brc
    ["y", {}], // fav_cmd_yank
    ["a", {}], // fav_cmd_add_board
    ["m", {}], // fav_cmd_toggle_or_del
    ["d", {}],
    ["z", {}],
    ["M", { shiftKey: true }], // fav_cmd_move
    ["g", {}], // fav_cmd_add_folder
    ["L", { shiftKey: true }], // fav_cmd_add_line_or_link
    ["T", { shiftKey: true }], // fav_cmd_edit_title
    ["K", { shiftKey: true }], // fav_cmd_backup
    ["*", { shiftKey: true }], // fav_cmd_tag_all
    ["D", { shiftKey: true }], // board_cmd_del_link
    ["E", { shiftKey: true }], // board_cmd_edit_board
    ["B", { shiftKey: true }], // board_cmd_new_board
    ["x", {}], // nothing on the board list
    ["s", { ctrlKey: true }], // Ctrl-S board_cmd_search_local
    ["w", { ctrlKey: true }], // Ctrl-W board_cmd_whereami
    ["z", { ctrlKey: true }], // Ctrl-Z ZA
    ["u", { ctrlKey: true }], // Ctrl-U online users
    ["r", { ctrlKey: true }], // Ctrl-R waterball reply
    ["x", { ctrlKey: true }], // not a clipboard key
    ["p", { ctrlKey: true }], // Ctrl-P paste tagged boards (board.c beats psb.c's up alias)
    ["d", { ctrlKey: true }], // Ctrl-D tagged boards
    ["e", { ctrlKey: true }], // Ctrl-E untag all
    ["t", { ctrlKey: true }], // Ctrl-T untag all
    ["y", { ctrlKey: true }], // Ctrl-Y whereami
    ["j", { ctrlKey: true }], // not a PTT alias of anything kept
    ["]", { ctrlKey: true }],
    ["Tab", {}],
    ["Backspace", {}],
    ["Insert", {}],
  ];
  test.each(UNSUPPORTED)(
    "%s %j → prevented, nothing enqueued or sent, list kept, error hint",
    (key, mods) => {
      const h = engaged();
      const e = keyEvent(key, mods);
      h.s.onKeyDown(e);
      expectRefused(h, e);
    }
  );

  test("a refused key leaves the next key working", () => {
    const h = engaged();
    h.s.onKeyDown(keyEvent("w"));
    h.hints.length = 0;
    h.s.onKeyDown(keyEvent("w"));
    expect(h.hints).toEqual([[KEY_HINT, 4000, "error"]]);
    h.s.onKeyDown(keyEvent("j"));
    expect(h.s._selectedNum).toBe(8);
  });

  test("browser keys stay with the browser: clipboard Ctrl-C/A/V, non-letter Alt, keys with no byte", () => {
    for (const [key, mods] of [
      ["c", { ctrlKey: true }],
      ["a", { ctrlKey: true }],
      ["v", { ctrlKey: true }],
      ["5", { altKey: true, code: "Digit5" }],
      ["ArrowLeft", { altKey: true, code: "ArrowLeft" }],
      ["F2", {}],
    ]) {
      const h = engaged();
      const e = keyEvent(key, mods);
      h.s.onKeyDown(e);
      expect(e.defaultPrevented).toBe(false);
      expectUntouched(h);
      expect(h.hints).toEqual([]);
    }
  });
});

describe("Alt remap (Alt = PTT's Ctrl) is refused on the board list", () => {
  test.each([
    ["w", "KeyW"],
    ["s", "KeyS"],
    ["t", "KeyT"],
    ["b", "KeyB"], // must not page up locally (b is PgUp on the board list)
    ["j", "KeyJ"],
    ["c", "KeyC"], // not eaten by the clipboard early return
    ["∑", "KeyW"], // macOS ⌥W
    ["Dead", "KeyE"], // macOS ⌥E
  ])("Alt+%s (%s) → refused, selection unchanged", (key, code) => {
    const h = engaged();
    const e = keyEvent(key, { altKey: true, code });
    h.s.onKeyDown(e);
    expectRefused(h, e);
  });
});

// PTT's help screen lists aliases (psb.c): a kept function does the same thing
// for every key PTT lists for it.
describe("aliases of kept functions behave exactly like their base key", () => {
  const ALIASES = [
    ["Ctrl-N", ["n", { ctrlKey: true }], ["ArrowDown", {}]],
    ["Ctrl-B", ["b", { ctrlKey: true }], ["PageUp", {}]],
    ["Ctrl-F", ["f", { ctrlKey: true }], ["PageDown", {}]],
    ["Q", ["Q", { shiftKey: true }], ["q", {}]],
    ["H", ["H", { shiftKey: true }], ["h", {}]],
    ["?", ["?", { shiftKey: true }], ["h", {}]],
  ];
  const BYTE_ALIASES = [
    ["\x0e", "\x1b[B"],
    ["\x02", "\x1b[5~"],
    ["\x06", "\x1b[6~"],
    ["Q", "\x1b[D"],
    ["H", "h"],
    ["?", "h"],
  ];
  const observe = (h) => ({
    sent: h.sent,
    enqueued: h.enqueued.map((q) => [q.kind, q.keys]),
    hints: h.hints,
    state: h.s.state,
    mode: h.s._renderMode,
    selected: h.s._selectedNum,
    helpCalls: h.helpCalls.length,
  });

  test.each(ALIASES)("%s key = base key", (_name, alias, base) => {
    const a = engaged();
    const e = keyEvent(alias[0], alias[1]);
    a.s.onKeyDown(e);
    expect(e.defaultPrevented).toBe(true);
    expect(a.hints).toEqual([]);
    const b = engaged();
    b.s.onKeyDown(keyEvent(base[0], base[1]));
    expect(observe(a)).toEqual(observe(b));
  });

  test.each(BYTE_ALIASES)("footer byte %j = base byte", (alias, base) => {
    const a = engaged();
    expect(a.s.onFunctionKey(alias)).toBe(true);
    expect(a.hints).toEqual([]);
    const b = engaged();
    expect(b.s.onFunctionKey(base)).toBe(true);
    expect(observe(a)).toEqual(observe(b));
  });

  test("`E` is not an alias of leave: it is board_cmd_edit_board and stays refused", () => {
    const h = engaged();
    h.s.onKeyDown(keyEvent("E", { shiftKey: true }));
    expectRefused(h, null);
  });
});

describe("other user entrances are refused the same way", () => {
  test("footer-button bytes easy reading does not present → refused", () => {
    for (const bytes of ["y", "/", "\x13", "w"]) {
      const h = engaged();
      expect(h.s.onFunctionKey(bytes)).toBe(true);
      expectRefused(h, null);
    }
  });

  test("the footer's `s` button opens PttChrome's board search sheet, like the `s` key", () => {
    const h = engaged();
    const opened = [];
    h.core.buf = h.termBuf;
    h.core.openSearchModal = (kind) => opened.push(kind) || true;
    expect(h.s.onFunctionKey("s")).toBe(true);
    expect(opened).toEqual(["board"]);
    expectUntouched(h);
    expect(h.hints).toEqual([]);
  });

  test("footer-button bytes it presents still work (←, PgDn)", () => {
    const h = engaged();
    expect(h.s.onFunctionKey("\x1b[6~")).toBe(true);
    expect(h.hints).toEqual([]);
    const h2 = engaged();
    expect(h2.s.onFunctionKey("\x1b[D")).toBe(true);
    expect(h2.enqueued[0].kind).toBe(BRD_CMD_PREFIX + "leave-sync-jump");
  });

  test("adoptUserBytes: bytes reaching the wire exit over the buffer are refused", () => {
    const h = engaged();
    expect(h.s.adoptUserBytes("\x18")).toBe(true);
    expectRefused(h, null);
  });

  test("adoptUserBytes with opts.conv → the text hint", () => {
    const h = engaged();
    expect(h.s.adoptUserBytes("測試", { conv: true })).toBe(true);
    expectRefused(h, null, TEXT_HINT);
  });

  test("paste over the buffer → refused with the paste hint", () => {
    const h = engaged();
    expect(h.s.onPaste("SYSOP")).toBe(true);
    expectRefused(h, null, PASTE_HINT);
  });

  test("IME text over the buffer → refused with the text hint", () => {
    const h = engaged();
    expect(h.s.noteTextInput("測試")).toBe(true);
    expectRefused(h, null, TEXT_HINT);
  });

  test("paste / text when not engaged (native) → false: the ordinary send path owns it", () => {
    const h = makeSession();
    expect(h.s._renderMode).toBe("native");
    expect(h.s.onPaste("SYSOP")).toBe(false);
    expect(h.s.noteTextInput("測試")).toBe(false);
    expect(h.enqueued).toEqual([]);
    expect(h.hints).toEqual([]);
  });

  test("paste / text while a transaction is in flight (frozen) → swallowed with the busy hint", () => {
    const h = engaged();
    h.s.onKeyDown(keyEvent("v")); // in-place transaction: sync leg in flight, frozen
    expect(h.s._renderMode).toBe("frozen");
    h.hints.length = 0;
    const n = h.enqueued.length;
    expect(h.s.onPaste("SYSOP")).toBe(true);
    expect(h.s.noteTextInput("測試")).toBe(true);
    expect(h.enqueued.length).toBe(n);
    expect(h.hints.length).toBe(2);
    expect(h.hints[0][0]).not.toBe(PASTE_HINT);
  });
});

describe("help (`h`) is presented by the help menu sheet over the board list", () => {
  function askHelp(via = "key") {
    const h = engaged();
    if (via === "key") {
      const e = keyEvent("h");
      h.s.onKeyDown(e);
      expect(e.defaultPrevented).toBe(true);
    } else {
      expect(h.s.onFunctionKey("h")).toBe(true);
    }
    // The real cursor lags (1 vs 7), and `h` goes out at once all the same
    // (#222): no cursor sync before it. A command picked from the sheet is
    // typed on the list later and syncs the cursor itself.
    expect(h.enqueued.map((c) => c.kind)).toEqual([BRD_CMD_PREFIX + "help"]);
    expect(h.enqueued[0].keys).toBe("h");
    expect(h.s._renderMode).toBe("native");
    return h;
  }

  test("h asks for the sheet with the board list as requester; no native hint", () => {
    const h = askHelp();
    expect(h.helpCalls).toEqual([h.s]);
    expect(h.s.state).toBe("functionMode");
    expect(h.s._holdReason).toBe("passthrough");
    expect(h.hints).toEqual([]);
    // The rows the reader sees stay held for the way back.
    expect(h.termBuf.brdListLines.length).toBe(40);
  });

  test("a background fetch on the wire is cut short, not waited out, before h", () => {
    const h = engaged();
    const calls = [];
    h.queue.inFlightKind = BRD_CMD_PREFIX + "fetch-up";
    h.queue.expedite = (ms) => calls.push("expedite:" + ms);
    h.queue.flushPendingKind = (prefix) => calls.push("drop:" + prefix);
    h.s.onKeyDown(keyEvent("h"));
    expect(calls).toEqual(["drop:" + BRD_CMD_PREFIX + "fetch", "expedite:250"]);
    expect(h.enqueued.at(-1).keys).toBe("h");
  });

  test("the sheet's rows follow the list's keys (wouldRefuse)", () => {
    const h = engaged();
    const refused = (key, ctrlKey = false) => h.s.wouldRefuse({ key, ctrlKey });
    // Kept: navigation, open, leave, number jump, board search (the search
    // sheet), the in-place marks.
    // the view switches (#221; `S` on the favorites opens the reorder sheet).
    for (const k of ["ArrowUp", "PageDown", "Home", "End", "ArrowRight", "ArrowLeft", "1", "s", "t", "v", "c", "C", "S"])
      expect(refused(k)).toBe(false);
    expect(refused("b", true)).toBe(false); // Ctrl-B, the page-up alias
    // Refused (#192): editing the favorites, other searches, PTT's own screens.
    for (const k of ["a", "d", "g", "M", "/", "y", "*"]) expect(refused(k)).toBe(true);
    for (const k of ["d", "s", "u", "z"]) expect(refused(k, true)).toBe(true);
  });

  // #222: a row lists several keys; its pick types the first one the list
  // keeps, the non-digit keys first (a digit starts a number jump).
  test("a help row's pick is the first key the board list keeps, non-digits first", () => {
    const h = engaged();
    const pick = (keysText) => helpItemKey({ keys: splitHelpKeys(keysText) }, (k) => h.s.wouldRefuse(k));
    expect(pick("0/Home")).toEqual({ key: "Home", ctrlKey: false });
    expect(pick("PgUp/P/b/^B")).toEqual({ key: "PageUp", ctrlKey: false });
    expect(pick("y/s")).toEqual({ key: "s", ctrlKey: false }); // y refused, s kept
    expect(pick("^S/1")).toEqual({ key: "1", ctrlKey: false }); // only the digit is kept
    expect(pick("a/i")).toBeNull(); // every key refused: unavailable
    expect(pick("h/H")).toBeNull(); // the help keys
    expect(pick("1-9")).toBeNull();
  });

  test("the footer's help button takes the same route", () => {
    const h = askHelp("button");
    expect(h.helpCalls).toEqual([h.s]);
  });

  test("closed sheet (listKept) → the list comes back as the reader left it, no rebuild", () => {
    const h = askHelp();
    h.enqueued[0].onDone && h.enqueued[0].onDone();
    h.termBuf.feed(HELP_ROWS, { curY: 23 });
    // PTT redraws its board list page (rows 1..20) after q, its cursor where
    // it was (1): nothing moved it there.
    h.termBuf.show(brdScreenRows(), { curY: 3 });
    h.enqueued.length = 0;
    h.s.resumeAfterHelp(true);
    expect(h.s.state).toBe("active");
    expect(h.s._renderMode).toBe("buffer");
    expect(h.s._holdReason).toBe(null);
    expect(h.termBuf.brdListLines.length).toBe(40); // not re-seeded
    expect(h.s._selectedNum).toBe(7); // the reader's selection
    expect(h.s._serverNum).toBe(1); // PTT's cursor, synced by the next command that needs it
    expect(h.s._topNum).toBe(5); // the reader's scroll position, not PTT's page top
    expect(h.s._scrollFrac).toBe(3);
  });

  test("closed sheet after the reader scrolled since the last render → back where they scrolled to", () => {
    // _topNum is only refreshed at render time; the viewport's scrollTop is
    // what the reader sees (found by the board-list e2e: the list came back
    // at the old render's anchor, 477px away).
    const h = engaged();
    h.s._view.chh = 20;
    h.s._view.componentScreen = {
      getListScrollTop: () => 11 * 20 + 4, // row index 11 = board 12, 4px into it
      hasListViewport: () => true,
    };
    h.s.onKeyDown(keyEvent("h"));
    h.enqueued[0].onDone && h.enqueued[0].onDone();
    h.termBuf.show(brdScreenRows(), { curY: 3 + 6 });
    h.s.resumeAfterHelp(true);
    expect(h.s.state).toBe("active");
    expect(h.s._topNum).toBe(12);
    expect(h.s._scrollFrac).toBe(4);
  });

  test("closed sheet, but PTT shows another list (variant or names differ) → rebuilt from PTT's page", () => {
    const h = askHelp();
    h.enqueued[0].onDone && h.enqueued[0].onDone();
    const rows = brdScreenRows();
    rows[3 + 6] = brdRow(7, "Other");
    h.termBuf.show(rows, { curY: 3 + 6 });
    h.s.resumeAfterHelp(true);
    expect(h.s.state).toBe("active");
    expect(h.termBuf.brdListLines.length).toBe(0); // _seed dropped the old rows
    expect(h.s._topNum).toBe(1);
  });

  test("left otherwise (not closed) → resumes at once by re-seeding from PTT's page", () => {
    const h = askHelp();
    h.enqueued[0].onDone && h.enqueued[0].onDone();
    h.termBuf.show(brdScreenRows(), { curY: 3 + 6 });
    h.s.resumeAfterHelp(false);
    expect(h.s.state).toBe("active");
    expect(h.termBuf.brdListLines.length).toBe(0);
    expect(h.s._topNum).toBe(1);
    expect(h.s._selectedNum).toBe(7);
  });

  test("not back on a board list → stays on native for the idle probe; held rows are dropped", () => {
    const h = askHelp();
    h.enqueued[0].onDone && h.enqueued[0].onDone();
    h.termBuf.show(HELP_ROWS, { curY: 23 });
    h.s.resumeAfterHelp(true);
    expect(h.s.state).toBe("functionMode");
    expect(h.s._renderMode).toBe("native");
    expect(h.s._helpList).toBe(null);
  });

  test("the reading record's restore after a closed sheet applies at once (no lingering pending view)", () => {
    const h = askHelp();
    h.enqueued[0].onDone && h.enqueued[0].onDone();
    h.termBuf.show(brdScreenRows(), { curY: 3 + 6 });
    h.s.resumeAfterHelp(true);
    h.s.requestViewportRestore({ variant: h.s._variant, topNum: 5, scrollFrac: 3, cursorNum: 7 });
    expect(h.s._pendingViewport.adopted).toBe(true);
  });
});

describe("PttChrome's own serialized sequences still pass through (_beginPassthroughBytes)", () => {
  test("a one-step sequence still syncs the cursor, then sends with \\f repaint", () => {
    const h = engaged();
    h.s._beginPassthroughBytes("/");
    expect(h.enqueued[0].kind).toBe(BRD_CMD_PREFIX + "native-sync-jump");
    h.enqueued[0].onDone();
    expect(h.enqueued[1].kind).toBe(BRD_CMD_PREFIX + "native-key");
    expect(h.enqueued[1].keys).toBe("/");
    expect(h.s._renderMode).toBe("native");
  });
});

// ---- The list's view switches (#221) -----------------------------------------
//
// PTT's `c` (board_cmd_toggle_newflag) switches the number column between the
// board's position and its article total (header 編號 ↔ 總數); `S`
// (board_cmd_sort) switches a class's boards between PTT's by-name and
// by-class order (the account flag UF_BRDSORT). Easy reading presents `c` on
// the favorites and a class's boards, `S` on a class's boards (not the class
// root, whose order is always by class; not the favorites, where PTT's `S` rewrites the saved order): the list
// stays on screen while PTT answers, then is rebuilt from PTT's new page alone.

const HEADER_COUNTS = HEADER_NUM.replace("編號", "總數");
// The article-count view: totals in the number column (here 100 + position).
function countRows({ startNum = 1, count = 20, name = (n) => "B" + n, foot = FOOT_FAV } = {}) {
  const rowTexts = ["【看板列表】 批踢踢實業坊", "[←][q]回上層 [↑↓]選擇", HEADER_COUNTS];
  for (let i = 0; i < 20; ++i)
    rowTexts.push(i < count ? brdRow(100 + startNum + i, name(startNum + i)) : "");
  rowTexts.push(foot);
  return rowTexts;
}
function numberRows({ startNum = 1, count = 20, name = (n) => "B" + n, foot = FOOT_FAV } = {}) {
  const rowTexts = brdScreenRows({ startNum, count, foot });
  for (let i = 0; i < count; ++i) rowTexts[3 + i] = brdRow(startNum + i, name(startNum + i));
  return rowTexts;
}
const rowOf = (num) => 3 + ((num - 1) % 20);
// PTT's favorites reorder prompt over the list (board.c#board_cmd_sort).
function favSortPromptRows() {
  const rowTexts = brdScreenRows();
  rowTexts[21] = "重新排序看板 (注意, 這個動作會覆寫原來設定)";
  rowTexts[22] = "";
  rowTexts[23] = "排序方式 (1)按照板名排序 (2)按照類別排序 ==> [0]取消";
  return rowTexts;
}
const textOf = (row) => row.map((c) => c.ch).join("").trimEnd();

// term_view.accumulateBoardListLines in small: a redraw over the buffer takes
// the rows the session says sit where (newflagRowNums), or reads their numbers.
function withAccumulation(h) {
  const { s, termBuf } = h;
  termBuf.notify = function () {
    if (s._renderMode !== "buffer") return;
    const texts = this._rowTexts;
    const counted = s.newflagRowNums(texts, this.cur_x, this.cur_y);
    const map = new Map(termBuf.brdListLineNums.map((n, i) => [n, termBuf.brdListLines[i]]));
    for (let r = 3; r <= 22; ++r) {
      const m = /^\s*(\d+)/.exec(texts[r] || "");
      const num = counted !== undefined ? counted[r] : m ? Number(m[1]) : null;
      if (num != null) map.set(num, rowChars(texts[r]));
    }
    const nums = [...map.keys()].sort((a, b) => a - b);
    termBuf.brdListLineNums = nums;
    termBuf.brdListLines = nums.map((n) => map.get(n));
  };
  return h;
}

// PTT draws `rows` with its cursor on `curY`; the leg sees that frame.
function land(h, cmd, rows, curY) {
  h.termBuf.show(rows, { curY });
  cmd.onSend?.();
  return cmd.expect(null, h.s._collectFacts(null));
}

// `c` from the numbered list through to the article-count view, the
// selection on 7.
function toCounts(h, foot = FOOT_FAV) {
  h.s.onKeyDown(keyEvent("c"));
  const key = h.enqueued.at(-1);
  expect(land(h, key, countRows({ foot }), 3)).toBe(true);
  key.onDone();
  const sync = h.enqueued.at(-1);
  expect(land(h, sync, countRows({ foot }), rowOf(7))).toBe(true);
  sync.onDone();
  h.enqueued.length = 0;
  h.hints.length = 0;
}

describe("view switches `c`/`C` and `S` on the easy-reading board list (#221)", () => {
  test("c → the list freezes on screen; `c` goes out with a repaint; no native, no hint", () => {
    const h = engaged();
    const e = keyEvent("c");
    h.s.onKeyDown(e);
    expect(e.defaultPrevented).toBe(true);
    expect(h.hints).toEqual([]);
    expect(h.s.state).toBe("functionMode");
    expect(h.s._renderMode).toBe("frozen");
    expect(h.s._holdReason).toBe(null);
    expect(h.termBuf.brdListLines.length).toBe(40);
    expect(h.enqueued.map((c) => [c.kind, c.keys, c.fullRepaint])).toEqual([
      [BRD_CMD_PREFIX + "list-toggle", "c", true],
    ]);
  });

  test("S on a class's boards sends `S` the same way", () => {
    const h = engaged({ foot: FOOT_CLASS });
    h.s.onKeyDown(keyEvent("S", { shiftKey: true }));
    expect(h.enqueued.map((c) => [c.kind, c.keys])).toEqual([[BRD_CMD_PREFIX + "list-toggle", "S"]]);
    expect(h.s._renderMode).toBe("frozen");
  });

  test("C, the hot-key row's buttons and the entrances all do what the key does", () => {
    const observe = (h) => [h.enqueued.map((c) => [c.kind, c.keys]), h.hints, h.s.state, h.s._renderMode];
    const base = engaged();
    base.s.onKeyDown(keyEvent("c"));
    for (const run of [
      (h) => h.s.onKeyDown(keyEvent("C", { shiftKey: true })),
      (h) => expect(h.s.onFunctionKey("c")).toBe(true),
      (h) => expect(h.s.toggleCounts()).toBe(true),
    ]) {
      const h = engaged();
      run(h);
      expect(observe(h)).toEqual(observe(base));
    }
    const sortKey = engaged({ foot: FOOT_CLASS });
    sortKey.s.onKeyDown(keyEvent("S", { shiftKey: true }));
    for (const run of [(h) => h.s.onFunctionKey("S"), (h) => h.s.toggleSort()]) {
      const h = engaged({ foot: FOOT_CLASS });
      run(h);
      expect(observe(h)).toEqual(observe(sortKey));
    }
  });

  test("busy: a switch while a transaction is in flight shows the hint and sends nothing", () => {
    const h = engaged();
    h.s.onKeyDown(keyEvent("c"));
    h.enqueued.length = 0;
    h.s.onKeyDown(keyEvent("S", { shiftKey: true }));
    expect(h.s.toggleCounts()).toBe(true);
    expect(h.enqueued).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(h.hints).toEqual([["看板列表：指令處理中，請稍候…"], ["看板列表：指令處理中，請稍候…"]]);
  });

  test("the favorites: S, its entrance and its palette way in open the reorder sheet; nothing is sent", () => {
    // PTT's `S` on the favorites asks how to rewrite their saved order
    // (board.c#board_cmd_sort, IS_LISTING_FAV): easy reading asks first.
    for (const run of [
      (h) => {
        const e = keyEvent("S", { shiftKey: true });
        h.s.onKeyDown(e);
        expect(e.defaultPrevented).toBe(true);
      },
      (h) => expect(h.s.onFunctionKey("S")).toBe(true),
      (h) => expect(h.s.toggleSort()).toBe(true),
    ]) {
      const h = engaged();
      let asked = 0;
      h.core.openFavSortChoice = () => ++asked > 0;
      expect(h.s._variant).toBe("fav");
      expect(h.s.listToggles()).toEqual({ counts: false, sort: "favorites" });
      run(h);
      expect(asked).toBe(1);
      expectUntouched(h);
      expect(h.hints).toEqual([]);
    }
    // No sheet to ask with: refused.
    const h = engaged();
    const e = keyEvent("S", { shiftKey: true });
    h.s.onKeyDown(e);
    expectRefused(h, e);
  });

  test("the favorites reordered: `S`, PTT's prompt answered with the pick and Enter, then rebuilt from the landed page", () => {
    for (const [order, answer] of [["name", "1"], ["class", "2"]]) {
      const h = withAccumulation(engaged());
      let changed = 0;
      h.core.homeDashboard = { favoritesChanged: () => ++changed };
      expect(h.s.reorderFavorites(order)).toBe(true);
      expect(h.s.state).toBe("functionMode");
      expect(h.s._renderMode).toBe("frozen");
      const key = h.enqueued[0];
      expect([key.kind, key.keys, !!key.fullRepaint]).toEqual([BRD_CMD_PREFIX + "fav-sort", "S", false]);
      expect(land(h, key, numberRows(), 3)).toBe(false);
      expect(land(h, key, favSortPromptRows(), 23)).toBe(true);
      key.onDone();
      expect(h.s._renderMode).toBe("frozen"); // through PTT's prompt
      const ans = h.enqueued[1];
      expect([ans.kind, ans.keys, ans.fullRepaint]).toEqual([BRD_CMD_PREFIX + "fav-sort-answer", answer + "\r", true]);
      expect(land(h, ans, favSortPromptRows(), 23)).toBe(false);
      const reversed = (n) => "B" + (21 - n);
      expect(land(h, ans, numberRows({ name: reversed }), 3)).toBe(true);
      ans.onDone();
      expect(changed).toBe(1);
      const sync = h.enqueued[2];
      expect([sync.kind, sync.keys]).toEqual([BRD_CMD_PREFIX + "list-toggle-sync", "7\r"]);
      expect(land(h, sync, numberRows({ name: reversed }), rowOf(7))).toBe(true);
      sync.onDone();
      expect(h.s.state).toBe("active");
      expect(h.s._renderMode).toBe("buffer");
      expect(h.termBuf.brdListLineNums.length).toBe(20);
      expect(h.s._selectedNum).toBe(14); // B7 is 14th now
      expect(h.hints.at(-1)[0]).toBe("已重新排序我的最愛");
    }
  });

  test("the favorites reordered: busy shows the hint; off the favorites nothing is taken; a timeout fails visibly", () => {
    const busy = engaged();
    busy.s.onKeyDown(keyEvent("c"));
    busy.enqueued.length = 0;
    expect(busy.s.reorderFavorites("name")).toBe(true);
    expect(busy.enqueued).toEqual([]);
    expect(busy.hints).toEqual([["看板列表：指令處理中，請稍候…"]]);

    const cls = engaged({ foot: FOOT_CLASS });
    expect(cls.s.reorderFavorites("name")).toBe(false);
    expect(engaged().s.reorderFavorites("other")).toBe(false);
    expect(cls.enqueued).toEqual([]);

    for (const leg of [0, 1]) {
      const h = withAccumulation(engaged());
      h.s.reorderFavorites("class");
      if (leg === 1) {
        expect(land(h, h.enqueued[0], favSortPromptRows(), 23)).toBe(true);
        h.enqueued[0].onDone();
      }
      h.enqueued[leg].onFail("timeout");
      expect(h.s.failed()).toBe(true);
      expect(h.s._renderMode).toBe("frozen");
      expect(h.hints.at(-1)).toEqual(["重新排序我的最愛逾時，下拉重新整理以重試", 4000, "error"]);
      expect(h.enqueued.length).toBe(leg + 1);
    }
  });

  test("the class root (#229): c, C and S are refused (no header shows the view; the order never changes)", () => {
    for (const [key, mods] of [["c", {}], ["C", { shiftKey: true }]]) {
      const h = engaged();
      h.s._variant = "classroot";
      const e = keyEvent(key, mods);
      h.s.onKeyDown(e);
      expectRefused(h, e);
    }
    const h = engaged();
    h.s._variant = "classroot";
    expect(h.s.listToggles()).toBe(null);
    expect(h.s.toggleCounts()).toBe(true);
    expect(h.enqueued).toEqual([]);
    expect(h.hints).toEqual([[KEY_HINT, 4000, "error"]]);
    const sortKey = engaged();
    sortKey.s._variant = "classroot";
    const e = keyEvent("S", { shiftKey: true });
    sortKey.s.onKeyDown(e);
    expectRefused(sortKey, e);
  });

  test("listToggles: what the entrances offer, and the view the list shows", () => {
    const h = withAccumulation(engaged());
    expect(h.s.listToggles()).toEqual({ counts: false, sort: "favorites" });
    toCounts(h);
    expect(h.s.listToggles()).toEqual({ counts: true, sort: "favorites" });
    const cls = engaged({ foot: FOOT_CLASS });
    expect(cls.s._variant).toBe("class");
    expect(cls.s.listToggles()).toEqual({ counts: false, sort: "switch" });
    const idle = makeSession();
    expect(idle.s.listToggles()).toBe(null);
    expect(idle.s.toggleCounts()).toBe(false);
  });

  test("c lands: the list is rebuilt from PTT's article-count page alone, the selection kept", () => {
    const h = withAccumulation(engaged());
    h.s._pendingViewport = { topNum: 30, scrollFrac: 0, variant: "fav", cursorNum: 31, at: Date.now(), adopted: true, fills: 0 };
    h.s.onKeyDown(keyEvent("c"));
    expect(h.s._pendingViewport).toBe(null); // the reading record's stale anchor is never restored
    const key = h.enqueued[0];
    // Not yet: PTT still shows the numbered view, or another screen.
    expect(land(h, key, numberRows(), 3)).toBe(false);
    expect(land(h, key, HELP_ROWS, 3)).toBe(false);
    expect(land(h, key, countRows(), 3)).toBe(true);
    key.onDone();
    expect(h.s._renderMode).toBe("frozen"); // still on screen while PTT moves its cursor
    const sync = h.enqueued[1];
    expect([sync.kind, sync.keys, sync.fullRepaint]).toEqual([BRD_CMD_PREFIX + "list-toggle-sync", "7\r", true]);
    expect(land(h, sync, countRows(), rowOf(3))).toBe(false); // PTT's cursor not on 7 yet
    expect(land(h, sync, countRows(), rowOf(7))).toBe(true);
    sync.onDone();
    expect(h.s.state).toBe("active");
    expect(h.s._renderMode).toBe("buffer");
    expect(h.s._selectedNum).toBe(7);
    expect(h.s._serverNum).toBe(7);
    // PTT's page only: none of the 40 numbered rows held before is mixed in.
    expect(h.termBuf.brdListLineNums).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(textOf(h.termBuf.brdListLines[6])).toBe(brdRow(107, "B7").trimEnd()); // the total shows
    expect(h.s._rowTextOf(7)).toBe(brdRow(7, "B7").padEnd(80, " ")); // read as its position
    expect(h.hints.at(-1)[0]).toBe("看板列表改顯示文章數");
  });

  test("c again lands back on the numbered view", () => {
    const h = withAccumulation(engaged());
    toCounts(h);
    h.s.onKeyDown(keyEvent("c"));
    const key = h.enqueued[0];
    expect(land(h, key, countRows(), 3)).toBe(false);
    expect(land(h, key, numberRows(), 3)).toBe(true);
    key.onDone();
    const sync = h.enqueued[1];
    expect(land(h, sync, numberRows(), rowOf(7))).toBe(true);
    sync.onDone();
    expect(h.s._newflag).toBe(false);
    expect(h.s._selectedNum).toBe(7);
    expect(textOf(h.termBuf.brdListLines[6])).toBe(brdRow(7, "B7").trimEnd());
    expect(h.hints.at(-1)[0]).toBe("看板列表改顯示看板編號");
  });

  test("S lands: rebuilt from the reordered page; the selected board stays selected when that page shows it", () => {
    const foot = FOOT_CLASS;
    const h = withAccumulation(engaged({ foot }));
    h.s.onKeyDown(keyEvent("S", { shiftKey: true }));
    const key = h.enqueued[0];
    const reversed = (n) => "B" + (21 - n);
    expect(land(h, key, numberRows({ name: reversed, foot }), 3)).toBe(true);
    key.onDone();
    const sync = h.enqueued[1];
    expect(sync.keys).toBe("7\r");
    expect(land(h, sync, numberRows({ name: reversed, foot }), rowOf(7))).toBe(true);
    sync.onDone();
    expect(h.termBuf.brdListLineNums.length).toBe(20);
    expect(h.s._selectedNum).toBe(14); // B7 is 14th now
    expect(h.hints.at(-1)[0]).toBe("已切換看板排序（依板名／依類別）");
  });

  test("S in the article-count view: the reordered page is placed by PTT's cursor, not the old names", () => {
    const foot = FOOT_CLASS;
    const h = withAccumulation(engaged({ foot }));
    toCounts(h, foot);
    h.s.onKeyDown(keyEvent("S", { shiftKey: true }));
    const key = h.enqueued[0];
    const reversed = (n) => "B" + (21 - n);
    expect(land(h, key, countRows({ name: reversed, foot }), 3)).toBe(true);
    key.onDone();
    const sync = h.enqueued[1];
    expect(land(h, sync, countRows({ name: reversed, foot }), rowOf(7))).toBe(true);
    sync.onDone();
    expect(h.s._newflag).toBe(true);
    expect(h.s._rowTextOf(14)).toBe(brdRow(14, "B7").padEnd(80, " "));
    expect(h.s._selectedNum).toBe(14);
  });

  test("a leg that times out fails visibly: the list stays frozen with the retry hint, nothing more is sent", () => {
    for (const leg of [0, 1]) {
      const h = withAccumulation(engaged());
      h.s.onKeyDown(keyEvent("c"));
      if (leg === 1) {
        expect(land(h, h.enqueued[0], countRows(), 3)).toBe(true);
        h.enqueued[0].onDone();
      }
      const n = h.enqueued.length;
      h.enqueued[leg].onFail("timeout");
      expect(h.s.failed()).toBe(true);
      expect(h.s._renderMode).toBe("frozen");
      expect(h.hints.at(-1)).toEqual(["切換顯示方式逾時，下拉重新整理以重試", 4000, "error"]);
      expect(h.enqueued.length).toBe(n);
      expect(h.termBuf.brdListLines.length).toBe(40); // the list stays on screen
    }
  });
});

describe("the article-count view on the easy-reading board list (#221)", () => {
  test("a list never switched by easy reading is not taken over in the article-count view", () => {
    const h = makeSession();
    h.termBuf.feed(countRows());
    expect(h.s.state).toBe("idle");
  });

  test("a page the session cannot place, or one of the other view, is never mixed in", () => {
    const h = withAccumulation(engaged());
    toCounts(h);
    const none = new Array(24).fill(null);
    // The numbered view's rows while the list shows totals.
    expect(h.s.newflagRowNums(numberRows({ startNum: 21 }), 0, 3)).toEqual(none);
    // A page past the list's rows, with no jump that sent PTT there.
    expect(h.s.newflagRowNums(countRows({ startNum: 41, name: (n) => "X" + n }), 0, 3)).toEqual(none);
    // A half-drawn frame (no footer).
    expect(h.s.newflagRowNums(countRows().slice(0, 23).concat([""]), 0, 3)).toEqual(none);
  });

  test("the fetch that fills the list places its page by the jump it sent", () => {
    const h = withAccumulation(engaged());
    toCounts(h);
    h.s._maybeFill();
    const fetch = h.enqueued.at(-1);
    expect([fetch.kind, fetch.keys]).toEqual([BRD_CMD_PREFIX + "fetch-down", "21\r"]);
    expect(land(h, fetch, countRows({ startNum: 21, count: 5 }), 3)).toBe(true);
    h.termBuf.notify();
    expect(h.termBuf.brdListLineNums.at(-1)).toBe(25);
    expect(h.s._rowTextOf(25)).toBe(brdRow(25, "B25").padEnd(80, " "));
  });

  test("End walks down with fetches (PTT's End page does not say where it is), then selects the last row", () => {
    const h = withAccumulation(engaged());
    toCounts(h);
    h.s.onKeyDown(keyEvent("End"));
    let leg = h.enqueued.at(-1);
    expect([leg.kind, leg.keys]).toEqual([BRD_CMD_PREFIX + "fetch-down", "21\r"]);
    expect(land(h, leg, countRows({ startNum: 21, count: 5 }), 3)).toBe(true);
    h.termBuf.notify();
    leg.onDone();
    leg = h.enqueued.at(-1);
    expect(leg.keys).toBe("26\r");
    // search_num clamps to the last board: PTT stays on that page.
    expect(land(h, leg, countRows({ startNum: 21, count: 5 }), rowOf(25))).toBe(true);
    h.termBuf.notify();
    leg.onDone();
    expect(h.s._edgeDown).toBe(true);
    expect(h.s._selectedNum).toBe(25);
    expect(h.enqueued.some((c) => c.keys === "\x1b[4~")).toBe(false);
  });

  // PTT's `c` flips choose_board's own `newflag`: a group or folder opened
  // from the count view is a new choose_board(0), numbered; Back reloads the
  // outer list still in its count view, PTT's cursor on the first unread
  // board from the row opened (board.c#brdlist_loader).
  test("count view → a group's boards → Back: the outer list comes back in the count view, placed by a jump to the row opened", () => {
    const foot = FOOT_CLASS;
    const h = withAccumulation(engaged({ foot }));
    toCounts(h, foot);
    h.s.onKeyDown(keyEvent("Enter"));
    const open = h.enqueued.at(-1);
    expect([open.kind, open.keys]).toEqual([BRD_CMD_PREFIX + "open-board", "\r"]);
    const group = numberRows({ count: 5, name: (n) => "G" + n, foot });
    expect(land(h, open, group, 3)).toBe(true);
    open.onDone();
    h.termBuf.feed(group, { curY: 3 });
    expect(h.s.state).toBe("active");
    expect(h.s._newflag).toBe(false);
    expect(h.s._rowTextOf(1)).toBe(brdRow(1, "G1").padEnd(80, " "));
    h.enqueued.length = 0;

    h.s.onKeyDown(keyEvent("ArrowLeft"));
    const leave = h.enqueued.at(-1);
    expect(leave.kind).toBe(BRD_CMD_PREFIX + "leave");
    // PTT's cursor on the first unread board from 7: here 9.
    expect(land(h, leave, countRows({ foot }), rowOf(9))).toBe(true);
    leave.onDone();
    expect(h.s.state).toBe("opening");
    expect(h.s._renderMode).toBe("frozen"); // never handed to PTT's own screen
    const back = h.enqueued.at(-1);
    expect([back.kind, back.keys, back.fullRepaint]).toEqual([BRD_CMD_PREFIX + "counts-return", "7\r", true]);
    expect(land(h, back, countRows({ foot }), rowOf(9))).toBe(false);
    expect(land(h, back, countRows({ foot }), rowOf(7))).toBe(true);
    back.onDone();
    expect(h.s.state).toBe("active");
    expect(h.s._renderMode).toBe("buffer");
    expect(h.s._variant).toBe("class");
    expect(h.s._newflag).toBe(true);
    expect(h.s._selectedNum).toBe(7);
    expect(h.s._rowTextOf(7)).toBe(brdRow(7, "B7").padEnd(80, " "));
    expect(h.s.listToggles()).toEqual({ counts: true, sort: "switch" });
  });

  test("count view → a group's boards → Back that times out fails visibly, the list frozen", () => {
    const h = withAccumulation(engaged());
    toCounts(h);
    h.s.onKeyDown(keyEvent("Enter"));
    const open = h.enqueued.at(-1);
    const group = numberRows({ count: 5, name: (n) => "G" + n });
    land(h, open, group, 3);
    open.onDone();
    h.termBuf.feed(group, { curY: 3 });
    h.s.onKeyDown(keyEvent("ArrowLeft"));
    const leave = h.enqueued.at(-1);
    land(h, leave, countRows(), rowOf(9));
    leave.onDone();
    h.enqueued.at(-1).onFail("timeout");
    expect(h.s.failed()).toBe(true);
    expect(h.s._renderMode).toBe("frozen");
    expect(h.hints.at(-1)).toEqual(["回上層逾時，下拉重新整理以重試", 4000, "error"]);
  });

  test("Back from a numbered sub-list to a numbered list is the usual reseed (no jump back)", () => {
    const h = withAccumulation(engaged());
    h.s._serverNum = 7;
    h.s.onKeyDown(keyEvent("Enter"));
    const open = h.enqueued.at(-1);
    const group = numberRows({ count: 5, name: (n) => "G" + n });
    land(h, open, group, 3);
    open.onDone();
    h.termBuf.feed(group, { curY: 3 });
    h.enqueued.length = 0;
    h.s.onKeyDown(keyEvent("ArrowLeft"));
    const leave = h.enqueued.at(-1);
    land(h, leave, numberRows(), rowOf(7));
    leave.onDone();
    expect(h.enqueued.map((c) => c.kind)).toEqual([BRD_CMD_PREFIX + "leave"]);
    expect(h.s.state).toBe("idle");
  });

  test("count view → a board → Back: the list resumes in place, still in the count view", () => {
    const h = withAccumulation(engaged());
    toCounts(h);
    h.s.onKeyDown(keyEvent("Enter"));
    const open = h.enqueued.at(-1);
    land(h, open, HELP_ROWS, 3); // the board's own screen
    open.onDone();
    expect(h.s.state).toBe("suspended");
    h.enqueued.length = 0;
    h.termBuf.feed(countRows(), { curY: rowOf(7) });
    expect(h.s.state).toBe("active");
    expect(h.s._newflag).toBe(true);
    expect(h.s._selectedNum).toBe(7);
    expect(h.enqueued.some((c) => c.kind === BRD_CMD_PREFIX + "counts-return")).toBe(false);
  });

  test("a number jump: a held position is selected here, one past the rows held is walked to", () => {
    const h = withAccumulation(engaged());
    toCounts(h);
    h.s.state = "functionMode"; // as _beginJumpCollect leaves it
    h.s._beginJumpNumber(12);
    expect(h.s.state).toBe("active");
    expect(h.s._selectedNum).toBe(12);
    expect(h.enqueued).toEqual([]);
    h.s.state = "functionMode";
    h.s._beginJumpNumber(23);
    expect(h.s.state).toBe("active");
    expect(h.enqueued.at(-1).keys).toBe("21\r");
  });
});
