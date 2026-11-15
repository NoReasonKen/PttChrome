// 斷線重連後回到原處（src/js/reconnect_resume.js；docs/reading-record.md「斷線重連」）：
// 斷線那一刻要去哪（resumePlanFrom，純函式）＋什麼時候出發（登入後的主功能表）。
// 實際的鍵序列與落地還原在 aid_navigation.test.js「startResume」。
import {
  ReconnectResume,
  resumePlanFrom,
  OPEN_RESUME_DELAY_MS,
  RECOVERY_ARRIVAL_HOLD_MS,
  RECOVERY_DRIVE_HOLD_MS,
  RECOVERY_PRESENT_HOLD_MS
} from "../../src/js/reconnect_resume";
import { ReadingRecord } from "../../src/js/reading_record";

const LIST = {
  kind: "list",
  board: "C_Chat",
  mode: "plain",
  topNum: 353200,
  topPinnedKey: null,
  scrollFrac: 0,
  cursorNum: 353218
};
const ARTICLE = { kind: "article", board: "C_Chat", lineIndex: 37, atBottom: false, easy: true };
const POST = { board: "C_Chat", aid: "1gIeu-3A" };

describe("resumePlanFrom（斷線那一刻要回哪）", () => {
  test("在文章裡、知道本篇 AID ⇒ 回到那篇文章（帶書籤還原列）", () => {
    const bm = { article: ARTICLE, list: LIST };
    expect(resumePlanFrom(bm, POST)).toEqual({
      kind: "article",
      board: "C_Chat",
      aid: "1gIeu-3A",
      bookmark: bm
    });
  });

  test("在文章裡但問不到 AID ⇒ 退回那篇所在的列表，游標放回那篇（不用編號開文）", () => {
    const bm = { article: ARTICLE, list: LIST };
    expect(resumePlanFrom(bm, null)).toEqual({
      kind: "list",
      board: "C_Chat",
      num: 353218,
      bookmark: bm
    });
  });

  test("問不到 AID、而身後的列表是別的板 ⇒ 不回（那份列表不是這篇的）", () => {
    const bm = { article: { ...ARTICLE, board: "Android" }, list: LIST };
    expect(resumePlanFrom(bm, null)).toBeNull();
  });

  test("在文章列表 ⇒ 回到那個板，游標放回斷線前那篇", () => {
    const bm = { article: null, list: LIST };
    expect(resumePlanFrom(bm, null)).toEqual({
      kind: "list",
      board: "C_Chat",
      num: 353218,
      bookmark: bm
    });
  });

  test("搜尋結果／文摘（另一個編號空間）⇒ 回到該板完整列表，不帶編號、不還原視野", () => {
    const bm = { article: null, list: { ...LIST, mode: "select" } };
    const plan = resumePlanFrom(bm, null);
    expect(plan.kind).toBe("list");
    expect(plan.num).toBeNull();
    expect(plan.bookmark.list).toBeNull();
  });

  test("verified search metadata accompanies list recovery without reusing result numbers", () => {
    const search = { board: "C_Chat", filters: [{ kind: "title", value: "topic" }, { kind: "author", value: "alice" }] };
    const plan = resumePlanFrom({ article: null, list: { ...LIST, mode: "select" } }, null, search);
    expect(plan.search).toEqual(search);
    expect(plan.num).toBeNull();
    expect(plan.bookmark.list).toBeNull();
    const legacy = resumePlanFrom({ article: null, list: LIST }, null, search);
    expect(legacy.search).toEqual(search);
    expect(legacy.num).toBeNull();
    expect(legacy.bookmark.list).toBeNull();
    expect(resumePlanFrom({ article: ARTICLE, list: { ...LIST, mode: "select" } }, null, search).search).toBeUndefined();
    expect(resumePlanFrom({ article: null, list: { ...LIST, mode: "select" } }, null,
      { ...search, board: "Other" }).search).toBeUndefined();
  });

  test("keeps a validated search viewport anchor separate from full-board numbers", () => {
    const search = { board: "C_Chat", filters: [{ kind: "title", value: "topic" }] };
    const position = { num: 7, author: "reader", date: "9/01", title: "□ topic", scrollFrac: 0.2 };
    const bm = { article: null, list: { ...LIST, mode: "select" } };
    const plan = resumePlanFrom(bm, null, search, position);
    expect(plan.searchPosition).toEqual(position);
    expect(plan.num).toBeNull();
    expect(plan.bookmark.list).toBeNull();
    position.num = 99;
    expect(plan.searchPosition.num).toBe(7);
    expect(resumePlanFrom(bm, null, search, { ...position, num: -1 }).searchPosition).toBeNull();
    expect(resumePlanFrom(bm, null, null, position).searchPosition).toBeUndefined();
  });

  test("游標在置底文（沒有編號）⇒ 進板就停", () => {
    const plan = resumePlanFrom({ article: null, list: { ...LIST, cursorNum: null } }, null);
    expect(plan.num).toBeNull();
    expect(plan.bookmark.list).toEqual({ ...LIST, cursorNum: null });
  });

  test("主功能表／看板列表／站內信（沒有文章也沒有文章列表）⇒ 不回", () => {
    expect(resumePlanFrom({ article: null, list: null, boardList: { kind: "boardList" } }, null)).toBeNull();
    expect(resumePlanFrom({ article: { ...ARTICLE, board: null }, list: null }, null)).toBeNull();
    expect(resumePlanFrom(null, POST)).toBeNull();
  });
});

