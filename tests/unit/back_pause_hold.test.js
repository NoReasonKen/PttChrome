// A pause screen after Back (#189, src/js/back_pause_hold.js). Locked here:
//   - only Back from an easy-reading article arms, and only with easy reading on;
//   - a pause after Back holds the view's frames, shows its message as a hint
//     and is dismissed with one space; its successor list ends the hold once list
//     easy reading presents it;
//   - any other answer is drawn as before: the hold ends (or never starts);
//   - a timeout, a key of the reader's own and disconnection end it;
//   - a paused movie is not a pause (any key plays on).
import { CommandQueue } from "../../src/js/command_queue";
import {
  BackPauseHold,
  isBackKey,
  isPauseRow,
  pauseMessage,
  backAnswerOf,
  ANSWER_MS,
  LANDING_MS,
} from "../../src/js/back_pause_hold";
import { classifyListScreen } from "../../src/js/list_session";
import { serializedOpHint } from "../../src/js/serialized_op_gate";
import { i18n, setupI18n } from "../../src/js/i18n";

beforeAll(() => setupI18n());

const ROWS = 24;
const COLS = 80;

function screen(rows, opts = {}) {
  const r = Array.from({ length: ROWS }, (_, i) => rows[i] || "");
  return { rows: r, curX: opts.curX ?? COLS - 1, curY: opts.curY ?? ROWS - 1, reversed: !!opts.reversed, onField: !!opts.onField };
}

const PAUSE_ROW = "                         請按任意鍵繼續";
const PAUSE = screen({ [ROWS - 1]: PAUSE_ROW });
const PAUSE_MSG = screen({ 10: "  您的文章已被板主刪除", [ROWS - 1]: PAUSE_ROW });
const VMSG = screen({ [ROWS - 1]: " ◆ 此看板已被設定為唯讀                              [按任意鍵繼續]" });
const MOVIE_PAUSED = screen({ 5: "  art", [ROWS - 1]: " >>> 暫停播放動畫，請按任意鍵繼續或 q 中斷。 <<<" });
const MAIN_MENU = screen({ 0: "【主功能表】                       批踢踢實業坊" }, { curX: 0, curY: 10 });
const ARTICLE_PAGER = screen({
  0: " 作者  rick                                                         看板  Browsers",
  1: " 標題  [-Fx-] Firefox 157.0.1 Release",
  2: " 時間  Tue Sep 29 21:52:40 2026",
  [ROWS - 1]: "  瀏覽 第 1/8 頁 (  8%)  目前顯示: 第 01~26 行  (y)回應(X)推文(←)離開",
});
const ARTICLE_LIST = (() => {
  const rows = {
    0: "【板主:someone】                    看板《Android》",
    1: "[←]離開 [→]閱讀 [Ctrl-P]發表文章 [d]刪除 [z]精華區 [i]看板資訊/設定",
    2: "   編號    日 期 作  者       文  章  標  題                       人氣:99",
    23: " 文章選讀  (y)回應(X)推文(^X)轉錄 (=[]<>)相關主題(/?a)找標題/作者 (b)進板畫面",
  };
  for (let i = 0; i < 20; ++i) {
    const n = String(48366 + i).padStart(7);
    rows[3 + i] = (i === 0 ? ">" : " ") + n.slice(1) + " +  10/08 someone      □ [問題] 標題 " + i;
  }
  return screen(rows, { curX: 0, curY: 3, reversed: true });
})();

