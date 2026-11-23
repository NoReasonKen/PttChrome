// @unit-env browser
// real-input: tests/e2e/offline/mobile_toolbar.offline.spec.js
// 手機黏滯 Ctrl（按鍵面板的 Ctrl → 下一個字元送控制碼）在 term_view 的兩條入口：
//   - onKeyDown：實體鍵盤／面板上的合成鍵
//   - onTextInput：Android 軟鍵盤（字幾乎都走 input 事件，keydown 是 229）
// 只用一次就解除；字母必須走 Alt remap（Ctrl+A/C/V 會被 app 的 UI 快捷鍵攔走）。
import { TermView } from "../../src/js/term_view";
import { takeStickyCtrl } from "../../src/js/mobile_layout";
import { OverListPage } from "../../src/js/over_list_page";

function ctx() {
  const core = {
    mobileCtrlArmed: true,
    setMobileCtrlArmed: vi.fn((on) => (core.mobileCtrlArmed = !!on)),
    aidNavigation: { active: false },
    longPush: { active: false },
    easyReading: { _onKeyDown: vi.fn(), noteTextInput: vi.fn() },
    activeListSession: () => null,
    noteListNativeInput: vi.fn(),
  };
  const view = {
    bbscore: core,
    buf: { pageState: 0 },
    useEasyReadingMode: false,
    sendKeyAsUser: vi.fn(),
    _convSend: vi.fn(),
    _keyboard: { onKeyDown: vi.fn() },
    flashListHint: vi.fn(),
  };
  // onTextInput 的剩餘字元會遞迴呼叫自己
  view.onTextInput = TermView.prototype.onTextInput;
  return { core, view };
}

const keyEvent = (key, over) => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  preventDefault: vi.fn(),
  ...over,
});

describe("onKeyDown", () => {
  test("armed 後按 p ⇒ 改送 Alt+p（＝^P），並解除", () => {
    const { core, view } = ctx();
    const e = keyEvent("p");
    TermView.prototype.onKeyDown.call(view, e);
    expect(view.sendKeyAsUser).toHaveBeenCalledWith("p", { key: "p", altKey: true });
    expect(e.preventDefault).toHaveBeenCalled();
    expect(core.mobileCtrlArmed).toBe(false);
    expect(view._keyboard.onKeyDown).not.toHaveBeenCalled();
  });

  test("an armed Ctrl converts q and a before search backtracking or search invalidation sees them", () => {
    for (const key of ["q", "a"]) {
      const { core, view } = ctx();
      core.articleShortcutSearch = { handleBack: vi.fn(() => true), noteSearchKey: vi.fn() };
      TermView.prototype.onKeyDown.call(view, keyEvent(key));
      expect(view.sendKeyAsUser).toHaveBeenCalledWith(key, { key, altKey: true });
      expect(core.articleShortcutSearch.handleBack).not.toHaveBeenCalled();
      expect(core.articleShortcutSearch.noteSearchKey).not.toHaveBeenCalled();
      expect(core.mobileCtrlArmed).toBe(false);
    }
  });

  test("單按 Shift 不算下一個鍵（不解除）", () => {
    const { core, view } = ctx();
    TermView.prototype.onKeyDown.call(view, keyEvent("Shift"));
    expect(core.mobileCtrlArmed).toBe(true);
    expect(view.sendKeyAsUser).not.toHaveBeenCalled();
  });

  test("沒有控制碼的鍵（方向鍵）⇒ 解除、照常送出", () => {
    const { core, view } = ctx();
    TermView.prototype.onKeyDown.call(view, keyEvent("ArrowUp"));
    expect(core.mobileCtrlArmed).toBe(false);
    expect(view.sendKeyAsUser).not.toHaveBeenCalled();
    expect(view._keyboard.onKeyDown).toHaveBeenCalled();
  });
});

describe("onTextInput（軟鍵盤）", () => {
  test("armed 後打 u ⇒ 送 ^U，不送字", () => {
    const { core, view } = ctx();
    view.onTextInput("u");
    expect(view.sendKeyAsUser).toHaveBeenCalledWith("u", { key: "u", altKey: true });
    expect(view._convSend).not.toHaveBeenCalled();
    expect(core.mobileCtrlArmed).toBe(false);
  });

  test("一次上多個字 ⇒ 只有第一個變控制碼，其餘照常", () => {
    const { view } = ctx();
    view.onTextInput("xy");
    expect(view.sendKeyAsUser).toHaveBeenCalledWith("x", { key: "x", altKey: true });
    expect(view._convSend).toHaveBeenCalledWith("y");
  });

  // #292: over a page over the list (the board entry screen) the armed Ctrl
  // applies first, so the letter reaches the page as Ctrl+letter (the Alt
  // remap), never as the plain letter.
  test("over a page over the list: the armed Ctrl comes first and the page gets Ctrl+letter", () => {
    const { core, view } = ctx();
    const page = { ownsInput: () => true, takeKey: vi.fn(() => true), refuseText: vi.fn() };
    core.boardNotes = page;
    view.sendKeyAsUser = TermView.prototype.sendKeyAsUser;
    view.onTextInput("x");
    expect(page.takeKey).toHaveBeenCalledTimes(1);
    expect(page.takeKey.mock.calls[0][0]).toMatchObject({ key: "x", altKey: true, ctrlKey: false });
    expect(page.takeKey.mock.calls[0][1]).toBe(true);
    expect(page.refuseText).not.toHaveBeenCalled();
    expect(core.mobileCtrlArmed).toBe(false);
    // Unarmed, the letter is the plain key.
    view.onTextInput("y");
    expect(page.takeKey.mock.calls[1][0]).toMatchObject({ key: "y", altKey: false, ctrlKey: false });
    expect(view._convSend).not.toHaveBeenCalled();
  });

  test("貼上不吃 Ctrl", () => {
    const { core, view } = ctx();
    view.onTextInput("u", true);
    expect(view.sendKeyAsUser).not.toHaveBeenCalled();
    expect(core.mobileCtrlArmed).toBe(true);
  });
});