const MAIN_MENU = "【主功能表】                      批踢踢實業坊";

// 假 termBuf：row0 決定「是不是主功能表」，settle() 觸發 screenSettled。
function harness({ pageState = 3 } = {}) {
  const listeners = [];
  const frameListeners = [];
  const termBuf = {
    rows: 24,
    cols: 80,
    pageState,
    row0: "",
    getRowText(row) {
      return row === 0 ? this.row0 : "";
    },
    addEventListener(type, fn) {
      if (type === "screenSettled") listeners.push(fn);
      if (type === "change") frameListeners.push(fn);
    }
  };
  const view = { _articleBoard: "C_Chat", currentLineIndex: () => 37, navigationEnded: vi.fn() };
  const core = {
    connectState: 1,
    autoLogin: { stop: vi.fn() },
    deepLinkController: { pending: false, hasPending() { return this.pending; } },
    aidNavigation: {
      active: false,
      post: POST,
      currentPostAid() {
        return this.post;
      },
      startResume: vi.fn(() => true)
    },
    easyReading: { _enabled: true, _functionMode: false },
    listSession: { readingPosition: () => LIST, returningFromExternal: () => false },
    homeDashboard: { recheck: vi.fn() }
  };
  core.readingRecord = new ReadingRecord(core);
  const rr = new ReconnectResume(core, view, termBuf);
  const settle = row0 => {
    termBuf.row0 = row0;
    for (const fn of listeners) fn();
  };
  // A frame arrives, before the view draws it and before the screen settles.
  const frame = row0 => {
    termBuf.row0 = row0;
    for (const fn of frameListeners) fn();
  };
  // The run startResume began ends with this result.
  const endRun = result => endResumeRun(core, result);
  return { rr, core, view, termBuf, settle, frame, endRun };
}

function endResumeRun(core, result) {
  const calls = core.aidNavigation.startResume.mock.calls;
  core.aidNavigation.active = false;
  calls[calls.length - 1][1](result);
}

