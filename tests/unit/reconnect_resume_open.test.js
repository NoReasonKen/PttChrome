// @unit-env browser
// 開站回到上次的地方（pref resumeLastPlace，src/js/reconnect_resume.js；docs/reading-record.md
// 「開站回到上次的地方」）：分頁切到背景／關掉時存書籤，下一次開站登入回主功能表後先倒數
// （提示上有「取消」），倒數完還在主功能表才出發；deep link、使用者自己走開、取消都不送鍵。
import {
  ReconnectResume,
  SNAPSHOT_KEY,
  OPEN_RESUME_DELAY_MS,
  RESUME_TOAST_ID,
  bootResumeMode,
  isResumeToastTarget
} from "../../src/js/reconnect_resume";
import { ReadingRecord } from "../../src/js/reading_record";
import { DEFAULT_PREFS, NATIVE_SAFE_MODE_KEYS, writeValues } from "../../src/js/pref_storage";

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
  return { rr, core, settle };
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
    [true, { reconnectResume: true, resumeLastPlace: true }, "restored"],
    [true, { reconnectResume: false, resumeLastPlace: true }, "open"],
    [false, { reconnectResume: true, resumeLastPlace: true }, "open"],
    [false, { reconnectResume: true, resumeLastPlace: false }, null],
    [true, { reconnectResume: false, resumeLastPlace: false }, null]
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

  test("還沒登入、斷線中、功能關掉 ⇒ 不存（清掉舊的）", () => {
    const h = harness();
    window.localStorage.setItem(SNAPSHOT_KEY, "{}");
    window.dispatchEvent(new Event("pagehide"));
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    h.settle(MAIN_MENU);
    h.core.connectState = 2;
    h.rr.saveSnapshot();
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    h.core.connectState = 1;
    writeValues({ ...DEFAULT_PREFS, resumeLastPlace: false });
    h.rr.saveSnapshot();
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });
});

describe("開站接回", () => {
  test("登入回主功能表 ⇒ 先倒數（提示）、不送鍵；倒數完才出發", () => {
    leaveFromOldPage();
    const h = harness();
    expect(h.rr.hasPending()).toBe(true);
    expect(window.localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    h.settle(LOGIN);
    h.settle(MAIN_MENU);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    expect(toast().hidden).toBe(false);
    expect(toast().textContent).toContain("C_Chat");
    expect(h.rr.hasPending()).toBe(true);
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
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

  test("按「取消」⇒ 一個鍵都不送，停在主功能表", () => {
    leaveFromOldPage();
    const h = harness();
    h.settle(MAIN_MENU);
    toast().querySelector("button").click();
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS * 2);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
    expect(toast().hidden).toBe(true);
    expect(h.rr.hasPending()).toBe(false);
  });

  test("倒數中使用者自己走開（離開主功能表）⇒ 作廢", () => {
    leaveFromOldPage();
    const h = harness();
    h.settle(MAIN_MENU);
    h.settle("【看板列表】");
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
    vi.advanceTimersByTime(OPEN_RESUME_DELAY_MS);
    expect(h.core.aidNavigation.startResume).not.toHaveBeenCalled();
  });

  test("功能關掉 ⇒ 開站不接回", () => {
    leaveFromOldPage();
    writeValues({ ...DEFAULT_PREFS, resumeLastPlace: false });
    const h = harness();
    expect(h.rr.hasPending()).toBe(false);
  });

  test("提示認得出來（App._onUploadLayer 靠它不把點提示當成點終端機）", () => {
    leaveFromOldPage();
    const h = harness();
    h.settle(MAIN_MENU);
    expect(isResumeToastTarget(toast().querySelector("button"))).toBe(true);
    expect(isResumeToastTarget(document.body)).toBe(false);
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

test("預設開、會送鍵 ⇒ 在安全模式名單內", () => {
  expect(DEFAULT_PREFS.resumeLastPlace).toBe(true);
  expect(NATIVE_SAFE_MODE_KEYS).toContain("resumeLastPlace");
});
