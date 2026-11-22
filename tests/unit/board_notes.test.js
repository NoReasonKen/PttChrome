// @unit-env browser
// The board entry screen (#292, src/js/board_notes.js): `b` on the easy-reading
// article list, PTT's entry screen on a page of its own over the held list, the
// keys that reach PTT raw and the way back. PTT's screens are fed through
// PttChrome's own TermBuf/AnsiParser; the list session is a stub that records
// the steps the page asks for. Every screen is invented; the shapes follow
// bbs.c#b_notes (more(notes, NA), 「本看板尚無進板畫面。」 at (4,20), then
// pressanykey) and pmore's movie footers.
import { TermBuf } from "../../src/js/term_buf";
import { AnsiParser } from "../../src/js/ansi_parser";
import { u2b } from "../../src/js/string_util";
import { loadBig5Tables } from "./helpers/load_big5_tables";
import { BoardNotes, boardNotesKeyBytes, showBoardNotes } from "../../src/js/board_notes";
import { inputPage } from "../../src/js/input_page";
import { renderScreen } from "../../src/js/term_ui";
import { i18n, setupI18n } from "../../src/js/i18n";
import { serializedOpHint } from "../../src/js/serialized_op_gate";
import { mobileToolbarContext } from "../../src/js/mobile_toolbar";
import { UNSUPPORTED_KEY_HINT, unsupportedPasteHint } from "../../src/js/unsupported_hint";

vi.mock("../../src/js/term_ui", async (importOriginal) => ({
  ...(await importOriginal()),
  renderScreen: vi.fn(() => ({ release: vi.fn() })),
}));

const COLS = 80;
const ROWS = 24;
const at = (row, col = 0) => "\x1b[" + (row + 1) + ";" + (col + 1) + "H";
const BAR = "\x1b[1;34;44m" + "▄".repeat(15) + " \x1b[37m請按任意鍵繼續\x1b[34m " + "▄".repeat(15) + "\x1b[m";
const CLEAR = "\x1b[H\x1b[2J";

// A coloured entry screen, then pressanykey.
const PLAIN = CLEAR + at(3, 10) + "\x1b[1;33m歡迎來到測試板\x1b[m" + at(5, 10) + "\x1b[32m請先閱讀板規\x1b[m" +
  at(ROWS - 1) + BAR + at(ROWS - 1, 79);
// A board without one.
const NONE = CLEAR + at(4, 20) + "本看板尚無進板畫面。" + at(ROWS - 1) + BAR + at(ROWS - 1, 79);
// A movie frame and an interactive one.
const movie = (n) => CLEAR + at(6, 10) + "\x1b[1;36m動畫第 " + n + " 幀\x1b[m" +
  at(ROWS - 1) + " >>> 動畫播放中... 可按 q, Ctrl-C 或其它任意鍵停止" + at(ROWS - 1, 79);
const INTERACTIVE = CLEAR + at(6, 10) + "請選擇 (1) 或 (2)" +
  at(ROWS - 1) + " >> 請輸入選項:  (互動式動畫播放中，可按 q 或 Ctrl-C 中斷)" + at(ROWS - 1, 79);
// A message of PTT's the page does not know to wait for a key.
const VMSG = CLEAR + at(ROWS - 1) + " ◆ 系統忙碌中 [按任意鍵繼續]" + at(ROWS - 1, 79);
// PTT's article list again (the stub list session says it shows the held list).
const LIST = CLEAR + "【板主:someone】     看板《C_Chat》" + at(3) + ">  1234 + 1/01 tester   □ 測試";

const key = (k, extra) => ({ key: k, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...extra });
const flush = () => new Promise((r) => queueMicrotask(r));