describe("ReconnectResume（何時出發）", () => {
  test("登入過 → 斷線 → 重連登入回到主功能表 ⇒ 出發；先停 AutoLogin", () => {
    const h = harness();
    h.settle(MAIN_MENU); // 這條連線登入過
    h.rr.capture(false);
    expect(h.rr.hasPending()).toBe(true);
    // 重連中：登入流程的畫面不算「使用者走開了」
    h.settle("請輸入代號，或以 guest 參觀，或以 new 註冊:");
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    h.settle(MAIN_MENU);
    expect(h.core.autoLogin.stop).toHaveBeenCalled();
    expect(h.core.aidNavigation.startResume).toHaveBeenCalledTimes(1);
    const plan = h.core.aidNavigation.startResume.mock.calls[0][0];
    expect(plan).toMatchObject({ kind: "article", board: "C_Chat", aid: "1gIeu-3A" });
    // 書籤是斷線那一刻的閱讀紀錄
    expect(plan.bookmark.feature).toBe("reconnect-resume");
    expect(plan.bookmark.article).toMatchObject({ lineIndex: 37 });
    // 一次性
    h.settle(MAIN_MENU);
    expect(h.core.aidNavigation.startResume).toHaveBeenCalledTimes(1);
  });

  test("自己登出 ⇒ 不回去", () => {
    const h = harness();
    h.settle(MAIN_MENU);
    h.rr.capture(true);
    h.settle(MAIN_MENU);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
  });

  test("還沒登入就斷了（重連失敗）⇒ 保留上一份，之後登入成功仍回得去", () => {
    const h = harness();
    h.settle(MAIN_MENU);
    h.rr.capture(false);
    h.settle("請輸入代號");
    h.rr.capture(false); // 第二條連線沒登入就斷
    expect(h.rr.hasPending()).toBe(true);
    h.settle(MAIN_MENU);
    expect(h.core.aidNavigation.startResume).toHaveBeenCalledTimes(1);
  });

  test("從沒登入過（開站就斷）⇒ 沒有東西可回", () => {
    const h = harness();
    h.rr.capture(false);
    expect(h.rr.hasPending()).toBe(false);
  });

  test("沒連上就不出發（connectState 不是 1）", () => {
    const h = harness();
    h.settle(MAIN_MENU);
    h.rr.capture(false);
    h.core.connectState = 2;
    h.settle(MAIN_MENU);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    expect(h.rr.hasPending()).toBe(true);
  });

  test("deep link 也在等登入 ⇒ 讓給它（使用者剛給的連結比較新）", () => {
    const h = harness();
    h.settle(MAIN_MENU);
    h.rr.capture(false);
    h.core.deepLinkController.pending = true;
    h.settle(MAIN_MENU);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    expect(h.rr.hasPending()).toBe(false);
  });

  test("同一次 settle 已經有序列在跑（deep link 先跳了）⇒ 作廢", () => {
    const h = harness();
    h.settle(MAIN_MENU);
    h.rr.capture(false);
    h.core.aidNavigation.active = true;
    h.settle(MAIN_MENU);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    expect(h.rr.hasPending()).toBe(false);
  });

  test("登入後使用者先走開了（不在主功能表）⇒ 作廢，之後回主功能表也不搶畫面", () => {
    const h = harness();
    h.settle(MAIN_MENU);
    h.rr.capture(false);
    h.core.connectState = 2; // 主功能表那一幀還沒出發（例如連線狀態還沒更新）
    h.settle(MAIN_MENU);
    h.core.connectState = 1;
    h.settle("【看板列表】");
    h.settle(MAIN_MENU);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
  });

  // Reconnect resume is part of easy reading: it follows the easy-reading switch.
  describe("easy reading off", () => {
    const prefs = (values) =>
      vi.stubGlobal("window", {
        localStorage: { getItem: () => JSON.stringify({ values }), setItem() {} }
      });
    afterEach(() => vi.unstubAllGlobals());

    test("turned off while reconnecting ⇒ does not set off", () => {
      const h = harness();
      h.settle(MAIN_MENU);
      h.rr.capture(false);
      expect(h.rr.hasPending()).toBe(true);
      prefs({ enableEasyReading: false });
      h.settle(MAIN_MENU);
      expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
      expect(h.rr.hasPending()).toBe(false);
    });

    test("easy reading off ⇒ records and sends nothing", () => {
      prefs({ enableEasyReading: false });
      const h = harness();
      h.settle(MAIN_MENU);
      h.rr.capture(false);
      expect(h.rr.hasPending()).toBe(false);
      h.settle(MAIN_MENU);
      expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    });

    test("on by default", () => {
      prefs({});
      const h = harness();
      h.settle(MAIN_MENU);
      h.rr.capture(false);
      h.settle(MAIN_MENU);
      expect(h.core.aidNavigation.startResume).toHaveBeenCalledTimes(1);
    });
  });

  test("在主功能表斷線 ⇒ 沒有東西可回", () => {
    const h = harness({ pageState: 0 });
    h.core.listSession.readingPosition = () => null;
    h.settle(MAIN_MENU);
    h.rr.capture(false);
    expect(h.rr.hasPending()).toBe(false);
  });
});

