// @unit-env browser
// The poll results (#301, src/js/poll_results.js): `R` on the easy-reading
// article list, PTT's pmore page of the results on the screen page shared with
// the board entry screen (screen_page.js), and the banner of a board without
// any. PTT's screens are fed through PttChrome's own TermBuf/AnsiParser; the
// list session is a stub that records the steps the page asks for. Every
// screen is invented; the shapes follow poll.c#poll_results (more(results,
// YEA)) and vtuikit.c#vmsg.
import { TermBuf } from "../../src/js/term_buf";
import { AnsiParser } from "../../src/js/ansi_parser";
import { u2b } from "../../src/js/string_util";
import { loadBig5Tables } from "./helpers/load_big5_tables";
import { PollResults, showPollResults } from "../../src/js/poll_results";
import { BoardNotes } from "../../src/js/board_notes";
import { screenPageHolding } from "../../src/js/input_page";
import { renderScreen } from "../../src/js/term_ui";
import { i18n, setupI18n } from "../../src/js/i18n";
import { serializedOpHint } from "../../src/js/serialized_op_gate";
import { unsupportedPasteHint } from "../../src/js/unsupported_hint";

vi.mock("../../src/js/term_ui", async (importOriginal) => ({
  ...(await importOriginal()),
  renderScreen: vi.fn(() => ({ release: vi.fn() })),
}));

const COLS = 80;
const ROWS = 24;
const at = (row, col = 0) => "\x1b[" + (row + 1) + ";" + (col + 1) + "H";
const CLEAR = "\x1b[H\x1b[2J";
const LIST = CLEAR + "【板主:someone】     看板《C_Chat》" + at(3) + ">  1234 + 1/01 tester   □ 測試";
// pmore's page with its status row.
const RESULTS = CLEAR + at(1, 4) + "\x1b[1;33m◆ 投票名稱：午餐吃什麼\x1b[m" + at(3, 4) + "\x1b[32m(1) 便當 12 票\x1b[m" +
  at(ROWS - 1) + "\x1b[34;46m  瀏覽 第 1/2 頁 ( 50%)  \x1b[31;47m目前顯示: 第 01~23 行 \x1b[m" + at(ROWS - 1, 79);
const NONE_MESSAGE = "目前沒有任何投票的結果。";
const NO_RESULTS = LIST + at(ROWS - 1) + " ◆ " + NONE_MESSAGE + " ".repeat(30) + " [按任意鍵繼續]" + at(ROWS - 1, 79);
const key = (k, extra) => ({ key: k, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...extra });
const flush = () => new Promise((r) => queueMicrotask(r));