describe("the board entry screen (#292)", () => {
  beforeAll(() => {
    loadBig5Tables();
    setupI18n();
  });
  let main;
  // Every controller a test made: its page and window listener go with the test.
  const made = [];
  beforeEach(() => {
    vi.useFakeTimers();
    renderScreen.mockClear();
    main = document.createElement("div");
    document.body.appendChild(main);
  });
  afterEach(() => {
    made.splice(0).forEach((notes) => notes.reset());
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    main.remove();
    document.querySelectorAll("[data-board-notes-page], [data-board-notes-leaving]").forEach((n) => n.remove());
  });

  // A core on a board's article list: `ls.held` says whether PTT's screen is
  // the list again (ListSession.showsHeldList).
  function liveCore({ board = "C_Chat" } = {}) {
    const buf = new TermBuf(COLS, ROWS);
    buf.setView({ update() {}, updateCursorPos() {}, refreshCursorVisibility() {}, charset: "big5", blinkOn: false });
    buf.useMouseBrowsing = false;
    buf.listRenderMode = "buffer";
    const parser = new AnsiParser(buf);
    const hints = [];
    const modals = new Set();
    const dismissers = [];
    const ls = {
      held: false,
      boardNotesBoard: vi.fn(() => board),
      showsHeldList() {
        return this.held;
      },
      beginBoardNotes: vi.fn(),
      continueUserQuery: vi.fn(() => true),
      resumeAfterHelp: vi.fn(),
    };
    const core = {
      mobile: false,
      buf,
      listSession: ls,
      activeListSession: () => ls,
      _openModals: modals,
      _screenContext: { appBar: { kind: "list", title: "C_Chat" } },
      view: {
        mainDisplay: main,
        chh: 20,
        textFontPx: (chh) => chh - 2,
        flashListHint: (text, ms, level) => hints.push([text, level]),
        navigationEnded: vi.fn(),
      },
      setModalOpen: (s, open) => (open ? modals.add(s) : modals.delete(s)),
      registerSheetDismiss: (fn) => {
        dismissers.push(fn);
        return () => dismissers.splice(dismissers.indexOf(fn), 1);
      },
      _refreshScreenContext: vi.fn(),
      sendMachineBytes: vi.fn(() => true),
      readingRecord: { begin: vi.fn(() => ({ feature: "board-notes" })), end: vi.fn() },
    };
    core.boardNotes = new BoardNotes(core);
    made.push(core.boardNotes);
    // PTT draws a screen and goes quiet (the settle every follower waits for).
    const feed = (screen) => {
      parser.feed(u2b(screen));
      vi.advanceTimersByTime(300);
    };
    main.style.setProperty("font-family", "MingLiu, SymMingLiu, monospace", "important");
    feed(LIST);
    currentBuf = buf;
    return { core, ls, buf, feed, hints, modals, dismissers, notes: core.boardNotes };
  }

  // `b` sent and PTT's entry screen in: the page shows it.
  function shown(screen = PLAIN, opts) {
    const t = liveCore(opts);
    expect(t.notes.start()).toBe(true);
    const step = t.ls.beginBoardNotes.mock.calls[0][0][0];
    t.feed(screen);
    const answer = step.expect();
    expect(answer).toEqual({ notes: true });
    step.onDone(answer);
    expect(t.notes.phase).toBe("shown");
    return { ...t, step };
  }

  const pageEl = () => document.querySelector("[data-board-notes-page]");
  const lastRender = () => renderScreen.mock.calls[renderScreen.mock.calls.length - 1];
  // The copy's rows as text, read the way PTT's buffer reads its own.
  let currentBuf = null;
  const renderedText = (call) => call[0].map((_, r) => currentBuf.getRowText(r, 0, COLS, call[0])).join("\n");

  test("`b` asks PTT once, holds the list and owns the wire until the list is back", () => {
    const { core, ls, notes, modals, dismissers, hints } = liveCore();
    expect(notes.available()).toBe(true);
    expect(showBoardNotes(core)).toBe(true);
    expect(ls.beginBoardNotes).toHaveBeenCalledTimes(1);
    const steps = ls.beginBoardNotes.mock.calls[0][0];
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ keys: "b", kind: "board-notes", fullRepaint: false });
    expect(notes.phase).toBe("asking");
    expect(notes.holding).toBe(true);
    expect(notes.pageShown).toBe(false);
    expect([...modals]).toEqual(["boardNotes"]);
    expect(dismissers).toHaveLength(1);
    expect(core.readingRecord.begin).toHaveBeenCalledWith("board-notes");
    expect(serializedOpHint(core)).toBe(i18n("boardNotes_busy"));
    expect(notes.available()).toBe(false);
    // The list's App Bar until the page shows.
    expect(notes.appBar()).toEqual({ kind: "list", title: "C_Chat" });
    // A second `b` while it runs: the busy hint, nothing sent.
    expect(showBoardNotes(core)).toBe(false);
    expect(ls.beginBoardNotes).toHaveBeenCalledTimes(1);
    expect(hints).toEqual([[i18n("boardNotes_busy"), undefined]]);
    // The system Back before the page shows: the busy hint, never a way out.
    dismissers[0]();
    expect(hints).toHaveLength(2);
    expect(notes.phase).toBe("asking");
  });

  test("not on a board's article list (mailbox, user list), or another operation runs: a hint, nothing sent", () => {
    const off = liveCore({ board: null });
    expect(off.notes.available()).toBe(false);
    expect(showBoardNotes(off.core)).toBe(false);
    expect(off.hints).toEqual([[i18n("boardNotes_unavailable"), undefined]]);
    const native = liveCore();
    native.buf.listRenderMode = "native";
    expect(native.notes.start()).toBe(false);
    const busy = liveCore();
    busy.core.searchInFlight = true;
    expect(busy.notes.start()).toBe(false);
    expect(busy.hints).toEqual([["搜尋中，請稍候…", undefined]]);
    for (const t of [off, native, busy]) {
      expect(t.ls.beginBoardNotes).not.toHaveBeenCalled();
      expect(t.notes.phase).toBe("idle");
      expect(t.modals.size).toBe(0);
    }
    expect(showBoardNotes(null)).toBe(false);
  });

  test("what answers `b`: the entry screen, the list, or a screen not yet known", () => {
    const { ls, notes, feed } = liveCore();
    notes.start();
    const step = ls.beginBoardNotes.mock.calls[0][0][0];
    feed(VMSG);
    expect(step.expect()).toBe(false);
    for (const screen of [PLAIN, NONE, movie(1), INTERACTIVE]) {
      feed(screen);
      expect(step.expect()).toEqual({ notes: true });
    }
    ls.held = true;
    expect(step.expect()).toEqual({ list: true });
  });

  test("the page shows PTT's whole screen, its colours and footer, copied from the buffer", () => {
    const { core, buf, notes } = shown();
    const page = pageEl();
    expect(page).not.toBeNull();
    expect(page.getAttribute("role")).toBe("dialog");
    const root = page.querySelector(".boardNotesScreen");
    expect(root.getAttribute("data-stack-layer")).toBe("boardNotes");
    expect(root.style.width).toBe((20 / 2) * COLS + "px");
    expect(root.style.fontSize).toBe("18px");
    // The terminal's own font face, which keeps ASCII at half a cell.
    expect(root.style.getPropertyValue("font-family")).toContain("SymMingLiu");
    expect(root.style.getPropertyPriority("font-family")).toBe("important");
    const call = lastRender();
    expect(call[1]).toBe(20);
    expect(call[4]).toBe(root);
    expect(call[5]).toMatchObject({ pageState: 0, debugRecordButton: false, lightsButton: false });
    // The rows are copies: PTT's buffer is written in place by the next frame.
    expect(call[0]).toHaveLength(ROWS);
    expect(call[0][3]).not.toBe(buf.lines[3]);
    expect(call[0][3][10]).not.toBe(buf.lines[3][10]);
    const text = renderedText(call);
    expect(text).toContain("歡迎來到測試板");
    expect(text).toContain("請按任意鍵繼續");
    // Colours come along: the greeting is bright yellow.
    expect(call[0][3][10]).toMatchObject({ fg: 3, bright: true });
    expect(notes.appBar()).toMatchObject({ kind: "other", title: i18n("boardNotes_title"), subtitle: "C_Chat" });
    expect(notes.ownsInput()).toBe(true);
    expect(inputPage(core)).toBe(notes);
    expect(mobileToolbarContext(core)).toMatchObject({ queryPage: true, locked: false, boardNotes: false });
  });

  test("a board without an entry screen: PTT's own line on the page, any key leaves", async () => {
    const { core, ls, notes, feed } = shown(NONE);
    expect(renderedText(lastRender())).toContain("本看板尚無進板畫面。");
    expect(notes.takeKey(key("x"))).toBe(true);
    expect(core.sendMachineBytes).not.toHaveBeenCalled();
    expect(notes.phase).toBe("leaving");
    expect(pageEl()).toBeNull();
    expect(ls.continueUserQuery).toHaveBeenCalledTimes(1);
    const step = ls.continueUserQuery.mock.calls[0][0];
    expect(step).toMatchObject({ keys: " ", kind: "board-notes-leave" });
    feed(LIST);
    ls.held = true;
    step.onDone(step.expect());
    await flush();
    expect(notes.phase).toBe("idle");
    expect(ls.resumeAfterHelp).toHaveBeenCalledWith(true);
    expect(core.readingRecord.end).toHaveBeenCalledWith({ feature: "board-notes" }, "done");
    expect(core.view.navigationEnded).toHaveBeenCalled();
    expect(serializedOpHint(core)).toBe(null);
  });

  test("a movie: every settled frame is drawn again, keys reach PTT raw, q stops it, then one key for pressanykey", async () => {
    const { core, ls, notes, feed, hints } = shown(movie(1));
    expect(renderedText(lastRender())).toContain("動畫第 1 幀");
    feed(movie(2));
    expect(renderedText(lastRender())).toContain("動畫第 2 幀");
    // Typed keys go to PTT as they are.
    for (const [e, bytes] of [
      [key("x"), "x"],
      [key("ArrowUp"), "\x1b[A"],
      [key("Enter"), "\r"],
      [key("c", { altKey: true }), "\x03"],
      [key("2"), "2"],
    ]) {
      expect(notes.takeKey(e)).toBe(true);
      expect(core.sendMachineBytes).toHaveBeenLastCalledWith(bytes);
    }
    expect(notes.phase).toBe("shown");
    expect(ls.continueUserQuery).not.toHaveBeenCalled();
    expect(hints).toEqual([]);
    // q leaves: PTT gets q, judged anew after each answer.
    const sent = core.sendMachineBytes.mock.calls.length;
    expect(notes.takeKey(key("q"))).toBe(true);
    expect(core.sendMachineBytes).toHaveBeenCalledTimes(sent);
    expect(pageEl()).toBeNull();
    const first = ls.continueUserQuery.mock.calls[0][0];
    expect(first.keys).toBe("q");
    // A movie frame drawn before q arrived is no answer.
    feed(movie(3));
    expect(first.expect()).toBe(false);
    feed(PLAIN);
    const answer = first.expect();
    expect(answer.again).toMatchObject({ action: "skip", key: " ", shape: "pause" });
    first.onDone(answer);
    const second = ls.continueUserQuery.mock.calls[1][0];
    expect(second.keys).toBe(" ");
    feed(LIST);
    ls.held = true;
    second.onDone(second.expect());
    await flush();
    expect(notes.phase).toBe("idle");
    expect(ls.resumeAfterHelp).toHaveBeenCalledTimes(1);
    // The page stopped following PTT's frames.
    const renders = renderScreen.mock.calls.length;
    feed(movie(4));
    expect(renderScreen).toHaveBeenCalledTimes(renders);
  });

  test("an interactive movie takes the reader's choices; Esc and ← leave with q", () => {
    const { core, ls, notes } = shown(INTERACTIVE);
    expect(notes.takeKey(key("1"))).toBe(true);
    expect(core.sendMachineBytes).toHaveBeenLastCalledWith("1");
    expect(notes.takeKey(key("Escape"))).toBe(true);
    expect(ls.continueUserQuery.mock.calls[0][0].keys).toBe("q");
    // ← on another run.
    const other = shown(INTERACTIVE);
    expect(other.notes.takeKey(key("ArrowLeft"))).toBe(true);
    expect(other.ls.continueUserQuery.mock.calls[0][0].keys).toBe("q");
  });

  test("a movie that ends in pressanykey keeps its last frame until the reader leaves; any key then leaves", () => {
    const { core, ls, notes, feed } = shown(movie(1));
    feed(PLAIN);
    expect(notes.phase).toBe("shown");
    expect(renderedText(lastRender())).toContain("請按任意鍵繼續");
    expect(notes.takeKey(key("x"))).toBe(true);
    expect(core.sendMachineBytes).not.toHaveBeenCalled();
    expect(ls.continueUserQuery.mock.calls[0][0].keys).toBe(" ");
  });

  test("PTT draws the list by itself (a key stopped the movie): the list takes its frame back under the page, leaving only closes it", async () => {
    const { core, ls, notes, feed, hints } = shown(movie(1));
    const renders = renderScreen.mock.calls.length;
    ls.held = true;
    feed(LIST);
    expect(notes.phase).toBe("ended");
    // The page keeps the movie's last frame.
    expect(renderScreen).toHaveBeenCalledTimes(renders);
    await flush();
    expect(ls.resumeAfterHelp).toHaveBeenCalledWith(true);
    expect(core.readingRecord.end).toHaveBeenCalledWith({ feature: "board-notes" }, "done");
    expect(notes.holding).toBe(false);
    expect(notes.pageShown).toBe(true);
    expect(pageEl()).not.toBeNull();
    // Keys reach no one: PTT shows the list.
    expect(notes.takeKey(key("x"))).toBe(true);
    expect(core.sendMachineBytes).not.toHaveBeenCalled();
    expect(hints).toEqual([[UNSUPPORTED_KEY_HINT, "error"]]);
    expect(notes.takeKey(key("q"))).toBe(true);
    expect(pageEl()).toBeNull();
    expect(notes.phase).toBe("idle");
    expect(ls.continueUserQuery).not.toHaveBeenCalled();
    expect(ls.resumeAfterHelp).toHaveBeenCalledTimes(1);
    expect(core.readingRecord.end).toHaveBeenCalledTimes(1);
  });

  test("leaving in the same task as the list came back resumes the list once", () => {
    const { ls, notes, feed } = shown(movie(1));
    ls.held = true;
    feed(LIST);
    notes.dismiss();
    expect(notes.phase).toBe("idle");
    expect(ls.resumeAfterHelp).toHaveBeenCalledTimes(1);
  });

  // A tap on the page (a click on a desktop; the page's click listener, real
  // taps in the offline specs) is any key where any key will do.
  test("a tap leaves on pressanykey and once PTT drew the list; during a movie it does nothing", () => {
    const pause = shown(NONE);
    pause.notes._tap();
    expect(pause.notes.phase).toBe("leaving");
    expect(pause.ls.continueUserQuery.mock.calls[0][0].keys).toBe(" ");
    const playing = shown(movie(1));
    playing.notes._tap();
    playing.notes._tap();
    expect(playing.notes.phase).toBe("shown");
    expect(playing.ls.continueUserQuery).not.toHaveBeenCalled();
    expect(playing.core.sendMachineBytes).not.toHaveBeenCalled();
    // The movie ended in pressanykey: now a tap leaves.
    playing.feed(PLAIN);
    playing.notes._tap();
    expect(playing.notes.phase).toBe("leaving");
    const ended = shown(movie(1));
    ended.ls.held = true;
    ended.feed(LIST);
    expect(ended.notes.phase).toBe("ended");
    ended.notes._tap();
    expect(ended.notes.phase).toBe("idle");
    expect(ended.ls.continueUserQuery).not.toHaveBeenCalled();
    expect(pageEl()).toBeNull();
  });

  test("a tap with a sheet over the page, or one that ended a text selection, does nothing", () => {
    const { notes, modals, ls } = shown();
    modals.add("more");
    notes._tap();
    expect(notes.phase).toBe("shown");
    modals.delete("more");
    const text = document.querySelector("[data-board-notes-page] .boardNotesScreen");
    text.textContent = "selected text";
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    notes._tap();
    expect(notes.phase).toBe("shown");
    window.getSelection().removeAllRanges();
    notes._tap();
    expect(notes.phase).toBe("leaving");
    expect(ls.continueUserQuery).toHaveBeenCalledTimes(1);
  });

  test("a screen not known to wait for a key: leaving is refused with a hint, the page stays", () => {
    const { ls, notes, feed, hints } = shown();
    feed(VMSG);
    expect(notes.takeKey(key("Escape"))).toBe(true);
    expect(notes.phase).toBe("shown");
    expect(pageEl()).not.toBeNull();
    expect(ls.continueUserQuery).not.toHaveBeenCalled();
    expect(hints).toEqual([[i18n("boardNotes_wait"), "error"]]);
  });

  test("a way back with no answer: the page comes back with the hint; with the list, the list takes it", async () => {
    const { ls, notes, hints } = shown();
    notes.dismiss();
    ls.continueUserQuery.mock.calls[0][0].onFail();
    expect(notes.phase).toBe("shown");
    expect(pageEl()).not.toBeNull();
    expect(hints).toEqual([[i18n("boardNotes_failed"), "error"]]);
    // Leave again; this time PTT shows the list after all.
    notes.dismiss();
    ls.held = true;
    ls.continueUserQuery.mock.calls[1][0].onFail();
    expect(notes.phase).toBe("idle");
    expect(ls.resumeAfterHelp).toHaveBeenCalledTimes(1);
    expect(hints).toHaveLength(2);
    // A leave that could not be sent at all.
    const t = shown();
    t.ls.continueUserQuery.mockReturnValue(false);
    t.notes.dismiss();
    expect(t.notes.phase).toBe("shown");
  });

  test("`b` with no answer: the list takes the frame back with the hint, or PTT's screen shows on the page", () => {
    const a = liveCore();
    a.notes.start();
    a.ls.held = true;
    a.ls.beginBoardNotes.mock.calls[0][0][0].onFail();
    expect(a.notes.phase).toBe("idle");
    expect(a.ls.resumeAfterHelp).toHaveBeenCalledWith(true);
    expect(a.core.readingRecord.end).toHaveBeenCalledWith({ feature: "board-notes" }, "fail");
    expect(a.hints).toEqual([[i18n("boardNotes_failed"), "error"]]);
    const b = liveCore();
    b.notes.start();
    b.feed(VMSG);
    b.ls.beginBoardNotes.mock.calls[0][0][0].onFail();
    expect(b.notes.phase).toBe("shown");
    expect(pageEl()).not.toBeNull();
    expect(b.hints).toEqual([[i18n("boardNotes_failed"), "error"]]);
  });

  test("the keyboard: the browser keeps its own keys; the keypad's keys with no bytes are refused", () => {
    const { core, notes, hints } = shown(movie(1));
    expect(notes.takeKey(key("F5"))).toBe(false);
    expect(notes.takeKey(key("Shift"))).toBe(false);
    expect(notes.takeKey(key("c", { ctrlKey: true }))).toBe(false);
    expect(notes.takeKey(key("ArrowLeft", { altKey: true }))).toBe(false);
    expect(notes.takeKey(key("r", { metaKey: true }))).toBe(false);
    expect(core.sendMachineBytes).not.toHaveBeenCalled();
    expect(hints).toEqual([]);
    // The keypad's Ctrl+C reaches PTT (q and Ctrl-C always stop a movie).
    expect(notes.takeKey(key("c", { ctrlKey: true }), true)).toBe(true);
    expect(core.sendMachineBytes).toHaveBeenLastCalledWith("\x03");
    expect(notes.takeKey(key("F5"), true)).toBe(true);
    expect(hints).toEqual([[UNSUPPORTED_KEY_HINT, "error"]]);
    // Text that is no single key.
    expect(notes.refuseText("abc", "paste")).toBe(true);
    expect(hints[1]).toEqual([unsupportedPasteHint("進板畫面"), "error"]);
    expect(boardNotesKeyBytes(key("Home"))).toBe("\x1b[1~");
  });

  test("the page's window listener takes a typed key before the terminal", () => {
    const { core } = shown(movie(1));
    const e = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(core.sendMachineBytes).toHaveBeenCalledWith("x");
    expect(e.defaultPrevented).toBe(true);
  });

  test("a sheet over the page keeps its own keys", () => {
    const { core, notes, modals } = shown();
    modals.add("more");
    expect(notes.ownsInput()).toBe(false);
    expect(inputPage(core)).toBe(null);
    expect(notes.takeKey(key("q"))).toBe(false);
    expect(notes.phase).toBe("shown");
  });

  test("the system Back over the page leaves it", () => {
    const { ls, notes, dismissers } = shown();
    dismissers[0]();
    expect(notes.phase).toBe("leaving");
    expect(ls.continueUserQuery.mock.calls[0][0].keys).toBe(" ");
  });

  test("a disconnect drops the page and everything it holds without touching the list", () => {
    const { core, ls, notes, modals, dismissers } = shown(movie(1));
    notes.reset();
    expect(pageEl()).toBeNull();
    expect(notes.phase).toBe("idle");
    expect(modals.size).toBe(0);
    expect(dismissers).toHaveLength(0);
    expect(ls.resumeAfterHelp).not.toHaveBeenCalled();
    expect(core.readingRecord.end).toHaveBeenCalledWith({ feature: "board-notes" }, "fail");
    expect(serializedOpHint(core)).toBe(null);
    // Nothing more to drop.
    notes.reset();
    expect(core.readingRecord.end).toHaveBeenCalledTimes(1);
  });
});
