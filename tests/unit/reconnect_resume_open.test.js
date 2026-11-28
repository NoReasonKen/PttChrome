// @unit-env browser
// 開站回到上次的地方（好讀行為，src/js/reconnect_resume.js；docs/reading-record.md
// 「開站回到上次的地方」）：分頁切到背景／關掉時存書籤，下一次開站登入回主功能表後先倒數
// 3 秒（提示下緣的進度條），倒數完還在主功能表才出發；點提示立刻出發；提示出現後的其他
// 輸入（點別處、觸控、滾輪、捲首頁、按鍵）、deep link、使用者自己走開都不送鍵。
// real-input: tests/e2e/offline/mobile_article_search_recovery.offline.spec.js
import {
  ReconnectResume,
  SNAPSHOT_KEY,
  OPEN_RESUME_DELAY_MS,
  RESUME_TOAST_ID,
  bootResumeMode,
  isResumeToastTarget
} from "../../src/js/reconnect_resume";
import { ReadingRecord } from "../../src/js/reading_record";
import { DEFAULT_PREFS, writeValues } from "../../src/js/pref_storage";
import { recordSearchResults } from "../../src/js/search_results_context";
import mainCss from "../../src/css/main.css?raw";

const LIST = {
  kind: "list",
  board: "C_Chat",
  mode: "plain",
  topNum: 353200,
  topPinnedKey: null,
  scrollFrac: 0,
  cursorNum: 353218
};
const POST = { board: "C_Chat", aid: "1gIeu-3A" };
const MAIN_MENU = "【主功能表】                      批踢踢實業坊";
const LOGIN = "請輸入代號，或以 guest 參觀，或以 new 註冊:";

function harness() {
  const listeners = [];
  const termBuf = {
    rows: 24,
    cols: 80,
    pageState: 3,
    row0: "",
    getRowText(row) {
      return row === 0 ? this.row0 : "";
    },
    addEventListener(type, fn) {
      if (type === "screenSettled") listeners.push(fn);
    }
  };
  const view = { _articleBoard: "C_Chat", currentLineIndex: () => 37 };
  const core = {
    connectState: 1,
    autoLogin: { stop: vi.fn() },
    deepLinkController: { hasPending: () => false },
    aidNavigation: {
      active: false,
      currentPostAid: () => POST,
      startResume: vi.fn(() => true)
    },
    easyReading: { _enabled: true, _functionMode: false },
    listSession: { readingPosition: () => LIST }
  };
  core.readingRecord = new ReadingRecord(core);
  const rr = new ReconnectResume(core, view, termBuf);
  const settle = (row0) => {
    termBuf.row0 = row0;
    for (const fn of listeners) fn();
  };
  return { rr, core, settle, termBuf, view };
}

// 上一次開站：登入後在文章裡，分頁被關掉（pagehide）。
function leaveFromOldPage() {
  const old = harness();
  old.settle(MAIN_MENU);
  window.dispatchEvent(new Event("pagehide"));
  return old;
}

const toast = () => document.getElementById(RESUME_TOAST_ID);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.removeItem(SNAPSHOT_KEY);
  window.localStorage.removeItem("pttchrome.recoveryDebug.v1");
  window.localStorage.removeItem("pttchrome.pref.v1");
  if (toast()) toast().remove();
});

describe("bootResumeMode", () => {
  test.each([
    [true, { enableEasyReading: true }, "restored"],
    [false, { enableEasyReading: true }, "open"],
    [true, { enableEasyReading: false }, null],
    [false, { enableEasyReading: false }, null]
  ])("restored=%j %j ⇒ %j", (restored, prefs, mode) => {
    expect(bootResumeMode(restored, prefs)).toBe(mode);
  });
});

describe("存書籤", () => {
  test("登入後關掉分頁 ⇒ 存「回到那篇」", () => {
    leaveFromOldPage();
    const snap = JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY));
    expect(snap.plan).toMatchObject({ kind: "article", board: "C_Chat", aid: "1gIeu-3A" });
  });

  test("not logged in, disconnected or easy reading off ⇒ nothing saved (the old one is cleared)", () => {
    const h = harness();
    window.localStorage.setItem(SNAPSHOT_KEY, "{}");
    window.dispatchEvent(new Event("pagehide"));
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    h.settle(MAIN_MENU);
    h.core.connectState = 2;
    h.rr.saveSnapshot();
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    h.core.connectState = 1;
    writeValues({ ...DEFAULT_PREFS, enableEasyReading: false });
    h.rr.saveSnapshot();
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });
});