test("sendKeyAsUser 帶 altKey ⇒ 合成的 keydown 帶修飾鍵、不補 keypress", () => {
  const seen = [];
  const view = {
    onKeyDown: (e) => seen.push({ key: e.key, alt: e.altKey, ctrl: e.ctrlKey }),
    _keyboard: { onKeyPress: vi.fn() },
  };
  TermView.prototype.sendKeyAsUser.call(view, "p", { altKey: true });
  expect(seen).toEqual([{ key: "p", alt: true, ctrl: false }]);
  expect(view._keyboard.onKeyPress).not.toHaveBeenCalled();
});

describe("takeStickyCtrl (every input entrance)", () => {
  const armed = () => {
    const core = { mobileCtrlArmed: true, setMobileCtrlArmed: vi.fn((on) => (core.mobileCtrlArmed = !!on)) };
    return core;
  };

  test("the next key takes Ctrl and disarms; one without a control code only disarms", () => {
    let core = armed();
    expect(takeStickyCtrl(core, { key: "P" })).toEqual({ key: "p", altKey: true });
    expect(core.mobileCtrlArmed).toBe(false);
    expect(takeStickyCtrl(core, { key: "p" })).toBeNull();
    core = armed();
    expect(takeStickyCtrl(core, { key: "ArrowUp" })).toBeNull();
    expect(core.mobileCtrlArmed).toBe(false);
  });

  test("a modifier alone, a modified key and an input method's keydown are not the next key", () => {
    const core = armed();
    for (const e of [
      { key: "Shift" },
      { key: "x", ctrlKey: true },
      { key: "x", altKey: true },
      { key: "x", metaKey: true },
      { key: "Process", keyCode: 229 },
      { key: "Unidentified", keyCode: 229 },
      { key: "x", isComposing: true },
    ]) expect(takeStickyCtrl(core, e)).toBeNull();
    expect(core.mobileCtrlArmed).toBe(true);
  });
});

// #292: a page over the list takes keyboard keys in a window listener in the
// capture phase, before term_view.onKeyDown. The armed Ctrl applies there
// first, for both pages (OverListPage), and the page gets Ctrl+letter.
describe("a page over the list: the keyboard's keydown", () => {
  let made = [];
  afterEach(() => {
    for (const { shell, host } of made) {
      shell.close(false);
      host.remove();
    }
    made = [];
  });

  function openPage({ owns = true } = {}) {
    const host = document.createElement("div");
    const main = document.createElement("div");
    host.appendChild(main);
    document.body.appendChild(host);
    const page = { ownsInput: () => owns, takeKey: vi.fn(() => true), refuseText: vi.fn() };
    const core = {
      mobileCtrlArmed: true,
      setMobileCtrlArmed: vi.fn((on) => (core.mobileCtrlArmed = !!on)),
      boardNotes: page,
    };
    const view = { bbscore: core, mainDisplay: main, sendKeyAsUser: vi.fn() };
    const onKey = vi.fn();
    const shell = new OverListPage(view, {
      marker: "test-over", className: "testOver", label: "test",
      onKey, canSwipe: () => false, onSwipeLeave: () => {},
    });
    expect(shell.open()).toBe(true);
    made.push({ shell, host });
    return { core, view, onKey };
  }

  const press = (key, over) => {
    const e = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...over });
    document.body.dispatchEvent(e);
    return e;
  };

  test("armed: the letter goes on as the keypad's Ctrl+letter, never to the page as the plain letter", () => {
    const { core, view, onKey } = openPage();
    const e = press("x");
    expect(view.sendKeyAsUser).toHaveBeenCalledWith("x", { key: "x", altKey: true });
    expect(onKey).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
    expect(core.mobileCtrlArmed).toBe(false);
    // Unarmed, the page's own handler gets the key.
    press("y");
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onKey.mock.calls[0][0].key).toBe("y");
    expect(view.sendKeyAsUser).toHaveBeenCalledTimes(1);
  });

  test("a modifier alone and an input method's keydown keep Ctrl armed for the next key", () => {
    const { core, view, onKey } = openPage();
    press("Shift");
    press("Process", { keyCode: 229 });
    expect(core.mobileCtrlArmed).toBe(true);
    expect(view.sendKeyAsUser).not.toHaveBeenCalled();
    expect(onKey).toHaveBeenCalledTimes(2);
  });

  test("with a sheet over the page, the key is the sheet's and Ctrl stays armed", () => {
    const { core, view, onKey } = openPage({ owns: false });
    press("x");
    expect(view.sendKeyAsUser).not.toHaveBeenCalled();
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(core.mobileCtrlArmed).toBe(true);
  });

  test("a toolbar key over the page takes the armed Ctrl as well (sendKeyAsUser)", () => {
    const { core } = openPage();
    const view = { bbscore: core, sendKeyAsUser: TermView.prototype.sendKeyAsUser };
    view.sendKeyAsUser("q");
    expect(core.boardNotes.takeKey).toHaveBeenCalledTimes(1);
    expect(core.boardNotes.takeKey.mock.calls[0][0]).toMatchObject({ key: "q", altKey: true, ctrlKey: false });
    expect(core.boardNotes.takeKey.mock.calls[0][1]).toBe(true);
    expect(core.mobileCtrlArmed).toBe(false);
  });
});
