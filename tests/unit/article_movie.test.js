// @unit-env browser
// An article's animation (#300, src/js/article_movie.js): `p` in an
// easy-reading article plays it on the page of PTT's own screen
// (screen_page.js, shared with the board entry screen) over the held article,
// the keys that reach PTT raw and the way back to the article. PTT's screens
// are fed through PttChrome's own TermBuf/AnsiParser; the command queue,
// easy reading and the article hold are stubs that record what the page asks
// of them. Every screen is invented; the shapes follow pmore.c's movie
// footers and pmore_cmd_movie's questions.
import { TermBuf } from "../../src/js/term_buf";
import { AnsiParser } from "../../src/js/ansi_parser";
import { u2b } from "../../src/js/string_util";
import { loadBig5Tables } from "./helpers/load_big5_tables";
import { ArticleMovie, articleMovieDecision, showArticleMovie } from "../../src/js/article_movie";
import { articleLeftoverKey, articleWouldRefuse } from "../../src/js/easy_reading";
import { inputPage, screenPageHolding } from "../../src/js/input_page";
import { renderScreen } from "../../src/js/term_ui";
import { i18n, setupI18n } from "../../src/js/i18n";
import { serializedOpHint } from "../../src/js/serialized_op_gate";
import { mobileToolbarContext } from "../../src/js/mobile_toolbar";

vi.mock("../../src/js/term_ui", async (importOriginal) => ({
  ...(await importOriginal()),
  renderScreen: vi.fn(() => ({ release: vi.fn() })),
}));

const COLS = 80;
const ROWS = 24;
const at = (row, col = 0) => "\x1b[" + (row + 1) + ";" + (col + 1) + "H";
const CLEAR = "\x1b[H\x1b[2J";
const HOME = "\x1b[1~";

const STATUS = "  瀏覽 第 1/3 頁 ( 33%)  目前顯示: 第 01~23 行  (y)回應(X%)推文(h)說明(←)離開 ";
// The article in pmore's pager, the cursor on its footer.
const ARTICLE = CLEAR + "作者  tester (tester) 看板 Test" + at(1) + "標題  [動畫] 測試" +
  at(4) + "第一行內文" + at(ROWS - 1) + STATUS + at(ROWS - 1, 79);
// pmore's question on an article that is no movie (getdata_buf on b_lines-1),
// over the article with its footer.
const SPEED = "這可能是傳統動畫檔, 若要直接播放請輸入速度(秒): ";
const QUESTION = ARTICLE + at(ROWS - 2) + SPEED + "1" + at(ROWS - 2, 51);
const AS24 = ARTICLE + at(ROWS - 2) + "傳統動畫是以 24 行為單位設計的, 要模擬 24 行嗎? (否則會用現在的行數)[Yn] " +
  at(ROWS - 2, 78);
// A movie's frames.
const movie = (n) => CLEAR + at(6, 10) + "\x1b[1;35m動畫第 " + n + " 幀\x1b[m" +
  at(ROWS - 1) + " >>> 動畫播放中... 可按 q, Ctrl-C 或其它任意鍵停止" + at(ROWS - 1, 79);
const INTERACTIVE = CLEAR + at(6, 10) + "請選擇 (1) 或 (2)" +
  at(ROWS - 1) + " >>> 互動式動畫播放中... 可按 q 或 Ctrl-C 停止" + at(ROWS - 1, 79);
const CHOOSING = CLEAR + at(6, 10) + "請選擇 (1) 或 (2)" +
  at(ROWS - 2) + " >> 請輸入選項:  (互動式動畫播放中，可按 q 或 Ctrl-C 中斷)" +
  at(ROWS - 1) + " 1. 左 2. 右" + at(ROWS - 1, 12);
const PAUSED = CLEAR + at(6, 10) + "動畫暫停" +
  at(ROWS - 1) + " >>> 暫停播放動畫，請按任意鍵繼續或 q 中斷。 <<<" + at(ROWS - 1, 79);
