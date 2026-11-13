// Text that reaches PTT without a key event (an input method, a paste) while
// an article is open in easy reading. Easy reading presents nowhere to type, so
// the text is refused with a message (#160); only a help or reply character
// still opens the native mirror, like its key does. Once a native prompt is
// mirrored, text passes through untouched.
import { EasyReading } from "../../src/js/easy_reading";

function harness({ enabled = true, startedEasyReading = true } = {}) {
  const buf = {
    easyReadingFunctionMode: false,
    lineChangeds: { fill: () => {} },
    changed: false,
    notifyCalls: 0,
    notify() {
      this.notifyCalls++;
    }
  };
  const ctx = {
    _enabled: enabled,
    startedEasyReading,
    sendCommandAfterUpdate: "",
    _savedScrollTop: null,
    _view: {
      mainDisplay: { scrollTop: 120 },
      hints: [],
      flashListHint(msg, ms, level) {
        this.hints.push({ msg, level });
      }
    },
    _termBuf: buf,
    // 真實實作：noteTextInput 的重點就是「有沒有正確接上 _enterFunctionMode」。
    _enterFunctionMode: EasyReading.prototype._enterFunctionMode,
    enterNativeRoute: EasyReading.prototype.enterNativeRoute,
    refuseText: EasyReading.prototype.refuseText,
    _refuseUnsupported: EasyReading.prototype._refuseUnsupported
  };
  Object.defineProperty(ctx, "_functionMode", {
    get: () => buf.easyReadingFunctionMode,
    set: v => {
      buf.easyReadingFunctionMode = v;
    }
  });
  return { ctx, buf };
}

const noteTextInput = (ctx, text, isPasting) =>
  EasyReading.prototype.noteTextInput.call(ctx, text, isPasting);

test("a reply character opens the native mirror and is not refused", () => {
  const h = harness();
  expect(noteTextInput(h.ctx, "y")).toBe(false);
  expect(h.buf.easyReadingFunctionMode).toBe(true);
  expect(h.ctx._savedScrollTop).toBe(120); // 'resume' scrolls back with it
  expect(h.buf.notifyCalls).toBe(1);
  expect(h.ctx._view.hints).toEqual([]);
});

test("typed text is refused with a message and the article stays", () => {
  const h = harness();
  expect(noteTextInput(h.ctx, "你好")).toBe(true);
  expect(h.buf.easyReadingFunctionMode).toBe(false);
  expect(h.buf.notifyCalls).toBe(0);
  expect(h.ctx._view.hints).toHaveLength(1);
  expect(h.ctx._view.hints[0].msg).toContain("輸入文字");
  expect(h.ctx._view.hints[0].level).toBe("error");
});

test("pasted text is refused, a pasted reply character included", () => {
  const h = harness();
  expect(noteTextInput(h.ctx, "y", true)).toBe(true);
  expect(h.buf.easyReadingFunctionMode).toBe(false);
  expect(h.ctx._view.hints[0].msg).toContain("貼上");
});

test("a native prompt already mirrored takes the text", () => {
  const h = harness();
  noteTextInput(h.ctx, "y");
  h.ctx._view.mainDisplay.scrollTop = 0; // the mirror's redraw reset it
  expect(noteTextInput(h.ctx, "推文內容")).toBe(false);
  expect(noteTextInput(h.ctx, "pasted", true)).toBe(false);
  expect(h.ctx._savedScrollTop).toBe(120);
  expect(h.buf.notifyCalls).toBe(1);
  expect(h.ctx._view.hints).toEqual([]);
});

test("easy reading off: nothing happens and the text goes out", () => {
  const h = harness({ enabled: false });
  expect(noteTextInput(h.ctx, "abc")).toBe(false);
  expect(h.buf.easyReadingFunctionMode).toBe(false);
  expect(h.buf.notifyCalls).toBe(0);
});

test("no article open (a list, a menu): nothing happens", () => {
  const h = harness({ startedEasyReading: false });
  expect(noteTextInput(h.ctx, "abc")).toBe(false);
  expect(h.buf.easyReadingFunctionMode).toBe(false);
  expect(h.ctx._view.hints).toEqual([]);
});