// The recovery keeps the page shown while it drives PTT (#188): from the first
// main-menu frame of the login it returns from, through the run, until the
// destination is presented by easy reading or the recovery stops.
describe("ReconnectResume: recovery hold", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Logged in, disconnected while reading an article: a plan is pending.
  const disconnected = (opts) => {
    const h = harness(opts);
    h.settle(MAIN_MENU);
    h.rr.capture(false);
    return h;
  };

  test("holds from the first main-menu frame through the run; an article landing releases it", () => {
    const h = disconnected();
    expect(h.rr.holding).toBe(false);
    // The login screens before the main menu are the reader's to see.
    h.frame("請輸入代號，或以 guest 參觀，或以 new 註冊:");
    expect(h.rr.holding).toBe(false);
    h.frame(MAIN_MENU);
    expect(h.rr.holding).toBe(true);
    h.settle(MAIN_MENU);
    expect(h.core.aidNavigation.startResume).toHaveBeenCalledTimes(1);
    expect(h.rr.holding).toBe(true);
    // Run frames pass far beyond the arrival budget while the run drives PTT.
    vi.advanceTimersByTime(RECOVERY_ARRIVAL_HOLD_MS * 3);
    expect(h.rr.holding).toBe(true);
    expect(h.view.navigationEnded).not.toHaveBeenCalled();
    h.endRun({ ok: true });
    expect(h.rr.holding).toBe(false);
    expect(h.view.navigationEnded).toHaveBeenCalledTimes(1);
    expect(h.core.homeDashboard.recheck).toHaveBeenCalled();
  });

  test("a list destination stays held until the easy-reading list is presented", () => {
    const h = disconnected();
    h.frame(MAIN_MENU);
    h.settle(MAIN_MENU);
    h.core.listSession.returningFromExternal = () => true;
    h.endRun({ ok: true });
    expect(h.rr.holding).toBe(true);
    // The list measures the landing and takes it over.
    h.core.listSession.returningFromExternal = () => false;
    h.rr.pagePresented();
    expect(h.rr.holding).toBe(false);
    expect(h.view.navigationEnded).toHaveBeenCalledTimes(1);
  });

  test("a list that never takes the landing over is drawn after the presentation budget", () => {
    const h = disconnected();
    h.frame(MAIN_MENU);
    h.settle(MAIN_MENU);
    h.core.listSession.returningFromExternal = () => true;
    h.endRun({ ok: true });
    vi.advanceTimersByTime(RECOVERY_PRESENT_HOLD_MS - 1);
    expect(h.rr.holding).toBe(true);
    vi.advanceTimersByTime(1);
    expect(h.rr.holding).toBe(false);
  });

  test("a settle after the list has left its external hold releases it", () => {
    const h = disconnected();
    h.frame(MAIN_MENU);
    h.settle(MAIN_MENU);
    h.core.listSession.returningFromExternal = () => true;
    h.endRun({ ok: true });
    h.core.listSession.returningFromExternal = () => false;
    h.settle("【板主：x】看板《C_Chat》");
    expect(h.rr.holding).toBe(false);
  });

  test("a failed run releases it on the screen where it stopped", () => {
    const h = disconnected();
    h.frame(MAIN_MENU);
    h.settle(MAIN_MENU);
    h.endRun({ ok: false, error: "not found" });
    expect(h.rr.holding).toBe(false);
    expect(h.view.navigationEnded).toHaveBeenCalledTimes(1);
  });

  test("a run that cannot start releases it", () => {
    const h = disconnected();
    h.core.aidNavigation.startResume.mockReturnValue(false);
    h.frame(MAIN_MENU);
    h.settle(MAIN_MENU);
    expect(h.rr.holding).toBe(false);
  });

  test("a run that never ends is drawn after the drive budget", () => {
    const h = disconnected();
    h.frame(MAIN_MENU);
    h.settle(MAIN_MENU);
    vi.advanceTimersByTime(RECOVERY_DRIVE_HOLD_MS - 1);
    expect(h.rr.holding).toBe(true);
    vi.advanceTimersByTime(1);
    expect(h.rr.holding).toBe(false);
  });

  test("a disconnect during the run releases it", () => {
    const h = disconnected();
    h.frame(MAIN_MENU);
    h.settle(MAIN_MENU);
    h.settle("【板主：x】看板《C_Chat》");
    expect(h.rr.holding).toBe(true);
    h.rr.capture(false);
    expect(h.rr.holding).toBe(false);
  });

  test("a main menu the recovery does not leave from is released at its settle", () => {
    const h = disconnected();
    h.core.deepLinkController.pending = true;
    h.frame(MAIN_MENU);
    expect(h.rr.holding).toBe(true);
    h.settle(MAIN_MENU);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    expect(h.rr.holding).toBe(false);
    expect(h.view.navigationEnded).toHaveBeenCalledTimes(1);
  });

  test("a main menu that never settles is drawn after the arrival budget", () => {
    const h = disconnected();
    h.frame(MAIN_MENU);
    vi.advanceTimersByTime(RECOVERY_ARRIVAL_HOLD_MS);
    expect(h.rr.holding).toBe(false);
  });

  test("nothing is held without a plan", () => {
    const h = harness();
    h.frame(MAIN_MENU);
    expect(h.rr.holding).toBe(false);
  });

  test("reopening: the countdown is not held; the run after it is", () => {
    const h = disconnected();
    h.rr._pending = Object.assign({}, h.rr._pending, { fromOpen: true });
    h.frame(MAIN_MENU);
    expect(h.rr.holding).toBe(false);
    h.settle(MAIN_MENU);
    expect(h.rr.countingDown()).toBe(true);
    expect(h.rr.holding).toBe(false);
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
    expect(h.core.aidNavigation.startResume).toHaveBeenCalledTimes(1);
    expect(h.rr.holding).toBe(true);
    h.endRun({ ok: true });
    expect(h.rr.holding).toBe(false);
  });

  test("reopening: an operation the reader started during the countdown supersedes it", () => {
    const h = disconnected();
    h.rr._pending = Object.assign({}, h.rr._pending, { fromOpen: true });
    h.settle(MAIN_MENU);
    h.core.commandQueue = { idle: false };
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    expect(h.rr.holding).toBe(false);
    expect(h.rr.hasPending()).toBe(false);
  });

  test("in transit while a reconnect's plan waits or the hold is on, not while a reopening arrives home or counts down", () => {
    const h = disconnected();
    expect(h.rr.inTransit()).toBe(true);
    // A reopening arrives at home: the dashboard shows from its first frame.
    h.rr._pending = Object.assign({}, h.rr._pending, { fromOpen: true });
    expect(h.rr.inTransit()).toBe(false);
    h.settle(MAIN_MENU);
    expect(h.rr.inTransit()).toBe(false);
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
    expect(h.rr.inTransit()).toBe(true);
    h.endRun({ ok: true });
    expect(h.rr.inTransit()).toBe(false);
  });

  describe("easy reading off", () => {
    afterEach(() => vi.unstubAllGlobals());

    test("nothing is held", () => {
      const h = disconnected();
      vi.stubGlobal("window", {
        localStorage: { getItem: () => JSON.stringify({ values: { enableEasyReading: false } }), setItem() {} }
      });
      h.frame(MAIN_MENU);
      expect(h.rr.holding).toBe(false);
    });
  });
});
