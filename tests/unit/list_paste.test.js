// @unit-env browser
// List easy-reading paste contract (#159): easy reading presents no place to
// paste into, so pasted text over the list is refused. onPaste(text) returns
// true (taken over, the caller must not send it), sends nothing, leaves the
// session where it was and shows an error-level hint. When the session does not
// own the screen (native mirror, idle, ...) it returns false and the ordinary
// send path stays in charge.
import { ListSession } from "../../src/js/list_session";

function makeSession() {
  const sent = [];
  const enqueued = [];
  const core = { conn: { isConnected: true, send: (d) => sent.push(d) } };
  const view = {
    hideCursor() {},
    showCursor() {},
    resetListAccumulation() {},
    flashListHint() {},
    lineWrap: 0,
    blacklist: new Set(),
    titleBlacklist: [],
  };
  const termBuf = {
    rows: 24,
    cols: 80,
    listLines: [],
    listLineNums: [],
    lineChangeds: new Array(24).fill(false),
    changed: false,
    // 靜置探針（非導覽操作完成後自動回好讀）會在 hold 期間量一次當下畫面，
    // 所以 stub 也要有 TermBuf 的畫面讀取介面（真的 TermBuf 一定有）。
    getRowText: () => "",
    isUnicolor: () => false,
    cur_x: 0,
    cur_y: 0,
    addEventListener() {},
    notify() {},
  };
  const queue = {
    idle: true,
    inFlightKind: null,
    flush() {
      this.flushed = (this.flushed || 0) + 1;
    },
    flushPending() {
      this.pendingFlushed = (this.pendingFlushed || 0) + 1;
    },
    flushPendingKind() {},
    hasKind: () => false,
    enqueue(cmd) {
      enqueued.push(cmd);
    },
    onSettle() {},
  };
  const s = new ListSession(core, view, termBuf, queue);
  return { s, sent, enqueued, queue };
}

// An article code is a jump now (#253, aid_jump.test.js); other text is refused.
const AID = "not an article code";
const PASTE_HINT = "好讀模式目前不支援在列表貼上文字";

// A pasted ptt.cc article link is a jump too, as over an easy-reading article
// (#281): the list's board selects it there, another board takes the deep-link
// navigation (aid_jump.startAidJump).
describe("ListSession.onPaste — a pasted article link", () => {
  function linked() {
    const session = makeSession();
    const { s } = session;
    const hints = [];
    s._view.flashListHint = (...a) => hints.push(a);
    s.state = "active";
    s._renderMode = "buffer";
    Object.assign(s._core, {
      view: s._view,
      listSession: { aidJumpBoard: () => "Test", selectionOrigin() {}, restoreSelection() {} },
      aidNavigation: { selectArticle: vi.fn(() => true), active: false },
      deepLinkController: { request: vi.fn(() => "navigating") },
    });
    return { ...session, hints };
  }

  test("a link to an article on the list's board selects it there, with no refusal", () => {
    const { s, hints, sent } = linked();
    expect(s.onPaste("https://www.ptt.cc/bbs/Test/M.1783270974.A.0CA.html")).toBe(true);
    expect(s._core.aidNavigation.selectArticle.mock.calls[0].slice(0, 2)).toEqual(["Test", "1gIeu-3A"]);
    expect(hints).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("a link to another board takes the deep-link navigation", () => {
    const { s, hints } = linked();
    expect(s.onPaste("https://www.ptt.cc/bbs/Gossiping/M.1783270974.A.0CA.html")).toBe(true);
    expect(s._core.deepLinkController.request).toHaveBeenCalledWith({ board: "Gossiping", aid: "1gIeu-3A" });
    expect(s._core.aidNavigation.selectArticle).not.toHaveBeenCalled();
    expect(hints).toEqual([]);
  });

  test("any other link is still refused", () => {
    const { s, hints } = linked();
    expect(s.onPaste("https://www.ptt.cc/bbs/Test/index.html")).toBe(true);
    expect(s._core.aidNavigation.selectArticle).not.toHaveBeenCalled();
    expect(hints).toEqual([[PASTE_HINT, 4000, "error"]]);
  });
});

describe("ListSession.onPaste — refused in easy reading", () => {
  test("text longer than an article code can be is refused, never parsed as one", () => {
    const { s, enqueued, sent } = makeSession();
    const hints = [];
    s._view.flashListHint = (...a) => hints.push(a);
    s.state = "active";
    s._renderMode = "buffer";
    expect(s.onPaste("#1gTTD8RU" + " ".repeat(5000) + "Test")).toBe(true);
    expect(enqueued).toEqual([]);
    expect(sent).toEqual([]);
    expect(hints).toEqual([[PASTE_HINT, 4000, "error"]]);
  });

  test("active on the buffer: refused, nothing enqueued or sent, state unchanged, hint shown", () => {
    const { s, sent, enqueued } = makeSession();
    const hints = [];
    s._view.flashListHint = (...a) => hints.push(a);
    s.state = "active";
    s._renderMode = "buffer";
    s._selectedNum = 42;

    expect(s.onPaste(AID)).toBe(true);
    expect(enqueued).toEqual([]);
    expect(sent).toEqual([]);
    expect(s.state).toBe("active");
    expect(s._renderMode).toBe("buffer");
    expect(hints).toEqual([[PASTE_HINT, 4000, "error"]]);
  });

  test("pinned selection (no number) is refused the same way", () => {
    const { s, enqueued, sent } = makeSession();
    s.state = "active";
    s._renderMode = "buffer";
    s._selectedNum = null;
    s._selectedPinnedKey = "arrenwu|[公告] 板規";

    expect(s.onPaste(AID)).toBe(true);
    expect(enqueued).toEqual([]);
    expect(sent).toEqual([]);
    expect(s.state).toBe("active");
  });

  test("not engaged (render mode native / state not active) → false, ordinary send path", () => {
    for (const state of ["idle", "functionMode", "suspended"]) {
      const { s, enqueued } = makeSession();
      s.state = state;
      s._renderMode = "native";
      expect(s.onPaste(AID)).toBe(false);
      expect(enqueued).toEqual([]);
    }
    const { s } = makeSession();
    s.state = "suspended";
    s._renderMode = "buffer";
    expect(s.onPaste(AID)).toBe(false);
  });

  test("transaction in flight (opening / functionMode+frozen) → swallowed with the busy hint, returns true", () => {
    for (const setup of [
      (s) => {
        s.state = "opening";
        s._renderMode = "buffer";
      },
      (s) => {
        s.state = "functionMode";
        s._renderMode = "frozen";
      },
    ]) {
      const { s, enqueued, sent } = makeSession();
      const hints = [];
      s._view.flashListHint = (m) => hints.push(m);
      setup(s);
      expect(s.onPaste(AID)).toBe(true);
      expect(enqueued).toEqual([]);
      expect(sent).toEqual([]);
      expect(hints.length).toBe(1);
      expect(hints[0]).not.toBe(PASTE_HINT);
    }
  });
});