const STOPPED = CHOOSING + at(ROWS - 1) + "\x1b[K ◆ 已強制中斷互動式系統 [按任意鍵繼續]" + at(ROWS - 1, 79);
// PTT's title bar, reversed across the row.
const TITLE = "\x1b[7m【主功能表】" + " ".repeat(COLS - 12) + "\x1b[m";
// A movie frame that draws a menu, its footer still pmore's.
const MENU_FRAME = CLEAR + TITLE + at(3) + "  (B)oard 看板列表" +
  at(ROWS - 1) + " >>> 動畫播放中... 可按 q, Ctrl-C 或其它任意鍵停止" + at(ROWS - 1, 79);
// PTT's main menu: PTT left the article.
const MENU = CLEAR + TITLE + at(3) + "  (B)oard 看板列表" + at(ROWS - 1) + "我是測試主選單" + at(4, 1);

const key = (k, extra) => ({ key: k, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...extra });
const flush = () => new Promise((r) => queueMicrotask(r));

describe("articleMovieDecision: what PTT's screen waits for", () => {
  beforeAll(() => loadBig5Tables());
  const facts = (screen) => {
    const buf = new TermBuf(COLS, ROWS);
    buf.setView({ update() {}, updateCursorPos() {}, refreshCursorVisibility() {}, charset: "big5", blinkOn: false });
    new AnsiParser(buf).feed(u2b(screen));
    buf.updateCharAttr();
    const rowTexts = [];
    for (let r = 0; r < ROWS; ++r) rowTexts.push(buf.getRowText(r, 0, COLS));
    return { rowTexts, rows: ROWS, curX: buf.cur_x, curY: buf.cur_y };
  };

  test("a playing movie stops with Home; paused and interactive ones with q", () => {
    expect(articleMovieDecision(facts(movie(1)))).toEqual({ action: "skip", key: HOME, shape: "movie" });
    expect(articleMovieDecision(facts(MENU_FRAME))).toEqual({ action: "skip", key: HOME, shape: "movie" });
    expect(articleMovieDecision(facts(INTERACTIVE))).toEqual({ action: "skip", key: "q", shape: "movie" });
    expect(articleMovieDecision(facts(CHOOSING))).toEqual({ action: "skip", key: "q", shape: "movie" });
    expect(articleMovieDecision(facts(PAUSED))).toEqual({ action: "skip", key: "q", shape: "movie" });
  });

  test("a stopped interactive movie waits for any key; the classic animation's questions are cleared", () => {
    expect(articleMovieDecision(facts(STOPPED))).toEqual({ action: "skip", key: HOME, shape: "pause" });
    expect(articleMovieDecision(facts(QUESTION))).toEqual({ action: "skip", key: "\x03", shape: "input" });
    expect(articleMovieDecision(facts(AS24))).toEqual({ action: "skip", key: "\x03", shape: "input" });
  });

  test("the article, a menu, and a question's words in the article's text wait", () => {
    expect(articleMovieDecision(facts(ARTICLE))).toEqual({ action: "wait" });
    expect(articleMovieDecision(facts(MENU))).toEqual({ action: "wait" });
    // The cursor is on the footer: the words are the article's own.
    expect(articleMovieDecision(facts(ARTICLE + at(ROWS - 2) + SPEED + at(ROWS - 1, 79)))).toEqual({ action: "wait" });
    expect(articleMovieDecision(null)).toEqual({ action: "wait" });
  });
});