describe("開站接回", () => {
  // The reader's inputs the countdown watches (#314), each dispatched where the
  // reader would make it: outside the toast, or on home's own scroller.
  const OUTSIDE_INPUTS = {
    "a tap or click outside the toast": () =>
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
    "a touch": () => document.body.dispatchEvent(new Event("touchstart", { bubbles: true })),
    "a wheel": () => document.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 40 })),
    "a key": () => document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "j" })),
    "a home scroll": (h) => h.home.dispatchEvent(new Event("scroll"))
  };

  // Home's scroller, as the home dashboard registers it (attachRoot).
  function withHome(h) {
    h.home = document.createElement("div");
    document.body.append(h.home);
    h.core.homeDashboard = { rootElement: () => h.home };
    h.view.flashListHint = vi.fn();
    return h;
  }
  afterEach(() => document.querySelectorAll("body > div:not([id])").forEach((el) => el.remove()));

  test("登入回主功能表 ⇒ 先倒數 3 秒（提示）、不送鍵；倒數完才出發", () => {
    expect(OPEN_RESUME_DELAY_MS).toBe(3000);
    leaveFromOldPage();
    const h = harness();
    expect(h.rr.hasPending()).toBe(true);
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    h.settle(LOGIN);
    h.settle(MAIN_MENU);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    expect(toast().hidden).toBe(false);
    expect(toast().textContent).toBe("即將回到上次的地方：C_Chat 的文章");
    expect(h.rr.hasPending()).toBe(true);
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS - 1);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.core.aidNavigation.startResume).toHaveBeenCalledTimes(1);
    expect(h.core.aidNavigation.startResume.mock.calls[0][0]).toMatchObject({
      kind: "article",
      board: "C_Chat",
      aid: "1gIeu-3A",
      fromOpen: true
    });
    expect(toast().hidden).toBe(true);
    expect(h.rr.hasPending()).toBe(false);
  });

  test("the toast has no cancel button and a bottom bar that empties over the countdown", () => {
    const style = document.createElement("style");
    style.textContent = mainCss;
    document.head.append(style);
    onTestFinished(() => style.remove());
    leaveFromOldPage();
    const h = harness();
    h.settle(MAIN_MENU);
    expect(toast().querySelector("button")).toBeNull();
    const bar = toast().querySelector(".resumeLastPlaceProgress");
    const drain = getComputedStyle(bar);
    expect(drain.animationDuration).toBe(OPEN_RESUME_DELAY_MS / 1000 + "s");
    expect(drain.animationTimingFunction).toBe("linear");
    const box = toast().getBoundingClientRect();
    const edge = bar.getBoundingClientRect();
    expect(edge.bottom).toBeCloseTo(box.bottom, 0);
    expect(edge.height).toBeLessThan(box.height / 4);
  });

  test("tapping the toast sets off at once", () => {
    leaveFromOldPage();
    const h = withHome(harness());
    h.settle(MAIN_MENU);
    vi.advanceTimersByTime(500);
    // The tap's own press and touch land on the toast: they are not outside input.
    toast().dispatchEvent(new Event("touchstart", { bubbles: true }));
    toast().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(h.rr.countingDown()).toBe(true);
    toast().querySelector(".resumeLastPlaceText").click();
    expect(h.core.aidNavigation.startResume).toHaveBeenCalledTimes(1);
    expect(h.core.aidNavigation.startResume.mock.calls[0][0]).toMatchObject({ kind: "article", aid: "1gIeu-3A" });
    expect(toast().hidden).toBe(true);
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
    expect(h.core.aidNavigation.startResume).toHaveBeenCalledTimes(1);
  });

  test("a tap on the toast still meets the dispatch-time checks", () => {
    leaveFromOldPage();
    const h = harness();
    h.settle(MAIN_MENU);
    h.core.deepLinkController.hasPending = () => true;
    toast().click();
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    expect(h.rr.hasPending()).toBe(false);
  });

  test.each(Object.keys(OUTSIDE_INPUTS))("%s during the countdown cancels at once: no keys, no hint, not offered again", (input) => {
    leaveFromOldPage();
    const h = withHome(harness());
    h.settle(MAIN_MENU);
    vi.advanceTimersByTime(500);
    OUTSIDE_INPUTS[input](h);
    expect(toast().hidden).toBe(true);
    expect(h.rr.hasPending()).toBe(false);
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS * 2);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    expect(h.view.flashListHint).not.toHaveBeenCalled();
    expect(harness().rr.hasPending()).toBe(false);
  });

  test("input before the toast appears does not cancel", () => {
    leaveFromOldPage();
    const h = withHome(harness());
    h.settle(LOGIN);
    for (const input of Object.values(OUTSIDE_INPUTS)) input(h);
    h.settle(MAIN_MENU);
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
    expect(h.core.aidNavigation.startResume).toHaveBeenCalledTimes(1);
  });

  test("cancelling input reaches the page as well (the reader's action goes on)", () => {
    leaveFromOldPage();
    const h = withHome(harness());
    h.settle(MAIN_MENU);
    const seen = vi.fn();
    h.home.addEventListener("pointerdown", seen);
    const event = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    h.home.dispatchEvent(event);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    expect(h.rr.hasPending()).toBe(false);
  });

  test("倒數中使用者自己走開（離開主功能表）⇒ 作廢", () => {
    leaveFromOldPage();
    const h = harness();
    h.settle(MAIN_MENU);
    h.settle("【看板列表】");
    expect(toast().hidden).toBe(true);
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
  });

  test("倒數中 deep link 登記了 ⇒ 以 deep link 為準", () => {
    leaveFromOldPage();
    const h = harness();
    h.settle(MAIN_MENU);
    h.core.deepLinkController.hasPending = () => true;
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
  });

  test("倒數中斷線 ⇒ 作廢這份計畫", () => {
    leaveFromOldPage();
    const h = harness();
    h.settle(MAIN_MENU);
    h.core.connectState = 2;
    h.rr.capture(false);
    expect(toast().hidden).toBe(true);
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
  });

  test("easy reading off ⇒ not resumed on open", () => {
    leaveFromOldPage();
    writeValues({ ...DEFAULT_PREFS, enableEasyReading: false });
    const h = harness();
    expect(h.rr.hasPending()).toBe(false);
  });

  test("提示認得出來，滑鼠事件不外傳（App._onUploadLayer 靠它不把點提示當成點終端機）", () => {
    leaveFromOldPage();
    const h = harness();
    h.settle(MAIN_MENU);
    expect(isResumeToastTarget(toast().querySelector(".resumeLastPlaceText"))).toBe(true);
    expect(isResumeToastTarget(document.body)).toBe(false);
    const terminal = vi.fn();
    window.addEventListener("mousedown", terminal);
    window.addEventListener("mouseup", terminal);
    window.addEventListener("click", terminal);
    try {
      for (const type of ["mousedown", "mouseup"])
        toast().dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      toast().click();
    } finally {
      window.removeEventListener("mousedown", terminal);
      window.removeEventListener("mouseup", terminal);
      window.removeEventListener("click", terminal);
    }
    expect(terminal).not.toHaveBeenCalled();
  });
});