function makeHarness({ stored = null, easyReading = true, pageState = 3 } = {}) {
  vi.useFakeTimers();
  if (stored) vi.stubGlobal("window", { localStorage: { getItem: () => JSON.stringify({ values: stored }) } });
  const listeners = [];
  const buf = {
    rows: ROWS,
    cols: COLS,
    cur: ARTICLE_PAGER,
    cur_x: 0,
    cur_y: ROWS - 1,
    pageState,
    easyReadingFunctionMode: false,
    serverWrites: 1,
    settleSnapshot: null,
    listRenderMode: "native",
    listRenderOwner: null,
    getRowText(r) {
      return this.cur.rows[r] || "";
    },
    isUnicolor() {
      return this.cur.reversed;
    },
    isCursorOnInputField() {
      return this.cur.onField;
    },
    addEventListener(name, fn) {
      if (name === "screenSettled") listeners.push(fn);
    },
  };
  const view = { useEasyReadingMode: easyReading, flashListHint: vi.fn(), navigationEnded: vi.fn() };
  const sent = [];
  let hold = null;
  const queue = new CommandQueue({
    send: (d) => {
      sent.push(d);
      hold.noteSent(d);
    },
  });
  const core = { commandQueue: queue };
  hold = new BackPauseHold(core, view, buf, queue);
  core.backPause = hold;
  const userSend = (bytes) => {
    sent.push(bytes);
    hold.noteSent(bytes);
  };
  // PTT draws a frame and it settles: list_session runs queue.onSettle first
  // (the real listener order), then ours. `beforeOurs` runs between them (list
  // easy reading taking the list over in the same settle).
  const settle = (next, beforeOurs) => {
    buf.serverWrites += 1;
    buf.cur = next;
    buf.cur_x = next.curX;
    buf.cur_y = next.curY;
    buf.pageState = next === ARTICLE_LIST ? 3 : next === ARTICLE_PAGER ? 3 : 0;
    const snap = {
      changedRows: new Set(Array.from({ length: ROWS }, (_, i) => i)),
      cursorMoved: true,
      curX: next.curX,
      curY: next.curY,
      serverWrites: buf.serverWrites,
    };
    buf.settleSnapshot = snap;
    const facts = {
      rowTexts: next.rows.slice(),
      rows: ROWS,
      curX: next.curX,
      curY: next.curY,
      row0Reversed: next.reversed,
      row2Reversed: next.reversed,
      changedRows: snap.changedRows,
    };
    facts.kind = classifyListScreen(facts).kind;
    queue.onSettle(snap, facts);
    if (beforeOurs) beforeOurs();
    for (const fn of listeners) fn();
  };
  const present = () => {
    buf.listRenderMode = "buffer";
    buf.listRenderOwner = "article-list";
  };
  return { buf, view, queue, sent, hold, core, userSend, settle, present };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = () => Promise.resolve();

describe("pure functions", () => {
  test("Back is ← in either cursor mode; a trailing Ctrl-L does not matter", () => {
    for (const k of ["\x1b[D", "\x1bOD", "\x1b[D\f"]) expect(isBackKey(k)).toBe(true);
    for (const k of ["q", "\x1b[C", " ", "\f", "\x1b[D\x1b[D", ""]) expect(isBackKey(k)).toBe(false);
  });

  test("pause rows: pressanykey and vmsg; not a paused movie or an input field", () => {
    expect(isPauseRow(PAUSE_ROW)).toBe(true);
    expect(isPauseRow(VMSG.rows[ROWS - 1])).toBe(true);
    expect(isPauseRow(MOVIE_PAUSED.rows[ROWS - 1])).toBe(false);
    expect(isPauseRow(PAUSE_ROW, true)).toBe(false);
    expect(isPauseRow(ARTICLE_PAGER.rows[ROWS - 1])).toBe(false);
  });

  test("the message: vmsg text, text left of the prompt, or a lone short text on a cleared screen", () => {
    expect(pauseMessage(VMSG.rows)).toBe("此看板已被設定為唯讀");
    expect(pauseMessage(PAUSE_MSG.rows)).toBe("您的文章已被板主刪除");
    expect(pauseMessage(screen({ [ROWS - 1]: " 已刪除  請按任意鍵繼續" }).rows)).toBe("已刪除");
    expect(pauseMessage(screen({ 3: "第一行", 4: "第二行", [ROWS - 1]: PAUSE_ROW }).rows)).toBe("第一行 第二行");
    // No message, or a screen the pause was drawn over: no hint.
    expect(pauseMessage(PAUSE.rows)).toBe(null);
    expect(pauseMessage(screen({ 1: "a", 5: "b", 9: "c", [ROWS - 1]: PAUSE_ROW }).rows)).toBe(null);
  });

  test("answers to Back", () => {
    const f = (s) => ({ rowTexts: s.rows, rows: ROWS, curX: s.curX, curY: s.curY, row0Reversed: s.reversed, row2Reversed: s.reversed, cursorOnInputField: s.onField });
    expect(backAnswerOf(f(PAUSE))).toBe("pause");
    expect(backAnswerOf(f(VMSG))).toBe("pause");
    expect(backAnswerOf(f(MOVIE_PAUSED))).not.toBe("pause");
    expect(backAnswerOf(f(ARTICLE_LIST))).toBe("list");
    expect(backAnswerOf(f(MAIN_MENU))).toBe("menu");
    expect(backAnswerOf(f(ARTICLE_PAGER))).toBe("article");
  });
});

describe("the hold", () => {
  test("Back → pause → space → list presented: held throughout, hint shown, one key sent", async () => {
    const h = makeHarness();
    h.userSend("\x1b[D");
    expect(h.hold.phase).toBe("armed");
    // Armed but nothing paused yet: the view draws as before.
    expect(h.hold.holding).toBe(false);
    h.settle(PAUSE_MSG);
    expect(h.sent).toEqual(["\x1b[D", " \f"]);
    expect(h.hold.holding).toBe(true);
    expect(h.hold.busy).toBe(true);
    expect(serializedOpHint(h.core)).toBe(i18n("backPause_busy"));
    expect(i18n("backPause_busy")).toBeTruthy();
    expect(h.view.flashListHint).toHaveBeenCalledWith("您的文章已被板主刪除", expect.any(Number), "error");
    // The list arrives; list easy reading takes it over in the same settle.
    h.settle(ARTICLE_LIST, h.present);
    await flush();
    expect(h.hold.phase).toBe("idle");
    expect(h.hold.holding).toBe(false);
    expect(h.view.navigationEnded).toHaveBeenCalledTimes(1);
    expect(h.sent).toEqual(["\x1b[D", " \f"]);
  });

  test("a pause without a message shows no hint and is still dismissed", () => {
    const h = makeHarness();
    h.userSend("\x1b[D");
    h.settle(PAUSE);
    expect(h.sent).toEqual(["\x1b[D", " \f"]);
    expect(h.view.flashListHint).not.toHaveBeenCalled();
  });

  test("the hold is true while the pause is on screen before the settle", () => {
    const h = makeHarness();
    h.userSend("\x1b[D");
    h.buf.cur = PAUSE;
    expect(h.hold.holding).toBe(true);
    expect(h.hold.absorbs()).toBe(true);
  });

  test("the list presented later: the hold lasts until list easy reading takes it over", async () => {
    const h = makeHarness();
    h.userSend("\x1b[D");
    h.settle(PAUSE);
    h.settle(ARTICLE_LIST);
    await flush();
    expect(h.hold.phase).toBe("landing");
    expect(h.hold.holding).toBe(true);
    h.present();
    // A later frame of the list (the list session's own repaint).
    h.settle(ARTICLE_LIST);
    await flush();
    expect(h.hold.phase).toBe("idle");
  });

  test("a list read while landing does not end the hold; the presented list does", async () => {
    const h = makeHarness();
    h.userSend("\x1b[D");
    h.settle(PAUSE);
    h.settle(ARTICLE_LIST);
    await flush();
    // List easy reading reads the next page before presenting.
    h.userSend("\x1b[6~");
    expect(h.hold.phase).toBe("landing");
    h.present();
    h.settle(ARTICLE_LIST);
    await flush();
    expect(h.hold.phase).toBe("idle");
  });

  test("the list never presented: the landing times out and the frame is drawn", async () => {
    const h = makeHarness();
    h.userSend("\x1b[D");
    h.settle(PAUSE);
    h.settle(ARTICLE_LIST);
    await flush();
    vi.advanceTimersByTime(LANDING_MS + 1);
    expect(h.hold.phase).toBe("idle");
    expect(h.view.navigationEnded).toHaveBeenCalledTimes(1);
  });

  test("a second pause is dismissed too; a third is drawn as before", () => {
    const h = makeHarness();
    h.userSend("\x1b[D");
    h.settle(PAUSE);
    h.settle(VMSG);
    expect(h.sent).toEqual(["\x1b[D", " \f", " \f"]);
    h.settle(PAUSE);
    expect(h.sent).toEqual(["\x1b[D", " \f", " \f"]);
    expect(h.hold.phase).toBe("idle");
  });

  test("Back answered with the list: no hold, nothing sent", () => {
    const h = makeHarness();
    h.userSend("\x1b[D");
    h.settle(ARTICLE_LIST);
    expect(h.hold.phase).toBe("idle");
    expect(h.hold.holding).toBe(false);
    expect(h.sent).toEqual(["\x1b[D"]);
  });

  test("the pause followed by a menu: the hold ends and the menu is drawn", async () => {
    const h = makeHarness();
    h.userSend("\x1b[D");
    h.settle(PAUSE);
    h.settle(MAIN_MENU);
    await flush();
    expect(h.hold.phase).toBe("idle");
    expect(h.view.navigationEnded).toHaveBeenCalled();
  });

  test("no answer: the hold ends after the timeout", () => {
    const h = makeHarness();
    h.userSend("\x1b[D");
    vi.advanceTimersByTime(ANSWER_MS + 1);
    expect(h.hold.phase).toBe("idle");
  });

  test("a stale frame from before Back is no answer", () => {
    const h = makeHarness();
    h.buf.cur = PAUSE;
    h.userSend("\x1b[D");
    // A settle carrying no new server data.
    h.buf.settleSnapshot = { changedRows: new Set([1]), cursorMoved: true, serverWrites: h.buf.serverWrites };
    h.hold._onScreenSettled();
    expect(h.sent).toEqual(["\x1b[D"]);
  });

  test("a key of the reader's own ends the hold", () => {
    const h = makeHarness();
    h.userSend("\x1b[D");
    h.userSend("q");
    expect(h.hold.phase).toBe("idle");
    h.settle(PAUSE);
    expect(h.sent).toEqual(["\x1b[D", "q"]);
  });

  test("disconnection resets", () => {
    const h = makeHarness();
    h.userSend("\x1b[D");
    h.settle(PAUSE);
    h.hold.reset();
    expect(h.hold.phase).toBe("idle");
    expect(h.hold.holding).toBe(false);
  });

  test("a paused movie after Back is drawn as before", () => {
    const h = makeHarness();
    h.userSend("\x1b[D");
    h.settle(MOVIE_PAUSED);
    expect(h.sent).toEqual(["\x1b[D"]);
    expect(h.hold.holding).toBe(false);
  });

  test("easy reading off: Back never arms", () => {
    const h = makeHarness({ stored: { enableEasyReading: false } });
    h.userSend("\x1b[D");
    expect(h.hold.phase).toBe("idle");
    h.settle(PAUSE);
    expect(h.sent).toEqual(["\x1b[D"]);
  });

  test("Back from a native (not easy-reading) screen never arms", () => {
    const h = makeHarness({ easyReading: false });
    h.userSend("\x1b[D");
    expect(h.hold.phase).toBe("idle");
    const h2 = makeHarness({ pageState: 2 });
    h2.userSend("\x1b[D");
    expect(h2.hold.phase).toBe("idle");
  });

  test("another app-driven run owns the screens: no arming", () => {
    const h = makeHarness();
    h.core.articleShortcutSearch = { active: true };
    h.userSend("\x1b[D");
    expect(h.hold.phase).toBe("idle");
  });
});
