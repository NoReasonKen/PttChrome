// @unit-env browser
// List easy-reading text input (IME) contract (#159): easy reading presents no
// place to type into, so text an input method commits over the list is refused.
// An IME's keydown never reaches onKeyDown (keyCode 229), so term_view.onTextInput
// asks noteTextInput first. noteTextInput(text) returns true (taken over, the
// caller must not send it), sends nothing, leaves the session where it was and
// shows an error-level hint; when the session does not own the screen it returns
// false and the ordinary send path stays in charge.
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



const AID = "#1gTTD8RU";
const TEXT_HINT = "好讀模式目前不支援在列表輸入文字";

describe("ListSession.noteTextInput — refused in easy reading", () => {
  test("active on the buffer: refused, nothing enqueued or sent, state unchanged, hint shown", () => {
    const { s, sent, enqueued } = makeSession();
    const hints = [];
    s._view.flashListHint = (...a) => hints.push(a);
    s.state = "active";
    s._renderMode = "buffer";
    s._selectedNum = 42;

    expect(s.noteTextInput(AID)).toBe(true);
    expect(enqueued).toEqual([]);
    expect(sent).toEqual([]);
    expect(s.state).toBe("active");
    expect(s._renderMode).toBe("buffer");
    expect(hints).toEqual([[TEXT_HINT, 4000, "error"]]);
  });

  test("a single `h` typed as text (soft keyboard, IME in Latin mode) asks for help like the key", () => {
    const { s } = makeSession();
    const hints = [];
    s._view.flashListHint = (...a) => hints.push(a);
    s.state = "active";
    s._renderMode = "buffer";
    s._selectedNum = 42;
    const helped = [];
    s._beginHelp = () => helped.push(true);

    expect(s.noteTextInput("h")).toBe(true);
    expect(helped).toEqual([true]);
    expect(hints).toEqual([]);
    // Longer text that merely starts with it is still text.
    expect(s.noteTextInput("hi")).toBe(true);
    expect(helped).toEqual([true]);
    expect(hints).toEqual([[TEXT_HINT, 4000, "error"]]);
  });

  test("pinned selection (no number) is refused the same way", () => {
    const { s, enqueued, sent } = makeSession();
    s.state = "active";
    s._renderMode = "buffer";
    s._selectedNum = null;
    s._selectedPinnedKey = "arrenwu|[公告] 板規";

    expect(s.noteTextInput(AID)).toBe(true);
    expect(enqueued).toEqual([]);
    expect(sent).toEqual([]);
    expect(s.state).toBe("active");
  });

  test("not engaged (render mode native / state not active) → false, ordinary send path", () => {
    for (const state of ["idle", "functionMode", "suspended"]) {
      const { s, enqueued } = makeSession();
      s.state = state;
      s._renderMode = "native";
      expect(s.noteTextInput(AID)).toBe(false);
      expect(enqueued).toEqual([]);
    }
    const { s } = makeSession();
    s.state = "suspended";
    s._renderMode = "buffer";
    expect(s.noteTextInput(AID)).toBe(false);
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
      expect(s.noteTextInput(AID)).toBe(true);
      expect(enqueued).toEqual([]);
      expect(sent).toEqual([]);
      expect(hints.length).toBe(1);
      expect(hints[0]).not.toBe(TEXT_HINT);
    }
  });
});