describe("the article's animation (#300)", () => {
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
    made.splice(0).forEach((movie) => movie.reset());
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    main.remove();
    document.querySelectorAll("[data-article-movie-page], [data-article-movie-leaving]").forEach((n) => n.remove());
  });

  // A core reading an article in easy reading: easy reading, the command
  // queue and the article hold are stubs.
  function liveCore() {
    const buf = new TermBuf(COLS, ROWS);
    buf.setView({ update() {}, updateCursorPos() {}, refreshCursorVisibility() {}, charset: "big5", blinkOn: false });
    buf.useMouseBrowsing = false;
    buf.startedEasyReading = true;
    buf.easyReadingFunctionMode = false;
    const parser = new AnsiParser(buf);
    const hints = [];
    const modals = new Set();
    const dismissers = [];
    const queue = { enqueue: vi.fn() };
    const easyReading = {
      _enterFunctionMode: vi.fn(() => { buf.easyReadingFunctionMode = true; }),
      settleFunctionMode: vi.fn(() => { buf.easyReadingFunctionMode = false; }),
    };
    // article_hold.run/done/fail as they act on easy reading: done takes the
    // article back (settleFunctionMode), fail holds it.
    const hold = {
      running: null,
      held: false,
      run: vi.fn((source) => { hold.running = source; return true; }),
      done: vi.fn((source) => {
        if (hold.running !== source) return;
        hold.running = null;
        easyReading.settleFunctionMode();
      }),
      fail: vi.fn((source) => {
        if (hold.running !== source) return false;
        hold.running = null;
        hold.held = true;
        return true;
      }),
      // The article's locked bar while an operation runs over it.
      toolbarContext: () => (hold.running || hold.held ? { locked: true, appBar: { kind: "article" } } : null),
    };
    const core = {
      mobile: false,
      buf,
      connectState: 1,
      commandQueue: queue,
      easyReading,
      aidNavigation: { active: false },
      articleHold: hold,
      _openModals: modals,
      _screenContext: { appBar: { kind: "article", title: "[動畫] 測試" } },
      view: {
        mainDisplay: main,
        useEasyReadingMode: true,
        _articleTitle: "[動畫] 測試",
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
      readingRecord: { begin: vi.fn(() => ({ feature: "article-movie" })), end: vi.fn() },
    };
    core.articleMovie = new ArticleMovie(core);
    made.push(core.articleMovie);
    const feed = (screen) => {
      parser.feed(u2b(screen));
      vi.advanceTimersByTime(300);
    };
    feed(ARTICLE);
    const steps = () => queue.enqueue.mock.calls.map((c) => c[0]);
    return { core, buf, feed, hints, modals, dismissers, queue, easyReading, steps, movie: core.articleMovie };
  }

  // `p` sent and PTT's first screen in: the page shows it.
  function shown(screen = movie(1)) {
    const t = liveCore();
    expect(t.movie.start()).toBe(true);
    const step = t.steps()[0];
    t.feed(screen);
    const answer = step.expect();
    expect(answer).toEqual({ page: true });
    step.onDone(answer);
    expect(t.movie.phase).toBe("shown");
    return { ...t, step };
  }

  const pageEl = () => document.querySelector("[data-article-movie-page]");
  const lastRender = () => renderScreen.mock.calls[renderScreen.mock.calls.length - 1];
  const renderedText = (t, call) => call[0].map((_, r) => t.buf.getRowText(r, 0, COLS, call[0])).join("\n");

  test("`p` asks PTT once from the article's top, mirrors natively and owns the wire until the article is back", () => {
    const { core, movie, modals, queue, easyReading, steps, hints, dismissers } = liveCore();
    expect(movie.available()).toBe(true);
    expect(showArticleMovie(core)).toBe(true);
    expect(core.readingRecord.begin).toHaveBeenCalledWith("article-movie", { view: core.view, buf: core.buf });
    // The record is begun on the article as read; the article's copy covers
    // it, an operation over the article; then the native mirror.
    expect(core.articleHold.run).toHaveBeenCalledWith("articleMovie", { cover: true });
    expect(core.readingRecord.begin.mock.invocationCallOrder[0])
      .toBeLessThan(core.articleHold.run.mock.invocationCallOrder[0]);
    expect(core.articleHold.run.mock.invocationCallOrder[0])
      .toBeLessThan(easyReading._enterFunctionMode.mock.invocationCallOrder[0]);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(steps()[0]).toMatchObject({ keys: HOME + "p", kind: "article-movie", fullRepaint: false });
    expect(movie.phase).toBe("asking");
    expect(movie.holding).toBe(true);
    expect(screenPageHolding(core)).toBe(true);
    expect([...modals]).toEqual(["articleMovie"]);
    expect(serializedOpHint(core)).toBe(i18n("articleMovie_busy"));
    // The article's App Bar, locked, until the page shows.
    expect(mobileToolbarContext(core)).toMatchObject({ locked: true, appBar: { kind: "article" } });
    // Asked again, and the system Back meanwhile: the busy hint.
    expect(movie.start()).toBe(false);
    dismissers[0]();
    expect(hints).toEqual([[i18n("articleMovie_busy"), undefined], [i18n("articleMovie_busy"), undefined]]);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  test("not asked for over a native mirror, a running operation, a held article, an AID jump or no connection", () => {
    const cases = [
      (core) => { core.buf.easyReadingFunctionMode = true; },
      (core) => { core.articleHold.running = "postInfo"; },
      (core) => { core.articleHold.held = true; },
      (core) => { core.aidNavigation.active = true; },
      (core) => { core.connectState = 2; },
      (core) => { core.view.useEasyReadingMode = false; },
    ];
    for (const change of cases) {
      const t = liveCore();
      change(t.core);
      // What runs over the article says so; otherwise the article cannot play.
      const hint = serializedOpHint(t.core) || i18n("articleMovie_unavailable");
      expect(t.movie.available()).toBe(false);
      expect(t.movie.start()).toBe(false);
      expect(t.hints).toEqual([[hint, undefined]]);
      expect(t.queue.enqueue).not.toHaveBeenCalled();
      expect(t.easyReading._enterFunctionMode).not.toHaveBeenCalled();
      expect(t.core.articleHold.run).not.toHaveBeenCalled();
      expect(t.movie.phase).toBe("idle");
    }
    const busy = liveCore();
    busy.core.searchInFlight = true;
    expect(busy.movie.start()).toBe(false);
    expect(busy.hints).toEqual([["搜尋中，請稍候…", undefined]]);
    expect(showArticleMovie(null)).toBe(false);
  });

  test("what answers `p`: the article Home drew is a frame on the way; a movie or a question is the page's; a menu is lost", () => {
    const { movie: m, feed, steps } = liveCore();
    m.start();
    const step = steps()[0];
    feed(ARTICLE);
    expect(step.expect()).toBe(false);
    for (const screen of [movie(1), INTERACTIVE, PAUSED, QUESTION]) {
      feed(screen);
      expect(step.expect()).toEqual({ page: true });
    }
    // A movie frame drawing a menu is the movie's.
    feed(MENU_FRAME);
    expect(step.expect()).toEqual({ page: true });
    feed(MENU);
    expect(step.expect()).toEqual({ lost: true });
  });

  test("the page shows the movie's frames live over the held article; keys reach PTT raw; Esc stops it with Home", async () => {
    const t = shown();
    const { core, movie: m, feed, steps, easyReading, hints } = t;
    const page = pageEl();
    expect(page.getAttribute("role")).toBe("dialog");
    expect(page.className).toContain("screenPage");
    const root = page.querySelector(".screenPageScreen");
    expect(root.getAttribute("data-stack-layer")).toBe("articleMovie");
    expect(renderedText(t, lastRender())).toContain("動畫第 1 幀");
    feed(movie(2));
    expect(renderedText(t, lastRender())).toContain("動畫第 2 幀");
    expect(m.appBar()).toMatchObject({ kind: "other", title: i18n("articleMovie_title"), subtitle: "[動畫] 測試" });
    expect(inputPage(core)).toBe(m);
    expect(mobileToolbarContext(core)).toMatchObject({ queryPage: true, locked: false, articleMovie: false });
    expect(m.takeKey(key("x"))).toBe(true);
    expect(core.sendMachineBytes).toHaveBeenLastCalledWith("x");
    expect(m.phase).toBe("shown");
    // Over the article's copy.
    expect(page.classList.contains("overArticleCover")).toBe(true);
    // A tap while it plays does nothing.
    page.click();
    expect(m.phase).toBe("shown");
    expect(m.takeKey(key("Escape"))).toBe(true);
    expect(pageEl()).toBeNull();
    expect(m.phase).toBe("leaving");
    const leave = steps()[1];
    expect(leave).toMatchObject({ keys: HOME, kind: "article-movie-leave" });
    expect(typeof leave.onFlushed).toBe("function");
    // A frame drawn before Home arrived is no answer.
    feed(movie(3));
    expect(leave.expect()).toBe(false);
    feed(ARTICLE);
    expect(easyReading.settleFunctionMode).not.toHaveBeenCalled();
    const answer = leave.expect();
    expect(answer).toEqual({ back: true });
    leave.onDone(answer);
    await flush();
    expect(m.phase).toBe("idle");
    expect(screenPageHolding(core)).toBe(false);
    expect(easyReading.settleFunctionMode).toHaveBeenCalledTimes(1);
    expect(core.readingRecord.end).toHaveBeenCalledWith({ feature: "article-movie" }, "done");
    // The reader's line is asked for before the operation ends: the article's
    // copy lifts once it is restored.
    expect(core.articleHold.done).toHaveBeenCalledWith("articleMovie");
    expect(core.readingRecord.end.mock.invocationCallOrder[0])
      .toBeLessThan(core.articleHold.done.mock.invocationCallOrder[0]);
    expect(core.view.navigationEnded).toHaveBeenCalled();
    expect(serializedOpHint(core)).toBe(null);
    expect(hints).toEqual([]);
  });

  test("an interactive movie takes the reader's choices; q stops it, and a stop at a choice is answered with one more key", async () => {
    const { core, movie: m, feed, steps, easyReading } = shown(INTERACTIVE);
    expect(m.takeKey(key("1"))).toBe(true);
    expect(core.sendMachineBytes).toHaveBeenLastCalledWith("1");
    feed(CHOOSING);
    expect(m.takeKey(key("q"))).toBe(true);
    const first = steps()[1];
    expect(first.keys).toBe("q");
    feed(STOPPED);
    const answer = first.expect();
    expect(answer.again).toMatchObject({ key: HOME, shape: "pause" });
    first.onDone(answer);
    const second = steps()[2];
    expect(second.keys).toBe(HOME);
    feed(ARTICLE);
    second.onDone(second.expect());
    await flush();
    expect(m.phase).toBe("idle");
    expect(easyReading.settleFunctionMode).toHaveBeenCalledTimes(1);
  });

  test("a movie that ends keeps its last frame; the article is back under it at once; any key then only leaves", async () => {
    const { core, movie: m, feed, steps, easyReading, hints } = shown(movie(1));
    feed(movie(2));
    const frames = renderScreen.mock.calls.length;
    feed(ARTICLE);
    expect(m.phase).toBe("ended");
    expect(m.holding).toBe(false);
    // The page keeps its last frame.
    expect(renderScreen).toHaveBeenCalledTimes(frames);
    expect(pageEl()).not.toBeNull();
    await flush();
    expect(easyReading.settleFunctionMode).toHaveBeenCalledTimes(1);
    expect(core.readingRecord.end).toHaveBeenCalledWith({ feature: "article-movie" }, "done");
    expect(m.takeKey(key("x"))).toBe(true);
    expect(core.sendMachineBytes).not.toHaveBeenCalled();
    expect(hints.length).toBe(1);
    expect(m.takeKey(key("ArrowLeft"))).toBe(true);
    expect(m.phase).toBe("idle");
    expect(steps()).toHaveLength(1);
    expect(core.readingRecord.end).toHaveBeenCalledTimes(1);
  });

  test("an article that is no movie: pmore's question on the page, with a hint; the reader may answer it, Esc clears it", async () => {
    const { core, movie: m, feed, steps, hints, easyReading } = shown(QUESTION);
    expect(hints).toEqual([[i18n("articleMovie_notMovie"), undefined]]);
    expect(renderedText({ buf: core.buf }, lastRender())).toContain("這可能是傳統動畫檔");
    expect(m.takeKey(key("2"))).toBe(true);
    expect(core.sendMachineBytes).toHaveBeenLastCalledWith("2");
    expect(m.takeKey(key("Escape"))).toBe(true);
    const leave = steps()[1];
    expect(leave.keys).toBe("\x03");
    feed(ARTICLE);
    leave.onDone(leave.expect());
    await flush();
    expect(m.phase).toBe("idle");
    expect(easyReading.settleFunctionMode).toHaveBeenCalledTimes(1);
  });

  test("the 24-row question plays even when cleared: the movie is PTT's answer, stopped next", () => {
    const { movie: m, feed, steps } = shown(AS24);
    m.takeKey(key("Escape"));
    const first = steps()[1];
    expect(first.keys).toBe("\x03");
    feed(movie(1));
    const answer = first.expect();
    expect(answer.again).toMatchObject({ key: HOME, shape: "movie" });
    first.onDone(answer);
    expect(steps()[2].keys).toBe(HOME);
  });

  test("PTT left the article (a q after the movie ended): no guess, the operation fails and the article is held with the message", async () => {
    const { core, movie: m, feed, steps, easyReading } = shown(INTERACTIVE);
    m.takeKey(key("q"));
    const leave = steps()[1];
    feed(MENU);
    const answer = leave.expect();
    expect(answer).toEqual({ lost: true });
    leave.onDone(answer);
    expect(m.phase).toBe("idle");
    expect(core.articleHold.fail).toHaveBeenCalledWith("articleMovie", expect.objectContaining({
      message: "articleMovie_lost",
    }));
    expect(core.articleHold.held).toBe(true);
    expect(core.articleHold.done).not.toHaveBeenCalled();
    expect(easyReading.settleFunctionMode).not.toHaveBeenCalled();
    expect(core.readingRecord.end).not.toHaveBeenCalled();
    // While the page shows too.
    const other = shown(movie(1));
    other.feed(MENU);
    expect(other.movie.phase).toBe("idle");
    expect(other.core.articleHold.fail).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-article-movie-page]")).toBeNull();
  });

  test("no answer to `p`: the article again takes it back with the hint; a frame of the movie shows with it", () => {
    const a = liveCore();
    a.movie.start();
    a.feed(ARTICLE);
    a.steps()[0].onFail("miss");
    expect(a.movie.phase).toBe("idle");
    expect(a.easyReading.settleFunctionMode).toHaveBeenCalledTimes(1);
    expect(a.core.readingRecord.end).toHaveBeenCalledWith({ feature: "article-movie" }, "fail");
    expect(a.hints).toEqual([[i18n("articleMovie_failed"), "error"]]);
    const b = liveCore();
    b.movie.start();
    b.feed(movie(1));
    // A flushed key is unanswered too.
    b.steps()[0].onFlushed();
    expect(b.movie.phase).toBe("shown");
    expect(b.hints).toEqual([[i18n("articleMovie_failed"), "error"]]);
  });

  test("the connection closed: everything dropped, no reading position restored", () => {
    const { core, movie: m, modals } = shown();
    m.reset();
    expect(m.phase).toBe("idle");
    expect(pageEl()).toBeNull();
    expect(modals.size).toBe(0);
    expect(core.readingRecord.end).not.toHaveBeenCalled();
  });
});

describe("`p` in an easy-reading article", () => {
  test("p and P play the animation, in a mail too; with Ctrl they are refused", () => {
    expect(articleLeftoverKey(key("p"))).toBe("movie");
    expect(articleLeftoverKey(key("P"))).toBe("movie");
    expect(articleLeftoverKey(key("p"), { mail: true })).toBe("movie");
    expect(articleLeftoverKey(key("p", { ctrlKey: true }))).toBe("refuse");
    expect(articleWouldRefuse({ key: "p" }, {}, {})).toBe(false);
    expect(articleWouldRefuse({ key: "p", ctrlKey: true }, {}, {})).toBe(true);
  });
});