// Reclaim (the APK renderer was rebuilt) and reconnect (重新連線 pressed) return
// through the countdown of a reopening (#315), worded with the 回到斷線前的位置 label.
describe("Reclaim and reconnect countdown", () => {
  const KINDS = {
    reclaim: () => {
      leaveFromOldPage();
      window.__PTT_ANDROID__ = { version: "1", site: "x", restored: true };
      onTestFinished(() => delete window.__PTT_ANDROID__);
      return harness();
    },
    reconnect: () => {
      const h = harness();
      h.settle(MAIN_MENU);
      h.core.connectState = 2;
      h.rr.capture(false);
      h.core.connectState = 1;
      return h;
    }
  };
  const press = () => {
    // The 重新連線 press, or a key at a login screen: before the toast, never counted.
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
  };

  describe.each(Object.keys(KINDS))("%s", (kind) => {
    test("no key before 3 s; the toast uses the 回到斷線前的位置 wording; dispatch at 3 s", () => {
      const h = KINDS[kind]();
      expect(h.rr.hasPending()).toBe(true);
      press();
      h.settle(LOGIN);
      press();
      h.settle(MAIN_MENU);
      expect(toast().hidden).toBe(false);
      expect(toast().textContent).toBe("即將回到斷線前的位置：C_Chat 的文章");
      expect(toast().querySelector("button")).toBeNull();
      expect(toast().querySelector(".resumeLastPlaceProgress")).not.toBeNull();
      vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS - 1);
      expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(h.core.aidNavigation.startResume).toHaveBeenCalledTimes(1);
      expect(h.core.aidNavigation.startResume.mock.calls[0][0]).toMatchObject({ kind: "article", aid: "1gIeu-3A" });
      expect(h.core.aidNavigation.startResume.mock.calls[0][0].fromOpen).toBeUndefined();
      expect(toast().hidden).toBe(true);
    });

    test("tapping the toast sets off at once", () => {
      const h = KINDS[kind]();
      h.settle(MAIN_MENU);
      vi.advanceTimersByTime(500);
      toast().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      expect(h.rr.countingDown()).toBe(true);
      toast().click();
      expect(h.core.aidNavigation.startResume).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
      expect(h.core.aidNavigation.startResume).toHaveBeenCalledTimes(1);
    });

    test("outside input cancels silently: no keys, plan dropped, not offered again", () => {
      const h = KINDS[kind]();
      h.view.flashListHint = vi.fn();
      h.settle(MAIN_MENU);
      vi.advanceTimersByTime(500);
      document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "j" }));
      expect(toast().hidden).toBe(true);
      expect(h.rr.hasPending()).toBe(false);
      vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS * 2);
      h.settle(MAIN_MENU);
      vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
      expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
      expect(h.view.flashListHint).not.toHaveBeenCalled();
    });

    test("a disconnect during the countdown discards the plan", () => {
      const h = KINDS[kind]();
      h.settle(MAIN_MENU);
      h.core.connectState = 2;
      h.rr.capture(false);
      expect(toast().hidden).toBe(true);
      vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
      expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    });
  });
});