describe("the poll results (#301)", () => {
  beforeAll(() => {
    loadBig5Tables();
    setupI18n();
  });
  let main;
  const made = [];
  beforeEach(() => {
    vi.useFakeTimers();
    renderScreen.mockClear();
    main = document.createElement("div");
    document.body.appendChild(main);
  });
  afterEach(() => {
    made.splice(0).forEach((p) => p.reset());
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    main.remove();
    document.querySelectorAll("[data-board-notes-page], [data-board-notes-leaving]").forEach((n) => n.remove());
  });

  function liveCore({ board = "C_Chat" } = {}) {
    const buf = new TermBuf(COLS, ROWS);
    buf.setView({ update() {}, updateCursorPos() {}, refreshCursorVisibility() {}, charset: "big5", blinkOn: false });
    buf.useMouseBrowsing = false;
    buf.listRenderMode = "buffer";
    const parser = new AnsiParser(buf);
    const hints = [];
    const modals = new Set();
    const ls = {
      held: false,
      digest: false,
      boardNotesBoard: vi.fn(() => board),
      isDigestList() {
        return this.digest;
      },
      showsHeldList() {
        return this.held;
      },
      beginScreenPage: vi.fn(),
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
      registerSheetDismiss: () => () => {},
      _refreshScreenContext: vi.fn(),
      sendMachineBytes: vi.fn(() => true),
      readingRecord: { begin: vi.fn(() => ({ feature: "board-notes" })), end: vi.fn() },
    };
    core.pollResults = new PollResults(core);
    core.boardNotes = new BoardNotes(core);
    made.push(core.pollResults, core.boardNotes);
    const feed = (screen) => {
      parser.feed(u2b(screen));
      vi.advanceTimersByTime(300);
    };
    main.style.setProperty("font-family", "MingLiu, SymMingLiu, monospace", "important");
    feed(LIST);
    return { core, ls, buf, feed, hints, modals, poll: core.pollResults };
  }

  const pageEl = () => document.querySelector("[data-board-notes-page]");

  test("`R` asks PTT once, holds the list and owns the wire; not on the digest list", () => {
    const { core, ls, poll, modals, hints } = liveCore();
    expect(showPollResults(core)).toBe(true);
    const steps = ls.beginScreenPage.mock.calls[0][0];
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ keys: "R", kind: "poll-results", fullRepaint: false });
    expect([...modals]).toEqual(["pollResults"]);
    expect(screenPageHolding(core)).toBe(true);
    expect(serializedOpHint(core)).toBe(i18n("pollResults_busy"));
    expect(showPollResults(core)).toBe(false);
    expect(hints).toEqual([[i18n("pollResults_busy"), undefined]]);
    expect(poll.phase).toBe("asking");
    const digest = liveCore();
    digest.ls.digest = true;
    expect(digest.poll.available()).toBe(false);
    expect(digest.core.boardNotes.available()).toBe(true);
    expect(showPollResults(digest.core)).toBe(false);
    expect(digest.hints).toEqual([[i18n("pollResults_unavailable"), undefined]]);
    expect(liveCore({ board: null }).poll.available()).toBe(false);
  });

  test("the results show on the page; paging keys reach PTT; ← leaves with the pager's ←", async () => {
    const t = liveCore();
    t.poll.start();
    const step = t.ls.beginScreenPage.mock.calls[0][0][0];
    t.feed(RESULTS);
    const answer = step.expect();
    expect(answer).toEqual({ page: true });
    step.onDone(answer);
    expect(t.poll.phase).toBe("shown");
    expect(pageEl().getAttribute("aria-label")).toBe(i18n("pollResults_title"));
    expect(t.poll.appBar()).toMatchObject({ title: i18n("pollResults_title"), subtitle: "C_Chat" });
    expect(t.poll.takeKey(key(" "))).toBe(true);
    expect(t.core.sendMachineBytes).toHaveBeenLastCalledWith(" ");
    expect(t.poll.refuseText("abc", "paste")).toBe(true);
    expect(t.hints.at(-1)[0]).toBe(unsupportedPasteHint("投票結果"));
    expect(t.poll.takeKey(key("ArrowLeft"))).toBe(true);
    const leave = t.ls.continueUserQuery.mock.calls[0][0];
    expect(leave).toMatchObject({ keys: "\x1b[D", kind: "poll-results-leave" });
    t.feed(LIST);
    t.ls.held = true;
    leave.onDone(leave.expect());
    await flush();
    expect(t.poll.phase).toBe("idle");
    expect(t.ls.resumeAfterHelp).toHaveBeenCalledWith(true);
    expect(serializedOpHint(t.core)).toBe(null);
  });

  test("a board without results: the banner's message is the hint, one space answers it, no page", async () => {
    const t = liveCore();
    t.poll.start();
    const step = t.ls.beginScreenPage.mock.calls[0][0][0];
    t.feed(NO_RESULTS);
    t.ls.held = true;
    const answer = step.expect();
    expect(answer).toEqual({ message: { key: " ", hint: NONE_MESSAGE } });
    step.onDone(answer);
    expect(t.poll.phase).toBe("leaving");
    expect(pageEl()).toBeNull();
    expect(t.core.sendMachineBytes).not.toHaveBeenCalled();
    const leave = t.ls.continueUserQuery.mock.calls[0][0];
    expect(leave).toMatchObject({ keys: " ", kind: "poll-results-leave" });
    t.feed(LIST);
    leave.onDone(leave.expect());
    await flush();
    expect(t.poll.phase).toBe("idle");
    expect(t.ls.resumeAfterHelp).toHaveBeenCalledWith(true);
    expect(t.hints.at(-1)).toEqual([NONE_MESSAGE, undefined]);
  });

  test("the banner is no board entry screen: `b` still waits for a known screen", () => {
    const { core, ls, feed } = liveCore();
    core.boardNotes.start();
    const step = ls.beginScreenPage.mock.calls[0][0][0];
    feed(NO_RESULTS);
    expect(step.expect()).toBe(false);
  });

  test("a banner never answered: the page shows PTT's screen with the failure hint; a key leaves with a space", () => {
    const t = liveCore();
    t.poll.start();
    const step = t.ls.beginScreenPage.mock.calls[0][0][0];
    t.feed(NO_RESULTS);
    t.ls.held = false;
    step.onFail();
    expect(t.poll.phase).toBe("shown");
    expect(t.hints.at(-1)).toEqual([i18n("pollResults_failed"), "error"]);
    expect(t.poll.takeKey(key("x"))).toBe(true);
    expect(t.ls.continueUserQuery.mock.calls[0][0].keys).toBe(" ");
  });
});