describe("Foreground recovery checkpoints", () => {
  test("keeps the last visible location when shutdown changes mobile geometry", () => {
    const h = harness();
    h.termBuf.pageState = 2;
    h.core.mobile = true;
    h.view.chh = 18;
    let position = { ...LIST, topNum: 16 };
    h.core.listSession.readingPosition = () => position;
    h.settle(MAIN_MENU);
    h.rr.saveSnapshot();
    position = { ...position, topNum: 25 };
    h.core.mobile = false;
    h.view.chh = 10;
    window.dispatchEvent(new Event("pagehide"));
    const saved = JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY));
    expect(saved.plan.bookmark.list.topNum).toBe(16);
  });

  test("also protects card-mode changes that keep the same mobile flag and font height", () => {
    const h = harness();
    h.termBuf.pageState = 2;
    h.core.mobile = true;
    h.view.chh = 18;
    h.view.listCards = true;
    let position = { ...LIST, topNum: 16 };
    h.core.listSession.readingPosition = () => position;
    h.settle(MAIN_MENU);
    h.rr.saveSnapshot();
    h.view.listCards = false;
    position = { ...position, topNum: 25 };
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)).plan.bookmark.list.topNum).toBe(16);
  });

  test("layout protection does not reuse a checkpoint after the reader changes boards", () => {
    const h = harness();
    h.termBuf.pageState = 2;
    h.core.mobile = true;
    h.view.chh = 18;
    h.settle(MAIN_MENU);
    h.rr.saveSnapshot();
    h.core.listSession.readingPosition = () => ({ ...LIST, board: "Test", topNum: 25 });
    h.core.mobile = false;
    h.view.chh = 10;
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)).plan.board).toBe("Test");
  });

  test("waits for a stable geometry window before replacing a foreground checkpoint", () => {
    const h = harness();
    h.view.chh = 18;
    h.settle(MAIN_MENU);
    h.settle("article content");
    vi.advanceTimersByTime(250);
    h.view.chh = 10;
    vi.advanceTimersByTime(250);
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    vi.advanceTimersByTime(500);
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)).plan.kind).toBe("article");
  });

  test("persists the visible search anchor and passes it through reopening", () => {
    const h = harness();
    h.termBuf.pageState = 2;
    h.termBuf.listLineNums = [LIST.topNum];
    h.termBuf.listLines = [`${String(LIST.topNum).padStart(7)}     9/01 alice        □ topic`];
    recordSearchResults(h.core, { board: "C_Chat", filters: [{ kind: "title", value: "topic" }] });
    h.settle(MAIN_MENU);
    h.rr.saveSnapshot();
    const snap = JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY));
    expect(snap.plan.searchPosition).toMatchObject({ num: LIST.topNum, author: "alice", title: "□ topic" });
    const next = harness();
    next.settle(MAIN_MENU);
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
    expect(next.core.aidNavigation.startResume.mock.calls[0][0].searchPosition).toEqual(snap.plan.searchPosition);
  });

  test("reopens the article even when no background or shutdown event arrives", () => {
    const old = harness();
    old.settle(MAIN_MENU);
    old.settle("article content");
    vi.advanceTimersByTime(500);
    const snap = JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY));
    expect(snap?.plan).toMatchObject({ kind: "article", board: POST.board, aid: POST.aid });
    const next = harness();
    expect(next.rr.diagnostics().boot).toMatchObject({ validPlan: true, kind: "article" });
    expect(next.rr.hasPending()).toBe(true);
  });

  test("records the latest scroll position with at most one write per checkpoint window", () => {
    const h = harness();
    h.view.mainDisplay = document.createElement("div");
    document.body.append(h.view.mainDisplay);
    h.settle(MAIN_MENU);
    h.settle("article content");
    vi.advanceTimersByTime(500);
    h.view.currentLineIndex = () => 81;
    for (let i = 0; i < 30; i++) h.view.mainDisplay.dispatchEvent(new Event("scroll"));
    const write = vi.spyOn(Storage.prototype, "setItem");
    try {
      vi.advanceTimersByTime(500);
      expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)).plan.bookmark.article.lineIndex).toBe(81);
      expect(write.mock.calls.filter(([key]) => key === SNAPSHOT_KEY)).toHaveLength(1);
    } finally {
      write.mockRestore();
      h.view.mainDisplay.remove();
    }
  });

  test("does not overwrite the saved place during a navigation transaction", () => {
    const h = harness();
    h.settle(MAIN_MENU);
    h.settle("article content");
    vi.advanceTimersByTime(500);
    const saved = window.localStorage.getItem(SNAPSHOT_KEY);
    expect(saved).not.toBeNull();
    h.core.aidNavigation.active = true;
    h.view.currentLineIndex = () => 99;
    h.settle("intermediate navigation screen");
    vi.advanceTimersByTime(500);
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBe(saved);
  });

  test("does not save before login or when easy reading is off", () => {
    const h = harness();
    h.settle(LOGIN);
    vi.advanceTimersByTime(500);
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    writeValues({ ...DEFAULT_PREFS, enableEasyReading: false });
    h.settle(MAIN_MENU);
    h.settle("article content");
    vi.advanceTimersByTime(500);
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });

  test("checkpoints list reading and never resurrects a place after explicit logout", () => {
    const h = harness();
    h.termBuf.pageState = 2;
    h.core.listSession.state = "active";
    h.settle(MAIN_MENU);
    h.settle("article list");
    vi.advanceTimersByTime(500);
    expect(JSON.parse(window.localStorage.getItem(SNAPSHOT_KEY)).plan.kind).toBe("list");
    h.settle("article list");
    h.rr.capture(true);
    vi.advanceTimersByTime(500);
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });
});

describe("Recovery diagnostics available after startup", () => {
  test("retains recorded teardown decisions across reopening when the resume snapshot is missing", () => {
    const old = harness();
    old.core.debugRecorder = { isRecording: true, log: vi.fn() };
    old.rr.recordingStarted();
    old.settle(MAIN_MENU);
    old.rr.saveSnapshot();
    old.rr.capture(false);
    old.core.connectState = 2;
    old.rr.saveSnapshot();
    const next = harness();
    const info = next.rr.diagnostics();
    expect(info.boot.storage).toBe("missing");
    expect(info.previousRecording).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "saveSnapshot", kind: "article", storage: "written" }),
      expect.objectContaining({ event: "capture", kind: "article" }),
      expect.objectContaining({ event: "saveSnapshot", kind: null, storage: "removed" })
    ]));
    expect(JSON.stringify(info.previousRecording)).not.toContain(POST.aid);
    expect(JSON.stringify(info.previousRecording)).not.toContain(POST.board);
    expect(window.localStorage.getItem("pttchrome.recoveryDebug.v1")).toBeNull();
  });

  test("does not persist teardown diagnostics without an active recording", () => {
    const h = harness();
    h.settle(MAIN_MENU);
    h.rr.saveSnapshot();
    expect(window.localStorage.getItem("pttchrome.recoveryDebug.v1")).toBeNull();
    h.core.debugRecorder = { isRecording: false, log: vi.fn() };
    h.rr.saveSnapshot();
    expect(window.localStorage.getItem("pttchrome.recoveryDebug.v1")).toBeNull();
  });

  test("ignores malformed and expired diagnostic traces", () => {
    window.localStorage.setItem("pttchrome.recoveryDebug.v1", "{");
    expect(harness().rr.diagnostics().previousRecording).toBeNull();
    window.localStorage.setItem("pttchrome.recoveryDebug.v1", JSON.stringify({
      at: Date.now() - 13 * 60 * 60 * 1000, events: []
    }));
    expect(harness().rr.diagnostics().previousRecording).toBeNull();
  });

  test("retains boot and discard decisions without navigation targets", () => {
    leaveFromOldPage();
    const h = harness();
    h.settle(MAIN_MENU);
    h.settle("【看板列表】");
    const info = h.rr.diagnostics();
    expect(info.boot).toMatchObject({ storage: "read", validPlan: true, kind: "article", mode: "open" });
    expect(info.recent).toContainEqual(expect.objectContaining({ event: "discard", reason: "moved" }));
    expect(info.pendingKind).toBeNull();
    expect(JSON.stringify(info)).not.toContain(POST.aid);
    expect(JSON.stringify(info)).not.toContain(POST.board);
    info.recent[0].event = "modified";
    expect(h.rr.diagnostics().recent[0].event).not.toBe("modified");
  });

  test("distinguishes missing, malformed, and expired snapshots", () => {
    window.localStorage.removeItem(SNAPSHOT_KEY);
    expect(harness().rr.diagnostics().boot.storage).toBe("missing");
    window.localStorage.setItem(SNAPSHOT_KEY, "{");
    expect(harness().rr.diagnostics().boot).toMatchObject({ storage: "invalid-json", validPlan: false });
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      at: Date.now() - 13 * 60 * 60 * 1000,
      plan: { kind: "article", board: POST.board, aid: POST.aid }
    }));
    expect(harness().rr.diagnostics().boot).toMatchObject({ storage: "read", validPlan: false });
  });

  test("reports failed storage writes and bounds recent decisions", () => {
    const h = harness();
    h.settle(MAIN_MENU);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError");
    });
    try {
      h.rr.saveSnapshot();
      expect(h.rr.diagnostics().recent.at(-1)).toMatchObject({
        event: "saveSnapshot", kind: "article", storage: "storage-error"
      });
    } finally {
      write.mockRestore();
    }
    for (let i = 0; i < 30; i++) h.rr.saveSnapshot();
    expect(h.rr.diagnostics().recent).toHaveLength(24);
    expect(h.rr.diagnostics().boot).not.toBeNull();
    expect(h.rr.diagnostics().recent.at(-1).storage).toBe("written");
  });
});
